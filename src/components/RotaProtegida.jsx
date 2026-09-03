// Wrapper de rota que:
// 1. Redireciona para /login se não autenticado.
// 2. Redireciona para /acesso-bloqueado se o usuário autenticado é
//    funcionário com status="inativo".
// 3. Redireciona para /acesso-bloqueado se o usuário autenticado é
//    dono com status="bloqueado" (definido pelo Painel Admin).
//
// Funcionários ativos têm o mesmo acesso que o dono, porém sempre
// no escopo do `ownerUid` (garantido pelas Firestore Rules +
// useEffectiveUid()).

import { Navigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import AcessoBloqueado from "../pages/AcessoBloqueado";

export default function RotaProtegida({ children }) {
  const { usuario, carregando, role, funcionarioStatus, donoBloqueado } = useAuth();

  if (carregando) return null;
  if (!usuario) return <Navigate to="/login" replace />;

  // Funcionário inativo → tela de bloqueio
  if (role === "funcionario" && funcionarioStatus === "inativo") {
    return (
      <AcessoBloqueado
        titulo="Acesso desativado"
        mensagem="Seu acesso foi desativado. Entre em contato com o administrador da conta."
      />
    );
  }

  // Dono bloqueado pelo Painel Admin → tela de bloqueio
  if (role === "dono" && donoBloqueado) {
    return (
      <AcessoBloqueado
        titulo="Conta bloqueada"
        mensagem="Sua conta foi bloqueada pelo administrador. Entre em contato com o suporte para regularizar o acesso."
      />
    );
  }

  return children;
}
