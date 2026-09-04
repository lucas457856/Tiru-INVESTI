// Wrapper central para os 3 endpoints de notificacao da Fase A.
// Endpoints backend (Vercel serverless, em api/notifications/):
//   - POST /api/notifications/register-event
//   - POST /api/notifications/register-device
//   - POST /api/notifications/dispatch
// Erros de rede/HTTP retornam { ok: false, erro } sem lancar excecao.

import { auth } from "./firebase";

// Le VITE_API_BASE de forma defensiva. Sem import.meta, retorna "".
function lerEnvBase() {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env) {
      const v = import.meta.env.VITE_API_BASE;
      if (typeof v === "string") return v;
    }
  } catch {
    // ignore - cai no caminho relativo
  }
  return "";
}

// Base normalizada: sem barra final, vazia = caminho relativo.
const API_BASE = lerEnvBase().replace(/\/+$/, "");

// Monta a URL final do endpoint.
function endpoint(path) {
  return API_BASE + "/api/notifications/" + path;
}

// Le o idToken do Firebase Auth (cache local do SDK). Null se deslogado.
async function obterIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(false);
  } catch (err) {
    const code = err && err.code;
    const msg = err && err.message;
    console.warn("[notif-events] getIdToken falhou:", code, msg);
    return null;
  }
}

// Fetch autenticado generico. NUNCA lanca - devolve {ok:false, erro}.
async function postAutenticado(path, body) {
  const idToken = await obterIdToken();
  if (!idToken) {
    return { ok: false, erro: "Usuario nao autenticado." };
  }
  let res;
  try {
    res = await fetch(endpoint(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken,
      },
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    const msg = err && err.message;
    console.warn("[notif-events] POST " + path + " falhou (rede):", msg);
    return { ok: false, erro: "Falha de rede: " + (msg || "desconhecida") };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return {
      ok: res.ok,
      erro: res.ok ? null : "HTTP " + res.status,
      status: res.status,
    };
  }
  if (!res.ok) {
    const erroMsg = data && data.erro ? data.erro : "HTTP " + res.status;
    return { ok: false, erro: erroMsg, status: res.status };
  }
  const envelope = { ok: true };
  if (data && typeof data === "object") {
    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      envelope[k] = data[k];
    }
  }
  return envelope;
}

// Cria (ou valida idempotencia de) um evento central em
// usuarios/{ownerId}/notificationEvents/{eventId}.
// Backend: api/notifications/register-event.js.
export async function criarNotificationEvent(payload) {
  if (!payload || !payload.eventId) {
    return { ok: false, erro: "eventId e obrigatorio." };
  }
  return postAutenticado("register-event", payload);
}

// Registra (ou atualiza) o device do chamador em
// usuarios/{uid}/devices/{deviceId}. Backend grava no path do chamador.
// Em logout, passar fcmToken: null e notificationsEnabled: false.
// Backend: api/notifications/register-device.js.
export async function registrarMeuDevice(payload) {
  if (!payload || !payload.deviceId) {
    return { ok: false, erro: "deviceId e obrigatorio." };
  }
  return postAutenticado("register-device", payload);
}

// Dispara (envia via FCM) um evento central previamente gravado.
// Recipients sao derivados server-side.
// Backend: api/notifications/dispatch.js.
export async function dispatchNotificationEvent(payload) {
  if (!payload || !payload.eventId) {
    return { ok: false, erro: "eventId e obrigatorio." };
  }
  return postAutenticado("dispatch", payload);
}

// Chave do localStorage usada por useDeviceRegistration para persistir
// o deviceId gerado uma unica vez por browser. Mantida em sincronia com
// `src/hooks/useDeviceRegistration.js` (STORAGE_KEY).
const DEVICE_ID_STORAGE_KEY = "jurex:device:id";

// Le o deviceId persistido no localStorage pelo useDeviceRegistration.
// Retorna null se indisponivel (SSR / modo privado / chave ausente).
//
// Usado pelos call sites client-side da Fase C (contractService,
// useNotificadorVencimentos) para enviar `sourceDeviceId` ao backend,
// que valida que o deviceId pertence ao uid autenticado.
// NAO gera um novo deviceId se ausente — quem registra e o proprio
// useDeviceRegistration, no login do usuario.
export function obterDeviceIdLocal() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const v = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (typeof v === "string" && v.length > 0 && v.length <= 200) return v;
  } catch {
    // localStorage indisponivel (modo privado do Safari, etc.)
  }
  return null;
}
