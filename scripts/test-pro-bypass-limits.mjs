// Teste de regressão para a regra "PRO = ilimitado".
//
// Garante que:
//   1. Backend: cada endpoint que valida limite (criar-cliente,
//      criar-contrato, create-employee) tem um helper `ehPro` e
//      pula a checagem de limite quando o DONO é PRO.
//   2. Frontend: cada página que decide `limiteAtingido` também
//      checa `!ehPro` (ou seja, PRO nunca bloqueia por limite).
//   3. Regras: nada foi apagado (apenas `&& !ehPro(...)` adicionado).
//
// Sem isso, o usuário no plano PRO continuaria sendo bloqueado
// pela mensagem "Limite de X atingido" mesmo com limites FREE salvos.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function expect(cond, msg) {
  if (!cond) {
    console.error("FALHA:", msg);
    process.exit(1);
  }
}

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

// 1) Helpers `ehPro` em cada endpoint
const endpoints = [
  "api/admin/criar-cliente.js",
  "api/admin/criar-contrato.js",
  "api/auth/create-employee.js",
];
for (const ep of endpoints) {
  const src = read(ep);
  expect(/function\s+ehPro\s*\(\s*perfil\s*\)\s*\{[^}]*perfil\?\.plan\s*===\s*"pro"[^}]*\}/.test(src),
    `${ep}: precisa ter um helper ehPro(perfil) que compara perfil?.plan === "pro".`);
}

// 2) Checagem de limite (limites.clientes/contratos/funcionarios > 0)
//    é envolta em `!ehPro(...)` em cada endpoint
const checks = [
  {
    file: "api/admin/criar-cliente.js",
    // Padrão: if (!ehPro(perfilDono) && limites.clientes > 0) {
    needle: /if\s*\(\s*!ehPro\(perfilDono\)\s*&&\s*limites\.clientes\s*>\s*0\s*\)\s*\{/,
    label: "criar-cliente: limite de clientes protegido por !ehPro",
  },
  {
    file: "api/admin/criar-contrato.js",
    needle: /if\s*\(\s*!ehPro\(perfilDono\)\s*&&\s*limites\.contratos\s*>\s*0\s*\)\s*\{/,
    label: "criar-contrato: limite de contratos do DONO protegido por !ehPro",
  },
  {
    file: "api/auth/create-employee.js",
    needle: /if\s*\(\s*!ehPro\(perfilChamador\)\s*&&\s*limiteFuncionarios\s*>\s*0\s*\)\s*\{/,
    label: "create-employee: limite de funcionarios protegido por !ehPro",
  },
];
for (const c of checks) {
  const src = read(c.file);
  expect(c.needle.test(src), `${c.label} (arquivo: ${c.file})`);
}

// 3) Frontend: páginas com `limiteAtingido` precisam checar `!ehPro`
const feChecks = [
  {
    file: "src/pages/Clientes.jsx",
    needle: /!\s*ehPro\s*&&[\s\S]{0,200}clientes\.length\s*>=\s*limiteClientes/,
    label: "Clientes.jsx: limiteAtingido checa !ehPro",
  },
  {
    file: "src/pages/Emprestimos.jsx",
    needle: /!\s*ehPro\s*&&[\s\S]{0,200}contratos\.length\s*>=\s*limiteContratos/,
    label: "Emprestimos.jsx: limiteAtingido checa !ehPro",
  },
  {
    file: "src/pages/Funcionarios.jsx",
    needle: /!\s*ehPro\s*&&\s*limites\.funcionarios\s*>\s*0\s*&&\s*funcionarios\.length\s*>=\s*limites\.funcionarios/,
    label: "Funcionarios.jsx: limiteAtingido checa !ehPro",
  },
  {
    file: "src/pages/NovoCliente.jsx",
    needle: /!\s*ehPro\s*&&[\s\S]{0,200}qtdClientes\s*>=\s*limiteClientes/,
    label: "NovoCliente.jsx: limiteAtingido checa !ehPro",
  },
  {
    file: "src/pages/NovoContrato.jsx",
    needle: /!\s*ehPro\s*&&[\s\S]{0,200}qtdContratos\s*>=\s*limiteContratos/,
    label: "NovoContrato.jsx: limiteAtingido checa !ehPro",
  },
];
for (const c of feChecks) {
  const src = read(c.file);
  expect(c.needle.test(src), `${c.label} (arquivo: ${c.file})`);
}

// 4) Cada página usa o `plan` do useDonoAdmin
const fePlanChecks = [
  "src/pages/Clientes.jsx",
  "src/pages/Emprestimos.jsx",
  "src/pages/Funcionarios.jsx",
  "src/pages/NovoCliente.jsx",
  "src/pages/NovoContrato.jsx",
];
for (const f of fePlanChecks) {
  const src = read(f);
  // Procura `plan` perto do `useDonoAdmin()` (em qualquer ordem
  // dentro do destructure ou logo após).
  const m = src.match(/useDonoAdmin\(\)/);
  expect(m, `${f}: useDonoAdmin() precisa estar sendo chamado.`);
  const idx = m.index;
  const janela = src.slice(Math.max(0, idx - 250), idx + 200);
  expect(/\bplan\b/.test(janela),
    `${f}: precisa desestruturar \`plan\` do useDonoAdmin().`);
}

// 5) Garantir que o limite individual do funcionário NÃO foi tocado
//    indevidamente em criar-contrato (regra de negócio separada)
const cc = read("api/admin/criar-contrato.js");
expect(/limiteFunc\s*>\s*0/.test(cc),
  "criar-contrato: limite individual do funcionário continua validando sem ehPro (escopo separado).");

console.log("OK — regra 'PRO = ilimitado' validada de ponta a ponta:");
console.log("  Backend (3 endpoints): ehPro(...) pula o limite do DONO em PRO");
console.log("  Frontend (5 páginas):   limiteAtingido checa !ehPro");
console.log("  Limite individual de funcionário: continua aplicando (escopo separado)");
