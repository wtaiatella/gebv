import { NextRequest, NextResponse } from 'next/server';
import { processarTransicaoTodos } from '@/app/lib/services/transicao-service';
import { normalizeRamo, Ramo } from '@/app/lib/ramo';

export async function POST(request: NextRequest) {
  try {
    const ramoParam = request.nextUrl.searchParams.get('ramo');
    const ramo = ramoParam ? normalizeRamo(ramoParam) : Ramo.ESCOTEIRO;

    const resultado = await processarTransicaoTodos(ramo);
    return NextResponse.json({
      success: true,
      ramo: resultado.ramo,
      total_processados: resultado.totalProcessados,
      resultados: resultado.resultados,
    });
  } catch (error: any) {
    console.error('[API /api/transicao/lote Error]:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Falha ao processar transição em lote.',
      },
      { status: 500 }
    );
  }
}
