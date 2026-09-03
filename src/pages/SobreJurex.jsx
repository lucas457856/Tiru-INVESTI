import { useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";

export default function SobreJurex() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <BackButton />
            <HomeButton />
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Sobre o Jurex
            </h1>
          </div>
        </div>

        {/* Card sobre */}
        <section className="mt-6 mb-24 rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-b from-emerald-50/80 to-white dark:from-slate-900 dark:to-slate-950 px-6 py-12 flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="Logo do Jurex"
            className="w-16 h-16 rounded-2xl object-cover shadow-md"
          />
          <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
            Jurex
          </h2>
          <p className="mt-0.5 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
            Versão MVP 1.0
          </p>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            O Jurex é um aplicativo de gestão de contratos e cobranças, feito
            para ajudar você a controlar empréstimos, parcelas e clientes em um
            só lugar, de forma simples e organizada.
          </p>
        </section>
      </div>
    </AppLayout>
  );
}
