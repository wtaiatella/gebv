import { NextResponse } from 'next/server';
import { getProgressoNovoModelo } from '@/app/lib/services/transicao-service';

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const dsRamo = searchParams.get('ramo') || 'Escoteiro';

    if (!id) {
      return NextResponse.json({ success: false, error: 'Código do associado não fornecido' }, { status: 400 });
    }

    const progresso = await getProgressoNovoModelo(id, dsRamo);

    return NextResponse.json({
      success: true,
      data: progresso,
    });
  } catch (error: any) {
    console.error('[API Progresso Novo Modelo GET] Erro:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao buscar progressão do jovem' },
      { status: 500 }
    );
  }
}
