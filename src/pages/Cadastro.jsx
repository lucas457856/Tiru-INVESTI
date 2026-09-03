import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  User,
  Phone,
  ArrowRight,
  CircleAlert,
} from "lucide-react";
import AuthShell from "../components/AuthShell";
import AuthTabs from "../components/AuthTabs";
import TurnstileMock from "../components/TurnstileMock";
import { cadastrar } from "../services/authService";

const INPUT_CLASSE =
  "w-full h-12 pl-11 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none transition focus:border-Cred Facil focus:ring-2 focus:ring-Cred Facil/20";

export default function Cadastro() {
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [turnstileOk, setTurnstileOk] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const senhasConferem = senha === confirmarSenha;
  const podeEnviar =
    turnstileOk && senhasConferem && senha.length >= 8 && nome && email;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!podeEnviar) return;
    setErro("");
    setEnviando(true);
    const res = await cadastrar({ nome, email, telefone, senha });
    setEnviando(false);
    if (res.ok) {
      navigate("/dashboard");
    } else {
      setErro(res.erro);
    }
  }

  return (
    <AuthShell>
      <AuthTabs ativa="criar" />

      <form onSubmit={handleSubmit} className="mt-7 space-y-5">
        {/* Nome completo */}
        <Campo label="Nome completo" id="nome">
          <User className="campo-icone" />
          <input
            id="nome"
            type="text"
            required
            autoComplete="name"
            placeholder="Seu nome completo"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={INPUT_CLASSE}
          />
        </Campo>

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

        {/* Telefone */}
        <Campo label="Telefone" id="telefone">
          <Phone className="campo-icone" />
          <input
            id="telefone"
            type="tel"
            autoComplete="tel"
            inputMode="numeric"
            placeholder="(00) 00000-0000"
            value={telefone}
            onChange={(e) => setTelefone(formatarTelefone(e.target.value))}
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
            minLength={8}
            autoComplete="new-password"
            placeholder="Mínimo de 8 caracteres"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className={INPUT_CLASSE}
          />
        </Campo>

        {/* Confirmar senha */}
        <Campo label="Confirmar senha" id="confirmar-senha">
          <Lock className="campo-icone" />
          <input
            id="confirmar-senha"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Repita a senha"
            value={confirmarSenha}
            onChange={(e) => setConfirmarSenha(e.target.value)}
            className={`${INPUT_CLASSE} ${
              confirmarSenha && !senhasConferem
                ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                : ""
            }`}
          />
          {confirmarSenha && !senhasConferem && (
            <p className="mt-1.5 text-xs text-red-500">
              As senhas não coincidem.
            </p>
          )}
        </Campo>

        {/* Widget Cloudflare Turnstile (visual) */}
        <TurnstileMock onVerified={setTurnstileOk} />

        {/* Erro do cadastro */}
        {erro && (
          <p className="flex items-center gap-1.5 text-xs text-red-500">
            <CircleAlert className="w-4 h-4 shrink-0" />
            {erro}
          </p>
        )}

        {/* Botão Criar conta */}
        <button
          type="submit"
          disabled={!podeEnviar || enviando}
          className="w-full h-13 rounded-2xl bg-gradient-to-r from-Cred Facil to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-Cred Facil/30 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-60 disabled:pointer-events-none"
        >
          Criar conta
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

function formatarTelefone(valor) {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.replace(/(\d{0,2})/, "($1");
  if (d.length <= 6) return d.replace(/(\d{2})(\d{0,4})/, "($1) $2");
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3");
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
}
