import { NextResponse } from 'next/server';
import { toggleAcaoNovoModelo, resetAcaoNovoModelo } from '@/app/lib/services/transicao-service';
import { normalizeRamo, Ramo } from '@/app/lib/ramo';

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  try {
    const { id: cd_associado } = await params;
    const body = await request.json();
    const { acao_id, fl_concluido, cd_escotista, ds_observacao, ramo } = body;

    if (!cd_associado || !acao_id) {
      return NextResponse.json({ success: false, error: 'Parâmetros incompletos' }, { status: 400 });
    }

    const ramoNorm = ramo ? normalizeRamo(ramo) : Ramo.ESCOTEIRO;

    const res = await toggleAcaoNovoModelo(
      cd_associado,
      parseInt(acao_id, 10),
      Boolean(fl_concluido),
      cd_escotista,
      ds_observacao,
      ramoNorm
    );

    return NextResponse.json({
      success: true,
      data: res.data,
    });
  } catch (error: any) {
    console.error('[API Toggle Ação Novo Modelo POST] Erro:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao alterar status da ação' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id: cd_associado } = await params;
    const { searchParams } = new URL(request.url);
    const acaoIdParam = searchParams.get('acao_id');
    const ramoParam = searchParams.get('ramo');

    if (!cd_associado || !acaoIdParam) {
      return NextResponse.json(
        { success: false, error: 'Parâmetros incompletos (cd_associado ou acao_id ausente)' },
        { status: 400 }
      );
    }

    const acao_id = parseInt(acaoIdParam, 10);
    if (isNaN(acao_id)) {
      return NextResponse.json({ success: false, error: 'acao_id inválido' }, { status: 400 });
    }

    const ramoNorm = ramoParam ? normalizeRamo(ramoParam) : Ramo.ESCOTEIRO;

    const res = await resetAcaoNovoModelo(cd_associado, acao_id, ramoNorm);

    return NextResponse.json({
      success: true,
      data: res.data,
    });
  } catch (error: any) {
    console.error('[API Reset Ação Novo Modelo DELETE] Erro:', error);
    const msg = error.message || 'Erro ao resetar status da ação';
    const status = msg.includes('não há marcação manual') || msg.includes('não possui registro') ? 400 : 500;
    return NextResponse.json(
      { success: false, error: msg },
      { status }
    );
  }
}
