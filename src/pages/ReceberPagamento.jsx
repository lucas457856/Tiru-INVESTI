import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  House,
  LoaderCircle,
  TriangleAlert,
  Info,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import BackButton from "../components/BackButton";
import { useAuth } from "../context/useAuth";
import { useEffectiveUid } from "../hooks/useEffectiveUid";
import { formatarMoeda, formatarData, formatarTelefone, numeroCurto } from "../utils/formatadores";
import {
  buscarContrato,
  statusContrato,
  parcelasDoContrato,
  processarPagamento,
} from "../services/contractService";
import {
  calculateInterest,
  calculatePenalty,
  calculateTotalReceived,
  calculateNextDueDate,
  calculateDebtRemaining,
  calculatePrincipalQuitado,
  totalAbatimentos,
  shiftFutureInstallments,
} from "../services/paymentCalculations";
import { calcularParcelas } from "../utils/parcelasUtil";

const HOJE = new Date();
HOJE.setHours(0, 0, 0, 0);

// Modalidades de recebimento
const MODALIDADES = [
  { id: "parcela_inteira", label: "Pagar a parcela" },
  { id: "juros_apenas", label: "Só os juros" },
  { id: "juros_parte_divida", label: "Juros + parte da dívida" },
  { id: "quitar_tudo", label: "Pagar a dívida toda" },
];

// Formata valor monetário para input (apenas dígitos → decimal)
function parseMoedaInput(valor) {
  const digits = String(valor).replace(/\D/g, "");
  if (!digits) return 0;
  return Number(digits) / 100;
}

export default function ReceberPagamento() {
  const { contratoId } = useParams();
  const [searchParams] = useSearchParams();
  const parcelaParam = searchParams.get("parcela");
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const effectiveUid = useEffectiveUid();

  // carregando | pronto | nao-encontrado | erro
  const [estado, setEstado] = useState("carregando");
  const [contrato, setContrato] = useState(null);
  const [cliente, setCliente] = useState(null);
  const [parcela, setParcela] = useState(null);
  const [modalidade, setModalidade] = useState("parcela_inteira");
  const [valorJurosInput, setValorJurosInput] = useState("");
  const [valorAbatimentoInput, setValorAbatimentoInput] = useState("");
  const [dataRecebimento, setDataRecebimento] = useState(hojeIso());
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  const parcelaNum = parseInt(parcelaParam, 10) || 1;

  function hojeIso() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${dia}`;
  }

  // Busca contrato + cliente e identifica a parcela clicada
  useEffect(() => {
    if (!effectiveUid || !contratoId) return;
    let ativo = true;
    setEstado("carregando");

    buscarContrato({ uid: effectiveUid }, contratoId)
      .then((dados) => {
        if (!ativo) return;
        if (!dados) {
          setEstado("nao-encontrado");
          return;
        }
        setContrato(dados.contrato);
        setCliente(dados.cliente);

        // Identifica a parcela selecionada usando calcularParcelas com abatimentos
        const parcelasCalc = parcelasDoContrato(dados.contrato, HOJE);
        const p = parcelasCalc.find((x) => x.numero === parcelaNum) || parcelasCalc[0];
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

    return () => { ativo = false; };
  }, [usuario, contratoId, parcelaNum]);

  // Cálculos derivados da parcela e contrato
  // REGRA FUNDAMENTAL:
  // - Juros sobre valorEmprestado ORIGINAL (nunca sobre saldo reduzido)
  // - saldoPrincipal: valorEmprestado - abatimentos (reduzido pelo abatimento)
  // - principalQuitado: soma de principal pago em parcelas fechadas (informativo)
  // - principalRestante: saldoPrincipal (já reflete tudo — NÃO subtrair principalQuitado)
  // - As parcelas futuras refletem o principalRestante redistribuído
  const calculos = useMemo(() => {
    if (!contrato || !parcela) return null;

    const valorEmprestado = Number(contrato.valorEmprestado) || 0;
    const jurosTaxa = Number(contrato.juros) || 0;
    const jurosOriginais = calculateInterest(valorEmprestado, jurosTaxa);

    // Multa por atraso
    const multa = calculatePenalty(contrato, parcela, HOJE);

    // Abatimento acumulado (total de todos os abatimentos no contrato)
    const abatimentoTotal = Number(totalAbatimentos(contrato.abatimentos)) || 0;

    // Saldo principal do contrato: já reflete abatimentos + principal pago via parcelas
    const saldoPrincipal = calculateDebtRemaining(contrato);

    // Principal já quitado (parcelas pagas × valor base) — apenas para informação
    const principalQuitado = calculatePrincipalQuitado(contrato);

    // Principal restante: saldoPrincipal já é o total restante (não subtrair principalQuitado)
    const dividaRestante = Math.max(0, saldoPrincipal);

    // Juros total = juros sobre valor original + multa
    const jurosTotal = Math.round((jurosOriginais + multa) * 100) / 100;

    // Valor da parcela para exibição e pagamento.
    // Fonte de verdade: parcela.valor (produzido por parcelasDoContrato → calcularParcelas).
    // - Parcela renegociada: parcela.valor é o TOTAL renegociado (principal + juros).
    // - Parcela original sem abatimento: parcela.valor já é congelado em
    //   valorOriginalParcela + jurosOriginais (pelo preservation de parcelasDoContrato).
    // - Parcela original COM abatimento: parcela.valor foi recalculado por calcularParcelas
    //   usando saldoPrincipal reduzido (ex: 382,50). Deve usar esse valor, NÃO o original.
    // Em TODOS os casos, parcela.valor é a fonte de verdade — usar diretamente.
    const valorParcelaOriginal = Number(parcela.valor) || 0;

    const proximaData = calculateNextDueDate(contrato, parcela);
    const valorRecebido = calculateTotalReceived(contrato);

    return {
      valorEmprestado,
      jurosTaxa,
      jurosOriginais,
      multa,
      jurosTotal,
      abatimentoTotal,
      saldoPrincipal,
      principalQuitado,
      dividaRestante,
      valorParcelaOriginal,
      proximaData,
      valorRecebido,
    };
  }, [contrato, parcela]);

  // Valores editáveis conforme a modalidade
  const valorJurosReal = (() => {
    if (!calculos) return 0;
    if (valorJurosInput) {
      const v = parseMoedaInput(valorJurosInput);
      return v <= 0 ? calculos.jurosOriginais : v;
    }
    return calculos.jurosOriginais;
  })();

  const valorAbatimentoReal = (() => {
    if (!calculos) return 0;
    if (valorAbatimentoInput) {
      const v = parseMoedaInput(valorAbatimentoInput);
      return v <= 0 ? 0 : v;
    }
    return 0;
  })();

  // Validações em tempo real
  const validacoes = useMemo(() => {
    if (!calculos) return { ok: false, msg: "" };

    // Não permitir pagamento se contrato quitado
    if (contrato?.quitado) {
      return { ok: false, msg: "Este contrato já está quitado." };
    }

    if (modalidade === "juros_parte_divida") {
      // Abatimento não pode ser negativo
      if (valorAbatimentoReal < 0) {
        return { ok: false, msg: "O abatimento não pode ser negativo." };
      }

      // Principal restante disponível para abatimento
      // saldoPrincipal já reflete todas as reduções (abatimentos + principal pago)
      const principalRestante = Math.max(0, calculos.saldoPrincipal);
      if (valorAbatimentoReal > principalRestante) {
        return {
          ok: false,
          msg: `O abatimento não pode exceder ${formatarMoeda(principalRestante)} (principal restante).`,
        };
      }

      // Juros não podem ser negativos
      if (valorJurosReal < 0) {
        return { ok: false, msg: "Os juros não podem ser negativos." };
      }
    }

    return { ok: true, msg: "" };
  }, [modalidade, valorAbatimentoReal, valorJurosReal, calculos, contrato]);

  // Resumo dinâmico baseado na modalidade
  // REGRA FUNDAMENTAL:
  // - Juros sempre sobre valorEmprestado ORIGINAL (nunca sobre saldo reduzido)
  // - Abatimento reduz o saldoPrincipal do contrato (não a parcela já paga)
  const resumo = useMemo(() => {
    if (!calculos) return null;

    const {
      valorEmprestado,
      jurosTaxa,
      jurosOriginais,
      multa,
      jurosTotal,
      abatimentoTotal,
      saldoPrincipal,
      principalQuitado,
      dividaRestante,
      valorParcelaOriginal,
      proximaData,
    } = calculos;

    switch (modalidade) {
      case "parcela_inteira": {
        // TOTAL A RECEBER = parcela.valor + multa
        // parcela.valor é a fonte de verdade (produzido por parcelasDoContrato):
        //  - Original sem abatimento: valor congelado = valorOriginalParcela + jurosOriginais
        //  - Original com abatimento: recalculado por calcularParcelas (saldo reduzido)
        //  - Renegociada: total renegociado (principal + juros incluídos)
        // OS JUROS JÁ ESTÃO INCLUÍDOS em parcela.valor. NÃO somar jurosOriginais novamente —
        // isso causaria duplicação (ex: 382,50 + 175 = 557,50 ❌).
        const totalParcela = Math.round((valorParcelaOriginal + multa) * 100) / 100;
        return {
          titulo: "TOTAL A RECEBER",
          valor: totalParcela,
          detalhes: [
            { rotulo: "Valor total da parcela", valor: valorParcelaOriginal },
            { rotulo: "Multa/juros de atraso", valor: multa },
          ],
          saldoRestante: saldoPrincipal,
          proximaData,
        };
      }

      case "juros_apenas": {
        const jurosRecebidos = valorJurosReal;
        return {
          titulo: "VALOR DOS JUROS (R$)",
          valor: jurosRecebidos,
          detalhes: [
            { rotulo: "Valor original do contrato", valor: valorEmprestado },
            { rotulo: "Juros pagos agora", valor: jurosRecebidos },
            { rotulo: "Dívida principal (inalterada)", valor: saldoPrincipal },
          ],
          saldoRestante: saldoPrincipal,
          proximaData,
          aviso: "⚠ A dívida continua a mesma — você recebeu só os juros",
          sugestao: `Sugestão: ${formatarMoeda(jurosOriginais)} (${jurosTaxa}% sobre ${formatarMoeda(valorEmprestado)})`,
        };
      }

      case "juros_parte_divida": {
        const jurosRecebidos = valorJurosReal;
        const abatimento = valorAbatimentoReal;
        const totalRecebido = Math.round((jurosRecebidos + abatimento) * 100) / 100;
        // Novo saldoPrincipal = atual - abatimento
        const novoSaldoPrincipal = Math.max(0, saldoPrincipal - abatimento);
        // Principal restante = novoSaldoPrincipal (já reflete tudo — não subtrair principalQuitado)
        const novoPrincipalRestante = novoSaldoPrincipal;
        return {
          titulo: "VALOR RECEBIDO",
          valor: totalRecebido,
          detalhes: [
            { rotulo: "Valor original do contrato", valor: valorEmprestado },
            { rotulo: "Abatimentos anteriores", valor: abatimentoTotal },
            { rotulo: "Juros pagos agora", valor: jurosRecebidos },
            { rotulo: "Principal abatido agora", valor: abatimento },
            { rotulo: "Novo saldo principal", valor: novoSaldoPrincipal },
            { rotulo: "Principal restante (futuras)", valor: novoPrincipalRestante },
          ],
          saldoRestante: novoSaldoPrincipal,
          proximaData,
        };
      }

      case "quitar_tudo": {
        const saldo = saldoPrincipal;
        // Juros sobre o VALOR ORIGINAL DO CONTRATO + multa da parcela atual
        const jurosRecebidos = jurosOriginais + multa;
        const totalParaQuitar = Math.round((saldo + jurosRecebidos) * 100) / 100;
        return {
          titulo: "VALOR PARA QUITAR TUDO",
          valor: totalParaQuitar,
          detalhes: [
            { rotulo: "Dívida atual", valor: saldo },
            { rotulo: `Juros (${jurosTaxa}% sobre ${formatarMoeda(valorEmprestado)})`, valor: jurosOriginais },
            { rotulo: "Multa/juros de atraso", valor: multa },
            { rotulo: "Total para quitar", valor: totalParaQuitar },
          ],
          saldoRestante: 0,
          proximaData: null,
        };
      }

      default:
        return null;
    }
  }, [modalidade, calculos, valorJurosReal, valorAbatimentoReal, contrato]);

  // Confirma o recebimento e persiste no Firestore
  async function confirmarRecebimento() {
    if (!contrato || !parcela || !usuario || !calculos) return;
    if (!validacoes.ok) return;

    setSalvando(true);
    setErro("");
    setSucesso("");

    let valores = {};
    if (modalidade === "parcela_inteira") {
      valores = { valorTotal: resumo.valor };
    } else if (modalidade === "juros_apenas") {
      valores = { valorJuros: valorJurosReal };
    } else if (modalidade === "juros_parte_divida") {
      valores = { valorJuros: valorJurosReal, valorAbatimento: valorAbatimentoReal };
    } else if (modalidade === "quitar_tudo") {
      valores = { valorTotal: resumo.valor };
    }

    try {
      const result = await processarPagamento(
        usuario,
        contrato,
        parcela,
        modalidade,
        valores,
        dataRecebimento,
        observacao
      );

      setSucesso("Recebimento registrado com sucesso!");
      setTimeout(() => {
        navigate(`/emprestimos/${contrato.id}`);
      }, 1500);
    } catch (err) {
      console.error("Erro ao registrar pagamento:", err);
      setErro(err.message || "Não foi possível registrar o pagamento. Verifique as regras do Firestore e tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  // ---------- Estados de loading / erro / não encontrado ----------

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

  if (estado === "nao-encontrado" || estado === "erro" || !contrato) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <section className="mt-16 mb-16 flex flex-col items-center text-center">
            <span className="rounded-2xl bg-amber-50/60 dark:bg-amber-500/10 p-4">
              <TriangleAlert className="w-7 h-7 text-amber-500" />
            </span>
            <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
              {estado === "erro"
                ? "Não foi possível carregar o contrato."
                : "Contrato não encontrado."}
            </h2>
            {estado === "erro" && (
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                Verifique sua conexão e regras do Firestore.
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate(`/emprestimos/${contratoId}`)}
              className="mt-5 h-11 px-5 rounded-xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-sm font-bold shadow-md shadow-jurex/25 hover:brightness-105 active:scale-[0.98] transition"
            >
              Voltar para o contrato
            </button>
          </section>
        </div>
      </AppLayout>
    );
  }

  // ---------- Página completa ----------

  const status = statusContrato(contrato, HOJE);
  const sb = STATUS_CONTRATO[status] || STATUS_CONTRATO["Em dia"];

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
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {numeroCurto(contrato.id)}
              </p>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                Receber pagamento
              </h1>
            </div>
          </div>
        </header>

        {/* Card superior — fondo verde claríssimo */}
        {resumo && (
          <section className="mt-6 rounded-3xl border border-emerald-100 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 via-emerald-50/80 to-emerald-100/30 dark:from-emerald-500/5 dark:via-emerald-500/5 dark:to-transparent px-6 sm:px-8 py-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-widest text-slate-400 dark:text-slate-500 uppercase">
                  {resumo.titulo}
                </p>
                <p className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900 dark:text-white">
                  {formatarMoeda(resumo.valor)}
                </p>
                {parcela && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {cliente?.nomeCompleto ?? contrato.clienteNome ?? "Cliente"} · Parcela {parcela.numero}
                  </p>
                )}
                {resumo.sugestao && (
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                    {resumo.sugestao}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${sb.classe}`}
              >
                {sb.label}
              </span>
            </div>

            {/* Detalhes do cálculo */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
              {resumo.detalhes.map((d) => (
                <div key={d.rotulo} className="flex justify-between">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {d.rotulo}
                  </span>
                  <span className="text-xs font-semibold text-slate-900 dark:text-white tabular-nums">
                    {formatarMoeda(d.valor)}
                  </span>
                </div>
              ))}
            </div>

            {/* Multa/juros e vencimento */}
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {calculos.multa > 0 && (
                <p>
                  <span className="font-semibold">Multa:</span> {formatarMoeda(calculos.multa)}
                </p>
              )}
              <p>
                <span className="font-semibold">Vencimento:</span> {formatarData(parcela?.vencimento) || "-"}
              </p>
            </div>

            {/* Aviso da modalidade juros_apenas */}
            {resumo.aviso && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50/60 dark:bg-amber-500/10 px-3 py-2">
                <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {resumo.aviso}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Quatro modalidades */}
        <section className="mt-8">
          <h2 className="text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase">
            COMO QUER RECEBER?
          </h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MODALIDADES.map((m) => {
              const ativa = modalidade === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setModalidade(m.id);
                    setErro("");
                    setSucesso("");
                    setValorJurosInput("");
                    setValorAbatimentoInput("");
                  }}
                  className={`h-14 rounded-2xl text-sm font-bold transition ${
                    ativa
                      ? "bg-gradient-to-r from-jurex to-emerald-500 text-white shadow-lg shadow-jurex/25"
                      : "bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-300 hover:border-jurex/40 hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Campos dinâmicos conforme modalidade */}
        {resumo && (modalidade === "juros_apenas" || modalidade === "juros_parte_divida") && (
          <section className="mt-6 space-y-4">
            {/* Juros */}
            <div>
              <label
                htmlFor="receber-juros"
                className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase"
              >
                {modalidade === "juros_apenas" ? "VALOR DOS JUROS (R$)" : "VALOR DOS JUROS (R$)"}
              </label>
              <input
                id="receber-juros"
                type="text"
                inputMode="decimal"
                placeholder={formatarMoeda(calculos.jurosOriginais).replace("R$", "").trim()}
                value={valorJurosInput || ""}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  setValorJurosInput(digits ? (Number(digits) / 100).toFixed(2) : "");
                }}
                className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
              />
              {modalidade === "juros_apenas" && resumo.sugestao && (
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {resumo.sugestao}
                </p>
              )}
            </div>

            {/* Abatimento (apenas na modalidade 3) */}
            {modalidade === "juros_parte_divida" && (
              <div>
                <label
                  htmlFor="receber-abatimento"
                  className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase"
                >
                  QUANTO VAI ABATER DA DÍVIDA (R$)
                </label>
                <input
                  id="receber-abatimento"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={valorAbatimentoInput || ""}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setValorAbatimentoInput(digits ? (Number(digits) / 100).toFixed(2) : "");
                  }}
                  className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
                />
                {calculos.dividaRestante > 0 && (
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                    Dívida restante: {formatarMoeda(calculos.dividaRestante)}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* Data do recebimento */}
        <div className="mt-6">
          <label
            htmlFor="receber-data"
            className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase"
          >
            Data do recebimento
          </label>
          <input
            id="receber-data"
            type="date"
            value={dataRecebimento}
            onChange={(e) => setDataRecebimento(e.target.value)}
            className="mt-2 w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
          />
        </div>

        {/* Observação */}
        <div className="mt-4">
          <label
            htmlFor="receber-obs"
            className="block text-[10px] font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase"
          >
            Observação
          </label>
          <textarea
            id="receber-obs"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            placeholder="Ex.: Pagamento em espécie"
            className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/40 p-3 text-sm leading-relaxed text-slate-800 dark:text-slate-100 outline-none resize-y transition focus:border-jurex focus:ring-2 focus:ring-jurex/20"
          />
        </div>

        {/* Erro de validação */}
        {!validacoes.ok && (
          <p className="mt-4 rounded-xl bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-500">
            {validacoes.msg}
          </p>
        )}

        {/* Erro geral */}
        {erro && (
          <p className="mt-4 rounded-xl bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-500">
            {erro}
          </p>
        )}

        {/* Sucesso */}
        {sucesso && (
          <p className="mt-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-jurex">
            {sucesso}
          </p>
        )}

        {/* Botão confirmar */}
        <div className="mt-8">
          <button
            type="button"
            onClick={confirmarRecebimento}
            disabled={salvando || !validacoes.ok || !resumo}
            className={`w-full h-13 rounded-2xl bg-gradient-to-r from-jurex to-emerald-500 text-white text-base font-bold flex items-center justify-center gap-2 shadow-lg shadow-jurex/30 hover:brightness-105 active:scale-[0.99] transition ${
              salvando || !validacoes.ok || !resumo
                ? "opacity-60 pointer-events-none"
                : ""
            }`}
          >
            {modalidade === "quitar_tudo"
              ? (salvando ? "Salvando..." : "CONFIRMAR QUITAÇÃO")
              : (salvando ? "Salvando..." : "CONFIRMAR RECEBIMENTO")}
          </button>
        </div>
      </div>
    </AppLayout>
  );
}

// Badges de status do contrato
const STATUS_CONTRATO = {
  Quitado: { classe: "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400", label: "Quitado" },
  Atrasado: { classe: "bg-red-50 dark:bg-red-500/10 text-red-500", label: "Atrasado" },
  "Em dia": { classe: "bg-emerald-50 dark:bg-emerald-500/10 text-jurex", label: "Em dia" },
};
