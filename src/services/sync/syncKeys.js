// Centraliza as chaves de cache do SyncManager/CacheStore para evitar
// strings espalhadas pelo código. Toda chave SEMPRE inclui o `effectiveUid`
// (resolvido por `useEffectiveUid`) — isso garante que dados de um usuário
// NUNCA apareçam para outro no mesmo browser (cyber café, equipamento
// compartilhado, troca de login).
//
// Convenção mantida com o resto do projeto (notificationDedup, ThemeProvider,
// useDeviceRegistration): prefixo `jurex:`.
//
// `CACHE_VERSION` é incrementado quando o SCHEMA do cache muda. Mismatch
// na leitura → CacheStore descarta o cache e a página cai no loading normal
// (fonte de verdade continua sendo o Firestore).

// Bump sempre que o shape do cache mudar. Próximo bump esperado: Fase 2
// (quando adicionarmos chaves para clientes).
export const CACHE_VERSION = 1;

// Namespace raiz. Mantido curto: `jurex:cache:{uid}:{collection}`.
const NS = "jurex:cache";

/**
 * Chave completa de cache para uma coleção de um UID.
 * @param {string} uid - effectiveUid resolvido por useEffectiveUid
 * @param {string} collection - "contratos" | "clientes" | etc.
 * @returns {string}
 */
export function cacheKey(uid, collection) {
  if (!uid) throw new Error("cacheKey: uid obrigatório");
  if (!collection) throw new Error("cacheKey: collection obrigatória");
  return `${NS}:${uid}:${collection}`;
}

/**
 * Versão + timestamp + payload. Tudo envelopado para o CacheStore
 * detectar schema antigo e descartar sem crashar.
 *
 * @typedef {Object} CacheEnvelope
 * @property {number} v       - CACHE_VERSION no momento da escrita
 * @property {number} ts      - Date.now() no momento da escrita
 * @property {*}      data    - payload arbitrário (array de docs, etc.)
 */

/**
 * Monta o envelope padrão antes de gravar no localStorage.
 * @param {*} data
 * @returns {CacheEnvelope}
 */
export function envelope(data) {
  return { v: CACHE_VERSION, ts: Date.now(), data };
}

/**
 * Valida um envelope lido do localStorage. Retorna `null` se o envelope
 * é inválido, ausente ou de versão antiga — CacheStore deve descartar
 * nesse caso e cair no Firestore.
 *
 * @param {*} raw
 * @returns {CacheEnvelope|null}
 */
export function readEnvelope(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.v !== CACHE_VERSION) return null;
  if (typeof raw.ts !== "number") return null;
  if (!("data" in raw)) return null;
  return raw;
}
