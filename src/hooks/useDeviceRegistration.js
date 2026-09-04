// Hook: registro do device + token FCM no backend de notificacoes.
//
// OBJETIVO: manter usuarios/{uid}/devices/{deviceId} sincronizado com
// o estado real do browser (FCM token + permissao) e desativar o vinculo
// FCM em logout. Chamadas de rede vao para /api/notifications/register-device
// (ver src/services/notificationEvents.js).
//
// deviceId: gerado uma vez no cliente e persistido no localStorage.
// O deviceId NAO e apagado em logout (continua no mesmo browser), apenas
// o vinculo FCM e desativado naquele uid. Isso garante que em login
// de outro user no mesmo browser nao ha cross-contamination: o doc do
// device vive no path do chamador autenticado (ver backend).
//
// dependencias externas (passadas via parametro para manter o hook puro):
//   - auth: instancia do Firebase Auth (./services/firebase)
//   - getMessagingFn: () => Messaging  (./services/firebase -> firebase/messaging)
//   - onAuthChange: () => unsubscribe  (AuthProvider.onAuthStateChanged)

import { useEffect, useRef, useState } from "react";
import { getToken } from "firebase/messaging";
import { registrarMeuDevice } from "../services/notificationEvents";

const STORAGE_KEY = "jurex:device:id";
const LOG_PREFIX = "[device-reg]";
// Prefixo de logs seguros para o fluxo FCM. NAO expoe a VAPID nem o token.
const FCM_PREFIX = "[FCM]";
// Evento customizado disparado por Perfil.jsx apos o usuario conceder
// permissao de notificacoes. O hook escuta para re-tentar getToken +
// registrarMeuDevice. Tambem cobrimos o caso de permissionchange via
// Permissions API (cadeado do Chrome).
const REENVIAR_EVENT = "jurex:notif:reenviar-device";

// Gera UUID v4 usando crypto.randomUUID (disponivel em browsers modernos).
// Fallback: timestamp + random, suficiente para unicidade pratica.
function gerarDeviceId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return "dev-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

// Le o deviceId persistido ou cria um novo. Idempotente.
function obterOuCriarDeviceId() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const existente = window.localStorage.getItem(STORAGE_KEY);
      if (existente && existente.length > 0 && existente.length <= 200) {
        return existente;
      }
    }
  } catch {
    // localStorage indisponivel (modo privado Safari). Gera um na sessao.
  }
  const novo = gerarDeviceId();
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, novo);
    }
  } catch {
    // ignore
  }
  return novo;
}

// Detecta o tipo do device a partir do userAgent. Simples e suficiente
// para roteamento e UI - nao usa feature detection cara.
function detectarTipo(ua) {
  if (!ua) return "other";
  if (/iPad|Tablet/.test(ua)) return "tablet";
  if (/Android|Mobile|iPhone|iPod/.test(ua)) return "mobile";
  if (/Windows NT|Macintosh|Linux x86/.test(ua)) return "desktop";
  return "other";
}

// String curta de plataforma para o campo `platform` do device.
function detectarPlatform() {
  try {
    if (typeof navigator === "undefined") return "";
    const ua = navigator.userAgent || "";
    const plat = navigator.platform || "";
    return (plat + " | " + ua).slice(0, 200);
  } catch {
    return "";
  }
}

// Checa se o browser suporta a API minima necessaria.
function suportado() {
  return typeof window !== "undefined"
    && "Notification" in window
    && "serviceWorker" in navigator
    && typeof navigator.serviceWorker !== "undefined";
}

// Hook publico. Recebe as dependencias por parametro para evitar
// acoplamento direto com a inicializacao do Firebase e do AuthProvider.
//
// Comportamento:
//   1. No mount: pega/cria o deviceId no localStorage.
//   2. Quando o usuario loga (onAuthChange dispara com user): se a
//      permissao for "granted", pega o FCM token e chama
//      registrarMeuDevice com o token + enabled=true.
//   3. Quando o usuario desloga (onAuthChange dispara com null):
//      chama deleteToken() no Firebase Messaging e depois
//      registrarMeuDevice com fcmToken: null, enabled=false. Isso
//      desativa o vinculo FCM apenas no path daquele uid
//      (usuarios/{uidQueSaiu}/devices/{deviceId}), sem afetar
//      outros devices.
//   4. Em qualquer erro de rede, loga e segue - o hook nunca
//      quebra a aplicacao.
export function useDeviceRegistration({ auth, getMessagingFn, onAuthChange }) {
  // deviceId gerado/persistido uma unica vez no primeiro render via
  // lazy initializer do useState. Estavel entre renders, sem acessar
  // .current de ref em tempo de render.
  const [deviceId] = useState(obterOuCriarDeviceId);
  // Snapshot estavel do deviceId para uso dentro de callbacks (logout).
  // Inicializado com o proprio deviceId; NAO atualizado em render.
  const deviceIdForLogoutRef = useRef(deviceId);
  // Refs usadas pelos listeners de reativacao (permissionchange +
  // CustomEvent). Atualizadas dentro de enviarEstado; NAO disparam
  // re-render. Mantemos o user atual e a permissao atual para que
  // o listener saiba se faz sentido re-tentar getToken.
  const currentUserRef = useRef(null);
  const currentPermissionRef = useRef("default");

  useEffect(() => {
    if (typeof onAuthChange !== "function") return undefined;
    if (!suportado()) return undefined;

    // Envia o estado atual do device para o backend.
    // - logado + granted: fcmToken + enabled=true
    // - deslogado: fcmToken=null + enabled=false
    //   (o deviceId do localStorage permanece; o doc e desativado apenas
    //   no path do uid que saiu).
    const enviarEstado = async (user, opts) => {
      const type = detectarTipo(typeof navigator !== "undefined" ? navigator.userAgent : "");
      const platform = detectarPlatform();
      const permission = (opts && opts.permission)
        || (typeof Notification !== "undefined" ? Notification.permission : "default");
      const enabled = !!(user && permission === "granted");
      // Atualiza refs para que os listeners de reativacao
      // (permissionchange + REENVIAR_EVENT) saibam o estado atual.
      currentUserRef.current = user || null;
      currentPermissionRef.current = permission;
      let fcmToken = null;
      if (user && enabled) {
        try {
          // Le a VAPID key (constante em build-time). Loga apenas
          // se esta configurada e o comprimento - nunca o valor.
          const vapidKey = (typeof import.meta !== "undefined" && import.meta.env)
            ? import.meta.env.VITE_FIREBASE_VAPID_KEY || ""
            : "";
          const vapidConfigured = typeof vapidKey === "string" && vapidKey.length > 0;
          if (!vapidConfigured) {
            // silencioso: VAPID ausente — fluxo FCM fica desativado, sem ruído no console
          } else {
            // getToken exige que o SW esteja controlando a pagina.
            // Aguarda readiness uma vez (idempotente). Se o SW ja
            // estiver pronto, resolve imediato. Guardamos a referencia
            // do ServiceWorkerRegistration retornado por `.ready` para
            // passar explicitamente ao getToken() abaixo - isso impede
            // que o SDK tente registrar o SW padrao do Firebase
            // (`/firebase-messaging-sw.js`, que NAO existe no projeto)
            // e dispare `messaging/failed-service-worker-registration`.
            let serviceWorkerRegistration = null;
            try {
              if (typeof navigator !== "undefined"
                && navigator.serviceWorker
                && typeof navigator.serviceWorker.ready !== "undefined") {
                serviceWorkerRegistration = await navigator.serviceWorker.ready;
              } else {
                // SW não disponível — sem ruído
              }
            } catch {
              // SW falhou — silencioso (console.error seria excessivo)
            }
            const messaging = getMessagingFn();
            // API modular do Firebase v12: getToken(messaging, options) e
            // uma FUNCAO importada de firebase/messaging, NAO um metodo
            // da instancia de Messaging. Chamar messaging.getToken(...)
            // resulta em "e.getToken is not a function".
            //
            // Passamos `serviceWorkerRegistration` (o SW do projeto,
            // registrado em src/main.jsx como `/sw.js?v=jurex-sw-v3`)
            // para impedir que o SDK procure/registre o SW padrao do
            // Firebase em `/firebase-messaging-sw.js`.
            const getTokenOptions = { vapidKey };
            if (serviceWorkerRegistration) {
              getTokenOptions.serviceWorkerRegistration = serviceWorkerRegistration;
            }
            fcmToken = await getToken(messaging, getTokenOptions);
          }
        } catch {
          // getToken falhou — silencioso (mantém fallback para fcmToken=null)
        }
      }
      const res = await registrarMeuDevice({
        deviceId: opts && opts.deviceId ? opts.deviceId : deviceIdForLogoutRef.current,
        type,
        platform,
        fcmToken,
        notificationsEnabled: enabled,
      });
      if (res && res.ok === true) {
        // registro ok — silencioso
      }
      // Falha no register-device: silenciosa. O usuário não precisa ver no console;
      // o backend já registra o motivo. Mantém fluxo intacto.
      return res;
    };

    // Snapshot do deviceId no momento da subscription.
    const deviceIdSnap = deviceIdForLogoutRef.current;

    const unsubscribe = onAuthChange(async (user) => {
      try {
        const permission = (typeof Notification !== "undefined")
          ? Notification.permission
          : "default";
        if (user) {
          await enviarEstado(user, { permission, deviceId: deviceIdSnap });
        } else {
          // Logout: tenta apagar o token do Firebase Messaging primeiro
          // (idempotente - se nao existir, ignora).
          try {
            if (typeof getMessagingFn === "function") {
              const messaging = getMessagingFn();
              if (messaging && typeof messaging.deleteToken === "function") {
                await messaging.deleteToken();
              }
            }
          } catch (err) {
            const msg = err && err.message;
            console.warn(LOG_PREFIX, "deleteToken falhou (ignorado):", msg);
          }
          await enviarEstado(null, { permission: "default", deviceId: deviceIdSnap });
        }
      } catch (err) {
        const msg = err && err.message;
        console.warn(LOG_PREFIX, "erro no onAuthChange (ignorado):", msg);
      }
    });

    // === REATIVACAO APOS CONCESSAO DE PERMISSAO (P0 FCM) ===
    //
    // O hook reage ao onAuthStateChanged (cima) E a dois sinais
    // adicionais que cobrem o caso comum em que o usuario loga com
    // permissao "default" e so depois clica em "Ativar notificacoes
    // push" no Perfil:
    //
    //   1. Permissions API (navigator.permissions.query): emite
    //      'change' quando o status muda (ex: usuario clica no
    //      cadeado do Chrome e alterna). Suportado em Chrome/Edge;
    //      Firefox pode nao implementar "notifications" - por isso
    //      o sinal 2 e o principal.
    //
    //   2. CustomEvent 'jurex:notif:reenviar-device' no window.
    //      Disparado por Perfil.jsx apos o popup resolver com
    //      "granted". Funciona em todos os browsers e e o sinal
    //      canonico no fluxo atual.
    //
    // Em QUALQUER um dos dois, lemos a permissao ATUAL (font of
    // truth) e re-chamamos enviarEstado(user, { permission }). Se
    // nao houver user logado, apenas atualizamos a ref.
    const reativar = async () => {
      try {
        const perm = (typeof Notification !== "undefined")
          ? Notification.permission
          : "default";
        currentPermissionRef.current = perm;
        const u = currentUserRef.current;
        if (perm === "granted" && u) {
          await enviarEstado(u, { permission: perm, deviceId: deviceIdSnap });
        }
      } catch (err) {
        const msg = err && err.message;
        console.warn(FCM_PREFIX, "reativacao falhou (ignorado):", msg);
      }
    };

    // Permissions API - pode nao existir (Safari) ou rejeitar
    // (Firefox para "notifications"). Capturamos tudo.
    let permissionStatus = null;
    let onPermissionChangeHandler = null;
    if (typeof navigator !== "undefined"
      && navigator.permissions
      && typeof navigator.permissions.query === "function") {
      try {
        navigator.permissions
          .query({ name: "notifications" })
          .then((status) => {
            permissionStatus = status;
            onPermissionChangeHandler = () => {
              // Sem await - listener deve ser sincrono.
              reativar();
            };
            if (status && typeof status.addEventListener === "function") {
              status.addEventListener("change", onPermissionChangeHandler);
            }
          })
          .catch(() => {
            // Sem suporte - o CustomEvent cobre o caso.
          });
      } catch {
        // ignore
      }
    }

    // CustomEvent disparado por Perfil.jsx apos o usuario clicar
    // em "Ativar notificacoes push" e o popup resolver com "granted".
    if (typeof window !== "undefined") {
      window.addEventListener(REENVIAR_EVENT, reativar);
    }

    return () => {
      try {
        if (typeof unsubscribe === "function") unsubscribe();
      } catch (err) {
        const msg = err && err.message;
        console.warn(LOG_PREFIX, "unsubscribe onAuthChange falhou:", msg);
      }
      // Cleanup do listener da Permissions API.
      if (permissionStatus
        && typeof onPermissionChangeHandler === "function"
        && typeof permissionStatus.removeEventListener === "function") {
        try {
          permissionStatus.removeEventListener("change", onPermissionChangeHandler);
        } catch {
          // ignore
        }
      }
      // Cleanup do listener do CustomEvent.
      if (typeof window !== "undefined") {
        try {
          window.removeEventListener(REENVIAR_EVENT, reativar);
        } catch {
          // ignore
        }
      }
    };
  }, [auth, getMessagingFn, onAuthChange]);
}
