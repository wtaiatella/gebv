import { chromium } from 'playwright';

const PAXTU_LOGIN_URL = 'https://paxtu100.escoteiros.org.br/login';

export async function loginPaxtu(user: string, pass: string): Promise<string> {
  if (!user || !pass) {
    throw new Error('Usuário e senha são obrigatórios.');
  }

  // No servidor Linux (Linode) ou ambiente local, roda com proteções anti-bot
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    await page.goto(PAXTU_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Espera pelo formulário de login do Keycloak
    const usernameInput = await page
      .waitForSelector('input[name="username"], #username', { timeout: 15000 })
      .catch(() => null);

    if (!usernameInput) {
      const pageTitle = await page.title().catch(() => '');
      const content = await page.content().catch(() => '');
      if (content.includes('cf-challenge') || content.includes('turnstile')) {
        throw new Error('Verificação de segurança (Cloudflare) detectada no Paxtu. Tente novamente em instantes.');
      }
      throw new Error(`Não foi possível carregar a página de login do Paxtu (Título: "${pageTitle || 'sem título'}").`);
    }

    await page.fill('input[name="username"], #username', user);
    await page.fill('input[name="password"], #password', pass);

    await page.click('input[type="submit"], #kc-login, button[type="submit"]');

    // Monitora o resultado da autenticação via corrida entre redirecionamento e erros
    const outcome = await Promise.race([
      // 1. Sucesso: Redirecionamento de volta ao Paxtu 100 (concluiu fluxo OAuth/Keycloak)
      page
        .waitForURL(
          (url) =>
            url.hostname === 'paxtu100.escoteiros.org.br' &&
            !url.pathname.includes('/login') &&
            !url.pathname.includes('/auth/keycloak/callback'),
          { timeout: 20000 }
        )
        .then(() => 'SUCCESS' as const),

      // 2. Erro de autenticação explícito no Keycloak (ex: credenciais inválidas)
      page
        .waitForSelector('#input-error, .alert-error, .kc-feedback-text, .alert-danger', { timeout: 15000 })
        .then(() => 'KEYCLOAK_ERROR' as const),

      // 3. Prompt de 2FA / OTP
      page
        .waitForSelector('input[name="otp"], input[name="totp"], #otp', { timeout: 15000 })
        .then(() => 'OTP_REQUIRED' as const),

      // 4. Exigência de troca de senha
      page
        .waitForSelector('#password-new, input[name="password-new"]', { timeout: 15000 })
        .then(() => 'PASSWORD_CHANGE_REQUIRED' as const),

      // 5. Termos de uso
      page
        .waitForSelector('#kc-terms-accept, #kc-accept', { timeout: 15000 })
        .then(() => 'TERMS_REQUIRED' as const),
    ]).catch((err) => {
      console.warn('[PaxtuAuth] Timeout na corrida de navegação:', err.message);
      return 'TIMEOUT' as const;
    });

    if (outcome === 'KEYCLOAK_ERROR') {
      const errorMsg = await page
        .$eval('#input-error, .alert-error, .kc-feedback-text, .alert-danger', (el) => el.textContent?.trim())
        .catch(() => null);
      throw new Error(errorMsg || 'Nome de usuário ou senha inválida no Paxtu 100.');
    }

    if (outcome === 'OTP_REQUIRED') {
      throw new Error('Autenticação em duas etapas (2FA/OTP) requerida. Autentique-se primeiro no navegador do Meu Paxtu.');
    }

    if (outcome === 'PASSWORD_CHANGE_REQUIRED') {
      throw new Error('O Paxtu 100 exige alteração de senha da sua conta. Acesse https://login.escoteiros.org.br para atualizar.');
    }

    if (outcome === 'TERMS_REQUIRED') {
      throw new Error('É necessário aceitar novos termos de uso do Paxtu. Acesse o Meu Paxtu no navegador para aceitá-los.');
    }

    // Se a URL final ainda estiver no Keycloak, a autenticação definitivamente falhou
    if (page.url().includes('login.escoteiros.org.br')) {
      const feedback = await page
        .$eval('#input-error, .alert-error, .kc-feedback-text, .alert-danger, .pf-c-form__helper-text', (el) =>
          el.textContent?.trim()
        )
        .catch(() => null);
      throw new Error(feedback || 'Falha na autenticação do Paxtu 100. Verifique seu usuário e senha.');
    }

    // Aguarda o Paxtu gravar os cookies da sessão após o retorno do callback
    await page.waitForTimeout(1000);

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'paxtu100_session')?.value;
    const xsrfToken = cookies.find((c) => c.name === 'XSRF-TOKEN')?.value;
    const cfClearance = cookies.find((c) => c.name === 'cf_clearance')?.value;

    if (!sessionCookie) {
      throw new Error('Sessão não identificada após autenticação no Paxtu 100.');
    }

    const cookieParts: string[] = [];
    if (xsrfToken) cookieParts.push(`XSRF-TOKEN=${xsrfToken}`);
    cookieParts.push(`paxtu100_session=${sessionCookie}`);
    if (cfClearance) cookieParts.push(`cf_clearance=${cfClearance}`);

    const finalCookie = cookieParts.join('; ');

    // Validação ativa da sessão: testa uma requisição rápida para confirmar que está autenticado de fato
    const testRes = await fetch('https://paxtu100.escoteiros.org.br/associado/lista', {
      headers: {
        cookie: finalCookie,
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        accept: 'text/html',
      },
      redirect: 'manual',
    });

    if (testRes.status === 302 || testRes.status === 401) {
      const loc = testRes.headers.get('location') || '';
      if (loc.includes('/login') || loc.includes('keycloak')) {
        throw new Error('A sessão gerada não foi aceita pelo Paxtu 100. Verifique se seu usuário tem acesso à seção.');
      }
    }

    return finalCookie;
  } finally {
    await browser.close();
  }
}

