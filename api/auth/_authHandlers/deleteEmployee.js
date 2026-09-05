// Sub-handler: POST /api/auth/delete-employee
//
// Disparado por api/auth/[...slug].js quando slug === "delete-employee".
//
// Exclusão DEFINITIVA de um funcionário e de TODOS os dados a ele
// vinculados (clientes e contratos que ele criou). Apenas o DONO
// pode executar — funcionário nunca consegue chamar este endpoint
// (nem para si próprio nem para outro).
//
// Fluxo (chamado pelo DONO autenticado):
//   1. Recebe { funcionarioId, funcionarioAuthUid }.
//   2. Valida método, body.
//   3. Valida o `Authorization: Bearer <idToken>` via Firebase Admin.
//   4. Confirma que o chamador é DONO (perfil sem role/ownerUid).
//      O `ownerUid` para o escopo da exclusão é o `chamadorUid` do
//      token — NUNCA o enviado no body (cliente não confiável).
//   5. Lê /usuarios/{ownerUid}/funcionarios/{funcionarioId} e
//      confirma que:
//        - existe;
//        - resource.authUid === funcionarioAuthUid (defesa contra
//          tampering do body);
//        - o chamador é dono desse funcionário (chamadorUid é o
//          ownerUid porque o doc vive em funcionarios do chamador).
//   6. Identifica e exclui, NA ORDEM:
//        a) Subcoleções de cada contrato (pagamentos, jurosRecebidos,
//           e quaisquer outras subcoleções existentes — exclusão
//           recursiva por listagem de collectionIds).
//        b) Documento do contrato (usuarios/{ownerUid}/contratos/{cid}).
//        c) Documento do cliente (clientes/{clienteId}).
//        d) Documento do funcionário (usuarios/{ownerUid}/funcionarios/{fid}).
//        e) Perfil do funcionário (usuarios/{funcionarioAuthUid}).
//        f) Usuário do Firebase Authentication (authAdmin.deleteUser).
//   7. Rollback: se algo falhar no meio do caminho, retornamos erro
//      claro. Não tentamos restaurar dados já apagados (impossível).
//      O chamador pode repetir a operação — o que sobrou será apagado.
//
// Segurança:
//   - Variáveis sensíveis em process.env.
//   - Nenhuma senha trafega por este endpoint.
//   - O frontend NÃO ganha permissão no Firestore — toda a exclusão
//     passa por Admin SDK (que bypassa as Rules).

import { getFirestore } from "firebase-admin/firestore";
import { bad, extrairBearer, getAdminSdk, verificarToken } from "../../_lib/http.js";
import { excluirSubcolecoesRecursivo } from "../../_lib/tree.js";
import { getAuth } from "../../_lib/dono.js";

const PREFIX = "auth/delete-employee";

// Limite de contratos/clientes processados por chamada. Se um único
// funcionário tiver mais que isso, a operação precisa ser repetida.
// Admin SDK tem limite de 500 writes por batch — usamos batches
// internamente, então este limite é só para evitar loop eterno.
const MAX_ITENS_POR_OPERACAO = 5000;

export async function deleteEmployeeHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const funcionarioId = typeof body.funcionarioId === "string" ? body.funcionarioId.trim() : "";
  const funcionarioAuthUid = typeof body.funcionarioAuthUid === "string" ? body.funcionarioAuthUid.trim() : "";

  if (!funcionarioId) {
    return bad(res, PREFIX, 400, "Informe o identificador do funcionário.");
  }
  if (!funcionarioAuthUid) {
    return bad(res, PREFIX, 400, "Informe o authUid do funcionário.");
  }

  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, PREFIX, 401, "Autenticação obrigatória.");
  }

  const admin = getAdminSdk(res, PREFIX);
  if (!admin) return; // getAdminSdk já escreveu a resposta de erro
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 1) Identidade do chamador
  const chamadorUid = await verificarToken(res, PREFIX, authAdmin, idToken);
  if (!chamadorUid) return; // verificarToken já escreveu a resposta de erro

  // 2) Confirma que o chamador é DONO
  let perfilChamador;
  try {
    const snap = await dbAdmin.collection("usuarios").doc(chamadorUid).get();
    if (!snap.exists) {
      return bad(res, PREFIX, 403, "Perfil de dono não encontrado.");
    }
    perfilChamador = snap.data() || {};
  } catch (err) {
    console.error(`[${PREFIX}] Leitura do perfil do chamador falhou:`, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível validar o chamador.");
  }
  if (perfilChamador.role || perfilChamador.ownerUid) {
    return bad(res, PREFIX, 403, "Apenas o proprietário da conta pode excluir funcionários.");
  }

  // 3) Valida o funcionário
  const funcRef = dbAdmin
    .collection("usuarios")
    .doc(chamadorUid)
    .collection("funcionarios")
    .doc(funcionarioId);

  let funcSnap;
  try {
    funcSnap = await funcRef.get();
  } catch (err) {
    console.error(`[${PREFIX}] Leitura do funcionário falhou:`, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível carregar o funcionário.");
  }
  if (!funcSnap.exists) {
    return bad(res, PREFIX, 404, "Funcionário não encontrado.");
  }
  const funcData = funcSnap.data() || {};

  // Defesa: o authUid no doc deve bater com o enviado no body
  if (funcData.authUid !== funcionarioAuthUid) {
    return bad(res, PREFIX, 400, "Identificador do funcionário inconsistente.");
  }

  // Defesa extra: confirma perfil do funcionário (vínculo
  // funcionarioAuthUid → chamadorUid via ownerUid)
  const perfilFuncRef = dbAdmin.collection("usuarios").doc(funcionarioAuthUid);
  let perfilFuncSnap;
  try {
    perfilFuncSnap = await perfilFuncRef.get();
  } catch (err) {
    console.error(`[${PREFIX}] Leitura do perfil do funcionário falhou:`, err?.message);
  }
  if (perfilFuncSnap && perfilFuncSnap.exists) {
    const perfilFuncData = perfilFuncSnap.data() || {};
    if (perfilFuncData.ownerUid !== chamadorUid) {
      return bad(res, PREFIX, 403, "Funcionário não pertence a este proprietário.");
    }
  }

  // Estatísticas para retornar ao frontend
  const stats = {
    clientesExcluidos: 0,
    contratosExcluidos: 0,
    subDocsExcluidos: 0,
    authExcluido: false,
  };

  // 4) Identifica e exclui CONTRATOS do funcionário
  //    Filtra por createdBy === funcionarioAuthUid. Contratos do dono
  //    e de outros funcionários NÃO são tocados.
  try {
    const contratosSnap = await dbAdmin
      .collection("usuarios")
      .doc(chamadorUid)
      .collection("contratos")
      .where("createdBy", "==", funcionarioAuthUid)
      .limit(MAX_ITENS_POR_OPERACAO)
      .get();

    for (const cDoc of contratosSnap.docs) {
      // Exclui subcoleções recursivamente (helper compartilhado em _lib/tree.js)
      stats.subDocsExcluidos += await excluirSubcolecoesRecursivo(dbAdmin, cDoc.ref);
      // Exclui o contrato em si
      await cDoc.ref.delete();
      stats.contratosExcluidos += 1;
    }
  } catch (err) {
    console.error(`[${PREFIX}] Exclusão de contratos falhou:`, err?.code, err?.message);
    return bad(
      res,
      PREFIX,
      500,
      `Não foi possível excluir os contratos: ${err?.message || "erro desconhecido"}.`,
    );
  }

  // 5) Identifica e exclui CLIENTES do funcionário
  //    Filtra por createdBy === funcionarioAuthUid. Clientes do dono
  //    (sem createdBy ou com createdBy === dono) e de outros
  //    funcionários NÃO são tocados.
  try {
    const clientesSnap = await dbAdmin
      .collection("clientes")
      .where("ownerId", "==", chamadorUid)
      .where("createdBy", "==", funcionarioAuthUid)
      .limit(MAX_ITENS_POR_OPERACAO)
      .get();

    for (const cliDoc of clientesSnap.docs) {
      // Exclui subcoleções do cliente (se houver)
      stats.subDocsExcluidos += await excluirSubcolecoesRecursivo(dbAdmin, cliDoc.ref);
      // Exclui o cliente em si
      await cliDoc.ref.delete();
      stats.clientesExcluidos += 1;
    }
  } catch (err) {
    console.error(`[${PREFIX}] Exclusão de clientes falhou:`, err?.code, err?.message);
    return bad(
      res,
      PREFIX,
      500,
      `Não foi possível excluir os clientes: ${err?.message || "erro desconhecido"}.`,
    );
  }

  // 6) Exclui o documento do funcionário na subcoleção do dono
  try {
    await funcRef.delete();
  } catch (err) {
    console.error(`[${PREFIX}] Exclusão do doc funcionarios/{id} falhou:`, err?.code, err?.message);
    return bad(
      res,
      PREFIX,
      500,
      `Não foi possível remover o cadastro do funcionário: ${err?.message || "erro"}.`,
    );
  }

  // 7) Exclui o perfil do funcionário
  try {
    await perfilFuncRef.delete();
  } catch (err) {
    // Se o perfil não existe, não é erro — prossegue para Auth.
    if (err?.code !== 5 && err?.code !== "NOT_FOUND") {
      console.error(`[${PREFIX}] Exclusão do perfil usuarios/{funcUid} falhou:`, err?.code, err?.message);
      return bad(
        res,
        PREFIX,
        500,
        `Não foi possível remover o perfil do funcionário: ${err?.message || "erro"}.`,
      );
    }
  }

  // 8) Exclui a conta do Firebase Authentication
  try {
    await authAdmin.deleteUser(funcionarioAuthUid);
    stats.authExcluido = true;
  } catch (err) {
    // Se o usuário já não existe no Auth, considera OK.
    if (err?.code === "auth/user-not-found") {
      stats.authExcluido = true; // já não existia — mesmo resultado
    } else {
      console.error(`[${PREFIX}] deleteUser Auth falhou:`, err?.code, err?.message);
      return bad(
        res,
        PREFIX,
        500,
        `Funcionário removido dos dados, mas a conta de autenticação não pôde ser excluída: ${err?.message || "erro"}.`,
      );
    }
  }

  return res.status(200).json({
    ok: true,
    funcionarioId,
    ...stats,
  });
}
