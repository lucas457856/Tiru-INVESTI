// API: POST /api/admin/criar-contrato
//
// Cria um contrato em /usuarios/{donoUid}/contratos para o DONO
// autenticado (ou para o DONO ao qual o FUNCIONÁRIO autenticado
// está vinculado). Valida token, status, permissão e limite de
// contratos no servidor (Admin SDK), e só então grava o documento.
//
// POR QUE ISSO É SERVER-SIDE:
//   Mesma justificativa de /api/admin/criar-cliente: as Firestore
//   Rules não conseguem contar documentos de uma coleção de forma
//   portável/confiável para validar limites. A solução é mover
//   o create para um endpoint com Admin SDK, que ignora as Rules e
//   executa a checagem no servidor. O front não escreve mais em
//   /usuarios/{uid}/contratos via client SDK.
//
// Segurança:
//   - Token verificado via verifyIdToken.
//   - Status, permissoes e limites do DONO lidos via Admin SDK.
//   - Defaults permissivos: donos sem `limites` (5/5/5), sem
//     `permissoes` (criarContratos = true), sem `status` ("ativo").
//   - Limite 0 = sem limite. Limite > 0 = bloqueia quando count >= limite.
//   - Se o chamador for FUNCIONÁRIO, também valida o limite individual
//     do funcionário (`funcionarios/{id}.limiteContratos`) e o
//     status do funcionário.
//
// Body esperado:
//   {
//     clienteId: string (obrigatório; validado por ownerId == donoUid),
//     valorEmprestado: number (obrigatório > 0),
//     numeroParcelas: number (obrigatório >= 1),
//     juros?: number (0 se "Sem Juros", > 0 se "Com Juros"),
//     tipoJuros?: "parcela" | "total" | null,
//     tipoEmprestimo?: "Com Juros" | "Sem Juros" (default "Com Juros"),
//     frequencia?: "Diária" | "Semanal" | "Quinzenal" | "Mensal",
//     dataPrimeiraParcela?: string YYYY-MM-DD (default hoje),
//     valorParcela: number (obrigatório; calculado pelo front),
//     totalReceber: number (obrigatório; calculado pelo front),
//     jurosAtraso?: { cobrar: boolean, modo?: string, valor?: number },
//     observacao?: string
//   }
// O server preenche automaticamente:
//   - nome / clienteNome (lê do cliente)
//   - createdBy: uid do autor (chamador)
//   - valorRecebido: 0
//   - jurosRecebidos: 0
//   - saldoPrincipal: valorEmprestado
//   - quitado: false
//   - parcelasPagas: 0
//   - dataProximo: dataPrimeiraParcela
//   - abatimentos: []
//   - abatimentoTotal: 0
//   - criadoEm, updatedAt: serverTimestamp
//   - notificação do app: gravada em /usuarios/{donoUid}/notificacoes

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "../_lib/firebaseAdmin.js";

const DEFAULT_LIMITES = { contratos: 5, clientes: 5, funcionarios: 5 };
const DEFAULT_PERMISSOES = { criarContratos: true, criarClientes: true, criarFuncionarios: false };
const DEFAULT_STATUS = "ativo";
const FREQ_VALIDAS = ["Diária", "Semanal", "Quinzenal", "Mensal"];
const TIPO_JUROS_VALIDOS = ["parcela", "total", null];

// Plano: aceita apenas "pro". Qualquer outro valor (incluindo
// ausente) é tratado como "free". Mantém compatibilidade com donos
// antigos que não têm o campo `plan` no Firestore.
function ehPro(perfil) {
  return perfil?.plan === "pro";
}

function bad(res, status, erro) {
  console.error(`[admin/criar-contrato] ${status} ${erro}`);
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

// Calcula as parcelas no servidor para garantir consistência
// independente do que o front enviou. Suporta os dois tipos
// ("parcela" = juros em cada parcela; "total" = juros único).
function calcularParcelas({ valorEmprestado, numeroParcelas, juros, tipoJuros }) {
  const N = Math.max(1, Math.floor(numeroParcelas));
  const principal = Number(valorEmprestado) || 0;
  const taxa = Number(juros) || 0;
  if (taxa <= 0) {
    const valorParcela = principal / N;
    return {
      valorParcela: Math.round(valorParcela * 100) / 100,
      totalReceber: principal,
      jurosTotal: 0,
    };
  }
  if (tipoJuros === "total") {
    const jurosTotal = principal * (taxa / 100);
    const totalReceber = principal + jurosTotal;
    const valorParcela = totalReceber / N;
    return {
      valorParcela: Math.round(valorParcela * 100) / 100,
      totalReceber: Math.round(totalReceber * 100) / 100,
      jurosTotal: Math.round(jurosTotal * 100) / 100,
    };
  }
  // "parcela" (default)
  const principalPorParcela = principal / N;
  const jurosPorParcela = principal * (taxa / 100);
  const valorParcela = principalPorParcela + jurosPorParcela;
  const totalReceber = valorParcela * N;
  return {
    valorParcela: Math.round(valorParcela * 100) / 100,
    totalReceber: Math.round(totalReceber * 100) / 100,
    jurosTotal: Math.round((totalReceber - principal) * 100) / 100,
  };
}

function dataHojeISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido.");
  }

  // 1) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const clienteId = typeof body.clienteId === "string" ? body.clienteId.trim() : "";
  if (!clienteId) {
    return bad(res, 400, "clienteId é obrigatório.");
  }
  const valorEmprestado = Number(body.valorEmprestado);
  const numeroParcelas = Number(body.numeroParcelas);
  if (!Number.isFinite(valorEmprestado) || valorEmprestado <= 0) {
    return bad(res, 400, "valorEmprestado deve ser número > 0.");
  }
  if (!Number.isFinite(numeroParcelas) || !Number.isInteger(numeroParcelas) || numeroParcelas < 1) {
    return bad(res, 400, "numeroParcelas deve ser inteiro >= 1.");
  }
  const tipoEmprestimo = body.tipoEmprestimo === "Sem Juros" ? "Sem Juros" : "Com Juros";
  const juros = tipoEmprestimo === "Com Juros" ? Number(body.juros) || 0 : 0;
  if (tipoEmprestimo === "Com Juros" && (!Number.isFinite(juros) || juros <= 0)) {
    return bad(res, 400, "Informe os juros ao mês (número > 0).");
  }
  const tipoJuros = TIPO_JUROS_VALIDOS.includes(body.tipoJuros) ? body.tipoJuros : (tipoEmprestimo === "Com Juros" ? "parcela" : null);
  const frequencia = FREQ_VALIDAS.includes(body.frequencia) ? body.frequencia : "Mensal";
  const dataPrimeiraParcela = typeof body.dataPrimeiraParcela === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dataPrimeiraParcela)
    ? body.dataPrimeiraParcela
    : dataHojeISO();
  const observacao = typeof body.observacao === "string" ? body.observacao.trim().slice(0, 1000) : "";
  const jurosAtraso = body.jurosAtraso && typeof body.jurosAtraso === "object" ? body.jurosAtraso : null;
  const cobrarJurosAtraso = !!(jurosAtraso && jurosAtraso.cobrar === true);
  const modoJurosAtraso = jurosAtraso && typeof jurosAtraso.modo === "string" ? jurosAtraso.modo : null;
  const jurosAtrasoValor = jurosAtraso && Number.isFinite(Number(jurosAtraso.valor)) ? Number(jurosAtraso.valor) : 0;

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
    console.error("[admin/criar-contrato] Firebase Admin indisponível:", err?.code, err?.message);
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
    console.error("[admin/criar-contrato] verifyIdToken falhou:", err?.code, err?.message);
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
    console.error("[admin/criar-contrato] Leitura do perfil falhou:", err?.message);
    return bad(res, 500, "Não foi possível validar o chamador.");
  }

  // 6) Resolve o DONO efetivo
  let donoUid;
  let ehFuncionario = false;
  if (perfilChamador.role === "funcionario") {
    if (!perfilChamador.ownerUid) {
      return bad(res, 403, "Funcionário sem vínculo de proprietário.");
    }
    donoUid = perfilChamador.ownerUid;
    ehFuncionario = true;
  } else if (perfilChamador.ownerUid) {
    return bad(res, 403, "Perfil inválido para criação.");
  } else {
    donoUid = chamadorUid;
  }

  // 7) Perfil do DONO
  let perfilDono;
  try {
    const snap = await dbAdmin.collection("usuarios").doc(donoUid).get();
    if (!snap.exists) {
      return bad(res, 403, "Proprietário não encontrado.");
    }
    perfilDono = snap.data() || {};
  } catch (err) {
    console.error("[admin/criar-contrato] Leitura do perfil do dono falhou:", err?.message);
    return bad(res, 500, "Não foi possível validar o proprietário.");
  }

  const statusDono = normalizarStatus(perfilDono);
  if (statusDono === "bloqueado") {
    return bad(
      res,
      403,
      "Conta bloqueada pelo administrador. Não é possível criar contratos.",
    );
  }
  const permissoes = normalizarPermissoes(perfilDono);
  if (!permissoes.criarContratos) {
    return bad(
      res,
      403,
      "A criação de contratos foi bloqueada pelo administrador.",
    );
  }
  const limites = normalizarLimites(perfilDono);

  // 8) Limite individual do FUNCIONÁRIO (se aplicável)
  if (ehFuncionario) {
    let funcSnap;
    try {
      funcSnap = await dbAdmin
        .collection("usuarios")
        .doc(donoUid)
        .collection("funcionarios")
        .where("authUid", "==", chamadorUid)
        .limit(1)
        .get();
    } catch (err) {
      console.error("[admin/criar-contrato] busca funcionário falhou:", err?.message);
      return bad(res, 500, "Não foi possível validar o funcionário.");
    }
    if (funcSnap.empty) {
      return bad(res, 403, "Funcionário não encontrado. Contate o proprietário.");
    }
    const funcDoc = funcSnap.docs[0].data();
    if ((funcDoc.status || "ativo") === "inativo") {
      return bad(res, 403, "Seu acesso foi desativado. Entre em contato com o administrador da conta.");
    }
    const limiteFunc = Number(funcDoc.limiteContratos) || 0;
    if (limiteFunc > 0) {
      try {
        const contFunc = await dbAdmin
          .collection("usuarios")
          .doc(donoUid)
          .collection("contratos")
          .where("createdBy", "==", chamadorUid)
          .count()
          .get();
        const cont = contFunc.data().count || 0;
        if (cont >= limiteFunc) {
          return bad(res, 403, "Limite de contratos do funcionário atingido. Procure o administrador.");
        }
      } catch (err) {
        console.error("[admin/criar-contrato] contagem funcionário falhou:", err?.message);
        return bad(res, 500, "Não foi possível validar o limite do funcionário.");
      }
    }
  }

  // 9) Limite de CONTRATOS do DONO
  // EXCEÇÃO: se o DONO estiver no plano PRO, o limite do DONO é
  // ignorado (ilimitado). Os limites FREE permanecem salvos no
  // Firestore para serem reativados se o DONO voltar para FREE.
  // O limite individual do funcionário (acima) NÃO é afetado pelo
  // plano do DONO — ele é uma configuração por funcionário.
  // Permissões e status continuam sendo validados normalmente.
  if (!ehPro(perfilDono) && limites.contratos > 0) {
    try {
      const contSnap = await dbAdmin
        .collection("usuarios")
        .doc(donoUid)
        .collection("contratos")
        .count()
        .get();
      const cont = contSnap.data().count || 0;
      if (cont >= limites.contratos) {
        return bad(
          res,
          403,
          `Limite de contratos atingido (${cont}/${limites.contratos}). Entre em contato com o administrador para aumentar seu limite.`,
        );
      }
    } catch (err) {
      console.error("[admin/criar-contrato] Contagem de contratos falhou:", err?.code, err?.message);
      return bad(res, 500, "Não foi possível validar o limite de contratos.");
    }
  }

  // 10) Valida que o cliente existe e pertence ao dono
  let clienteDoc;
  try {
    const snap = await dbAdmin.collection("clientes").doc(clienteId).get();
    if (!snap.exists) {
      return bad(res, 404, "Cliente não encontrado.");
    }
    clienteDoc = snap.data() || {};
  } catch (err) {
    console.error("[admin/criar-contrato] Leitura do cliente falhou:", err?.message);
    return bad(res, 500, "Não foi possível validar o cliente.");
  }
  if (clienteDoc.ownerId !== donoUid) {
    return bad(res, 403, "Cliente não pertence ao proprietário.");
  }

  // 10b) Validação do `deviceId` de origem (Fase A — notificações sincronizadas).
  //
  // O frontend envia no body o `deviceId` do dispositivo que originou a
  // ação (UUID v4 persistido no localStorage). Aqui validamos que:
  //   1. O `deviceId` é uma string não-vazia (até 200 chars).
  //   2. Existe um doc em `usuarios/{chamadorUid}/devices/{deviceId}` —
  //      ou seja, o dispositivo ESTÁ REGISTRADO para o chamador.
  //   3. O doc do device aponta para o mesmo `ownerUid` (não pode ser
  //      um device de outro dono).
  //   4. O `userRole` do doc do device bate com o perfil do chamador
  //      (defesa em profundidade: não dá pra usar um device de
  //      funcionário logado como dono, nem vice-versa).
  //
  // Por que essa validação é importante:
  //   O `sourceDeviceId` é gravado no evento e usado pelo `dispatch`
  //   para EXCLUIR esse device do envio FCM (evita tripla notificação:
  //   in-app + FCM + nativa local). Se aceitássemos qualquer string
  //   como `sourceDeviceId`, um client malicioso poderia fazer com que
  //   outros devices NÃO recebessem o push.
  //
  // Quando `deviceId` é omitido (chamada puramente server-side: cron,
  // admin, import), o evento é gravado com `sourceDeviceId: null` e
  // o dispatch envia FCM para todos os devices elegíveis.
  const deviceIdRaw = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  let sourceDeviceId = null;
  if (deviceIdRaw) {
    if (deviceIdRaw.length > 200) {
      return bad(res, 400, "deviceId inválido (até 200 chars).");
    }
    let deviceSnap;
    try {
      deviceSnap = await dbAdmin
        .collection("usuarios")
        .doc(chamadorUid)
        .collection("devices")
        .doc(deviceIdRaw)
        .get();
    } catch (err) {
      console.error("[admin/criar-contrato] Leitura do device falhou:", err?.message);
      return bad(res, 500, "Não foi possível validar o dispositivo de origem.");
    }
    if (!deviceSnap.exists) {
      return bad(
        res,
        400,
        "Dispositivo de origem não registrado. Atualize a página para registrar este dispositivo antes de continuar.",
      );
    }
    const deviceData = deviceSnap.data() || {};
    // Defesa em profundidade: o path já garante que o device é do chamador,
    // mas o Admin SDK bypassa as rules, então validamos explicitamente.
    if (deviceData.ownerUid !== donoUid) {
      console.error(
        "[admin/criar-contrato] deviceId com ownerUid divergente:",
        `chamador=${chamadorUid}`,
        `donoUid=${donoUid}`,
        `device.ownerUid=${deviceData.ownerUid}`,
        `deviceId=${deviceIdRaw}`,
      );
      return bad(res, 403, "Dispositivo de origem não pertence a este proprietário.");
    }
    // Consistência de papel: se o chamador é dono, o device deve ser de
    // dono; se é funcionário, deve ser de funcionário. Isso evita que
    // um device compartilhado entre papéis (cenário improvável mas
    // possível em testes/HMR) seja aceito como origem.
    const expectedRole = ehFuncionario ? "funcionario" : "owner";
    if (deviceData.userRole && deviceData.userRole !== expectedRole) {
      console.error(
        "[admin/criar-contrato] deviceId com userRole divergente:",
        `expected=${expectedRole}`,
        `device.userRole=${deviceData.userRole}`,
        `deviceId=${deviceIdRaw}`,
      );
      return bad(res, 403, "Dispositivo de origem incompatível com o perfil do chamador.");
    }
    sourceDeviceId = deviceIdRaw;
  }

  // 11) Cria o contrato
  const resumo = calcularParcelas({ valorEmprestado, numeroParcelas, juros, tipoJuros });
  const novoContrato = {
    clienteId,
    clienteNome: clienteDoc.nomeCompleto || clienteDoc.nome || "",
    nome: clienteDoc.nomeCompleto || clienteDoc.nome || "",
    valorEmprestado,
    valorParcela: resumo.valorParcela,
    totalReceber: resumo.totalReceber,
    valorRecebido: 0,
    jurosRecebidos: 0,
    saldoPrincipal: valorEmprestado,
    tipoEmprestimo,
    juros,
    tipoJuros,
    createdBy: chamadorUid,
    numeroParcelas,
    cobrarJurosAtraso,
    modoJurosAtraso: cobrarJurosAtraso ? modoJurosAtraso : null,
    jurosAtrasoValor: cobrarJurosAtraso ? jurosAtrasoValor : 0,
    frequencia,
    dataPrimeiraParcela,
    observacao,
    quitado: false,
    parcelasPagas: 0,
    dataProximo: dataPrimeiraParcela,
    abatimentos: [],
    abatimentoTotal: 0,
    criadoEm: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const contratosRef = dbAdmin
    .collection("usuarios")
    .doc(donoUid)
    .collection("contratos");
  let docRef;
  try {
    docRef = await contratosRef.add(novoContrato);
  } catch (err) {
    console.error("[admin/criar-contrato] addDoc falhou:", err?.code, err?.message);
    return bad(res, 500, "Não foi possível salvar o contrato. Tente novamente.");
  }

  // 12) Notificação do app (best-effort; falha não bloqueia o fluxo)
  try {
    await dbAdmin
      .collection("usuarios")
      .doc(donoUid)
      .collection("notificacoes")
      .add({
        tipo: "contrato_criado",
        titulo: "Novo contrato criado",
        descricao: `${numeroParcelas}x`,
        contratoId: docRef.id,
        valor: valorEmprestado,
        lida: false,
        criadaEm: FieldValue.serverTimestamp(),
      });
  } catch (err) {
    console.error("[admin/criar-contrato] criarNotificacao falhou:", err?.code, err?.message);
  }

  // 13) Evento central (Fase A — arquitetura de notificações sincronizadas).
  //
  // Gera um `eventId` server-side e grava o evento em
  // `usuarios/{ownerId}/notificationEvents/{eventId}`. O `dispatch`
  // (envio FCM para os devices) é responsabilidade do CLIENTE
  // (`src/services/notificationEvents.js` chama /api/notifications/dispatch
  // após receber este id). Razão: separar a gravação do evento do envio
  // FCM permite que uma falha de FCM não impeça a notificação in-app.
  //
  // `sourceDeviceId` foi validado no passo 10b — o device precisa
  // existir em `usuarios/{chamadorUid}/devices/{deviceId}` e apontar
  // para o mesmo `ownerUid` e `userRole` do chamador. Se o chamador
  // omitiu o `deviceId` (chamada server-side pura), o evento é
  // gravado com `sourceDeviceId: null` e o dispatch envia FCM para
  // todos os devices elegíveis.
  //
  // Falha aqui NÃO bloqueia o fluxo principal (a criação do contrato
  // já está commitada no Firestore). O cliente recebe `eventId` apenas
  // se a gravação teve sucesso.
  let eventId = null;
  try {
    eventId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await dbAdmin
      .collection("usuarios")
      .doc(donoUid)
      .collection("notificationEvents")
      .doc(eventId)
      .set({
        eventId,
        type: "CONTRACT_CREATED",
        title: "Novo contrato criado",
        body: `${numeroParcelas}x`,
        data: {
          contratoId: docRef.id,
          clienteId,
          clienteNome: clienteDoc.nomeCompleto || clienteDoc.nome || "",
          valor: valorEmprestado,
        },
        sourceDeviceId,
        ownerId: donoUid,
        createdBy: { uid: chamadorUid, role: ehFuncionario ? "funcionario" : "owner" },
        createdAt: FieldValue.serverTimestamp(),
        status: "created",
        dispatchedAt: null,
      });
    console.log(
      "[admin/criar-contrato] evento criado:",
      `eventId=${eventId}`,
      `type=CONTRACT_CREATED`,
      `ownerId=${donoUid}`,
      `contratoId=${docRef.id}`,
      `sourceDevice=${sourceDeviceId || "(server-side)"}`,
    );
  } catch (err) {
    console.error("[admin/criar-contrato] criar evento falhou:", err?.code, err?.message);
    // Não bloqueia o fluxo. O cliente pode re-tentar via /api/notifications/register-event.
  }

  return res.status(201).json({
    ok: true,
    id: docRef.id,
    contrato: { id: docRef.id, ...novoContrato },
    eventId,
  });
}
