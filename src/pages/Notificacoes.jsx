import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Check,
  CircleCheck,
  Clock,
  FileText,
  Home,
  TrendingUp,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import { useNotificacoes } from "../hooks/useNotificacoes";

// Mapeamento: tipo de notificação → ícone + cor do container.
// Mantém o mesmo padrão visual dos cards do Dashboard/Parcelas.
const ICONES_POR_TIPO = {
  contrato_criado: { Icone: FileText, classe: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" },
  parcela_vencendo: { Icone: Clock, classe: "bg-amber-50 text-amber-600 dark:bg-amber-500/10" },
  parcela_atrasada: { Icone: AlertTriangle, classe: "bg-red-50 text-red-600 dark:bg-red-500/10" },
  pagamento_recebido: { Icone: CircleCheck, classe: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" },
  resumo_contratos: { Icone: TrendingUp, classe: "bg-sky-50 text-sky-600 dark:bg-sky-500/10" },
  parcelas_para_receber_hoje: { Icone: Clock, classe: "bg-sky-50 text-sky-600 dark:bg-sky-500/10" },
};

const ICONE_PADRAO = { Icone: Bell, classe: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };

// Formata um Date como tempo relativo em pt-BR: "agora", "há 5 min",
// "há 2 h", "ontem", "há 3 dias", ou dd/mm se > 7 dias.
function formatarDataRelativa(data) {
  if (!data) return "";
  const agora = new Date();
  const diffMs = agora.getTime() - data.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffH = Math.round(diffMs / 3600000);
  const diffDia = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;
  if (diffH < 24) return `há ${diffH} h`;
  if (diffDia === 1) return "ontem";
  if (diffDia < 7) return `há ${diffDia} dias`;
  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function Notificacoes() {
  const navigate = useNavigate();
  const {
    notificacoes,
    naoLidas,
    carregando,
    marcarComoLida,
    marcarTodasComoLidas,
  } = useNotificacoes();

  const [filtro, setFiltro] = useState("todas"); // "todas" | "nao-lidas"

  const listaFiltrada = useMemo(() => {
    if (filtro === "nao-lidas") return notificacoes.filter((n) => !n.lida);
    return notificacoes;
  }, [notificacoes, filtro]);

  function handleClickCard(n) {
    if (!n.lida) marcarComoLida(n.id);
    if (n.contratoId) navigate(`/emprestimos/${n.contratoId}`);
  }

  function handleMarcarTodas() {
    if (naoLidas === 0) return;
    marcarTodasComoLidas();
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Cabeçalho — mesmo padrão verde claro do Perfil/Dashboard */}
        <div className="rounded-2xl border border-emerald-100 dark:border-emerald-500/20 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-slate-900 px-5 py-4">
          <div className="flex items-center gap-4">
            <BackButton />
            <button
              type="button"
              aria-label="Início"
              onClick={() => navigate("/dashboard")}
              className="rounded-full p-2 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <Home className="w-4.5 h-4.5 text-slate-600 dark:text-slate-300" />
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Notificações
            </h1>
            {naoLidas > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-emerald-500 text-white text-xs font-bold">
                {naoLidas}
              </span>
            )}
          </div>
        </div>

        {/* Filtros */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {[
              { key: "todas", label: "Todas" },
              { key: "nao-lidas", label: "Não lidas" },
            ].map((f) => {
              const ativo = filtro === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFiltro(f.key)}
                  className={`h-10 px-4 rounded-full text-sm font-bold transition ${
                    ativo
                      ? "bg-emerald-500 text-white shadow"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleMarcarTodas}
            disabled={naoLidas === 0}
            className="text-sm font-bold text-jurex hover:text-jurex-dark disabled:text-slate-400 disabled:cursor-not-allowed transition"
          >
            Marcar todas
          </button>
        </div>

        {/* Lista */}
        <div className="mt-5 space-y-3 pb-10">
          {carregando ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Carregando...
            </div>
          ) : listaFiltrada.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center">
              <span className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 mb-3">
                <Bell className="w-6 h-6 text-slate-400" />
              </span>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Nenhuma notificação no momento.
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {filtro === "nao-lidas"
                  ? "Você não tem notificações não lidas."
                  : "Eventos como novos contratos e pagamentos aparecerão aqui."}
              </p>
            </div>
          ) : (
            listaFiltrada.map((n) => (
              <NotificacaoCard key={n.id} n={n} onClick={() => handleClickCard(n)} />
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function NotificacaoCard({ n, onClick }) {
  const { Icone, classe } = ICONES_POR_TIPO[n.tipo] || ICONE_PADRAO;
  const naoLida = !n.lida;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition ${
        naoLida
          ? "bg-emerald-50/60 dark:bg-emerald-500/5 border-emerald-200/70 dark:border-emerald-500/20"
          : "bg-white dark:bg-slate-900"
      } hover:border-jurex/40 hover:shadow-md`}
    >
      <div className="flex items-start gap-3 p-4">
        <span
          className={`shrink-0 inline-flex w-10 h-10 items-center justify-center rounded-xl ${classe}`}
        >
          <Icone className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={`text-sm leading-snug ${
                naoLida
                  ? "font-extrabold text-slate-900 dark:text-white"
                  : "font-bold text-slate-700 dark:text-slate-200"
              }`}
            >
              {n.titulo}
            </p>
            {naoLida && (
              <span
                aria-label="Não lida"
                className="shrink-0 mt-1 inline-block w-2 h-2 rounded-full bg-emerald-500"
              />
            )}
            {n.lida && (
              <span className="shrink-0 mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase">
                <Check className="w-3 h-3" />
                Lida
              </span>
            )}
          </div>
          {n.descricao && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
              {n.descricao}
            </p>
          )}
          <p className="mt-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            {formatarDataRelativa(n.criadaEm)}
          </p>
        </div>
      </div>
    </button>
  );
}
