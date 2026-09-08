import { NextRequest, NextResponse } from 'next/server';
import { syncRamo } from '@/app/lib/services/sync-service';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ ramo: string }> }
) {
  try {
    const { ramo } = await context.params;
    const cookieHeader = request.cookies.get('paxtu_session')?.value;
    if (cookieHeader) {
      const { setSessionCookie } = await import('@/app/lib/paxtu/client');
      setSessionCookie(cookieHeader);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await syncRamo(ramo || 'Escoteiro', (event) => {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          });
          controller.close();
        } catch (error: any) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: 'error',
                message: error.message || `Falha ao sincronizar seção ${ramo}.`,
              }) + '\n'
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error: any) {
    console.error('[API /api/sync/ramo/[ramo] Error]:', error);
    const isConflict = error.message?.includes('em andamento');
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Falha ao sincronizar seção.',
      },
      { status: isConflict ? 409 : 500 }
    );
  }
}
