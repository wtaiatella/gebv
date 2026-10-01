import { readFile } from 'node:fs/promises';
import path from 'node:path';

const RPC_BASE = 'https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.EntryPointPrincipal/rpc';
const MODULE_BASE = 'https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/';
const PERMUTATION = 'E0CAF052CC10CF07C17AA5F96BCD3E44';

const COOKIE = process.env.PAXTU_PA_COOKIE || process.env.PAXTU_COOKIE;

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
      } catch {
        // ignora
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

function buildAssociadosPayload(offset = 0) {
  return (
    '7|0|10|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|FF5CB9852330EB11461971E09407D0D9|' +
    'br.com.wallis.sgg.client.rpc.AssociadoService|pesquisaAssociadosMinMax|' +
    'br.com.wallis.sgg.shared.beans.associado.PesquisaAssociadosMinMaxParameter/1272958102||1|S|' +
    'java.lang.Boolean/476441737|java.lang.Integer/3438268394|1|2|3|4|1|5|5|0|6|6|6|-1|0|-1|6|-1|6|7|6|6|0|-1|0|6|0|0|0|0|0|0|0|8|6|9|0|6|' +
    `20|${offset}|6|6|-1|10|0|`
  );
}

async function test() {
  console.log('Testando chamada GWT-RPC AssociadoService...');
  const text = await rpcCall('associadoservice', buildAssociadosPayload(0));
  const [blob] = extractJsonBlobs(text);
  console.log(`Sucesso! Total retornado: ${blob?.totalCount}, registros nesta página: ${blob?.data?.length}`);
  if (blob?.data?.length > 0) {
    console.log('Primeiro registro:', blob.data[0].nm_associado, 'Ramo:', blob.data[0].dsRamo, 'ID:', blob.data[0].cd_associado);
  }
}

test().catch(console.error);
