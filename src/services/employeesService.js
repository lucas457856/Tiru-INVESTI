// Wrappers de fetch para os endpoints server-side de funcionários.
// Toda a autenticação é feita via `Authorization: Bearer <idToken>` do
// Firebase Auth (getIdToken do usuário logado). O Admin SDK roda no
// servidor — NENHUMA senha é persistida, logada ou retornada.

import { auth } from "./firebase";

async function getToken() {
  const u = auth.currentUser;
  if (!u) throw new Error("Sessão expirada. Faça login novamente.");
  return u.getIdToken();
}

async function postJSON(url, body) {
  const token = await getToken();
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
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
    return {
      ok: false,
      erro: data?.erro || "Não foi possível concluir a operação.",
    };
  }
  return data || { ok: true };
}

// Cria um funcionário: cria o usuário Auth via Admin SDK no servidor
// e persiste os 2 docs Firestore. A sessão do dono no navegador NÃO
// é afetada (a chamada roda no servidor).
export function criarFuncionario({ nome, email, senha, limiteContratos }) {
  return postJSON("/api/auth/create-employee", {
    nome,
    email,
    senha,
    limiteContratos,
  });
}

// Edita nome, limiteContratos e/ou status de um funcionário existente.
// Qualquer campo omitido NÃO é alterado. Apenas o dono pode chamar.
//
// Aceita:
//   - `status: "ativo" | "inativo"` (forma legada, mantida para a
//     página de edição completa).
//   - `action: "ativar" | "inativar"` (forma preferida, usada pelo
//     modal de toggle de status). O backend traduz para o campo
//     `status` no Firestore.
export function atualizarFuncionario({
  funcionarioId,
  nome,
  limiteContratos,
  status,
  action,
}) {
  const body = { funcionarioId };
  if (nome !== undefined) body.nome = nome;
  if (limiteContratos !== undefined) body.limiteContratos = limiteContratos;
  if (status !== undefined) body.status = status;
  if (action !== undefined) body.action = action;
  return postJSON("/api/auth/update-employee", body);
}

// Atalho para o toggle de status: usa `action: "ativar" | "inativar"`.
// O backend faz updateDoc com FieldValue.delete() (ativar) ou
// FieldValue.serverTimestamp() (inativar) em `deletedAt`.
export function alternarStatusFuncionario(funcionarioId, acao) {
  if (acao !== "ativar" && acao !== "inativar") {
    return Promise.resolve({ ok: false, erro: "Ação inválida." });
  }
  return atualizarFuncionario({ funcionarioId, action: acao });
}
