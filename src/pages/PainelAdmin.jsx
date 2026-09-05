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
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";
import DonoGerenciarDrawer from "../components/DonoGerenciarDrawer";
import DonoExcluirDefinitivoModal from "../components/DonoExcluirDefinitivoModal";
import { useAuth } from "../context/useAuth";
import { ADMIN_UID, isAdminUid } from "../config/adminConfig";
import { buscarOverview, salvarDono } from "../services/adminService";

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

// Card de total (Donos / Funcionários / Clientes / Contratos).
// Composição igual em qualquer largura: ícone arredondado à esquerda,
// label UPPERCASE + número grande à direita. No mobile, o ícone e o
// número são proporcionados para preencher o card (referência).
function CardTotal({ icone: Icone, rotulo, valor, cor = "jurex" }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span
          className={`shrink-0 w-12 h-12 sm:w-10 sm:h-10 rounded-xl bg-${cor}-50 dark:bg-${cor}-500/10 ring-1 ring-${cor}-100 dark:ring-${cor}-500/20 flex items-center justify-center`}
        >
          <Icone className={`w-6 h-6 sm:w-5 sm:h-5 text-${cor}-500`} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {rotulo}
          </p>
          <p className="text-2xl sm:text-2xl font-bold text-slate-900 dark:text-white tabular-nums leading-tight">
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
  const [erro, setErro] = useState(null);
  const [aba, setAba] = useState("dono");
  // Versão incremental: cada vez que "atualizar" muda, refaz o fetch.
  const [tick, setTick] = useState(0);
  // Dono selecionado para edição no drawer.
  const [donoSelecionado, setDonoSelecionado] = useState(null);
  const [erroDrawer, setErroDrawer] = useState(null);
  // Dono selecionado para exclusão definitiva (modal).
  const [donoExcluir, setDonoExcluir] = useState(null);
  // Toast de sucesso após exclusão (auto-dismiss simples).
  const [sucessoExcluir, setSucessoExcluir] = useState(null);

  useEffect(() => {
    let cancelado = false;
    buscarOverview().then((resp) => {
      if (cancelado) return;
      setLoading(false);
      if (!resp || !resp.ok) {
        setErro(resp || { ok: false, erro: "Não foi possível carregar o painel." });
        return;
      }
      setDados(resp);
      setErro(null);
    });
    return () => {
      cancelado = true;
    };
  }, [tick]);

  function carregar() {
    setErro(null);
    setLoading(true);
    setTick((t) => t + 1);
  }

  function abrirGerenciar(dono) {
    setErroDrawer(null);
    setDonoSelecionado(dono);
  }

  function fecharGerenciar() {
    setDonoSelecionado(null);
    setErroDrawer(null);
  }

  function abrirExcluirDono(dono) {
    setDonoExcluir(dono);
  }

  function fecharExcluirDono() {
    setDonoExcluir(null);
  }

  // Chamado pelo DonoExcluirDefinitivoModal após sucesso do backend.
  // Fecha o modal, recarrega o overview e mostra toast verde.
  function handleDonoExcluidoSucesso() {
    setDonoExcluir(null);
    setSucessoExcluir("Dono excluído com sucesso.");
    carregar();
  }

  // Persiste as alterações do drawer. Devolve { ok, erro? } para o
  // drawer saber se fecha ou exibe a mensagem de erro.
  async function handleSalvarDono(donoUid, payload) {
    setErroDrawer(null);
    const resp = await salvarDono(donoUid, payload);
    if (resp && resp.ok) {
      // Recarrega overview para refletir valores atualizados.
      carregar();
      return { ok: true };
    }
    setErroDrawer(resp || { ok: false, erro: "Falha ao salvar." });
    return { ok: false, erro: resp?.erro || "Falha ao salvar." };
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
        {/* Cabeçalho — hierarquia em 3 linhas no mobile, mesma composição
            no desktop. Sem flex-wrap: o botão "Atualizar" permanece
            à direita com shrink-0 em qualquer largura. */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-4 sm:px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <BackButton />
              <HomeButton />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-jurex shrink-0" />
                  <h1 className="text-base sm:text-xl font-bold text-slate-900 dark:text-white truncate">
                    Painel Administrativo
                  </h1>
                </div>
                <p className="mt-0.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                  Visão geral do sistema
                </p>
                <p className="mt-0.5 text-[10px] sm:text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate">
                  UID: {ADMIN_UID}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={carregar}
              disabled={loading}
              className="shrink-0 h-10 px-3.5 sm:px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden xs:inline sm:inline">Atualizar</span>
            </button>
          </div>
        </div>

        {/* Erro */}
        {erro && (
          <div className="rounded-2xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300 space-y-2">
            <p className="font-bold flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Não foi possível carregar o painel
            </p>
            <p>{erro.erro || "Erro desconhecido."}</p>
            {(erro.status || erro.contentType || erro.trecho) && (
              <div className="text-[11px] font-mono bg-red-100/60 dark:bg-red-950/40 rounded-lg p-2 space-y-1">
                {erro.status && <p>Status HTTP: {erro.status}</p>}
                {erro.contentType && <p>Content-Type: {erro.contentType}</p>}
                {erro.trecho && (
                  <p className="break-all">
                    Trecho: <span className="opacity-80">{erro.trecho}</span>
                  </p>
                )}
              </div>
            )}
            <p className="text-[11px] opacity-80">
              Se o status for 500 e a mensagem citar <span className="font-mono">ADMIN_UID</span>,
              adicione a variável de ambiente <span className="font-mono">ADMIN_UID</span> com o
              valor <span className="font-mono">hzfrWIuTXYgeasOTPD7pmKNxt1P2</span> no painel da
              Vercel (Production, Preview e Development) e faça um novo deploy.
            </p>
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

            {/* Resumo do sistema — header com ícone maior no mobile */}
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <Activity className="w-5 h-5 text-jurex" />
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
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
                <ListaDonos
                  donos={dados?.donos || []}
                  aoGerenciar={abrirGerenciar}
                  aoExcluir={abrirExcluirDono}
                />
              ) : (
                <ListaFuncionarios funcionarios={dados?.funcionarios || []} />
              )}
            </section>
          </>
        )}
      </div>

      {/* Drawer de gerenciamento de dono (status, limites, permissoes).
          A `key` faz o React remontar o componente quando o `dono` muda,
          o que aciona o lazy initializer do estado interno. */}
      <DonoGerenciarDrawer
        key={donoSelecionado?.uid || "vazio"}
        aberto={!!donoSelecionado}
        dono={donoSelecionado}
        onFechar={fecharGerenciar}
        onSalvar={handleSalvarDono}
      />

      {/* Erro do drawer (toast simples) */}
      {erroDrawer && (
        <div className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-xl border border-red-200 dark:border-red-500/30 bg-white dark:bg-slate-900 shadow-xl p-3 text-xs text-red-700 dark:text-red-300">
          {erroDrawer.erro || "Falha ao salvar."}
        </div>
      )}

      {/* Modal de exclusão definitiva do dono.
          A `key` faz o React remontar o componente quando o `dono` muda,
          resetando o estado interno (campo de confirmação, erro). */}
      <DonoExcluirDefinitivoModal
        key={donoExcluir?.uid || "vazio"}
        aberto={!!donoExcluir}
        dono={donoExcluir}
        aoFechar={fecharExcluirDono}
        aoSucesso={handleDonoExcluidoSucesso}
      />

      {/* Toast de sucesso após exclusão (verde) */}
      {sucessoExcluir && (
        <div className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-white dark:bg-slate-900 shadow-xl p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSucessoExcluir(null)}
            aria-label="Fechar notificação"
            className="shrink-0 rounded-md p-0.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition"
          >
            <span aria-hidden>×</span>
          </button>
          <span className="flex-1">{sucessoExcluir}</span>
        </div>
      )}
    </AppLayout>
  );
}

function ListaDonos({ donos, aoGerenciar, aoExcluir }) {
  if (donos.length === 0) {
    return <EstadoVazio mensagem="Nenhum dono cadastrado ainda." />;
  }
  return (
    <>
      {/* Mobile: cards empilhados (referência). Desktop: tabela. */}
      <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
        {donos.map((d) => (
          <CardDono
            key={d.uid}
            dono={d}
            aoGerenciar={aoGerenciar}
            aoExcluir={aoExcluir}
          />
        ))}
      </div>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60">
              <th className="text-left font-bold px-5 py-3">Dono</th>
              <th className="text-left font-bold px-3 py-3">Contato</th>
              <th className="text-left font-bold px-3 py-3">Cadastro</th>
              <th className="text-center font-bold px-3 py-3">Status</th>
              <th className="text-center font-bold px-3 py-3">Plano</th>
              <th className="text-right font-bold px-3 py-3">Uso</th>
              <th className="text-right font-bold px-5 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {donos.map((d) => (
              <LinhaDono
                key={d.uid}
                dono={d}
                aoGerenciar={aoGerenciar}
                aoExcluir={aoExcluir}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Card mobile de DONO — composição fiel à imagem de referência:
//   [Avatar] [Nome + UID]   | [Status + Plano] | [C/Ct/F] | [⚙ 🗑]
//   linha inferior: [📧 email] [📞 telefone] [📅 data]
// Reaproveita `BadgePlano`, `ResumoUso`, `fmtData` e os ícones
// já importados — zero lógica duplicada.
function CardDono({ dono, aoGerenciar, aoExcluir }) {
  const bloqueado = dono.status === "bloqueado";
  return (
    <div className="p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <span className="w-11 h-11 rounded-xl bg-jurex text-white text-sm font-bold flex items-center justify-center shrink-0">
          {(dono.nome || dono.email || "?")
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((s) => s[0]?.toUpperCase() || "")
            .join("") || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
            {dono.nome || "—"}
          </p>
          <p className="text-[10px] font-mono text-slate-400 truncate">
            {dono.uid}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Mail className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[140px]">
                {dono.email || "—"}
              </span>
            </span>
            {dono.telefone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="w-3 h-3 shrink-0" />
                {dono.telefone}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3 shrink-0" />
              {fmtData(dono.criadoEm)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
            bloqueado
              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300"
              : "bg-emerald-50 text-jurex dark:bg-emerald-500/10 dark:text-emerald-400"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              bloqueado ? "bg-red-500" : "bg-jurex"
            }`}
          />
          {bloqueado ? "Bloqueado" : "Ativo"}
        </span>
        <BadgePlano plano={dono.plano} vigencia={dono.vigencia} />
      </div>

      <div className="flex items-end justify-between gap-3">
        <ResumoUso dono={dono} />
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => aoGerenciar?.(dono)}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-jurex hover:text-jurex transition"
            aria-label={`Gerenciar dono ${dono.nome || dono.uid}`}
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => aoExcluir?.(dono)}
            aria-label={`Excluir dono ${dono.nome || dono.uid}`}
            title="Excluir dono"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:border-red-300 hover:text-red-600 dark:hover:border-red-500/40 dark:hover:text-red-400 transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function LinhaDono({ dono, aoGerenciar, aoExcluir }) {
  const bloqueado = dono.status === "bloqueado";
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-jurex text-white text-xs font-bold flex items-center justify-center shrink-0">
            {(dono.nome || dono.email || "?")
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase() || "")
              .join("") || "?"}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {dono.nome || "—"}
            </p>
            <p className="text-[10px] font-mono text-slate-400 truncate">
              {dono.uid}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3.5 text-xs text-slate-600 dark:text-slate-300">
        <p className="flex items-center gap-1 truncate">
          <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate">{dono.email || "—"}</span>
        </p>
        {dono.telefone && (
          <p className="flex items-center gap-1 mt-0.5">
            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {dono.telefone}
          </p>
        )}
      </td>
      <td className="px-3 py-3.5 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
        <p className="flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5 text-slate-400" />
          {fmtData(dono.criadoEm)}
        </p>
      </td>
      <td className="px-3 py-3.5 text-center">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
            bloqueado
              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300"
              : "bg-emerald-50 text-jurex dark:bg-emerald-500/10 dark:text-emerald-400"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              bloqueado ? "bg-red-500" : "bg-jurex"
            }`}
          />
          {bloqueado ? "Bloqueado" : "Ativo"}
        </span>
      </td>
      <td className="px-3 py-3.5 text-center">
        <BadgePlano plano={dono.plano} vigencia={dono.vigencia} />
      </td>
      <td className="px-3 py-3.5 text-right">
        <ResumoUso dono={dono} />
      </td>
      <td className="px-5 py-3.5 text-right">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => aoGerenciar?.(dono)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-200 hover:border-jurex hover:text-jurex transition"
          >
            <Settings className="w-3.5 h-3.5" />
            Gerenciar
          </button>
          <button
            type="button"
            onClick={() => aoExcluir?.(dono)}
            aria-label={`Excluir dono ${dono.nome || dono.uid}`}
            title="Excluir dono"
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:border-red-300 hover:text-red-600 dark:hover:border-red-500/40 dark:hover:text-red-400 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// Mostra "X / Y" para cada recurso. Reutiliza o MESMO `dono.plano`
// que a coluna PLANO usa (BadgePlano) — única fonte de verdade.
//   - PRO: exibe "∞" (compacto, cabe bem na tabela) e o valor real
//     usado continua sendo mostrado (não vira infinito).
//   - FREE: exibe o limite FREE salvo no Firestore, sem alteração.
//   - limite <= 0 (legado = "sem limite") também mostra "∞" para não
//     exibir 0/0 confuso.
// Os limites FREE nunca são apagados pelo overview: `normalizarPlano`
// em api/admin/overview.js só troca o rótulo do plano, e os campos
// `limites.contratos/clientes/funcionarios` retornam exatamente o
// que está persistido no Firebase. Trocar FREE↔PRO no Gerenciar
// chama `carregar()` (handleSalvarDono) → o próximo snapshot
// traz `dono.plano` e `dono.limites` atualizados, e a tabela
// re-renderiza imediatamente.
function ResumoUso({ dono }) {
  const lim = dono.limites || {};
  // Compat: se a vigência ainda não chegou (overview antigo), usa
  // `dono.plano` como fallback. Com a vigência nova, usamos o
  // PLANO EFETIVO (que respeita `planVigencia` e o relógio).
  const ehPro = dono.vigencia
    ? dono.vigencia.efetivo === "pro"
    : dono.plano === "pro";
  const itens = [
    { rotulo: "C", valor: dono.contContratos, limite: lim.contratos },
    { rotulo: "Cl", valor: dono.contClientes, limite: lim.clientes },
    { rotulo: "F", valor: dono.contFuncionarios, limite: lim.funcionarios },
  ];
  return (
    <div className="inline-flex flex-col items-end gap-0.5 tabular-nums">
      {itens.map((it) => {
        const semLimite = ehPro || !it.limite || it.limite <= 0;
        return (
          <span
            key={it.rotulo}
            className="text-[11px] text-slate-600 dark:text-slate-300"
          >
            <span className="font-bold text-slate-900 dark:text-white">
              {it.rotulo}
            </span>
            {": "}
            {it.valor} /{" "}
            {semLimite ? (
              <span className="font-bold text-jurex dark:text-emerald-400">
                ∞
              </span>
            ) : (
              it.limite
            )}
          </span>
        );
      })}
    </div>
  );
}

// Formata ISO string em "dd/MM/yyyy" usando componentes locais
// (sem UTC). Faz parse local explícito para evitar drift de timezone.
function fmtDataLocal(iso) {
  if (!iso || typeof iso !== "string") return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Badge do plano na tabela. FREE = discreto, PRO = destacado.
// Com vigência:
//   - configurado=pro + status=ativo    → "PRO" + "Até dd/MM/yyyy"
//   - configurado=pro + status=agendado → "PRO" + "Inicia em dd/MM/yyyy"
//   - configurado=pro + status=expirado → "FREE" (regra do briefing)
//   - efetivo=free (qualquer caso)      → "FREE" sem data
//   - configurado=free                  → "FREE" sem data
// Compat: se `vigencia` não veio, usa o `plano` legado.
function BadgePlano({ plano, vigencia }) {
  const v = vigencia || null;
  const configuradoPro = v ? v.configurado === "pro" : plano === "pro";
  const efetivoPro = v ? v.efetivo === "pro" : plano === "pro";

  if (configuradoPro && v && v.status === "ativo") {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-jurex text-white shadow-sm shadow-jurex/30">
          <Sparkles className="w-3 h-3" strokeWidth={2.5} />
          PRO
        </span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          Até {fmtDataLocal(v.fim)}
        </span>
      </span>
    );
  }
  if (configuradoPro && v && v.status === "agendado") {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-jurex text-white shadow-sm shadow-jurex/30">
          <Sparkles className="w-3 h-3" strokeWidth={2.5} />
          PRO
        </span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400">
          Inicia em {fmtDataLocal(v.inicio)}
        </span>
      </span>
    );
  }
  if (configuradoPro && (efetivoPro === false || (v && v.status === "expirado"))) {
    // Pro expirado (ou admin configurou Free): aparece como FREE,
    // sem mostrar a data — a regra do briefing disse que o Pro
    // expirado deve aparecer como FREE na tabela.
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
        FREE
      </span>
    );
  }
  if (configuradoPro && efetivoPro) {
    // Pro sem vigência configurada (dono antigo): só "PRO".
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-jurex text-white shadow-sm shadow-jurex/30">
        <Sparkles className="w-3 h-3" strokeWidth={2.5} />
        PRO
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
      FREE
    </span>
  );
}

function ListaFuncionarios({ funcionarios }) {
  if (funcionarios.length === 0) {
    return <EstadoVazio mensagem="Nenhum funcionário cadastrado ainda." />;
  }
  return (
    <>
      {/* Mobile: cards empilhados. Desktop: tabela. */}
      <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
        {funcionarios.map((f) => (
          <CardFuncionario key={f.authUid} funcionario={f} />
        ))}
      </div>
      <div className="hidden md:block overflow-x-auto">
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
    </>
  );
}

// Card mobile de FUNCIONÁRIO. Espelha `LinhaDono` em formato
// empilhado. Reaproveita os ícones já importados.
function CardFuncionario({ funcionario: f }) {
  return (
    <div className="p-4 sm:p-5 flex items-start gap-3">
      <span className="w-11 h-11 rounded-xl bg-blue-500 text-white text-sm font-bold flex items-center justify-center shrink-0">
        {(f.nome || f.email || "?")
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((s) => s[0]?.toUpperCase() || "")
          .join("") || "?"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
          {f.nome || "—"}
        </p>
        <p className="text-[10px] font-mono text-slate-400 truncate">
          {f.authUid}
        </p>
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 min-w-0">
          <Mail className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[180px]">{f.email || "—"}</span>
        </p>
        <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono text-slate-500">
          <span className="text-slate-400">Vinculado a:</span>
          <span className="truncate max-w-[180px]">{f.ownerUid || "—"}</span>
        </p>
      </div>
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
