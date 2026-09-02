// Wrapper centralizado em torno da Notification API do navegador.
//
// REGRA CRÍTICA: Notification.requestPermission() DEVE ser chamado
// de forma SÍNCRONA dentro de um user gesture handler (click, keypress).
// Se houver qualquer await antes da chamada, o Chrome quebra a "transient
// activation" e exibe um aviso no DevTools / overlay em vez do popup nativo
// ("www.jurexbrasil.com quer — Mostrar notificações — Permitir / Bloquear").
//
// Por isso esta função:
//   1. Faz as checagens de guarda SÍNCRONAS (sem await).
//   2. Chama Notification.requestPermission() DIRETAMENTE (sem await antes).
//   3. Retorna a Promise para o chamador resolver com .then().
//
// Garante que o popup nativo do Chrome aparece
// ("www.jurexbrasil.com quer — Mostrar notificações — Permitir / Bloquear")
// e evita re-solicitações desnecessárias quando o usuário já concedeu
// ou bloqueou. Sem Firestore, sem service worker, sem FCM — só a
// Notification Web API local do browser.

/**
 * Detecta se a Notification API está disponível no ambiente atual.
 * `false` em SSR, iframes sandbox sem permissão, browsers antigos, etc.
 *
 * @returns {boolean}
 */
export function notifSuportada() {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Solicita permissão de notificações nativas do navegador.
 *
 * - Se a API não existe, retorna Promise<"unsupported"> sem prompt.
 * - Se já é "granted", retorna Promise<"granted"> sem prompt.
 * - Se já é "denied", retorna Promise<"denied"> sem prompt. O chamador
 *   é responsável por mostrar uma confirmação própria antes de orientar
 *   o usuário a liberar a permissão nas configurações do navegador
 *   (o Chrome não exibe o popup nativo novamente nesse estado).
 * - Caso contrário (default), chama Notification.requestPermission()
 *   DIRETAMENTE (sem await antes, preservando o user gesture) e retorna
 *   a Promise que resolve com a decisão do usuário.
 *
 * IMPORTANTE: o chamador deve invocar esta função DIRETAMENTE no onClick
 * (ex.: `onClick={() => solicitarPermissaoNotificacoes().then(...)}`).
 * NÃO chamar via uma função async intermediária com await, pois isso
 * quebraria o user gesture e o Chrome mostraria o aviso interno em vez
 * do popup nativo.
 *
 * @returns {Promise<NotificationPermission | "unsupported">}
 */
export function solicitarPermissaoNotificacoes() {
  if (!notifSuportada()) return Promise.resolve("unsupported");
  if (Notification.permission === "granted") return Promise.resolve("granted");
  if (Notification.permission === "denied") return Promise.resolve("denied");
  // CHAMADA SÍNCRONA no user gesture — sem await antes.
  return Promise.resolve(Notification.requestPermission());
}

/**
 * Retorna a URL da página de configurações de notificações do navegador
 * atual, ou null se o navegador não expõe uma URL pública. Usado para
 * orientar o usuário a liberar notificações bloqueadas para o site.
 *
 * @returns {string | null}
 */
export function urlConfiguracoesNotificacoes() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/Edg\//.test(ua)) return "edge://settings/content/notifications";
  if (/Chrome\//.test(ua) && !/OPR\//.test(ua))
    return "chrome://settings/content/notifications";
  if (/Firefox\//.test(ua)) return "about:preferences#privacy";
  return null;
}
