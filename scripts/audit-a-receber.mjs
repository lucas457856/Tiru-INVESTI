// Script de auditoria v2: testa múltiplas regras plausíveis até
// reproduzir exatamente os valores-alvo:
//   Total a Receber: R$ 2.762,50
//   Juros Previstos: R$ 845,83
//   Vencido: R$ 0,00
//   Nº de Parcelas: 7
//
// Como rodar:
//   cd agt-controller3
//   node scripts/audit-a-receber.mjs

// Forçar "hoje" como 2026-09-02 LOCAL
const HOJE_FAKE = new Date(2026, 8, 2, 0, 0, 0, 0);
const realDate = Date;

global.Date = class extends realDate {
  constructor(...args) {
    if (args.length === 0) {
      super(HOJE_FAKE.getTime());
    } else {
      super(...args);
    }
  }
  static now() {
    return HOJE_FAKE.getTime();
  }
};

// ============ CÓPIA LITERAL de parcelasUtil.js (sem import/export) ============
const PASSO_DIAS = { "Diária": 1, Semanal: 7, Quinzenal: 15 };
function avancarData(data, frequencia) {
  const nova = new Date(data);
  const dias = PASSO_DIAS[frequencia];
  if (dias) nova.setDate(nova.getDate() + dias);
  else nova.setMonth(nova.getMonth() + 1);
  return nova;
}
function totalAbatimentos(abatimentos) {
  if (!abatimentos || !Array.isArray(abatimentos)) return 0;
  return abatimentos.reduce((s, a) => s + (Number(a?.valor) || 0), 0);
}
function jurosPorParcelaPorFrequencia(contrato) {
  const juros = Number(contrato?.juros) || 0;
  const total = Number(contrato?.numeroParcelas) || 0;
  if ((contrato?.frequencia || "") === "Mensal") return juros / 100;
  return total > 0 ? (juros / 100) / total : 0;
}
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
function calcularParcelas(contrato, hoje = new Date(), abatimentosParam = null) {
  const total = Number(contrato.numeroParcelas) || 0;
  const valorEmprestado = Number(contrato.valorEmprestado) || 0;
  const jurosTaxa = Number(contrato.juros) || 0;
  const valorBaseParcela = valorEmprestado > 0 && total > 0
    ? valorEmprestado / total
    : (Number(contrato.valorParcela) || 0);
  const abatimentos = abatimentosParam || (Array.isArray(contrato.abatimentos) ? contrato.abatimentos : []);
  const abatimentoTotal = totalAbatimentos(abatimentos);
  const abatimentoTotalOriginal = abatimentos.reduce(
    (s, a) => {
      const num = Number(a?.parcelaNumero);
      if (num >= 1 && num <= total) return s + (Number(a?.valor) || 0);
      return s;
    }, 0
  );
  const abatimentosOriginaisPagos = new Set();
  for (const a of abatimentos) {
    const num = Number(a?.parcelaNumero);
    if (num >= 1 && num <= total) abatimentosOriginaisPagos.add(num);
  }
  const pagas = contrato.quitado ? total : (() => {
    const pagasSet = new Set();
    const formais = Number(contrato.parcelasPagas) || 0;
    for (let i = 1; i <= formais; i++) pagasSet.add(i);
    for (const n of abatimentosOriginaisPagos) pagasSet.add(n);
    return pagasSet.size;
  })();
  const principalQuitado = pagas * valorBaseParcela;
  const temSaldoPrincipal = contrato.saldoPrincipal !== undefined && contrato.saldoPrincipal !== null;
  const saldoPrincipal = temSaldoPrincipal
    ? Number(contrato.saldoPrincipal)
    : Math.max(0, valorEmprestado - abatimentoTotal - principalQuitado);
  const principalRestante = Math.max(0, saldoPrincipal);
  const jurosOriginaisTotal = valorEmprestado * (jurosTaxa / 100);
  const jurosPorParcela = valorEmprestado * jurosPorParcelaPorFrequencia(contrato);
  const valorOriginalParcela = valorBaseParcela;
  const todasOriginaisPagas = pagas >= total;
  const saldoPositivo = saldoPrincipal > 0;
  const abatimentosDinamicosPagos = new Set();
  for (const a of abatimentos) {
    const num = Number(a?.parcelaNumero);
    if (num > total) abatimentosDinamicosPagos.add(num);
  }
  const dinamicasPagas = abatimentosDinamicosPagos.size;
  let totalParcelas = total;
  if (todasOriginaisPagas && saldoPositivo) totalParcelas = total + 1 + dinamicasPagas;
  if (saldoPrincipal <= 0 && !contrato.quitado && !todasOriginaisPagas) totalParcelas = pagas;
  const primeira = contrato.dataPrimeiraParcela
    ? new Date(`${contrato.dataPrimeiraParcela}T12:00:00`)
    : null;
  const lista = [];
  let vencimento = primeira && !isNaN(primeira) ? new Date(primeira) : null;
  let saldoDinamico = todasOriginaisPagas ? (valorEmprestado - abatimentoTotalOriginal) : saldoPrincipal;
  for (let i = 1; i <= totalParcelas; i += 1) {
    let status = "Pendente", valor = valorBaseParcela, recebido = 0;
    const abatimentoParcela = abatimentos.find((a) => Number(a?.parcelaNumero) === i);
    const abatimentoParcelaValor = abatimentoParcela
      ? Math.round((Number(abatimentoParcela.valor) || 0) * 100) / 100
      : 0;
    const ehParcelaOriginal = i <= total;
    const ehParcelaDinamica = i > total;
    const abatimentoMarcaOriginal = abatimentoParcelaValor > 0 && ehParcelaOriginal;
    const abatimentoMarcaDinamica = abatimentoParcelaValor > 0 && ehParcelaDinamica;
    if (i <= pagas || abatimentoMarcaOriginal || abatimentoMarcaDinamica) {
      status = "Paga";
      if (abatimentoParcelaValor > 0 && abatimentoParcelaValor < (valorBaseParcela + jurosPorParcela)) {
        recebido = abatimentoParcelaValor; valor = recebido;
      } else {
        const valorOriginalCheio = Math.round((valorBaseParcela + jurosPorParcela) * 100) / 100;
        valor = valorOriginalCheio; recebido = valorOriginalCheio;
      }
    } else if (ehParcelaDinamica) {
      const jurosParcela = saldoDinamico * (jurosTaxa / 100);
      let multaParcela = 0;
      if (vencimento && vencimento < hoje) multaParcela = calculatePenaltyInline(contrato, valorOriginalParcela, vencimento, hoje);
      valor = Math.round((saldoDinamico + jurosParcela + multaParcela) * 100) / 100;
      status = vencimento && vencimento < hoje ? "Vencida" : "Pendente";
    } else {
      const basePrincipal = principalRestante;
      const principalParcela = basePrincipal / total;
      const jurosParcela = basePrincipal * jurosPorParcelaPorFrequencia(contrato);
      let multaParcela = 0;
      if (vencimento && vencimento < hoje) multaParcela = calculatePenaltyInline(contrato, valorOriginalParcela, vencimento, hoje);
      valor = Math.round((principalParcela + jurosParcela + multaParcela) * 100) / 100;
      status = vencimento && vencimento < hoje ? "Vencida" : "Pendente";
    }
    lista.push({ numero: i, vencimento, valor, valorOriginalParcela, recebido, jurosTaxa, jurosOriginais: jurosPorParcela, status });
    if (abatimentoMarcaDinamica) saldoDinamico = Math.max(0, saldoDinamico - abatimentoParcelaValor);
    vencimento = vencimento ? avancarData(vencimento, contrato.frequencia) : null;
  }
  return lista;
}

// ============ CÓPIA de relatorioAReceber.js ============
function hojeDate() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function addDias(d, dias) { const r = new Date(d); r.setDate(r.getDate() + dias); return r; }
function fimDoDia(d) { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function toValidDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value?.toDate === "function") { const d = value.toDate(); return Number.isNaN(d.getTime()) ? null : d; }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) { const [y, m, d] = value.slice(0, 10).split("-").map(Number); const dt = new Date(y, m - 1, d); return Number.isNaN(dt.getTime()) ? null : dt; }
    const dt = new Date(value); return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}
function parseVencimento(v) { return toValidDate(v); }
function janelaPeriodo(periodo, personalizadoIni, personalizadoFim) {
  const h = hojeDate();
  if (periodo === "Este mês") {
    const inicioPeriodo = new Date(h.getFullYear(), h.getMonth(), 1);
    const fimBase = new Date(h.getFullYear(), h.getMonth() + 1, 0);
    return { inicioPeriodo, fimPeriodo: fimDoDia(fimBase) };
  }
  if (periodo === "Próximos 30 dias") return { inicioPeriodo: h, fimPeriodo: fimDoDia(addDias(h, 30)) };
  if (periodo === "Próximos 90 dias") return { inicioPeriodo: h, fimPeriodo: fimDoDia(addDias(h, 90)) };
  if (periodo === "Personalizado" && personalizadoIni && personalizadoFim) {
    const ini = parseVencimento(personalizadoIni);
    const fim = parseVencimento(personalizadoFim);
    if (ini && fim) return { inicioPeriodo: ini, fimPeriodo: fimDoDia(fim) };
  }
  const fimBasePadrao = new Date(h.getFullYear(), h.getMonth() + 1, 0);
  return { inicioPeriodo: new Date(h.getFullYear(), h.getMonth(), 1), fimPeriodo: fimDoDia(fimBasePadrao) };
}
function filtrarPorTipo(contratos, tipo) {
  return contratos.filter((c) => {
    if (tipo === "Contratos" && c.nomeProduto != null) return false;
    if (tipo === "Vendas" && c.nomeProduto == null) return false;
    return true;
  });
}
function filtrarPorAba(base, aba) {
  return base.filter((c) => {
    if (aba === "Em aberto" && c.quitado) return false;
    return true;
  });
}

// ============ CONTRATOS ============
const URSTIE = {
  id: "URSTIE", valorEmprestado: 500, numeroParcelas: 2, juros: 35, frequencia: "Mensal",
  dataPrimeiraParcela: "2026-09-01", parcelasPagas: 0, quitado: false, dataProximo: "2026-09-01",
};
const M3MX4ZS = {
  id: "3MX4ZS", valorEmprestado: 1700, numeroParcelas: 6, juros: 35, frequencia: "Semanal",
  dataPrimeiraParcela: "2026-08-30", parcelasPagas: 0, quitado: false, dataProximo: "2026-08-30",
};
const contratos = [URSTIE, M3MX4ZS];

// ============ TESTES DE REGRAS ============
const ALVO = { total: 2762.50, juros: 845.83, vencido: 0.00, count: 7 };

function fmtNum(n) { return Number(n).toFixed(2); }

function testarRegra(nome, fnFiltragem, fnTotais) {
  const baseGeral = filtrarPorTipo(contratos, "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    let parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (!fnFiltragem(p, c, inicioPeriodo, fimPeriodo)) continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  const totais = fnTotais(ps);
  const ok = Math.abs(totais.total - ALVO.total) < 0.05 && Math.abs(totais.juros - ALVO.juros) < 0.05 && Math.abs(totais.vencido - ALVO.vencido) < 0.05 && totais.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] ${nome}`);
  console.log(`    total=R$${fmtNum(totais.total)} juros=R$${fmtNum(totais.juros)} vencido=R$${fmtNum(totais.vencido)} count=${totais.count}`);
  if (ok) {
    console.log("    >>> BATE COM O ALVO! <<<");
    ps.forEach((p) => {
      console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)}  R$${fmtNum(p.parcela.jurosOriginais)}  ${p.parcela.status}`);
    });
  }
}

console.log("=================================================================");
console.log("ALVO: total=2762.50 juros=845.83 vencido=0.00 count=7");
console.log("=================================================================\n");

// Regra 0: atual (inclui atrasadas)
testarRegra("R0: ATUAL (inclui todas pendentes com v <= fimPeriodo)",
  (p) => p.status !== "Paga",
  (ps) => {
    const hoje = hojeDate();
    let total = 0, juros = 0, vencido = 0, count = 0;
    for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < hoje) vencido += item.parcela.valor; count++; }
    return { total, juros, vencido, count };
  }
);

// Regra 1: exclui parcelas com vencimento < hoje (Vencido = 0)
testarRegra("R1: Exclui atrasadas (v < hoje) — só pendentes futuras",
  (p, c, ini, fim) => p.status !== "Paga" && p.vencimento >= ini && p.vencimento <= fim,
  (ps) => {
    const hoje = hojeDate();
    let total = 0, juros = 0, vencido = 0, count = 0;
    for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < hoje) vencido += item.parcela.valor; count++; }
    return { total, juros, vencido, count };
  }
);

// Regra 2: usa apenas dataProximo (1 parcela por contrato)
testarRegra("R2: Apenas a PRIMEIRA parcela aberta de cada contrato (próximo vencimento)",
  (p, c, ini, fim) => {
    if (p.status === "Paga") return false;
    if (p.vencimento > fim) return false;
    return true; // primeira não-paga na ordem do contrato
  },
  (ps) => {
    // Agrupa por contrato, pega só a primeira
    const map = new Map();
    for (const item of ps) {
      if (!map.has(item.contratoId)) map.set(item.contratoId, item);
    }
    const filtrado = [...map.values()];
    const hoje = hojeDate();
    let total = 0, juros = 0, vencido = 0, count = 0;
    for (const item of filtrado) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < hoje) vencido += item.parcela.valor; count++; }
    return { total, juros, vencido, count };
  }
);

// Regra 3: usa dataProximo para pegar só a próxima parcela, depois v < hoje sai
testarRegra("R3: 1ª parcela aberta de cada + exclui atrasadas",
  (p, c, ini, fim) => p.status !== "Paga" && p.vencimento >= ini && p.vencimento <= fim,
  (ps) => {
    const map = new Map();
    for (const item of ps) if (!map.has(item.contratoId)) map.set(item.contratoId, item);
    const filtrado = [...map.values()];
    let total = 0, juros = 0, vencido = 0, count = 0;
    for (const item of filtrado) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor; count++; }
    return { total, juros, vencido, count };
  }
);

// Regra 4: usa valorParcela (campo do contrato) em vez do calculado
testarRegra("R4: Usa c.valorParcela (campo do contrato) — exclui atrasadas",
  (p, c, ini, fim) => p.status !== "Paga" && p.vencimento >= ini && p.vencimento <= fim,
  (ps) => {
    const hoje = hojeDate();
    let total = 0, juros = 0, vencido = 0, count = 0;
    for (const item of ps) {
      // Usa o valorParcela do contrato (R$425 / R$382.50 seriam os mesmos)
      total += item.parcela.valor;
      juros += item.parcela.jurosOriginais;
      if (item.vencimentoDate < hoje) vencido += item.parcela.valor;
      count++;
    }
    return { total, juros, vencido, count };
  }
);

// Regra 5: parcelas > hoje (pendentes e futuras), exatamente o que o usuário diz
testarRegra("R5: Pendentes com venc >= hoje, dentro de 90 dias",
  (p, c, ini, fim) => {
    if (p.status === "Paga") return false;
    const v = p.vencimento;
    if (!v) return false;
    return v >= ini && v <= fim;
  },
  (ps) => {
    let total = 0, juros = 0, vencido = 0, count = 0;
    for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor; count++; }
    return { total, juros, vencido, count };
  }
);

// Regra 21: usa parcelasDoContrato (que aplica preservação de valor original)
// Vou replicar a função: para cada parcela pendente, valor = valorOriginalParcela + jurosOriginais
function parcelasDoContratoSim(contrato, hoje = new Date()) {
  const base = calcularParcelas(contrato, hoje, contrato.abatimentos || null);
  return base.map((p) => {
    if (p.status === "Paga") return p;
    if (p.renegociada) return p;
    const totalOriginal = Number(contrato.numeroParcelas) || 0;
    if (totalOriginal > 0 && Number(p.numero) > totalOriginal) return p;
    const valorOriginal = Math.round(
      (Number(p.valorOriginalParcela) + Number(p.jurosOriginais)) * 100
    ) / 100;
    return { ...p, valor: valorOriginal };
  });
}

function calcularR21() {
  const baseGeral = filtrarPorTipo([URSTIE, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = parcelasDoContratoSim(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR21();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R21: ATUAL (v<=fim) + parcelasDoContrato (valor=original+jurosOriginais)`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)} status=${p.parcela.status}`));
}

// Regra 22: R21 + #URSTIE com P1 paga
function calcularR22() {
  const c2 = { ...URSTIE, parcelasPagas: 1 };
  const baseGeral = filtrarPorTipo([c2, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = parcelasDoContratoSim(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR22();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R22: R21 + #URSTIE P1 paga`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)} status=${p.parcela.status}`));
}

// Regra 23: ATUAL (v<=fim) + exclui atrasadas + valorOrig (parcelasDoContrato)
function calcularR23() {
  const baseGeral = filtrarPorTipo([URSTIE, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = parcelasDoContratoSim(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v < HOJE_FAKE) continue; // EXCLUI ATRASADAS
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR23();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R23: parcelasDoContrato + EXCLUI v<hoje (atrasadas)`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)} status=${p.parcela.status}`));
}

// Regra 24: ATUAL (v<=fim) + exclui v<hoje + exclui v=hoje (só futuras estritas)
function calcularR24() {
  const baseGeral = filtrarPorTipo([URSTIE, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = parcelasDoContratoSim(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v < HOJE_FAKE) continue; // exclui atrasadas
      if (v.getTime() === HOJE_FAKE.getTime()) continue; // exclui vence HOJE
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR24();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R24: parcelasDoContrato + exclui v<hoje e v=hoje`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)} status=${p.parcela.status}`));
}

// Regra 25: ATUAL (v<=fim) + usa "dataProximo" como data de corte para Vencido
// (parcelas com vencimento anterior a dataProximo NÃO contam como vencidas)
function calcularR25() {
  const baseGeral = filtrarPorTipo([URSTIE, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  const hoje = hojeDate();
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = parcelasDoContratoSim(c, new Date());
    // Pega a data de "próximo vencimento" do contrato
    const dataProximo = c.dataProximo ? parseVencimento(c.dataProximo) : null;
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      // Vencido = parcelas com vencimento ANTERIOR a max(hoje, dataProximo)
      // Se dataProximo > hoje, então a regra de "vencido" começa em dataProximo
      const limiteVencido = dataProximo && dataProximo > hoje ? dataProximo : hoje;
      const ehVencida = v < limiteVencido;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v, ehVencida });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.ehVencida) vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR25();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R25: ATUAL + Vencido = Σ v < max(hoje, dataProximo)`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)} status=${p.parcela.status} vencida=${p.ehVencida}`));
}

// Regra 26: Vencido = Σ onde v < hoje E dataProximo <= v (parcela anterior a dataProximo)
function calcularR26() {
  const baseGeral = filtrarPorTipo([URSTIE, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  const hoje = hojeDate();
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = parcelasDoContratoSim(c, new Date());
    const dataProximo = c.dataProximo ? parseVencimento(c.dataProximo) : null;
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      // Vencido: v < hoje E v < dataProximo
      const ehVencida = v < hoje && (!dataProximo || v < dataProximo);
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v, ehVencida });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.ehVencida) vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR26();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R26: ATUAL + Vencido = Σ v < hoje E v < dataProximo`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)} status=${p.parcela.status} vencida=${p.ehVencida}`));
}

// Regra 33: #URSTIE com vencimentosCustom (P1 deslocada para 02/09) — isso faz P1
// vencer HOJE → fica "Em dia" (status), conta no A Receber, e NÃO conta como vencida
const URSTIE_custom = {
  ...URSTIE,
  dataPrimeiraParcela: "2026-09-02", // vencimento da P1 = HOJE
  vencimentosCustom: [{ numero: 1, vencimento: "2026-09-02" }],
};
function calcularR33() {
  const baseGeral = filtrarPorTipo([URSTIE_custom, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  const hoje = hojeDate();
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = parcelasDoContratoSim(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      const ehVencida = v < hoje;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v, ehVencida });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.ehVencida) vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR33();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R33: #URSTIE P1 venc=02/09 (dataPrimeiraParcela=02/09)`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)} status=${p.parcela.status} vencida=${p.ehVencida}`));
}

// Regra 34: R33 + #3MX4ZS P1 venc=30/08 → cai em Vencida. Vamos remover a P1 de #3MX4ZS:
// Talvez a P1 do #3MX4ZS esteja marcada como Paga (parcelasPagas=1)
const M3MX4ZS_p1Paga = { ...M3MX4ZS, parcelasPagas: 1 };
function calcularR34() {
  const baseGeral = filtrarPorTipo([URSTIE_custom, M3MX4ZS_p1Paga], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  const hoje = hojeDate();
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = parcelasDoContratoSim(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      const ehVencida = v < hoje;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v, ehVencida });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.ehVencida) vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR34();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R34: R33 + #3MX4ZS P1 paga`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)} status=${p.parcela.status} vencida=${p.ehVencida}`));
}

// Regra 35: #URSTIE P1=01/09 (dataPrimeiraParcela) MAS o sistema usa dataProximo
// como referência de "próximo vencimento". A P1 do #URSTIE tem dataProximo=01/09.
// Se o cálculo usa dataProximo como data de vencimento, então v=01/09 e cai em Vencida.
// Mas a P1 do #3MX4ZS tem dataProximo=30/08 e cai em Vencida também.
// A SOMA 807,50 (P1 #URSTIE) + 382,50 (P1 #3MX4ZS) = 1.190,00 (vencido se ambos)
// Mas usuário diz 0. Então a regra do card Vencido EXCLUI a próxima parcela (dataProximo)
function calcularR35() {
  const baseGeral = filtrarPorTipo([URSTIE, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  const hoje = hojeDate();
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = parcelasDoContratoSim(c, new Date());
    const dataProximo = c.dataProximo ? parseVencimento(c.dataProximo) : null;
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      // Vencida = v < hoje E v < dataProximo
      // (a próxima parcela, com v==dataProximo, NÃO conta como vencida)
      const isDataProximo = dataProximo && v.getTime() === dataProximo.getTime();
      const ehVencida = v < hoje && !isDataProximo;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v, ehVencida });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.ehVencida) vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR35();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R35: ATUAL + Vencido = Σ v<hoje EXCLUINDO parcela==dataProximo`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)} status=${p.parcela.status} vencida=${p.ehVencida}`));
}

// Regra 17: ATUAL (v <= fim) + Vencido = Σ onde p.status === 'Vencida' (não v < hoje)
function calcularR17() {
  const baseGeral = filtrarPorTipo([URSTIE, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.parcela.status === "Vencida") vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR17();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R17: ATUAL (v<=fim) + Vencido = Σ p.status==='Vencida'`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)} status=${p.parcela.status}`));
}

// Regra 18: status da parcela
function calcularR18() {
  console.log("\n[Debug] Status de cada parcela do #URSTIE e #3MX4ZS (geradas por calcularParcelas):");
  for (const c of [URSTIE, M3MX4ZS]) {
    const ps = calcularParcelas(c, new Date());
    ps.forEach((p) => console.log(`  ${c.id}#${p.numero}  v=${p.vencimento ? p.vencimento.toISOString().slice(0,10) : 'null'}  status=${p.status}  R$${fmtNum(p.valor)}`));
  }
}
calcularR18();

// Regra 19: Vencido = Σ onde v <= hoje (incluindo HOJE como vencido)
function calcularR19() {
  const baseGeral = filtrarPorTipo([URSTIE, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) {
    total += item.parcela.valor;
    juros += item.parcela.jurosOriginais;
    if (item.vencimentoDate <= HOJE_FAKE) vencido += item.parcela.valor;
    count++;
  }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR19();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`\n[${ok ? "✓" : " "}] R19: ATUAL (v<=fim) + Vencido = Σ onde v <= hoje (incluindo hoje)`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)}`));
}

// Regra 20: Vencido = 0 fixo (definido pelo usuário)
function calcularR20() {
  const baseGeral = filtrarPorTipo([URSTIE, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; count++; }
  return { total, juros, vencido: 0, count, ps };
}
{
  const r = calcularR20();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R20: ATUAL (v<=fim) + Vencido=0 sempre`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)}`));
}

// Regra 11: #URSTIE P1 paga + EXCLUI ATRASADAS (v < hoje) — count=7 esperado
function calcularR11() {
  const c2 = { ...URSTIE, parcelasPagas: 1 };
  const baseGeral = filtrarPorTipo([c2, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v < HOJE_FAKE) continue; // EXCLUI ATRASADAS
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR11();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R11: #URSTIE P1 paga + EXCLUI v<hoje`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)}  R$${fmtNum(p.parcela.jurosOriginais)}`));
}

// Regra 12: #3MX4ZS com 5 parcelas (não 6) — númeroParcelas dinâmico
function calcularR12() {
  const c3 = { ...M3MX4ZS, numeroParcelas: 5 };
  const baseGeral = filtrarPorTipo([URSTIE, c3], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR12();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R12: #3MX4ZS 5x + ATUAL`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)}`));
}

// Regra 13: #URSTIE 2x mas com valorEmprestado=500, juros=15% (175 por parcela dividido?)
function calcularR13() {
  const c2 = { ...URSTIE, juros: 15 }; // jurosPorParcela = 0.15, valor = 250 + 75 = 325
  const baseGeral = filtrarPorTipo([c2, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR13();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R13: #URSTIE juros=15% + ATUAL`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)}`));
}

// Regra 14: #URSTIE 2x MAS valorParcela já embutido (250+175=425) E 1ª já paga
function calcularR14() {
  const c2 = { ...URSTIE, parcelasPagas: 1 };
  const baseGeral = filtrarPorTipo([c2, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  // R6 com P1 do #URSTIE paga: count=7, total=2.507,50, juros=770, vencido=382,50
  // Diferença: 425-382,50=42,50 (1d atraso)  |  175+170,83-174,17=...
  // Testar se a regra é "P1 paga E não incluir a atrasada do #3MX4ZS"
  // #3MX4ZS P1=30/08, mas dataProximo=06/09 (P2)? — parcelasPagas=0 mas P1 vencida E NÃO PAGA
  // E excluir v < hoje...
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR14();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R14: #URSTIE P1 paga + ATUAL (sem excluir atrasadas) — espera-se 7 count, mas com vencida`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)}`));
}

// Regra 15: #URSTIE P1 paga + #3MX4ZS com P1 paga (1+1=2 pagas) + ATUAL
function calcularR15() {
  const c2 = { ...URSTIE, parcelasPagas: 1 };
  const c3 = { ...M3MX4ZS, parcelasPagas: 1 };
  const baseGeral = filtrarPorTipo([c2, c3], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR15();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R15: ambos P1 paga + ATUAL`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)}`));
}

// Regra 16: #URSTIE P1 paga + #3MX4ZS 5x (não 6) — ajusta para 7 count
function calcularR16() {
  const c2 = { ...URSTIE, parcelasPagas: 1 };
  const c3 = { ...M3MX4ZS, numeroParcelas: 5 };
  const baseGeral = filtrarPorTipo([c2, c3], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < HOJE_FAKE) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count, ps };
}
{
  const r = calcularR16();
  const ok = Math.abs(r.total - ALVO.total) < 0.05 && Math.abs(r.juros - ALVO.juros) < 0.05 && Math.abs(r.vencido - ALVO.vencido) < 0.05 && r.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R16: #URSTIE P1 paga + #3MX4ZS 5x + ATUAL`);
  console.log(`    total=R$${fmtNum(r.total)} juros=R$${fmtNum(r.juros)} vencido=R$${fmtNum(r.vencido)} count=${r.count}`);
  if (ok) r.ps.forEach((p) => console.log(`        ${p.contratoId}#${p.parcela.numero}  ${p.vencimentoDate.toISOString().slice(0,10)}  R$${fmtNum(p.parcela.valor)}`));
}

// Regra 6: #URSTIE P1 considerada "Paga" (count 7 = 1+6) + exclui atrasadas
function calcularComURSTIEp1Paga() {
  const c2 = { ...URSTIE, parcelasPagas: 1 };
  const baseGeral = filtrarPorTipo([c2, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  const hoje = hojeDate();
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < hoje) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count };
}
{
  const r6 = calcularComURSTIEp1Paga();
  const ok = Math.abs(r6.total - ALVO.total) < 0.05 && Math.abs(r6.juros - ALVO.juros) < 0.05 && Math.abs(r6.vencido - ALVO.vencido) < 0.05 && r6.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R6: #URSTIE com parcelasPagas=1 (P1 já paga)`);
  console.log(`    total=R$${fmtNum(r6.total)} juros=R$${fmtNum(r6.juros)} vencido=R$${fmtNum(r6.vencido)} count=${r6.count}`);
}

// Regra 7: #URSTIE com 1 só parcela (numeroParcelas=1)
function calcularComURSTIE1parcela() {
  const c2 = { ...URSTIE, numeroParcelas: 1 };
  const baseGeral = filtrarPorTipo([c2, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  const hoje = hojeDate();
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < hoje) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count };
}
{
  const r7 = calcularComURSTIE1parcela();
  const ok = Math.abs(r7.total - ALVO.total) < 0.05 && Math.abs(r7.juros - ALVO.juros) < 0.05 && Math.abs(r7.vencido - ALVO.vencido) < 0.05 && r7.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R7: #URSTIE com numeroParcelas=1`);
  console.log(`    total=R$${fmtNum(r7.total)} juros=R$${fmtNum(r7.juros)} vencido=R$${fmtNum(r7.vencido)} count=${r7.count}`);
}

// Regra 8: #URSTIE com juros = 24% (250 + 500*0.24 = 370)
function calcularComURSTIEjuros24() {
  const c2 = { ...URSTIE, juros: 24 };
  const baseGeral = filtrarPorTipo([c2, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  const hoje = hojeDate();
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < hoje) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count };
}
{
  const r8 = calcularComURSTIEjuros24();
  const ok = Math.abs(r8.total - ALVO.total) < 0.05 && Math.abs(r8.juros - ALVO.juros) < 0.05 && Math.abs(r8.vencido - ALVO.vencido) < 0.05 && r8.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R8: #URSTIE com juros=24% Mensal`);
  console.log(`    total=R$${fmtNum(r8.total)} juros=R$${fmtNum(r8.juros)} vencido=R$${fmtNum(r8.vencido)} count=${r8.count}`);
}

// Regra 9: #URSTIE 2x Semanal
function calcularComURSTIEsem() {
  const c2 = { ...URSTIE, frequencia: "Semanal" };
  const baseGeral = filtrarPorTipo([c2, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  const hoje = hojeDate();
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < hoje) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count };
}
{
  const r9 = calcularComURSTIEsem();
  const ok = Math.abs(r9.total - ALVO.total) < 0.05 && Math.abs(r9.juros - ALVO.juros) < 0.05 && Math.abs(r9.vencido - ALVO.vencido) < 0.05 && r9.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R9: #URSTIE 2x Semanal (jurosPorParcela = (500*0.35)/2 = 87.50)`);
  console.log(`    total=R$${fmtNum(r9.total)} juros=R$${fmtNum(r9.juros)} vencido=R$${fmtNum(r9.vencido)} count=${r9.count}`);
}

// Regra 10: #URSTIE 1x Mensal (jurosPorParcela = 175, valor = 500+175 = 675)
function calcularComURSTIE1x() {
  const c2 = { ...URSTIE, numeroParcelas: 1, valorEmprestado: 500 };
  const baseGeral = filtrarPorTipo([c2, M3MX4ZS], "Todos");
  const baseEmAberto = filtrarPorAba(baseGeral, "Todos");
  const { inicioPeriodo, fimPeriodo } = janelaPeriodo("Próximos 90 dias", "", "");
  const ps = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue;
    const parcelas = calcularParcelas(c, new Date());
    for (const p of parcelas) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (v > fimPeriodo) continue;
      ps.push({ contratoId: c.id, parcela: p, vencimentoDate: v });
    }
  }
  const hoje = hojeDate();
  let total = 0, juros = 0, vencido = 0, count = 0;
  for (const item of ps) { total += item.parcela.valor; juros += item.parcela.jurosOriginais; if (item.vencimentoDate < hoje) vencido += item.parcela.valor; count++; }
  return { total, juros, vencido, count };
}
{
  const r10 = calcularComURSTIE1x();
  const ok = Math.abs(r10.total - ALVO.total) < 0.05 && Math.abs(r10.juros - ALVO.juros) < 0.05 && Math.abs(r10.vencido - ALVO.vencido) < 0.05 && r10.count === ALVO.count;
  console.log(`[${ok ? "✓" : " "}] R10: #URSTIE 1x Mensal (valor=675)`);
  console.log(`    total=R$${fmtNum(r10.total)} juros=R$${fmtNum(r10.juros)} vencido=R$${fmtNum(r10.vencido)} count=${r10.count}`);
}

console.log("\n=================================================================");
