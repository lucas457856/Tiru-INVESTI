// API: POST /api/notifications/register-event
//
// Grava o EVENTO CENTRAL de notificação em
// `usuarios/{ownerId}/notificationEvents/{eventId}`.
//
// POR QUE ISSO É SERVER-SIDE:
//   - A Firestore Rules proíbe `create` em `notificationEvents/{eventId}`
//     via client SDK (ver regra em firestore.rules). Só o Admin SDK grava,
//     garantindo que o evento não pode ser forjado pelo front.
//   - O `eventId` é gerado pelo CLIENTE (chamador) e enviado no body.
//     Idempotência: se já existe doc com esse id, retorna 200 sem ação.
//     Isso garante que retries (rede instável, F5, re-emissão) não
//     duplicam o evento no Firestore.
//
//   - O `dispatch` (envio FCM) é uma chamada SEPARADA após o register,
//     feita pelo call site (`src/services/notificationEvents.js`).
//     Separar as duas etapas permite que um erro de FCM não impeça
//     a gravação do evento (e vice-versa).
//
// Segurança:
//   - Token verificado via verifyIdToken.
//   - Resolved o DONO efetivo: dono (chamador) ou funcionário vinculado.
//   - `ownerId` enviado no body é IGNORADO — sempre derivado do chamador
//     para evitar que um funcionário inunde o `ownerId` de outro dono.
//   - `eventId` validado como string não-vazia de tamanho razoável.
//   - `type` validado contra `EVENT_TYPES` (constants de
//     `src/utils/notificationEventTypes.js` — espelhado aqui para
//     evitar dependência frontend → backend).
//
// Body esperado:
//   {
//     eventId: string (UUID v4; obrigatório),
//     type: "CONTRACT_CREATED" | "PAYMENT_REGISTERED" | ... (obrigatório),
//     title: string (obrigatório),
//     body: string (obrigatório),
//     data: object (payload para navegação; ex: { contratoId, clienteId, ... }),
//     sourceDeviceId: string (UUID v4 do dispositivo que originou; opcional)
//   }
//
// Resposta (200 OK):
//   {
//     ok: true,
//     eventId: "...",
//     status: "created" | "exists"
//   }

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "../_lib/firebaseAdmin.js";

// Conjunto canônico de tipos de evento. Espelha
// `src/utils/notificationEventTypes.js` para evitar uma dependência
// cross-bucket. Adicionar novo tipo: replicar em ambos os arquivos.
const EVENT_TYPES_VALIDOS = new Set([
  // Contratos
  "CONTRACT_CREATED",
  "CONTRACT_UPDATED",
  "CONTRACT_DELETED",
  // Pagamentos / parcelas
  "PAYMENT_REGISTERED",
  "INSTALLMENT_PAID",
  "INSTALLMENT_DUE_TODAY",
  "INSTALLMENT_OVERDUE",
  // Resumo diário / agregado (1× por dia por usuário)
  "CONTRACTS_SUMMARY",
  "INSTALLMENTS_DUE_TODAY_SUMMARY",
  // Clientes
  "CLIENT_CREATED",
  "CLIENT_UPDATED",
  "CLIENT_DELETED",
  // Funcionários
  "EMPLOYEE_CREATED",
  "EMPLOYEE_UPDATED",
  "EMPLOYEE_DELETED",
]);

function bad(res, status, erro) {
  console.error(`[notifications/register-event] ${status} ${erro}`);
  return res.status(status).json({ ok: false, erro });
}

function extrairBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

// Valida o `sourceDeviceId` enviado pelo client. Espelha a mesma
// lógica aplicada em api/admin/criar-contrato.js:397-449 e
// api/admin/criar-cliente.js:271-321: o deviceId deve (a) existir
// em `usuarios/{chamadorUid}/devices/{sourceDeviceId}`, (b) ter
// `ownerUid === donoUid`, e (c) ter `userRole` compatível com o
// `roleChamador` (defesa em profundidade contra troca de papel).
//
// Quando `sourceDeviceId` é string vazia (omitido pelo front ou
// chamada server-side), retorna `{ ok: true, sourceDeviceId: null }`
// e o caller grava o evento com `sourceDeviceId: null`
// (comportamento atual preservado).
//
// Retorna:
//   { ok: true, sourceDeviceId }                    → pode usar
//   { ok: true, sourceDeviceId: null }              → não enviado, ok
//   { ok: false, code: 400|403|500, msg }           → erro a retornar
async function validarSourceDeviceId({ dbAdmin, chamadorUid, donoUid, roleChamador, sourceDeviceId }) {
  // Sem sourceDeviceId: chamada server-side, comportamento atual.
  if (!sourceDeviceId) {
    return { ok: true, sourceDeviceId: null };
  }
  if (sourceDeviceId.length > 200) {
    return { ok: false, code: 400, msg: "sourceDeviceId inválido (até 200 chars)." };
  }
  let deviceSnap;
  try {
    deviceSnap = await dbAdmin
      .collection("usuarios")
      .doc(chamadorUid)
      .collection("devices")
      .doc(sourceDeviceId)
      .get();
  } catch (err) {
    console.error("[notifications/register-event] leitura do device falhou:", err?.message);
    return { ok: false, code: 500, msg: "Não foi possível validar o dispositivo de origem." };
  }
  if (!deviceSnap.exists) {
    return {
      ok: false,
      code: 400,
      msg: "Dispositivo de origem não registrado. Atualize a página para registrar este dispositivo antes de continuar.",
    };
  }
  const deviceData = deviceSnap.data() || {};
  if (deviceData.ownerUid !== donoUid) {
    console.error(
      "[notifications/register-event] sourceDeviceId com ownerUid divergente:",
      `chamador=${chamadorUid}`,
      `donoUid=${donoUid}`,
      `device.ownerUid=${deviceData.ownerUid}`,
      `sourceDeviceId=${sourceDeviceId}`,
    );
    return { ok: false, code: 403, msg: "Dispositivo de origem não pertence a este proprietário." };
  }
  // userRole esperado: "owner" se roleChamador==="dono", senão "funcionario".
  // (a constante no doc é "owner" minúsculo — ver register-device.js:144.)
  const expectedRole = roleChamador === "funcionario" ? "funcionario" : "owner";
  if (deviceData.userRole && deviceData.userRole !== expectedRole) {
    console.error(
      "[notifications/register-event] sourceDeviceId com userRole divergente:",
      `expected=${expectedRole}`,
      `device.userRole=${deviceData.userRole}`,
      `sourceDeviceId=${sourceDeviceId}`,
    );
    return { ok: false, code: 403, msg: "Dispositivo de origem incompatível com o perfil do chamador." };
  }
  return { ok: true, sourceDeviceId };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido.");
  }

  // 1) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const bodyText = typeof body.body === "string" ? body.body.trim() : "";
  const sourceDeviceId =
    typeof body.sourceDeviceId === "string" ? body.sourceDeviceId.trim() : "";
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data)
    ? body.data
    : null;

  // 2) Validação
  if (!eventId || eventId.length > 200) {
    return bad(res, 400, "eventId é obrigatório (string até 200 chars).");
  }
  if (!type || !EVENT_TYPES_VALIDOS.has(type)) {
    return bad(res, 400, `type inválido. Esperado um de: ${Array.from(EVENT_TYPES_VALIDOS).join(", ")}.`);
  }
  if (!title || title.length > 200) {
    return bad(res, 400, "title é obrigatório (string até 200 chars).");
  }
  if (!bodyText || bodyText.length > 1000) {
    return bad(res, 400, "body é obrigatório (string até 1000 chars).");
  }
  if (sourceDeviceId && sourceDeviceId.length > 200) {
    return bad(res, 400, "sourceDeviceId inválido (string até 200 chars).");
  }

  // 3) Token
  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, 401, "Autenticação obrigatória.");
  }

  // 4) Admin
  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch (err) {
    console.error("[notifications/register-event] Firebase Admin indisponível:", err?.code, err?.message);
    return bad(res, 500, "Serviço de autenticação indisponível. Tente novamente mais tarde.");
  }
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 5) Identidade do chamador
  let chamadorUid;
  try {
    const decoded = await authAdmin.verifyIdToken(idToken, true);
    chamadorUid = decoded.uid;
  } catch (err) {
    console.error("[notifications/register-event] verifyIdToken falhou:", err?.code, err?.message);
    return bad(res, 401, "Sessão inválida. Faça login novamente.");
  }

  // 6) Resolve o DONO efetivo (dono = ele mesmo; funcionário = ownerUid).
  //    O `ownerId` enviado no body é IGNORADO — sempre derivado do chamador.
  let donoUid;
  let roleChamador = "dono";
  try {
    const snap = await dbAdmin.collection("usuarios").doc(chamadorUid).get();
    if (!snap.exists) {
      return bad(res, 403, "Perfil do chamador não encontrado.");
    }
    const data = snap.data() || {};
    if (data.role === "funcionario" && data.ownerUid) {
      donoUid = data.ownerUid;
      roleChamador = "funcionario";
    } else if (data.ownerUid) {
      return bad(res, 403, "Perfil inválido.");
    } else {
      donoUid = chamadorUid;
    }
  } catch (err) {
    console.error("[notifications/register-event] leitura do perfil falhou:", err?.message);
    return bad(res, 500, "Não foi possível validar o chamador.");
  }

  // 6.5) Validação do `sourceDeviceId` (P3 — segurança contra DoS entre
  // devices do mesmo ownerUid). Espelha api/admin/criar-contrato.js:397-449.
  // Se o front enviou um sourceDeviceId, exigimos que o device esteja
  // registrado em `usuarios/{chamadorUid}/devices/{sourceDeviceId}` e
  // que o ownerUid/userRole do doc do device sejam coerentes com o
  // perfil do chamador. Sem isso, um client poderia injetar o
  // deviceId de outro device e fazer o dispatch EXCLUIR esse device
  // do envio FCM (regra "originator" em dispatch.js:277). sourceDeviceId
  // ausente/vazio segue sendo permitido (chamadas server-side).
  const validacaoDevice = await validarSourceDeviceId({
    dbAdmin,
    chamadorUid,
    donoUid,
    roleChamador,
    sourceDeviceId,
  });
  if (!validacaoDevice.ok) {
    return bad(res, validacaoDevice.code, validacaoDevice.msg);
  }
  // A partir daqui, `validacaoDevice.sourceDeviceId` é o valor validado
  // (ou `null` se não enviado). Usamos essa variável local em vez do
  // `sourceDeviceId` bruto do body.
  const sourceDeviceIdValidado = validacaoDevice.sourceDeviceId;

  // 7) Idempotência: checa se o evento já existe.
  const eventoRef = dbAdmin
    .collection("usuarios")
    .doc(donoUid)
    .collection("notificationEvents")
    .doc(eventId);
  try {
    const snap = await eventoRef.get();
    if (snap.exists) {
      return res.status(200).json({ ok: true, eventId, status: "exists" });
    }
  } catch (err) {
    console.error("[notifications/register-event] leitura do evento falhou:", err?.message);
    return bad(res, 500, "Não foi possível verificar o evento.");
  }

  // 8) Grava o evento. ServerTimestamp garante ordenação estável.
  const evento = {
    eventId,
    type,
    title,
    body: bodyText,
    data: data || {},
    sourceDeviceId: sourceDeviceIdValidado,
    ownerId: donoUid,
    createdBy: { uid: chamadorUid, role: roleChamador },
    createdAt: FieldValue.serverTimestamp(),
    status: "created",
    dispatchedAt: null,
  };
  try {
    await eventoRef.set(evento);
  } catch (err) {
    console.error("[notifications/register-event] set evento falhou:", err?.code, err?.message);
    return bad(res, 500, "Não foi possível registrar o evento.");
  }

  console.log(
    "[notifications/register-event] evento criado:",
    `eventId=${eventId}`,
    `type=${type}`,
    `ownerId=${donoUid}`,
    `sourceDevice=${sourceDeviceIdValidado || "(none)"}`,
    `createdBy=${chamadorUid}(${roleChamador})`,
  );

  return res.status(201).json({ ok: true, eventId, status: "created" });
}
