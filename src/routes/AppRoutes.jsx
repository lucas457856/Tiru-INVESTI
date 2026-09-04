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
import AcessoBloqueado from "../pages/AcessoBloqueado";
import RotaProtegida from "../components/RotaProtegida";
import RotaDono from "../components/RotaDono";

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
import DebugAuth from "../pages/DebugAuth";
import PainelAdmin from "../pages/PainelAdmin";
import RotaAdmin from "../components/RotaAdmin";
import CentralAjuda from "../pages/CentralAjuda";
import Privacidade from "../pages/Privacidade";
import SobreJurex from "../pages/SobreJurex";
import ModeloContratoEditor from "../pages/ModeloContratoEditor";
import Relatorios from "../pages/Relatorios";
import Perfil from "../pages/Perfil";
import Notificacoes from "../pages/Notificacoes";
import Configuracoes from "../pages/Configuracoes";
import MeusPlanos from "../pages/MeusPlanos";

// Redireciona usuários autenticados para o dashboard
function RotaPublica({ children }) {
  const { usuario, carregando } = useAuth();
  if (carregando) return null;
  return usuario ? <Navigate to="/dashboard" replace /> : children;
}

// Protege as rotas do sistema (RotaPrivada removido — não era usado;
// toda proteção é feita via <RotaProtegida>.)
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
          <Route path="/dashboard" element={<RotaProtegida><Dashboard /></RotaProtegida>} />
          <Route path="/emprestimos" element={<RotaProtegida><Emprestimos /></RotaProtegida>} />
          <Route path="/contratos/novo" element={<RotaProtegida><NovoContrato /></RotaProtegida>} />
          {/* Edição reusa o mesmo componente `NovoContrato`, que detecta o
              `:id` via `useParams` e alterna para modo edição (prefetch via
              buscarContrato, updateDoc no salvar). */}
          <Route path="/emprestimos/:id/editar" element={<RotaProtegida><NovoContrato /></RotaProtegida>} />
          <Route path="/contratos/:id/sucesso" element={<RotaProtegida><ContratoSucesso /></RotaProtegida>} />
          <Route path="/emprestimos/:id" element={<RotaProtegida><EmprestimoDetalhes /></RotaProtegida>} />
          <Route path="/receber-pagamento/:contratoId" element={<RotaProtegida><ReceberPagamento /></RotaProtegida>} />
          <Route path="/contratos/:contratoId/parcelas/:parcelaNumero/renegociar" element={<RotaProtegida><RenegociarParcela /></RotaProtegida>} />
          <Route path="/clientes" element={<RotaProtegida><Clientes /></RotaProtegida>} />
          <Route path="/clientes/novo" element={<RotaProtegida><NovoCliente /></RotaProtegida>} />
          <Route path="/clientes/:id" element={<RotaProtegida><PerfilCliente /></RotaProtegida>} />
          <Route path="/clientes/:id/editar" element={<RotaProtegida><EditarCliente /></RotaProtegida>} />
          <Route path="/calendario" element={<RotaProtegida><Calendario /></RotaProtegida>} />
          <Route path="/parcelas" element={<RotaProtegida><Parcelas /></RotaProtegida>} />
          <Route path="/historico-financeiro" element={<RotaProtegida><HistoricoFinanceiro /></RotaProtegida>} />
          <Route path="/suporte" element={<RotaProtegida><Suporte /></RotaProtegida>} />
          <Route path="/relatorios" element={<RotaProtegida><Relatorios /></RotaProtegida>} />
          <Route path="/perfil" element={<RotaProtegida><Perfil /></RotaProtegida>} />
          <Route path="/notificacoes" element={<RotaProtegida><Notificacoes /></RotaProtegida>} />
          <Route path="/configuracoes/modelos-cobranca" element={<RotaProtegida><RotaDono><ModelosCobranca /></RotaDono></RotaProtegida>} />
          <Route path="/configuracoes/modelos-contrato" element={<RotaProtegida><RotaDono><ModelosContrato /></RotaDono></RotaProtegida>} />
          <Route path="/configuracoes/modelos-contrato/:id/editar" element={<RotaProtegida><RotaDono><ModeloContratoEditor /></RotaDono></RotaProtegida>} />
          <Route path="/configuracoes/backup" element={<RotaProtegida><RotaDono><BackupDados /></RotaDono></RotaProtegida>} />
          <Route path="/configuracoes/ajuda" element={<RotaProtegida><CentralAjuda /></RotaProtegida>} />
          <Route path="/configuracoes/privacidade" element={<RotaProtegida><Privacidade /></RotaProtegida>} />
          <Route path="/configuracoes/sobre" element={<RotaProtegida><SobreJurex /></RotaProtegida>} />
          <Route path="/configuracoes/funcionarios" element={<RotaProtegida><RotaDono><Funcionarios /></RotaDono></RotaProtegida>} />
          <Route path="/debug-auth" element={<RotaProtegida><DebugAuth /></RotaProtegida>} />
          <Route path="/configuracoes" element={<RotaProtegida><Configuracoes /></RotaProtegida>} />
          <Route path="/configuracoes/meus-planos" element={<RotaProtegida><MeusPlanos /></RotaProtegida>} />

          {/* Tela de bloqueio para funcionário inativo */}
          <Route path="/acesso-bloqueado" element={<AcessoBloqueado />} />

          {/* ADMIN — só a conta ADMIN_UID entra (RotaAdmin verifica
              tanto no client quanto no endpoint server-side). */}
          <Route path="/admin" element={<RotaAdmin><PainelAdmin /></RotaAdmin>} />

        </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
