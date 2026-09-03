// API: POST /api/auth/reset-password
//
// Fluxo:
//   1. Recebe { email } do cliente (apenas o e-mail, NUNCA credenciais).
//   2. Valida método, body e formato do e-mail.
//   3. Usa Firebase Admin (generatePasswordResetLink) para gerar o link
//      com oobCode. O link aponta para https://tiru-investi.vercel.app/nova-senha
//      e tem validade de 1 hora (padrão Firebase).
//   4. Envia o e-mail HTML personalizado via Resend.
//   5. Retorna 200 sem expor o link, o e-mail, ou qualquer credencial.
//
// Segurança:
//   - Variáveis sensíveis (FIREBASE_PRIVATE_KEY, RESEND_API_KEY, etc.)
//     vêm de process.env e NUNCA são logadas nem retornadas no body.
//   - O link gerado NUNCA aparece em logs. Só o `email` do destinatário
//     (já público) e o `messageId` do Resend (ID opaco).
//   - Em ambiente dev (localhost), o link aponta para o domínio canônico
//     de produção para que o usuário possa clicar do e-mail real.
//   - `auth/user-not-found` retorna 200 com `ok: true` para não vazar
//     quais e-mails existem cadastrados (mesma postura do Firebase
//     Client SDK sendPasswordResetEmail).

import { getAuth } from "firebase-admin/auth";
import { Resend } from "resend";
import { getFirebaseAdmin } from "../_lib/firebaseAdmin.js";
import { renderEmailRedefinicaoSenha } from "../_lib/emailTemplate.js";

const PRODUCAO_ORIGEM = "https://tiru-investi.vercel.app";
const CONTINUE_URL = `${PRODUCAO_ORIGEM}/nova-senha`;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setCors(res) {
  // Mesma origem do front; mantém headers simples. Se o front e a API
  // ficarem em domínios diferentes, isso precisa ser ajustado.
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, erro: "Método não permitido." });
  }

  // 1) Body
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!email) {
    return res.status(400).json({ ok: false, erro: "Informe um e-mail válido." });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ ok: false, erro: "Informe um e-mail válido." });
  }

  // 2) Env vars obrigatórias
  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM_EMAIL;

  if (!resendApiKey) {
    console.error("RESEND_API_KEY ausente. Configure no painel da Vercel.");
    return res.status(500).json({
      ok: false,
      erro: "Serviço de e-mail indisponível no momento. Tente novamente mais tarde.",
    });
  }
  if (!resendFrom) {
    console.error("RESEND_FROM_EMAIL ausente. Configure no painel da Vercel.");
    return res.status(500).json({
      ok: false,
      erro: "Serviço de e-mail indisponível no momento. Tente novamente mais tarde.",
    });
  }

  // 3) Firebase Admin
  let admin;
  try {
    admin = getFirebaseAdmin();
  } catch (err) {
    console.error("Falha ao inicializar Firebase Admin:", err.code || err.message);
    return res.status(500).json({
      ok: false,
      erro: "Serviço de autenticação indisponível. Tente novamente mais tarde.",
    });
  }
  const authAdmin = getAuth(admin);

  // 4) Gera o link de redefinição (NÃO logamos o link, por segurança)
  let resetLink;
  try {
    resetLink = await authAdmin.generatePasswordResetLink(email, {
      url: CONTINUE_URL,
      handleCodeInApp: true,
    });
  } catch (err) {
    // Não vaza se o e-mail existe na base. Para "user-not-found"
    // devolvemos 200 silencioso, igual ao Firebase Client SDK.
    if (err?.code === "auth/user-not-found") {
      return res.status(200).json({ ok: true });
    }
    if (err?.code === "auth/invalid-email") {
      return res.status(400).json({ ok: false, erro: "E-mail inválido." });
    }
    console.error("Firebase generatePasswordResetLink falhou:", {
      code: err?.code,
      message: err?.message,
    });
    return res.status(500).json({
      ok: false,
      erro: "Não foi possível gerar o link de redefinição. Tente novamente em alguns minutos.",
    });
  }

  // 5) Monta e envia o e-mail
  const { html, text } = renderEmailRedefinicaoSenha({ email, link: resetLink });

  try {
    const resend = new Resend(resendApiKey);
    const result = await resend.emails.send({
      from: resendFrom,
      to: email,
      subject: "Redefinir sua senha — Jurex",
      html,
      text,
    });
    if (result?.error) {
      console.error("Resend retornou erro:", result.error?.name, result.error?.message);
      return res.status(502).json({
        ok: false,
        erro: "Não foi possível enviar o e-mail. Tente novamente em alguns minutos.",
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Resend exception:", err?.message || err);
    return res.status(502).json({
      ok: false,
      erro: "Não foi possível enviar o e-mail. Tente novamente em alguns minutos.",
    });
  }
}
