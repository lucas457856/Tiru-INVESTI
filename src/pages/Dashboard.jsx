import { Link } from "react-router-dom";
import {
  Bell,
  EyeOff,
  CalendarDays,
  CircleDollarSign,
  FileText,
  History,
  CircleQuestionMark,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/useAuth";

export default function Dashboard() {
  const { usuario } = useAuth();

  const atalhos = [
    { label: "Contratos", icone: FileText },
    { label: "Parcelas", icone: CircleDollarSign },
    { label: "Histórico", icone: History },
    { label: "Suporte", icone: CircleQuestionMark },
  ];

  return (
    <AppLayout>
      {/* Topo */}
      <div className="flex items-start justify-between px-8 pt-6">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">Olá,</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {(usuario?.displayName ?? "USUÁRIO").toUpperCase()}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Bem-vindo(a) ao seu painel
          </p>
        </div>
        <button
          type="button"
          className="relative rounded-full p-2.5 bg-white ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          aria-label="Notificações"
        >
          <Bell className="w-5 h-5 text-emerald-600" />
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-jurex text-[10px] font-bold text-white flex items-center justify-center">
            2+
          </span>
        </button>
      </div>

      {/* Card do saldo */}
      <div className="mx-8 mt-5 relative overflow-hidden rounded-2xl border border-emerald-100 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 p-7">
        {/* Ondas decorativas */}
        <svg
          viewBox="0 0 200 120"
          className="absolute right-16 top-1/2 h-32 w-64 -translate-y-1/2 text-emerald-200/40 pointer-events-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          {[10, 30, 50, 70, 90, 110].map((y) => (
            <path key={y} d={`M0 ${y} q 50 -18 100 0 t 100 0`} />
          ))}
        </svg>
        <EyeOff className="absolute right-4 top-4 w-5 h-5 text-slate-500" />

        <p className="text-xs font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase dark:!text-slate-400">
          Total emprestado
        </p>
        <p className="mt-1 text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white tabular-nums">
          R$&nbsp;0,00
        </p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-jurex/15 px-3 py-1 text-xs font-bold text-jurex dark:bg-jurex/25">
          Tudo em dia
        </span>

        {/* Recebido / A receber */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-500/30 bg-white/60 dark:bg-slate-800/60 p-4">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase text-emerald-600">
              <CircleDollarSign className="w-4 h-4" />
              Recebido
            </span>
            <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white tabular-nums">
              R$ 0,00
            </p>
          </div>
          <div className="rounded-xl border border-amber-300/70 dark:border-amber-500/30 bg-white/60 dark:bg-slate-800/60 p-4">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase text-amber-600">
              <CircleDollarSign className="w-4 h-4" />
              A receber
            </span>
            <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white tabular-nums">
              R$ 0,00
            </p>
          </div>
        </div>
      </div>

      {/* Ativar notificações */}
      <div className="mx-8 mt-6 flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-2.5">
            <Bell className="w-5 h-5 text-emerald-600" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Ativar notificações
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Receba alertas de pagamentos mesmo com o app fechado
            </p>
          </div>
        </div>
        <button
          type="button"
          className="text-sm font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 transition"
        >
          Ativar
        </button>
      </div>

      {/* Parcelas de hoje */}
      <div className="mx-8 mt-4 flex items-center gap-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <span className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2.5">
          <CalendarDays className="w-5 h-5 text-slate-600" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Não temos parcelas hoje
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Nenhum vencimento para hoje</p>
        </div>
      </div>

      {/* Acesso rápido */}
      <section className="mx-8 mt-8">
        <h2 className="text-xs font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
          Acesso rápido
        </h2>
        <div className="mt-4 flex flex-wrap gap-6">
          {atalhos.map(({ label, icone: Atalho }) => (
            <Link
              key={label}
              to="/emprestimos"
              className="group flex flex-col items-center gap-1.5"
            >
              <span className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm group-hover:border-emerald-300 group-hover:text-jurex text-slate-700 dark:bg-slate-900 dark:text-slate-200 transition [&_svg]:w-6 [&_svg]:h-6">
                <Atalho />
              </span>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Contratos ativos */}
      <section className="mx-8 mb-10 mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
            Contratos ativos
          </h2>
          <Link
            to="/emprestimos"
            className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 transition"
          >
            Ver todos
          </Link>
        </div>
        {/* Lista de contratos aqui */}
      </section>
    </AppLayout>
  );
}
