import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  House,
  Pencil,
  Trash2,
  Phone,
  Mail,
  MapPin,
  FileText,
  File,
  UsersRound,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
} from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import { useEffectiveUid } from "../hooks/useEffectiveUid";
import { db } from "../services/firebase";
import {
  formatarMoeda,
  formatarData,
  formatarTelefone,
} from "../utils/formatadores";

// Cores do indicador de score por nível
const CORES_SCORE = {
  Baixo: "bg-red-50 dark:bg-red-500/10 text-red-500",
  Médio: "bg-amber-50 dark:bg-amber-500/10 text-amber-500",
  Alto: "bg-emerald-50 dark:bg-emerald-500/10 text-jurex",
};

// Normaliza um item da lista de documentos (string antiga ou objeto novo)
function interpretarDocumento(item) {
  if (typeof item === "string") return { nome: item, tamanho: null, url: null };
  if (item && typeof item === "object") {
    return {
      nome: item.nome ?? item.name ?? "Documento",
      tamanho: item.tamanho ?? item.size ?? null,
      url: item.url ?? null,
    };
  }
  return null;
}

// Formata o tamanho em bytes para exibição
function formatarTamanho(tamanho) {
  if (tamanho == null) return null;
  if (typeof tamanho === "string") return tamanho;
  if (tamanho >= 1048576) return `${(tamanho / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(tamanho / 1024))} KB`;
}

export default function PerfilCliente() {
  const { id } = useParams();
  const navigate = useNavigate();
  const effectiveUid = useEffectiveUid();

  const [cliente, setCliente] = useState(null);
  // carregando | pronto | nao-encontrado | erro
  const [estado, setEstado] = useState("carregando");
  const [contratos, setContratos] = useState([]);
  const [excluindo, setExcluindo] = useState(false);
  const [docAberto, setDocAberto] = useState(null); // documento no modal

  // Fecha o modal com a tecla Escape
  const fecharModal = useCallback(() => setDocAberto(null), []);
  useEffect(() => {
    if (!docAberto) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") fecharModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [docAberto, fecharModal]);

  // Busca o documento do cliente validando a posse (ownerId = uid autenticado).
  // O estado inicial já é "carregando"; resets ocorrem nos callbacks assíncronos.
  useEffect(() => {
    if (!effectiveUid || !id) return;
    let ativo = true;
    getDoc(doc(db, "clientes", id))
      .then((snap) => {
        if (!ativo) return;
        // Sem posse ou inexistente → trata como não encontrado (não vaza existência)
        if (!snap.exists() || snap.data().ownerId !== effectiveUid) {
          setCliente(null);
          setEstado("nao-encontrado");
          return;
        }
        setCliente({ id: snap.id, ...snap.data() });
        setEstado("pronto");
      })
      .catch((err) => {
        if (!ativo) return;
        setCliente(null);
        setEstado(
          err?.code === "permission-denied" ? "nao-encontrado" : "erro"
        );
      });
    return () => {
      ativo = false;
    };
  }, [effectiveUid, id]);

  // Escuta os contratos do escopo efetivo e filtra os vinculados a este cliente
  useEffect(() => {
    if (!effectiveUid || !cliente) return;
    const unsub = onSnapshot(
      collection(db, "usuarios", effectiveUid, "contratos"),
      (snap) => {
        const vinculados = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(
            (c) =>
              c.clienteId === cliente.id ||
              (!c.clienteId && c.nome === cliente.nomeCompleto)
          );
        setContratos(vinculados);
      },
      (err) => console.error("Erro ao ouvir contratos:", err)
    );
    return unsub;
  }, [effectiveUid, cliente]);

  // Totais calculados a partir dos contratos vinculados (sem valores fixos)
  const totais = useMemo(() => {
    let emprestado = 0;
    let recebido = 0;
    for (const c of contratos) {
      const principal = Number(c.valorEmprestado ?? c.valor ?? 0);
      const totalParcelas =
        Number(c.valorParcela ?? 0) * Number(c.numeroParcelas ?? 0);
      emprestado += principal > 0 ? principal : totalParcelas;
      recebido += Number(c.valorRecebido ?? c.totalRecebido ?? 0);
    }
    return { emprestado, recebido };
  }, [contratos]);

  // Lista de documentos reais gravados no documento do cliente
  const documentos = useMemo(
    () =>
      (Array.isArray(cliente?.documentos) ? cliente.documentos : [])
        .map(interpretarDocumento)
        .filter(Boolean),
    [cliente]
  );

  // Exclusão com confirmação; só exclui se o documento pertencer ao usuário
  async function excluir() {
    if (!cliente || excluindo) return;
    const ok = window.confirm(
      `Excluir o cliente "${cliente.nomeCompleto}"?\nEsta ação não pode ser desfeita.`
    );
    if (!ok) return;
    try {
      setExcluindo(true);
      const ref = doc(db, "clientes", cliente.id);
      const snap = await getDoc(ref);
      if (!snap.exists() || snap.data().ownerId !== effectiveUid) {
        window.alert("Você não tem permissão para excluir este cliente.");
        return;
      }
      await deleteDoc(ref);
      navigate("/clientes"); // onSnapshot da listagem atualiza sozinho
    } catch (err) {
      console.error("Erro ao excluir cliente:", err);
      window.alert("Não foi possível excluir o cliente. Tente novamente.");
    } finally {
      setExcluindo(false);
    }
  }

  // ---------- Estados de carregamento / erro ----------

  if (estado === "carregando") {
    return (
      <AppLayout>
        <div className="min-h-svh flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
          <LoaderCircle className="w-7 h-7 text-jurex animate-spin" />
          <p className="text-sm font-semibold">Carregando cliente...</p>
        </div>
      </AppLayout>
    );
  }

  if (estado === "nao-encontrado") {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <section className="mt-16 mb-16 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-4">
              <UsersRound className="w-7 h-7 text-slate-400" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
              Cliente não encontrado.
            </h2>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              Ele pode ter sido excluído ou não pertence à sua conta.
            </p>
            <button
              type="button"
              onClick={() => navigate("/clientes")}
              className="mt-5 h-11 px-5 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.98] transition"
            >
              Voltar para clientes
            </button>
          </section>
        </div>
      </AppLayout>
    );
  }

  if (estado === "erro" || !cliente) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <section className="mt-16 mb-16 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-red-50 dark:bg-red-950/30 p-4">
              <UsersRound className="w-7 h-7 text-red-400" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
              Algo deu errado
            </h2>
            <p className="mt-1.5 max-w-xs text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Não foi possível carregar este cliente agora. Verifique sua conexão
              e tente novamente.
            </p>
            <button
              type="button"
              onClick={() => navigate("/clientes")}
              className="mt-5 h-11 px-5 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.98] transition"
            >
              Voltar para clientes
            </button>
          </section>
        </div>
      </AppLayout>
    );
  }

  // ---------- Página completa ----------

  const score = cliente.scoreCredito;
  const corScore = CORES_SCORE[score];
  const inicial = (cliente.nomeCompleto ?? "?")
    .trim()
    .charAt(0)
    .toUpperCase();
  const criadoEm = formatarData(cliente.createdAt);

  const campos = [
    {
      rotulo: "Telefone",
      valor: formatarTelefone(cliente.telefone),
      icone: Phone,
    },
    { rotulo: "E-mail", valor: cliente.email, icone: Mail },
    { rotulo: "Endereço", valor: cliente.endereco, icone: MapPin },
  ];

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-4">
            <BackButton to="/clientes" />
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              aria-label="Início"
              className="rounded-full p-2 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <House className="w-4.5 h-4.5 text-slate-600 dark:text-slate-300" />
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Perfil do cliente
            </h1>
          </div>
        </div>

        {/* Card principal */}
        <section className="mt-5 rounded-3xl border border-emerald-100 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 via-emerald-50/60 to-emerald-100/70 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/20 px-5 sm:px-8 py-8">
          {/* Identidade */}
          <div className="flex flex-col items-center text-center">
            <span className="w-24 h-24 rounded-3xl overflow-hidden bg-gradient-to-r from-jurex to-emerald-500 shadow-lg shadow-jurex/25 flex items-center justify-center">
              {cliente.fotoUrl ? (
                <img
                  src={cliente.fotoUrl}
                  alt={`Foto de ${cliente.nomeCompleto}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-white text-4xl font-bold">{inicial}</span>
              )}
            </span>

            <h2 className="mt-4 text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white uppercase">
              {cliente.nomeCompleto}
            </h2>
            {criadoEm && (
              <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                Cliente desde {criadoEm}
              </p>
            )}
            {score && corScore && (
              <span
                className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${corScore}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                Score {score}
              </span>
            )}
          </div>

          {/* Resumo financeiro */}
          <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-500/30 bg-white/70 dark:bg-slate-800/60 px-5 py-4 text-center">
              <p className="text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                Emprestado
              </p>
              <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">
                {formatarMoeda(totais.emprestado)}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-500/30 bg-white/70 dark:bg-slate-800/60 px-5 py-4 text-center">
              <p className="text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
                Recebido
              </p>
              <p className="mt-1 text-lg font-extrabold text-jurex tabular-nums">
                {formatarMoeda(totais.recebido)}
              </p>
            </div>
          </div>
        </section>

        {/* Informações do cliente */}
        <section className="mt-5 space-y-3">
          {campos.map(({ rotulo, valor, icone: Icone }) => (
            <div
              key={rotulo}
              className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5"
            >
              <span className="shrink-0 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-2.5">
                <Icone className="w-5 h-5 text-jurex" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                  {rotulo}
                </p>
                <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                  {valor || "Não informado"}
                </p>
              </div>
            </div>
          ))}
        </section>

        {/* Editar / Excluir */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => navigate(`/clientes/${cliente.id}/editar`)}
            className="h-12 rounded-2xl border border-jurex/60 bg-white dark:bg-slate-900 text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center justify-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition"
          >
            <Pencil className="w-4.5 h-4.5 text-jurex" />
            Editar
          </button>
          <button
            type="button"
            onClick={excluir}
            disabled={excluindo}
            className="h-12 rounded-2xl border border-red-300 dark:border-red-500/40 bg-white dark:bg-slate-900 text-sm font-bold text-red-500 flex items-center justify-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30 transition disabled:opacity-60 disabled:pointer-events-none"
          >
            <Trash2 className="w-4.5 h-4.5" />
            {excluindo ? "Excluindo..." : "Excluir"}
          </button>
        </div>

        {/* Contratos */}
        <section className="mt-8 mb-12">
          <h2 className="text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
            Contratos
          </h2>

          {contratos.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-8 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Nenhum contrato vinculado.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {contratos.map((c) => {
                const ehVenda = c.nomeProduto != null;
                return (
                  <article
                    key={c.id}
                    onClick={() => navigate(`/emprestimos/${c.id}`)}
                    className="cursor-pointer flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5 hover:border-jurex/40 hover:shadow-md transition"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="shrink-0 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-2.5">
                        <FileText className="w-5 h-5 text-jurex" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                          {ehVenda ? `Venda · ${c.nomeProduto}` : "Empréstimo"}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          {c.numeroParcelas ?? "-"}x de{" "}
                          {formatarMoeda(c.valorParcela)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                        c.quitado
                          ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                          : "bg-emerald-50 dark:bg-emerald-500/10 text-jurex"
                      }`}
                    >
                      {c.quitado ? "Quitado" : "Ativo"}
                    </span>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Documentos */}
        <section className="mb-16">
          <h2 className="text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
            Documentos
          </h2>

          {documentos.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-8 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Nenhum documento.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {documentos.map((docItem, i) =>
                docItem.url ? (
                  <button
                    key={`${docItem.nome}-${i}`}
                    type="button"
                    onClick={() => setDocAberto(docItem)}
                    className="w-full text-left flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5 hover:border-jurex/40 transition cursor-pointer"
                  >
                    <DocumentoItem docItem={docItem} />
                  </button>
                ) : (
                  <div
                    key={`${docItem.nome}-${i}`}
                    className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5"
                  >
                    <DocumentoItem docItem={docItem} />
                  </div>
                )
              )}
            </div>
          )}
        </section>
      </div>

      {/* Modal de visualização do documento */}
      {docAberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={docAberto.nome}
          onClick={fecharModal}
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl p-5"
          >
            <div className="flex items-center justify-between gap-4">
              <p className="min-w-0 truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                {docAberto.nome}
              </p>
              <button
                type="button"
                onClick={fecharModal}
                aria-label="Fechar"
                className="shrink-0 rounded-full p-1.5 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={docAberto.url}
              alt={docAberto.nome}
              referrerPolicy="no-referrer"
              className="mt-4 w-full max-h-[70svh] object-contain rounded-xl bg-slate-50 dark:bg-slate-950"
            />
          </div>
        </div>
      )}
    </AppLayout>
  );
}

// Linha de documento (ícone + nome + tamanho)
function DocumentoItem({ docItem }) {
  const tamanho = formatarTamanho(docItem.tamanho);
  return (
    <>
      <span className="shrink-0 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-2.5">
        <File className="w-5 h-5 text-jurex" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
          {docItem.nome}
        </p>
        {tamanho && (
          <p className="text-xs text-slate-400">{tamanho}</p>
        )}
      </div>
    </>
  );
}
