// Wrapper de fetch para o endpoint administrativo.
// O ID Token do usuário autenticado é enviado no header Authorization.
// O backend (api/admin/overview.js) valida que o uid é o ADMIN_UID.

import { auth } from "./firebase";

async function getToken() {
  const u = auth.currentUser;
  if (!u) throw new Error("Sessão expirada. Faça login novamente.");
  return u.getIdToken();
}

// Faz um GET e devolve SEMPRE um objeto { ok, erro?, ...data } — nunca
// silenciosamente devolve "resposta vazia". Mostra o status, content-type
// e um trecho do body para o usuário entender o que aconteceu.
//
// Cache: o adminService adiciona um timestamp na URL como query param
// e envia `Cache-Control: no-cache` para que proxies da Vercel (ou
// caches locais) não sirvam uma resposta antiga do deploy anterior.
async function getJson(urlBase, headers) {
  const url = `${urlBase}?_=${Date.now()}`;
  let resp;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: { ...headers, "Cache-Control": "no-cache", Pragma: "no-cache" },
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
    // Quando o body não é JSON, mostra o trecho (ex: página HTML 404 do Vercel).
    const trecho = !data && texto ? texto.slice(0, 200) : null;
    return {
      ok: false,
      status: resp.status,
      contentType,
      erro:
        data?.erro ||
        (resp.status === 404
          ? "Endpoint não encontrado. Verifique se o deploy da Vercel inclui a pasta api/admin/overview.js."
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
  return getJson("/api/admin/overview", {
    Authorization: `Bearer ${token}`,
  });
}

