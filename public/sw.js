// Cred Facil — Service Worker
//
// OBJETIVO ÚNICO: habilitar `registration.showNotification()` no Android
// (Chrome/Firefox). Sem este SW, a Notification Web API funciona SÓ
// enquanto a aba está em primeiro plano; ao trocar de app, bloquear a
// tela ou fechar o navegador, a notificação some.
//
// O `new Notification(...)` (caminho desktop) continua funcionando como
// antes. O `mostrarNotificacaoNativa` (em `src/utils/notifications.js`)
// escolhe o caminho adequado: se existir `navigator.serviceWorker.controller`,
// usa `registration.showNotification()`; caso contrário, usa o `new
// Notification(...)` legado.
//
// Este SW:
//   1. NÃO escuta `push` (não usamos FCM/VAPID neste projeto).
//   2. NÃO faz cache de assets (não é objetivo deste escopo).
//   3. Faz APENAS o `notificationclick` abrir / focar a aba do app.
//
// VERSIONAMENTO: bumpar SW_VERSION ao alterar este arquivo. O `main.jsx`
// registra o SW com `?v=...` para garantir que o navegador baixe a nova
// versão e descarte a antiga (resolve o problema clássico de "service
// worker antigo continua executando código anterior").

const SW_VERSION = "Cred Facil-sw-v1";
const APP_URL = "/dashboard";

// Instalação: ativa imediatamente sem esperar fechamento de abas antigas.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Ativação: assume o controle de todas as abas abertas.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Click na notificação: foca uma aba existente do app OU abre uma nova.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      // Tenta achar uma aba já aberta do app.
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Foca a primeira aba /dashboard (ou /) encontrada.
      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin) {
            await client.focus();
            if ("navigate" in client) {
              try {
                await client.navigate(APP_URL);
              } catch (_) {
                // ignore — algumas implementações não permitem navigate
              }
            }
            return;
          }
        } catch (_) {
          // ignore
        }
      }
      // Sem aba aberta: abre uma nova.
      if (self.clients.openWindow) {
        await self.clients.openWindow(APP_URL);
      }
    })(),
  );
});
