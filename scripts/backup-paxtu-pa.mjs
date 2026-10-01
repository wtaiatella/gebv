import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

const RPC_BASE = 'https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.EntryPointPrincipal/rpc';
const MODULE_BASE = 'https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/';
const PERMUTATION = 'E0CAF052CC10CF07C17AA5F96BCD3E44';
const ROOT_RAW_DIR = path.resolve(process.cwd(), 'data', 'raw_pa');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeRamoFolder(ramo) {
  const r = String(ramo || '').toLowerCase();
  if (r.includes('lobinh') || r.includes('alcateia')) return 'alcateia';
  if (r.includes('escoteir')) return 'escoteiros';
  if (r.includes('senior') || r.includes('sênior')) return 'senior';
  if (r.includes('pion')) return 'pioneiros';
  return 'outros';
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
    if (
      unescaped.startsWith('{ "totalCount"') ||
      unescaped.startsWith('{"totalCount"') ||
      unescaped.startsWith('[') ||
      unescaped.startsWith('{')
    ) {
      try {
        blobs.push(JSON.parse(unescaped));
      } catch {}
    }
  }
  return blobs;
}

function getHeaders(cookie) {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7,es;q=0.6',
    'content-type': 'text/x-gwt-rpc; charset=UTF-8',
    cookie: cookie,
    dnt: '1',
    origin: 'https://paxtu.escoteiros.org.br',
    referer: 'https://paxtu.escoteiros.org.br/paxtu/main.do',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'x-gwt-module-base': MODULE_BASE,
    'x-gwt-permutation': PERMUTATION,
  };
}

async function rpcCall(service, payload, cookie, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${RPC_BASE}/${service}`, {
        method: 'POST',
        headers: getHeaders(cookie),
        body: payload,
      });

      const text = await res.text();
      if (!res.ok || !text.startsWith('//OK')) {
        if (text.includes('SessaoExpiradaException') || text.includes('login') || res.status === 401 || res.status === 403) {
          throw new Error(`SESSAO_EXPIRADA: ${text.slice(0, 200)}`);
        }
        throw new Error(`Chamada GWT-RPC ${service} falhou (HTTP ${res.status}): ${text.slice(0, 200)}`);
      }
      return text;
    } catch (err) {
      if (err.message.includes('SESSAO_EXPIRADA') || attempt === retries) {
        throw err;
      }
      console.warn(`    ⚠️ Tentativa ${attempt} falhou (${err.message}). Retentando em 2s...`);
      await sleep(2000);
    }
  }
}

// 1. Busca todos os associados (usando PAGE_SIZE=150)
async function fetchAllAssociados(cookie) {
  const payload =
    '7|0|10|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|FF5CB9852330EB11461971E09407D0D9|' +
    'br.com.wallis.sgg.client.rpc.AssociadoService|pesquisaAssociadosMinMax|' +
    'br.com.wallis.sgg.shared.beans.associado.PesquisaAssociadosMinMaxParameter/1272958102||0|S|' +
    'java.lang.Boolean/476441737|java.lang.Integer/3438268394|1|2|3|4|1|5|5|0|6|6|6|-1|0|-1|6|-1|6|7|6|6|0|-1|0|6|0|0|0|0|0|0|0|8|6|9|0|6|' +
    '150|0|6|6|-1|10|0|';

  const rawRpc = await rpcCall('associadoservice', payload, cookie);
  const blobs = extractJsonBlobs(rawRpc);
  const associados = blobs[0]?.data || [];
  return { associados, rawRpc };
}

// 2. Busca caminhos de progressão
async function fetchProgressao(cdAssociado, cookie) {
  const payload =
    '7|0|6|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|7B80C4FAD4E58D53CB6773CC004DD479|' +
    'br.com.wallis.sgg.client.rpc.ProgressaoService|getCaminhos|S|java.lang.Integer/3438268394|1|2|3|4|2|5|6|1|6|' +
    `${cdAssociado}|`;

  const rawRpc = await rpcCall('progressaoservice', payload, cookie);
  const blobs = extractJsonBlobs(rawRpc);
  return { blobs, rawRpc };
}

// 3. Busca especialidades
async function fetchEspecialidades(cdAssociado, cookie) {
  const payload =
    '7|0|7|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|2A60FE1D79751ABBA940A75E669C617F|' +
    'br.com.wallis.sgg.client.rpc.EspecialidadeItemAssociadoService|getEspecialidadesAssociado|I|java.lang.String/2004016611|115130551788830887137|1|2|3|4|2|5|6|' +
    `${cdAssociado}|7|`;

  const rawRpc = await rpcCall('especialidadeitemassociadoservice', payload, cookie);
  const blobs = extractJsonBlobs(rawRpc);
  return { especialidades: blobs[0]?.data || [], rawRpc };
}

// 4. Busca itens de uma especialidade
async function fetchItensEspecialidade(cdAssociado, cdEspecialidade, cookie) {
  const payload =
    '7|0|5|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|2A60FE1D79751ABBA940A75E669C617F|' +
    'br.com.wallis.sgg.client.rpc.EspecialidadeItemAssociadoService|getItensAssociadoDtItem|I|1|2|3|4|2|5|5|' +
    `${cdAssociado}|${cdEspecialidade}|`;

  const rawRpc = await rpcCall('especialidadeitemassociadoservice', payload, cookie);
  const blobs = extractJsonBlobs(rawRpc);
  return { itens: blobs[0]?.data || [], rawRpc };
}

async function main() {
  console.log('='.repeat(70));
  console.log('⚜️  EXTRAÇÃO COMPLETA DE BACKUP: PAXTU ANTIGO (PA / WALLIS)');
  console.log('    Destino:', ROOT_RAW_DIR);
  console.log('='.repeat(70));

  const cookie = process.env.PAXTU_PA_COOKIE || process.env.PAXTU_COOKIE;
  if (!cookie) {
    throw new Error('PAXTU_PA_COOKIE não encontrado no .env. Execute "npm run paxtu_pa:login" primeiro.');
  }

  await mkdir(ROOT_RAW_DIR, { recursive: true });

  console.log('\n📡 1. Buscando lista de associados no Paxtu Antigo...');
  const { associados, rawRpc: rawAssociadosRpc } = await fetchAllAssociados(cookie);
  console.log(`✅ Total de associados recebidos: ${associados.length}`);

  // Salva lista bruta e tratada de todos os associados
  await writeFile(path.join(ROOT_RAW_DIR, '00-todos-associados.json'), JSON.stringify(associados, null, 2));

  // Filtra beneficiários ativos
  const beneficiarios = associados.filter((a) => a.dsCategoria === 'Beneficiário');
  console.log(`🎯 Beneficiários encontrados para backup: ${beneficiarios.length}`);

  const estatisticasGerais = {
    data_extracao: new Date().toISOString(),
    sistema_origem: 'Paxtu Antigo (br.com.wallis.sgg.Sgg - GWT-RPC)',
    total_associados: associados.length,
    total_beneficiarios: beneficiarios.length,
    ramos: {},
    total_atividades_conquistadas: 0,
    total_especialidades: 0,
    total_itens_especialidades: 0,
    jovens: [],
  };

  for (let i = 0; i < beneficiarios.length; i++) {
    const a = beneficiarios[i];
    const cdAssociado = String(a.cd_associado);
    const nome = a.nm_associado;
    const ramo = a.dsRamo || 'Sem Ramo';
    const ramoFolder = normalizeRamoFolder(ramo);
    const slug = `${cdAssociado}-${slugify(nome)}`;
    const youthDir = path.join(ROOT_RAW_DIR, ramoFolder, slug);
    const brutoDir = path.join(youthDir, 'bruto');
    const tratadoDir = path.join(youthDir, 'tratado');

    await mkdir(brutoDir, { recursive: true });
    await mkdir(tratadoDir, { recursive: true });

    estatisticasGerais.ramos[ramoFolder] = (estatisticasGerais.ramos[ramoFolder] || 0) + 1;

    process.stdout.write(`\n[${i + 1}/${beneficiarios.length}] [${ramoFolder.toUpperCase()}] ${nome} (ID: ${cdAssociado})...\n`);

    // 1. Dados Pessoais / Cadastrais
    await writeFile(path.join(brutoDir, '01-associado-cadastral.json'), JSON.stringify(a, null, 2));

    const dadosPessoaisTratados = {
      cd_associado: cdAssociado,
      nm_associado: nome,
      nr_registro: a.nr_registro || '',
      nr_registro_formatado: a.nr_registro_formatado || a.nr_registro || '',
      ds_ramo: ramo,
      ds_categoria: a.dsCategoria,
      fl_status: a.flStatus || '',
      dt_nascimento: a.dt_nascimento || '',
      ds_email: a.ds_email || '',
      ds_telefone_cel: a.ds_telefone_cel || '',
      ds_telefone_res: a.ds_telefone_res || '',
      ds_cidade: a.ds_cidade || '',
      nm_estado: a.nm_estado || '',
      ds_bairro: a.ds_bairro || '',
      ds_endereco: a.ds_endereco || '',
      nr_residencia: a.nr_residencia || '',
      ds_cep: a.ds_cep || '',
      dt_validade: a.dt_validade || '',
      nr_grupo: a.nr_grupo || '100',
    };
    await writeFile(path.join(tratadoDir, 'dados-pessoais.json'), JSON.stringify(dadosPessoaisTratados, null, 2));

    // 2. Progressão (Caminhos, Competências, Atividades)
    let caminhosBlobs = [];
    let rawProgRpc = '';
    let totalAtividadesChecadas = 0;
    let totalAtividadesDisponiveis = 0;
    try {
      const progRes = await fetchProgressao(cdAssociado, cookie);
      caminhosBlobs = progRes.blobs;
      rawProgRpc = progRes.rawRpc;

      await writeFile(path.join(brutoDir, '02-caminhos-progressao.json'), JSON.stringify(caminhosBlobs, null, 2));

      // Tratamento dos caminhos
      const caminhosTratados = caminhosBlobs.map((blob, cIdx) => {
        const atvs = blob.data || [];
        totalAtividadesDisponiveis += atvs.length;

        const atvsTratadas = atvs.map((atv) => {
          const flEscotista =
            atv.checkEscotista === 'confirmadoEscotista' ||
            atv.checkEscotista === 'true' ||
            Boolean(atv.dtCheckEscotista);

          const flJovem =
            atv.checkJovem === 'feitoJovem' ||
            atv.checkJovem === 'S' ||
            atv.checkJovem === '1' ||
            atv.checkJovem === 'true' ||
            Boolean(atv.dtCheckJovem);

          if (flEscotista) {
            totalAtividadesChecadas++;
          }

          return {
            cd_ueb: atv.cdUeb || '',
            cd_ordenacao: atv.cdOrdenacao || '',
            cd_caminho: atv.cdCaminho || '',
            cd_competencia: atv.cdCompetencia || '',
            cd_atividade: atv.cdAtividade || '',
            ds_atividade: atv.dsAtividade || '',
            ds_desenvolvimento: atv.dsDesenvolvimento || '',
            check_escotista: atv.checkEscotista || '',
            fl_check_escotista: flEscotista,
            dt_check_escotista: atv.dtCheckEscotista || '',
            check_jovem: atv.checkJovem || '',
            fl_check_jovem: flJovem,
            dt_check_jovem: atv.dtCheckJovem || '',
            dt_atividade: atv.dtAtividade || '',
            dh_atualizacao: atv.dhAtualizacao || '',
          };
        });

        return {
          caminho_indice: cIdx + 1,
          total_atividades: atvs.length,
          atividades_conquistadas: atvsTratadas.filter((x) => x.fl_check_escotista).length,
          atividades: atvsTratadas,
        };
      });

      await writeFile(
        path.join(tratadoDir, 'progressoes-caminhos.json'),
        JSON.stringify(
          {
            cd_associado: cdAssociado,
            nm_associado: nome,
            total_atividades_disponiveis: totalAtividadesDisponiveis,
            total_atividades_conquistadas: totalAtividadesChecadas,
            caminhos: caminhosTratados,
          },
          null,
          2
        )
      );

      console.log(`   ├─ Progressão: ${caminhosBlobs.length} caminhos, ${totalAtividadesChecadas}/${totalAtividadesDisponiveis} itens conquistados`);
    } catch (err) {
      console.error(`   ├─ ❌ Erro ao buscar progressão: ${err.message}`);
      await writeFile(
        path.join(brutoDir, '02-caminhos-progressao-erro.json'),
        JSON.stringify({ error: err.message }, null, 2)
      );
    }

    await sleep(250);

    // 3. Especialidades & Itens Conquistados
    let especialidadesList = [];
    let totalItensEspecialidades = 0;
    try {
      const espRes = await fetchEspecialidades(cdAssociado, cookie);
      especialidadesList = espRes.especialidades;

      await writeFile(path.join(brutoDir, '03-especialidades.json'), JSON.stringify(especialidadesList, null, 2));

      const especialidadesTratadas = [];

      for (const esp of especialidadesList) {
        const cdEsp = String(esp.cd_especialidade);
        const dsEsp = esp.ds_especialidade || `Especialidade ${cdEsp}`;
        const nivel = parseInt(esp.nr_nivel, 10) || 0;
        const dtNivel = esp.dt_nivel || '';

        // Busca itens específicos conquistados pelo associado nesta especialidade
        let itensConquistados = [];
        try {
          const itemRes = await fetchItensEspecialidade(cdAssociado, cdEsp, cookie);
          itensConquistados = itemRes.itens;

          await writeFile(
            path.join(brutoDir, `04-especialidade-itens-${cdEsp}.json`),
            JSON.stringify(itensConquistados, null, 2)
          );
        } catch (itemErr) {
          console.warn(`      ⚠️ Erro ao buscar itens da especialidade ${dsEsp} (${cdEsp}): ${itemErr.message}`);
        }

        const itensTratados = itensConquistados.map((it) => ({
          cd_item: String(it.cd_item || ''),
          ds_item: it.ds_item ? it.ds_item.replace(/!@#BARRA_R#@!!@#BARRA_N#@!|!@#BARRA_N#@!|!@#BARRA_R#@!/g, ' ').replace(/\s+/g, ' ').trim() : '',
          dt_item: it.dt_item || '',
          nr_nivel: parseInt(it.nr_nivel, 10) || 0,
          check_escotista: it.check_escotista || '',
          check_jovem: it.check_jovem || '',
        }));

        totalItensEspecialidades += itensTratados.length;

        especialidadesTratadas.push({
          cd_especialidade: cdEsp,
          ds_especialidade: dsEsp,
          nr_nivel: nivel,
          dt_nivel: dtNivel,
          total_itens_conquistados: itensTratados.length,
          itens: itensTratados,
        });

        await sleep(150);
      }

      await writeFile(
        path.join(tratadoDir, 'especialidades.json'),
        JSON.stringify(
          {
            cd_associado: cdAssociado,
            nm_associado: nome,
            total_especialidades: especialidadesTratadas.length,
            total_itens_conquistados: totalItensEspecialidades,
            especialidades: especialidadesTratadas,
          },
          null,
          2
        )
      );

      console.log(`   └─ Especialidades: ${especialidadesTratadas.length} especialidades, ${totalItensEspecialidades} itens conquistados`);
    } catch (err) {
      console.error(`   └─ ❌ Erro ao buscar especialidades: ${err.message}`);
      await writeFile(
        path.join(brutoDir, '03-especialidades-erro.json'),
        JSON.stringify({ error: err.message }, null, 2)
      );
    }

    // 4. Manifesto Individual
    const manifesto = {
      cd_associado: cdAssociado,
      nm_associado: nome,
      nr_registro: a.nr_registro_formatado || a.nr_registro || '',
      ds_ramo: ramo,
      ramo_folder: ramoFolder,
      data_extracao: new Date().toISOString(),
      origem: 'Paxtu Antigo (Wallis GWT-RPC)',
      estatisticas: {
        total_caminhos: caminhosBlobs.length,
        total_atividades_disponiveis: totalAtividadesDisponiveis,
        total_atividades_conquistadas: totalAtividadesChecadas,
        total_especialidades: especialidadesList.length,
        total_itens_especialidades: totalItensEspecialidades,
      },
      arquivos_brutos: [
        'bruto/01-associado-cadastral.json',
        'bruto/02-caminhos-progressao.json',
        'bruto/03-especialidades.json',
      ],
      arquivos_tratados: [
        'tratado/dados-pessoais.json',
        'tratado/progressoes-caminhos.json',
        'tratado/especialidades.json',
      ],
    };

    await writeFile(path.join(youthDir, '00-manifesto.json'), JSON.stringify(manifesto, null, 2));

    estatisticasGerais.total_atividades_conquistadas += totalAtividadesChecadas;
    estatisticasGerais.total_especialidades += especialidadesList.length;
    estatisticasGerais.total_itens_especialidades += totalItensEspecialidades;
    estatisticasGerais.jovens.push({
      cd_associado: cdAssociado,
      nm_associado: nome,
      ds_ramo: ramo,
      ramo_folder: ramoFolder,
      atividades_conquistadas: totalAtividadesChecadas,
      especialidades: especialidadesList.length,
      itens_especialidades: totalItensEspecialidades,
    });

    await sleep(350);
  }

  // 5. Salva Resumo Geral
  await writeFile(
    path.join(ROOT_RAW_DIR, '00-resumo-geral.json'),
    JSON.stringify(estatisticasGerais, null, 2)
  );

  console.log('\n' + '='.repeat(70));
  console.log('🎉 BACKUP DO PAXTU ANTIGO CONCLUÍDO COM SUCESSO!');
  console.log(`📁 Diretório: ${ROOT_RAW_DIR}`);
  console.log(`👥 Total de Jovens: ${estatisticasGerais.total_beneficiarios}`);
  console.log(`📊 Ramos:`, estatisticasGerais.ramos);
  console.log(`🏅 Total de Atividades Checadas no PA: ${estatisticasGerais.total_atividades_conquistadas}`);
  console.log(`🎖️  Total de Especialidades: ${estatisticasGerais.total_especialidades} (${estatisticasGerais.total_itens_especialidades} itens)`);
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('\n❌ Erro fatal durante o backup do Paxtu Antigo:', err);
  process.exit(1);
});
