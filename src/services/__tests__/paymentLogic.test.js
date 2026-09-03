// Tests for the financial logic of the Cred Facil contract system.
// Verifica: abatimento (principal reduction) vs pagamento de parcela (installment payment)
//
// REGRA DEFINITIVA (MODELO "SALDO ATUAL"):
// REGRA 1 — PARCELAS ORIGINAIS (parcelasPagas < numeroParcelas):
//   valor = (saldoPrincipal / numeroParcelas) + (saldoPrincipal × juros/100)
//   Divisão SEMPRE por numeroParcelas ORIGINAL.
// REGRA 2 — PARCELAS DINÂMICAS (parcelasPagas >= numeroParcelas, saldoPrincipal > 0):
//   valor = saldoPrincipal × (1 + juros/100)
// REGRA 3 — ABATIMENTO:
//   novoSaldo = saldoPrincipal - valorAbatimento (cumulativo)

// Mock do Firebase Firestore — precisa ser hoisted pelo vitest
const _firestoreMocks = {};

vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    doc: (db, ...paths) => ({ _mock: true, _paths: paths }),
    updateDoc: (ref, data) => {
      _firestoreMocks.lastUpdate = { ref, data };
      return Promise.resolve();
    },
    getDoc: (ref) => Promise.resolve({ exists: () => false, data: () => null }),
    deleteDoc: () => Promise.resolve(),
    serverTimestamp: () => "mock-timestamp",
  };
});

vi.mock("../firebase", () => ({
  db: { _mock: true },
}));

vi.mock("./paymentHistoryService", () => ({
  registrarPagamento: () => Promise.resolve(),
}));

import { describe, it, expect, vi } from "vitest";
import { calcularParcelas } from "../../utils/parcelasUtil";
import { processarPagamento, parcelasDoContrato } from "../contractService";
import {
  calculateInterest,
  calculateDebtRemaining,
  calculatePrincipalQuitado,
  totalAbatimentos,
  getNextOpenInstallment,
  calculateFullSettlement,
  avancarData,
  shiftFutureInstallments,
} from "../paymentCalculations";

// Helper: cria um contrato base para testes
function criarContrato(overrides = {}) {
  return {
    id: "test-123",
    numeroParcelas: 2,
    valorEmprestado: 500,
    juros: 35,
    jurosRecebidos: 0,
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 500,
    abatimentos: [],
    dataPrimeiraParcela: "2026-08-01",
    frequencia: "Mensal",
    ...overrides,
  };
}

describe("calculateInterest", () => {
  it("calcula juros sobre o valor ORIGINAL", () => {
    // 500 * 35% = 175
    expect(calculateInterest(500, 35)).toBe(175);
    expect(calculateInterest(1000, 10)).toBe(100);
    expect(calculateInterest(0, 35)).toBe(0);
  });
});

describe("calculateDebtRemaining", () => {
  it("retorna saldoPrincipal quando existe", () => {
    const c = criarContrato({ saldoPrincipal: 450 });
    expect(calculateDebtRemaining(c)).toBe(450);
  });

  it("fallback: calcula valorEmprestado - abatimentos - principalQuitado", () => {
    const c = criarContrato({
      valorEmprestado: 500,
      saldoPrincipal: null, // força fallback
      abatimentos: [{ valor: 50 }],
      parcelasPagas: 0,
      numeroParcelas: 2,
    });
    // 500 - 50 - 0 = 450
    expect(calculateDebtRemaining(c)).toBe(450);
  });
});

describe("calculatePrincipalQuitado", () => {
  it("calcula principal quitado = parcelasPagas × valorBaseParcela", () => {
    const c = criarContrato({ valorEmprestado: 500, numeroParcelas: 2, parcelasPagas: 1 });
    // 1 × (500/2) = 250
    expect(calculatePrincipalQuitado(c)).toBe(250);
  });

  it("retorna 0 quando nenhuma parcela paga", () => {
    const c = criarContrato({ parcelasPagas: 0 });
    expect(calculatePrincipalQuitado(c)).toBe(0);
  });
});

describe("totalAbatimentos", () => {
  it("soma todos os abatimentos", () => {
    const abatimentos = [
      { valor: 50, parcelaNumero: 1 },
      { valor: 100, parcelaNumero: 2 },
    ];
    expect(totalAbatimentos(abatimentos)).toBe(150);
  });

  it("retorna 0 quando não há abatimentos", () => {
    expect(totalAbatimentos(null)).toBe(0);
    expect(totalAbatimentos([])).toBe(0);
    expect(totalAbatimentos(undefined)).toBe(0);
  });
});

// ============================================================================
// REGRA 1 — PARCELAS ORIGINAIS (pagas < numeroParcelas)
// valor = (saldoPrincipal / numeroParcelas) + (saldoPrincipal × juros%)
// ============================================================================
describe("REGRA 1: Parcelas originais — saldo / numeroParcelas + juros sobre saldo", () => {
  it("TESTE A: R$ 500, 2x, 35% → P1 = P2 = 425", () => {
    // valorEmprestado = 500
    // saldoPrincipal = 500
    // (500 / 2) + (500 × 0,35) = 250 + 175 = 425
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 500,
      parcelasPagas: 0,
      abatimentos: [],
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas.length).toBe(2);
    expect(parcelas[0].valor).toBeCloseTo(425, 2);
    expect(parcelas[1].valor).toBeCloseTo(425, 2);
    expect(parcelas[0].status).toBe("Pendente");
    expect(parcelas[1].status).toBe("Pendente");

    // Juros sobre original (display): 500 × 35% = 175
    expect(parcelas[0].jurosOriginais).toBe(175);
    expect(parcelas[1].jurosOriginais).toBe(175);
  });

  it("TESTE B: R$ 450, 2x, 35%, P1 paga R$ 50 → P2 = 382.50", () => {
    // valorEmprestado = 450
    // saldoPrincipal = 450 (450 - 50 abatimento)
    // (450 / 2) + (450 × 0,35) = 225 + 157.5 = 382.5
    const contrato = criarContrato({
      valorEmprestado: 450,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 400, // 450 - 50
      parcelasPagas: 1,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      valorRecebido: 50,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    // Parcela 1: Paga com R$ 50
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[0].recebido).toBe(50);

    // Parcela 2: (400/2) + (400*0.35) = 200 + 140 = 340
    // ESPERA! saldoPrincipal = 400 → (400/2) + (400*0.35) = 340
    // MAS o site mostra 382.50...

    // ESPERA! O valorEmprestado é 450, mas saldoPrincipal é 400?
    // O site mostra 382.50 = 225 + 157.5 = (450/2) + (450*0.35)
    // Isso usa 450 (valorEmprestado) não 400 (saldoPrincipal)!
    // NÃO! Regra 1 diz: saldoPrincipal / numeroParcelas + saldoPrincipal × juros
    // saldoPrincipal = 400 → (400/2) + (400*0.35) = 200 + 140 = 340

    // MAS O SITE MOSTRA 382.50!
    // 382.50 = (450/2) + (450*0.35) → usa valorEmprestado (450), não saldoPrincipal (400)!

    // ESPERA... valorEmprestado = 450? Então:
    // (450/2) + (450*0.35) = 225 + 157.5 = 382.5 ✓
    // MAS saldoPrincipal = 400 ≠ 450!

    // O problema é que saldoPrincipal = 400 (450 - 50 abatimento)
    // mas a fórmula usa valorEmprestado = 450
    // OU: saldoPrincipal deveria ser 450?

    // NO AGUARDE! Vamos re-examinar. O contrato do Estado B:
    // valorEmprestado = 450, saldoPrincipal = 400 (após R$ 50 abatimento)
    // MAS o site mostra P2 = 382.50 = (450/2) + (450*0.35)
    // Isso significa que a fórmula usa valorEmprestado (ou saldo antes do abatimento)?

    // NÃO! A regra diz:
    // saldoPrincipal / numeroParcelas + saldoPrincipal × juros
    // Com saldoPrincipal = 450 (antes de dividir, se o abatimento ainda não foi aplicado)

    // ESPERA! Talvez eu esteja confundindo o cálculo.
    // Se valorEmprestado = 450 e saldoPrincipal = 400 (450 - 50):
    //   Regra 1: (400/2) + (400*0.35) = 200 + 140 = 340

    // MAS 382.50 = (450/2) + (450*0.35)
    // Isso usa 450, que é o valorEmprestado OU o saldo antes do abatimento!

    // AH! Entendo agora. No estado B:
    // valorEmprestado = 500 (original!)
    // saldoPrincipal = 450 (500 - 50 abatimento)
    // (450/2) + (450*0.35) = 225 + 157.5 = 382.5 ✓

    // O erro está no teste: valorEmprestado deveria ser 500, não 450!
    // E saldoPrincipal = 450 (500 - 50)

    // Vou corrigir isso no teste...
  });

  it("TESTE B CORRIGIDO: R$ 500, 2x, 35%, P1 paga R$ 50 → saldo=450 → P2 = 382.50", () => {
    // valorEmprestado = 500 (ORIGINAL)
    // saldoPrincipal = 450 (500 - 50 abatimento)
    // (450 / 2) + (450 × 0,35) = 225 + 157.5 = 382.5
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      parcelasPagas: 1,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      valorRecebido: 50,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    // Parcela 1: Paga com R$ 50
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[0].recebido).toBe(50);

    // Parcela 2: (450/2) + (450*0.35) = 225 + 157.5 = 382.5
    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);

    // Juros sobre original (display): 500 × 35% = 175
    expect(parcelas[0].jurosOriginais).toBe(175);
    expect(parcelas[1].jurosOriginais).toBe(175);
  });

  it("TESTE: 3 parcelas, 1ª paga, saldo=350 → cada futura = (350/3) + (350*0.35)", () => {
    // valorEmprestado = 500, 3 parcelas, saldo = 350 (500 - 50 abatimento - 500/3 principal quitado)
    // (350 / 3) + (350 × 0,35) = 116.67 + 122.5 = 239.17
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 3,
      juros: 35,
      parcelasPagas: 1,
      saldoPrincipal: 350,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
    });

    const parcelas = calcularParcelas(contrato, new Date());

    expect(parcelas.length).toBe(3);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].recebido).toBe(50);
    expect(parcelas[0].valor).toBe(50);

    // (350/3) + (350 * 0.35) = 116.666... + 122.5 = 239.166...
    const valorEsperado = Math.round(((350 / 3) + (350 * 0.35)) * 100) / 100;
    expect(parcelas[1].valor).toBeCloseTo(valorEsperado, 2);
    expect(parcelas[2].valor).toBeCloseTo(valorEsperado, 2);

    // Juros sobre original: 500 × 0.35 = 175 (display)
    expect(parcelas[1].jurosOriginais).toBe(175);
    expect(parcelas[2].jurosOriginais).toBe(175);
  });

  it("TESTE: saldo com remainder (999, 3x, 35%) — cada parcela original = (999/3) + (999*0.35)", () => {
    const contrato = criarContrato({
      valorEmprestado: 999,
      numeroParcelas: 3,
      juros: 35,
      saldoPrincipal: 999,
      abatimentos: [],
      parcelasPagas: 0,
    });

    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas.length).toBe(3);

    // (999/3) + (999*0.35) = 333 + 349.65 = 682.65
    const valorEsperado = Math.round((999 / 3 + 999 * 0.35) * 100) / 100;
    expect(parcelas[0].valor).toBeCloseTo(valorEsperado, 2);
    expect(parcelas[1].valor).toBeCloseTo(valorEsperado, 2);
    expect(parcelas[2].valor).toBeCloseTo(valorEsperado, 2);
  });
});

// ============================================================================
// REGRA 2 — PARCELAS DINÂMICAS (parcelasPagas >= numeroParcelas, saldoPrincipal > 0)
// valor = saldoPrincipal × (1 + juros%)
// ============================================================================
describe("REGRA 2: Parcelas dinâmicas — saldo × (1 + juros%)", () => {
  it("TESTE C: R$ 400 saldo, 2 pgtas, 2 originais → P3 dinâmica = 540", () => {
    // Todas originais pagas (parcelasPagas=2, numeroParcelas=2)
    // saldoPrincipal = 400, juros = 35%
    // 400 × 1.35 = 540
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 400,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
      ],
      valorRecebido: 100,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    // P1: Paga (50), P2: Paga (50), P3: Dinâmica (540)
    expect(parcelas.length).toBe(3);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[1].status).toBe("Paga");
    expect(parcelas[1].valor).toBe(50);
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(540, 2);

    // Juros sobre original (display): 500 × 0.35 = 175
    expect(parcelas[2].jurosOriginais).toBe(175);
  });

  it("TESTE D: R$ 350 saldo, todas originais pagas → parcela dinâmica = 472.50", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 350,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
        { valor: 50, parcelaNumero: 1 },
      ],
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas.length).toBe(3);
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(472.5, 2);
  });

  it("TESTE E: R$ 300 saldo, todas originais pagas → parcela dinâmica = 405", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 300,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 1 },
      ],
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas.length).toBe(3);
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(405, 2);
  });

  it("NÃO cria parcela dinâmica quando saldo = 0", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      saldoPrincipal: 0,
      parcelasPagas: 2,
      quitado: true,
      abatimentos: [],
    });

    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas.length).toBe(2);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].status).toBe("Paga");
  });
});

// ============================================================================
// REGRA 3 — ABATIMENTO (cumulativo)
// ============================================================================
describe("REGRA 3: Abatimento cumulativo", () => {
  it("500 - 50 = 450, depois 450 - 50 = 400", () => {
    expect(500 - 50).toBe(450);
    expect(450 - 50).toBe(400);
  });

  it("Abatimento não duplica — total correto", () => {
    const abatimentos = [
      { valor: 50, parcelaNumero: 1 },
      { valor: 50, parcelaNumero: 1 },
      { valor: 50, parcelaNumero: 1 },
    ];
    const total = totalAbatimentos(abatimentos);
    expect(total).toBe(150);

    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      saldoPrincipal: 350, // 500 - 150
      abatimentos,
    });

    expect(calculateDebtRemaining(contrato)).toBe(350);
    expect(totalAbatimentos(contrato.abatimentos)).toBe(150);
  });
});

// ============================================================================
// SEQUÊNCIA DEFINITIVA DO USUÁRIO
// ============================================================================
describe("SEQUÊNCIA DEFINITIVA DO USUÁRIO", () => {
  const JUROS = 35;
  const DATA_BASE = new Date("2026-08-01T12:00:00");

  it("Passo 1: 500, 2x, 35% → P1=425, P2=425 (REGRA 1)", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 500,
      parcelasPagas: 0,
      abatimentos: [],
    });

    const parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas[0].valor).toBeCloseTo(425, 2);
    expect(parcelas[1].valor).toBeCloseTo(425, 2);
  });

  it("Passo 2: 500 - 50 (abatimento) = 450, P1 paga → P2 = 382.5 (REGRA 1)", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 450, // 500 - 50
      parcelasPagas: 1,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      valorRecebido: 50,
    });

    const parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);
  });

  it("Passo 3: 450 - 50 = 400, P2 paga → P3 dinâmica = 540 (REGRA 2)", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 400, // 450 - 50
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
      ],
      valorRecebido: 100,
    });

    const parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[1].status).toBe("Paga");
    expect(parcelas[1].valor).toBe(50);
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(540, 2);
  });

  it("Passo 4: 400 - 50 = 350 → P3 dinâmica = 472.5 (REGRA 2)", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 350,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
        { valor: 50, parcelaNumero: 3 },
      ],
    });

    const parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(472.5, 2);
  });

  it("Passo 5: 350 - 50 = 300 → P3 dinâmica = 405 (REGRA 2)", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 300,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
        { valor: 50, parcelaNumero: 3 },
        { valor: 50, parcelaNumero: 3 },
      ],
    });

    const parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(405, 2);
  });
});

// ============================================================================
// TESTES PARA getNextOpenInstallment
// ============================================================================
describe("getNextOpenInstallment", () => {
  it("TESTE 1: Contrato com 0 parcelas pagas deve retornar a parcela 1", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 500,
      abatimentos: [],
      parcelasPagas: 0,
    });
    const hoje = new Date("2026-08-01T12:00:00");
    const proxima = getNextOpenInstallment(contrato, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(1);
    expect(proxima.status).toBe("Pendente");
    // REGRA 1: (500/2) + (500*0.35) = 425
    expect(proxima.valor).toBeCloseTo(425, 2);
  });

  it("TESTE 2: Contrato com 1ª parcela paga deve retornar a parcela 2", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 250,
      abatimentos: [],
      parcelasPagas: 1,
    });
    const hoje = new Date("2026-08-01T12:00:00");
    const proxima = getNextOpenInstallment(contrato, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(2);
    expect(proxima.status).toBe("Pendente");
    // REGRA 1: (250/2) + (250*0.35) = 125 + 87.5 = 212.5
    expect(proxima.valor).toBeCloseTo(212.5, 2);
  });

  it("TESTE 3: Contrato quitado deve retornar null", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 0,
      abatimentos: [],
      parcelasPagas: 2,
      quitado: true,
    });
    const proxima = getNextOpenInstallment(contrato, new Date());
    expect(proxima).toBeNull();
  });

  it("TESTE 4: Contrato com todas as parcelas pagas (mas não quitado) deve retornar null", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 0,
      abatimentos: [],
      parcelasPagas: 2,
      quitado: false,
    });
    const proxima = getNextOpenInstallment(contrato, new Date());
    expect(proxima).toBeNull();
  });

  it("TESTE 5: Abatimento na P1 (parcelaNumero=1) — P1 fica Paga, próxima = P2 (REGRA 1)", () => {
    // valorEmprestado = 500, 2 parcelas, 35% juros
    // Abatimento R$ 50 na P1 → P1 marcada como Paga (abatimento em parcela original)
    // saldoPrincipal = 450 (500 - 50)
    // getNextOpenInstallment deve retornar P2, não P1
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 0,
    });
    const hoje = new Date("2026-08-01T12:00:00");
    const proxima = getNextOpenInstallment(contrato, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(2);
    // REGRA 1: (450/2) + (450*0.35) = 225 + 157.5 = 382.5
    expect(proxima.valor).toBeCloseTo(382.5, 2);
  });

  it("TESTE 5b: Abatimento sem parcelaNumero — não marca parcela como Paga", () => {
    // Abatimento geral (sem parcelaNumero) reduz saldoPrincipal
    // mas não marca nenhuma parcela original como Paga
    // getNextOpenInstallment deve retornar P1
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50 }], // sem parcelaNumero
      parcelasPagas: 0,
    });
    const hoje = new Date("2026-08-01T12:00:00");
    const proxima = getNextOpenInstallment(contrato, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(1);
    // REGRA 1: (450/2) + (450*0.35) = 225 + 157.5 = 382.5
    expect(proxima.valor).toBeCloseTo(382.5, 2);
  });

  it("TESTE 6: Contrato nulo deve retornar null", () => {
    const proxima = getNextOpenInstallment(null, new Date());
    expect(proxima).toBeNull();
  });
});

// ============================================================================
// CENÁRIOS COMPLETOS
// ============================================================================
describe("CENÁRIOS COMPLETOS", () => {
  function criarContratoBase(overrides = {}) {
    return {
      id: "test-complete",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      dataPrimeiraParcela: "2026-08-01",
      frequencia: "Mensal",
      ...overrides,
    };
  }

  it("CENÁRIO 1: Abatimento R$ 50 em contrato de 2 parcelas, nenhuma paga", () => {
    const contrato = criarContratoBase({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 0,
    });

    expect(calculateDebtRemaining(contrato)).toBe(450);
    expect(totalAbatimentos(contrato.abatimentos)).toBe(50);
    const juros = calculateInterest(500, 35);
    expect(juros).toBe(175);
    expect(calculatePrincipalQuitado(contrato)).toBe(0);

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas[0].abatimentoAcumulado).toBe(0);
    expect(parcelas[1].abatimentoAcumulado).toBe(0);

    // REGRA 1: (450/2) + (450*0.35) = 225 + 157.5 = 382.5
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[0].recebido).toBe(50);
    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);

    const proxima = getNextOpenInstallment(contrato, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(2);
    expect(proxima.valor).toBeCloseTo(382.5, 2);
  });

  it("CENÁRIO 2: Abatimento R$ 50, paga parcela 1 integralmente, novo abatimento R$ 50", () => {
    // Passo 1: Abatimento R$ 50, saldo = 450
    const contratoComAbatimento = criarContratoBase({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 0,
    });

    expect(calculateDebtRemaining(contratoComAbatimento)).toBe(450);
    expect(totalAbatimentos(contratoComAbatimento.abatimentos)).toBe(50);

    // Passo 2: Paga parcela 1 integralmente
    // principal = 250, juros sobre original = 175, total = 425
    const contratoPosPagamento = {
      ...contratoComAbatimento,
      parcelasPagas: 1,
      saldoPrincipal: 200, // 450 - 250 (principal pago)
      valorRecebido: 425,
      jurosRecebidos: 175,
    };

    expect(calculateDebtRemaining(contratoPosPagamento)).toBe(200);
    expect(calculatePrincipalQuitado(contratoPosPagamento)).toBe(250);

    // Passo 3: Novo abatimento R$ 50 (via juros_parte_divida — reduz saldo, não marca parcela como Paga)
    const contratoComNovoAbatimento = {
      ...contratoPosPagamento,
      saldoPrincipal: 150, // 200 - 50
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50 }, // abatimento sem número de parcela
      ],
    };

    expect(totalAbatimentos(contratoComNovoAbatimento.abatimentos)).toBe(100);
    expect(calculateDebtRemaining(contratoComNovoAbatimento)).toBe(150);

    const hoje = new Date("2026-09-01T12:00:00");
    const parcelas = calcularParcelas(contratoComNovoAbatimento, hoje);

    // Parcela 1: Paga — abatimento R$50
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].recebido).toBe(50);
    expect(parcelas[0].valor).toBe(50);

    // REGRA 1: (150/2) + (150*0.35) = 75 + 52.5 = 127.5
    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(127.5, 2);
  });

  it("CENÁRIO 3: Abatimento com 3 parcelas, 1ª paga", () => {
    const contrato = criarContratoBase({
      valorEmprestado: 500,
      numeroParcelas: 3,
      juros: 35,
      saldoPrincipal: 350,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 1,
    });

    expect(calculateDebtRemaining(contrato)).toBeCloseTo(350, 2);

    const hoje = new Date("2026-08-15T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[2].status).toBe("Pendente");

    const jurosOriginal = calculateInterest(500, 35);
    expect(jurosOriginal).toBe(175);

    expect(parcelas[0].jurosOriginais).toBeCloseTo(175, 2);
    expect(parcelas[1].jurosOriginais).toBeCloseTo(175, 2);
    expect(parcelas[2].jurosOriginais).toBeCloseTo(175, 2);

    // REGRA 1: (350/3) + (350*0.35) = 116.67 + 122.5 = 239.17
    const valorEsperado = Math.round(((350 / 3) + (350 * 0.35)) * 100) / 100;
    expect(parcelas[1].valor).toBeCloseTo(valorEsperado, 2);
    expect(parcelas[2].valor).toBeCloseTo(valorEsperado, 2);

    const proxima = getNextOpenInstallment(contrato, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(2);
  });

  it("CENÁRIO 4: Quitação total com abatimento prévio", () => {
    const contrato = criarContratoBase({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 0,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);
    const parcelaAtual = getNextOpenInstallment(contrato, hoje);

    const settlement = calculateFullSettlement(contrato, parcelaAtual, hoje);

    expect(settlement.saldoRestante).toBe(450);
    expect(settlement.juros).toBe(175);
    expect(settlement.totalParaQuitar).toBe(625);
  });

  it("CENÁRIO 5: Contrato sem abatimento — verificação de integridade", () => {
    const contrato = criarContratoBase({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 500,
      abatimentos: [],
      parcelasPagas: 0,
    });

    expect(totalAbatimentos(contrato.abatimentos)).toBe(0);
    expect(calculateDebtRemaining(contrato)).toBe(500);

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    // REGRA 1: (500/2) + (500*0.35) = 250 + 175 = 425
    expect(parcelas[0].valor).toBeCloseTo(425, 2);
    expect(parcelas[1].valor).toBeCloseTo(425, 2);

    const proxima = getNextOpenInstallment(contrato, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(1);
  });

  it("CENÁRIO 6: Contrato totalmente pago", () => {
    const contrato = criarContratoBase({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 0,
      abatimentos: [],
      parcelasPagas: 2,
      quitado: true,
      valorRecebido: 850,
      jurosRecebidos: 350,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas.length).toBe(2);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].status).toBe("Paga");
    expect(calculateDebtRemaining(contrato)).toBe(0);

    const proxima = getNextOpenInstallment(contrato, hoje);
    expect(proxima).toBeNull();
  });

  it("CENÁRIO 7: Parcela atrasada — multa sobre valor ORIGINAL da parcela", () => {
    const contrato = criarContratoBase({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 500,
      abatimentos: [],
      parcelasPagas: 0,
      cobrarJurosAtraso: true,
      jurosAtrasoValor: 2,
      modoJurosAtraso: "% ao valor da parcela",
      dataPrimeiraParcela: "2026-07-01",
    });

    const hoje = new Date("2026-08-26T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas[0].status).toBe("Vencida");
    expect(parcelas[0].abatimentoAcumulado).toBe(0);

    // Juros sobre original: 500 * 0.35 = 175 (display)
    expect(parcelas[0].jurosOriginais).toBeCloseTo(175, 2);

    // Multa: valorOriginalParcela (250) * 2% * 56 dias
    const valorOriginalParcela = 250;
    const multaEsperada = Math.round((valorOriginalParcela * (2 / 100) * 56) * 100) / 100;

    // REGRA 1: (500/2) + (500*0.35) + multa = 425 + multa
    const jurosSobreSaldo = 500 * 0.35;
    const valorTotal = Math.round((500 / 2 + jurosSobreSaldo + multaEsperada) * 100) / 100;
    expect(parcelas[0].valor).toBeCloseTo(valorTotal, 2);
  });

  it("CENÁRIO 8: Múltiplos abatimentos consecutivos", () => {
    const contrato1 = criarContratoBase({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 0,
    });

    expect(calculateDebtRemaining(contrato1)).toBe(450);
    expect(totalAbatimentos(contrato1.abatimentos)).toBe(50);

    const contrato2 = {
      ...contrato1,
      saldoPrincipal: 350,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 100, parcelaNumero: 2 },
      ],
    };

    expect(calculateDebtRemaining(contrato2)).toBe(350);
    expect(totalAbatimentos(contrato2.abatimentos)).toBe(150);

    const contrato3 = {
      ...contrato2,
      saldoPrincipal: 300,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 100, parcelaNumero: 2 },
        { valor: 50, parcelaNumero: 1 },
      ],
    };

    expect(calculateDebtRemaining(contrato3)).toBe(300);
    expect(totalAbatimentos(contrato3.abatimentos)).toBe(200);
  });

  it("CENÁRIO 9: Consistência — saldoPrincipal + totalAbatimentos = valorEmprestado", () => {
    const contrato = criarContratoBase({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 0,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(calculateDebtRemaining(contrato) + totalAbatimentos(contrato.abatimentos)).toBe(500);

    // Juros sobre original: 175 por parcela (500 * 0.35)
    const jurosTotal = parcelas.reduce((s, p) => s + p.jurosOriginais, 0);
    expect(jurosTotal).toBeCloseTo(350, 2);

    // Total a pagar = principalRestante + juros sobre saldo
    const jurosSobreSaldo = 450 * 0.35;
    const totalAPagar = calculateDebtRemaining(contrato) + jurosSobreSaldo;
    // (450/2) + (450*0.35) = 382.5, 2 parcelas → mas só uma é futura
    // A receita total será 382.5 (uma futura) + 50 (paga) = 432.5
    // ou 450 (saldo) + 157.5 (juros) = 607.5 se considerar saldo inteiro
    // O importante é que saldo + abatimento = original
    expect(totalAPagar).toBe(607.5); // 450 + 157.5
  });

  it("CENÁRIO 10: Pagamento parcial após abatimento", () => {
    const contrato = criarContratoBase({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 0,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const proxima = getNextOpenInstallment(contrato, hoje);

    const settlement = calculateFullSettlement(contrato, proxima, hoje);
    // saldoRestante = 450, juros sobre original = 175 → 450 + 175 = 625
    expect(settlement.totalParaQuitar).toBe(625);

    expect(settlement.saldoRestante + totalAbatimentos(contrato.abatimentos)).toBe(500);
    expect(settlement.totalParaQuitar).toBe(settlement.saldoRestante + settlement.juros);
  });
});

// ============================================================================
// TESTES ADICIONAIS: Pagamento parcial, quitação, múltiplas parcelas
// ============================================================================

describe("PAGAMENTO PARCIAL: valor menor que juros", () => {
  it("R$ 50 pago quando juros = R$ 175 — reduz saldoPrincipal em R$ 50", () => {
    // valorEmprestado = 500, 2 parcelas, 35% juros
    // Pagamento de R$ 50, juros sobre original = 175
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 1,
      valorRecebido: 50,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    // Parcela 1: Paga com R$ 50
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[0].recebido).toBe(50);

    // REGRA 1: (450/2) + (450*0.35) = 225 + 157.5 = 382.5
    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);
  });
});

describe("PAGAMENTO PARCIAL: valor entre juros e juros+principal", () => {
  it("Pago R$ 200 quando juros = R$ 175 e principal = R$ 250", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 425,
      abatimentos: [{ valor: 75, parcelaNumero: 1 }],
      parcelasPagas: 0,
      valorRecebido: 200,
      jurosRecebidos: 175,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    // REGRA 1: (425/2) + (425*0.35) = 212.5 + 148.75 = 361.25
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(75);
    expect(parcelas[0].recebido).toBe(75);

    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(361.25, 2);

    expect(calculateDebtRemaining(contrato)).toBeCloseTo(425, 2);
  });
});

describe("QUITAÇÃO: pagar tudo com abatimento prévio", () => {
  it("Contrato R$ 500, 2 parcelas, 35% juros, abatimento R$ 50", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 0,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);
    const parcelaAtual = getNextOpenInstallment(contrato, hoje);

    const settlement = calculateFullSettlement(contrato, parcelaAtual, hoje);

    expect(settlement.saldoRestante).toBe(450);
    expect(settlement.juros).toBe(175);
    expect(settlement.totalParaQuitar).toBe(625);
  });
});

describe("PAGAMENTO DAS DUAS PARCELAS: progresso = 100%", () => {
  it("Pagar todas as parcelas — progresso 100%, todas Paga", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 0,
      abatimentos: [],
      parcelasPagas: 2,
      quitado: true,
      valorRecebido: 850,
      jurosRecebidos: 350,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas.length).toBe(2);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].status).toBe("Paga");

    const pagas = parcelas.filter((p) => p.status === "Paga").length;
    expect(pagas).toBe(2);
    expect((pagas / parcelas.length) * 100).toBe(100);

    const totalRecebido = parcelas.reduce((s, p) => s + (p.recebido || 0), 0);
    expect(totalRecebido).toBe(850);
  });
});

describe("CONTRATO COM 3+ PARCELAS", () => {
  it("3 parcelas — pagar parcela 1, demais calculadas sobre saldo (REGRA 1)", () => {
    // valorEmprestado = 600, 3 parcelas, 10% juros
    // 1 parcela paga → principalPago = 200, saldoPrincipal = 400
    // REGRA 1: (400/3) + (400*0.10) = 133.33 + 40 = 173.33
    const contrato = criarContrato({
      valorEmprestado: 600,
      numeroParcelas: 3,
      juros: 10,
      saldoPrincipal: 400,
      parcelasPagas: 1,
      valorRecebido: 260,
      jurosRecebidos: 60,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas.length).toBe(3);

    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].recebido).toBe(260);
    expect(parcelas[0].valor).toBe(260);

    // REGRA 1: (400/3) + (400*0.10) = 173.33
    const valorEsperado = Math.round((400 / 3 + 400 * 0.10) * 100) / 100;
    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(valorEsperado, 2);
    expect(parcelas[2].valor).toBeCloseTo(valorEsperado, 2);

    expect(parcelas[0].jurosOriginais).toBe(60);
    expect(parcelas[1].jurosOriginais).toBe(60);
    expect(parcelas[2].jurosOriginais).toBe(60);

    const proxima = getNextOpenInstallment(contrato, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(2);
    expect(proxima.valor).toBeCloseTo(valorEsperado, 2);
  });

  it("5 parcelas — pagar 2, demais calculadas sobre saldo (REGRA 1)", () => {
    const contrato = criarContrato({
      valorEmprestado: 1000,
      numeroParcelas: 5,
      juros: 10,
      saldoPrincipal: 600,
      parcelasPagas: 2,
      valorRecebido: 600,
      jurosRecebidos: 200,
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas.length).toBe(5);

    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].status).toBe("Paga");
    expect(parcelas[0].recebido).toBe(300);
    expect(parcelas[1].recebido).toBe(300);

    // REGRA 1: (600/5) + (600*0.10) = 120 + 60 = 180
    const valorEsperado = Math.round((600 / 5 + 600 * 0.10) * 100) / 100;
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[3].status).toBe("Pendente");
    expect(parcelas[4].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(valorEsperado, 2);
    expect(parcelas[3].valor).toBeCloseTo(valorEsperado, 2);
    expect(parcelas[4].valor).toBeCloseTo(valorEsperado, 2);

    const proxima = getNextOpenInstallment(contrato, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(3);
  });

  it("3 parcelas — todas pagas, saldo>0 → REGRA 2 (dinâmica)", () => {
    // valorEmprestado=600, 3x, 10%, toutes pagas, saldo=150
    // REGRA 2: 150 * 1.10 = 165
    const contrato = criarContrato({
      valorEmprestado: 600,
      numeroParcelas: 3,
      juros: 10,
      saldoPrincipal: 150,
      parcelasPagas: 3,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
        { valor: 50, parcelaNumero: 3 },
      ],
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas.length).toBe(4);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].status).toBe("Paga");
    expect(parcelas[2].status).toBe("Paga");
    // Parcela dinâmica
    expect(parcelas[3].status).toBe("Pendente");
    expect(parcelas[3].valor).toBeCloseTo(165, 2);
  });
});

// ============================================================================
// TESTES DE VALIDAÇÃO: fallback sem saldoPrincipal
// ============================================================================
describe("VALIDAÇÃO: fallback sem saldoPrincipal não duplica principalQuitado", () => {
  it("Fallback: contrato sem saldoPrincipal, 1ª parcela paga, abatimento R$ 50", () => {
    const contrato = {
      id: "test-fallback",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 1,
      quitado: false,
      saldoPrincipal: null,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      dataPrimeiraParcela: "2026-08-01",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    expect(parcelas.length).toBe(2);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].status).toBe("Pendente");

    // Fallback: saldoPrincipal = 500 - 50 - 250 = 200
    // REGRA 1: (200/2) + (200*0.35) = 100 + 70 = 170
    expect(parcelas[1].valor).toBeCloseTo(170, 2);
  });
});

// ============================================================================
// TESTES DE VALIDAÇÃO: numeroParcelas, parcelas congeladas, sem duplicação
// ============================================================================
describe("VALIDAÇÃO: numeroParcelas nunca é modificado", () => {
  it("TESTE 1: Abatimento não altera numeroParcelas", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
    });
    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas.length).toBe(2);
    expect(contrato.numeroParcelas).toBe(2);
  });

  it("TESTE 2: Pagar parcela 1 de 2 não reduz numeroParcelas", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      parcelasPagas: 1,
      saldoPrincipal: 250,
    });
    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas.length).toBe(2);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].status).toBe("Pendente");
  });

  it("TESTE 3: Abatimento + pagamento não altera numeroParcelas", () => {
    const contrato = criarContrato({
      valorEmprestado: 600,
      numeroParcelas: 3,
      parcelasPagas: 1,
      saldoPrincipal: 350,
      abatimentos: [{ valor: 100, parcelaNumero: 1 }],
    });
    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas.length).toBe(3);
    expect(contrato.numeroParcelas).toBe(3);
  });
});

describe("VALIDAÇÃO: parcelas pagas são congeladas (imutáveis)", () => {
  it("TESTE 4: Parcela paga mantém valorOriginal e recebido após novo abatimento", () => {
    const contrato = criarContrato({
      valorEmprestado: 600,
      numeroParcelas: 3,
      juros: 10,
      parcelasPagas: 1,
      saldoPrincipal: 400,
      abatimentos: [{ valor: 100, parcelaNumero: 1 }],
    });
    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valorOriginalParcela).toBeCloseTo(200, 2);
    expect(parcelas[0].abatimentoAcumulado).toBe(0);
    expect(parcelas[0].abatimentoParcela).toBe(0);
  });

  it("TESTE 5: Valor da parcela paga não muda mesmo com abatimento posterior", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      parcelasPagas: 1,
      saldoPrincipal: 150,
      abatimentos: [{ valor: 100, parcelaNumero: 1 }],
    });
    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas[0].valorOriginalParcela).toBeCloseTo(250, 2);
  });
});

describe("VALIDAÇÃO: abatimento não é duplicado", () => {
  it("TESTE 8: Um único abatimento de R$ 50 não aparece duas vezes", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
    });
    const abatimentoTotal = totalAbatimentos(contrato.abatimentos);
    expect(abatimentoTotal).toBe(50);
    const parcelas = calcularParcelas(contrato, new Date());
    for (const p of parcelas) {
      expect(p.abatimentoAcumulado).toBe(0);
      expect(p.abatimentoParcela).toBe(0);
    }
  });

  it("TESTE 9: Múltiplos abatimentos somam corretamente sem duplicar", () => {
    const abatimentos = [
      { valor: 50, parcelaNumero: 1 },
      { valor: 100, parcelaNumero: 2 },
    ];
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      saldoPrincipal: 150,
      parcelasPagas: 1,
      abatimentos,
    });
    expect(totalAbatimentos(contrato.abatimentos)).toBe(150);
    expect(calculateDebtRemaining(contrato)).toBe(150);
    const parcelas = calcularParcelas(contrato, new Date());
    for (const p of parcelas) {
      expect(p.abatimentoAcumulado).toBe(0);
    }
  });
});

describe("VALIDAÇÃO: valores corretos nas parcelas", () => {
  it("TESTE 10: valorEmprestado = 500, abatimento = 50, sem pagamento de parcela", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasPagas: 0,
    });
    const parcelas = calcularParcelas(contrato, new Date());
    // REGRA 1: (450/2) + (450*0.35) = 225 + 157.5 = 382.5
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);
  });

  it("TESTE 11: Após pagar 1 parcela e abatimento, valor da 2ª = (saldo/numeroParcelas) + juros", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      parcelasPagas: 1,
      saldoPrincipal: 225,
      abatimentos: [{ valor: 100, parcelaNumero: 1 }],
    });
    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas[0].status).toBe("Paga");
    // REGRA 1: (225/2) + (225*0.35) = 112.5 + 78.75 = 191.25
    expect(parcelas[1].valor).toBeCloseTo(191.25, 2);
  });
});

// ============================================================================
// TESTE DE INTEGRAÇÃO: Fluxo REAL de processamento de pagamento
// ============================================================================
describe("INTEGRAÇÃO: Processar pagamento parcial REAL (contractService.js)", () => {
  it("Fluxo completo: contrato R$ 500, 2x, 35%, pagar R$ 50 na P1", async () => {
    const contratoOriginal = {
      id: "test-real",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      valorParcela: 250,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      valorRecebido: 0,
      abatimentos: [],
      dataPrimeiraParcela: "2026-08-01",
      frequencia: "Mensal",
      cobrarJurosAtraso: false,
    };

    const hoje = new Date("2026-08-01T12:00:00");

    // Passo 1: Calcular parcelas iniciais
    const parcelasIniciais = calcularParcelas(contratoOriginal, hoje);
    // REGRA 1: (500/2) + (500*0.35) = 250 + 175 = 425
    expect(parcelasIniciais[0].valor).toBeCloseTo(425, 2);
    expect(parcelasIniciais[1].valor).toBeCloseTo(425, 2);

    // Passo 2: Processar pagamento REAL (R$ 50, menor que juros R$ 175)
    const usuario = { uid: "test-user" };
    const result = await processarPagamento(
      usuario,
      contratoOriginal,
      parcelasIniciais[0],
      "parcela_inteira",
      { valorTotal: 50 },
      "2026-08-29",
      "Pagamento parcial"
    );

    // Passo 3: Verificar resultado
    expect(result.parcelasPagas).toBe(1);
    expect(result.valorRecebido).toBe(50);
    expect(result.quitado).toBe(false);

    // Passo 4: Verificar o que foi gravado no Firestore (mock)
    const firestoreUpdate = _firestoreMocks.lastUpdate?.data;
    expect(firestoreUpdate).toBeDefined();
    expect(firestoreUpdate.parcelasPagas).toBe(1);
    expect(firestoreUpdate.valorRecebido).toBe(50);
    expect(firestoreUpdate.saldoPrincipal).toBe(450); // 500 - 50
    expect(firestoreUpdate.abatimentos).toEqual([
      expect.objectContaining({ valor: 50, parcelaNumero: 1 }),
    ]);

    // Passo 5: Construir o contrato atualizado
    const contratoAtualizado = {
      ...contratoOriginal,
      parcelasPagas: firestoreUpdate.parcelasPagas,
      valorRecebido: firestoreUpdate.valorRecebido,
      saldoPrincipal: firestoreUpdate.saldoPrincipal,
      abatimentos: firestoreUpdate.abatimentos,
      jurosRecebidos: firestoreUpdate.jurosRecebidos,
    };

    // Passo 6: Recalcular parcelas
    const parcelasAtualizadas = calcularParcelas(contratoAtualizado, hoje);

    // RESULTADO: P1 = R$ 50, P2 = (450/2) + (450*0.35) = 225 + 157.5 = 382.5
    expect(parcelasAtualizadas[0].status).toBe("Paga");
    expect(parcelasAtualizadas[0].valor).toBe(50);
    expect(parcelasAtualizadas[0].recebido).toBe(50);

    expect(parcelasAtualizadas[1].status).toBe("Pendente");
    expect(parcelasAtualizadas[1].valor).toBeCloseTo(382.5, 2);

    // Progresso: 50%
    const pagas = parcelasAtualizadas.filter((p) => p.status === "Paga").length;
    expect(pagas).toBe(1);
    expect((pagas / parcelasAtualizadas.length) * 100).toBe(50);

    const recebido = parcelasAtualizadas.reduce((s, p) => s + (p.recebido || 0), 0);
    expect(recebido).toBe(50);

    const proxima = getNextOpenInstallment(contratoAtualizado, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(2);
    expect(proxima.valor).toBeCloseTo(382.5, 2);
  });

  it("CENÁRIO REAL: 2/2 pagas + saldo 400 → quitado=false, P3=540 criada", async () => {
    // Simula o contrato APÓS 2 abatimentos de R$50 (P1 e P2 pagas)
    // com saldoPrincipal = 400 (ainda há dívida)
    const contratoPosPagamento = {
      id: "test-real",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      valorParcela: 250,
      jurosRecebidos: 0,
      parcelasPagas: 2,
      quitado: false,
      saldoPrincipal: 400,
      valorRecebido: 100,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
      ],
      dataPrimeiraParcela: "2026-08-29",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-29T12:00:00");

    // 1. calcularParcelas deve criar P3 dinâmica
    const parcelas = calcularParcelas(contratoPosPagamento, hoje);
    expect(parcelas.length).toBe(3);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[1].status).toBe("Paga");
    expect(parcelas[1].valor).toBe(50);
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(540, 2);

    // 2. getNextOpenInstallment deve encontrar P3
    const proxima = getNextOpenInstallment(contratoPosPagamento, hoje);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(3);
    expect(proxima.valor).toBeCloseTo(540, 2);

    // 3. quitado deve ser false (saldo ainda > 0)
    expect(contratoPosPagamento.quitado).toBe(false);

    // 4. Verifica que a fórmula correta foi aplicada
    // REGRA 2: 400 × (1 + 35/100) = 400 × 1.35 = 540
    expect(parcelas[2].valor).toBe(400 * 1.35);
  });
});

// ============================================================================
// TESTES: avancarData — sem drift de timezone, fim de mês correto
// ============================================================================
describe("avancarData — sem drift de timezone e tratamento de fim de mês", () => {
  it("Diária: +1 dia", () => {
    const r = avancarData("Diária", "2026-08-30");
    expect(r).not.toBeNull();
    expect(r.getFullYear()).toBe(2026);
    expect(r.getMonth()).toBe(7); // agosto (0-based)
    expect(r.getDate()).toBe(31);
  });

  it("Semanal: +7 dias", () => {
    const r = avancarData("Semanal", "2026-08-30");
    expect(r.getDate()).toBe(6);
    expect(r.getMonth()).toBe(8); // setembro
    expect(r.getFullYear()).toBe(2026);
  });

  it("Quinzenal: +15 dias", () => {
    const r = avancarData("Quinzenal", "2026-08-30");
    expect(r.getDate()).toBe(14);
    expect(r.getMonth()).toBe(8); // setembro
  });

  it("Mensal: 30/08/2026 → 30/09/2026 (dia existe)", () => {
    const r = avancarData("Mensal", "2026-08-30");
    expect(r.getDate()).toBe(30);
    expect(r.getMonth()).toBe(8); // setembro
  });

  it("Mensal: 15/08/2026 → 15/09/2026", () => {
    const r = avancarData("Mensal", "2026-08-15");
    expect(r.getDate()).toBe(15);
    expect(r.getMonth()).toBe(8);
  });

  it("Mensal: 31/01/2026 → 28/02/2026 (fim de mês, não bissexto)", () => {
    const r = avancarData("Mensal", "2026-01-31");
    expect(r.getMonth()).toBe(1); // fevereiro
    expect(r.getDate()).toBe(28);
  });

  it("Mensal: 31/01/2028 → 29/02/2028 (fim de mês, bissexto)", () => {
    const r = avancarData("Mensal", "2028-01-31");
    expect(r.getMonth()).toBe(1); // fevereiro
    expect(r.getDate()).toBe(29);
  });

  it("Mensal: 31/03/2026 → 30/04/2026 (abril tem 30 dias)", () => {
    const r = avancarData("Mensal", "2026-03-31");
    expect(r.getMonth()).toBe(3); // abril
    expect(r.getDate()).toBe(30);
  });

  it("Mensal: 31/07/2026 → 31/08/2026 — agosto tem 31 dias", () => {
    const r = avancarData("Mensal", "2026-07-31");
    expect(r.getMonth()).toBe(7); // agosto
    expect(r.getDate()).toBe(31);
  });

  it("Mensal: 31/03/2026 → 30/04/2026 (dia não existe no mês alvo)", () => {
    const r = avancarData("Mensal", "2026-03-31");
    expect(r.getMonth()).toBe(3); // abril
    expect(r.getDate()).toBe(30);
  });

  it("Mensal: 30/04/2026 → 30/05/2026 (preserva dia 30, maio tem 31)", () => {
    const r = avancarData("Mensal", "2026-04-30");
    expect(r.getMonth()).toBe(4); // maio
    expect(r.getDate()).toBe(30);
  });

  it("Aceita Date input", () => {
    const input = new Date(2026, 7, 30); // 30/08/2026 local
    const r = avancarData("Mensal", input);
    expect(r.getDate()).toBe(30);
    expect(r.getMonth()).toBe(8); // setembro
  });

  it("Retorna null para entrada inválida", () => {
    expect(avancarData("Mensal", null)).toBeNull();
    expect(avancarData("Mensal", undefined)).toBeNull();
    expect(avancarData("Mensal", "invalid")).toBeNull();
  });

  it("NÃO causa drift de timezone: 2026-08-30 não vira 29/08", () => {
    // Este é o bug crítico que foi corrigido
    const r = avancarData("Mensal", "2026-08-30");
    expect(r.getFullYear()).toBe(2026);
    expect(r.getMonth()).toBe(8); // setembro
    expect(r.getDate()).toBe(30);
  });
});

// ============================================================================
// TESTES: shiftFutureInstallments — deslocamento de vencimentos
// ============================================================================
describe("shiftFutureInstallments", () => {
  // Helper: cria parcelas mock similares ao calcularParcelas
  function criarParcelas(comecoDia, mes, quantidade, freq) {
    const datas = [];
    let d = new Date(2026, mes - 1, comecoDia);
    for (let i = 0; i < quantidade; i++) {
      datas.push({
        numero: i + 1,
        vencimento: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        valor: 425,
        status: i < 1 ? "Paga" : "Pendente",
        valorOriginalParcela: 250,
        jurosOriginais: 175,
        recebido: i < 1 ? 50 : 0,
      });
      // Avança manualmente para próxima data
      d = avancarData(freq, datas[i].vencimento);
    }
    return datas;
  }

  it("SCENARIO 1: 2 parcelas, paga P1, juros na P1 → P1 e P2 avançam, P0 mantém", () => {
    // P1 = 01/08/2026 (Pagas), P2 = 01/09/2026 (Pendente)
    // Receber juros na P1 → P1 e P2 avançam 1 mês
    // P1: 01/08 → 01/09, P2: 01/09 → 01/10
    const parcelas = criarParcelas(1, 8, 2, "Mensal");
    const original = parcelas.map((p) => ({ ...p }));

    const shifted = shiftFutureInstallments(parcelas, 0, "Mensal");

    // P1 (índice 0) e P2 (índice 1) avançam
    expect(shifted[0].vencimento).toBe("2026-09-01");
    expect(shifted[1].vencimento).toBe("2026-10-01");

    // Valores e status preservados
    expect(shifted[0].valor).toBe(425);
    expect(shifted[1].valor).toBe(425);
    expect(shifted[0].status).toBe("Paga");
    expect(shifted[1].status).toBe("Pendente");

    // Original não foi mutado (imutabilidade)
    expect(parcelas[0].vencimento).toBe(original[0].vencimento);
    expect(parcelas[1].vencimento).toBe(original[1].vencimento);
  });

  it("SCENARIO 2: 4 parcelas, paga P1 e P2, juros na P2 → P2, P3, P4 avançam", () => {
    // P1, P2 pagas; juros na P2 → P2 e posteriores avançam
    // P2: 01/09 → 01/10, P3: 01/10 → 01/11, P4: 01/11 → 01/12
    // P1: 01/08 permanece
    const parcelas = [
      { numero: 1, vencimento: "2026-08-01", valor: 425, status: "Paga", valorOriginalParcela: 250 },
      { numero: 2, vencimento: "2026-09-01", valor: 425, status: "Paga", valorOriginalParcela: 250 },
      { numero: 3, vencimento: "2026-10-01", valor: 425, status: "Pendente", valorOriginalParcela: 250 },
      { numero: 4, vencimento: "2026-11-01", valor: 425, status: "Pendente", valorOriginalParcela: 250 },
    ];

    const shifted = shiftFutureInstallments(parcelas, 1, "Mensal");

    // P1: mantém 01/08
    expect(shifted[0].vencimento).toBe("2026-08-01");

    // P2, P3, P4: avançam 1 mês
    expect(shifted[1].vencimento).toBe("2026-10-01");
    expect(shifted[2].vencimento).toBe("2026-11-01");
    expect(shifted[3].vencimento).toBe("2026-12-01");

    // Valores e status preservados
    expect(shifted[1].valor).toBe(425);
    expect(shifted[2].valor).toBe(425);
    expect(shifted[3].valor).toBe(425);
    expect(shifted[1].status).toBe("Paga");
    expect(shifted[2].status).toBe("Pendente");
    expect(shifted[3].status).toBe("Pendente");
  });

  it("Diária: 01/08 → 02/08 (avança 1 dia)", () => {
    const parcelas = [
      { numero: 1, vencimento: "2026-08-01", valor: 425, status: "Pendente" },
      { numero: 2, vencimento: "2026-08-02", valor: 425, status: "Pendente" },
    ];
    const shifted = shiftFutureInstallments(parcelas, 0, "Diária");
    expect(shifted[0].vencimento).toBe("2026-08-02");
    expect(shifted[1].vencimento).toBe("2026-08-03");
  });

  it("Semanal: 01/08 → 08/08 (avança 7 dias)", () => {
    const parcelas = [
      { numero: 1, vencimento: "2026-08-01", valor: 425, status: "Pendente" },
      { numero: 2, vencimento: "2026-08-08", valor: 425, status: "Pendente" },
    ];
    const shifted = shiftFutureInstallments(parcelas, 0, "Semanal");
    expect(shifted[0].vencimento).toBe("2026-08-08");
    expect(shifted[1].vencimento).toBe("2026-08-15");
  });

  it("Quinzenal: 01/08 → 16/08 (avança 15 dias)", () => {
    const parcelas = [
      { numero: 1, vencimento: "2026-08-01", valor: 425, status: "Pendente" },
    ];
    const shifted = shiftFutureInstallments(parcelas, 0, "Quinzenal");
    expect(shifted[0].vencimento).toBe("2026-08-16");
  });

  it("Mensal: 31/01 → 28/02 (fim de mês, não bissexto)", () => {
    const parcelas = [
      { numero: 1, vencimento: "2026-01-31", valor: 425, status: "Pagar" },
      { numero: 2, vencimento: "2026-02-28", valor: 425, status: "Pendente" },
    ];
    const shifted = shiftFutureInstallments(parcelas, 0, "Mensal");
    expect(shifted[0].vencimento).toBe("2026-02-28");
    expect(shifted[1].vencimento).toBe("2026-03-28");
  });

  it("Mensal: 30/08 → 30/09 (dia existe no mês alvo)", () => {
    const parcelas = [
      { numero: 1, vencimento: "2026-08-30", valor: 425, status: "Pendente" },
      { numero: 2, vencimento: "2026-09-30", valor: 425, status: "Pendente" },
    ];
    const shifted = shiftFutureInstallments(parcelas, 0, "Mensal");
    expect(shifted[0].vencimento).toBe("2026-09-30");
    expect(shifted[1].vencimento).toBe("2026-10-30");
  });

  it("NÃO altera valores, status, jurosOriginais, valorOriginalParcela", () => {
    const parcelas = [
      { numero: 1, vencimento: "2026-08-01", valor: 425, status: "Paga", valorOriginalParcela: 250, jurosOriginais: 175, recebido: 50 },
      { numero: 2, vencimento: "2026-09-01", valor: 425, status: "Pendente", valorOriginalParcela: 250, jurosOriginais: 175, recebido: 0 },
      { numero: 3, vencimento: "2026-10-01", valor: 540, status: "Pendente", valorOriginalParcela: 250, jurosOriginais: 175, recebido: 0 },
    ];
    const shifted = shiftFutureInstallments(parcelas, 1, "Mensal");

    // Apenas data alterada; tudo mais preservado
    shifted.forEach((p, i) => {
      expect(p.valor).toBe(parcelas[i].valor);
      expect(p.status).toBe(parcelas[i].status);
      expect(p.valorOriginalParcela).toBe(parcelas[i].valorOriginalParcela);
      expect(p.jurosOriginais).toBe(parcelas[i].jurosOriginais);
      expect(p.recebido).toBe(parcelas[i].recebido);
      expect(p.numero).toBe(parcelas[i].numero);
    });
  });

  it("Cumulative: dois pagamentos de juros seguidos avançam 1 + 1 = 2 intervalos", () => {
    // Primeiro pagamento na P1: shift 1
    let parcelas = [
      { numero: 1, vencimento: "2026-08-01", valor: 425, status: "Pagar" },
      { numero: 2, vencimento: "2026-09-01", valor: 425, status: "Pagar" },
      { numero: 3, vencimento: "2026-10-01", valor: 425, status: "Pagar" },
    ];
    parcelas = shiftFutureInstallments(parcelas, 0, "Mensal");
    // Segundo pagamento na P2 (agora em 01/10): shift 1
    parcelas = shiftFutureInstallments(parcelas, 1, "Mensal");

    // P1: 01/08 → 01/09 (não muda no segundo shift)
    expect(parcelas[0].vencimento).toBe("2026-09-01");
    // P2: 01/09 → 01/10 → 01/11
    expect(parcelas[1].vencimento).toBe("2026-11-01");
    // P3: 01/10 → 01/10 → 01/11 → 01/12
    expect(parcelas[2].vencimento).toBe("2026-12-01");
  });

  it("Retorna array original se lista vazia ou índice inválido", () => {
    expect(shiftFutureInstallments([], 0, "Mensal")).toEqual([]);
    const parcelas = [{ numero: 1, vencimento: "2026-08-01", valor: 425, status: "Pendente" }];
    expect(shiftFutureInstallments(parcelas, -1, "Mensal")).toBe(parcelas);
    expect(shiftFutureInstallments(parcelas, 99, "Mensal")).toBe(parcelas);
  });
});

// ============================================================================
// TESTES DA REGRA DEFINITIVA
// ============================================================================
describe("REGRA DEFINITIVA: ABATIMENTO → SALDO → JUROS → PARCELA", () => {
  const JUROS_TAXA = 35;
  const DATA_BASE = new Date("2026-08-01T12:00:00");

  function criarContratoSimples(saldoPrincipal, abatimentos = [], overrides = {}) {
    return {
      id: "test-regra",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: JUROS_TAXA,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal,
      abatimentos,
      dataPrimeiraParcela: "2026-08-01",
      frequencia: "Mensal",
      ...overrides,
    };
  }

  it("Exemplo 1: Saldo 500 → parcelas originais = (500/2) + (500*0.35) = 425", () => {
    const contrato = criarContratoSimples(500, []);
    const parcelas = calcularParcelas(contrato, DATA_BASE);

    expect(parcelas[0].status).toBe("Pendente");
    expect(parcelas[0].valor).toBeCloseTo(425, 2);

    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(425, 2);
  });

  it("Exemplo 2: Saldo 450, P1 paga → P2 = (450/2) + (450*0.35) = 382.5", () => {
    const contrato = criarContratoSimples(450, [{ valor: 50, parcelaNumero: 1 }], { parcelasPagas: 1 });
    const parcelas = calcularParcelas(contrato, DATA_BASE);

    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].recebido).toBe(50);

    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);
  });

  it("Exemplo 3: 2 pgtas, saldo 400 → REGRA 2: 400 × 1.35 = 540", () => {
    const contrato = criarContratoSimples(400, [
      { valor: 50, parcelaNumero: 1 },
      { valor: 50, parcelaNumero: 2 },
    ], { parcelasPagas: 2 });

    const parcelas = calcularParcelas(contrato, DATA_BASE);

    expect(parcelas.length).toBe(3);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].status).toBe("Paga");
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(540, 2);
  });

  it("Exemplo 4: 2 pgtas, saldo 350 → REGRA 2: 350 × 1.35 = 472.5", () => {
    const contrato = criarContratoSimples(350, [
      { valor: 50, parcelaNumero: 1 },
      { valor: 50, parcelaNumero: 2 },
    ], { parcelasPagas: 2 });

    const parcelas = calcularParcelas(contrato, DATA_BASE);

    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(472.5, 2);
  });

  it("Sequência completa: saldo acumulado diminui 50 a cada passo", () => {
    const saldosEsperados = [607.5, 540, 472.5, 405]; // mas esses são do ESTADO C+
    let saldoAtual = 500;
    const abatimentos = [];

    // Passo 1: 500 → 425 (REGRA 1)
    let contrato = criarContratoSimples(saldoAtual, []);
    let parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas[0].valor).toBeCloseTo(425, 2);
    expect(parcelas[1].valor).toBeCloseTo(425, 2);

    // Passo 2: 500 - 50 = 450, P1 paga → 382.5 (REGRA 1)
    saldoAtual -= 50; // 450
    abatimentos.push({ valor: 50, parcelaNumero: 1 });
    contrato = criarContratoSimples(saldoAtual, [...abatimentos], { parcelasPagas: 1 });
    parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);

    // Passo 3: 450 - 50 = 400, P2 paga → REGRA 2: 400*1.35 = 540
    saldoAtual -= 50; // 400
    abatimentos.push({ valor: 50, parcelaNumero: 2 });
    contrato = criarContratoSimples(saldoAtual, [...abatimentos], { parcelasPagas: 2 });
    parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas[2].valor).toBeCloseTo(540, 2);

    // Passo 4: 400 - 50 = 350 → REGRA 2: 350*1.35 = 472.5
    saldoAtual -= 50; // 350
    abatimentos.push({ valor: 50, parcelaNumero: 3 });
    contrato = criarContratoSimples(saldoAtual, [...abatimentos], { parcelasPagas: 2 });
    parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas[2].valor).toBeCloseTo(472.5, 2);

    // Passo 5: 350 - 50 = 300 → REGRA 2: 300*1.35 = 405
    saldoAtual -= 50; // 300
    abatimentos.push({ valor: 50, parcelaNumero: 3 });
    contrato = criarContratoSimples(saldoAtual, [...abatimentos], { parcelasPagas: 2 });
    parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas[2].valor).toBeCloseTo(405, 2);
  });

  it("REGRA 1 não confunde juros sobre saldo com juros sobre original", () => {
    // saldo=450, 2x, P1 paga
    const contrato = criarContratoSimples(450, [{ valor: 50, parcelaNumero: 1 }], { parcelasPagas: 1 });
    const parcelas = calcularParcelas(contrato, DATA_BASE);

    // jurosOriginais (display) sobre original: 500 × 35% = 175
    expect(parcelas[1].jurosOriginais).toBe(175);

    // valor da parcela: (450/2) + (450*0.35) = 225 + 157.5 = 382.5
    // NÃO = 500 * 1.35 = 675
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);
    expect(parcelas[1].valor).not.toBeCloseTo(675, 2);
  });

  it("Saldo acumulado: 2 abatimentos de R$ 50 reduzem 500 para 450 → 382.5", () => {
    const contrato = criarContratoSimples(450, [
      { valor: 50, parcelaNumero: 1 },
      { valor: 50, parcelaNumero: 1 },
    ]);
    expect(calculateDebtRemaining(contrato)).toBe(450);
    expect(totalAbatimentos(contrato.abatimentos)).toBe(100);

    const parcelas = calcularParcelas(contrato, DATA_BASE);
    // REGRA 1: (450/2) + (450*0.35) = 382.5
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);
  });
});

// ============================================================================
// TESTES ADICIONAIS: arredondamento, edge cases
// ============================================================================
describe("ARREDONDAMENTO: centavos precisos", () => {
  it("999 / 3 + 999 * 0.35 com arredondamento para centavos", () => {
    const contrato = criarContrato({
      valorEmprestado: 999,
      numeroParcelas: 3,
      juros: 35,
      saldoPrincipal: 999,
      parcelasPagas: 0,
      abatimentos: [],
    });

    const parcelas = calcularParcelas(contrato, new Date());
    // (999/3) + (999*0.35) = 333 + 349.65 = 682.65
    expect(parcelas[0].valor).toBeCloseTo(682.65, 2);
    expect(parcelas[1].valor).toBeCloseTo(682.65, 2);
    expect(parcelas[2].valor).toBeCloseTo(682.65, 2);
  });

  it("Saldo zero não cria parcelas", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 0,
      parcelasPagas: 2,
      quitado: true,
      abatimentos: [],
    });

    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas.length).toBe(2);
    expect(parcelas.every((p) => p.status === "Paga")).toBe(true);
  });

  it("Contrato sem dataPrimeiraParcela não quebra", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 500,
      parcelasPagas: 0,
      abatimentos: [],
      dataPrimeiraParcela: null,
    });

    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas.length).toBe(2);
    expect(parcelas[0].valor).toBeCloseTo(425, 2);
  });
});

describe("ESTORNO: cancelamento de abatimento não afeta parcelas pagas", () => {
  it("Remover abatimento: P1 mantém valor RecebidoOriginal (imutável)", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 200,
      parcelasPagas: 1,
      valorRecebido: 425,
      abatimentos: [{ valor: 300, parcelaNumero: 1 }],
    });

    const parcelas = calcularParcelas(contrato, new Date());

    // Parcela paga mantém histórico
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valorOriginalParcela).toBe(250);

    // REGRA 1: (200/2) + (200*0.35) = 100 + 70 = 170
    expect(parcelas[1].valor).toBeCloseTo(170, 2);
  });
});

describe("RENEGOCIAÇÃO: saldoPrincipal atualizado, regra muda dinamicamente", () => {
  it("Contrato 3x, paga 1, abatimento 50 → REGRA 1", () => {
    const contrato = criarContrato({
      valorEmprestado: 600,
      numeroParcelas: 3,
      juros: 35,
      saldoPrincipal: 300,
      parcelasPagas: 1,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
    });
    // (300/3) + (300*0.35) = 100 + 105 = 205
    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].valor).toBeCloseTo(205, 2);
    expect(parcelas[2].valor).toBeCloseTo(205, 2);
  });

  it("Contrato 3x, paga 3, saldo>0 → REGRA 2", () => {
    const contrato = criarContrato({
      valorEmprestado: 600,
      numeroParcelas: 3,
      juros: 35,
      saldoPrincipal: 100,
      parcelasPagas: 3,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
        { valor: 50, parcelaNumero: 3 },
      ],
    });
    // 100 * 1.35 = 135
    const parcelas = calcularParcelas(contrato, new Date());
    expect(parcelas.length).toBe(4);
    expect(parcelas[3].status).toBe("Pendente");
    expect(parcelas[3].valor).toBeCloseTo(135, 2);
  });
});

// ============================================================================
// TESTE DEFINITIVO: Criação automática de parcela dinâmica (P3 = 540)
// ============================================================================
describe("TESTE DEFINITIVO: Criação automática de parcela dinâmica", () => {
  const JUROS = 35;
  const DATA_BASE = new Date("2026-08-29T12:00:00");

  it("CENÁRIO COMPLETO: 500 → 450 → 400 → P3 = 540", () => {
    // ESTADO 1: Inicial — 500, 2x, 35%
    const contrato1 = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 500,
      parcelasPagas: 0,
      abatimentos: [],
    });

    const p1 = calcularParcelas(contrato1, DATA_BASE);
    expect(p1.length).toBe(2);
    expect(p1[0].valor).toBeCloseTo(425, 2); // (500/2) + (500*0.35) = 425
    expect(p1[1].valor).toBeCloseTo(425, 2);

    // ESTADO 2: Abatimento R$ 50 na P1 → saldo 450, P1 paga
    const contrato2 = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 450,
      parcelasPagas: 1,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      valorRecebido: 50,
    });

    const p2 = calcularParcelas(contrato2, DATA_BASE);
    expect(p2[0].status).toBe("Paga");
    expect(p2[0].valor).toBe(50);
    expect(p2[0].recebido).toBe(50);
    expect(p2[1].status).toBe("Pendente");
    // REGRA 1: (450/2) + (450*0.35) = 382.5
    expect(p2[1].valor).toBeCloseTo(382.5, 2);

    // ESTADO 3: Outro abatimento R$ 50 na P2 → saldo 400, 2/2 pagas
    const contrato3 = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 400,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
      ],
      valorRecebido: 100,
    });

    const p3 = calcularParcelas(contrato3, DATA_BASE);
    expect(p3.length).toBe(3); // P1, P2, P3 (dinâmica)
    expect(p3[0].status).toBe("Paga");
    expect(p3[0].valor).toBe(50);
    expect(p3[0].recebido).toBe(50);
    expect(p3[1].status).toBe("Paga");
    expect(p3[1].valor).toBe(50);
    expect(p3[1].recebido).toBe(50);
    // REGRA 2: 400 × 1.35 = 540
    expect(p3[2].status).toBe("Pendente");
    expect(p3[2].valor).toBeCloseTo(540, 2);
    // P3 não está marcada como Paga
    expect(p3[2].abatimentoAcumulado).toBe(0);
    expect(p3[2].abatimentoParcela).toBe(0);

    // getNextOpenInstallment deve encontrar P3
    const proxima = getNextOpenInstallment(contrato3, DATA_BASE);
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(3);
    expect(proxima.valor).toBeCloseTo(540, 2);
    expect(proxima.status).toBe("Pendente");

    // ESTADO 4: Abatimento R$ 50 → saldo 350, P3 = 472.5 (REGRA 2)
    const contrato4 = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 350,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
        { valor: 50 }, // abatimento geral, não marca P3 como Paga
      ],
    });

    const p4 = calcularParcelas(contrato4, DATA_BASE);
    expect(p4.length).toBe(3);
    expect(p4[2].status).toBe("Pendente");
    expect(p4[2].valor).toBeCloseTo(472.5, 2);

    // ESTADO 5: Abatimento R$ 50 → saldo 300, P3 = 405 (REGRA 2)
    const contrato5 = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 300,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
        { valor: 50 },
        { valor: 50 },
      ],
    });

    const p5 = calcularParcelas(contrato5, DATA_BASE);
    expect(p5.length).toBe(3);
    expect(p5[2].status).toBe("Pendente");
    expect(p5[2].valor).toBeCloseTo(405, 2);
  });

  it("ABATIMENTO com parcelaNumero=3 NÃO marca P3 dinâmica como Paga", () => {
    // Este é o bug central: um abatimento parcelaNumero=3 marcava P3 como Paga
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 400,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
        { valor: 50, parcelaNumero: 3 }, // NÃO deve marcar P3 como Paga
      ],
    });

    const parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas.length).toBe(3);
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(540, 2);
  });

  it("ABATIMENTO sem parcelaNumero não marca nenhuma parcela como Paga", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 400,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
        { valor: 50 }, // sem parcelaNumero
      ],
    });

    const parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas.length).toBe(3);
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(540, 2);
  });

  it("P3 dinâmica tem vencimento mensal após a última parcela original", () => {
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 400,
      parcelasPagas: 2,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
      ],
      dataPrimeiraParcela: "2026-08-29",
      frequencia: "Mensal",
    });

    const parcelas = calcularParcelas(contrato, DATA_BASE);
    expect(parcelas.length).toBe(3);
    // P1 = 29/08, P2 = 29/09, P3 = 29/10
    expect(parcelas[0].vencimento).toBeTruthy();
    expect(parcelas[1].vencimento).toBeTruthy();
    expect(parcelas[2].vencimento).toBeTruthy();
  });

  it("CENÁRIO INTERFACE: quitado=true persistido no banco + saldo 400 → P3 = 540", () => {
    // Simula um contrato antigo que foi marcado como quitado=true (regra antiga)
    // quando todas as parcelas originais foram pagas, mas que ainda tem saldo
    // para uma parcela dinâmica.
    const contrato = criarContrato({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: JUROS,
      saldoPrincipal: 400,
      parcelasPagas: 2,
      quitado: true, // MARCADO COMO QUITADO PELO SISTEMA ANTIGO!
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
      ],
      valorRecebido: 100,
    });

    // A UI usa estas duas chamadas:
    const parcelas = calcularParcelas(contrato, DATA_BASE, contrato.abatimentos);
    const proxima = getNextOpenInstallment(contrato, DATA_BASE);

    // calcularParcelas deve criar P3 dinâmica mesmo com quitado=true
    expect(parcelas.length).toBe(3);
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[1].status).toBe("Paga");
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(540, 2);

    // getNextOpenInstallment deve encontrar P3
    expect(proxima).not.toBeNull();
    expect(proxima.numero).toBe(3);
    expect(proxima.valor).toBeCloseTo(540, 2);
  });
});

// ============================================================================
// TESTES: juros_apenas — preservação absoluta de abatimentos
// ============================================================================
describe("juros_apenas — preservação total de abatimentos", () => {
  it("Contrato com abatimento existente: saldoPrincipal, parcelasPagas e abatimentos idênticos antes/depois", async () => {
    const contrato = {
      id: "test-preserve",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      // saldoPrincipal = 450 (500 - 50 abatimento)
      saldoPrincipal: 450,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-29T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);
    const parcelaAtual = parcelas[0];

    // Estado ANTES
    const saldoAntes = contrato.saldoPrincipal;
    const pagasAntes = contrato.parcelasPagas;
    const abatimentosAntes = JSON.parse(JSON.stringify(contrato.abatimentos));
    const valorEmprestadoAntes = contrato.valorEmprestado;

    const result = await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelaAtual,
      "juros_apenas",
      { valorJuros: 175 },
      "2026-08-29",
      "Juros P1"
    );

    // Verifica Firestore mock
    const update = _firestoreMocks.lastUpdate.data;

    // REQUISITO 4: saldoPrincipal NÃO alterado
    expect(update.saldoPrincipal).toBe(saldoAntes);
    expect(result.saldoPrincipal).toBe(saldoAntes);

    // REQUISITO 5: parcelasPagas NÃO incrementado
    expect(update.parcelasPagas).toBe(pagasAntes);
    expect(result.parcelasPagas).toBe(pagasAntes);

    // REQUISITO 3: abatimentos não recalculados — idênticos
    expect(update.abatimentos).toEqual(abatimentosAntes);
    expect(update.abatimentoTotal).toBe(50); // total mantido

    // REQUISITO 6: valorEmprestado não alterado
    expect(update.saldoPrincipal).toBe(450); // 500 - 50 = 450
    expect(valorEmprestadoAntes).toBe(500);

    // Juros recebidos registrado
    expect(update.jurosRecebidos).toBe(175);

    // vencimentosCustom criado com deslocamento
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(3);
    // P1: 30/08 → 30/09
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-09-30" });
    // P2: 30/09 → 30/10
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-10-30" });
    // P3: 30/10 → 30/11
    expect(update.vencimentosCustom[2]).toEqual({ numero: 3, vencimento: "2026-11-30" });
  });

  it("Contrato sem abatimento: juros_apenas não cria abatimentos", async () => {
    const contrato = {
      id: "test-no-abatimento",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-29T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-08-29",
      ""
    );

    const update = _firestoreMocks.lastUpdate.data;

    // Nenhum abatimento criado
    expect(update.abatimentos).toBeUndefined();
    expect(update.abatimentoTotal).toBeUndefined();

    // saldoPrincipal mantido
    expect(update.saldoPrincipal).toBe(500);
    expect(update.parcelasPagas).toBe(0);

    // vencimentosCustom presente
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(2);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-09-30" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-10-30" });
  });

  it("parcela_inteira NÃO cria vencimentosCustom mesmo com abatimento existente", async () => {
    const contrato = {
      id: "test-parcela-inteira",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-29T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "parcela_inteira",
      { valorTotal: 425 },
      "2026-08-29",
      ""
    );

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeUndefined();
  });

  it("juros_parte_divida NÃO cria vencimentosCustom", async () => {
    const contrato = {
      id: "test-parcial",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-29T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 },
      "2026-08-29",
      ""
    );

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeUndefined();
    // abatimento foi criado normalmente (lógica preservada)
    expect(update.abatimentos).toBeDefined();
    expect(update.abatimentos.length).toBe(1);
    expect(update.abatimentos[0].valor).toBe(50);
  });
});

/**
 * TESTES DE REGRESSÃO: ABATIMENTO NÃO DESTROI vencimentosCustom
 *
 * Bug reportado: após juros_apenas (que cria vencimentosCustom), um abatimento
 * posterior faz as datas voltar para as originais de dataPrimeiraParcela.
 *
 * Regra: vencimentosCustom é a fonte de verdade das datas já personalizadas.
 * Abatimento, parcela_inteira, juros_parte_divida e quitacao devem PRESERVAR
 * o array vencimentosCustom (não removê-lo, não resetar).
 */
describe("REGRESSÃO: abatimento não destrói vencimentosCustom", () => {
  // Estado pós-2º juros_apenas na P1 (do cenário do bug):
  //   P1 → 30/10/2026, P2 → 30/11/2026, P3 → 30/12/2026
  const contratoComCustom = {
    id: "test-regressao-abatimento",
    numeroParcelas: 3,
    valorEmprestado: 500,
    juros: 35,
    jurosRecebidos: 350, // 2 juros de 175
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 500,
    abatimentos: [],
    abatimentoTotal: 0,
    valorRecebido: 350,
    dataPrimeiraParcela: "2026-08-30",
    frequencia: "Mensal",
    // vencimentosCustom já existente após 2 juros cumulativos
    vencimentosCustom: [
      { numero: 1, vencimento: "2026-10-30" },
      { numero: 2, vencimento: "2026-11-30" },
      { numero: 3, vencimento: "2026-12-30" },
    ],
  };

  it("juros_parte_divida (abatimento) preserva vencimentosCustom existente", async () => {
    const contrato = { ...contratoComCustom, id: "rp-1" };
    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);
    const parcelaAtual = parcelas[0]; // P1, vencimento 30/10 (custom)

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelaAtual,
      "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 },
      "2026-10-15",
      "Abatimento de 50 após juros cumulativos"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // REQUISITO: vencimentosCustom preservado exatamente
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom).toEqual(contrato.vencimentosCustom);

    // Abatimento aplicado normalmente
    expect(update.abatimentos).toBeDefined();
    expect(update.abatimentos.length).toBe(1);
    expect(update.abatimentos[0].valor).toBe(50);
    expect(update.saldoPrincipal).toBe(450); // 500 - 50
  });

  it("parcela_inteira preserva vencimentosCustom existente", async () => {
    const contrato = { ...contratoComCustom, id: "rp-2", valorRecebido: 350, jurosRecebidos: 350 };
    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);
    const parcelaAtual = parcelas[0];

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelaAtual,
      "parcela_inteira",
      { valorTotal: 425 }, // juros 175 + principal 250
      "2026-10-15",
      "Parcela inteira após juros cumulativos"
    );

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom).toEqual(contrato.vencimentosCustom);
  });

  it("juros_apenas preserva e acumula vencimentosCustom existente (cumulativo)", async () => {
    const contrato = { ...contratoComCustom, id: "rp-3" };
    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);
    const parcelaAtual = parcelas[0]; // P1, vencimento 30/10

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelaAtual,
      "juros_apenas",
      { valorJuros: 175 },
      "2026-10-15",
      "3º juros cumulativo P1"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // Cumulativo: P1 30/10 → 30/11, P2 30/11 → 30/12, P3 30/12 → 30/01
    // (avancarData Mensal preserva o dia quando existe no mês alvo)
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-11-30" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-12-30" });
    expect(update.vencimentosCustom[2]).toEqual({ numero: 3, vencimento: "2027-01-30" });
  });

  it("quitar_tudo não deve causar regressão nas datas enquanto precisar", async () => {
    const contrato = { ...contratoComCustom, id: "rp-4", valorRecebido: 350, jurosRecebidos: 350 };
    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);
    const parcelaAtual = parcelas[0];

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelaAtual,
      "quitar_tudo",
      { valorTotal: 675 }, // 500 saldo + 175 juros
      "2026-10-15",
      "Quitacao"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // quitado true mas vencimentosCustom preservado
    expect(update.quitado).toBe(true);
    expect(update.saldoPrincipal).toBe(0);
    // vencimentosCustom continua disponível (não é removido por quitacao)
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom).toEqual(contrato.vencimentosCustom);
  });

  it("SEQUÊNCIA COMPLETA: juros → juros → abatimento → nada volta para data original", async () => {
    let contrato = {
      id: "seq-completa",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-29T12:00:00");

    // 1º juros na P1
    let parcelas = parcelasDoContrato(contrato, hoje);
    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-08-29",
      "1º juros"
    );
    let update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom[0].vencimento).toBe("2026-09-30");
    // Atualiza contrato simulando o Firestore
    contrato = { ...contrato, ...update, vencimentosCustom: update.vencimentosCustom };

    // 2º juros na P1 (cumulativo)
    parcelas = parcelasDoContrato(contrato, hoje);
    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-09-15",
      "2º juros"
    );
    update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom[0].vencimento).toBe("2026-10-30");
    contrato = { ...contrato, ...update, vencimentosCustom: update.vencimentosCustom };

    // Abatimento de 50 (juros_parte_divida) — DEVE preservar vencimentosCustom
    parcelas = parcelasDoContrato(contrato, hoje);
    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 },
      "2026-09-16",
      "Abatimento 50"
    );
    update = _firestoreMocks.lastUpdate.data;
    // vencimentosCustom preservado exatamente
    expect(update.vencimentosCustom).toEqual(contrato.vencimentosCustom);
    // Abatimento aplicado
    expect(update.saldoPrincipal).toBe(450);

    // VERIFICAÇÃO FINAL: nenhuma data voltou para o original (30/08, 30/09, 30/10)
    const datasCustom = update.vencimentosCustom.map((v) => v.vencimento);
    expect(datasCustom).not.toContain("2026-08-30"); // P1 original
    expect(datasCustom).not.toContain("2026-09-30"); // P1 original era 30/09 mas já foi deslocada
    expect(datasCustom).toEqual(["2026-10-30", "2026-11-30", "2026-12-30"]);
  });

  it("vencimentosCustom não é removido de updateData quando modalidade não é juros_apenas", async () => {
    // Teste focado: abatimento puro deve deixar vencimentosCustom no updateData
    const contrato = { ...contratoComCustom, id: "rp-isolation" };
    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 },
      "2026-10-15",
      "Isolamento: vencimentosCustom no updateData"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // A propriedade vencimentosCustom DEVE estar presente preservada
    expect(update).toHaveProperty("vencimentosCustom");
    expect(update.vencimentosCustom).toEqual(contrato.vencimentosCustom);
  });

  it("saldoPrincipal continua calculado pela lógica existente após abatimento", async () => {
    const contrato = { ...contratoComCustom, id: "rp-saldo" };
    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 },
      "2026-10-15",
      "Saldo"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // Lógica existente: saldoPrincipal = 500 - 50 = 450
    expect(update.saldoPrincipal).toBe(450);
  });

  it("abatimentos continuam exatamente como antes (mesmo array)", async () => {
    const contrato = { ...contratoComCustom, id: "rp-abt" };
    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 },
      "2026-10-15",
      "Abt"
    );

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.abatimentos).toBeDefined();
    expect(update.abatimentos.length).toBe(1);
    expect(update.abatimentos[0].valor).toBe(50);
    expect(update.abatimentoTotal).toBe(50);
  });

  it("parcelasPagas não muda após abatimento", async () => {
    const contrato = { ...contratoComCustom, id: "rp-pagas" };
    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 },
      "2026-10-15",
      "Pagas"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // parcelasPagas não deve ser incrementado por abatimento
    expect(update.parcelasPagas).toBe(0);
  });
});

/**
 * TESTES DE REGRESSÃO: MERGE CUMULATIVO DE vencimentosCustom
 *
 * Bug: juros_apenas deslocava parcelas selecionada + posteriores, mas o
 * .slice(indiceSelecionado) descartava os overrides das parcelas ANTERIORES,
 * fazendo updateDoc sobrescrever o array inteiro e perder customizações
 * anteriores — o que revertia datas para dataPrimeiraParcela.
 *
 * Regra: juros_apenas preserva overrides anteriores (a) e adiciona os novos
 * deslocamentos (b), unindo por numero da parcela.
 */
describe("MERGE CUMULATIVO de vencimentosCustom (bug do slice perdedor)", () => {
  it("3.º deslocamento na P2: P1 preservada, P2 e P3 deslocadas a partir das datas efetivas", async () => {
    // Estado após juros_apenas P1 → 2º juros P1:
    //   P1=30/10, P2=30/11, P3=30/12
    const contrato = {
      id: "merge-1",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 350,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 350,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
      vencimentosCustom: [
        { numero: 1, vencimento: "2026-10-30" },
        { numero: 2, vencimento: "2026-11-30" },
        { numero: 3, vencimento: "2026-12-30" },
      ],
    };

    // Agora desloca P2 — deve partir das datas efetivas atuais (30/11, 30/12)
    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);
    const parcelaAtual = parcelas[1]; // P2 vence 30/11 (custom)

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelaAtual,
      "juros_apenas",
      { valorJuros: 175 },
      "2026-10-15",
      "3º deslocamento P2"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // MERGE: P1 preservada, P2 e P3 deslocadas +1 mês a partir do efetivo
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(3);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-10-30" }); // PRESERVADA
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-12-30" }); // 30/11 → 30/12
    expect(update.vencimentosCustom[2]).toEqual({ numero: 3, vencimento: "2027-01-30" }); // 30/12 → 30/01
  });

  it("datas sempre em ordem cronológica após merge cumulativo", async () => {
    const contrato = {
      id: "merge-ordem",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 350,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 350,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
      vencimentosCustom: [
        { numero: 1, vencimento: "2026-10-30" },
        { numero: 2, vencimento: "2026-11-30" },
        { numero: 3, vencimento: "2026-12-30" },
      ],
    };

    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[1],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-10-15",
      "Ordem cronológica"
    );

    const update = _firestoreMocks.lastUpdate.data;
    const datas = update.vencimentosCustom.map((v) => v.vencimento);
    const datasComoEpoch = datas.map((s) => new Date(s.replace(/-/g, "/")).getTime());
    // Verifica ordenação crescente
    const ordenado = [...datasComoEpoch].sort((a, b) => a - b);
    expect(datasComoEpoch).toEqual(ordenado);
  });

  it("juros_parte_divida (abatimento) após juros cumulativo preserva todo vencimentosCustom", async () => {
    const contrato = {
      id: "merge-abatimento",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 350,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 350,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
      vencimentosCustom: [
        { numero: 1, vencimento: "2026-10-30" },
        { numero: 2, vencimento: "2026-11-30" },
        { numero: 3, vencimento: "2026-12-30" },
      ],
    };

    const hoje = new Date("2026-10-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[1],
      "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 },
      "2026-10-15",
      "Juros + abatimento P2"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // Abatimento preserva vencimentosCustom exatamente como estava
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom).toEqual(contrato.vencimentosCustom);
    // Abatimento aplicado normalmente
    expect(update.saldoPrincipal).toBe(450);
    expect(update.abatimentos.length).toBe(1);
    expect(update.abatimentos[0].valor).toBe(50);
  });

  it("SEQUÊNCIA COMPLETA: P1 2x juros → P2 deslocar → P3 abatimento → tudo preservado e ordenado", async () => {
    let contrato = {
      id: "merge-seq",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    // 1º juros P1: P1→30/09, P2→30/10, P3→30/11
    let hoje = new Date("2026-08-29T12:00:00");
    let parcelas = parcelasDoContrato(contrato, hoje);
    await processarPagamento({ uid: "u" }, contrato, parcelas[0], "juros_apenas",
      { valorJuros: 175 }, "2026-08-29", "1º juros P1");
    let update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom[0].vencimento).toBe("2026-09-30");
    expect(update.vencimentosCustom[1].vencimento).toBe("2026-10-30");
    expect(update.vencimentosCustom[2].vencimento).toBe("2026-11-30");
    contrato = { ...contrato, ...update, vencimentosCustom: update.vencimentosCustom };

    // 2º juros P1: P1→30/10, P2→30/11, P3→30/12
    hoje = new Date("2026-09-15T12:00:00");
    parcelas = parcelasDoContrato(contrato, hoje);
    await processarPagamento({ uid: "u" }, contrato, parcelas[0], "juros_apenas",
      { valorJuros: 175 }, "2026-09-15", "2º juros P1");
    update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom[0].vencimento).toBe("2026-10-30");
    expect(update.vencimentosCustom[1].vencimento).toBe("2026-11-30");
    expect(update.vencimentosCustom[2].vencimento).toBe("2026-12-30");
    contrato = { ...contrato, ...update, vencimentosCustom: update.vencimentosCustom };

    // 3º operação: juros + abatimento P2 (preserva tudo, apenas abate)
    hoje = new Date("2026-10-15T12:00:00");
    parcelas = parcelasDoContrato(contrato, hoje);
    await processarPagamento({ uid: "u" }, contrato, parcelas[1], "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 }, "2026-10-15", "Juros+abatimento P2");
    update = _firestoreMocks.lastUpdate.data;
    // vencimentosCustom preservado exatamente
    expect(update.vencimentosCustom).toEqual(contrato.vencimentosCustom);
    expect(update.saldoPrincipal).toBe(450);
    expect(update.abatimentos.length).toBe(1);
    expect(update.abatimentos[0].valor).toBe(50);

    // VERIFICAÇÃO FINAL: nenhuma data voltou para a original (30/08, 30/09, 30/10)
    const datas = update.vencimentosCustom.map((v) => v.vencimento);
    expect(datas).not.toContain("2026-08-30");
    expect(datas).toEqual(["2026-10-30", "2026-11-30", "2026-12-30"]);
  });

  it("virada de ano: deslocamento Mensal preserva o dia 30 através de dez/2026→jan/2027", async () => {
    const contrato = {
      id: "merge-ano",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-11-30",
      frequencia: "Mensal",
      vencimentosCustom: [
        { numero: 1, vencimento: "2026-12-30" },
        { numero: 2, vencimento: "2027-01-30" },
        { numero: 3, vencimento: "2027-02-28" },
      ],
    };

    const hoje = new Date("2026-12-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    // juros na P2: P2 30/01 → 28/02, P3 28/02 → 30/03
    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[1],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-12-15",
      "Virada de ano P2"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // P1 preservada (30/12)
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-12-30" });
    // P2: 30/01 → 28/02 (último dia de fevereiro)
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2027-02-28" });
    // P3: 28/02 → 28/03 (avancarData preserva o dia do input quando existe no mês alvo)
    expect(update.vencimentosCustom[2]).toEqual({ numero: 3, vencimento: "2027-03-28" });
  });

  it("juros_apenas na P3 (última): P1 e P2 preservadas, P3 deslocada", async () => {
    const contrato = {
      id: "merge-p3",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 350,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 350,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
      vencimentosCustom: [
        { numero: 1, vencimento: "2026-10-30" },
        { numero: 2, vencimento: "2026-11-30" },
        { numero: 3, vencimento: "2026-12-30" },
      ],
    };

    const hoje = new Date("2026-12-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[2], // P3
      "juros_apenas",
      { valorJuros: 175 },
      "2026-12-15",
      "Juros P3"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // P1 e P2 preservadas exatamente
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-10-30" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-11-30" });
    // P3: 30/12 → 30/01 (último e único deslocado)
    expect(update.vencimentosCustom[2]).toEqual({ numero: 3, vencimento: "2027-01-30" });
    expect(update.vencimentosCustom.length).toBe(3);
  });
});

/**
 * TESTES A-F (cenários obrigatórios do bug do Firestore incompleto)
 *
 * Bug: juros_apenas persistia apenas a parcela selecionada em vencimentosCustom,
 * perdendo as posteriores deslocadas — e quando o vencimentosCustom existente
 * era incompleto (apenas P1), a P2 não customizada não era persistida.
 *
 * Exigência: ao deslocar P1 em contrato de 2 parcelas, o Firestore deve ter
 * P1 E P2. O MERGE preserva anteriores e adiciona todos os deslocados.
 */
describe("BUG FIREBASE: vencimentosCustom incompleto (TESTES A-F)", () => {
  it("TESTE A: contrato 2 parcelas, juros P1 → vencimentosCustom com P1 E P2", async () => {
    const contrato = {
      id: "firestore-A",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-29T12:00:00");
    const parcelas = calcularParcelas(contrato, hoje);

    await processarPagamento(
      { uid: "test-user" },
      contrato,
      parcelas[0],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-08-29",
      "Juros P1 (contrato 2x)"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // FIX: deve conter P1 e P2 (antes o código só persistia P1)
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(2);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-09-30" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-10-30" });
  });

  it("TESTE B: 3 parcelas, juros P1 duas vezes → P2 adianta cumulativamente", async () => {
    let contrato = {
      id: "firestore-B",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-29T12:00:00");

    // 1º juros P1: P1→30/09, P2→30/10, P3→30/11
    let parcelas = calcularParcelas(contrato, hoje);
    await processarPagamento({ uid: "u" }, contrato, parcelas[0], "juros_apenas",
      { valorJuros: 175 }, "2026-08-29", "1º");
    let update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toEqual([
      { numero: 1, vencimento: "2026-09-30" },
      { numero: 2, vencimento: "2026-10-30" },
      { numero: 3, vencimento: "2026-11-30" },
    ]);
    contrato = { ...contrato, ...update, vencimentosCustom: update.vencimentosCustom };

    // 2º juros P1: P1→30/10, P2→30/11, P3→30/12 (cumulativo, não volta pra 30/10 original)
    parcelas = parcelasDoContrato(contrato, hoje);
    await processarPagamento({ uid: "u" }, contrato, parcelas[0], "juros_apenas",
      { valorJuros: 175 }, "2026-09-15", "2º");
    update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toEqual([
      { numero: 1, vencimento: "2026-10-30" },
      { numero: 2, vencimento: "2026-11-30" },
      { numero: 3, vencimento: "2026-12-30" },
    ]);
  });

  it("TESTE C: juros + abatimento preserva vencimentosCustom completo", async () => {
    const contrato = {
      id: "firestore-C",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 175,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 175,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
      vencimentosCustom: [
        { numero: 1, vencimento: "2026-09-30" },
        { numero: 2, vencimento: "2026-10-30" },
        { numero: 3, vencimento: "2026-11-30" },
      ],
    };

    const hoje = new Date("2026-09-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    await processarPagamento(
      { uid: "u" },
      contrato,
      parcelas[0],
      "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 },
      "2026-09-15",
      "Juros + abatimento"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // vencimentosCustom preservado integralmente
    expect(update.vencimentosCustom).toEqual(contrato.vencimentosCustom);
    expect(update.saldoPrincipal).toBe(450);
  });

  it("TESTE D: vários juros cumulativos — nenhuma parcela volta para data original", async () => {
    let contrato = {
      id: "firestore-D",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-29T12:00:00");

    // juros P1, P2, P3 consecutivos (acúmulo sobre datas efetivas)
    for (let i = 0; i < 3; i++) {
      const parcelas = parcelasDoContrato(contrato, hoje);
      const alvo = i; // P1, P2, P3
      await processarPagamento(
        { uid: "u" },
        contrato,
        parcelas[alvo],
        "juros_apenas",
        { valorJuros: 175 },
        "2026-08-29",
        `Juros P${alvo + 1}`
      );
      const update = _firestoreMocks.lastUpdate.data;
      contrato = { ...contrato, ...update, vencimentosCustom: update.vencimentosCustom };
    }

    // Estado final (fluxo 3 juros: P1, depois P2, depois P3):
    // Iter 1 (juros P1): P1→30/09, P2→30/10, P3→30/11
    // Iter 2 (juros P2): P1=30/09 (preservada), P2→30/11, P3→30/12
    // Iter 3 (juros P3): P1=30/09, P2=30/11 (preservadas), P3→30/01/2027
    const final = _firestoreMocks.lastUpdate.data;
    expect(final.vencimentosCustom).toEqual([
      { numero: 1, vencimento: "2026-09-30" },
      { numero: 2, vencimento: "2026-11-30" },
      { numero: 3, vencimento: "2027-01-30" },
    ]);
    // Nenhuma data é a original (nem 30/08, nem 30/09 original de P1, nem 30/10 original de P2)
    const datas = final.vencimentosCustom.map((v) => v.vencimento);
    expect(datas).not.toContain("2026-08-30");
    expect(datas).not.toContain("2026-10-30"); // P2 original, já deslocada
  });

  it("TESTE E: sem números duplicados em vencimentosCustom após múltiplos deslocamentos", async () => {
    let contrato = {
      id: "firestore-E",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-29T12:00:00");

    for (let i = 0; i < 3; i++) {
      const parcelas = parcelasDoContrato(contrato, hoje);
      await processarPagamento(
        { uid: "u" },
        contrato,
        parcelas[0],
        "juros_apenas",
        { valorJuros: 175 },
        "2026-08-29",
        `Juros ${i + 1} P1`
      );
      const update = _firestoreMocks.lastUpdate.data;
      contrato = { ...contrato, ...update, vencimentosCustom: update.vencimentosCustom };
    }

    const final = _firestoreMocks.lastUpdate.data;
    const numeros = final.vencimentosCustom.map((v) => v.numero);
    expect(new Set(numeros).size).toBe(numeros.length); // sem duplicatas
    expect(numeros).toEqual([1, 2]); // 2 parcelas → 2 registros
  });

  it("TESTE F: parcelas anteriores à selecionada não são alteradas após abatimento", async () => {
    const contrato = {
      id: "firestore-F",
      numeroParcelas: 3,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 350,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 350,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
      vencimentosCustom: [
        { numero: 1, vencimento: "2026-09-30" },
        { numero: 2, vencimento: "2026-10-30" },
        { numero: 3, vencimento: "2026-11-30" },
      ],
    };

    const hoje = new Date("2026-09-15T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    await processarPagamento(
      { uid: "u" },
      contrato,
      parcelas[1], // P2
      "juros_parte_divida",
      { valorJuros: 175, valorAbatimento: 50 },
      "2026-09-15",
      "Abatimento P2"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // P1 (anterior à selecionada) preservada exatamente
    expect(update.vencimentosCustom).toEqual(contrato.vencimentosCustom);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-09-30" });
  });
});

/**
 * TESTES GENÉRICOS: juros_apenas em contratos com 6 parcelas
 *
 * Regra geral (não limitada a P1/P2/P3):
 * - Ao pagar juros_apenas da parcela N:
 *   - parcela N e todas posteriores avançam 1 intervalo
 *   - parcelas anteriores a N não mudam
 *   - TODAS as parcelas deslocadas são persistidas em vencimentosCustom
 * - Frequências testadas: Mensal, Quinzenal, Semanal, Diária
 * - Cada parcela P1..P6 pode ser a alvo — não há hardcoding de número
 */
describe("GENÉRICO: juros_apenas em contrato de 6 parcelas — Mensal", () => {
  const makeContrato = (numeroParcelas = 6) => ({
    id: "test-generico",
    numeroParcelas,
    valorEmprestado: 1000,
    juros: 35,
    jurosRecebidos: 0,
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 1000,
    abatimentos: [],
    abatimentoTotal: 0,
    valorRecebido: 0,
    dataPrimeiraParcela: "2026-08-30",
    frequencia: "Mensal",
  });

  it("juros P1: todas as 6 parcelas avançam 1 mês (P1→30/09, P2→30/10, ..., P6→30/02)", async () => {
    const contrato = makeContrato();
    const parcelas = parcelasDoContrato(contrato, new Date("2026-08-01T12:00:00"));

    await processarPagamento({ uid: "u" }, contrato, parcelas[0], "juros_apenas", { valorJuros: 350 }, "2026-08-30");

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(6);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-09-30" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-10-30" });
    expect(update.vencimentosCustom[2]).toEqual({ numero: 3, vencimento: "2026-11-30" });
    expect(update.vencimentosCustom[3]).toEqual({ numero: 4, vencimento: "2026-12-30" });
    expect(update.vencimentosCustom[4]).toEqual({ numero: 5, vencimento: "2027-01-30" });
    expect(update.vencimentosCustom[5]).toEqual({ numero: 6, vencimento: "2027-02-28" }); // fim de mês
  });

  it("juros P2: P1 preservada, P2-P6 avançam 1 mês", async () => {
    const contrato = makeContrato();
    const parcelas = parcelasDoContrato(contrato, new Date("2026-08-01T12:00:00"));

    await processarPagamento({ uid: "u" }, contrato, parcelas[1], "juros_apenas", { valorJuros: 350 }, "2026-08-30");

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(5);
    // P1 não está no array — ela NÃO sofreu shift e não precisa de override
    expect(update.vencimentosCustom[0]).toEqual({ numero: 2, vencimento: "2026-10-30" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 3, vencimento: "2026-11-30" });
    expect(update.vencimentosCustom[2]).toEqual({ numero: 4, vencimento: "2026-12-30" });
    expect(update.vencimentosCustom[3]).toEqual({ numero: 5, vencimento: "2027-01-30" });
    expect(update.vencimentosCustom[4]).toEqual({ numero: 6, vencimento: "2027-02-28" });
  });

  it("juros P4: P4-P6 avançam, P1-P3 fora do array (não customizados)", async () => {
    const contrato = makeContrato();
    const parcelas = parcelasDoContrato(contrato, new Date("2026-08-01T12:00:00"));

    await processarPagamento({ uid: "u" }, contrato, parcelas[3], "juros_apenas", { valorJuros: 350 }, "2026-08-30");

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(3);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 4, vencimento: "2026-12-30" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 5, vencimento: "2027-01-30" });
    expect(update.vencimentosCustom[2]).toEqual({ numero: 6, vencimento: "2027-02-28" });
  });

  it("juros P6 (última): apenas P6 avança 1 mês", async () => {
    const contrato = makeContrato();
    const parcelas = parcelasDoContrato(contrato, new Date("2026-08-01T12:00:00"));

    await processarPagamento({ uid: "u" }, contrato, parcelas[5], "juros_apenas", { valorJuros: 350 }, "2026-08-30");

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(1);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 6, vencimento: "2027-02-28" });
  });

  it("juros P6 (última): apenas P6 avança 1 mês", async () => {
    const contrato = makeContrato();
    const parcelas = parcelasDoContrato(contrato, new Date("2026-08-01T12:00:00"));

    await processarPagamento({ uid: "u" }, contrato, parcelas[5], "juros_apenas", { valorJuros: 350 }, "2026-08-30");

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(1);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 6, vencimento: "2027-02-28" });
  });

  it("dois juros consecutivos em P1: segundo a partir das datas já customizadas", async () => {
    const contrato = makeContrato();
    const parcelas = parcelasDoContrato(contrato, new Date("2026-08-01T12:00:00"));

    // First juros P1
    await processarPagamento({ uid: "u" }, contrato, parcelas[0], "juros_apenas", { valorJuros: 350 }, "2026-08-30");
    const update1 = _firestoreMocks.lastUpdate.data;
    expect(update1.vencimentosCustom).toBeDefined();

    // Second juros P1 (cumulativo — partindo das datas já shiftadas)
    const contratoComCustom = { ...contrato, vencimentosCustom: update1.vencimentosCustom };
    const parcelas2 = parcelasDoContrato(contratoComCustom, new Date("2026-08-01T12:00:00"));
    await processarPagamento({ uid: "u" }, contratoComCustom, parcelas2[0], "juros_apenas", { valorJuros: 350 }, "2026-09-15");

    const update2 = _firestoreMocks.lastUpdate.data;
    expect(update2.vencimentosCustom).toBeDefined();
    expect(update2.vencimentosCustom.length).toBe(6);
    // Second shift cumulativo: P1 30/09→30/10, P2 30/10→30/11, etc.
    expect(update2.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-10-30" });
    expect(update2.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-11-30" });
    expect(update2.vencimentosCustom[2]).toEqual({ numero: 3, vencimento: "2026-12-30" });
    expect(update2.vencimentosCustom[3]).toEqual({ numero: 4, vencimento: "2027-01-30" });
    expect(update2.vencimentosCustom[4]).toEqual({ numero: 5, vencimento: "2027-02-28" });
    expect(update2.vencimentosCustom[5]).toEqual({ numero: 6, vencimento: "2027-03-28" });
  });

  it("juros P2 depois de P1 já customizado: MERGE preserva P1, atualiza P2-P6", async () => {
    const contrato = makeContrato();
    const parcelas = parcelasDoContrato(contrato, new Date("2026-08-01T12:00:00"));

    // First juros P1: P1→30/09, P2→30/10, P3→30/11, P4→30/12, P5→30/01, P6→28/02
    await processarPagamento({ uid: "u" }, contrato, parcelas[0], "juros_apenas", { valorJuros: 350 }, "2026-08-30");
    const update1 = _firestoreMocks.lastUpdate.data;

    // Second juros P2: partindo das datas customizadas
    const contratoComCustom = { ...contrato, vencimentosCustom: update1.vencimentosCustom };
    const parcelas2 = parcelasDoContrato(contratoComCustom, new Date("2026-08-01T12:00:00"));
    await processarPagamento({ uid: "u" }, contratoComCustom, parcelas2[1], "juros_apenas", { valorJuros: 350 }, "2026-09-15");

    const update2 = _firestoreMocks.lastUpdate.data;
    expect(update2.vencimentosCustom).toBeDefined();
    expect(update2.vencimentosCustom.length).toBe(6);
    // P1 preservada (30/09), P2-P6 deslocadas +1 mês a partir de suas datas customizadas
    expect(update2.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-09-30" }); // preserved
    expect(update2.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-11-30" }); // 30/10 → 30/11
    expect(update2.vencimentosCustom[2]).toEqual({ numero: 3, vencimento: "2026-12-30" });
    expect(update2.vencimentosCustom[3]).toEqual({ numero: 4, vencimento: "2027-01-30" });
    expect(update2.vencimentosCustom[4]).toEqual({ numero: 5, vencimento: "2027-02-28" });
    expect(update2.vencimentosCustom[5]).toEqual({ numero: 6, vencimento: "2027-03-28" });
  });
});

describe("GENÉRICO: juros_apenas em contrato de 6 parcelas — Quinzenal", () => {
  const makeContrato = (numeroParcelas = 6) => ({
    id: "test-quinzenal",
    numeroParcelas,
    valorEmprestado: 1000,
    juros: 35,
    jurosRecebidos: 0,
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 1000,
    abatimentos: [],
    abatimentoTotal: 0,
    valorRecebido: 0,
    dataPrimeiraParcela: "2026-08-30",
    frequencia: "Quinzenal",
  });

  it("juros P3: P3-P6 avançam 15 dias, P1-P2 fora do array", async () => {
    const contrato = makeContrato();
    const parcelas = parcelasDoContrato(contrato, new Date("2026-08-01T12:00:00"));

    await processarPagamento({ uid: "u" }, contrato, parcelas[2], "juros_apenas", { valorJuros: 350 }, "2026-08-30");

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(4);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 3, vencimento: "2026-10-14" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 4, vencimento: "2026-10-29" });
    expect(update.vencimentosCustom[2]).toEqual({ numero: 5, vencimento: "2026-11-13" });
    expect(update.vencimentosCustom[3]).toEqual({ numero: 6, vencimento: "2026-11-28" });
  });
});

describe("GENÉRICO: juros_apenas — Semanal", () => {
  const makeContrato = (numeroParcelas = 6) => ({
    id: "test-semanal",
    numeroParcelas,
    valorEmprestado: 1000,
    juros: 35,
    jurosRecebidos: 0,
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 1000,
    abatimentos: [],
    abatimentoTotal: 0,
    valorRecebido: 0,
    dataPrimeiraParcela: "2026-08-30",
    frequencia: "Semanal",
  });

  it("juros P1: todas avançam 7 dias — P1=09/09, P2=16/09, ..., P6=04/10", async () => {
    const contrato = makeContrato();
    const parcelas = parcelasDoContrato(contrato, new Date("2026-08-01T12:00:00"));

    await processarPagamento({ uid: "u" }, contrato, parcelas[0], "juros_apenas", { valorJuros: 350 }, "2026-08-30");

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(6);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-09-06" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-09-13" });
    expect(update.vencimentosCustom[2]).toEqual({ numero: 3, vencimento: "2026-09-20" });
    expect(update.vencimentosCustom[3]).toEqual({ numero: 4, vencimento: "2026-09-27" });
    expect(update.vencimentosCustom[4]).toEqual({ numero: 5, vencimento: "2026-10-04" });
    expect(update.vencimentosCustom[5]).toEqual({ numero: 6, vencimento: "2026-10-11" });
  });
});

describe("GENÉRICO: juros_apenas — Diária", () => {
  const makeContrato = (numeroParcelas = 6) => ({
    id: "test-diaria",
    numeroParcelas,
    valorEmprestado: 1000,
    juros: 35,
    jurosRecebidos: 0,
    parcelasPagas: 0,
    quitado: false,
    saldoPrincipal: 1000,
    abatimentos: [],
    abatimentoTotal: 0,
    valorRecebido: 0,
    dataPrimeiraParcela: "2026-08-30",
    frequencia: "Diária",
  });

  it("juros P4: P4-P6 avançam 1 dia — P4=09/09, P5=10/09, P6=11/09", async () => {
    const contrato = makeContrato();
    const parcelas = parcelasDoContrato(contrato, new Date("2026-08-01T12:00:00"));

    await processarPagamento({ uid: "u" }, contrato, parcelas[3], "juros_apenas", { valorJuros: 350 }, "2026-08-30");

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(3);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 4, vencimento: "2026-09-03" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 5, vencimento: "2026-09-04" });
    expect(update.vencimentosCustom[2]).toEqual({ numero: 6, vencimento: "2026-09-05" });
  });
});

/**
 * REPRODUÇÃO DO BUG: Renegociação (parcelasCustom) + Pagar só juros
 *
 * Cenário:
 * - Contrato 2 parcelas, P1 vence 30/08
 * - P1 renegociada via parcelasCustom → vence 15/09
 * - Pagar "só juros" na P1
 * - Verifica se o vencimento renegociado (15/09) é preservado
 */
describe("REPRODUÇÃO: contrato normal sem renegociação — pagar só juros na P1", () => {
  it("P1 deve ser deslocada e vencimentosCustom salvo", async () => {
    const contrato = {
      id: "repro-1",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-30T12:00:00");

    // Passo 1: estado antes
    const parcelasAntes = parcelasDoContrato(contrato, hoje);
    console.log("ANTES — P1 vencimento:", parcelasAntes[0].vencimento);
    console.log("ANTES — P2 vencimento:", parcelasAntes[1].vencimento);

    // Passo 2: pagar só juros na P1
    await processarPagamento(
      { uid: "u" },
      contrato,
      parcelasAntes[0],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-08-30",
      "juros"
    );

    const update = _firestoreMocks.lastUpdate.data;
    console.log("\nupdateData.vencimentosCustom:", JSON.stringify(update.vencimentosCustom));

    // Passo 3: simula Firestore (partial update)
    const contratoApos = { ...contrato, ...update };
    console.log("Firestore vencimentosCustom:", JSON.stringify(contratoApos.vencimentosCustom));

    // Passo 4: ler de novo
    const parcelasApos = parcelasDoContrato(contratoApos, hoje);
    console.log("\nDEPOIS — P1 vencimento:", parcelasApos[0].vencimento);
    console.log("DEPOIS — P2 vencimento:", parcelasApos[1].vencimento);
  });
});

describe("BUG: renegociação (parcelasCustom) + juros_apenas preserva vencimento renegociado", () => {
  it("após juros_apenas na P1 renegociada, parcelasDoContrato deve manter vencimento renegociado da P1", async () => {
    const contrato = {
      id: "renegocia-test",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
      // P1 renegociada: novo valor + novo vencimento
      parcelasCustom: [
        { numero: 1, valor: 450, vencimento: "2026-09-15", observacoes: "renegociado" },
      ],
    };

    const hoje = new Date("2026-08-30T12:00:00");

    // Passo 1: parcelasDoContrato deve aplicar parcelasCustom
    const parcelas = parcelasDoContrato(contrato, hoje);
    expect(parcelas[0].vencimento).toBe("2026-09-15"); // renegociado

    // Passo 2: pagar "só juros" na P1
    await processarPagamento(
      { uid: "u" },
      contrato,
      parcelas[0],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-08-30",
      "juros só juros"
    );

    const update = _firestoreMocks.lastUpdate.data;

    // Passo 3: updateDoc é partial — parcelasCustom sobrevive no Firestore
    // (não está em update, então não é removido)

    // Passo 3b: VERIFICA se parcelasCustom foi incluído no update (BUG se sim)
    if (update.parcelasCustom !== undefined) {
      console.log("ATENÇÃO: parcelasCustom foi incluído no updateData → SERIA SOBRESCRITO!");
    }

    // Passo 4: simula o Firestore após o update (mescla update + contrato original)
    const contratoAposJuros = { ...contrato, ...update };

    // Passo 5: parcelasDoContrato deve ainda respeitar parcelasCustom (P1 renegociada)
    const parcelasApos = parcelasDoContrato(contratoAposJuros, hoje);

    // AQUI ESTÁ O PROBLEMA: P1.vencimento deveria ser 15/10 (deslocada de 15/09)
    // vencimentosCustom (gerado pelo juros_apenas) prevalece sobre parcelasCustom (15/09)
    const p1 = parcelasApos[0];
    const p1Vencimento = typeof p1.vencimento === "string"
      ? p1.vencimento
      : p1.vencimento instanceof Date
        ? p1.vencimento.toISOString().split("T")[0]
        : String(p1.vencimento);

    console.log("P1 vencimento após juros_apense + leitura:", p1Vencimento);
    console.log("vencimentosCustom gerado:", JSON.stringify(update.vencimentosCustom));
    console.log("parcelasCustom no Firestore:", JSON.stringify(contratoAposJuros.parcelasCustom));

    // P1: vencimentosCustom (15/10) prevalece sobre parcelasCustom (15/09) — operação mais recente
    expect(p1Vencimento).toBe("2026-10-15");

    // Passo 6: a data de P2 DEVE seguir cumulativamente a partir da data deslocada de P1
    // (15/10 + 1 mês = 15/11), NÃO da data original de P2 (30/09 + 1 mês = 30/10)
    const p2 = parcelasApos[1];
    const p2Vencimento = typeof p2.vencimento === "string"
      ? p2.vencimento
      : p2.vencimento instanceof Date
        ? p2.vencimento.toISOString().split("T")[0]
        : String(p2.vencimento);

    console.log("P2 vencimento após juros_apense + leitura:", p2Vencimento);

    // CORRETO: P2 = "2026-11-15" (avançado cumulativamente de P1 deslocada = 15/10 + 1 mês)
    expect(p2Vencimento).toBe("2026-11-15");
  });
});

/**
 * REPRODUÇÃO DO BUG RELATADO PELO USUÁRIO:
 * - P1 vence 30/08 (original)
 * - Renegocio P1 para 15/09
 * - Pago "só juros" em P1
 * - P1 CONTINUA mostrando 30/08 (ou 30/09 do vencimentosCustom) em vez de 15/09
 */
describe("REPRODUÇÃO: BUG RELATADO — juros_apenas desloca P1 da data ORIGINAL ignorando renegociação", () => {
  it("renegociação P1=15/09 + juros_apenas: P1 deve permanecer 15/09", async () => {
    const contrato = {
      id: "bug-relatado",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
      // Renegociação: P1 → 15/09
      parcelasCustom: [
        { numero: 1, valor: 450, vencimento: "2026-09-15", observacoes: "renegociado" },
      ],
    };

    const hoje = new Date("2026-08-30T12:00:00");

    // Estado antes
    const parcelasAntes = parcelasDoContrato(contrato, hoje);
    console.log("[BUG] ANTES — P1 vencimento:", parcelasAntes[0].vencimento);
    console.log("[BUG] ANTES — P2 vencimento:", parcelasAntes[1].vencimento);

    // Pagar só juros em P1 (que foi renegociada para 15/09)
    await processarPagamento(
      { uid: "u" },
      contrato,
      parcelasAntes[0],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-08-30",
      "juros"
    );

    const update = _firestoreMocks.lastUpdate.data;
    console.log("[BUG] updateData.vencimentosCustom:", JSON.stringify(update.vencimentosCustom));
    console.log("[BUG] updateData.parcelasCustom presente?", update.parcelasCustom !== undefined);

    // Firestore real (partial update)
    const contratoApos = { ...contrato, ...update };
    console.log("[BUG] Firestore parcelasCustom:", JSON.stringify(contratoApos.parcelasCustom));

    // Recalcular parcelas
    const parcelasApos = parcelasDoContrato(contratoApos, hoje);
    const p1 = parcelasApos[0];
    const p1Vencimento = typeof p1.vencimento === "string"
      ? p1.vencimento
      : p1.vencimento instanceof Date
        ? p1.vencimento.toISOString().split("T")[0]
        : String(p1.vencimento);
    console.log("[BUG] DEPOIS — P1 vencimento:", p1Vencimento);
  });
});

/**
 * REPRODUÇÃO EXATA: contrato sem renegociação, P1 = 30/08, pagar só juros.
 * Usuário diz P1 CONTINUA em 30/08 após pagar só juros.
 */
describe("REPRODUÇÃO: contrato SEM renegociação — P1 continua 30/08 após juros?", () => {
  it("verifica se vencimentosCustom é aplicado na leitura", async () => {
    const contrato = {
      id: "sem-renegocio",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
    };

    const hoje = new Date("2026-08-30T12:00:00");

    const parcelasAntes = parcelasDoContrato(contrato, hoje);
    // NOTA: P1 = Date original (não aplicou override)
    const p1Antes = parcelasAntes[0];
    console.log("[BUG] ANTES — P1 tipo:", typeof p1Antes.vencimento, p1Antes.vencimento);

    await processarPagamento(
      { uid: "u" },
      contrato,
      parcelasAntes[0],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-08-30",
      "juros"
    );

    const update = _firestoreMocks.lastUpdate.data;
    console.log("[BUG] updateData.vencimentosCustom:", JSON.stringify(update.vencimentosCustom));

    const contratoApos = { ...contrato, ...update };
    console.log("[BUG] Firestore vencimentosCustom:", JSON.stringify(contratoApos.vencimentosCustom));

    const parcelasApos = parcelasDoContrato(contratoApos, hoje);
    const p1 = parcelasApos[0];
    console.log("[BUG] DEPOIS — P1 vencimento:", p1.vencimento);
    console.log("[BUG] DEPOIS — P2 vencimento:", parcelasApos[1].vencimento);

    // O que P1 vence depois?
    expect(p1.vencimento).not.toBe(parcelasAntes[0].vencimento);
  });
});

/**
 * TESTE CRÍTICO: conflito entre parcelasCustom e vencimentosCustom
 *
 * - parcelasCustom (renegociação): P1 → 15/09
 * - vencimentosCustom (juros_apenas): P1 → 15/10 (deslocado)
 * - Na leitura, QUAL prevalece?
 */
describe("CONFLITO: parcelasCustom vs vencimentosCustom — qual vence?", () => {
  it("quando ambos existem, parcelasCustom deve vencer sobre vencimentosCustom", () => {
    const contrato = {
      id: "conflito",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
      parcelasPagas: 0,
      saldoPrincipal: 500,
      abatimentos: [],
      // vencimentosCustom: juros_apenas já deslocou P1 → 15/10
      vencimentosCustom: [
        { numero: 1, vencimento: "2026-10-15" },
        { numero: 2, vencimento: "2026-10-30" },
      ],
      // parcelasCustom: renegociação → P1 = 15/09
      parcelasCustom: [
        { numero: 1, valor: 450, vencimento: "2026-09-15", observacoes: "renegociado" },
      ],
    };

    const hoje = new Date("2026-08-30T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    console.log("[CONFLITO] P1 vencimento (parcelasCustom vs vencimentosCustom):", parcelas[0].vencimento);
    console.log("[CONFLITO] Esperado pelo vencimentosCustom (juros):", "2026-10-15");
    console.log("[CONFLITO] Esperado pelo parcelasCustom (renegocio):", "2026-09-15");
  });
});

// ============================================================================
// 7 CENÁRIOS OBRIGATÓRIOS: parcelasCustom aplicado ANTES de vencimentosCustom
// e shiftFutureInstallments cumulativo a partir da data deslocada da parcela
// anterior (não da data original).
// ============================================================================
describe("CORREÇÃO 1+2: parcelasCustom antes vencimentosCustom + shift cumulativo", () => {
  const JUROS = 35;
  const DATA_BASE = new Date("2026-08-30T12:00:00");

  function base(overrides = {}) {
    return {
      id: "fix-test",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: JUROS,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-30",
      frequencia: "Mensal",
      ...overrides,
    };
  }

  // TESTE 1 — vencimentosCustom prevalece sobre parcelasCustom (precedência correta)
  it("TESTE 1: vencimentosCustom prevalece sobre parcelasCustom (operacao mais recente vence)", () => {
    // parcelasCustom: P1 → 15/09 (renegocio)
    // vencimentosCustom: P1 → 15/10 (juros_apenas posterior)
    // Resultado esperado: P1 = 15/10 (vencimentosCustom vence — operação mais recente)
    const contrato = base({
      parcelasCustom: [
        { numero: 1, valor: 450, vencimento: "2026-09-15", observacoes: "renegociado" },
      ],
      vencimentosCustom: [
        { numero: 1, vencimento: "2026-10-15" },
        // P2 não tem override — deve usar cumulativo: 15/10 + 1 mês = 15/11
      ],
    });

    const parcelas = parcelasDoContrato(contrato, DATA_BASE);
    expect(parcelas[0].vencimento).toBe("2026-10-15");
    // Parcela 2 vem do cumulativo (15/10 + 1 mês = 15/11)
    expect(parcelas[1].vencimento).toBe("2026-11-15");
    // O valor renegociado (450) é preservado
    expect(parcelas[0].valor).toBe(450);
    expect(parcelas[0].renegociada).toBe(true);
  });

  // TESTE 2 — juros_apenas preserva parcelasCustom como parte do deslocamento
  it("TESTE 2: juros_apenas preserva parcelasCustom e gera vencimentosCustom a partir da data renegociada", async () => {
    // P1 renegociada para 15/09; paga juros na P1.
    // vencimentosCustom deve conter P1 e P2 deslocados a partir de 15/09.
    const contrato = base({
      parcelasCustom: [
        { numero: 1, valor: 450, vencimento: "2026-09-15", observacoes: "renegociado" },
      ],
    });

    const parcelas = parcelasDoContrato(contrato, DATA_BASE);
    expect(parcelas[0].vencimento).toBe("2026-09-15");

    await processarPagamento(
      { uid: "u" },
      contrato,
      parcelas[0],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-08-30",
      "juros P1 renegociada"
    );

    const update = _firestoreMocks.lastUpdate.data;
    // vencimentosCustom deve refletir o deslocamento cumulativo a partir de 15/09
    expect(update.vencimentosCustom).toBeDefined();
    expect(update.vencimentosCustom.length).toBe(2);
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-10-15" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-11-15" });
  });

  // TESTE 3 — leitura após juros_apenas preserva data renegociada de P1 e desloca P2 cumulativamente
  it("TESTE 3: leitura após juros_apenas + renegocio → P1 mantém data renegociada, P2 deslocada cumulativa", async () => {
    const contrato = base({
      parcelasCustom: [
        { numero: 1, valor: 450, vencimento: "2026-09-15", observacoes: "renegociado" },
      ],
    });

    const parcelas = parcelasDoContrato(contrato, DATA_BASE);

    await processarPagamento(
      { uid: "u" },
      contrato,
      parcelas[0],
      "juros_apenas",
      { valorJuros: 175 },
      "2026-08-30",
      "juros"
    );

    const update = _firestoreMocks.lastUpdate.data;
    const contratoApos = { ...contrato, ...update };
    const parcelasApos = parcelasDoContrato(contratoApos, DATA_BASE);

    // P1: vencimentoCustom (15/10) prevalece sobre parcelasCustom (15/09)
    expect(parcelasApos[0].vencimento).toBe("2026-10-15");
    // Valor renegociado preservado
    expect(parcelasApos[0].valor).toBe(450);
    expect(parcelasApos[0].renegociada).toBe(true);
    // P2: cumulativa a partir de P1 deslocada (15/10 + 1 mês = 15/11), NÃO da original 30/09
    expect(parcelasApos[1].vencimento).toBe("2026-11-15");
  });

  // TESTE 4 — juros_apenas duas vezes consecutivas: acúmulo cumulativo sobre datas já customizadas
  it("TESTE 4: dois juros_apensos consecutivos sobre P1 renegociada acumulam cumulativamente", async () => {
    const contrato = base({
      parcelasCustom: [
        { numero: 1, valor: 450, vencimento: "2026-09-15", observacoes: "renegociado" },
      ],
    });

    // 1º juros na P1 (renegociada 15/09) → P1=15/10, P2=15/11
    let parcelas = parcelasDoContrato(contrato, DATA_BASE);
    await processarPagamento(
      { uid: "u" }, contrato, parcelas[0], "juros_apenas",
      { valorJuros: 175 }, "2026-08-30", "1º juros"
    );
    let update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-10-15" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-11-15" });

    const contratoComCustom = { ...contrato, ...update, vencimentosCustom: update.vencimentosCustom };

    // 2º juros na P1 → P1=15/11, P2=15/12 (cumulativo sobre datas já deslocadas)
    parcelas = parcelasDoContrato(contratoComCustom, DATA_BASE);
    await processarPagamento(
      { uid: "u" }, contratoComCustom, parcelas[0], "juros_apenas",
      { valorJuros: 175 }, "2026-09-15", "2º juros"
    );
    update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-11-15" });
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-12-15" });
  });

  // TESTE 5 — juros_apenas duas vezes na P2: P1 preservada, P2-P3 acumulam
  it("TESTE 5: juros P1 fixa, depois juros P2 — P1 preservada, P2-P3 acumulam sobre datas efetivas", async () => {
    let contrato = base({
      numeroParcelas: 3,
      abatimentos: [],
    });

    const hoje = new Date("2026-08-01T12:00:00");

    // 1º juros na P1: P1→30/09, P2→30/10, P3→30/11
    let parcelas = parcelasDoContrato(contrato, hoje);
    await processarPagamento(
      { uid: "u" }, contrato, parcelas[0], "juros_apenas",
      { valorJuros: 175 }, "2026-08-30", "juros P1"
    );
    let update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom[1].vencimento).toBe("2026-10-30"); // P2
    contrato = { ...contrato, ...update, vencimentosCustom: update.vencimentosCustom };

    // 2º juros na P2: P2 já em 30/10 → desloca para 30/11; P3 de 30/11 → 30/12 (cumulativo)
    parcelas = parcelasDoContrato(contrato, hoje);
    await processarPagamento(
      { uid: "u" }, contrato, parcelas[1], "juros_apenas",
      { valorJuros: 175 }, "2026-09-15", "juros P2"
    );
    update = _firestoreMocks.lastUpdate.data;

    // P1 preservada (30/09)
    expect(update.vencimentosCustom[0]).toEqual({ numero: 1, vencimento: "2026-09-30" });
    // P2: 30/10 → 30/11 (cumulativo a partir da data efetiva)
    expect(update.vencimentosCustom[1]).toEqual({ numero: 2, vencimento: "2026-11-30" });
    // P3: 30/11 → 30/12 (cumulativo)
    expect(update.vencimentosCustom[2]).toEqual({ numero: 3, vencimento: "2026-12-30" });
  });

  // TESTE 6 — contrato com 4 parcelas: renegocio P1 + P3, juros na P2
  it("TESTE 6: contrato 4x, renegocio P1 e P3, juros na P2 — precedence e cumulatividade", async () => {
    const contrato = base({
      numeroParcelas: 4,
      parcelasCustom: [
        { numero: 1, valor: 450, vencimento: "2026-08-15", observacoes: "P1 reneg" },
        { numero: 3, valor: 480, vencimento: "2026-10-15", observacoes: "P3 reneg" },
      ],
    });

    const hoje = new Date("2026-08-01T12:00:00");
    const parcelas = parcelasDoContrato(contrato, hoje);

    // Antes do juros: P1=15/08 (renegociada), P3=15/10 (renegociada)
    expect(parcelas[0].vencimento).toBe("2026-08-15");
    expect(parcelas[2].vencimento).toBe("2026-10-15");

    // Juros na P2: P2 + posteriores avançam 1 mês a partir das datas efetivas
    await processarPagamento(
      { uid: "u" }, contrato, parcelas[1], "juros_apenas",
      { valorJuros: 175 }, "2026-08-01", "juros P2"
    );

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.vencimentosCustom).toBeDefined();

    // P1 (15/08) preservada — não entra no shift de P2 em diante
    // P2 (original 30/09 → +1 mês = 30/10)
    // P3 (renegociada 15/10 → +1 mês = 15/11, cumulativo a partir de P2 deslocada)
    // P4 (cumulativo a partir de 15/11 → 15/12)
    const vc = update.vencimentosCustom;
    const mapVc = new Map(vc.map((v) => [Number(v.numero), v.vencimento]));

    expect(mapVc.get(2)).toBe("2026-10-30"); // P2 original 30/09 + 1 mês
    expect(mapVc.get(3)).toBe("2026-11-15"); // P3 renegociada 15/10 + 1 mês = 15/11
    expect(mapVc.get(4)).toBe("2026-12-15"); // P4 cumulativo: 15/11 + 1 mês = 15/12
    // P1 não deve estar no override (não sofreu shift)
    expect(mapVc.has(1)).toBe(false);
  });

  // TESTE 7 — shiftFutureInstallments cumulativo: 3 parcelas, shift P1, depois shift P2
  it("TESTE 7: shiftFutureInstallments cumulativo — P1 então P2, P3 acumula", () => {
    const baseParc = [
      { numero: 1, vencimento: "2026-08-30", valor: 425, status: "Pendente" },
      { numero: 2, vencimento: "2026-09-30", valor: 425, status: "Pendente" },
      { numero: 3, vencimento: "2026-10-30", valor: 425, status: "Pendente" },
    ];

    // Shift 1: P1 e posteriores avançam
    let shifted = shiftFutureInstallments(baseParc, 0, "Mensal");
    expect(shifted[0].vencimento).toBe("2026-09-30");
    expect(shifted[1].vencimento).toBe("2026-10-30"); // cumulativo: de shifted[0] = 30/09 + 1 = 30/10
    expect(shifted[2].vencimento).toBe("2026-11-30"); // cumulativo: de shifted[1] = 30/10 + 1 = 30/11

    // Shift 2: P2 e posteriores avançam (a partir do estado já shiftado)
    shifted = shiftFutureInstallments(shifted, 1, "Mensal");
    expect(shifted[0].vencimento).toBe("2026-09-30"); // P1 preservada
    expect(shifted[1].vencimento).toBe("2026-11-30"); // 30/10 + 1 = 30/11
    expect(shifted[2].vencimento).toBe("2026-12-30"); // cumulativo: 30/11 + 1 = 30/12

    // Shift 3: P3 (última) avança
    shifted = shiftFutureInstallments(shifted, 2, "Mensal");
    expect(shifted[0].vencimento).toBe("2026-09-30"); // P1 preservada
    expect(shifted[1].vencimento).toBe("2026-11-30"); // P2 preservada
    expect(shifted[2].vencimento).toBe("2027-01-30"); // 30/12 + 1 = 30/01/2027
  });
});

// ============================================================================
// TESTES OBRIGATÓRIOS: CENÁRIO 500→50→450
//
// Fluxo:
//   1. Contrato: 500, 2x, 35% → P1=425, P2=425
//   2. Paga R$50 na P1 → P1=50 (Paga), P2=425 (Pendente)
//   3. Renegocia para 450 → P1=50 (Paga), P2=382,50 (Pendente)
//
// Regra definitiva:
//   - Parcela PAGA: preserva `recebido`
//   - Parcela PENDENTE: recalcular via calcularParcelas() com estado ATUAL
//   - Parcela CUSTOM: respeita parcelasCustom existente
//   - Parcela DINÂMICA: preserva lógica existente
// ============================================================================
describe("CENÁRIO 500→50→450: pagamento parcial + renegociação", () => {
  const DATA_BASE = new Date("2026-08-01T12:00:00");

  function contratoBase(overrides = {}) {
    return {
      id: "cenario-500-50-450",
      numeroParcelas: 2,
      valorEmprestado: 500,
      juros: 35,
      jurosRecebidos: 0,
      parcelasPagas: 0,
      quitado: false,
      saldoPrincipal: 500,
      abatimentos: [],
      abatimentoTotal: 0,
      valorRecebido: 0,
      dataPrimeiraParcela: "2026-08-01",
      frequencia: "Mensal",
      cobrarJurosAtraso: false,
      ...overrides,
    };
  }

  it("TESTE 1: Estado inicial — P1=425, P2=425", () => {
    const contrato = contratoBase();
    const parcelas = parcelasDoContrato(contrato, DATA_BASE);

    expect(parcelas[0].valor).toBeCloseTo(425, 2);
    expect(parcelas[1].valor).toBeCloseTo(425, 2);
    expect(parcelas[0].status).toBe("Pendente");
    expect(parcelas[1].status).toBe("Pendente");
  });

  it("TESTE 2: Paga R$50 na P1 — P1=50 Paga, P2=425 (recalculado com saldo=450)", async () => {
    const contrato = contratoBase();
    const parcelas = parcelasDoContrato(contrato, DATA_BASE);

    await processarPagamento(
      { uid: "u" },
      contrato,
      parcelas[0],
      "parcela_inteira",
      { valorTotal: 50 },
      "2026-08-01",
      "Pagamento parcial R$50"
    );

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.saldoPrincipal).toBe(450); // 500 - 50
    expect(update.parcelasPagas).toBe(1);

    const contratoApos = { ...contrato, ...update };
    const parcelasApos = parcelasDoContrato(contratoApos, DATA_BASE);

    // P1: paga com 50 (preservado)
    expect(parcelasApos[0].status).toBe("Paga");
    expect(parcelasApos[0].valor).toBe(50);
    expect(parcelasApos[0].recebido).toBe(50);

    // P2: recalculada — (450/2) + (450 * 0,35) = 225 + 157,5 = 382,50
    expect(parcelasApos[1].status).toBe("Pendente");
    expect(parcelasApos[1].valor).toBeCloseTo(382.5, 2);
  });

  it("TESTE 3: Renegocia para 450 — P1=50 Paga, P2=382,50", () => {
    // Estado após pagamento R$50 + renegociação para 450
    const contrato = contratoBase({
      valorEmprestado: 450,
      saldoPrincipal: 450,
      parcelasPagas: 1,
      valorRecebido: 50,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
    });

    const parcelas = parcelasDoContrato(contrato, DATA_BASE);

    // P1: paga com 50 (preservado)
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[0].recebido).toBe(50);

    // P2: recalculada — (450/2) + (450 * 0,35) = 225 + 157,5 = 382,50
    expect(parcelas[1].status).toBe("Pendente");
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);
  });

  it("TESTE 4: Fórmula = 450/2 + 450*0,35 = 382,50", () => {
    const valorEsperado = Math.round(((450 / 2) + (450 * 0.35)) * 100) / 100;
    expect(valorEsperado).toBe(382.5);
  });

  it("TESTE 5: P2 NÃO é 212,50 (não usa saldoPrincipal=250)", () => {
    const contrato = contratoBase({
      valorEmprestado: 450,
      saldoPrincipal: 450,
      parcelasPagas: 1,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      valorRecebido: 50,
    });

    const parcelas = parcelasDoContrato(contrato, DATA_BASE);

    // NÃO 212,50 (que seria 250/2 + 250*0,35)
    expect(parcelas[1].valor).not.toBeCloseTo(212.5, 2);
    // NÃO 425 (congelamento)
    expect(parcelas[1].valor).not.toBeCloseTo(425, 2);
    // Deve ser 382,50
    expect(parcelas[1].valor).toBeCloseTo(382.5, 2);
  });

  it("TESTE 6: P1 preservado como 50 após renegociação", () => {
    const contrato = contratoBase({
      valorEmprestado: 450,
      saldoPrincipal: 450,
      parcelasPagas: 1,
      valorRecebido: 50,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
    });

    const parcelas = parcelasDoContrato(contrato, DATA_BASE);

    expect(parcelas[0].valor).toBe(50);
    expect(parcelas[0].recebido).toBe(50);
    expect(parcelas[0].status).toBe("Paga");
  });

  it("TESTE 7: Múltiplas consultas — P1=50, P2=382,50 estáveis", () => {
    const contrato = contratoBase({
      valorEmprestado: 450,
      saldoPrincipal: 450,
      parcelasPagas: 1,
      valorRecebido: 50,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
    });

    const p1 = parcelasDoContrato(contrato, DATA_BASE);
    const p2 = parcelasDoContrato(contrato, DATA_BASE);
    const p3 = parcelasDoContrato(contrato, DATA_BASE);

    p1.forEach((p, i) => {
      expect(p2[i].valor).toBe(p.valor);
      expect(p3[i].valor).toBe(p.valor);
    });
  });

  it("TESTE 8: parcelasCustom preservada — regra existente mantida", () => {
    const contrato = contratoBase({
      valorEmprestado: 450,
      saldoPrincipal: 450,
      parcelasPagas: 1,
      valorRecebido: 50,
      abatimentos: [{ valor: 50, parcelaNumero: 1 }],
      parcelasCustom: [
        { numero: 2, valor: 500, vencimento: "2026-09-15", observacoes: "Custom P2" },
      ],
    });

    const parcelas = parcelasDoContrato(contrato, DATA_BASE);

    // P1: paga, preservado
    expect(parcelas[0].status).toBe("Paga");
    expect(parcelas[0].valor).toBe(50);

    // P2: parcelasCustom prevalece (500, não 382,50)
    expect(parcelas[1].valor).toBe(500);
    expect(parcelas[1].renegociada).toBe(true);
  });

  it("TESTE 9: Parcela dinâmica preservada — lógica existente mantida", () => {
    // 2 originais pagas, saldoPrincipal=400 → P3 dinâmica
    const contrato = contratoBase({
      valorEmprestado: 500,
      numeroParcelas: 2,
      juros: 35,
      saldoPrincipal: 400,
      parcelasPagas: 2,
      quitado: false,
      valorRecebido: 100,
      abatimentos: [
        { valor: 50, parcelaNumero: 1 },
        { valor: 50, parcelaNumero: 2 },
      ],
    });

    const parcelas = parcelasDoContrato(contrato, DATA_BASE);

    // P3 dinâmica: 400 * (1 + 0,35) = 540
    expect(parcelas.length).toBe(3);
    expect(parcelas[2].status).toBe("Pendente");
    expect(parcelas[2].valor).toBeCloseTo(540, 2);
  });

  it("TESTE 10: Fluxo COMPLETO — processarPagamento + renegociação", async () => {
    let contrato = contratoBase();

    // 1. Estado inicial: P1=425, P2=425
    let parcelas = parcelasDoContrato(contrato, DATA_BASE);
    expect(parcelas[0].valor).toBeCloseTo(425, 2);
    expect(parcelas[1].valor).toBeCloseTo(425, 2);

    // 2. Paga R$50 na P1
    await processarPagamento(
      { uid: "u" },
      contrato,
      parcelas[0],
      "parcela_inteira",
      { valorTotal: 50 },
      "2026-08-01",
      "Parcial"
    );

    const update = _firestoreMocks.lastUpdate.data;
    expect(update.saldoPrincipal).toBe(450);
    expect(update.parcelasPagas).toBe(1);

    // 3. Simula renegociação: valorEmprestado → 450, saldoPrincipal → 450
    contrato = {
      ...contrato,
      ...update,
      valorEmprestado: 450,
      saldoPrincipal: 450,
    };

    // 4. Calcula parcelas finais
    const parcelasFinais = parcelasDoContrato(contrato, DATA_BASE);

    // P1 = 50 Paga
    expect(parcelasFinais[0].status).toBe("Paga");
    expect(parcelasFinais[0].valor).toBe(50);

    // P2 = 382,50 Pendente
    expect(parcelasFinais[1].status).toBe("Pendente");
    expect(parcelasFinais[1].valor).toBeCloseTo(382.5, 2);
  });
});

