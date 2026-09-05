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

  // A Vercel popula `req.query.slug` como:
  //   - "reset-password"  (se a rota for /api/auth/reset-password)
  //   - ["a", "b"]        (se for /api/auth/a/b)
  // Para nosso caso, sempre é uma única string.
  const slugArr = req.query?.slug;
  const slug = Array.isArray(slugArr) ? slugArr[0] : slugArr;
  if (!slug) {
    res.setHeader("Allow", "POST");
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
