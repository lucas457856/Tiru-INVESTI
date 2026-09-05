// API: catch-all /api/auth/*
//
// Consolida 4 sub-rotas em UMA Serverless Function (reduz contagem de
// 13 → 3, dentro do limite de 12 do plano Hobby da Vercel).
//
// Sub-rotas:
//   - POST /api/auth/reset-password
//   - POST /api/auth/create-employee
//   - POST /api/auth/update-employee
//   - POST /api/auth/delete-employee
//
// IMPORTANTE: NÃO MUDAR URLs nem contratos. O frontend continua
// chamando exatamente os mesmos endpoints — a Vercel roteia
// automaticamente para este catch-all via `req.query.slug`.

import { resetPasswordHandler } from "./_authHandlers/resetPassword.js";
import { createEmployeeHandler } from "./_authHandlers/createEmployee.js";
import { updateEmployeeHandler } from "./_authHandlers/updateEmployee.js";
import { deleteEmployeeHandler } from "./_authHandlers/deleteEmployee.js";

const ROTAS = {
  "reset-password": { method: "POST", handler: resetPasswordHandler, prefix: "auth/reset-password" },
  "create-employee": { method: "POST", handler: createEmployeeHandler, prefix: "auth/create-employee" },
  "update-employee": { method: "POST", handler: updateEmployeeHandler, prefix: "auth/update-employee" },
  "delete-employee": { method: "POST", handler: deleteEmployeeHandler, prefix: "auth/delete-employee" },
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // Extrai o slug (action) da URL. Espelha o padrão de
  // api/admin/[...slug].js para garantir o fallback 404 em qualquer
  // deploy da Vercel (em alguns deploys `req.query.slug` chega
  // `undefined` mesmo com o rewrite aplicado, então extraímos
  // diretamente do pathname como fonte primária).
  //
  // Fontes, em ordem de prioridade:
  //   1. Pathname de `req.url`: "/api/auth/reset-password" → "reset-password".
  //   2. `req.query.slug` (caso a Vercel volte a popular em algum
  //      deploy/região).
  //   3. `req.query.slug` como array (legado).
  let slug = "";
  try {
    const url = new URL(req.url || "", "http://localhost");
    const partes = url.pathname.split("/").filter(Boolean); // ["api","auth","reset-password"]
    if (partes[0] === "api" && partes[1] === "auth" && partes[2]) {
      slug = partes[2];
    }
  } catch {
    // Ignora: cai no fallback abaixo.
  }
  if (!slug) {
    const slugArr = req.query?.slug;
    slug = Array.isArray(slugArr) ? slugArr[0] : slugArr;
    if (slug) slug = String(slug);
  }
  if (!slug) {
    return res.status(404).json({ ok: false, erro: "Rota não encontrada." });
  }

  const rota = ROTAS[slug];
  if (!rota) {
    res.setHeader("Allow", "POST");
    return res.status(404).json({ ok: false, erro: `Rota /api/auth/${slug} não encontrada.` });
  }

  if (req.method !== rota.method) {
    res.setHeader("Allow", rota.method);
    return res.status(405).json({ ok: false, erro: "Método não permitido." });
  }

  return rota.handler(req, res);
}
