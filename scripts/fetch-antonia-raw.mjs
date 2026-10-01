import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const BASE_URL = 'https://paxtu100.escoteiros.org.br';

/**
 * Obtém o token CSRF a partir do cookie ou de fallback
 */
function getCsrfToken(cookie) {
  const match = cookie.match(/XSRF-TOKEN=([^;]+)/);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  return '';
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

/**
 * Resolve o cd_associado e número de registro a partir do banco de dados ou fallback
 */
async function resolveAssociado(registroInput) {
  const prisma = new PrismaClient();
  try {
    const cleanInput = String(registroInput).trim();
    const associado = await prisma.associado.findFirst({
      where: {
        OR: [
          { nr_registro_formatado: cleanInput },
          { cd_associado: cleanInput },
          { nr_registro_formatado: cleanInput.replace(/\D/g, '') },
        ],
      },
    });

    if (associado) {
      return {
        cdAssociado: associado.cd_associado,
        nrRegistro: associado.nr_registro_formatado || cleanInput,
        nmAssociado: associado.nm_associado,
      };
    }
  } catch (err) {
    console.warn('Aviso: Não foi possível consultar o banco local:', err.message);
  } finally {
    await prisma.$disconnect();
  }

  // Fallback caso não esteja no banco
  return {
    cdAssociado: String(registroInput).trim(),
    nrRegistro: String(registroInput).trim(),
    nmAssociado: 'Não identificado no banco',
  };
}

export async function fetchAssociadoRaw(registroInput, customCookie) {
  if (!registroInput) {
    console.error('Uso: node scripts/fetch-antonia-raw.mjs <numero_registro> [cookie]');
    process.exit(1);
  }

  const { cdAssociado, nrRegistro, nmAssociado } = await resolveAssociado(registroInput);
  console.log(`\n=== INICIANDO EXTRAÇÃO DE DADOS BRUTOS DO PAXTU 100 ===`);
  console.log(`Associado: ${nmAssociado}`);
  console.log(`Registro:  ${nrRegistro}`);
  console.log(`Código:    ${cdAssociado}`);

  const sessionCookie = customCookie || process.env.PAXTU_COOKIE;
  if (!sessionCookie) {
    throw new Error('Nenhum cookie de sessão do Paxtu fornecido (defina PAXTU_COOKIE no .env ou passe como 2º parâmetro).');
  }

  // Diretório de destino: gebv/data/raw/[num. registro]-[nome]
  const baseDir = process.cwd().endsWith('gebv') ? process.cwd() : path.join(process.cwd(), 'gebv');
  const slugNome = nmAssociado ? `-${slugify(nmAssociado)}` : '';
  const outDir = path.join(baseDir, 'data', 'raw', `${nrRegistro}${slugNome}`);
  await mkdir(outDir, { recursive: true });
  console.log(`Destino:   ${outDir}\n`);

  const csrfToken = getCsrfToken(sessionCookie);

  const defaultHeaders = {
    'cookie': sessionCookie,
    'accept': 'application/json, text/plain, */*',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'x-requested-with': 'XMLHttpRequest',
  };

  const endpoints = [
    {
      name: '01-atualizacoes-ultima.json',
      url: `${BASE_URL}/atualizacoes/ultima`,
      method: 'GET',
      headers: defaultHeaders,
    },
    {
      name: '02-sincronizar-retroativo.json',
      url: `${BASE_URL}/associado/associado/progressoes/sincronizar-retroativo`,
      method: 'POST',
      headers: {
        ...defaultHeaders,
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      body: new URLSearchParams({ associate_code: cdAssociado }).toString(),
    },
    {
      name: '03-competences-show-branch-1.json',
      url: `${BASE_URL}/associado/associado/progressoes/competences/show?associate_code=${cdAssociado}&branch=1`,
      method: 'GET',
      headers: defaultHeaders,
    },
    {
      name: '04-activities-caminho-4.json',
      url: `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${cdAssociado}&competence_id=caminho_4`,
      method: 'GET',
      headers: defaultHeaders,
    },
    {
      name: '05-activities-caminho-5.json',
      url: `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${cdAssociado}&competence_id=caminho_5`,
      method: 'GET',
      headers: defaultHeaders,
    },
    {
      name: '06-activities-caminho-6.json',
      url: `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${cdAssociado}&competence_id=caminho_6`,
      method: 'GET',
      headers: defaultHeaders,
    },
    {
      name: '07-activities-competencia-109.json',
      url: `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${cdAssociado}&competence_id=109`,
      method: 'GET',
      headers: defaultHeaders,
    },
  ];

  const metadata = {
    nr_registro: nrRegistro,
    cd_associado: cdAssociado,
    nm_associado: nmAssociado,
    data_extracao: new Date().toISOString(),
    arquivos_extraidos: [],
  };

  for (const ep of endpoints) {
    try {
      console.log(`-> Requisitando: ${ep.name} (${ep.url})`);
      const options = {
        method: ep.method,
        headers: ep.headers,
        ...(ep.body ? { body: ep.body } : {}),
      };

      const res = await fetch(ep.url, options);
      const text = await res.text();

      let formatted = text;
      let isJson = false;
      try {
        const json = JSON.parse(text);
        formatted = JSON.stringify(json, null, 2);
        isJson = true;
      } catch {
        // Se for HTML (ex: redirecionou para Keycloak), avisa
        if (text.includes('login-pf') || text.includes('Entrar em paxtu')) {
          console.warn(`   ⚠️ Atenção: Resposta recebida foi tela de login do Keycloak (Sessão expirada).`);
        }
      }

      const filePath = path.join(outDir, ep.name);
      await writeFile(filePath, formatted, 'utf-8');
      metadata.arquivos_extraidos.push({
        arquivo: ep.name,
        url: ep.url,
        status: res.status,
        tamanho_bytes: text.length,
        is_json: isJson,
      });

      console.log(`   ✓ Salvo em ${ep.name} (${text.length} bytes, HTTP ${res.status})`);
    } catch (err) {
      console.error(`   ✗ Falha ao obter ${ep.name}:`, err.message);
    }
  }

  // Extração de Especialidades
  try {
    console.log(`\n-> Buscando perfil para extração de especialidades...`);
    const espDir = path.join(outDir, 'especialidades');
    await mkdir(espDir, { recursive: true });

    const perfilRes = await fetch(`${BASE_URL}/associado/perfil`, {
      method: 'POST',
      headers: {
        ...defaultHeaders,
        'content-type': 'application/x-www-form-urlencoded',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        accept: 'text/html',
      },
      body: new URLSearchParams({
        associate_code: cdAssociado,
        ...(csrfToken ? { _token: csrfToken } : {}),
      }),
    });

    if (perfilRes.ok) {
      const perfilHtml = await perfilRes.text();
      const perfilPath = path.join(outDir, '08-perfil.html');
      await writeFile(perfilPath, perfilHtml, 'utf-8');
      metadata.arquivos_extraidos.push({
        arquivo: '08-perfil.html',
        url: `${BASE_URL}/associado/perfil`,
        status: perfilRes.status,
        tamanho_bytes: perfilHtml.length,
        is_json: false,
      });

      const cards = [...perfilHtml.matchAll(/class="[^"]*specialty-card[^"]*"[^>]*data-specialty-id="(\d+)"/g)];
      const espIds = [...new Set(cards.map((m) => Number(m[1])))].filter((id) => !isNaN(id) && id > 0).sort((a, b) => a - b);
      console.log(`   ✓ Encontradas ${espIds.length} especialidades no perfil.`);

      const todasEsps = [];
      for (const espId of espIds) {
        const espUrl = `${BASE_URL}/associado/associado/progressoes/especialidades/${espId}/${cdAssociado}`;
        try {
          const espRes = await fetch(espUrl, { headers: defaultHeaders });
          if (espRes.ok) {
            const espJson = await espRes.json();
            todasEsps.push(espJson);
            const slug = slugify(espJson.ds_especialidade);
            const espFileName = `esp-${espId}-${slug}.json`;
            const espFile = path.join(espDir, espFileName);
            const espContent = JSON.stringify(espJson, null, 2);
            await writeFile(espFile, espContent, 'utf-8');
            metadata.arquivos_extraidos.push({
              arquivo: `especialidades/${espFileName}`,
              url: espUrl,
              status: espRes.status,
              tamanho_bytes: Buffer.byteLength(espContent, 'utf-8'),
              is_json: true,
              cd_especialidade: espId,
              ds_especialidade: espJson.ds_especialidade,
              nr_nivel: espJson.nr_nivel,
            });
          }
        } catch (espErr) {
          console.error(`   ✗ Falha ao obter especialidade ${espId}:`, espErr.message);
        }
      }

      const consolidadoPath = path.join(outDir, '08-especialidades.json');
      const consolidadoContent = JSON.stringify(todasEsps, null, 2);
      await writeFile(consolidadoPath, consolidadoContent, 'utf-8');
      metadata.arquivos_extraidos.push({
        arquivo: '08-especialidades.json',
        descricao: 'Consolidado com todas as especialidades extraídas do Paxtu100',
        total_especialidades: todasEsps.length,
        tamanho_bytes: Buffer.byteLength(consolidadoContent, 'utf-8'),
        is_json: true,
      });
      metadata.total_especialidades = todasEsps.length;

      // Extração de Conquistas e Insígnias
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
      const conquistasPath = path.join(outDir, '09-conquistas.json');
      const conquistasContent = JSON.stringify(conquistas, null, 2);
      await writeFile(conquistasPath, conquistasContent, 'utf-8');
      metadata.arquivos_extraidos.push({
        arquivo: '09-conquistas.json',
        descricao: 'Conquistas e insígnias extraídas do perfil HTML do Paxtu100',
        total_conquistas: conquistas.length,
        tamanho_bytes: Buffer.byteLength(conquistasContent, 'utf-8'),
        is_json: true,
      });
      metadata.total_conquistas = conquistas.length;
    }
  } catch (err) {
    console.error('   ✗ Falha ao processar especialidades/conquistas:', err.message);
  }

  metadata.total_arquivos = metadata.arquivos_extraidos.length;
  // Salva metadata de resumo da extração
  await writeFile(path.join(outDir, '00-extracao-info.json'), JSON.stringify(metadata, null, 2), 'utf-8');
  console.log(`\n★ Concluído! Todos os dados brutos foram salvos em: ${outDir}\n`);
}

// Execução direta via CLI
const inputRegistro = process.argv[2];
const inputCookie = process.argv[3];

if (inputRegistro) {
  fetchAssociadoRaw(inputRegistro, inputCookie).catch((err) => {
    console.error('Erro na extração:', err);
    process.exit(1);
  });
}
