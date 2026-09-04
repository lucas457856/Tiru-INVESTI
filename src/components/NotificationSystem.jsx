// Componente wrapper que monta os hooks de notificacao da Fase B
// (useDeviceRegistration + useNotificationDispatcher) dentro do
// AuthProvider, sem renderizar nada na UI.
//
// Por que existe:
//   - useDeviceRegistration precisa do Firebase Auth + Messaging e
//     do onAuthStateChanged para reagir a login/logout. Ele nao pode
//     ser chamado direto no App.jsx porque o AuthProvider ainda nao
//     existe nesse nivel.
//   - useNotificationDispatcher precisa do Messaging para registrar
//     o onMessage em foreground. Idem: precisa rodar dentro de um
//     React subtree que ja tenha os providers prontos.
//   - Este componente NAO e visivel (renderiza null) e so existe
//     para hospedar os dois hooks com seguranca.
//
// Fase B: registra o device, escuta FCM em foreground, dispara
// notificacao nativa local. NAO cria doc in-app (Fase C).

import { useMemo } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getMessaging } from "firebase/messaging";
import { auth as firebaseAuth, app as firebaseApp } from "../services/firebase";
import { useDeviceRegistration } from "../hooks/useDeviceRegistration";
import { useNotificationDispatcher } from "../hooks/useNotificationDispatcher";

// Subcomponente interno: registra o device e escuta FCM em foreground.
// Recebe as dependencias estaveis via props para nao recriar a cada
// render do pai.
function NotificationSystemInner() {
  // getMessagingFn estavel: mesma referencia entre renders.
  // Retorna a instancia singleton de Firebase Messaging para o app
  // ja inicializado em src/services/firebase.js.
  const getMessagingFn = useMemo(() => {
    return function getMessagingInstance() {
      return getMessaging(firebaseApp);
    };
  }, []);

  // useDeviceRegistration: usa o proprio onAuthStateChanged do Firebase.
  // Cada chamada a onAuthChange registra um listener; o cleanup eh
  // feito pelo proprio hook no return do useEffect interno.
  useDeviceRegistration({
    auth: firebaseAuth,
    getMessagingFn,
    onAuthChange: function subscribeAuth(cb) {
      return onAuthStateChanged(firebaseAuth, cb);
    },
  });

  // useNotificationDispatcher: escuta onMessage em foreground.
  useNotificationDispatcher({ getMessagingFn });

  return null;
}

// Componente publico: montado em App.jsx dentro do AuthProvider.
// Nao renderiza nada. Hospeda os hooks de notificacao.
export default function NotificationSystem() {
  return <NotificationSystemInner />;
}
