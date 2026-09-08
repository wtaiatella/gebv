import { NextResponse } from 'next/server';
import { query } from '@/app/lib/db/pool';

type Params = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ruleId = parseInt(id, 10);

    if (isNaN(ruleId)) {
      return NextResponse.json({ success: false, error: 'ID inválido' }, { status: 400 });
    }

    const body = await request.json();
    const {
      operacao,
      descricao_origem,
      origem_pistas_ueb,
      origem_rumo_ueb,
      origem_especialidades,
      nivel_min_especialidade,
      min_count,
      fl_requer_validacao_manual,
    } = body;

    // Validações básicas
    const operacoesValidas = ['DIRETA', 'OR', 'MIN_COUNT', 'ESPECIALIDADES', 'SEM_EQUIVALENCIA'];
    if (operacao && !operacoesValidas.includes(operacao)) {
      return NextResponse.json({ success: false, error: `Operação inválida: ${operacao}` }, { status: 400 });
    }

    const res = await query(
      `UPDATE pn_equivalencia_regras
       SET 
         operacao = COALESCE($1, operacao),
         descricao_origem = COALESCE($2, descricao_origem),
         origem_pistas_ueb = COALESCE($3, origem_pistas_ueb),
         origem_rumo_ueb = COALESCE($4, origem_rumo_ueb),
         origem_especialidades = COALESCE($5, origem_especialidades),
         nivel_min_especialidade = COALESCE($6, nivel_min_especialidade),
         min_count = COALESCE($7, min_count),
         fl_requer_validacao_manual = COALESCE($8, fl_requer_validacao_manual),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [
        operacao,
        descricao_origem,
        origem_pistas_ueb || [],
        origem_rumo_ueb || [],
        origem_especialidades || [],
        nivel_min_especialidade !== undefined ? parseInt(nivel_min_especialidade, 10) : null,
        min_count !== undefined ? parseInt(min_count, 10) : null,
        fl_requer_validacao_manual !== undefined ? Boolean(fl_requer_validacao_manual) : null,
        ruleId,
      ]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ success: false, error: 'Regra de equivalência não encontrada' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      regra: res.rows[0],
    });
  } catch (error: any) {
    console.error('[API Regras Equivalência PUT] Erro ao atualizar regra:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao salvar alterações da regra' },
      { status: 500 }
    );
  }
}
