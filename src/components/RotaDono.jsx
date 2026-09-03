// Wrapper de rota que bloqueia FUNCIONÁRIO de acessar páginas exclusivas
// do DONO (modelos de contrato, configurações, backup, etc.).
// Funcionário inativo continua barrado pelo RotaProtegida.

import { Navigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function RotaDono({ children }) {
  const { role } = useAuth();
  if (role === "funcionario") {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}
