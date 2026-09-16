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

  // Diretório de destino: gebv/data/raw/[num. registro]
  const baseDir = process.cwd().endsWith('gebv') ? process.cwd() : path.join(process.cwd(), 'gebv');
  const outDir = path.join(baseDir, 'data', 'raw', nrRegistro);
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
