// Funções puras de cálculo de parcelas — sem dependências de renderização.
// Separadas do módulo de PDF para permitir testes unitários sem jsPDF.
//
// REGRA DEFINITIVA — MODELO "SALDO ATUAL":
// -----------------------------------------------------------------------
// REGRA 1 — PARCELAS ORIGINAIS (pagas < numeroParcelas):
//   Cada parcela futura original usa:
//     valor = (saldoPrincipal / numeroParcelas) + (saldoPrincipal × juros/100)
//   IMPORTANTE: divisão SEMPRE por numeroParcelas ORIGINAL, nunca por
//   parcelas restantes.
//   Ex: 500 / 2 + 500 × 0.35 = 250 + 175 = 425
//
// REGRA 2 — PARCELAS DINÂMICAS (pagas >= numeroParcelas, saldoPrincipal > 0):
//   Quando todas as parcelas originais foram pagas/abatidas e ainda há saldo,
//   o sistema cria NOVA(S) parcela(s) com:
//     valor = saldoPrincipal × (1 + juros/100)
//   Uma única parcela dinâmica por vez — ela é paga, e se ainda houver saldo,
//   outra é criada na próxima iteração.
//   Ex: 400 × 1.35 = 540
//
// REGRA 3 — ABATIMENTO:
//   Cada abatimento reduz o saldoPrincipal cumulativamente:
//     novoSaldo = saldoPrincipal - valorAbatimento
//   Ex: 500 - 50 = 450  →  450 - 50 = 400  →  400 - 50 = 350  →  300
//
// REGRA FUNDAMENTAL:
//   ABATIMENTO → ATUALIZA SALDO → APLICA JUROS → GERA PRÓXIMA PARCELA
//
// REGRA DE ABATIMENTO:
// - Abatimento reduz o saldoPrincipal do CONTRATO (não da parcela)
// - Parcelas já PAGAS mantêm seus valores originais (histórico imutável)
// - O abatimento é um crédito no nível do contrato, não recalcula o valor das parcelas já pagas
//
// REGRA DE JUROS:
// - jurosOriginais (display): SEMPRE sobre valorEmprestado ORIGINAL
//   = valorEmprestado × (taxaJuros / 100)
// - jurosParcela (cálculo de valor): sobre saldoPrincipal atual
// - quando saldoPrincipal ≤ 0, contrato é quitado, não cria novas parcelas

const PASSO_DIAS = { "Diária": 1, Semanal: 7, Quinzenal: 15 };

// Avança a data conforme a frequência do contrato
export function avancarData(data, frequencia) {
  const nova = new Date(data);
  const dias = PASSO_DIAS[frequencia];
  if (dias) {
    nova.setDate(nova.getDate() + dias);
  } else {
    nova.setMonth(nova.getMonth() + 1); // Mensal
  }
  return nova;
}

// Soma total de abatimentos em um array
export function totalAbatimentos(abatimentos) {
  if (!abatimentos || !Array.isArray(abatimentos)) return 0;
  return abatimentos.reduce((s, a) => s + (Number(a?.valor) || 0), 0);
}

// Fração de juros por parcela (em decimal sobre o principal base), ajustada
// pela periodicidade do contrato.
//
// REGRA POR PERIODICIDADE:
// - Mensal: `juros` é taxa AO MÊS. Aplica-se diretamente sobre o principal
//   base, SEM dividir por `numeroParcelas`. Ex: 500/35%/2x → 0,35 (35% a.m.),
//   juros por parcela = 500 × 0,35 = 175. Valor = 250 + 175 = 425.
// - Semanal/Diária/Quinzenal: `juros` representa o TOTAL do contrato (não
//   taxa por período). Divide-se por `numeroParcelas` para obter a fração
//   por parcela. Ex: 1700/35%/6x → 0,35/6 ≈ 0,0583, juros por parcela =
//   1700 × 0,35 / 6 = 99,17. Valor = 283,33 + 99,17 = 382,50. Este é o
//   comportamento já validado para contratos semanais.
export function jurosPorParcelaPorFrequencia(contrato) {
  const juros = Number(contrato?.juros) || 0;
  const total = Number(contrato?.numeroParcelas) || 0;
  if ((contrato?.frequencia || "") === "Mensal") {
    // 35% a.m. → 0,35 (sem dividir por N)
    return juros / 100;
  }
  // Semanal/Diária/Quinzenal: juros total ÷ N
  return total > 0 ? (juros / 100) / total : 0;
}

// Helper inline para calcular multa (evita import circular)
function calculatePenaltyInline(contrato, valorParcela, vencimento, hoje) {
  if (!contrato?.cobrarJurosAtraso) return 0;
  if (!vencimento) return 0;

  const venc = new Date(vencimento);
  venc.setHours(0, 0, 0, 0);
  const diffDias = Math.floor((hoje - venc) / (1000 * 60 * 60 * 24));
  if (diffDias <= 0) return 0;

  const taxa = Number(contrato.jurosAtrasoValor) || 0;

  if (contrato.modoJurosAtraso === "% ao valor da parcela") {
    return Math.round((valorParcela * (taxa / 100) * diffDias) * 100) / 100;
  }
  return Math.round((taxa * diffDias) * 100) / 100;
}

// Cronograma de parcelas calculado a partir dos dados reais do contrato.
//
// REGRA DEFINITIVA (MODELO "SALDO ATUAL"):
// -----------------------------------------------------------------------
// REGRA 1 — PARCELAS ORIGINAIS (pagas < numeroParcelas):
//   valor = (saldoPrincipal / numeroParcelas) + (saldoPrincipal × juros/100)
//   Divisão SEMPRE por numeroParcelas ORIGINAL.
//
// REGRA 2 — PARCELAS DINÂMICAS (pagas >= numeroParcelas, saldoPrincipal > 0):
//   valor = saldoPrincipal × (1 + juros/100)
//   Uma única parcela dinâmica é criada quando todas as originais foram pagas
//   e ainda há saldo. Se for paga e saldo ainda > 0, outra é criada.
//
// REGRA 3 — ABATIMENTO:
//   novoSaldo = saldoPrincipal - valorAbatimento (cumulativo)
//
// REGRA FUNDAMENTAL:
//   ABATIMENTO → ATUALIZA SALDO → APLICA JUROS → GERA PRÓXIMA PARCELA
export function calcularParcelas(contrato, hoje = new Date(), abatimentosParam = null) {
  const total = Number(contrato.numeroParcelas) || 0;
  const valorEmprestado = Number(contrato.valorEmprestado) || 0;
  const jurosTaxa = Number(contrato.juros) || 0;

  // valorBaseParcela = valor original do principal por parcela (sem juros)
  const valorBaseParcela = valorEmprestado > 0 && total > 0
    ? valorEmprestado / total
    : (Number(contrato.valorParcela) || 0);

  const abatimentos = abatimentosParam || (Array.isArray(contrato.abatimentos) ? contrato.abatimentos : []);
  const abatimentoTotal = totalAbatimentos(abatimentos);

  // Abatimento total APENAS em parcelas originais (parcelaNumero <= total).
  // Usado como base para a primeira parcela dinâmica: a dinâmica refinancia
  // o principal original não abatido — NÃO inclui abatimentos em dinâmicas
  // anteriores (que são descontados sequencialmente via saldoDinamico no loop).
  // Evita dupla contagem: cada abatimento é aplicado exatamente uma vez.
  const abatimentoTotalOriginal = abatimentos.reduce(
    (s, a) => {
      const num = Number(a?.parcelaNumero);
      if (num >= 1 && num <= total) return s + (Number(a?.valor) || 0);
      return s;
    }, 0
  );

  // Determina quantas parcelas originais estão pagas.
  // Une dois conceitos:
  //  1. parcelasPagas — contador formal persistido no Firestore (pagamentos via
  //     parcela_inteira / quitar_tudo). Representa as parcelas [1..parcelasPagas].
  //  2. abatimentosOriginaisPagos — números de parcelas originais que receberam
  //     abatimento (juros_parte_divida). Cada um também conta como "processada".
  //
  // Ambas são unidas em um único Set sem duplicatas. O tamanho final reflete
  // quantas parcelas originais foram realmente processadas (pagas ou abatidas).
  // Isso é necessário porque alguns contratos persistem parcelasPagas=0 no Firestore
  // enquanto os abatimentos individuais já cobrem todas as parcelas originais.
  //
  // IMPORTANTE: isso não altera parcelasPagas no Firestore — é apenas uma projeção
  // para o cálculo. O contador oficial permanece como está.
  const abatimentosOriginaisPagos = new Set();
  for (const a of abatimentos) {
    const num = Number(a?.parcelaNumero);
    if (num >= 1 && num <= total) abatimentosOriginaisPagos.add(num);
  }
  const pagas = contrato.quitado
    ? total
    : (() => {
        const pagasSet = new Set();
        const formais = Number(contrato.parcelasPagas) || 0;
        // Parcelas pagas formalmente: [1..formais]
        for (let i = 1; i <= formais; i++) pagasSet.add(i);
        // Mais abatimentos direcionados a parcelas originais
        for (const n of abatimentosOriginaisPagos) pagasSet.add(n);
        return pagasSet.size;
      })();

  // Principal já quitado = parcelas pagas × valor base
  const principalQuitado = pagas * valorBaseParcela;

  // Saldo principal do contrato: representa a dívida total restante.
  // - Se saldoPrincipal existe (contratos modernos): já reflete abatimentos E principal pago via parcelas.
  //   NÃO deve subtrair principalQuitado novamente (evita double-counting).
  // - Se fallback (contratos antigos): calcula valorEmprestado - abatimentos, depois subtrai principalQuitado.
  const temSaldoPrincipal = contrato.saldoPrincipal !== undefined && contrato.saldoPrincipal !== null;
  const saldoPrincipal = temSaldoPrincipal
    ? Number(contrato.saldoPrincipal)
    : Math.max(0, valorEmprestado - abatimentoTotal - principalQuitado);

  // Principal restante (representa o principal total restante no contrato).
  const principalRestante = Math.max(0, saldoPrincipal);

  // Juros SEMPRE sobre valorEmprestado ORIGINAL (nunca sobre saldo reduzido).
  // Regra: jurosOriginais (display) = valorEmprestado × (taxaJuros / 100).
  // jurosPorParcela (campo da parcela) usa a função jurosPorParcelaPorFrequencia:
  //   - Mensal: 35% × valorEmprestado (sem dividir por N) → 500×0,35 = 175
  //   - Semanal: (35% × valorEmprestado) / N → (1700×0,35)/6 = 99,17
  const jurosOriginaisTotal = valorEmprestado * (jurosTaxa / 100);
  const jurosPorParcela = valorEmprestado * jurosPorParcelaPorFrequencia(contrato);

  // Valor original de cada parcela (para histórico e cálculo de multa).
  const valorOriginalParcela = valorBaseParcela;

  // --- Determina o número total de parcelas ---
  // REGRA 1: Se há parcelas originais futuras (pagas < numeroParcelas),
  //   mantém o total original. Cada futura usa fórmula ORIGINAL.
  // REGRA 2: Se todas originais foram pagas (pagas >= numeroParcelas) e
  //   saldoPrincipal > 0, cria parcelas DINÂMICAS encadeadas.
  //   - Cada parcela dinâmica paga (via abatimento com parcelaNumero > numeroParcelas)
  //     gera uma nova, até que saldoPrincipal chegue a 0.
  const todasOriginaisPagas = pagas >= total;
  // Não usar contrato.quitado para determinar se há saldo — o flag pode estar
  // desatualizado (contratos antigos marcados como quitado quando todas as
  // parcelas originais foram pagas, mas ainda há saldoPrincipal > 0).
  // A REGRA 2 depende apenas de: todas originais pagas + saldo > 0.
  const saldoPositivo = saldoPrincipal > 0;

  // Conta quantas parcelas dinâmicas já foram marcadas como Paga via abatimento.
  // Cada abatimento com parcelaNumero > numeroParcelas marca uma parcela dinâmica como Paga.
  const abatimentosDinamicosPagos = new Set();
  for (const a of abatimentos) {
    const num = Number(a?.parcelaNumero);
    if (num > total) abatimentosDinamicosPagos.add(num);
  }
  const dinamicasPagas = abatimentosDinamicosPagos.size;

  let totalParcelas = total;
  if (todasOriginaisPagas && saldoPositivo) {
    // REGRA 2: cria 1 + dinamicasPagas parcelas dinâmicas
    // +1 para a parcela dinâmica atual (sempre criada quando saldo > 0)
    totalParcelas = total + 1 + dinamicasPagas;
  }
  if (saldoPrincipal <= 0 && !contrato.quitado && !todasOriginaisPagas) {
    // Saldo esgotado mas contrato não marcado como quitado — tratar como quitado
    totalParcelas = pagas;
  }

  const primeira = contrato.dataPrimeiraParcela
    ? new Date(`${contrato.dataPrimeiraParcela}T12:00:00`)
    : null;

  const lista = [];
  let vencimento = primeira && !isNaN(primeira) ? new Date(primeira) : null;

  // Saldo dinâmico: base para cálculo de parcelas dinâmicas (REGRA 2).
  //
  // Quando todas as originais foram processadas (todasOriginaisPagas), a
  // primeira parcela dinâmica usa como base:
  //   valorEmprestado - abatimentoTotalOriginal
  // (principal original não abatido por descontos em parcelas originais).
  // O principalPago (P1 paga integralmente) NÃO é descontado da base —
  // a dinâmica refinancia o principal não-abatido, e as originais já foram
  // "processadas".
  //
  // Para REGRA 1 (originais futuras), saldoDinamico não é usado.
  let saldoDinamico = todasOriginaisPagas
    ? (valorEmprestado - abatimentoTotalOriginal)
    : saldoPrincipal;

  for (let i = 1; i <= totalParcelas; i += 1) {
    let status = "Pendente";
    let valor = valorBaseParcela;
    let recebido = 0;

    // Marca como Paga quando:
    // 1. i <= pagas: parcela original já contabilizada como paga
    // 2. abatimento direcionado a esta parcela ORIGINAL (parcelaNumero definido
    //    e valor > 0): marca como Paga para parcelas originais (i <= total).
    // 3. abatimento direcionado a esta parcela DINÂMICA (parcelaNumero definido,
    //    valor > 0, i > total): marca como Paga e reduz o saldo para calcular a próxima.
    const abatimentoParcela = abatimentos.find(
      (a) => Number(a?.parcelaNumero) === i
    );
    const abatimentoParcelaValor = abatimentoParcela
      ? Math.round((Number(abatimentoParcela.valor) || 0) * 100) / 100
      : 0;

    const ehParcelaOriginal = i <= total;
    const ehParcelaDinamica = i > total;
    const abatimentoMarcaOriginal = abatimentoParcelaValor > 0 && ehParcelaOriginal;
    const abatimentoMarcaDinamica = abatimentoParcelaValor > 0 && ehParcelaDinamica;

    if (i <= pagas || abatimentoMarcaOriginal || abatimentoMarcaDinamica) {
      // ---- Parcela PAGA: histórico IMUTÁVEL ----
      // Status = Paga — parcela com pagamento/abatimento registrado.
      // REGRA: uma parcela paga é histórica. Seu valor NÃO pode ser alterado
      // por operações em OUTRAS parcelas (abatimentos, pagamentos futuros,
      // recálculo de valorRecebido). O valor exibido é:
      //   - Se há abatimento registrado PARA ESTA parcela: o valor do abatimento
      //     (pagamento parcial explícito).
      //   - Caso contrário: o valor ORIGINAL cheio da parcela
      //     (valorBaseParcela + jurosPorParcela). Isso é o que foi pago no
      //     momento da quitação, registrado em `parcelasPagas`.
      //
      // Nunca recalcular a partir de `valorRecebido / pagas` — isso faria a
      // média cair quando outra parcela é abatida/paga depois, violando a
      // imutabilidade do histórico. Os abatimentos são no nível do CONTRATO
      // (saldoPrincipal), não nas parcelas individuais.
      status = "Paga";

      if (abatimentoParcelaValor > 0 && abatimentoParcelaValor < (valorBaseParcela + jurosPorParcela)) {
        // Pagamento parcial explícito para esta parcela: mostra o que entrou.
        recebido = abatimentoParcelaValor;
        valor = recebido;
      } else {
        // Pagamento integral (parcela_inteira) ou abatimento total desta parcela:
        // valor histórico = valor original cheio da parcela.
        const valorOriginalCheio = Math.round((valorBaseParcela + jurosPorParcela) * 100) / 100;
        valor = valorOriginalCheio;
        recebido = valorOriginalCheio;
      }
    } else if (ehParcelaDinamica) {
      // ---- Parcela DINÂMICA (Paga ou Pendente) ----
      // REGRA 2: todas as parcelas originais foram pagas e saldoPrincipal > 0
      // cria nova parcela: saldoPrincipal × (1 + juros%)
      // O saldo usado é o restante APÓS abatimentos das parcelas dinâmicas
      // anteriores. Cada abatimento dinâmico reduz o saldo sequencialmente.
      const jurosParcela = saldoDinamico * (jurosTaxa / 100);

      // Multa (se aplicável) — sempre sobre o valor ORIGINAL da parcela
      let multaParcela = 0;
      if (vencimento && vencimento < hoje) {
        multaParcela = calculatePenaltyInline(contrato, valorOriginalParcela, vencimento, hoje);
      }

      valor = Math.round((saldoDinamico + jurosParcela + multaParcela) * 100) / 100;
      status = vencimento && vencimento < hoje ? "Vencida" : "Pendente";
    } else {
      // ---- Parcela FUTURA ORIGINAL ----
      // Base de cálculo: principalRestante (= saldoPrincipal após abatimentos
      // parciais aplicados no nível do contrato).
      //   - Sem abatimento: principalRestante === valorEmprestado.
      //   - Com abatimento (ex: R$ 50 abatido na P1): principalRestante cai
      //     para 1650 e as parcelas futuras são recalculadas sobre esse novo
      //     principal. Ex: 1650/6 + (1650×0,35)/6 = 275 + 96,25 = 371,25.
      // Juros continuam aplicando-se uma única vez sobre o principal base
      // (nunca juros compostos). A fração de juros por parcela depende da
      // periodicidade:
      //   - Mensal: juros × principal (sem dividir por N) — taxa a.m.
      //   - Semanal/Diária/Quinzenal: (juros × principal) / N — juros total ÷ N
      // Para 500/35%/2x Mensal: 250 + 175 = 425. Para 1700/35%/6x Semanal:
      // 283,33 + 99,17 = 382,50.
      const basePrincipal = principalRestante;
      const principalParcela = basePrincipal / total;
      const jurosParcela = basePrincipal * jurosPorParcelaPorFrequencia(contrato);

      // Multa (se aplicável) — sempre sobre o valor ORIGINAL da parcela
      let multaParcela = 0;
      if (vencimento && vencimento < hoje) {
        multaParcela = calculatePenaltyInline(contrato, valorOriginalParcela, vencimento, hoje);
      }

      valor = Math.round((principalParcela + jurosParcela + multaParcela) * 100) / 100;
      status = vencimento && vencimento < hoje ? "Vencida" : "Pendente";
    }

    lista.push({
      numero: i,
      vencimento,
      valor,
      valorOriginal: valorEmprestado,
      valorOriginalParcela,           // valor original desta parcela (para multa)
      valorComAbatimento: saldoPrincipal, // saldo do contrato após abatimentos (não por parcela)
      dividaRestante: saldoPrincipal,     // saldo do contrato (não por parcela)
      recebido,
      abatimentoAcumulado: 0,           // sempre 0 — abatimento é no CONTRATO, não na parcela
      abatimentoParcela: 0,            // sempre 0 — abatimento é no CONTRATO, não na parcela
      jurosTaxa,
      jurosOriginais: jurosPorParcela,        // juros sobre valor original por parcela
      status,
    });

    // Se esta parcela dinâmica foi Paga APENAS por abatimento (não por
    // pagamento formal de parcela_inteira), reduz o saldoDinamico pelo
    // valor do abatimento. Isso garante que abatimentos em dinâmicas
    // anteriores sejam descontados exatamente uma vez (via saldoDinamico),
    // evitando dupla contagem com abatimentoTotalOriginal.
    //
    // Pagamentos formais (parcela_inteira) não passam por aqui — eles são
    // refletidos no saldoPrincipal persistido, que já é a base correta.
    if (abatimentoMarcaDinamica) {
      saldoDinamico = Math.max(0, saldoDinamico - abatimentoParcelaValor);
    }

    vencimento = vencimento ? avancarData(vencimento, contrato.frequencia) : null;
  }
  return lista;
}
