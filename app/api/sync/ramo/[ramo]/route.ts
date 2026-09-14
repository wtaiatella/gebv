import { NextRequest, NextResponse } from 'next/server';
import { syncRamo } from '@/app/lib/services/sync-service';
import { normalizeRamo, ramoToDisplayName } from '@/app/lib/ramo';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ ramo: string }> }
) {
  try {
    const { ramo: rawRamo } = await context.params;
    let ramoEnum;
    try {
      ramoEnum = normalizeRamo(rawRamo || 'escoteiro');
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: `Ramo inválido: "${rawRamo}". Ramos aceitos: lobinho, escoteiro, senior, pioneiro.`,
        },
        { status: 400 }
      );
    }

    const cookieHeader = request.cookies.get('paxtu_session')?.value || request.headers.get('x-paxtu-cookie') || undefined;
    const ramoDisplay = ramoToDisplayName(ramoEnum);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await syncRamo(ramoEnum, (event) => {
            controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
          }, cookieHeader);
          controller.close();
        } catch (error: any) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: 'error',
                message: error.message || `Falha ao sincronizar seção ${ramoDisplay}.`,
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
    const isAuth = error.name === 'PaxtuSessionExpiredError';
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Falha ao sincronizar seção.',
      },
      { status: isConflict ? 409 : isAuth ? 401 : 500 }
    );
  }
}
