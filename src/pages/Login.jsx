import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock, ArrowRight, Fingerprint, CircleAlert } from "lucide-react";
import AuthShell from "../components/AuthShell";
import AuthTabs from "../components/AuthTabs";
import TurnstileMock from "../components/TurnstileMock";
import { entrar } from "../services/authService";

const INPUT_CLASSE =
  "w-full h-12 pl-11 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [lembrar, setLembrar] = useState(false);
  const [turnstileOk, setTurnstileOk] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    const res = await entrar({ email, senha });
    setEnviando(false);
    if (res.ok) {
      navigate("/dashboard");
    } else {
      setErro(res.erro);
    }
  }

  return (
    <AuthShell>
      <AuthTabs ativa="entrar" />

      <form onSubmit={handleSubmit} className="mt-7 space-y-5">
        {/* E-mail */}
        <Campo label="E-mail" id="email">
          <Mail className="campo-icone" />
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
        </Campo>

        {/* Senha */}
        <Campo label="Senha" id="senha">
          <Lock className="campo-icone" />
          <input
            id="senha"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className={INPUT_CLASSE}
          />
        </Campo>

        {/* Lembrar acesso / Esqueci minha senha */}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={lembrar}
              onChange={(e) => setLembrar(e.target.checked)}
              className="peer sr-only"
            />
            <span className="w-4.5 h-4.5 rounded-full border border-slate-300 dark:border-slate-600 peer-checked:border-jurex peer-checked:bg-jurex relative after:absolute after:left-1/2 after:top-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:w-2 after:h-2 after:rounded-full after:bg-transparent peer-checked:after:bg-white" />
            <span className="text-xs text-slate-600 dark:text-slate-300">Lembrar acesso</span>
          </label>
          <Link
            to="/esqueci-senha"
            className="text-xs font-semibold text-jurex hover:text-jurex-dark transition"
          >
            Esqueci minha senha
          </Link>
        </div>

        {/* Widget Cloudflare Turnstile (visual) */}
        <TurnstileMock onVerified={setTurnstileOk} />

        {/* Erro de autenticação */}
        {erro && (
          <p className="flex items-center gap-1.5 text-xs text-red-500 -mt-2">
            <CircleAlert className="w-4 h-4 shrink-0" />
            {erro}
          </p>
        )}

        {/* Botão Entrar */}
        <button
          type="submit"
          disabled={!turnstileOk || enviando}
          className="w-full h-13 rounded-2xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-60 disabled:pointer-events-none"
        >
          Entrar
          {enviando ? (
            <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <ArrowRight className="w-5 h-5" />
          )}
        </button>
      </form>

      {/* Divisor OU */}
      <div className="my-5 flex items-center gap-4">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-semibold text-slate-400">OU</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {/* Biometria */}
      <button
        type="button"
        onClick={() => console.log("biometria")}
        className="w-full h-12 rounded-2xl bg-white ring-1 ring-slate-200 text-slate-700 text-sm font-bold flex items-center justify-center gap-2.5 hover:bg-slate-50 active:scale-[0.99] transition"
      >
        <Fingerprint className="w-5 h-5 text-emerald-500" />
        Entrar com biometria
      </button>
    </AuthShell>
  );
}

function Campo({ label, id, children }) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2"
      >
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none [&>svg]:w-4.5 [&>svg]:h-4.5">
          {children[0]}
        </span>
        {children[1]}
      </div>
    </div>
  );
}
