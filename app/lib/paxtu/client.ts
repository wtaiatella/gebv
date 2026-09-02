import type { Associado, Atividade, Caminho } from '@/app/lib/data';

const RPC_BASE = 'https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.EntryPointPrincipal/rpc';
const MODULE_BASE = 'https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/';
const PERMUTATION = 'E0CAF052CC10CF07C17AA5F96BCD3E44';
const PAGE_SIZE = 20;

let activeSessionCookie: string | null = null;

export function setSessionCookie(cookie: string) {
  activeSessionCookie = cookie;
}

export function getSessionCookie(): string | null {
  return activeSessionCookie || process.env.PAXTU_COOKIE || null;
}

function getCookie(): string {
  const cookie = getSessionCookie();
  if (!cookie) {
    throw new Error('Sessão do Paxtu (Antigo) não configurada. Clique em "Conectar Paxtu (Antigo)" para autenticar.');
  }
  return cookie;
}

function getHeaders(): HeadersInit {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7,es;q=0.6',
    'content-type': 'text/x-gwt-rpc; charset=UTF-8',
    cookie: getCookie(),
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
}

function gwtUnescape(str: string): string {
  return str.replace(/\\(?:x([0-9A-Fa-f]{2})|u([0-9A-Fa-f]{4})|(.))/g, (_, hex2, hex4, other) => {
    if (hex2) return String.fromCharCode(parseInt(hex2, 16));
    if (hex4) return String.fromCharCode(parseInt(hex4, 16));
    if (other === 'n') return '\n';
    if (other === 'r') return '\r';
    if (other === 't') return '\t';
    return other;
  });
}

function extractJsonBlobs(text: string): any[] {
  const stringRe = /"((?:[^"\\]|\\.)*)"/g;
  const matches: { start: number; end: number; raw: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = stringRe.exec(text))) {
    matches.push({ start: match.index, end: stringRe.lastIndex, raw: match[1] });
  }

  const fused: string[] = [];
  let current: string | null = null;
  let prevEnd: number | null = null;

  for (const seg of matches) {
    if (current !== null && prevEnd !== null && /^\s*\+\s*$/.test(text.slice(prevEnd, seg.start))) {
      current += gwtUnescape(seg.raw);
    } else {
      if (current !== null) fused.push(current);
      current = gwtUnescape(seg.raw);
    }
    prevEnd = seg.end;
  }
  if (current !== null) fused.push(current);

  const blobs: any[] = [];
  for (const unescaped of fused) {
    if (unescaped.startsWith('{ "totalCount"') || unescaped.startsWith('{"totalCount"')) {
      try {
        blobs.push(JSON.parse(unescaped));
      } catch {
        // Ignora blob truncado ou mal formatado
      }
    }
  }
  return blobs;
}

async function rpcCall(service: string, payload: string): Promise<string> {
  const res = await fetch(`${RPC_BASE}/${service}`, {
    method: 'POST',
    headers: getHeaders(),
    body: payload,
  });

  const text = await res.text();
  if (!res.ok || !text.startsWith('//OK')) {
    throw new Error(`Chamada GWT-RPC ${service} falhou (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return text;
}

function buildAssociadosPayload(offset: number): string {
  return (
    '7|0|10|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|FF5CB9852330EB11461971E09407D0D9|' +
    'br.com.wallis.sgg.client.rpc.AssociadoService|pesquisaAssociadosMinMax|' +
    'br.com.wallis.sgg.shared.beans.associado.PesquisaAssociadosMinMaxParameter/1272958102||1|S|' +
    'java.lang.Boolean/476441737|java.lang.Integer/3438268394|1|2|3|4|1|5|5|0|6|6|6|-1|0|-1|6|-1|6|7|6|6|0|-1|0|6|0|0|0|0|0|0|0|8|6|9|0|6|' +
    `${PAGE_SIZE}|${offset}|6|6|-1|10|0|`
  );
}

function buildProgressaoPayload(cdAssociado: string): string {
  return (
    '7|0|6|https://paxtu.escoteiros.org.br/paxtu/br.com.wallis.sgg.Sgg/|7B80C4FAD4E58D53CB6773CC004DD479|' +
    'br.com.wallis.sgg.client.rpc.ProgressaoService|getCaminhos|S|java.lang.Integer/3438268394|1|2|3|4|2|5|6|1|6|' +
    `${cdAssociado}|`
  );
}

export async function fetchAllAssociados(): Promise<Associado[]> {
  const all: Associado[] = [];
  let offset = 0;

  while (true) {
    const text = await rpcCall('associadoservice', buildAssociadosPayload(offset));
    const [blob] = extractJsonBlobs(text);
    const records: Associado[] = blob?.data ?? [];
    all.push(...records);

    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

export async function fetchProgressao(cdAssociado: string): Promise<Caminho[]> {
  const text = await rpcCall('progressaoservice', buildProgressaoPayload(cdAssociado));
  return extractJsonBlobs(text);
}
