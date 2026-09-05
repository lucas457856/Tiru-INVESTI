// API: catch-all /api/notifications/*
//
// Consolida 3 sub-rotas em UMA Serverless Function (reduz contagem de
// 13 → 3, dentro do limite de 12 do plano Hobby da Vercel).
//
// Sub-rotas:
//   - POST /api/notifications/register-device
//   - POST /api/notifications/register-event
//   - POST /api/notifications/dispatch
//
// IMPORTANTE: NÃO MUDAR URLs nem contratos. O frontend continua
// chamando exatamente os mesmos endpoints — a Vercel roteia
// automaticamente para este catch-all via `req.query.slug`.
//
// O `vercel.json` define `functions.maxDuration: 30` para esta
// function especificamente, porque o `dispatch` pode demorar com
// N devices em paralelo (cada `messaging.send` é uma chamada HTTP
// ao FCM).

import { registerDeviceHandler } from "./_notifHandlers/registerDevice.js";
import { registerEventHandler } from "./_notifHandlers/registerEvent.js";
import { dispatchHandler } from "./_notifHandlers/dispatch.js";

const ROTAS = {
  "register-device": { method: "POST", handler: registerDeviceHandler, prefix: "notifications/register-device" },
  "register-event": { method: "POST", handler: registerEventHandler, prefix: "notifications/register-event" },
  "dispatch": { method: "POST", handler: dispatchHandler, prefix: "notifications/dispatch" },
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // A Vercel popula `req.query.slug` como:
  //   - "dispatch"  (se a rota for /api/notifications/dispatch)
  //   - ["a", "b"]  (se for /api/notifications/a/b)
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
    return res.status(404).json({ ok: false, erro: `Rota /api/notifications/${slug} não encontrada.` });
  }

  if (req.method !== rota.method) {
    res.setHeader("Allow", rota.method);
    return res.status(405).json({ ok: false, erro: "Método não permitido." });
  }

  return rota.handler(req, res);
}
