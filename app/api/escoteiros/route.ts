import { NextRequest, NextResponse } from 'next/server';
import { getEscoteiros } from '@/app/lib/data';
import { normalizeRamo, ramoToDisplayName } from '@/app/lib/ramo';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ramoParam = searchParams.get('ramo') || 'Escoteiro';
    let ramoEnum;
    try {
      ramoEnum = normalizeRamo(ramoParam);
    } catch {
      ramoEnum = normalizeRamo('Escoteiro');
    }

    const escoteiros = await getEscoteiros(ramoEnum);

    return NextResponse.json(
      {
        success: true,
        ramo: ramoToDisplayName(ramoEnum),
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
