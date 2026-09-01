import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  TrendingUp,
  TrendingDown,
  Activity,
  Wallet,
  TriangleAlert,
  ListChecks,
} from "lucide-react";
import { collection, onSnapshot } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/useAuth";
import { db } from "../services/firebase";

const ABAS = ["Todos", "Em aberto"];
const PERIODOS = ["Este mês", "Próximos 30 dias", "Próximos 90 dias", "Personalizado"];
const TIPOS = ["Todos", "Contratos", "Vendas"];
const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function formatarMoeda(v) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarMoedaCurta(v) {
  const n = v ?? 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export default function Relatorios() {
  const { usuario } = useAuth();

  const [contratos, setContratos] = useState([]);
  const [aba, setAba] = useState("Todos");
  const [periodo, setPeriodo] = useState("Este mês");
  const [tipo, setTipo] = useState("Todos");

  // Escuta os contratos em tempo real
  useEffect(() => {
    if (!usuario) return;
    const unsub = onSnapshot(
      collection(db, "usuarios", usuario.uid, "contratos"),
      (snap) => setContratos(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, [usuario]);

  // Filtra por tipo e aba
  const base = useMemo(
    () =>
      contratos.filter((c) => {
        if (tipo === "Contratos" && c.nomeProduto != null) return false;
        if (tipo === "Vendas" && c.nomeProduto == null) return false;
        if (aba === "Em aberto" && c.quitado) return false;
        return true;
      }),
    [contratos, aba, tipo]
  );

  // Totais gerais
  const totais = useMemo(() => {
    const emprestado = base.reduce((s, c) => s + (c.valor ?? 0), 0);
    const totalReceber = base.reduce((s, c) => s + (c.totalReceber ?? c.valor ?? 0), 0);
    return {
      emprestado,
      recebido: base.filter((c) => c.quitado).reduce((s, c) => s + (c.totalReceber ?? c.valor ?? 0), 0),
      pendente: base.filter((c) => !c.quitado).reduce((s, c) => s + (c.totalReceber ?? c.valor ?? 0), 0),
      lucro: totalReceber - emprestado,
      aReceber: base.filter((c) => !c.quitado).reduce((s, c) => s + (c.totalReceber ?? c.valor ?? 0), 0),
      jurosPrevistos: base.reduce((s, c) => s + ((c.totalReceber ?? c.valor ?? 0) - (c.valor ?? 0)), 0),
      vencido: 0, // TODO: calcular com parcelas vencidas
      parcelas: base.filter((c) => !c.quitado).reduce((s, c) => s + (c.numeroParcelas ?? 0), 0),
    };
  }, [base]);

  // Janela dos gráficos: últimos 6 meses
  const janelaMeses = useMemo(() => {
    const hoje = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - 5 + i, 1);
      return { ano: d.getFullYear(), mes: d.getMonth(), label: MESES_ABREV[d.getMonth()] };
    });
  }, []);

  // Entrada vs Saída e Evolução (por enquanto zerados — TODO: dados de pagamentos)
  const serieGraficos = useMemo(
    () => janelaMeses.map(({ ano, mes }) => {
      const noMes = base.filter((c) => {
        if (!c.criadoEm) return false;
        const d = new Date(c.criadoEm);
        return d.getFullYear() === ano && d.getMonth() === mes;
      });
      return {
        entrada: noMes.reduce((s, c) => s + (c.valor ?? 0), 0),
        saida: 0,
        recebido: noMes.filter((c) => c.quitado).reduce((s, c) => s + (c.totalReceber ?? c.valor ?? 0), 0),
      };
    }),
    [base, janelaMeses]
  );

  const maxEscala = Math.max(
    1,
    ...serieGraficos.map((p) => Math.max(p.entrada, p.saida, p.recebido))
  );

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                Relatórios
              </h1>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Visão financeira
              </p>
            </div>
            <button
              type="button"
              aria-label="Notificações"
              className="relative rounded-full p-2.5 bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <Bell className="w-5 h-5 text-emerald-600" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-jurex" />
            </button>
          </div>
        </div>

        {/* Abas Todos / Em aberto */}
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
          {[
            { label: "Emprestado", valor: totais.emprestado, icone: Wallet, cor: "bg-slate-100 dark:bg-slate-800", texto: "" },
            { label: "Recebido", valor: totais.recebido, icone: TrendingUp, cor: "bg-emerald-50 dark:bg-emerald-500/10", texto: "text-jurex" },
            { label: "Pendente", valor: totais.pendente, icone: TrendingDown, cor: "bg-orange-50 dark:bg-orange-500/10", texto: "text-amber-500" },
            { label: "Lucro", valor: totais.lucro, icone: Activity, cor: "bg-emerald-50 dark:bg-emerald-500/10", texto: "text-jurex" },
          ].map(({ label, valor, icone: Icone, cor, texto }) => (
            <article
              key={label}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5"
            >
              <span className={`inline-flex rounded-xl p-2.5 ${cor}`}>
                <Icone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </span>
              <p className="mt-3 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                {label}
              </p>
              <p className={`text-lg font-extrabold tabular-nums ${texto || "text-slate-900 dark:text-white"}`}>
                R$ {formatarMoeda(valor).replace("R$", "").trim()}
              </p>
            </article>
          ))}
        </section>

        {/* A receber */}
        <section className="mt-8">
          <h2 className="text-sm font-extrabold tracking-widest text-slate-700 dark:text-slate-200 uppercase">
            A receber
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Filtre por período para ver o que ainda vai receber.
          </p>

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
                    : "bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400 hover:border-jurex/40"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

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
            {[
              { label: "Total a receber", valor: `R$ ${formatarMoeda(totais.aReceber).replace("R$", "").trim()}`, icone: Wallet, fundo: "bg-emerald-50 dark:bg-emerald-500/10", iconeCor: "text-jurex" },
              { label: "Juros previstos", valor: `R$ ${formatarMoeda(totais.jurosPrevistos).replace("R$", "").trim()}`, icone: TrendingUp, fundo: "bg-orange-50 dark:bg-orange-500/10", iconeCor: "text-amber-500" },
              { label: "Vencido", valor: `R$ ${formatarMoeda(totais.vencido).replace("R$", "").trim()}`, icone: TriangleAlert, fundo: "bg-red-50 dark:bg-red-500/10", iconeCor: "text-red-500" },
              { label: "Nº de parcelas", valor: String(totais.parcelas), icone: ListChecks, fundo: "bg-emerald-50 dark:bg-emerald-500/10", iconeCor: "text-jurex" },
            ].map(({ label, valor, icone: Icone, fundo, iconeCor }) => (
              <article
                key={label}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-5 flex flex-col items-center text-center"
              >
                <span className={`rounded-xl ${fundo} p-2`}>
                  <Icone className={`w-4 h-4 ${iconeCor}`} />
                </span>
                <p className="mt-2.5 text-[9px] font-bold tracking-widest text-slate-400 uppercase">
                  {label}
                </p>
                <p className="text-base font-extrabold text-slate-900 dark:text-white tabular-nums">
                  {valor}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* Gráficos */}
        <section className="mt-8 mb-24 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Entrada vs Saída */}
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Entrada vs Saida
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Últimos 6 meses</p>

            <div className="mt-3 inline-flex gap-1 rounded-full bg-slate-100 dark:bg-slate-800 p-1">
              {["Últimos 6 meses", "Período específico"].map((m, i) => (
                <button
                  key={m}
                  type="button"
                  className={`h-8 px-4 rounded-full text-xs font-bold transition ${
                    i === 0
                      ? "bg-emerald-500 text-white shadow"
                      : "bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Gráfico de barras */}
            <div className="mt-5 flex items-end gap-2">
              {/* Eixo Y */}
              <div className="flex flex-col justify-between h-40 text-[10px] text-slate-400 tabular-nums py-0.5">
                {[4, 3, 2, 1, 0].map((i) => (
                  <span key={i}>{formatarMoedaCurta((maxEscala / 4) * i)}</span>
                ))}
              </div>
              <div className="flex-1 flex flex-col">
                <div className="flex-1 flex items-end justify-around gap-2 border-b border-dashed border-slate-200 dark:border-slate-700">
                  {serieGraficos.map((p, i) => (
                    <div key={i} className="flex items-end gap-1 h-40">
                      <div
                        className="w-3.5 rounded-t bg-jurex/80"
                        style={{ height: `${Math.max(2, (p.entrada / maxEscala) * 100)}%` }}
                        title={`Entrada: ${formatarMoeda(p.entrada)}`}
                      />
                      <div
                        className="w-3.5 rounded-t bg-amber-400/80"
                        style={{ height: `${Math.max(2, (p.saida / maxEscala) * 100)}%` }}
                        title={`Saída: ${formatarMoeda(p.saida)}`
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex justify-around text-[11px] text-slate-400">
                  {janelaMeses.map(({ label }, i) => (
                    <span key={i}>{label}</span>
                  ))}
                </div>
              </div>
            </div>
          </article>

          {/* Evolução de recebimentos */}
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Evolução de recebimentos
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Últimos 6 meses</p>

            {/* Gráfico de linha */}
            <div className="mt-5 flex items-end gap-2">
              <div className="flex flex-col justify-between h-44 text-[10px] text-slate-400 tabular-nums py-0.5">
                {[4, 3, 2, 1, 0].map((i) => (
                  <span key={i}>{formatarMoedaCurta((maxEscala / 4) * i)}</span>
                ))}
              </div>
              <div className="flex-1 relative h-44">
                {/* Linhas horizontais pontilhadas */}
                <div className="absolute inset-0 flex flex-col justify-between">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="border-t border-dashed border-slate-100 dark:border-slate-800" />
                  ))}
                </div>
                {/* Linha SVG */}
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
                    return <circle key={i} cx={x} cy={y} r="1" fill="#17b26a" />;
                  })}
                </svg>
                {/* Eixo X */}
                <div className="absolute -bottom-5 inset-x-0 flex justify-between text-[11px] text-slate-400">
                  {janelaMeses.map(({ label }, i) => (
                    <span key={i}>{label}</span>
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
