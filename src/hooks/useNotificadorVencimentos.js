// Hook que detecta parcelas "vencendo hoje" e "atrasadas" no conjunto de
// contratos ATIVOS do usuário e dispara, para cada evento novo:
//
//   1. `criarNotificacao(uid, { tipo, titulo, descricao, contratoId,
//      parcelaNumero, valor })`  → 1 doc em `usuarios/{uid}/notificacoes`
//   2. `mostrarNotificacaoNativa(...)` (na success branch do (1))
//      → 1 toast nativo do Chrome/Windows
//
// REGRA DE DETECÇÃO: REUTILIZA o que o sistema já calcula para o
// formato da parcela, mas a decisão de NOTIFICAR é LOCAL a este hook,
// baseada em comparação de DIAS DE CALENDÁRIO (YYYY-MM-DD), imune a
// drift de fuso UTC. Razão: a notificação NÃO pode disparar no mesmo
// dia do vencimento, mesmo se a função compartilhada `calcularParcelas`
// (que serve Dashboard, Parcelas e Relatórios) classificar a parcela
// como "Vencida" no momento em que `new Date()` já passou de T12:00 do
// dia. O sinal canônico `parcela.status === "Vencida"` é IGNORADO aqui
// propositalmente — o que importa é a DATA, não o status compartilhado.
//
//   - `vencimento < DATA_HOJE` (comparação de strings ISO) → "atrasada".
//   - `vencimento === DATA_HOJE` + status Pendente → "vencendo".
//   - `vencimento > DATA_HOJE` → sem notificação.
//
// Nenhum cálculo financeiro é tocado — `parcelasDoContrato` é chamada
// como função pura e seu resultado é apenas LIDO. A função
// `calcularParcelas` (e o `parcela.status` que ela define) NÃO foi
// modificada.
//
// DEDUPLICAÇÃO: 3 camadas (ver `src/utils/notificationDedup.js`).
//   - Set em memória (`notificacoesInSession`)  — O(1), cobre re-renders.
//   - localStorage (`jurex:notif:<tipo>:<contratoId>:<parcelaNumero>:<vencimentoISO>`)
//     — cobre F5, logout/login, fechamento de aba.
//   - `tag` no Chrome (`jurex:parcela_<estado>:<contratoId>:<parcelaNumero>:<vencimentoISO>`)
//     — cobre toast visual repetido no browser.
//
// QUANDO RODA: num `useEffect([contratosAtivos, usuarioUid])`. Sem
// `setInterval`, sem `setTimeout`, sem polling. Reage a:
//   - montagem do Dashboard (primeira vez);
//   - re-emissão do `onSnapshot` de contratos (que faz `setContratos`
//     e re-deriva `contratosAtivos` via `useMemo`).
//
// O dedup garante que mesmo com o efeito rodando dezenas de vezes, cada
// evento (parcela X, vencimento Y) gera no máximo 1 notificação.

import { useEffect, useRef } from "react";
import { parcelasDoContrato } from "../services/contractService";
import { criarNotificacao } from "../services/notificationsService";
import {
  criarNotificationEvent,
  dispatchNotificationEvent,
  obterDeviceIdLocal,
} from "../services/notificationEvents";
import { EVENT_TYPES } from "../utils/notificationEventTypes";
import { mostrarNotificacaoNativa } from "../utils/notifications";
import { formatarMoeda } from "../utils/formatadores";
import {
  chaveNotificacao,
  eventoJaNotificado,
  marcarNotificado,
} from "../utils/notificationDedup";

// "YYYY-MM-DD" no fuso do browser (mesma definição do Dashboard.jsx:56-59).
// Calculado uma vez por execução do effect — não no escopo do módulo, porque
// o efeito pode rodar dias depois da primeira carga da página.
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Normaliza `parcela.vencimento` (que pode ser Date OU "YYYY-MM-DD"
// dependendo se houve override de `vencimentosCustom` ou `parcelasCustom`).
// Retorna a string ISO canônica ou `null` se não der pra normalizar.
function vencimentoISO(parcela) {
  const v = parcela?.vencimento;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "string" && v.length >= 10) {
    return v.slice(0, 10);
  }
  return null;
}

/**
 * Decide se a notificação de "Parcela em atraso" / "Parcela vencendo"
 * deve ser disparada para esta parcela. Função PURA — sem efeitos
 * colaterais, sem leitura de relógio, sem acesso a Firestore.
 *
 * REGRA (específica da notificação, NÃO do `parcela.status` compartilhado):
 *   - Paga: nunca notificar.
 *   - Pendente + vencimento === hojeISO → "parcela_vencendo".
 *   - Vencimento < hojeISO (comparação de strings ISO YYYY-MM-DD) →
 *     "parcela_atrasada", independente de `parcela.status`.
 *   - Vencimento > hojeISO → não notificar.
 *
 * A comparação é feita entre STRINGS ISO, não `Date < Date`, justamente
 * para evitar drift de fuso UTC (`new Date("2026-09-04")` vira
 * 2026-09-03T21:00 em horário de Brasília). Strings ISO são imunes a
 * isso: "2026-09-04" < "2026-09-05" sempre, em qualquer fuso.
 *
 * @param {{ status?: string, vencimento?: Date|string }} parcela
 * @param {string} hojeISO - "YYYY-MM-DD" no fuso do browser.
 * @returns {"parcela_atrasada" | "parcela_vencendo" | null}
 */
export function decidirTipoNotificacaoParcela(parcela, hojeISO) {
  if (parcela?.status === "Paga") return null;
  const vStr = vencimentoISO(parcela);
  if (!vStr) return null;
  if (vStr < hojeISO) return "parcela_atrasada";
  if (parcela.status === "Pendente" && vStr === hojeISO) return "parcela_vencendo";
  return null;
}

// Tipo → textos visíveis. Mantém o mesmo padrão de `pagamento_recebido`
// ("Cliente · parcela N · R$ X"). Texto curto e estável para o body da
// notificação nativa.
const TEXTOS = {
  parcela_vencendo: {
    titulo: "Parcela vencendo",
  },
  parcela_atrasada: {
    titulo: "Parcela em atraso",
  },
};

/**
 * Hook que dispara notificações (Firestore + nativa) para parcelas
 * vencendo hoje / vencidas. Sem polling. Sem `setInterval`. Reage a
 * mudanças em `contratosAtivos` (que o Dashboard já deriva do `onSnapshot`).
 *
 * IMPORTANTE: `ownerUid` deve ser o **UID do proprietário** dos contratos,
 * não o `auth.currentUser.uid`. Para DONO, ambos são iguais; para
 * FUNCIONÁRIO, é o `ownerUid` ao qual ele está vinculado. A coleção
 * `usuarios/{ownerUid}/notificacoes` é a chave da regra do Firestore
 * (dono e funcionário do dono acessam).
 *
 * @param {Array} contratosAtivos - Contratos não quitados. Já é filtrado
 *   pelo Dashboard via `useMemo` em `Dashboard.jsx:122-125`.
 * @param {string|undefined|null} ownerUid - UID do proprietário dos
 *   contratos. Ausente (deslogado) → hook é no-op.
 * @returns {{ verificadas: number, disparadas: number }} Contadores
 *   apenas para debug / log. NÃO usar em render — não causam re-render.
 */
export function useNotificadorVencimentos(contratosAtivos, ownerUid) {
  // Contadores expostos via ref (não causam re-render). Servem só para
  // diagnóstico em dev — logados na primeira execução e em mudanças.
  const statsRef = useRef({ verificadas: 0, disparadas: 0 });

  useEffect(() => {
    // Guarda 1: precisa ter um ownerUid válido.
    if (!ownerUid) return;
    // Guarda 2: precisa ter contratos para inspecionar.
    if (!Array.isArray(contratosAtivos) || contratosAtivos.length === 0) return;

    const hoje = hojeISO();
    let verificadas = 0;

    // Itera cada contrato ATIVO. Falha isolada em 1 contrato NÃO afeta
    // os outros (try/catch por contrato).
    for (const c of contratosAtivos) {
      let parcelas;
      try {
        parcelas = parcelasDoContrato(c, new Date());
      } catch (err) {
        // Em vez de quebrar a detecção inteira por causa de 1 contrato
        // malformado, loga e segue. O usuário pode ter dados legados.
        console.error(
          "[notif-venc] parcelasDoContrato falhou para",
          c?.id,
          err?.message,
        );
        continue;
      }
      if (!Array.isArray(parcelas)) continue;

      for (const p of parcelas) {
        verificadas += 1;

        // Decide o tipo de evento. Função PURA — não lê relógio, não
        // acessa Firestore. A REGRA é LOCAL à notificação (ver docstring
        // de `decidirTipoNotificacaoParcela` acima).
        const tipo = decidirTipoNotificacaoParcela(p, hoje);
        if (!tipo) continue;

        const vStr = vencimentoISO(p);
        if (!vStr) continue;

        // Chave estável do evento. Inclui o `vencimentoISO` ORIGINAL da
        // parcela — se ela for renegociada com novo vencimento, a chave
        // muda (evento novo, notificação nova é o comportamento correto).
        const chave = chaveNotificacao(tipo, c.id, p.numero, vStr);
        if (eventoJaNotificado(chave)) continue;

        // Marca ANTES de chamar o Firestore, para garantir que mesmo que
        // `criarNotificacao` dispare o `useEffect` novamente (o que NÃO
        // acontece em geral, mas é defensivo), o evento não vai re-disparar.
        marcarNotificado(chave);

        const titulo = TEXTOS[tipo].titulo;
        const valor = Number(p.valor) || 0;
        const nomeCliente = c?.clienteNome || c?.nome || "cliente";
        const descricao = `${nomeCliente} · parcela ${p.numero} · ${formatarMoeda(valor)}`;

        // === FASE C: evento central + dispatch (best-effort) ===
        // Gera eventId uma vez por deteccao. O tipo canonico
        // (INSTALLMENT_DUE_TODAY / INSTALLMENT_OVERDUE) e o que vai para
        // o sistema central. O tipo legado ("parcela_vencendo" /
        // "parcela_atrasada") permanece no criarNotificacao para manter
        // o sino igual.
        const eventId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
          ? crypto.randomUUID()
          : "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
        const sourceDeviceId = obterDeviceIdLocal();
        const canonicalType = tipo === "parcela_vencendo"
          ? EVENT_TYPES.INSTALLMENT_DUE_TODAY
          : EVENT_TYPES.INSTALLMENT_OVERDUE;

        // Central event + dispatch: best-effort, nao bloqueia o sino legado.
        // Falha de qualquer um so e logada.
        criarNotificationEvent({
          eventId,
          type: canonicalType,
          ownerId: ownerUid,
          sourceDeviceId,
          data: {
            contratoId: c.id,
            parcelaNumero: p.numero,
            valor,
            vencimentoISO: vStr,
            clienteNome: nomeCliente,
          },
          title: titulo,
          body: descricao,
        })
          .then(() =>
            dispatchNotificationEvent({
              eventId,
              sourceDeviceId,
            }).catch((err) => {
              console.warn("[notif-venc] dispatchNotificationEvent falhou (ignorado):", err && err.message);
            }),
          )
          .catch((err) => {
            console.warn("[notif-venc] criarNotificationEvent falhou (ignorado):", err && err.message);
          });

        // Notificacao legada (sino). Propaga eventId para dedup server-side.
        criarNotificacao(ownerUid, {
          tipo,
          titulo,
          descricao,
          contratoId: c.id,
          parcelaNumero: p.numero,
          valor,
          eventId,
        })
          .then(() => {
            mostrarNotificacaoNativa(titulo, descricao, {
              tipo,
              contratoId: c.id,
              parcelaNumero: p.numero,
              tag: `jurex:${tipo}:${c.id}:${p.numero}:${vStr}`,
            });
            disparadas += 1;
            statsRef.current.disparadas += 1;
          })
          .catch((err) => {
            // Não re-dispara nativa em caso de falha do Firestore.
            console.error(`[notif-venc] criarNotificacao(${tipo}):`, err?.code, err?.message);
          });
      }
    }

    statsRef.current.verificadas += verificadas;
    // Ciclo de detecção encerrado — silencioso (sem console.log por ciclo).
  }, [contratosAtivos, ownerUid]);

  // Retorno só para conveniência de debug em testes; não usar em render.
  return {
    get verificadas() {
      return statsRef.current.verificadas;
    },
    get disparadas() {
      return statsRef.current.disparadas;
    },
  };
}
