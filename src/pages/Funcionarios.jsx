// Página /configuracoes/funcionarios
//
// CRUD de funcionários do proprietário autenticado. Funcionários têm
// login próprio (Firebase Auth) e operam no escopo do `ownerUid`.
// Tudo é feito SEM assinatura/plano/pagamento — apenas dados reais
// do Firestore.
//
// - Lista: /usuarios/{donoUid}/funcionarios (onSnapshot)
// - Contador de contratos: ouve /usuarios/{donoUid}/contratos e
//   conta por `createdBy == authUid` (filtra contratos do dono).
// - Criar/Editar/Excluir: passa por endpoints server-side
//   /api/auth/create-employee e /api/auth/update-employee (Admin SDK).
//   A sessão do DONO nunca é afetada.
// - Senha NUNCA é persistida: vai direto do input para o POST.

import { useEffect, useMemo, useState } from "react";
import {
  Pencil,
  Power,
  PowerOff,
  Search,
  UserPlus,
  UsersRound,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";
import NotificationBellButton from "../components/NotificationBellButton";
import FuncionarioModal from "../components/FuncionarioModal";
import FuncionarioExcluirModal from "../components/FuncionarioExcluirModal";
import { useFuncionarios } from "../hooks/useFuncionarios";
import { useAuth } from "../context/useAuth";
import { useEffectiveUid } from "../hooks/useEffectiveUid";

const FILTROS = ["Todos", "Ativos", "Inativos"];
const POR_PAGINA = 10;

function iniciais(nome) {
  if (!nome) return "?";
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function BarraProgresso({ usado, limite }) {
  // limite === 0 → sem limite (mostra contagem sem barra)
  if (!limite || limite <= 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">
          {usado}
        </span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          sem limite
        </span>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((usado / limite) * 100));
  const cor =
    pct >= 100
      ? "bg-red-500"
      : pct >= 80
        ? "bg-amber-500"
        : "bg-jurex";
  return (
    <div className="min-w-[140px]">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="font-bold text-slate-700 dark:text-slate-200 tabular-nums">
          {usado} / {limite}
        </span>
        <span className="text-slate-500 dark:text-slate-400">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div
          className={`h-full ${cor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const ativo = status === "ativo";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
        ativo
          ? "bg-emerald-50 text-jurex dark:bg-emerald-500/10 dark:text-emerald-400"
          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          ativo ? "bg-jurex" : "bg-slate-400"
        }`}
      />
      {ativo ? "Ativo" : "Inativo"}
    </span>
  );
}

export default function Funcionarios() {
  const { role } = useAuth();
  const ownerUid = useEffectiveUid();
  const { funcionarios, contagemPorAuthUid, loading } = useFuncionarios();

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("Todos");
  const [pagina, setPagina] = useState(1);

  const [modalCriar, setModalCriar] = useState(false);
  const [modalEditar, setModalEditar] = useState({ aberto: false, func: null });
  const [modalExcluir, setModalExcluir] = useState({ aberto: false, func: null });

  // Funcionários não acessam esta página (Sidebar não expõe o link
  // para eles). Se chegar aqui por URL, mostra estado vazio neutro.
  if (role === "funcionario") {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
            <h1 className="text-base font-bold text-slate-900 dark:text-white">
              Acesso restrito ao proprietário
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Esta página é gerenciada pelo dono da conta.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Filtragem
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return funcionarios.filter((f) => {
      if (filtro === "Ativos" && f.status !== "ativo") return false;
      if (filtro === "Inativos" && f.status !== "inativo") return false;
      if (!q) return true;
      return (
        (f.nome || "").toLowerCase().includes(q) ||
        (f.email || "").toLowerCase().includes(q)
      );
    });
  }, [funcionarios, busca, filtro]);

  // Paginação
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const inicio = (paginaSegura - 1) * POR_PAGINA;
  const paginaItens = filtrados.slice(inicio, inicio + POR_PAGINA);

  useEffect(() => {
    setPagina(1);
  }, [busca, filtro]);

  // Helpers de ação
  function abrirCriar() {
    setModalCriar(true);
  }
  function abrirEditar(func) {
    setModalEditar({ aberto: true, func });
  }
  function abrirExcluir(func) {
    setModalExcluir({ aberto: true, func });
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <BackButton />
              <HomeButton />
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  Funcionários
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {funcionarios.length} cadastrado(s)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBellButton />
              <button
                type="button"
                onClick={abrirCriar}
                className="h-10 px-4 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold flex items-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition"
              >
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">Adicionar</span>
              </button>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400 pointer-events-none" />
            <input
              type="search"
              placeholder="Buscar por nome ou e-mail"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full h-12 pl-11 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
            />
          </div>
          <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/60 self-start">
            {FILTROS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFiltro(f)}
                className={`px-3 h-9 rounded-lg text-xs font-bold transition ${
                  filtro === f
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Conteúdo */}
        {loading ? (
          <div className="mt-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Carregando…
          </div>
        ) : funcionarios.length === 0 ? (
          <EstadoVazio aoAdicionar={abrirCriar} />
        ) : filtrados.length === 0 ? (
          <SemResultados busca={busca} />
        ) : (
          <>
            {/* Tabela (desktop) */}
            <div className="mt-6 hidden md:block rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60">
                    <th className="text-left font-bold px-5 py-3">Funcionário</th>
                    <th className="text-left font-bold px-3 py-3">Status</th>
                    <th className="text-left font-bold px-3 py-3">Limite</th>
                    <th className="text-left font-bold px-3 py-3">Utilizado</th>
                    <th className="text-right font-bold px-5 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {paginaItens.map((f) => (
                    <LinhaTabela
                      key={f.id}
                      func={f}
                      usado={contagemPorAuthUid[f.authUid] || 0}
                      aoEditar={() => abrirEditar(f)}
                      aoExcluir={() => abrirExcluir(f)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards (mobile) */}
            <div className="mt-6 md:hidden space-y-3">
              {paginaItens.map((f) => (
                <CardFuncionario
                  key={f.id}
                  func={f}
                  usado={contagemPorAuthUid[f.authUid] || 0}
                  aoEditar={() => abrirEditar(f)}
                  aoExcluir={() => abrirExcluir(f)}
                />
              ))}
            </div>

            {/* Paginação */}
            {totalPaginas > 1 && (
              <div className="mt-5 flex items-center justify-between">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Página {paginaSegura} de {totalPaginas}
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    disabled={paginaSegura === 1}
                    className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                    disabled={paginaSegura === totalPaginas}
                    className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modais */}
      <FuncionarioModal
        aberto={modalCriar}
        modo="criar"
        funcionario={null}
        aoFechar={() => setModalCriar(false)}
        aoSucesso={() => setModalCriar(false)}
      />

      <FuncionarioModal
        aberto={modalEditar.aberto}
        modo="editar"
        funcionario={modalEditar.func}
        aoFechar={() => setModalEditar({ aberto: false, func: null })}
        aoSucesso={() => setModalEditar({ aberto: false, func: null })}
      />

      <FuncionarioExcluirModal
        aberto={modalExcluir.aberto}
        funcionario={modalExcluir.func}
        aoFechar={() => setModalExcluir({ aberto: false, func: null })}
        aoSucesso={() => setModalExcluir({ aberto: false, func: null })}
      />
    </AppLayout>
  );
}

function LinhaTabela({ func, usado, aoEditar, aoExcluir }) {
  const ativo = func.status === "ativo";
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 w-9 h-9 rounded-lg bg-emerald-500 text-white text-xs font-bold flex items-center justify-center">
            {iniciais(func.nome)}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {func.nome}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {func.email}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3.5">
        <StatusBadge status={func.status} />
      </td>
      <td className="px-3 py-3.5 text-sm text-slate-700 dark:text-slate-200 tabular-nums">
        {func.limiteContratos > 0 ? func.limiteContratos : "Ilimitado"}
      </td>
      <td className="px-3 py-3.5">
        <BarraProgresso
          usado={usado}
          limite={func.limiteContratos}
        />
      </td>
      <td className="px-5 py-3.5">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={aoEditar}
            title="Editar"
            className="p-2 rounded-lg text-slate-500 hover:text-jurex hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition"
          >
            <Pencil className="w-4 h-4" />
          </button>
          {ativo ? (
            <button
              type="button"
              onClick={aoExcluir}
              title="Inativar"
              className="p-2 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition"
            >
              <PowerOff className="w-4 h-4" />
            </button>
          ) : (
            <span
              title="Inativo"
              className="p-2 rounded-lg text-slate-300 dark:text-slate-600"
            >
              <Power className="w-4 h-4" />
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function CardFuncionario({ func, usado, aoEditar, aoExcluir }) {
  const ativo = func.status === "ativo";
  return (
    <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center gap-3">
        <span className="shrink-0 w-10 h-10 rounded-xl bg-emerald-500 text-white text-sm font-bold flex items-center justify-center">
          {iniciais(func.nome)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
            {func.nome}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {func.email}
          </p>
        </div>
        <StatusBadge status={func.status} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Limite {func.limiteContratos > 0 ? `${func.limiteContratos} contratos` : "ilimitado"}
          </p>
          <BarraProgresso usado={usado} limite={func.limiteContratos} />
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={aoEditar}
            className="p-2 rounded-lg text-slate-500 hover:text-jurex hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition"
          >
            <Pencil className="w-4 h-4" />
          </button>
          {ativo && (
            <button
              type="button"
              onClick={aoExcluir}
              className="p-2 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition"
            >
              <PowerOff className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function EstadoVazio({ aoAdicionar }) {
  return (
    <section className="mt-14 mb-16 flex flex-col items-center text-center">
      <span className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-100 dark:ring-emerald-500/20 p-4">
        <UsersRound className="w-7 h-7 text-jurex" />
      </span>
      <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
        Nenhum funcionário cadastrado
      </h2>
      <p className="mt-1.5 max-w-xs text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
        Adicione funcionários para que eles acessem seus clientes e
        contratos com login próprio.
      </p>
      <button
        type="button"
        onClick={aoAdicionar}
        className="mt-5 h-11 px-5 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.98] transition"
      >
        Adicionar primeiro funcionário
      </button>
    </section>
  );
}

function SemResultados({ busca }) {
  return (
    <section className="mt-14 mb-16 flex flex-col items-center text-center">
      <span className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-4">
        <Search className="w-7 h-7 text-slate-400" />
      </span>
      <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
        Nenhum resultado
      </h2>
      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
        Nenhum funcionário corresponde a &quot;{busca}&quot;.
      </p>
    </section>
  );
}
