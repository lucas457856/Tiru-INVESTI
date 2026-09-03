import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
  FileText,
  Lock,
} from "lucide-react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import HomeButton from "../components/HomeButton";
import NotificationBellButton from "../components/NotificationBellButton";
import { useEffectiveUid } from "../hooks/useEffectiveUid";
import { useDonoAdmin } from "../hooks/useDonoAdmin";
import { db } from "../services/firebase";
import { numeroCurto } from "../utils/formatadores";
import { calculateDebtRemaining, calcularStatusContrato } from "../services/paymentCalculations";

const STATUS = ["Todos", "Em dia", "Atrasados", "Quitados"];

function formatarMoeda(v) {
  return (v ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarData(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d) ? "-" : d.toLocaleDateString("pt-BR");
}

// Status real do contrato a partir da PRÓXIMA PARCELA NÃO PAGA
// (fonte única de verdade — reaproveita `calcularStatusContrato`).
function statusContrato(c, hoje) {
  return calcularStatusContrato(c, hoje);
}

export default function Emprestimos() {
  const navigate = useNavigate();
  const effectiveUid = useEffectiveUid();
  // Limites, permissões e status do DONO (defaults permissivos
  // aplicados automaticamente — ver useDonoAdmin). Usado para
  // desabilitar o botão "Novo contrato" quando o limite é atingido,
  // exibir banner explicativo e impedir navegação para a tela
  // de cadastro. A defesa real é o endpoint server-side
  // /api/admin/criar-contrato, que valida o limite no Admin SDK
  // e o Firestore Rules nega create direto do client SDK.
  const { permissoes, limites, status: statusDono, loading: loadingDono } = useDonoAdmin();

  const [contratos, setContratos] = useState([]);
  const [status, setStatus] = useState("Todos");
  const [busca, setBusca] = useState("");

  // Regra de bloqueio do front (UX). Espelha Clientes.jsx.
  //   limite.contratos = 0 significa "sem limite" — não bloqueia.
  //   permissoes.criarContratos = false → bloqueia sempre.
  //   status = "bloqueado" → bloqueia sempre.
  const limiteContratos = limites.contratos;
  const limiteAtingido =
    !loadingDono &&
    statusDono !== "bloqueado" &&
    permissoes.criarContratos !== false &&
    limiteContratos > 0 &&
    contratos.length >= limiteContratos;
  const contaBloqueada = statusDono === "bloqueado";
  const permissaoNegada =
    !contaBloqueada && permissoes.criarContratos === false;
  const cadastroBloqueado = contaBloqueada || permissaoNegada || limiteAtingido;

  // Função única usada pelos botões "Novo contrato", "Criar
  // primeiro contrato" e o FAB flutuante. Se a criação estiver
  // bloqueada, NÃO navega para a tela de cadastro.
  function tentarIrParaCadastro() {
    if (cadastroBloqueado) return;
    navigate("/contratos/novo");
  }

  // Escuta os contratos do escopo efetivo em tempo real
  useEffect(() => {
    if (!effectiveUid) return;
    const path = `usuarios/${effectiveUid}/contratos`;
    console.log("[CONTRATOS] query path:", path);
    const unsub = onSnapshot(
      query(collection(db, "usuarios", effectiveUid, "contratos"), orderBy("criadoEm", "desc")),
      (snap) => {
        console.log("[CONTRATOS] snap recebido, docs:", snap.size);
        setContratos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error("[CONTRATOS] erro:", {
          code: err.code,
          message: err.message,
          effectiveUid,
        });
      }
    );
    return unsub;
  }, [effectiveUid]);

  // Filtra por status real e busca
  const filtrados = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const q = busca.trim().toLowerCase();
    return contratos.filter((c) => {
      const st = statusContrato(c, hoje);
      if (status === "Em dia" && st !== "Em dia") return false;
      if (status === "Atrasados" && st !== "Atrasado") return false;
      if (status === "Quitados" && st !== "Quitado") return false;
      if (!q) return true;
      return (
        (c.nome ?? "").toLowerCase().includes(q) ||
        String(c.valorEmprestado ?? c.totalReceber ?? "").includes(q)
      );
    });
  }, [contratos, status, busca]);

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <BackButton />
              <HomeButton />
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  Contratos
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {contratos.length} contrato(s)
                </p>
              </div>
            </div>
            <NotificationBellButton />
          </div>
        </div>

        {/* Busca + Novo contrato */}
        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400 pointer-events-none" />
            <input
              id="busca-contrato"
              type="search"
              placeholder="Buscar por cliente ou valor"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full h-12 pl-11 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
            />
          </div>
          <button
            type="button"
            onClick={tentarIrParaCadastro}
            disabled={cadastroBloqueado}
            title={
              cadastroBloqueado
                ? contaBloqueada
                  ? "Conta bloqueada. Entre em contato com o administrador."
                  : permissaoNegada
                  ? "Seu plano não permite criar contratos."
                  : "Limite de contratos atingido. Entre em contato com o administrador para aumentar seu limite."
                : "Criar novo contrato"
            }
            className={`h-12 px-5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shrink-0 transition ${
              cadastroBloqueado
                ? "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                : "bg-gradient-to-r from-jurex to-emerald-500 text-white shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99]"
            }`}
          >
            {cadastroBloqueado ? (
              <Lock className="w-4.5 h-4.5" />
            ) : (
              <Plus className="w-4.5 h-4.5" />
            )}
            Novo contrato
          </button>
        </div>

        {/* Banner de bloqueio: limite/permissão/status */}
        {cadastroBloqueado && !loadingDono && (
          <div
            role="alert"
            className="mt-4 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 flex items-start gap-3"
          >
            <span className="shrink-0 mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-500/20">
              <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            </span>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300 leading-relaxed">
              {contaBloqueada
                ? "Conta bloqueada. Entre em contato com o administrador."
                : permissaoNegada
                ? "A criação de contratos foi bloqueada pelo administrador. Entre em contato para liberar."
                : `Limite de contratos atingido. Seu limite atual é de ${limiteContratos} ${
                    limiteContratos === 1 ? "contrato" : "contratos"
                  }. Entre em contato com o administrador para aumentar seu limite.`}
            </p>
          </div>
        )}

        {/* Filtros de status */}
        <div className="mt-4 flex flex-wrap gap-2">
          {STATUS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`h-9 px-4 rounded-full text-xs font-bold transition ${
                status === s
                  ? "bg-emerald-500 text-white shadow"
                  : "bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400 hover:border-jurex/40"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Lista ou estado vazio */}
        {contratos.length === 0 ? (
          <section className="mt-14 mb-24 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-100 dark:ring-emerald-500/20 p-4">
              <FileText className="w-7 h-7 text-jurex" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
              Nenhum contrato cadastrado
            </h2>
            <p className="mt-1.5 max-w-xs text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Cadastre seu primeiro contrato de empréstimo ou venda para começar a receber pagamentos.
            </p>
            <button
              type="button"
              onClick={tentarIrParaCadastro}
              disabled={cadastroBloqueado}
              className={`mt-5 h-11 px-5 rounded-xl text-sm font-bold transition ${
                cadastroBloqueado
                  ? "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-jurex to-emerald-500 text-white shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.98]"
              }`}
            >
              {cadastroBloqueado ? "Criação indisponível" : "Criar primeiro contrato"}
            </button>
            {cadastroBloqueado && !loadingDono && (
              <p className="mt-3 max-w-xs text-xs text-amber-700 dark:text-amber-300">
                {contaBloqueada
                  ? "Conta bloqueada. Entre em contato com o administrador."
                  : permissaoNegada
                  ? "A criação de contratos foi bloqueada pelo administrador."
                  : `Limite de contratos atingido (${limiteContratos}). Entre em contato com o administrador para aumentar.`}
              </p>
            )}
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
              Nenhum contrato corresponde à busca ou filtro.
            </p>
          </section>
        ) : (
          <section className="mt-6 mb-28 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtrados.map((c) => {
              const hoje = new Date();
              hoje.setHours(0, 0, 0, 0);
              const st = statusContrato(c, hoje);
              const total = Number(c.numeroParcelas) || 0;
              const pagas = c.quitado ? total : Math.min(Number(c.parcelasPagas) || 0, total);
              const progresso = total > 0 ? (pagas / total) * 100 : 0;
              const saldoPrincipal = c.quitado ? 0 : calculateDebtRemaining(c);
              return (
                <article
                  key={c.id}
                  onClick={() => navigate(`/emprestimos/${c.id}`)}
                  className="cursor-pointer rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm hover:border-jurex/40 hover:shadow-md transition"
                >
                  {/* Nome + badge de status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold uppercase text-slate-900 dark:text-white">
                        {(c.nome ?? "Contrato").toUpperCase()}
                      </p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {numeroCurto(c.id)}
                        {c.juros ? ` · ${c.juros}% a.m.` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        st === "Atrasado"
                          ? "bg-red-50 dark:bg-red-500/10 text-red-500"
                          : st === "Quitado"
                            ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                            : "bg-emerald-50 dark:bg-emerald-500/10 text-jurex"
                      }`}
                    >
                      {st}
                    </span>
                  </div>

                  {/* Valor original + saldo atual */}
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Original: {formatarMoeda(c.valorEmprestado)}
                      </p>
                      <p className="text-lg font-extrabold tabular-nums text-jurex">
                        Saldo: {formatarMoeda(saldoPrincipal)}
                      </p>
                    </div>
                    <p className="text-xs font-semibold text-slate-400">{total}x</p>
                  </div>

                  {/* Progresso do pagamento */}
                  <div className="mt-2.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-jurex transition-all"
                      style={{ width: `${progresso}%` }}
                    />
                  </div>

                  {/* Rodapé: parcelas pagas + próximo vencimento */}
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      {pagas} de {total} pagas
                    </span>
                    <span>
                      {st === "Quitado"
                        ? "Quitado"
                        : c.dataProximo
                          ? `Próx: ${formatarData(c.dataProximo)}`
                          : "Sem vencimento"}
                    </span>
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {/* Botão flutuante novo contrato */}
        {contratos.length > 0 && (
          <button
            type="button"
            aria-label="Novo contrato"
            onClick={tentarIrParaCadastro}
            disabled={cadastroBloqueado}
            title={
              cadastroBloqueado
                ? contaBloqueada
                  ? "Conta bloqueada"
                  : permissaoNegada
                  ? "Criação bloqueada pelo administrador"
                  : "Limite de contratos atingido"
                : "Novo contrato"
            }
            className={`fixed bottom-6 right-6 w-14 h-14 rounded-full text-white flex items-center justify-center transition ${
              cadastroBloqueado
                ? "bg-slate-300 dark:bg-slate-700 cursor-not-allowed"
                : "bg-gradient-to-r from-jurex to-emerald-500 shadow-lg shadow-jurex/40 hover:brightness-105 active:scale-95"
            }`}
          >
            {cadastroBloqueado ? (
              <Lock className="w-6 h-6 text-slate-500 dark:text-slate-400" />
            ) : (
              <Plus className="w-6 h-6" />
            )}
          </button>
        )}
      </div>
    </AppLayout>
  );
}
