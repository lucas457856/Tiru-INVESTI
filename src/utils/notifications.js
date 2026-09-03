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
// ou bloqueou.
//
// CAMINHOS DE EXIBIÇÃO (`mostrarNotificacaoNativa`):
//   - DESKTOP (Chrome/Edge/Firefox no PC, aba em foreground):
//     `new Notification(titulo, { body, icon, tag })` — funciona nativamente.
//
//   - ANDROID/CHROME (celular):
//     `new Notification(...)` falha silenciosamente quando a aba está em
//     background, porque a Notification Web API depende de `document`
//     visível. A solução canônica é usar `ServiceWorkerRegistration.show
//     Notification()`, que entrega a notificação ao sistema operacional
//     mesmo com o app em background.
//
//   A função abaixo tenta o caminho SW primeiro; se o SW não estiver
//   controlando a página ainda (primeira carga, aba em foreground),
//   cai para `new Notification`. NUNCA dispara os dois caminhos.

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
 * Mostra uma notificação NATIVA do navegador (Chrome/Edge/Firefox toast)
 * usando a Web Notifications API.
 *
 * REGRAS:
 * - Só dispara se `Notification.permission === "granted"`. Sem prompt aqui —
 *   a permissão é solicitada separadamente via `solicitarPermissaoNotificacoes`
 *   (em user gesture).
 * - Best-effort: NUNCA propaga erro. A função envolve toda a lógica em
 *   try/catch para que uma falha do browser (Chromium travado, service de
 *   notif offline, etc.) não quebre o fluxo que a chamou (ex.: pagamento).
 * - NÃO é chamada em listeners `onSnapshot` — só no call site do evento
 *   real (criação de contrato, pagamento confirmado, etc.). Isso garante
 *   1 documento Firestore ↔ 1 toast nativo, sem duplicação em re-emissões
 *   do snapshot.
 *
 * ESCOLHA DE CAMINHO (sem duplicação):
 *   - Se existir um Service Worker ativo controlando a página
 *     (`navigator.serviceWorker.controller`), usa `registration.showNotification`.
 *     Este é o caminho CORRETO no Android/Chrome (e também funciona no
 *     desktop). A notificação é entregue ao sistema operacional,
 *     aparecendo na central mesmo com a aba em background.
 *   - Caso contrário, usa `new Notification(...)` legado (caminho desktop
 *     clássico, suficiente quando a aba está em primeiro plano).
 *   - NUNCA dispara os dois caminhos.
 *
 * DEDUPLICAÇÃO:
 * - O parâmetro `opts.tag` é usado pelo Chrome para SUBSTITUIR um toast
 *   anterior em vez de empilhar. Convenção usada no projeto:
 *     `jurex:<tipo>:<contratoId>:<parcelaNumero>`
 *   Dois eventos idênticos na mesma janela do browser viram 1 toast.
 *   Se `tag` não for informada, uma é gerada a partir de `contratoId` /
 *   `parcelaNumero` / `tipo` / `Date.now()` (fallback).
 *
 * @param {string} titulo - Título da notificação (ex.: "Pagamento recebido").
 * @param {string} body - Corpo/descrição (ex.: "João · parcela 3 · R$ 250,00").
 * @param {{
 *   tag?: string,
 *   icon?: string,
 *   tipo?: string,
 *   contratoId?: string,
 *   parcelaNumero?: number,
 * }} [opts]
 * @returns {void}
 */
export function mostrarNotificacaoNativa(titulo, body, opts = {}) {
  try {
    if (!notifSuportada()) return;
    if (Notification.permission !== "granted") return;

    // Logo padrão do Jurex (public/logo.png) — mesmo asset usado no Sidebar.
    // Sobrescrevível via opts.icon se algum evento precisar de ícone próprio.
    const icon = opts.icon || "/logo.png";

    // Tag dedup: se o chamador informar, usa. Senão, monta uma baseada nos
    // campos disponíveis (contrato+parcela deduplica no nível do browser).
    const tag =
      opts.tag ||
      (opts.contratoId
        ? `jurex:${opts.tipo || "evt"}:${opts.contratoId}:${opts.parcelaNumero ?? "-"}`
        : `jurex:${opts.tipo || "evt"}:${Date.now()}`);

    // Escolha do caminho. Sem await — fire-and-forget.
    //
    // Preferência: SW se estiver controlando a página. Caso contrário,
    // cai no caminho legado. O `registration.showNotification` é PROMISE-
    // based; tratamos o resultado para que uma falha silenciosa não
    // duplique nem derrube o fluxo.
    const temSW = !!(
      typeof navigator !== "undefined" &&
      navigator.serviceWorker &&
      navigator.serviceWorker.controller
    );

    if (temSW && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready
        .then((reg) => {
          if (!reg || !reg.showNotification) {
            // SW registrado mas API indisponível — fallback.
            new Notification(titulo, { body, icon, tag });
            return;
          }
          return reg.showNotification(titulo, {
            body,
            icon,
            tag,
            // badge: usa o mesmo logo (Android mostra em alguns launchers).
            badge: icon,
            // sem renotify: a tag dedup já cobre; renotify=true vibraria/soaria
            // a cada pagamento, o que é pior para o usuário.
            renotify: false,
            // requireInteraction false: a notificação some sozinha após ~5s
            // no Android (UX padrão de confirmação de pagamento).
            requireInteraction: false,
          });
        })
        .catch(() => {
          // Se o `showNotification` falhar (permissão revogada, SW caiu),
          // tenta o caminho legado como último recurso.
          try {
            new Notification(titulo, { body, icon, tag });
          } catch (innerErr) {
            // ignore — best-effort
            console.warn("mostrarNotificacaoNativa fallback falhou:", innerErr);
          }
        });
      return;
    }

    // Caminho legado (desktop clássico, ou Android na primeira carga
    // antes do SW assumir controle).
    new Notification(titulo, { body, icon, tag });
  } catch (err) {
    // Best-effort: log e segue. Não propaga para o chamador.
    console.warn("mostrarNotificacaoNativa falhou (ignorado):", err);
  }
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
