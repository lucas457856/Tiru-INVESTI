import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Mail,
  ArrowRight,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import AuthShell from "../components/AuthShell";
import TurnstileMock from "../components/TurnstileMock";
import { esqueciSenha } from "../services/authService";

const INPUT_CLASSE =
  "w-full h-12 pl-11 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20";

export default function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [turnstileOk, setTurnstileOk] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const podeEnviar = turnstileOk && email;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!podeEnviar) return;
    setErro("");
    setEnviando(true);
    const res = await esqueciSenha(email);
    setEnviando(false);
    if (res.ok) {
      setEnviado(true);
    } else {
      setErro(res.erro);
    }
  }

  if (enviado) {
    return (
      <AuthShell>
        <div className="py-6 text-center">
          <CircleCheck className="w-14 h-14 text-jurex mx-auto" />
          <h1 className="mt-4 text-lg font-bold text-slate-800 dark:text-slate-100">
            Link enviado!
          </h1>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed">
            Enviamos um link de recuperação para{" "}
            <span className="font-semibold text-slate-700 dark:text-slate-200">{email}</span>.
            Verifique sua caixa de entrada.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-jurex hover:text-jurex-dark transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para o login
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      {/* Voltar para o login */}
      <Link
        to="/login"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-jurex hover:text-jurex-dark transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar para o login
      </Link>

      <form onSubmit={handleSubmit} className="mt-7 space-y-5">
        {/* E-mail */}
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2"
          >
            E-mail
          </label>
          <div className="relative">
            <Mail className="campo-icone absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT_CLASSE}
            />
          </div>
        </div>

        {/* Widget Cloudflare Turnstile (visual) */}
        <TurnstileMock onVerified={setTurnstileOk} />

        {/* Erro do envio */}
        {erro && (
          <p className="flex items-center gap-1.5 text-xs text-red-500">
            <CircleAlert className="w-4 h-4 shrink-0" />
            {erro}
          </p>
        )}

        {/* Botão Enviar */}
        <button
          type="submit"
          disabled={!podeEnviar || enviando}
          className="w-full h-13 rounded-2xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-60 disabled:pointer-events-none"
        >
          Enviar link de recuperação
          {enviando ? (
            <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <ArrowRight className="w-5 h-5" />
          )}
        </button>
      </form>
    </AuthShell>
  );
}
