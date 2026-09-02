import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AuthProvider from "../context/AuthProvider";
import ThemeProvider from "../context/ThemeProvider";
import { useAuth } from "../context/useAuth";

import Login from "../pages/Login";
import NovoCliente from "../pages/NovoCliente";
import Cadastro from "../pages/Cadastro";
import EsqueciSenha from "../pages/EsqueciSenha";
import VerificarCodigo from "../pages/VerificarCodigo";
import NovaSenha from "../pages/NovaSenha";

import Dashboard from "../pages/Dashboard";
import Calendario from "../pages/Calendario";
import Parcelas from "../pages/Parcelas";
import Emprestimos from "../pages/Emprestimos";
import NovoContrato from "../pages/NovoContrato";
import ContratoSucesso from "../pages/ContratoSucesso";
import EmprestimoDetalhes from "../pages/EmprestimoDetalhes";
import ReceberPagamento from "../pages/ReceberPagamento";
import RenegociarParcela from "../pages/RenegociarParcela";
import Clientes from "../pages/Clientes";
import PerfilCliente from "../pages/PerfilCliente";
import EditarCliente from "../pages/EditarCliente";
import ModelosCobranca from "../pages/ModelosCobranca";
import ModelosContrato from "../pages/ModelosContrato";
import HistoricoFinanceiro from "../pages/HistoricoFinanceiro";
import Suporte from "../pages/Suporte";
import BackupDados from "../pages/BackupDados";
import Funcionarios from "../pages/Funcionarios";
import CentralAjuda from "../pages/CentralAjuda";
import Privacidade from "../pages/Privacidade";
import SobreJurex from "../pages/SobreJurex";
import ModeloContratoEditor from "../pages/ModeloContratoEditor";
import Relatorios from "../pages/Relatorios";
import Perfil from "../pages/Perfil";
import Configuracoes from "../pages/Configuracoes";

// Redireciona usuários autenticados para o dashboard
function RotaPublica({ children }) {
  const { usuario, carregando } = useAuth();
  if (carregando) return null;
  return usuario ? <Navigate to="/dashboard" replace /> : children;
}

// Protege as rotas do sistema
function RotaPrivada({ children }) {
  const { usuario, carregando } = useAuth();
  if (carregando) return null;
  return usuario ? children : <Navigate to="/login" replace />;
}

export default function AppRoutes() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
        <Routes>

          {/* AUTENTICAÇÃO */}
          <Route path="/" element={<RotaPublica><Login /></RotaPublica>} />
          <Route path="/login" element={<RotaPublica><Login /></RotaPublica>} />
          <Route path="/cadastro" element={<RotaPublica><Cadastro /></RotaPublica>} />
          <Route path="/esqueci-senha" element={<RotaPublica><EsqueciSenha /></RotaPublica>} />
          <Route path="/verificar-codigo" element={<VerificarCodigo />} />
          <Route path="/nova-senha" element={<NovaSenha />} />

          {/* SISTEMA (protegidas) */}
          <Route path="/dashboard" element={<RotaPrivada><Dashboard /></RotaPrivada>} />
          <Route path="/emprestimos" element={<RotaPrivada><Emprestimos /></RotaPrivada>} />
          <Route path="/contratos/novo" element={<RotaPrivada><NovoContrato /></RotaPrivada>} />
          <Route path="/contratos/:id/sucesso" element={<RotaPrivada><ContratoSucesso /></RotaPrivada>} />
          <Route path="/emprestimos/:id" element={<RotaPrivada><EmprestimoDetalhes /></RotaPrivada>} />
          <Route path="/receber-pagamento/:contratoId" element={<RotaPrivada><ReceberPagamento /></RotaPrivada>} />
          <Route path="/contratos/:contratoId/parcelas/:parcelaNumero/renegociar" element={<RotaPrivada><RenegociarParcela /></RotaPrivada>} />
          <Route path="/clientes" element={<RotaPrivada><Clientes /></RotaPrivada>} />
          <Route path="/clientes/novo" element={<RotaPrivada><NovoCliente /></RotaPrivada>} />
          <Route path="/clientes/:id" element={<RotaPrivada><PerfilCliente /></RotaPrivada>} />
          <Route path="/clientes/:id/editar" element={<RotaPrivada><EditarCliente /></RotaPrivada>} />
          <Route path="/calendario" element={<RotaPrivada><Calendario /></RotaPrivada>} />
          <Route path="/parcelas" element={<RotaPrivada><Parcelas /></RotaPrivada>} />
          <Route path="/historico-financeiro" element={<RotaPrivada><HistoricoFinanceiro /></RotaPrivada>} />
          <Route path="/suporte" element={<RotaPrivada><Suporte /></RotaPrivada>} />
          <Route path="/relatorios" element={<RotaPrivada><Relatorios /></RotaPrivada>} />
          <Route path="/perfil" element={<RotaPrivada><Perfil /></RotaPrivada>} />
          <Route path="/configuracoes/modelos-cobranca" element={<RotaPrivada><ModelosCobranca /></RotaPrivada>} />
          <Route path="/configuracoes/modelos-contrato" element={<RotaPrivada><ModelosContrato /></RotaPrivada>} />
          <Route path="/configuracoes/modelos-contrato/:id/editar" element={<RotaPrivada><ModeloContratoEditor /></RotaPrivada>} />
          <Route path="/configuracoes/backup" element={<RotaPrivada><BackupDados /></RotaPrivada>} />
          <Route path="/configuracoes/ajuda" element={<RotaPrivada><CentralAjuda /></RotaPrivada>} />
          <Route path="/configuracoes/privacidade" element={<RotaPrivada><Privacidade /></RotaPrivada>} />
          <Route path="/configuracoes/sobre" element={<RotaPrivada><SobreJurex /></RotaPrivada>} />
          <Route path="/configuracoes/funcionarios" element={<RotaPrivada><Funcionarios /></RotaPrivada>} />
          <Route path="/configuracoes" element={<RotaPrivada><Configuracoes /></RotaPrivada>} />

        </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
