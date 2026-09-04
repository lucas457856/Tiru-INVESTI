// Hook: escuta mensagens FCM em foreground (aba aberta) e dispara a
// notificação nativa local. O backend (api/notifications/dispatch.js)
// ja garante que o device originador NAO recebe push (regra de
// "originator" no dispatch), entao este hook cobre o caso:
// "outro device do mesmo usuario disparou um evento e o FCM chegou
// nesta aba aberta".
//
// IMPORTANTE (Fase B): este hook NAO cria doc in-app em
// usuarios/{uid}/notificacoes. A integração com o sino/notificacoes
// via criarNotificacao fica para a Fase C (regras de dedup por
// eventId ja estao prontas em notificationDedup.js).
//
// DEDUP: 3 camadas (ver src/utils/notificationDedup.js).
//   - Set em memoria (cobre re-renders do mesmo mount)
//   - localStorage chave jurex:notif:event:<eventId> (cobre F5)
//   - tag do Chrome (cobre toast visual repetido)
//
// dependencia externa passada por parametro para manter o hook puro:
//   - getMessagingFn: () => Messaging  (./services/firebase -> firebase/messaging)

import { useEffect, useRef } from "react";
import { mostrarNotificacaoNativa } from "../utils/notifications";
import {
  eventoJaNotificadoPorEventId,
  marcarNotificadoPorEventId,
} from "../utils/notificationDedup";

const LOG_PREFIX = "[notif-disp]";

// Extrai o eventId e o payload do message.data do FCM. Pode vir
// como string (FCM envia tudo como string) ou ja como objeto (em
// alguns SDKs/compat). Normaliza para { eventId, type, data }.
function extrairPayload(message) {
  if (!message || typeof message !== "object") return null;
  const data = message.data || {};
  let eventId = "";
  let type = "";
  let inner = {};
  if (typeof data === "object" && data !== null) {
    eventId = typeof data.eventId === "string" ? data.eventId : "";
    type = typeof data.type === "string" ? data.type : "";
    const rawPayload = data.payload;
    if (typeof rawPayload === "string" && rawPayload.length > 0) {
      try {
        const parsed = JSON.parse(rawPayload);
        if (parsed && typeof parsed === "object") inner = parsed;
      } catch {
        // payload nao era JSON - mantem vazio
      }
    } else if (rawPayload && typeof rawPayload === "object") {
      inner = rawPayload;
    }
  }
  const notification = message.notification || {};
  const title = typeof notification.title === "string"
    ? notification.title
    : "Atualizacao";
  const body = typeof notification.body === "string" ? notification.body : "";
  return { eventId, type, data: inner, title, body };
}

// Hook publico. Recebe getMessagingFn por parametro para evitar
// acoplamento direto com a inicializacao do Firebase.
//
// Comportamento:
//   1. No mount, obtem a instancia de messaging e registra um
//      listener de onMessage (foreground).
//   2. Para cada mensagem:
//      a. extrai eventId, type, data, title, body
//      b. dedup por eventId (Set em memoria + localStorage)
//      c. se novo, mostra a notificacao nativa local
//   3. No unmount, desinscreve o listener.
//   4. Erros sao logados e ignorados - o hook nunca quebra a UI.
//
// Fase B: nao cria doc in-app (Fase C).
export function useNotificationDispatcher({ getMessagingFn }) {
  // Mantem o unsubscribe estavel entre renders sem causar re-render.
  const unsubRef = useRef(null);

  useEffect(() => {
    if (typeof getMessagingFn !== "function") return undefined;
    let messaging;
    try {
      messaging = getMessagingFn();
    } catch (err) {
      const msg = err && err.message;
      console.warn(LOG_PREFIX, "getMessaging falhou:", msg);
      return undefined;
    }
    if (!messaging || typeof messaging.onMessage !== "function") {
      return undefined;
    }

    const onMessage = (payload) => {
      try {
        const parsed = extrairPayload(payload);
        if (!parsed) return;
        const { eventId, type, title, body } = parsed;
        // Sem eventId: nao conseguimos deduplicar com seguranca.
        // Mantemos a notificacao nativa (UX), mas sem marcar dedup.
        if (eventId) {
          if (eventoJaNotificadoPorEventId(eventId)) return;
          marcarNotificadoPorEventId(eventId);
        }
        const tag = eventId
          ? "jurex:notif:" + (type || "evt") + ":" + eventId
          : "jurex:notif:" + (type || "evt") + ":" + Date.now();
        mostrarNotificacaoNativa(title, body, {
          tipo: type || "evt",
          tag,
        });
      } catch (err) {
        const msg = err && err.message;
        console.warn(LOG_PREFIX, "onMessage handler falhou:", msg);
      }
    };

    let unsubscribe;
    try {
      unsubscribe = messaging.onMessage(onMessage);
    } catch (err) {
      const msg = err && err.message;
      console.warn(LOG_PREFIX, "onMessage subscribe falhou:", msg);
      return undefined;
    }
    unsubRef.current = typeof unsubscribe === "function"
      ? unsubscribe
      : null;

    return () => {
      try {
        if (typeof unsubRef.current === "function") {
          unsubRef.current();
        }
      } catch (err) {
        const msg = err && err.message;
        console.warn(LOG_PREFIX, "unsubscribe falhou:", msg);
      }
      unsubRef.current = null;
    };
  }, [getMessagingFn]);
}
