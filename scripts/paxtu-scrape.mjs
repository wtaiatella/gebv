import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://paxtu100.escoteiros.org.br';
const PAGE_SIZE = 20;

const COOKIE = process.env.PAXTU_COOKIE;
if (!COOKIE) {
  throw new Error(
    'Defina PAXTU_COOKIE no .env, ex: PAXTU_COOKIE="XSRF-TOKEN=xxx; paxtu100_session=yyy"'
  );
}

const HEADERS = {
  accept: 'application/json, text/javascript, */*; q=0.01',
  'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  cookie: COOKIE,
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  'x-requested-with': 'XMLHttpRequest',
  referer: `${BASE_URL}/associado/lista`,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAssociadosFromHtml(html) {
  const list = [];
  const seen = new Set();
  const desktopBlocks = [...html.matchAll(/data-bs-associate="(\d+)"[^>]*>([\s\S]*?)(?=(<div[^>]*data-bs-associate=|<hr class="paxtu-divider"|$))/g)];

  for (const match of desktopBlocks) {
    const cdAssociado = match[1];
    if (seen.has(cdAssociado)) continue;

    const block = match[2];
    const nameMatch = block.match(/<h3 class="[^"]*fw-bold[^"]*">([^<]+)<\/h3>/) ||
                      block.match(/<p class="[^"]*fw-bold[^"]*"[^>]*>([^<]+)<\/p>/) ||
                      block.match(/alt="([^"]+)"/);
    const nmAssociado = nameMatch ? nameMatch[1].trim() : `Associado ${cdAssociado}`;

    const regMatch = block.match(/Registro:\s*([0-9\s-]+)/);
    const nrRegistro = regMatch ? regMatch[1].replace(/\s+/g, ' ').trim() : '';

    const ramoMatch = block.match(/<span class="badge paxtu-badge[^>]*>([^<]+)<\/span>/);
    const dsRamo = ramoMatch ? ramoMatch[1].trim() : 'Escoteiro';

    const isAdulto = dsRamo.toLowerCase().includes('adulto') || dsRamo.toLowerCase().includes('escotista');
    const dsCategoria = isAdulto ? 'Escotista' : 'Beneficiário';

    seen.add(cdAssociado);
    list.push({
      cd_associado: cdAssociado,
      nm_associado: nmAssociado,
      nr_registro: nrRegistro,
      nr_registro_formatado: nrRegistro,
      dsRamo,
      dsCategoria,
      flStatus: 'S',
      dt_nascimento: '',
      nr_grupo: '190',
      nr_grupo_regiao: '190/SC',
      ds_cidade: '',
      ds_bairro: '',
      ds_endereco: '',
      nr_residencia: '',
      ds_complemento: '',
      ds_cep: '',
      nm_estado: 'SC',
      ds_telefone_cel: '',
      ds_telefone_res: '',
      ds_email: '',
      ds_ano_ingresso: '',
      ds_escolaridade: '',
      ds_profissao: '',
      dt_validade: '',
    });
  }

  return list;
}

async function fetchAllAssociados() {
  const all = [];
  let page = 1;

  while (true) {
    const url = `${BASE_URL}/associado/associado/lista/carregar?page=${page}&status=S`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      throw new Error(`Falha ao buscar associados na página ${page} (HTTP ${res.status})`);
    }

    const json = await res.json();
    if (!json || !json.html) break;

    const records = parseAssociadosFromHtml(json.html);
    if (records.length === 0) break;

    all.push(...records);
    console.log(`  página ${page}: ${records.length} registros`);

    if (records.length < PAGE_SIZE || !json.pagination || !json.pagination.includes(`page=${page + 1}`)) {
      break;
    }

    page++;
    await sleep(400);
  }
  return all;
}

async function fetchProgressao(cdAssociado) {
  const caminhosMap = new Map();

  for (const branch of [1, 2, 3, 4]) {
    const compUrl = `${BASE_URL}/associado/associado/progressoes/competences/show?associate_code=${cdAssociado}&branch=${branch}`;
    const compRes = await fetch(compUrl, { headers: HEADERS });
    if (!compRes.ok) continue;

    const competences = await compRes.json();
    if (!Array.isArray(competences) || competences.length === 0) continue;

    for (const comp of competences) {
      if (!comp.id) {
        continue;
      }

      const caminhoId = String(comp.caminho_id || '0');
      if (!caminhosMap.has(caminhoId)) {
        caminhosMap.set(caminhoId, { totalCount: 0, data: [] });
      }

      const actUrl = `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${cdAssociado}&competence_id=${comp.id}`;
      const actRes = await fetch(actUrl, { headers: HEADERS });
      if (!actRes.ok) continue;

      const actJson = await actRes.json();
      const activities = Array.isArray(actJson) ? actJson : (actJson.activities || []);

      for (const act of activities) {
        const atvId = String(act.id || act.codigo || '');
        const isConcluida = Boolean(act.concluida || act.status_escotista === 'confirmadoEscotista' || act.data_conclusao);

        const item = {
          cdCaminho: caminhoId,
          cdCompetencia: String(comp.id),
          cdAtividade: atvId,
          cdUeb: String(act.codigo || atvId),
          dsAtividade: act.descricao || comp.nome || '',
          checkEscotista: isConcluida ? 'confirmadoEscotista' : '',
          dtCheckEscotista: act.data_conclusao || '',
          checkJovem: isConcluida ? 'feitoJovem' : '',
          dtCheckJovem: act.data_conclusao || '',
        };

        const caminhoEntry = caminhosMap.get(caminhoId);
        caminhoEntry.data.push(item);
        caminhoEntry.totalCount = caminhoEntry.data.length;
      }
      await sleep(150);
    }
  }

  return Array.from(caminhosMap.values());
}

async function main() {
  const outDir = path.join(process.cwd(), 'data');
  await mkdir(outDir, { recursive: true });

  console.log('Buscando lista completa de associados no Paxtu 100...');
  const associados = await fetchAllAssociados();
  await writeFile(path.join(outDir, 'associados.json'), JSON.stringify(associados, null, 2));
  console.log(`Total: ${associados.length} associados salvos em data/associados.json`);

  const jovens = associados.filter((a) => a.dsCategoria === 'Beneficiário');
  console.log(`${jovens.length} jovens (Beneficiário) encontrados.`);

  const resultados = [];
  for (const [i, a] of jovens.entries()) {
    const id = a.cd_associado;
    console.log(`[${i + 1}/${jovens.length}] ${a.nm_associado} (id ${id})`);
    try {
      const caminhos = await fetchProgressao(id);
      resultados.push({ cd_associado: id, nome: a.nm_associado, caminhos });
    } catch (err) {
      console.error(`  falhou: ${err.message}`);
      resultados.push({ cd_associado: id, nome: a.nm_associado, error: err.message });
    }
    await writeFile(path.join(outDir, 'progressoes.json'), JSON.stringify(resultados, null, 2));
    await sleep(300);
  }

  console.log('Concluído. Resultados salvos em data/progressoes.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
