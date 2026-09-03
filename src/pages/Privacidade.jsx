import { useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";

export default function Privacidade() {
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
              Privacidade
            </h1>
          </div>
        </div>

        {/* Texto de privacidade */}
        <section className="mt-6 mb-24 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-6 space-y-4">
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            O Cred Facil leva a proteção dos seus dados a sério. As informações
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
