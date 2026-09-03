import { useState } from "react";
import { Check } from "lucide-react";

export default function TurnstileMock({ onVerified }) {
  const [ok, setOk] = useState(false);

  function toggle() {
    setOk((v) => {
      const next = !v;
      onVerified?.(next);
      return next;
    });
  }

  return (
    <div className="mx-auto w-[300px] max-w-full">
      <button
        type="button"
        onClick={toggle}
        aria-label="Verificação Cloudflare"
        className="w-full flex items-center justify-between border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-3 hover:border-slate-300 dark:hover:border-slate-600 transition"
      >
        <span className="flex items-center gap-2.5">
          <span
            className={`w-6 h-6 rounded-full flex items-center justify-center transition ${
              ok ? "bg-Cred Facil" : "border-2 border-slate-300 bg-white"
            }`}
          >
            {ok && <Check className="w-4 h-4 text-white stroke-[3]" />}
          </span>
          <span
            className={`text-sm ${ok ? "text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400"}`}
          >
            {ok ? "Sucesso!" : "Verificando..."}
          </span>
        </span>
        <span className="flex flex-col items-center leading-none">
          <span className="flex items-center gap-1">
            <CloudflareMark />
            <span className="text-[11px] font-bold tracking-wide text-slate-800 dark:text-slate-200">
              CLOUDFLARE
            </span>
          </span>
          <span className="text-[8px] text-slate-400 mt-0.5">
            Privacidade • Termos
          </span>
        </span>
      </button>
    </div>
  );
}

function CloudflareMark() {
  return (
    <svg viewBox="0 0 24 16" className="w-5 h-3.5" fill="#f6821f" aria-hidden="true">
      <path d="M16.51 12.2c.15-.55.1-1.05-.15-1.4-.22-.33-.6-.52-1.06-.54l-8.65-.11a.17.17 0 0 1-.14-.09c-.03-.05-.03-.12.01-.18a.23.23 0 0 1 .15-.09l8.72-.11c1.04-.05 2.16-.89 2.55-1.92l.5-1.3a.3.3 0 0 0 .02-.16C17.9 3.9 15.73 2 13.14 2 10.78 2 8.77 3.57 8.08 5.72a3.66 3.66 0 0 0-2.63-.36 3.63 3.63 0 0 0-2.86 3.19c0 .1.01.2.02.3A5.18 5.18 0 0 0 0 13.53c0 .26.02.51.05.76.01.12.11.21.23.21h15.83c.11 0 .2-.07.24-.18Z" />
    </svg>
  );
}
