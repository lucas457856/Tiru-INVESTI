// Helpers HTTP compartilhados por TODAS as Serverless Functions.
//
// Centraliza o que estava duplicado em 12 dos 13 handlers:
//   - bad(res, prefix, status, erro, extra) → resposta JSON de erro padronizada
//   - extrairBearer(req) → token do header Authorization
//   - getAdminSdk(res, prefix) → wrapper de getFirebaseAdmin() com 500 padronizado
//   - verificarToken(res, prefix, authAdmin, idToken, rateOpts?) → wrapper de
//     verifyIdToken com 401 padronizado + rate limit por UID opcional.
//
// O `prefix` é o identificador do handler (ex: "auth/reset-password") e
// aparece no `console.error` para facilitar a busca em logs.

import { getFirebaseAdmin } from "./firebaseAdmin.js";
import { checarRateLimit } from "./rateLimit.js";

/**
 * Escreve uma resposta JSON de erro padronizada e loga no console.
 * Não usa `return` — o chamador deve fazer `return bad(...)`.
 *
 * @param {import("http").ServerResponse} res
 * @param {string} prefix  Identificador do handler (ex: "auth/reset-password")
 * @param {number} status  HTTP status code
 * @param {string} erro    Mensagem amigável para o cliente
 * @param {object} [extra] Campos extras para incluir no JSON (ex: {variavel: "..."})
 * @returns {import("http").ServerResponse}
 */
export function bad(res, prefix, status, erro, extra = {}) {
  if (prefix) {
    // Extra é serializado de forma concisa (semelhante ao padrão anterior).
    console.error(`[${prefix}] ${status} ${erro}`, Object.keys(extra).length ? extra : "");
  }
  return res.status(status).json({ ok: false, erro, ...extra });
}

/**
 * Extrai o `idToken` do header `Authorization: Bearer <token>`.
 * Retorna `null` se ausente ou mal-formado.
 *
 * @param {import("http").IncomingMessage} req
 * @returns {string | null}
 */
export function extrairBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/**
 * Wrapper de `getFirebaseAdmin()` que escreve resposta 500 padronizada
 * se a inicialização falhar (env vars ausentes, etc.) e retorna `null`.
 *
 * @param {import("http").ServerResponse} res
 * @param {string} prefix
 * @returns {import("firebase-admin/app").App | null}
 */
export function getAdminSdk(res, prefix) {
  try {
    return getFirebaseAdmin();
  } catch (err) {
    console.error(`[${prefix}] Falha ao inicializar Firebase Admin:`, err?.code || err?.message);
    const missing = [];
    if (!process.env.FIREBASE_PROJECT_ID) missing.push("FIREBASE_PROJECT_ID");
    if (!process.env.FIREBASE_CLIENT_EMAIL) missing.push("FIREBASE_CLIENT_EMAIL");
    if (!process.env.FIREBASE_PRIVATE_KEY) missing.push("FIREBASE_PRIVATE_KEY");
    bad(
      res,
      prefix,
      500,
      missing.length
        ? `Firebase Admin não configurado no servidor. Faltam: ${missing.join(", ")}.`
        : "Serviço de autenticação indisponível. Tente novamente mais tarde.",
      { variavel: missing[0] || null },
    );
    return null;
  }
}

/**
 * Wrapper de `authAdmin.verifyIdToken()` que escreve resposta 401
 * padronizada se a verificação falhar e retorna `null`.
 *
 * Aceita um parâmetro opcional `rateOpts` para aplicar rate limit por
 * UID IMEDIATAMENTE após a verificação do token. Isso centraliza em UM
 * helper a lógica que estaria duplicada em 6+ handlers autenticados.
 *
 * @param {import("http").ServerResponse} res
 * @param {string} prefix
 * @param {import("firebase-admin/auth").Auth} authAdmin
 * @param {string} idToken
 * @param {{ limite: number, janelaMs: number, bucket: string }} [rateOpts]
 *   Se passado, aplica rate limit por UID após o verifyIdToken.
 *   `bucket` isola contadores entre endpoints (ex: "admin", "notifications").
 * @returns {Promise<string | null>} O UID do chamador, ou `null` se a verificação falhou OU se o rate limit foi excedido (429).
 */
export async function verificarToken(res, prefix, authAdmin, idToken, rateOpts) {
  let uid;
  try {
    const decoded = await authAdmin.verifyIdToken(idToken, true);
    uid = decoded.uid;
  } catch (err) {
    console.error(`[${prefix}] verifyIdToken falhou:`, err?.code || err?.message);
    bad(res, prefix, 401, "Sessão inválida. Faça login novamente.");
    return null;
  }
  if (
    rateOpts &&
    Number.isFinite(rateOpts.limite) &&
    Number.isFinite(rateOpts.janelaMs)
  ) {
    const bucket = rateOpts.bucket || "default";
    const rl = checarRateLimit({
      chave: `${bucket}:${uid}`,
      limite: rateOpts.limite,
      janelaMs: rateOpts.janelaMs,
    });
    if (!rl.ok) {
      res.setHeader("Retry-After", String(Math.ceil(rl.resetMs / 1000)));
      bad(
        res,
        prefix,
        429,
        "Muitas requisições em pouco tempo. Aguarde um momento e tente novamente.",
      );
      return null;
    }
  }
  return uid;
}
