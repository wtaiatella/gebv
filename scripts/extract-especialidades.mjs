import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const RPC_BASE = 'https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.EntryPointPrincipal/rpc';
const MODULE_BASE = 'https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/';
const PERMUTATION = 'E0CAF052CC10CF07C17AA5F96BCD3E44';

const COOKIE = process.env.PAXTU_COOKIE;
if (!COOKIE) {
  throw new Error('Defina PAXTU_COOKIE no .env');
}

const HEADERS = {
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7,es;q=0.6',
  'content-type': 'text/x-gwt-rpc; charset=UTF-8',
  cookie: COOKIE,
  dnt: '1',
  origin: 'https://paxtu.escoteiros.org.br',
  referer: 'https://paxtu.escoteiros.org.br/paxtu/main.do',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'x-gwt-module-base': MODULE_BASE,
  'x-gwt-permutation': PERMUTATION,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gwtUnescape(str) {
  return str.replace(/\\(?:x([0-9A-Fa-f]{2})|u([0-9A-Fa-f]{4})|(.))/g, (_, hex2, hex4, other) => {
    if (hex2) return String.fromCharCode(parseInt(hex2, 16));
    if (hex4) return String.fromCharCode(parseInt(hex4, 16));
    if (other === 'n') return '\n';
    if (other === 'r') return '\r';
    if (other === 't') return '\t';
    return other;
  });
}

function extractJsonBlobs(text) {
  const stringRe = /"((?:[^"\\]|\\.)*)"/g;
  const matches = [];
  let match;
  while ((match = stringRe.exec(text))) {
    matches.push({ start: match.index, end: stringRe.lastIndex, raw: match[1] });
  }

  const fused = [];
  let current = null;
  let prevEnd = null;
  for (const seg of matches) {
    if (current !== null && /^\s*\+\s*$/.test(text.slice(prevEnd, seg.start))) {
      current += gwtUnescape(seg.raw);
    } else {
      if (current !== null) fused.push(current);
      current = gwtUnescape(seg.raw);
    }
    prevEnd = seg.end;
  }
  if (current !== null) fused.push(current);

  const blobs = [];
  for (const unescaped of fused) {
    if (unescaped.startsWith('{ "totalCount"') || unescaped.startsWith('{"totalCount"')) {
      try {
        blobs.push(JSON.parse(unescaped));
      } catch {}
    }
  }
  return blobs;
}

async function rpcCall(service, payload) {
  const res = await fetch(`${RPC_BASE}/${service}`, {
    method: 'POST',
    headers: HEADERS,
    body: payload,
  });
  const text = await res.text();
  if (!res.ok || !text.startsWith('//OK')) {
    throw new Error(`${service} falhou (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  return text;
}

// 1. Busca todos os associados (usando PAGE_SIZE=150 para pegar os 101 do GEBV)
async function fetchAllAssociados() {
  const payload = `7|0|10|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|FF5CB9852330EB11461971E09407D0D9|br.com.wallis.sgg.client.rpc.AssociadoService|pesquisaAssociadosMinMax|br.com.wallis.sgg.shared.beans.associado.PesquisaAssociadosMinMaxParameter/1272958102||0|S|java.lang.Boolean/476441737|java.lang.Integer/3438268394|1|2|3|4|1|5|5|0|6|6|6|-1|0|-1|6|-1|6|7|6|6|0|-1|0|6|0|0|0|0|0|0|0|8|6|9|0|6|150|0|6|6|-1|10|0|`;
  const text = await rpcCall('associadoservice', payload);
  const [blob] = extractJsonBlobs(text);
  return blob?.data || [];
}

// 2. Busca lista de especialidades de um associado
async function fetchEspecialidadesAssociado(cdAssociado) {
  const payload = `7|0|7|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|2A60FE1D79751ABBA940A75E669C617F|br.com.wallis.sgg.client.rpc.EspecialidadeItemAssociadoService|getEspecialidadesAssociado|I|java.lang.String/2004016611|115130551788830887137|1|2|3|4|2|5|6|${cdAssociado}|7|`;
  const text = await rpcCall('especialidadeitemassociadoservice', payload);
  const [blob] = extractJsonBlobs(text);
  return blob?.data || [];
}

// 3. Busca catálogo de itens oficiais de uma especialidade (EspecialidadeItemService.getItens)
async function fetchItensEspecialidadeCatalogo(cdEspecialidade) {
  const payload = `7|0|5|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|8DCDF20ECEBC700E6FC16B57331E4EA3|br.com.wallis.sgg.client.rpc.EspecialidadeItemService|getItens|I|1|2|3|4|1|5|${cdEspecialidade}|`;
  const text = await rpcCall('especialidadeitemservice', payload);
  const [blob] = extractJsonBlobs(text);
  return blob?.data || [];
}

// 4. Busca os itens específicos conquistados por um associado numa especialidade
async function fetchItensAssociadoEspecialidade(cdAssociado, cdEspecialidade) {
  const payload = `7|0|5|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|2A60FE1D79751ABBA940A75E669C617F|br.com.wallis.sgg.client.rpc.EspecialidadeItemAssociadoService|getItensAssociadoDtItem|I|1|2|3|4|2|5|5|${cdAssociado}|${cdEspecialidade}|`;
  const text = await rpcCall('especialidadeitemassociadoservice', payload);
  const [blob] = extractJsonBlobs(text);
  return blob?.data || [];
}

async function main() {
  console.log('🚀 Iniciando Extração de Especialidades do Paxtu...');
  const outDir = path.join(process.cwd(), 'data');
  await mkdir(outDir, { recursive: true });

  // 1. Busca todos os associados
  console.log('1. Buscando lista completa de associados no Paxtu...');
  const associados = await fetchAllAssociados();
  console.log(`   Total de associados encontrados: ${associados.length}`);
  await writeFile(path.join(outDir, 'todos_associados_gebv.json'), JSON.stringify(associados, null, 2));

  // Catálogos e resultados
  const catalogoEspecialidades = new Map(); // cd_especialidade -> { cd_especialidade, ds_especialidade, total_itens, itens: [...] }
  const progressoAssociados = [];

  let totalComEspecialidade = 0;
  let totalEspecialidadesConquistadas = 0;

  console.log('\n2. Buscando especialidades de cada associado...');
  for (let i = 0; i < associados.length; i++) {
    const a = associados[i];
    const cdAssociado = a.cd_associado;
    const nome = a.nm_associado;
    const ramo = a.dsRamo || a.ds_ramo || 'Sem Ramo';
    const reg = a.nr_registro_formatado || a.nr_registro || '';

    process.stdout.write(`[${i + 1}/${associados.length}] ${nome} (${ramo})... `);

    try {
      const especialidades = await fetchEspecialidadesAssociado(cdAssociado);
      
      if (especialidades.length > 0) {
        totalComEspecialidade++;
        totalEspecialidadesConquistadas += especialidades.length;
        console.log(`✨ ${especialidades.length} especialidade(s)`);

        const espsDoJovem = [];

        for (const esp of especialidades) {
          const cdEsp = esp.cd_especialidade;
          const dsEsp = esp.ds_especialidade;
          const nivel = parseInt(esp.nr_nivel, 10) || 0;
          const qtdItensConcluidos = parseInt(esp.itens, 10) || 0;
          const dtNivel = esp.dt_nivel || '';

          // Se a especialidade ainda não está no catálogo, busca os itens oficiais
          if (!catalogoEspecialidades.has(cdEsp)) {
            try {
              const itensOficiais = await fetchItensEspecialidadeCatalogo(cdEsp);
              catalogoEspecialidades.set(cdEsp, {
                cd_especialidade: cdEsp,
                ds_especialidade: dsEsp,
                total_itens: itensOficiais.length,
                itens: itensOficiais.map((it) => ({
                  cd_item: it.cd_item,
                  ds_item: it.ds_item ? it.ds_item.replace(/!@#BARRA_R#@!!@#BARRA_N#@!/g, ' ').trim() : '',
                })),
              });
              await sleep(200);
            } catch (err) {
              console.error(`      Erro ao buscar catálogo da especialidade ${dsEsp} (${cdEsp}):`, err.message);
              catalogoEspecialidades.set(cdEsp, {
                cd_especialidade: cdEsp,
                ds_especialidade: dsEsp,
                total_itens: qtdItensConcluidos,
                itens: [],
              });
            }
          }

          // Busca os itens específicos conquistados por este associado nesta especialidade
          let itensConquistados = [];
          try {
            const rawItens = await fetchItensAssociadoEspecialidade(cdAssociado, cdEsp);
            itensConquistados = rawItens.map((it) => ({
              cd_item: it.cd_item,
              ds_item: it.ds_item ? it.ds_item.replace(/!@#BARRA_R#@!!@#BARRA_N#@!/g, ' ').trim() : '',
              dt_item: it.dt_item || '',
              check_escotista: it.check_escotista || '',
              nr_nivel: parseInt(it.nr_nivel, 10) || 0,
            }));
            await sleep(150);
          } catch (err) {
            console.error(`      Erro ao buscar itens da especialidade ${dsEsp} para ${nome}:`, err.message);
          }

          espsDoJovem.push({
            cd_especialidade: cdEsp,
            ds_especialidade: dsEsp,
            nr_nivel: nivel,
            dt_nivel: dtNivel,
            qtd_itens_concluidos: qtdItensConcluidos,
            itens_conquistados: itensConquistados,
          });
        }

        progressoAssociados.push({
          cd_associado: cdAssociado,
          nm_associado: nome,
          nr_registro_formatado: reg,
          ds_ramo: ramo,
          total_especialidades: especialidades.length,
          especialidades: espsDoJovem,
        });
      } else {
        console.log(`0 especialidades`);
        progressoAssociados.push({
          cd_associado: cdAssociado,
          nm_associado: nome,
          nr_registro_formatado: reg,
          ds_ramo: ramo,
          total_especialidades: 0,
          especialidades: [],
        });
      }

      await sleep(250 + Math.random() * 200);
    } catch (err) {
      console.log(`❌ Falhou: ${err.message}`);
    }
  }

  // Ordena catálogo por nome de especialidade
  const catalogoArray = Array.from(catalogoEspecialidades.values()).sort((a, b) =>
    a.ds_especialidade.localeCompare(b.ds_especialidade)
  );

  console.log('\n=============================================');
  console.log(`✅ Concluído!`);
  console.log(`- Total de Associados Processados: ${associados.length}`);
  console.log(`- Associados com Especialidades: ${totalComEspecialidade}`);
  console.log(`- Total de Registros de Especialidades Conquistadas/Em Andamento: ${totalEspecialidadesConquistadas}`);
  console.log(`- Especialidades Únicas no Catálogo: ${catalogoArray.length}`);
  console.log('=============================================\n');

  await writeFile(
    path.join(outDir, 'pa_especialidades_catalogo.json'),
    JSON.stringify(catalogoArray, null, 2)
  );
  await writeFile(
    path.join(outDir, 'pa_especialidades_associados.json'),
    JSON.stringify(progressoAssociados, null, 2)
  );

  console.log(`📁 Arquivos gerados com sucesso:`);
  console.log(`   - data/pa_especialidades_catalogo.json`);
  console.log(`   - data/pa_especialidades_associados.json`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
