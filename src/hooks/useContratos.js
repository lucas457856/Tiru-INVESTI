// Hook de leitura do array de contratos do effectiveUid.
//
// COMPORTAMENTO (Fase 1):
//   1. Hidratação SÍNCRONA do localStorage (se houver cache válido).
//      → render instantâneo com dados anteriores. Sem "flash de loading".
//      → `loading: true` apenas na PRIMEIRA carga (sem cache).
//   2. Assina o SyncManager. Se o listener JÁ existe (porque outra página
//      montou antes), recebe o snapshot em memória IMEDIATAMENTE.
//   3. Snapshot oficial do Firestore sobrescreve o estado e atualiza o
//      cache local. Erros do Firestore são capturados e expostos como
//      `error` — não derrubam a página.
//
// GARANTIAS:
//   - 1 listener de `usuarios/{uid}/contratos` por sessão, independente
//     de quantas páginas chamem `useContratos()`.
//   - Cache isolado por `effectiveUid`. Funcionários herdam o UID do
//     dono → mesmo cache para todos os dispositivos do mesmo dono.
//   - Dados confirmados são SEMPRE associados ao UID que os produziu
//     (`dataUid`); troca de effectiveUid invalida a apresentação
//     imediatamente, sem flash de dados da identidade anterior.
//   - Logout/troca de UID → SyncManager.reset() (Fase 6) descarta o
//     listener e invalida o estado React.
//
// O hook NÃO é fonte de verdade. O Firestore é.

import { useEffect, useState } from "react";
import { useEffectiveUid } from "./useEffectiveUid";
import * as SyncManager from "../services/sync/SyncManager";
import * as CacheStore from "../services/sync/CacheStore";

/**
 * Lê o cache de forma síncrona para o `effectiveUid` atual.
 * Função PURA (sem hooks).
 */
function readInitial(uid) {
  if (!uid) return { data: [], hasCache: false, loading: false };
  const env = CacheStore.get(uid, "contratos");
  if (env && Array.isArray(env.data)) {
    return { data: env.data, hasCache: true, loading: false };
  }
  return { data: [], hasCache: false, loading: true };
}

/**
 * @returns {{
 *   data: Array<object>,
 *   loading: boolean,
 *   error: Error|null,
 *   fromCache: boolean,
 * }}
 */
export function useContratos() {
  const effectiveUid = useEffectiveUid();

  // ESTADOS derivados de callbacks do SyncManager (não do corpo do
  // effect). `setState` em callbacks de subscribe NÃO disparam
  // `react-hooks/set-state-in-effect`.
  //
  // `dataUid` ATOMICAMENTE associado aos dados: garante que o
  // snapshot da identidade anterior nunca seja apresentado como
  // sendo da identidade atual durante uma troca (login, troca de
  // papel, ou refocus de effectiveUid que voltou de null).
  const [data, setData] = useState([]);
  const [dataUid, setDataUid] = useState(null);
  const [error, setError] = useState(null);
  const [errorUid, setErrorUid] = useState(null);

  useEffect(() => {
    if (!effectiveUid) return undefined;

    const unsub = SyncManager.subscribe(effectiveUid, "contratos", (payload) => {
      if (payload.error) {
        setError(payload.error);
        setErrorUid(effectiveUid);
        setDataUid(effectiveUid);
        return;
      }
      if (payload.hasFired) {
        setData(Array.isArray(payload.data) ? payload.data : []);
        setDataUid(effectiveUid);
        setError(null);
        setErrorUid(effectiveUid);
      }
    });

    return unsub;
  }, [effectiveUid]);

  // DERIVADO no render. Lê o cache SÍNCRONAMENTE para o effectiveUid
  // atual. O `useState` initializer em `readInitial` (chamado
  // apenas no primeiro render) já cuida do mount; o React garante
  // que o initializer rode uma vez por montagem, com o effectiveUid
  // do momento. Para mudanças subsequentes de effectiveUid, o
  // callback do subscribe entrega `payload.data` (snapshot em
  // memória) que sobrescreve `data` e marca `dataUid`.
  //
  // REGRA ANTI-VAZAMENTO:
  //   - `displayData` usa `data` SOMENTE se `dataUid === effectiveUid`.
  //     Caso contrário, usa o cache do UID atual (ou [] se sem cache).
  //   - `displayLoading` é true apenas se não há cache E o UID atual
  //     ainda não foi confirmado pelo Firestore.
  //   - `error` só é exibido se `errorUid === effectiveUid` (erro
  //     da identidade anterior é descartado).
  const initial = readInitial(effectiveUid);
  const dataMatchesUid = dataUid === effectiveUid && effectiveUid !== null;
  const errorMatchesUid = errorUid === effectiveUid && effectiveUid !== null;
  const displayData = dataMatchesUid ? data : initial.data;
  const displayLoading = !dataMatchesUid && initial.loading;
  const displayError = errorMatchesUid ? error : null;
  const fromCache = initial.hasCache && !dataMatchesUid && !errorMatchesUid;

  return {
    data: displayData,
    loading: displayLoading,
    error: displayError,
    fromCache,
  };
}
