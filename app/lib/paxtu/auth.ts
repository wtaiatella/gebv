import { chromium } from 'playwright';

const PAXTU_HOME = 'https://paxtu.escoteiros.org.br/paxtu/main.do';

export async function loginPaxtu(user: string, pass: string): Promise<string> {
  if (!user || !pass) {
    throw new Error('Usuário e senha são obrigatórios.');
  }

  // No servidor Linux (Linode) ou ambiente sem display, roda obrigatoriamente headless: true
  const browser = await chromium.launch({
    headless: true,
  });

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
    await page.goto(PAXTU_HOME, { waitUntil: 'networkidle', timeout: 45000 });

    const loginForm = await page.$('input[name="dsLogin"]');
    if (loginForm) {
      await page.fill('input[name="dsLogin"]', user);
      await page.fill('input[name="dsSenha"]', pass);

      await Promise.all([
        page
          .waitForResponse(
            (res) => res.url().includes('loginservice') || res.url().includes('index.jsp'),
            { timeout: 45000 }
          )
          .catch(() => {}),
        page.getByRole('button', { name: 'Login' }).click(),
      ]);

      await page.waitForTimeout(3000);
    }

    await page.waitForLoadState('networkidle', { timeout: 45000 });

    const cookies = await context.cookies();
    const jsessionid = cookies.find((c) => c.name === 'JSESSIONID')?.value;
    const cfClearance = cookies.find((c) => c.name === 'cf_clearance')?.value;

    if (!jsessionid) {
      throw new Error('Não foi possível autenticar no Paxtu (Antigo). Verifique seu usuário e senha.');
    }

    const cookieParts = [`JSESSIONID=${jsessionid}`];
    if (cfClearance) cookieParts.push(`cf_clearance=${cfClearance}`);
    return cookieParts.join('; ');
  } finally {
    await browser.close();
  }
}
