import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  House,
  LoaderCircle,
  TriangleAlert,
  Calendar,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import { useAuth } from "../context/useAuth";
import {
  formatarMoeda,
  formatarData,
  numeroCurto,
} from "../utils/formatadores";
import {
  buscarContrato,
  statusContrato,
  parcelasDoContrato,
  renegociarParcela,
} from "../services/contractService";
import { HOJE } from "../services/paymentCalculations";

// Converte string "YYYY-MM-DD" → Date no horário local (sem drift UTC)
function parseLocal(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// Formata Date ou string YYYY-MM-DD para "DD/MM/AAAA"
function formatarDataInput(data) {
  if (!data) return "";
  const d = typeof data === "string" ? parseLocal(data) : data;
  if (!d || Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

// Converte "DD/MM/AAAA" → "YYYY-MM-DD"
function formatarDataParaBackend(s) {
  if (!s) return "";
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.test(s)
    ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
    : null;
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}

// Valida "DD/MM/AAAA" e retorna true/false
function validarDataInput(s) {
  if (!s) return false;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return false;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return (
    d.getFullYear() === Number(m[3]) &&
    d.getMonth() === Number(m[2]) - 1 &&
    d.getDate() === Number(m[1])
  );
}

// Converte valor monetário input (dígitos) → número decimal
function parseMoedaInput(valor) {
  const digits = String(valor).replace(/\D/g, "");
  if (!digits) return 0;
  return Number(digits) / 100;
}

// Formata número → "R$ 0,00"
function formatarMoedaInput(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const STATUS_CONTRATO = {
  Quitado: { classe: "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400", label: "Quitado" },
  Atrasado: { classe: "bg-red-50 dark:bg-red-500/10 text-red-500", label: "Atrasado" },
  "Em dia": { classe: "bg-emerald-50 dark:bg-emerald-500/10 text-jurex", label: "Em dia" },
};

export default function RenegociarParcela() {
  const { contratoId, parcelaNumero } = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();

  // Estados
  const [estado, setEstado] = useState("carregando"); // carregando | pronto | nao-encontrado | erro
  const [contrato, setContrato] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [parcela, setParcela] = useState(null);
  const [valorInput, setValorInput] = useState(""); // armazena dígitos para formatar como moeda
  const [dataInput, setDataInput] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  const parcelaNum = parseInt(parcelaNumero, 10) || 0;

  // Busca contrato + cliente e identifica a parcela
  useEffect(() => {
    if (!usuario || !contratoId) return;
    let ativo = true;
    setEstado("carregando");
    setErro("");
    setSucesso("");

    buscarContrato(usuario, contratoId)
      .then((dados) => {
        if (!ativo) return;
        if (!dados) {
          setEstado("nao-encontrado");
          return;
        }
        setContrato(dados.contrato);
        setCliente(dados.cliente);

        // Calcula parcelas e localiza a parcela correta
        const parcelasCalc = parcelasDoContrato(dados.contrato, HOJE);
        const p = parcelasCalc.find((x) => Number(x.numero) === parcelaNum);

        if (!p) {
          setEstado("nao-encontrado");
          return;
        }

        setParcela(p);
        setEstado("pronto");
      })
      .catch((err) => {
        if (!ativo) return;
        console.error("Erro ao carregar contrato:", err);
        if (err?.code === "permission-denied") {
          setEstado("nao-encontrado");
        } else {
          setEstado("erro");
        }
      });

    return () => {
      ativo = false;
    };
  }, [usuario, contratoId, parcelaNum]);

  // Valores derivados da parcela
  const status = useMemo(() => {
    if (!contrato) return "";
    return statusContrato(contrato, HOJE);
  }, [contrato]);

  const sb = STATUS_CONTRATO[status] || STATUS_CONTRATO["Em dia"];

  // Inicializa inputs com valores atuais da parcela (apenas na primeira renderização após carregar)
  useEffect(() => {
    if (!parcela) return;

    // Valor atual
    const valorNum = Number(parcela.valor) || 0;
    const centavos = Math.round(valorNum * 100);
    setValorInput(String(centavos));

    // Data atual (formato YYYY-MM-DD da parcela → DD/MM/AAAA)
    const dataFmt = formatarDataInput(parcela.vencimento);
    setDataInput(dataFmt);
  }, [parcela]);

  // Converte o input de valor para número
  const valorReal = parseMoedaInput(valorInput);

  // Validações
  const validacoes = useMemo(() => {
    const erros = [];

    if (!valorInput || valorReal <= 0) {
      erros.push("O novo valor é obrigatório e deve ser maior que zero.");
    }

    if (!dataInput || !validarDataInput(dataInput)) {
      erros.push("A nova data de vencimento é obrigatória e deve ser válida.");
    }

    return {
      ok: erros.length === 0,
      erros,
    };
  }, [valorInput, valorReal, dataInput]);

  // Confirma a renegociação e persiste no Firestore
  async function confirmarRenegociacao() {
    if (!contrato || !parcela || !usuario) return;
    if (!validacoes.ok) return;

    setSalvando(true);
    setErro("");
    setSucesso("");

    const novoVencimento = formatarDataParaBackend(dataInput);

    try {
      await renegociarParcela(
        usuario,
        contrato,
        parcela.numero,
        valorReal,
        novoVencimento,
        observacoes
      );

      setSucesso("Parcela renegociada com sucesso!");
      setTimeout(() => {
        navigate(`/emprestimos/${contrato.id}`);
      }, 1500);
    } catch (err) {
      console.error("Erro ao renegociar parcela:", err);
      setErro(err.message || "Não foi possível renegociar. Verifique as regras do Firestore e tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  // ---------- Loading ----------

  if (estado === "carregando") {
    return (
      <AppLayout>
        <div className="min-h-svh flex flex-col items-center justify-center gap-3 text-slate-500">
          <LoaderCircle className="w-7 h-7 text-jurex animate-spin" />
          <p className="text-sm font-semibold">Carregando contrato...</p>
        </div>
      </AppLayout>
    );
  }

  // ---------- Não encontrado / Erro ----------

  if (estado === "nao-encontrado" || estado === "erro" || !contrato) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <section className="mt-16 mb-16 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-amber-50/60 dark:bg-amber-500/10 p-4">
              <TriangleAlert className="w-7 h-7 text-amber-500" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900">
              {estado === "erro" || estado === "nao-encontrado"
                ? "Contrato não encontrado."
                : parcela
                ? "Parcela não encontrada."
                : "Contrato não encontrado."}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Não foi possível localizar o contrato ou a parcela solicitada.
            </p>
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

  // ---------- Página completa ----------

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 mb-10">
        {/* Cabeçalho */}
        <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-emerald-50 to-white dark:from-slate-900 dark:to-emerald-950/20 px-6 py-5">
          <div className="flex items-center gap-4">
            <BackButton to={`/emprestimos/${contrato.id}`} />
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              aria-label="Início"
              className="rounded-full p-2 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-[0_2px_4px_rgba(15,23,42,0.04)] hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              <House className="w-4.5 h-4.5 text-slate-600 dark:text-slate-300" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                Renegociar parcela
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Parcela {parcela?.numero ?? parcelaNum}
              </p>
            </div>
          </div>
        </header>

        {/* Feedback de erro / sucesso */}
        {erro && (
          <div className="mt-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>
          </div>
        )}
        {sucesso && (
          <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3">
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{sucesso}</p>
          </div>
        )}

        {/* Formulário */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirmarRenegociacao();
          }}
          className="mt-6 space-y-5"
        >
          {/* Campo 1: Novo valor a receber */}
          <div>
            <label className="block text-[10px] font-medium tracking-wider text-slate-500 uppercase mb-1.5">
              Novo valor a receber
            </label>
            <div className="relative">
              <input
                type="text"
                value={valorInput ? formatarMoedaInput(parseMoedaInput(valorInput)) : ""}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  setValorInput(digits);
                }}
                disabled={salvando}
                className="w-full h-[46px] pl-[14px] pr-[14px] rounded-[10px] border border-[#DADFE5] bg-white text-slate-800 text-base font-medium focus:outline-none focus:ring-2 focus:ring-jurex/20 focus:border-jurex transition"
              />
              <span className="absolute right-[14px] top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                R$
              </span>
            </div>
            {!valorInput && (
              <p className="mt-1 text-[11px] text-red-500">
                O novo valor é obrigatório.
              </p>
            )}
          </div>

          {/* Campo 2: Nova data de vencimento */}
          <div>
            <label className="block text-[10px] font-medium tracking-wider text-slate-500 uppercase mb-1.5">
              Nova data de vencimento
            </label>
            <div className="relative">
              <input
                type="text"
                value={dataInput}
                onChange={(e) => {
                  let v = e.target.value.replace(/\D/g, "");
                  if (v.length > 8) v = v.slice(0, 8);
                  // Formata automaticamente como DD/MM/AAAA
                  let formatted = "";
                  if (v.length <= 2) {
                    formatted = v;
                  } else if (v.length <= 4) {
                    formatted = v.slice(0, 2) + "/" + v.slice(2);
                  } else {
                    formatted = v.slice(0, 2) + "/" + v.slice(2, 4) + "/" + v.slice(4, 8);
                  }
                  setDataInput(formatted);
                }}
                disabled={salvando}
                placeholder="DD/MM/AAAA"
                className="w-full h-[46px] pl-[14px] pr-[42px] rounded-[10px] border border-[#DADFE5] bg-white text-slate-800 text-base font-medium focus:outline-none focus:ring-2 focus:ring-jurex/20 focus:border-jurex transition"
              />
              <Calendar className="absolute right-[14px] top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
            </div>
            {dataInput && !validarDataInput(dataInput) && (
              <p className="mt-1 text-[11px] text-red-500">
                Digite uma data válida no formato DD/MM/AAAA.
              </p>
            )}
          </div>

          {/* Campo 3: Observações */}
          <div>
            <label className="block text-[10px] font-medium tracking-wider text-slate-500 uppercase mb-1.5">
              Observações
            </label>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              disabled={salvando}
              placeholder="Detalhes do acordo..."
              rows={4}
              className="w-full min-h-[90px] px-[14px] py-3 rounded-[10px] border border-[#DADFE5] bg-white text-slate-800 text-base font-medium resize-y focus:outline-none focus:ring-2 focus:ring-jurex/20 focus:border-jurex transition"
            />
          </div>

          {/* Botão Confirmar */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={salvando || !validacoes.ok}
              className={`w-full h-[50px] rounded-[14px] text-[15px] font-bold flex items-center justify-center gap-2 transition ${
                salvando || !validacoes.ok
                  ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-[#F59E0B] to-[#F97316] text-slate-900 hover:brightness-110"
              }`}
            >
              {salvando ? (
                <>
                  <LoaderCircle className="w-4 h-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Confirmar renegociação"
              )}
            </button>
          </div>
        </form>

        {/* Legenda do contrato */}
        <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>{numeroCurto(contrato.id)}</span>
          <span className={`px-2.5 py-1 rounded-full font-bold ${sb.classe}`}>
            {sb.label}
          </span>
        </div>
      </div>
    </AppLayout>
  );
}
