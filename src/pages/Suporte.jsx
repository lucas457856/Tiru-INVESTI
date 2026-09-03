// Página "Suporte" — ponto de contato da equipe.
//
// Visual: header verde claro com botões circulares (voltar / Home) +
// card central verde mint com ícone de chat + dois cards de contato
// (E-mail e WhatsApp).
//
// Sem dependências novas: reaproveita AppLayout (que já injeta a
// Sidebar existente) e a mesma paleta/cor padrão do projeto.
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Home,
  MessageCircle,
  Mail,
  Phone,
} from "lucide-react";
import AppLayout from "../components/AppLayout";

const EMAIL_CONTATO = "luquetedev@gmail.com";
const WHATSAPP_NUMERO = "5585999348700"; // sem máscara; usado no wa.me
const WHATSAPP_EXIBICAO = "(85) 99934-8700";

export default function Suporte() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="min-h-svh bg-slate-50 dark:bg-slate-950">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-16">
          {/* Cabeçalho verde claro com botões circulares */}
          <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-5 py-4 sm:px-6 sm:py-5 mb-6 sm:mb-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(-1)}
                aria-label="Voltar"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-sm"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                aria-label="Ir para o Início"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                <Home className="w-4 h-4" />
              </button>
              <h1 className="ml-2 sm:ml-3 text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white">
                Suporte
              </h1>
            </div>
          </div>

          {/* Card principal de boas-vindas (verde mint) */}
          <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 shadow-sm px-6 py-10 sm:px-10 sm:py-12 mb-4 sm:mb-5">
            <div className="flex flex-col items-center text-center">
              <span className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-jurex flex items-center justify-center shadow-md">
                <MessageCircle className="w-7 h-7 sm:w-8 sm:h-8 text-white" strokeWidth={2.25} />
              </span>
              <h2 className="mt-5 sm:mt-6 text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                Como podemos ajudar?
              </h2>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
                Nossa equipe responde em poucos minutos.
              </p>
            </div>
          </div>

          {/* Cards de contato */}
          <div className="space-y-3 sm:space-y-4">
            {/* E-mail */}
            <a
              href={`mailto:${EMAIL_CONTATO}`}
              className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-jurex/30 transition group"
            >
              <span className="shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-jurex">
                <Mail className="w-5 h-5" strokeWidth={2.25} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm sm:text-[15px] font-extrabold text-slate-900 dark:text-white">
                  E-mail
                </p>
                <p className="mt-0.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate">
                  {EMAIL_CONTATO}
                </p>
              </div>
            </a>

            {/* WhatsApp */}
            <a
              href={`https://wa.me/${WHATSAPP_NUMERO}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm hover:shadow-md hover:border-jurex/30 transition group"
            >
              <span className="shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-jurex">
                <Phone className="w-5 h-5" strokeWidth={2.25} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm sm:text-[15px] font-extrabold text-slate-900 dark:text-white">
                  WhatsApp
                </p>
                <p className="mt-0.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate">
                  {WHATSAPP_EXIBICAO}
                </p>
              </div>
            </a>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
