import { readFile, writeFile, mkdir, copyFile, readdir, stat } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { loginPaxtu } from '../app/lib/paxtu/auth';
import { parseAssociadosFromHtml } from '../app/lib/paxtu/client';

dotenv.config();

const BASE_URL = 'https://paxtu100.escoteiros.org.br';
const ROOT_RAW_DIR = path.resolve(process.cwd(), 'data', 'raw');

const RAMOS_CONFIG = [
  { folder: 'alcateia', branchId: 2, label: 'Lobinho (Alcateia)' },
  { folder: 'escoteiros', branchId: 1, label: 'Escoteiro (Tropa Escoteira)' },
  { folder: 'senior', branchId: 3, label: 'Sênior (Tropa Sênior)' },
  { folder: 'pioneiros', branchId: 4, label: 'Pioneiro (Clã Pioneiro)' },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(text) {
  return (text || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getHeaders(cookie, extraHeaders = {}) {
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

let currentCookie = process.env.PAXTU_COOKIE || '';
let currentCsrf = '';

async function ensureValidCookie(forceRefresh = false) {
  if (!forceRefresh && currentCookie) {
    try {
      const res = await fetch(`${BASE_URL}/atualizacoes/ultima`, {
        headers: getHeaders(currentCookie),
      });
      const text = await res.text();
      if (res.ok && !text.includes('login') && !text.includes('Keycloak')) {
        return currentCookie;
      }
    } catch {
      // Falha ao testar, força login
    }
  }

  console.log('🔄 Autenticando no Paxtu 100 com credenciais do .env via Playwright...');
  const user = process.env.user;
  const pass = process.env.senha;
  if (!user || !pass) {
    throw new Error('user ou senha não encontrados no .env');
  }

  currentCookie = await loginPaxtu(user.trim(), pass.trim());
  console.log('✓ Autenticado com sucesso! Novo cookie de sessão obtido.');

  // Atualiza arquivo .env
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = await readFile(envPath, 'utf-8').catch(() => '');
    const line = `PAXTU_COOKIE="${currentCookie}"`;
    if (/^PAXTU_COOKIE=/m.test(envContent)) {
      envContent = envContent.replace(/^PAXTU_COOKIE=.*$/m, line);
    } else {
      envContent = envContent.trimEnd() + '\n' + line + '\n';
    }
    await writeFile(envPath, envContent, 'utf-8');
  } catch (err) {
    console.warn('Aviso ao salvar .env:', err.message);
  }

  currentCsrf = await fetchCsrfToken(currentCookie);
  return currentCookie;
}

async function fetchCsrfToken(cookie) {
  const res = await fetch(`${BASE_URL}/associado/lista`, {
    headers: getHeaders(cookie, { accept: 'text/html' }),
  });
  const html = await res.text();
  const match = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  if (match) return match[1];
  throw new Error('Não foi possível obter o token CSRF.');
}

async function safeFetch(url, options = {}) {
  let retries = 3;
  while (retries > 0) {
    try {
      const cookie = await ensureValidCookie();
      const headers = getHeaders(cookie, options.headers || {});
      const res = await fetch(url, { ...options, headers });

      if (res.status === 401 || res.status === 419 || res.url.includes('/login') || res.url.includes('keycloak')) {
        console.warn(`! Sessão expirada em ${url}. Renovando credenciais...`);
        await ensureValidCookie(true);
        retries--;
        await sleep(1000);
        continue;
      }

      return res;
    } catch (err) {
      console.warn(`! Erro na requisição para ${url}: ${err.message}. Retentando...`);
      retries--;
      await sleep(1000);
    }
  }
  return null;
}

/**
 * 1. Busca todos os associados do GEBV
 */
async function fetchAllAssociadosList() {
  console.log('\n--- 1. Carregando lista completa de associados do Paxtu 100 ---');
  let page = 1;
  const todos = [];
  const seen = new Set();

  while (true) {
    const url = `${BASE_URL}/associado/associado/lista/carregar?page=${page}&status=S`;
    const res = await safeFetch(url);
    if (!res || !res.ok) break;

    const json = await res.json().catch(() => null);
    if (!json || !json.html) break;

    const items = parseAssociadosFromHtml(json.html);
    if (items.length === 0) break;

    for (const item of items) {
      if (!seen.has(item.cd_associado)) {
        seen.add(item.cd_associado);
        todos.push(item);
      }
    }

    if (!json.pagination || (!json.pagination.includes(`page=${page + 1}`) && !json.pagination.includes('rel="next"'))) {
      break;
    }
    page++;
    await sleep(80);
  }

  console.log(`✓ Total de associados ativos encontrados: ${todos.length}`);
  return todos;
}

/**
 * 2. Extrai dados brutos de um único jovem
 */
async function extrairJovemRaw(jovem, branchConfig, pastaRamoDir) {
  const cdAssociado = jovem.cd_associado;
  const nrRegistro = (jovem.nr_registro || '').replace(/\D/g, '') || cdAssociado;
  const nmAssociado = jovem.nm_associado || `Associado ${cdAssociado}`;
  const slugNome = slugify(nmAssociado);
  const pastaJovem = `${nrRegistro}-${slugNome}`;
  const jovemDir = path.join(pastaRamoDir, pastaJovem);
  const espDir = path.join(jovemDir, 'especialidades');
  const ativDir = path.join(jovemDir, 'atividades');

  await mkdir(jovemDir, { recursive: true });
  await mkdir(espDir, { recursive: true });
  await mkdir(ativDir, { recursive: true });

  const manifest = {
    nr_registro: nrRegistro,
    cd_associado: cdAssociado,
    nm_associado: nmAssociado,
    ds_ramo: branchConfig.label,
    branch_id: branchConfig.branchId,
    data_extracao: new Date().toISOString(),
    arquivos_extraidos: [],
  };

  async function saveFile(relPath, content, url, status, isJson = true, extraMeta = {}) {
    const fullPath = path.join(jovemDir, relPath);
    await writeFile(fullPath, content, 'utf-8');
    const bytes = Buffer.byteLength(content, 'utf-8');
    manifest.arquivos_extraidos.push({
      arquivo: relPath,
      url,
      status,
      tamanho_bytes: bytes,
      is_json: isJson,
      ...extraMeta,
    });
    return bytes;
  }

  // A. Atualizações última
  const atzUrl = `${BASE_URL}/atualizacoes/ultima`;
  const atzRes = await safeFetch(atzUrl);
  if (atzRes && atzRes.ok) {
    const text = await atzRes.text();
    await saveFile('01-atualizacoes-ultima.json', text, atzUrl, atzRes.status, true);
  }

  // B. Sincronizar retroativo
  const sincUrl = `${BASE_URL}/associado/associado/progressoes/sincronizar-retroativo`;
  if (!currentCsrf) currentCsrf = await fetchCsrfToken(currentCookie);
  const sincRes = await safeFetch(sincUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-csrf-token': currentCsrf,
    },
    body: new URLSearchParams({ associate_code: cdAssociado }).toString(),
  });
  if (sincRes) {
    const text = await sincRes.text();
    await saveFile('02-sincronizar-retroativo.json', text, sincUrl, sincRes.status, true);
  }

  // C. Competences show (Árvore de competências e caminhos do ramo)
  const compUrl = `${BASE_URL}/associado/associado/progressoes/competences/show?associate_code=${cdAssociado}&branch=${branchConfig.branchId}`;
  const compRes = await safeFetch(compUrl);
  let compJson = [];
  if (compRes && compRes.ok) {
    const text = await compRes.text();
    try {
      compJson = JSON.parse(text);
    } catch {}
    await saveFile(
      `03-competences-show-branch-${branchConfig.branchId}.json`,
      text,
      compUrl,
      compRes.status,
      true
    );
  }

  // D. Atividades por caminho do ramo
  const caminhosToFetch = new Set();
  if (Array.isArray(compJson)) {
    for (const c of compJson) {
      if (c.id && String(c.id).startsWith('caminho_')) {
        caminhosToFetch.add(String(c.id));
      }
    }
  }

  // Fallbacks padrão de cada ramo se não vier na árvore
  if (branchConfig.branchId === 2) {
    ['caminho_1', 'caminho_2', 'caminho_3'].forEach((c) => caminhosToFetch.add(c));
  } else if (branchConfig.branchId === 1) {
    ['caminho_4', 'caminho_5', 'caminho_6'].forEach((c) => caminhosToFetch.add(c));
  } else if (branchConfig.branchId === 3) {
    ['caminho_7', 'caminho_8', 'caminho_9', 'caminho_10', 'caminho_11'].forEach((c) => caminhosToFetch.add(c));
  } else if (branchConfig.branchId === 4) {
    ['caminho_15', 'caminho_16'].forEach((c) => caminhosToFetch.add(c));
  }

  for (const cId of caminhosToFetch) {
    const actUrl = `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${cdAssociado}&competence_id=${cId}`;
    const actRes = await safeFetch(actUrl);
    if (actRes && actRes.ok) {
      const text = await actRes.text();
      await saveFile(`atividades/activities-${cId}.json`, text, actUrl, actRes.status, true);
    }
    await sleep(60);
  }

  // E. Perfil da associada (HTML completo)
  const perfilUrl = `${BASE_URL}/associado/perfil`;
  if (!currentCsrf) currentCsrf = await fetchCsrfToken(currentCookie);
  const perfilRes = await safeFetch(perfilUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-csrf-token': currentCsrf,
      accept: 'text/html',
    },
    body: new URLSearchParams({
      associate_code: cdAssociado,
      _token: currentCsrf,
    }),
  });

  let perfilHtml = '';
  if (perfilRes && perfilRes.ok) {
    perfilHtml = await perfilRes.text();
    await saveFile('08-perfil.html', perfilHtml, perfilUrl, perfilRes.status, false);
  }

  // F. Especialidades
  const specialtyCards = [
    ...perfilHtml.matchAll(/class="[^"]*specialty-card[^"]*"[^>]*data-specialty-id="(\d+)"/g),
  ];
  const specialtyIds = [...new Set(specialtyCards.map((m) => Number(m[1])))].filter(
    (id) => !isNaN(id) && id > 0
  ).sort((a, b) => a - b);

  const todasEsps = [];
  for (const espId of specialtyIds) {
    const espUrl = `${BASE_URL}/associado/associado/progressoes/especialidades/${espId}/${cdAssociado}`;
    const espRes = await safeFetch(espUrl);
    if (espRes && espRes.ok) {
      const text = await espRes.text();
      try {
        const parsed = JSON.parse(text);
        todasEsps.push(parsed);
        const slugEsp = slugify(parsed.ds_especialidade);
        const espFileName = `especialidades/esp-${espId}-${slugEsp}.json`;
        await saveFile(espFileName, JSON.stringify(parsed, null, 2), espUrl, espRes.status, true, {
          cd_especialidade: espId,
          ds_especialidade: parsed.ds_especialidade,
          nr_nivel: parsed.nr_nivel,
        });
      } catch (err) {
        console.warn(`! Erro JSON na especialidade ${espId} para ${nmAssociado}:`, err.message);
      }
    }
    await sleep(60);
  }

  // Consolidado de especialidades
  const consolidadoContent = JSON.stringify(todasEsps, null, 2);
  await saveFile('08-especialidades.json', consolidadoContent, 'local', 200, true, {
    total_especialidades: todasEsps.length,
  });

  // G. Conquistas e Insígnias
  const branchNames = {
    '1': 'Escoteiro',
    '2': 'Lobinho',
    '3': 'Sênior',
    '4': 'Pioneiro',
    '5': 'Filhote',
    '9': 'Escotista',
  };
  const achRegex = /<div[^>]*class="[^"]*achievement-card[^"]*"[^>]*data-branch="([^"]*)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  const achMatches = [...perfilHtml.matchAll(achRegex)];
  const conquistas = [];

  for (const m of achMatches) {
    const bId = m[1];
    const block = m[2];
    const imgMatch = block.match(/<img[^>]*src="([^"]+)"/);
    const titleMatch = block.match(/<p class="h6 mb-2 fw-bold">\s*([^<]+)<\/p>/);
    const dateMatch = block.match(/<p class="h6">\s*([^<]+)<\/p>/);
    conquistas.push({
      titulo: titleMatch ? titleMatch[1].trim() : '',
      data_conquista: dateMatch ? dateMatch[1].trim() : '',
      branch_id: bId,
      ramo: branchNames[bId] || `Ramo ${bId}`,
      imagem_url: imgMatch ? imgMatch[1] : '',
    });
  }

  const conquistasContent = JSON.stringify(conquistas, null, 2);
  await saveFile('09-conquistas.json', conquistasContent, 'local', 200, true, {
    total_conquistas: conquistas.length,
  });

  // Salva manifesto final
  manifest.total_arquivos = manifest.arquivos_extraidos.length;
  manifest.total_especialidades = todasEsps.length;
  manifest.total_conquistas = conquistas.length;
  await writeFile(
    path.join(jovemDir, '00-extracao-info.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );

  return {
    pasta: pastaJovem,
    especialidades: todasEsps.length,
    conquistas: conquistas.length,
    arquivos: manifest.total_arquivos,
  };
}

async function main() {
  console.log(`================================================================`);
  console.log(`=== EXTRAÇÃO EM MASSA DE DADOS BRUTOS (ALCATEIA, ESCOTEIROS, SENIOR) ===`);
  console.log(`Destino: ${ROOT_RAW_DIR}`);
  console.log(`================================================================\n`);

  await mkdir(ROOT_RAW_DIR, { recursive: true });
  for (const r of RAMOS_CONFIG) {
    await mkdir(path.join(ROOT_RAW_DIR, r.folder), { recursive: true });
  }

  // Inicializa sessão
  await ensureValidCookie();
  currentCsrf = await fetchCsrfToken(currentCookie);

  // 1. Obter lista completa de associados
  const todosAssociados = await fetchAllAssociadosList();

  // Mapeia associados por ramo
  const associadosPorRamo = {
    alcateia: [],
    escoteiros: [],
    senior: [],
    pioneiros: [],
    outros: [],
  };

  const listaCompletaEnriquecida = [];

  for (const a of todosAssociados) {
    const ramoNormalizado = (a.dsRamo || '').toLowerCase();
    let pasta = 'outros';
    let branchId = null;

    if (ramoNormalizado.includes('lobinho') || ramoNormalizado.includes('alcateia')) {
      pasta = 'alcateia';
      branchId = 2;
    } else if (ramoNormalizado.includes('escoteir')) {
      pasta = 'escoteiros';
      branchId = 1;
    } else if (ramoNormalizado.includes('senior') || ramoNormalizado.includes('sênior')) {
      pasta = 'senior';
      branchId = 3;
    } else if (ramoNormalizado.includes('pioneir')) {
      pasta = 'pioneiros';
      branchId = 4;
    }

    const itemEnriquecido = {
      ...a,
      slug_nome: slugify(a.nm_associado),
      branch_id: branchId,
      pasta_ramo: pasta,
    };

    listaCompletaEnriquecida.push(itemEnriquecido);

    if (associadosPorRamo[pasta]) {
      associadosPorRamo[pasta].push(itemEnriquecido);
    } else {
      associadosPorRamo.outros.push(itemEnriquecido);
    }
  }

  // 2. Salva associados.json na raiz de data/raw/
  const associadosJsonPath = path.join(ROOT_RAW_DIR, 'associados.json');
  const associadosResumo = {
    data_extracao: new Date().toISOString(),
    total_geral: listaCompletaEnriquecida.length,
    contagem_por_ramo: {
      alcateia: associadosPorRamo.alcateia.length,
      escoteiros: associadosPorRamo.escoteiros.length,
      senior: associadosPorRamo.senior.length,
      outros: associadosPorRamo.outros.length,
    },
    associados: listaCompletaEnriquecida,
  };

  await writeFile(associadosJsonPath, JSON.stringify(associadosResumo, null, 2), 'utf-8');
  console.log(`\n✓ Arquivo ${associadosJsonPath} salvo com sucesso!`);
  console.log(`  - Alcateia (Lobinhos): ${associadosPorRamo.alcateia.length}`);
  console.log(`  - Escoteiros:          ${associadosPorRamo.escoteiros.length}`);
  console.log(`  - Sênior:              ${associadosPorRamo.senior.length}`);
  console.log(`  - Outros / Adultos:    ${associadosPorRamo.outros.length}`);

  // Se a pasta avulsa da Antonia existir na raiz de data/raw, move para escoteiros
  const antoniaOldDir = path.join(ROOT_RAW_DIR, '1343627-antonia-sofia-hendler-thiesen');
  const antoniaNewDir = path.join(ROOT_RAW_DIR, 'escoteiros', '1343627-antonia-sofia-hendler-thiesen');
  if (fs.existsSync(antoniaOldDir) && !fs.existsSync(antoniaNewDir)) {
    console.log(`\n→ Movendo dados existentes da Antônia para data/raw/escoteiros/...`);
    await fs.promises.rename(antoniaOldDir, antoniaNewDir);
  }

  // 3. Processa cada ramo específico
  for (const branchConfig of RAMOS_CONFIG) {
    const jovensDoRamo = associadosPorRamo[branchConfig.folder] || [];
    const pastaRamoDir = path.join(ROOT_RAW_DIR, branchConfig.folder);

    console.log(`\n================================================================`);
    console.log(`>>> Extraindo Ramo: ${branchConfig.label.toUpperCase()} (${jovensDoRamo.length} jovens)`);
    console.log(`>>> Pasta: ${pastaRamoDir}`);
    console.log(`================================================================`);

    for (let i = 0; i < jovensDoRamo.length; i++) {
      const jovem = jovensDoRamo[i];
      const prefix = `[${branchConfig.folder} ${i + 1}/${jovensDoRamo.length}]`;
      const nrReg = (jovem.nr_registro || '').replace(/\D/g, '') || jovem.cd_associado;
      console.log(`\n${prefix} ${jovem.nm_associado} (Reg: ${nrReg}, Código: ${jovem.cd_associado})...`);

      try {
        const res = await extrairJovemRaw(jovem, branchConfig, pastaRamoDir);
        console.log(
          `   ✓ Sucesso! ${res.arquivos} arquivos salvos (${res.especialidades} especialidades, ${res.conquistas} conquistas).`
        );
      } catch (err) {
        console.error(`   ✗ Falha ao extrair ${jovem.nm_associado}:`, err.message);
      }

      await sleep(150);
    }
  }

  console.log(`\n================================================================`);
  console.log(`★ EXTRAÇÃO COMPLETA FINALIZADA COM SUCESSO!`);
  console.log(`- Base de dados: ${ROOT_RAW_DIR}/associados.json`);
  console.log(`- Pastas preenchidas:`);
  console.log(`  • ${ROOT_RAW_DIR}/alcateia/ (${associadosPorRamo.alcateia.length} jovens)`);
  console.log(`  • ${ROOT_RAW_DIR}/escoteiros/ (${associadosPorRamo.escoteiros.length} jovens)`);
  console.log(`  • ${ROOT_RAW_DIR}/senior/ (${associadosPorRamo.senior.length} jovens)`);
  console.log(`================================================================\n`);
}

main().catch((err) => {
  console.error('\n❌ Erro fatal na extração em massa:', err);
  process.exit(1);
});
