// Template HTML do e-mail de redefinição de senha da Jurex.
// Gera SOMENTE a string HTML (subject fica a cargo do chamador).
//
// Convenções:
// - Visual Jurex: verde esmeralda (#10b981 / emerald-500) e cinza escuro.
// - Largura máxima 560px (compatível com a maioria dos clientes).
// - Tabela-based (não flex/grid), pra Gmail/Outlook renderizarem certo.
// - Fallback textual do link sempre visível, para clientes que cortam
//   o botão (Apple Mail, Outlook 365, etc).
// - O `linkRedefinicao` é inserido em DOIS lugares: o botão e o
//   fallback em texto puro. Mantemos os dois idênticos para que o
//   usuário consiga concluir o fluxo independente do cliente.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @param {object} opts
 * @param {object} opts
 * @param {string} opts.email        - E-mail do destinatário (mostrado em caixa).
 * @param {string} opts.link         - URL completa com oobCode (https://...).
 * @returns {{ html: string, text: string }}
 */
export function renderEmailRedefinicaoSenha({ email, link }) {
  const emailSafe = escapeHtml(email || "");
  const linkSafe = escapeHtml(link || "");

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>Redefinir sua senha — Jurex</title>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0f172a;padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">

        <!-- Cabeçalho: logo J + nome + subtítulo -->
        <tr>
          <td align="center" style="padding:0 0 24px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
              <tr>
                <td style="vertical-align:middle;">
                  <div style="display:inline-block;width:40px;height:40px;line-height:40px;background-color:#10b981;color:#ffffff;text-align:center;font-weight:800;font-size:20px;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">J</div>
                </td>
                <td style="vertical-align:middle;padding-left:12px;">
                  <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">Jurex</div>
                  <div style="font-size:10px;font-weight:700;color:#10b981;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Gestão Financeira</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Card principal -->
        <tr>
          <td style="background-color:#ffffff;border-radius:16px;padding:32px 28px;border:1px solid #1e293b;box-shadow:0 10px 30px rgba(0,0,0,0.25);">

            <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.3px;">
              Redefinir sua senha
            </h1>

            <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#475569;">
              Recebemos um pedido para redefinir a senha da sua conta Jurex.
              Se você fez essa solicitação, clique no botão abaixo para
              escolher uma nova senha.
            </p>

            <!-- Caixa com o e-mail da conta -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;margin:0 0 24px 0;">
              <tr>
                <td style="padding:14px 16px;">
                  <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">
                    Conta
                  </div>
                  <div style="font-size:15px;font-weight:700;color:#0f172a;word-break:break-all;">
                    ${emailSafe}
                  </div>
                </td>
              </tr>
            </table>

            <!-- Botão principal -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="center" style="padding:4px 0 8px 0;">
                  <a href="${linkSafe}" target="_blank" rel="noopener noreferrer"
                     style="display:inline-block;background-color:#10b981;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;padding:14px 32px;border-radius:12px;letter-spacing:0.2px;">
                    Redefinir senha →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:20px 0 0 0;font-size:13px;line-height:1.6;color:#64748b;">
              Este link expira em <strong style="color:#0f172a;">1 hora</strong>
              e pode ser usado apenas uma vez. Se você não solicitou a
              redefinição, basta ignorar este e-mail — sua senha atual
              continua valendo.
            </p>

            <!-- Fallback textual do link -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;border-top:1px solid #e2e8f0;">
              <tr>
                <td style="padding-top:16px;">
                  <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">
                    Não consegue clicar no botão?
                  </div>
                  <div style="font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">
                    Cole este link no seu navegador:<br />
                    <a href="${linkSafe}" style="color:#10b981;text-decoration:underline;">${linkSafe}</a>
                  </div>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding:20px 16px 0 16px;">
            <div style="font-size:12px;color:#94a3b8;line-height:1.6;">
              Cred-Facil — Controle total dos seus empréstimos.<br />
              <a href="https://tiru-investi.vercel.app" style="color:#94a3b8;text-decoration:underline;">tiru-investi.vercel.app</a>
            </div>
            <div style="font-size:11px;color:#475569;margin-top:8px;">
              Este é um e-mail automático. Não responda esta mensagem.
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    "Jurex — Gestão Financeira",
    "",
    "Redefinir sua senha",
    "",
    `Conta: ${email || ""}`,
    "",
    "Recebemos um pedido para redefinir a senha da sua conta Jurex.",
    "Se você fez essa solicitação, use o link abaixo para escolher uma",
    "nova senha:",
    "",
    link || "",
    "",
    "Este link expira em 1 hora e pode ser usado apenas uma vez.",
    "Se você não solicitou a redefinição, basta ignorar este e-mail —",
    "sua senha atual continua valendo.",
    "",
    "— Jurex",
    "https://tiru-investi.vercel.app",
  ].join("\n");

  return { html, text };
}
