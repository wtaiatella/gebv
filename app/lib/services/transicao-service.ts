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

  // Carrega histórico de especialidades conquistadas pelo jovem
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
    const refsPistas = regra?.origem_pistas_ueb || [];
    const refsRumo = regra?.origem_rumo_ueb || [];
    const refsEsp = regra?.origem_especialidades || [];
    const minCount = regra?.min_count || 1;
    const nivelMinEsp = regra?.nivel_min_especialidade || 1;

    let matchCount = 0;
    const matchedItems: string[] = [];
    const itensDetalhados: RefAtividadePaItem[] = [];
    const especialidadesDetalhadas: RefEspecialidadePaItem[] = [];

    for (const p of refsPistas) {
      const isDone = completedPistas.has(p);
      const info = paPistasMap.get(p);
      const ident = info?.identificacao || `PT-${p}`;
      if (isDone) {
        matchCount++;
        matchedItems.push(ident);
      }
      itensDetalhados.push({
        cd_ueb: p,
        identificacao: ident,
        ds_atividade: info?.ds_atividade || 'Atividade de Pistas',
        fl_concluido_paxtu: isDone,
        tipo: 'Pista',
      });
    }

    for (const r of refsRumo) {
      const isDone = completedRumo.has(r);
      const info = paRumoMap.get(r);
      const ident = info?.identificacao || `RT-${r}`;
      if (isDone) {
        matchCount++;
        matchedItems.push(ident);
      }
      itensDetalhados.push({
        cd_ueb: r,
        identificacao: ident,
        ds_atividade: info?.ds_atividade || 'Atividade de Rumo',
        fl_concluido_paxtu: isDone,
        tipo: 'Rumo',
      });
    }

    for (const e of refsEsp) {
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
      const isConquistada = nivelObtido >= nivelMinEsp;

      if (isConquistada) {
        matchCount++;
        matchedItems.push(`Esp. ${e} (N${nivelObtido})`);
      }

      especialidadesDetalhadas.push({
        nm_especialidade: e,
        nivel_exigido: nivelMinEsp,
        fl_conquistada: isConquistada,
        nivel_conquistado: nivelObtido,
        dt_nivel: scoutEsp?.dt_nivel || null,
      });
    }

    const totalRefs = refsPistas.length + refsRumo.length + refsEsp.length;
    const flCalculadoMatch = totalRefs > 0 && matchCount >= minCount;

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
      origem_pistas_ueb: refsPistas,
      origem_rumo_ueb: refsRumo,
      origem_especialidades: refsEsp,
      nivel_min_especialidade: nivelMinEsp,
      min_count: minCount,
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
    if (fl_concluido) {
      await tx.progressaoPn.upsert({
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
      await tx.progressaoPn.upsert({
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
          ds_observacao: ds_observacao || undefined,
        },
      });
    }

    // Recalcula status dos blocos
    await recalcularStatusBlocos(tx, cd_associado, ramo);

    return { success: true };
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

    // 2. Carrega especialidades conquistadas pelo jovem
    const espList = await tx.progressaoEspecialidadePa.findMany({
      where: { cd_associado },
    });

    const scoutEspMap = new Map<string, number>();
    for (const r of espList) {
      scoutEspMap.set(normalizeEspName(r.ds_especialidade), Number(r.nr_nivel) || 0);
    }

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
      if (regra.operacao === OperacaoEquivalencia.SEM_EQUIVALENCIA) continue;

      const refsPistas = regra.origem_pistas_ueb || [];
      const refsRumo = regra.origem_rumo_ueb || [];
      const refsEsp = regra.origem_especialidades || [];
      const minCount = regra.min_count || 1;
      const nivelMinEsp = regra.nivel_min_especialidade || 1;

      let matchCount = 0;
      const matchedItems: string[] = [];

      for (const p of refsPistas) {
        if (completedPistas.has(p)) {
          matchCount++;
          matchedItems.push(`Pista ${p}`);
        }
      }
      for (const r of refsRumo) {
        if (completedRumo.has(r)) {
          matchCount++;
          matchedItems.push(`Rumo ${r}`);
        }
      }
      for (const e of refsEsp) {
        const normE = normalizeEspName(e);
        let lvl = scoutEspMap.get(normE) || 0;
        if (!lvl) {
          for (const [key, val] of scoutEspMap.entries()) {
            if (key.includes(normE) || normE.includes(key)) {
              lvl = val;
              break;
            }
          }
        }
        if (lvl >= nivelMinEsp) {
          matchCount++;
          matchedItems.push(`Esp. ${e} (N${lvl})`);
        }
      }

      const totalRefs = refsPistas.length + refsRumo.length + refsEsp.length;
      if (matchCount >= minCount && totalRefs > 0) {
        acoesConquistadasMap.set(
          regra.acao_pn_id,
          `Equivalência com ${matchedItems.join(', ')} (${regra.descricao_origem})`
        );
      }
    }

    // 5. Salva as conquistas em progressao_pn
    for (const [acaoId, motivo] of acoesConquistadasMap.entries()) {
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
