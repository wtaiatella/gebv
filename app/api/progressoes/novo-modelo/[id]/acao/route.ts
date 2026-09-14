import { NextResponse } from 'next/server';
import { toggleAcaoNovoModelo } from '@/app/lib/services/transicao-service';
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
      data: res,
    });
  } catch (error: any) {
    console.error('[API Toggle Ação Novo Modelo POST] Erro:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao alterar status da ação' },
      { status: 500 }
    );
  }
}
