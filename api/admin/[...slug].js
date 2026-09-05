// API: catch-all /api/admin/*
//
// Consolida 6 sub-rotas em UMA Serverless Function (reduz contagem de
// 13 → 3, dentro do limite de 12 do plano Hobby da Vercel).
//
// Sub-rotas:
//   - GET  /api/admin/health
//   - GET  /api/admin/overview
//   - POST /api/admin/update-owner
//   - POST /api/admin/delete-owner
//   - POST /api/admin/criar-cliente
//   - POST /api/admin/criar-contrato
//
// IMPORTANTE: NÃO MUDAR URLs nem contratos. O frontend continua
// chamando exatamente os mesmos endpoints — a Vercel roteia
// automaticamente para este catch-all via `req.query.slug`.

import { healthHandler } from "./_adminHandlers/health.js";
import { overviewHandler } from "./_adminHandlers/overview.js";
import { updateOwnerHandler } from "./_adminHandlers/updateOwner.js";
import { deleteOwnerHandler } from "./_adminHandlers/deleteOwner.js";
import { criarClienteHandler } from "./_adminHandlers/criarCliente.js";
import { criarContratoHandler } from "./_adminHandlers/criarContrato.js";

const ROTAS = {
  "health": { method: "GET", handler: healthHandler, prefix: "admin/health" },
  "overview": { method: "GET", handler: overviewHandler, prefix: "admin/overview" },
  "update-owner": { method: "POST", handler: updateOwnerHandler, prefix: "admin/update-owner" },
  "delete-owner": { method: "POST", handler: deleteOwnerHandler, prefix: "admin/delete-owner" },
  "criar-cliente": { method: "POST", handler: criarClienteHandler, prefix: "admin/criar-cliente" },
  "criar-contrato": { method: "POST", handler: criarContratoHandler, prefix: "admin/criar-contrato" },
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // A Vercel popula `req.query.slug` como:
  //   - "overview"  (se a rota for /api/admin/overview)
  //   - ["a", "b"]  (se for /api/admin/a/b)
  // Para nosso caso, sempre é uma única string.
  const slugArr = req.query?.slug;
  const slug = Array.isArray(slugArr) ? slugArr[0] : slugArr;
  if (!slug) {
    return res.status(404).json({ ok: false, erro: "Rota não encontrada." });
  }

  const rota = ROTAS[slug];
  if (!rota) {
    const allow = Array.from(new Set(Object.values(ROTAS).map((r) => r.method))).join(", ");
    res.setHeader("Allow", allow);
    return res.status(404).json({ ok: false, erro: `Rota /api/admin/${slug} não encontrada.` });
  }

  if (req.method !== rota.method) {
    res.setHeader("Allow", rota.method);
    return res.status(405).json({ ok: false, erro: "Método não permitido." });
  }

  return rota.handler(req, res);
}
