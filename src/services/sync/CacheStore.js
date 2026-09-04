// Wrapper de localStorage para o cache do SyncManager.
//
// REGRAS INVIOLÁVEIS:
//   1. localStorage NUNCA é fonte de verdade. O Firestore é. Esta camada
//      só guarda uma CÓPIA do último snapshot confirmado, para acelerar
//      a hidratação (render instantâneo) antes do Firestore resolver.
//   2. Cache é SEMPRE por UID (effectiveUid). Nenhuma chave sem namespace
//      de usuário. Sem isso, logout/login de contas diferentes no mesmo
//      browser vazaria dados (já que `clearAll` só é chamado a partir da
//      Fase 6 — até lá, o isolamento por UID já cobre o caso).
//   3. JSON inválido / QuotaExceeded / qualquer falha de I/O é tratada
//      silenciosamente: a função retorna o que pode e LOGA. NUNCA
//      propaga erro para o caller (SyncManager e useContratos).
//   4. Schema versionado: se CACHE_VERSION mudou, o envelope é descartado
//      (retornado como null) e o cache é sobrescrito na próxima escrita
//      válida.
//
// Não depende de React. Funções puras, testáveis em isolamento.

import { cacheKey, envelope, readEnvelope } from "./syncKeys";

/**
 * Lê um envelope do localStorage. Retorna `null` se:
 *   - chave ausente;
 *   - JSON inválido;
 *   - schema antigo (CACHE_VERSION diferente);
 *   - qualquer erro de I/O.
 *
 * @param {string} uid
 * @param {string} collection
 * @returns {object|null}
 */
export function get(uid, collection) {
  if (!uid || !collection) return null;
  let raw;
  try {
    raw = window.localStorage.getItem(cacheKey(uid, collection));
  } catch (err) {
    // localStorage indisponível (modo privado restrito, etc.).
    console.warn("[CacheStore] get falhou:", err?.message);
    return null;
  }
  if (raw === null || raw === undefined) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // JSON corrompido: descarta a chave para não tentar de novo.
    console.warn("[CacheStore] JSON inválido em", cacheKey(uid, collection));
    try { window.localStorage.removeItem(cacheKey(uid, collection)); } catch (_) { /* noop */ }
    return null;
  }
  return readEnvelope(parsed);
}

/**
 * Grava um envelope no localStorage. Best-effort: se `QuotaExceededError`
 * ou qualquer falha de I/O, loga e segue em frente. O SyncManager
 * continua funcionando em memória; o cache local só acelera a hidratação.
 *
 * @param {string} uid
 * @param {string} collection
 * @param {*} data - payload arbitrário (array de contratos, etc.)
 */
export function set(uid, collection, data) {
  if (!uid || !collection) return;
  let serialized;
  try {
    serialized = JSON.stringify(envelope(data));
  } catch (err) {
    // data não-serializável (ciclos, BigInt, etc.). Loga e segue.
    console.warn("[CacheStore] JSON.stringify falhou para", collection, err?.message);
    return;
  }
  try {
    window.localStorage.setItem(cacheKey(uid, collection), serialized);
  } catch (err) {
    // QuotaExceededError é o caso mais comum em uso intenso.
    // Não tenta evict nesta fase — política de LRU entra em fase futura
    // se a app mostrar problemas reais. Por enquanto, perder o cache é
    // aceitável: o Firestore continua sendo a fonte de verdade.
    console.warn(
      "[CacheStore] set falhou para",
      cacheKey(uid, collection),
      err?.name || err?.message,
    );
  }
}

/**
 * Remove a chave de cache de um UID específico. Útil para testes e
 * (em fases futuras) para invalidação explícita por coleção.
 *
 * @param {string} uid
 * @param {string} collection
 */
export function clear(uid, collection) {
  if (!uid || !collection) return;
  try {
    window.localStorage.removeItem(cacheKey(uid, collection));
  } catch (err) {
    console.warn("[CacheStore] clear falhou:", err?.message);
  }
}

/**
 * Remove TODAS as chaves `jurex:cache:*` do localStorage. Preserva
 * outras chaves (`jurex:device-id`, `jurex:tema`, etc.) intencionalmente.
 *
 * Será usado na Fase 6 (logout cleanup). Disponível agora para testes.
 */
export function clearAll() {
  if (typeof window === "undefined") return;
  const prefix = "jurex:cache:";
  const toRemove = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch (err) {
    console.warn("[CacheStore] clearAll falhou:", err?.message);
  }
}
