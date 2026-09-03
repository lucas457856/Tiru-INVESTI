// API: POST /api/auth/update-employee
//
// Fluxo (chamado pelo DONO autenticado):
//   1. Recebe { funcionarioId, action? | status?, nome?, limiteContratos? }.
//      - `action` pode ser "ativar" ou "inativar" (forma preferida).
//      - `status` pode ser "ativo" ou "inativo" (forma legada,
//        mantida por compatibilidade).
//   2. Valida método, body, tipos e ranges.
//   3. Valida o `Authorization: Bearer <idToken>` via Firebase Admin.
//   4. Confirma que o chamador é DONO (perfil sem role/ownerUid).
//   5. Lê o doc /usuarios/{donoUid}/funcionarios/{funcionarioId} e
//      confirma que pertence ao chamador.
//   6. Aplica APENAS os campos enviados (merge). Não aceita mudar
//      email, authUid, createdAt, ownerUid. Atualiza updatedAt.
//   7. Retorna { ok:true, funcionarioId, status }.
//
// Segurança:
//   - Variáveis sensíveis em process.env.
//   - Nenhuma senha trafega por este endpoint (criação de senha é
//     exclusiva de /api/auth/create-employee; troca é via
//     /api/auth/reset-password + /esqueci-senha).

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "../_lib/firebaseAdmin.js";

const NOME_MIN = 2;
const NOME_MAX = 80;
const LIMITE_MIN = 0;
const LIMITE_MAX = 100000;

// Mapeia a chave do body para o `status` final armazenado no doc.
// Aceita tanto `action: "ativar" | "inativar"` (preferido) quanto
// `status: "ativo" | "inativo"` (legado).
const ACTION_TO_STATUS = {
  ativar: "ativo",
  inativar: "inativo",
};
const STATUSES = ["ativo", "inativo"];

function bad(res, status, erro) {
  return res.status(status).json({ ok: false, erro });
}

function extrairBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido.");
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const funcionarioId = typeof body.funcionarioId === "string" ? body.funcionarioId.trim() : "";
  const querMudarNome = Object.prototype.hasOwnProperty.call(body, "nome");
  const querMudarLimite = Object.prototype.hasOwnProperty.call(body, "limiteContratos");
  const querMudarAction = Object.prototype.hasOwnProperty.call(body, "action");
  const querMudarStatus = Object.prototype.hasOwnProperty.call(body, "status");

  if (!funcionarioId) {
    return bad(res, 400, "Informe o identificador do funcionário.");
  }
  if (!querMudarNome && !querMudarLimite && !querMudarAction && !querMudarStatus) {
    return bad(res, 400, "Nenhum campo para atualizar foi informado.");
  }

  let nome;
  if (querMudarNome) {
    nome = typeof body.nome === "string" ? body.nome.trim() : "";
    if (!nome || nome.length < NOME_MIN || nome.length > NOME_MAX) {
      return bad(res, 400, `Informe um nome entre ${NOME_MIN} e ${NOME_MAX} caracteres.`);
    }
  }

  let limiteNumero;
  if (querMudarLimite) {
    limiteNumero = Number(body.limiteContratos);
    if (
      body.limiteContratos === null ||
      !Number.isFinite(limiteNumero) ||
      !Number.isInteger(limiteNumero) ||
      limiteNumero < LIMITE_MIN ||
      limiteNumero > LIMITE_MAX
    ) {
      return bad(res, 400, `Limite de contratos inválido (${LIMITE_MIN} a ${LIMITE_MAX}).`);
    }
  }

  // Resolve `novoStatus` a partir de `action` (preferido) ou `status` (legado).
  let novoStatus;
  let querMudarStatusFinal = false;
  if (querMudarAction) {
    if (typeof body.action !== "string" || !ACTION_TO_STATUS[body.action]) {
      return bad(res, 400, "Ação inválida. Use 'ativar' ou 'inativar'.");
    }
    novoStatus = ACTION_TO_STATUS[body.action];
    querMudarStatusFinal = true;
  } else if (querMudarStatus) {
    if (typeof body.status !== "string" || !STATUSES.includes(body.status)) {
      return bad(res, 400, "Status inválido. Use 'ativo' ou 'inativo'.");
    }
    novoStatus = body.status;
    querMudarStatusFinal = true;
  }

  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, 401, "Autenticação obrigatória.");
  }

  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch (err) {
    console.error("Falha ao inicializar Firebase Admin:", err.code || err.message);
    return bad(res, 500, "Serviço de autenticação indisponível. Tente novamente mais tarde.");
  }
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  let chamadorUid;
  try {
    const decoded = await authAdmin.verifyIdToken(idToken, true);
    chamadorUid = decoded.uid;
  } catch (err) {
    console.error("verifyIdToken falhou:", err?.code || err?.message);
    return bad(res, 401, "Sessão inválida. Faça login novamente.");
  }

  let perfilChamador;
  try {
    const snap = await dbAdmin.collection("usuarios").doc(chamadorUid).get();
    if (!snap.exists) {
      return bad(res, 403, "Perfil de dono não encontrado.");
    }
    perfilChamador = snap.data() || {};
  } catch (err) {
    console.error("Leitura do perfil do chamador falhou:", err?.message);
    return bad(res, 500, "Não foi possível validar o chamador.");
  }
  if (perfilChamador.role || perfilChamador.ownerUid) {
    return bad(res, 403, "Apenas o proprietário da conta pode editar funcionários.");
  }

  const funcRef = dbAdmin
    .collection("usuarios")
    .doc(chamadorUid)
    .collection("funcionarios")
    .doc(funcionarioId);

  let funcSnap;
  try {
    funcSnap = await funcRef.get();
  } catch (err) {
    console.error("Leitura do funcionário falhou:", err?.message);
    return bad(res, 500, "Não foi possível carregar o funcionário.");
  }
  if (!funcSnap.exists) {
    return bad(res, 404, "Funcionário não encontrado.");
  }

  const update = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (querMudarNome) update.nome = nome;
  if (querMudarLimite) update.limiteContratos = limiteNumero;
  if (querMudarStatusFinal) {
    update.status = novoStatus;
    // Inativar: marca deletedAt com timestamp.
    // Ativar:   REMOVE o campo deletedAt (FieldValue.delete). Nunca
    //           usamos `null` porque Firestore rejeita atribuir null
    //           a um campo já existente em `update()`. O campo some
    //           completamente do documento.
    if (novoStatus === "inativo") {
      update.deletedAt = FieldValue.serverTimestamp();
    } else {
      update.deletedAt = FieldValue.delete();
    }
  }

  try {
    await funcRef.update(update);
  } catch (err) {
    // Repassa a mensagem real do Firestore (sem expor stack interno).
    // Antes estava genérica e escondia o problema; agora conseguimos
    // ver exatamente o motivo (permission-denied, not-found, etc.).
    console.error("updateDoc funcionário falhou:", err?.code, err?.message);
    return bad(res, 500, err?.message || "Não foi possível atualizar o funcionário.");
  }

  return res.status(200).json({ ok: true, funcionarioId, status: novoStatus });
}
