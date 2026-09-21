import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cd_associado, especialidade_id, especialidade_item_id, concluida } = body;

    const assocId = String(cd_associado || '');
    const espId = Number(especialidade_id);
    const itemId = Number(especialidade_item_id);
    const isConcluida = Boolean(concluida);

    if (!assocId || !espId || !itemId) {
      return NextResponse.json(
        { error: 'cd_associado, especialidade_id e especialidade_item_id são obrigatórios' },
        { status: 400 }
      );
    }

    const agora = new Date();

    const resultado = await prisma.$transaction(async (tx) => {
      // 1. Grava o status do item individual com origem MANUAL_CHEFE
      const itemSalvo = await tx.progressaoEspecialidadeItemPn.upsert({
        where: {
          cd_associado_especialidade_item_id: {
            cd_associado: assocId,
            especialidade_item_id: itemId,
          },
        },
        create: {
          cd_associado: assocId,
          especialidade_item_id: itemId,
          concluida: isConcluida,
          origem: 'MANUAL_CHEFE',
          data_conclusao: isConcluida ? agora : null,
        },
        update: {
          concluida: isConcluida,
          origem: 'MANUAL_CHEFE',
          data_conclusao: isConcluida ? agora : null,
        },
      });

      // 2. Busca todos os itens pertencentes a esta especialidade PN
      const itensCatalogo = await tx.pnEspecialidadeItem.findMany({
        where: { especialidade_id: espId },
        select: { id: true },
      });
      const itemIds = itensCatalogo.map((i) => i.id);

      // 3. Conta quantos itens estão concluídos para este associado nesta especialidade
      const itensConcluidosCount = await tx.progressaoEspecialidadeItemPn.count({
        where: {
          cd_associado: assocId,
          especialidade_item_id: { in: itemIds },
          concluida: true,
        },
      });

      // 4. Busca as metas de nível da especialidade PN
      const espCatalogo = await tx.pnEspecialidade.findUnique({
        where: { id: espId },
        select: {
          meta_nivel_1: true,
          meta_nivel_2: true,
        },
      });

      const meta1 = espCatalogo?.meta_nivel_1 ?? 4;
      const meta2 = espCatalogo?.meta_nivel_2 ?? 8;

      let nrNivel = 0;
      let flConcluido = false;

      if (itensConcluidosCount >= meta2) {
        nrNivel = 2;
        flConcluido = true;
      } else if (itensConcluidosCount >= meta1) {
        nrNivel = 1;
        flConcluido = false;
      }

      // 5. Atualiza ou cria o registro da especialidade PN
      const espSalva = await tx.progressaoEspecialidadePn.upsert({
        where: {
          cd_associado_especialidade_id: {
            cd_associado: assocId,
            especialidade_id: espId,
          },
        },
        create: {
          cd_associado: assocId,
          especialidade_id: espId,
          nr_nivel: nrNivel,
          fl_concluido: flConcluido,
          qtd_itens_concluidos: itensConcluidosCount,
          dt_conquista: nrNivel > 0 ? agora : null,
          origem: 'MANUAL_CHEFE',
        },
        update: {
          nr_nivel: nrNivel,
          fl_concluido: flConcluido,
          qtd_itens_concluidos: itensConcluidosCount,
          dt_conquista: nrNivel > 0 ? agora : null,
        },
      });

      return {
        item: {
          especialidade_item_id: itemSalvo.especialidade_item_id,
          concluida: itemSalvo.concluida,
          origem: itemSalvo.origem,
          data_conclusao: itemSalvo.data_conclusao,
        },
        especialidade: {
          especialidade_id: espSalva.especialidade_id,
          nr_nivel: espSalva.nr_nivel,
          qtd_itens_concluidos: espSalva.qtd_itens_concluidos,
          fl_concluido: espSalva.fl_concluido,
          origem: espSalva.origem,
        },
        timestamp: agora.toISOString(),
      };
    });

    return NextResponse.json({ success: true, ...resultado });
  } catch (err: any) {
    console.error('Erro em POST /api/especialidades-pn/item-status:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
