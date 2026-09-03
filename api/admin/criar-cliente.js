// API: POST /api/admin/criar-cliente
//
// Cria um cliente para o DONO autenticado (ou para o DONO ao qual o
// FUNCIONÁRIO autenticado está vinculado). Valida token, status,
// permissão e limite de clientes no servidor (Admin SDK), e só então
// grava o documento em /clientes.
//
// POR QUE ISSO É SERVER-SIDE:
//   O Firestore Rules não consegue contar documentos de uma coleção
//   de forma portável/confiável para validar limites. A solução
//   segura é mover o create para um endpoint com Admin SDK, que
//   ignora as Rules e executa a checagem no servidor. Isso garante
//   que mesmo um addDoc direto pelo console do Firestore seja
//   bloqueado (as Rules negam create via client SDK nesta coleção).
//
//   Consequência prática: o front-end NÃO escreve mais em
//   /clientes via client SDK. Toda criação passa por aqui.
//
// Segurança:
//   - ADMIN_UID continua sendo o único que altera limites/permissoes/
//     status (via /api/admin/update-owner com Admin SDK).
//   - O chamador (dono ou funcionário) tem seu ID Token verificado.
//   - Os campos `limites`, `permissoes` e `status` do DONO são lidos
//     aqui com Admin SDK (bypassa Rules) e comparados.
//   - Se limite for 0, é tratado como "sem limite" (criação livre).
//   - Defaults permissivos: donos sem `limites` (5/5/5), sem
//     `permissoes` (criarClientes = true), sem `status` ("ativo").
//
// Body esperado:
//   {
//     nomeCompleto: string (obrigatório),
//     cpf?: string,
//     telefone?: string,
//     email?: string,
//     endereco?: string,
//     scoreCredito?: string,
//     fotoUrl?: string,
//     documentos?: array
//   }
// O server preenche automaticamente:
//   - ownerId: uid do DONO (request.auth.uid para o DONO; meuPerfil.ownerUid para o FUNCIONÁRIO)
//   - createdBy: uid do autor (request.auth.uid)
//   - createdAt, updatedAt: serverTimestamp

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "../_lib/firebaseAdmin.js";

const NOME_MIN = 2;
const NOME_MAX = 200;
const CPF_MAX = 20;
const TELEFONE_MAX = 30;
const EMAIL_MAX = 200;
const ENDERECO_MAX = 400;
const SCORES = ["Baixo", "Médio", "Alto"];
const DEFAULT_LIMITES = { contratos: 5, clientes: 5, funcionarios: 5 };
const DEFAULT_PERMISSOES = { criarContratos: true, criarClientes: true, criarFuncionarios: false };
const DEFAULT_STATUS = "ativo";

function bad(res, status, erro) {
  console.error(`[admin/criar-cliente] ${status} ${erro}`);
  return res.status(status).json({ ok: false, erro });
}

function extrairBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function normalizarLimites(perfil) {
  const l = perfil?.limites;
  if (!l || typeof l !== "object") return { ...DEFAULT_LIMITES };
  return {
    contratos:
      l.contratos !== undefined && l.contratos !== null && Number.isFinite(Number(l.contratos))
        ? Number(l.contratos)
        : DEFAULT_LIMITES.contratos,
    clientes:
      l.clientes !== undefined && l.clientes !== null && Number.isFinite(Number(l.clientes))
        ? Number(l.clientes)
        : DEFAULT_LIMITES.clientes,
    funcionarios:
      l.funcionarios !== undefined && l.funcionarios !== null && Number.isFinite(Number(l.funcionarios))
        ? Number(l.funcionarios)
        : DEFAULT_LIMITES.funcionarios,
  };
}

function normalizarPermissoes(perfil) {
  const p = perfil?.permissoes;
  if (!p || typeof p !== "object") return { ...DEFAULT_PERMISSOES };
  return {
    criarContratos: p.criarContratos === true,
    criarClientes: p.criarClientes === true,
    criarFuncionarios: p.criarFuncionarios === true,
  };
}

function normalizarStatus(perfil) {
  return perfil?.status === "bloqueado" ? "bloqueado" : DEFAULT_STATUS;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido.");
  }

  // 1) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const nomeCompleto = typeof body.nomeCompleto === "string" ? body.nomeCompleto.trim() : "";
  if (!nomeCompleto || nomeCompleto.length < NOME_MIN || nomeCompleto.length > NOME_MAX) {
    return bad(res, 400, `Informe um nome entre ${NOME_MIN} e ${NOME_MAX} caracteres.`);
  }
  const cpf = typeof body.cpf === "string" ? body.cpf.replace(/\D/g, "").slice(0, CPF_MAX) : "";
  const telefone = typeof body.telefone === "string" ? body.telefone.replace(/\D/g, "").slice(0, TELEFONE_MAX) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, EMAIL_MAX) : "";
  const endereco = typeof body.endereco === "string" ? body.endereco.trim().slice(0, ENDERECO_MAX) : "";
  const scoreCredito = SCORES.includes(body.scoreCredito) ? body.scoreCredito : "Médio";
  const fotoUrl = typeof body.fotoUrl === "string" ? body.fotoUrl.slice(0, 1024) : "";
  const documentos = Array.isArray(body.documentos) ? body.documentos.slice(0, 20) : [];

  // 2) Token
  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, 401, "Autenticação obrigatória.");
  }

  // 3) Admin
  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch (err) {
    console.error("[admin/criar-cliente] Firebase Admin indisponível:", err?.code, err?.message);
    return bad(res, 500, "Serviço de autenticação indisponível. Tente novamente mais tarde.");
  }
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 4) Identidade
  let chamadorUid;
  try {
    const decoded = await authAdmin.verifyIdToken(idToken, true);
    chamadorUid = decoded.uid;
  } catch (err) {
    console.error("[admin/criar-cliente] verifyIdToken falhou:", err?.code, err?.message);
    return bad(res, 401, "Sessão inválida. Faça login novamente.");
  }

  // 5) Perfil do chamador
  let perfilChamador;
  try {
    const snap = await dbAdmin.collection("usuarios").doc(chamadorUid).get();
    if (!snap.exists) {
      return bad(res, 403, "Perfil do chamador não encontrado.");
    }
    perfilChamador = snap.data() || {};
  } catch (err) {
    console.error("[admin/criar-cliente] Leitura do perfil falhou:", err?.message);
    return bad(res, 500, "Não foi possível validar o chamador.");
  }

  // 6) Resolve o DONO efetivo:
  //   - DONO: ele mesmo
  //   - FUNCIONARIO: o ownerUid dele
  //   - Sem role ou sem ownerUid: bloqueia.
  let donoUid;
  let criadoPorFuncionario = false;
  if (perfilChamador.role === "funcionario") {
    if (!perfilChamador.ownerUid) {
      return bad(res, 403, "Funcionário sem vínculo de proprietário.");
    }
    donoUid = perfilChamador.ownerUid;
    criadoPorFuncionario = true;
  } else if (perfilChamador.ownerUid) {
    return bad(res, 403, "Perfil inválido para criação.");
  } else {
    donoUid = chamadorUid;
  }

  // 7) Perfil do DONO (validação de status, permissoes, limites)
  let perfilDono;
  try {
    const snap = await dbAdmin.collection("usuarios").doc(donoUid).get();
    if (!snap.exists) {
      return bad(res, 403, "Proprietário não encontrado.");
    }
    perfilDono = snap.data() || {};
  } catch (err) {
    console.error("[admin/criar-cliente] Leitura do perfil do dono falhou:", err?.message);
    return bad(res, 500, "Não foi possível validar o proprietário.");
  }

  const status = normalizarStatus(perfilDono);
  if (status === "bloqueado") {
    return bad(
      res,
      403,
      "Conta bloqueada pelo administrador. Não é possível cadastrar clientes.",
    );
  }

  const permissoes = normalizarPermissoes(perfilDono);
  if (!permissoes.criarClientes) {
    return bad(
      res,
      403,
      "A criação de clientes foi bloqueada pelo administrador.",
    );
  }

  const limites = normalizarLimites(perfilDono);

  // 8) Limite de clientes: contagem real no servidor.
  // 0 = sem limite; > 0 = bloqueia quando count >= limite.
  if (limites.clientes > 0) {
    try {
      const contSnap = await dbAdmin
        .collection("clientes")
        .where("ownerId", "==", donoUid)
        .count()
        .get();
      const cont = contSnap.data().count || 0;
      if (cont >= limites.clientes) {
        return bad(
          res,
          403,
          `Limite de clientes atingido (${cont}/${limites.clientes}). Entre em contato com o administrador para aumentar seu limite.`,
        );
      }
    } catch (err) {
      console.error("[admin/criar-cliente] Contagem de clientes falhou:", err?.code, err?.message);
      return bad(res, 500, "Não foi possível validar o limite de clientes.");
    }
  }

  // 9) Cria o cliente
  const clientesRef = dbAdmin.collection("clientes");
  const novoDoc = {
    ownerId: donoUid,
    createdBy: chamadorUid,
    nomeCompleto,
    cpf,
    telefone,
    email,
    endereco,
    scoreCredito,
    fotoUrl,
    documentos,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  let docRef;
  try {
    docRef = await clientesRef.add(novoDoc);
  } catch (err) {
    console.error("[admin/criar-cliente] addDoc falhou:", err?.code, err?.message);
    return bad(res, 500, "Não foi possível salvar o cliente. Tente novamente.");
  }

  return res.status(201).json({
    ok: true,
    id: docRef.id,
    cliente: { id: docRef.id, ...novoDoc, createdBy: criadoPorFuncionario ? "funcionario" : "dono" },
  });
}
