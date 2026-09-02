import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
  UsersRound,
} from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import NotificationBellButton from "../components/NotificationBellButton";
import { useAuth } from "../context/useAuth";
import { db } from "../services/firebase";

export default function Clientes() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const [clientes, setClientes] = useState([]);
  const [busca, setBusca] = useState("");

  // Escuta somente os clientes do usuário autenticado (ownerId = uid).
  // Ordenação por createdAt feita em memória para dispensar índice composto.
  useEffect(() => {
    if (!usuario) return;
    const unsub = onSnapshot(
      query(collection(db, "clientes"), where("ownerId", "==", usuario.uid)),
      (snap) => {
        const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Timestamp do Firestore → segundos; ISO string → epoch ms; ausente → 0
        const chave = (c) =>
          c.createdAt?.seconds ??
          (c.createdAt ? new Date(c.createdAt).getTime() / 1000 : 0);
        lista.sort((a, b) => chave(a) - chave(b));
        setClientes(lista);
      }
    );
    return unsub;
  }, [usuario]);

  // Filtra por nome ou CPF
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter(
      (c) =>
        (c.nomeCompleto ?? "").toLowerCase().includes(q) ||
        (c.cpf ?? "").includes(q)
    );
  }, [clientes, busca]);

  function formatarCpf(cpf) {
    if (!cpf) return "-";
    const d = cpf.replace(/\D/g, "").padStart(11, "0");
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                Clientes
              </h1>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {clientes.length} cadastrado(s)
              </p>
            </div>
            <NotificationBellButton />
          </div>
        </div>

        {/* Busca + Cadastrar */}
        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400 pointer-events-none" />
            <input
              id="busca-cliente"
              type="search"
              placeholder="Buscar por nome ou CPF"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full h-12 pl-11 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
            />
          </div>
          <button
            type="button"
            onClick={() => navigate("/clientes/novo")}
            className="h-12 px-5 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition shrink-0"
          >
            <Plus className="w-4.5 h-4.5" />
            Cadastrar cliente
          </button>
        </div>

        {/* Lista ou estado vazio */}
        {clientes.length === 0 ? (
          <section className="mt-14 mb-16 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-100 dark:ring-emerald-500/20 p-4">
              <UsersRound className="w-7 h-7 text-jurex" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
              Nenhum cliente cadastrado
            </h2>
            <p className="mt-1.5 max-w-xs text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Adicione seu primeiro cliente para começar a registrar empréstimos.
            </p>
            <button
              type="button"
              onClick={() => navigate("/clientes/novo")}
              className="mt-5 h-11 px-5 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.98] transition"
            >
              Cadastrar primeiro cliente
            </button>
          </section>
        ) : filtrados.length === 0 ? (
          <section className="mt-14 mb-16 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-4">
              <Search className="w-7 h-7 text-slate-400" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
              Nenhum resultado
            </h2>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              Nenhum cliente corresponde a "{busca}".
            </p>
          </section>
        ) : (
          <section className="mt-8 mb-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtrados.map(({ id, nomeCompleto, cpf, email, fotoUrl }) => (
              <article
                key={id}
                onClick={() => navigate(`/clientes/${id}`)}
                className="cursor-pointer rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 hover:border-jurex/40 hover:shadow-md transition"
              >
                <div className="flex items-center gap-3">
                  <span className="w-11 h-11 rounded-xl bg-emerald-500 text-white font-bold flex items-center justify-center overflow-hidden">
                    {fotoUrl ? (
                      <img
                        src={fotoUrl}
                        alt={`Foto de ${nomeCompleto}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      (nomeCompleto ?? "?").charAt(0).toUpperCase()
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {nomeCompleto}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatarCpf(cpf)}
                    </p>
                  </div>
                </div>
                {email && (
                  <p className="mt-3 truncate text-xs text-slate-500 dark:text-slate-400">
                    {email}
                  </p>
                )}
              </article>
            ))}
          </section>
        )}
      </div>
    </AppLayout>
  );
}
