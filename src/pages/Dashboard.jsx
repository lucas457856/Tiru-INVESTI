// Dashboard (tela "Início")
// --------------------------------------------------------------------
// Reaproveita ao máximo o que já existe no projeto:
//   - useAuth → usuário Firebase Auth (uid, displayName)
//   - Firestore collection `usuarios/{uid}/contratos` (onSnapshot em tempo real)
//   - Subcoleção `usuarios/{uid}/contratos/{cid}/pagamentos` — fonte de
//     verdade do que foi efetivamente recebido (mantida por processarPagamento)
//   - contractService.parcelasDoContrato() — cronograma real com overrides e
//     abatimentos aplicados (não recalculamos nada aqui).
//   - paymentCalculations.calculateDebtRemaining() — saldo principal
//   - formatadores.formatarMoeda() — R$ 1.000,00 (Intl pt-BR)
//
// Nenhum valor é hardcoded. Os números exibidos vêm das regras financeiras
// já implementadas no resto do sistema (Emprestimos, EmprestimoDetalhes,
// ReceberPagamento, Relatorios).
import { useEffect, useMemo, useState } from "react";
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
import { collection, getDocs, onSnapshot, query } from "firebase/firestore";
import { db } from "../services/firebase";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/useAuth";
import {
  parcelasDoContrato,
} from "../services/contractService";
import {
  calculateDebtRemaining,
  calcularStatusContrato,
} from "../services/paymentCalculations";
import {
  formatarMoeda,
  formatarData,
  numeroCurto,
} from "../utils/formatadores";
import {
  solicitarPermissaoNotificacoes,
  urlConfiguracoesNotificacoes,
} from "../utils/notifications";
import { useNotificacoes } from "../hooks/useNotificacoes";
import { useNotificadorVencimentos } from "../hooks/useNotificadorVencimentos";

// Data local de hoje (YYYY-MM-DD) — usada para "Parcelas de hoje".
// Construída a partir dos componentes locais para evitar drift de timezone
// que `toISOString()` causaria no fuso brasileiro.
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DATA_HOJE = hojeISO();

// Limite de contratos mostrados na Home (não limita a busca).
const LIMITE_CONTRATOS_HOME = 5;

// Status real do contrato a partir da PRÓXIMA PARCELA NÃO PAGA
// (reaproveita `calcularStatusContrato` — fonte única de verdade).
function statusContrato(c, hoje) {
  return calcularStatusContrato(c, hoje);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { usuario } = useAuth();

  // ---- Estados de UI / dados
  const [contratos, setContratos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [ocultarValores, setOcultarValores] = useState(false);
  const [notifSuportada, setNotifSuportada] = useState(false);
  const [notifPermissao, setNotifPermissao] = useState(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default"
  );
  // State mantido pelo useEffect que fecha modais ao virar "granted".
  // O fluxo de `denied` no `ativarNotificacoes` agora abre DIRETO o
  // modal de orientação, então este state permanece `false` na prática.
  const [mostrarConfirmacaoNotif, setMostrarConfirmacaoNotif] = useState(false);
  const [mostrarOrientacaoNotif, setMostrarOrientacaoNotif] = useState(false);
  // Mensagem inline mostrada no modal de orientação quando o
  // `window.open` falha (a maioria dos browsers bloqueia `chrome://...`
  // aberto a partir de páginas web). Orienta o usuário a usar o
  // cadeado/câmera ao lado da URL.
  const [mensagemOrientacao, setMensagemOrientacao] = useState("");
  // Lista de notificações do app + contador de não lidas. Fonte única
  // consumida também pela página /notificacoes (sino ↔ lista em sync).
  const { naoLidas } = useNotificacoes();

  // Detecta suporte à Notification API (sem push — só permissão local do
  // browser) e re-detecta a permissão quando o usuário RETORNA à aba.
  // Caso ele tenha liberado as notificações nas configurações do navegador
  // após o modal de orientação estar aberto, o Jurex detecta automaticamente
  // ao receber `visibilitychange` (aba voltou a ficar visível) ou `focus`
  // (janela recebeu foco) — sem precisar de F5.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const suportada = "Notification" in window;
    setNotifSuportada(suportada);
    if (!suportada) {
      setNotifPermissao("unsupported");
      return;
    }
    const atualizarPermissao = () => setNotifPermissao(Notification.permission);
    atualizarPermissao();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") atualizarPermissao();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", atualizarPermissao);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", atualizarPermissao);
    };
  }, []);

  // Quando a permissão passa a "granted", fecha automaticamente o modal
  // de orientação/confirmação caso esteja aberto. O card "Ativar
  // notificações" some pela regra `{notifPermissao !== "granted" && ...}`
  // no JSX — não é preciso tocá-lo aqui.
  useEffect(() => {
    if (notifPermissao === "granted") {
      setMostrarConfirmacaoNotif(false);
      setMostrarOrientacaoNotif(false);
      setMensagemOrientacao("");
    }
  }, [notifPermissao]);

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
  // Contratos ATIVOS = não quitados (usado para "A receber" e "Parcelas hoje")
  const contratosAtivos = useMemo(
    () => contratos.filter((c) => !c.quitado),
    [contratos]
  );

  // Detecta parcelas vencendo hoje / atrasadas e dispara a notificação
  // (Firestore + nativa). Roda sempre que `contratosAtivos` muda (incluindo
  // re-emissões do onSnapshot). O dedup (Set em memória + localStorage)
  // garante 1 notificação por evento, mesmo com re-renders / F5 / navegação.
  useNotificadorVencimentos(contratosAtivos, usuario?.uid);

  // ---- Carrega TODOS os pagamentos do usuário (fontes REAIS).
  // Estrutura Firestore: usuarios/{uid}/contratos/{cid}/pagamentos/{pid}.
  // É a fonte de verdade do que foi efetivamente recebido — `c.valorRecebido`
  // é um campo agregado mantido por processarPagamento, mas o histórico
  // imutável de pagamentos está na subcoleção.
  // Itera por contrato (mesmo padrão de Relatorios.jsx e Parcelas.jsx).
  const [pagamentosPorContrato, setPagamentosPorContrato] = useState({});
  useEffect(() => {
    if (!usuario || contratos.length === 0) {
      setPagamentosPorContrato({});
      return undefined;
    }
    let cancelado = false;
    async function carregar() {
      const acc = {};
      await Promise.all(
        contratos.map(async (c) => {
          try {
            const snap = await getDocs(
              collection(db, "usuarios", usuario.uid, "contratos", c.id, "pagamentos")
            );
            acc[c.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          } catch (err) {
            acc[c.id] = [];
          }
        })
      );
      if (!cancelado) setPagamentosPorContrato(acc);
    }
    carregar();
    return () => {
      cancelado = true;
    };
  }, [usuario, contratos]);

  // Total emprestado = soma do valorEmprestado de TODOS os contratos
  // (inclui quitados — o capital foi emprestado e continua contando como
  // saída do caixa, mesmo após quitação). Imutável, definido na criação.
  const totalEmprestado = useMemo(
    () => contratos.reduce((s, c) => s + (Number(c.valorEmprestado) || 0), 0),
    [contratos]
  );

  // Total recebido = soma do valorRecebido de TODOS os pagamentos
  // efetivamente registrados (subcoleção `pagamentos`). Esta é a fonte
  // primária — reflete o histórico imutável de recebimentos. Caso a
  // subcoleção ainda não tenha sido carregada, usa `c.valorRecebido`
  // (campo agregado mantido por processarPagamento) como fallback.
  const totalRecebido = useMemo(() => {
    const temPagamentos = Object.keys(pagamentosPorContrato).length > 0;
    if (temPagamentos) {
      let soma = 0;
      for (const cid of Object.keys(pagamentosPorContrato)) {
        const arr = pagamentosPorContrato[cid] || [];
        for (const p of arr) soma += Number(p.valorRecebido) || 0;
      }
      return soma;
    }
    return contratos.reduce((s, c) => s + (Number(c.valorRecebido) || 0), 0);
  }, [contratos, pagamentosPorContrato]);

  // Total a receber = soma do VALOR DAS PARCELAS AINDA NÃO PAGAS dos
  // contratos ATIVOS (não-quitados). Conceito: quanto dinheiro ainda
  // entrará no caixa, considerando principal + juros das parcelas futuras.
  // NÃO é "saldo de capital" (apenas principal) — é o valor TOTAL futuro.
  //
  // Cálculo: para cada contrato ativo, geramos as parcelas via
  // `parcelasDoContrato` (fonte canônica, com overrides e abatimentos
  // aplicados) e somamos o `valor` daquelas com status !== "Paga".
  // Este valor é INDEPENDENTE do "Parcelas vencendo hoje" — aquele filtra
  // apenas parcelas com vencimento HOJE; este soma TODAS as parcelas
  // em aberto (passadas, hoje e futuras).
  const totalAReceber = useMemo(() => {
    let total = 0;
    for (const c of contratosAtivos) {
      let ps;
      try {
        ps = parcelasDoContrato(c, new Date());
      } catch (err) {
        console.warn("parcelasDoContrato falhou para", c.id, err);
        continue;
      }
      for (const p of ps) {
        if (p.status === "Paga") continue;
        total += Number(p.valor) || 0;
      }
    }
    return total;
  }, [contratosAtivos]);

  // Parcelas que vencem HOJE — derivamos de parcelasDoContrato (a função
  // oficial do sistema, que já aplica overrides e abatimentos) e filtramos
  // por data. Considera APENAS contratos ativos (parcelas ainda em aberto).
  // "Total a receber hoje" = soma do `valor` das parcelas que vencem hoje.
  const { parcelasHoje, totalHoje, totalAtrasadas } = useMemo(() => {
    const lista = [];
    let somaHoje = 0;
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
          const valor = Number(p.valor) || 0;
          lista.push({
            parcelaNumero: p.numero,
            valor,
            contratoId: c.id,
            contratoNome: c.nome ?? c.clienteNome ?? "Contrato",
            clienteId: c.clienteId,
            vencimento: vStr,
          });
          somaHoje += valor;
        }
      }
    }
    return { parcelasHoje: lista, totalHoje: somaHoje, totalAtrasadas: atrasadas };
  }, [contratosAtivos]);

  // Contratos para a seção "Contratos ativos" da Home.
  // REGRA: usa os mesmos contratos da página Contratos (Emprestimos.jsx) —
  // nenhum campo, nenhuma coleção, nenhum cálculo paralelo. Inclui
  // contratos ATIVOS e QUITADOS para que a Home reflita fielmente o
  // que o usuário cadastrou e a tela de referência mostra.
  // Ordenação: criadoEm desc (mais novo primeiro), igual à página Contratos.
  // Limite: 5 cards para não esticar a Home.
  const contratosExibidos = useMemo(() => {
    const ordenados = [...contratos].sort((a, b) => {
      const ta = a.criadoEm?.toMillis?.() ?? new Date(a.criadoEm ?? 0).getTime() ?? 0;
      const tb = b.criadoEm?.toMillis?.() ?? new Date(b.criadoEm ?? 0).getTime() ?? 0;
      return tb - ta;
    });
    return ordenados.slice(0, LIMITE_CONTRATOS_HOME);
  }, [contratos]);

  // Status dinâmico do card "Tudo em dia" / "Existem atrasados".
  // REGRA: olha para as PARCELAS REAIS dos contratos ativos
  // (parcelasDoContrato). Se existir pelo menos uma parcela com
  // vencimento < HOJE e status !== "Paga", o status geral é
  // "X parcela(s) atrasada(s)" com variante "atraso" (badge vermelho).
  // Caso contrário:
  //   - Sem contratos ativos: "Tudo em dia".
  //   - Com contratos em aberto sem parcelas atrasadas: "Tudo em dia".
  const statusGeral = useMemo(() => {
    if (totalAtrasadas > 0) {
      return {
        texto: `${totalAtrasadas} ${totalAtrasadas === 1 ? "parcela atrasada" : "parcelas atrasadas"}`,
        variante: "atraso",
        parcelasAtrasadas: totalAtrasadas,
      };
    }
    return { texto: "Tudo em dia", variante: "ok", parcelasAtrasadas: 0 };
  }, [totalAtrasadas]);

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

  // Ativação de notificações — usa a função centralizada em
  // utils/notifications.js (mesma do botão "Ativar notificações" do Perfil).
  //
  // Comportamento por estado:
  //   - default: chama Notification.requestPermission() DIRETAMENTE no click
  //     (sem await antes, preservando a "transient activation" do Chrome) e
  //     exibe o popup nativo. Atualiza o estado com a decisão do usuário.
  //   - granted: no-op silencioso (o card "Ativar notificações" já não é
  //     renderizado pela guarda `{notifPermissao !== "granted" && ...}`).
  //   - denied: NÃO chamamos requestPermission() (Chrome não exibe o popup
  //     novamente quando a permissão já está bloqueada). Abrimos DIRETO o
  //     modal de orientação com o passo-a-passo para liberar nas configs.
  //   - unsupported: no-op silencioso.
  //
  // IMPORTANTE: o handler é SÍNCRONO (sem await antes de
  // Notification.requestPermission()) para preservar a "transient activation"
  // do Chrome. Se houver qualquer await antes da chamada, o Chrome quebra
  // o user gesture e exibe um aviso interno em vez do popup nativo.
  function ativarNotificacoes(e) {
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    // granted/unsupported: no-op silencioso (o card some quando granted).
    if (notifPermissao === "granted" || notifPermissao === "unsupported") {
      return;
    }
    // denied: NÃO chamamos requestPermission() (Chrome não exibe o popup
    // novamente quando a permissão já está bloqueada). Abrimos DIRETO o
    // modal de orientação com o passo-a-passo para liberar nas configs.
    if (notifPermissao === "denied") {
      setMensagemOrientacao("");
      setMostrarOrientacaoNotif(true);
      return;
    }
    // default: chamada SÍNCRONA no user gesture do click handler para
    // preservar a "transient activation" do Chrome (sem await antes).
    const promise = solicitarPermissaoNotificacoes();
    if (promise && typeof promise.then === "function") {
      promise
        .then((r) => {
          if (
            r === "granted" ||
            r === "denied" ||
            r === "default" ||
            r === "unsupported"
          ) {
            setNotifPermissao(r);
          }
        })
        .catch((err) => {
          console.error("Falha ao solicitar permissão de notificação:", err);
        });
    }
  }

  // Atalhos — usa APENAS rotas existentes (sem criar rota quebrada).
  const atalhos = [
    { label: "Contratos", icone: FileText, to: "/emprestimos" },
    { label: "Parcelas", icone: CircleDollarSign, to: "/parcelas" },
    { label: "Histórico", icone: History, to: "/historico-financeiro" },
    { label: "Suporte", icone: CircleQuestionMark, to: "/suporte" },
  ];

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-8 lg:px-10 py-6">
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

          <div className="relative">
            <button
              type="button"
              aria-label="Notificações"
              onClick={() => navigate("/notificacoes")}
              className="relative rounded-full p-2.5 bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <Bell className="w-5 h-5 text-emerald-600" />
              {naoLidas > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-bold ring-2 ring-white dark:ring-slate-900">
                  {naoLidas > 99 ? "99+" : naoLidas}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Card financeiro */}
        <section
          aria-label="Resumo financeiro"
          className="relative mt-5 overflow-hidden rounded-2xl border border-emerald-100 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/60 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 p-5 sm:p-7 shadow-sm"
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

          {statusGeral.variante === "atraso" ? (
            <Link
              to="/parcelas?filtro=atrasadas"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold bg-red-50 dark:bg-red-500/15 text-red-500 hover:bg-red-100 dark:hover:bg-red-500/25 transition"
              aria-label="Ver parcelas atrasadas"
            >
              <Bell className="w-3.5 h-3.5" />
              {statusGeral.texto}
            </Link>
          ) : (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold bg-jurex/15 text-jurex">
              <CircleCheck className="w-3.5 h-3.5" />
              {statusGeral.texto}
            </span>
          )}

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

        {/* Ativar notificações — visível SOMENTE enquanto a permissão
            ainda não foi concedida. Quando `notifPermissao === "granted"`,
            o card inteiro é removido do layout (sem espaço vazio, sem
            re-render do texto). Para `default` e `denied` (e para
            `notifSuportada === false`), o card continua renderizado com
            título "Ativar notificações" e botão "Ativar" clicável. */}
        {notifPermissao !== "granted" && (
          <section
            onClick={
              notifPermissao === "default" && notifSuportada
                ? ativarNotificacoes
                : undefined
            }
            className={`mt-5 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm transition ${
              notifPermissao === "default" && notifSuportada
                ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
                : ""
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="shrink-0 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-2.5">
                <Bell className="w-5 h-5 text-emerald-600" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Ativar notificações
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  Receba alertas de pagamentos mesmo com o app fechado
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={ativarNotificacoes}
              className="text-sm font-bold transition shrink-0 text-jurex hover:text-jurex-dark"
            >
              Ativar
            </button>
          </section>
        )}

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
                  {parcelasHoje.length} {parcelasHoje.length === 1 ? "parcela" : "parcela(s)"} · {valor(totalHoje)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Total a receber hoje
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
                // Mesmas regras da página Contratos (Emprestimos.jsx):
                //  - statusContrato(): "Em dia" | "Atrasado" | "Quitado"
                //  - pagas: numeroParcelas quando quitado, senão min(parcelasPagas, total)
                //  - saldoPrincipal via calculateDebtRemaining() (já abatido)
                //  - próximo vencimento: c.dataProximo (mantido por processarPagamento)
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);
                const st = statusContrato(c, hoje);
                const total = Number(c.numeroParcelas) || 0;
                const pagas = c.quitado ? total : Math.min(Number(c.parcelasPagas) || 0, total);
                const progresso = total > 0 ? (pagas / total) * 100 : 0;
                const saldoPrincipal = c.quitado ? 0 : calculateDebtRemaining(c);
                const nome = (c.nome ?? "Contrato").toUpperCase();
                // Inicial do cliente para o avatar circular (esquerda).
                // Usa a primeira letra do nome — segue o padrão do avatar
                // da Sidebar. Quando o nome é vazio, cai em "?".
                const inicial = (nome.trim()[0] || "?").toUpperCase();
                return (
                  <Link
                    key={c.id}
                    to={`/emprestimos/${c.id}`}
                    className="block rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm hover:border-jurex/40 hover:shadow-md transition"
                  >
                    {/* Linha topo: avatar + nome/valor + badge de status.
                        Em mobile (sm:hidden) só o avatar + nome + valor;
                        a badge vai para a linha de baixo do progress.
                        Em desktop (sm:flex) layout completo em uma linha. */}
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-emerald-500 text-white text-sm sm:text-base font-extrabold flex items-center justify-center">
                        {inicial}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-bold uppercase text-slate-900 dark:text-white">
                            {nome}
                          </p>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                              st === "Atrasado"
                                ? "bg-red-50 dark:bg-red-500/10 text-red-500"
                                : st === "Quitado"
                                  ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                                  : "bg-emerald-50 dark:bg-emerald-500/10 text-jurex"
                            }`}
                          >
                            {st}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {numeroCurto(c.id)}
                          {c.juros ? ` · ${c.juros}% a.m.` : ""}
                        </p>
                      </div>
                    </div>

                    {/* Valor: em mobile fica em uma linha só ("Saldo: R$X");
                        em desktop pode quebrar em duas (Original / Saldo). */}
                    <div className="mt-3 sm:mt-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Saldo: <span className="text-base sm:text-lg font-extrabold tabular-nums text-jurex">{formatarMoeda(saldoPrincipal)}</span>
                        <span className="hidden sm:inline">
                          {" "}
                          <span className="text-slate-400">·</span>{" "}
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Original {formatarMoeda(c.valorEmprestado)}
                          </span>
                        </span>
                      </p>
                    </div>

                    {/* Progresso do pagamento */}
                    <div className="mt-2.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-jurex transition-all"
                        style={{ width: `${progresso}%` }}
                      />
                    </div>

                    {/* Rodapé: parcelas pagas + próximo vencimento */}
                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>
                        {pagas} de {total} {total === 1 ? "parcela paga" : "parcelas pagas"}
                      </span>
                      <span>
                        {st === "Quitado"
                          ? "Quitado"
                          : c.dataProximo
                            ? `Próx: ${formatarData(c.dataProximo)}`
                            : "Sem vencimento"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Modal de confirmação — caso denied. Como o Chrome não exibe o popup
          nativo novamente, mostramos uma confirmação própria do app antes
          de orientar o usuário a liberar a permissão nas configurações. */}
      {mostrarConfirmacaoNotif && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={() => setMostrarConfirmacaoNotif(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="conf-notif-titulo"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id="conf-notif-titulo"
                className="text-base font-bold text-slate-900 dark:text-white"
              >
                Ativar notificações
              </h2>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setMostrarConfirmacaoNotif(false)}
                className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              As notificações estão bloqueadas. Deseja ativar as notificações?
            </p>
            <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                onClick={() => setMostrarConfirmacaoNotif(false)}
                className="h-11 px-4 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setMostrarConfirmacaoNotif(false);
                  setMostrarOrientacaoNotif(true);
                }}
                className="h-11 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 shadow hover:brightness-105 transition"
              >
                Ativar notificações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de orientação — passo a passo para liberar notificações
          nas configurações do navegador. Não chama requestPermission
          (o Chrome já a tem como denied e não permite resetar). */}
      {mostrarOrientacaoNotif && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={() => setMostrarOrientacaoNotif(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ori-notif-titulo"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id="ori-notif-titulo"
                className="text-base font-bold text-slate-900 dark:text-white"
              >
                Como ativar notificações
              </h2>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setMostrarOrientacaoNotif(false)}
                className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="mt-3 list-decimal pl-5 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <li>
                Abra as configurações do navegador (clique no cadeado/câmera
                ao lado do endereço).
              </li>
              <li>
                Encontre a opção <strong>Notificações</strong> e mude de
                &quot;Bloquear&quot; para &quot;Permitir&quot;.
              </li>
              <li>
                Volte para esta aba — o Jurex detecta a nova permissão
                automaticamente, sem precisar recarregar a página.
              </li>
            </ol>
            {(() => {
              const url = urlConfiguracoesNotificacoes();
              if (!url) {
                // Sem URL conhecida (browser exótico): instrução inline.
                return (
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    Abra as configurações do seu navegador, encontre a opção
                    <strong className="text-slate-700 dark:text-slate-200">
                      {" "}
                      Notificações{" "}
                    </strong>
                    deste site e mude para <em>Permitir</em>. Volte aqui em
                    seguida — o Jurex detecta a mudança automaticamente.
                  </p>
                );
              }
              return (
                <button
                  type="button"
                  onClick={() => {
                    setMensagemOrientacao("");
                    let ref = null;
                    try {
                      ref = window.open(url, "_blank", "noopener,noreferrer");
                    } catch {
                      ref = null;
                    }
                    // `window.open` pode retornar `null` quando o browser
                    // bloqueia a janela (popup blocker) ou quando a URL é
                    // `chrome://`/`about:` que o browser recusa de abrir a
                    // partir de uma página web. Em ambos os casos exibimos
                    // uma instrução inline orientando o cadeado/câmera.
                    if (!ref) {
                      setMensagemOrientacao(
                        "Não foi possível abrir as configurações automaticamente. Use o cadeado/câmera ao lado da barra de endereço para liberar as notificações deste site. O Jurex detecta a mudança automaticamente quando você voltar a esta aba.",
                      );
                      return;
                    }
                    // Tenta detectar fechamento imediato (URL recusada).
                    try {
                      setTimeout(() => {
                        try {
                          if (ref.closed) {
                            setMensagemOrientacao(
                              "Não foi possível abrir as configurações diretamente. Use o cadeado/câmera ao lado da barra de endereço para liberar as notificações deste site. O Jurex detecta a mudança automaticamente quando você voltar a esta aba.",
                            );
                          }
                        } catch {
                          // cross-origin ou já fechado: ignora
                        }
                      }, 600);
                    } catch {
                      // sem suporte a `closed` (raro): ignora
                    }
                  }}
                  className="mt-4 w-full h-11 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 shadow hover:brightness-105 transition"
                >
                  Abrir configurações do navegador
                </button>
              );
            })()}
            {mensagemOrientacao && (
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
                {mensagemOrientacao}
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setMostrarOrientacaoNotif(false)}
                className="h-10 px-4 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
