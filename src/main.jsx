import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import "./services/migrationPreviewService"; // Expõe window.previewMigrationDryRun (DRY RUN only)

// Registro do Service Worker (PWA mínimo).
//
// OBJETIVO: habilitar `registration.showNotification()` no Android/Chrome,
// que é a única forma de mostrar notificações nativas confiáveis quando a
// aba está em background. Sem este SW, o `new Notification(...)` só funciona
// com a aba em primeiro plano.
//
// REGRAS:
//   1. Só registra se a API existir (não-SSR / browsers modernos).
//   2. `?v=Cred Facil-sw-v1` força o navegador a invalidar caches antigos quando
//      o SW_VERSION é alterado em `public/sw.js` (resolve o problema de
//      "service worker antigo continua executando código anterior").
//   3. `updateViaCache: "none"` impede que o HTTP cache sirva um sw.js
//      desatualizado — sempre baixa do servidor.
//   4. Best-effort: falhas são logadas mas NÃO bloqueiam o boot do app.
//   5. Idempotente: o navegador é quem dedup o registro por URL.
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js?v=Cred Facil-sw-v1", { updateViaCache: "none" })
      .catch((err) => {
        // Não bloqueia o app se o registro falhar (HTTP, browser policy).
        console.warn("[sw] registro falhou (ignorado):", err);
      });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
