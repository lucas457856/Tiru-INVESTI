import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { AuthContext } from "./AuthContext";

// Identifica o papel do usuário logo após o login.
//
// - DONO: o doc /usuarios/{uid} NÃO tem `role`/`ownerUid`.
//   Compatível com perfis existentes (que nunca tiveram esses campos).
// - FUNCIONARIO: o doc tem role="funcionario" e ownerUid vinculado.
//   O `funcionarioId` é usado para abrir listener em tempo real
//   no doc /usuarios/{ownerUid}/funcionarios/{funcionarioId} e
//   detectar mudança de status (inativação pelo dono).
// - SEM PERFIL: o doc não existe — usuário autenticado sem registro
//   (não deveria acontecer no fluxo normal: cadastro Auth sempre
//   cria o doc). Tratamos como logout forçado.
export default function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [role, setRole] = useState("dono"); // "dono" | "funcionario" | "sem-perfil"
  const [ownerUid, setOwnerUid] = useState(null);
  const [funcionarioId, setFuncionarioId] = useState(null);
  const [funcionarioStatus, setFuncionarioStatus] = useState(null);

  useEffect(() => {
    let unsubFuncDoc = null;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // Limpa listener anterior ao trocar de usuário
      if (unsubFuncDoc) {
        unsubFuncDoc();
        unsubFuncDoc = null;
      }

      setUsuario(user);
      setOwnerUid(null);
      setFuncionarioId(null);
      setFuncionarioStatus(null);
      setRole(user ? "dono" : "dono"); // default até carregar

      if (!user) {
        setCarregando(false);
        return;
      }

      // Carrega o perfil em /usuarios/{user.uid} para identificar role
      const perfilRef = doc(db, "usuarios", user.uid);
      getDoc(perfilRef)
        .then((snap) => {
          if (!snap.exists()) {
            setRole("sem-perfil");
            setCarregando(false);
            return;
          }
          const data = snap.data() || {};
          if (data.role === "funcionario" && data.ownerUid) {
            setRole("funcionario");
            setOwnerUid(data.ownerUid);
            setFuncionarioId(data.funcionarioId || null);
            // Listener em tempo real no doc do funcionário para detectar
            // mudança de status (dono inativa → funcionário bloqueado).
            if (data.funcionarioId) {
              const funcRef = doc(
                db,
                "usuarios",
                data.ownerUid,
                "funcionarios",
                data.funcionarioId,
              );
              unsubFuncDoc = onSnapshot(funcRef, (fSnap) => {
                if (!fSnap.exists()) {
                  setFuncionarioStatus("inativo");
                  return;
                }
                const fData = fSnap.data() || {};
                setFuncionarioStatus(fData.status || "ativo");
              });
            }
            setCarregando(false);
          } else {
            setRole("dono");
            setCarregando(false);
          }
        })
        .catch(() => {
          setRole("sem-perfil");
          setCarregando(false);
        });
    });
    return () => {
      if (unsubFuncDoc) unsubFuncDoc();
      unsubAuth();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        usuario,
        carregando,
        role,
        ownerUid,
        funcionarioId,
        funcionarioStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
