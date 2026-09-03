// Camada de deduplicação para notificações de parcelas (vencendo / vencida).
//
// OBJETIVO: garantir que o MESMO evento (mesma parcela, mesmo vencimento)
// gere no máximo UMA notificação (Firestore + nativa), mesmo quando:
//   - o React re-renderiza várias vezes no mesmo mount;
//   - o `onSnapshot` re-emite a cada reconexão / update;
//   - o usuário navega entre páginas e volta;
//   - o usuário dá F5 / recarrega a aba;
//   - o hook é remontado por HMR em dev.
//
// ESTRATÉGIA — 3 camadas:
//
//   1. `notificacoesInSession` (Set em memória, singleton deste módulo):
//      cache O(1) compartilhado entre TODOS os hooks/componentes da aba.
//      Limpa em F5 (a própria JS heap é recriada).
//
//   2. `localStorage` (chave `jurex:notif:<tipo>:<contratoId>:<parcelaNumero>:<vencimentoISO>`):
//      persiste entre F5, logout/login, fechamento/reabertura de aba.
//      Padrão `jurex-*` consistente com `ThemeProvider.jsx:1-32`.
//
//   3. `tag` do Chrome (passado em `mostrarNotificacaoNativa({ tag })`):
//      dedup no nível do browser — segundo toast com mesma tag substitui o
//      primeiro em vez de empilhar. Definido em `utils/notifications.js`.
//
// ESTABILIDADE DA CHAVE: o `<vencimentoISO>` é a data ORIGINAL de vencimento
// da parcela (vem de `parcelasDoContrato`, que respeita `parcelasCustom` e
// `vencimentosCustom`). Enquanto a parcela não for renegociada, a chave é a
// mesma para sempre — não há re-disparo "no dia seguinte".
//
// Se o usuário renegociar a parcela com NOVO vencimento, a chave muda — e a
// notificação volta a aparecer (consistente com a definição de "evento novo").
//
// SEM TTL: a chave é estável para sempre enquanto a parcela não for
// renegociada. O `localStorage` acomoda 12k chaves × ~80 bytes ≈ 1 MB,
// bem dentro do limite de 5-10 MB dos browsers. Não vamos poluir a
// implementação com limpeza periódica.

const PREFIXO = "jurex:notif";

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
