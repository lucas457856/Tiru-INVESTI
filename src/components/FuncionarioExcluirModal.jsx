// Modal de alteração de STATUS do funcionário (inativar / ativar).
//
// - Funcionário ATIVO  → modal pergunta "Inativar?" (botão vermelho)
// - Funcionário INATIVO → modal pergunta "Ativar?"  (botão verde)
//
// IMPORTANTE: este modal NÃO apaga nada. Apenas alterna o campo
// `status` (e `deletedAt` no caso de inativação) via
// /api/auth/update-employee. Firebase Auth, o documento do funcionário,
// clientes, contratos, parcelas, pagamentos e histórico permanecem
// intactos.
//
// O funcionário inativado é bloqueado pelo AuthProvider ao tentar
// logar (status === "inativo" → /acesso-bloqueado). Reativar restaura
// o acesso sem recriar nada.

import { useState } from "react";
import { LoaderCircle, X, PowerOff, Power } from "lucide-react";
import { atualizarFuncionario } from "../services/employeesService";

export default function FuncionarioExcluirModal({ aberto, funcionario, aoFechar, aoSucesso }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  if (!aberto || !funcionario) return null;

  const jaInativo = funcionario.status === "inativo";
  const novoStatus = jaInativo ? "ativo" : "inativo";
  const acao = jaInativo ? "ativar" : "inativar";
  const corBotao = jaInativo
    ? "bg-gradient-to-r from-jurex to-emerald-500 shadow-jurex/25"
    : "bg-red-500 hover:bg-red-600";
  const textoTitulo = jaInativo ? "Ativar funcionário" : "Inativar funcionário";
  const textoBotao = jaInativo ? "Ativar" : "Inativar";
  const textoSucesso = jaInativo
    ? "Funcionário ativado com sucesso."
    : "Funcionário inativado com sucesso.";
  const Icone = jaInativo ? Power : PowerOff;

  async function handleConfirmar() {
    setErro("");
    setSalvando(true);
    // Mostra o erro real retornado pelo backend (sem try/catch que
    // esconda). `postJSON` sempre devolve { ok, erro } — incluindo a
    // mensagem de validação do servidor.
    const resp = await atualizarFuncionario({
      funcionarioId: funcionario.id,
      status: novoStatus,
    });
    setSalvando(false);
    if (!resp || !resp.ok) {
      setErro(resp?.erro || `Não foi possível ${acao}.`);
      return;
    }
    aoSucesso?.(textoSucesso);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => !salvando && aoFechar()}
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ring-1 ${
                jaInativo
                  ? "bg-emerald-50 dark:bg-emerald-500/10 ring-emerald-100 dark:ring-emerald-500/20"
                  : "bg-red-50 dark:bg-red-500/10 ring-red-100 dark:ring-red-500/20"
              }`}
            >
              <Icone
                className={`w-5 h-5 ${jaInativo ? "text-jurex" : "text-red-500"}`}
              />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {textoTitulo}
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {jaInativo
                  ? `${funcionario.nome} voltará a conseguir acessar o sistema.`
                  : `${funcionario.nome} não conseguirá mais acessar o sistema.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !salvando && aoFechar()}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">
          {jaInativo
            ? "Nenhum dado será alterado. A conta de acesso, clientes, contratos, parcelas, pagamentos e histórico permanecem intactos."
            : "Contratos, clientes, parcelas, pagamentos e histórico permanecem intactos. Esta ação pode ser revertida reativando o funcionário."}
        </div>

        {erro && (
          <div className="mt-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2.5 text-xs text-red-600 dark:text-red-300">
            {erro}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => !salvando && aoFechar()}
            disabled={salvando}
            className="flex-1 h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmar}
            disabled={salvando}
            className={`flex-1 h-11 rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md active:scale-[0.99] transition disabled:opacity-60 ${corBotao}`}
          >
            {salvando && <LoaderCircle className="w-4 h-4 animate-spin" />}
            {textoBotao}
          </button>
        </div>
      </div>
    </div>
  );
}
