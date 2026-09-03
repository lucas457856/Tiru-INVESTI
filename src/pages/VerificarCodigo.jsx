import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, MailCheck, RefreshCw } from "lucide-react";
import { sendEmailVerification } from "firebase/auth";
import AuthShell from "../components/AuthShell";
import { useAuth } from "../context/useAuth";

const DIGITOS = 6;

export default function VerificarCodigo() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const [codigo, setCodigo] = useState(Array(DIGITOS).fill(""));
  const [reenviado, setReenviado] = useState(false);
  const [segundos, setSegundos] = useState(30);

  const completo = codigo.every((d) => d !== "");

  // Countdown para reenvio
  useEffect(() => {
    if (segundos <= 0) return;
    const t = setInterval(() => setSegundos((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [segundos]);

  function handleChange(i, valor) {
    if (!/^\d?$/.test(valor)) return; // só dígito
    const novo = [...codigo];
    novo[i] = valor;
    setCodigo(novo);
    if (valor && i < DIGITOS - 1) {
      document.getElementById(`otp-${i + 1}`)?.focus();
    }
  }

  function handleKeyDown(i, e) {
    if (e.key === "Backspace" && !codigo[i] && i > 0) {
      document.getElementById(`otp-${i - 1}`)?.focus();
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const texto = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, DIGITOS);
    if (!texto) return;
    const novo = Array(DIGITOS).fill("");
    texto.split("").forEach((d, i) => (novo[i] = d));
    setCodigo(novo);
    document.getElementById(`otp-${Math.min(texto.length, DIGITOS - 1)}`)?.focus();
  }

  async function reenviar() {
    if (segundos > 0 || !usuario) return;
    await sendEmailVerification(usuario);
    setReenviado(true);
    setSegundos(30);
  }

  return (
    <AuthShell>
      {/* Voltar */}
      <button
        type="button"
        onClick={() => navigate("/login")}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-jurex hover:text-jurex-dark transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar para o login
      </button>

      <div className="mt-8 text-center">
        <MailCheck className="w-14 h-14 text-jurex mx-auto" />
        <h1 className="mt-4 text-lg font-bold text-slate-800">
          Verifique seu e-mail
        </h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          Enviamos um código de confirmação para{" "}
          <span className="font-semibold text-slate-700">
            {usuario?.email ?? "seu e-mail"}
          </span>
          .
        </p>
      </div>

      {/* Campos OTP */}
      <div className="mt-8 flex justify-center gap-2.5" onPaste={handlePaste}>
        {codigo.map((digito, i) => (
          <input
            key={i}
            id={`otp-${i}`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={digito}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={`w-11 h-13 rounded-xl border text-center text-lg font-bold text-slate-800 outline-none transition ${
              digito
                ? "border-jurex bg-emerald-50/60"
                : "border-slate-200 bg-white focus:border-jurex focus:ring-2 focus:ring-jurex/20"
            }`}
          />
        ))}
      </div>

      {/* Reenviar */}
      <div className="mt-6 text-center">
        {segundos > 0 ? (
          <p className="text-xs text-slate-400">
            Reenviar código em {segundos}s
          </p>
        ) : (
          <button
            type="button"
            onClick={reenviar}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-jurex hover:text-jurex-dark transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reenviar código
          </button>
        )}
        {reenviado && (
          <p className="mt-1.5 text-xs text-jurex">Código reenviado!</p>
        )}
      </div>

      {/* Confirmar */}
      <button
        type="button"
        disabled={!completo}
        onClick={() => navigate("/dashboard")}
        className="mt-8 w-full h-13 rounded-2xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-60 disabled:pointer-events-none"
      >
        Confirmar
      </button>

      <p className="mt-4 text-center text-xs text-slate-400">
        Já confirmou?{" "}
        <Link to="/login" className="font-semibold text-jurex">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
