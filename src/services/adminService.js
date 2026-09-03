// Wrappers de fetch para os endpoints administrativos.
// O ID Token do usuário autenticado é enviado no header Authorization.
// O backend (api/admin/*) valida que o uid é o ADMIN_UID onde aplicável,
// e valida status/permissoes/limites onde relevante.

import { auth } from "./firebase";

async function getToken() {
  const u = auth.currentUser;
  if (!u) throw new Error("Sessão expirada. Faça login novamente.");
  return u.getIdToken();
}

// Faz uma requisição e devolve SEMPRE um objeto { ok, erro?, ...data } —
// nunca silenciosamente devolve "resposta vazia". Mostra o status,
// content-type e um trecho do body para o usuário entender o que
// aconteceu.
//
// Cache: o adminService adiciona um timestamp na URL como query param
// e envia `Cache-Control: no-cache` para que proxies da Vercel (ou
// caches locais) não sirvam uma resposta antiga do deploy anterior.
async function requisitar(urlBase, { method = "GET", body = null, headers = {} } = {}) {
  const url = `${urlBase}?_=${Date.now()}`;
  const finalHeaders = {
    ...headers,
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return {
      ok: false,
      erro: "Falha de conexão. Verifique sua internet ou tente novamente em alguns instantes.",
    };
  }
  const contentType = resp.headers.get("content-type") || "";
  const texto = await resp.text();
  let data = null;
  if (contentType.includes("application/json") && texto) {
    try {
      data = JSON.parse(texto);
    } catch {
      data = null;
    }
  }
  if (!resp.ok) {
    const trecho = !data && texto ? texto.slice(0, 200) : null;
    return {
      ok: false,
      status: resp.status,
      contentType,
      erro:
        data?.erro ||
        (resp.status === 404
          ? "Endpoint não encontrado. Verifique se o deploy da Vercel inclui a pasta api/admin/."
          : resp.status === 500
          ? "O servidor encontrou um erro ao processar a requisição. Tente novamente em alguns instantes."
          : `Erro HTTP ${resp.status}`),
      ...(trecho ? { trecho } : {}),
    };
  }
  if (!data) {
    return {
      ok: false,
      status: resp.status,
      erro: "O servidor retornou uma resposta vazia. Tente novamente em alguns instantes.",
      contentType,
    };
  }
  return data;
}

export async function buscarOverview() {
  const token = await getToken();
  return requisitar("/api/admin/overview", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Atualiza os campos administrativos (status, limites, permissoes)
// de um dono. Apenas o ADMIN_UID é aceito pelo servidor.
//
// Aceita um payload parcial — cada chave é opcional, mas o servidor
// exige pelo menos uma. Retorna { ok, donoUid, status, limites, permissoes }.
export async function salvarDono(donoUid, { status, limites, permissoes } = {}) {
  if (!donoUid) return { ok: false, erro: "donoUid ausente." };
  const token = await getToken();
  const body = { donoUid };
  if (status !== undefined) body.status = status;
  if (limites !== undefined) body.limites = limites;
  if (permissoes !== undefined) body.permissoes = permissoes;
  return requisitar("/api/admin/update-owner", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });
}

// Cria um cliente para o DONO autenticado (ou para o DONO ao qual o
// FUNCIONÁRIO autenticado está vinculado). Valida status, permissão
// e limite de clientes no servidor (Admin SDK). Retorna
// { ok, id, cliente }. Em caso de bloqueio, retorna { ok: false, erro }.
export async function criarCliente(payload) {
  const token = await getToken();
  return requisitar("/api/admin/criar-cliente", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload || {},
  });
}

// Cria um contrato para o DONO autenticado (ou para o DONO ao qual o
// FUNCIONÁRIO autenticado está vinculado). Valida status, permissão
// e limite de contratos no servidor (Admin SDK). Retorna
// { ok, id, contrato }. Em caso de bloqueio, retorna { ok: false, erro }.
export async function criarContrato(payload) {
  const token = await getToken();
  return requisitar("/api/admin/criar-contrato", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload || {},
  });
}
