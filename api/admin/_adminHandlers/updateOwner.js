// Sub-handler: POST /api/admin/update-owner
//
// Disparado por api/admin/[...slug].js quando slug === "update-owner".
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
//                     "criarFuncionarios": true },
//     "plan": "free" | "pro",
//     "planVigencia": { "inicio": "YYYY-MM-DD", "fim": "YYYY-MM-DD" } | null
//   }
//
// planVigencia: datas em meia-noite LOCAL; gravadas como Timestamp.
// fim >= inicio (senão 400). null = remover vigência. Se omitido,
// a vigência existente é preservada (compat com Free que volta a Pro).

import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { bad, extrairBearer, getAdminSdk, verificarToken } from "../../_lib/http.js";
import { getAuth } from "../../_lib/dono.js";

const PREFIX = "admin/update-owner";

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

  // planVigencia: { inicio, fim }. Aceita string "YYYY-MM-DD" ou
  // Timestamp já existente. Sempre gravamos como Timestamp.fromDate
  // em meia-noite LOCAL (sem drift de timezone). Validação:
  //   - inicio e fim são ambos obrigatórios quando planVigencia é enviado.
  //   - fim >= inicio, senão 400.
  // Compat: se `plan` não veio, `planVigencia` ainda é aceito (admin
  // pode atualizar só a vigência de um dono já Pro).
  if (body.planVigencia !== undefined) {
    if (body.planVigencia === null) {
      // Admin explicitamente limpou a vigência (ex: voltou para Free
      // e quer apagar datas antigas). Permitido; gravamos delete marker.
      update.planVigencia = FieldValue.delete();
    } else if (typeof body.planVigencia !== "object") {
      return { ok: false, erro: "planVigencia deve ser um objeto {inicio, fim} ou null." };
    } else {
      const parseDataVigencia = (raw) => {
        if (raw == null) return null;
        // Timestamp já existente
        if (typeof raw === "object" && typeof raw.toDate === "function") {
          const d = raw.toDate();
          if (Number.isNaN(d.getTime())) return null;
          return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }
        // Date nativo
        if (raw instanceof Date) {
          if (Number.isNaN(raw.getTime())) return null;
          return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
        }
        // String "YYYY-MM-DD"
        if (typeof raw === "string") {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
          if (!m) return null;
          return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        }
        return null;
      };
      const inicio = parseDataVigencia(body.planVigencia.inicio);
      const fim = parseDataVigencia(body.planVigencia.fim);
      if (!inicio || !fim) {
        return {
          ok: false,
          erro: "planVigencia.inicio e planVigencia.fim são obrigatórios (formato 'YYYY-MM-DD').",
        };
      }
      if (fim.getTime() < inicio.getTime()) {
        return {
          ok: false,
          erro: "A data de término não pode ser anterior à data de início.",
        };
      }
      update.planVigencia = {
        inicio: Timestamp.fromDate(inicio),
        fim: Timestamp.fromDate(fim),
      };
    }
  }

  if (Object.keys(update).length === 0) {
    return {
      ok: false,
      erro: "Informe pelo menos um campo para atualizar (status, limites, permissoes, plan ou planVigencia).",
    };
  }

  return { ok: true, donoUid, update };
}

export async function updateOwnerHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // 1) ADMIN_UID (env var)
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) {
    return bad(res, PREFIX, 500, "Configuração do servidor ausente. ADMIN_UID não foi definido no servidor.", {
      variavel: "ADMIN_UID",
    });
  }

  // 2) Bearer token
  const idToken = extrairBearer(req);
  if (!idToken) {
    return bad(res, PREFIX, 401, "Autenticação obrigatória.");
  }

  // 3) Firebase Admin
  const admin = getAdminSdk(res, PREFIX);
  if (!admin) return; // getAdminSdk já escreveu a resposta de erro
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 4) Verifica identidade
  const chamadorUid = await verificarToken(res, PREFIX, authAdmin, idToken);
  if (!chamadorUid) return; // verificarToken já escreveu a resposta de erro

  // 5) BLOQUEIO PRINCIPAL
  if (chamadorUid !== adminUid) {
    return bad(res, PREFIX, 403, "Acesso restrito ao administrador do sistema.");
  }

  // 6) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const validacao = validarBody(body);
  if (!validacao.ok) {
    return bad(res, PREFIX, 400, validacao.erro);
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
    console.error(`[${PREFIX}] get dono falhou:`, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível ler o perfil do dono.");
  }
  if (!existe) {
    return bad(res, PREFIX, 404, "Dono não encontrado.");
  }

  // 8) Aplica o update com merge. Admin SDK ignora as Firestore Rules.
  //    Adiciona updatedAt: serverTimestamp() para auditoria leve.
  const updateFinal = { ...update, updatedAt: FieldValue.serverTimestamp() };
  try {
    await donoRef.update(updateFinal);
  } catch (err) {
    console.error(`[${PREFIX}] updateDoc falhou:`, err?.code, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível atualizar o dono.");
  }

  return res.status(200).json({
    ok: true,
    donoUid,
    status: update.status ?? null,
    plano: update.plan ?? null,
    limites: update.limites ?? null,
    permissoes: update.permissoes ?? null,
    planVigencia: update.planVigencia === undefined ? null : (body.planVigencia === null ? null : { inicio: body.planVigencia.inicio, fim: body.planVigencia.fim }),
  });
}
