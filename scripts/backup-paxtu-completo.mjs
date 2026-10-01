import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
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

/**
 * Garante sessão válida renovando via Playwright se expirada
 */
async function ensureValidCookie(forceRefresh = false) {
  if (!forceRefresh && currentCookie) {
    try {
      const res = await fetch(`${BASE_URL}/atualizacoes/ultima`, {
        headers: getHeaders(currentCookie),
      });
      const text = await res.text();
      if (res.ok && !text.includes('login-pf') && !text.includes('Entrar em paxtu') && !text.includes('Keycloak')) {
        return currentCookie;
      }
    } catch {
      // Força login se falhar
    }
  }

  console.log('🔄 Autenticação expirada. Executando renovação de login no Paxtu 100...');
  const user = process.env.user;
  const pass = process.env.senha;

  if (!user || !pass) {
    throw new Error('Credenciais user/senha não definidas no .env');
  }

  currentCookie = await loginPaxtu(user.trim(), pass.trim());
  process.env.PAXTU_COOKIE = currentCookie;

  try {
    const envPath = path.join(process.cwd(), '.env');
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
  console.log('✓ Sessão renovada com sucesso!');
  return currentCookie;
}

async function fetchCsrfToken(cookie) {
  const res = await fetch(`${BASE_URL}/associado/lista`, {
    headers: getHeaders(cookie, { accept: 'text/html' }),
  });
  const html = await res.text();
  const match = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  if (match) return match[1];
  throw new Error('Não foi possível obter o token CSRF de /associado/lista.');
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
 * 1. Busca todos os associados ativos do GEBV
 */
async function fetchAllAssociadosList() {
  console.log('\n--- 1. Carregando lista completa de associados ativos do Paxtu 100 ---');
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
 * Extrai dados pessoais de 08-perfil.html usando regex robusto
 */
function parseDadosPessoaisFromHtml(html, jovem) {
  function getAttr(name) {
    // Busca value em input com name ou id
    const reg = new RegExp(`<(?:input|textarea)[^>]+(?:name|id)=["']${name}["'][^>]*value=["']([^"']*)["']`, 'i');
    const m = html.match(reg);
    if (m) return m[1].trim();

    // Caso o value venha antes do name
    const reg2 = new RegExp(`<(?:input|textarea)[^>]+value=["']([^"']*)["'][^>]+(?:name|id)=["']${name}["']`, 'i');
    const m2 = html.match(reg2);
    if (m2) return m2[1].trim();

    return '';
  }

  function getSelect(name) {
    const reg = new RegExp(`select[^>]+name=["']${name}["'][\\s\\S]*?<option[^>]+selected[^>]*>([\\s\\S]*?)<\\/option>`, 'i');
    const m = html.match(reg);
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
  }

  return {
    cd_associado: getAttr('associate-code') || String(jovem.cd_associado),
    nr_registro: getAttr('associate-register-number') || String(jovem.nr_registro || ''),
    nm_associado: getAttr('associate-name') || jovem.nm_associado,
    nm_abreviado: getAttr('associate-short-name'),
    dt_nascimento: getAttr('birthdate') || jovem.dt_nascimento || '',
    ds_sexo: getSelect('gender'),
    ds_cpf: getAttr('cpf-number'),
    ds_rg: getAttr('rg-number'),
    ds_orgao_expedidor: getAttr('dispatcher'),
    ds_nacionalidade: getSelect('country-code') || 'Brasil',
    ds_naturalidade: getAttr('birth-city-name') || getAttr('city-name'),
    ds_endereco: getAttr('address') || jovem.ds_endereco || '',
    nr_endereco: getAttr('address-number') || jovem.nr_residencia || '',
    ds_complemento: getAttr('address-complement') || jovem.ds_complemento || '',
    ds_bairro: getAttr('address-district') || jovem.ds_bairro || '',
    ds_cep: getAttr('postal-code') || jovem.ds_cep || '',
    ds_cidade: getAttr('city-name') || jovem.ds_cidade || 'Florianópolis',
    nm_estado: getSelect('state-code') || jovem.nm_estado || 'SC',
    ds_telefone_cel: getAttr('cellphone') || jovem.ds_telefone_cel || '',
    ds_telefone_res: getAttr('landline-phone') || jovem.ds_telefone_res || '',
    ds_email: getAttr('main-email') || jovem.ds_email || '',
    ds_email_ueb: getAttr('org-email'),
    responsavel_1: {
      nome: getAttr('primary-responsible-name'),
      cpf: getAttr('primary-responsible-cpf'),
      celular: getAttr('primary-responsible-cellphone'),
      email: getAttr('primary-responsible-email'),
    },
    responsavel_2: {
      nome: getAttr('secondary-responsible-name'),
      cpf: getAttr('secondary-responsible-cpf'),
      celular: getAttr('secondary-responsible-cellphone'),
      email: getAttr('secondary-responsible-email'),
    },
    ramo: jovem.dsRamo || '',
    secao: jovem.nr_grupo_regiao || '190/SC',
    dt_ingresso: jovem.ds_ano_ingresso || '',
    dt_validade_registro: jovem.dt_validade || '',
  };
}

/**
 * 2. Extrai dados completos de um jovem gerando as duas visões:
 * - bruto/: arquivos recebidos verbatim da rede
 * - tratado/: JSONs consolidados e limpos
 */
async function extrairJovemCompleto(jovem, branchConfig, pastaRamoDir, opts = {}) {
  const cdAssociado = String(jovem.cd_associado);
  const nrRegistro = (jovem.nr_registro || '').replace(/\D/g, '') || cdAssociado;
  const nmAssociado = jovem.nm_associado || `Associado ${cdAssociado}`;
  const slugNome = slugify(nmAssociado);
  const pastaJovem = `${nrRegistro}-${slugNome}`;
  
  const jovemDir = path.join(pastaRamoDir, pastaJovem);
  const manifestoPath = path.join(jovemDir, '00-manifesto.json');

  if (opts.skipExisting && fs.existsSync(manifestoPath)) {
    try {
      const existing = JSON.parse(await readFile(manifestoPath, 'utf-8'));
      if (existing.totais) {
        console.log(`   ⏩ [Skip] Já extraído anteriormente: ${nmAssociado}`);
        return existing.totais;
      }
    } catch {
      // continua extração se o manifesto estiver ilegível
    }
  }

  const brutoDir = path.join(jovemDir, 'bruto');
  const brutoEspDir = path.join(brutoDir, 'especialidades');
  const brutoAtivDir = path.join(brutoDir, 'atividades');
  const tratadoDir = path.join(jovemDir, 'tratado');

  // Pastas legadas para retrocompatibilidade
  const legadoEspDir = path.join(jovemDir, 'especialidades');
  const legadoAtivDir = path.join(jovemDir, 'atividades');

  await mkdir(jovemDir, { recursive: true });
  await mkdir(brutoDir, { recursive: true });
  await mkdir(brutoEspDir, { recursive: true });
  await mkdir(brutoAtivDir, { recursive: true });
  await mkdir(tratadoDir, { recursive: true });
  await mkdir(legadoEspDir, { recursive: true });
  await mkdir(legadoAtivDir, { recursive: true });

  const manifest = {
    nr_registro: nrRegistro,
    cd_associado: cdAssociado,
    nm_associado: nmAssociado,
    ds_ramo: branchConfig.label,
    branch_id: branchConfig.branchId,
    data_extracao: new Date().toISOString(),
    arquivos_brutos: [],
    arquivos_tratados: [],
  };

  async function saveBruto(relPath, content, url, status) {
    const fullPath = path.join(brutoDir, relPath);
    await writeFile(fullPath, content, 'utf-8');
    const bytes = Buffer.byteLength(content, 'utf-8');
    manifest.arquivos_brutos.push({
      arquivo: `bruto/${relPath}`,
      url,
      status,
      tamanho_bytes: bytes,
    });

    // Salva também na raiz legada para manter compatibilidade
    const legadoPath = path.join(jovemDir, relPath);
    await writeFile(legadoPath, content, 'utf-8').catch(() => {});
    return bytes;
  }

  async function saveTratado(filename, data) {
    const fullPath = path.join(tratadoDir, filename);
    const content = JSON.stringify(data, null, 2);
    await writeFile(fullPath, content, 'utf-8');
    manifest.arquivos_tratados.push({
      arquivo: `tratado/${filename}`,
      tamanho_bytes: Buffer.byteLength(content, 'utf-8'),
    });

    // Se for arquivo chave legado, salva na raiz também
    if (filename === 'especialidades.json') {
      await writeFile(path.join(jovemDir, '08-especialidades.json'), content, 'utf-8').catch(() => {});
    } else if (filename === 'conquistas.json') {
      await writeFile(path.join(jovemDir, '09-conquistas.json'), content, 'utf-8').catch(() => {});
    }
  }

  // --- A. Atualizações última ---
  const atzUrl = `${BASE_URL}/atualizacoes/ultima`;
  const atzRes = await safeFetch(atzUrl);
  if (atzRes && atzRes.ok) {
    const text = await atzRes.text();
    await saveBruto('01-atualizacoes-ultima.json', text, atzUrl, atzRes.status);
  }

  // --- B. Sincronizar retroativo ---
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
    await saveBruto('02-sincronizar-retroativo.json', text, sincUrl, sincRes.status);
  }

  // --- C. Competences show (Árvore de competências) ---
  const compUrl = `${BASE_URL}/associado/associado/progressoes/competences/show?associate_code=${cdAssociado}&branch=${branchConfig.branchId}`;
  const compRes = await safeFetch(compUrl);
  let compJson = [];
  if (compRes && compRes.ok) {
    const text = await compRes.text();
    try {
      compJson = JSON.parse(text);
    } catch {}
    await saveBruto(`03-competences-show-branch-${branchConfig.branchId}.json`, text, compUrl, compRes.status);
  }

  // --- D. Atividades por caminho ---
  const caminhosToFetch = new Set();
  const caminhosNomes = {};
  if (Array.isArray(compJson)) {
    for (const c of compJson) {
      if (c.id && String(c.id).startsWith('caminho_')) {
        caminhosToFetch.add(String(c.id));
        if (c.nome) caminhosNomes[String(c.id)] = c.nome;
      }
      if (c.caminho_id) {
        const cKey = `caminho_${c.caminho_id}`;
        caminhosToFetch.add(cKey);
        if (c.caminho) caminhosNomes[cKey] = c.caminho;
      }
    }
  }

  // Fallbacks seguros de caminhos por ramo
  if (branchConfig.branchId === 2) {
    ['caminho_1', 'caminho_2', 'caminho_3'].forEach((c) => caminhosToFetch.add(c));
  } else if (branchConfig.branchId === 1) {
    ['caminho_4', 'caminho_5', 'caminho_6'].forEach((c) => caminhosToFetch.add(c));
  } else if (branchConfig.branchId === 3) {
    ['caminho_7', 'caminho_8', 'caminho_9', 'caminho_10', 'caminho_11'].forEach((c) => caminhosToFetch.add(c));
  } else if (branchConfig.branchId === 4) {
    ['caminho_15', 'caminho_16'].forEach((c) => caminhosToFetch.add(c));
  }

  const todasAtividadesTratadas = [];
  let totalAtividadesCumpridas = 0;

  for (const cId of caminhosToFetch) {
    const actUrl = `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${cdAssociado}&competence_id=${cId}`;
    const actRes = await safeFetch(actUrl);
    if (actRes && actRes.ok) {
      const text = await actRes.text();
      await saveBruto(`atividades/activities-${cId}.json`, text, actUrl, actRes.status);

      try {
        const actData = JSON.parse(text);
        const lista = Array.isArray(actData) ? actData : actData.activities || [];
        const itensTratados = lista.map((a) => {
          if (a.concluida) totalAtividadesCumpridas++;
          return {
            id: a.id,
            codigo: a.codigo || a.id,
            descricao: a.descricao || a.ds_atividade || '',
            concluida: Boolean(a.concluida),
            data_conclusao: a.data_conclusao || null,
            status_escotista: a.status_escotista || null,
          };
        });

        todasAtividadesTratadas.push({
          caminho_id: cId,
          nm_caminho: caminhosNomes[cId] || cId,
          total_itens: itensTratados.length,
          itens_concluidos: itensTratados.filter((i) => i.concluida).length,
          atividades: itensTratados,
        });
      } catch {}
    }
    await sleep(60);
  }

  // Salva tratado de atividades de progressão
  await saveTratado('progressoes-atividades.json', {
    cd_associado: cdAssociado,
    nr_registro: nrRegistro,
    nm_associado: nmAssociado,
    ds_ramo: branchConfig.label,
    total_atividades_cumpridas: totalAtividadesCumpridas,
    caminhos: todasAtividadesTratadas,
  });

  // --- E. Perfil completo (HTML) ---
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
    await saveBruto('08-perfil.html', perfilHtml, perfilUrl, perfilRes.status);

    // Gera tratado de dados pessoais
    const dadosPessoais = parseDadosPessoaisFromHtml(perfilHtml, jovem);
    await saveTratado('dados-pessoais.json', dadosPessoais);
  }

  // --- F. Especialidades ---
  const specialtyCards = [
    ...perfilHtml.matchAll(/class="[^"]*specialty-card[^"]*"[^>]*data-specialty-id="(\d+)"/g),
  ];
  const specialtyIds = [...new Set(specialtyCards.map((m) => Number(m[1])))].filter(
    (id) => !isNaN(id) && id > 0
  ).sort((a, b) => a - b);

  const todasEspsTratadas = [];
  for (const espId of specialtyIds) {
    const espUrl = `${BASE_URL}/associado/associado/progressoes/especialidades/${espId}/${cdAssociado}`;
    const espRes = await safeFetch(espUrl);
    if (espRes && espRes.ok) {
      const text = await espRes.text();
      try {
        const parsed = JSON.parse(text);
        const slugEsp = slugify(parsed.ds_especialidade);
        await saveBruto(`especialidades/esp-${espId}-${slugEsp}.json`, text, espUrl, espRes.status);

        // Tratamento da especialidade e seus itens
        const itensMap = parsed.itens || {};
        const itensLista = Object.values(itensMap).map((it) => ({
          cd_item: it.cd_item,
          ds_item: it.ds_item,
          concluido: Boolean(it.dt_item),
          dt_item: it.dt_item || null,
        }));

        const conquistados = itensLista.filter((i) => i.concluido).length;

        todasEspsTratadas.push({
          cd_especialidade: parsed.cd_especialidade || espId,
          ds_especialidade: parsed.ds_especialidade || '',
          nr_nivel: parsed.nr_nivel || 0,
          dt_nivel: parsed.dt_nivel || null,
          fl_iniciado: Boolean(parsed.fl_iniciado),
          total_itens: itensLista.length,
          itens_conquistados: conquistados,
          itens_pendentes: itensLista.length - conquistados,
          itens: itensLista,
        });
      } catch (err) {
        console.warn(`! Erro JSON na especialidade ${espId} de ${nmAssociado}:`, err.message);
      }
    }
    await sleep(60);
  }

  // Salva tratado de especialidades
  await saveTratado('especialidades.json', todasEspsTratadas);

  // --- G. Conquistas e Insígnias ---
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

  // Salva tratado de conquistas
  await saveTratado('conquistas.json', conquistas);

  // --- H. Manifesto Final ---
  manifest.totais = {
    especialidades: todasEspsTratadas.length,
    especialidades_com_nivel: todasEspsTratadas.filter((e) => e.nr_nivel > 0).length,
    atividades_cumpridas: totalAtividadesCumpridas,
    conquistas: conquistas.length,
    arquivos_brutos_gravados: manifest.arquivos_brutos.length,
    arquivos_tratados_gravados: manifest.arquivos_tratados.length,
  };

  await writeFile(
    path.join(jovemDir, '00-manifesto.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );

  return manifest.totais;
}

/**
 * Função Principal de Extração
 */
async function main() {
  console.log(`================================================================`);
  console.log(`=== BACKUP DEFINITIVO DO PROGRAMA ANTIGO (PAXTU 100 ➔ GEBV) ===`);
  console.log(`Data/Hora: ${new Date().toLocaleString('pt-BR')}`);
  console.log(`Destino: ${ROOT_RAW_DIR}`);
  console.log(`================================================================\n`);

  await mkdir(ROOT_RAW_DIR, { recursive: true });
  for (const r of RAMOS_CONFIG) {
    await mkdir(path.join(ROOT_RAW_DIR, r.folder), { recursive: true });
  }

  // 1. Garante autenticação ativa
  await ensureValidCookie();
  currentCsrf = await fetchCsrfToken(currentCookie);

  // 2. Carrega lista de todos os associados
  const todosAssociados = await fetchAllAssociadosList();

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

  // Salva associados.json atualizado na raiz de raw/
  const associadosJsonPath = path.join(ROOT_RAW_DIR, 'associados.json');
  const associadosResumo = {
    data_extracao: new Date().toISOString(),
    total_geral: listaCompletaEnriquecida.length,
    contagem_por_ramo: {
      alcateia: associadosPorRamo.alcateia.length,
      escoteiros: associadosPorRamo.escoteiros.length,
      senior: associadosPorRamo.senior.length,
      pioneiros: associadosPorRamo.pioneiros.length,
      outros: associadosPorRamo.outros.length,
    },
    associados: listaCompletaEnriquecida,
  };

  await writeFile(associadosJsonPath, JSON.stringify(associadosResumo, null, 2), 'utf-8');
  console.log(`\n✓ Base de dados ${associadosJsonPath} atualizada:`);
  console.log(`  - 🐺 Alcateia (Lobinhos): ${associadosPorRamo.alcateia.length}`);
  console.log(`  - ⚜️ Escoteiros:          ${associadosPorRamo.escoteiros.length}`);
  console.log(`  - 🏔️ Sênior:              ${associadosPorRamo.senior.length}`);
  console.log(`  - 🧭 Pioneiros:           ${associadosPorRamo.pioneiros.length}`);
  console.log(`  - 👥 Outros / Adultos:    ${associadosPorRamo.outros.length}`);

  let grandTotalEsps = 0;
  let grandTotalAtivs = 0;
  let grandTotalConquistas = 0;
  let grandTotalJovens = 0;

  const ramoArg = process.argv.find((arg) => arg.startsWith('--ramo='))?.split('=')[1]?.toLowerCase();
  const onlyPioneiros = process.argv.includes('--pioneiros') || process.argv.includes('--only-pioneiros') || ramoArg === 'pioneiros';
  const skipExisting = process.argv.includes('--skip-existing');

  let ramosParaProcessar = RAMOS_CONFIG;
  if (onlyPioneiros) {
    ramosParaProcessar = RAMOS_CONFIG.filter((r) => r.folder === 'pioneiros');
  } else if (ramoArg) {
    ramosParaProcessar = RAMOS_CONFIG.filter((r) => r.folder === ramoArg || r.label.toLowerCase().includes(ramoArg));
  }

  // 3. Executa a extração estruturada para cada ramo
  for (const branchConfig of ramosParaProcessar) {
    const jovensDoRamo = associadosPorRamo[branchConfig.folder] || [];
    const pastaRamoDir = path.join(ROOT_RAW_DIR, branchConfig.folder);

    console.log(`\n================================================================`);
    console.log(`>>> PROCESSANDO RAMO: ${branchConfig.label.toUpperCase()} (${jovensDoRamo.length} jovens)`);
    console.log(`================================================================`);

    for (let i = 0; i < jovensDoRamo.length; i++) {
      const jovem = jovensDoRamo[i];
      const prefix = `[${branchConfig.folder} ${i + 1}/${jovensDoRamo.length}]`;
      const nrReg = (jovem.nr_registro || '').replace(/\D/g, '') || jovem.cd_associado;
      console.log(`\n${prefix} Extraindo ${jovem.nm_associado} (Reg: ${nrReg}, ID: ${jovem.cd_associado})...`);

      try {
        const totais = await extrairJovemCompleto(jovem, branchConfig, pastaRamoDir, { skipExisting });
        grandTotalJovens++;
        grandTotalEsps += totais.especialidades;
        grandTotalAtivs += totais.atividades_cumpridas;
        grandTotalConquistas += totais.conquistas;

        console.log(
          `   ✓ Sucesso! ${totais.especialidades} especialidades (${totais.especialidades_com_nivel} com nível), ` +
          `${totais.atividades_cumpridas} atividades cumpridas, ${totais.conquistas} conquistas.`
        );
      } catch (err) {
        console.error(`   ✗ Falha ao extrair ${jovem.nm_associado}:`, err.message);
      }

      await sleep(120);
    }
  }

  console.log(`\n================================================================`);
  console.log(`★ BACKUP DEFINITIVO DO PROGRAMA ANTIGO CONCLUÍDO COM SUCESSO!`);
  console.log(`- Jovens processados: ${grandTotalJovens}`);
  console.log(`- Total de especialidades extraídas: ${grandTotalEsps}`);
  console.log(`- Total de atividades concluídas: ${grandTotalAtivs}`);
  console.log(`- Total de conquistas/insígnias: ${grandTotalConquistas}`);
  console.log(`- Local dos dados: ${ROOT_RAW_DIR}`);
  console.log(`  Estrutura criada em cada jovem:`);
  console.log(`  ├── bruto/   (HTML do perfil, JSONs de rede originais)`);
  console.log(`  ├── tratado/ (dados-pessoais.json, especialidades.json, progressoes-atividades.json, conquistas.json)`);
  console.log(`  └── 00-manifesto.json`);
  console.log(`================================================================\n`);
}

main().catch((err) => {
  console.error('\n❌ Erro fatal durante o backup do Paxtu:', err);
  process.exit(1);
});
