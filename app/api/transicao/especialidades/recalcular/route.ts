import { NextRequest, NextResponse } from 'next/server';
import {
  transicionarEspecialidadesAssociado,
  transicionarEspecialidadesSecao,
} from '@/app/lib/services/transicao-especialidades-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tipo, ds_ramo, cd_associado } = body;

    if (tipo === 'INDIVIDUAL') {
      if (!cd_associado) {
        return NextResponse.json(
          { error: 'cd_associado é obrigatório para recálculo individual' },
          { status: 400 }
        );
      }
      const resultado = await transicionarEspecialidadesAssociado(String(cd_associado));
      return NextResponse.json({ success: true, ...resultado });
    }

    // Default: SECAO
    const ramo = ds_ramo || 'Escoteiro';
    const resultado = await transicionarEspecialidadesSecao(ramo);
    return NextResponse.json({ success: true, ramo, ...resultado });
  } catch (err: any) {
    console.error('Erro em POST /api/transicao/especialidades/recalcular:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
