// API: POST /api/admin/update-owner
//
// Atualiza os CAMPOS ADMINISTRATIVOS de um DONO (usuarios/{donoUid}):
//   - status: "ativo" | "bloqueado"
//   - limites: { contratos, clientes, funcionarios }  (inteiros ≥ 0; 0 = sem limite)
//   - permissoes: { criarContratos, criarClientes, criarFuncionarios }  (booleanos)
//
// Apenas a conta ADMIN_UID pode chamar — qualquer outro uid recebe
// 403 imediato. O Admin SDK é usado para escrever, porque a Firestore
// Rules proíbe o client SDK de mexer nesses campos (ver Decisão 4
// do plano).
//
// IMPORTANTE — POR QUE ISSO É SERVER-SIDE:
//   O client SDK não pode alterar `usuarios/{outroUid}.limites` —
//   a regra exige `request.auth.uid == uid`. Mesmo se o admin
//   tentasse via client SDK, ele só conseguiria no próprio UID dele
//   (não nos outros donos). O Admin SDK bypassa as rules (comportamento
//   padrão) e o servidor valida o chamador contra a env var ADMIN_UID.
//
// Segurança:
//   - ADMIN_UID vem de process.env (Vercel env vars).
//   - Token validado com verifyIdToken (revoga tokens adulterados/expirados).
//   - Campos validados no servidor (tipo, range, valores permitidos).
//   - Nenhuma credencial Admin no front.
//
// Body esperado (campos opcionais; pelo menos um precisa estar presente):
//   {
//     "donoUid": "abc123",
//     "status": "ativo" | "bloqueado",
//     "limites": { "contratos": 5, "clientes": 5, "funcionarios": 5 },
//     "permissoes": { "criarContratos": true, "criarClientes": true,
//                     "criarFuncionarios": true }
//   }

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "../_lib/firebaseAdmin.js";

function bad(res, status, erro, extra = {}) {
  console.error(`[admin/update-owner] ${status} ${erro}`, extra);
  return res.status(status).json({ ok: false, erro, ...extra });
}

function extrairBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

// Valida o body e retorna { ok, update, error }. update é um objeto
// pronto para ser passado a updateDoc (campos validados e normalizados).
function validarBody(body) {
  const donoUid = typeof body?.donoUid === "string" ? body.donoUid.trim() : "";
  if (!donoUid || donoUid.length > 256) {
    return { ok: false, erro: "donoUid inválido ou ausente." };
  }

  const update = {};

  // status
  if (body.status !== undefined) {
    if (body.status !== "ativo" && body.status !== "bloqueado") {
      return { ok: false, erro: "status deve ser 'ativo' ou 'bloqueado'." };
    }
    update.status = body.status;
  }

  // limites
  if (body.limites !== undefined) {
    if (typeof body.limites !== "object" || body.limites === null) {
      return { ok: false, erro: "limites deve ser um objeto." };
    }
    const chaves = ["contratos", "clientes", "funcionarios"];
    const out = {};
    for (const k of chaves) {
      if (body.limites[k] === undefined) continue;
      const n = Number(body.limites[k]);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        return { ok: false, erro: `limites.${k} deve ser inteiro ≥ 0.` };
      }
      // Limite razoável para não permitir valores absurdos (1M+).
      if (n > 1_000_000) {
        return { ok: false, erro: `limites.${k} acima do máximo permitido (1.000.000).` };
      }
      out[k] = n;
    }
    if (Object.keys(out).length === 0) {
      return { ok: false, erro: "limites precisa de pelo menos uma chave." };
    }
    update.limites = out;
  }

  // permissoes
  if (body.permissoes !== undefined) {
    if (typeof body.permissoes !== "object" || body.permissoes === null) {
      return { ok: false, erro: "permissoes deve ser um objeto." };
    }
    const chaves = ["criarContratos", "criarClientes", "criarFuncionarios"];
    const out = {};
    for (const k of chaves) {
      if (body.permissoes[k] === undefined) continue;
      if (typeof body.permissoes[k] !== "boolean") {
        return { ok: false, erro: `permissoes.${k} deve ser booleano.` };
      }
      out[k] = body.permissoes[k];
    }
    if (Object.keys(out).length === 0) {
      return { ok: false, erro: "permissoes precisa de pelo menos uma chave." };
    }
    update.permissoes = out;
  }

  // plano ("free" | "pro"). Aceita apenas esses dois valores. Donos
  // antigos sem o campo continuam como "free" (default aplicado em
  // /api/admin/overview e nos hooks de leitura). Não apaga limites
  // configurados — apenas o sinalizador de plano é persistido.
  if (body.plan !== undefined) {
    if (body.plan !== "free" && body.plan !== "pro") {
      return { ok: false, erro: "plan deve ser 'free' ou 'pro'." };
    }
    update.plan = body.plan;
  }

  if (Object.keys(update).length === 0) {
    return {
      ok: false,
      erro: "Informe pelo menos um campo para atualizar (status, limites, permissoes ou plan).",
    };
  }

  return { ok: true, donoUid, update };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido.");
  }

  // 1) ADMIN_UID (env var)
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) {
    return bad(res, 500, "Configuração do servidor ausente. ADMIN_UID não foi definido no servidor.", {
      variavel: "ADMIN_UID",
    });
  }

  // 2) Bearer token
  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, 401, "Autenticação obrigatória.");
  }

  // 3) Firebase Admin
  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch {
    const missing = [];
    if (!process.env.FIREBASE_PROJECT_ID) missing.push("FIREBASE_PROJECT_ID");
    if (!process.env.FIREBASE_CLIENT_EMAIL) missing.push("FIREBASE_CLIENT_EMAIL");
    if (!process.env.FIREBASE_PRIVATE_KEY) missing.push("FIREBASE_PRIVATE_KEY");
    return bad(
      res,
      500,
      missing.length
        ? `Firebase Admin não configurado no servidor. Faltam: ${missing.join(", ")}.`
        : "Não foi possível inicializar o Firebase Admin.",
      { variavel: missing[0] || null },
    );
  }
  const authAdmin = (await import("firebase-admin/auth")).getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 4) Verifica identidade
  let chamadorUid;
  try {
    const decoded = await authAdmin.verifyIdToken(idToken, true);
    chamadorUid = decoded.uid;
  } catch (err) {
    console.error("[admin/update-owner] verifyIdToken falhou:", err?.code, err?.message);
    return bad(res, 401, "Sessão inválida. Faça login novamente.");
  }

  // 5) BLOQUEIO PRINCIPAL
  if (chamadorUid !== adminUid) {
    return bad(res, 403, "Acesso restrito ao administrador do sistema.");
  }

  // 6) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const validacao = validarBody(body);
  if (!validacao.ok) {
    return bad(res, 400, validacao.erro);
  }
  const { donoUid, update } = validacao;

  // 7) Confirma que o doc do dono existe (admin não pode atualizar
  //    fantasmas). Se não existir, 404.
  const donoRef = dbAdmin.collection("usuarios").doc(donoUid);
  let existe;
  try {
    const snap = await donoRef.get();
    existe = snap.exists;
  } catch (err) {
    console.error("[admin/update-owner] get dono falhou:", err?.message);
    return bad(res, 500, "Não foi possível ler o perfil do dono.");
  }
  if (!existe) {
    return bad(res, 404, "Dono não encontrado.");
  }

  // 8) Aplica o update com merge. Admin SDK ignora as Firestore Rules.
  //    Adiciona updatedAt: serverTimestamp() para auditoria leve.
  const updateFinal = { ...update, updatedAt: FieldValue.serverTimestamp() };
  try {
    await donoRef.update(updateFinal);
  } catch (err) {
    console.error("[admin/update-owner] updateDoc falhou:", err?.code, err?.message);
    return bad(res, 500, "Não foi possível atualizar o dono.");
  }

  return res.status(200).json({
    ok: true,
    donoUid,
    status: update.status ?? null,
    plano: update.plan ?? null,
    limites: update.limites ?? null,
    permissoes: update.permissoes ?? null,
  });
}
