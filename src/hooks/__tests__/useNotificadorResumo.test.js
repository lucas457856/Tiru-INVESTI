// Testes para as funções PURAS do hook de notificação de resumo.
// As funções testadas (`contarContratosAtivos`, `calcularParcelasParaReceberHoje`)
// são extraídas e exportadas, então são testáveis sem React/Firebase/Firestore.
//
// CASO REAL (regressão 2026-09-04):
//   N contratos ativos → "N contratos ativos"
//   2 parcelas pendentes hoje (R$ 100 + R$ 147,94) → "Total a receber: R$ 247,94"
//
// Mock do `parcelasDoContrato` via vi.mock — o módulo ESM tem exports
// read-only, então não conseguimos reatribuir diretamente.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de `parcelasDoContrato` — controlável por teste via `_setMock`.
let mockFn = () => [];
vi.mock("../../services/contractService", () => ({
  parcelasDoContrato: (c) => mockFn(c),
}));

import {
  contarContratosAtivos,
  calcularParcelasParaReceberHoje,
} from "../useNotificadorResumo";

function setMockParcelas(mapaPorContrato) {
  mockFn = (c) => {
    const ps = mapaPorContrato.get(c?.id);
    return Array.isArray(ps) ? ps : [];
  };
}

describe("contarContratosAtivos", () => {
  it("usuário com 2 contratos ativos retorna 2", () => {
    expect(
      contarContratosAtivos([
        { id: "c1", quitado: false },
        { id: "c2", quitado: false },
      ]),
    ).toBe(2);
  });

  it("usuário com 0 contratos ativos retorna 0", () => {
    expect(contarContratosAtivos([])).toBe(0);
  });

  it("contratos quitados não são contados", () => {
    expect(
      contarContratosAtivos([
        { id: "c1", quitado: true },
        { id: "c2", quitado: false },
        { id: "c3", quitado: true },
      ]),
    ).toBe(1);
  });

  it("input não-array retorna 0 (defesa)", () => {
    expect(contarContratosAtivos(null)).toBe(0);
    expect(contarContratosAtivos(undefined)).toBe(0);
    expect(contarContratosAtivos("string")).toBe(0);
  });

  it("ignora entradas null/undefined", () => {
    expect(
      contarContratosAtivos([null, { quitado: false }, undefined, { quitado: false }]),
    ).toBe(2);
  });
});

describe("calcularParcelasParaReceberHoje", () => {
  const hoje = "2026-09-04";

  it("usuário com 2 parcelas pendentes vencendo HOJE → quantidade=2, soma=247.94", () => {
    setMockParcelas(
      new Map([
        [
          "c1",
          [
            { numero: 1, status: "Pendente", vencimento: "2026-09-04", valor: 100 },
            { numero: 2, status: "Pendente", vencimento: "2026-09-04", valor: 147.94 },
          ],
        ],
      ]),
    );
    const r = calcularParcelasParaReceberHoje([{ id: "c1" }], hoje);
    expect(r.quantidade).toBe(2);
    expect(r.total).toBeCloseTo(247.94, 2);
  });

  it("parcela vencida ontem NÃO entra em 'parcelas para receber hoje'", () => {
    setMockParcelas(
      new Map([
        [
          "c1",
          [
            { numero: 1, status: "Vencida", vencimento: "2026-09-03", valor: 100 },
          ],
        ],
      ]),
    );
    const r = calcularParcelasParaReceberHoje([{ id: "c1" }], hoje);
    expect(r.quantidade).toBe(0);
    expect(r.total).toBe(0);
  });

  it("parcela com vencimento amanhã NÃO entra", () => {
    setMockParcelas(
      new Map([
        [
          "c1",
          [
            { numero: 1, status: "Pendente", vencimento: "2026-09-05", valor: 100 },
          ],
        ],
      ]),
    );
    const r = calcularParcelasParaReceberHoje([{ id: "c1" }], hoje);
    expect(r.quantidade).toBe(0);
  });

  it("parcela PAGA com vencimento hoje NÃO entra", () => {
    setMockParcelas(
      new Map([
        [
          "c1",
          [
            { numero: 1, status: "Paga", vencimento: "2026-09-04", valor: 100 },
          ],
        ],
      ]),
    );
    const r = calcularParcelasParaReceberHoje([{ id: "c1" }], hoje);
    expect(r.quantidade).toBe(0);
  });

  it("mistura: 1 hoje + 1 atrasada + 1 futura + 1 paga → só 1 conta", () => {
    setMockParcelas(
      new Map([
        [
          "c1",
          [
            { numero: 1, status: "Pendente", vencimento: "2026-09-04", valor: 50 },
            { numero: 2, status: "Vencida", vencimento: "2026-09-03", valor: 80 },
            { numero: 3, status: "Pendente", vencimento: "2026-09-05", valor: 70 },
            { numero: 4, status: "Paga", vencimento: "2026-09-04", valor: 999 },
          ],
        ],
      ]),
    );
    const r = calcularParcelasParaReceberHoje([{ id: "c1" }], hoje);
    expect(r.quantidade).toBe(1);
    expect(r.total).toBe(50);
  });

  it("múltiplos contratos do mesmo usuário somam corretamente", () => {
    setMockParcelas(
      new Map([
        ["c1", [{ numero: 1, status: "Pendente", vencimento: "2026-09-04", valor: 100 }]],
        ["c2", [{ numero: 1, status: "Pendente", vencimento: "2026-09-04", valor: 47.94 }]],
      ]),
    );
    const r = calcularParcelasParaReceberHoje(
      [{ id: "c1" }, { id: "c2" }],
      hoje,
    );
    expect(r.quantidade).toBe(2);
    expect(r.total).toBeCloseTo(147.94, 2);
  });

  it("valor com string numérica (defesa) é somado", () => {
    setMockParcelas(
      new Map([
        [
          "c1",
          [
            { numero: 1, status: "Pendente", vencimento: "2026-09-04", valor: "100.50" },
          ],
        ],
      ]),
    );
    const r = calcularParcelasParaReceberHoje([{ id: "c1" }], hoje);
    expect(r.total).toBeCloseTo(100.5, 2);
  });

  it("contrato desconhecido pelo mock retorna [] e não quebra", () => {
    setMockParcelas(new Map());
    const r = calcularParcelasParaReceberHoje([{ id: "estranho" }], hoje);
    expect(r.quantidade).toBe(0);
  });

  it("input não-array retorna zeros (defesa)", () => {
    expect(calcularParcelasParaReceberHoje(null, hoje)).toEqual({
      quantidade: 0,
      total: 0,
      parcelas: [],
    });
  });
});

describe("casos de borda: virada de mês e ano", () => {
  it("virada de mês 31/08 → 01/09 funciona", () => {
    setMockParcelas(
      new Map([
        [
          "c1",
          [
            { numero: 1, status: "Pendente", vencimento: "2026-09-01", valor: 10 },
          ],
        ],
      ]),
    );
    const r = calcularParcelasParaReceberHoje([{ id: "c1" }], "2026-09-01");
    expect(r.quantidade).toBe(1);
    expect(r.total).toBe(10);
  });

  it("virada de ano 31/12/2025 → 01/01/2026 funciona", () => {
    setMockParcelas(
      new Map([
        [
          "c1",
          [
            { numero: 1, status: "Pendente", vencimento: "2026-01-01", valor: 5 },
          ],
        ],
      ]),
    );
    const r = calcularParcelasParaReceberHoje([{ id: "c1" }], "2026-01-01");
    expect(r.quantidade).toBe(1);
    expect(r.total).toBe(5);
  });
});

describe("isolamento por usuário (segurança)", () => {
  it("parcelas de um usuário NÃO vazam em cálculo de outro", () => {
    // O hook recebe SEMPRE o array de contratos do ownerUid corrente.
    // A função pura não tem acesso a dados de outros usuários por
    // construção. Aqui validamos que ela respeita o array recebido.
    setMockParcelas(
      new Map([
        [
          "c-usuario-a",
          [{ numero: 1, status: "Pendente", vencimento: "2026-09-04", valor: 999 }],
        ],
        // c-usuario-b existe no mapa mas NÃO é passado para a função.
      ]),
    );
    const rUsuarioA = calcularParcelasParaReceberHoje(
      [{ id: "c-usuario-a" }],
      "2026-09-04",
    );
    // Usuário A recebe 999.
    expect(rUsuarioA.total).toBe(999);

    // Se a função fosse chamada com array vazio (outro usuário), retorna 0.
    const rUsuarioB = calcularParcelasParaReceberHoje([], "2026-09-04");
    expect(rUsuarioB.quantidade).toBe(0);
    expect(rUsuarioB.total).toBe(0);
  });
});

describe("timezone: comparação por string ISO é determinística", () => {
  it("vencimento como Date (T12:00:00 local) extrai o dia local corretamente", () => {
    // 2026-09-04T12:00:00 SEM 'Z' = 12:00 horário LOCAL do dia 04/09.
    const localNoon = new Date("2026-09-04T12:00:00");
    setMockParcelas(
      new Map([
        [
          "c1",
          [
            { numero: 1, status: "Pendente", vencimento: localNoon, valor: 25 },
          ],
        ],
      ]),
    );
    const r = calcularParcelasParaReceberHoje([{ id: "c1" }], "2026-09-04");
    expect(r.quantidade).toBe(1);
    expect(r.total).toBe(25);
  });
});
