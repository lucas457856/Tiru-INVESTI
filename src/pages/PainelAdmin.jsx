// Página: /admin — Painel Administrativo.
//
// Acesso restrito à conta ADMIN_UID (ver `RotaAdmin` e
// `api/admin/overview.js`). A proteção é dupla:
//
//   1. Frontend: `RotaAdmin` redireciona para /dashboard se
//      `user.uid !== ADMIN_UID`.
//   2. Backend:  `api/admin/overview.js` valida o idToken e compara
//      o `decoded.uid` com a env var ADMIN_UID. Retorna 403 se
//      não bater.
//
// Por isso esta página NUNCA é renderizada para usuários comuns,
// mesmo que descubram a URL. E os dados de múltiplos donos só
// saem do servidor se o servidor confirmar que o chamador é admin.

import { useEffect, useState } from "react";
import {
  Users,
  UserCog,
  Briefcase,
  FileText,
  RefreshCw,
  Shield,
  LoaderCircle,
  Mail,
  Phone,
  Calendar,
  Activity,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";
import { useAuth } from "../context/useAuth";
import { ADMIN_UID, isAdminUid } from "../config/adminConfig";
import { buscarOverview } from "../services/adminService";

// Formata data ISO para pt-BR curto. Aceita string ISO, Timestamp do
// Firestore (já convertido) ou null.
function fmtData(v) {
  if (!v) return "—";
  try {
    const d = typeof v === "string" ? new Date(v) : v;
    if (!(d instanceof Date) || isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function CardTotal({ icone: Icone, rotulo, valor, cor = "jurex" }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span
          className={`shrink-0 w-10 h-10 rounded-xl bg-${cor}-50 dark:bg-${cor}-500/10 ring-1 ring-${cor}-100 dark:ring-${cor}-500/20 flex items-center justify-center`}
        >
          <Icone className={`w-5 h-5 text-${cor}-500`} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {rotulo}
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {valor}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function PainelAdmin() {
  const { usuario } = useAuth();
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState("dono");
  // Versão incremental: cada vez que "atualizar" muda, refaz o fetch.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelado = false;
    buscarOverview().then((resp) => {
      if (cancelado) return;
      setLoading(false);
      if (!resp || !resp.ok) {
        setErro(resp?.erro || "Não foi possível carregar o painel.");
        return;
      }
      setDados(resp);
    });
    return () => {
      cancelado = true;
    };
  }, [tick]);

  function carregar() {
    setErro("");
    setLoading(true);
    setTick((t) => t + 1);
  }

  // Defesa adicional: se algo passou pelo RotaAdmin mas o usuário
  // não é admin, mostra estado vazio em vez de dados (não acontece
  // em produção, mas é uma camada a mais).
  if (!isAdminUid(usuario?.uid)) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
            <h1 className="text-base font-bold text-slate-900 dark:text-white">
              Acesso restrito
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Esta página é exclusiva do administrador principal do sistema.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const totals = dados?.totals || {
    donos: 0,
    funcionarios: 0,
    clientes: 0,
    contratos: 0,
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <BackButton />
              <HomeButton />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-jurex" />
                  <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                    Painel Administrativo
                  </h1>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Visão geral do sistema • UID{" "}
                  <span className="font-mono text-[11px]">{ADMIN_UID}</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={carregar}
              disabled={loading}
              className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </button>
          </div>
        </div>

        {/* Erro */}
        {erro && (
          <div className="rounded-2xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
            {erro}
          </div>
        )}

        {/* Cards de totais */}
        {loading && !dados ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
            <LoaderCircle className="w-4 h-4 animate-spin" />
            Carregando dados agregados do Firestore…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <CardTotal
                icone={Users}
                rotulo="Donos"
                valor={totals.donos}
                cor="jurex"
              />
              <CardTotal
                icone={UserCog}
                rotulo="Funcionários"
                valor={totals.funcionarios}
                cor="blue"
              />
              <CardTotal
                icone={Briefcase}
                rotulo="Clientes"
                valor={totals.clientes}
                cor="amber"
              />
              <CardTotal
                icone={FileText}
                rotulo="Contratos"
                valor={totals.contratos}
                cor="purple"
              />
            </div>

            {/* Resumo do sistema */}
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-jurex" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Resumo do sistema
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
                  <p className="text-[11px] uppercase tracking-widest text-slate-500 font-bold">
                    Total de usuários
                  </p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                    {totals.donos + totals.funcionarios}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {totals.donos} dono(s) + {totals.funcionarios} funcionário(s)
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
                  <p className="text-[11px] uppercase tracking-widest text-slate-500 font-bold">
                    Proporção cliente/dono
                  </p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                    {totals.donos > 0
                      ? (totals.clientes / totals.donos).toFixed(1)
                      : "0"}
                  </p>
                  <p className="text-[11px] text-slate-500">clientes por dono</p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
                  <p className="text-[11px] uppercase tracking-widest text-slate-500 font-bold">
                    Proporção contrato/dono
                  </p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                    {totals.donos > 0
                      ? (totals.contratos / totals.donos).toFixed(1)
                      : "0"}
                  </p>
                  <p className="text-[11px] text-slate-500">contratos por dono</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                Atualizado em{" "}
                {dados?.geradoEm
                  ? new Date(dados.geradoEm).toLocaleString("pt-BR")
                  : "—"}{" "}
                • A leitura é feita pelo Admin SDK no servidor.
              </p>
            </section>

            {/* Tabs: Donos / Funcionários */}
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="flex border-b border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAba("dono")}
                  className={`flex-1 px-4 py-3 text-sm font-bold transition ${
                    aba === "dono"
                      ? "text-jurex border-b-2 border-jurex"
                      : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                  }`}
                >
                  <Users className="w-4 h-4 inline mr-2" />
                  Donos ({dados?.donos?.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setAba("func")}
                  className={`flex-1 px-4 py-3 text-sm font-bold transition ${
                    aba === "func"
                      ? "text-jurex border-b-2 border-jurex"
                      : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                  }`}
                >
                  <UserCog className="w-4 h-4 inline mr-2" />
                  Funcionários ({dados?.funcionarios?.length || 0})
                </button>
              </div>

              {aba === "dono" ? (
                <ListaDonos donos={dados?.donos || []} />
              ) : (
                <ListaFuncionarios funcionarios={dados?.funcionarios || []} />
              )}
            </section>

            {/* Aviso sobre controles futuros */}
            <section className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
              <p className="font-bold">Controles administrativos</p>
              <p className="mt-1 text-xs leading-relaxed">
                Ativação/desativação de donos, limites de uso e outras ações
                administrativas exigirão um campo{" "}
                <span className="font-mono">disabled</span> ou{" "}
                <span className="font-mono">status</span> no documento{" "}
                <span className="font-mono">usuarios/&#123;uid&#125;</span>, mais
                endpoints server-side. A estrutura está pronta para receber
                isso sem quebrar o sistema atual.
              </p>
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function ListaDonos({ donos }) {
  if (donos.length === 0) {
    return <EstadoVazio mensagem="Nenhum dono cadastrado ainda." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60">
            <th className="text-left font-bold px-5 py-3">Dono</th>
            <th className="text-left font-bold px-3 py-3">Contato</th>
            <th className="text-left font-bold px-3 py-3">Cadastro</th>
            <th className="text-right font-bold px-3 py-3">Func.</th>
            <th className="text-right font-bold px-3 py-3">Contratos</th>
            <th className="text-left font-bold px-5 py-3">UID</th>
          </tr>
        </thead>
        <tbody>
          {donos.map((d) => (
            <tr
              key={d.uid}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-jurex text-white text-xs font-bold flex items-center justify-center">
                    {(d.nome || d.email || "?")
                      .trim()
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((s) => s[0]?.toUpperCase() || "")
                      .join("") || "?"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {d.nome || "—"}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3.5 text-xs text-slate-600 dark:text-slate-300">
                <p className="flex items-center gap-1 truncate">
                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{d.email || "—"}</span>
                </p>
                {d.telefone && (
                  <p className="flex items-center gap-1 mt-0.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    {d.telefone}
                  </p>
                )}
              </td>
              <td className="px-3 py-3.5 text-xs text-slate-600 dark:text-slate-300">
                <p className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  {fmtData(d.criadoEm)}
                </p>
              </td>
              <td className="px-3 py-3.5 text-right tabular-nums">
                {d.contFuncionarios}
              </td>
              <td className="px-3 py-3.5 text-right tabular-nums">
                {d.contContratos}
              </td>
              <td className="px-5 py-3.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-[180px]">
                {d.uid}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListaFuncionarios({ funcionarios }) {
  if (funcionarios.length === 0) {
    return <EstadoVazio mensagem="Nenhum funcionário cadastrado ainda." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60">
            <th className="text-left font-bold px-5 py-3">Funcionário</th>
            <th className="text-left font-bold px-3 py-3">E-mail</th>
            <th className="text-left font-bold px-3 py-3">Vinculado a</th>
            <th className="text-left font-bold px-5 py-3">Auth UID</th>
          </tr>
        </thead>
        <tbody>
          {funcionarios.map((f) => (
            <tr
              key={f.authUid}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              <td className="px-5 py-3.5 text-sm font-bold text-slate-900 dark:text-white">
                {f.nome || "—"}
              </td>
              <td className="px-3 py-3.5 text-xs text-slate-600 dark:text-slate-300 truncate max-w-[200px]">
                {f.email || "—"}
              </td>
              <td className="px-3 py-3.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                {f.ownerUid || "—"}
              </td>
              <td className="px-5 py-3.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                {f.authUid}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EstadoVazio({ mensagem }) {
  return (
    <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
      {mensagem}
    </div>
  );
}
