import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PAXTU_LOGIN_URL = 'https://paxtu100.escoteiros.org.br/login';

async function updateEnvCookie(cookieValue) {
  const envPath = path.join(process.cwd(), '.env');
  let content = '';
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    // arquivo não existe ainda, será criado
  }

  const line = `PAXTU_COOKIE="${cookieValue}"`;
  if (/^PAXTU_COOKIE=/m.test(content)) {
    content = content.replace(/^PAXTU_COOKIE=.*$/m, line);
  } else {
    content = content.trimEnd() + (content.trim() ? '\n' : '') + line + '\n';
  }

  await writeFile(envPath, content);
}

async function main() {
  const user = process.env.user;
  const password = process.env.senha;

  if (!user || !password) {
    throw new Error('user/senha não encontrados nas variáveis de ambiente (.env)');
  }

  console.log('Abrindo navegador...');
  const browser = await chromium.launch({ headless: false });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    console.log('Navegando para o Paxtu 100 / Keycloak...');
    await page.goto(PAXTU_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const usernameInput = await page.waitForSelector('input[name="username"], #username', { timeout: 30000 }).catch(() => null);
    if (usernameInput) {
      console.log('Formulário de login Keycloak encontrado. Preenchendo credenciais...');
      await page.fill('input[name="username"], #username', user);
      await page.fill('input[name="password"], #password', password);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
        page.click('input[type="submit"], #kc-login, button[type="submit"]'),
      ]);

      await page.waitForTimeout(2000);
    } else {
      console.log('Sessão já autenticada (formulário de login não encontrado).');
    }

    console.log('Aguardando carregamento da página...');
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'paxtu100_session')?.value;
    const xsrfToken = cookies.find((c) => c.name === 'XSRF-TOKEN')?.value;
    const cfClearance = cookies.find((c) => c.name === 'cf_clearance')?.value;

    if (!sessionCookie) {
      throw new Error('paxtu100_session não encontrado após o login. Verifique se o login foi bem-sucedido.');
    }

    const cookieParts = [];
    if (xsrfToken) cookieParts.push(`XSRF-TOKEN=${xsrfToken}`);
    cookieParts.push(`paxtu100_session=${sessionCookie}`);
    if (cfClearance) cookieParts.push(`cf_clearance=${cfClearance}`);
    const cookieValue = cookieParts.join('; ');

    await updateEnvCookie(cookieValue);
    console.log('PAXTU_COOKIE salvo em .env com sucesso.');

    return cookieValue;
  } catch (error) {
    console.error('Login falhou:', error.message);
    await page.screenshot({ path: 'public/paxtu-login-error.png' }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
