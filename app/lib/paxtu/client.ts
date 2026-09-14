import type { Associado, Atividade, Caminho } from '@/app/lib/data';

const BASE_URL = 'https://paxtu100.escoteiros.org.br';
const PAGE_SIZE = 20;

let activeSessionCookie: string | null = null;
let cachedCsrfToken: string | null = null;
let lastCookieForCsrf: string | null = null;


export function setSessionCookie(cookie: string) {
  activeSessionCookie = cookie;
  cachedCsrfToken = null;
  lastCookieForCsrf = null;
}

export function getSessionCookie(): string | null {
  return activeSessionCookie || process.env.PAXTU_COOKIE || null;
}

function getCookie(): string {
  const cookie = getSessionCookie();
  if (!cookie) {
    throw new Error('Sessão do Paxtu 100 não configurada. Clique em "Conectar Paxtu 100" para autenticar.');
  }
  return cookie;
}

function getHeaders(extraHeaders: Record<string, string> = {}): HeadersInit {
  return {
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    cookie: getCookie(),
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'x-requested-with': 'XMLHttpRequest',
    referer: `${BASE_URL}/associado/lista`,
    ...extraHeaders,
  };
}

/**
 * Extrai token CSRF a partir da página /associado/lista com cache
 */
async function getCsrfToken(forceRefresh = false): Promise<string> {
  const currentCookie = getCookie();
  if (!forceRefresh && cachedCsrfToken && lastCookieForCsrf === currentCookie) {
    return cachedCsrfToken;
  }

  const res = await fetch(`${BASE_URL}/associado/lista`, {
    headers: getHeaders({ accept: 'text/html' }),
  });
  const html = await res.text();
  const metaMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  if (metaMatch) {
    cachedCsrfToken = metaMatch[1];
    lastCookieForCsrf = currentCookie;
    return cachedCsrfToken;
  }

  throw new Error('Não foi possível obter o token CSRF do Paxtu 100.');
}


/**
 * Analisa o bloco HTML retornado pela listagem e extrai os associados
 */
function parseAssociadosFromHtml(html: string): Associado[] {
  const list: Associado[] = [];
  const seen = new Set<string>();

  // Bloco desktop com classe paxtu-info
  const desktopBlocks = [...html.matchAll(/data-bs-associate="(\d+)"[^>]*>([\s\S]*?)(?=(<div[^>]*data-bs-associate=|<hr class="paxtu-divider"|$))/g)];

  for (const match of desktopBlocks) {
    const cdAssociado = match[1];
    if (seen.has(cdAssociado)) continue;

    const block = match[2];
    
    // Nome
    const nameMatch = block.match(/<h3 class="[^"]*fw-bold[^"]*">([^<]+)<\/h3>/) ||
                      block.match(/<p class="[^"]*fw-bold[^"]*"[^>]*>([^<]+)<\/p>/) ||
                      block.match(/alt="([^"]+)"/);
    const nmAssociado = nameMatch ? nameMatch[1].trim() : `Associado ${cdAssociado}`;

    // Registro
    const regMatch = block.match(/Registro:\s*([0-9\s-]+)/);
    const nrRegistro = regMatch ? regMatch[1].replace(/\s+/g, ' ').trim() : '';

    // Ramo
    const ramoMatch = block.match(/<span class="badge paxtu-badge[^>]*>([^<]+)<\/span>/);
    const dsRamo = ramoMatch ? ramoMatch[1].trim() : 'Escoteiro';

    // Categoria
    const isAdulto = dsRamo.toLowerCase().includes('adulto') || dsRamo.toLowerCase().includes('escotista') || dsRamo.toLowerCase().includes('dirigente');
    const dsCategoria = isAdulto ? 'Escotista' : 'Beneficiário';

    seen.add(cdAssociado);
    list.push({
      cd_associado: cdAssociado,
      nm_associado: nmAssociado,
      nr_registro: nrRegistro,
      nr_registro_formatado: nrRegistro,
      dsRamo: dsRamo,
      dsCategoria: dsCategoria,
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

/**
 * Busca a lista completa de associados paginada
 */
export async function fetchAllAssociados(): Promise<Associado[]> {
  const all: Associado[] = [];
  let page = 1;

  while (true) {
    const url = `${BASE_URL}/associado/associado/lista/carregar?page=${page}&status=S`;
    const res = await fetch(url, { headers: getHeaders() });

    if (!res.ok) {
      throw new Error(`Falha ao buscar associados na página ${page} (HTTP ${res.status})`);
    }

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      if (text.includes('login') || text.includes('<!DOCTYPE')) {
        throw new Error('Sessão do Paxtu 100 expirada ou inválida. Conecte suas credenciais pelo botão "Conectar Paxtu 100".');
      }
      throw new Error(`Resposta inválida do Paxtu 100 na página ${page}.`);
    }

    if (!json || !json.html) break;


    const records = parseAssociadosFromHtml(json.html);
    if (records.length === 0) break;

    all.push(...records);

    // Continua para a próxima página enquanto houver link rel="next" ou page=N+1 na paginação
    const hasNextPage = Boolean(
      json.pagination && (
        json.pagination.includes(`page=${page + 1}`) ||
        json.pagination.includes('rel="next"')
      )
    );

    if (!hasNextPage) {
      break;
    }

    page++;
    await new Promise((r) => setTimeout(r, 100));
  }

  return all;
}


/**
 * Mapeamento dos Ramos para os branch IDs do Paxtu 100
 * 1: Escoteiro, 2: Lobinho, 3: Sênior, 4: Pioneiro
 */
const RAMO_TO_BRANCH_ID: Record<string, number> = {
  escoteiro: 1,
  lobinho: 2,
  sênior: 3,
  senior: 3,
  pioneiro: 4,
};

/**
 * Busca as progressões do PA (Programa de Atividades) para o associado
 */
export async function fetchProgressao(cdAssociado: string, dsRamo?: string): Promise<Caminho[]> {
  const branchesToQuery = dsRamo && RAMO_TO_BRANCH_ID[dsRamo.toLowerCase()]
    ? [RAMO_TO_BRANCH_ID[dsRamo.toLowerCase()]]
    : [1, 2, 3, 4];

  const caminhosMap = new Map<string, { totalCount: number; data: Atividade[] }>();

  for (const branch of branchesToQuery) {
    try {
      const compUrl = `${BASE_URL}/associado/associado/progressoes/competences/show?associate_code=${cdAssociado}&branch=${branch}`;
      const compRes = await fetch(compUrl, { headers: getHeaders() });
      if (!compRes.ok) continue;

      const competences: any = await compRes.json().catch(() => null);
      if (!Array.isArray(competences) || competences.length === 0) continue;

      const validCompetences = competences.filter(
        (comp) => comp.tipo !== 'caminho_direto' && comp.id && !(typeof comp.id === 'string' && comp.id.startsWith('caminho_'))
      );

      await Promise.all(
        validCompetences.map(async (comp) => {
          const caminhoId = String(comp.caminho_id || comp.cd_caminho || '0');
          if (!caminhosMap.has(caminhoId)) {
            caminhosMap.set(caminhoId, { totalCount: 0, data: [] });
          }

          const actUrl = `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${cdAssociado}&competence_id=${comp.id}`;
          const actRes = await fetch(actUrl, { headers: getHeaders() });
          if (!actRes.ok) return;

          const actJson: any = await actRes.json().catch(() => null);
          if (!actJson) return;
          const activities: any[] = Array.isArray(actJson) ? actJson : (actJson.activities || []);

          for (const act of activities) {
            const atvId = String(act.id || act.codigo || '');
            const isConcluida = Boolean(act.concluida || act.status_escotista === 'confirmadoEscotista' || act.data_conclusao);

            const item: Atividade = {
              cdCaminho: caminhoId,
              cdCompetencia: String(comp.id),
              cdAtividade: atvId,
              cdUeb: String(act.codigo || atvId),
              dsAtividade: act.descricao || comp.nome || '',
              checkEscotista: isConcluida ? 'confirmadoEscotista' : '',
              dtCheckEscotista: act.data_conclusao || '',
              checkJovem: isConcluida ? 'feitoJovem' : '',
              dtCheckJovem: act.data_conclusao || '',
              dtAtividade: act.data_conclusao || '',
            };

            const caminhoEntry = caminhosMap.get(caminhoId)!;
            caminhoEntry.data.push(item);
            caminhoEntry.totalCount = caminhoEntry.data.length;
          }
        })
      );
    } catch {}
  }

  return Array.from(caminhosMap.values());
}

/**
 * Busca os detalhes de uma especialidade do associado (itens cumpridos e datas)
 */
export async function fetchItensAssociadoEspecialidade(
  cdAssociado: string,
  cdEspecialidade: string | number
): Promise<any[]> {
  try {
    const url = `${BASE_URL}/associado/associado/progressoes/especialidades/${cdEspecialidade}/${cdAssociado}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) return [];

    const json = await res.json().catch(() => null);
    if (!json || !json.itens) return [];

    return Object.values(json.itens).map((it: any) => ({
      cd_item: String(it.cd_item || ''),
      ds_item: it.ds_item || '',
      dt_item: it.dt_item || '',
      nr_nivel: Number(it.nr_nivel ?? json.nr_nivel ?? 0),
      check_escotista: it.dt_item ? 'confirmadoEscotista' : '',
      check_jovem: it.dt_item ? 'feitoJovem' : '',
    }));
  } catch (err) {
    console.warn(`[Paxtu100] Erro ao buscar itens da especialidade ${cdEspecialidade} para ${cdAssociado}:`, err);
    return [];
  }
}

/**
 * Busca todas as especialidades e seus itens detalhados para o associado em paralelo
 */
export async function fetchEspecialidadesCompletasAssociado(cdAssociado: string): Promise<any[]> {
  try {
    let csrfToken = await getCsrfToken();
    let profileRes = await fetch(`${BASE_URL}/associado/perfil`, {
      method: 'POST',
      headers: getHeaders({
        'content-type': 'application/x-www-form-urlencoded',
        'x-csrf-token': csrfToken,
        accept: 'text/html',
      }),
      body: new URLSearchParams({
        associate_code: cdAssociado,
        _token: csrfToken,
      }),
    });

    if (profileRes.status === 419) {
      csrfToken = await getCsrfToken(true);
      profileRes = await fetch(`${BASE_URL}/associado/perfil`, {
        method: 'POST',
        headers: getHeaders({
          'content-type': 'application/x-www-form-urlencoded',
          'x-csrf-token': csrfToken,
          accept: 'text/html',
        }),
        body: new URLSearchParams({
          associate_code: cdAssociado,
          _token: csrfToken,
        }),
      });
    }

    if (!profileRes.ok) {
      console.warn(`[Paxtu100] Perfil do associado ${cdAssociado} retornou HTTP ${profileRes.status}`);
      return [];
    }


    const html = await profileRes.text();
    const specialtyCards = [...html.matchAll(/class="[^"]*specialty-card[^"]*"[^>]*data-specialty-id="(\d+)"/g)];
    const uniqueIds = [...new Set(specialtyCards.map((m) => m[1]))];

    const results = await Promise.all(
      uniqueIds.map(async (cdEsp) => {
        try {
          const espUrl = `${BASE_URL}/associado/associado/progressoes/especialidades/${cdEsp}/${cdAssociado}`;
          const espRes = await fetch(espUrl, { headers: getHeaders() });
          if (!espRes.ok) return null;

          const espJson = await espRes.json().catch(() => null);
          if (!espJson) return null;

          const itensList = Object.values(espJson.itens || {}).map((it: any) => ({
            cd_item: String(it.cd_item || ''),
            ds_item: it.ds_item || '',
            dt_item: it.dt_item || '',
            nr_nivel: Number(it.nr_nivel ?? espJson.nr_nivel ?? 0),
            check_escotista: it.dt_item ? 'confirmadoEscotista' : '',
            check_jovem: it.dt_item ? 'feitoJovem' : '',
          }));

          const concluidos = itensList.filter((it: any) => Boolean(it.dt_item)).length;

          return {
            cd_especialidade: String(cdEsp),
            ds_especialidade: espJson.ds_especialidade || `Especialidade ${cdEsp}`,
            nr_nivel: Number(espJson.nr_nivel ?? 0),
            dt_nivel: espJson.dt_nivel || null,
            qtd_itens_concluidos: concluidos,
            itens_conquistados: itensList,
          };
        } catch {
          return null;
        }
      })
    );

    return results.filter(Boolean);
  } catch (err: any) {
    console.warn(`[Paxtu100] Erro geral ao buscar especialidades para ${cdAssociado}:`, err.message);
    return [];
  }
}

