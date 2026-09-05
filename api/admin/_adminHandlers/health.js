// Sub-handler: GET /api/admin/health
//
// Disparado por api/admin/[...slug].js quando slug === "health".
//
// Endpoint público (sem auth) usado para diagnóstico. Mostra:
//   - Se a função serverless está respondendo JSON corretamente
//   - Se a env var ADMIN_UID está configurada
//   - Se a env var ADMIN_UID confere com o UID oficial do projeto
//   - Quais env vars do Firebase Admin estão faltando
//
// NÃO expõe nenhum secret. Apenas "ok" ou "faltando" para cada var.
// NÃO faz nenhuma chamada ao Firebase.

const ADMIN_UID_OFICIAL = "hzfrWIuTXYgeasOTPD7pmKNxt1P2";

function listarFaltando() {
  const out = {};
  out.ADMIN_UID = !!process.env.ADMIN_UID;
  out.FIREBASE_PROJECT_ID = !!process.env.FIREBASE_PROJECT_ID;
  out.FIREBASE_CLIENT_EMAIL = !!process.env.FIREBASE_CLIENT_EMAIL;
  out.FIREBASE_PRIVATE_KEY = !!process.env.FIREBASE_PRIVATE_KEY;
  return out;
}

export async function healthHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const env = listarFaltando();
  const adminUidConfigurado = !!process.env.ADMIN_UID;
  const adminUidConfere = process.env.ADMIN_UID === ADMIN_UID_OFICIAL;

  return res.status(200).json({
    ok: true,
    mensagem: "Endpoint administrativo respondendo.",
    env,
    adminUidConfigurado,
    adminUidConfere,
    timestamp: new Date().toISOString(),
  });
}
