// Firebase (App, Auth e Firestore)
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC6StDHxZn5VakxH1MDqiYDKAGx6f1QLJg",
  authDomain: "agt-controller3.firebaseapp.com",
  projectId: "agt-controller3",
  storageBucket: "agt-controller3.firebasestorage.app",
  messagingSenderId: "1015891452736",
  appId: "1:1015891452736:web:42c93a93415ecda4cf90a5",
  measurementId: "G-5NSDLRRKZ9",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Habilita cache persistente nativo do Firestore (IndexedDB) com
// sincronização entre múltiplas tabs. Reduz drasticamente as leituras
// em reload/offline — o SDK resolve snapshots do cache local antes
// de consultar o backend. API recomendada (v9+); `enableIndexedDbPersistence`
// está deprecated. Ver `node_modules/@firebase/firestore/dist/firestore/
// src/api/cache_config.d.ts` para a tipagem.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
