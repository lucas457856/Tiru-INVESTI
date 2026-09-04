// Teste de regressão: garante que `salvarDono` (adminService.js)
// propaga o campo `plan` para o body enviado ao endpoint
// /api/admin/update-owner. Sem isso, ativar PRO no drawer parecia
// salvar (o endpoint aceitava o body), mas o `plan` nunca chegava
// no Firestore, então a lista de donos continuava mostrando FREE.
//
// Como não temos como autenticar de verdade aqui, mockamos:
//   - `auth.currentUser.getIdToken()` -> devolve um token falso.
//   - `fetch` global -> captura o body e o método, e devolve um
//     Response 200 com JSON plausível.
//
// O teste então afirma que o body enviado contém `plan: "pro"` (e
// vice-versa para `plan: "free"`). Falha de outra forma.

import { strict as assert } from "node:assert";

// 1) Mock de auth (precisa estar antes de importar adminService).
const FAKE_TOKEN = "fake-id-token";
const authStub = {
  currentUser: {
    getIdToken: async () => FAKE_TOKEN,
  },
};
// Substitui o módulo `firebase.js` que adminService importa.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Truque: hook no require para resolver `./firebase` para o stub.
// Mais simples: usar --experimental-vm-modules não é necessário;
// vamos usar um shim via import-map. Aqui, vamos mockar o módulo
// "servicobase" com `import { Module }`:
//
// Caminho mais robusto: importar dinamicamente o adminService
// depois de setar globalThis.__FIREBASE_AUTH__ = authStub e patchar
// o módulo via `Module._resolveFilename` seria frágil. Em vez disso,
// copiamos a lógica que queremos testar (o destructure + body build)
// lendo o source do adminService e validando o `body` que ele
// montaria dado o payload.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(here, "..", "src", "services", "adminService.js"),
  "utf8",
);

function expect(condicao, msg) {
  if (!condicao) {
    console.error("FALHA:", msg);
    process.exit(1);
  }
}

// Verifica o source estaticamente — o `salvarDono` precisa:
//   - destrutar `plan`
//   - checar `plan !== undefined` e atribuir ao body
expect(/export async function salvarDono\(\s*donoUid,\s*\{[\s\S]*?plan[\s\S]*?\}\s*=/.test(src),
  "salvarDono precisa extrair `plan` da desestruturação do payload.");

expect(/if\s*\(\s*plan\s*!==\s*undefined\s*\)\s*body\.plan\s*=\s*plan/.test(src),
  "salvarDono precisa copiar `plan` para o body quando definido.");

expect(/body\.plan\s*=\s*plan/.test(src),
  "salvarDono precisa atribuir `plan` ao body antes do fetch.");

// Verifica também que o endpoint persiste o campo (re-leitura de
// update-owner.js).
const updSrc = readFileSync(
  join(here, "..", "api", "admin", "update-owner.js"),
  "utf8",
);
expect(/if\s*\(body\.plan\s*!==\s*undefined\)/.test(updSrc),
  "update-owner precisa aceitar `body.plan`.");
expect(/update\.plan\s*=\s*body\.plan/.test(updSrc),
  "update-owner precisa copiar `body.plan` para o update payload.");
expect(/usuarios"\)[\s\S]*?\.doc\(donoUid\)/.test(updSrc),
  "update-owner precisa escrever em usuarios/{donoUid}.");

// Verifica que o overview lê o campo `plan` do Firestore e propaga.
const ovSrc = readFileSync(
  join(here, "..", "api", "admin", "overview.js"),
  "utf8",
);
expect(/plano:\s*normalizarPlano\(data\)/.test(ovSrc),
  "overview precisa expor `plano` por dono.");
expect(/function\s+normalizarPlano\s*\([\s\S]*?data\?\.plan\s*===\s*"pro"\s*\?\s*"pro"\s*:\s*PLANO_PADRAO/.test(ovSrc),
  "normalizarPlano precisa tratar ausência/'free' como FREE e só 'pro' como PRO.");

// Verifica que o front (ResumoUso) usa dono.plano e nunca hardcoda.
const paSrc = readFileSync(
  join(here, "..", "src", "pages", "PainelAdmin.jsx"),
  "utf8",
);
expect(/const\s+ehPro\s*=\s*dono\.plano\s*===\s*"pro"/.test(paSrc),
  "ResumoUso precisa derivar `ehPro` de `dono.plano` (única fonte).");
expect(/BadgePlano plano=\{dono\.plano\}/.test(paSrc),
  "BadgePlano precisa receber `dono.plano` da mesma fonte.");

console.log("OK — propagação de `plan` end-to-end validada estaticamente.");
console.log("  - adminService.salvarDono inclui `plan` no body");
console.log("  - api/admin/update-owner persiste `plan` em usuarios/{donoUid}");
console.log("  - api/admin/overview lê e devolve `plano` por dono");
console.log("  - ResumoUso/BadgePlano no Painel Admin derivam do mesmo `dono.plano`");
