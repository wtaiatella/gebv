import { query, withTransaction } from '../db/pool';

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

/**
 * Recalcula o status e percentual de conclusão dos blocos de um associado
 */
export async function recalcularStatusBlocos(client: any, cd_associado: string, ds_ramo: string = 'Escoteiro') {
  // Carrega blocos do ramo
  const blocosRes = await client.query(
    `SELECT b.id, b.nm_bloco, e.nm_eixo, b.eixo_id, b.ds_intencionalidade,
            b.nr_acoes_fixas_obrigatorias, b.nr_acoes_variaveis_exigidas
     FROM pn_blocos b
     JOIN pn_eixos e ON b.eixo_id = e.id
     WHERE b.ds_ramo = $1
     ORDER BY e.nr_ordem, b.nr_ordem`,
    [ds_ramo]
  );

  // Carrega todas as ações do ramo
  const acoesRes = await client.query(
    `SELECT a.id, a.bloco_id, a.tp_acao, a.modalidade, COALESCE(ea.fl_concluido, false) as fl_concluido
     FROM pn_acoes_educativas a
     LEFT JOIN escoteiro_pn_acoes ea ON ea.acao_id = a.id AND ea.cd_associado = $1
     WHERE a.ds_ramo = $2`,
    [cd_associado, ds_ramo]
  );

  const acoesPorBloco = new Map<number, { fixasTotal: number; fixasDone: number; varTotal: number; varDone: number; paDone: number; subDone: number }>();
  for (const b of blocosRes.rows) {
    acoesPorBloco.set(b.id, { fixasTotal: 0, fixasDone: 0, varTotal: 0, varDone: 0, paDone: 0, subDone: 0 });
  }

  for (const a of acoesRes.rows) {
    const bObj = acoesPorBloco.get(a.bloco_id);
    if (bObj) {
      if (a.tp_acao === 'Fixa') {
        bObj.fixasTotal++;
        if (a.fl_concluido) bObj.fixasDone++;
      } else if (a.tp_acao === 'Substitutiva' || a.modalidade === 'Substitutiva') {
        if (a.fl_concluido) bObj.subDone++;
      } else if (a.modalidade === 'PA') {
        if (a.fl_concluido) bObj.paDone++;
      } else {
        bObj.varTotal++;
        if (a.fl_concluido) bObj.varDone++;
      }
    }
  }

  let totalBlocosConcluidos = 0;
  for (const b of blocosRes.rows) {
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

    await client.query(
      `INSERT INTO escoteiro_pn_blocos_status (
        cd_associado, bloco_id, fl_concluido, nr_fixas_concluidas,
        nr_variaveis_concluidas, pct_conclusao, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (cd_associado, bloco_id) DO UPDATE SET
        fl_concluido = EXCLUDED.fl_concluido,
        nr_fixas_concluidas = EXCLUDED.nr_fixas_concluidas,
        nr_variaveis_concluidas = EXCLUDED.nr_variaveis_concluidas,
        pct_conclusao = EXCLUDED.pct_conclusao,
        updated_at = CURRENT_TIMESTAMP`,
      [cd_associado, b.id, isConcluido, stats.fixasDone, stats.varDone, pct]
    );
  }

  return { totalBlocos: blocosRes.rows.length, totalBlocosConcluidos };
}

/**
 * Retorna a visão completa do Novo Programa para um associado
 */
export async function getProgressoNovoModelo(
  cd_associado: string,
  ds_ramo: string = 'Escoteiro'
): Promise<ProgressoCompletoJovem> {
  // 1. Dados do Associado
  const assocRes = await query(
    `SELECT cd_associado, nm_associado, nr_registro_formatado, COALESCE(ds_ramo, $2) as ds_ramo
     FROM associados
     WHERE cd_associado = $1`,
    [cd_associado, ds_ramo]
  );

  if (assocRes.rowCount === 0) {
    throw new Error(`Associado ${cd_associado} não encontrado.`);
  }

  const associado = assocRes.rows[0];

  // 2. Histórico de atividades do PA concluídas pelo jovem (para calcular equivalência em tempo real)
  const oldActivitiesRes = await query(
    `SELECT c.cd_caminho_paxtu, a.cd_ueb, ea.fl_check_jovem, ea.fl_check_escotista
     FROM escoteiro_pa_atividades ea
     JOIN pa_atividades a ON ea.atividade_id = a.id
     JOIN pa_competencias comp ON a.competencia_id = comp.id
     JOIN pa_caminhos c ON comp.caminho_id = c.id
     WHERE ea.cd_associado = $1 AND (ea.fl_check_jovem = true OR ea.fl_check_escotista = true)`,
    [cd_associado]
  );

  const completedPistas = new Set<string>();
  const completedRumo = new Set<string>();
  for (const row of oldActivitiesRes.rows) {
    const numOnly = (row.cd_ueb || '').replace(/\D/g, '');
    if (row.cd_ueb.startsWith('P') || row.cd_caminho_paxtu === '4' || row.cd_caminho_paxtu === '5' || row.cd_caminho_paxtu === 'PISTA') {
      completedPistas.add(numOnly);
      completedPistas.add(row.cd_ueb);
    }
    if (row.cd_ueb.startsWith('R') || row.cd_caminho_paxtu === '6' || row.cd_caminho_paxtu === 'RUMO' || row.cd_caminho_paxtu === 'TRAVESSIA') {
      completedRumo.add(numOnly);
      completedRumo.add(row.cd_ueb);
    }
  }

  // Carrega histórico de especialidades conquistadas pelo jovem
  const espRes = await query(
    `SELECT cd_especialidade, ds_especialidade, nr_nivel, dt_nivel, qtd_itens_concluidos
     FROM escoteiro_pa_especialidades
     WHERE cd_associado = $1`,
    [cd_associado]
  );
  const scoutEspMap = new Map<string, { cd_especialidade: string; ds_especialidade: string; nr_nivel: number; dt_nivel: string | null }>();
  for (const r of espRes.rows) {
    scoutEspMap.set(normalizeEspName(r.ds_especialidade), {
      cd_especialidade: r.cd_especialidade,
      ds_especialidade: r.ds_especialidade,
      nr_nivel: Number(r.nr_nivel) || 0,
      dt_nivel: r.dt_nivel || null,
    });
  }

  // 3. Eixos e Blocos com Status
  const eixosRes = await query(
    `SELECT id, nm_eixo, nr_ordem FROM pn_eixos WHERE ds_ramo = $1 ORDER BY nr_ordem ASC`,
    [ds_ramo]
  );

  const blocosRes = await query(
    `SELECT 
       b.id as bloco_id,
       b.nm_bloco,
       e.nm_eixo,
       b.eixo_id,
       b.ds_intencionalidade,
       b.nr_acoes_fixas_obrigatorias,
       b.nr_acoes_variaveis_exigidas,
       COALESCE(s.nr_fixas_concluidas, 0) as nr_fixas_concluidas,
       COALESCE(s.nr_variaveis_concluidas, 0) as nr_variaveis_concluidas,
       COALESCE(s.pct_conclusao, 0) as pct_conclusao,
       COALESCE(s.fl_concluido, false) as fl_concluido
     FROM pn_blocos b
     JOIN pn_eixos e ON b.eixo_id = e.id
     LEFT JOIN escoteiro_pn_blocos_status s ON s.bloco_id = b.id AND s.cd_associado = $1
     WHERE b.ds_ramo = $2
     ORDER BY e.nr_ordem ASC, b.nr_ordem ASC`,
    [cd_associado, ds_ramo]
  );

  // 4. Ações e Regras de Equivalência vinculadas
  const acoesRes = await query(
    `SELECT 
       a.id,
       a.bloco_id,
       a.tp_acao,
       a.modalidade,
       a.ds_acao,
       a.regra_qtd_texto,
       a.nr_ordem,
       ea.fl_concluido,
       ea.origem,
       ea.dt_conclusao,
       ea.ds_observacao,
       r.id as regra_id,
       r.operacao,
       r.descricao_origem,
       r.origem_pistas_ueb,
       r.origem_rumo_ueb,
       r.origem_especialidades,
       r.nivel_min_especialidade,
       r.min_count,
       r.fl_requer_validacao_manual
     FROM pn_acoes_educativas a
     LEFT JOIN escoteiro_pn_acoes ea ON ea.acao_id = a.id AND ea.cd_associado = $1
     LEFT JOIN pn_equivalencia_regras r ON r.acao_pn_id = a.id
     WHERE a.ds_ramo = $2
     ORDER BY a.nr_ordem ASC`,
    [cd_associado, ds_ramo]
  );

  // 3. Catálogo de atividades PA para descrições e identificação
  const paAtivRes = await query(
    `SELECT a.cd_ueb, a.identificacao, a.ds_atividade, c.cd_caminho_paxtu 
     FROM pa_atividades a
     JOIN pa_competencias comp ON a.competencia_id = comp.id
     JOIN pa_caminhos c ON comp.caminho_id = c.id
     WHERE a.ds_ramo = $1`,
    [ds_ramo]
  );
  const paPistasMap = new Map<string, { identificacao: string; ds_atividade: string }>();
  const paRumoMap = new Map<string, { identificacao: string; ds_atividade: string }>();

  for (const row of paAtivRes.rows) {
    const numOnly = (row.cd_ueb || '').replace(/\D/g, '');
    if (row.cd_caminho_paxtu === '4' || row.cd_caminho_paxtu === '5' || (row.cd_ueb || '').startsWith('P')) {
      const item = {
        identificacao: row.identificacao || `PT-${numOnly || row.cd_ueb}`,
        ds_atividade: row.ds_atividade,
      };
      if (numOnly) paPistasMap.set(numOnly, item);
      paPistasMap.set(row.cd_ueb, item);
    } else if (row.cd_caminho_paxtu === '6' || (row.cd_ueb || '').startsWith('R')) {
      const item = {
        identificacao: row.identificacao || `RT-${numOnly || row.cd_ueb}`,
        ds_atividade: row.ds_atividade,
      };
      if (numOnly) paRumoMap.set(numOnly, item);
      paRumoMap.set(row.cd_ueb, item);
    }
  }

  const acoesPorBloco: Record<number, AcaoProgressoItem[]> = {};
  for (const b of blocosRes.rows) {
    acoesPorBloco[b.bloco_id] = [];
  }

  let totalAcoes = 0;
  let totalConcluidas = 0;

  for (const row of acoesRes.rows) {
    totalAcoes++;
    if (row.fl_concluido) totalConcluidas++;

    // Avalia o match da regra de equivalência
    const refsPistas = row.origem_pistas_ueb || [];
    const refsRumo = row.origem_rumo_ueb || [];
    const refsEsp = row.origem_especialidades || [];
    const minCount = row.min_count || 1;
    const nivelMinEsp = row.nivel_min_especialidade || 1;

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

    const item: AcaoProgressoItem = {
      id: row.id,
      bloco_id: row.bloco_id,
      tp_acao: row.tp_acao,
      modalidade: row.modalidade || 'Básico',
      ds_acao: row.ds_acao,
      regra_qtd_texto: row.regra_qtd_texto,
      nr_ordem: row.nr_ordem,
      fl_concluido: Boolean(row.fl_concluido),
      origem: row.origem,
      dt_conclusao: row.dt_conclusao,
      ds_observacao: row.ds_observacao,
      regra_id: row.regra_id,
      operacao: row.operacao,
      descricao_origem: row.descricao_origem,
      origem_pistas_ueb: refsPistas,
      origem_rumo_ueb: refsRumo,
      origem_especialidades: refsEsp,
      nivel_min_especialidade: nivelMinEsp,
      min_count: minCount,
      fl_requer_validacao_manual: Boolean(row.fl_requer_validacao_manual),
      fl_calculado_match: flCalculadoMatch,
      itens_conquistados_match: matchedItems,
      itens_origem_detalhados: itensDetalhados,
      especialidades_origem_detalhadas: especialidadesDetalhadas,
    };

    if (acoesPorBloco[row.bloco_id]) {
      acoesPorBloco[row.bloco_id].push(item);
    }
  }

  const blocosConcluidos = blocosRes.rows.filter((b: any) => b.fl_concluido).length;
  const pctGlobal = totalAcoes > 0 ? Math.round((totalConcluidas / totalAcoes) * 10000) / 100 : 0;

  return {
    associado,
    ramo: ds_ramo,
    eixos: eixosRes.rows,
    blocos: blocosRes.rows,
    acoes_por_bloco: acoesPorBloco,
    estatisticas: {
      total_acoes: totalAcoes,
      total_concluidas: totalConcluidas,
      total_blocos: blocosRes.rows.length,
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
  ds_ramo: string = 'Escoteiro'
) {
  return await withTransaction(async (client) => {
    if (fl_concluido) {
      await client.query(
        `INSERT INTO escoteiro_pn_acoes (
          cd_associado, acao_id, origem, fl_concluido, dt_conclusao, cd_escotista_avaliador, ds_observacao
        ) VALUES ($1, $2, 'manual_chefe', true, CURRENT_DATE, $3, $4)
        ON CONFLICT (cd_associado, acao_id) DO UPDATE SET
          fl_concluido = true,
          origem = 'manual_chefe',
          cd_escotista_avaliador = COALESCE($3, escoteiro_pn_acoes.cd_escotista_avaliador),
          ds_observacao = COALESCE($4, escoteiro_pn_acoes.ds_observacao)`,
        [cd_associado, acao_id, cd_escotista || null, ds_observacao || null]
      );
    } else {
      await client.query(
        `UPDATE escoteiro_pn_acoes 
         SET fl_concluido = false, ds_observacao = $3
         WHERE cd_associado = $1 AND acao_id = $2`,
        [cd_associado, acao_id, ds_observacao || null]
      );
    }

    // Recalcula status dos blocos
    await recalcularStatusBlocos(client, cd_associado, ds_ramo);

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
  ds_ramo: string = 'Escoteiro'
) {
  return await withTransaction(async (client) => {
    for (const item of acoes_status) {
      if (item.fl_concluido) {
        await client.query(
          `INSERT INTO escoteiro_pn_acoes (
            cd_associado, acao_id, origem, fl_concluido, dt_conclusao
          ) VALUES ($1, $2, 'manual_chefe', true, CURRENT_DATE)
          ON CONFLICT (cd_associado, acao_id) DO UPDATE SET
            fl_concluido = true,
            origem = 'manual_chefe'`,
          [cd_associado, item.acao_id]
        );
      } else {
        await client.query(
          `INSERT INTO escoteiro_pn_acoes (
            cd_associado, acao_id, origem, fl_concluido
          ) VALUES ($1, $2, 'manual_chefe', false)
          ON CONFLICT (cd_associado, acao_id) DO UPDATE SET
            fl_concluido = false`,
          [cd_associado, item.acao_id]
        );
      }
    }

    await recalcularStatusBlocos(client, cd_associado, ds_ramo);
    return { success: true, count: acoes_status.length };
  });
}

/**
 * Executa o motor de transição/equivalência para um associado específico
 */
export async function processarTransicaoAssociado(
  cd_associado: string,
  ds_ramo: string = 'Escoteiro'
): Promise<ProgressoCompletoJovem> {
  await withTransaction(async (client) => {
    // 1. Carrega histórico de atividades concluídas pelo jovem no modelo antigo
    const oldActivitiesRes = await client.query(
      `SELECT c.cd_caminho_paxtu, a.cd_ueb, ea.fl_check_jovem, ea.fl_check_escotista
       FROM escoteiro_pa_atividades ea
       JOIN pa_atividades a ON ea.atividade_id = a.id
       JOIN pa_competencias comp ON a.competencia_id = comp.id
       JOIN pa_caminhos c ON comp.caminho_id = c.id
       WHERE ea.cd_associado = $1 AND (ea.fl_check_jovem = true OR ea.fl_check_escotista = true)`,
      [cd_associado]
    );

    const completedPistas = new Set<string>();
    const completedRumo = new Set<string>();

    for (const row of oldActivitiesRes.rows) {
      const numOnly = (row.cd_ueb || '').replace(/\D/g, '');
      if (row.cd_ueb.startsWith('P') || row.cd_caminho_paxtu === '4' || row.cd_caminho_paxtu === '5' || row.cd_caminho_paxtu === 'PISTA') {
        if (numOnly) completedPistas.add(numOnly);
        completedPistas.add(row.cd_ueb);
      }
      if (row.cd_ueb.startsWith('R') || row.cd_caminho_paxtu === '6' || row.cd_caminho_paxtu === 'RUMO' || row.cd_caminho_paxtu === 'TRAVESSIA') {
        if (numOnly) completedRumo.add(numOnly);
        completedRumo.add(row.cd_ueb);
      }
    }

    // 2. Carrega especialidades conquistadas pelo jovem
    const espRes = await client.query(
      `SELECT ds_especialidade, nr_nivel FROM escoteiro_pa_especialidades WHERE cd_associado = $1`,
      [cd_associado]
    );
    const scoutEspMap = new Map<string, number>();
    for (const r of espRes.rows) {
      scoutEspMap.set(normalizeEspName(r.ds_especialidade), Number(r.nr_nivel) || 0);
    }

    // 3. Carrega todas as regras de equivalência mapeadas para o ramo
    const regrasRes = await client.query(
      `SELECT r.id, r.acao_pn_id, r.operacao, r.descricao_origem,
              r.origem_pistas_ueb, r.origem_rumo_ueb, r.origem_especialidades,
              r.nivel_min_especialidade, r.min_count
       FROM pn_equivalencia_regras r
       JOIN pn_acoes_educativas a ON a.id = r.acao_pn_id
       WHERE a.ds_ramo = $1`,
      [ds_ramo]
    );

    // 4. Avalia quais ações do novo programa foram atingidas por equivalência
    const acoesConquistadasMap = new Map<number, string>();

    for (const regra of regrasRes.rows) {
      if (regra.operacao === 'SEM_EQUIVALENCIA') continue;

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

    // 4. Salva as conquistas em escoteiro_pn_acoes
    for (const [acaoId, motivo] of acoesConquistadasMap.entries()) {
      await client.query(
        `INSERT INTO escoteiro_pn_acoes (cd_associado, acao_id, origem, fl_concluido, dt_conclusao, ds_observacao)
         VALUES ($1, $2, 'equivalencia_automatica', true, CURRENT_DATE, $3)
         ON CONFLICT (cd_associado, acao_id) DO UPDATE SET
           fl_concluido = true,
           origem = EXCLUDED.origem,
           ds_observacao = EXCLUDED.ds_observacao`,
        [cd_associado, acaoId, motivo]
      );
    }

    // 5. Recalcula os blocos
    await recalcularStatusBlocos(client, cd_associado, ds_ramo);
  });

  return await getProgressoNovoModelo(cd_associado, ds_ramo);
}

/**
 * Executa a transição para todos os associados do banco
 */
export async function processarTransicaoTodos(ds_ramo: string = 'Escoteiro') {
  const assocRes = await query<{ cd_associado: string }>(
    `SELECT DISTINCT cd_associado 
     FROM associados 
     WHERE ds_categoria = 'Beneficiário' 
       AND ds_ramo = $1 
       AND (
         fl_status IS NULL 
         OR fl_status IN ('jaRegistrado', 'registroValido', 'jaGravado', 'S', 'Ativo', 'true', '1')
       ) 
     ORDER BY cd_associado ASC`,
    [ds_ramo]
  );

  const resultados: any[] = [];
  for (const row of assocRes.rows) {
    const res = await processarTransicaoAssociado(row.cd_associado, ds_ramo);
    resultados.push(res);
  }

  return {
    ramo: ds_ramo,
    totalProcessados: resultados.length,
    resultados,
  };
}
