// Modal de confirmação para EXCLUSÃO DEFINITIVA de funcionário.
//
// Diferente do `FuncionarioExcluirModal` (que faz toggle de status),
// este modal é a operação destrutiva: apaga o funcionário do Firebase
// Authentication, remove o doc do funcionário, o perfil, e TODOS os
// clientes e contratos que ele criou (filtrados por `createdBy`).
//
// Fluxo:
//   1. Usuário clica no botão "Excluir" na lista de funcionários.
//   2. Modal abre com aviso destacado de ação permanente.
//   3. Usuário digita o nome do funcionário para confirmar.
//   4. Clica em "Excluir definitivamente".
//   5. POST /api/auth/delete-employee com { funcionarioId, authUid }.
//   6. Sucesso → fecha modal e mostra toast.
//   7. Erro → mantém modal aberto e exibe a mensagem real do backend.
//
// Não deleta nada diretamente no client — tudo passa pelo Admin SDK
// no servidor. A sessão do dono nunca é afetada.

import { useState } from "react";
import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";
import { excluirFuncionario } from "../services/employeesService";

export default function FuncionarioExcluirDefinitivoModal({
  aberto,
  funcionario,
  aoFechar,
  aoSucesso,
}) {
  const [salvando, setSalvando] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState("");

  if (!aberto || !funcionario) return null;

  const nomeEsperado = (funcionario.nome || "").trim();
  const podeExcluir = confirmacao.trim() === nomeEsperado;

  async function handleExcluir() {
    if (!podeExcluir) {
      setErro(`Digite "${nomeEsperado}" para confirmar.`);
      return;
    }
    setErro("");
    setSalvando(true);
    const resp = await excluirFuncionario({
      funcionarioId: funcionario.id,
      funcionarioAuthUid: funcionario.authUid,
    });
    setSalvando(false);
    if (!resp || !resp.ok) {
      // Mostra a mensagem real do backend (sem try/catch que esconda).
      setErro(resp?.erro || "Não foi possível excluir o funcionário.");
      return;
    }
    aoSucesso?.(resp);
  }

  function handleFechar() {
    if (salvando) return;
    setConfirmacao("");
    setErro("");
    aoFechar();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={handleFechar}
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-5 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 ring-1 ring-red-100 dark:ring-red-500/20 flex items-center justify-center">
              <Trash2 className="w-5 h-5 text-red-500" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Excluir funcionário
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Tem certeza que deseja excluir este funcionário?
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleFechar}
            aria-label="Fechar"
            disabled={salvando}
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Alerta destacado de ação permanente */}
        <div className="mt-4 rounded-xl border-2 border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
              <p className="font-bold uppercase tracking-wide">
                Atenção: esta ação é permanente.
              </p>
              <p className="mt-1.5">
                Ao excluir este funcionário, todos os clientes e contratos
                vinculados a ele também serão excluídos permanentemente.
              </p>
              <p className="mt-1.5 font-semibold">
                Essa ação não poderá ser desfeita.
              </p>
            </div>
          </div>
        </div>

        {/* Dados do funcionário */}
        <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold">
            Funcionário
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">
            {funcionario.nome}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 break-all">
            {funcionario.email}
          </p>
        </div>

        {/* Lista do que será excluído */}
        <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">
          <p className="font-semibold text-slate-700 dark:text-slate-200">
            Serão excluídos:
          </p>
          <ul className="mt-1.5 space-y-1 list-disc list-inside">
            <li>Conta de acesso do funcionário (Firebase Authentication)</li>
            <li>Perfil e cadastro do funcionário</li>
            <li>Todos os clientes cadastrados por este funcionário</li>
            <li>Todos os contratos cadastrados por este funcionário</li>
            <li>Histórico de pagamentos e juros desses contratos</li>
          </ul>
        </div>

        {/* Confirmação por digitação */}
        <div className="mt-4">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Para confirmar, digite{" "}
            <span className="font-mono text-slate-900 dark:text-white">
              {nomeEsperado}
            </span>
          </label>
          <input
            type="text"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            disabled={salvando}
            autoFocus
            placeholder={nomeEsperado}
            className="mt-1.5 w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 disabled:opacity-60"
          />
        </div>

        {erro && (
          <div className="mt-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2.5 text-xs text-red-600 dark:text-red-300">
            {erro}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={handleFechar}
            disabled={salvando}
            className="flex-1 h-11 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleExcluir}
            disabled={!podeExcluir || salvando}
            className="flex-1 h-11 rounded-xl bg-red-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-red-500/25 hover:bg-red-600 active:scale-[0.99] transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {salvando && <LoaderCircle className="w-4 h-4 animate-spin" />}
            {salvando ? "Excluindo..." : "Excluir definitivamente"}
          </button>
        </div>
      </div>
    </div>
  );
}
