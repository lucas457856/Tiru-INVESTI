// Tipos canônicos de eventos de notificação.
//
// FONTE ÚNICA DE VERDADE: importada pelo front (para chamar
// criarNotificationEvent) e referenciada pelo backend (em
// api/notifications/dispatch.js) ao rotear notificações.
//
// Adicionar um novo tipo:
//   1. Adicionar a constante aqui.
//   2. (Opcional) Adicionar textos padrão (titulo/body) em
//      textosPadraoEvento() para reuso. Se preferir textos dinâmicos
//      por call site, ignore a função e passe titulo/body no payload.
//   3. Pronto. O dispatch (api/notifications/dispatch.js) não precisa
//      saber do tipo — ele apenas lê ownerId + data + createdBy do evento
//      e roteia por deviceId conforme as regras (ver plano §8).

export const EVENT_TYPES = Object.freeze({
  // Contratos
  CONTRACT_CREATED: "CONTRACT_CREATED",
  CONTRACT_UPDATED: "CONTRACT_UPDATED",
  CONTRACT_DELETED: "CONTRACT_DELETED",
  // Pagamentos / parcelas
  PAYMENT_REGISTERED: "PAYMENT_REGISTERED",
  INSTALLMENT_PAID: "INSTALLMENT_PAID",
  INSTALLMENT_DUE_TODAY: "INSTALLMENT_DUE_TODAY",
  INSTALLMENT_OVERDUE: "INSTALLMENT_OVERDUE",
  // Clientes
  CLIENT_CREATED: "CLIENT_CREATED",
  CLIENT_UPDATED: "CLIENT_UPDATED",
  CLIENT_DELETED: "CLIENT_DELETED",
  // Funcionários
  EMPLOYEE_CREATED: "EMPLOYEE_CREATED",
  EMPLOYEE_UPDATED: "EMPLOYEE_UPDATED",
  EMPLOYEE_DELETED: "EMPLOYEE_DELETED",
});

/**
 * Textos padrão por tipo de evento.
 * Usado quando o call site não fornece titulo/body próprios.
 * Mantém o sistema de notificação GENÉRICO (regra §23 do briefing):
 * a função de notificação não decide regra de negócio — apenas roteia.
 * Textos continuam sendo responsabilidade do call site quando ele
 * quiser ser específico (ex: "Parcela vencendo" com nome do cliente).
 *
 * @param {string} type
 * @returns {{ titulo: string, corpo: string }}
 */
export function textosPadraoEvento(type) {
  switch (type) {
    case EVENT_TYPES.CONTRACT_CREATED:
      return { titulo: "Novo contrato criado", corpo: "Um novo contrato foi cadastrado." };
    case EVENT_TYPES.CONTRACT_UPDATED:
      return { titulo: "Contrato atualizado", corpo: "Um contrato foi atualizado." };
    case EVENT_TYPES.CONTRACT_DELETED:
      return { titulo: "Contrato excluído", corpo: "Um contrato foi excluído." };
    case EVENT_TYPES.PAYMENT_REGISTERED:
      return { titulo: "Pagamento registrado", corpo: "Um pagamento foi registrado." };
    case EVENT_TYPES.INSTALLMENT_PAID:
      return { titulo: "Parcela paga", corpo: "Uma parcela foi marcada como paga." };
    case EVENT_TYPES.INSTALLMENT_DUE_TODAY:
      return { titulo: "Parcela vence hoje", corpo: "Uma parcela vence hoje." };
    case EVENT_TYPES.INSTALLMENT_OVERDUE:
      return { titulo: "Parcela em atraso", corpo: "Há uma parcela em atraso." };
    case EVENT_TYPES.CLIENT_CREATED:
      return { titulo: "Novo cliente cadastrado", corpo: "Um novo cliente foi adicionado." };
    case EVENT_TYPES.CLIENT_UPDATED:
      return { titulo: "Cliente atualizado", corpo: "Um cliente foi atualizado." };
    case EVENT_TYPES.CLIENT_DELETED:
      return { titulo: "Cliente excluído", corpo: "Um cliente foi removido." };
    case EVENT_TYPES.EMPLOYEE_CREATED:
      return { titulo: "Novo funcionário", corpo: "Um novo funcionário foi adicionado." };
    case EVENT_TYPES.EMPLOYEE_UPDATED:
      return { titulo: "Funcionário atualizado", corpo: "Um funcionário foi atualizado." };
    case EVENT_TYPES.EMPLOYEE_DELETED:
      return { titulo: "Funcionário removido", corpo: "Um funcionário foi removido." };
    default:
      return { titulo: "Atualização", corpo: "Há uma nova atualização no sistema." };
  }
}
