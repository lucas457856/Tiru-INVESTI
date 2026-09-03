// Hook que retorna `true` se o usuário autenticado é a conta
// administrativa principal. Usa a constante ADMIN_UID de
// `src/config/adminConfig.js`.
//
// Retorna `false` enquanto o AuthProvider ainda está carregando ou
// se o usuário não está autenticado. Componentes que precisam de
// feedback imediato durante o loading devem usar `carregando` do
// useAuth() em conjunto.

import { useAuth } from "../context/useAuth";
import { isAdminUid } from "../config/adminConfig";

export function useIsAdmin() {
  const { usuario } = useAuth();
  if (!usuario || !usuario.uid) return false;
  return isAdminUid(usuario.uid);
}
