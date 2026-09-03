// Hook que detecta parcelas "vencendo hoje" e "atrasadas" no conjunto de
// contratos ATIVOS do usuário e dispara, para cada evento novo:
//
//   1. `criarNotificacao(uid, { tipo, titulo, descricao, contratoId,
//      parcelaNumero, valor })`  → 1 doc em `usuarios/{uid}/notificacoes`
//   2. `mostrarNotificacaoNativa(...)` (na success branch do (1))
//      → 1 toast nativo do Chrome/Windows
//
// REGRA DE DETECÇÃO: REUTILIZA 100% o que o sistema já calcula.
//   - `parcelasDoContrato(contrato, hoje)` é a MESMA função que o
//     Dashboard, Parcelas e Relatórios já chamam para renderizar.
//   - `parcela.status === "Pendente"` + `vencimento === DATA_HOJE`
//     → "vencendo" (mesma semântica do card "Parcelas de hoje" do
//     Dashboard.jsx:221-253).
//   - `parcela.status === "Vencida"` → "atrasada" (sinal canônico
//     definido em `src/utils/parcelasUtil.js:325, 352`).
//
// NENHUMA nova regra de datas é introduzida. Nenhum cálculo financeiro
// é tocado — `parcelasDoContrato` é chamada como função pura e seu
// resultado é apenas LIDO.
//
// DEDUPLICAÇÃO: 3 camadas (ver `src/utils/notificationDedup.js`).
//   - Set em memória (`notificacoesInSession`)  — O(1), cobre re-renders.
//   - localStorage (`Cred Facil:notif:<tipo>:<contratoId>:<parcelaNumero>:<vencimentoISO>`)
//     — cobre F5, logout/login, fechamento de aba.
//   - `tag` no Chrome (`Cred Facil:parcela_<estado>:<contratoId>:<parcelaNumero>:<vencimentoISO>`)
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
 * @param {Array} contratosAtivos - Contratos não quitados. Já é filtrado
 *   pelo Dashboard via `useMemo` em `Dashboard.jsx:122-125`.
 * @param {string|undefined|null} usuarioUid - `useAuth().usuario.uid`. Se
 *   ausente (deslogado), o hook é no-op.
 * @returns {{ verificadas: number, disparadas: number }} Contadores
 *   apenas para debug / log. NÃO usar em render — não causam re-render.
 */
export function useNotificadorVencimentos(contratosAtivos, usuarioUid) {
  // Contadores expostos via ref (não causam re-render). Servem só para
  // diagnóstico em dev — logados na primeira execução e em mudanças.
  const statsRef = useRef({ verificadas: 0, disparadas: 0 });

  useEffect(() => {
    // Guarda 1: precisa ter usuário autenticado.
    if (!usuarioUid) return;
    // Guarda 2: precisa ter contratos para inspecionar.
    if (!Array.isArray(contratosAtivos) || contratosAtivos.length === 0) return;

    const hoje = hojeISO();
    let verificadas = 0;
    let disparadas = 0;

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
        // Já paga? Nada a notificar.
        if (p?.status === "Paga") continue;

        const vStr = vencimentoISO(p);
        if (!vStr) continue;
        verificadas += 1;

        // Define o tipo de evento a partir do status canônico.
        // `parcela_vencendo` exige status Pendente + vencimento HOJE.
        // `parcela_atrasada` exige status Vencida (sinal canônico do
        // `parcelasUtil.js`).
        let tipo = null;
        if (p.status === "Vencida") {
          tipo = "parcela_atrasada";
        } else if (p.status === "Pendente" && vStr === hoje) {
          tipo = "parcela_vencendo";
        }
        if (!tipo) continue;

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

        // Mesma sequência dos outros 2 eventos:
        //   1) criarNotificacao (Firestore) — fire-and-forget
        //   2) NA success branch: mostrarNotificacaoNativa (best-effort)
        // Falha do (1) NÃO dispara o (2). Falha do (2) é silenciada
        // internamente por `mostrarNotificacaoNativa`.
        criarNotificacao(usuarioUid, {
          tipo,
          titulo,
          descricao,
          contratoId: c.id,
          parcelaNumero: p.numero,
          valor,
        })
          .then(() => {
            mostrarNotificacaoNativa(titulo, descricao, {
              tipo,
              contratoId: c.id,
              parcelaNumero: p.numero,
              tag: `Cred Facil:${tipo}:${c.id}:${p.numero}:${vStr}`,
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
    if (verificadas > 0) {
      // Log único por ciclo de detecção, para diagnóstico.
      console.log(
        "[notif-venc] ciclo de detecção:",
        "verificadas=",
        verificadas,
        "disparadas_neste_ciclo=",
        disparadas,
        "data_hoje=",
        hoje,
      );
    }
  }, [contratosAtivos, usuarioUid]);

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
