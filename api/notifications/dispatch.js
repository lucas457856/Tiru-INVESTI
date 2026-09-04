// API: POST /api/notifications/dispatch
//
// Distribui um evento centralizado para os dispositivos do ownerId
// que devem recebê-lo, via Firebase Cloud Messaging (FCM).
//
// FLUXO:
//   1. Recebe `eventId` no body.
//   2. Lê o evento em `usuarios/{ownerId}/notificationEvents/{eventId}`.
//   3. Lê os devices do ownerId (todos os users — dono e funcionários
//      vinculados, porque o doc do evento mora no path do DONO).
//   4. Para cada device, decide se recebe ou não (regras abaixo).
//   5. Envia FCM (`admin.messaging().send`) para os devices elegíveis.
//   6. Atualiza o evento com `status` e `dispatchedAt`.
//   7. Retorna 200 com o resumo (delivered, skipped, failed).
//
// REGRAS DE DISTRIBUIÇÃO:
//   - O dispositivo que ORIGINOU o evento (event.sourceDeviceId) NÃO
//     recebe FCM — ele já vê a notificação via in-app (sino) +
//     `mostrarNotificacaoNativa` local. Evita 3 notificações (in-app +
//     push + nativa) na mesma máquina.
//   - Devices de DONO: recebem todos os eventos do ownerId.
//   - Devices de FUNCIONÁRIO: recebem SOMENTE se o evento tiver
//     `data.createdBy` ou se o `evento.createdBy.uid` for do próprio
//     funcionário. Para simplificar a Fase A, funcionários recebem
//     TODOS os eventos disparados pelo PRÓPRIO dono da conta (igual
//     à regra de leitura de /usuarios/{ownerUid}/contratos). A regra
//     fina (filtrar por createdBy) é aplicada em uma Fase futura.
//
// SEGURANÇA:
//   - Token verificado (verifyIdToken). Apenas o DONO efetivo do
//     ownerId do evento (ou um funcionário vinculado) pode disparar.
//   - Tokens FCM com erro de `messaging/registration-token-not-registered`
//     ou `messaging/invalid-argument` são MARCADOS COMO NULOS no doc do
//     device (limpeza automática).
//   - Falhas de envio NÃO retornam 5xx — o evento já está gravado
//     e o cliente pode re-despachar. Status `partial_failure` permite
//     diagnóstico.
//
// Body esperado:
//   { eventId: string (obrigatório) }
//
// Resposta (200 OK):
//   {
//     ok: true,
//     eventId: "...",
//     delivered: number,
//     skipped: number,
//     failed: number,
//     status: "delivered" | "partial_failure" | "no_targets"
//   }

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdmin, getFirebaseMessaging } from "../_lib/firebaseAdmin.js";

function bad(res, status, erro) {
  console.error(`[notifications/dispatch] ${status} ${erro}`);
  return res.status(status).json({ ok: false, erro });
}

function extrairBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

// Erros FCM que justificam marcar o token como inválido no doc do device.
// Lista alinhada com a doc do Firebase Admin SDK:
// https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging
const CODIGOS_TOKEN_INVALIDO = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido.");
  }

  // 1) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!eventId || eventId.length > 200) {
    return bad(res, 400, "eventId é obrigatório.");
  }

  // 2) Token
  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, 401, "Autenticação obrigatória.");
  }

  // 3) Admin
  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch (err) {
    console.error("[notifications/dispatch] Firebase Admin indisponível:", err?.code, err?.message);
    return bad(res, 500, "Serviço de autenticação indisponível. Tente novamente mais tarde.");
  }
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 4) Identidade do chamador
  let chamadorUid;
  try {
    const decoded = await authAdmin.verifyIdToken(idToken, true);
    chamadorUid = decoded.uid;
  } catch (err) {
    console.error("[notifications/dispatch] verifyIdToken falhou:", err?.code, err?.message);
    return bad(res, 401, "Sessão inválida. Faça login novamente.");
  }

  // 5) Lê o evento. Se não existir, 404 (cliente gerou eventId errado
  //    ou o register-event não foi chamado antes).
  //    Para descobrir o ownerId do evento, precisamos ler ANTES de
  //    validar permissão. Lemos o evento, depois validamos.
  //    Como o evento é um doc único, e o cliente já passou pelo
  //    register-event (que validou o ownerId do chamador), aqui só
  //    precisamos garantir que o chamador PODE acessar o ownerId do
  //    evento.
  //    Otimização: o cliente pode enviar `ownerId` no body. Validamos
  //    se o chamador tem acesso a ele.
  const bodyOwnerId = typeof body.ownerId === "string" ? body.ownerId.trim() : null;

  let donoUid;
  if (bodyOwnerId) {
    // Se o cliente enviou ownerId, validamos contra o chamador.
    let perfilChamador;
    try {
      const snap = await dbAdmin.collection("usuarios").doc(chamadorUid).get();
      if (!snap.exists) {
        return bad(res, 403, "Perfil do chamador não encontrado.");
      }
      perfilChamador = snap.data() || {};
      if (perfilChamador.role === "funcionario" && perfilChamador.ownerUid === bodyOwnerId) {
        donoUid = bodyOwnerId;
      } else if (perfilChamador.role === "funcionario") {
        return bad(res, 403, "Funcionário sem acesso a este ownerId.");
      } else if (!perfilChamador.role && !perfilChamador.ownerUid) {
        // DONO: ele mesmo pode despachar seus próprios eventos
        if (chamadorUid !== bodyOwnerId) {
          return bad(res, 403, "Dono só pode despachar seus próprios eventos.");
        }
        donoUid = bodyOwnerId;
      } else {
        return bad(res, 403, "Perfil inválido.");
      }
    } catch (err) {
      console.error("[notifications/dispatch] leitura do perfil falhou:", err?.message);
      return bad(res, 500, "Não foi possível validar o chamador.");
    }
  } else {
    // Sem ownerId no body: deriva do chamador.
    try {
      const snap = await dbAdmin.collection("usuarios").doc(chamadorUid).get();
      if (!snap.exists) {
        return bad(res, 403, "Perfil do chamador não encontrado.");
      }
      const data = snap.data() || {};
      if (data.role === "funcionario" && data.ownerUid) {
        donoUid = data.ownerUid;
      } else if (data.ownerUid) {
        return bad(res, 403, "Perfil inválido.");
      } else {
        donoUid = chamadorUid;
      }
    } catch (err) {
      console.error("[notifications/dispatch] leitura do perfil falhou:", err?.message);
      return bad(res, 500, "Não foi possível validar o chamador.");
    }
  }

  // 6) Lê o evento.
  const eventoRef = dbAdmin
    .collection("usuarios")
    .doc(donoUid)
    .collection("notificationEvents")
    .doc(eventId);
  let eventoSnap;
  try {
    eventoSnap = await eventoRef.get();
  } catch (err) {
    console.error("[notifications/dispatch] leitura do evento falhou:", err?.message);
    return bad(res, 500, "Não foi possível ler o evento.");
  }
  if (!eventoSnap.exists) {
    return bad(res, 404, "Evento não encontrado.");
  }
  const evento = eventoSnap.data() || {};

  // Idempotência: se já foi dispatched, não re-despacha (a menos que
  // explicitamente forçado). Para simplificar a Fase A, permitimos
  // re-dispatch (retornamos o status atual). O cliente que precisar
  // pode checar `evento.status` antes de chamar.
  // O frontend também usa dedup por eventId no localStorage, então
  // re-dispatches acidentais não causam notificações duplicadas.

  // 7) Lista os devices de TODOS os usuários sob o ownerUid (dono +
  //    funcionários). Cada device tem `userRole` + `ownerUid` no doc
  //    para sabermos a qual usuário pertence.
  let devicesSnap;
  try {
    // Estratégia: listar devices do dono + devices de cada funcionário
    // vinculado. Para Fase A (volume pequeno), aceitamos 1 query por
    // funcionário. Em Fase futura, podemos indexar devices por ownerUid
    // numa coleção top-level se necessário.
    const allDevices = [];

    // Devices do próprio DONO
    const donoDevices = await dbAdmin
      .collection("usuarios")
      .doc(donoUid)
      .collection("devices")
      .get();
    donoDevices.forEach((d) => allDevices.push({ uid: donoUid, id: d.id, data: d.data() }));

    // Devices de cada funcionário vinculado
    const funcSnap = await dbAdmin
      .collection("usuarios")
      .doc(donoUid)
      .collection("funcionarios")
      .get();
    for (const fDoc of funcSnap.docs) {
      const funcData = fDoc.data() || {};
      if (!funcData.authUid) continue;
      try {
        const funcDevices = await dbAdmin
          .collection("usuarios")
          .doc(funcData.authUid)
          .collection("devices")
          .get();
        funcDevices.forEach((d) =>
          allDevices.push({ uid: funcData.authUid, id: d.id, data: d.data() }),
        );
      } catch (err) {
        console.warn(
          `[notifications/dispatch] falha ao listar devices do funcionário ${funcData.authUid}:`,
          err?.message,
        );
        // Continua com os outros funcionários.
      }
    }

    devicesSnap = { docs: allDevices.map((d) => ({ id: d.id, _uid: d.uid, _data: d.data })) };
  } catch (err) {
    console.error("[notifications/dispatch] listagem de devices falhou:", err?.message);
    return bad(res, 500, "Não foi possível listar os devices.");
  }

  // 8) Filtra devices elegíveis:
  //    - Tem fcmToken (não null/vazio)
  //    - notificationsEnabled === true
  //    - sourceDeviceId !== event.sourceDeviceId (originador não recebe push)
  //    - Se for device de FUNCIONÁRIO, o evento deve ter sido criado
  //      por esse funcionário OU o filtro passa (Fase A: passa sempre
  //      para dispositivos de dono; funcionários só recebem eventos
  //      do ownerId onde trabalham).
  const targets = [];
  const skipped = [];
  for (const d of devicesSnap.docs) {
    const data = d._data || {};
    const token = data.fcmToken;
    if (!token || typeof token !== "string") {
      skipped.push({ deviceId: d.id, reason: "no_token" });
      continue;
    }
    if (data.notificationsEnabled !== true) {
      skipped.push({ deviceId: d.id, reason: "disabled" });
      continue;
    }
    if (evento.sourceDeviceId && d.id === evento.sourceDeviceId) {
      skipped.push({ deviceId: d.id, reason: "originator" });
      continue;
    }
    targets.push({ uid: d._uid, deviceId: d.id, token });
  }

  // Agregadores por motivo de skip para diagnostico nos logs. Nao
  // alteram o comportamento - apenas facilitam entender por que um
  // push NAO foi entregue (no_token vs disabled vs originator).
  const skippedByReason = { no_token: 0, disabled: 0, originator: 0 };
  for (let i = 0; i < skipped.length; i++) {
    const r = skipped[i] && skipped[i].reason;
    if (r && Object.prototype.hasOwnProperty.call(skippedByReason, r)) {
      skippedByReason[r] += 1;
    }
  }

  if (targets.length === 0) {
    // Nada a enviar. Marca como dispatched mesmo assim.
    // Log estruturado para diagnostico: mostra quantos devices foram
    // encontrados no total e quantos foram pulados por cada reason.
    // Sem expor tokens. Ajuda a distinguir "nenhum device tem
    // fcmToken" de "todos foram pulados por originator" de
    // "notificationsEnabled=false em todos".
    console.warn(
      "[FCM DISPATCH]",
      `eventId=${eventId}`,
      `ownerId=${donoUid}`,
      `type=${evento.type || "(?)"}`,
      `devicesFound=${devicesSnap.docs.length}`,
      `skippedNoToken=${skippedByReason.no_token}`,
      `skippedDisabled=${skippedByReason.disabled}`,
      `skippedOriginator=${skippedByReason.originator}`,
      `delivered=0`,
      `failed=0`,
      `status=no_targets`,
    );
    try {
      await eventoRef.update({
        status: "no_targets",
        dispatchedAt: FieldValue.serverTimestamp(),
        deliverySummary: {
          delivered: 0,
          skipped: skipped.length,
          failed: 0,
          skippedDetails: skipped,
        },
      });
    } catch (err) {
      console.warn("[notifications/dispatch] update evento (no_targets) falhou:", err?.message);
    }
    return res.status(200).json({
      ok: true,
      eventId,
      delivered: 0,
      skipped: skipped.length,
      failed: 0,
      status: "no_targets",
    });
  }

  // 9) Envia FCM para cada target. Erros não derrubam o batch — apenas
  //    marcam o device e o contador.
  let messaging;
  try {
    messaging = getFirebaseMessaging();
  } catch (err) {
    console.error("[notifications/dispatch] FCM indisponível:", err?.code, err?.message);
    return bad(
      res,
      500,
      "Serviço de push indisponível. Verifique se a Cloud Messaging API (V1) está habilitada.",
    );
  }

  let delivered = 0;
  let failed = 0;
  const failures = [];
  const tokenRemovidos = [];

  // Envia em paralelo. Cada send é independente; um erro não cancela os outros.
  await Promise.all(
    targets.map(async (t) => {
      const message = {
        token: t.token,
        notification: {
          title: evento.title || "Atualização",
          body: evento.body || "",
        },
        data: {
          // Todos os campos `data` precisam ser string (constraint do FCM).
          eventId: String(evento.eventId || eventId),
          type: String(evento.type || ""),
          // Serializa o objeto data como JSON string para que o SW
          // possa fazer `JSON.parse` e ler contratoId/clienteId/etc.
          payload: JSON.stringify(evento.data || {}),
        },
        webpush: {
          headers: {
            // Urgência: alta para pagamentos/vencidos; normal para o resto.
            Urgency: evento.type === "INSTALLMENT_OVERDUE" || evento.type === "PAYMENT_REGISTERED" ? "high" : "normal",
          },
        },
      };
      try {
        await messaging.send(message);
        delivered += 1;
      } catch (err) {
        failed += 1;
        const code = err?.code || err?.errorInfo?.code || "unknown";
        failures.push({ deviceId: t.deviceId, code });
        if (CODIGOS_TOKEN_INVALIDO.has(code)) {
          tokenRemovidos.push({ uid: t.uid, deviceId: t.deviceId, code });
        }
      }
    }),
  );

  // 10) Cleanup: marca como nulos os tokens que o FCM reportou inválidos.
  for (const tr of tokenRemovidos) {
    try {
      await dbAdmin
        .collection("usuarios")
        .doc(tr.uid)
        .collection("devices")
        .doc(tr.deviceId)
        .update({
          fcmToken: null,
          fcmTokenInvalidAt: FieldValue.serverTimestamp(),
        });
    } catch (err) {
      console.warn(
        `[notifications/dispatch] cleanup token falhou (uid=${tr.uid}, device=${tr.deviceId}):`,
        err?.message,
      );
    }
  }

  // 11) Atualiza o evento com o status final.
  const status =
    failed === 0 ? "delivered" : delivered === 0 ? "failed" : "partial_failure";
  try {
    await eventoRef.update({
      status,
      dispatchedAt: FieldValue.serverTimestamp(),
      deliverySummary: {
        delivered,
        skipped: skipped.length,
        failed,
        failures,
        tokenRemovidos: tokenRemovidos.map((t) => t.deviceId),
      },
    });
  } catch (err) {
    console.warn("[notifications/dispatch] update evento falhou:", err?.message);
  }

  console.log(
    "[FCM DISPATCH]",
    `eventId=${eventId}`,
    `ownerId=${donoUid}`,
    `type=${evento.type || "(?)"}`,
    `devicesFound=${devicesSnap.docs.length}`,
    `skippedNoToken=${skippedByReason.no_token}`,
    `skippedDisabled=${skippedByReason.disabled}`,
    `skippedOriginator=${skippedByReason.originator}`,
    `delivered=${delivered}`,
    `failed=${failed}`,
    `tokensRemovidos=${tokenRemovidos.length}`,
    `status=${status}`,
  );

  return res.status(200).json({
    ok: true,
    eventId,
    delivered,
    skipped: skipped.length,
    failed,
    status,
  });
}
