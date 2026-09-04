// API: POST /api/admin/delete-owner
//
// Exclusão DEFINITIVA de um DONO e de TODOS os dados a ele vinculados
// (clientes, contratos, funcionários, sub-coleções, contas Auth, etc.).
// Apenas a conta ADMIN_UID pode chamar — qualquer outro uid recebe
// 403 imediato.
//
// Fluxo (chamado pelo ADMIN_UID autenticado):
//   1. Recebe { donoUid }.
//   2. Valida método, body.
//   3. Valida o `Authorization: Bearer <idToken>` via Firebase Admin.
//   4. Bloqueio principal: chamadorUid === process.env.ADMIN_UID.
//   5. Defesa extra: donoUid !== ADMIN_UID (admin não pode se autoexcluir).
//   6. Confirma que /usuarios/{donoUid} existe (404 se não).
//   7. Coleta prévia de IDs a serem apagados (funcionários, contratos,
//      clientes top-level).
//   8. Exclui NA ORDEM:
//      a) Sub-coleções de cada contrato (pagamentos, jurosRecebidos,
//         e quaisquer outras via listCollections()).
//      b) Documento de cada contrato (usuarios/{donoUid}/contratos/{cid}).
//      c) Para cada cliente top-level (ownerId === donoUid):
//         sub-coleções do cliente + o documento do cliente.
//      d) Sub-coleção legada usuarios/{donoUid}/clientes (recursiva).
//      e) Para cada funcionário vinculado:
//         - clientes e contratos com createdBy === funcionarioAuthUid
//           (replica a lógica de delete-employee, mas aqui no escopo
//           do dono — sem funcionário de outro dono, pois a exclusão
//           é restrita ao donoUid recebido).
//         - funcionarios/{funcionarioId}.
//         - perfil usuarios/{funcionarioAuthUid}.
//         - conta Auth do funcionário.
//      f) Demais sub-coleções diretas de usuarios/{donoUid} (config,
//         modelosContrato, modelosCobranca, notificacoes,
//         notificationEvents, devices) via listCollections() recursivo.
//      g) Documento raiz usuarios/{donoUid}.
//      h) Conta Auth do próprio DONO (tolerar auth/user-not-found).
//   9. Retorna { ok, stats } com contadores para auditoria.
//
// Observações:
//   - Em caso de erro no meio do caminho, retornamos erro claro SEM
//     tentar restaurar dados já apagados. O admin pode repetir (a
//     operação é idempotente: docs já apagados são silenciosamente
//     ignorados).
//   - Helper `excluirSubcolecoesRecursivo` foi DUPLICADO de
//     api/auth/delete-employee.js (intencionalmente, para não tocar
//     naquele arquivo nesta fase). Lógica idêntica.
//
// Segurança:
//   - ADMIN_UID via process.env (Vercel env var).
//   - Token validado com verifyIdToken (revoga adulterados/expirados).
//   - Admin SDK ignora Firestore Rules — toda a exclusão passa pelo
//     servidor. Frontend não ganha permissão extra.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "../_lib/firebaseAdmin.js";

// Limite por operação. Acima disso, a operação precisa ser repetida.
// Admin SDK tem limite de 500 writes por batch — processamos em
// batches internamente. Este limite é apenas um teto de segurança
// contra loop eterno.
const MAX_ITENS_POR_OPERACAO = 5000;

function bad(res, status, erro) {
  return res.status(status).json({ ok: false, erro });
}

function extrairBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

// Exclui recursivamente todas as subcoleções de um documento.
// COPIADO de api/auth/delete-employee.js para evitar alterar aquele
// arquivo. Lógica idêntica: lista coleções via listCollections() e
// apaga documentos em batches de 500 (limite do Firestore). Recursão
// limitada em profundidade=5 como defesa contra ciclos.
async function excluirSubcolecoesRecursivo(dbAdmin, docRef, profundidade = 0) {
  if (profundidade > 5) return 0;
  const collections = await docRef.listCollections();
  let total = 0;
  for (const coll of collections) {
    const snap = await coll.limit(MAX_ITENS_POR_OPERACAO).get();
    if (snap.empty) continue;
    for (const subDoc of snap.docs) {
      total += await excluirSubcolecoesRecursivo(dbAdmin, subDoc.ref, profundidade + 1);
    }
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = dbAdmin.batch();
      const fatia = docs.slice(i, i + 500);
      for (const d of fatia) {
        batch.delete(d.ref);
      }
      await batch.commit();
      total += fatia.length;
    }
  }
  return total;
}

// Exclui os clientes e contratos CRIADOS por um funcionário específico
// do dono. Replica o comportamento de api/auth/delete-employee.js, mas
// aqui já sabemos o ownerUid (= donoUid) e o escopo da exclusão é o
// dono inteiro — não tocamos em clientes/contratos de outros donos.
async function excluirDadosDoFuncionario(dbAdmin, donoUid, funcionarioAuthUid, stats) {
  // Contratos com createdBy === funcionarioAuthUid
  const contratosSnap = await dbAdmin
    .collection("usuarios")
    .doc(donoUid)
    .collection("contratos")
    .where("createdBy", "==", funcionarioAuthUid)
    .limit(MAX_ITENS_POR_OPERACAO)
    .get();

  for (const cDoc of contratosSnap.docs) {
    stats.subDocsExcluidos += await excluirSubcolecoesRecursivo(dbAdmin, cDoc.ref);
    await cDoc.ref.delete();
    stats.contratosExcluidos += 1;
  }

  // Clientes top-level com createdBy === funcionarioAuthUid
  const clientesSnap = await dbAdmin
    .collection("clientes")
    .where("ownerId", "==", donoUid)
    .where("createdBy", "==", funcionarioAuthUid)
    .limit(MAX_ITENS_POR_OPERACAO)
    .get();

  for (const cliDoc of clientesSnap.docs) {
    stats.subDocsExcluidos += await excluirSubcolecoesRecursivo(dbAdmin, cliDoc.ref);
    await cliDoc.ref.delete();
    stats.clientesExcluidos += 1;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido.");
  }

  // 1) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const donoUid = typeof body.donoUid === "string" ? body.donoUid.trim() : "";
  if (!donoUid) {
    return bad(res, 400, "Informe o identificador do dono.");
  }
  if (donoUid.length > 256) {
    return bad(res, 400, "Identificador do dono inválido (excede 256 caracteres).");
  }

  // 2) Token
  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, 401, "Autenticação obrigatória.");
  }

  // 3) Firebase Admin
  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch (err) {
    console.error("[admin/delete-owner] Falha ao inicializar Firebase Admin:", err?.code || err?.message);
    return bad(res, 500, "Serviço de autenticação indisponível. Tente novamente mais tarde.");
  }
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 4) Identidade do chamador
  let chamadorUid;
  try {
    const decoded = await authAdmin.verifyIdToken(idToken, true);
    chamadorUid = decoded.uid;
  } catch (err) {
    console.error("[admin/delete-owner] verifyIdToken falhou:", err?.code || err?.message);
    return bad(res, 401, "Sessão inválida. Faça login novamente.");
  }

  // 5) ADMIN_UID (env var)
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) {
    return bad(res, 500, "Configuração do servidor ausente. ADMIN_UID não foi definido no servidor.");
  }

  // 6) Bloqueio principal
  if (chamadorUid !== adminUid) {
    return bad(res, 403, "Acesso restrito ao administrador do sistema.");
  }

  // 7) Defesa extra: o admin NÃO pode se autoexcluir
  if (donoUid === adminUid) {
    return bad(res, 403, "A conta administrativa principal não pode ser excluída.");
  }

  // 8) Confirma que o doc do dono existe
  const donoRef = dbAdmin.collection("usuarios").doc(donoUid);
  let donoSnap;
  try {
    donoSnap = await donoRef.get();
  } catch (err) {
    console.error("[admin/delete-owner] get dono falhou:", err?.message);
    return bad(res, 500, "Não foi possível ler o perfil do dono.");
  }
  if (!donoSnap.exists) {
    return bad(res, 404, "Dono não encontrado.");
  }

  // Estatísticas para auditoria
  const stats = {
    clientesExcluidos: 0,
    contratosExcluidos: 0,
    funcionariosExcluidos: 0,
    subDocsExcluidos: 0,
    authsExcluidos: 0,
    includesAuthDono: false,
  };

  // 9) Coleta prévia de funcionários (precisamos dos authUids)
  let funcionarios;
  try {
    const funcSnap = await donoRef
      .collection("funcionarios")
      .limit(MAX_ITENS_POR_OPERACAO)
      .get();
    funcionarios = funcSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (err) {
    console.error("[admin/delete-owner] listagem de funcionários falhou:", err?.code, err?.message);
    return bad(res, 500, "Não foi possível listar os funcionários do dono.");
  }

  // 10a) Exclui sub-coleções de cada contrato + o contrato
  try {
    const contratosSnap = await donoRef
      .collection("contratos")
      .limit(MAX_ITENS_POR_OPERACAO)
      .get();
    for (const cDoc of contratosSnap.docs) {
      stats.subDocsExcluidos += await excluirSubcolecoesRecursivo(dbAdmin, cDoc.ref);
      await cDoc.ref.delete();
      stats.contratosExcluidos += 1;
    }
  } catch (err) {
    console.error("[admin/delete-owner] exclusão de contratos falhou:", err?.code, err?.message);
    return bad(
      res,
      500,
      `Não foi possível excluir os contratos: ${err?.message || "erro desconhecido"}.`,
    );
  }

  // 10b) Exclui clientes top-level (ownerId === donoUid) + sub-coleções
  try {
    const clientesSnap = await dbAdmin
      .collection("clientes")
      .where("ownerId", "==", donoUid)
      .limit(MAX_ITENS_POR_OPERACAO)
      .get();
    for (const cliDoc of clientesSnap.docs) {
      stats.subDocsExcluidos += await excluirSubcolecoesRecursivo(dbAdmin, cliDoc.ref);
      await cliDoc.ref.delete();
      stats.clientesExcluidos += 1;
    }
  } catch (err) {
    console.error("[admin/delete-owner] exclusão de clientes top-level falhou:", err?.code, err?.message);
    return bad(
      res,
      500,
      `Não foi possível excluir os clientes: ${err?.message || "erro desconhecido"}.`,
    );
  }

  // 10c) Exclui a sub-coleção legada usuarios/{donoUid}/clientes
  //      (caso ainda existam docs lá) + sub-coleções filhas.
  try {
    stats.subDocsExcluidos += await excluirSubcolecoesRecursivo(
      dbAdmin,
      donoRef.collection("clientes"),
      0,
    );
  } catch (err) {
    console.error("[admin/delete-owner] exclusão de clientes legados falhou:", err?.code, err?.message);
    return bad(
      res,
      500,
      `Não foi possível excluir a subcoleção legada de clientes: ${err?.message || "erro"}.`,
    );
  }

  // 10d) Para cada funcionário: exclui seus dados (clientes/contratos
  //      com createdBy), depois o cadastro, perfil e Auth.
  for (const f of funcionarios) {
    const funcAuthUid = typeof f.authUid === "string" ? f.authUid : null;
    const funcRef = donoRef.collection("funcionarios").doc(f.id);

    try {
      if (funcAuthUid) {
        await excluirDadosDoFuncionario(dbAdmin, donoUid, funcAuthUid, stats);
      }
    } catch (err) {
      console.error("[admin/delete-owner] exclusão de dados do funcionário falhou:", err?.code, err?.message);
      return bad(
        res,
        500,
        `Não foi possível excluir os dados vinculados ao funcionário: ${err?.message || "erro"}.`,
      );
    }

    try {
      await funcRef.delete();
      stats.funcionariosExcluidos += 1;
    } catch (err) {
      console.error("[admin/delete-owner] exclusão do funcionarios/{id} falhou:", err?.code, err?.message);
      return bad(
        res,
        500,
        `Não foi possível remover o cadastro do funcionário: ${err?.message || "erro"}.`,
      );
    }

    if (funcAuthUid) {
      try {
        const perfilRef = dbAdmin.collection("usuarios").doc(funcAuthUid);
        await perfilRef.delete();
      } catch (err) {
        // Se o perfil não existe, não é erro — prossegue para Auth.
        if (err?.code !== 5 && err?.code !== "NOT_FOUND") {
          console.error("[admin/delete-owner] exclusão do perfil do funcionário falhou:", err?.code, err?.message);
          return bad(
            res,
            500,
            `Não foi possível remover o perfil do funcionário: ${err?.message || "erro"}.`,
          );
        }
      }

      try {
        await authAdmin.deleteUser(funcAuthUid);
        stats.authsExcluidos += 1;
      } catch (err) {
        if (err?.code === "auth/user-not-found") {
          stats.authsExcluidos += 1; // já não existia — mesmo resultado
        } else {
          console.error("[admin/delete-owner] deleteUser (funcionário) falhou:", err?.code, err?.message);
          return bad(
            res,
            500,
            `Funcionário removido dos dados, mas a conta de autenticação não pôde ser excluída: ${err?.message || "erro"}.`,
          );
        }
      }
    }
  }

  // 10e) Demais sub-coleções diretas do dono (config, modelosContrato,
  //      modelosCobranca, notificacoes, notificationEvents, devices)
  //      via listCollections() recursivo. contratos/ e funcionarios/
  //      já foram apagados nos passos anteriores; listCollections()
  //      retorna apenas coleções com pelo menos 1 documento restante.
  try {
    stats.subDocsExcluidos += await excluirSubcolecoesRecursivo(dbAdmin, donoRef, 0);
  } catch (err) {
    console.error("[admin/delete-owner] exclusão de sub-coleções restantes falhou:", err?.code, err?.message);
    return bad(
      res,
      500,
      `Não foi possível remover as sub-coleções restantes: ${err?.message || "erro"}.`,
    );
  }

  // 10f) Exclui o doc raiz do dono
  try {
    await donoRef.delete();
  } catch (err) {
    console.error("[admin/delete-owner] exclusão do doc raiz do dono falhou:", err?.code, err?.message);
    return bad(
      res,
      500,
      `Não foi possível remover o perfil do dono: ${err?.message || "erro"}.`,
    );
  }

  // 10g) Exclui a conta Auth do próprio DONO (tolerar user-not-found)
  try {
    await authAdmin.deleteUser(donoUid);
    stats.authsExcluidos += 1;
    stats.includesAuthDono = true;
  } catch (err) {
    if (err?.code === "auth/user-not-found") {
      stats.authsExcluidos += 1;
      stats.includesAuthDono = true; // já não existia — mesmo resultado
    } else {
      console.error("[admin/delete-owner] deleteUser (dono) falhou:", err?.code, err?.message);
      return bad(
        res,
        500,
        `Dados do dono removidos, mas a conta de autenticação não pôde ser excluída: ${err?.message || "erro"}.`,
      );
    }
  }

  return res.status(200).json({
    ok: true,
    donoUid,
    ...stats,
  });
}
