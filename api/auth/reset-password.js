// API: POST /api/auth/reset-password
//
// Fluxo:
//   1. Recebe { email } do cliente (apenas o e-mail, NUNCA credenciais).
//   2. Valida método, body e formato do e-mail.
//   3. Usa Firebase Admin (generatePasswordResetLink) para gerar o link
//      oficial do Firebase (com oobCode válido por 1h).
//   4. EXTRAI o `oobCode` desse link e monta a URL final
//      https://tiru-investi.vercel.app/nova-senha?oobCode=...
//      O token continua sendo o do Firebase (validade, regras e
//      confirmação idênticas); só trocamos a porta de entrada para o
//      app do usuário, evitando o redirect pela página
//      `__/auth/action` do firebaseapp.com (que falha em adblockers,
//      webviews de e-mail mobile, etc).
//   5. Envia o e-mail HTML personalizado via Resend, apontando para
//      a URL final.
//   6. Retorna 200 sem expor o link, o oobCode, o e-mail ou qualquer
//      credencial.
//
// Segurança:
//   - Variáveis sensíveis (FIREBASE_PRIVATE_KEY, RESEND_API_KEY, etc.)
//     vêm de process.env e NUNCA são logadas nem retornadas no body.
//   - O `oobCode` NUNCA aparece em logs (nem inteiro, nem parcial).
//   - `auth/user-not-found` retorna 200 com `ok: true` para não vazar
//     quais e-mails existem cadastrados.

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

  // 4) Gera o link oficial do Firebase (apenas para obter o oobCode
  // válido). O Admin retorna um link para
  // `https://<projectId>.firebaseapp.com/__/auth/action?mode=
  // resetPassword&oobCode=XXX&continueUrl=...`. NÃO vamos usar esse
  // link diretamente no botão do e-mail, porque ele força o usuário a
  // passar pela página `__/auth/action` do firebaseapp.com — o que
  // falha em adblockers e em vários clientes de e-mail mobile. Em vez
  // disso, extraímos o `oobCode` e montamos a URL final que aponta
  // direto para o nosso app. O token é o mesmo (validade 1h, mesma
  // regra de expiração do Firebase), então `confirmPasswordReset` na
  // página /nova-senha continua aceitando normalmente.
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

  // 5) Extrai o oobCode do link do Firebase e monta a URL final.
  // NÃO logamos nem o link bruto nem o oobCode.
  let oobCode;
  try {
    oobCode = new URL(resetLink).searchParams.get("oobCode");
  } catch {
    console.error("Não foi possível parsear o link de redefinição do Firebase.");
    return res.status(500).json({
      ok: false,
      erro: "Não foi possível gerar o link de redefinição. Tente novamente em alguns minutos.",
    });
  }
  if (!oobCode) {
    console.error("Link do Firebase não contém oobCode.");
    return res.status(500).json({
      ok: false,
      erro: "Não foi possível gerar o link de redefinição. Tente novamente em alguns minutos.",
    });
  }
  // Validação defensiva: oobCode do Firebase é uma string base64url
  // com tamanho típico entre 60 e 200 caracteres. Se vier algo fora
  // disso, recusamos em vez de repassar para o front.
  if (!/^[A-Za-z0-9_-]{20,512}$/.test(oobCode)) {
    console.error("oobCode em formato inesperado.");
    return res.status(500).json({
      ok: false,
      erro: "Não foi possível gerar o link de redefinição. Tente novamente em alguns minutos.",
    });
  }

  // URL final que vai para o botão do e-mail.
  // O `oobCode` é codificado para ser seguro em URL.
  const linkFinal = `${PRODUCAO_ORIGEM}/nova-senha?oobCode=${encodeURIComponent(oobCode)}`;

  // 6) Monta e envia o e-mail com a URL final do Jurex.
  const { html, text } = renderEmailRedefinicaoSenha({ email, link: linkFinal });

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
