import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  TriangleAlert,
  CalendarDays,
  LoaderCircle,
} from "lucide-react";
import { collection, doc, getDoc, onSnapshot, query } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import NotificationBellButton from "../components/NotificationBellButton";
import { useEffectiveUid } from "../hooks/useEffectiveUid";
import { db } from "../services/firebase";
import { parcelasDoContrato } from "../services/contractService";
import { calculatePenalty } from "../services/paymentCalculations";
import { formatarMoeda, formatarData, numeroCurto } from "../utils/formatadores";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

// Badge de status da parcela — reaproveita o padrão visual do sistema
// (mesmo mapa usado em NovoContrato.jsx / EmprestimoDetalhes.jsx).
const STATUS_PARCELA = {
  Paga: { classe: "bg-emerald-50 dark:bg-emerald-500/10 text-jurex", label: "Paga" },
  Pendente: { classe: "bg-amber-50 dark:bg-amber-500/10 text-amber-500", label: "Em dia" },
  Vencida: { classe: "bg-red-50 dark:bg-red-500/10 text-red-500", label: "Vencida" },
};

// Helpers de data — comparação por string YYYY-MM-DD para evitar drift
// de timezone (toISOString retorna UTC, no fuso BR desloca o dia em -1).
// Mesmo padrão de Parcelas.jsx (linhas 56-87) e Dashboard.jsx (linhas 60-63).
function dataLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}
function normalizarVencimento(v) {
  if (!v) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) return dataLocalISO(v);
  if (typeof v === "object" && typeof v.toDate === "function") {
    return dataLocalISO(v.toDate());
  }
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return dataLocalISO(d);
  }
  return "";
}
function inicioFimMes(ano, mes) {
  const ini = new Date(ano, mes, 1);
  const fim = new Date(ano, mes + 1, 0);
  return { ini: dataLocalISO(ini), fim: dataLocalISO(fim) };
}

// Gera a grade do mês (6 semanas), com dias dos meses vizinhos preenchendo
function gradeDoMes(ano, mes) {
  const primeiro = new Date(ano, mes, 1);
  const inicio = new Date(primeiro);
  inicio.setDate(1 - primeiro.getDay());

  const semanas = [];
  const cursor = new Date(inicio);
  for (let s = 0; s < 6; s++) {
    const semana = [];
    for (let d = 0; d < 7; d++) {
      semana.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
  }
  return semanas;
}

export default function Calendario() {
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth());
  const [ano, setAno] = useState(hoje.getFullYear());
  const [diaSelecionado, setDiaSelecionado] = useState(hoje);
  const [filtro, setFiltro] = useState("total");

  // effectiveUid resolve dono/funcionário (mesma arquitetura do Dashboard,
  // Parcelas e Emprestimos). Bloqueia queries até a role ser resolvida.
  const effectiveUid = useEffectiveUid();

  // ---- Estados de dados (idênticos ao padrão de Dashboard.jsx / Parcelas.jsx)
  const [contratos, setContratos] = useState([]);
  const [clientes, setClientes] = useState({}); // clienteId -> cliente
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  // ---- Carrega contratos do escopo efetivo em tempo real
  // MESMA assinatura de Dashboard.jsx:147-157 e Parcelas.jsx:328-344:
  //   collection(db,"usuarios",effectiveUid,"contratos") via onSnapshot.
  useEffect(() => {
    if (!effectiveUid) return undefined;
    const unsub = onSnapshot(
      query(collection(db, "usuarios", effectiveUid, "contratos")),
      (snap) => {
        setContratos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setCarregando(false);
        setErro(null);
      },
      (err) => {
        console.error("[CALENDARIO] erro ao carregar contratos:", {
          code: err?.code,
          message: err?.message,
        });
        setErro("Não foi possível carregar suas cobranças.");
        setCarregando(false);
      }
    );
    return unsub;
  }, [effectiveUid]);

  // ---- Carrega clientes REFERENCIADOS pelos contratos (em lote, com cache).
  // Estratégia idêntica a Parcelas.jsx:350-385: getDoc em paralelo apenas
  // para ids ainda não presentes no cache. Se o contrato não tiver clienteId,
  // o card usa o `clienteNome` denormalizado do contrato.
  useEffect(() => {
    if (!effectiveUid) return;
    const idsUnicos = Array.from(
      new Set(contratos.map((c) => c.clienteId).filter(Boolean))
    );
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
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratos, effectiveUid]);

  // ---- Coleção mestra de parcelas (uma só passada por render).
  // Usa `parcelasDoContrato` (fonte canônica do sistema) que já aplica
  // overrides de renegociação, deslocamentos de juros_apenas e abatimentos
  // por juros_parte_divida. Falha de um contrato NÃO derruba a página.
  const todasParcelas = useMemo(() => {
    const itens = [];
    for (const c of contratos) {
      let ps;
      try {
        ps = parcelasDoContrato(c, new Date());
      } catch (err) {
        console.warn("parcelasDoContrato falhou para", c.id, err);
        continue;
      }
      for (const p of ps) {
        itens.push({
          contratoId: c.id,
          contratoDoc: c,
          contratoNome: c.nome ?? c.clienteNome ?? "—",
          numeroCurto: numeroCurto(c.id),
          cliente: c.clienteId ? clientes[c.clienteId] : null,
          clienteId: c.clienteId,
          clienteNomeDoc: c.clienteNome,
          parcela: p,
        });
      }
    }
    return itens;
  }, [contratos, clientes]);

  // HOJE em string "YYYY-MM-DD" local — usado para A VENCER / VENCIDOS.
  const hojeISO = useMemo(() => dataLocalISO(new Date()), []);

  // A VENCER: parcelas não-pagas com vencimento >= hoje (Pendente OU Vencida
  // no dia de hoje ainda conta como "a vencer"; vencidas em data passada
  // vão para o card "VENCIDOS"). Exclui Pagas.
  const aVencerCount = useMemo(() => {
    return todasParcelas.filter((it) => {
      const p = it.parcela;
      if (p.status === "Paga") return false;
      const v = normalizarVencimento(p.vencimento);
      return v && v >= hojeISO;
    }).length;
  }, [todasParcelas, hojeISO]);

  // VENCIDOS: parcelas não-pagas com vencimento < hoje. Exclui Pagas.
  const vencidosCount = useMemo(() => {
    return todasParcelas.filter((it) => {
      const p = it.parcela;
      if (p.status === "Paga") return false;
      const v = normalizarVencimento(p.vencimento);
      return v && v < hojeISO;
    }).length;
  }, [todasParcelas, hojeISO]);

  // Mês selecionado — intervalo [ini, fim] em "YYYY-MM-DD".
  const { ini: iniMes, fim: fimMes } = useMemo(
    () => inicioFimMes(ano, mes),
    [ano, mes]
  );

  // TOTAL NO MÊS: soma das parcelas NÃO PAGAS com vencimento dentro do
  // intervalo [iniMes, fimMes]. Quando `filtro === "juros"`, soma apenas
  // os juros (parcela.jurosOriginais) + multa de atraso (calculatePenalty,
  // função canônica de paymentCalculations.js — zero fórmula duplicada).
  // Quando `filtro === "total"`, soma parcela.valor (regra financeira
  // atual do sistema, idêntica ao Dashboard/Parcelas/Relatorios).
  const totalMes = useMemo(() => {
    let soma = 0;
    for (const it of todasParcelas) {
      const p = it.parcela;
      if (p.status === "Paga") continue;
      const v = normalizarVencimento(p.vencimento);
      if (!v || v < iniMes || v > fimMes) continue;
      if (filtro === "juros") {
        const multa = calculatePenalty(it.contratoDoc, p, new Date());
        soma += (Number(p.jurosOriginais) || 0) + (Number(multa) || 0);
      } else {
        soma += Number(p.valor) || 0;
      }
    }
    return soma;
  }, [todasParcelas, iniMes, fimMes, filtro]);

  // Set de dias do mês selecionado que POSSUEM cobrança (para destacar
  // visualmente os dias com parcela — sem hardcode).
  const diasComCobranca = useMemo(() => {
    const set = new Set();
    for (const it of todasParcelas) {
      const p = it.parcela;
      if (p.status === "Paga") continue;
      const v = normalizarVencimento(p.vencimento);
      if (v && v >= iniMes && v <= fimMes) set.add(v);
    }
    return set;
  }, [todasParcelas, iniMes, fimMes]);

  // Cobranças do dia selecionado: filtra `todasParcelas` (já em memória)
  // — zero queries novas ao trocar de dia.
  const cobrancasDoDia = useMemo(() => {
    const alvo = dataLocalISO(diaSelecionado);
    return todasParcelas
      .filter((it) => {
        const p = it.parcela;
        if (p.status === "Paga") return false;
        const v = normalizarVencimento(p.vencimento);
        return v === alvo;
      })
      .map((it) => {
        const p = it.parcela;
        const multa = calculatePenalty(it.contratoDoc, p, new Date());
        const valorTotal =
          filtro === "juros"
            ? (Number(p.jurosOriginais) || 0) + (Number(multa) || 0)
            : (Number(p.valor) || 0);
        return {
          clienteNome: it.cliente?.nomeCompleto ?? it.clienteNomeDoc ?? "—",
          contratoNome: it.contratoNome,
          numeroCurto: it.numeroCurto,
          numero: p.numero,
          vencimento: normalizarVencimento(p.vencimento),
          status: p.status,
          valor: Number(p.valor) || 0,
          juros: Number(p.jurosOriginais) || 0,
          multa,
          valorTotal,
        };
      });
  }, [todasParcelas, diaSelecionado, filtro]);

  const semanas = useMemo(() => gradeDoMes(ano, mes), [ano, mes]);

  function trocarMes(delta) {
    let m = mes + delta;
    let a = ano;
    if (m < 0) { m = 11; a--; }
    if (m > 11) { m = 0; a++; }
    setMes(m);
    setAno(a);
  }

  function mesmoDia(a, b) {
    return (
      a && b &&
      a.getDate() === b.getDate() &&
      a.getMonth() === b.getMonth() &&
      a.getFullYear() === b.getFullYear()
    );
  }

  const ehHoje = (d) => mesmoDia(d, hoje);

  // Placeholders enquanto o primeiro snapshot não chegou — evita mostrar
  // "R$ 0,00" durante o carregamento (que poderia ser confundido com
  // "não há cobranças").
  const placeholdersCarregando = carregando && contratos.length === 0;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-slate-900 px-6 py-4">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Calendário
          </h1>
          <NotificationBellButton />
        </div>

        {/* Cards resumo */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-center">
            <span className="inline-flex rounded-full bg-amber-50 dark:bg-amber-500/10 p-2.5 mb-3">
              <Clock className="w-5 h-5 text-amber-500" />
            </span>
            <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">A vencer</p>
            <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">
              {placeholdersCarregando ? "—" : aVencerCount}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-center">
            <span className="inline-flex rounded-full bg-red-50 dark:bg-red-500/10 p-2.5 mb-3">
              <TriangleAlert className="w-5 h-5 text-red-400" />
            </span>
            <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Vencidos</p>
            <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">
              {placeholdersCarregando ? "—" : vencidosCount}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-center">
            <span className="inline-flex rounded-full bg-emerald-50 dark:bg-emerald-500/10 p-2.5 mb-3">
              <CalendarDays className="w-5 h-5 text-jurex" />
            </span>
            <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Total no mês</p>
            <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">
              {placeholdersCarregando ? "—" : formatarMoeda(totalMes)}
            </p>
          </div>
        </div>

        {/* Filtro Total / Juros + multas */}
        <div className="mt-5 flex justify-center">
          <div className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-slate-800 rounded-full p-1 min-w-[280px]">
            {[
              { id: "total", label: "Total" },
              { id: "juros", label: "Juros + multas" },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setFiltro(id)}
                className={`h-9 rounded-full text-sm font-semibold transition ${
                  filtro === id
                    ? "bg-jurex text-white shadow"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Calendário */}
        <div className="mx-auto mt-5 max-w-md rounded-2xl border border-emerald-100/80 dark:border-emerald-500/20 bg-gradient-to-b from-white to-emerald-50/40 dark:from-slate-900 dark:to-emerald-950/10 p-5 shadow-sm">
          {/* Navegação de mês */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => trocarMes(-1)}
              aria-label="Mês anterior"
              className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <ChevronLeft className="w-4 h-4 text-slate-500" />
            </button>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {MESES[mes]} {ano}
            </p>
            <button
              type="button"
              onClick={() => trocarMes(1)}
              aria-label="Próximo mês"
              className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          </div>

          {/* Dias da semana */}
          <div className="mt-4 grid grid-cols-7 text-center">
            {DIAS_SEMANA.map((d) => (
              <span key={d} className="text-xs font-medium text-slate-400">
                {d}
              </span>
            ))}
          </div>

          {/* Grade de dias */}
          <div className="mt-2 space-y-1.5">
            {semanas.map((semana, i) => (
              <div key={i} className="grid grid-cols-7 text-center">
                {semana.map((dia) => {
                  const foraDoMes = dia.getMonth() !== mes;
                  const selecionado = mesmoDia(dia, diaSelecionado);
                  const isoDia = dataLocalISO(dia);
                  const temCobranca = diasComCobranca.has(isoDia);
                  return (
                    <button
                      key={isoDia}
                      type="button"
                      onClick={() => setDiaSelecionado(dia)}
                      title={temCobranca ? "Há cobranças neste dia" : undefined}
                      className={`relative mx-auto w-9 h-9 rounded-full text-sm font-semibold flex items-center justify-center transition ${
                        selecionado
                          ? "bg-jurex text-white shadow-md shadow-jurex/30"
                          : foraDoMes
                            ? "text-slate-300 dark:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
                            : ehHoje(dia)
                              ? "text-jurex font-bold hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                              : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {dia.getDate()}
                      {temCobranca && !selecionado && !foraDoMes && (
                        <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-jurex" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Erro de carregamento (ex: permission-denied) */}
        {erro && (
          <p className="mt-4 text-center text-sm text-red-500 dark:text-red-400">
            {erro}
          </p>
        )}

        {/* Data selecionada */}
        <p className="mt-6 text-center text-sm font-bold text-slate-800 dark:text-slate-100 capitalize">
          {diaSelecionado.getDate()} De{" "}
          <span className="capitalize">{MESES[diaSelecionado.getMonth()]}</span>{" "}
          De {diaSelecionado.getFullYear()}
        </p>

        {/* Cobranças do dia */}
        <section className="mt-8 mb-12 flex flex-col items-center text-center">
          <span className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-100 dark:ring-emerald-500/20 p-4">
            <CalendarDays className="w-7 h-7 text-jurex" />
          </span>
          {carregando && contratos.length === 0 ? (
            <>
              <LoaderCircle className="mt-4 w-6 h-6 text-jurex animate-spin" />
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Carregando cobranças...
              </p>
            </>
          ) : cobrancasDoDia.length === 0 ? (
            <>
              <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                Nenhuma cobrança neste dia
              </h2>
              <p className="mt-1.5 max-w-xs text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Não há parcelas pendentes com vencimento nesta data.
              </p>
            </>
          ) : (
            <ul className="mt-4 w-full max-w-sm space-y-2 text-left">
              {cobrancasDoDia.map((c, idx) => {
                const st = STATUS_PARCELA[c.status] || STATUS_PARCELA.Pendente;
                return (
                  <li
                    key={`${c.numeroCurto}-${c.numero}-${idx}`}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {c.clienteNome}
                      </p>
                      <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${st.classe}`}>
                        {st.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Contrato {c.numeroCurto} · Parcela {c.numero}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Vencimento: {formatarData(c.vencimento)}
                      </p>
                      <p className="text-sm font-extrabold text-slate-900 dark:text-white tabular-nums">
                        {formatarMoeda(c.valorTotal)}
                      </p>
                    </div>
                    {filtro === "juros" && (c.juros > 0 || c.multa > 0) && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Juros: {formatarMoeda(c.juros)}</span>
                        {c.multa > 0 && <span>Multa: {formatarMoeda(c.multa)}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
