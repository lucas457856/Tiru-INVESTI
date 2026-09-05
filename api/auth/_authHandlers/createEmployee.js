// Sub-handler: POST /api/auth/create-employee
//
// Disparado por api/auth/[...slug].js quando slug === "create-employee".
//
// Fluxo (chamado pelo DONO autenticado):
//   1. Recebe { nome, email, senha, limiteContratos } do cliente.
//   2. Valida método, body, formato (regex e-mail, senha ≥ 6, etc.).
//   3. Valida o `Authorization: Bearer <idToken>` via Firebase Admin
//      (verifyIdToken). Garante que o chamador está autenticado.
//   4. Confirma que o chamador é o DONO (perfil /usuarios/{uid} existe
//      e NÃO tem role/ownerUid — funcionários têm esses campos).
//   5. Cria o usuário no Firebase Authentication via Admin SDK
//      (authAdmin.createUser). ESTA é a chamada que cria o login do
//      funcionário sem afetar a sessão do dono no navegador — Admin
//      roda no servidor, currentUser do browser não muda.
//   6. Persiste 2 docs:
//        - usuarios/{donoUid}/funcionarios/{funcionarioId}
//            { nome, email, status:"ativo", limiteContratos, authUid,
//              createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
//        - usuarios/{funcionarioUid}
//            { nome, email, ownerUid: donoUid, funcionarioId, role:"funcionario",
//              createdAt: serverTimestamp() }
//   7. ROLLBACK: se a persistência falhar após createUser, apaga o
//      usuário Auth (authAdmin.deleteUser) para não deixar conta órfã.
//   8. Retorna { ok:true, funcionarioId, authUid }. NUNCA retorna senha.
//
// Segurança:
//   - Variáveis sensíveis (FIREBASE_PRIVATE_KEY) ficam em process.env.
//   - A senha NUNCA é persistida, logada, ou retornada no body.
//   - O e-mail é normalizado (lowercase, trim) antes de comparar e gravar.
//   - Validações de payload: tipo, comprimento mínimo, regex e-mail.

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { bad, extrairBearer, getAdminSdk, verificarToken } from "../../_lib/http.js";
import { ehPro, getAuth } from "../../_lib/dono.js";

const PREFIX = "auth/create-employee";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOME_MIN = 2;
const NOME_MAX = 80;
const SENHA_MIN = 6;
const SENHA_MAX = 128;
const LIMITE_MIN = 0;
const LIMITE_MAX = 100000;

export async function createEmployeeHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // 1) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const senha = typeof body.senha === "string" ? body.senha : "";
  const limiteRaw = body.limiteContratos;

  if (!nome || nome.length < NOME_MIN || nome.length > NOME_MAX) {
    return bad(res, PREFIX, 400, `Informe um nome entre ${NOME_MIN} e ${NOME_MAX} caracteres.`);
  }
  if (!email || !EMAIL_REGEX.test(email)) {
    return bad(res, PREFIX, 400, "E-mail inválido.");
  }
  if (!senha || senha.length < SENHA_MIN || senha.length > SENHA_MAX) {
    return bad(res, PREFIX, 400, `A senha deve ter entre ${SENHA_MIN} e ${SENHA_MAX} caracteres.`);
  }
  const limiteNumero = Number(limiteRaw);
  if (
    limiteRaw === undefined ||
    limiteRaw === null ||
    !Number.isFinite(limiteNumero) ||
    !Number.isInteger(limiteNumero) ||
    limiteNumero < LIMITE_MIN ||
    limiteNumero > LIMITE_MAX
  ) {
    return bad(res, PREFIX, 400, `Limite de contratos inválido (${LIMITE_MIN} a ${LIMITE_MAX}).`);
  }

  // 2) Token do chamador
  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, PREFIX, 401, "Autenticação obrigatória.");
  }

  // 3) Firebase Admin
  const admin = getAdminSdk(res, PREFIX);
  if (!admin) return; // getAdminSdk já escreveu a resposta de erro
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 4) Verifica identidade do chamador
  const chamadorUid = await verificarToken(res, PREFIX, authAdmin, idToken);
  if (!chamadorUid) return; // verificarToken já escreveu a resposta de erro

  // 5) Confirma que o chamador é DONO: /usuarios/{uid} existe e não
  //    tem role/ownerUid (perfis de funcionário têm ambos).
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
    return bad(
      res,
      PREFIX,
      403,
      "Apenas o proprietário da conta pode cadastrar funcionários.",
    );
  }

  // 5b) Gate administrativo: status, permissão e limite de funcionários
  //     definidos pelo Painel Administrativo principal (ADMIN_UID).
  //     - status: se o dono está bloqueado, não pode criar funcionários.
  //     - permissoes.criarFuncionarios: false → bloqueia.
  //     - limites.funcionarios: 0 = sem limite; > 0 → não pode passar.
  //
  //     Esses campos são opcionais (defaults permissivos aplicados)
  //     para garantir compatibilidade com donos antigos.
  if (perfilChamador.status === "bloqueado") {
    return bad(
      res,
      PREFIX,
      403,
      "Conta bloqueada pelo administrador. Não é possível cadastrar funcionários.",
    );
  }
  if (perfilChamador.permissoes?.criarFuncionarios === false) {
    return bad(
      res,
      PREFIX,
      403,
      "A criação de funcionários foi bloqueada pelo administrador.",
    );
  }
  const limiteFuncionarios = Number(perfilChamador.limites?.funcionarios) || 0;
  // EXCEÇÃO: se o DONO estiver no plano PRO, o limite de funcionários
  // é ignorado (ilimitado). Os limites FREE permanecem salvos no
  // Firestore para serem reativados se o DONO voltar para FREE.
  // Status e permissão continuam validados acima.
  if (!ehPro(perfilChamador) && limiteFuncionarios > 0) {
    try {
      const contSnap = await dbAdmin
        .collection("usuarios")
        .doc(chamadorUid)
        .collection("funcionarios")
        .count()
        .get();
      const cont = contSnap.data().count || 0;
      if (cont >= limiteFuncionarios) {
        return bad(
          res,
          PREFIX,
          403,
          `Limite de funcionários atingido (${cont}/${limiteFuncionarios}). Entre em contato com o administrador.`,
        );
      }
    } catch (err) {
      console.error(`[${PREFIX}] Contagem de funcionários falhou:`, err?.message);
      return bad(res, PREFIX, 500, "Não foi possível validar o limite de funcionários.");
    }
  }

  // 6) Verifica se já existe funcionário com esse e-mail na subcoleção
  //    do dono. Se existir (em qualquer status), recusamos — e-mail
  //    é único por dono.
  try {
    const dupQuery = await dbAdmin
      .collection("usuarios")
      .doc(chamadorUid)
      .collection("funcionarios")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (!dupQuery.empty) {
      return bad(res, PREFIX, 409, "Já existe um funcionário com este e-mail.");
    }
  } catch (err) {
    console.error(`[${PREFIX}] Verificação de duplicidade falhou:`, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível validar o e-mail.");
  }

  // 7) Cria usuário no Firebase Auth (server-side, sem afetar sessão
  //    do dono no browser). Em caso de e-mail já em uso, auth/email-already-in-use.
  let funcionarioAuthUid;
  try {
    const userRecord = await authAdmin.createUser({
      email,
      password: senha,
      displayName: nome,
    });
    funcionarioAuthUid = userRecord.uid;
  } catch (err) {
    if (err?.code === "auth/email-already-in-use") {
      return bad(res, PREFIX, 409, "Este e-mail já está cadastrado no Firebase Authentication.");
    }
    if (err?.code === "auth/invalid-email") {
      return bad(res, PREFIX, 400, "E-mail inválido.");
    }
    if (err?.code === "auth/weak-password") {
      return bad(res, PREFIX, 400, "A senha é muito fraca. Use pelo menos 6 caracteres.");
    }
    console.error(`[${PREFIX}] createUser falhou:`, err?.code, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível criar a conta de autenticação.");
  }

  // 8) Persiste os 2 docs Firestore. Se QUALQUER um falhar, rollback
  //    do usuário Auth (deleteUser) para não deixar conta órfã.
  const funcionariosRef = dbAdmin
    .collection("usuarios")
    .doc(chamadorUid)
    .collection("funcionarios");
  const perfilFuncRef = dbAdmin.collection("usuarios").doc(funcionarioAuthUid);

  let funcionarioId;
  try {
    const novoFunc = await funcionariosRef.add({
      nome,
      email,
      status: "ativo",
      limiteContratos: limiteNumero,
      authUid: funcionarioAuthUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deletedAt: null,
    });
    funcionarioId = novoFunc.id;

    await perfilFuncRef.set({
      nome,
      email,
      ownerUid: chamadorUid,
      funcionarioId,
      role: "funcionario",
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error(`[${PREFIX}] Persistência Firestore falhou — iniciando rollback:`, err?.message);
    try {
      await authAdmin.deleteUser(funcionarioAuthUid);
    } catch (rbErr) {
      console.error(`[${PREFIX}] Rollback deleteUser falhou:`, rbErr?.code, rbErr?.message);
    }
    return bad(res, PREFIX, 500, "Não foi possível cadastrar o funcionário. Tente novamente.");
  }

  return res.status(201).json({
    ok: true,
    funcionarioId,
    authUid: funcionarioAuthUid,
  });
}
