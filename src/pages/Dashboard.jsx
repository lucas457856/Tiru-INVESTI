// Dashboard (tela "Início")
// --------------------------------------------------------------------
// Reaproveita ao máximo o que já existe no projeto:
//   - useAuth → usuário Firebase Auth (uid, displayName)
//   - Firestore collection `usuarios/{uid}/contratos` (onSnapshot em tempo real)
//   - contractService.parcelasDoContrato() — cronograma real com overrides e
//     abatimentos aplicados (não recalculamos nada aqui).
//   - paymentCalculations.calculateDebtRemaining() — saldo principal
//   - formatadores.formatarMoeda() — R$ 1.000,00 (Intl pt-BR)
//
// Nenhum valor é hardcoded. Os números exibidos vêm das regras financeiras
// já implementadas no resto do sistema (Emprestimos, EmprestimoDetalhes,
// ReceberPagamento, Relatorios).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bell,
  Eye,
  EyeOff,
  CalendarDays,
  TrendingUp,
  FileText,
  CircleDollarSign,
  History,
  CircleQuestionMark,
  CircleCheck,
  X,
} from "lucide-react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "../services/firebase";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/useAuth";
import {
  parcelasDoContrato,
} from "../services/contractService";
import {
  calculateDebtRemaining,
} from "../services/paymentCalculations";
import {
  formatarMoeda,
  formatarData,
  numeroCurto,
} from "../utils/formatadores";

// Data local de hoje (YYYY-MM-DD) — usada para "Parcelas de hoje".
// Construída a partir dos componentes locais para evitar drift de timezone
// que `toISOString()` causaria no fuso brasileiro.
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DATA_HOJE = hojeISO();

// Limite de contratos ativos mostrados na Home (não limita a busca).
const LIMITE_CONTRATOS_HOME = 5;

export default function Dashboard() {
  const navigate = useNavigate();
  const { usuario } = useAuth();

  // ---- Estados de UI / dados
  const [contratos, setContratos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [ocultarValores, setOcultarValores] = useState(false);
  const [mostrarNotificacoes, setMostrarNotificacoes] = useState(false);
  const [notifSuportada, setNotifSuportada] = useState(false);
  const [notifPermissao, setNotifPermissao] = useState(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default"
  );
  const sinoRef = useRef(null);

  // Detecta suporte à Notification API (sem push — só permissão local do browser)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const suportada = "Notification" in window;
    setNotifSuportada(suportada);
    if (suportada) setNotifPermissao(Notification.permission);
  }, []);

  // ---- Carrega contratos do usuário (em tempo real) — mesma collection usada
  // em Emprestimos.jsx; evita listeners duplicados via cleanup do onSnapshot.
  useEffect(() => {
    if (!usuario) return;
    setCarregando(true);
    const unsub = onSnapshot(
      query(collection(db, "usuarios", usuario.uid, "contratos")),
      (snap) => {
        setContratos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setCarregando(false);
      },
      (err) => {
        console.error("Erro ao carregar contratos (Dashboard):", err);
        setCarregando(false);
      }
    );
    return unsub;
  }, [usuario]);

  // ---- Cálculos derivados (todos a partir dos dados reais)
  // Contratos ATIVOS = não quitados
  const contratosAtivos = useMemo(
    () => contratos.filter((c) => !c.quitado),
    [contratos]
  );

  // Total emprestado (soma de valorEmprestado dos contratos ativos)
  const totalEmprestado = useMemo(
    () => contratosAtivos.reduce((s, c) => s + (Number(c.valorEmprestado) || 0), 0),
    [contratosAtivos]
  );

  // Total recebido (soma de valorRecebido de TODOS os contratos, inclusive quitados)
  const totalRecebido = useMemo(
    () => contratos.reduce((s, c) => s + (Number(c.valorRecebido) || 0), 0),
    [contratos]
  );

  // Total a receber (soma de saldoPrincipal dos contratos ativos)
  const totalAReceber = useMemo(
    () =>
      contratosAtivos.reduce((s, c) => s + calculateDebtRemaining(c), 0),
    [contratosAtivos]
  );

  // Parcelas que vencem HOJE — derivamos de parcelasDoContrato (a função oficial
  // do sistema, que já aplica overrides e abatimentos) e filtramos por data.
  // Mantemos um mapa parcela -> contrato (e cliente) para exibir no card.
  const { parcelasHoje, totalVencidasAtrasadas } = useMemo(() => {
    const lista = [];
    let atrasadas = 0;
    for (const c of contratosAtivos) {
      const ps = parcelasDoContrato(c, new Date());
      for (const p of ps) {
        if (p.status === "Paga") continue;
        // vencimento pode ser Date ou "YYYY-MM-DD"
        let vStr = null;
        if (p.vencimento instanceof Date) {
          vStr = `${p.vencimento.getFullYear()}-${String(p.vencimento.getMonth() + 1).padStart(2, "0")}-${String(p.vencimento.getDate()).padStart(2, "0")}`;
        } else if (typeof p.vencimento === "string") {
          vStr = p.vencimento.slice(0, 10);
        }
        if (!vStr) continue;
        if (vStr < DATA_HOJE) atrasadas += 1;
        if (vStr === DATA_HOJE) {
          lista.push({
            parcelaNumero: p.numero,
            valor: Number(p.valor) || 0,
            contratoId: c.id,
            contratoNome: c.nome ?? c.clienteNome ?? "Contrato",
            clienteId: c.clienteId,
            vencimento: vStr,
          });
        }
      }
    }
    return { parcelasHoje: lista, totalVencidasAtrasadas: atrasadas };
  }, [contratosAtivos]);

  // Contratos para a seção "Contratos ativos" — ordenados por criadoEm desc
  // quando disponível, e limitados a LIMITE_CONTRATOS_HOME.
  const contratosExibidos = useMemo(() => {
    const ordenados = [...contratosAtivos].sort((a, b) => {
      const ta = a.criadoEm?.toMillis?.() ?? new Date(a.criadoEm ?? 0).getTime() ?? 0;
      const tb = b.criadoEm?.toMillis?.() ?? new Date(b.criadoEm ?? 0).getTime() ?? 0;
      return tb - ta;
    });
    return ordenados.slice(0, LIMITE_CONTRATOS_HOME);
  }, [contratosAtivos]);

  // Status dinâmico do card "Tudo em dia"
  // Se existem parcelas atrasadas, exibe a quantidade. Senão, "Tudo em dia".
  const statusGeral = useMemo(() => {
    if (contratosAtivos.length === 0) return { texto: "Tudo em dia", variante: "ok" };
    if (totalVencidasAtrasadas > 0) {
      return {
        texto: `${totalVencidasAtrasadas} ${totalVencidasAtrasadas === 1 ? "parcela atrasada" : "parcelas atrasadas"}`,
        variante: "atraso",
      };
    }
    return { texto: "Tudo em dia", variante: "ok" };
  }, [contratosAtivos.length, totalVencidasAtrasadas]);

  // ---- Helpers
  const nomeUsuario = useMemo(() => {
    const dn = usuario?.displayName?.trim();
    if (dn) return dn.toUpperCase();
    if (usuario?.email) return usuario.email.split("@")[0].toUpperCase();
    return "USUÁRIO";
  }, [usuario]);

  function valor(v) {
    return ocultarValores ? "••••••" : formatarMoeda(v);
  }

  // Iniciais do cliente para o avatar (fallback quando não há foto)
  function iniciais(nome) {
    if (!nome) return "?";
    const partes = String(nome).trim().split(/\s+/);
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  // Ativação de notificações — usa Notification API (sem push, sem FCM).
  // Se o navegador não suporta, o botão fica inativo (sem fingir ativação).
  async function ativarNotificacoes() {
    if (!notifSuportada) return;
    try {
      const r = await Notification.requestPermission();
      setNotifPermissao(r);
    } catch (err) {
      console.error("Falha ao solicitar permissão de notificação:", err);
    }
  }

  // Click-outside para o sino de notificações
  useEffect(() => {
    if (!mostrarNotificacoes) return;
    function onDown(e) {
      if (sinoRef.current && !sinoRef.current.contains(e.target)) {
        setMostrarNotificacoes(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [mostrarNotificacoes]);

  // Atalhos — usa APENAS rotas existentes (sem criar rota quebrada).
  const atalhos = [
    { label: "Contratos", icone: FileText, to: "/emprestimos" },
    { label: "Parcelas", icone: CircleDollarSign, to: "/parcelas" },
    { label: "Histórico", icone: History, to: "/historico-financeiro" },
    { label: "Suporte", icone: CircleQuestionMark, to: "/suporte" },
  ];

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 sm:px-8 lg:px-10 py-6">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Olá,</p>
            <h1 className="mt-0.5 text-2xl sm:text-[28px] font-extrabold tracking-tight text-slate-900 dark:text-white">
              {carregando ? "CARREGANDO..." : nomeUsuario}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Bem-vindo(a) ao seu painel
            </p>
          </div>

          <div className="relative" ref={sinoRef}>
            <button
              type="button"
              aria-label="Notificações"
              onClick={() => setMostrarNotificacoes((v) => !v)}
              className="relative rounded-full p-2.5 bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <Bell className="w-5 h-5 text-emerald-600" />
              {/* Badge sempre presente para seguir o design da referência;
                  sem sistema de notificações, mantemos apenas o ícone ativo. */}
            </button>

            {mostrarNotificacoes && (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-30 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    Notificações
                  </p>
                  <button
                    type="button"
                    onClick={() => setMostrarNotificacoes(false)}
                    className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    aria-label="Fechar notificações"
                  >
                    <X className="w-3.5 h-3.5 text-slate-500" />
                  </button>
                </div>
                <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400 text-center">
                  Nenhuma notificação no momento.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Card financeiro */}
        <section
          aria-label="Resumo financeiro"
          className="relative mt-5 overflow-hidden rounded-2xl border border-emerald-100 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/60 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 p-6 sm:p-7 shadow-sm"
        >
          {/* Ondas decorativas (canto superior direito) */}
          <svg
            viewBox="0 0 220 130"
            aria-hidden
            className="pointer-events-none absolute right-10 top-2 h-28 w-56 text-emerald-200/60"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          >
            {[12, 32, 52, 72, 92, 112].map((y) => (
              <path key={y} d={`M0 ${y} q 55 -18 110 0 t 110 0`} />
            ))}
          </svg>

          {/* Botão de ocultar valores */}
          <button
            type="button"
            onClick={() => setOcultarValores((v) => !v)}
            aria-label={ocultarValores ? "Mostrar valores" : "Ocultar valores"}
            className="absolute right-4 top-4 rounded-md p-1.5 text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60 transition"
          >
            {ocultarValores ? (
              <Eye className="w-4.5 h-4.5" />
            ) : (
              <EyeOff className="w-4.5 h-4.5" />
            )}
          </button>

          <p className="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
            Total emprestado
          </p>
          <p className="mt-1 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white tabular-nums">
            {carregando ? "..." : valor(totalEmprestado)}
          </p>

          <span
            className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
              statusGeral.variante === "atraso"
                ? "bg-red-50 dark:bg-red-500/15 text-red-500"
                : "bg-jurex/15 text-jurex"
            }`}
          >
            {statusGeral.variante === "atraso" ? (
              <Bell className="w-3.5 h-3.5" />
            ) : (
              <CircleCheck className="w-3.5 h-3.5" />
            )}
            {statusGeral.texto}
          </span>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 relative">
            <div className="rounded-xl border border-emerald-200/70 dark:border-emerald-500/30 bg-white/70 dark:bg-slate-800/60 p-4">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-jurex uppercase">
                <TrendingUp className="w-4 h-4" />
                Recebido
              </span>
              <p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                {carregando ? "..." : valor(totalRecebido)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-300/70 dark:border-amber-500/30 bg-white/70 dark:bg-slate-800/60 p-4">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-amber-600 uppercase">
                <TrendingUp className="w-4 h-4" />
                A receber
              </span>
              <p className="mt-1 text-xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                {carregando ? "..." : valor(totalAReceber)}
              </p>
            </div>
          </div>
        </section>

        {/* Ativar notificações */}
        <section className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-2.5">
              <Bell className="w-5 h-5 text-emerald-600" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {notifPermissao === "granted"
                  ? "Notificações ativadas"
                  : "Ativar notificações"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Receba alertas de pagamentos mesmo com o app fechado
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={ativarNotificacoes}
            disabled={!notifSuportada || notifPermissao === "granted"}
            className={`text-sm font-bold transition shrink-0 ${
              notifPermissao === "granted" || !notifSuportada
                ? "text-slate-400 cursor-not-allowed"
                : "text-jurex hover:text-jurex-dark"
            }`}
          >
            {notifPermissao === "granted"
              ? "Ativado"
              : !notifSuportada
                ? "Indisponível"
                : "Ativar"}
          </button>
        </section>

        {/* Parcelas de hoje */}
        <Link
          to="/parcelas"
          className="mt-3 flex items-center gap-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm hover:border-jurex/40 transition"
        >
          <span className="shrink-0 rounded-xl bg-slate-100 dark:bg-slate-800 p-2.5">
            <CalendarDays className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          </span>
          <div className="min-w-0 flex-1">
            {carregando ? (
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                Carregando...
              </p>
            ) : parcelasHoje.length === 0 ? (
              <>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Não temos parcelas hoje
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Nenhum vencimento para hoje
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {parcelasHoje.length}{" "}
                  {parcelasHoje.length === 1 ? "parcela vence" : "parcelas vencem"} hoje
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {parcelasHoje
                    .slice(0, 3)
                    .map((p) => `${p.contratoNome} · ${formatarMoeda(p.valor)}`)
                    .join("  ·  ")}
                </p>
              </>
            )}
          </div>
        </Link>

        {/* Acesso rápido */}
        <section className="mt-8">
          <h2 className="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
            Acesso rápido
          </h2>
          <div className="mt-4 grid grid-cols-4 gap-3 sm:gap-6">
            {atalhos.map(({ label, icone: Icone, to }) => (
              <Link
                key={label}
                to={to}
                className="group flex flex-col items-center gap-2"
              >
                <span className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center shadow-sm group-hover:border-jurex/40 group-hover:text-jurex transition">
                  <Icone className="w-5 h-5 sm:w-6 sm:h-6 text-slate-600 dark:text-slate-300 group-hover:text-jurex transition" />
                </span>
                <span className="text-[11px] sm:text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {label}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Contratos ativos */}
        <section className="mt-8 mb-12">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
              Contratos ativos
            </h2>
            <Link
              to="/emprestimos"
              className="text-sm font-semibold text-jurex hover:text-jurex-dark transition"
            >
              Ver todos
            </Link>
          </div>

          {carregando ? (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-28 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
                />
              ))}
            </div>
          ) : contratosExibidos.length === 0 ? (
            <div className="mt-4 flex flex-col items-center text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-10 px-6">
              <span className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 p-3">
                <FileText className="w-6 h-6 text-jurex" />
              </span>
              <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                Nenhum contrato ativo
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                Crie seu primeiro contrato para começar a acompanhar aqui.
              </p>
              <button
                type="button"
                onClick={() => navigate("/contratos/novo")}
                className="mt-4 h-9 px-4 rounded-xl bg-jurex text-white text-xs font-bold hover:bg-jurex-dark transition"
              >
                Criar contrato
              </button>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {contratosExibidos.map((c) => {
                const total = Number(c.numeroParcelas) || 0;
                const pagas = Math.min(Number(c.parcelasPagas) || 0, total);
                const progresso = total > 0 ? (pagas / total) * 100 : 0;
                const nome = c.nome ?? c.clienteNome ?? "Cliente";
                return (
                  <Link
                    key={c.id}
                    to={`/emprestimos/${c.id}`}
                    className="block rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm hover:border-jurex/40 hover:shadow-md transition"
                  >
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm font-extrabold text-slate-700 dark:text-slate-200">
                        {iniciais(nome)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold uppercase text-slate-900 dark:text-white">
                          {nome}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatarMoeda(c.valorEmprestado)} · {total}x
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md p-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-jurex">
                        <FileText className="w-3.5 h-3.5" />
                      </span>
                    </div>

                    <div className="mt-3 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-jurex transition-all"
                        style={{ width: `${progresso}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>
                        {pagas} de {total} {total === 1 ? "parcela paga" : "parcelas pagas"}
                      </span>
                      <span>{numeroCurto(c.id)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
