import { NextResponse } from 'next/server';
import { processarTransicaoTodos } from '@/app/lib/services/transicao-service';

export async function POST() {
  try {
    const resultado = await processarTransicaoTodos();
    return NextResponse.json({
      success: true,
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
