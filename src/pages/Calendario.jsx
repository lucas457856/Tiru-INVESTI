import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  TriangleAlert,
  CalendarDays,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import NotificationBellButton from "../components/NotificationBellButton";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

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

  // TODO: buscar cobranças reais do Firestore e filtrar por diaSelecionado
  const cobrancasDoDia = [];

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
            <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">0</p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-center">
            <span className="inline-flex rounded-full bg-red-50 dark:bg-red-500/10 p-2.5 mb-3">
              <TriangleAlert className="w-5 h-5 text-red-400" />
            </span>
            <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Vencidos</p>
            <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">0</p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-center">
            <span className="inline-flex rounded-full bg-emerald-50 dark:bg-emerald-500/10 p-2.5 mb-3">
              <CalendarDays className="w-5 h-5 text-jurex" />
            </span>
            <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Total no mês</p>
            <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">R$ 0,00</p>
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
                  return (
                    <button
                      key={dia.toISOString()}
                      type="button"
                      onClick={() => setDiaSelecionado(dia)}
                      className={`mx-auto w-9 h-9 rounded-full text-sm font-semibold flex items-center justify-center transition ${
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
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

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
          {cobrancasDoDia.length === 0 ? (
            <>
              <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                Nenhuma cobrança neste dia
              </h2>
              <p className="mt-1.5 max-w-xs text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Não há parcelas pendentes com vencimento nesta data.
              </p>
            </>
          ) : (
            <ul className="mt-4 w-full max-w-sm space-y-2">
              {/* Lista de cobranças aqui */}
            </ul>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
