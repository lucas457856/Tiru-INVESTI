// Helpers de perfil DONO/FUNCIONÁRIO compartilhados pelos handlers.
//
// Centraliza o que estava duplicado em 5+ handlers (overview, update-owner,
// criar-cliente, criar-contrato, register-event, register-device, ...):
//   - DEFAULT_LIMITES, DEFAULT_PERMISSOES, DEFAULT_STATUS (constantes)
//   - planoEfetivo(perfil, agora?) — resolve o plano real baseado em
//     `plan` + `planVigencia.{inicio,fim}` vs `new Date()` (LOCAL).
//     Retorna { configurado, efetivo, status, vigenciaInicio, vigenciaFim, agora }
//   - ehPro(perfil) — atalho: `planoEfetivo(perfil).efetivo === "pro"`
//   - normalizarLimites(perfil) / normalizarPermissoes(perfil) / normalizarStatus(perfil)
//   - resolverDonoEfetivo(perfil, chamadorUid) — resolve donoUid a partir do chamador
//   - isDonoPuro(perfil) — confere se é DONO (sem role/ownerUid)
//   - validarSourceDeviceId({ ... }) — valida o deviceId de origem (usado em criar-cliente, criar-contrato, register-event)
//
// Compatibilidade: donos sem `planVigencia` (todos os antigos) seguem
// o comportamento binário original (`efetivo === configurado`). Sem
// migração destrutiva.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Defaults aplicados quando o doc do dono não tem os campos
// administrativos. Novas contas começam com limites de 5/5/5 e com
// a permissão de criar funcionários DESLIGADA — o admin ativa
// manualmente quando quiser liberar.
//
// ATENÇÃO: alterar estes valores NÃO afeta donos antigos. Quem já
// tem `limites`/`permissoes`/`status` no Firestore continua com
// os valores que lá estão. Os defaults só são aplicados quando o
// campo está AUSENTE no doc.
export const DEFAULT_LIMITES = { contratos: 5, clientes: 5, funcionarios: 5 };
export const DEFAULT_PERMISSOES = { criarContratos: true, criarClientes: true, criarFuncionarios: false };
export const DEFAULT_STATUS = "ativo";

/**
 * Converte uma data em vários formatos (Timestamp do Admin SDK,
 * Date, string "YYYY-MM-DD") para um `Date` que representa 00:00
 * UTC do dia YYYY-MM-DD.
 *
 * DRIFT DE TIMEZONE — POR QUE COMPONENTES UTC:
 *   O servidor grava `Timestamp.fromDate(new Date(y, m-1, d))` —
 *   meia-noite LOCAL do servidor (Vercel = UTC, então meia-noite
 *   UTC). Quando o backend ou o Client SDK lê esse Timestamp via
 *   `ts.toDate()`, retorna o mesmo instante UTC. Mas
 *   `d.getDate()`/`getMonth()`/`getFullYear()` retornam componentes
 *   no timezone do contexto — em BRT (UTC-3), meia-noite UTC vira
 *   "ontem 21h", então `getDate()` retorna o dia anterior. Isso
 *   fazia `planoEfetivo` calcular `status` como "expirado" 1 dia
 *   antes em timezones ≠ UTC.
 *
 *   Solução: extrair o "dia" pelos componentes UTC
 *   (`getUTCFullYear()` etc.) — o mesmo YYYY-MM-DD que o admin
 *   configurou. O `Date` retornado fica em meia-noite UTC do dia,
 *   preservando exatamente a data configurada.
 *
 * @param {unknown} valor
 * @returns {Date | null}
 */
function toLocalDate(valor) {
  if (valor == null) return null;
  // Firestore Admin SDK Timestamp
  if (typeof valor === "object" && typeof valor.toDate === "function") {
    const d = valor.toDate();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  // Date nativo
  if (valor instanceof Date) {
    return new Date(Date.UTC(valor.getUTCFullYear(), valor.getUTCMonth(), valor.getUTCDate()));
  }
  // String "YYYY-MM-DD" (saída do <input type="date"> do front)
  if (typeof valor === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
    if (m) {
      return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    }
    return null;
  }
  return null;
}

/**
 * Resolve o plano efetivo do DONO considerando a vigência.
 *
 * Regras:
 *   - configurado = "free" → efetivo = "free" (vigência ignorada)
 *   - configurado = "pro" e sem `planVigencia` → efetivo = "pro"
 *     (compat com donos antigos; sem migração destrutiva)
 *   - configurado = "pro" e inicio <= hoje < fim → efetivo = "pro", status "ativo"
 *   - configurado = "pro" e hoje < inicio → efetivo = "free", status "agendado"
 *   - configurado = "pro" e hoje >= fim → efetivo = "free", status "expirado"
 *
 * `inicio` e `fim` são normalizados para meia-noite UTC do dia
 * (ver `toLocalDate` acima) — preservando o YYYY-MM-DD que o admin
 * configurou. `hoje` é meia-noite LOCAL do contexto de execução
 * (servidor ou, no espelho frontend, do browser). A comparação
 * `hoje < tFim` / `hoje >= tFim` pode diferir em até 1 dia entre
 * timezones, e isso bate com a regra "inicio é inclusivo, fim é
 * o primeiro dia Free".
 *
 * @param {object | null | undefined} perfil
 * @param {Date} [agora] Opcional; para testes. Default = new Date()
 * @returns {{
 *   configurado: "free"|"pro",
 *   efetivo: "free"|"pro",
 *   status: "ativo"|"agendado"|"expirado"|"indefinido",
 *   vigenciaInicio: Date|null,
 *   vigenciaFim: Date|null,
 *   agora: Date
 * }}
 */
export function planoEfetivo(perfil, agora) {
  const configurado = perfil?.plan === "pro" ? "pro" : "free";
  const vigencia = perfil?.planVigencia;
  const ref = agora || new Date();
  if (configurado !== "pro" || !vigencia || typeof vigencia !== "object") {
    return {
      configurado,
      efetivo: configurado,
      status: "indefinido",
      vigenciaInicio: null,
      vigenciaFim: null,
      agora: ref,
    };
  }
  const inicio = toLocalDate(vigencia.inicio);
  const fim = toLocalDate(vigencia.fim);
  // `hoje` continua sendo meia-noite LOCAL do servidor — é a data
  // atual no fuso onde o código executa.
  const hoje = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
  // `inicio` e `fim` foram normalizados para meia-noite UTC em
  // `toLocalDate`. O `.getTime()` em si retorna o instante UTC
  // correto, então não precisa recompor via getUTCFullYear etc.
  // — basta usar o timestamp direto.
  const tInicio = inicio ? inicio.getTime() : null;
  const tFim = fim ? fim.getTime() : null;
  let status = "indefinido";
  if (tInicio != null && tFim != null) {
    if (hoje < tInicio) status = "agendado";
    else if (hoje >= tFim) status = "expirado";
    else status = "ativo";
  }
  const efetivo = status === "ativo" ? "pro" : "free";
  return { configurado, efetivo, status, vigenciaInicio: inicio, vigenciaFim: fim, agora: ref };
}

/**
 * Plano efetivo: aceita apenas "pro" no `planoEfetivo().efetivo`.
 * Compatibilidade com donos antigos preservada (sem `planVigencia`,
 * `planoEfetivo` retorna `efetivo === configurado === "pro"`).
 *
 * @param {object | null | undefined} perfil
 * @param {Date} [agora] Opcional; para testes. Default = new Date().
 *   Propagado para `planoEfetivo` de forma que `ehPro` e
 *   `planoEfetivo(...).efetivo === "pro"` permaneçam sincronizados
 *   quando o caller simula uma data.
 * @returns {boolean}
 */
export function ehPro(perfil, agora) {
  return planoEfetivo(perfil, agora).efetivo === "pro";
}

/**
 * Normaliza os limites de um perfil de DONO. Aplica defaults
 * permissivos quando ausentes. Garante que os valores são inteiros
 * válidos (usa `Number.isFinite` em vez de `||` para preservar 0).
 *
 * @param {object | null | undefined} perfil
 * @returns {{ contratos: number, clientes: number, funcionarios: number }}
 */
export function normalizarLimites(perfil) {
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

/**
 * Normaliza as permissões de um perfil de DONO. Aplica defaults
 * permissivos quando ausentes. Coerção explícita para boolean.
 *
 * @param {object | null | undefined} perfil
 * @returns {{ criarContratos: boolean, criarClientes: boolean, criarFuncionarios: boolean }}
 */
export function normalizarPermissoes(perfil) {
  const p = perfil?.permissoes;
  if (!p || typeof p !== "object") return { ...DEFAULT_PERMISSOES };
  return {
    criarContratos: p.criarContratos === true,
    criarClientes: p.criarClientes === true,
    criarFuncionarios: p.criarFuncionarios === true,
  };
}

/**
 * Normaliza o status de um perfil de DONO. Aceita apenas
 * "ativo" ou "bloqueado"; qualquer outro valor (ou ausente)
 * vira "ativo" (default permissivo).
 *
 * @param {object | null | undefined} perfil
 * @returns {"ativo" | "bloqueado"}
 */
export function normalizarStatus(perfil) {
  return perfil?.status === "bloqueado" ? "bloqueado" : DEFAULT_STATUS;
}

/**
 * Confere se o perfil é de DONO puro (sem `role` e sem `ownerUid`).
 * Funcionários têm `role: "funcionario"` e `ownerUid` apontando para
 * o dono.
 *
 * @param {object | null | undefined} perfil
 * @returns {boolean}
 */
export function isDonoPuro(perfil) {
  if (!perfil || typeof perfil !== "object") return false;
  return !perfil.role && !perfil.ownerUid;
}

/**
 * Resolve o DONO efetivo a partir do perfil do chamador.
 *   - DONO puro → retorna { donoUid: chamadorUid, ehFuncionario: false }
 *   - FUNCIONARIO com ownerUid → retorna { donoUid: ownerUid, ehFuncionario: true }
 *   - Perfil inválido (ownerUid sem role) → retorna { erro: "..." }
 *   - Funcionário sem ownerUid → retorna { erro: "..." }
 *
 * Esta função NÃO chama o Firestore — recebe o `perfilChamador` já
 * carregado pelo caller. O caller é responsável por ter feito
 * `db.collection("usuarios").doc(chamadorUid).get()`.
 *
 * @param {object} perfilChamador
 * @param {string} chamadorUid
 * @returns {{ ok: true, donoUid: string, ehFuncionario: boolean, roleChamador: "dono" | "funcionario" }
 *          | { ok: false, code: 403, msg: string }}
 */
export function resolverDonoEfetivo(perfilChamador, chamadorUid) {
  if (perfilChamador?.role === "funcionario") {
    if (!perfilChamador.ownerUid) {
      return { ok: false, code: 403, msg: "Funcionário sem vínculo de proprietário." };
    }
    return {
      ok: true,
      donoUid: perfilChamador.ownerUid,
      ehFuncionario: true,
      roleChamador: "funcionario",
    };
  }
  if (perfilChamador?.ownerUid) {
    return { ok: false, code: 403, msg: "Perfil inválido para esta operação." };
  }
  return {
    ok: true,
    donoUid: chamadorUid,
    ehFuncionario: false,
    roleChamador: "dono",
  };
}

/**
 * Valida o `deviceId` de origem enviado pelo cliente.
 *
 * Espelha a lógica aplicada em api/admin/criar-contrato.js:397-449,
 * api/admin/criar-cliente.js:271-321 e
 * api/notifications/register-event.js:105-156: o deviceId deve
 *   (a) existir em `usuarios/{chamadorUid}/devices/{deviceId}`,
 *   (b) ter `ownerUid === donoUid` (não pode ser device de outro dono),
 *   (c) ter `userRole` compatível com `roleChamador`
 *       (`"owner"` para dono, `"funcionario"` para funcionário).
 *
 * Quando `deviceId` é string vazia (omitido pelo front ou chamada
 * server-side), retorna `{ ok: true, sourceDeviceId: null }` e o
 * caller grava o evento/recurso com `sourceDeviceId: null`
 * (comportamento atual preservado).
 *
 * O parâmetro `dbAdmin` é a instância já inicializada do Firestore
 * (caller deve ter chamado `getFirestore(admin)` antes).
 *
 * @param {object} opts
 * @param {import("firebase-admin/firestore").Firestore} opts.dbAdmin
 * @param {string} opts.chamadorUid
 * @param {string} opts.donoUid
 * @param {"dono" | "funcionario"} opts.roleChamador
 * @param {string} opts.sourceDeviceId
 * @param {string} [opts.prefix] Prefixo para logs (ex: "admin/criar-cliente")
 * @returns {Promise<{ ok: true, sourceDeviceId: string | null }
 *                   | { ok: false, code: 400 | 403 | 500, msg: string }>}
 */
export async function validarSourceDeviceId({
  dbAdmin,
  chamadorUid,
  donoUid,
  roleChamador,
  sourceDeviceId,
  prefix = "lib/dono",
}) {
  // Sem deviceId: chamada server-side, comportamento atual preservado.
  if (!sourceDeviceId) {
    return { ok: true, sourceDeviceId: null };
  }
  if (sourceDeviceId.length > 200) {
    return { ok: false, code: 400, msg: "deviceId inválido (até 200 chars)." };
  }
  let deviceSnap;
  try {
    deviceSnap = await dbAdmin
      .collection("usuarios")
      .doc(chamadorUid)
      .collection("devices")
      .doc(sourceDeviceId)
      .get();
  } catch (err) {
    console.error(`[${prefix}] Leitura do device falhou:`, err?.message);
    return { ok: false, code: 500, msg: "Não foi possível validar o dispositivo de origem." };
  }
  if (!deviceSnap.exists) {
    return {
      ok: false,
      code: 400,
      msg: "Dispositivo de origem não registrado. Atualize a página para registrar este dispositivo antes de continuar.",
    };
  }
  const deviceData = deviceSnap.data() || {};
  if (deviceData.ownerUid !== donoUid) {
    console.error(
      `[${prefix}] deviceId com ownerUid divergente:`,
      `chamador=${chamadorUid}`,
      `donoUid=${donoUid}`,
      `device.ownerUid=${deviceData.ownerUid}`,
      `deviceId=${sourceDeviceId}`,
    );
    return { ok: false, code: 403, msg: "Dispositivo de origem não pertence a este proprietário." };
  }
  const expectedRole = roleChamador === "funcionario" ? "funcionario" : "owner";
  if (deviceData.userRole && deviceData.userRole !== expectedRole) {
    console.error(
      `[${prefix}] deviceId com userRole divergente:`,
      `expected=${expectedRole}`,
      `device.userRole=${deviceData.userRole}`,
      `deviceId=${sourceDeviceId}`,
    );
    return { ok: false, code: 403, msg: "Dispositivo de origem incompatível com o perfil do chamador." };
  }
  return { ok: true, sourceDeviceId };
}

/**
 * Helper de conveniência que carrega o perfil do chamador e resolve o
 * DONO efetivo. Reduz boilerplate dos handlers que precisam de ambos.
 *
 * Em caso de erro (perfil não existe, perfil inválido, falha de
 * leitura), escreve resposta de erro no `res` e retorna `null`.
 *
 * @param {import("http").ServerResponse} res
 * @param {string} prefix Prefixo para logs
 * @param {string} chamadorUid
 * @param {import("firebase-admin/firestore").Firestore} dbAdmin
 * @returns {Promise<null | { perfilChamador: object, donoUid: string, ehFuncionario: boolean, roleChamador: "dono" | "funcionario" }>}
 */
export async function carregarChamadorEDono(res, prefix, chamadorUid, dbAdmin) {
  let perfilChamador;
  try {
    const snap = await dbAdmin.collection("usuarios").doc(chamadorUid).get();
    if (!snap.exists) {
      res.status(403).json({ ok: false, erro: "Perfil do chamador não encontrado." });
      return null;
    }
    perfilChamador = snap.data() || {};
  } catch (err) {
    console.error(`[${prefix}] Leitura do perfil do chamador falhou:`, err?.message);
    res.status(500).json({ ok: false, erro: "Não foi possível validar o chamador." });
    return null;
  }
  const r = resolverDonoEfetivo(perfilChamador, chamadorUid);
  if (!r.ok) {
    res.status(r.code).json({ ok: false, erro: r.msg });
    return null;
  }
  return { perfilChamador, ...r };
}

// Re-exporta getAuth e getFirestore para conveniência dos handlers
// que já precisam importar esses dois. (Reduz imports repetidos.)
export { getAuth, getFirestore };
