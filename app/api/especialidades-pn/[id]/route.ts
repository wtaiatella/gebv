import { NextResponse } from 'next/server';
import prisma from '@/app/lib/prisma';
import { normalizeRamo, Ramo as RamoEnum } from '@/app/lib/ramo';

async function fetchCatalogoFromDb(pnRamoEnum: string) {
  return prisma.pnEspecialidade.findMany({
    where: {
      OR: [{ ramo: pnRamoEnum as any }, { ramo: null }],
    },
    select: {
      id: true,
      cd_especialidade: true,
      ds_especialidade: true,
      slug: true,
      ramo: true,
      meta_nivel_1: true,
      meta_nivel_2: true,
      eixo: {
        select: {
          id: true,
          nm_eixo: true,
        },
      },
      itens: {
        orderBy: [{ nr_item: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          cd_item: true,
          nr_item: true,
          ds_item: true,
          equivalencias_regras: {
            where: { fl_aprovado: true },
            select: {
              pa_item_id: true,
              pa_item: {
                select: {
                  cd_item: true,
                  ds_item: true,
                  especialidade: {
                    select: {
                      ds_especialidade: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { ds_especialidade: 'asc' },
  });
}

type CatalogoData = Awaited<ReturnType<typeof fetchCatalogoFromDb>>;

// Cache em memória do catálogo base de especialidades (não varia por jovem)
let catalogoCache: Record<string, { data: CatalogoData; timestamp: number }> = {};
const CACHE_TTL_MS = 60 * 1000; // 60 segundos

export function invalidateCatalogoCache() {
  catalogoCache = {};
}

async function getCatalogoEspecialidades(pnRamoEnum: string): Promise<CatalogoData> {
  const cached = catalogoCache[pnRamoEnum];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await fetchCatalogoFromDb(pnRamoEnum);
  catalogoCache[pnRamoEnum] = { data, timestamp: Date.now() };
  return data;
}

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: Params) {
  try {
    const { id: cd_associado } = await params;
    if (!cd_associado) {
      return NextResponse.json(
        { success: false, error: 'Código do associado não fornecido.' },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const ramoParam = searchParams.get('ramo');

    // 1. Busca associado
    const assoc = await prisma.associado.findUnique({
      where: { cd_associado },
      select: { cd_associado: true, nm_associado: true, ds_ramo: true },
    });

    if (!assoc) {
      return NextResponse.json(
        { success: false, error: 'Associado não encontrado.' },
        { status: 404 }
      );
    }

    const ramoNormalizado = ramoParam
      ? normalizeRamo(ramoParam)
      : assoc.ds_ramo
      ? normalizeRamo(assoc.ds_ramo)
      : RamoEnum.ESCOTEIRO;

    const isSeniorOuPioneiro =
      ramoNormalizado === RamoEnum.SENIOR || ramoNormalizado === RamoEnum.PIONEIRO;

    const pnRamoEnum = isSeniorOuPioneiro ? 'SENIOR_PIONEIRO' : 'LOBINHO_ESCOTEIRO';

    // 2. Busca catálogo de especialidades PN otimizado (sem vetores de embeddings)
    const especialidadesDb = await getCatalogoEspecialidades(pnRamoEnum);

    // 3. Busca conquistas PN do jovem
    const conquistasEspecialidades = await prisma.progressaoEspecialidadePn.findMany({
      where: { cd_associado },
    });
    const conquistasEspMap = new Map<number, (typeof conquistasEspecialidades)[0]>();
    for (const c of conquistasEspecialidades) {
      conquistasEspMap.set(c.especialidade_id, c);
    }

    // 4. Busca itens PN concluídos do jovem
    const itensPnConcluidos = await prisma.progressaoEspecialidadeItemPn.findMany({
      where: { cd_associado },
    });
    const itensPnMap = new Map<number, (typeof itensPnConcluidos)[0]>();
    for (const it of itensPnConcluidos) {
      itensPnMap.set(it.especialidade_item_id, it);
    }

    // 5. Busca itens PA concluídos pelo jovem (para marcar equivalências atendidas)
    const itensPaConcluidos = await prisma.progressaoEspecialidadeItemPa.findMany({
      where: { cd_associado, concluida: true },
      select: { especialidade_item_id: true, data_conclusao: true },
    });
    const itensPaConcluidosMap = new Map<number, Date | null>();
    for (const pa of itensPaConcluidos) {
      itensPaConcluidosMap.set(pa.especialidade_item_id, pa.data_conclusao);
    }

    // 6. Monta payload estruturado
    const especialidades = especialidadesDb.map((esp) => {
      const progEsp = conquistasEspMap.get(esp.id);

      const itens = esp.itens.map((item) => {
        const itemPn = itensPnMap.get(item.id);

        const regras = item.equivalencias_regras.map((regra) => {
          const paConcluida = itensPaConcluidosMap.has(regra.pa_item_id);
          const paData = itensPaConcluidosMap.get(regra.pa_item_id) || null;
          return {
            pa_item_id: regra.pa_item_id,
            cd_item_pa: regra.pa_item.cd_item,
            ds_item_pa: regra.pa_item.ds_item,
            ds_especialidade_pa: regra.pa_item.especialidade?.ds_especialidade || 'Especialidade PA',
            pa_concluida: paConcluida,
            pa_data_conclusao: paData ? paData.toISOString().split('T')[0] : null,
          };
        });

        return {
          id: item.id,
          cd_item: item.cd_item,
          nr_item: item.nr_item,
          ds_item: item.ds_item,
          concluida: itemPn ? itemPn.concluida : false,
          origem: itemPn ? itemPn.origem : null,
          data_conclusao: itemPn?.data_conclusao
            ? itemPn.data_conclusao.toISOString().split('T')[0]
            : null,
          regras_aprovadas: regras,
        };
      });

      const totalCumpridos = itens.filter((i) => i.concluida).length;

      return {
        id: esp.id,
        cd_especialidade: esp.cd_especialidade,
        ds_especialidade: esp.ds_especialidade,
        slug: esp.slug,
        ramo: esp.ramo,
        eixo: esp.eixo
          ? {
              id: esp.eixo.id,
              ds_eixo: esp.eixo.nm_eixo,
            }
          : null,
        meta_nivel_1: esp.meta_nivel_1 ?? 4,
        meta_nivel_2: esp.meta_nivel_2 ?? 8,
        total_itens: esp.itens.length,
        conquista: {
          nr_nivel: progEsp ? progEsp.nr_nivel : 0,
          qtd_itens_concluidos: progEsp ? progEsp.qtd_itens_concluidos : totalCumpridos,
          fl_concluido: progEsp ? progEsp.fl_concluido : false,
          origem: progEsp ? progEsp.origem : 'EQUIVALENCIA_AUTOMATICA',
          dt_conquista: progEsp?.dt_conquista
            ? progEsp.dt_conquista.toISOString().split('T')[0]
            : null,
        },
        itens,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        associado: {
          cd_associado: assoc.cd_associado,
          nm_associado: assoc.nm_associado,
          ramo: ramoNormalizado,
          is_senior_ou_pioneiro: isSeniorOuPioneiro,
        },
        especialidades,
      },
    });
  } catch (error: any) {
    console.error('[API Especialidades PN [id] GET] Erro:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao carregar especialidades PN do jovem.' },
      { status: 500 }
    );
  }
}
