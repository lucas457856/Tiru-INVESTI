// Página "Parcelas"
// --------------------------------------------------------------------
// Tela dedicada de listagem de parcelas com filtros (Hoje / Amanhã /
// Atrasadas / Por data / A vencer / Pagas / Todas).
//
// - Reaproveita `parcelasDoContrato(contrato, hoje)` do contractService —
//   é a mesma função usada em EmprestimoDetalhes, ReceberPagamento e
//   Relatorios, então os valores, datas e status refletem exatamente o
//   resto do sistema (overrides de renegociação, deslocamentos de juros_apenas,
//   abatimentos por juros_parte_divida etc.).
// - Carrega clientes em paralelo (subcoleção propria dos contratos referencia
//   `clienteId` mas `clienteNome` já vem denormalizado no contrato, então só
//   buscamos o telefone se o cliente referenciado existir).
// - Cálculo do "TOTAL A RECEBER" sempre sobre o resultado ATUAL do filtro
//   (igual ao screenshot: muda quando você troca de filtro).
// - Datas em horário local — usa comparação por string "YYYY-MM-DD" para
//   evitar drift de timezone (toISOString retorna UTC, o que no fuso BR
//   anda 1 dia).
// - WhatsApp: abre `https://wa.me/55${telefone}?text=...` no padrão
//   já usado em EmprestimoDetalhes.jsx e ContratoSucesso.jsx.
// - Navegação para detalhes: rota já existente `/emprestimos/:id`.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CalendarX2,
  Inbox,
  LoaderCircle,
} from "lucide-react";
import {
  collection,
  onSnapshot,
  query,
  doc,
  getDoc,
} from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import { useEffectiveUid } from "../hooks/useEffectiveUid";
import { db } from "../services/firebase";
import { parcelasDoContrato } from "../services/contractService";
import {
  formatarMoeda,
  formatarData,
  formatarTelefone,
  numeroCurto,
} from "../utils/formatadores";

// --------------------------------------------------------------------
// Helpers de data — TODAS as comparações usam string YYYY-MM-DD para
// evitar drift de timezone do `toISOString` (que retorna UTC e no fuso
// brasileiro desloca o dia em -1).
// --------------------------------------------------------------------
function dataLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}
function adicionarDiasISO(iso, dias) {
  // Parse LOCAL explícito (string "YYYY-MM-DD" → componentes locais, sem UTC)
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + dias);
  return dataLocalISO(dt);
}
function formatarDataBR(iso) {
  if (!iso) return "—";
  return formatarData(iso);
}

// Formata uma data "YYYY-MM-DD" (string) como "01 de setembro de 2026".
// Faz parse LOCAL (split em componentes) para evitar o drift de UTC.
const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
function formatarDataPorExtensoBR(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const dia = Number(m[3]);
  const mes = Number(m[2]);
  const ano = Number(m[1]);
  return `${String(dia).padStart(2, "0")} de ${MESES_PT[mes - 1]} de ${ano}`;
}

// "01 de setembro de 2026" ou "01 de setembro de 2026 — 03 de setembro de 2026"
function formatarIntervaloBR(inicio, fim) {
  if (!inicio) return "";
  const a = formatarDataPorExtensoBR(inicio);
  if (!fim || fim === inicio) return a;
  const b = formatarDataPorExtensoBR(fim);
  return `${a} — ${b}`;
}

// --------------------------------------------------------------------
// DatePicker customizado (sem dependência externa).
// Visual idêntico à referência: card branco, grid 7 colunas, dia
// selecionado em bolinha verde, dias de meses vizinhos em cinza claro.
// Recebe o valor como "YYYY-MM-DD" e emite onChange no mesmo formato.
// --------------------------------------------------------------------
const DIAS_SEMANA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

function DatePicker({ value, onChange }) {
  // Estado interno: o mês/ano sendo visualizado
  const hoje = new Date();
  const valorInicial = value
    ? (() => {
        const [y, m, d] = value.split("-").map(Number);
        return new Date(y, m - 1, d);
      })()
    : hoje;
  const [visao, setVisao] = useState({
    ano: valorInicial.getFullYear(),
    mes: valorInicial.getMonth(),
  });

  const ano = visao.ano;
  const mes = visao.mes;
  // Primeiro dia do mês (em horário local)
  const primeiro = new Date(ano, mes, 1);
  const inicioSemana = primeiro.getDay(); // 0=domingo
  // Quantos dias tem o mês atual
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  // Dias do mês anterior para preencher o grid
  const diasMesAnterior = new Date(ano, mes, 0).getDate();

  // Constrói a grade de 6 semanas (42 células) — pode ser 5 em alguns meses,
  // mas manter 42 garante alinhamento uniforme.
  const celulas = [];
  for (let i = 0; i < 42; i++) {
    const offset = i - inicioSemana;
    const data = new Date(ano, mes, 1 + offset);
    celulas.push({
      data,
      fora: data.getMonth() !== mes,
    });
  }

  const mesLabel = `${MESES_PT[mes]} ${ano}`;

  function irMes(delta) {
    setVisao((v) => {
      let novoMes = v.mes + delta;
      let novoAno = v.ano;
      if (novoMes < 0) {
        novoMes = 11;
        novoAno -= 1;
      } else if (novoMes > 11) {
        novoMes = 0;
        novoAno += 1;
      }
      return { ano: novoAno, mes: novoMes };
    });
  }

  function selecionar(d) {
    if (typeof onChange === "function") {
      onChange(dataLocalISO(d));
    }
  }

  // Compara um Date com o valor selecionado (string "YYYY-MM-DD")
  function isSelecionado(d) {
    if (!value) return false;
    return dataLocalISO(d) === value;
  }
  function isHoje(d) {
    return (
      d.getFullYear() === hoje.getFullYear() &&
      d.getMonth() === hoje.getMonth() &&
      d.getDate() === hoje.getDate()
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-3 w-[280px]">
      {/* Header do mês */}
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          onClick={() => irMes(-1)}
          className="rounded-full w-7 h-7 flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 capitalize">
          {mesLabel}
        </p>
        <button
          type="button"
          onClick={() => irMes(1)}
          className="rounded-full w-7 h-7 flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          aria-label="Mês seguinte"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      {/* Cabeçalho dias da semana */}
      <div className="grid grid-cols-7 text-center text-[11px] text-slate-400 font-medium pb-1">
        {DIAS_SEMANA_CURTO.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      {/* Grade de dias */}
      <div className="grid grid-cols-7 text-center text-xs">
        {celulas.map(({ data, fora }, i) => {
          const sel = isSelecionado(data);
          const hj = isHoje(data);
          return (
            <button
              key={i}
              type="button"
              onClick={() => selecionar(data)}
              className={`mx-auto my-0.5 w-7 h-7 flex items-center justify-center rounded-full transition ${
                sel
                  ? "bg-jurex text-white font-bold"
                  : fora
                    ? "text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                    : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              } ${hj && !sel ? "ring-1 ring-jurex/40 font-bold" : ""}`}
            >
              {data.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Normaliza qualquer representação de vencimento (Date, Timestamp-like com
// toDate, ISO string, "YYYY-MM-DD") para "YYYY-MM-DD" local. Devolve "" se
// não conseguir interpretar.
function normalizarVencimento(v) {
  if (!v) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) return dataLocalISO(v);
  if (typeof v === "object" && typeof v.toDate === "function") {
    const d = v.toDate();
    return dataLocalISO(d);
  }
  if (typeof v === "string") {
    // Pode vir "2026-09-01", "2026-09-01T00:00:00.000Z" ou "2026-09-01T03:00:00"
    // Pegamos só os 10 primeiros caracteres, que correspondem a YYYY-MM-DD
    // mesmo quando o resto é hora em UTC (a data civil do Firestore costuma
    // vir como meia-noite UTC, então o YYYY-MM-DD já está correto).
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    // Tenta como Date genérica
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return dataLocalISO(d);
  }
  return "";
}

// Identificadores dos filtros
const FILTROS = [
  { id: "hoje", label: "Hoje" },
  { id: "amanha", label: "Amanhã" },
  { id: "atrasadas", label: "Atrasadas" },
  { id: "por-data", label: "Por data" },
  { id: "a-vencer", label: "A vencer" },
  { id: "pagas", label: "Pagas" },
  { id: "todas", label: "Todas" },
];

export default function Parcelas() {
  const navigate = useNavigate();
  const effectiveUid = useEffectiveUid();
  const [searchParams] = useSearchParams();

  // Estados de UI / dados
  const [contratos, setContratos] = useState([]);
  const [clientes, setClientes] = useState({}); // mapa clienteId -> cliente
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  // Filtro inicial pode vir via query string (ex: /parcelas?filtro=atrasadas),
  // permitindo links diretos como o indicador de atraso do Dashboard.
  // Aceita apenas IDs válidos do array FILTROS — caso contrário cai em "hoje".
  const filtroInicial = useMemo(() => {
    const daUrl = searchParams.get("filtro");
    if (daUrl && FILTROS.some((f) => f.id === daUrl)) return daUrl;
    return "hoje";
    // searchParams é estável por referência durante a montagem; reler em
    // mudanças exigiria sync URL↔state (fora do escopo deste fix).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filtro, setFiltro] = useState(filtroInicial);
  // "Por data" usa INTERVALO (dataInicial + dataFinal) conforme a referência
  // visual ("Selecione a data inicial e depois a data final."). Se dataFinal
  // estiver vazia, filtra apenas pela dataInicial.
  const [dataInicial, setDataInicial] = useState("");
  const [dataFinal, setDataFinal] = useState("");
  const [feedback, setFeedback] = useState(null); // {tipo, texto} para mensagens curtas
  const [dataPickerAberto, setDataPickerAberto] = useState(false);
  const dataPickerRef = useRef(null);

  // Data atual — calculada UMA VEZ por montagem (reflete o dia em que a
  // tela foi aberta; recarregue a página para "amanhã virar hoje").
  const hojeISO = useMemo(() => dataLocalISO(new Date()), []);
  const amanhaISO = useMemo(() => adicionarDiasISO(hojeISO, 1), [hojeISO]);

  // Click-outside e ESC para fechar o DatePicker customizado
  useEffect(() => {
    if (!dataPickerAberto) return undefined;
    function onDown(e) {
      if (dataPickerRef.current && !dataPickerRef.current.contains(e.target)) {
        setDataPickerAberto(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") setDataPickerAberto(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [dataPickerAberto]);

  // ---- Carrega contratos do escopo efetivo (tempo real)
  useEffect(() => {
    if (!effectiveUid) return;
    const unsub = onSnapshot(
      query(collection(db, "usuarios", effectiveUid, "contratos")),
      (snap) => {
        setContratos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setCarregando(false);
        setErro(null);
      },
      (err) => {
        console.error("Erro ao carregar contratos (Parcelas):", err);
        setErro("Não foi possível carregar suas parcelas.");
        setCarregando(false);
      }
    );
    return unsub;
  }, [effectiveUid]);

  // ---- Carrega clientes REFERENCIADOS pelos contratos.
  // Estratégia em lote: coleta clienteId únicos e faz getDoc em paralelo
  // (sem listener — só leitura única por sessão). Se o contrato não tiver
  // clienteId, mantemos só o `clienteNome` denormalizado.
  useEffect(() => {
    if (!effectiveUid) return;
    const idsUnicos = Array.from(
      new Set(contratos.map((c) => c.clienteId).filter(Boolean))
    );
    // Carrega apenas os que ainda não temos em cache
    const pendentes = idsUnicos.filter((id) => !(id in clientes));
    if (pendentes.length === 0) return;

    let cancelado = false;
    (async () => {
      const entradas = await Promise.all(
        pendentes.map(async (id) => {
          try {
            const snap = await getDoc(doc(db, "clientes", id));
            if (!snap.exists()) return [id, null];
            return [id, { id: snap.id, ...snap.data() }];
          } catch {
            return [id, null];
          }
        })
      );
      if (cancelado) return;
      setClientes((prev) => {
        const prox = { ...prev };
        for (const [id, cli] of entradas) {
          if (cli) prox[id] = cli;
        }
        return prox;
      });
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratos, effectiveUid]);

  // ---- Constrói a lista mestra de parcelas
  // Cada item: { contratoId, parcela (original de parcelasDoContrato), cliente }
  // Importante: parcelasDoContrato já aplica overrides e abatimentos.
  const todasParcelas = useMemo(() => {
    const itens = [];
    for (const c of contratos) {
      // Se o contrato está quitado, mantemos as parcelas para o filtro "Pagas"
      // (elas foram pagas de fato). Para os demais filtros, queremos apenas
      // as parcelas AINDA EM ABERTO, então filtramos pelo status aqui depois.
      const ps = parcelasDoContrato(c, new Date());
      const cli = c.clienteId ? clientes[c.clienteId] : null;
      for (const p of ps) {
        itens.push({
          contratoId: c.id,
          contratoNome: c.nome ?? c.clienteNome ?? "—",
          numeroCurto: numeroCurto(c.id),
          cliente: cli,
          clienteId: c.clienteId,
          parcela: p,
        });
      }
    }
    return itens;
  }, [contratos, clientes]);

  // ---- Aplica o filtro atual
  // Regras:
  //   hoje       → venc === hoje (qualquer status: pagas também aparecem)
  //   amanha     → venc === amanha (qualquer status)
  //   atrasadas  → venc < hoje E NÃO paga (semântica de "atraso em aberto")
  //   por-data   → venc dentro do intervalo [dataInicial, dataFinal] (qualquer status)
  //   a-vencer   → venc > hoje E NÃO paga
  //   pagas      → somente Paga
  //   todas      → todos
  const parcelasFiltradas = useMemo(() => {
    return todasParcelas.filter((item) => {
      const p = item.parcela;
      const venc = normalizarVencimento(p.vencimento);
      const isPaga = p.status === "Paga";
      switch (filtro) {
        case "hoje":
          return venc !== "" && venc === hojeISO;
        case "amanha":
          return venc !== "" && venc === amanhaISO;
        case "atrasadas":
          return !isPaga && venc !== "" && venc < hojeISO;
        case "por-data": {
          if (!dataInicial) return false;
          if (venc === "") return false;
          if (venc < dataInicial) return false;
          // Se a data final não foi preenchida, considera só a inicial
          if (dataFinal && venc > dataFinal) return false;
          return true;
        }
        case "a-vencer":
          return !isPaga && venc !== "" && venc > hojeISO;
        case "pagas":
          return isPaga;
        case "todas":
        default:
          return true;
      }
    });
  }, [todasParcelas, filtro, dataInicial, dataFinal, hojeISO, amanhaISO]);

  // ---- Total a receber
  // REGRAS:
  //   - "pagas"               → soma `recebido` (o que foi efetivamente pago)
  //   - "atrasadas"/"a-vencer" → todas são não-pagas por construção, soma `valor`
  //   - "hoje"/"amanha"/
  //     "por-data"/"todas"    → soma APENAS o que ainda precisa receber:
  //                              parcelas não-pagas somam `valor`,
  //                              parcelas Pagas NÃO entram no cálculo.
  //   (Este é o comportamento da referência: 3 parcela(s) / R$ 425,00
  //    quando há 1 A vencer de 425 + 2 Pagas de 135 e 50.)
  const totalFiltrado = useMemo(
    () =>
      parcelasFiltradas.reduce((s, item) => {
        const p = item.parcela;
        const isPaga = p.status === "Paga";
        if (filtro === "pagas") {
          return s + (Number(p.recebido) || 0);
        }
        if (isPaga) {
          return s;
        }
        return s + (Number(p.valor) || 0);
      }, 0),
    [parcelasFiltradas, filtro]
  );

  // ---- Ações

  // Abre o WhatsApp com a mensagem de cobrança pré-preenchida.
  // Padrão idêntico ao usado em EmprestimoDetalhes.jsx (linhas 255-279).
  function abrirWhatsapp(item) {
    const { cliente, parcela, contratoNome, numeroCurto: nc } = item;
    if (!cliente) {
      setFeedback({
        tipo: "erro",
        texto: "Este cliente não tem telefone cadastrado.",
      });
      return;
    }
    const telefone = formatarTelefone(cliente.telefone ?? "").replace(/\D/g, "");
    if (!telefone) {
      setFeedback({
        tipo: "erro",
        texto: "Este cliente não tem telefone cadastrado.",
      });
      return;
    }
    const primeiroNome = (cliente.nomeCompleto ?? "").split(" ")[0] || "cliente";
    const mensagem =
      `Olá, ${primeiroNome}! Tudo bem?\n\n` +
      `Sua parcela no valor de ${formatarMoeda(parcela.valor)}, ` +
      `com vencimento em ${formatarDataBR(parcela.vencimento)}, ` +
      `está disponível para pagamento.\n\n` +
      `Contrato: ${contratoNome} (${nc})`;
    window.open(
      `https://wa.me/55${telefone}?text=${encodeURIComponent(mensagem)}`,
      "_blank",
      "noopener"
    );
  }

  function abrirDetalhes(item) {
    // Vai direto para a tela de receber pagamento da parcela,
    // conforme referência visual (clique no card → ação de cobrança).
    navigate(`/receber-pagamento/${item.contratoId}`);
  }

  // Limpa o feedback após 2.5s
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 2500);
    return () => clearTimeout(t);
  }, [feedback]);

  // Texto auxiliar no card "TOTAL A RECEBER" — depende do filtro
  const labelTotal =
    filtro === "pagas" ? "Total recebido" : "Total a receber";

  return (
    <AppLayout>
      <div className="min-h-svh bg-white dark:bg-slate-950 relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden sm:block"
          style={{
            background:
              "radial-gradient(900px 500px at 90% 100%, rgba(23,178,106,0.10), rgba(23,178,106,0) 60%)",
          }}
        />

        <div className="relative max-w-5xl mx-auto px-6 sm:px-8 py-6">
          {/* Cabeçalho */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 sm:px-8 py-5 shadow-sm">
            <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight text-slate-900 dark:text-white">
              Parcelas
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {carregando ? "..." : `${todasParcelas.length} no total`}
            </p>
          </div>

          {/* Filtros */}
          <div className="mt-5 flex flex-wrap gap-2 justify-center sm:justify-start">
            {FILTROS.map((f) => {
              const ativo = filtro === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFiltro(f.id)}
                  className={`h-9 px-4 rounded-full text-xs font-bold transition ${
                    ativo
                      ? "bg-jurex text-white shadow-sm shadow-jurex/30"
                      : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-700 hover:border-jurex/40"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Campo de data (apenas para "Por data") — visual "01 de setembro de 2026".
              Ao clicar, abre um calendário customizado (popover) logo abaixo. */}
          {filtro === "por-data" && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <div ref={dataPickerRef} className="relative w-full max-w-md">
                <button
                  type="button"
                  onClick={() => setDataPickerAberto((v) => !v)}
                  aria-haspopup="dialog"
                  aria-expanded={dataPickerAberto}
                  className={`w-full inline-flex items-center gap-3 rounded-xl border ${
                    dataPickerAberto
                      ? "border-jurex ring-2 ring-jurex/20"
                      : "border-slate-200 dark:border-slate-700"
                  } bg-white dark:bg-slate-900 px-5 py-3 text-left transition hover:border-jurex/40 focus:outline-none`}
                >
                  <CalendarDays className="w-4.5 h-4.5 text-jurex shrink-0" />
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {dataInicial
                      ? formatarDataPorExtensoBR(dataInicial)
                      : "Selecione a data"}
                  </span>
                </button>

                {dataPickerAberto && (
                  <div className="absolute left-1/2 -translate-x-1/2 mt-2 z-30">
                    <DatePicker
                      value={dataInicial}
                      onChange={(iso) => {
                        setDataInicial(iso);
                        if (dataFinal && iso > dataFinal) setDataFinal("");
                        setDataPickerAberto(false);
                      }}
                    />
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
                Selecione a data inicial e depois a data final.
              </p>
            </div>
          )}

          {/* Feedback inline (substitui window.alert) */}
          {feedback && (
            <div
              role="status"
              className={`mt-3 rounded-xl px-4 py-2.5 text-sm font-semibold ${
                feedback.tipo === "erro"
                  ? "bg-red-50 text-red-500 border border-red-200/70"
                  : "bg-emerald-50 text-jurex border border-emerald-200/70"
              }`}
            >
              {feedback.texto}
            </div>
          )}

          {/* Card de TOTAL A RECEBER (centralizado, igual à referência) */}
          <div className="mt-5 flex justify-center">
            <div className="w-full max-w-md rounded-2xl border border-emerald-200/70 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10 px-6 py-4 shadow-sm flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-300 uppercase">
                  {labelTotal}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {parcelasFiltradas.length}{" "}
                  {parcelasFiltradas.length === 1 ? "parcela" : "parcela(s)"}
                </p>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold text-jurex tabular-nums">
                {carregando ? "..." : formatarMoeda(totalFiltrado)}
              </p>
            </div>
          </div>

          {/* Erro global */}
          {erro && (
            <p className="mt-4 rounded-xl bg-red-50 text-red-500 px-4 py-3 text-sm font-semibold">
              {erro}
            </p>
          )}

          {/* Lista de parcelas */}
          {carregando ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
              <LoaderCircle className="w-4 h-4 animate-spin" />
              Carregando parcelas...
            </div>
          ) : parcelasFiltradas.length === 0 ? (
            <div className="mt-10 flex flex-col items-center text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-12 px-6">
              <span className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-3">
                {filtro === "atrasadas" ? (
                  <CalendarX2 className="w-6 h-6 text-slate-400" />
                ) : (
                  <Inbox className="w-6 h-6 text-slate-400" />
                )}
              </span>
              <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
                Nenhuma parcela encontrada
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                {filtro === "por-data" && !dataInicial
                  ? "Selecione uma data para filtrar."
                  : filtro === "hoje"
                    ? "Sem parcelas com vencimento hoje."
                    : filtro === "amanha"
                      ? "Sem parcelas com vencimento amanhã."
                      : filtro === "atrasadas"
                        ? "Ótima notícia — sem parcelas atrasadas."
                        : filtro === "a-vencer"
                          ? "Sem parcelas futuras em aberto."
                          : filtro === "pagas"
                            ? "Nenhuma parcela paga ainda."
                            : "Cadastre contratos para começar."}
              </p>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-16">
              {parcelasFiltradas.map((item) => {
                const p = item.parcela;
                const venc = normalizarVencimento(p.vencimento);
                // Status visual: o sistema já fornece `p.status` ("Paga" | "Pendente" | "Vencida" | "Parcial")
                // Mapeamos para rótulos curtos da referência.
                const status = calcularStatus(p, venc, hojeISO);
                return (
                  <article
                    key={`${item.contratoId}-${p.numero}`}
                    onClick={() => abrirDetalhes(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        abrirDetalhes(item);
                      }
                    }}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm cursor-pointer transition hover:border-jurex/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-jurex/20"
                  >
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 flex items-center justify-center text-sm font-extrabold">
                        {p.numero}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-bold uppercase text-slate-900 dark:text-white"
                          title={item.contratoNome}
                        >
                          {item.contratoNome}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Vence {formatarDataBR(p.vencimento)}
                        </p>
                      </div>
                      <StatusBadge status={status} />
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <p className="text-base font-extrabold text-jurex tabular-nums">
                        {formatarMoeda(p.valor)}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirWhatsapp(item);
                          }}
                          aria-label="Enviar mensagem pelo WhatsApp"
                          className="rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 p-2 text-jurex transition"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirDetalhes(item);
                          }}
                          aria-label="Receber pagamento"
                          className="rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 p-2 text-slate-600 dark:text-slate-200 transition"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

// Mapeia o status do sistema (que vem em `p.status` da função
// `parcelasDoContrato`) para o rótulo curto da referência.
function calcularStatus(parcela, venc, hojeISO) {
  // Fonte canônica: o sistema já classifica a parcela
  //   "Paga" | "Pendente" | "Vencida" | "Parcial"
  // Pendente hoje vira "Hoje"; Vencida vira "Atrasada".
  if (parcela.status === "Paga") return "Paga";
  if (parcela.status === "Vencida") return "Atrasada";
  if (parcela.status === "Parcial") {
    if (venc < hojeISO) return "Atrasada";
    if (venc === hojeISO) return "Hoje";
    return "A vencer";
  }
  // Pendente: decidir pela data
  if (venc === hojeISO) return "Hoje";
  if (venc < hojeISO) return "Atrasada";
  return "A vencer";
}

function StatusBadge({ status }) {
  // Mesma paleta do projeto (emerald-50/red-50/amber-50/blue-50)
  const mapa = {
    Paga: "bg-emerald-50 text-jurex border border-emerald-200/70",
    Hoje: "bg-emerald-50 text-jurex border border-emerald-200/70",
    "A vencer": "bg-amber-50 text-amber-700 border border-amber-200/70",
    Atrasada: "bg-red-50 text-red-500 border border-red-200/70",
  };
  const classe = mapa[status] || mapa["A vencer"];
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold leading-tight text-center ${classe}`}
    >
      {status}
    </span>
  );
}
