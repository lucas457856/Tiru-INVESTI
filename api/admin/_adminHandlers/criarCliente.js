// Sub-handler: POST /api/admin/criar-cliente
//
// Disparado por api/admin/[...slug].js quando slug === "criar-cliente".
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
//     documentos?: array,
//     deviceId?: string (obrigatório para chamadas autenticadas do front)
//   }
// O server preenche automaticamente:
//   - ownerId: uid do DONO (request.auth.uid para o DONO; meuPerfil.ownerUid para o FUNCIONÁRIO)
//   - createdBy: uid do autor (request.auth.uid)
//   - createdAt, updatedAt: serverTimestamp

import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { bad, extrairBearer, getAdminSdk, verificarToken } from "../../_lib/http.js";
import { RATE_OPTS_ADMIN } from "../../_lib/rateLimit.js";
import {
  ehPro,
  getAuth,
  normalizarLimites,
  normalizarPermissoes,
  normalizarStatus,
  resolverDonoEfetivo,
  validarSourceDeviceId,
} from "../../_lib/dono.js";

const PREFIX = "admin/criar-cliente";
const NOME_MIN = 2;
const NOME_MAX = 200;
const CPF_MAX = 20;
const TELEFONE_MAX = 30;
const EMAIL_MAX = 200;
const ENDERECO_MAX = 400;
const SCORES = ["Baixo", "Médio", "Alto"];

export async function criarClienteHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // 1) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const nomeCompleto = typeof body.nomeCompleto === "string" ? body.nomeCompleto.trim() : "";
  if (!nomeCompleto || nomeCompleto.length < NOME_MIN || nomeCompleto.length > NOME_MAX) {
    return bad(res, PREFIX, 400, `Informe um nome entre ${NOME_MIN} e ${NOME_MAX} caracteres.`);
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
    return bad(res, PREFIX, 401, "Autenticação obrigatória.");
  }

  // 3) Admin
  const admin = getAdminSdk(res, PREFIX);
  if (!admin) return; // getAdminSdk já escreveu a resposta de erro
  const authAdmin = getAuth(admin);
  const dbAdmin = getFirestore(admin);

  // 4) Identidade
  const chamadorUid = await verificarToken(res, PREFIX, authAdmin, idToken, RATE_OPTS);
  if (!chamadorUid) return; // verificarToken já escreveu a resposta de erro

  // 5) Perfil do chamador
  let perfilChamador;
  try {
    const snap = await dbAdmin.collection("usuarios").doc(chamadorUid).get();
    if (!snap.exists) {
      return bad(res, PREFIX, 403, "Perfil do chamador não encontrado.");
    }
    perfilChamador = snap.data() || {};
  } catch (err) {
    console.error(`[${PREFIX}] Leitura do perfil falhou:`, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível validar o chamador.");
  }

  // 6) Resolve o DONO efetivo (helper compartilhado em _lib/dono.js)
  const r = resolverDonoEfetivo(perfilChamador, chamadorUid);
  if (!r.ok) {
    return bad(res, PREFIX, r.code, r.msg);
  }
  const { donoUid, ehFuncionario, roleChamador } = r;
  const criadoPorFuncionario = ehFuncionario;

  // 7) Perfil do DONO (validação de status, permissoes, limites)
  let perfilDono;
  try {
    const snap = await dbAdmin.collection("usuarios").doc(donoUid).get();
    if (!snap.exists) {
      return bad(res, PREFIX, 403, "Proprietário não encontrado.");
    }
    perfilDono = snap.data() || {};
  } catch (err) {
    console.error(`[${PREFIX}] Leitura do perfil do dono falhou:`, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível validar o proprietário.");
  }

  const status = normalizarStatus(perfilDono);
  if (status === "bloqueado") {
    return bad(
      res,
      PREFIX,
      403,
      "Conta bloqueada pelo administrador. Não é possível cadastrar clientes.",
    );
  }

  const permissoes = normalizarPermissoes(perfilDono);
  if (!permissoes.criarClientes) {
    return bad(
      res,
      PREFIX,
      403,
      "A criação de clientes foi bloqueada pelo administrador.",
    );
  }

  const limites = normalizarLimites(perfilDono);

  // 8) Limite de clientes: contagem real no servidor.
  // 0 = sem limite; > 0 = bloqueia quando count >= limite.
  // EXCEÇÃO: se o DONO estiver no plano PRO, o limite é ignorado
  // (ilimitado). Os limites FREE permanecem salvos no Firestore para
  // serem reativados se o DONO voltar para FREE. Permissões e status
  // continuam sendo validados normalmente acima.
  if (!ehPro(perfilDono) && limites.clientes > 0) {
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
          PREFIX,
          403,
          `Limite de clientes atingido (${cont}/${limites.clientes}). Entre em contato com o administrador para aumentar seu limite.`,
        );
      }
    } catch (err) {
      console.error(`[${PREFIX}] Contagem de clientes falhou:`, err?.code, err?.message);
      return bad(res, PREFIX, 500, "Não foi possível validar o limite de clientes.");
    }
  }

  // 8.5) Validação do `deviceId` de origem (Fase A — notificações sincronizadas).
  //
  // O `deviceId` é OBRIGATÓRIO para toda chamada autenticada por
  // idToken (frontend). Não aceitamos `deviceId` ausente nem vazio,
  // e nem `sourceDeviceId: null` como fallback — esta endpoint é
  // exclusiva de chamadas do frontend; chamadas internas (cron, admin)
  // devem usar outros endpoints dedicados.
  //
  // Validações (todas antes do addDoc do cliente):
  //   1. String não-vazia (até 200 chars).
  //   2. Existe em `usuarios/{chamadorUid}/devices/{deviceId}` —
  //      dispositivo REGISTRADO para o chamador.
  //   3. O doc do device tem `ownerUid === donoUid` (não pode ser
  //      device de outro dono).
  //   4. O doc do device tem `userRole` compatível com o chamador
  //      (`owner` ou `funcionario` conforme `criadoPorFuncionario`).
  //
  // Se inválido, retornamos 400/403 ANTES de criar o cliente.
  const deviceIdRaw = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  if (!deviceIdRaw) {
    return bad(
      res,
      PREFIX,
      400,
      "deviceId é obrigatório para registrar a origem do evento. Atualize a página para registrar este dispositivo antes de continuar.",
    );
  }
  if (deviceIdRaw.length > 200) {
    return bad(res, PREFIX, 400, "deviceId inválido (até 200 chars).");
  }
  const validacaoDevice = await validarSourceDeviceId({
    dbAdmin,
    chamadorUid,
    donoUid,
    roleChamador,
    sourceDeviceId: deviceIdRaw,
    prefix: PREFIX,
  });
  if (!validacaoDevice.ok) {
    return bad(res, PREFIX, validacaoDevice.code, validacaoDevice.msg);
  }
  const sourceDeviceId = validacaoDevice.sourceDeviceId;

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
    console.error(`[${PREFIX}] addDoc falhou:`, err?.code, err?.message);
    return bad(res, PREFIX, 500, "Não foi possível salvar o cliente. Tente novamente.");
  }

  // 10) Evento central (Fase A — notificações sincronizadas).
  //
  // Gera um `eventId` server-side e grava o evento em
  // `usuarios/{ownerId}/notificationEvents/{eventId}`. O `dispatch`
  // (envio FCM) é responsabilidade do CLIENTE, chamado após esta
  // resposta via /api/notifications/dispatch.
  //
  // `sourceDeviceId` foi validado no passo 8.5 (sempre presente, nunca
  // null). Falha aqui NÃO bloqueia o fluxo principal.
  const eventId = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  try {
    await dbAdmin
      .collection("usuarios")
      .doc(donoUid)
      .collection("notificationEvents")
      .doc(eventId)
      .set({
        eventId,
        type: "CLIENT_CREATED",
        title: "Novo cliente cadastrado",
        body: nomeCompleto + " foi adicionado à sua base de clientes.",
        data: {
          clienteId: docRef.id,
          clienteNome: nomeCompleto,
        },
        sourceDeviceId,
        ownerId: donoUid,
        createdBy: { uid: chamadorUid, role: criadoPorFuncionario ? "funcionario" : "owner" },
        createdAt: FieldValue.serverTimestamp(),
        status: "created",
        dispatchedAt: null,
      });
    console.log(
      `[${PREFIX}] evento criado:`,
      `eventId=${eventId}`,
      `type=CLIENT_CREATED`,
      `ownerId=${donoUid}`,
      `clienteId=${docRef.id}`,
      `sourceDevice=${sourceDeviceId}`,
    );
  } catch (err) {
    console.error(`[${PREFIX}] criar evento falhou:`, err?.code, err?.message);
    // Não bloqueia o fluxo principal.
  }

  return res.status(201).json({
    ok: true,
    id: docRef.id,
    cliente: { id: docRef.id, ...novoDoc, createdBy: criadoPorFuncionario ? "funcionario" : "dono" },
    eventId,
  });
}
