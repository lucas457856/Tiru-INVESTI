// Página "Relatórios" — visão financeira agregada.
//
// Fontes de dados (todas REAIS, sem mocks):
//   1. usuarios/{uid}/contratos/{id}
//        Campos lidos:
//          - valorEmprestado   → "Emprestado" (soma)
//          - valorRecebido     → "Recebido" (soma) — mantido por processarPagamento
//          - saldoPrincipal    → usado em "Pendente" e no cálculo de Lucro
//          - jurosRecebidos    → "Juros previstos" (acumulado de juros recebidos)
//          - numeroParcelas    → nº de contratos
//          - criadoEm          → "Saída" no gráfico Entrada vs Saída (por mês)
//          - quitado           → filtro "Em aberto"
//          - nomeProduto       → filtro "Vendas" (somente se existir; senão 0)
//
//   2. usuarios/{uid}/contratos/{id}/pagamentos (paymentHistoryService)
//        Campos lidos:
//          - valorRecebido + criadoEm  → "Entrada" do gráfico Entrada vs Saída
//                                        e "Evolução de recebimentos" (por mês)
//
// Regras de cálculo reaproveitadas do projeto:
//   - (sem dependências de paymentCalculations — Pendente agora vem das
//      parcelas, não do saldo principal)
//   - parcelasDoContrato (contractService.js) — cronograma com abatimentos e
//     overrides aplicados (fonte canônica das parcelas exibidas no sistema)
//
// Sem dados mockados, sem valores hardcoded, sem datas fixas.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Wallet,
  TriangleAlert,
  ListChecks,
  CalendarDays,
} from "lucide-react";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import NotificationBellButton from "../components/NotificationBellButton";
import { useAuth } from "../context/useAuth";
import { db } from "../services/firebase";
import {
  parcelasDoContrato,
} from "../services/contractService";
import { formatarMoeda } from "../utils/formatadores";
import {
  janelaPeriodo,
  filtrarPorTipo,
  filtrarPorAba,
  calcularParcelasAReceber,
  calcularTotaisAReceber,
} from "../utils/relatorioAReceber";

const ABAS = ["Todos", "Em aberto"];
const PERIODOS = ["Este mês", "Próximos 30 dias", "Próximos 90 dias", "Personalizado"];
const TIPOS = ["Todos", "Contratos", "Vendas"];
const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// --- Helpers de data LOCAL (sem drift de timezone) ---
function hojeDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Normaliza QUALQUER fonte de data (Firestore Timestamp, ISO string,
// YYYY-MM-DD, Date) para um Date LOCAL válido. Mantida localmente para o
// gráfico Entrada vs Saída (que tem outro consumidor: `grafDataIni/Fim`).
function toValidDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const [y, m, d] = value.slice(0, 10).split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function parseVencimento(v) {
  return toValidDate(v);
}
function tsDoFirestore(t) {
  if (!t) return 0;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (t instanceof Date) return t.getTime();
  if (typeof t === "string") {
    const p = parseVencimento(t);
    return p ? p.getTime() : 0;
  }
  return 0;
}
function formatarMoedaCurta(v) {
  const n = Number(v) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function formatarMoedaSinal(v) {
  const n = Number(v) || 0;
  const m = formatarMoeda(Math.abs(n));
  if (n < 0) return `-${m}`;
  if (n > 0) return `+${m}`;
  return m;
}

// Função `janelaPeriodo` movida para `src/utils/relatorioAReceber.js`
// (fonte única de verdade compartilhada com outras telas que precisem
// da mesma janela de "A receber").

export default function Relatorios() {
  const { usuario } = useAuth();

  // ---- Estados
  const [contratos, setContratos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState("Todos");
  const [periodo, setPeriodo] = useState("Este mês");
  const [tipo, setTipo] = useState("Todos");

  // Período personalizado
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");

  // Filtro do gráfico Entrada vs Saída
  const [graficoFiltro, setGraficoFiltro] = useState("Últimos 6 meses");
  const [grafDataIni, setGrafDataIni] = useState("");
  const [grafDataFim, setGrafDataFim] = useState("");

  // ---- Carrega contratos em tempo real
  useEffect(() => {
    if (!usuario) return undefined;
    setCarregando(true);
    const unsub = onSnapshot(
      collection(db, "usuarios", usuario.uid, "contratos"),
      (snap) => {
        setContratos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setCarregando(false);
      },
      (err) => {
        console.error("Erro ao carregar contratos (Relatórios):", err);
        setCarregando(false);
      }
    );
    return unsub;
  }, [usuario]);

  // ---- Carrega TODOS os pagamentos do usuário (fontes reais).
  // Estrutura Firestore: usuarios/{uid}/contratos/{cid}/pagamentos/{pid}.
  // Sem collectionGroup para evitar regra nova; itera por contrato (mesmo
  // padrão de Parcelas.jsx). Se a subcoleção não existir ou estiver vazia
  // para um contrato, simplesmente pulamos.
  const [pagamentosPorContrato, setPagamentosPorContrato] = useState({});
  useEffect(() => {
    if (!usuario || contratos.length === 0) {
      setPagamentosPorContrato({});
      return undefined;
    }
    let cancelado = false;
    async function carregarPagamentos() {
      const acc = {};
      await Promise.all(
        contratos.map(async (c) => {
          try {
            const snap = await getDocs(
              collection(db, "usuarios", usuario.uid, "contratos", c.id, "pagamentos")
            );
            acc[c.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          } catch (err) {
            // Coleção inexistente ou falha parcial: mantém o contrato sem histórico.
            console.warn(`Sem pagamentos para ${c.id}:`, err?.message);
            acc[c.id] = [];
          }
        })
      );
      if (!cancelado) setPagamentosPorContrato(acc);
    }
    carregarPagamentos();
    return () => {
      cancelado = true;
    };
  }, [usuario, contratos]);

  // ---- Filtros de tipo e aba
  // REGRA DOS FILTROS:
  //   - Filtro de TIPO (Contratos / Vendas / Todos) é GLOBAL: afeta
  //     indicadores financeiros, gráficos, "A receber" e Pendente.
  //     Quando o tipo é "Todos", todos os contratos passam; quando
  //     é "Contratos", exclui vendas; quando é "Vendas", exclui
  //     contratos puros.
  //   - Filtro de ABA (Todos / Em aberto) afeta os 4 cards do topo
  //     (Emprestado, Recebido, Pendente, Lucro) E a seção "A receber".
  //     Quando a aba é "Em aberto", contratos quitados são excluídos
  //     do cálculo. Quando é "Todos", todos os contratos do tipo
  //     selecionado entram.
  //
  // Por quê? "Em aberto" significa "ainda preciso receber/controlar
  // esse contrato". Contratos quitados já estão fechados e saem do
  // escopo dos indicadores e da lista de parcelas em aberto. O
  // gráfico "Entrada vs Saída" continua usando `baseGeral` para
  // preservar o histórico de capital e recebimentos ao longo do
  // tempo (inclui contratos já quitados).
  // REGRAS DE TIPO e ABA agora vivem em `utils/relatorioAReceber.js` —
  // qualquer outra tela (ex.: uma futura "A Receber" dedicada) pode
  // compor a mesma base e exibir números idênticos.
  const baseGeral = useMemo(
    () => filtrarPorTipo(contratos, tipo),
    [contratos, tipo]
  );

  // Lista de contratos em aberto (para os 4 cards do topo E para a seção
  // "A receber"). Combina o filtro de TIPO com a aba "Em aberto".
  //
  // REGRA DO FILTRO DE ABA:
  //   Quando a aba = "Todos"   → `baseEmAberto` === `baseGeral`
  //   Quando a aba = "Em aberto" → `baseEmAberto` exclui contratos quitados.
  //   Os 4 cards do topo (Emprestado, Recebido, Pendente, Lucro) usam
  //   `baseEmAberto` como fonte, então a aba "Em aberto" LIMITA o
  //   escopo dos indicadores financeiros aos contratos ainda abertos.
  //   A seção "A receber" também usa `baseEmAberto` (mesma fonte,
  //   comportamento consistente).
  const baseEmAberto = useMemo(
    () => filtrarPorAba(baseGeral, aba),
    [baseGeral, aba]
  );

  // ---- Soma das parcelas NÃO PAGAS (card "Pendente" do topo)
  // REGRA DO PENDENTE:
  //   PENDENTE = Σ valor das parcelas com status !== "Paga" dos
  //   contratos de `baseEmAberto`. Contratos quitados não contribuem
  //   (todas as parcelas estão "Paga"), então a soma é equivalente à
  //   de "em aberto" mesmo na aba "Todos". Usar `baseEmAberto` (em vez
  //   de `baseGeral`) mantém o card PENDENTE coerente com os demais
  //   cards do topo — todos respondem juntos à aba "Em aberto".
  //
  // Por que somar `parcela.valor` e NÃO `calculateDebtRemaining`?
  //   O card Pendente deve refletir o VALOR REAL que o cliente ainda
  //   deve pagar (cada parcela = principal + juros), não o saldo do
  //   capital sozinho. Ex.: contrato 500+350=850, 2 parcelas de 425,
  //   1ª paga, 2ª em aberto → Pendente = 425 (a 2ª parcela inteira),
  //   e não 250 (capital restante sem juros).
  //
  // Não aplicamos filtro de período aqui — o card topo mostra o TOTAL
  // sempre. O filtro de período só se aplica à seção "A receber" abaixo
  // (que já tem comportamento próprio).
  const pendentePorParcelas = useMemo(() => {
    let total = 0;
    for (const c of baseEmAberto) {
      if (c.quitado) continue; // contrato quitado → todas as parcelas já pagas
      let ps;
      try {
        ps = parcelasDoContrato(c, new Date());
      } catch (err) {
        console.warn("parcelasDoContrato falhou para", c.id, err);
        continue;
      }
      for (const p of ps) {
        if (p.status === "Paga") continue; // "Pendente" + "Vencida" entram
        total += Number(p.valor) || 0;
      }
    }
    return total;
  }, [baseEmAberto]);

  // ---- Cards principais (Emprestado, Recebido, Pendente, Lucro)
  // REGRA DO LUCRO:
  //   LUCRO = TOTAL RECEBIDO − TOTAL EMPRESTADO
  //   aplicado sobre `baseEmAberto` (filtro de TIPO + aba "Em aberto").
  //   Os 4 cards do topo respondem à aba superior:
  //     - aba "Todos"     → `baseEmAberto` === `baseGeral` (todos os
  //                         contratos do tipo selecionado, quitados
  //                         e abertos juntos).
  //     - aba "Em aberto" → `baseEmAberto` exclui os quitados, e os
  //                         4 cards refletem apenas os contratos
  //                         ainda em aberto.
  //
  // O resultado pode ser negativo quando há capital emprestado que ainda
  // não foi recuperado pelos recebimentos (ex.: contrato novo de R$ 500
  // sem pagamentos → Emprestado R$ 500, Recebido R$ 0 → Lucro −R$ 500).
  // O card usa `sinalNegativo` para mostrar o sinal de "−" automaticamente.
  //
  // PENDENTE = soma do `valor` das parcelas não pagas (calculado em
  // `pendentePorParcelas`), independente de filtro de período.
  //
  // FONTE DO RECEBIDO:
  //   O `c.valorRecebido` no documento do contrato é mantido por
  //   `processarPagamento` (incremento). Porém, se o histórico de
  //   pagamentos (subcoleção `pagamentos`) contém registros, usamos
  //   essa fonte como verdade — é o registro imutável do que entrou
  //   no caixa, e reflete todos os pagamentos mesmo que o campo
  //   agregado esteja atrasado ou zerado por algum motivo.
  //   Fallback: `c.valorRecebido` quando não há pagamentos na subcoleção.
  const totais = useMemo(() => {
    let emprestado = 0;
    let recebido = 0;
    for (const c of baseEmAberto) {
      const v = Number(c.valorEmprestado) || 0;
      // Soma real do histórico de pagamentos (fonte de verdade do que entrou)
      const pagamentos = Array.isArray(pagamentosPorContrato[c.id]) ? pagamentosPorContrato[c.id] : [];
      let r = 0;
      if (pagamentos.length > 0) {
        r = pagamentos.reduce(
          (s, p) => s + (Number(p.valorRecebido) || 0),
          0
        );
      } else {
        // Fallback: campo agregado mantido por processarPagamento
        r = Number(c.valorRecebido) || 0;
      }
      emprestado += v;
      recebido += r;
    }
    const pendente = pendentePorParcelas;
    const lucro = recebido - emprestado;
    return {
      emprestado,
      recebido,
      pendente,
      lucro,
    };
  }, [baseEmAberto, pendentePorParcelas, pagamentosPorContrato]);

  // ---- Janela "A receber" e totais do período
  const { inicioPeriodo, fimPeriodo } = useMemo(
    () => janelaPeriodo(periodo, dataIni, dataFim),
    [periodo, dataIni, dataFim]
  );

  // Parcelas reais (via parcelasDoContrato) dos contratos filtrados
  // (apenas "Em aberto" para "A receber" — parcelas pagas não entram).
  //
  // Regra do filtro de período:
  //   - "Este mês"        → parcelas com vencimento dentro do mês atual
  //                         (comparação exata por ano/mês).
  //   - "Próximos 30 dias"→ parcelas com vencimento <= hoje + 30 dias.
  //                         Inclui parcelas ATRASADAS (vencimento < hoje) que
  //                         ainda estão no horizonte curto de cobrança. Sem
  //                         limite inferior no passado: tudo que está vencido
  //                         e ainda dentro do "futuro próximo" entra.
  //   - "Próximos 90 dias"→ parcelas com vencimento <= hoje + 90 dias
  //                         (também inclui atrasadas).
  //   - "Personalizado"   → parcelas com vencimento em [dataIni, dataFim].
  //
  // IMPORTANTE: usa `baseEmAberto` (filtro de TIPO + aba) — o filtro
  // "Em aberto" afeta ESTA lista por design (mostra apenas o que ainda
  // falta receber). Indicadores e gráfico usam `baseGeral`.
  // A função vive em `utils/relatorioAReceber.js` — fonte única de verdade.
  const parcelasAReceber = useMemo(
    () => calcularParcelasAReceber(baseEmAberto, inicioPeriodo, fimPeriodo, periodo),
    [baseEmAberto, inicioPeriodo, fimPeriodo, periodo]
  );

  // ---- Totais do "A receber" (TOTAL, JUROS PREVISTOS, VENCIDO, Nº DE PARCELAS)
  // Regras:
  //   TOTAL A RECEBER  = Σ valor das parcelas dentro do conjunto
  //                       `parcelasAReceber` (filtro de período aplicado).
  //                       Para "Próximos 30/90 dias", isso inclui parcelas
  //                       ATRASADAS e futuras até o limite.
  //   JUROS PREVISTOS  = Σ jurosOriginais das mesmas parcelas.
  //   Nº DE PARCELAS   = count das parcelas do conjunto.
  //   VENCIDO          = Σ valor das parcelas do conjunto com
  //                       vencimento < HOJE. É um subset do total que
  //                       destaca o atraso.
  // Agregação extraída para `utils/relatorioAReceber.js` (fonte única).
  const totaisAReceber = useMemo(
    () => calcularTotaisAReceber(parcelasAReceber),
    [parcelasAReceber]
  );

  // ---- Janela do gráfico "Entrada vs Saída" / "Evolução"
  const janelaGrafico = useMemo(() => {
    if (graficoFiltro === "Período específico" && grafDataIni && grafDataFim) {
      const ini = parseVencimento(grafDataIni);
      const fim = parseVencimento(grafDataFim);
      if (ini && fim && fim >= ini) {
        // Gera um bucket por mês entre ini e fim
        const meses = [];
        let cur = new Date(ini.getFullYear(), ini.getMonth(), 1);
        while (cur <= fim) {
          meses.push({ ano: cur.getFullYear(), mes: cur.getMonth(), label: MESES_ABREV[cur.getMonth()] });
          cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        }
        return meses;
      }
    }
    // Padrão: últimos 6 meses (dinâmico, sem hardcode)
    const hoje = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - 5 + i, 1);
      return { ano: d.getFullYear(), mes: d.getMonth(), label: MESES_ABREV[d.getMonth()] };
    });
  }, [graficoFiltro, grafDataIni, grafDataFim]);

  // Séries reais para os gráficos.
  // Entrada (mês) = Σ valorRecebido dos pagamentos com criadoEm (ou dataRecebimento) naquele mês.
  // Saída (mês)   = Σ valorEmprestado dos contratos com criadoEm naquele mês.
  // Recebido (mês)= igual a Entrada (mantido separado para o segundo gráfico).
  //
  // IMPORTANTE: a Saída usa `baseGeral` (TODOS os contratos do tipo
  // selecionado, incluindo quitados) — o filtro "Em aberto" NÃO afeta
  // o gráfico. Medir "Saída = TOTAL EMPRESTADO" exige incluir todos
  // os contratos, senão contratos quitados somem do histórico.
  const serieGraficos = useMemo(() => {
    // Pré-agrupa pagamentos por (ano, mes) para performance
    const entradaPorMes = new Map();
    for (const cid of Object.keys(pagamentosPorContrato)) {
      for (const p of pagamentosPorContrato[cid]) {
        const ts = tsDoFirestore(p.criadoEm) || tsDoFirestore(p.dataRecebimento);
        if (!ts) continue;
        const d = new Date(ts);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        entradaPorMes.set(key, (entradaPorMes.get(key) || 0) + (Number(p.valorRecebido) || 0));
      }
    }
    return janelaGrafico.map(({ ano, mes, label }) => {
      const key = `${ano}-${mes}`;
      const entrada = entradaPorMes.get(key) || 0;
      const saida = baseGeral.reduce((s, c) => {
        const ts = tsDoFirestore(c.criadoEm);
        if (!ts) return s;
        const d = new Date(ts);
        return d.getFullYear() === ano && d.getMonth() === mes
          ? s + (Number(c.valorEmprestado) || 0)
          : s;
      }, 0);
      return { label, entrada, saida, recebido: entrada };
    });
  }, [baseGeral, pagamentosPorContrato, janelaGrafico]);

  const maxEscala = Math.max(
    1,
    ...serieGraficos.flatMap((p) => [p.entrada, p.saida, p.recebido])
  );

  // --- Tooltip do gráfico Entrada vs Saída
  const [hoverMes, setHoverMes] = useState(null); // índice do mês em hover
  const [hoverX, setHoverX] = useState(0);       // posição X do mouse dentro do contêiner
  const barrasRef = useRef(null);

  function onBarrasMouseMove(e) {
    const el = barrasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHoverX(x);
    // Mapeia a posição X para o bucket do mês (colunas equally spaced)
    const cols = serieGraficos.length || 1;
    const slot = rect.width / cols;
    const idx = Math.max(0, Math.min(cols - 1, Math.floor(x / slot)));
    setHoverMes(idx);
  }
  function onBarrasLeave() {
    setHoverMes(null);
  }

  // --- Tooltip do gráfico "Evolução de recebimentos"
  const [hoverMesLinha, setHoverMesLinha] = useState(null);
  const linhaRef = useRef(null);
  function onLinhaMouseMove(e) {
    const el = linhaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const cols = serieGraficos.length || 1;
    const slot = rect.width / cols;
    const idx = Math.max(0, Math.min(cols - 1, Math.floor(x / slot)));
    setHoverMesLinha(idx);
  }
  function onLinhaLeave() {
    setHoverMesLinha(null);
  }

  // --- Loading
  if (carregando) {
    return (
      <AppLayout>
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-emerald-50 to-white p-6">
            <p className="text-sm text-slate-500">Carregando relatórios…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Relatórios</h1>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Visão financeira</p>
            </div>
            <NotificationBellButton />
          </div>
        </div>

        {/* Filtro principal Todos / Em aberto */}
        <div className="mt-6 mx-auto max-w-xs grid grid-cols-2 gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
          {ABAS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAba(a)}
              className={`h-9 rounded-lg text-sm font-bold transition ${
                aba === a
                  ? "bg-emerald-500 text-white shadow"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        {/* Cards de resumo */}
        <section className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <CardResumo label="Emprestado" valor={totais.emprestado} icone={Wallet} corFundo="bg-slate-100 dark:bg-slate-800" corIcone="text-emerald-600" />
          <CardResumo label="Recebido" valor={totais.recebido} icone={TrendingUp} corFundo="bg-emerald-50 dark:bg-emerald-500/10" corIcone="text-Cred Facil" />
          <CardResumo label="Pendente" valor={totais.pendente} icone={TrendingDown} corFundo="bg-amber-50 dark:bg-amber-500/10" corIcone="text-amber-500" />
          <CardResumo label="Lucro" valor={totais.lucro} icone={Activity} corFundo="bg-rose-50 dark:bg-rose-500/10" corIcone={totais.lucro < 0 ? "text-rose-500" : "text-Cred Facil"} sinalNegativo />
        </section>

        {/* A receber */}
        <section className="mt-8">
          <h2 className="text-sm font-extrabold tracking-widest text-slate-700 dark:text-slate-200 uppercase">A receber</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Filtre por período para ver o que ainda vai receber.</p>

          {/* Período */}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {PERIODOS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriodo(p)}
                className={`h-9 px-4 rounded-full text-xs font-bold transition ${
                  periodo === p
                    ? "bg-emerald-500 text-white shadow"
                    : "bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400 hover:border-Cred Facil/40"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Período personalizado */}
          {periodo === "Personalizado" && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
              <label className="flex items-center gap-2">
                <span className="text-slate-500">De</span>
                <input
                  type="date"
                  value={dataIni}
                  onChange={(e) => setDataIni(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-slate-500">até</span>
                <input
                  type="date"
                  value={dataFim}
                  onChange={(e) => setDataFim(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
                />
              </label>
            </div>
          )}

          {/* Tipo */}
          <div className="mt-3 mx-auto max-w-md grid grid-cols-3 gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            {TIPOS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`h-9 rounded-lg text-xs font-bold transition ${
                  tipo === t
                    ? "bg-emerald-500 text-white shadow"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Mini cards do período */}
          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MiniCard label="Total a receber" valor={formatarMoeda(totaisAReceber.total)} icone={Wallet} fundo="bg-emerald-50 dark:bg-emerald-500/10" corIcone="text-Cred Facil" />
            <MiniCard label="Juros previstos" valor={formatarMoeda(totaisAReceber.juros)} icone={TrendingUp} fundo="bg-amber-50 dark:bg-amber-500/10" corIcone="text-amber-500" />
            <MiniCard label="Vencido" valor={formatarMoeda(totaisAReceber.vencido)} icone={TriangleAlert} fundo="bg-rose-50 dark:bg-rose-500/10" corIcone="text-rose-500" />
            <MiniCard label="Nº de parcelas" valor={String(totaisAReceber.count)} icone={ListChecks} fundo="bg-emerald-50 dark:bg-emerald-500/10" corIcone="text-Cred Facil" />
          </div>

          {parcelasAReceber.length === 0 && (
            <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
              Nenhum dado disponível para o período selecionado.
            </p>
          )}
        </section>

        {/* Gráficos */}
        <section className="mt-8 mb-24 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Entrada vs Saída */}
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Entrada vs Saída</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {graficoFiltro === "Período específico" ? "Período selecionado" : "Últimos 6 meses"}
            </p>

            <div className="mt-3 inline-flex gap-1 rounded-full bg-slate-100 dark:bg-slate-800 p-1">
              {["Últimos 6 meses", "Período específico"].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setGraficoFiltro(m)}
                  className={`h-8 px-4 rounded-full text-xs font-bold transition ${
                    graficoFiltro === m
                      ? "bg-emerald-500 text-white shadow"
                      : "bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {graficoFiltro === "Período específico" && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <input
                  type="date"
                  value={grafDataIni}
                  onChange={(e) => setGrafDataIni(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
                />
                <span className="text-slate-500">até</span>
                <input
                  type="date"
                  value={grafDataFim}
                  onChange={(e) => setGrafDataFim(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs"
                />
              </div>
            )}

            {/* Gráfico de barras (Entrada = verde, Saída = vermelho) */}
            <div className="mt-5 flex items-end gap-2">
              <div className="flex flex-col justify-between h-40 text-[10px] text-slate-400 tabular-nums py-0.5">
                {[4, 3, 2, 1, 0].map((i) => (
                  <span key={i}>{formatarMoedaCurta((maxEscala / 4) * i)}</span>
                ))}
              </div>
              <div className="flex-1 flex flex-col">
                <div
                  ref={barrasRef}
                  onMouseMove={onBarrasMouseMove}
                  onMouseLeave={onBarrasLeave}
                  className="relative flex-1 flex items-end justify-around gap-2 border-b border-dashed border-slate-200 dark:border-slate-700"
                >
                  {/* Tooltip flutuante */}
                  {hoverMes != null && serieGraficos[hoverMes] && (
                    <div
                      className="absolute z-10 -translate-x-1/2 -translate-y-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg text-[11px] whitespace-nowrap pointer-events-none"
                      style={{ left: `${((hoverMes + 0.5) / serieGraficos.length) * 100}%`, top: "0.25rem" }}
                    >
                      <p className="font-bold text-slate-700 dark:text-slate-200 capitalize">
                        {serieGraficos[hoverMes].label}
                      </p>
                      <p className="text-Cred Facil font-semibold">
                        Entrada : {formatarMoeda(serieGraficos[hoverMes].entrada)}
                      </p>
                      <p className="text-rose-500 font-semibold">
                        Saída : {formatarMoeda(serieGraficos[hoverMes].saida)}
                      </p>
                    </div>
                  )}

                  {serieGraficos.map((p, i) => (
                    <div key={i} className="relative z-[1] flex items-end gap-1 h-40">
                      <div
                        className="w-3.5 rounded-t bg-Cred Facil/80"
                        style={{ height: `${Math.max(2, (p.entrada / maxEscala) * 100)}%` }}
                      />
                      <div
                        className="w-3.5 rounded-t bg-rose-500/80"
                        style={{ height: `${Math.max(2, (p.saida / maxEscala) * 100)}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex justify-around text-[11px] text-slate-400">
                  {serieGraficos.map((p, i) => (
                    <span key={i}>{p.label}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-Cred Facil" /> Entrada</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> Saída</span>
            </div>
          </article>

          {/* Evolução de recebimentos */}
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Evolução de recebimentos</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {graficoFiltro === "Período específico" ? "Período selecionado" : "Últimos 6 meses"}
            </p>

            <div className="mt-5 flex items-end gap-2">
              <div className="flex flex-col justify-between h-44 text-[10px] text-slate-400 tabular-nums py-0.5">
                {[4, 3, 2, 1, 0].map((i) => (
                  <span key={i}>{formatarMoedaCurta((maxEscala / 4) * i)}</span>
                ))}
              </div>
              <div
                ref={linhaRef}
                onMouseMove={onLinhaMouseMove}
                onMouseLeave={onLinhaLeave}
                className="flex-1 relative h-44"
              >
                <div className="absolute inset-0 flex flex-col justify-between">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="border-t border-dashed border-slate-100 dark:border-slate-800" />
                  ))}
                </div>

                {/* Tooltip flutuante */}
                {hoverMesLinha != null && serieGraficos[hoverMesLinha] && (
                  <div
                    className="absolute z-10 -translate-x-1/2 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg text-[11px] whitespace-nowrap pointer-events-none"
                    style={{
                      left: `${((hoverMesLinha + 0.5) / serieGraficos.length) * 100}%`,
                      top: "45%",
                    }}
                  >
                    <p className="font-bold text-slate-700 dark:text-slate-200 capitalize">
                      {serieGraficos[hoverMesLinha].label}
                    </p>
                    <p className="text-Cred Facil font-semibold">
                      Recebido : {formatarMoeda(serieGraficos[hoverMesLinha].recebido)}
                    </p>
                  </div>
                )}

                {serieGraficos.length > 1 && (
                  <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
                    <polyline
                      fill="none"
                      stroke="#17b26a"
                      strokeWidth="0.8"
                      vectorEffect="non-scaling-stroke"
                      points={serieGraficos
                        .map((p, i) => {
                          const x = (i / (serieGraficos.length - 1)) * 100;
                          const y = 38 - (p.recebido / maxEscala) * 36;
                          return `${x},${y}`;
                        })
                        .join(" ")}
                    />
                    {serieGraficos.map((p, i) => {
                      const x = (i / (serieGraficos.length - 1)) * 100;
                      const y = 38 - (p.recebido / maxEscala) * 36;
                      return (
                        <circle
                          key={i}
                          cx={x}
                          cy={y}
                          r={hoverMesLinha === i ? "1.6" : "1"}
                          fill="#17b26a"
                        />
                      );
                    })}
                  </svg>
                )}
                <div className="absolute -bottom-5 inset-x-0 flex justify-between text-[11px] text-slate-400">
                  {serieGraficos.map((p, i) => (
                    <span key={i}>{p.label}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mb-7" />
          </article>
        </section>
      </div>
    </AppLayout>
  );
}

// Subcomponentes visuais isolados (não poluem o escopo principal)
function CardResumo({ label, valor, icone: Icone, corFundo, corIcone, sinalNegativo = false }) {
  const negativo = Number(valor) < 0;
  const texto = negativo ? formatarMoedaSinal(valor).replace("-", "-") : formatarMoeda(valor);
  return (
    <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <span className={`inline-flex rounded-xl p-2.5 ${corFundo}`}>
        <Icone className={`w-5 h-5 ${corIcone}`} />
      </span>
      <p className="mt-3 text-[10px] font-bold tracking-widest text-slate-400 uppercase">{label}</p>
      <p className={`text-lg font-extrabold tabular-nums ${
        sinalNegativo && negativo ? "text-rose-500" : "text-slate-900 dark:text-white"
      }`}>
        {sinalNegativo ? formatarMoedaSinal(valor) : formatarMoeda(valor)}
      </p>
    </article>
  );
}

function MiniCard({ label, valor, icone: Icone, fundo, corIcone }) {
  return (
    <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-5 flex flex-col items-center text-center">
      <span className={`rounded-xl ${fundo} p-2`}>
        <Icone className={`w-4 h-4 ${corIcone}`} />
      </span>
      <p className="mt-2.5 text-[9px] font-bold tracking-widest text-slate-400 uppercase">{label}</p>
      <p className="text-base font-extrabold text-slate-900 dark:text-white tabular-nums">{valor}</p>
    </article>
  );
}
