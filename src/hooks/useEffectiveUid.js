import { useAuth } from "../context/useAuth";

// Retorna o UID sob o qual as queries de clientes/contratos/funcionários
// devem ser executadas.
//
// - DONO: o próprio `usuario.uid` (consulta seus próprios dados).
// - FUNCIONARIO: o `ownerUid` (consulta dados do dono a que está
//   vinculado). O Firestore Rules valida que o perfil do funcionário
//   realmente tem esse `ownerUid`.
//
// IMPORTANTE — RACE CONDITION:
//   Enquanto o AuthProvider ainda está buscando o perfil
//   (getDoc em /usuarios/{user.uid}), `role` é `null` e
//   `roleResolvido` é `false`. Durante essa janela, retornar
//   `usuario.uid` causaria queries com o UID do FUNCIONÁRIO —
//   que retornam 0 docs para Clientes/Contratos (porque os dados
//   vivem em `usuarios/{ownerUid}/...`). Por isso retornamos
//   `null` aqui e bloqueamos as queries até a role ser resolvida.
//
// Para a grande maioria das páginas isso é transparente: trocar
// `usuario.uid` por `useEffectiveUid()` em `collection(db, "usuarios", X, ...)`
// e em `where("ownerId", "==", X)` é o suficiente.
export function useEffectiveUid() {
  const { usuario, role, roleResolvido, ownerUid } = useAuth();
  if (!usuario) return null;
  if (!roleResolvido) {
    return null;
  }
  if (role === "funcionario") {
    if (!ownerUid) {
      console.error("[EFFECTIVE UID] funcionário sem ownerUid — perfil corrompido");
      return null;
    }
    return ownerUid;
  }
  if (role === "dono") {
    return usuario.uid;
  }
  // sem-perfil: bloqueia
  console.warn("[EFFECTIVE UID] role=", role, "— bloqueando queries");
  return null;
}
