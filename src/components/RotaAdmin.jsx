// Wrapper de rota que PROTEGE o Painel Administrativo (/admin).
//
// Comportamento:
//   1. Se o usuário não está autenticado, redireciona para /login.
//   2. Se está autenticado mas NÃO é a conta ADMIN_UID, redireciona
//      para /dashboard (nunca exibe a página, mesmo digitando a URL
//      manualmente).
//   3. Se é a conta ADMIN_UID, renderiza os filhos.
//
// IMPORTANTE: esta é defesa em camadas. A validação real (e
// autoritativa) acontece no endpoint server-side
// `api/admin/overview.js`, que compara o `decoded.uid` do token
// com a env var `ADMIN_UID`. Este wrapper apenas garante que a
// página nem seja renderizada para usuários não-admin.

import { Navigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { isAdminUid } from "../config/adminConfig";

export default function RotaAdmin({ children }) {
  const { usuario, carregando } = useAuth();

  if (carregando) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="w-8 h-8 border-2 border-jurex/30 border-t-jurex rounded-full animate-spin" />
      </div>
    );
  }

  if (!usuario) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdminUid(usuario.uid)) {
    // Bloqueio silencioso: usuário não-admin não vê nem um flash
    // do painel. Vai direto para o dashboard normal dele.
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
