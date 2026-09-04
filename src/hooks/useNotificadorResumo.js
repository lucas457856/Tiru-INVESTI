// Hook que dispara DUAS notificações agregadas (1× por dia por usuário):
//
//   1. "📊 Resumo dos seus contratos"
//      "{N} contratos ativos"  — onde N = contratos NÃO quitados do usuário.
//
//   2. "Você tem {N} parcelas para receber hoje"
//      "Total a receber: R$ {VALOR}"  — onde N = parcelas pendentes com
//      vencimento HOJE, e VALOR = soma de `parcela.valor` dessas parcelas.
//
// REGRAS:
//   - Reutiliza EXATAMENTE o que o Dashboard já calcula:
//     * `contratosAtivos` = `contratos.filter(c => !c.quitado)` (Dashboard.jsx:162).
//     * `parcelasDoContrato(c, new Date())` — fonte canônica de parcelas
//       (já com overrides, abatimentos e juros aplicados).
//     * `parcela.status === "Paga"` filtra parcelas já quitadas.
//     * `parcela.vencimento === DATA_HOJE` (string ISO) seleciona "hoje".
//   - NÃO altera regras de status, juros, contratos, layout ou banco.
//   - NÃO cria novos tipos de notificação visual — apenas dispara
//     `criarNotificacao` + `criarNotificationEvent` + `mostrarNotificacaoNativa`
//     com o mesmo pipeline do `useNotificadorVencimentos`.
//   - DEDUPLICAÇÃO: 3 camadas (Set em memória + localStorage + tag Chrome),
//     via `notificationDedup.js`. Chave inclui o `hojeISO` para que
//     "hoje" mude naturalmente no dia seguinte — sem reset manual.
//
// SEGURANÇA:
//   - ownerUid é SEMPRE passado pelo chamador (Dashboard) e vem de
//     `useEffectiveUid()` — resolve DONO (proprietário) vs FUNCIONARIO
//     (vinculado). O `criarNotificacao` grava em `usuarios/{ownerUid}/...`
//     e o backend (`api/notifications/register-event.js`) IGNORA o
//     `ownerId` enviado no body, derivando do token. Cada usuário só
//     recebe os próprios dados.
//
// QUANDO RODA: num `useEffect([contratosAtivos, ownerUid, carregando])`.
// Sem `setInterval`, sem `setTimeout`. Reage ao `onSnapshot` de contratos.
// O parâmetro `carregando` impede disparo durante a primeira carga
// (quando `contratosAtivos` ainda é `[]` por loading).
//
// FREQUÊNCIA:
//   - Mesmo dia, mesma aba, re-render/F5 → 1 notificação (dedup localStorage).
//   - Dia seguinte → nova chave → nova notificação.
//   - Outro device do mesmo ownerUid → recebe via FCM (regra de "originator"
//     em `api/notifications/dispatch.js:275` SÓ exclui PAYMENT_REGISTERED;
//     CONTRACTS_SUMMARY e INSTALLMENTS_DUE_TODAY_SUMMARY são distribuídos
//     normalmente para todos os devices do ownerUid).

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

// "YYYY-MM-DD" no fuso do browser (mesma definição do Dashboard.jsx:59-62
// e do useNotificadorVencimentos). Calculado uma vez por execução do
// effect — não no escopo do módulo, porque o efeito pode rodar dias
// depois da primeira carga da página (aba em background, etc.).
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Normaliza `parcela.vencimento` (Date OU "YYYY-MM-DD") para string ISO
// canônica. Retorna `null` se não for possível normalizar.
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

// Tipos legados (in-app sino) para os dois eventos novos. Mantém o
// mesmo padrão dos tipos já existentes (`parcela_vencendo`,
// `parcela_atrasada`, `resumo_contratos`). Texto curto e estável para
// o body da notificação nativa + entrada na lista de notificações.
const TIPO_SINO_RESUMO = "resumo_contratos";
const TIPO_SINO_PARCELAS_HOJE = "parcelas_para_receber_hoje";

// Textos visíveis. Nenhum literal hardcoded para valor/quantidade —
// o template é montado em runtime a partir dos dados reais.
const TEXTOS = {
  [TIPO_SINO_RESUMO]: {
    titulo: "📊 Resumo dos seus contratos",
    corpo: (quantidade) => `${quantidade} ${quantidade === 1 ? "contrato ativo" : "contratos ativos"}`,
  },
  [TIPO_SINO_PARCELAS_HOJE]: {
    titulo: (quantidade) =>
      `Você tem ${quantidade} ${quantidade === 1 ? "parcela para receber hoje" : "parcelas para receber hoje"}`,
    corpo: (total) => `Total a receber: ${formatarMoeda(total)}`,
  },
};

/**
 * Conta contratos ATIVOS (não quitados). Função PURA — sem efeitos
 * colaterais. Lida com inputs malformados (null, undefined, NaN).
 *
 * @param {Array} contratos
 * @returns {number}
 */
export function contarContratosAtivos(contratos) {
  if (!Array.isArray(contratos)) return 0;
  return contratos.filter((c) => c && !c.quitado).length;
}

/**
 * Calcula as parcelas PENDENTES com vencimento HOJE e o total a receber
 * somando o `valor` dessas parcelas. Função PURA — sem relógio do
 * sistema (recebe `hojeISO` como argumento).
 *
 * @param {Array} contratosAtivos
 * @param {string} hojeISO - "YYYY-MM-DD" no fuso do browser.
 * @returns {{ quantidade: number, total: number, parcelas: Array }}
 */
export function calcularParcelasParaReceberHoje(contratosAtivos, hojeISO) {
  const lista = [];
  let total = 0;
  if (!Array.isArray(contratosAtivos)) {
    return { quantidade: 0, total: 0, parcelas: lista };
  }
  for (const c of contratosAtivos) {
    let ps;
    try {
      ps = parcelasDoContrato(c, new Date());
    } catch (err) {
      // Falha isolada em 1 contrato não derruba o cálculo dos outros.
      // Mantém comportamento defensivo idêntico ao useNotificadorVencimentos.
      console.warn("[notif-resumo] parcelasDoContrato falhou para", c?.id, err?.message);
      continue;
    }
    if (!Array.isArray(ps)) continue;
    for (const p of ps) {
      // Ignora parcelas já pagas, quitadas, ou qualquer estado que não
      // seja "Pendente" / "Vencida" — só conta o que REALMENTE precisa
      // ser recebido. A correção anterior (useNotificadorVencimentos) já
      // documenta que `Paga` é o estado terminal.
      if (p?.status === "Paga") continue;
      const vStr = vencimentoISO(p);
      if (!vStr) continue;
      if (vStr !== hojeISO) continue;
      const valor = Number(p.valor) || 0;
      lista.push({
        contratoId: c.id,
        parcelaNumero: p.numero,
        valor,
        vencimentoISO: vStr,
      });
      total += valor;
    }
  }
  // Arredonda o total para 2 casas (consistência com formatarMoeda).
  return {
    quantidade: lista.length,
    total: Math.round(total * 100) / 100,
    parcelas: lista,
  };
}

/**
 * Hook que dispara (1× por dia) as duas notificações agregadas do
 * usuário: resumo de contratos ativos + parcelas para receber hoje.
 *
 * @param {Array} contratosAtivos - Contratos não quitados (já filtrado
 *   pelo Dashboard via `useMemo`).
 * @param {string|undefined|null} ownerUid - UID efetivo (useEffectiveUid).
 *   Para DONO = próprio uid; para FUNCIONARIO = ownerUid vinculado.
 * @param {boolean} [carregando=false] - Quando `true`, hook é no-op
 *   para não disparar "0 contratos ativos" antes do `onSnapshot`
 *   carregar os dados reais.
 */
export function useNotificadorResumo(contratosAtivos, ownerUid, carregando = false) {
  const statsRef = useRef({ disparadas: 0 });

  useEffect(() => {
    if (!ownerUid) return;
    // Não dispara durante a primeira carga do snapshot de contratos —
    // evita o falso "0 contratos ativos" antes dos dados reais chegarem.
    if (carregando) return;
    if (!Array.isArray(contratosAtivos)) return;

    const hoje = hojeISO();
    const sourceDeviceId = obterDeviceIdLocal();

    // === NOTIFICAÇÃO 1: Resumo dos contratos ativos ===================
    const qtdContratos = contarContratosAtivos(contratosAtivos);
    // Chave estável por dia: se o usuário abrir o app no dia seguinte,
    // `hoje` muda, a chave muda e a notificação é re-disparada.
    const chaveResumo = chaveNotificacao(TIPO_SINO_RESUMO, ownerUid, "resumo", hoje);
    if (!eventoJaNotificado(chaveResumo)) {
      const tituloResumo = TEXTOS[TIPO_SINO_RESUMO].titulo;
      const corpoResumo = TEXTOS[TIPO_SINO_RESUMO].corpo(qtdContratos);
      // Marca ANTES de chamar o Firestore (defesa contra re-render
      // concorrente durante a latência da escrita).
      marcarNotificado(chaveResumo);
      dispararNotificacao({
        ownerUid,
        sourceDeviceId,
        tipoSino: TIPO_SINO_RESUMO,
        tipoCanonico: EVENT_TYPES.CONTRACTS_SUMMARY,
        titulo: tituloResumo,
        corpo: corpoResumo,
        data: {
          ownerUid,
          quantidadeContratosAtivos: qtdContratos,
          dataReferenciaISO: hoje,
        },
        tagNativa: `jurex:${TIPO_SINO_RESUMO}:${ownerUid}:${hoje}`,
        onDisparada: () => {
          statsRef.current.disparadas += 1;
        },
      });
    }

    // === NOTIFICAÇÃO 2: Parcelas para receber hoje ====================
    const { quantidade, total, parcelas } = calcularParcelasParaReceberHoje(
      contratosAtivos,
      hoje,
    );
    const chaveParcelas = chaveNotificacao(
      TIPO_SINO_PARCELAS_HOJE,
      ownerUid,
      "parcelas-hoje",
      hoje,
    );
    if (!eventoJaNotificado(chaveParcelas)) {
      // Se não há parcelas HOJE, NÃO dispara (não queremos ruído
      // desnecessário). Mantém semântica de "sistema te avisa só
      // quando tem algo pra fazer".
      if (quantidade > 0) {
        const tituloParcelas = TEXTOS[TIPO_SINO_PARCELAS_HOJE].titulo(quantidade);
        const corpoParcelas = TEXTOS[TIPO_SINO_PARCELAS_HOJE].corpo(total);
        marcarNotificado(chaveParcelas);
        dispararNotificacao({
          ownerUid,
          sourceDeviceId,
          tipoSino: TIPO_SINO_PARCELAS_HOJE,
          tipoCanonico: EVENT_TYPES.INSTALLMENTS_DUE_TODAY_SUMMARY,
          titulo: tituloParcelas,
          corpo: corpoParcelas,
          data: {
            ownerUid,
            dataReferenciaISO: hoje,
            quantidadeParcelasHoje: quantidade,
            totalReceberHoje: total,
            // Lista resumida (apenas IDs/números/valores) — NÃO inclui
            // dados de outros usuários. Limite de tamanho seguro para FCM.
            parcelas: parcelas.slice(0, 50).map((p) => ({
              contratoId: p.contratoId,
              parcelaNumero: p.parcelaNumero,
              valor: p.valor,
              vencimentoISO: p.vencimentoISO,
            })),
          },
          tagNativa: `jurex:${TIPO_SINO_PARCELAS_HOJE}:${ownerUid}:${hoje}`,
          onDisparada: () => {
            statsRef.current.disparadas += 1;
          },
        });
      }
    }
  }, [contratosAtivos, ownerUid, carregando]);

  return {
    get disparadas() {
      return statsRef.current.disparadas;
    },
  };
}

// Helper interno: dispara a notificação nos 3 canais (evento central +
// in-app + nativa local) seguindo o pipeline de useNotificadorVencimentos.
// Best-effort: falhas em qualquer canal são logadas mas não interrompem
// os outros.
function dispararNotificacao({
  ownerUid,
  sourceDeviceId,
  tipoSino,
  tipoCanonico,
  titulo,
  corpo,
  data,
  tagNativa,
  onDisparada,
}) {
  const eventId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);

  // Evento central + dispatch (FCM) — best-effort, não bloqueia o sino.
  criarNotificationEvent({
    eventId,
    type: tipoCanonico,
    ownerId: ownerUid,
    sourceDeviceId,
    data,
    title: titulo,
    body: corpo,
  })
    .then(() =>
      dispatchNotificationEvent({ eventId, sourceDeviceId }).catch((err) => {
        console.warn("[notif-resumo] dispatch falhou (ignorado):", err && err.message);
      }),
    )
    .catch((err) => {
      console.warn("[notif-resumo] criarNotificationEvent falhou (ignorado):", err && err.message);
    });

  // In-app notif (sino + lista). Propaga eventId para dedup server-side
  // (criarNotificacao checa se já existe doc com mesmo eventId).
  criarNotificacao(ownerUid, {
    tipo: tipoSino,
    titulo,
    descricao: corpo,
    eventId,
  })
    .then(() => {
      // Toast nativo local — funciona no PC (Notification API) e no
      // mobile (Service Worker registration.showNotification, ver
      // utils/notifications.js). Mesmo pipeline da notificação
      // de parcela atrasada.
      mostrarNotificacaoNativa(titulo, corpo, {
        tipo: tipoSino,
        tag: tagNativa,
      });
      if (typeof onDisparada === "function") onDisparada();
    })
    .catch((err) => {
      console.error(`[notif-resumo] criarNotificacao(${tipoSino}):`, err?.code, err?.message);
    });
}
