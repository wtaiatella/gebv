import { NextRequest, NextResponse } from 'next/server';
import { processarTransicaoAssociado } from '@/app/lib/services/transicao-service';
import { normalizeRamoOrNull } from '@/app/lib/ramo';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Identificador cd_associado não informado.' },
        { status: 400 }
      );
    }

    const ramoParam = request.nextUrl.searchParams.get('ramo');
    const ramo = ramoParam ? normalizeRamoOrNull(ramoParam) : null;

    const resultado = await processarTransicaoAssociado(id, ramo || undefined);
    return NextResponse.json({
      success: true,
      cd_associado: id,
      transicao: resultado,
    });
  } catch (error: any) {
    console.error('[API /api/transicao/[id] Error]:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Falha ao processar transição do associado.',
      },
      { status: 500 }
    );
  }
}
