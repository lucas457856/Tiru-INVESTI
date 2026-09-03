// Wrapper de rota que:
// 1. Redireciona para /login se não autenticado.
// 2. Redireciona para /acesso-bloqueado se o usuário autenticado é
//    funcionário com status="inativo".
//
// Este wrapper é aplicado nas rotas internas do sistema (RotaPrivada
// em AppRoutes.jsx). Funcionários ativos têm o mesmo acesso que o
// dono, porém sempre no escopo do `ownerUid` (garantido pelas
// Firestore Rules + useEffectiveUid()).

import { Navigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import AcessoBloqueado from "../pages/AcessoBloqueado";

export default function RotaProtegida({ children }) {
  const { usuario, carregando, role, funcionarioStatus } = useAuth();

  if (carregando) return null;
  if (!usuario) return <Navigate to="/login" replace />;

  // Funcionário inativo → tela de bloqueio.
  if (role === "funcionario" && funcionarioStatus === "inativo") {
    return <AcessoBloqueado />;
  }

  return children;
}
