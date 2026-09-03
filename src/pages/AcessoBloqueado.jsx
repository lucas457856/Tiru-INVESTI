// Tela exibida quando um funcionário autenticado tem `status == "inativo"`
// no doc /usuarios/{ownerUid}/funcionarios/{funcionarioId}.
//
// O AuthProvider detecta essa condição e expõe `funcionarioStatus` no
// contexto. As rotas internas ficam bloqueadas; o usuário só vê esta
// tela e o botão Sair.

import { useNavigate } from "react-router-dom";
import { Lock, LogOut } from "lucide-react";
import { sair } from "../services/authService";

export default function AcessoBloqueado() {
  const navigate = useNavigate();

  async function handleSair() {
    try {
      await sair();
    } catch {
      /* ignore */
    }
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center shadow-sm">
        <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-500/10 ring-1 ring-amber-100 dark:ring-amber-500/20">
          <Lock className="w-7 h-7 text-amber-500" />
        </span>
        <h1 className="mt-5 text-lg font-bold text-slate-900 dark:text-white">
          Acesso desativado
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          Seu acesso foi desativado. Entre em contato com o administrador da
          conta.
        </p>
        <button
          type="button"
          onClick={handleSair}
          className="mt-6 w-full h-11 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.98] transition"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </div>
  );
}
