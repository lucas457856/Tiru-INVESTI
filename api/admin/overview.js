// API: GET /api/admin/overview
//
// Retorna a visão geral do sistema para o Painel Administrativo.
// Apenas a conta ADMIN_UID pode chamar — qualquer outro uid recebe
// 403 imediato.
//
// IMPORTANTE — POR QUE ISSO É SERVER-SIDE:
//   O Firestore Rules atual NÃO permite que o client SDK leia
//   `usuarios/{uid}` de outros donos (`request.auth.uid == uid`).
//   O Admin SDK bypassa as Rules (comportamento padrão) e permite
//   agregar dados de múltiplos donos. Isso é seguro porque:
//     - O ID Token é verificado (verifyIdToken).
//     - O decoded.uid é comparado com a env var ADMIN_UID.
//     - Se não bater, retorna 403 sem fazer nenhuma leitura.
//
// Segurança:
//   - ADMIN_UID vem de process.env (Vercel env vars).
//   - Nenhuma credencial Admin no front (FIREBASE_PRIVATE_KEY fica
//     no painel da Vercel).
//   - Nenhuma regra do Firestore foi enfraquecida.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "../_lib/firebaseAdmin.js";

// Defaults aplicados quando o doc do dono não tem os campos
// administrativos. Novas contas começam com limites de 5/5/5 e com
// a permissão de criar funcionários DESLIGADA — o admin ativa
// manualmente quando quiser liberar.
//
// ATENÇÃO: alterar estes valores NÃO afeta donos antigos. Quem já
// tem `limites`/`permissoes`/`status` no Firestore continua com
// os valores que lá estão. Os defaults só são aplicados quando o
// campo está AUSENTE no doc.
const LIMITES_PADRAO = { contratos: 5, clientes: 5, funcionarios: 5 };
const PERMISSOES_PADRAO = { criarContratos: true, criarClientes: true, criarFuncionarios: false };
const STATUS_PADRAO = "ativo";
const PLANO_PADRAO = "free";

// Normaliza o campo `plan`. Aceita apenas "free" ou "pro" — qualquer
// outro valor (ou ausente) é tratado como "free". Donos antigos sem
// o campo continuam funcionando sem migração destrutiva.
function normalizarPlano(data) {
  return data?.plan === "pro" ? "pro" : PLANO_PADRAO;
}

function bad(res, status, erro, extra = {}) {
  console.error(`[admin/overview] ${status} ${erro}`, extra);
  return res.status(status).json({ ok: false, erro, ...extra });
}

function extrairBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

async function contarSubcolecao(dbAdmin, docRef, collName) {
  try {
    const snap = await docRef.collection(collName).count().get();
    return snap.data().count || 0;
  } catch {
    return 0;
  }
}

// Conta clientes por dono na coleção top-level /clientes (filtrada
// por ownerId). Custo: 1 leitura agregada por dono. Aceitável.
async function contarClientesPorDono(dbAdmin, donoUid) {
  try {
    const snap = await dbAdmin
      .collection("clientes")
      .where("ownerId", "==", donoUid)
      .count()
      .get();
    return snap.data().count || 0;
  } catch {
    return 0;
  }
}

// Lê uma permissão do Firestore respeitando o default:
//   - `true` ou `false`  → usa o valor persistido.
//   - `undefined` (ausente) ou outro tipo → usa o default.
// Coerção explícita: garante que o retorno seja sempre boolean.
function lerPermissao(valor, padrao) {
  if (valor === true || valor === false) return valor;
  return padrao;
}

// Normaliza os campos administrativos aplicando defaults permissivos
// quando ausentes. Garante que o front sempre recebe o objeto completo.
function normalizarAdmin(data) {
  const status = (data?.status === "bloqueado" || data?.status === "ativo")
    ? data.status
    : STATUS_PADRAO;
  const limites = {
    // `!= null` + `Number.isFinite` (não `||`) para preservar 0
    // quando o limite está presente mas vale 0 (zero é válido:
    // significa "sem limite").
    contratos:
      data?.limites?.contratos != null && Number.isFinite(Number(data.limites.contratos))
        ? Number(data.limites.contratos)
        : LIMITES_PADRAO.contratos,
    clientes:
      data?.limites?.clientes != null && Number.isFinite(Number(data.limites.clientes))
        ? Number(data.limites.clientes)
        : LIMITES_PADRAO.clientes,
    funcionarios:
      data?.limites?.funcionarios != null && Number.isFinite(Number(data.limites.funcionarios))
        ? Number(data.limites.funcionarios)
        : LIMITES_PADRAO.funcionarios,
  };
  const permissoes = {
    criarContratos: lerPermissao(data?.permissoes?.criarContratos, PERMISSOES_PADRAO.criarContratos),
    criarClientes: lerPermissao(data?.permissoes?.criarClientes, PERMISSOES_PADRAO.criarClientes),
    criarFuncionarios: lerPermissao(data?.permissoes?.criarFuncionarios, PERMISSOES_PADRAO.criarFuncionarios),
  };
  return { status, limites, permissoes };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return bad(res, 405, "Método não permitido.");
  }

  // 1) ADMIN_UID (env var)
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) {
    console.error(
      "[admin/overview] ADMIN_UID não configurado. Defina no painel da Vercel (Production, Preview e Development) com o valor: hzfrWIuTXYgeasOTPD7pmKNxt1P2",
    );
    return bad(res, 500, "Configuração do servidor ausente. ADMIN_UID não foi definido no servidor.", {
      variavel: "ADMIN_UID",
    });
  }

  // 2) Token do chamador
  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, 401, "Autenticação obrigatória. Envie o Firebase ID Token no header Authorization: Bearer <token>.");
  }

  // 3) Inicializa Firebase Admin
  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch (err) {
    console.error("[admin/overview] Falha ao inicializar Firebase Admin:", err?.code, err?.message);
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
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 4) Verifica identidade
  let chamadorUid;
  try {
    const decoded = await authAdmin.verifyIdToken(idToken, true);
    chamadorUid = decoded.uid;
  } catch (err) {
    console.error("[admin/overview] verifyIdToken falhou:", err?.code, err?.message);
    return bad(res, 401, "Sessão inválida. Faça login novamente.");
  }

  // 5) BLOQUEIO PRINCIPAL: só ADMIN_UID
  if (chamadorUid !== adminUid) {
    return bad(res, 403, "Acesso restrito ao administrador do sistema.");
  }

  // 6) Agrega dados
  try {
    const usuariosSnap = await dbAdmin.collection("usuarios").get();

    const donos = [];
    const funcionarios = [];
    let totalClientes = 0;
    let totalContratos = 0;

    for (const uDoc of usuariosSnap.docs) {
      const data = uDoc.data() || {};
      const uid = uDoc.id;

      if (data.role === "funcionario" || data.ownerUid) {
        funcionarios.push({
          authUid: uid,
          ownerUid: data.ownerUid || null,
          funcionarioId: data.funcionarioId || null,
          nome: data.nome || null,
          email: data.email || null,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        });
        continue;
      }

      // Perfil de dono
      const [contFuncionarios, contContratos, contClientes] = await Promise.all([
        contarSubcolecao(dbAdmin, uDoc.ref, "funcionarios"),
        contarSubcolecao(dbAdmin, uDoc.ref, "contratos"),
        contarClientesPorDono(dbAdmin, uid),
      ]);

      const adminFields = normalizarAdmin(data);

      donos.push({
        uid,
        nome: data.nome || data.displayName || null,
        email: data.email || null,
        telefone: data.telefone || null,
        criadoEm: data.criadoEm || data.createdAt?.toDate?.()?.toISOString() || null,
        contFuncionarios,
        contContratos,
        contClientes,
        status: adminFields.status,
        plano: normalizarPlano(data),
        limites: adminFields.limites,
        permissoes: adminFields.permissoes,
      });
      totalContratos += contContratos;
    }

    // Total de clientes (top-level) — usado para o card "Clientes" do
    // painel. Pode divergir da soma por dono se houver clientes
    // órfãos (sem ownerId válido), o que é raro.
    try {
      const clientesSnap = await dbAdmin.collection("clientes").count().get();
      totalClientes = clientesSnap.data().count || 0;
    } catch {
      totalClientes = 0;
    }

    return res.status(200).json({
      ok: true,
      totals: {
        donos: donos.length,
        funcionarios: funcionarios.length,
        clientes: totalClientes,
        contratos: totalContratos,
      },
      donos,
      funcionarios,
      geradoEm: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[admin/overview] Agregação falhou:", err?.code, err?.message);
    return bad(res, 500, "Não foi possível agregar os dados do Firestore.");
  }
}
