import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { useEffectiveUid } from "./useEffectiveUid";

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
  const [contagemPorAuthUid, setContagemPorAuthUid] = useState({});
  const [loading, setLoading] = useState(true);

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

  // 2) Contagem de contratos por authUid (createdBy)
  useEffect(() => {
    if (!ownerUid) {
      setContagemPorAuthUid({});
      return;
    }
    const unsub = onSnapshot(
      collection(db, "usuarios", ownerUid, "contratos"),
      (snap) => {
        const cont = {};
        for (const d of snap.docs) {
          const data = d.data() || {};
          const cBy = data.createdBy;
          // Conta APENAS contratos com createdBy definido (criados
          // explicitamente por alguém — pode ser o dono ou um func).
          // Contratos antigos sem createdBy são ignorados aqui.
          if (cBy) {
            cont[cBy] = (cont[cBy] || 0) + 1;
          }
        }
        setContagemPorAuthUid(cont);
      },
    );
    return unsub;
  }, [ownerUid]);

  return { funcionarios, contagemPorAuthUid, loading };
}
