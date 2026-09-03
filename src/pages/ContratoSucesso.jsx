import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  House,
  Check,
  FileText,
  Send,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../context/useAuth";
import { db } from "../services/firebase";
import { formatarMoeda, formatarTelefone, numeroCurto as numeroContrato } from "../utils/formatadores";
import { gerarPdfContrato } from "../utils/pdfContrato";
import logoJurex from "../assets/jurex-logo.png";

export default function ContratoSucesso() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();

  const [contrato, setContrato] = useState(null);
  const [cliente, setCliente] = useState(null);
  // carregando | pronto | nao-encontrado | erro
  const [estado, setEstado] = useState("carregando");
  const [gerandoPdf, setGerandoPdf] = useState(false);

  // Busca o contrato pelo ID validando a posse (subcoleção do usuário autenticado)
  useEffect(() => {
    if (!usuario || !id) return;
    let ativo = true;
    getDoc(doc(db, "usuarios", usuario.uid, "contratos", id))
      .then((snap) => {
        if (!ativo) return;
        if (!snap.exists()) {
          setEstado("nao-encontrado");
          return;
        }
        const dados = { id: snap.id, ...snap.data() };
        setContrato(dados);
        // Telefone do cliente para o WhatsApp (busca tolerante a falha)
        if (dados.clienteId) {
          getDoc(doc(db, "clientes", dados.clienteId))
            .then((c) => {
              if (ativo && c.exists() && c.data().ownerId === usuario.uid) {
                setCliente({ id: c.id, ...c.data() });
              }
            })
            .catch(() => {});
        }
        setEstado("pronto");
      })
      .catch(() => {
        if (ativo) setEstado("erro");
      });
    return () => {
      ativo = false;
    };
  }, [usuario, id]);

  // Linhas do card com os dados reais do contrato
  const linhas = useMemo(() => {
    if (!contrato) return [];
    return [
      { rotulo: "Número do contrato", valor: numeroContrato(contrato.id), destaque: false },
      { rotulo: "Cliente", valor: contrato.clienteNome ?? "—", destaque: false },
      { rotulo: "Valor", valor: formatarMoeda(contrato.valorEmprestado), destaque: true },
      { rotulo: "Parcelas", valor: String(contrato.numeroParcelas ?? "—"), destaque: false },
      { rotulo: "Frequência", valor: contrato.frequencia ?? "—", destaque: false },
    ];
  }, [contrato]);

  // PDF do contrato recém-criado (comprovante financeiro completo)
  async function gerarPdf() {
    if (!contrato || gerandoPdf) return;
    setGerandoPdf(true);
    try {
      gerarPdfContrato({ contrato, cliente, logoDataUrl: logoJurex });
    } finally {
      setGerandoPdf(false);
    }
  }

  // WhatsApp com o telefone real do cliente
  function enviarWhatsapp() {
    if (!contrato) return;
    const telefone = formatarTelefone(cliente?.telefone ?? "").replace(/\D/g, "");
    if (!telefone) {
      window.alert("Este cliente não tem telefone cadastrado.");
      return;
    }
    const mensagem = [
      `*Contrato ${numeroContrato(contrato.id)}*`,
      `Cliente: ${contrato.clienteNome ?? "-"}`,
      `Valor: ${formatarMoeda(contrato.valorEmprestado)}`,
      `Parcelas: ${contrato.numeroParcelas ?? "-"}x de ${formatarMoeda(contrato.valorParcela)}`,
      `Frequência: ${contrato.frequencia ?? "-"}`,
    ].join("\n");
    window.open(
      `https://wa.me/55${telefone}?text=${encodeURIComponent(mensagem)}`,
      "_blank",
      "noopener"
    );
  }

  if (estado === "carregando") {
    return (
      <AppLayout>
        <div className="min-h-svh flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
          <LoaderCircle className="w-7 h-7 text-jurex animate-spin" />
          <p className="text-sm font-semibold">Carregando contrato...</p>
        </div>
      </AppLayout>
    );
  }

  if (estado !== "pronto" || !contrato) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <section className="mt-16 mb-16 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 p-4">
              <TriangleAlert className="w-7 h-7 text-amber-500" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
              {estado === "erro"
                ? "Não foi possível carregar o contrato."
                : "Contrato não encontrado."}
            </h2>
            <button
              type="button"
              onClick={() => navigate("/emprestimos")}
              className="mt-5 h-11 px-5 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.98] transition"
            >
              Voltar para contratos
            </button>
          </section>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 mb-10">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate("/emprestimos")}
              aria-label="Voltar"
              className="rounded-full p-2 ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 transition"
            >
              <ArrowLeft className="w-4.5 h-4.5 text-slate-700 dark:text-slate-200" />
            </button>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              aria-label="Início"
              className="rounded-full p-2 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <House className="w-4.5 h-4.5 text-slate-600 dark:text-slate-300" />
            </button>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Novo contrato
            </h1>
          </div>
        </div>

        {/* Confirmação */}
        <section className="mt-10 flex flex-col items-center text-center">
          <span className="rounded-full bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-100 dark:ring-emerald-500/20 p-4">
            <span className="rounded-full bg-jurex p-3 flex items-center justify-center shadow-lg shadow-jurex/30">
              <Check className="w-7 h-7 text-white stroke-[3]" />
            </span>
          </span>
          <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-snug">
            Contrato criado
            <br />
            com sucesso!
          </h2>
        </section>

        {/* Card de resumo com os dados reais */}
        <section className="mt-8 rounded-3xl border border-emerald-100 dark:border-emerald-500/20 bg-white dark:bg-slate-900 shadow-sm divide-y divide-slate-100 dark:divide-slate-800 px-5 sm:px-6">
          {linhas.map(({ rotulo, valor, destaque }) => (
            <div key={rotulo} className="py-4">
              <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                {rotulo}
              </p>
              <p
                className={`mt-0.5 text-sm font-extrabold tabular-nums ${
                  destaque ? "text-jurex" : "text-slate-900 dark:text-white"
                }`}
              >
                {valor}
              </p>
            </div>
          ))}
        </section>

        <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
          Compartilhe o contrato com o cliente por PDF ou WhatsApp.
        </p>

        {/* Ações de compartilhamento */}
        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={gerarPdf}
            disabled={gerandoPdf}
            className="w-full h-13 rounded-2xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition disabled:opacity-60 disabled:pointer-events-none"
          >
            {gerandoPdf ? (
              <LoaderCircle className="w-4.5 h-4.5 animate-spin" />
            ) : (
              <FileText className="w-4.5 h-4.5" />
            )}
            {gerandoPdf ? "Gerando PDF..." : "Compartilhar contrato em PDF"}
          </button>
          <button
            type="button"
            onClick={enviarWhatsapp}
            className="w-full h-13 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            <Send className="w-4.5 h-4.5 text-jurex" />
            Enviar contrato via WhatsApp
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigate(`/emprestimos/${contrato.id}`)}
          className="mt-8 w-full text-center text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-jurex transition"
        >
          Voltar ao contrato
        </button>
      </div>
    </AppLayout>
  );
}
