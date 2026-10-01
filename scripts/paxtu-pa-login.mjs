import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PAXTU_HOME = 'https://paxtu.escoteiros.org.br/paxtu/main.do';

async function updateEnvCookie(cookieValue) {
  const envPath = path.join(process.cwd(), '.env');
  let content = '';
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    // arquivo não existe ainda
  }

  const line = `PAXTU_PA_COOKIE="${cookieValue}"`;
  if (/^PAXTU_PA_COOKIE=/m.test(content)) {
    content = content.replace(/^PAXTU_PA_COOKIE=.*$/m, line);
  } else {
    content = content.trimEnd() + (content.trim() ? '\n' : '') + line + '\n';
  }

  await writeFile(envPath, content);
}

async function main() {
  const user = process.env.user_pa || process.env.user;
  const password = process.env.senha_pa || process.env.senha;

  if (!user || !password) {
    throw new Error('user_pa/senha_pa não encontrados no .env');
  }

  console.log(`[Paxtu PA Login] Iniciando login para usuário: ${user.slice(0, 4)}***...`);
  const browser = await chromium.launch({ headless: false });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    console.log('[Paxtu PA Login] Navegando para o Paxtu (antigo)...');
    await page.goto(PAXTU_HOME, { waitUntil: 'networkidle', timeout: 60000 });

    const loginForm = await page.waitForSelector('input[name="dsLogin"]', { timeout: 15000 }).catch(() => null);
    if (loginForm) {
      console.log('[Paxtu PA Login] Formulário de login encontrado. Preenchendo credenciais...');
      await page.fill('input[name="dsLogin"]', user);
      await page.fill('input[name="dsSenha"]', password);

      console.log('[Paxtu PA Login] Clicando no botão Login...');
      await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes('loginservice') || res.url().includes('index.jsp') || res.url().includes('main.do'),
          { timeout: 60000 }
        ).catch(() => {}),
        page.getByRole('button', { name: 'Login' }).click(),
      ]);

      await page.waitForTimeout(4000);
    } else {
      console.log('[Paxtu PA Login] Formulário de login não visível de imediato, verificando se já autenticado...');
    }

    console.log('[Paxtu PA Login] Aguardando carregamento pós-login...');
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const cookies = await context.cookies();
    const jsessionid = cookies.find((c) => c.name === 'JSESSIONID')?.value;
    const cfClearance = cookies.find((c) => c.name === 'cf_clearance')?.value;

    if (!jsessionid) {
      throw new Error('JSESSIONID não encontrado após o login. Verifique se o login foi bem-sucedido.');
    }

    const cookieParts = [`JSESSIONID=${jsessionid}`];
    if (cfClearance) cookieParts.push(`cf_clearance=${cfClearance}`);
    const cookieValue = cookieParts.join('; ');

    await updateEnvCookie(cookieValue);
    console.log('✅ PAXTU_PA_COOKIE salvo em .env com sucesso!');
    console.log(`Cookie obtido: JSESSIONID=${jsessionid.slice(0, 8)}...`);

    return cookieValue;
  } catch (error) {
    console.error('❌ Login falhou:', error.message);
    await page.screenshot({ path: 'public/paxtu-pa-login-error.png' }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
