// Wrapper de fetch para o endpoint administrativo.
// O ID Token do usuário autenticado é enviado no header Authorization.
// O backend (api/admin/overview.js) valida que o uid é o ADMIN_UID.

import { auth } from "./firebase";

async function getToken() {
  const u = auth.currentUser;
  if (!u) throw new Error("Sessão expirada.");
  return u.getIdToken();
}

export async function buscarOverview() {
  const token = await getToken();
  let resp;
  try {
    resp = await fetch("/api/admin/overview", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    return { ok: false, erro: "Falha de conexão. Verifique sua internet." };
  }
  let data = null;
  try {
    data = await resp.json();
  } catch {
    /* ignore */
  }
  if (!resp.ok) {
    return { ok: false, erro: data?.erro || "Não foi possível carregar o painel." };
  }
  return data || { ok: false, erro: "Resposta vazia do servidor." };
}
