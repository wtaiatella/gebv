import { prisma } from '../prisma';
import {
  Ramo,
  TipoAcaoPn,
  ModalidadePn,
  OperacaoEquivalencia,
  OrigemConquista,
  StatusAssociado,
  CategoriaAssociado,
  Prisma,
} from '@prisma/client';
import { normalizeRamo } from '../ramo';

export interface ResumoBlocoTransicionado {
  bloco_id: number;
  nm_bloco: string;
  nm_eixo: string;
  eixo_id: number;
  ds_intencionalidade: string;
  nr_acoes_fixas_obrigatorias: number;
  nr_acoes_variaveis_exigidas: number;
  nr_fixas_concluidas: number;
  nr_variaveis_concluidas: number;
  pct_conclusao: number;
  fl_concluido: boolean;
}

export type DetalhesRegra =
  | RegraProgressoes
  | RegraEspecialidade
  | RegraSemantico
  | RegraTodas
  | RegraQntMinima
  | { tipo: 'SEM_EQUIVALENCIA' }
  | null; // null ou { tipo: 'SEM_EQUIVALENCIA' } representa SEM_EQUIVALENCIA

export interface RegraProgressoes {
  tipo: 'PROGRESSOES';
  item: {
    pa_atividade_id: number;
    identificacao?: string;
    ds_atividade?: string;
  };
}

export interface RegraEspecialidade {
  tipo: 'ESPECIALIDADE';
  pa_especialidade_id?: number;
  nm_especialidade?: string;
  nivel_minimo: number; // 1, 2 ou 3
}

export interface RegraSemantico {
  tipo: 'SEMANTICO';
  logica: 'OR' | 'AND'; // OR = "Ao menos uma"; AND = "Todas"
  itens: Array<{
    pa_atividade_id: number;
    identificacao?: string;
    score_capturado: number;
  }>;
}

// Operações-contêiner: proibido auto-aninhamento
export type SubBlocoValidoParaTodas =
  | RegraProgressoes
  | RegraEspecialidade
  | RegraSemantico
  | RegraQntMinima; // TODAS NUNCA contém TODAS

export interface RegraTodas {
  tipo: 'TODAS';
  blocos: SubBlocoValidoParaTodas[];
}

export type SubBlocoValidoParaQntMinima =
  | RegraProgressoes
  | RegraEspecialidade
  | RegraSemantico
  | RegraTodas; // QNT_MINIMA NUNCA contém QNT_MINIMA

export interface RegraQntMinima {
  tipo: 'QNT_MINIMA';
  quantidade_minima: number; // Inteiro >= 1
  blocos: SubBlocoValidoParaQntMinima[];
}

export interface ValidacaoRegraResult {
  valido: boolean;
  erro?: string;
}

export function validarDetalhesRegra(regra: unknown, parentType?: string): ValidacaoRegraResult {
  if (regra === null || regra === undefined) {
    return { valido: true };
  }

  if (typeof regra !== 'object') {
    return { valido: false, erro: 'Regra deve ser um objeto JSON' };
  }

  const r = regra as any;

  // Formato legado com colunas planas
  if (!r.tipo && (r.origem_pistas_ueb || r.origem_rumo_ueb || r.origem_especialidades)) {
    return { valido: true };
  }

  switch (r.tipo) {
    case 'PROGRESSOES': {
      if (!r.item || typeof r.item.pa_atividade_id !== 'number') {
        return { valido: false, erro: 'Regra PROGRESSOES requer item com pa_atividade_id numérico' };
      }
      return { valido: true };
    }
    case 'ESPECIALIDADE': {
      if (typeof r.pa_especialidade_id !== 'number') {
        return { valido: false, erro: 'Regra ESPECIALIDADE requer pa_especialidade_id numérico' };
      }
      const nivel = Number(r.nivel_minimo);
      if (isNaN(nivel) || nivel < 1 || nivel > 3) {
        return { valido: false, erro: 'Nível mínimo de especialidade deve ser entre 1 e 3' };
      }
      return { valido: true };
    }
    case 'SEMANTICO': {
      if (r.logica !== 'OR' && r.logica !== 'AND') {
        return { valido: false, erro: 'Regra SEMANTICO requer lógica OR ou AND' };
      }
      if (!Array.isArray(r.itens) || r.itens.length === 0) {
        return { valido: false, erro: 'Regra SEMANTICO requer lista de itens não vazia' };
      }
      for (const it of r.itens) {
        if (!it || typeof it.pa_atividade_id !== 'number') {
          return { valido: false, erro: 'Item semântico inválido: pa_atividade_id ausente' };
        }
      }
      return { valido: true };
    }
    case 'TODAS': {
      if (parentType === 'TODAS') {
        return { valido: false, erro: 'Auto-aninhamento proibido: TODAS não pode conter TODAS' };
      }
      if (!Array.isArray(r.blocos) || r.blocos.length === 0) {
        return { valido: false, erro: 'Regra TODAS requer ao menos um sub-bloco' };
      }
      for (const sub of r.blocos) {
        if (sub?.tipo === 'TODAS') {
          return { valido: false, erro: 'Auto-aninhamento proibido: TODAS não pode conter TODAS' };
        }
        const subVal = validarDetalhesRegra(sub, 'TODAS');
        if (!subVal.valido) return subVal;
      }
      return { valido: true };
    }
    case 'QNT_MINIMA': {
      if (parentType === 'QNT_MINIMA') {
        return { valido: false, erro: 'Auto-aninhamento proibido: QNT_MINIMA não pode conter QNT_MINIMA' };
      }
      const q = Number(r.quantidade_minima);
      if (isNaN(q) || q < 1) {
        return { valido: false, erro: 'quantidade_minima deve ser um número inteiro >= 1' };
      }
      if (!Array.isArray(r.blocos) || r.blocos.length === 0) {
        return { valido: false, erro: 'Regra QNT_MINIMA requer lista de blocos' };
      }
      if (r.blocos.length < q) {
        return { valido: false, erro: `quantidade_minima (${q}) não pode ser maior que o total de blocos (${r.blocos.length})` };
      }
      for (const sub of r.blocos) {
        if (sub?.tipo === 'QNT_MINIMA') {
          return { valido: false, erro: 'Auto-aninhamento proibido: QNT_MINIMA não pode conter QNT_MINIMA' };
        }
        const subVal = validarDetalhesRegra(sub, 'QNT_MINIMA');
        if (!subVal.valido) return subVal;
      }
      return { valido: true };
    }
    default:
      return { valido: false, erro: `Tipo de regra desconhecido: ${r.tipo}` };
  }
}

export function gerarDescricaoOrigem(regra: DetalhesRegra | any, operacao?: OperacaoEquivalencia | string): string {
  if (!regra || operacao === 'SEM_EQUIVALENCIA' || operacao === OperacaoEquivalencia.SEM_EQUIVALENCIA) {
    return 'Sem equivalência direta mapeada';
  }

  // Compatibilidade com payload legado em detalhes_regra
  if (!regra.tipo && (regra.origem_pistas_ueb || regra.origem_rumo_ueb || regra.origem_especialidades)) {
    const parts: string[] = [];
    for (const p of regra.origem_pistas_ueb || []) parts.push(`Pista ${p}`);
    for (const r of regra.origem_rumo_ueb || []) parts.push(`Rumo ${r}`);
    for (const e of regra.origem_especialidades || []) parts.push(`Esp. ${e} (N${regra.nivel_min_especialidade || 1})`);
    const sep = (regra.min_count && regra.min_count > 1) ? ' OU ' : ' | ';
    return parts.join(sep) || 'Sem equivalência direta mapeada';
  }

  switch (regra.tipo) {
    case 'PROGRESSOES': {
      const ident = regra.item?.identificacao || `Atividade ${regra.item?.pa_atividade_id}`;
      return regra.item?.ds_atividade ? `${ident} - ${regra.item.ds_atividade}` : ident;
    }
    case 'ESPECIALIDADE': {
      const nome = regra.nm_especialidade || `Especialidade ID ${regra.pa_especialidade_id}`;
      return `${nome} (Nível ${regra.nivel_minimo})`;
    }
    case 'SEMANTICO': {
      const itensStr = (regra.itens || [])
        .map((i: any) => i.identificacao || `Atividade ${i.pa_atividade_id}`)
        .join(regra.logica === 'AND' ? ' E ' : ' OU ');
      return `Semântico [${regra.logica}]: ${itensStr}`;
    }
    case 'TODAS': {
      const sub = (regra.blocos || []).map((b: any) => gerarDescricaoOrigem(b)).join(' E ');
      return `Todas: (${sub})`;
    }
    case 'QNT_MINIMA': {
      const sub = (regra.blocos || []).map((b: any) => gerarDescricaoOrigem(b)).join(' OU ');
      return `Mínimo de ${regra.quantidade_minima}: (${sub})`;
    }
    default:
      return 'Sem equivalência direta mapeada';
  }
}

export interface ContextoAvaliacaoTransicao {
  atividadesPaConcluidasIds: Set<number>;
  atividadesPaIdentificacoes: Set<string>;
  especialidadesPa: Map<string, number>;
  especialidadesPaIds?: Map<number, number>;
  especialidadesPn?: Map<number, number>;
  especialidadesPnNomes?: Map<string, number>;
}

export interface ResultadoAvaliacaoRegra {
  atingido: boolean;
  itensConquistados: string[];
}

export function avaliarRegraRecursiva(
  regra: DetalhesRegra | any,
  contexto: ContextoAvaliacaoTransicao
): ResultadoAvaliacaoRegra {
  if (!regra) {
    return { atingido: false, itensConquistados: [] };
  }

  // Compatibilidade com formato legado armazenado no JSON
  if (!regra.tipo && (regra.origem_pistas_ueb || regra.origem_rumo_ueb || regra.origem_especialidades)) {
    const refsPistas: string[] = regra.origem_pistas_ueb || [];
    const refsRumo: string[] = regra.origem_rumo_ueb || [];
    const refsEsp: string[] = regra.origem_especialidades || [];
    const minCount: number = regra.min_count || 1;
    const nivelMinEsp: number = regra.nivel_min_especialidade || 1;

    let matchCount = 0;
    const matched: string[] = [];

    for (const p of refsPistas) {
      if (contexto.atividadesPaIdentificacoes.has(p)) {
        matchCount++;
        matched.push(`Pista ${p}`);
      }
    }
    for (const r of refsRumo) {
      if (contexto.atividadesPaIdentificacoes.has(r)) {
        matchCount++;
        matched.push(`Rumo ${r}`);
      }
    }
    for (const e of refsEsp) {
      const normE = normalizeEspName(e);
      let lvl = contexto.especialidadesPa.get(normE) || 0;
      if (!lvl) {
        for (const [key, val] of contexto.especialidadesPa.entries()) {
          if (key.includes(normE) || normE.includes(key)) {
            lvl = val;
            break;
          }
        }
      }
      if (lvl >= nivelMinEsp) {
        matchCount++;
        matched.push(`Esp. ${e} (N${lvl})`);
      }
    }

    const totalRefs = refsPistas.length + refsRumo.length + refsEsp.length;
    const atingido = totalRefs > 0 && matchCount >= minCount;
    return { atingido, itensConquistados: matched };
  }

  switch (regra.tipo) {
    case 'PROGRESSOES': {
      const ativId = regra.item?.pa_atividade_id;
      const ident = regra.item?.identificacao;
      const concluidoPorId = typeof ativId === 'number' && contexto.atividadesPaConcluidasIds.has(ativId);
      const concluidoPorIdent = ident ? contexto.atividadesPaIdentificacoes.has(ident) : false;

      if (concluidoPorId || concluidoPorIdent) {
        return {
          atingido: true,
          itensConquistados: [ident || `Atividade ${ativId}`],
        };
      }
      return { atingido: false, itensConquistados: [] };
    }

    case 'ESPECIALIDADE': {
      const espId = regra.pa_especialidade_id;
      const nivelMin = regra.nivel_minimo || 1;
      let nivelObtido = 0;

      if (typeof espId === 'number' && contexto.especialidadesPaIds?.has(espId)) {
        nivelObtido = contexto.especialidadesPaIds.get(espId) || 0;
      } else if (regra.nm_especialidade) {
        const norm = normalizeEspName(regra.nm_especialidade);
        nivelObtido = contexto.especialidadesPa.get(norm) || 0;
        if (!nivelObtido) {
          for (const [key, val] of contexto.especialidadesPa.entries()) {
            if (key.includes(norm) || norm.includes(key)) {
              nivelObtido = val;
              break;
            }
          }
        }
      }

      if (nivelObtido >= nivelMin) {
        return {
          atingido: true,
          itensConquistados: [`Esp. ${regra.nm_especialidade || espId} (N${nivelObtido})`],
        };
      }
      return { atingido: false, itensConquistados: [] };
    }

    case 'SEMANTICO': {
      const itens = regra.itens || [];
      const concluidos: string[] = [];

      for (const item of itens) {
        const ativId = item.pa_atividade_id;
        const ident = item.identificacao;
        const porId = typeof ativId === 'number' && contexto.atividadesPaConcluidasIds.has(ativId);
        const porIdent = ident ? contexto.atividadesPaIdentificacoes.has(ident) : false;
        if (porId || porIdent) {
          concluidos.push(ident || `Atividade ${ativId}`);
        }
      }

      if (regra.logica === 'AND') {
        const atingido = itens.length > 0 && concluidos.length === itens.length;
        return { atingido, itensConquistados: concluidos };
      } else {
        const atingido = concluidos.length > 0;
        return { atingido, itensConquistados: concluidos };
      }
    }

    case 'TODAS': {
      const blocos = regra.blocos || [];
      if (blocos.length === 0) return { atingido: false, itensConquistados: [] };

      const subResultados: ResultadoAvaliacaoRegra[] = blocos.map((b: any) => avaliarRegraRecursiva(b, contexto));
      const todosAtingidos = subResultados.every((r: ResultadoAvaliacaoRegra) => r.atingido);
      const todosItens = subResultados.flatMap((r: ResultadoAvaliacaoRegra) => r.itensConquistados);

      return {
        atingido: todosAtingidos,
        itensConquistados: todosItens,
      };
    }

    case 'QNT_MINIMA': {
      const blocos = regra.blocos || [];
      const qMin = regra.quantidade_minima || 1;
      if (blocos.length === 0) return { atingido: false, itensConquistados: [] };

      const subResultados: ResultadoAvaliacaoRegra[] = blocos.map((b: any) => avaliarRegraRecursiva(b, contexto));
      const subAtingidos = subResultados.filter((r: ResultadoAvaliacaoRegra) => r.atingido);
      const atingido = subAtingidos.length >= qMin;
      const itens = subAtingidos.flatMap((r: ResultadoAvaliacaoRegra) => r.itensConquistados);

      return {
        atingido,
        itensConquistados: itens,
      };
    }

    default:
      return { atingido: false, itensConquistados: [] };
  }
}

export function extrairCamposLegados(detalhes: any) {
  if (!detalhes || typeof detalhes !== 'object') {
    return {
      origem_pistas_ueb: [],
      origem_rumo_ueb: [],
      origem_especialidades: [],
      nivel_min_especialidade: 1,
      min_count: 1,
    };
  }
  return {
    origem_pistas_ueb: Array.isArray(detalhes.origem_pistas_ueb) ? detalhes.origem_pistas_ueb : [],
    origem_rumo_ueb: Array.isArray(detalhes.origem_rumo_ueb) ? detalhes.origem_rumo_ueb : [],
    origem_especialidades: Array.isArray(detalhes.origem_especialidades) ? detalhes.origem_especialidades : [],
    nivel_min_especialidade: typeof detalhes.nivel_min_especialidade === 'number' ? detalhes.nivel_min_especialidade : 1,
    min_count: typeof detalhes.min_count === 'number' ? detalhes.min_count : 1,
  };
}

/**
 * Extrai tags de especialidades PN para as 15 ações variáveis dos 18 blocos
 */
export function extrairEspecialidadesPnDaAcao(ds_acao: string): {
  nivel_exigido: number;
  especialidades: string[];
} | null {
  if (!ds_acao) return null;
  const match = ds_acao.match(/Conquistar ao menos uma das seguintes especialidades no nível\s*(\d)\+:\s*(.+)$/i);
  if (!match) return null;

  const nivel_exigido = parseInt(match[1], 10) || 1;
  const rawList = match[2];
  const especialidades = rawList
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    nivel_exigido,
    especialidades,
  };
}

export interface RefAtividadePaItem {
  cd_ueb: string;
  identificacao?: string;
  ds_atividade: string;
  fl_concluido_paxtu: boolean;
  tipo: 'Pista' | 'Rumo' | 'Especialidade' | 'Intro';
}

export interface RefEspecialidadePaItem {
  nm_especialidade: string;
  nivel_exigido: number;
  fl_conquistada: boolean;
  nivel_conquistado: number;
  dt_nivel?: string | null;
}

export interface AcaoProgressoItem {
  id: number;
  bloco_id: number;
  tp_acao: 'Fixa' | 'Variável' | 'Variavel' | 'Substitui Variável' | 'Substitutiva' | string;
  modalidade: 'Básico' | 'Ar' | 'Mar' | 'PA' | 'Substitutiva' | string;
  ds_acao: string;
  regra_qtd_texto: string | null;
  nr_ordem: number;
  // Status do jovem
  fl_concluido: boolean;
  origem: string | null;
  dt_conclusao: string | null;
  ds_observacao: string | null;
  // Regra de equivalência vinculada
  regra_id: number | null;
  operacao: string | null;
  descricao_origem: string | null;
  detalhes_regra?: DetalhesRegra | any;
  especialidades_pn_tags?: Array<{
    nome: string;
    nivel_exigido: number;
    fl_conquistada: boolean;
    nivel_conquistado: number;
  }>;
  origem_pistas_ueb: string[];
  origem_rumo_ueb: string[];
  origem_especialidades: string[];
  nivel_min_especialidade: number;
  min_count: number;
  fl_requer_validacao_manual: boolean;
  fl_calculado_match: boolean;
  itens_conquistados_match: string[];
  itens_origem_detalhados: RefAtividadePaItem[];
  especialidades_origem_detalhadas: RefEspecialidadePaItem[];
}

export interface ProgressoCompletoJovem {
  associado: {
    cd_associado: string;
    nm_associado: string;
    nr_registro: string;
    nr_registro_formatado: string;
    ds_ramo: string;
  };
  ramo: string;
  eixos: Array<{ id: number; nm_eixo: string; nr_ordem: number }>;
  blocos: ResumoBlocoTransicionado[];
  acoes_por_bloco: Record<number, AcaoProgressoItem[]>;
  estatisticas: {
    total_acoes: number;
    total_concluidas: number;
    total_blocos: number;
    blocos_concluidos: number;
    pct_global: number;
  };
}

export function normalizeEspName(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Recalcula o status e percentual de conclusão dos blocos de um associado
 */
export async function recalcularStatusBlocos(
  client: DbClient,
  cd_associado: string,
  ds_ramo: string | Ramo = Ramo.ESCOTEIRO
) {
  const ramo = normalizeRamo(ds_ramo);

  // Carrega blocos do ramo
  const blocos = await client.pnBloco.findMany({
    where: { ds_ramo: ramo },
    include: { eixo: true },
    orderBy: [
      { eixo: { nr_ordem: 'asc' } },
      { nr_ordem: 'asc' },
    ],
  });

  // Carrega todas as ações do ramo com status de conclusão do associado
  const acoes = await client.pnAcaoEducativa.findMany({
    where: { ds_ramo: ramo },
    include: {
      progressoes_pn: {
        where: { cd_associado },
      },
    },
  });

  const acoesPorBloco = new Map<
    number,
    { fixasTotal: number; fixasDone: number; varTotal: number; varDone: number; paDone: number; subDone: number }
  >();

  for (const b of blocos) {
    acoesPorBloco.set(b.id, { fixasTotal: 0, fixasDone: 0, varTotal: 0, varDone: 0, paDone: 0, subDone: 0 });
  }

  for (const a of acoes) {
    const bObj = acoesPorBloco.get(a.bloco_id);
    if (bObj) {
      const isDone = a.progressoes_pn.length > 0 && a.progressoes_pn[0].fl_concluido;
      if (a.tp_acao === TipoAcaoPn.FIXA) {
        bObj.fixasTotal++;
        if (isDone) bObj.fixasDone++;
      } else if (a.tp_acao === TipoAcaoPn.SUBSTITUTIVA) {
        if (isDone) bObj.subDone++;
      } else if (a.tp_acao === TipoAcaoPn.PA) {
        if (isDone) bObj.paDone++;
      } else {
        bObj.varTotal++;
        if (isDone) bObj.varDone++;
      }
    }
  }

  let totalBlocosConcluidos = 0;
  for (const b of blocos) {
    const stats = acoesPorBloco.get(b.id)!;
    const fixasReq = b.nr_acoes_fixas_obrigatorias;
    const varReq = b.nr_acoes_variaveis_exigidas;
    const totalReq = fixasReq + varReq;

    const varEfetivas = Math.min(stats.varDone, varReq);
    const pct = totalReq > 0
      ? Math.min(100, Math.round(((stats.fixasDone + varEfetivas) / totalReq) * 10000) / 100)
      : 0;

    const isConcluido = stats.fixasDone >= fixasReq && stats.varDone >= varReq;
    if (isConcluido) totalBlocosConcluidos++;

    await client.progressaoBlocos.upsert({
      where: {
        cd_associado_bloco_id: {
          cd_associado,
          bloco_id: b.id,
        },
      },
      create: {
        cd_associado,
        bloco_id: b.id,
        fl_concluido: isConcluido,
        nr_fixas_concluidas: stats.fixasDone,
        nr_variaveis_concluidas: stats.varDone,
        pct_conclusao: pct,
      },
      update: {
        fl_concluido: isConcluido,
        nr_fixas_concluidas: stats.fixasDone,
        nr_variaveis_concluidas: stats.varDone,
        pct_conclusao: pct,
      },
    });
  }

  return { totalBlocos: blocos.length, totalBlocosConcluidos };
}

/**
 * Retorna a visão completa do Novo Programa para um associado
 */
export async function getProgressoNovoModelo(
  cd_associado: string,
  ds_ramo: string | Ramo = Ramo.ESCOTEIRO
): Promise<ProgressoCompletoJovem> {
  // 1. Dados do Associado
  const associado = await prisma.associado.findUnique({
    where: { cd_associado },
  });

  if (!associado) {
    throw new Error(`Associado ${cd_associado} não encontrado.`);
  }

  const ramo = normalizeRamo(ds_ramo || associado.ds_ramo || Ramo.ESCOTEIRO);

  // 2. Histórico de atividades do PA concluídas pelo jovem (para calcular equivalência em tempo real)
  const oldActivities = await prisma.progressaoPa.findMany({
    where: {
      cd_associado,
      concluida: true,
    },
    include: {
      atividade: {
        include: {
          competencia: {
            include: {
              caminho: true,
            },
          },
        },
      },
    },
  });

  const completedPistas = new Set<string>();
  const completedRumo = new Set<string>();

  for (const row of oldActivities) {
    const caminhoPaxtu = row.atividade?.cd_caminho_paxtu || row.atividade?.competencia?.caminho?.cd_caminho_paxtu || '';
    const nrOrd = row.atividade?.nr_ordenacao !== null && row.atividade?.nr_ordenacao !== undefined ? String(row.atividade.nr_ordenacao) : '';
    const ident = row.atividade?.identificacao || '';
    const numOnly = ident.replace(/\D/g, '') || nrOrd;

    if (caminhoPaxtu === '4' || caminhoPaxtu === '5' || ident.startsWith('P')) {
      if (numOnly) completedPistas.add(numOnly);
      if (nrOrd) completedPistas.add(nrOrd);
      if (ident) completedPistas.add(ident);
    }
    if (caminhoPaxtu === '6' || ident.startsWith('R')) {
      if (numOnly) completedRumo.add(numOnly);
      if (nrOrd) completedRumo.add(nrOrd);
      if (ident) completedRumo.add(ident);
    }
  }

  // Carrega histórico de especialidades conquistadas pelo jovem (PA)
  const espList = await prisma.progressaoEspecialidadePa.findMany({
    where: { cd_associado },
  });

  const scoutEspMap = new Map<
    string,
    { cd_especialidade: string; ds_especialidade: string; nr_nivel: number; dt_nivel: string | null }
  >();

  for (const r of espList) {
    scoutEspMap.set(normalizeEspName(r.ds_especialidade), {
      cd_especialidade: r.cd_especialidade,
      ds_especialidade: r.ds_especialidade,
      nr_nivel: Number(r.nr_nivel) || 0,
      dt_nivel: r.dt_nivel ? r.dt_nivel.toISOString() : null,
    });
  }

  // Carrega histórico de especialidades conquistadas pelo jovem (PN)
  const espPnList = await prisma.progressaoEspecialidadePn.findMany({
    where: { cd_associado },
    include: { especialidade: true },
  });
  const scoutEspPnMap = new Map<number, number>();
  const scoutEspPnNameMap = new Map<string, number>();
  for (const ep of espPnList) {
    scoutEspPnMap.set(ep.especialidade_id, ep.nr_nivel);
    if (ep.especialidade?.ds_especialidade) {
      scoutEspPnNameMap.set(normalizeEspName(ep.especialidade.ds_especialidade), ep.nr_nivel);
    }
  }

  const atividadesPaConcluidasIds = new Set<number>();
  for (const row of oldActivities) {
    if (row.atividade_id) atividadesPaConcluidasIds.add(row.atividade_id);
  }

  const contextoAvaliacao: ContextoAvaliacaoTransicao = {
    atividadesPaConcluidasIds,
    atividadesPaIdentificacoes: new Set([...completedPistas, ...completedRumo]),
    especialidadesPa: new Map(Array.from(scoutEspMap.entries()).map(([k, v]) => [k, v.nr_nivel])),
    especialidadesPaIds: new Map(Array.from(scoutEspMap.values()).map((v) => [parseInt(v.cd_especialidade, 10), v.nr_nivel])),
    especialidadesPn: scoutEspPnMap,
    especialidadesPnNomes: scoutEspPnNameMap,
  };

  // 3. Eixos e Blocos com Status
  const eixos = await prisma.pnEixo.findMany({
    where: { ds_ramo: ramo },
    orderBy: { nr_ordem: 'asc' },
  });

  const blocos = await prisma.pnBloco.findMany({
    where: { ds_ramo: ramo },
    include: {
      eixo: true,
      status_jovens: {
        where: { cd_associado },
      },
    },
    orderBy: [
      { eixo: { nr_ordem: 'asc' } },
      { nr_ordem: 'asc' },
    ],
  });

  // 4. Ações e Regras de Equivalência vinculadas
  const acoes = await prisma.pnAcaoEducativa.findMany({
    where: { ds_ramo: ramo },
    include: {
      regra: true,
      progressoes_pn: {
        where: { cd_associado },
      },
    },
    orderBy: { nr_ordem: 'asc' },
  });

  // 5. Catálogo de atividades PA para descrições e identificação
  const paAtivList = await prisma.paAtividade.findMany({
    where: { ds_ramo: ramo },
    include: {
      competencia: {
        include: {
          caminho: true,
        },
      },
    },
  });

  const paPistasMap = new Map<string, { identificacao: string; ds_atividade: string }>();
  const paRumoMap = new Map<string, { identificacao: string; ds_atividade: string }>();

  for (const row of paAtivList) {
    const caminhoPaxtu = row.cd_caminho_paxtu || row.competencia?.caminho?.cd_caminho_paxtu || '';
    const nrOrd = row.nr_ordenacao !== null && row.nr_ordenacao !== undefined ? String(row.nr_ordenacao) : '';
    const ident = row.identificacao || (caminhoPaxtu === '6' ? `RT-${nrOrd}` : `PT-${nrOrd}`);
    const numOnly = ident.replace(/\D/g, '') || nrOrd;

    if (caminhoPaxtu === '4' || caminhoPaxtu === '5' || ident.startsWith('P')) {
      const item = {
        identificacao: ident,
        ds_atividade: row.ds_atividade,
      };
      if (numOnly) paPistasMap.set(numOnly, item);
      if (nrOrd) paPistasMap.set(nrOrd, item);
      paPistasMap.set(ident, item);
    } else if (caminhoPaxtu === '6' || ident.startsWith('R')) {
      const item = {
        identificacao: ident,
        ds_atividade: row.ds_atividade,
      };
      if (numOnly) paRumoMap.set(numOnly, item);
      if (nrOrd) paRumoMap.set(nrOrd, item);
      paRumoMap.set(ident, item);
    }
  }

  const blocosResumo: ResumoBlocoTransicionado[] = blocos.map((b) => {
    const status = b.status_jovens[0];
    return {
      bloco_id: b.id,
      nm_bloco: b.nm_bloco,
      nm_eixo: b.eixo.nm_eixo,
      eixo_id: b.eixo_id,
      ds_intencionalidade: b.ds_intencionalidade,
      nr_acoes_fixas_obrigatorias: b.nr_acoes_fixas_obrigatorias,
      nr_acoes_variaveis_exigidas: b.nr_acoes_variaveis_exigidas,
      nr_fixas_concluidas: status?.nr_fixas_concluidas || 0,
      nr_variaveis_concluidas: status?.nr_variaveis_concluidas || 0,
      pct_conclusao: status ? Number(status.pct_conclusao) : 0,
      fl_concluido: Boolean(status?.fl_concluido),
    };
  });

  const acoesPorBloco: Record<number, AcaoProgressoItem[]> = {};
  for (const b of blocos) {
    acoesPorBloco[b.id] = [];
  }

  let totalAcoes = 0;
  let totalConcluidas = 0;

  for (const a of acoes) {
    totalAcoes++;
    const prog = a.progressoes_pn[0];
    const flConcluido = Boolean(prog?.fl_concluido);
    if (flConcluido) totalConcluidas++;

    const regra = a.regra;
    const legado = extrairCamposLegados(regra?.detalhes_regra);

    // Extrai tags de especialidades PN (US4)
    const parsedEspPn = extrairEspecialidadesPnDaAcao(a.ds_acao);
    let especialidadesPnTags: Array<{
      nome: string;
      nivel_exigido: number;
      fl_conquistada: boolean;
      nivel_conquistado: number;
    }> | undefined = undefined;

    let flEspPnConquistada = false;

    if (parsedEspPn) {
      especialidadesPnTags = parsedEspPn.especialidades.map((nomeEsp) => {
        const norm = normalizeEspName(nomeEsp);
        let nivelObtido = scoutEspPnNameMap.get(norm) || 0;
        if (!nivelObtido) {
          for (const [key, val] of scoutEspPnNameMap.entries()) {
            if (key.includes(norm) || norm.includes(key)) {
              nivelObtido = val;
              break;
            }
          }
        }
        const conquistada = nivelObtido >= parsedEspPn.nivel_exigido;
        if (conquistada) flEspPnConquistada = true;
        return {
          nome: nomeEsp,
          nivel_exigido: parsedEspPn.nivel_exigido,
          fl_conquistada: conquistada,
          nivel_conquistado: nivelObtido,
        };
      });
    }

    // Avaliação recursiva de regras
    const avaliacao = regra
      ? avaliarRegraRecursiva(regra.detalhes_regra, contextoAvaliacao)
      : { atingido: false, itensConquistados: [] };

    const flCalculadoMatch = avaliacao.atingido || flEspPnConquistada;
    const matchedItems: string[] = [...avaliacao.itensConquistados];
    if (flEspPnConquistada && especialidadesPnTags) {
      const espGanhos = especialidadesPnTags
        .filter((t) => t.fl_conquistada)
        .map((t) => `${t.nome} (N${t.nivel_conquistado})`);
      matchedItems.push(...espGanhos);
    }

    const itensDetalhados: RefAtividadePaItem[] = [];
    const especialidadesDetalhadas: RefEspecialidadePaItem[] = [];

    for (const p of legado.origem_pistas_ueb) {
      const isDone = completedPistas.has(p);
      const info = paPistasMap.get(p);
      const ident = info?.identificacao || `PT-${p}`;
      itensDetalhados.push({
        cd_ueb: p,
        identificacao: ident,
        ds_atividade: info?.ds_atividade || 'Atividade de Pistas',
        fl_concluido_paxtu: isDone,
        tipo: 'Pista',
      });
    }

    for (const r of legado.origem_rumo_ueb) {
      const isDone = completedRumo.has(r);
      const info = paRumoMap.get(r);
      const ident = info?.identificacao || `RT-${r}`;
      itensDetalhados.push({
        cd_ueb: r,
        identificacao: ident,
        ds_atividade: info?.ds_atividade || 'Atividade de Rumo',
        fl_concluido_paxtu: isDone,
        tipo: 'Rumo',
      });
    }

    for (const e of legado.origem_especialidades) {
      const normE = normalizeEspName(e);
      let scoutEsp = scoutEspMap.get(normE);
      if (!scoutEsp) {
        for (const [key, val] of scoutEspMap.entries()) {
          if (key.includes(normE) || normE.includes(key)) {
            scoutEsp = val;
            break;
          }
        }
      }

      const nivelObtido = scoutEsp ? scoutEsp.nr_nivel : 0;
      const isConquistada = nivelObtido >= legado.nivel_min_especialidade;

      especialidadesDetalhadas.push({
        nm_especialidade: e,
        nivel_exigido: legado.nivel_min_especialidade,
        fl_conquistada: isConquistada,
        nivel_conquistado: nivelObtido,
        dt_nivel: scoutEsp?.dt_nivel || null,
      });
    }

    let tpAcaoStr: string = a.tp_acao;
    if (a.tp_acao === TipoAcaoPn.FIXA) tpAcaoStr = 'Fixa';
    else if (a.tp_acao === TipoAcaoPn.VARIAVEL) tpAcaoStr = 'Variável';
    else if (a.tp_acao === TipoAcaoPn.SUBSTITUTIVA) tpAcaoStr = 'Substitutiva';
    else if (a.tp_acao === TipoAcaoPn.PA) tpAcaoStr = 'PA';

    let modalidadeStr: string = a.modalidade;
    if (a.modalidade === ModalidadePn.BASICO) modalidadeStr = 'Básico';
    else if (a.modalidade === ModalidadePn.AR) modalidadeStr = 'Ar';
    else if (a.modalidade === ModalidadePn.MAR) modalidadeStr = 'Mar';

    const item: AcaoProgressoItem = {
      id: a.id,
      bloco_id: a.bloco_id,
      tp_acao: tpAcaoStr,
      modalidade: modalidadeStr,
      ds_acao: a.ds_acao,
      regra_qtd_texto: a.regra_qtd_texto,
      nr_ordem: a.nr_ordem,
      fl_concluido: flConcluido,
      origem: prog?.origem || null,
      dt_conclusao: prog?.dt_conclusao ? prog.dt_conclusao.toISOString() : null,
      ds_observacao: prog?.ds_observacao || null,
      regra_id: regra?.id || null,
      operacao: regra?.operacao || null,
      descricao_origem: regra?.descricao_origem || null,
      detalhes_regra: regra?.detalhes_regra || null,
      especialidades_pn_tags: especialidadesPnTags,
      origem_pistas_ueb: legado.origem_pistas_ueb,
      origem_rumo_ueb: legado.origem_rumo_ueb,
      origem_especialidades: legado.origem_especialidades,
      nivel_min_especialidade: legado.nivel_min_especialidade,
      min_count: legado.min_count,
      fl_requer_validacao_manual: Boolean(regra?.fl_requer_validacao_manual),
      fl_calculado_match: flCalculadoMatch,
      itens_conquistados_match: matchedItems,
      itens_origem_detalhados: itensDetalhados,
      especialidades_origem_detalhadas: especialidadesDetalhadas,
    };

    if (acoesPorBloco[a.bloco_id]) {
      acoesPorBloco[a.bloco_id].push(item);
    }
  }

  const blocosConcluidos = blocosResumo.filter((b) => b.fl_concluido).length;
  const pctGlobal = totalAcoes > 0 ? Math.round((totalConcluidas / totalAcoes) * 10000) / 100 : 0;

  return {
    associado: {
      cd_associado: associado.cd_associado,
      nm_associado: associado.nm_associado,
      nr_registro: associado.nr_registro_formatado || '',
      nr_registro_formatado: associado.nr_registro_formatado || '',
      ds_ramo: associado.ds_ramo || ramo,
    },
    ramo,
    eixos: eixos.map((e) => ({ id: e.id, nm_eixo: e.nm_eixo, nr_ordem: e.nr_ordem })),
    blocos: blocosResumo,
    acoes_por_bloco: acoesPorBloco,
    estatisticas: {
      total_acoes: totalAcoes,
      total_concluidas: totalConcluidas,
      total_blocos: blocosResumo.length,
      blocos_concluidos: blocosConcluidos,
      pct_global: pctGlobal,
    },
  };
}

/**
 * Salva ou atualiza a conclusão de uma ação específica do jovem
 * Retorna { success: true, data: { acao, bloco } } e garante MANUAL_CHEFE na desmarcação
 */
export async function toggleAcaoNovoModelo(
  cd_associado: string,
  acao_id: number,
  fl_concluido: boolean,
  cd_escotista?: string,
  ds_observacao?: string,
  ds_ramo: string | Ramo = Ramo.ESCOTEIRO
) {
  const ramo = normalizeRamo(ds_ramo);

  return await prisma.$transaction(async (tx) => {
    let prog: any;
    if (fl_concluido) {
      prog = await tx.progressaoPn.upsert({
        where: { cd_associado_acao_id: { cd_associado, acao_id } },
        create: {
          cd_associado,
          acao_id,
          origem: OrigemConquista.MANUAL_CHEFE,
          fl_concluido: true,
          dt_conclusao: new Date(),
          cd_escotista_avaliador: cd_escotista || null,
          ds_observacao: ds_observacao || null,
        },
        update: {
          fl_concluido: true,
          origem: OrigemConquista.MANUAL_CHEFE,
          cd_escotista_avaliador: cd_escotista || undefined,
          ds_observacao: ds_observacao || undefined,
        },
      });
    } else {
      prog = await tx.progressaoPn.upsert({
        where: { cd_associado_acao_id: { cd_associado, acao_id } },
        create: {
          cd_associado,
          acao_id,
          origem: OrigemConquista.MANUAL_CHEFE,
          fl_concluido: false,
          ds_observacao: ds_observacao || null,
        },
        update: {
          fl_concluido: false,
          origem: OrigemConquista.MANUAL_CHEFE, // ADR-5: Regra de Ouro Simétrica
          ds_observacao: ds_observacao || undefined,
        },
      });
    }

    // Recalcula status dos blocos
    await recalcularStatusBlocos(tx, cd_associado, ramo);

    // Obtém dados do bloco recalculado
    const acaoInfo = await tx.pnAcaoEducativa.findUnique({
      where: { id: acao_id },
      select: { bloco_id: true },
    });

    let blocoData: any = null;
    if (acaoInfo?.bloco_id) {
      const blocoDb = await tx.pnBloco.findUnique({
        where: { id: acaoInfo.bloco_id },
        include: {
          status_jovens: {
            where: { cd_associado },
          },
        },
      });
      if (blocoDb) {
        const st = blocoDb.status_jovens[0];
        blocoData = {
          bloco_id: blocoDb.id,
          nm_bloco: blocoDb.nm_bloco,
          nr_fixas_concluidas: st?.nr_fixas_concluidas || 0,
          nr_variaveis_concluidas: st?.nr_variaveis_concluidas || 0,
          nr_acoes_fixas_obrigatorias: blocoDb.nr_acoes_fixas_obrigatorias,
          nr_acoes_variaveis_exigidas: blocoDb.nr_acoes_variaveis_exigidas,
          fl_concluido: Boolean(st?.fl_concluido),
          pct_conclusao: st ? Number(st.pct_conclusao) : 0,
        };
      }
    }

    return {
      success: true,
      data: {
        acao: {
          id: acao_id,
          fl_concluido: prog.fl_concluido,
          origem: prog.origem,
          dt_conclusao: prog.dt_conclusao ? prog.dt_conclusao.toISOString() : null,
          cd_escotista_avaliador: prog.cd_escotista_avaliador,
          ds_observacao: prog.ds_observacao,
        },
        bloco: blocoData,
      },
    };
  });
}

/**
 * Reseta o status de uma ação marcada manualmente pelo chefe
 * Rejeita com erro 400 se o item não for MANUAL_CHEFE
 */
export async function resetAcaoNovoModelo(
  cd_associado: string,
  acao_id: number,
  ds_ramo: string | Ramo = Ramo.ESCOTEIRO
) {
  const ramo = normalizeRamo(ds_ramo);

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.progressaoPn.findUnique({
      where: { cd_associado_acao_id: { cd_associado, acao_id } },
    });

    if (!existing) {
      throw new Error('Ação educativa não possui registro para este associado');
    }

    if (existing.origem !== OrigemConquista.MANUAL_CHEFE) {
      throw new Error('Este item foi concluído automaticamente por equivalência; não há marcação manual para desfazer.');
    }

    // Deleta o registro manual
    await tx.progressaoPn.delete({
      where: { cd_associado_acao_id: { cd_associado, acao_id } },
    });

    // Recalcula status dos blocos
    await recalcularStatusBlocos(tx, cd_associado, ramo);

    const acaoInfo = await tx.pnAcaoEducativa.findUnique({
      where: { id: acao_id },
      select: { bloco_id: true },
    });

    let blocoData: any = null;
    if (acaoInfo?.bloco_id) {
      const blocoDb = await tx.pnBloco.findUnique({
        where: { id: acaoInfo.bloco_id },
        include: {
          status_jovens: {
            where: { cd_associado },
          },
        },
      });
      if (blocoDb) {
        const st = blocoDb.status_jovens[0];
        blocoData = {
          bloco_id: blocoDb.id,
          nm_bloco: blocoDb.nm_bloco,
          nr_fixas_concluidas: st?.nr_fixas_concluidas || 0,
          nr_variaveis_concluidas: st?.nr_variaveis_concluidas || 0,
          nr_acoes_fixas_obrigatorias: blocoDb.nr_acoes_fixas_obrigatorias,
          nr_acoes_variaveis_exigidas: blocoDb.nr_acoes_variaveis_exigidas,
          fl_concluido: Boolean(st?.fl_concluido),
          pct_conclusao: st ? Number(st.pct_conclusao) : 0,
        };
      }
    }

    return {
      success: true,
      data: {
        acao: {
          id: acao_id,
          fl_concluido: false,
          origem: null,
          dt_conclusao: null,
          cd_escotista_avaliador: null,
          ds_observacao: null,
        },
        bloco: blocoData,
      },
    };
  });
}

/**
 * Salva em lote os status das ações de um bloco para o jovem ("SAVE All")
 */
export async function saveBlocoAcoesNovoModelo(
  cd_associado: string,
  bloco_id: number,
  acoes_status: Array<{ acao_id: number; fl_concluido: boolean }>,
  ds_ramo: string | Ramo = Ramo.ESCOTEIRO
) {
  const ramo = normalizeRamo(ds_ramo);

  return await prisma.$transaction(async (tx) => {
    for (const item of acoes_status) {
      if (item.fl_concluido) {
        await tx.progressaoPn.upsert({
          where: { cd_associado_acao_id: { cd_associado, acao_id: item.acao_id } },
          create: {
            cd_associado,
            acao_id: item.acao_id,
            origem: OrigemConquista.MANUAL_CHEFE,
            fl_concluido: true,
            dt_conclusao: new Date(),
          },
          update: {
            fl_concluido: true,
            origem: OrigemConquista.MANUAL_CHEFE,
          },
        });
      } else {
        await tx.progressaoPn.upsert({
          where: { cd_associado_acao_id: { cd_associado, acao_id: item.acao_id } },
          create: {
            cd_associado,
            acao_id: item.acao_id,
            origem: OrigemConquista.MANUAL_CHEFE,
            fl_concluido: false,
          },
          update: {
            fl_concluido: false,
            origem: OrigemConquista.MANUAL_CHEFE,
          },
        });
      }
    }

    await recalcularStatusBlocos(tx, cd_associado, ramo);
    return { success: true, count: acoes_status.length };
  });
}

/**
 * Executa o motor de transição/equivalência para um associado específico
 */
export async function processarTransicaoAssociado(
  cd_associado: string,
  ds_ramo?: string | Ramo
): Promise<ProgressoCompletoJovem> {
  const associado = await prisma.associado.findUnique({
    where: { cd_associado },
    select: { cd_associado: true, ds_ramo: true },
  });

  if (!associado) {
    throw new Error(`Associado ${cd_associado} não encontrado.`);
  }

  const ramo = normalizeRamo(ds_ramo || associado.ds_ramo || Ramo.ESCOTEIRO);

  await prisma.$transaction(async (tx) => {
    // 1. Carrega histórico de atividades concluídas pelo jovem no modelo antigo
    const oldActivities = await tx.progressaoPa.findMany({
      where: {
        cd_associado,
        concluida: true,
      },
      include: {
        atividade: {
          include: {
            competencia: {
              include: {
                caminho: true,
              },
            },
          },
        },
      },
    });

    const completedPistas = new Set<string>();
    const completedRumo = new Set<string>();
    const atividadesPaConcluidasIds = new Set<number>();

    for (const row of oldActivities) {
      if (row.atividade_id) atividadesPaConcluidasIds.add(row.atividade_id);
      const caminhoPaxtu = row.atividade?.cd_caminho_paxtu || row.atividade?.competencia?.caminho?.cd_caminho_paxtu || '';
      const nrOrd = row.atividade?.nr_ordenacao !== null && row.atividade?.nr_ordenacao !== undefined ? String(row.atividade.nr_ordenacao) : '';
      const ident = row.atividade?.identificacao || '';
      const numOnly = ident.replace(/\D/g, '') || nrOrd;

      if (caminhoPaxtu === '4' || caminhoPaxtu === '5' || ident.startsWith('P')) {
        if (numOnly) completedPistas.add(numOnly);
        if (nrOrd) completedPistas.add(nrOrd);
        if (ident) completedPistas.add(ident);
      }
      if (caminhoPaxtu === '6' || ident.startsWith('R')) {
        if (numOnly) completedRumo.add(numOnly);
        if (nrOrd) completedRumo.add(nrOrd);
        if (ident) completedRumo.add(ident);
      }
    }

    // 2. Carrega especialidades conquistadas pelo jovem (PA)
    const espList = await tx.progressaoEspecialidadePa.findMany({
      where: { cd_associado },
    });

    const scoutEspMap = new Map<string, number>();
    const scoutEspIdMap = new Map<number, number>();
    for (const r of espList) {
      scoutEspMap.set(normalizeEspName(r.ds_especialidade), Number(r.nr_nivel) || 0);
      const idNum = parseInt(r.cd_especialidade, 10);
      if (!isNaN(idNum)) {
        scoutEspIdMap.set(idNum, Number(r.nr_nivel) || 0);
      }
    }

    // 2b. Carrega especialidades conquistadas no PN
    const espPnList = await tx.progressaoEspecialidadePn.findMany({
      where: { cd_associado },
      include: { especialidade: true },
    });
    const scoutEspPnMap = new Map<number, number>();
    const scoutEspPnNameMap = new Map<string, number>();
    for (const ep of espPnList) {
      scoutEspPnMap.set(ep.especialidade_id, ep.nr_nivel);
      if (ep.especialidade?.ds_especialidade) {
        scoutEspPnNameMap.set(normalizeEspName(ep.especialidade.ds_especialidade), ep.nr_nivel);
      }
    }

    const contextoAvaliacao: ContextoAvaliacaoTransicao = {
      atividadesPaConcluidasIds,
      atividadesPaIdentificacoes: new Set([...completedPistas, ...completedRumo]),
      especialidadesPa: scoutEspMap,
      especialidadesPaIds: scoutEspIdMap,
      especialidadesPn: scoutEspPnMap,
      especialidadesPnNomes: scoutEspPnNameMap,
    };

    // 3. Carrega todas as regras de equivalência mapeadas para o ramo
    const regras = await tx.pnEquivalenciaRegra.findMany({
      where: {
        acao: {
          ds_ramo: ramo,
        },
      },
      include: {
        acao: true,
      },
    });

    // 4. Avalia quais ações do novo programa foram atingidas por equivalência
    const acoesConquistadasMap = new Map<number, string>();

    for (const regra of regras) {
      // Caso 1: As 15 ações de especialidades do PN (US4)
      const parsedEspPn = extrairEspecialidadesPnDaAcao(regra.acao.ds_acao);
      if (parsedEspPn) {
        let atingido = false;
        const conquistadas: string[] = [];
        for (const nomeEsp of parsedEspPn.especialidades) {
          const norm = normalizeEspName(nomeEsp);
          let nivelObtido = scoutEspPnNameMap.get(norm) || 0;
          if (!nivelObtido) {
            for (const [key, val] of scoutEspPnNameMap.entries()) {
              if (key.includes(norm) || norm.includes(key)) {
                nivelObtido = val;
                break;
              }
            }
          }
          if (nivelObtido >= parsedEspPn.nivel_exigido) {
            atingido = true;
            conquistadas.push(`${nomeEsp} (N${nivelObtido})`);
          }
        }
        if (atingido) {
          acoesConquistadasMap.set(
            regra.acao_pn_id,
            `Concedido automaticamente por Especialidade PN: ${conquistadas.join(', ')}`
          );
          continue;
        }
      }

      if (regra.operacao === OperacaoEquivalencia.SEM_EQUIVALENCIA) continue;

      // Caso 2: Avaliação recursiva padrão
      const resultado = avaliarRegraRecursiva(regra.detalhes_regra, contextoAvaliacao);
      if (resultado.atingido) {
        const itensDesc = resultado.itensConquistados.length > 0
          ? resultado.itensConquistados.join(', ')
          : (regra.descricao_origem || 'Itens equivalentes');
        acoesConquistadasMap.set(
          regra.acao_pn_id,
          `Equivalência com ${itensDesc} (${regra.descricao_origem || ''})`
        );
      }
    }

    // 5. Salva as conquistas em progressao_pn respeitando MANUAL_CHEFE
    const progExistentes = await tx.progressaoPn.findMany({
      where: {
        cd_associado,
        acao_id: { in: Array.from(acoesConquistadasMap.keys()) },
      },
    });
    const progExistenteMap = new Map(progExistentes.map((p) => [p.acao_id, p]));

    for (const [acaoId, motivo] of acoesConquistadasMap.entries()) {
      const existente = progExistenteMap.get(acaoId);
      // Se já foi marcada/desmarcada manualmente por chefe, NÃO sobrescrever!
      if (existente && existente.origem === OrigemConquista.MANUAL_CHEFE) {
        continue;
      }

      await tx.progressaoPn.upsert({
        where: {
          cd_associado_acao_id: {
            cd_associado,
            acao_id: acaoId,
          },
        },
        create: {
          cd_associado,
          acao_id: acaoId,
          origem: OrigemConquista.EQUIVALENCIA_AUTOMATICA,
          fl_concluido: true,
          dt_conclusao: new Date(),
          ds_observacao: motivo,
        },
        update: {
          fl_concluido: true,
          origem: OrigemConquista.EQUIVALENCIA_AUTOMATICA,
          ds_observacao: motivo,
        },
      });
    }

    // 6. Recalcula os blocos
    await recalcularStatusBlocos(tx, cd_associado, ramo);
  });

  return await getProgressoNovoModelo(cd_associado, ramo);
}

/**
 * Executa a transição para todos os associados do banco
 */
export async function processarTransicaoTodos(ds_ramo: string | Ramo = Ramo.ESCOTEIRO) {
  const ramo = normalizeRamo(ds_ramo);

  const associados = await prisma.associado.findMany({
    where: {
      ds_categoria: CategoriaAssociado.BENEFICIARIO,
      ds_ramo: ramo,
      fl_status: StatusAssociado.ATIVO,
    },
    select: {
      cd_associado: true,
    },
    orderBy: {
      cd_associado: 'asc',
    },
  });

  const resultados: ProgressoCompletoJovem[] = [];
  for (const row of associados) {
    const res = await processarTransicaoAssociado(row.cd_associado, ramo);
    resultados.push(res);
  }

  return {
    ramo,
    totalProcessados: resultados.length,
    resultados,
  };
}
