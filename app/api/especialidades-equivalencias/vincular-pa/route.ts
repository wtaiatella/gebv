import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pn_especialidade_id, pa_especialidade_id, acao } = body;

    const pnId = Number(pn_especialidade_id);
    const paId = Number(pa_especialidade_id);

    if (!pnId || !paId) {
      return NextResponse.json(
        { error: 'pn_especialidade_id e pa_especialidade_id são obrigatórios' },
        { status: 400 }
      );
    }

    if (acao === 'DESVINCULAR') {
      await prisma.pnPaEspecialidadeRelacao.deleteMany({
        where: {
          pn_especialidade_id: pnId,
          pa_especialidade_id: paId,
        },
      });
      return NextResponse.json({ success: true, acao: 'DESVINCULAR' });
    }

    // Default: VINCULAR
    await prisma.pnPaEspecialidadeRelacao.upsert({
      where: {
        pn_especialidade_id_pa_especialidade_id: {
          pn_especialidade_id: pnId,
          pa_especialidade_id: paId,
        },
      },
      create: {
        pn_especialidade_id: pnId,
        pa_especialidade_id: paId,
      },
      update: {},
    });

    return NextResponse.json({ success: true, acao: 'VINCULAR' });
  } catch (err: any) {
    console.error('Erro em POST /api/especialidades-equivalencias/vincular-pa:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
