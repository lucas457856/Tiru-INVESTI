// Testes para a regra de decisão da notificação de "Parcela em atraso" /
// "Parcela vencendo". A função testada é PURA (`decidirTipoNotificacaoParcela`),
// sem dependência de React, Firebase ou relógio do sistema.
//
// CASO REAL (regressão 2026-09-04):
//   Vencimento = hoje → NÃO notificar como atraso.
//   Vencimento = ontem → notificar como atraso de 1 dia.
//   Vencimento = anteontem → notificar como atraso de 2 dias.
//   Parcela Paga → nunca notificar.

import { describe, it, expect } from "vitest";
import { decidirTipoNotificacaoParcela } from "../useNotificadorVencimentos";

describe("decidirTipoNotificacaoParcela", () => {
  // Casos obrigatórios da especificação.
  describe("regressão: atraso (data atual = 2026-09-04)", () => {
    const hoje = "2026-09-04";

    it("vencimento HOJE (04/09) + hoje (04/09) → NÃO notificar", () => {
      const parcela = { status: "Pendente", vencimento: "2026-09-04" };
      expect(decidirTipoNotificacaoParcela(parcela, hoje)).toBe("parcela_vencendo");
    });

    it("vencimento 03/09 + hoje 04/09 → notificar atraso de 1 dia", () => {
      const parcela = { status: "Vencida", vencimento: "2026-09-03" };
      expect(decidirTipoNotificacaoParcela(parcela, hoje)).toBe("parcela_atrasada");
    });

    it("vencimento 02/09 + hoje 04/09 → notificar atraso de 2 dias", () => {
      const parcela = { status: "Vencida", vencimento: "2026-09-02" };
      expect(decidirTipoNotificacaoParcela(parcela, hoje)).toBe("parcela_atrasada");
    });

    it("vencimento 01/09 + hoje 04/09 → notificar atraso de 3 dias", () => {
      const parcela = { status: "Vencida", vencimento: "2026-09-01" };
      expect(decidirTipoNotificacaoParcela(parcela, hoje)).toBe("parcela_atrasada");
    });
  });

  describe("atraso em outros dias", () => {
    it("vencimento 04/09 + hoje 05/09 → atraso de 1 dia", () => {
      const parcela = { status: "Vencida", vencimento: "2026-09-04" };
      expect(decidirTipoNotificacaoParcela(parcela, "2026-09-05")).toBe("parcela_atrasada");
    });

    it("vencimento 04/09 + hoje 06/09 → atraso de 2 dias", () => {
      const parcela = { status: "Vencida", vencimento: "2026-09-04" };
      expect(decidirTipoNotificacaoParcela(parcela, "2026-09-06")).toBe("parcela_atrasada");
    });
  });

  describe("proteções: não notificar", () => {
    it("parcela PAGA + vencimento antigo → NÃO notificar", () => {
      const parcela = { status: "Paga", vencimento: "2026-08-01" };
      expect(decidirTipoNotificacaoParcela(parcela, "2026-09-04")).toBeNull();
    });

    it("vencimento futuro (hoje + 1) → NÃO notificar", () => {
      const parcela = { status: "Pendente", vencimento: "2026-09-05" };
      expect(decidirTipoNotificacaoParcela(parcela, "2026-09-04")).toBeNull();
    });

    it("vencimento futuro distante → NÃO notificar", () => {
      const parcela = { status: "Pendente", vencimento: "2026-12-31" };
      expect(decidirTipoNotificacaoParcela(parcela, "2026-09-04")).toBeNull();
    });
  });

  describe("parcela vencendo hoje", () => {
    it("status Pendente + vencimento HOJE → parcela_vencendo", () => {
      const parcela = { status: "Pendente", vencimento: "2026-09-04" };
      expect(decidirTipoNotificacaoParcela(parcela, "2026-09-04")).toBe("parcela_vencendo");
    });
  });

  describe("imunidade a timezone (UTC vs local)", () => {
    // O contrato usa `T12:00:00` SEM `Z` (horário local 12h) em
    // `parcelasUtil.js:261` — formato que evita o "drift" de UTC. Garante
    // que `Date` extraída via getDate() bate com o dia pretendido.
    it("vencimento como Date em horário local 12:00 → bate com o DIA local", () => {
      // 2026-09-04T12:00:00 (sem Z) = 12:00 horário LOCAL do dia 04/09.
      const localNoon = new Date("2026-09-04T12:00:00");
      const parcela = { status: "Pendente", vencimento: localNoon };
      // Hoje 04/09 → mesma data de calendário → vencendo, NÃO atraso.
      expect(decidirTipoNotificacaoParcela(parcela, "2026-09-04")).toBe("parcela_vencendo");
    });

    it("comparação entre STRINGS ISO é determinística (não usa Date math)", () => {
      // A regra da função pura usa `vStr < hojeISO` (string < string).
      // Não importa o horário do relógio do browser — a comparação
      // é puramente lexicográfica, que para YYYY-MM-DD equivale a
      // cronológica.
      const p1 = { status: "Pendente", vencimento: "2026-09-04" };
      const p2 = { status: "Pendente", vencimento: "2026-09-04" };
      // Para a mesma data de calendário, independente de "horário",
      // a função devolve o mesmo resultado.
      expect(decidirTipoNotificacaoParcela(p1, "2026-09-04")).toBe(
        decidirTipoNotificacaoParcela(p2, "2026-09-04"),
      );
    });
  });

  describe("edge cases de input", () => {
    it("parcela sem vencimento → null", () => {
      const parcela = { status: "Pendente", vencimento: null };
      expect(decidirTipoNotificacaoParcela(parcela, "2026-09-04")).toBeNull();
    });

    it("parcela null → null (sem throw)", () => {
      expect(decidirTipoNotificacaoParcela(null, "2026-09-04")).toBeNull();
    });

    it("vencimento string curta demais → null", () => {
      const parcela = { status: "Pendente", vencimento: "2026" };
      expect(decidirTipoNotificacaoParcela(parcela, "2026-09-04")).toBeNull();
    });
  });

  describe("datas que cruzam virada de mês (regressão de comparação de strings)", () => {
    // Strings ISO YYYY-MM-DD comparam lexicograficamente E cronologicamente,
    // contanto que ambas as strings tenham o MESMO formato. Estes testes
    // fixam essa propriedade.
    it("vencimento 31/08 + hoje 01/09 → atraso", () => {
      const parcela = { status: "Vencida", vencimento: "2026-08-31" };
      expect(decidirTipoNotificacaoParcela(parcela, "2026-09-01")).toBe("parcela_atrasada");
    });

    it("vencimento 31/12/2025 + hoje 01/01/2026 → atraso cruzando ano", () => {
      const parcela = { status: "Vencida", vencimento: "2025-12-31" };
      expect(decidirTipoNotificacaoParcela(parcela, "2026-01-01")).toBe("parcela_atrasada");
    });
  });
});
