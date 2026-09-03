// Script de diagnóstico para o endpoint administrativo.
//
// O que ele faz:
//   1. Faz um GET em /api/admin/overview SEM token (deve dar 401).
//   2. Tenta fazer login programático (precisa de e-mail/senha via env).
//   3. Faz GET COM o ID Token e mostra o que o servidor respondeu.
//
// Uso:
//   ADMIN_EMAIL=seu@email.com ADMIN_SENHA=suaSenha node scripts/test-admin-endpoint.mjs
//
// Saída mostra:
//   - HTTP status code
//   - Content-Type
//   - Body bruto (mesmo que não seja JSON)
//   - Diagnóstico automático

const BASE = process.env.ADMIN_BASE_URL || "https://cred-facil-zeta.vercel.app";
const EMAIL = process.env.ADMIN_EMAIL;
const SENHA = process.env.ADMIN_SENHA;

function log(rotulo, valor) {
  console.log(`\n=== ${rotulo} ===`);
  console.log(valor);
}

async function testeSemToken() {
  log("TESTE 1 — sem token", `URL: ${BASE}/api/admin/overview`);
  const r = await fetch(`${BASE}/api/admin/overview`, { method: "GET" });
  const texto = await r.text();
  log("Resposta", `Status: ${r.status}\nContent-Type: ${r.headers.get("content-type")}\nBody: ${texto}`);
  return { status: r.status, contentType: r.headers.get("content-type"), body: texto };
}

async function testeComToken() {
  if (!EMAIL || !SENHA) {
    log(
      "TESTE 2 — com token",
      "Pulando. Defina ADMIN_EMAIL e ADMIN_SENHA no ambiente para fazer login programático.",
    );
    return null;
  }
  log("TESTE 2 — com token", `Login com ${EMAIL}`);

  // Firebase REST API: signInWithPassword
  // Primeiro pegamos API key do Web SDK
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    log("TESTE 2 — com token", "Pulando. Defina FIREBASE_WEB_API_KEY no ambiente.");
    return null;
  }
  const loginResp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: SENHA, returnSecureToken: true }),
    },
  );
  const loginBody = await loginResp.json();
  if (!loginResp.ok) {
    log("Falha no login", JSON.stringify(loginBody, null, 2));
    return null;
  }
  const idToken = loginBody.idToken;
  log("Login OK", `UID: ${loginBody.localId}\nToken (primeiros 30): ${idToken.slice(0, 30)}…`);

  log("GET /api/admin/overview", "com Authorization Bearer");
  const r = await fetch(`${BASE}/api/admin/overview`, {
    method: "GET",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const texto = await r.text();
  log("Resposta", `Status: ${r.status}\nContent-Type: ${r.headers.get("content-type")}\nBody: ${texto}`);

  // Diagnóstico
  if (r.status === 200) {
    try {
      const j = JSON.parse(texto);
      log("Diagnóstico", `✓ Endpoint retornou 200 com ok=${j.ok}. Total de donos: ${j.totals?.donos ?? "?"}.`);
    } catch {
      log("Diagnóstico", "✗ Status 200 mas body não é JSON válido.");
    }
  } else if (r.status === 401) {
    log("Diagnóstico", "✗ 401: token rejeitado. Pode estar expirado ou mal formado.");
  } else if (r.status === 403) {
    log("Diagnóstico", "✗ 403: o UID logado NÃO é o ADMIN_UID. Confira a env var ADMIN_UID na Vercel.");
  } else if (r.status === 500) {
    log(
      "Diagnóstico",
      '✗ 500: o servidor falhou. Veja a mensagem em "Body". Geralmente significa que uma env var (ADMIN_UID, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) está faltando na Vercel.',
    );
  }

  return { status: r.status, body: texto };
}

(async () => {
  log("Diagnóstico do endpoint administrativo", `Base URL: ${BASE}`);
  await testeSemToken();
  await testeComToken();
  log("FIM", "Se nenhum teste produziu dados esperados, verifique no painel da Vercel:\n  1. ADMIN_UID (exatamente: hzfrWIuTXYgeasOTPD7pmKNxt1P2)\n  2. FIREBASE_PROJECT_ID\n  3. FIREBASE_CLIENT_EMAIL\n  4. FIREBASE_PRIVATE_KEY (com \\n escapados, NÃO quebras de linha reais)");
})();
