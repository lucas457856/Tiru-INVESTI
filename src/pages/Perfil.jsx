import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Home,
  Sun,
  Moon,
  KeyRound,
  ChevronRight,
  Fingerprint,
  LogOut,
  Check,
  CircleAlert,
  LoaderCircle,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import { useAuth } from "../context/useAuth";
import { useTheme } from "../context/useTheme";
import { sair, buscarPerfil, solicitarRedefinicaoSenha } from "../services/authService";
import { db } from "../services/firebase";
import { doc, setDoc } from "firebase/firestore";
import {
  notifSuportada,
  solicitarPermissaoNotificacoes,
} from "../utils/notifications";

const INPUT_CLASSE =
  "w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 dark:text-slate-100 dark:bg-slate-900 outline-none transition focus:border-Cred Facil focus:ring-2 focus:ring-Cred Facil/20";

export default function Perfil() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const { tema, alternarTema } = useTheme();

  const [nome, setNome] = useState(usuario?.displayName ?? "");
  const [telefone, setTelefone] = useState("");
  const [salvo, setSalvo] = useState(false);

  // Estado do fluxo "Trocar senha" — reaproveita `esqueciSenha()` do
  // authService.js. O Firebase envia um e-mail com link de redefinição
  // para o e-mail da sessão; a página /nova-senha só é aberta quando
  // o usuário clica no link do e-mail (não direto da UI).
  const [enviandoSenha, setEnviandoSenha] = useState(false);
  const [senhaMsgOk, setSenhaMsgOk] = useState("");
  const [senhaMsgErro, setSenhaMsgErro] = useState("");

  // Estado de permissão de notificações do navegador.
  // Mesmo padrão do Dashboard: sincroniza com Notification.permission no mount
  // e respeita granted/denied/unsupported sem re-solicitar.
  const [notifPermissao, setNotifPermissao] = useState(
    notifSuportada() ? Notification.permission : "unsupported"
  );
  useEffect(() => {
    if (notifSuportada()) setNotifPermissao(Notification.permission);
  }, []);

  // Ativação de notificações. Igual ao Dashboard: chamada SÍNCRONA
  // no caminho síncrono do click handler para preservar o user gesture
  // do Chrome (sem await antes de Notification.requestPermission()).
  function ativarNotificacoesPerfil() {
    if (!notifSuportada() || notifPermissao !== "default") return;
    const promise = solicitarPermissaoNotificacoes();
    if (promise && typeof promise.then === "function") {
      promise
        .then((r) => {
          if (
            r === "granted" ||
            r === "denied" ||
            r === "default" ||
            r === "unsupported"
          ) {
            setNotifPermissao(r);
          }
        })
        .catch((err) => {
          console.error("Falha ao solicitar permissão de notificação:", err);
        });
    }
  }

  // Carrega os dados do perfil gravados no Firestore
  useEffect(() => {
    if (!usuario) return;
    buscarPerfil(usuario.uid).then((p) => {
      if (p) {
        if (p.nome) setNome(p.nome);
        if (p.telefone) setTelefone(p.telefone);
      }
    });
  }, [usuario]);

  async function salvar(e) {
    e.preventDefault();
    await setDoc(
      doc(db, "usuarios", usuario.uid),
      { nome, telefone },
      { merge: true }
    );
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2500);
  }

  // Handler de "Trocar senha" — chama a API serverless que dispara o
  // e-mail HTML personalizado (Firebase Admin + Resend). Pega o e-mail
  // da sessão atual (NÃO pede para o usuário digitar de novo).
  // Após sucesso, a única forma de chegar em /nova-senha é clicando
  // no botão "Redefinir senha →" dentro do e-mail — não navegamos
  // manualmente daqui.
  async function handleTrocarSenha() {
    if (enviandoSenha) return; // anti-double-click
    const email = (usuario?.email || "").trim();
    if (!email) {
      setSenhaMsgErro("Não foi possível identificar o e-mail da conta atual.");
      setSenhaMsgOk("");
      return;
    }
    setSenhaMsgOk("");
    setSenhaMsgErro("");
    setEnviandoSenha(true);
    const res = await solicitarRedefinicaoSenha(email);
    setEnviandoSenha(false);
    if (res.ok) {
      setSenhaMsgOk("✓ Email enviado! Verifique sua caixa de entrada.");
    } else {
      setSenhaMsgErro(
        res.erro || "Não foi possível enviar o e-mail de recuperação.",
      );
    }
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Cabeçalho com voltar */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-4">
            <BackButton />
            <button
              type="button"
              aria-label="Início"
              onClick={() => navigate("/dashboard")}
              className="rounded-full p-2 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <Home className="w-4.5 h-4.5 text-slate-600 dark:text-slate-300" />
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Perfil</h1>
          </div>
        </div>

        {/* Banner de feedback do "Trocar senha" — fica no topo, abaixo
            do cabeçalho, exatamente como no mockup fornecido. Some
            automaticamente após 6s (sucesso) ou 8s (erro). */}
        {senhaMsgOk && (
          <div
            role="status"
            className="mt-4 flex items-start gap-2.5 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
          >
            <span className="mt-0.5 inline-flex w-5 h-5 items-center justify-center rounded-full bg-emerald-500 text-white shrink-0">
              <Check className="w-3 h-3" strokeWidth={3} />
            </span>
            <span>{senhaMsgOk}</span>
          </div>
        )}
        {senhaMsgErro && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-2xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-300"
          >
            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{senhaMsgErro}</span>
          </div>
        )}

        {/* Cartão do usuário */}
        <div className="mt-5 flex items-center gap-4 rounded-2xl border border-emerald-100 dark:border-emerald-500/20 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-slate-900 p-5">
          <span className="w-14 h-14 rounded-2xl bg-emerald-500 text-white text-xl font-bold flex items-center justify-center">
            {(nome || "?").trim().charAt(0).toUpperCase()}
          </span>
          <div>
            <p className="text-xs text-slate-500">Perfil</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white uppercase">
              {nome || "Sem nome"}
            </p>
            <p className="text-sm text-slate-500">{usuario?.email}</p>
          </div>
        </div>

        {/* Aparência */}
        <section className="mt-7">
          <h2 className="text-xs font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
            Aparência
          </h2>
          <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="text-xs font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
              Tema
            </p>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-slate-100 dark:bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => alternarTema("claro")}
                className={`flex items-center justify-center gap-2 rounded-full h-11 text-sm font-bold transition ${
                  tema === "claro"
                    ? "bg-emerald-500 text-white shadow"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
                }`}
              >
                <Sun className="w-4 h-4" />
                Claro
              </button>
              <button
                type="button"
                onClick={() => alternarTema("escuro")}
                className={`flex items-center justify-center gap-2 rounded-full h-11 text-sm font-bold transition ${
                  tema === "escuro"
                    ? "bg-emerald-500 text-white shadow"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
                }`}
              >
                <Moon className="w-4 h-4" />
                Escuro
              </button>
            </div>
          </div>
        </section>

        {/* Dados do perfil */}
        <form onSubmit={salvar}>
          <section className="mt-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-xs font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
              Perfil
            </h2>

            <label
              htmlFor="perfil-nome"
              className="mt-4 block text-xs font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase"
            >
              Nome
            </label>
            <input
              id="perfil-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className={`mt-2 ${INPUT_CLASSE}`}
            />

            <label
              htmlFor="perfil-telefone"
              className="mt-4 block text-xs font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase"
            >
              Telefone
            </label>
            <input
              id="perfil-telefone"
              value={telefone}
              onChange={(e) => setTelefone(formatarTelefone(e.target.value))}
              className={`mt-2 ${INPUT_CLASSE}`}
            />

            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit"
                className="rounded-lg bg-emerald-500 px-5 h-10 text-sm font-bold text-white shadow hover:bg-emerald-600 transition"
              >
                Salvar
              </button>
              {salvo && (
                <span className="text-xs font-semibold text-emerald-600">
                  Salvo!
                </span>
              )}
            </div>
          </section>
        </form>

        {/* Segurança */}
        <section className="mt-7">
          <h2 className="text-xs font-semibold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
            Segurança
          </h2>
          <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            <button
              type="button"
              onClick={handleTrocarSenha}
              disabled={enviandoSenha}
              className="w-full flex items-center justify-between px-5 py-4 group disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-3">
                <span className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-2">
                  <KeyRound className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400" />
                </span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {enviandoSenha ? "Enviando e-mail…" : "Trocar senha"}
                </span>
              </span>
              {enviandoSenha ? (
                <LoaderCircle className="w-4 h-4 text-slate-400 animate-spin" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition" />
              )}
            </button>
            <div className="px-5 pb-5 pt-4">
              <button
                type="button"
                onClick={ativarNotificacoesPerfil}
                disabled={!notifSuportada() || notifPermissao !== "default"}
                className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-sm font-bold text-white shadow flex items-center justify-center gap-2 hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Fingerprint className="w-5 h-5" />
                {notifPermissao === "granted"
                  ? "Notificações ativadas"
                  : notifPermissao === "denied"
                    ? "Notificações bloqueadas"
                    : !notifSuportada()
                      ? "Notificações indisponíveis"
                      : "Ativar notificações push"}
              </button>
            </div>
          </div>
        </section>

        {/* Sair da conta */}
        <button
          type="button"
          onClick={async () => {
            await sair();
            navigate("/login");
          }}
          className="mt-7 mb-10 w-full h-13 rounded-2xl border border-red-200 text-red-500 text-base font-bold flex items-center justify-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
        >
          <LogOut className="w-5 h-5" />
          Sair da conta
        </button>
      </div>
    </AppLayout>
  );
}

function formatarTelefone(valor) {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.replace(/(\d{0,2})/, "($1");
  if (d.length <= 6) return d.replace(/(\d{2})(\d{0,4})/, "($1) $2");
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3");
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
}
