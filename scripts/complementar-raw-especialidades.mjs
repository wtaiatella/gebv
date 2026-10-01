import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { loginPaxtu } from '../app/lib/paxtu/auth.js';

dotenv.config();

const BASE_URL = 'https://paxtu100.escoteiros.org.br';
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

const NR_REGISTRO = '1343627';
const CD_ASSOCIADO = '1035437';
const NM_ASSOCIADO = 'Antonia Sofia Hendler Thiesen';
const RAW_DIR = path.resolve(process.cwd(), 'data', 'raw', `${NR_REGISTRO}-${slugify(NM_ASSOCIADO)}`);

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

async function ensureValidCookie() {
  let cookie = process.env.PAXTU_COOKIE;
  
  if (cookie) {
    try {
      const res = await fetch(`${BASE_URL}/atualizacoes/ultima`, {
        headers: getHeaders(cookie),
      });
      const text = await res.text();
      if (res.ok && !text.includes('login') && !text.includes('Keycloak')) {
        console.log('✓ Sessão existente em PAXTU_COOKIE é válida.');
        return cookie;
      }
    } catch (err) {
      console.warn('! Erro ao testar cookie existente:', err.message);
    }
  }

  console.log('Autenticando novamente no Paxtu 100 com credenciais do .env...');
  const user = process.env.user;
  const pass = process.env.senha;
  if (!user || !pass) {
    throw new Error('user ou senha não encontrados no .env');
  }

  cookie = await loginPaxtu(user.trim(), pass.trim());
  console.log('✓ Autenticação realizada com sucesso via Playwright.');

  // Atualiza .env
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = await readFile(envPath, 'utf-8').catch(() => '');
    const line = `PAXTU_COOKIE="${cookie}"`;
    if (/^PAXTU_COOKIE=/m.test(envContent)) {
      envContent = envContent.replace(/^PAXTU_COOKIE=.*$/m, line);
    } else {
      envContent = envContent.trimEnd() + '\n' + line + '\n';
    }
    await writeFile(envPath, envContent, 'utf-8');
    console.log('✓ PAXTU_COOKIE salvo no .env.');
  } catch (err) {
    console.warn('Aviso ao persistir .env:', err.message);
  }

  return cookie;
}

async function getCsrfToken(cookie) {
  const res = await fetch(`${BASE_URL}/associado/lista`, {
    headers: getHeaders(cookie, { accept: 'text/html' }),
  });
  const html = await res.text();
  const match = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  if (match) return match[1];
  throw new Error('Não foi possível obter token CSRF.');
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`=== COMPLEMENTAÇÃO DE DADOS BRUTOS (ESPECIALIDADES) ===`);
  console.log(`Associada: Antonia Sofia Hendler Thiesen`);
  console.log(`Registro:  ${NR_REGISTRO}`);
  console.log(`Código:    ${CD_ASSOCIADO}`);
  console.log(`Diretório: ${RAW_DIR}`);
  console.log(`======================================================\n`);

  const cookie = await ensureValidCookie();
  const espDir = path.join(RAW_DIR, 'especialidades');
  await mkdir(espDir, { recursive: true });

  // 1. Obter CSRF Token
  const csrfToken = await getCsrfToken(cookie);
  console.log('✓ Token CSRF obtido com sucesso.');

  // 2. Buscar Perfil HTML para extrair todos os cards de especialidades
  console.log('Buscando perfil da associada no Paxtu 100 (/associado/perfil)...');
  const perfilRes = await fetch(`${BASE_URL}/associado/perfil`, {
    method: 'POST',
    headers: getHeaders(cookie, {
      'content-type': 'application/x-www-form-urlencoded',
      'x-csrf-token': csrfToken,
      accept: 'text/html',
    }),
    body: new URLSearchParams({
      associate_code: CD_ASSOCIADO,
      _token: csrfToken,
    }),
  });

  if (!perfilRes.ok) {
    throw new Error(`Falha ao obter perfil: HTTP ${perfilRes.status}`);
  }

  const perfilHtml = await perfilRes.text();
  const perfilPath = path.join(RAW_DIR, '08-perfil.html');
  await writeFile(perfilPath, perfilHtml, 'utf-8');
  console.log(`✓ Perfil salvo em 08-perfil.html (${perfilHtml.length} bytes).`);

  // Extrair IDs de especialidades dos cards HTML
  const specialtyCards = [...perfilHtml.matchAll(/class="[^"]*specialty-card[^"]*"[^>]*data-specialty-id="(\d+)"/g)];
  const specialtyIds = new Set(
    specialtyCards.map((m) => Number(m[1])).filter((id) => !isNaN(id) && id > 0)
  );
  console.log(`✓ Identificadas ${specialtyIds.size} especialidades a partir dos cards do perfil HTML.`);

  // Complementa com o banco local caso haja alguma especialidade histórica adicional
  const prisma = new PrismaClient();
  try {
    const dbEsps = await prisma.progressaoEspecialidadePa.findMany({
      where: { cd_associado: CD_ASSOCIADO },
      select: { cd_especialidade: true },
    });
    for (const esp of dbEsps) {
      specialtyIds.add(Number(esp.cd_especialidade));
    }
    console.log(`✓ Total acumulado (Perfil + Banco): ${specialtyIds.size} especialidades únicas a extrair.`);
  } catch (err) {
    console.warn('Aviso ao consultar banco local:', err.message);
  } finally {
    await prisma.$disconnect();
  }

  const sortedIds = Array.from(specialtyIds).sort((a, b) => a - b);
  const todasEspecialidades = [];
  const manifestArquivos = [];

  console.log(`\nIniciando leitura e extração de ${sortedIds.length} especialidades...`);

  for (let i = 0; i < sortedIds.length; i++) {
    const espId = sortedIds[i];
    const url = `${BASE_URL}/associado/associado/progressoes/especialidades/${espId}/${CD_ASSOCIADO}`;

    let res = null;
    let retries = 3;
    while (retries > 0) {
      try {
        res = await fetch(url, { headers: getHeaders(cookie) });
        if (res.ok) break;
      } catch (err) {
        console.warn(`! Tentativa falhou para especialidade ${espId}: ${err.message}. Retentando...`);
      }
      retries--;
      await sleep(500);
    }

    if (!res || !res.ok) {
      console.error(`✗ Erro ao extrair especialidade ${espId} (HTTP ${res ? res.status : 'ERR'})`);
      manifestArquivos.push({
        arquivo: `especialidades/esp-${espId}.json`,
        url,
        metodo: 'GET',
        status: res ? res.status : 'ERROR',
        is_json: false,
      });
      continue;
    }

    const text = await res.text();
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(text);
      todasEspecialidades.push(parsedJson);
    } catch (err) {
      console.warn(`! Não foi possível converter resposta de ${espId} para JSON:`, err.message);
    }

    const nome = parsedJson?.ds_especialidade || `Especialidade ${espId}`;
    const slug = slugify(nome);
    const relFileName = `especialidades/esp-${espId}-${slug}.json`;
    const fullFilePath = path.join(RAW_DIR, relFileName);

    await writeFile(fullFilePath, JSON.stringify(parsedJson || text, null, 2), 'utf-8');

    const totalItens = parsedJson?.itens ? Object.keys(parsedJson.itens).length : 0;
    const itensConcluidos = parsedJson?.itens
      ? Object.values(parsedJson.itens).filter((it) => it && it.dt_item !== null).length
      : 0;
    const nivel = parsedJson?.nr_nivel ?? '-';

    console.log(
      `  [${i + 1}/${sortedIds.length}] ${path.basename(relFileName)}: ${nome} (Nível: ${nivel}, Concluídos: ${itensConcluidos}/${totalItens})`
    );

    manifestArquivos.push({
      arquivo: relFileName,
      url,
      metodo: 'GET',
      status: res.status,
      tamanho_bytes: Buffer.byteLength(text, 'utf-8'),
      is_json: true,
      cd_especialidade: espId,
      ds_especialidade: nome,
      nr_nivel: parsedJson?.nr_nivel ?? null,
      itens_concluidos: itensConcluidos,
      total_itens: totalItens,
    });

    await sleep(80);
  }

  // 3. Salvar arquivo consolidado com todas as especialidades
  const consolidadoPath = path.join(RAW_DIR, '08-especialidades.json');
  await writeFile(consolidadoPath, JSON.stringify(todasEspecialidades, null, 2), 'utf-8');
  console.log(`\n✓ Arquivo consolidado salvo em 08-especialidades.json (${todasEspecialidades.length} especialidades).`);

  // 3.1 Extrair e salvar conquistas/insígnias a partir do perfil
  const branchMap = {
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
    const branchId = m[1];
    const block = m[2];
    const imgMatch = block.match(/<img[^>]*src="([^"]+)"/);
    const titleMatch = block.match(/<p class="h6 mb-2 fw-bold">\s*([^<]+)<\/p>/);
    const dateMatch = block.match(/<p class="h6">\s*([^<]+)<\/p>/);
    conquistas.push({
      titulo: titleMatch ? titleMatch[1].trim() : '',
      data_conquista: dateMatch ? dateMatch[1].trim() : '',
      branch_id: branchId,
      ramo: branchMap[branchId] || `Ramo ${branchId}`,
      imagem_url: imgMatch ? imgMatch[1] : '',
    });
  }
  const conquistasPath = path.join(RAW_DIR, '09-conquistas.json');
  await writeFile(conquistasPath, JSON.stringify(conquistas, null, 2), 'utf-8');
  console.log(`✓ Conquistas e insígnias salvas em 09-conquistas.json (${conquistas.length} conquistas).`);

  // 4. Atualizar o manifesto 00-extracao-info.json
  const infoPath = path.join(RAW_DIR, '00-extracao-info.json');
  let info = {};
  try {
    const rawInfo = await readFile(infoPath, 'utf-8');
    info = JSON.parse(rawInfo);
  } catch (err) {
    console.warn('Aviso: Criando novo manifesto 00-extracao-info.json.');
    info = {
      nr_registro: NR_REGISTRO,
      cd_associado: CD_ASSOCIADO,
      nm_associado: 'Antonia Sofia Hendler Thiesen',
      data_extracao: new Date().toISOString(),
      arquivos_extraidos: [],
    };
  }

  // Registra 08-perfil.html no manifesto
  const perfilStat = await readFile(perfilPath).then((b) => b.length);
  const consolidadoStat = await readFile(consolidadoPath).then((b) => b.length);

  // Remove entradas anteriores de especialidades para evitar duplicação no manifesto
  const existingOtherFiles = (info.arquivos_extraidos || []).filter(
    (a) => !a.arquivo.startsWith('especialidades/') && a.arquivo !== '08-especialidades.json' && a.arquivo !== '08-perfil.html'
  );

  existingOtherFiles.push({
    arquivo: '08-perfil.html',
    url: `${BASE_URL}/associado/perfil`,
    metodo: 'POST',
    status: 200,
    tamanho_bytes: perfilStat,
    is_json: false,
  });

  existingOtherFiles.push({
    arquivo: '08-especialidades.json',
    descricao: 'Consolidado com todas as especialidades extraídas do Paxtu100',
    total_especialidades: todasEspecialidades.length,
    tamanho_bytes: consolidadoStat,
    is_json: true,
  });

  info.arquivos_extraidos = [...existingOtherFiles, ...manifestArquivos];
  info.total_arquivos = info.arquivos_extraidos.length;
  info.total_especialidades = todasEspecialidades.length;
  info.data_complementacao_especialidades = new Date().toISOString();

  await writeFile(infoPath, JSON.stringify(info, null, 2), 'utf-8');
  console.log(`✓ Manifesto 00-extracao-info.json atualizado com ${info.arquivos_extraidos.length} arquivos.`);

  console.log(`\n======================================================`);
  console.log(`★ EXTRAÇÃO CONCLUÍDA COM SUCESSO!`);
  console.log(`- Especialidades extraídas: ${todasEspecialidades.length}`);
  console.log(`- Pasta de destino: ${espDir}`);
  console.log(`- Arquivo consolidado: ${consolidadoPath}`);
  console.log(`- Manifesto atualizado: ${infoPath}`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('\n❌ Falha fatal ao complementar dados brutos:', err);
  process.exit(1);
});
