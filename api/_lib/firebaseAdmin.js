// Inicialização única do Firebase Admin SDK para uso server-side.
//
// O Vercel mantém a function "quente" entre invocações. Para evitar
// re-inicializar o app a cada request (o que gera warning e gasta CPU),
// guardamos o app em um singleton no escopo do módulo.
//
// Variáveis de ambiente necessárias (configurar no painel da Vercel
// ou em `.env.local` durante dev):
//   - FIREBASE_PROJECT_ID
//   - FIREBASE_CLIENT_EMAIL
//   - FIREBASE_PRIVATE_KEY
//
// A `FIREBASE_PRIVATE_KEY` vem com `\n` literais quando copiada do
// console do Google Cloud; aqui substituímos por quebras de linha reais
// para que o SDK consiga parsear a chave PEM.

import { cert, getApps, initializeApp } from "firebase-admin/app";

let cachedApp = null;

export function getFirebaseAdmin() {
  if (cachedApp) return cachedApp;
  if (getApps().length > 0) {
    cachedApp = getApps()[0];
    return cachedApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  // Falha explícita (não loga a chave) — sem env vars, a função não
  // tem como se autenticar no Firebase. Quem opera precisa configurar.
  const missing = [];
  if (!projectId) missing.push("FIREBASE_PROJECT_ID");
  if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
  if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY");
  if (missing.length > 0) {
    const err = new Error(
      `Firebase Admin não configurado. Faltam variáveis de ambiente: ${missing.join(", ")}.`,
    );
    err.code = "FIREBASE_ADMIN_MISSING_ENV";
    throw err;
  }

  cachedApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      // A chave chega como string com "\\n" — transformamos em quebras
      // de linha reais para o PEM ser válido.
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
  });
  return cachedApp;
}
