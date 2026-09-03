import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Headset,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import HomeButton from "../components/HomeButton";

export default function CentralAjuda() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Voltar"
              className="rounded-full p-2 ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 transition"
            >
              <ArrowLeft className="w-4.5 h-4.5 text-slate-700 dark:text-slate-200" />
            </button>
            <HomeButton />
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Central de ajuda
            </h1>
          </div>
        </div>

        {/* Banner de suporte */}
        <section className="mt-6 mb-24 rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-b from-emerald-50/80 to-white dark:from-slate-900 dark:to-slate-950 px-6 py-12 flex flex-col items-center text-center">
          <span className="rounded-2xl bg-jurex p-4 shadow-lg shadow-jurex/30">
            <Headset className="w-7 h-7 text-white" />
          </span>
          <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
            Suporte 24/7 disponível
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            Nossa equipe está pronta para ajudar com qualquer dúvida sobre o uso
            do Jurex — contratos, cobranças, pagamentos e mais.
          </p>
        </section>
      </div>
    </AppLayout>
  );
}
