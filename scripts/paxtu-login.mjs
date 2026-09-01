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
    console.log('Navegando para o Paxtu (antigo)...');
    await page.goto(PAXTU_HOME, { waitUntil: 'networkidle', timeout: 60000 });

    const loginForm = await page.$('input[name="dsLogin"]');
    if (loginForm) {
      console.log('Formulário de login encontrado. Preenchendo credenciais...');
      await page.fill('input[name="dsLogin"]', user);
      await page.fill('input[name="dsSenha"]', password);

      await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes('loginservice') || res.url().includes('index.jsp'),
          { timeout: 60000 }
        ).catch(() => {}),
        page.getByRole('button', { name: 'Login' }).click(),
      ]);

      await page.waitForTimeout(3000);
    } else {
      console.log('Sessão já autenticada (formulário de login não encontrado).');
    }

    console.log('Login concluído. Aguardando carregamento da página...');
    await page.waitForLoadState('networkidle', { timeout: 60000 });

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
    console.log('PAXTU_COOKIE salvo em .env com sucesso.');

    return cookieValue;
  } catch (error) {
    console.error('Login falhou:', error.message);
    await page.screenshot({ path: 'public/paxtu-login-error.png' });
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
