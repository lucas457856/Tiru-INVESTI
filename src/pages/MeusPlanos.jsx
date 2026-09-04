// Página "Meus Planos" — espelha o estado real do plano do DONO
// (defaults permissivos 5/5/5 aplicados automaticamente — ver
// useDonoAdmin) e a contagem REAL de clientes/contratos do escopo
// efetivo (donoUid para funcionários; próprio uid para o dono).
//
// Toda a contagem usa o MESMO padrão de isolamento já presente no
// restante do sistema:
//   - Clientes: `collection(db, "clientes")` com `where("ownerId", "==", effectiveUid)`
//   - Contratos: `collection(db, "usuarios", effectiveUid, "contratos")`
//
// O Firestore Rules + o hook useEffectiveUid garantem que o usuário
// autenticado só consegue ouvir/ler os seus próprios dados. Os
// listeners são em tempo real (onSnapshot), então o contador reflete
// imediatamente a criação/exclusão de clientes e contratos.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  Sparkles,
  Lock,
  Users,
  FileText,
  ArrowRight,
} from "lucide-react";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";
import { db } from "../services/firebase";
import { useEffectiveUid } from "../hooks/useEffectiveUid";
import { useDonoAdmin } from "../hooks/useDonoAdmin";

export default function MeusPlanos() {
  const navigate = useNavigate();
  const effectiveUid = useEffectiveUid();
  // Plano e limites efetivos do DONO (5/5/5 por padrão no FREE;
  // PRO = ilimitado — o useDonoAdmin devolve limites = 0 nesse caso).
  // O campo `plan` é o mesmo usado no Painel Admin: "free" | "pro".
  const { plan, limites, loading: loadingDono } = useDonoAdmin();
  const ehPro = plan === "pro";
  // No PRO, exibimos "Ilimitado" no lugar do número; o limite real
  // (que é 0) não é usado na UI mas continua valendo nos endpoints
  // de criação (que já tratam limite=0 como "sem limite").
  const limiteClientes = ehPro ? 0 : Number(limites?.clientes) || 0;
  const limiteContratos = ehPro ? 0 : Number(limites?.contratos) || 0;

  // Contadores em tempo real. Mantemos em estado separado (em vez de
  // guardar a lista inteira) porque a página só precisa do tamanho.
  const [qtdClientes, setQtdClientes] = useState(0);
  const [qtdContratos, setQtdContratos] = useState(0);
  const [carregandoClientes, setCarregandoClientes] = useState(true);
  const [carregandoContratos, setCarregandoContratos] = useState(true);

  // Clientes: query por ownerId (mesmo filtro usado em Clientes.jsx
  // e em NovoContrato.jsx). Funcionários herdam o ownerUid via
  // useEffectiveUid, então continuam vendo os clientes do DONO.
  useEffect(() => {
    if (!effectiveUid) return undefined;
    const q = query(
      collection(db, "clientes"),
      where("ownerId", "==", effectiveUid),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setQtdClientes(snap.size);
        setCarregandoClientes(false);
      },
      () => setCarregandoClientes(false),
    );
    return unsub;
  }, [effectiveUid]);

  // Contratos: subcoleção por usuário, mesmo padrão de
  // Emprestimos.jsx e NovoContrato.jsx. Não precisa de filtro
  // adicional porque o Firestore Rules + path já isolam por dono.
  useEffect(() => {
    if (!effectiveUid) return undefined;
    const q = query(collection(db, "usuarios", effectiveUid, "contratos"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setQtdContratos(snap.size);
        setCarregandoContratos(false);
      },
      () => setCarregandoContratos(false),
    );
    return unsub;
  }, [effectiveUid]);

  // Limite atingido: usado para realçar visualmente os contadores
  // (não bloqueia nada aqui — só reflete o estado real). No PRO
  // nunca atingimos o limite (é ilimitado).
  const clientesNoLimite =
    !ehPro && limiteClientes > 0 && qtdClientes >= limiteClientes;
  const contratosNoLimite =
    !ehPro && limiteContratos > 0 && qtdContratos >= limiteContratos;

  return (
    <AppLayout>
      <div className="min-h-svh bg-white dark:bg-slate-950 relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden sm:block"
          style={{
            background:
              "radial-gradient(900px 500px at 85% 100%, rgba(23,178,106,0.10), rgba(23,178,106,0) 60%)",
          }}
        />

        <div className="relative w-full max-w-[1180px] 2xl:max-w-[1280px] mx-auto px-6 sm:px-8 lg:px-10 py-6 lg:py-8">
          {/* Cabeçalho — mesmo padrão de EmprestimoDetalhes.jsx */}
          <div className="rounded-2xl border border-emerald-100/70 dark:border-slate-800 bg-gradient-to-r from-emerald-50/80 via-emerald-50/40 to-white dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/20 px-5 sm:px-7 py-4 sm:py-5 shadow-sm">
            <div className="flex items-center gap-3">
              <BackButton className="p-2.5" iconSize="w-[18px] h-[18px]" />
              <HomeButton />
              <h1 className="text-[20px] font-bold text-slate-900 dark:text-white tracking-tight">
                Planos
              </h1>
            </div>
          </div>

          <div className="mt-6 lg:mt-7 space-y-5 pb-24">
            {/* Card "Plano atual" */}
            <section className="rounded-2xl border border-emerald-100/80 dark:border-slate-800 bg-gradient-to-br from-emerald-50/60 via-white to-white dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 p-5 sm:p-6 shadow-sm">
              <p className="text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                Plano atual
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  {ehPro ? "Pro" : "Free"}
                </h2>
                {ehPro ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-jurex px-2.5 py-1 text-[11px] font-bold text-white">
                    <Sparkles className="w-3 h-3" strokeWidth={2.5} />
                    Pro
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-jurex">
                    <span className="w-1.5 h-1.5 rounded-full bg-jurex" />
                    Ativo
                  </span>
                )}
              </div>

              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Clientes */}
                <div
                  className={`rounded-xl border bg-white dark:bg-slate-900 px-4 py-3.5 transition ${
                    clientesNoLimite
                      ? "border-amber-300/80 dark:border-amber-500/40"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                    <Users className="w-3.5 h-3.5" />
                    Clientes
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span
                      className={`text-2xl font-extrabold tabular-nums ${
                        clientesNoLimite
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-slate-900 dark:text-white"
                      }`}
                    >
                      {carregandoClientes && !loadingDono ? "—" : qtdClientes}
                    </span>
                    <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                      {ehPro ? "/ Ilimitado" : `/ ${limiteClientes}`}
                    </span>
                    {clientesNoLimite && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                        <Lock className="w-3 h-3" />
                        Limite
                      </span>
                    )}
                  </div>
                </div>

                {/* Contratos */}
                <div
                  className={`rounded-xl border bg-white dark:bg-slate-900 px-4 py-3.5 transition ${
                    contratosNoLimite
                      ? "border-amber-300/80 dark:border-amber-500/40"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                    <FileText className="w-3.5 h-3.5" />
                    Contratos
                  </div>
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span
                      className={`text-2xl font-extrabold tabular-nums ${
                        contratosNoLimite
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-slate-900 dark:text-white"
                      }`}
                    >
                      {carregandoContratos && !loadingDono ? "—" : qtdContratos}
                    </span>
                    <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                      {ehPro ? "/ Ilimitado" : `/ ${limiteContratos}`}
                    </span>
                    {contratosNoLimite && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                        <Lock className="w-3 h-3" />
                        Limite
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Card do plano Free */}
            <article
              className={`rounded-2xl border p-5 sm:p-6 shadow-sm ${
                !ehPro
                  ? "border-jurex/40 bg-white dark:bg-slate-900 ring-1 ring-jurex/20"
                  : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              }`}
            >
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                Free
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Plano gratuito para começar
              </p>
              <p className="mt-3 text-2xl font-extrabold text-slate-900 dark:text-white">
                Grátis
              </p>

              <ul className="mt-4 space-y-2.5">
                {[
                  "Até 5 clientes",
                  "Até 5 contratos",
                  "Suporte por e-mail",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200"
                  >
                    <Check className="w-4 h-4 mt-0.5 shrink-0 text-jurex" strokeWidth={2.5} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                disabled={!ehPro}
                aria-disabled={!ehPro}
                className={
                  !ehPro
                    ? "mt-5 w-full h-11 rounded-[10px] text-sm font-semibold bg-jurex text-white shadow-sm shadow-jurex/30"
                    : "mt-5 w-full h-11 rounded-[10px] text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                }
              >
                {!ehPro ? "Plano atual" : "Selecionar Free"}
              </button>
            </article>

            {/* Card do plano Pro */}
            <article
              className={`relative overflow-hidden rounded-2xl border p-5 sm:p-6 shadow-lg ${
                ehPro
                  ? "border-jurex bg-jurex text-white shadow-jurex/30"
                  : "border-emerald-500/30 bg-jurex text-white shadow-jurex/20"
              }`}
            >
              {/* Selo "Recomendado" / "Plano atual" no canto superior direito */}
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/15 backdrop-blur px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase text-white">
                <Sparkles className="w-3 h-3" strokeWidth={2.5} />
                {ehPro ? "Plano atual" : "Recomendado"}
              </span>

              <h3 className="text-base font-extrabold text-white">Pro</h3>
              <p className="mt-1 text-sm text-white/80">
                Plano profissional com mais recursos
              </p>
              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold tabular-nums text-white">
                  R$ 20,00
                </span>
                <span className="text-sm font-semibold text-white/80">/mês</span>
              </p>

              <ul className="mt-4 space-y-2.5">
                {[
                  "Clientes ilimitados",
                  "Contratos ilimitados",
                  "Funcionários ilimitados",
                  "Suporte prioritário",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2.5 text-sm text-white"
                  >
                    <Check className="w-4 h-4 mt-0.5 shrink-0 text-white" strokeWidth={2.5} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => navigate("/suporte")}
                disabled={ehPro}
                aria-disabled={ehPro}
                className={`mt-5 w-full h-11 rounded-[10px] text-sm font-bold flex items-center justify-center gap-1.5 shadow-sm transition ${
                  ehPro
                    ? "bg-white/95 text-jurex cursor-default"
                    : "bg-white text-jurex hover:bg-white/95 active:scale-[0.99]"
                }`}
              >
                {ehPro ? "Plano atual" : "Assinar agora"}
                {!ehPro && <ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
              </button>
            </article>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
