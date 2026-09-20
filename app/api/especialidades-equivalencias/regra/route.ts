import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pn_item_id, pa_item_id, fl_aprovado, score_similaridade } = body;

    const pnItemId = Number(pn_item_id);
    const paItemId = Number(pa_item_id);

    if (!pnItemId || !paItemId) {
      return NextResponse.json(
        { error: 'pn_item_id e pa_item_id são obrigatórios' },
        { status: 400 }
      );
    }

    if (fl_aprovado === false) {
      await prisma.pnEspecialidadeEquivalenciaRegra.deleteMany({
        where: {
          pn_item_id: pnItemId,
          pa_item_id: paItemId,
        },
      });
      return NextResponse.json({ success: true, removido: true });
    }

    const regra = await prisma.pnEspecialidadeEquivalenciaRegra.upsert({
      where: {
        pn_item_id_pa_item_id: {
          pn_item_id: pnItemId,
          pa_item_id: paItemId,
        },
      },
      create: {
        pn_item_id: pnItemId,
        pa_item_id: paItemId,
        score_similaridade: score_similaridade !== undefined ? Number(score_similaridade) : null,
        fl_aprovado: true,
      },
      update: {
        fl_aprovado: true,
        score_similaridade: score_similaridade !== undefined ? Number(score_similaridade) : undefined,
      },
    });

    return NextResponse.json({ success: true, regra });
  } catch (err: any) {
    console.error('Erro em POST /api/especialidades-equivalencias/regra:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
