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
import { registrarMeuDevice } from "../services/notificationEvents";

const STORAGE_KEY = "jurex:device:id";
const LOG_PREFIX = "[device-reg]";

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
      const enabled = !!(user && opts && opts.permission === "granted");
      let fcmToken = null;
      if (user && enabled) {
        try {
          const messaging = getMessagingFn();
          const vapidKey = (typeof import.meta !== "undefined" && import.meta.env)
            ? import.meta.env.VITE_FIREBASE_VAPID_KEY
            : "";
          if (!vapidKey) {
            console.warn(LOG_PREFIX, "VITE_FIREBASE_VAPID_KEY nao definida; pulando getToken.");
          } else {
            fcmToken = await messaging.getToken({ vapidKey });
          }
        } catch (err) {
          const code = err && err.code;
          const msg = err && err.message;
          console.warn(LOG_PREFIX, "getToken falhou:", code, msg);
        }
      }
      const res = await registrarMeuDevice({
        deviceId: opts && opts.deviceId ? opts.deviceId : deviceIdForLogoutRef.current,
        type,
        platform,
        fcmToken,
        notificationsEnabled: enabled,
      });
      if (!res || res.ok !== true) {
        console.warn(LOG_PREFIX, "register-device falhou:", res && res.erro);
      }
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

    return unsubscribe;
  }, [auth, getMessagingFn, onAuthChange]);
}
