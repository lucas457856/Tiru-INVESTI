import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Lock,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { collection, onSnapshot, query } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";
import { useAuth } from "../context/useAuth";
import { db } from "../services/firebase";

export default function Funcionarios() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const [funcionarios, setFuncionarios] = useState([]);

  // TODO: assinatura paga controla o desbloqueio
  const assinaturaAtiva = false;

  // Escuta os funcionários cadastrados em tempo real
  useEffect(() => {
    if (!usuario) return;
    const unsub = onSnapshot(
      query(collection(db, "usuarios", usuario.uid, "funcionarios")),
      (snap) => setFuncionarios(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, [usuario]);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <BackButton />
            <HomeButton />
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                Funcionários
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {funcionarios.length} cadastrado(s)
              </p>
            </div>
          </div>
        </div>

        {/* Aviso de assinatura */}
        {!assinaturaAtiva && (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-amber-300/70 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10 px-5 py-3.5">
            <Lock className="w-4.5 h-4.5 shrink-0 text-amber-500" />
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              Gerenciar funcionários requer uma assinatura paga ativa.
            </p>
          </div>
        )}

        {/* Adicionar funcionário */}
        <button
          type="button"
          disabled={!assinaturaAtiva}
          title={
            assinaturaAtiva
              ? undefined
              : "Requer assinatura paga ativa"
          }
          onClick={() => navigate("/configuracoes/meus-planos")}
          className="mt-5 mx-auto max-w-md w-full h-12 rounded-2xl bg-gradient-to-r from-Cred Facil to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-Cred Facil/30 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-50 disabled:pointer-events-none"
        >
          <UserPlus className="w-5 h-5" />
          Adicionar funcionário
        </button>

        {/* Lista ou estado vazio */}
        {funcionarios.length === 0 ? (
          <section className="mt-14 mb-16 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-100 dark:ring-emerald-500/20 p-4">
              <UsersRound className="w-7 h-7 text-Cred Facil" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
              Nenhum funcionário cadastrado
            </h2>
            <p className="mt-1.5 max-w-xs text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Adicione funcionários para que eles acessem seus clientes e
              contratos com login próprio.
            </p>
          </section>
        ) : (
          <section className="mt-8 mb-12 space-y-3">
            {funcionarios.map(({ id, nome, email }) => (
              <article
                key={id}
                className="flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-emerald-500 text-white font-bold flex items-center justify-center">
                    {(nome ?? "?").charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      {nome}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {email}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </AppLayout>
  );
}
