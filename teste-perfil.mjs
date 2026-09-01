import { chromium } from 'file:///C:/Users/Luquete/Downloads/chkformiga/clonar-site-com-node/node_modules/playwright/index.mjs';

const BASE = 'http://localhost:5175';
const results = [];
function log(nome, ok, detalhe = '') {
  results.push({ nome, ok, detalhe });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${nome}${detalhe ? ` :: ${detalhe}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));

// ---------- 1. Usuário não autenticado é redirecionado ----------
await page.goto(`${BASE}/clientes`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
log(
  'Não autenticado em /clientes redireciona para /login',
  page.url().includes('/login'),
  page.url()
);

// ---------- 2. Login ----------
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', 'lucas457856@gmail.com');
await page.fill('#senha', 'teste12345');
// TurnstileMock: clica no checkbox de verificação se existir
const turnstile = page.locator('button[aria-label*="Cloudflare"], [role="button"][aria-label*="Verificação"]');
const turnstileCount = await turnstile.count();
if (turnstileCount > 0) {
  await turnstile.first().click();
}
await page.click('button[type="submit"]');
await page.waitForTimeout(5000);
log('Login efetuado (chegou ao dashboard)', page.url().includes('/dashboard'), page.url());

// ---------- 3. Lista de clientes carrega ----------
await page.goto(`${BASE}/clientes`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const cards = page.locator('article');
const qtdCards = await cards.count();
log('Lista /clientes carrega com cards', qtdCards > 0, `${qtdCards} card(s)`);

// ---------- 4. Clicar em um card abre /clientes/:id ----------
if (qtdCards > 0) {
  await cards.first().click();
  await page.waitForTimeout(3000);
  const url = page.url();
  const match = url.match(/\/clientes\/([A-Za-z0-9]+)$/);
  log('Clique no card navega para /clientes/:id', !!match, url);

  // ---------- 5. Perfil mostra dados reais ----------
  const nomeVisivel = await page.locator('h2').first().textContent().catch(() => null);
  log('Perfil exibe nome do cliente', !!nomeVisivel && nomeVisivel.trim().length > 0, nomeVisivel ?? 'vazio');

  const temEmprestado = await page.getByText('EMPRESTADO', { exact: false }).count();
  const temRecebido = await page.getByText('RECEBIDO', { exact: false }).count();
  log('Blocos Emprestado/Recebido presentes', temEmprestado > 0 && temRecebido > 0);

  const temTelefone = await page.getByText('TELEFONE', { exact: false }).count();
  const temEmail = await page.getByText('E-MAIL', { exact: false }).count();
  const temEndereco = await page.getByText('ENDEREÇO', { exact: false }).count();
  log('Campos Telefone/E-mail/Endereço presentes', temTelefone > 0 && temEmail > 0 && temEndereco > 0);

  // ---------- 6. Contratos e Documentos ----------
  const contratosSecao = await page.getByText('CONTRATOS', { exact: false }).count();
  log('Seção CONTRATOS presente', contratosSecao > 0);
  const docsSecao = await page.getByText('DOCUMENTOS', { exact: false }).count();
  log('Seção DOCUMENTOS presente', docsSecao > 0);

  // ---------- 7. Botão Editar abre /clientes/:id/editar com dados ----------
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.waitForTimeout(2500);
  const urlEditar = page.url();
  log('Editar navega para /clientes/:id/editar', /\/clientes\/[A-Za-z0-9]+\/editar$/.test(urlEditar), urlEditar);
  const inputNome = page.locator('#editar-cliente-nome');
  const valorNome = await inputNome.inputValue().catch(() => '');
  log('Formulário de edição carrega dados atuais', valorNome.trim().length > 0, valorNome);

  // Volta para o perfil (sem salvar)
  await page.goBack();
  await page.waitForTimeout(2000);
}

// ---------- 8. Cliente inexistente ----------
await page.goto(`${BASE}/clientes/IDINEXISTENTE123`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const naoEncontrado = await page.getByText('Cliente não encontrado.').count();
log('Cliente inexistente mostra "Cliente não encontrado."', naoEncontrado > 0);

// ---------- 9. Botão voltar para clientes ----------
const btnVoltar = await page.getByRole('button', { name: 'Voltar para clientes' }).count();
log('Botão "Voltar para clientes" presente', btnVoltar > 0);

// ---------- Erros de console (ignorando extensões e erros conhecidos do ambiente) ----------
const errosRelevantes = consoleErrors.filter(
  (e) =>
    !e.includes('genadblock') &&
    !e.includes('ContentScriptManager') &&
    !e.includes('installHook')
);
log('Sem erros de console do app', errosRelevantes.length === 0, errosRelevantes.slice(0, 3).join(' | '));

await page.screenshot({ path: 'C:/Users/Luquete/Downloads/chkformiga/Claude-IA/teste-final.png', fullPage: false });
await browser.close();

const falhas = results.filter((r) => !r.ok);
console.log(`\n=== RESULTADO: ${results.length - falhas.length}/${results.length} testes passaram ===`);
if (falhas.length > 0) process.exit(1);
