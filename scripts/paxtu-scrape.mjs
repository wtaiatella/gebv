import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const RPC_BASE = 'https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.EntryPointPrincipal/rpc';
const MODULE_BASE = 'https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/';
const PERMUTATION = 'E0CAF052CC10CF07C17AA5F96BCD3E44';
const PAGE_SIZE = 20;

const COOKIE = process.env.PAXTU_COOKIE;
if (!COOKIE) {
  throw new Error(
    'Defina PAXTU_COOKIE no .env, ex: PAXTU_COOKIE="JSESSIONID=xxx; cf_clearance=yyy" (copie da aba Network, requisição ao paxtu)'
  );
}

const HEADERS = {
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7,es;q=0.6',
  'content-type': 'text/x-gwt-rpc; charset=UTF-8',
  cookie: COOKIE,
  dnt: '1',
  origin: 'https://paxtu.escoteiros.org.br',
  referer: 'https://paxtu.escoteiros.org.br/paxtu/main.do',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'x-gwt-module-base': MODULE_BASE,
  'x-gwt-permutation': PERMUTATION,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GWT-RPC escapa strings de um jeito parecido com JSON, mas usa \xNN (hex de 2
// dígitos) pra alguns caracteres — isso não é escape válido em JSON.parse, então
// decodificamos manualmente em vez de usar JSON.parse na camada externa.
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

// Strings muito longas o GWT serializa quebradas em vários literais concatenados
// com `+` (ex: "25/04/2" + "026 10:00:26") — sem juntar os pedaços antes de
// decodificar, o JSON.parse trunca no meio e o blob inteiro é perdido.
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
      } catch {
        // blob malformado, ignora
      }
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

function buildAssociadosPayload(offset) {
  return (
    '7|0|10|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|FF5CB9852330EB11461971E09407D0D9|' +
    'br.com.wallis.sgg.client.rpc.AssociadoService|pesquisaAssociadosMinMax|' +
    'br.com.wallis.sgg.shared.beans.associado.PesquisaAssociadosMinMaxParameter/1272958102||1|S|' +
    'java.lang.Boolean/476441737|java.lang.Integer/3438268394|1|2|3|4|1|5|5|0|6|6|6|-1|0|-1|6|-1|6|7|6|6|0|-1|0|6|0|0|0|0|0|0|0|8|6|9|0|6|' +
    `${PAGE_SIZE}|${offset}|6|6|-1|10|0|`
  );
}

function buildProgressaoPayload(cdAssociado) {
  return (
    '7|0|6|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|7B80C4FAD4E58D53CB6773CC004DD479|' +
    'br.com.wallis.sgg.client.rpc.ProgressaoService|getCaminhos|S|java.lang.Integer/3438268394|1|2|3|4|2|5|6|1|6|' +
    `${cdAssociado}|`
  );
}

async function fetchAllAssociados() {
  const all = [];
  let offset = 0;
  while (true) {
    const text = await rpcCall('associadoservice', buildAssociadosPayload(offset));
    const [blob] = extractJsonBlobs(text);
    const records = blob?.data ?? [];
    all.push(...records);
    console.log(`  página offset=${offset}: ${records.length} registros`);
    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    await sleep(500 + Math.random() * 500);
  }
  return all;
}

async function fetchProgressao(cdAssociado) {
  const text = await rpcCall('progressaoservice', buildProgressaoPayload(cdAssociado));
  return extractJsonBlobs(text);
}

async function main() {
  const outDir = path.join(process.cwd(), 'data');
  await mkdir(outDir, { recursive: true });

  console.log('Buscando lista completa de associados...');
  const associados = await fetchAllAssociados();
  await writeFile(path.join(outDir, 'associados.json'), JSON.stringify(associados, null, 2));
  console.log(`Total: ${associados.length} associados salvos em data/associados.json`);

  const jovens = associados.filter((a) => a.dsCategoria === 'Beneficiário');
  console.log(`${jovens.length} jovens (Beneficiário) a processar (${associados.length - jovens.length} Escotistas ignorados)`);

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
    // salva incrementalmente para não perder progresso se travar no meio
    await writeFile(path.join(outDir, 'progressoes.json'), JSON.stringify(resultados, null, 2));
    await sleep(800 + Math.random() * 700);
  }

  console.log('Concluído. Resultados em data/progressoes.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
