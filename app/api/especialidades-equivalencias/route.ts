import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';

function cosineSimilarity(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface CachedPaItem {
  id: number;
  pa_especialidade_id: number;
  ds_especialidade: string;
  cd_item: string;
  ds_item: string;
  embedding: number[];
}

let cachedItensPa: CachedPaItem[] | null = null;
let loadingItensPaPromise: Promise<CachedPaItem[]> | null = null;

async function getTodosItensPa(): Promise<CachedPaItem[]> {
  if (cachedItensPa) return cachedItensPa;
  if (!loadingItensPaPromise) {
    loadingItensPaPromise = prisma.paEspecialidadeItem
      .findMany({
        select: {
          id: true,
          cd_item: true,
          ds_item: true,
          embedding: true,
          especialidade: {
            select: {
              id: true,
              ds_especialidade: true,
            },
          },
        },
      })
      .then((raw) => {
        cachedItensPa = raw.map((item) => ({
          id: item.id,
          pa_especialidade_id: item.especialidade.id,
          ds_especialidade: item.especialidade.ds_especialidade,
          cd_item: item.cd_item,
          ds_item: item.ds_item,
          embedding: item.embedding,
        }));
        return cachedItensPa;
      });
  }
  return loadingItensPaPromise;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pnIdParam = searchParams.get('pn_especialidade_id');
    const ramoParam = searchParams.get('ramo');

    if (!pnIdParam) {
      const where: any = {};
      if (ramoParam) {
        where.ramo = ramoParam;
      }
      const especialidades = await prisma.pnEspecialidade.findMany({
        where,
        select: {
          id: true,
          slug: true,
          ds_especialidade: true,
          ramo: true,
          total_itens: true,
          meta_nivel_1: true,
          meta_nivel_2: true,
          eixo: {
            select: {
              id: true,
              nm_eixo: true,
            },
          },
        },
        orderBy: { ds_especialidade: 'asc' },
      });
      return NextResponse.json({ especialidades });
    }

    const pnId = parseInt(pnIdParam, 10);
    if (isNaN(pnId)) {
      return NextResponse.json({ error: 'ID de especialidade PN inválido' }, { status: 400 });
    }

    const pnEsp = await prisma.pnEspecialidade.findUnique({
      where: { id: pnId },
      include: {
        eixo: true,
        itens: {
          orderBy: { nr_item: 'asc' },
          include: {
            equivalencias_regras: {
              where: { fl_aprovado: true },
              include: {
                pa_item: {
                  include: {
                    especialidade: true,
                  },
                },
              },
            },
          },
        },
        relacoes_pa: {
          include: {
            pa_especialidade: true,
          },
        },
      },
    });

    if (!pnEsp) {
      return NextResponse.json({ error: 'Especialidade PN não encontrada' }, { status: 404 });
    }

    const paCorrelatasVinculadas = pnEsp.relacoes_pa.map((rel) => ({
      id: rel.pa_especialidade.id,
      cd_especialidade: rel.pa_especialidade.cd_especialidade,
      ds_especialidade: rel.pa_especialidade.ds_especialidade,
    }));

    // Carrega todos os itens de todas as especialidades PA (em cache de memória no Node)
    const todosItensPa = await getTodosItensPa();

    const itensResultado = pnEsp.itens.map((pnItem) => {
      const regrasAprovadas = pnItem.equivalencias_regras.map((r) => ({
        id: r.id,
        pa_item_id: r.pa_item_id,
        cd_item_pa: r.pa_item?.cd_item || '',
        ds_item_pa: r.pa_item?.ds_item || '',
        ds_especialidade_pa: r.pa_item?.especialidade?.ds_especialidade || '',
        score: r.score_similaridade,
      }));

      // Calcula similaridade semântica contra todo o catálogo de itens PA
      const sugestoes = todosItensPa
        .map((paItem) => {
          const score = cosineSimilarity(pnItem.embedding, paItem.embedding);
          return {
            pa_item_id: paItem.id,
            pa_especialidade: paItem.ds_especialidade,
            cd_item: paItem.cd_item,
            ds_item: paItem.ds_item,
            score: Math.round(score * 100) / 100,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      return {
        id: pnItem.id,
        nr_item: pnItem.nr_item,
        cd_item: pnItem.cd_item,
        ds_item: pnItem.ds_item,
        regras_aprovadas: regrasAprovadas,
        sugestoes,
      };
    });

    const todasPaCandidatas = await prisma.paEspecialidade.findMany({
      select: {
        id: true,
        cd_especialidade: true,
        ds_especialidade: true,
      },
      orderBy: { ds_especialidade: 'asc' },
    });

    return NextResponse.json({
      pn_especialidade: {
        id: pnEsp.id,
        slug: pnEsp.slug,
        ds_especialidade: pnEsp.ds_especialidade,
        ramo: pnEsp.ramo,
        meta_nivel_1: pnEsp.meta_nivel_1,
        meta_nivel_2: pnEsp.meta_nivel_2,
        itens: itensResultado,
      },
      pa_correlatas_vinculadas: paCorrelatasVinculadas,
      todas_pa_candidatas: todasPaCandidatas,
    });
  } catch (err: any) {
    console.error('Erro em GET /api/especialidades-equivalencias:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
