// Página "Nova senha" — consumida após o usuário clicar no link do
// e-mail de recuperação de senha.
//
// FLUXO:
//   1. O usuário pede a recuperação em /esqueci-senha.
//   2. O Firebase envia um e-mail com um link
//      `https://<authDomain>/__/auth/action?mode=resetPassword&oobCode=XXX
//      &continueUrl=https://tiru-investi.vercel.app/nova-senha` (configurado
//      em `authService.actionCodeSettingsReset`).
//   3. O usuário clica → o Firebase valida o oobCode e redireciona
//      para `continueUrl` (configurado também no console Firebase em
//      Authentication > Templates > Password reset > continueUrl).
//      O redirect injeta `?oobCode=...` na URL final.
//   4. Esta página lê o `oobCode` da URL, valida o token com
//      `verifyPasswordResetCode(auth, oobCode)` e exibe o formulário.
//   5. Ao confirmar, chama `confirmPasswordReset(auth, oobCode, novaSenha)`.
//   6. Redireciona para /login.
//
// TOKEN EXPIRA EM 1 HORA por padrão no Firebase
// (Authentication > Templates > Password reset > "Customize expiration
// time" no console). Não introduzimos token próprio.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Lock, Eye, EyeOff, CircleAlert, CircleCheck, ArrowRight } from "lucide-react";
import {
  redefinirSenha,
  verificarCodigoReset,
} from "../services/authService";

const INPUT_CLASSE =
  "w-full h-12 pl-11 pr-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20";

const BOTAO_PRIMARIO =
  "w-full h-12 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-60 disabled:pointer-events-none";

export default function NovaSenha() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oobCode = searchParams.get("oobCode") || searchParams.get("oob_code") || "";

  // Estado do token: "verificando" | "ok" | "invalido"
  // O estado inicial é derivado SÍNCRONAMENTE do oobCode na URL (sem
  // precisar de effect): se não há oobCode, já marcamos como inválido
  // direto. Caso haja, ficamos em "verificando" até a promise resolver.
  const [estadoToken, setEstadoToken] = useState(() =>
    oobCode ? "verificando" : "invalido",
  );
  const [emailVinculado, setEmailVinculado] = useState("");
  const [erroToken, setErroToken] = useState(() =>
    oobCode
      ? ""
      : "Link inválido. Solicite um novo link de recuperação em /esqueci-senha.",
  );

  // Campos do formulário
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrarNova, setMostrarNova] = useState(false);
  const [mostrarConfirmar, setMostrarConfirmar] = useState(false);

  // UI
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);

  // Garante que o efeito de validação rode APENAS UMA VEZ por oobCode,
  // mesmo sob StrictMode (que monta o componente duas vezes em dev) e
  // mesmo que o React re-emita o effect por alguma outra razão.
  const verificadoRef = useRef(false);

  useEffect(() => {
    // Se não há oobCode, o estado já foi inicializado como "invalido".
    // Nada a verificar.
    if (!oobCode) return;
    // StrictMode + re-emissões: roda 1x.
    if (verificadoRef.current) return;
    verificadoRef.current = true;

    verificarCodigoReset(oobCode).then((res) => {
      if (res.ok) {
        setEmailVinculado(res.email || "");
        setEstadoToken("ok");
      } else {
        setErroToken(res.erro);
        setEstadoToken("invalido");
      }
    });
  }, [oobCode]);

  // Regras de validação local dos campos. Reativam o feedback em tempo real.
  const senhaOk = useMemo(() => novaSenha.length >= 6, [novaSenha]);
  const confirmarOk = useMemo(
    () => confirmar.length >= 6 && confirmar === novaSenha,
    [confirmar, novaSenha],
  );
  const podeSalvar = senhaOk && confirmarOk && !salvando && !sucesso;

  async function handleSalvar(e) {
    e.preventDefault();
    if (!podeSalvar) return;
    setErro("");
    setSalvando(true);
    const res = await redefinirSenha(oobCode, novaSenha);
    setSalvando(false);
    if (res.ok) {
      setSucesso(true);
      // Redireciona para /login após 1.5s para o usuário ver a confirmação.
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } else {
      setErro(res.erro);
    }
  }

  // ----- Render -----

  // 1) Carregando o token
  if (estadoToken === "verificando") {
    return (
      <div className="min-h-svh flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <span className="w-7 h-7 border-2 border-slate-200 border-t-jurex rounded-full animate-spin" />
          <p className="text-sm font-medium">Validando link…</p>
        </div>
      </div>
    );
  }

  // 2) Token inválido / expirado
  if (estadoToken === "invalido") {
    return (
      <div className="min-h-svh flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-emerald-900/10 ring-1 ring-black/5 p-6 sm:p-8 text-center">
          <span className="inline-flex w-12 h-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 mx-auto">
            <CircleAlert className="w-6 h-6" />
          </span>
          <h1 className="mt-4 text-lg font-bold text-slate-800">
            Link inválido ou expirado
          </h1>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed">
            {erroToken}
          </p>
          <Link
            to="/esqueci-senha"
            className={BOTAO_PRIMARIO + " mt-6"}
          >
            Solicitar novo link
            <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            to="/login"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-jurex hover:text-jurex-dark transition"
          >
            Voltar para o login
          </Link>
        </div>
      </div>
    );
  }

  // 3) Sucesso — senha alterada
  if (sucesso) {
    return (
      <div className="min-h-svh flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-emerald-900/10 ring-1 ring-black/5 p-6 sm:p-8 text-center">
          <span className="inline-flex w-12 h-12 items-center justify-center rounded-2xl bg-emerald-50 text-jurex mx-auto">
            <CircleCheck className="w-6 h-6" />
          </span>
          <h1 className="mt-4 text-lg font-bold text-slate-800">
            Senha alterada!
          </h1>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed">
            Sua senha foi atualizada com sucesso. Você será redirecionado para
            o login em instantes.
          </p>
        </div>
      </div>
    );
  }

  // 4) Formulário principal — token válido, exibe o form.
  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-emerald-100 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-emerald-500/5 shadow-xl shadow-emerald-900/10 p-6 sm:p-8">
        {/* Cabeçalho verde claro — ícone cadeado + título + subtítulo */}
        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 p-4 sm:p-5">
          <span className="inline-flex w-10 h-10 items-center justify-center rounded-xl bg-jurex text-white shadow-md">
            <Lock className="w-5 h-5" strokeWidth={2.25} />
          </span>
          <h1 className="mt-4 text-xl font-extrabold text-slate-900 dark:text-white">
            Nova senha
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Escolha uma nova senha para sua conta.
          </p>
        </div>

        <form onSubmit={handleSalvar} className="mt-6 space-y-4">
          {/* E-mail (somente leitura) */}
          {emailVinculado && (
            <p className="text-xs text-slate-500 dark:text-slate-400 break-all">
              Conta:{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {emailVinculado}
              </span>
            </p>
          )}

          {/* NOVA SENHA */}
          <div>
            <label
              htmlFor="nova-senha"
              className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase"
            >
              Nova senha
            </label>
            <div className="relative mt-2">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400 pointer-events-none" />
              <input
                id="nova-senha"
                type={mostrarNova ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Mínimo 6 caracteres"
                value={novaSenha}
                onChange={(e) => {
                  setNovaSenha(e.target.value);
                  if (erro) setErro("");
                }}
                className={INPUT_CLASSE}
              />
              <button
                type="button"
                aria-label={mostrarNova ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setMostrarNova((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
              >
                {mostrarNova ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {novaSenha && !senhaOk && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-600">
                <CircleAlert className="w-3.5 h-3.5 shrink-0" />
                A senha deve ter no mínimo 6 caracteres.
              </p>
            )}
          </div>

          {/* CONFIRMAR SENHA */}
          <div>
            <label
              htmlFor="confirmar-senha"
              className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase"
            >
              Confirmar senha
            </label>
            <div className="relative mt-2">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400 pointer-events-none" />
              <input
                id="confirmar-senha"
                type={mostrarConfirmar ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repita a nova senha"
                value={confirmar}
                onChange={(e) => {
                  setConfirmar(e.target.value);
                  if (erro) setErro("");
                }}
                className={INPUT_CLASSE}
              />
              <button
                type="button"
                aria-label={mostrarConfirmar ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setMostrarConfirmar((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
              >
                {mostrarConfirmar ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {confirmar && !confirmarOk && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-600">
                <CircleAlert className="w-3.5 h-3.5 shrink-0" />
                As senhas não coincidem.
              </p>
            )}
          </div>

          {/* Erro geral (ex.: token expirou entre a validação e o submit) */}
          {erro && (
            <p className="flex items-center gap-1.5 text-xs text-red-500">
              <CircleAlert className="w-4 h-4 shrink-0" />
              {erro}
            </p>
          )}

          {/* Botão Salvar */}
          <button
            type="submit"
            disabled={!podeSalvar}
            className={BOTAO_PRIMARIO + " mt-2"}
          >
            Salvar nova senha
            {salvando ? (
              <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <ArrowRight className="w-5 h-5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}