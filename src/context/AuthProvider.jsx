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
//
// IMPORTANTE: o estado `roleResolvido` distingue "ainda não sei o
// papel do usuário" de "sei que é dono". Sem isso, useEffectiveUid()
// retornaria usuario.uid durante a janela de 1-2 rounds de Firestore
// em que o perfil está sendo buscado — e as queries de Clientes/
// Contratos rodariam com o UID errado (causando 0 resultados para
// funcionários). Ver useEffectiveUid.js.
export default function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [role, setRole] = useState(null); // null | "dono" | "funcionario" | "sem-perfil"
  const [roleResolvido, setRoleResolvido] = useState(false);
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
      setRole(null);
      setRoleResolvido(false);
      setCarregando(false);

      if (!user) {
        // Sem usuário: papel resolvido (não há papel).
        setRoleResolvido(true);
        return;
      }

      // Carrega o perfil em /usuarios/{user.uid} para identificar role
      const perfilRef = doc(db, "usuarios", user.uid);
      getDoc(perfilRef)
        .then((snap) => {
          if (!snap.exists()) {
            console.warn("[AUTH] perfil não encontrado em usuarios/" + user.uid);
            setRole("sem-perfil");
            setRoleResolvido(true);
            return;
          }
          const data = snap.data() || {};
          console.log("[AUTH]", {
            authUid: user.uid,
            role: data.role ?? "(ausente — DONO)",
            ownerUid: data.ownerUid ?? null,
            funcionarioId: data.funcionarioId ?? null,
          });
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
            setRoleResolvido(true);
          } else {
            setRole("dono");
            setRoleResolvido(true);
          }
        })
        .catch((err) => {
          console.error("[AUTH] erro ao carregar perfil:", err);
          setRole("sem-perfil");
          setRoleResolvido(true);
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
        roleResolvido,
        ownerUid,
        funcionarioId,
        funcionarioStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
