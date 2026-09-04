import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { useEffectiveUid } from "./useEffectiveUid";
import { useContratos } from "./useContratos";

// Hook que observa:
//   1. A subcoleção /usuarios/{donoUid}/funcionarios (tempo real)
//   2. A coleção /usuarios/{donoUid}/contratos para contar quantos
//      contratos cada funcionário criou (filtra por createdBy ==
//      authUid; contratos do dono e de outros funcionários não contam).
//
// Retorna:
//   - funcionarios: array [{ id, nome, email, status, limiteContratos,
//     authUid, createdAt, ... }]
//   - contagemPorAuthUid: Record<authUid, number> — número de contratos
//     criados por aquele funcionário
//   - loading: true enquanto a primeira carga não chegou
//
// Para o DONO, `useEffectiveUid()` retorna o próprio uid. Funcionário
// não acessa esta página (não está no menu para ele), mas se chegar,
// o `useEffectiveUid()` retorna o ownerUid, e as rules validam o escopo.
export function useFuncionarios() {
  const ownerUid = useEffectiveUid();
  const [funcionarios, setFuncionarios] = useState([]);
  const [loading, setLoading] = useState(true);

  // Contratos do escopo efetivo, em tempo real, compartilhados com o
  // resto do app via SyncManager (Fase 1). Mesmo formato `{ id, ...data }`.
  // Substitui o `onSnapshot` próprio de `usuarios/{ownerUid}/contratos`
  // que existia nas linhas 55-79 da versão anterior (Fase 2.5).
  const { data: contratos } = useContratos();

  // 1) Lista de funcionários
  useEffect(() => {
    if (!ownerUid) {
      setFuncionarios([]);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db, "usuarios", ownerUid, "funcionarios")),
      (snap) => {
        const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Ordena por nome em memória (sem índice composto)
        lista.sort((a, b) =>
          (a.nome || "").localeCompare(b.nome || "", "pt-BR"),
        );
        setFuncionarios(lista);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [ownerUid]);

  // 2) Contagem de contratos por authUid (createdBy) — derivado dos
  // contratos acima (sem listener próprio). Mesma lógica do effect
  // antigo: conta APENAS contratos com `createdBy` definido
  // (contratos antigos sem `createdBy` são ignorados).
  //
  // Quando `ownerUid` é `null`, `useContratos().data` é `[]`, e o
  // `useMemo` itera array vazio → `{}` (idêntico ao
  // `setContagemPorAuthUid({})` do effect antigo).
  const contagemPorAuthUid = useMemo(() => {
    const cont = {};
    for (const c of contratos) {
      const cBy = c.createdBy;
      if (cBy) {
        cont[cBy] = (cont[cBy] || 0) + 1;
      }
    }
    return cont;
  }, [contratos]);

  return { funcionarios, contagemPorAuthUid, loading };
}
