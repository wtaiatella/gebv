import { NextResponse } from 'next/server';
import { query } from '@/app/lib/db/pool';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dsRamo = searchParams.get('ramo') || 'Escoteiro';

    // 1. Busca todas as regras com dados das ações, blocos e eixos
    const regrasResult = await query(
      `SELECT 
        r.id,
        r.acao_pn_id,
        r.operacao,
        r.descricao_origem,
        r.origem_pistas_ueb,
        r.origem_rumo_ueb,
        r.origem_especialidades,
        r.nivel_min_especialidade,
        r.min_count,
        r.fl_requer_validacao_manual,
        r.updated_at,
        a.ds_acao,
        a.tp_acao,
        a.modalidade,
        a.regra_qtd_texto,
        a.nr_ordem as nr_ordem_acao,
        b.id as bloco_id,
        b.nm_bloco,
        b.ds_intencionalidade,
        b.nr_ordem as nr_ordem_bloco,
        e.id as eixo_id,
        e.nm_eixo,
        a.ds_ramo
      FROM pn_equivalencia_regras r
      JOIN pn_acoes_educativas a ON a.id = r.acao_pn_id
      JOIN pn_blocos b ON b.id = a.bloco_id
      JOIN pn_eixos e ON e.id = b.eixo_id
      WHERE a.ds_ramo = $1
      ORDER BY e.nr_ordem ASC, b.nr_ordem ASC, a.nr_ordem ASC`,
      [dsRamo]
    );

    // 2. Busca lista de Eixos
    const eixosResult = await query(
      `SELECT id, nm_eixo, nr_ordem FROM pn_eixos WHERE ds_ramo = $1 ORDER BY nr_ordem ASC`,
      [dsRamo]
    );

    // 3. Busca lista de Blocos
    const blocosResult = await query(
      `SELECT b.id, b.eixo_id, b.nm_bloco, b.nr_ordem, b.ds_intencionalidade, e.nm_eixo 
       FROM pn_blocos b
       JOIN pn_eixos e ON e.id = b.eixo_id
       WHERE b.ds_ramo = $1 
       ORDER BY b.nr_ordem ASC`,
      [dsRamo]
    );

    // 4. Busca catálogo de atividades do Programa Antigo (Pistas e Rumo) para autocomplete/chips
    const paAtividadesResult = await query(
      `SELECT 
        a.id,
        a.cd_ueb,
        a.identificacao,
        a.ds_atividade,
        a.nr_ordenacao,
        c.cd_caminho_paxtu,
        c.nm_caminho,
        comp.ds_competencia
       FROM pa_atividades a
       JOIN pa_competencias comp ON comp.id = a.competencia_id
       JOIN pa_caminhos c ON c.id = comp.caminho_id
       WHERE a.ds_ramo = $1
       ORDER BY c.cd_caminho_paxtu, a.nr_ordenacao`,
      [dsRamo]
    );

    // 5. Lista oficial de especialidades do Programa Antigo (pa_especialidades)
    const espResult = await query(
      `SELECT cd_especialidade, ds_especialidade FROM pa_especialidades ORDER BY ds_especialidade ASC`
    );

    return NextResponse.json({
      success: true,
      ramo: dsRamo,
      regras: regrasResult.rows,
      eixos: eixosResult.rows,
      blocos: blocosResult.rows,
      pa_atividades: paAtividadesResult.rows,
      especialidades_catalogo: espResult.rows,
    });
  } catch (error: any) {
    console.error('[API Regras Equivalência] Erro ao carregar regras:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao carregar regras de equivalência' },
      { status: 500 }
    );
  }
}
