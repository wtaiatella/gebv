import { chromium } from 'playwright';

const PAXTU_LOGIN_URL = 'https://paxtu100.escoteiros.org.br/login';

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
    await page.goto(PAXTU_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Keycloak login selectors
    const usernameInput = await page.waitForSelector('input[name="username"], #username', { timeout: 30000 }).catch(() => null);
    if (usernameInput) {
      await page.fill('input[name="username"], #username', user);
      await page.fill('input[name="password"], #password', pass);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}),
        page.click('input[type="submit"], #kc-login, button[type="submit"]'),
      ]);

      await page.waitForTimeout(2000);
    }

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'paxtu100_session')?.value;
    const xsrfToken = cookies.find((c) => c.name === 'XSRF-TOKEN')?.value;
    const cfClearance = cookies.find((c) => c.name === 'cf_clearance')?.value;

    if (!sessionCookie) {
      throw new Error('Não foi possível autenticar no Paxtu 100. Verifique seu usuário e senha.');
    }

    const cookieParts: string[] = [];
    if (xsrfToken) cookieParts.push(`XSRF-TOKEN=${xsrfToken}`);
    cookieParts.push(`paxtu100_session=${sessionCookie}`);
    if (cfClearance) cookieParts.push(`cf_clearance=${cfClearance}`);

    return cookieParts.join('; ');
  } finally {
    await browser.close();
  }
}

