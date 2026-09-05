// Sub-handler: POST /api/notifications/register-device
//
// Disparado por api/notifications/[...slug].js quando slug === "register-device".
//
// Grava/atualiza o dispositivo do usuário em
// `usuarios/{uid}/devices/{deviceId}`.
//
// POR QUE ISSO É SERVER-SIDE:
//   - A Firestore Rules permite que cada uid leia/escreva apenas
//     o PRÓPRIO device (escopo `request.auth.uid == uid`). O front
//     poderia fazer isso direto via `setDoc(..., { merge: true })`.
//     Mesmo assim, centralizamos aqui para:
//       1. Validar campos (tipo de device, formato de token, etc.).
//       2. Padronizar o shape gravado (defaults de plataforma, etc.).
//       3. Permitir futura auditoria/limpeza (ex: tokens expirados).
//   - O `deviceId` é gerado pelo cliente (UUID v4 no localStorage).
//   - O `fcmToken` vem do `getToken()` do Firebase Messaging.
//
// Body esperado:
//   {
//     deviceId: string (UUID v4; obrigatório),
//     type: "desktop" | "mobile" | "tablet" | "other" (obrigatório),
//     platform: string (ex: "Chrome 124", "iPhone Safari"; opcional),
//     fcmToken: string (opcional — pode ser null no logout),
//     notificationsEnabled: boolean (obrigatório)
//   }
//
// Resposta (200 OK):
//   { ok: true, deviceId: "..." }

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { bad, extrairBearer, getAdminSdk, verificarToken } from "../../_lib/http.js";
import { getAuth } from "../../_lib/dono.js";

const PREFIX = "notifications/register-device";
const DEVICE_TYPES_VALIDOS = new Set(["desktop", "mobile", "tablet", "other"]);

export async function registerDeviceHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // 1) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim().toLowerCase() : "";
  const platform = typeof body.platform === "string" ? body.platform.trim().slice(0, 200) : "";
  const fcmToken = typeof body.fcmToken === "string" ? body.fcmToken.trim() : null;
  const notificationsEnabled = body.notificationsEnabled === true;

  // 2) Validação
  if (!deviceId || deviceId.length > 200) {
    return bad(res, PREFIX, 400, "deviceId é obrigatório (string até 200 chars).");
  }
  if (!DEVICE_TYPES_VALIDOS.has(type)) {
    return bad(res, PREFIX, 400, `type deve ser um de: ${Array.from(DEVICE_TYPES_VALIDOS).join(", ")}.`);
  }
  // fcmToken pode ser null (logout intencional) ou string (até ~200 chars
  // para tokens web-push; tokens nativos costumam ser maiores, então
  // permitimos até 4096).
  if (fcmToken !== null && fcmToken !== undefined && (typeof fcmToken !== "string" || fcmToken.length > 4096)) {
    return bad(res, PREFIX, 400, "fcmToken inválido (string até 4096 chars ou null).");
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

  // 6) Resolve o DONO efetivo + papel do chamador.
  //    Para DEVICES, o `uid` do path é o PRÓPRIO chamador (cada device
  //    é do próprio usuário, não do owner). Isso garante que o deviceId
  //    do user A NUNCA seja gravado sob o uid do user B (proteção
  //    contra cross-contamination em logout/login no mesmo browser).
  //    Os campos `userRole`/`ownerUid` no doc permitem ao dispatch
  //    saber se é um device de DONO ou de FUNCIONÁRIO e rotear
  //    corretamente.
  let userRole = "owner";
  let ownerUid = chamadorUid;
  try {
    const snap = await dbAdmin.collection("usuarios").doc(chamadorUid).get();
    if (!snap.exists) {
      return bad(res, PREFIX, 403, "Perfil do chamador não encontrado.");
    }
    const data = snap.data() || {};
    if (data.role === "funcionario" && data.ownerUid) {
      userRole = "funcionario";
      ownerUid = data.ownerUid;
    } else if (data.ownerUid) {
      return bad(res, PREFIX, 403, "Perfil inválido.");
    }
  } catch (err) {
    console.error(`[${PREFIX}] leitura do perfil falhou:`, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível validar o chamador.");
  }

  // 7) Upsert do device. setDoc com merge preserva campos que não
  //    vieram (ex: createdAt na primeira escrita).
  const deviceRef = dbAdmin
    .collection("usuarios")
    .doc(chamadorUid)
    .collection("devices")
    .doc(deviceId);
  const deviceDoc = {
    deviceId,
    type,
    platform,
    fcmToken: fcmToken || null,
    notificationsEnabled,
    userRole,
    ownerUid,
    lastSeenAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  // createdAt só na primeira escrita — usa `serverTimestamp` no `set`
  // apenas se o doc não existir.
  try {
    const existing = await deviceRef.get();
    if (!existing.exists) {
      deviceDoc.createdAt = FieldValue.serverTimestamp();
    }
    await deviceRef.set(deviceDoc, { merge: true });
  } catch (err) {
    console.error(`[${PREFIX}] set device falhou:`, err?.code, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível registrar o dispositivo.");
  }

  console.log(
    `[${PREFIX}] device upsert:`,
    `uid=${chamadorUid}`,
    `deviceId=${deviceId}`,
    `type=${type}`,
    `fcmToken=${fcmToken ? "set" : "null"}`,
    `enabled=${notificationsEnabled}`,
    `role=${userRole}`,
  );

  return res.status(200).json({ ok: true, deviceId });
}
