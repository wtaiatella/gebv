import { chromium } from 'playwright';

export async function runScraper() {
  const user = process.env.user;
  const password = process.env.senha;

  if (!user || !password) {
    throw new Error('User or password not found in environment variables');
  }

  console.log('Launching browser (headed for visibility)...');
  const browser = await chromium.launch({ 
    headless: false, // Set to false so you can see it working
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    console.log('Navigating to login page...');
    const loginUrl = 'https://login.escoteiros.org.br/realms/paxtu/protocol/openid-connect/auth?client_id=azimute&redirect_uri=https%3A%2F%2Fpaxtu100.escoteiros.org.br%2Fauth%2Fkeycloak%2Fcallback&scope=openid&response_type=code&state=jS7Oi0pI3ipktDvHl16LLc0CcumOTAovICH8pxpB';
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 60000 });

    await page.fill('#username', user);
    await page.fill('#password', password);
    
    await Promise.all([
      page.waitForURL('**/paxtu100.escoteiros.org.br/**', { timeout: 60000 }),
      page.click('#kc-login'),
    ]);

    console.log('Login successful. Handling popups...');
    await page.waitForTimeout(3000);

    // Dismiss SweetAlert and Cookies
    try {
      const confirmBtn = await page.$('button.swal2-cancel, button:has-text("Agora não"), .swal2-confirm');
      if (confirmBtn) await confirmBtn.click();
      
      const cookieBtn = await page.$('button:has-text("Confirmar")');
      if (cookieBtn) await cookieBtn.click();
    } catch (e) {
      console.log('No popups found.');
    }

    // Step 1: Go directly to Associate List
    console.log('Navigating to Associate List...');
    await page.goto('https://paxtu100.escoteiros.org.br/associado/lista', { waitUntil: 'networkidle' });

    // Step 2: Filter by Categoria = Beneficiário
    console.log('Applying filter: Beneficiário...');
    // We search for the dropdown that contains "Categoria" nearby
    // Based on the screenshot, it's the 3rd dropdown or has a specific ID
    // We'll try to find by the text visible in the dropdown
    await page.waitForSelector('.select2-selection, select', { timeout: 30000 });
    
    // In many modern sites, these are Select2 components
    // If it's a standard select:
    const categorySelect = await page.$('select[name*="categoria"], select');
    if (categorySelect) {
      await page.selectOption('select', { label: 'Beneficiário' });
    } else {
      // If it's a custom dropdown (Select2 style)
      await page.click('span:has-text("Categoria"), .select2-container');
      await page.waitForSelector('.select2-results__option', { timeout: 5000 });
      await page.click('.select2-results__option:has-text("Beneficiário")');
    }

    // Wait for list to update
    await page.waitForTimeout(2000);

    // Step 3: Click "Escoteiro" button for the first person
    console.log('Opening scout profile...');
    await page.waitForSelector('button:has-text("Escoteiro"), .btn-success', { timeout: 30000 });
    await page.click('button:has-text("Escoteiro")');

    // Step 4: Click "Conquistas e certificações" tab
    console.log('Opening Conquistas tab...');
    await page.waitForSelector('#progression-certifications-tab', { timeout: 30000 });
    await page.click('#progression-certifications-tab');

    // Step 5: Expand accordion #collapseProgressao
    console.log('Expanding accordion...');
    await page.waitForSelector('#collapseProgressao', { state: 'attached', timeout: 30000 });
    
    const isExpanded = await page.evaluate(() => {
      const el = document.querySelector('#collapseProgressao');
      return el?.classList.contains('show');
    });
    
    if (!isExpanded) {
      await page.click('[data-bs-target="#collapseProgressao"]');
      await page.waitForTimeout(1000);
    }

    // Step 6: Click competences-button
    console.log('Clicking competences-button...');
    await page.waitForSelector('#competences-button', { timeout: 30000 });
    await page.click('#competences-button');

    // Step 7: Extract data from modal
    console.log('Extracting data from modal...');
    await page.waitForSelector('.modal-content', { visible: true, timeout: 30000 });
    
    const data = await page.evaluate(() => {
      const modalTitle = document.querySelector('.modal-title')?.textContent?.trim();
      const modalBody = document.querySelector('.modal-body');
      
      if (!modalBody) return { error: 'Modal body not found' };

      // Better extraction logic for tables if present
      const rows = Array.from(modalBody.querySelectorAll('tr')).map(tr => {
        return Array.from(tr.querySelectorAll('td, th')).map(td => td.textContent?.trim());
      }).filter(row => row.length > 0);

      const items = Array.from(modalBody.querySelectorAll('p, li, span')).map(el => el.textContent?.trim()).filter(Boolean);
      
      return {
        scoutName: document.querySelector('.text-dark.fs-5.fw-bold')?.textContent?.trim() || 'Unknown',
        title: modalTitle,
        tableData: rows,
        textData: items,
        timestamp: new Date().toISOString()
      };
    });

    console.log('Scrape complete!');
    return data;

  } catch (error: any) {
    console.error('Scraping failed:', error);
    await page.screenshot({ path: 'public/scrape-error.png' });
    throw new Error(`Scraping failed: ${error.message}`);
  } finally {
    await browser.close();
  }
}
