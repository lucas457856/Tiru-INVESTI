// SyncManager: singleton em memória que mantém UM listener de `contratos`
// por (uid, path) durante toda a sessão autenticada. Múltiplos subscribers
// (Dashboard, Emprestimos, Parcelas, Relatórios, Calendário etc.) compartilham
// o mesmo snapshot e o mesmo `onSnapshot` — a navegação entre páginas
// não destrói nem recria o listener.
//
// CONTRATO:
//   - `subscribe(uid, path, callback)` → função `unsubscribe`.
//   - 1º subscribe de um path: cria o `onSnapshot` no Firestore.
//   - 2º+ subscribe do mesmo path: apenas registra o callback, retorna
//     o último snapshot conhecido IMEDIATAMENTE (se já houver um).
//   - unsubscribe: decrementa refCount. **Nunca** encerra o listener
//     enquanto a sessão está autenticada (apenas `reset()` encerra).
//   - `notifyWrite(uid, path)`: apenas registra que algo mudou. NÃO
//     tenta fabricar snapshot otimista (a Fase 1 mantém o snapshot oficial
//     do Firestore como única verdade). O listener já está ouvindo — o
//     próximo push do Firestore atualiza todos os subscribers.
//   - `reset()`: encerra TODOS os listeners. Usado no logout (Fase 6).
//
// O Firestore é a única fonte de verdade. O cache local (CacheStore)
// é apenas um acelerador de hidratação. Mesmo se o cache local estiver
// errado, o snapshot do Firestore sobrescreve no próximo push.

import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "../firebase";
import * as CacheStore from "./CacheStore";

/**
 * @typedef {Object} ListenerState
 * @property {string} uid
 * @property {string} path        - ex: "contratos" (sem prefixo "usuarios/{uid}/")
 * @property {Function} unsub      - função de unsubscribe do Firestore
 * @property {Set<Function>} subs  - subscribers ativos
 * @property {*} lastSnapshot      - último payload entregue (cache em memória)
 * @property {boolean} hasFired    - se o onSnapshot já entregou o 1º evento
 * @property {string|null} lastError
 * @property {boolean} pendingWrite - true após notifyWrite, até o próximo push
 */

// Chave do Map: `${uid}::${path}` (escopo por UID garante isolamento total).
const KEY_SEP = "::";
const states = new Map();

/** Listener ativo por UID (para `reset()`). */
const statesByUid = new Map();

/**
 * Constrói a chave interna do Map.
 */
function makeKey(uid, path) {
  return `${uid}${KEY_SEP}${path}`;
}

/**
 * Constrói a query Firestore para um path. Por enquanto, apenas paths
 * no formato `usuarios/{uid}/{collection}` são suportados — é o único
 * padrão em uso no projeto para contratos e clientes.
 */
function buildQuery(uid, path) {
  // path é o segmento após `usuarios/{uid}/` (ex: "contratos").
  return query(collection(db, "usuarios", uid, path));
}

/**
 * Notifica todos os subscribers e atualiza o cache local (CacheStore).
 */
function deliver(state) {
  for (const cb of state.subs) {
    try {
      cb({
        data: state.lastSnapshot,
        error: state.lastError,
        hasFired: state.hasFired,
      });
    } catch (err) {
      console.error("[SyncManager] subscriber threw:", err?.message);
    }
  }
  // Persiste no cache local APÓS o último snapshot confirmado.
  // Não persiste estado de erro nem estado intermediário "hasFired=false".
  if (state.hasFired && !state.lastError && state.lastSnapshot !== undefined) {
    CacheStore.set(state.uid, state.path, state.lastSnapshot);
  }
}

/**
 * Assina o snapshot de um path para um UID. Retorna função de unsubscribe.
 *
 * @param {string} uid   - effectiveUid
 * @param {string} path  - nome da coleção dentro de `usuarios/{uid}/` (ex: "contratos")
 * @param {(payload: { data: *, error: Error|null, hasFired: boolean }) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribe(uid, path, callback) {
  if (!uid) throw new Error("SyncManager.subscribe: uid obrigatório");
  if (!path) throw new Error("SyncManager.subscribe: path obrigatório");
  if (typeof callback !== "function") {
    throw new Error("SyncManager.subscribe: callback obrigatório");
  }

  const key = makeKey(uid, path);
  let state = states.get(key);

  if (!state) {
    // 1ª vez neste (uid, path): cria o listener e o estado.
    state = {
      uid,
      path,
      unsub: null,
      subs: new Set(),
      lastSnapshot: undefined,
      hasFired: false,
      lastError: null,
      pendingWrite: false,
    };
    states.set(key, state);

    // Agrupa por UID para `reset()`.
    if (!statesByUid.has(uid)) statesByUid.set(uid, new Set());
    statesByUid.get(uid).add(state);

    // Cria o onSnapshot. Erros são capturados no callback de erro do
    // Firestore e propagados aos subscribers como `error`.
    const firestoreUnsub = onSnapshot(
      buildQuery(uid, path),
      (snap) => {
        // Mapeia docs para o formato `{ id, ...data }` — mesmo shape
        // que `setContratos` no Dashboard original. Mantém compat
        // total com o código existente.
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        state.lastSnapshot = docs;
        state.hasFired = true;
        state.lastError = null;
        state.pendingWrite = false;
        deliver(state);
      },
      (err) => {
        state.lastError = err;
        state.hasFired = true;
        console.error("[SyncManager] onSnapshot error:", uid, path, err?.message);
        deliver(state);
      },
    );
    state.unsub = firestoreUnsub;
  }

  // Adiciona subscriber.
  state.subs.add(callback);

  // Se já temos snapshot anterior, entrega IMEDIATAMENTE para o novo
  // subscriber. Isso é o que evita "flash de loading" quando uma página
  // monta e outra já está com dados em memória.
  if (state.hasFired || state.lastSnapshot !== undefined || state.lastError) {
    try {
      callback({
        data: state.lastSnapshot,
        error: state.lastError,
        hasFired: state.hasFired,
      });
    } catch (err) {
      console.error("[SyncManager] initial callback threw:", err?.message);
    }
  }

  return () => {
    // Remove o subscriber do Set.
    if (!state.subs.has(callback)) return;
    state.subs.delete(callback);
    // IMPORTANTE: NÃO fecha o listener. A sessão autenticada mantém o
    // Firestore subscription vivo. `reset()` é a única forma de fechar.
    // Se `reset()` for chamado, ele cuida do cleanup.
  };
}

/**
 * Sinaliza que algo mudou em um path (após um write). O listener já
 * está ativo e o Firestore vai enviar um push em breve. Aqui apenas
 * marcamos o estado para diagnóstico.
 *
 * NÃO tenta fabricar snapshot otimista: o snapshot oficial do Firestore
 * é a única verdade. Esta chamada é best-effort e ignorável.
 *
 * @param {string} uid
 * @param {string} path
 */
export function notifyWrite(uid, path) {
  if (!uid || !path) return;
  const state = states.get(makeKey(uid, path));
  if (state) state.pendingWrite = true;
}

/**
 * Encerra TODOS os listeners ativos. Usado no logout (Fase 6) para
 * garantir que nenhuma subscription continue aberta após o usuário
 * sair. NÃO é chamado automaticamente em unsubscribe de página — a
 * sessão autenticada é o ciclo de vida real do listener.
 */
export function reset() {
  for (const [key, state] of states) {
    try {
      if (typeof state.unsub === "function") state.unsub();
    } catch (err) {
      console.error("[SyncManager] reset unsub falhou:", key, err?.message);
    }
    states.delete(key);
  }
  statesByUid.clear();
}

/**
 * Encerra listeners de um UID específico. Útil se o effectiveUid mudar
 * dentro da mesma sessão (improvável, mas possível em fluxos de troca
 * de papel — ex: promoção de funcionário a dono). Não usado na Fase 1.
 */
export function resetUid(uid) {
  if (!uid) return;
  const set = statesByUid.get(uid);
  if (!set) return;
  for (const state of set) {
    try {
      if (typeof state.unsub === "function") state.unsub();
    } catch (err) {
      console.error("[SyncManager] resetUid unsub falhou:", err?.message);
    }
    states.delete(makeKey(state.uid, state.path));
  }
  statesByUid.delete(uid);
}

/**
 * Diagnóstico: número de listeners ativos por UID. Útil para validar
 * em testes que NÃO estamos criando listeners duplicados.
 */
export function debugStats() {
  const out = {};
  for (const [uid, set] of statesByUid) {
    out[uid] = set.size;
  }
  return { byUid: out, total: states.size };
}
