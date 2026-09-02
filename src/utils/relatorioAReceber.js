// Cálculo "A receber" — fonte ÚNICA de verdade para os 4 cards
// (Total a receber, Juros previstos, Vencido, Nº de parcelas) e a lista
// filtrada de parcelas usadas na seção "A receber" do Relatórios.
//
// Este módulo é o ÚNICO lugar do projeto onde mora a lógica de:
//   - janela de período (Este mês / Próximos 30/90 dias / Personalizado)
//   - filtragem de parcelas pela janela
//   - agregação dos totais (TOTAL, JUROS, VENCIDO, COUNT)
//
// Qualquer tela que precisar desses números (Relatórios, futuras telas
// "A receber" dedicadas, dashboard, etc.) deve importar daqui — não
// recriar a lógica. Isso garante que Relatórios e A Receber (ou
// qualquer outro consumidor) exibam EXATAMENTE os mesmos números para
// o mesmo período + tipo + aba.
//
// REGRAS DE NEGÓCIO (mantidas idênticas à implementação original do
// Relatórios; ver comentários inline para detalhes):
//
//   1. Filtro de TIPO (Todos / Contratos / Vendas):
//        - "Contratos" → exclui `c.nomeProduto != null` (vendas)
//        - "Vendas"    → exclui `c.nomeProduto == null` (contratos puros)
//        - "Todos"     → passa tudo
//   2. Filtro de ABA (Todos / Em aberto):
//        - "Em aberto" → exclui `c.quitado === true`
//        - "Todos"     → passa tudo
//   3. JANELA ("Próximos 30/90 dias"):
//        - Sem limite inferior: parcelas ATRASADAS (v < hoje) entram
//        - Limite superior: v <= hoje + N dias (com `fimPeriodo`
//          estendido até 23:59:59.999 do último dia)
//   4. Status das parcelas:
//        - "Paga"               → NUNCA entra (já recebida)
//        - "Pendente"/"Vencida" → entra (é a receber)
//        - vencimento ausente ou inválido → DESCARTADA (sem fallback)
//
// VENCIDO é um subset do TOTAL: Σ valor das parcelas do conjunto cujo
// vencimento < HOJE. Não é re-filtragem por fora do conjunto.
//
// Nenhuma fórmula de cálculo (juros, parcelas, abatimentos) é tocada
// aqui — `parcelasDoContrato` continua sendo a fonte canônica do
// cronograma.
import { parcelasDoContrato } from "../services/contractService";

// --------------------------------------------------------------------
// Helpers de data LOCAL (sem drift de timezone)
// --------------------------------------------------------------------
function hojeDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDias(d, dias) {
  const r = new Date(d);
  r.setDate(r.getDate() + dias);
  return r;
}
function fimDoDia(d) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

// Normaliza QUALQUER fonte de data (Firestore Timestamp, ISO string,
// YYYY-MM-DD, Date) para um Date LOCAL válido. Retorna null se a data
// for ausente, inválida (NaN) ou não conversível. NUNCA inventa data —
// quem recebe null deve descartar o registro.
function toValidDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const [y, m, d] = value.slice(0, 10).split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function parseVencimento(v) {
  return toValidDate(v);
}

/**
 * Calcula a janela do filtro "A receber" em [inicioPeriodo, fimPeriodo]
 * (Date locais). SEMPRE retorna duas Dates válidas — sem fallback fictício.
 *
 * `fimPeriodo` é estendido até o FINAL do dia (23:59:59.999) para que
 * parcelas com horário intradiário (ex.: 12:00 gravado em
 * `calcularParcelas` como `T12:00:00`) caiam DENTRO da janela. Sem isso,
 * uma parcela com vencimento 02/10/2026 12:00 seria rejeitada pela
 * comparação `v > fimPeriodo` quando `fimPeriodo` é 02/10/2026 00:00.
 *
 * @param {"Este mês" | "Próximos 30 dias" | "Próximos 90 dias" | "Personalizado"} periodo
 * @param {string} [personalizadoIni] — string "YYYY-MM-DD" (somente Personalizado)
 * @param {string} [personalizadoFim] — string "YYYY-MM-DD" (somente Personalizado)
 * @returns {{ inicioPeriodo: Date, fimPeriodo: Date }}
 */
export function janelaPeriodo(periodo, personalizadoIni, personalizadoFim) {
  const h = hojeDate();
  if (periodo === "Este mês") {
    const inicioPeriodo = new Date(h.getFullYear(), h.getMonth(), 1);
    const fimBase = new Date(h.getFullYear(), h.getMonth() + 1, 0);
    return { inicioPeriodo, fimPeriodo: fimDoDia(fimBase) };
  }
  if (periodo === "Próximos 30 dias") {
    return { inicioPeriodo: h, fimPeriodo: fimDoDia(addDias(h, 30)) };
  }
  if (periodo === "Próximos 90 dias") {
    return { inicioPeriodo: h, fimPeriodo: fimDoDia(addDias(h, 90)) };
  }
  if (periodo === "Personalizado" && personalizadoIni && personalizadoFim) {
    const ini = parseVencimento(personalizadoIni);
    const fim = parseVencimento(personalizadoFim);
    if (ini && fim) return { inicioPeriodo: ini, fimPeriodo: fimDoDia(fim) };
  }
  // Padrão: "Este mês" — se período vier desconhecido, mantém comportamento seguro
  const fimBasePadrao = new Date(h.getFullYear(), h.getMonth() + 1, 0);
  return {
    inicioPeriodo: new Date(h.getFullYear(), h.getMonth(), 1),
    fimPeriodo: fimDoDia(fimBasePadrao),
  };
}

/**
 * Aplica os filtros de TIPO e ABA sobre uma lista de contratos.
 * Função utilitária exportada para que telas dedicadas de "A Receber"
 * possam compor a base a partir da mesma regra do Relatórios.
 *
 * @param {Array} contratos
 * @param {"Todos" | "Contratos" | "Vendas"} tipo
 * @returns {Array}
 */
export function filtrarPorTipo(contratos, tipo) {
  return contratos.filter((c) => {
    if (tipo === "Contratos" && c.nomeProduto != null) return false;
    if (tipo === "Vendas" && c.nomeProduto == null) return false;
    return true;
  });
}

/**
 * Aplica o filtro de ABA sobre uma base já filtrada por TIPO.
 *
 * @param {Array} baseFiltrada
 * @param {"Todos" | "Em aberto"} aba
 * @returns {Array}
 */
export function filtrarPorAba(baseFiltrada, aba) {
  return baseFiltrada.filter((c) => {
    if (aba === "Em aberto" && c.quitado) return false;
    return true;
  });
}

/**
 * Constrói a lista mestra de parcelas "a receber" para o período
 * solicitado, a partir de uma base de contratos já filtrada por TIPO
 * e ABA (use `filtrarPorTipo` + `filtrarPorAba`).
 *
 * Regras do filtro de período:
 *   - "Este mês"        → vencimento dentro do mês atual (match exato
 *                         por ano/mês, sem juntar outros meses).
 *   - "Próximos 30 dias"→ vencimento <= hoje + 30 dias. Inclui
 *                         parcelas ATRASADAS (vencimento < hoje).
 *   - "Próximos 90 dias"→ vencimento <= hoje + 90 dias. Inclui
 *                         parcelas ATRASADAS (vencimento < hoje).
 *   - "Personalizado"   → vencimento em [dataIni, dataFim] (fechado).
 *
 * Regras das parcelas:
 *   - status === "Paga" → fora (já recebida).
 *   - vencimento ausente/inválido → fora (sem inventar data).
 *
 * @param {Array} baseEmAberto — contratos filtrados (TIPO + ABA aplicados)
 * @param {Date} inicioPeriodo
 * @param {Date} fimPeriodo
 * @param {"Este mês" | "Próximos 30 dias" | "Próximos 90 dias" | "Personalizado"} periodo
 * @returns {Array<{ contratoId: string, parcela: object, vencimentoDate: Date }>}
 */
export function calcularParcelasAReceber(baseEmAberto, inicioPeriodo, fimPeriodo, periodo) {
  const out = [];
  for (const c of baseEmAberto) {
    if (c.quitado) continue; // só contratos em aberto
    let ps;
    try {
      ps = parcelasDoContrato(c, new Date());
    } catch (err) {
      console.warn("parcelasDoContrato falhou para", c.id, err);
      continue;
    }
    for (const p of ps) {
      if (p.status === "Paga") continue;
      const v = parseVencimento(p.vencimento);
      if (!v) continue;
      if (
        !(inicioPeriodo instanceof Date) ||
        Number.isNaN(inicioPeriodo.getTime()) ||
        !(fimPeriodo instanceof Date) ||
        Number.isNaN(fimPeriodo.getTime())
      ) {
        // Janela corrompida: ignora o filtro e aceita a parcela
        // (melhor mostrar do que esconder dados por bug interno).
      } else if (periodo === "Este mês") {
        if (
          v.getFullYear() !== inicioPeriodo.getFullYear() ||
          v.getMonth() !== inicioPeriodo.getMonth()
        ) {
          continue;
        }
      } else if (periodo === "Próximos 30 dias" || periodo === "Próximos 90 dias") {
        if (v > fimPeriodo) continue;
      } else {
        // Personalizado: intervalo fechado [inicio, fim]
        if (v < inicioPeriodo || v > fimPeriodo) continue;
      }
      out.push({
        contratoId: c.id,
        parcela: p,
        vencimentoDate: v,
      });
    }
  }
  return out;
}

/**
 * Agrega os 4 totais "A receber" (TOTAL, JUROS, VENCIDO, COUNT) a partir
 * da lista de parcelas gerada por `calcularParcelasAReceber`.
 *
 *   TOTAL A RECEBER = Σ parcela.valor
 *   JUROS PREVISTOS = Σ parcela.jurosOriginais (campo canônico,
 *                     imutável ao longo do ciclo do contrato)
 *   VENCIDO         = Σ parcela.valor onde vencimentoDate < HOJE
 *                     (subset do TOTAL, destaca o atraso)
 *   Nº DE PARCELAS  = count do conjunto
 *
 * @param {Array} parcelasAReceber — saída de `calcularParcelasAReceber`
 * @returns {{ total: number, juros: number, vencido: number, count: number }}
 */
export function calcularTotaisAReceber(parcelasAReceber) {
  const hoje = hojeDate();
  let total = 0;
  let juros = 0;
  let vencido = 0;
  let count = 0;
  for (const item of parcelasAReceber) {
    const v = Number(item.parcela.valor) || 0;
    const j = Number(item.parcela.jurosOriginais) || 0;
    total += v;
    juros += j;
    if (item.vencimentoDate < hoje) vencido += v;
    count += 1;
  }
  return { total, juros, vencido, count };
}
