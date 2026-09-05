// Sub-handler: POST /api/notifications/register-event
//
// Disparado por api/notifications/[...slug].js quando slug === "register-event".
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

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { bad, extrairBearer, getAdminSdk, verificarToken } from "../../_lib/http.js";
import { getAuth, validarSourceDeviceId } from "../../_lib/dono.js";

const PREFIX = "notifications/register-event";

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

export async function registerEventHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");

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
    return bad(res, PREFIX, 400, "eventId é obrigatório (string até 200 chars).");
  }
  if (!type || !EVENT_TYPES_VALIDOS.has(type)) {
    return bad(res, PREFIX, 400, `type inválido. Esperado um de: ${Array.from(EVENT_TYPES_VALIDOS).join(", ")}.`);
  }
  if (!title || title.length > 200) {
    return bad(res, PREFIX, 400, "title é obrigatório (string até 200 chars).");
  }
  if (!bodyText || bodyText.length > 1000) {
    return bad(res, PREFIX, 400, "body é obrigatório (string até 1000 chars).");
  }
  if (sourceDeviceId && sourceDeviceId.length > 200) {
    return bad(res, PREFIX, 400, "sourceDeviceId inválido (string até 200 chars).");
  }

  // 3) Token
  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, PREFIX, 401, "Autenticação obrigatória.");
  }

  // 4) Admin
  const admin = getAdminSdk(res, PREFIX);
  if (!admin) return; // getAdminSdk já escreveu a resposta de erro
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 5) Identidade do chamador
  const chamadorUid = await verificarToken(res, PREFIX, authAdmin, idToken);
  if (!chamadorUid) return; // verificarToken já escreveu a resposta de erro

  // 6) Resolve o DONO efetivo (dono = ele mesmo; funcionário = ownerUid).
  //    O `ownerId` enviado no body é IGNORADO — sempre derivado do chamador.
  let donoUid;
  let roleChamador = "dono";
  try {
    const snap = await dbAdmin.collection("usuarios").doc(chamadorUid).get();
    if (!snap.exists) {
      return bad(res, PREFIX, 403, "Perfil do chamador não encontrado.");
    }
    const data = snap.data() || {};
    if (data.role === "funcionario" && data.ownerUid) {
      donoUid = data.ownerUid;
      roleChamador = "funcionario";
    } else if (data.ownerUid) {
      return bad(res, PREFIX, 403, "Perfil inválido.");
    } else {
      donoUid = chamadorUid;
    }
  } catch (err) {
    console.error(`[${PREFIX}] leitura do perfil falhou:`, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível validar o chamador.");
  }

  // 6.5) Validação do `sourceDeviceId` (P3 — segurança contra DoS entre
  // devices do mesmo ownerUid). Helper compartilhado em _lib/dono.js.
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
    prefix: PREFIX,
  });
  if (!validacaoDevice.ok) {
    return bad(res, PREFIX, validacaoDevice.code, validacaoDevice.msg);
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
    console.error(`[${PREFIX}] leitura do evento falhou:`, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível verificar o evento.");
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
    console.error(`[${PREFIX}] set evento falhou:`, err?.code, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível registrar o evento.");
  }

  console.log(
    `[${PREFIX}] evento criado:`,
    `eventId=${eventId}`,
    `type=${type}`,
    `ownerId=${donoUid}`,
    `sourceDevice=${sourceDeviceIdValidado || "(none)"}`,
    `createdBy=${chamadorUid}(${roleChamador})`,
  );

  return res.status(201).json({ ok: true, eventId, status: "created" });
}
