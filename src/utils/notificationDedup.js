// Camada de deduplicação para notificações.
//
// OBJETIVO: garantir que o MESMO evento gere no máximo UMA notificação
// (Firestore + nativa) POR DISPOSITIVO, mesmo quando:
//   - o React re-renderiza várias vezes no mesmo mount;
//   - o `onSnapshot` re-emite a cada reconexão / update;
//   - o usuário navega entre páginas e volta;
//   - o usuário dá F5 / recarrega a aba;
//   - o hook é remontado por HMR em dev;
//   - dois devices diferentes recebem o mesmo FCM e o SW processa duas vezes.
//
// ESTRATÉGIA — 3 camadas:
//
//   1. `notificacoesInSession` (Set em memória, singleton deste módulo):
//      cache O(1) compartilhado entre TODOS os hooks/componentes da aba.
//      Limpa em F5 (a própria JS heap é recriada).
//
//   2. `localStorage` (chave `jurex:notif:...`):
//      persiste entre F5, logout/login, fechamento/reabertura de aba.
//      Padrão `jurex-*` consistente com `ThemeProvider.jsx:1-32`.
//
//   3. `tag` do Chrome (passado em `mostrarNotificacaoNativa({ tag })`):
//      dedup no nível do browser — segundo toast com mesma tag substitui o
//      primeiro em vez de empilhar. Definido em `utils/notifications.js`.
//
// CHAVES SUPORTADAS:
//   A) Legado (por tipo+contrato+parcela+vencimento): usado pelo
//      `useNotificadorVencimentos` para parcela_vencendo / parcela_atrasada.
//      Mantido para não quebrar o trigger existente.
//   B) Por `eventId` (UUID v4 gerado pelo cliente que originou o evento):
//      usado por TODOS os novos triggers (CONTRACT_CREATED,
//      PAYMENT_REGISTERED, etc.). É a fonte de verdade da
//      deduplicação — `eventId` é único por evento, gerado uma vez
//      no call site (ex: api/admin/criar-contrato.js) e propagado
//      para in-app notif + push FCM.
//
// ESTABILIDADE: o `eventId` é imutável enquanto o evento existir no
// Firestore (`notificationEvents/{eventId}`). O backend rejeita criar
// 2 eventos com o mesmo `eventId` (idempotência server-side).
//
// SEM TTL: ambas as chaves são estáveis enquanto o evento não mudar
// de significado. O `localStorage` acomoda 12k chaves × ~80 bytes ≈ 1 MB,
// bem dentro do limite de 5-10 MB dos browsers.

const PREFIXO = "jurex:notif";
const PREFIXO_EVENTO = "jurex:notif:event";

/**
 * Constrói a chave estável que identifica um evento de notificação.
 *
 * @param {"parcela_vencendo" | "parcela_atrasada" | string} tipo
 * @param {string} contratoId
 * @param {number} parcelaNumero
 * @param {string} vencimentoISO - "YYYY-MM-DD" (formato canônico do projeto)
 * @returns {string}
 */
export function chaveNotificacao(tipo, contratoId, parcelaNumero, vencimentoISO) {
  return `${PREFIXO}:${tipo}:${contratoId}:${parcelaNumero}:${vencimentoISO}`;
}

/**
 * Cache em memória, compartilhado entre todos os hooks/componentes da aba.
 * Limpo em F5 (heap é recriada). Usado como primeira barreira (O(1)).
 */
export const notificacoesInSession = new Set();

/**
 * Lê o localStorage e devolve `true` se a chave já foi persistida.
 * Silencioso em SSR / localStorage indisponível.
 *
 * @param {string} chave
 * @returns {boolean}
 */
export function jaNotificou(chave) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    return window.localStorage.getItem(chave) !== null;
  } catch {
    // localStorage pode lançar em modo privado do Safari ou se o storage
    // estiver cheio. Em qualquer caso, falhamos "aberto" para não bloquear
    // a notificação — o dedup in-memory (Set) cobre o mesmo mount.
    return false;
  }
}

/**
 * Persiste a chave no localStorage e adiciona ao Set em memória.
 * Idempotente — chamar 2x com a mesma chave é seguro.
 *
 * @param {string} chave
 */
export function marcarNotificado(chave) {
  notificacoesInSession.add(chave);
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(chave, String(Date.now()));
  } catch {
    // Ignora falhas de quota / modo privado. O Set em memória já cobre
    // o ciclo de vida da aba; o localStorage é só uma otimização cross-F5.
  }
}

/**
 * Helper de conveniência: checa dedup (Set OU localStorage) e marca se novo.
 * Retorna `true` se o evento JÁ tinha sido notificado (não disparar),
 * `false` se for novo (pode disparar).
 *
 * @param {string} chave
 * @returns {boolean} true se já notificado, false se é novo
 */
export function eventoJaNotificado(chave) {
  if (notificacoesInSession.has(chave)) return true;
  if (jaNotificou(chave)) {
    // Re-hidrata o Set em memória para evitar uma segunda leitura
    // do localStorage no mesmo mount.
    notificacoesInSession.add(chave);
    return true;
  }
  return false;
}

/**
 * Constrói a chave estável por `eventId` (UUID v4).
 * Esta é a fonte de verdade para deduplicação de notificações
 * centralizadas (Fase B) — `eventId` é único por evento no servidor
 * (ver `api/notifications/register-event.js`, idempotente).
 *
 * Convenção: `jurex:notif:event:<eventId>`
 *
 * @param {string} eventId
 * @returns {string}
 */
export function chavePorEventId(eventId) {
  return `${PREFIXO_EVENTO}:${eventId}`;
}

/**
 * Versão por-`eventId` do `eventoJaNotificado`.
 * Reutiliza o Set em memória e o mesmo padrão de `localStorage` da
 * chave legada. Idempotente.
 *
 * @param {string} eventId
 * @returns {boolean} true se já notificado, false se é novo
 */
export function eventoJaNotificadoPorEventId(eventId) {
  if (!eventId) return false;
  return eventoJaNotificado(chavePorEventId(eventId));
}

/**
 * Versão por-`eventId` do `marcarNotificado`.
 * Idempotente — chamar 2x com o mesmo `eventId` é seguro.
 *
 * @param {string} eventId
 */
export function marcarNotificadoPorEventId(eventId) {
  if (!eventId) return;
  marcarNotificado(chavePorEventId(eventId));
}
