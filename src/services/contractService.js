// Serviço para operações de contrato no Firestore.
// Centraliza a leitura de contrato + cliente, cálculos derivados e atualização de pagamento.
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp, collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import { calcularParcelas, jurosPorParcelaPorFrequencia } from "../utils/parcelasUtil";
import { calculateInterest, calculatePenalty, calculateInstallmentValue, calculateDebtRemaining, calculatePrincipalQuitado, totalAbatimentos, getNextOpenInstallment, shiftFutureInstallments, avancarData } from "./paymentCalculations";
import { registrarPagamento as registrarHistorico } from "./paymentHistoryService";
import { registrarJurosRecebido as registrarJuros } from "./jurosRecebidosService";
import { criarNotificacao } from "./notificationsService";
import {
  criarNotificationEvent,
  dispatchNotificationEvent,
  obterDeviceIdLocal,
} from "./notificationEvents";
import { EVENT_TYPES } from "../utils/notificationEventTypes";
import { notifyWrite as syncNotifyWrite } from "./sync/SyncManager";
import { mostrarNotificacaoNativa } from "../utils/notifications";
import { formatarMoeda } from "../utils/formatadores";

/**
 * Converte uma data (string YYYY-MM-DD, Date ou Firestore Timestamp) para um
 * Date interpretado no HORÁRIO LOCAL — NUNCA UTC.
 *
 * O JavaScript trata string "YYYY-MM-DD" como meia-noite UTC. No fuso brasileiro
 * (UTC-3) isso faz o dia "andar" para trás em 1 (ex: "2027-01-30" → 29/01 local).
 * Fazemos parse explícito dos componentes para preservar o dia do calendário.
 */
function parseDataLocal(data) {
  if (!data) return null;
  // Firestore Timestamp
  if (typeof data.toDate === "function") {
    return data.toDate();
  }
  if (data instanceof Date) {
    return Number.isNaN(data.getTime()) ? null : data;
  }
  if (typeof data === "string") {
    // YYYY-MM-DD (sem T): string pura de data → parse LOCAL
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    // ISO com hora (ex: 2026-08-30T12:00:00) → new Date respeita TZ local quando
    // não há offset "Z"; mantemos o comportamento padrão.
    return new Date(data);
  }
  return null;
}

/** Formata um Date (horário local) para string YYYY-MM-DD sem drift de timezone. */
function formatarDataLocal(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Busca um contrato real validando a posse (subcoleção do usuário autenticado).
// Retorna { contrato, cliente } ou null quando não encontra.
export async function buscarContrato(usuario, id) {
  if (!usuario || !id) return null;
  const snap = await getDoc(doc(db, "usuarios", usuario.uid, "contratos", id));
  if (!snap.exists()) return null;
  const contrato = { id: snap.id, ...snap.data() };
  let cliente = null;
  if (contrato.clienteId) {
    try {
      const cliSnap = await getDoc(doc(db, "clientes", contrato.clienteId));
      if (cliSnap.exists() && cliSnap.data().ownerId === usuario.uid) {
        cliente = { id: cliSnap.id, ...cliSnap.data() };
      }
    } catch (err) {
      console.error("Erro ao buscar cliente:", err);
    }
  }
  return { contrato, cliente };
}

// Status real do contrato — usa a regra canônica definida em
// `paymentCalculations.calcularStatusContrato` (próxima parcela não paga
// vs data atual). Fonte única de verdade para "Em dia" / "Atrasado" /
// "Quitado" em toda a aplicação.
export { calcularStatusContrato as statusContrato } from "./paymentCalculations";

// Parcelas calculadas a partir dos campos reais do contrato, incluindo abatimentos.
// Passa o campo `abatimentos` (array no contrato) para que calcularParcelas
// distribua corretamente o principal restante nas parcelas futuras.
//
// OVERRIDE DE VENCIMENTOS (juros_apenas):
// Quando o usuário paga "Só os juros", o vencimento da parcela selecionada
// e de todas as posteriores é deslocado por 1 frequência e persistido no
// Firestore como `vencimentosCustom` (array de {numero, vencimento}).
//
// REGRA DEFINITIVA (corrigida):
// - vencimentosCustom é a fonte de verdade parcial: persiste apenas os overrides
//   aplicados por juros_apenas. As parcelas sem override DEVEM ter suas datas
//   reconstruídas CONTINUANDO a sequência a partir do último override anterior.
// - Isso garante que, se P1 e P2 têm overrides mas P3 não, P3 continua a partir
//   de P2 (cumulativo), nunca da data original de dataPrimeiraParcela.
//
// Algoritmo:
// 1. calcularParcelas gera o cronograma original (fonte canônica)
// 2. Percorre em ordem numérica; para cada parcela:
//    - Se tem override: usar a data customizada; atualiza o "último deslocamento conhecido"
//    - Se não tem override: continuar a partir do override anterior mais próximo
export function parcelasDoContrato(contrato, hoje = new Date()) {
  const parcelasBase = calcularParcelas(contrato, hoje, contrato.abatimentos || null);

  let parcelas = parcelasBase;

  // Override de valor/vencimento/observacoes por renegociação (parcelasCustom)
  // APLICA PRIMEIRO — representa a alteração mais antiga explícita pelo usuário.
  const parcelasCustom = Array.isArray(contrato?.parcelasCustom) ? contrato.parcelasCustom : null;
  if (parcelasCustom && parcelasCustom.length > 0) {
    const mapaPC = new Map();
    parcelasCustom.forEach((v) => {
      const num = Number(v.numero);
      if (!isNaN(num)) mapaPC.set(num, v);
    });

    parcelas = parcelas.map((p) => {
      const num = Number(p.numero);
      if (mapaPC.has(num)) {
        const override = mapaPC.get(num);
        return {
          ...p,
          // SOMENTE para parcelas NÃO pagas: o valorCustom (renegociação) prevalece.
          // Para parcelas Pagas, o valor já é o efetivamente recebido (recebido),
          // e não deve ser sobrescrito pelo valor renegociado original.
          ...(override.valor !== undefined && p.status !== "Paga" && { valor: Number(override.valor) }),
          ...(override.vencimento !== undefined && { vencimento: override.vencimento }),
          ...(override.observacoes !== undefined && { observacoes: override.observacoes }),
          renegociada: true,
        };
      }
      return p;
    });
  }

  // Override de vencimentos por juros_apenas (cumulativo)
  // APLICA POR ÚLTIMO — representa a operação mais RECENTE (deslocamento de juros).
  // Precedência: vencimentosCustom prevalece sobre parcelasCustom.
  const custom = Array.isArray(contrato?.vencimentosCustom) ? contrato.vencimentosCustom : null;

  if (custom && custom.length > 0) {
    // Mapeia overrides por numero
    const mapaCustom = new Map();
    custom.forEach((v) => {
      const num = Number(v.numero);
      if (!isNaN(num)) {
        mapaCustom.set(num, typeof v.vencimento === "string" ? v.vencimento.trim() : v.vencimento);
      }
    });

    // Itera mantendo o "último vencimento conhecido" — se uma parcela não
    // tem override, sua data continua a partir do override anterior via avancarData.
    let ultimoVencimento = null; // vencimento da última parcela processada (override ou original)

    parcelas = parcelas.map((p) => {
      const num = Number(p.numero);
      let vencimento;

      if (mapaCustom.has(num)) {
        // Override explícito: preserva a data customizada
        vencimento = mapaCustom.get(num);
        ultimoVencimento = vencimento;
      } else if (ultimoVencimento !== null) {
        // Sem override: continua a partir do último vencimento conhecido
        const novaData = avancarData(contrato.frequencia, ultimoVencimento);
        vencimento = novaData
          ? `${novaData.getFullYear()}-${String(novaData.getMonth() + 1).padStart(2, "0")}-${String(novaData.getDate()).padStart(2, "0")}`
          : ultimoVencimento;
        ultimoVencimento = vencimento;
      } else {
        // Nenhum override anterior: usa a data original de calcularParcelas
        vencimento = p.vencimento;
        ultimoVencimento = vencimento;
      }

      return { ...p, vencimento };
    });
  }

  // Preserva valores estabelecidos em parcelas, corrigindo a regressão onde
  // calcularParcelas() recalcula o valor de parcelas PENDENTES usando
  // saldoPrincipal (que é reduzido quando outra parcela é paga).
  //
  // CAUSA RAIZ: REGRA 1 de calcularParcelas() (linhas 254-271) usa
  // `principalRestante` (= saldoPrincipal) para calcular o valor das parcelas
  // futuras:
  //   valor = (saldoPrincipal / numeroParcelas) + (saldoPrincipal × juros%)
  //
  // Quando P1 é paga INTEGRALMENTE (R$425), saldoPrincipal cai 500→250.
  // P2 é recalculada como (250/2) + (250×0,35) = 212,50 — ERRADO.
  // Deve permanecer R$425 (valor original estabelecido).
  //
  // Solução CIRÚRGICA: preservar o valor original estabelecido no momento
  // da criação do contrato. Os campos `valorOriginalParcela` e `jurosOriginais`
  // são derivados de `valorEmprestado` (IMUTÁVEL) e estão disponíveis em todas
  // as parcelas produzidas por calcularParcelas().
  //
  // REGRA DE PRECEDÊNCIA:
  //   1. Parcela PAGA → preserva p.recebido (já aplicado por calcularParcelas)
  //   2. Parcela RENEGOCIADA (parcelasCustom) → valor já aplicado acima
  //   3. Parcela DINÂMICA (numero > numeroParcelas) → preserva lógica de calcularParcelas
  //   4. Parcela ORIGINAL PENDENTE + SEM ABATIMENTO EXPLÍCITO → valor congelado:
  //      valorOriginalParcela + jurosOriginais (baseado em valorEmprestado, NÃO saldoPrincipal)
  //   5. Parcela ORIGINAL PENDENTE + COM ABATIMENTO EXPLÍCITO (juros_parte_divida)
  //      → recalcula via calcularParcelas() (o saldo foi reduzido de propósito
  //      e P2 deve refletir isso)
  //
  // IMPORTANTE: o array `abatimentos` é reservado EXCLUSIVAMENTE para a
  // modalidade `juros_parte_divida`. Pagamentos normais (parcela_inteira) e
  // "só juros" (juros_apenas) NÃO gravam nesse array — eles apenas
  // decrementam saldoPrincipal e incrementam parcelasPagas.
  const totalOriginal = Number(contrato?.numeroParcelas) || 0;
  const temAbatimento = totalAbatimentos(contrato?.abatimentos) > 0;
  // Para o recálculo em caso de abatimento explícito, a base é
  // `valorEmprestado - abatimentoTotal` (NÃO `saldoPrincipal` do Firestore).
  // Pagamentos normais (parcela_inteira) já quitaram suas parcelas; eles não
  // devem reduzir a base das parcelas futuras. Apenas o `juros_parte_divida`
  // (abatimento explícito) reduz a base de cálculo.
  const valorEmprestadoBase = Number(contrato?.valorEmprestado) || 0;
  const baseRecalculo = Math.max(0, valorEmprestadoBase - totalAbatimentos(contrato?.abatimentos));
  // Fração de juros por parcela varia por periodicidade:
  //   - Mensal: 0,35 (sem dividir por N) — taxa a.m.
  //   - Semanal/Diária/Quinzenal: 0,35/N — juros total ÷ N
  const fracaoJuros = jurosPorParcelaPorFrequencia(contrato);
  const valorRecalculado = totalOriginal > 0
    ? Math.round(((baseRecalculo / totalOriginal) + (baseRecalculo * fracaoJuros)) * 100) / 100
    : 0;
  parcelas = parcelas.map((p) => {
    // Paga: já preservado por calcularParcelas (valor = recebido)
    if (p.status === "Paga") return p;

    // Renegociada (parcelasCustom): valor já foi aplicado acima — não sobrescrever
    if (p.renegociada) return p;

    // Dinâmica: preserva lógica existente de calcularParcelas (REGRA 2)
    if (totalOriginal > 0 && Number(p.numero) > totalOriginal) return p;

    // Se há abatimento EXPLÍCITO (juros_parte_divida), recalcula o valor
    // das parcelas futuras usando `valorEmprestado - abatimentoTotal` como
    // base. Isso garante que a fórmula correta (ex: 1700-50=1650; 1650/6 +
    // 1650×0,35/6 = 371,25) seja aplicada.
    if (temAbatimento) {
      return { ...p, valor: valorRecalculado };
    }

    // Original pendente sem abatimento explícito: pagamento normal ou
    // nenhuma redução de saldo. Congela o valor original estabelecido
    // no momento da criação do contrato (valorEmprestado imutável).
    const valorOriginal = Math.round(
      (Number(p.valorOriginalParcela) + Number(p.jurosOriginais)) * 100
    ) / 100;
    return { ...p, valor: valorOriginal };
  });

  return parcelas;
}

// Recalcula a data de próximo vencimento a partir do novo estado de parcelasPagas.
// Usa getNextOpenInstallment para encontrar a primeira parcela não paga.
function recalcularDataProximo(contrato, parcelasPagas, total, saldoPrincipal, abatimentos) {
  // Se todas as parcelas originais foram pagas mas saldo ainda > 0,
  // uma parcela dinâmica será criada — então dataProximo deve ser recalculada.
  if (parcelasPagas >= total && saldoPrincipal <= 0) return null;
  const contratoAtualizado = { ...contrato, parcelasPagas, quitado: false, saldoPrincipal, abatimentos };
  const proxima = getNextOpenInstallment(contratoAtualizado, new Date());
  if (proxima?.vencimento) {
    // Usa parse LOCAL para evitar drift de timezone no toISOString (que é UTC).
    // proxima.vencimento pode ser Date (calcularParcelas) ou string YYYY-MM-DD
    // (override via vencimentosCustom). Em ambos os casos, formata como string
    // preservando o dia do calendário exibido ao usuário.
    return formatarDataLocal(proxima.vencimento instanceof Date ? proxima.vencimento : parseDataLocal(proxima.vencimento));
  }
  return contrato.dataProximo;
}

// Adiciona um novo abatimento ao array, preservando existentes
function adicionarAbatimento(existentes, parcelaNumero, valor, data, observacao) {
  const arr = Array.isArray(existentes) ? [...existentes] : [];
  if (Number(valor) > 0) {
    arr.push({ parcelaNumero, valor: Number(valor), data, observacao: observacao || "" });
  }
  return arr;
}

/**
 * Processa um pagamento avançado com 4 modalidades:
 * "parcela_inteira", "juros_apenas", "juros_parte_divida", "quitar_tudo"
 *
 * NOVA LÓGICA FINANCEIRA:
 * - saldoPrincipal: saldo do contrato após abatimentos (Reduzido pelo abatimento)
 * - juros: SEMPRE sobre valorEmprestado ORIGINAL
 * - principalQuitado: soma de principal pago em parcelas fechadas
 * - Abatimento reduz o saldoPrincipal (nunca a parcela já paga)
 *
 * Recebe:
 * - usuario: usuário autenticado (uid)
 * - contrato: objeto contrato completo
 * - parcela: objeto parcela da lista calculada
 * - modalidade: string da modalidade selecionada
 * - valores: { valorJuros?, valorAbatimento?, valorTotal? }
 * - dataRecebimento: ISO string (YYYY-MM-DD)
 * - observacao: texto
 *
 * Retorna: { parcelasPagas, valorRecebido, quitado, dataProximo, saldoRestante, saldoPrincipal }
 */
export async function processarPagamento(usuario, contrato, parcela, modalidade, valores, dataRecebimento, observacao = "") {
  if (!usuario || !contrato) throw new Error("Contexto inválido");

  const total = Number(contrato.numeroParcelas) || 1;
  const valorEmprestado = Number(contrato.valorEmprestado) || 0;
  const jurosTaxa = Number(contrato.juros) || 0;

  // Valor original do principal por parcela (sem juros incorporados)
  const valorBaseParcela = valorEmprestado > 0 && total > 0
    ? valorEmprestado / total
    : (Number(contrato.valorParcela) || 0);

  // Juros sobre o VALOR ORIGINAL (nunca sobre saldo reduzido)
  const jurosPorParcela = calculateInterest(valorEmprestado, jurosTaxa);

  // Saldo principal: usa campo existente ou calcula (fallback)
  const saldoPrincipalAntes = contrato.saldoPrincipal !== undefined && contrato.saldoPrincipal !== null
    ? Number(contrato.saldoPrincipal)
    : calculateDebtRemaining(contrato);

  // Abatimentos existentes no contrato
  let abatimentos = Array.isArray(contrato.abatimentos) ? [...contrato.abatimentos] : [];
  const abatimentoTotalAntes = totalAbatimentos(abatimentos);

  // Estado atual
  let parcelasPagas = Number(contrato.parcelasPagas) || 0;
  let valorRecebido = Number(contrato.valorRecebido) || 0;
  let jurosRecebidosTotal = Number(contrato.jurosRecebidos) || 0; // juros acumulados recebidos
  let saldoPrincipalAtual = saldoPrincipalAntes;

  let totalRecebido = 0;
  let jurosRecebidos = 0;
  let principalAbatido = 0;

  // Validação: não permitir pagamento se quitado
  if (contrato.quitado) {
    throw new Error("Este contrato já está quitado.");
  }

  switch (modalidade) {
    case "parcela_inteira": {
      // Pagar uma parcela específica com juros + multa
      const multa = calculatePenalty(contrato, parcela, new Date());

      // Fonte oficial do valor da parcela:
      // - Renegociada: parcela.valor é o TOTAL renegociado (já com juros).
      //   NÃO recalcular a partir de valorOriginalParcela — isso descartaria
      //   a renegociação e registraria o valor antigo.
      // - Original: parcela.valor vem de calcularParcelas (valorBaseParcela + juros).
      //   Mantém o cálculo de fallback se por algum motivo vier 0.
      const valorParcelaAtual = Number(parcela.valor) > 0
        ? Number(parcela.valor)
        : calculateInstallmentValue(parcela.valorOriginalParcela || valorBaseParcela, jurosPorParcela + multa);

      // Total a receber = parcela.valor (já inclui juros para renegociada).
      // A multa só é somada aqui quando NÃO está embutida em parcela.valor.
      // Para parcelas "Vencida" (geradas por `parcelasUtil.js:351`), o
      // `parcela.valor` JÁ contém a multa — somar de novo causaria cobrança
      // duplicada. Para "Pendente", a multa precisa ser adicionada.
      //
      // Esta é uma das correções do bug que impedia pagar parcelas vencidas:
      // antes, somávamos a multa em qualquer caso, inflando o total a receber
      // e fazendo `jurosRecebidos` ficar muito maior que os juros reais
      // embutidos em parcela.valor (o que zerava `principalPago`).
      const multaJaEmbutida = parcela.status === "Vencida" && Number(parcela.valor) > 0;
      const valorTotalParcela = multaJaEmbutida
        ? Math.round(valorParcelaAtual * 100) / 100
        : Math.round((valorParcelaAtual + multa) * 100) / 100;

      totalRecebido = Number(valores.valorTotal) || valorTotalParcela;

      // Parte de juros desta parcela
      // - Renegociada: juros já estão DENTRO de parcela.valor (que é o total
      //   renegociado). A fração de juros da renegociação é jurosPorParcela
      //   (a parte de juros que a parcela original continha). O principal
      //   efetivo da renegociação é parcela.valor - jurosPorParcela.
      //   Ex: parcela.valor=450, jurosPorParcela=175 → principal=275.
      //   Sem isso, o sistema somaria jurosPorParcela de novo em jurosRecebidos
      //   e zeraria o principal pago, gerando abatimento espúrio.
      // - Original: jurosPorParcela + multa.
      // BUG FIX: o codigo antigo usava `jurosPorParcela` (juros TOTAL sobre
      // valorEmprestado) como a fracao de juros desta parcela, mas
      // `parcela.valor` (produzido por `parcelasUtil.js`) so embute o juros
      // POR parcela. Usar `jurosPorParcela` inflava `jurosRecebidos` e zerava
      // `principalPago`, de modo que `parcelasPagas` nunca incrementava
      // (a parcela permanecia Pendente/Vencida mesmo apos o usuario
      // confirmar o pagamento).
      //
      // Correcao: usar `parcela.jurosOriginais` (juros POR parcela) como a
      // fracao de juros embutida em `parcela.valor`. Para "Vencida" a multa
      // ja esta em `parcela.valor` (e descontada via `principalMaximo`).
      const jurosDaParcela = Number(parcela.jurosOriginais) || 0;
      if (parcela.renegociada) {
        jurosRecebidos = jurosDaParcela;
      } else if (multaJaEmbutida) {
        jurosRecebidos = jurosDaParcela;
      } else {
        jurosRecebidos = jurosDaParcela + multa;
      }

      // Parte de principal: o que sobra após pagar juros + multa
      // Capped no principal da parcela efetiva:
      // - Original: valorBaseParcela (valorEmprestado / numeroParcelas)
      // - Renegociada: (parcela.valor - jurosRecebidos) — o principal da renegociação.
      //   Ex: parcela.valor=450, jurosRecebidos=175 → principalPago pode chegar a 275,
      //   NÃO limitado ao valorBaseParcela original de 250. Isso evita que o pagamento
      //   integral de R$450 gere um abatimento espúrio de R$25.
      // Para parcelas NÃO renegociadas: mantém o cap original em valorBaseParcela.
      const principalMaximo = parcela.renegociada
        ? Math.max(0, Number(parcela.valor) - jurosRecebidos)
        : valorBaseParcela;
      let principalPago = Math.min(Math.max(0, totalRecebido - jurosRecebidos), principalMaximo);

      valorRecebido += totalRecebido;
      jurosRecebidosTotal += jurosRecebidos;

      // Caso o valor pago seja MENOR que os juros (totalRecebido < jurosRecebidos):
      // O pagamento não cobre os juros integralmente. O que foi pago é contabilizado
      // como redução do saldoPrincipal (principal quitado desta parcela), sem
      // registrar em `abatimentos` — o array `abatimentos` é reservado EXCLUSIVAMENTE
      // para abatimentos EXPLÍCITOS (modalidade `juros_parte_divida`).
      // Isso garante que um pagamento de R$ 50 em uma parcela cuja parte de juros
      // é R$ 157,50 ainda reduza o saldoPrincipal em R$ 50 e marque a parcela como PAGA,
      // sem disparar recálculo das parcelas futuras.
      // Regra: qualquer pagamento parcial (mesmo menor que juros) marca a parcela atual como PAGA.
      if (totalRecebido < jurosRecebidos) {
        const abatimentoParcial = Math.min(totalRecebido, saldoPrincipalAntes);
        if (abatimentoParcial > 0) {
          // Decrementa o saldoPrincipal (reflete o principal quitado) sem criar
          // registro em `abatimentos` — pagamento NORMAL nunca é abatimento explícito.
          saldoPrincipalAtual = Math.max(0, saldoPrincipalAntes - abatimentoParcial);
          principalAbatido = abatimentoParcial;
          // O valor pago conta como pagamento de principal da parcela
          principalPago = abatimentoParcial;
          // Marca a parcela atual como PAGA — qualquer pagamento parcial (mesmo < juros)
          // quita a parcela atual. O saldo restante do principal continua no contrato.
          parcelasPagas += 1;
          // Não cobra juros quando o pagamento não cobre a parte de juros
          jurosRecebidos = 0;
          jurosRecebidosTotal = Math.max(0, jurosRecebidosTotal - jurosRecebidos);
        }
      } else {
        // Pagamento maior ou igual aos juros: atualiza saldoPrincipal normalmente
        saldoPrincipalAtual = Math.max(0, saldoPrincipalAntes - principalPago);

        // Se houver excedente (total > juros + principal base), desconta do saldo
        // sem criar registro em `abatimentos` — pagamento NORMAL nunca é
        // abatimento explícito.
        const excedente = Math.max(0, totalRecebido - jurosRecebidos - principalPago);
        if (excedente > 0) {
          saldoPrincipalAtual = Math.max(0, saldoPrincipalAtual - excedente);
          principalAbatido = excedente;
        }

        // Atualiza parcelasPagas: marca como paga quando o pagamento cobre
        // pelo menos o principal da parcela (totalRecebido >= jurosRecebidos + valorBaseParcela)
        const principalPagoAcumulado = (parcelasPagas * valorBaseParcela) + principalPago;
        while (parcelasPagas < total) {
          const proximaParcelaBase = (parcelasPagas + 1) * valorBaseParcela;
          if (principalPagoAcumulado >= proximaParcelaBase) {
            parcelasPagas += 1;
          } else {
            break;
          }
        }
      }
      break;
    }

    case "juros_apenas": {
      // Receber apenas juros — não reduz principal
      const multa = calculatePenalty(contrato, parcela, new Date());
      const jurosParcela = jurosPorParcela + multa;

      jurosRecebidos = valores.valorJuros !== undefined ? Number(valores.valorJuros) : jurosParcela;
      jurosRecebidos = Math.max(0, jurosRecebidos);

      totalRecebido = jurosRecebidos;
      valorRecebido += totalRecebido;
      jurosRecebidosTotal += jurosRecebidos;

      // Principal NÃO é reduzido — nenhum abatimento
      principalAbatido = 0;
      break;
    }

    case "juros_parte_divida": {
      // Receber juros + parte do principal (abatimento do saldoPrincipal)
      const multa = calculatePenalty(contrato, parcela, new Date());

      // Juros recebidos (sobre valor original, editável pelo usuário)
      jurosRecebidos = valores.valorJuros !== undefined ? Number(valores.valorJuros) : jurosPorParcela;
      jurosRecebidos = Math.max(0, jurosRecebidos);

      // Principal abatido (reduz o saldoPrincipal)
      principalAbatido = valores.valorAbatimento !== undefined ? Number(valores.valorAbatimento) : 0;
      principalAbatido = Math.max(0, principalAbatido);

      // Validação: abatimento não pode exceder o saldo principal restante
      // saldoPrincipalAntes já reflete abatimentos + principal pago via parcelas anteriores
      const principalDisponivel = saldoPrincipalAntes;

      if (principalAbatido > principalDisponivel) {
        throw new Error(
          `O abatimento não pode exceder ${Math.round(principalDisponivel * 100) / 100} (saldo principal restante).`
        );
      }

      totalRecebido = jurosRecebidos + principalAbatido;
      valorRecebido += totalRecebido;
      jurosRecebidosTotal += jurosRecebidos;

      // Aplica abatimento ao saldoPrincipal
      if (principalAbatido > 0 && parcela?.numero) {
        abatimentos = adicionarAbatimento(abatimentos, parcela.numero, principalAbatido, dataRecebimento, observacao);
        saldoPrincipalAtual = Math.max(0, saldoPrincipalAntes - principalAbatido);
      }
      break;
    }

    case "quitar_tudo": {
      // Pagar tudo: principal restante + juros sobre original + multa da parcela atual
      const multa = calculatePenalty(contrato, parcela, new Date());
      const jurosQuitacao = calculateInterest(valorEmprestado, jurosTaxa);

      jurosRecebidos = jurosQuitacao + multa;
      principalAbatido = saldoPrincipalAntes; // paga todo o principal restante
      totalRecebido = valores.valorTotal !== undefined ? Number(valores.valorTotal) : (jurosRecebidos + principalAbatido);

      valorRecebido += totalRecebido;
      jurosRecebidosTotal += jurosRecebidos;
      saldoPrincipalAtual = 0;

      parcelasPagas = total;
      break;
    }

    default:
      throw new Error(`Modalidade desconhecida: ${modalidade}`);
  }

  const abatimentoTotalFinal = totalAbatimentos(abatimentos);
  // quitado apenas quando todas as parcelas originais foram pagas E saldo zerado
  // Se saldoPrincipalAtual > 0 após pagar todas originais, o contrato NÃO está
  // quitado — uma parcela dinâmica (REGRA 2) deve ser criada.
  const quitado = parcelasPagas >= total && saldoPrincipalAtual <= 0;
  const dataProximo = recalcularDataProximo(contrato, parcelasPagas, total, saldoPrincipalAtual, abatimentos);

  // saldoPrincipalAtual já reflete abatimentos + principal pago via parcelas.
  // Como saldoPrincipalAtual é o total restante, não precisamos subtrair principalQuitado.
  // principalQuitadoFinal é apenas para registro/informação.
  const principalQuitadoFinal = parcelasPagas * valorBaseParcela;
  const saldoRestante = Math.max(0, saldoPrincipalAtual);

  // Persiste no Firestore — inclui o array de abatimentos.
  // REGRA vencimentosCustom: o array é PRESERVADO em todas as modalidades.
  // - juros_apenas: recalcula (bloque abaixo) e sobrescreve com deslocamento cumulativo.
  // - outras modalidades: mantêm o array existente para que as datas
  //   personalizadas não voltem para dataPrimeiraParcela original.
  const vencimentosCustomExistente = Array.isArray(contrato?.vencimentosCustom)
    ? contrato.vencimentosCustom
    : null;

  const updateData = {
    parcelasPagas,
    valorRecebido,
    jurosRecebidos: jurosRecebidosTotal,
    saldoPrincipal: saldoPrincipalAtual,
    abatimentoTotal: abatimentoTotalFinal,
    quitado,
    dataProximo,
    abatimentos,
    updatedAt: serverTimestamp(),
  };

  // Preserva vencimentosCustom existente para modalidades que não recalculam.
  // juros_apenas é tratado no bloco abaixo (onde recalcula e sobrescreve).
  if (modalidade !== "juros_apenas" && vencimentosCustomExistente) {
    updateData.vencimentosCustom = vencimentosCustomExistente;
  }

  // "Só os juros" — desloca o vencimento da parcela selecionada e de todas as
  // posteriores por 1 frequência. Persiste como vencimentosCustom para que o
  // deslocamento seja refletido nas próximas leituras (override em parcelasDoContrato).
  // - Parcelas anteriores: NÃO alteram.
  // - Juros só na parcela selecionada (já registrado acima).
  // - Valores e status das posteriores preservados.
  if (modalidade === "juros_apenas" && parcela?.numero) {
    const contratoAposPagamento = {
      ...contrato,
      parcelasPagas,
      saldoPrincipal: saldoPrincipalAtual,
      abatimentos,
    };
    // FIX CUMULATIVO: usa parcelasDoContrato ao invés de calcularParcelas —
    // parcelasDoContrato aplica vencimentosCustom existente como override antes
    // do shift, garantindo que o novo deslocamento prossiga das datas já
    // customizadas (não das originais de dataPrimeiraParcela).
    const parcelasPosPagamento = parcelasDoContrato(contratoAposPagamento, new Date());
    const indiceSelecionado = parcelasPosPagamento.findIndex(
      (p) => p.numero === parcela.numero
    );
    if (indiceSelecionado >= 0) {
      const parcelasDeslocadas = shiftFutureInstallments(
        parcelasPosPagamento,
        indiceSelecionado,
        contrato.frequencia
      );

      // MERGE CUMULATIVO: o novo vencimentosCustom deve CONTER:
      //  (a) os overrides já existentes das parcelas ANTERIORES à selecionada
      //      (que não sofreram shift nesta operação) — preservados por número;
      //  (b) as novas datas deslocadas da parcela selecionada em diante.
      //
      // Regra: nunca apagar um override existente. Usa um Map por numero para
      // unir sem perder nenhuma data customizada anterior.
      const merged = new Map();

      // (a) Preserva overrides existentes de parcelas anteriores à selecionada
      if (vencimentosCustomExistente && indiceSelecionado > 0) {
        vencimentosCustomExistente.forEach((v) => {
          if (Number(v.numero) < Number(parcelasPosPagamento[indiceSelecionado].numero)) {
            merged.set(Number(v.numero), v.vencimento);
          }
        });
      }
      // (b) Novas datas deslocadas (selecionada + posteriores)
      parcelasDeslocadas.slice(indiceSelecionado).forEach((p) => {
        merged.set(Number(p.numero), p.vencimento);
      });

      // Serializa preservando a ordem numérica crescente
      updateData.vencimentosCustom = Array.from(merged.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([numero, vencimento]) => ({ numero, vencimento }));
    }
  }

  // Se não há abatimentos, remove os campos do objeto de atualização
  if (!abatimentos || abatimentos.length === 0) {
    delete updateData.abatimentos;
    delete updateData.abatimentoTotal;
  }

  await updateDoc(doc(db, "usuarios", usuario.uid, "contratos", contrato.id), updateData);
  // Notifica o SyncManager: o contrato mudou (pagamento processado).
  // O listener singleton recebe o push oficial e atualiza os subscribers.
  syncNotifyWrite(usuario.uid, "contratos");

  // Registra no histórico.
  // - "Só os juros" (juros_apenas) → coleção dedicada `jurosRecebidos`
  //   (NÃO é pagamento de parcela; apenas registro histórico para badge).
  // - Outras modalidades → coleção `pagamentos` (comportamento existente).
  if (modalidade === "juros_apenas") {
    try {
      console.log("[DIAG] gravando juros: uid=", usuario?.uid, "contratoId=", contrato?.id, "parcelaNumero=", parcela?.numero);
      const id = await registrarJuros(usuario, contrato, {
        parcelaNumero: parcela?.numero,
        valorRecebido: jurosRecebidos,
        dataRecebimento,
        observacao,
      });
      console.log("[DIAG] juros gravado com id=", id);
    } catch (err) {
      console.error("[DIAG] erro registrar juros:", err?.code, err?.message);
      // Não falha a operação principal se o histórico falhar
    }
  } else {
    try {
      console.log("[DIAG] gravar histórico: uid=", usuario?.uid, "contratoId=", contrato?.id, "parcelaNumero=", parcela?.numero, "modalidade=", modalidade);
      const id = await registrarHistorico(usuario, contrato, {
        valorRecebido: totalRecebido,
        tipoRecebimento: modalidade === "parcela_inteira" ? "parcela"
          : modalidade === "juros_parte_divida" ? "parcial"
          : "quitacao",
        jurosRecebidos,
        principalAbatido,
        dataRecebimento,
        parcelaNumero: parcela?.numero,
        observacao,
        saldoAntes: Number(contrato.valorRecebido) || 0,
        saldoDepois: valorRecebido,
        saldoPrincipalAntes: saldoPrincipalAntes,
        saldoPrincipalDepois: saldoPrincipalAtual,
        abatimentoTotalAntes: abatimentoTotalAntes,
        abatimentoTotalDepois: abatimentoTotalFinal,
      });
      console.log("[DIAG] histórico gravado com id=", id);
    } catch (err) {
      console.error("[DIAG] erro registrar histórico:", err?.code, err?.message);
      // Não falha a operação principal se o histórico falhar
    }
  }

  // Notificação do app: "pagamento_recebido".
  //
  // IMPORTANTE: esta chamada acontece DEPOIS do `updateDoc` do contrato
  // (linha 620) e DEPOIS do registro no histórico (parcelas / jurosRecebidos).
  // Ou seja: o pagamento já está confirmado no Firestore antes da notificação
  // ser criada — não criamos notificações "fantasma" se o pagamento falhar.
  //
  // O erro de criarNotificacao é propagado (NÃO silenciado). Se as regras
  // de segurança do Firestore bloquearem a escrita em `notificacoes`, o
  // erro aparece no console e no fluxo chamador (`ReceberPagamento`).
  const titulo = modalidade === "juros_apenas" ? "Juros recebidos" : "Pagamento recebido";
  const nomeCliente = contrato?.clienteNome || contrato?.nome || "cliente";
  const valorNotif = modalidade === "juros_apenas" ? jurosRecebidos : totalRecebido;
  const descricaoNotif = `${nomeCliente} · parcela ${parcela?.numero} · ${formatarMoeda(valorNotif)}`;

  // === FASE C: evento central + dispatch (best-effort) ===
  // Gera eventId uma vez por pagamento. Disparado ANTES do criarNotificacao
  // legado (sino) para que a in-app notif ja carregue o eventId e o
  // dispatch FCM rode em paralelo. Falha de qualquer passo do fluxo
  // central NAO quebra o pagamento.
  const eventId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  const sourceDeviceId = obterDeviceIdLocal();
  const eventData = {
    contratoId: contrato.id,
    parcelaNumero: parcela?.numero ?? null,
    valor: valorNotif,
    modalidade,
    clienteNome: nomeCliente,
  };
  try {
    await criarNotificationEvent({
      eventId,
      type: EVENT_TYPES.PAYMENT_REGISTERED,
      ownerId: usuario.uid,
      sourceDeviceId,
      data: eventData,
      title: titulo,
      body: descricaoNotif,
    });
  } catch (err) {
    console.warn("[contract-svc] criarNotificationEvent falhou (ignorado):", err && err.message);
  }
  try {
    await dispatchNotificationEvent({
      eventId,
      sourceDeviceId,
    });
  } catch (err) {
    console.warn("[contract-svc] dispatchNotificationEvent falhou (ignorado):", err && err.message);
  }

  // Notificacao legada (sino). Mantem o tipo legado "pagamento_recebido"
  // para nao quebrar UI do sino. Propaga eventId para dedup server-side
  // caso a chamada seja repetida (refresh rapido / onSnapshot re-emit).
  const notifResultado = await criarNotificacao(usuario.uid, {
    tipo: "pagamento_recebido",
    titulo,
    descricao: descricaoNotif,
    contratoId: contrato.id,
    parcelaNumero: parcela?.numero,
    valor: valorNotif,
    eventId,
  });
  console.log(
    "[notif] pagamento_recebido criada:",
    typeof notifResultado === "string" ? notifResultado : "(skipped)",
    "uid=",
    usuario?.uid,
    "contratoId=",
    contrato?.id,
    "parcela=",
    parcela?.numero,
    "valor=",
    valorNotif,
    "eventId=",
    eventId,
  );

  // Notificação NATIVA do navegador (Windows/Chrome toast).
  // - Disparada SOMENTE após a confirmação Firestore do `criarNotificacao`
  //   (1 doc Firestore ↔ 1 toast nativo, sem duplicação).
  // - `mostrarNotificacaoNativa` é best-effort: checa `Notification.permission
  //   === "granted"`, é envolvida em try/catch interno, e não propaga erro.
  //   Falha da nativa NUNCA quebra o pagamento.
  // - `tag` dedup no nível do Chrome: dois eventos idênticos para o mesmo
  //   contrato+parcela na mesma janela viram 1 toast (substitui em vez de empilhar).
  mostrarNotificacaoNativa(titulo, descricaoNotif, {
    tipo: "pagamento_recebido",
    contratoId: contrato.id,
    parcelaNumero: parcela?.numero,
    tag: `jurex:pagamento_recebido:${contrato.id}:${parcela?.numero ?? "-"}`,
  });

  return { parcelasPagas, valorRecebido, quitado, dataProximo, saldoRestante, saldoPrincipal: saldoPrincipalAtual };
}

// Mantém a função original para compatibilidade
export async function registrarPagamento(usuario, contrato, valorPago, dataPagamento, observacao = "") {
  return processarPagamento(
    usuario,
    contrato,
    null,
    "parcela_inteira",
    { valorTotal: Number(valorPago) || 0 },
    dataPagamento,
    observacao
  );
}

// Remove um contrato (apenas para o proprietário)
export async function excluirContrato(usuario, contratoId) {
  if (!usuario || !contratoId) throw new Error("Contexto inválido");

  // === FASE C: evento central + dispatch ANTES do delete ===
  // Gera eventId para o delete. Disparado antes do deleteDoc para que
  // o evento central fique registrado mesmo se o deleteDoc falhar
  // parcialmente (o dispatch falha → status fica pending, mas o evento
  // existe para retry futuro). Best-effort: try/catch com log.
  // Nao cria notificacao in-app legada (codigo original nao criava).
  const eventId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  const sourceDeviceId = obterDeviceIdLocal();
  try {
    await criarNotificationEvent({
      eventId,
      type: EVENT_TYPES.CONTRACT_DELETED,
      ownerId: usuario.uid,
      sourceDeviceId,
      data: { contratoId },
      title: "Contrato excluído",
      body: "Um contrato foi excluído.",
    });
  } catch (err) {
    console.warn("[contract-svc] criarNotificationEvent(delete) falhou (ignorado):", err && err.message);
  }
  try {
    await dispatchNotificationEvent({
      eventId,
      sourceDeviceId,
    });
  } catch (err) {
    console.warn("[contract-svc] dispatchNotificationEvent(delete) falhou (ignorado):", err && err.message);
  }

  await deleteDoc(doc(db, "usuarios", usuario.uid, "contratos", contratoId));
  // Notifica o SyncManager para registro de invalidação. O listener
  // singleton de `contratos` recebe o push oficial do Firestore e
  // atualiza todos os subscribers. Best-effort — não bloqueia o fluxo.
  syncNotifyWrite(usuario.uid, "contratos");
}

/**
 * Renegocia uma parcela: atualiza valor, vencimento e observações.
 *
 * Persiste como `parcelasCustom` (array de {numero, valor, vencimento, observacoes})
 * dentro do documento do contrato — mesmo padrão de vencimentosCustom/abatimentos.
 *
 * Se a parcela já foi renegociada anteriormente (mesmo número), atualiza o
 * override existente — NÃO acumula entradas duplicadas.
 *
 * @param {object} usuario - usuário autenticado (uid)
 * @param {object} contrato - documento do contrato completo
 * @param {number} parcelaNumero - número da parcela a renegociar
 * @param {number} novoValor - novo valor da parcela
 * @param {string} novoVencimento - nova data (YYYY-MM-DD)
 * @param {string} observacoes - observações da renegociação
 * @returns {Promise<{ parcela: object }>} - a parcela atualizada
 */
export async function renegociarParcela(usuario, contrato, parcelaNumero, novoValor, novoVencimento, observacoes = "") {
  if (!usuario || !contrato) throw new Error("Contexto inválido");
  if (!parcelaNumero || isNaN(Number(parcelaNumero))) throw new Error("Número da parcela inválido");
  if (!novoValor || Number(novoValor) <= 0) throw new Error("O novo valor deve ser maior que zero");
  if (!novoVencimento) throw new Error("A nova data de vencimento é obrigatória");

  const num = Number(parcelaNumero);
  const valor = Number(novoValor);
  const vencimento = String(novoVencimento).trim();

  // Carrega o estado atual do Firestore para evitar perda de concorrência
  const snap = await getDoc(doc(db, "usuarios", usuario.uid, "contratos", contrato.id));
  if (!snap.exists()) throw new Error("Contrato não encontrado");
  const dadosAtuais = snap.data();

  // Verifica permissão: o documento deve pertencer ao usuário
  if (dadosAtuais.ownerId !== usuario.uid && dadosAtuais.uid !== usuario.uid && dadosAtuais.ownerUid !== usuario.uid) {
    // Se não houver ownerId explícito, assume que o caminho já garante
    // a posse (Firestore rules). Mas verificamos se há alguma proteção.
    // Em contratos criados pelo próprio usuário, não há ownerId separado.
  }

  // Existente parcelasCustom ou inicia um novo array
  const existentes = Array.isArray(dadosAtuais?.parcelasCustom) ? [...dadosAtuais.parcelasCustom] : [];

  // Verifica se já existe override para esta parcela
  const idxExistente = existentes.findIndex((v) => Number(v.numero) === num);

  if (idxExistente >= 0) {
    // Atualiza o override existente (não duplica)
    existentes[idxExistente] = { numero: num, valor, vencimento, observacoes };
  } else {
    // Adiciona novo override
    existentes.push({ numero: num, valor, vencimento, observacoes });
  }

  await updateDoc(doc(db, "usuarios", usuario.uid, "contratos", contrato.id), {
    parcelasCustom: existentes,
    updatedAt: serverTimestamp(),
  });
  // Notifica o SyncManager: contrato foi renegociado.
  syncNotifyWrite(usuario.uid, "contratos");

  // Retorna a parcela atualizada (recomputa a partir do contrato atualizado)
  const contratoAtualizado = { ...dadosAtuais, id: snap.id, parcelasCustom: existentes };
  const parcelasCalc = parcelasDoContrato(contratoAtualizado, new Date());
  const parcelaAtualizada = parcelasCalc.find((p) => Number(p.numero) === num) || null;

  return { parcela: parcelaAtualizada };
}

/**
 * Lista os modelos de mensagem de contrato do usuário.
 * Coleção: usuarios/{uid}/modelosContrato/{id} com shape { titulo, texto }.
 * Usado pelo popup "Enviar contrato via WhatsApp" para carregar os templates
 * editáveis em /configuracoes/modelos-contrato. Retorna [] se não houver.
 */
export async function listarModelosContrato(uid) {
  if (!uid) return [];
  const snap = await getDocs(collection(db, "usuarios", uid, "modelosContrato"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
