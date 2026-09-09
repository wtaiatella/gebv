import { NextRequest, NextResponse } from 'next/server';
import { getEscoteiros, Ramo } from '@/app/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ramoParam = searchParams.get('ramo') || 'Escoteiro';
    const ramoValido: Ramo = (['Escoteiro', 'Lobinho', 'Sênior', 'Pioneiro'].includes(ramoParam)
      ? ramoParam
      : 'Escoteiro') as Ramo;

    const escoteiros = await getEscoteiros(ramoValido);

    return NextResponse.json(
      {
        success: true,
        ramo: ramoValido,
        total: escoteiros.length,
        escoteiros,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error: any) {
    console.error('[API /api/escoteiros Error]:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Falha ao buscar lista de escoteiros.',
      },
      { status: 500 }
    );
  }
}
