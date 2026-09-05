// Sub-handler: POST /api/admin/delete-owner
//
// Disparado por api/admin/[...slug].js quando slug === "delete-owner".
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
//   - Helper `excluirSubcolecoesRecursivo` é importado de _lib/tree.js
//     (compartilhado com delete-employee).
//
// Segurança:
//   - ADMIN_UID via process.env (Vercel env var).
//   - Token validado com verifyIdToken (revoga adulterados/expirados).
//   - Admin SDK ignora Firestore Rules — toda a exclusão passa pelo
//     servidor. Frontend não ganha permissão extra.

import { getFirestore } from "firebase-admin/firestore";
import { bad, extrairBearer, getAdminSdk, verificarToken } from "../../_lib/http.js";
import { RATE_OPTS_ADMIN } from "../../_lib/rateLimit.js";
import { excluirSubcolecoesRecursivo } from "../../_lib/tree.js";
import { getAuth } from "../../_lib/dono.js";

const PREFIX = "admin/delete-owner";

// Limite por operação. Acima disso, a operação precisa ser repetida.
// Admin SDK tem limite de 500 writes por batch — processamos em
// batches internamente. Este limite é apenas um teto de segurança
// contra loop eterno.
const MAX_ITENS_POR_OPERACAO = 5000;

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

export async function deleteOwnerHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // 1) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const donoUid = typeof body.donoUid === "string" ? body.donoUid.trim() : "";
  if (!donoUid) {
    return bad(res, PREFIX, 400, "Informe o identificador do dono.");
  }
  if (donoUid.length > 256) {
    return bad(res, PREFIX, 400, "Identificador do dono inválido (excede 256 caracteres).");
  }

  // 2) Token
  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, PREFIX, 401, "Autenticação obrigatória.");
  }

  // 3) Firebase Admin
  const admin = getAdminSdk(res, PREFIX);
  if (!admin) return; // getAdminSdk já escreveu a resposta de erro
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 4) Identidade do chamador
  const chamadorUid = await verificarToken(res, PREFIX, authAdmin, idToken, RATE_OPTS_ADMIN);
  if (!chamadorUid) return; // verificarToken já escreveu a resposta de erro

  // 5) ADMIN_UID (env var)
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) {
    return bad(res, PREFIX, 500, "Configuração do servidor ausente. ADMIN_UID não foi definido no servidor.");
  }

  // 6) Bloqueio principal
  if (chamadorUid !== adminUid) {
    return bad(res, PREFIX, 403, "Acesso restrito ao administrador do sistema.");
  }

  // 7) Defesa extra: o admin NÃO pode se autoexcluir
  if (donoUid === adminUid) {
    return bad(res, PREFIX, 403, "A conta administrativa principal não pode ser excluída.");
  }

  // 8) Confirma que o doc do dono existe
  const donoRef = dbAdmin.collection("usuarios").doc(donoUid);
  let donoSnap;
  try {
    donoSnap = await donoRef.get();
  } catch (err) {
    console.error(`[${PREFIX}] get dono falhou:`, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível ler o perfil do dono.");
  }
  if (!donoSnap.exists) {
    return bad(res, PREFIX, 404, "Dono não encontrado.");
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
    console.error(`[${PREFIX}] listagem de funcionários falhou:`, err?.code, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível listar os funcionários do dono.");
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
    console.error(`[${PREFIX}] exclusão de contratos falhou:`, err?.code, err?.message);
    return bad(
      res,
      PREFIX,
      500,
      "Não foi possível excluir os contratos.",
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
    console.error(`[${PREFIX}] exclusão de clientes top-level falhou:`, err?.code, err?.message);
    return bad(
      res,
      PREFIX,
      500,
      "Não foi possível excluir os clientes.",
    );
  }

  // 10c) Exclui a sub-coleção legada usuarios/{donoUid}/clientes
  //      (caso ainda existam docs lá) + sub-coleções filhas.
  //      Importante: excluirSubcolecoesRecursivo recebe um
  //      DocumentReference (faz listCollections() no documento), então
  //      precisamos iterar a coleção legada via get() e passar cada
  //      documento individualmente.
  try {
    const clientesLegadosSnap = await donoRef
      .collection("clientes")
      .limit(MAX_ITENS_POR_OPERACAO)
      .get();
    for (const cliDoc of clientesLegadosSnap.docs) {
      stats.subDocsExcluidos += await excluirSubcolecoesRecursivo(dbAdmin, cliDoc.ref, 0);
      await cliDoc.ref.delete();
      stats.clientesExcluidos += 1;
    }
  } catch (err) {
    console.error(`[${PREFIX}] exclusão de clientes legados falhou:`, err?.code, err?.message);
    return bad(
      res,
      PREFIX,
      500,
      "Não foi possível excluir a subcoleção legada de clientes.",
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
      console.error(`[${PREFIX}] exclusão de dados do funcionário falhou:`, err?.code, err?.message);
      return bad(
        res,
        PREFIX,
        500,
        "Não foi possível excluir os dados vinculados ao funcionário.",
      );
    }

    try {
      await funcRef.delete();
      stats.funcionariosExcluidos += 1;
    } catch (err) {
      console.error(`[${PREFIX}] exclusão do funcionarios/{id} falhou:`, err?.code, err?.message);
      return bad(
        res,
        PREFIX,
        500,
        "Não foi possível remover o cadastro do funcionário.",
      );
    }

    if (funcAuthUid) {
      try {
        const perfilRef = dbAdmin.collection("usuarios").doc(funcAuthUid);
        await perfilRef.delete();
      } catch (err) {
        // Se o perfil não existe, não é erro — prossegue para Auth.
        if (err?.code !== 5 && err?.code !== "NOT_FOUND") {
          console.error(`[${PREFIX}] exclusão do perfil do funcionário falhou:`, err?.code, err?.message);
          return bad(
            res,
            PREFIX,
            500,
            "Não foi possível remover o perfil do funcionário.",
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
          console.error(`[${PREFIX}] deleteUser (funcionário) falhou:`, err?.code, err?.message);
          return bad(
            res,
            PREFIX,
            500,
            "Funcionário removido dos dados, mas a conta de autenticação não pôde ser excluída.",
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
    console.error(`[${PREFIX}] exclusão de sub-coleções restantes falhou:`, err?.code, err?.message);
    return bad(
      res,
      PREFIX,
      500,
      "Não foi possível remover as sub-coleções restantes.",
    );
  }

  // 10f) Exclui o doc raiz do dono
  try {
    await donoRef.delete();
  } catch (err) {
    console.error(`[${PREFIX}] exclusão do doc raiz do dono falhou:`, err?.code, err?.message);
    return bad(
      res,
      PREFIX,
      500,
      "Não foi possível remover o perfil do dono.",
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
      console.error(`[${PREFIX}] deleteUser (dono) falhou:`, err?.code, err?.message);
      return bad(
        res,
        PREFIX,
        500,
        "Dados do dono removidos, mas a conta de autenticação não pôde ser excluída.",
      );
    }
  }

  return res.status(200).json({
    ok: true,
    donoUid,
    ...stats,
  });
}
