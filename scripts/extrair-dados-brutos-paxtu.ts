import { loginPaxtu } from '../app/lib/paxtu/auth';
import { getCsrfToken } from '../app/lib/paxtu/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = 'https://paxtu100.escoteiros.org.br';
const NR_REGISTRO = '1343627';
const CD_ASSOCIADO = '1035437';
const NM_ASSOCIADO = 'Antonia Sofia Hendler Thiesen';

const TARGET_DIR = path.resolve(
  '/Users/wagnertaiatella/repos/beacon-gebv/docs/specs/2026-09-15-especialidades/paxtu100-bruto/1343627-antonia'
);

function getHeaders(cookie: string, extraHeaders: Record<string, string> = {}): HeadersInit {
  return {
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    cookie,
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'x-requested-with': 'XMLHttpRequest',
    referer: `${BASE_URL}/associado/lista`,
    ...extraHeaders,
  };
}

async function main() {
  console.log(`=== Extração de Dados Brutos do Paxtu100 ===`);
  console.log(`Associada: ${NM_ASSOCIADO} (UEB: ${NR_REGISTRO}, cd_associado: ${CD_ASSOCIADO})`);
  console.log(`Destino: ${TARGET_DIR}`);

  await fs.mkdir(TARGET_DIR, { recursive: true });
  await fs.mkdir(path.join(TARGET_DIR, 'atividades'), { recursive: true });
  await fs.mkdir(path.join(TARGET_DIR, 'especialidades'), { recursive: true });

  const user = process.env.user;
  const pass = process.env.senha;
  if (!user || !pass) {
    throw new Error('user ou senha não encontrados no .env');
  }

  console.log('1. Autenticando no Paxtu 100 via Playwright...');
  const cookie = await loginPaxtu(user.trim(), pass.trim());
  console.log('✓ Autenticado com sucesso! Cookie obtido.');

  // Atualiza .env
  try {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = await fs.readFile(envPath, 'utf-8').catch(() => '');
    const line = `PAXTU_COOKIE="${cookie}"`;
    if (/^PAXTU_COOKIE=/m.test(envContent)) {
      envContent = envContent.replace(/^PAXTU_COOKIE=.*$/m, line);
    } else {
      envContent = envContent.trimEnd() + '\n' + line + '\n';
    }
    await fs.writeFile(envPath, envContent);
    console.log('✓ PAXTU_COOKIE atualizado no .env');
  } catch (err: any) {
    console.warn('Aviso ao salvar .env:', err.message);
  }

  const manifest: any = {
    nr_registro: NR_REGISTRO,
    cd_associado: CD_ASSOCIADO,
    nm_associado: NM_ASSOCIADO,
    data_extracao: new Date().toISOString(),
    arquivos_extraidos: [],
  };

  async function fetchAndSave(
    relativePath: string,
    url: string,
    options: {
      method?: string;
      body?: any;
      headers?: Record<string, string>;
      isJson?: boolean;
    } = {}
  ) {
    const method = options.method || 'GET';
    const isJson = options.isJson !== false;
    console.log(`→ [${method}] ${url}`);

    try {
      const res = await fetch(url, {
        method,
        headers: getHeaders(cookie, options.headers),
        body: options.body,
      });

      const fullPath = path.join(TARGET_DIR, relativePath);
      let content = '';
      let parsedJson: any = null;

      if (isJson) {
        try {
          parsedJson = await res.json();
          content = JSON.stringify(parsedJson, null, 2);
        } catch {
          content = await res.text();
        }
      } else {
        content = await res.text();
      }

      await fs.writeFile(fullPath, content, 'utf-8');
      const stat = await fs.stat(fullPath);

      manifest.arquivos_extraidos.push({
        arquivo: relativePath,
        url,
        metodo: method,
        status: res.status,
        tamanho_bytes: stat.size,
        is_json: isJson,
      });

      console.log(`  ✓ Salvo em ${relativePath} (${stat.size} bytes, status ${res.status})`);
      return { status: res.status, json: parsedJson, text: content };
    } catch (err: any) {
      console.error(`  ✗ Erro ao buscar ${url}:`, err.message);
      manifest.arquivos_extraidos.push({
        arquivo: relativePath,
        url,
        metodo: method,
        status: 'ERROR',
        error: err.message,
      });
      return null;
    }
  }

  // 1. Atualizações última
  await fetchAndSave('01-atualizacoes-ultima.json', `${BASE_URL}/atualizacoes/ultima`);

  // 2. CSRF Token & Lista
  const csrfToken = await getCsrfToken(cookie);
  console.log('✓ Token CSRF obtido:', csrfToken);

  // 3. Perfil da associada (HTML com os cards de especialidades)
  const perfilRes = await fetchAndSave('02-perfil-antonia.html', `${BASE_URL}/associado/perfil`, {
    method: 'POST',
    isJson: false,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-csrf-token': csrfToken,
      accept: 'text/html',
    },
    body: new URLSearchParams({
      associate_code: CD_ASSOCIADO,
      _token: csrfToken,
    }),
  });

  // 4. Sincronizar retroativo
  await fetchAndSave(
    '03-sincronizar-retroativo.json',
    `${BASE_URL}/associado/associado/progressoes/sincronizar-retroativo`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-csrf-token': csrfToken,
      },
      body: new URLSearchParams({
        associate_code: CD_ASSOCIADO,
        _token: csrfToken,
      }),
    }
  );

  // 5. Competences show (Ramo Escoteiro = branch 1)
  const compRes = await fetchAndSave(
    '04-competences-show-branch-1.json',
    `${BASE_URL}/associado/associado/progressoes/competences/show?associate_code=${CD_ASSOCIADO}&branch=1`
  );

  // 6. Atividades por caminho ou competência
  const activitiesToFetch: string[] = ['caminho_4', 'caminho_5', 'caminho_6'];
  if (compRes?.json?.competences) {
    for (const c of compRes.json.competences) {
      if (c.id && !activitiesToFetch.includes(String(c.id))) {
        activitiesToFetch.push(String(c.id));
      }
    }
  }

  for (const actId of activitiesToFetch) {
    await fetchAndSave(
      `atividades/activities-${actId}.json`,
      `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${CD_ASSOCIADO}&competence_id=${actId}`
    );
  }

  // 7. Especialidades a partir do perfil
  const specialtyIds = new Set<number>();
  if (perfilRes?.text) {
    const matches = perfilRes.text.matchAll(/class="[^"]*specialty-card[^"]*"[^>]*data-specialty-id="(\d+)"/g);
    for (const m of matches) {
      const id = parseInt(m[1], 10);
      if (id > 0) specialtyIds.add(id);
    }
  }
  console.log(`✓ Encontradas ${specialtyIds.size} especialidades no HTML do perfil.`);

  // Também adicionamos os IDs que já existiam no banco para garantir cobertura máxima
  const dbEsps = [34, 107, 264, 233, 61, 157, 176, 77, 113, 3, 170, 39, 50, 100, 119, 122, 123, 164, 194, 212, 111, 140, 226, 232, 265, 73, 82, 126, 134, 159, 1, 33, 76, 87, 88, 94, 104, 114, 208, 209, 225, 254, 267];
  for (const id of dbEsps) {
    specialtyIds.add(id);
  }
  console.log(`✓ Total acumulado de especialidades a consultar: ${specialtyIds.size}`);

  const sortedIds = Array.from(specialtyIds).sort((a, b) => a - b);
  let countSuccessEsp = 0;

  for (const espId of sortedIds) {
    const res = await fetchAndSave(
      `especialidades/esp-${espId}.json`,
      `${BASE_URL}/associado/associado/progressoes/especialidades/${espId}/${CD_ASSOCIADO}`
    );
    if (res?.json) {
      countSuccessEsp++;
    }
  }

  console.log(`✓ ${countSuccessEsp} especialidades extraídas e salvas.`);

  // Salva o manifesto de extração
  manifest.total_arquivos = manifest.arquivos_extraidos.length;
  manifest.total_especialidades = countSuccessEsp;
  await fs.writeFile(
    path.join(TARGET_DIR, '00-extracao-info.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
  console.log(`✓ Manifesto salvo em 00-extracao-info.json.`);
  console.log(`Extração 100% concluída!`);
}

main().catch((err) => {
  console.error('Falha fatal na extração:', err);
  process.exit(1);
});
