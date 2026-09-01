import { chromium } from 'playwright';
const browser = await chromium.launch();
// logado? Se /dashboard redireciona para /login, criamos sessão via UI
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
console.log('URL atual:', page.url());
// Se estiver no login, faz login com conta de teste
if (page.url().includes('/login')) {
  await page.fill('#email', 'lucas457856@gmail.com');
  await page.fill('#senha', 'teste12345');
  await page.click('button[aria-label="Verificação Cloudflare"]');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  console.log('após login:', page.url());
}
// Abre o submenu de Configurações
await page.click('button:has-text("Configurações")');
await page.waitForTimeout(400);
await page.screenshot({ path: 'C:/Users/Luquete/Downloads/chkformiga/Claude-IA/sidebar-submenu.png' });
await browser.close();
console.log('ok');
