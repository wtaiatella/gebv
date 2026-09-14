import type { Associado, Atividade, Caminho } from '@/app/lib/data';
import { PaxtuSessionExpiredError, PaxtuApiError } from './errors';

export { PaxtuSessionExpiredError, PaxtuApiError };

const BASE_URL = 'https://paxtu100.escoteiros.org.br';

export function resolveSessionCookie(explicitCookie?: string | null): string {
  const cookie = explicitCookie || process.env.PAXTU_COOKIE;
  if (!cookie) {
    throw new PaxtuSessionExpiredError('Sessão do Paxtu 100 não configurada. Por favor, conecte suas credenciais.');
  }
  return cookie;
}

// Suporte deprecado para compatibilidade retroativa (sem estado global de memória)
export function setSessionCookie(_cookie: string) {
  // Cookies de sessão agora são estritamente por request via cabeçalhos HTTP
}
export function getSessionCookie(): string | null {
  return process.env.PAXTU_COOKIE || null;
}

function getCookie(explicitCookie?: string | null): string {
  return resolveSessionCookie(explicitCookie);
}

function getHeaders(cookie: string, extraHeaders: Record<string, string> = {}): HeadersInit {
  return {
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    cookie,
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    'x-requested-with': 'XMLHttpRequest',
    referer: `${BASE_URL}/associado/lista`,
    ...extraHeaders,
  };
}

/**
 * Extrai token CSRF a partir da página /associado/lista
 */
export async function getCsrfToken(cookie?: string, forceRefresh = false): Promise<string> {
  const sessionCookie = getCookie(cookie);
  const res = await fetch(`${BASE_URL}/associado/lista`, {
    headers: getHeaders(sessionCookie, { accept: 'text/html' }),
  });

  if (res.status === 401 || res.status === 419 || res.url.includes('/login') || res.url.includes('keycloak')) {
    throw new PaxtuSessionExpiredError();
  }

  const html = await res.text();
  const metaMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  if (metaMatch) {
    return metaMatch[1];
  }

  throw new Error('Não foi possível obter o token CSRF do Paxtu 100.');
}

/**
 * Analisa o bloco HTML retornado pela listagem e extrai os associados
 */
export function parseAssociadosFromHtml(html: string): Associado[] {
  const list: Associado[] = [];
  const seen = new Set<string>();

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

export interface FetchAssociadosOptions {
  branchId?: number;
  category?: number;
  status?: string;
  cookie?: string;
}

/**
 * Busca a lista completa de associados paginada por ramo
 * Utiliza branch_id={1..4}, category=1 (Beneficiários), status=S (Ativo)
 */
export async function fetchAllAssociados(options: FetchAssociadosOptions = {}): Promise<Associado[]> {
  const sessionCookie = getCookie(options.cookie);
  const branchId = options.branchId;
  const category = options.category ?? 1; // Default: 1 (Beneficiários)
  const status = options.status ?? 'S';   // Default: S (Ativos)

  const all: Associado[] = [];
  let page = 1;

  while (true) {
    let url = `${BASE_URL}/associado/associado/lista/carregar?page=${page}&category=${category}&status=${status}`;
    if (branchId !== undefined) {
      url += `&branch_id=${branchId}`;
    }

    const res = await fetch(url, { headers: getHeaders(sessionCookie) });

    if (res.status === 401 || res.status === 419 || res.url.includes('/login')) {
      throw new PaxtuSessionExpiredError();
    }

    if (!res.ok) {
      throw new PaxtuApiError(`Falha ao buscar associados na página ${page}`, res.status, url);
    }

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      if (text.includes('login') || text.includes('<!DOCTYPE')) {
        throw new PaxtuSessionExpiredError();
      }
      throw new Error(`Resposta inválida do Paxtu 100 na página ${page}.`);
    }

    if (!json || !json.html) break;

    const records = parseAssociadosFromHtml(json.html);
    if (records.length === 0) break;

    all.push(...records);

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
 * Dispara sincronização retroativa no Paxtu 100 antes da extração (FR-2)
 */
export async function sincronizarRetroativo(cdAssociado: string, cookie?: string): Promise<boolean> {
  const sessionCookie = getCookie(cookie);
  try {
    const csrfToken = await getCsrfToken(sessionCookie);
    const res = await fetch(`${BASE_URL}/associado/associado/progressoes/sincronizar-retroativo`, {
      method: 'POST',
      headers: getHeaders(sessionCookie, {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-csrf-token': csrfToken,
      }),
      body: new URLSearchParams({
        associate_code: cdAssociado,
      }),
    });

    if (res.status === 401 || res.status === 419 || res.url.includes('/login')) {
      throw new PaxtuSessionExpiredError();
    }

    return res.ok;
  } catch (err: any) {
    if (err instanceof PaxtuSessionExpiredError) throw err;
    console.warn(`[Paxtu100] Sincronização retroativa falhou para ${cdAssociado}:`, err.message);
    return false;
  }
}

/**
 * Busca as competências de uma seção/ramo do associado
 */
export async function fetchCompetenciasAssociado(
  cdAssociado: string,
  branchId: number,
  cookie?: string
): Promise<any[]> {
  const sessionCookie = getCookie(cookie);
  const url = `${BASE_URL}/associado/associado/progressoes/competences/show?associate_code=${cdAssociado}&branch=${branchId}`;
  const res = await fetch(url, { headers: getHeaders(sessionCookie) });

  if (res.status === 401 || res.status === 419 || res.url.includes('/login')) {
    throw new PaxtuSessionExpiredError();
  }

  if (!res.ok) return [];
  const json = await res.json().catch(() => []);
  return Array.isArray(json) ? json : [];
}

/**
 * Busca as atividades de uma competência específica
 */
export async function fetchAtividadesCompetencia(
  cdAssociado: string,
  competenceId: number | string,
  cookie?: string
): Promise<any[]> {
  const sessionCookie = getCookie(cookie);
  const url = `${BASE_URL}/associado/associado/progressoes/competences/activities?associate_code=${cdAssociado}&competence_id=${competenceId}`;
  const res = await fetch(url, { headers: getHeaders(sessionCookie) });

  if (res.status === 401 || res.status === 419 || res.url.includes('/login')) {
    throw new PaxtuSessionExpiredError();
  }

  if (!res.ok) return [];
  const json: any = await res.json().catch(() => null);
  if (!json) return [];
  return Array.isArray(json) ? json : (json.activities || []);
}

/**
 * Busca as progressões do PA (Programa de Atividades) para o associado
 */
export async function fetchProgressao(
  cdAssociado: string,
  branchId?: number,
  cookie?: string
): Promise<Caminho[]> {
  const sessionCookie = getCookie(cookie);
  // 1. Sincronização retroativa prévia
  await sincronizarRetroativo(cdAssociado, sessionCookie);

  const branchesToQuery = branchId !== undefined ? [branchId] : [1, 2, 3, 4];
  const caminhosMap = new Map<string, { totalCount: number; data: Atividade[] }>();

  for (const branch of branchesToQuery) {
    try {
      const competences = await fetchCompetenciasAssociado(cdAssociado, branch, sessionCookie);
      if (competences.length === 0) continue;

      const validCompetences = competences.filter(
        (comp: any) => comp.tipo !== 'caminho_direto' && comp.id && !(typeof comp.id === 'string' && comp.id.startsWith('caminho_'))
      );

      await Promise.all(
        validCompetences.map(async (comp: any) => {
          const caminhoId = String(comp.caminho_id || comp.cd_caminho || '0');
          if (!caminhosMap.has(caminhoId)) {
            caminhosMap.set(caminhoId, { totalCount: 0, data: [] });
          }

          const activities = await fetchAtividadesCompetencia(cdAssociado, comp.id, sessionCookie);

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
    } catch (err: any) {
      if (err instanceof PaxtuSessionExpiredError) throw err;
      console.warn(`[Paxtu100] Erro ao buscar ramo ${branch} para ${cdAssociado}:`, err.message);
    }
  }

  return Array.from(caminhosMap.values());
}

/**
 * T025: Formaliza e tipa a extração dos IDs de especialidades conquistadas do perfil HTML
 */
export async function fetchEspecialidadesDoPerfil(
  cdAssociado: string,
  cookie?: string
): Promise<{ id: number }[]> {
  const sessionCookie = getCookie(cookie);
  let csrfToken = await getCsrfToken(sessionCookie);

  let profileRes = await fetch(`${BASE_URL}/associado/perfil`, {
    method: 'POST',
    headers: getHeaders(sessionCookie, {
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
    csrfToken = await getCsrfToken(sessionCookie, true);
    profileRes = await fetch(`${BASE_URL}/associado/perfil`, {
      method: 'POST',
      headers: getHeaders(sessionCookie, {
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

  if (profileRes.status === 401 || profileRes.status === 419 || profileRes.url.includes('/login')) {
    throw new PaxtuSessionExpiredError();
  }

  if (!profileRes.ok) {
    console.warn(`[Paxtu100] Perfil do associado ${cdAssociado} retornou HTTP ${profileRes.status}`);
    return [];
  }

  const html = await profileRes.text();
  const specialtyCards = [
    ...html.matchAll(/class="[^"]*specialty-card[^"]*"[^>]*data-specialty-id="(\d+)"/g),
  ];
  const uniqueIds = [...new Set(specialtyCards.map((m) => Number(m[1])))].filter((id) => !isNaN(id) && id > 0);

  return uniqueIds.map((id) => ({ id }));
}

/**
 * Busca os detalhes de uma especialidade individual do associado
 */
export async function fetchDetalhesEspecialidade(
  cdEspecialidade: string | number,
  cdAssociado: string,
  cookie?: string
): Promise<any | null> {
  const sessionCookie = getCookie(cookie);
  const url = `${BASE_URL}/associado/associado/progressoes/especialidades/${cdEspecialidade}/${cdAssociado}`;
  const res = await fetch(url, { headers: getHeaders(sessionCookie) });

  if (res.status === 401 || res.status === 419 || res.url.includes('/login')) {
    throw new PaxtuSessionExpiredError();
  }

  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json) return null;

  const itensList = Object.values(json.itens || {}).map((it: any) => ({
    cd_item: String(it.cd_item || ''),
    ds_item: it.ds_item || '',
    dt_item: it.dt_item || '',
    nr_nivel: Number(it.nr_nivel ?? json.nr_nivel ?? 0),
    check_escotista: it.dt_item ? 'confirmadoEscotista' : '',
    check_jovem: it.dt_item ? 'feitoJovem' : '',
  }));

  const concluidos = itensList.filter((it: any) => Boolean(it.dt_item)).length;

  return {
    cd_especialidade: String(cdEspecialidade),
    ds_especialidade: json.ds_especialidade || `Especialidade ${cdEspecialidade}`,
    nr_nivel: Number(json.nr_nivel ?? 0),
    dt_nivel: json.dt_nivel || null,
    qtd_itens_concluidos: concluidos,
    itens_conquistados: itensList,
  };
}

/**
 * Busca todas as especialidades e seus itens detalhados para o associado
 */
export async function fetchEspecialidadesCompletasAssociado(
  cdAssociado: string,
  cookie?: string
): Promise<any[]> {
  const sessionCookie = getCookie(cookie);
  try {
    const especialidadesList = await fetchEspecialidadesDoPerfil(cdAssociado, sessionCookie);
    if (especialidadesList.length === 0) return [];

    const results = await Promise.all(
      especialidadesList.map((esp) => fetchDetalhesEspecialidade(esp.id, cdAssociado, sessionCookie))
    );

    return results.filter(Boolean);
  } catch (err: any) {
    if (err instanceof PaxtuSessionExpiredError) throw err;
    console.warn(`[Paxtu100] Erro ao buscar especialidades completas para ${cdAssociado}:`, err.message);
    return [];
  }
}
