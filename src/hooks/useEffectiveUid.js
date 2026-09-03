import { useAuth } from "../context/useAuth";

// Retorna o UID sob o qual as queries de clientes/contratos/funcionários
// devem ser executadas.
//
// - DONO: o próprio `usuario.uid` (consulta seus próprios dados).
// - FUNCIONARIO: o `ownerUid` (consulta dados do dono a que está
//   vinculado). O Firestore Rules valida que o perfil do funcionário
//   realmente tem esse `ownerUid`.
//
// Para a grande maioria das páginas isso é transparente: trocar
// `usuario.uid` por `useEffectiveUid()` em `collection(db, "usuarios", X, ...)`
// e em `where("ownerId", "==", X)` é o suficiente.
export function useEffectiveUid() {
  const { usuario, role, ownerUid } = useAuth();
  if (!usuario) return null;
  if (role === "funcionario" && ownerUid) return ownerUid;
  return usuario.uid;
}
