import { NextRequest, NextResponse } from 'next/server';
import { syncAssociado } from '@/app/lib/services/sync-service';

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

    const cookieHeader = request.cookies.get('paxtu_session')?.value || request.headers.get('x-paxtu-cookie') || undefined;

    const result = await syncAssociado(id, cookieHeader);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /api/sync/[id] Error]:', error);
    const isAuth = error.name === 'PaxtuSessionExpiredError';
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Falha ao sincronizar dados do associado.',
      },
      { status: isAuth ? 401 : 500 }
    );
  }
}
