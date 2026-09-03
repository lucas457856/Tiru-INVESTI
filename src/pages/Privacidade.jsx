import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import HomeButton from "../components/HomeButton";

export default function Privacidade() {
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
              Privacidade
            </h1>
          </div>
        </div>

        {/* Texto de privacidade */}
        <section className="mt-6 mb-24 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-6 space-y-4">
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            O Jurex leva a proteção dos seus dados a sério. As informações
            cadastradas no aplicativo — como dados de clientes, contratos e
            parcelas — são armazenadas de forma segura e utilizadas
            exclusivamente para o funcionamento das funcionalidades oferecidas.
          </p>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Não compartilhamos seus dados com terceiros para fins de marketing.
            O acesso às informações é restrito à sua conta, protegido por
            autenticação e controles de permissão.
          </p>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Você pode solicitar a exportação ou exclusão dos seus dados a
            qualquer momento através do suporte do aplicativo.
          </p>
        </section>
      </div>
    </AppLayout>
  );
}
