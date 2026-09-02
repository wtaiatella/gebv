import { NextRequest, NextResponse } from 'next/server';
import { syncEscoteiro } from '@/app/lib/services/sync-service';

export async function POST(request: NextRequest) {
  try {
    const cookieHeader = request.cookies.get('paxtu_session')?.value;
    if (cookieHeader) {
      const { setSessionCookie } = await import('@/app/lib/paxtu/client');
      setSessionCookie(cookieHeader);
    }

    const result = await syncEscoteiro();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API /api/sync/escoteiro Error]:', error);
    const isConflict = error.message?.includes('em andamento');
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Falha ao sincronizar tropa escoteira.',
      },
      { status: isConflict ? 409 : 500 }
    );
  }
}
