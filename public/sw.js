/* global importScripts, firebase */
// Jurex — Service Worker
//
// OBJETIVO: habilitar `registration.showNotification()` no Android
// (Chrome/Firefox) para a Notification Web API, e servir de target
// para mensagens FCM em background (aba fechada / em segundo plano).
//
// CAMINHOS DE EXIBICAO (`mostrarNotificacaoNativa` em
// `src/utils/notifications.js`):
//   - DESKTOP / aba em foreground: `new Notification(...)`.
//   - ANDROID/CHROME: `registration.showNotification(...)` (via este SW).
//   - FCM em background: `messaging.onBackgroundMessage(...)` chama
//     `registration.showNotification(...)` a partir deste SW.
//
// ESTE SW:
//   1. Faz o `notificationclick` abrir / focar a aba do app.
//   2. Inicializa o Firebase Messaging compat SDK e registra o
//      `onBackgroundMessage` para receber push com a aba fechada.
//   3. NAO faz cache de assets (nao e objetivo deste escopo).
//
// VERSIONAMENTO: bumpar SW_VERSION ao alterar este arquivo. O `main.jsx`
// registra o SW com `?v=...` para garantir que o navegador baixe a nova
// versao e descarte a antiga.

// eslint-disable-next-line no-unused-vars
const SW_VERSION = "jurex-sw-v3";
const APP_URL = "/dashboard";

// Firebase Messaging compat SDK (versao 12.18.0 - mesma do `firebase`
// em package.json). O SW nao tem acesso a `import.meta.env`, entao
// usamos o CDN do gstatic via `importScripts`. O init do app usa a
// MESMA config de `src/services/firebase.js` (manter em sync se
// algum campo for rotacionado).
importScripts(
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyC6StDHxZn5VakxH1MDqiYDKAGx6f1QLJg",
  authDomain: "agt-controller3.firebaseapp.com",
  projectId: "agt-controller3",
  storageBucket: "agt-controller3.firebasestorage.app",
  messagingSenderId: "1015891452736",
  appId: "1:1015891452736:web:42c93a93415ecda4cf90a5",
  measurementId: "G-5NSDLRRKZ9",
});

const messaging = firebase.messaging();

// Tipos de evento cujo destino é /emprestimos/:contratoId.
// Mantido em sincronia com EVENT_TYPES_VALIDOS no backend.
const TIPOS_CONTRATO = new Set([
  "CONTRACT_CREATED",
  "CONTRACT_UPDATED",
  "PAYMENT_REGISTERED",
  "INSTALLMENT_PAID",
  "INSTALLMENT_DUE_TODAY",
  "INSTALLMENT_OVERDUE",
]);
// Tipos cujo destino é /clientes/:clienteId.
const TIPOS_CLIENTE = new Set([
  "CLIENT_CREATED",
  "CLIENT_UPDATED",
  "CLIENT_DELETED",
]);
// Tipos cujo destino é /dashboard (sem ID navegável).
// CONTRACT_DELETED entra aqui porque o contrato já foi excluído —
// navegar para /emprestimos/:id mostraria 404.
const TIPOS_DASHBOARD_SEM_ID = new Set([
  "CONTRACT_DELETED",
  "EMPLOYEE_CREATED",
  "EMPLOYEE_UPDATED",
  "EMPLOYEE_DELETED",
]);

// Extrai a URL de destino a partir de `event.notification.data`.
// data é o que o FCM entrega ao SW: { eventId, type, payload: "<JSON string>" }.
// `APP_URL` é o fallback se a URL não puder ser construída.
function urlDeDestino(data) {
  // Falha silenciosa → fallback. O click nunca deve quebrar.
  try {
    if (!data || typeof data !== "object") return APP_URL;
    const type = typeof data.type === "string" ? data.type : "";
    let payload = {};
    const raw = data.payload;
    if (typeof raw === "string" && raw.length > 0) {
      try { payload = JSON.parse(raw); } catch { payload = {}; }
    } else if (raw && typeof raw === "object") {
      payload = raw;
    }
    if (TIPOS_CONTRATO.has(type)) {
      const id = typeof payload.contratoId === "string" ? payload.contratoId.trim() : "";
      return id ? `/emprestimos/${id}` : APP_URL;
    }
    if (TIPOS_CLIENTE.has(type)) {
      const id = typeof payload.clienteId === "string" ? payload.clienteId.trim() : "";
      return id ? `/clientes/${id}` : APP_URL;
    }
    if (TIPOS_DASHBOARD_SEM_ID.has(type)) {
      return APP_URL;
    }
    return APP_URL;
  } catch {
    return APP_URL;
  }
}

messaging.onBackgroundMessage((payload) => {
  try {
    const notif = (payload && payload.notification) || {};
    const data = (payload && payload.data) || {};
    const title = typeof notif.title === "string" ? notif.title : "Atualizacao";
    const body = typeof notif.body === "string" ? notif.body : "";
    const eventId = typeof data.eventId === "string" ? data.eventId : "";
    const type = typeof data.type === "string" ? data.type : "evt";
    const tag = eventId
      ? "jurex:notif:" + type + ":" + eventId
      : "jurex:notif:" + type + ":" + Date.now();
    self.registration.showNotification(title, {
      body,
      icon: "/logo.png",
      badge: "/logo.png",
      tag,
      renotify: false,
      requireInteraction: false,
    });
  } catch (err) {
    console.warn("[sw] onBackgroundMessage falhou:", err && err.message);
  }
});

// Instalação: ativa imediatamente sem esperar fechamento de abas antigas.
// eslint-disable-next-line no-unused-vars
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Ativação: assume o controle de todas as abas abertas.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Click na notificação: foca uma aba existente do app OU abre uma nova.
// A URL de destino é derivada de `event.notification.data` via
// `urlDeDestino(...)`, com fallback para APP_URL (/dashboard) se o
// tipo for desconhecido ou se o data estiver corrompido. (P3 — RA7.)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = urlDeDestino(event.notification.data);
  event.waitUntil(
    (async () => {
      // Tenta achar uma aba já aberta do app.
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Foca a primeira aba da mesma origin e navega para `destino`.
      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin) {
            await client.focus();
            if ("navigate" in client) {
              try {
                await client.navigate(destino);
              } catch (_) { // eslint-disable-line no-unused-vars
                // ignore — algumas implementações não permitem navigate
              }
            }
            return;
          }
        } catch (_) { // eslint-disable-line no-unused-vars
          // ignore
        }
      }
      // Sem aba aberta: abre uma nova na URL de destino.
      if (self.clients.openWindow) {
        await self.clients.openWindow(destino);
      }
    })(),
  );
});
