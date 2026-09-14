import { NextResponse } from 'next/server';
import { saveBlocoAcoesNovoModelo } from '@/app/lib/services/transicao-service';
import { normalizeRamo, Ramo } from '@/app/lib/ramo';

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  try {
    const { id: cd_associado } = await params;
    const body = await request.json();
    const { bloco_id, acoes_status, ramo } = body;

    if (!cd_associado || !bloco_id || !Array.isArray(acoes_status)) {
      return NextResponse.json({ success: false, error: 'Parâmetros inválidos para SAVE All' }, { status: 400 });
    }

    const ramoNorm = ramo ? normalizeRamo(ramo) : Ramo.ESCOTEIRO;

    const res = await saveBlocoAcoesNovoModelo(
      cd_associado,
      parseInt(bloco_id, 10),
      acoes_status,
      ramoNorm
    );

    return NextResponse.json({
      success: true,
      data: res,
    });
  } catch (error: any) {
    console.error('[API Save All Bloco POST] Erro:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao salvar ações do bloco' },
      { status: 500 }
    );
  }
}
