// Cálculos financeiros reutilizáveis para o módulo de recebimento de pagamentos.
// Todas as funções recebem os dados REAIS do contrato/parcela — sem valores fixos.
//
// ARQUITETURA FINANCEIRA:
// - valorEmprestado: valor original do contrato (IMUTÁVEL)
// - saldoPrincipal: valorEmprestado menos abatimentos (atualizado após cada pagamento)
// - juros: SEMPRE sobre valorEmprestado original (nunca sobre saldo reduzido)
// - principal quitado: soma de principal pago em parcelas fechadas
// - saldo restante: saldoPrincipal (já reflete abatimentos + principalPago — NÃO subtrair principal quitado)
import { calcularParcelas } from "../utils/parcelasUtil.js";

/**
 * Data atual zerada (meia-noite local) — usada como referência para cálculos
 * de vencimento, status e juros ao longo da aplicação.
 */
export const HOJE = new Date();
HOJE.setHours(0, 0, 0, 0);

/**
 * Calcula juros sobre o valor ORIGINAL do contrato (nunca sobre saldo reduzido).
 * Regra: jurosOriginais = valorOriginal × (taxaJuros / 100)
 */
export function calculateInterest(principal, taxaMensal) {
  const p = Number(principal) || 0;
  const t = Number(taxaMensal) || 0;
  return Math.round((p * (t / 100)) * 100) / 100;
}

/**
 * Calcula a multa por atraso (dias * taxa).
 * Respeita modoJurosAtraso: "% ao valor da parcela" ou "Valor fixo".
 * A base da multa é o valor ORIGINAL da parcela, nunca o saldo reduzido.
 */
export function calculatePenalty(contrato, parcela, hoje = new Date()) {
  if (!contrato?.cobrarJurosAtraso) return 0;
  if (!parcela?.vencimento) return 0;
  if (parcela.status === "Paga") return 0;

  // Parse LOCAL para evitar drift: string "YYYY-MM-DD" com new Date() vira UTC
  // (meia-noite) e, no fuso BR (UTC-3), o dia andaria 1 data para trás no cálculo
  // de diferença de dias. Faz parse explícito preservando o calendário.
  let venc;
  if (typeof parcela.vencimento === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parcela.vencimento)) {
    const [y, m, d] = parcela.vencimento.split("-").map(Number);
    venc = new Date(y, m - 1, d);
  } else {
    venc = new Date(parcela.vencimento);
  }
  venc.setHours(0, 0, 0, 0);
  const diffDias = Math.floor((hoje - venc) / (1000 * 60 * 60 * 24));
  if (diffDias <= 0) return 0;

  // Base: valor ORIGINAL da parcela (nunca o saldo reduzido por abatimento)
  const valorParcela = Number(parcela.valorOriginalParcela) || Number(contrato.valorParcela) || 0;
  const taxa = Number(contrato.jurosAtrasoValor) || 0;

  if (contrato.modoJurosAtraso === "% ao valor da parcela") {
    return Math.round((valorParcela * (taxa / 100) * diffDias) * 100) / 100;
  }
  return Math.round((taxa * diffDias) * 100) / 100; // Valor fixo por dia
}

/**
 * Valor total de uma parcela: principal + juros + multa
 * - principal: parte do principal original desta parcela
 * - juros: sobre o valorEmprestado ORIGINAL
 * - multa: sobre o valor ORIGINAL da parcela
 */
export function calculateInstallmentValue(principal, juros, multa = 0) {
  return Math.round((Number(principal) + Number(juros) + Number(multa)) * 100) / 100;
}

/**
 * Calcula o principal restante do contrato.
 * principalRestante = valorEmprestado - abatimentoTotal - principalQuitado
 *
 * @param {object} contrato - documento do contrato
 * @param {number} abatimentoTotal - soma de todos os abatimentos registrados
 * @param {number} principalQuitado - soma de principal pago em parcelas fechadas
 */
export function calculateRemainingPrincipal(contrato, abatimentoTotal = 0, principalQuitado = 0) {
  const valorEmprestado = Number(contrato?.valorEmprestado) || 0;
  const abat = Number(abatimentoTotal) || 0;
  const quitado = Number(principalQuitado) || 0;
  return Math.max(0, Math.round((valorEmprestado - abat - quitado) * 100) / 100);
}

/**
 * Calcula o principal quitado baseado em parcelasPagas.
 * Cada parcela paga cobre valorBaseParcela do principal original.
 */
export function calculatePrincipalQuitado(contrato) {
  const total = Number(contrato?.numeroParcelas) || 0;
  const valorEmprestado = Number(contrato?.valorEmprestado) || 0;
  const parcelasPagas = Number(contrato?.parcelasPagas) || 0;
  const valorBaseParcela = total > 0 ? valorEmprestado / total : 0;
  return Math.round((parcelasPagas * valorBaseParcela) * 100) / 100;
}

/**
 * Calcula o total de juros já recebidos no contrato.
 * Juros são acumulados conforme cada parcela é paga ou juros são recebidos.
 */
export function calculateTotalInterestReceived(contrato) {
  // jurosRecebidos é armazenado no contrato e acumulado
  return Number(contrato?.jurosRecebidos) || 0;
}

/**
 * Calcula o principal restante para exibição na UI.
 * Usa saldoPrincipal se existir, senão calcula a partir de valorEmprestado - abatimentos - principalQuitado
 */
export function calculateDebtRemaining(contrato, hoje = new Date()) {
  // Se saldoPrincipal existe, usar diretamente
  if (contrato?.saldoPrincipal !== undefined && contrato.saldoPrincipal !== null) {
    return Math.max(0, Number(contrato.saldoPrincipal));
  }
  // Fallback para contratos antigos sem saldoPrincipal
  const valorEmprestado = Number(contrato?.valorEmprestado) || 0;
  const abatimentoTotal = totalAbatimentos(contrato?.abatimentos);
  const principalQuitado = calculatePrincipalQuitado(contrato);
  return calculateRemainingPrincipal(contrato, abatimentoTotal, principalQuitado);
}

/**
 * Soma total de abatimentos em um array
 */
export function totalAbatimentos(abatimentos) {
  if (!abatimentos || !Array.isArray(abatimentos)) return 0;
  return abatimentos.reduce((s, a) => s + (Number(a?.valor) || 0), 0);
}

/**
 * Calcula o valor da parcela com abatimento aplicado.
 * Usado para exibir o valor atual de uma parcela não paga.
 */
export function calcularValorParcelaComAbatimento(contrato, parcela) {
  if (!parcela) return Number(contrato?.valorParcela) || 0;
  const valorOriginal = Number(parcela.valorOriginalParcela) || Number(contrato?.valorParcela) || 0;
  const abatimentos = Number(parcela.abatimentoParcela) || 0;
  return Math.max(0, Math.round((valorOriginal - abatimentos) * 100) / 100);
}

/**
 * Total recebido no contrato (soma de todas as parcelas pagas + juros recebidos)
 */
export function calculateTotalReceived(contrato) {
  return Number(contrato?.valorRecebido) || 0;
}

/**
 * Total a receber no contrato (soma de todas as parcelas + juros)
 */
export function calculateTotalToReceive(contrato) {
  return Number(contrato?.totalReceber) || 0;
}

/**
 * Avança uma data por exatamente um intervalo de frequência, respeitando timezone
 * e tratando corretamente o fim de mês.
 *
 * - Diária (+1 dia), Semanal (+7 dias), Quinzenal (+15 dias)
 * - Mensal: +1 mês de calendário, preservando o dia quando existe no mês alvo;
 *   se o dia não existir (ex: 31/01 → fevereiro), usa o último dia válido.
 *
 * A entrada pode ser YYYY-MM-DD (string) ou Date. A saída é sempre um Date
 * cujo dia corresponde exatamente ao esperado (sem drift de timezone).
 *
 * @param {string|Date} dataBase - data de origem
 * @param {string} [frequencia] - "Diária" | "Semanal" | "Quinzenal" | "Mensal"
 * @returns {Date|null}
 */
export function avancarData(frequencia, dataBase) {
  if (!dataBase) return null;

  // Parse robusto evitando drift de timezone:
  // - Se string "YYYY-MM-DD", constrói componentes locais explicitamente.
  // - Se Date, copia os componentes UTC (consistente) e converte para local.
  let y, m, d;
  if (typeof dataBase === "string") {
    const partes = dataBase.split("T")[0].split("-").map(Number);
    if (partes.length !== 3 || partes.some(Number.isNaN)) return null;
    [y, m, d] = partes;
    m -= 1; // JS months são 0-based
  } else if (dataBase instanceof Date && !Number.isNaN(dataBase.getTime())) {
    y = dataBase.getFullYear();
    m = dataBase.getMonth();
    d = dataBase.getDate();
  } else {
    return null;
  }

  const PASSO_DIAS = { "Diária": 1, Semanal: 7, Quinzenal: 15 };
  const dias = PASSO_DIAS[frequencia];

  if (dias) {
    // Avanço por dias: cópia profunda e adição
    const result = new Date(y, m, d + dias);
    if (Number.isNaN(result.getTime())) return null;
    return result;
  }

  // Mensal: +1 mês de calendário
  // Cuidado com overflow de ano (dezembro → janeiro do próximo ano)
  const mesAlvo = m + 1;
  const anoAlvo = mesAlvo > 11 ? y + 1 : y;
  const mesAlvoNormalizado = mesAlvo > 11 ? 0 : mesAlvo;
  // Último dia válivel do mês alvo
  const ultimoDiaMesAlvo = new Date(anoAlvo, mesAlvoNormalizado + 1, 0).getDate();
  // Preservar o dia original se existir no mês alvo; caso contrário, usar último dia
  const diaAlvo = Math.min(d, ultimoDiaMesAlvo);
  const result = new Date(anoAlvo, mesAlvoNormalizado, diaAlvo);
  if (Number.isNaN(result.getTime())) return null;
  return result;
}

/**
 * Data da próxima cobrança a partir da data atual (avança pela frequência)
 */
export function calculateNextDueDate(contrato, parcela) {
  if (!parcela?.vencimento) return null;
  const freq = contrato?.frequencia;
  return avancarData(freq, parcela.vencimento);
}

/**
 * Desloca o vencimento da parcela selecionada e de TODAS as parcelas posteriores
 * por exatamente um intervalo da frequência do contrato.
 *
 * Regra do deslocamento (para "Só os juros"):
 *  - Parcelas ANTERIORES à selecionada: NÃO alteram.
 *  - Parcela selecionada + todas as POSTERIORES: avançam 1 intervalo.
 *  - Valores e status são preservados — SOMENTE as datas mudam.
 *
 * @param {Array} parcelas - lista retornada por calcularParcelas
 * @param {number} indiceSelecionado - índice da parcela que recebeu juros
 * @param {string} [frequencia] - frequência do contrato (necessária para avançarData)
 * @returns {Array} nova lista de parcelas com vencimentos deslocados (imutável)
 */
export function shiftFutureInstallments(parcelas, indiceSelecionado, frequencia) {
  if (!Array.isArray(parcelas) || parcelas.length === 0) return parcelas;
  const idx = Number(indiceSelecionado);
  if (Number.isNaN(idx) || idx < 0 || idx >= parcelas.length) return parcelas;

  // Cumulativo: cada parcela avança a partir da data JÁ DESLOCADA da parcela
  // anterior (não da data original), preservando a sequência de períodos.
  // Usa-se reduce para acumular a data deslocada entre iterações.
  //
  // EXCEÇÃO: se a parcela posterior tem vencimento customizado via parcelasCustom
  // (marca `renegociada = true`), ela DEVE usar seu próprio vencimento
  // customizado como base do deslocamento, ignorando a data acumulada da
  // parcela anterior. Isso garante que uma renegociação de data seja
  // respeitada antes do shift cumulativo.
  const ultimoVencimento = { valor: null }; // holder mutável para o acúmulo

  return parcelas.map((p, i) => {
    if (i < idx) {
      // Anteriores: não alteram
      return p;
    }
    // Base: para a parcela selecionada, usa sua própria data efetiva.
    // Para as posteriores, usa a data JÁ deslocada da parcela anterior
    // — UNLESS a parcela posterior tem vencimento customizado (renegociada),
    // caso em que usa seu próprio vencimento customizado como base.
    let baseData;
    if (i === idx) {
      baseData = p.vencimento;
    } else if (p.renegociada) {
      baseData = p.vencimento;
    } else {
      baseData = ultimoVencimento.valor;
    }
    const novaData = avancarData(frequencia, baseData);
    const vencimentoStr = novaData
      ? `${novaData.getFullYear()}-${String(novaData.getMonth() + 1).padStart(2, "0")}-${String(novaData.getDate()).padStart(2, "0")}`
      : p.vencimento;

    // Atualiza o acúmulo para a próxima iteração
    ultimoVencimento.valor = vencimentoStr;

    return { ...p, vencimento: vencimentoStr };
  });
}

/**
 * Retorna a PRIMEIRA parcela em aberto (não paga, com saldo, que não esteja totalmente quitada).
 * Usa calcularParcelas para obter o cronograma atualizado, incluindo abatimentos.
 *
 * @param {object} contrato - documento do contrato
 * @param {Date} hoje - data base (opcional, default = new Date())
 * @returns {object|null} - a parcela ou null se todas estiverem pagas
 */
export function getNextOpenInstallment(contrato, hoje = new Date()) {
  if (!contrato) return null;

  // Não confiar cegamente em contrato.quitado — um contrato pode ter sido marcado
  // como quitado quando todas as parcelas originais foram pagas, mas ainda ter
  // saldoPrincipal > 0, o que significa que uma parcela DINÂMICA (REGRA 2)
  // deve ser criada. Recalcula o quitado com base no saldo real.
  const saldoReal = calculateDebtRemaining(contrato);
  const totalOriginal = Number(contrato.numeroParcelas) || 1;
  const parcelasPagas = Number(contrato.parcelasPagas) || 0;
  const realmenteQuitado = parcelasPagas >= totalOriginal && saldoReal <= 0;
  if (realmenteQuitado && Number(contrato.saldoPrincipal) !== null) return null;
  // Se saldoReal > 0, o contrato NÃO está realmente quitado, mesmo que
  // contrato.quitado seja true (persistido com regra antiga). Prossegue.

  const parcelas = calcularParcelas(contrato, hoje, contrato.abatimentos || null);

  // Estratégia: encontrar a primeira parcela que:
  // 1. Não esteja paga (status !== "Paga")
  // 2. Ainda tenha saldo (valor > 0)
  return parcelas.find((p) => p.status !== "Paga" && Number(p.valor) > 0) || null;
}

/**
 * Determina o status do contrato a partir da PRÓXIMA PARCELA NÃO PAGA.
 * Fonte única de verdade para status ("Em dia" | "Atrasado" | "Quitado").
 *
 * REGRAS:
 *   1. Quitado: todas as parcelas foram pagas (pagas >= totalParcelas).
 *      Independe de data. Um contrato nunca é "Quitado" apenas por
 *      estar atrasado — atraso significa "ainda há valor a receber".
 *   2. Atrasado: existe parcela pendente cuja data de vencimento é
 *      ANTERIOR a hoje (vencimento < hoje). Vencimento NO DIA de hoje
 *      ainda é considerado "Em dia" (regra `vencimento >= hoje`).
 *   3. Em dia: existe parcela pendente, mas a próxima vence hoje ou
 *      no futuro.
 *   4. Caso sem parcelas pendentes (lista vazia), considera "Quitado".
 *
 * Implementação:
 *   - Usa `getNextOpenInstallment` para encontrar a próxima parcela
 *     não paga (canônica: aplica overrides de renegociação e
 *     deslocamentos de juros_apenas).
 *   - Compara a data de vencimento dessa parcela com `hoje`
 *     (zerada em meia-noite local), usando `parseDataLocal` para
 *     evitar drift de timezone em strings "YYYY-MM-DD".
 *
 * @param {object} contrato - documento do contrato
 * @param {Date} hoje - data base (opcional, default = new Date())
 * @returns {"Quitado"|"Atrasado"|"Em dia"}
 */
export function calcularStatusContrato(contrato, hoje = new Date()) {
  if (!contrato) return "Em dia";

  // Quitado: checa pelo campo persistido E recalcula do saldo real.
  // Recálculo cobre contratos migrados com flag stale.
  const totalParcelas = Number(contrato.numeroParcelas) || 0;
  const parcelasPagas = Number(contrato.parcelasPagas) || 0;
  const saldoReal = calculateDebtRemaining(contrato);
  const realmenteQuitado = parcelasPagas >= totalParcelas && saldoReal <= 0;
  if (realmenteQuitado) return "Quitado";

  // Próxima parcela não paga (com vencimento refletindo overrides)
  const proxima = getNextOpenInstallment(contrato, hoje);
  if (!proxima) return "Quitado";

  // Compara vencimento (YYYY-MM-DD ou Date) com hoje (meia-noite local)
  const hojeLocal = new Date(hoje);
  hojeLocal.setHours(0, 0, 0, 0);
  const venc = parseVencimentoLocal(proxima.vencimento);
  if (!venc) return "Em dia";
  if (venc < hojeLocal) return "Atrasado";
  return "Em dia";
}

// Helper de parse LOCAL para "YYYY-MM-DD" / Date (mesma semântica de
// parseDataLocal em contractService.js, sem importar Firestore aqui).
function parseVencimentoLocal(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      d.setHours(0, 0, 0, 0);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Pagamento parcial: juros + parte do principal (abatimento)
 * IMPORTANTE: juros é calculado sobre o VALOR ORIGINAL do contrato,
 * nunca sobre o saldo reduzido por abatimento.
 */
export function calculatePartialPayment(contrato, parcela, abatimentoPrincipal, hoje = new Date()) {
  const valorEmprestado = Number(contrato?.valorEmprestado) || 0;
  const jurosTaxa = Number(contrato?.juros) || 0;
  const juros = calculateInterest(valorEmprestado, jurosTaxa);
  const multa = calculatePenalty(contrato, parcela, hoje);
  const jurosTotal = Math.round((juros + multa) * 100) / 100;

  const saldoPrincipal = calculateDebtRemaining(contrato);
  const principalQuitado = calculatePrincipalQuitado(contrato);
  // saldoPrincipal já reflete todas as reduções (abatimentos + principal pago via parcelas)
  // principalDisponivel = saldoPrincipal (não subtrair principalQuitado de novo)
  const principalDisponivel = Math.max(0, saldoPrincipal);

  const abatimento = Math.min(Number(abatimentoPrincipal) || 0, principalDisponivel);
  const totalRecebido = Math.round((jurosTotal + abatimento) * 100) / 100;
  const saldoRestante = Math.max(0, Math.round((saldoPrincipal - abatimento) * 100) / 100);

  return { juros: jurosTotal, totalRecebido, saldoRestante, abatimento };
}

/**
 * Quitação completa: calcula o total para pagar tudo (principal restante + juros + multa)
 * IMPORTANTE: juros sobre o VALOR ORIGINAL do contrato, não sobre o saldo reduzido.
 */
export function calculateFullSettlement(contrato, parcela, hoje = new Date()) {
  const valorEmprestado = Number(contrato?.valorEmprestado) || 0;
  const jurosTaxa = Number(contrato?.juros) || 0;
  const juros = calculateInterest(valorEmprestado, jurosTaxa);
  const multa = calculatePenalty(contrato, parcela, hoje);
  const saldoRestante = calculateDebtRemaining(contrato);
  const totalParaQuitar = Math.round((saldoRestante + juros + multa) * 100) / 100;
  return { saldoRestante, juros, multa, totalParaQuitar };
}

/**
 * Valida que o abatimento não exceda o saldo disponível da dívida.
 * Saldo disponível = saldoPrincipal - principal já quitado
 */
export function validarAbatimento(abatimento, saldoDisponivel) {
  const amt = Number(abatimento) || 0;
  if (amt < 0) return { ok: false, msg: "O abatimento não pode ser negativo." };
  if (amt > saldoDisponivel) {
    return {
      ok: false,
      msg: `O abatimento não pode exceder ${formatarMoedaCurto(saldoDisponivel)}.`,
    };
  }
  return { ok: true, msg: "" };
}

/**
 * Valida todos os valores de um pagamento.
 * Garante que não haja valores negativos ou inconsistentes.
 */
export function validarPagamento(valores) {
  const { valorJuros = 0, valorAbatimento = 0, valorTotal = 0 } = valores || {};

  if (valorJuros < 0) return { ok: false, msg: "Os juros não podem ser negativos." };
  if (valorAbatimento < 0) return { ok: false, msg: "O abatimento não pode ser negativo." };
  if (valorTotal < 0) return { ok: false, msg: "O total não pode ser negativo." };

  return { ok: true, msg: "" };
}

function formatarMoedaCurto(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
