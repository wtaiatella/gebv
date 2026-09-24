import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { normalizeRamo, Ramo } from '@/app/lib/ramo';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ramoParam = searchParams.get('ramo');
    const ramo = ramoParam ? normalizeRamo(ramoParam) : Ramo.ESCOTEIRO;

    // 1. Busca todas as regras do ramo com dados das ações, blocos e eixos
    const regrasDb = await prisma.pnEquivalenciaRegra.findMany({
      where: {
        acao: {
          ds_ramo: ramo,
        },
      },
      include: {
        acao: {
          include: {
            bloco: {
              include: {
                eixo: true,
              },
            },
          },
        },
      },
      orderBy: [
        { acao: { bloco: { eixo: { nr_ordem: 'asc' } } } },
        { acao: { bloco: { nr_ordem: 'asc' } } },
        { acao: { nr_ordem: 'asc' } },
      ],
    });

    const regras = regrasDb.map((r) => {
      const detalhes: any = r.detalhes_regra && typeof r.detalhes_regra === 'object' ? r.detalhes_regra : {};
      return {
        id: r.id,
        acao_pn_id: r.acao_pn_id,
        operacao: r.operacao,
        descricao_origem: r.descricao_origem,
        detalhes_regra: r.detalhes_regra,
        origem_pistas_ueb: Array.isArray(detalhes.origem_pistas_ueb) ? detalhes.origem_pistas_ueb : [],
        origem_rumo_ueb: Array.isArray(detalhes.origem_rumo_ueb) ? detalhes.origem_rumo_ueb : [],
        origem_especialidades: Array.isArray(detalhes.origem_especialidades) ? detalhes.origem_especialidades : [],
        nivel_min_especialidade: typeof detalhes.nivel_min_especialidade === 'number' ? detalhes.nivel_min_especialidade : 1,
        min_count: typeof detalhes.min_count === 'number' ? detalhes.min_count : 1,
        fl_requer_validacao_manual: r.fl_requer_validacao_manual,
        updated_at: r.updated_at,
        ds_acao: r.acao.ds_acao,
        tp_acao: r.acao.tp_acao,
        modalidade: r.acao.modalidade,
        regra_qtd_texto: r.acao.regra_qtd_texto,
        nr_ordem_acao: r.acao.nr_ordem,
        bloco_id: r.acao.bloco_id,
        nm_bloco: r.acao.bloco.nm_bloco,
        ds_intencionalidade: r.acao.bloco.ds_intencionalidade,
        nr_ordem_bloco: r.acao.bloco.nr_ordem,
        eixo_id: r.acao.bloco.eixo_id,
        nm_eixo: r.acao.bloco.eixo.nm_eixo,
        ds_ramo: r.acao.ds_ramo,
      };
    });

    // 2. Busca lista de Eixos
    const eixosDb = await prisma.pnEixo.findMany({
      where: { ds_ramo: ramo },
      orderBy: { nr_ordem: 'asc' },
    });
    const eixos = eixosDb.map((e) => ({
      id: e.id,
      nm_eixo: e.nm_eixo,
      nr_ordem: e.nr_ordem,
    }));

    // 3. Busca lista de Blocos
    const blocosDb = await prisma.pnBloco.findMany({
      where: { ds_ramo: ramo },
      include: { eixo: true },
      orderBy: { nr_ordem: 'asc' },
    });
    const blocos = blocosDb.map((b) => ({
      id: b.id,
      eixo_id: b.eixo_id,
      nm_bloco: b.nm_bloco,
      nr_ordem: b.nr_ordem,
      ds_intencionalidade: b.ds_intencionalidade,
      nm_eixo: b.eixo.nm_eixo,
    }));

    // 4. Busca catálogo de atividades do Programa Antigo (Pistas e Rumo)
    const paAtividadesDb = await prisma.paAtividade.findMany({
      where: { ds_ramo: ramo },
      include: {
        competencia: {
          include: {
            caminho: true,
          },
        },
      },
      orderBy: [
        { competencia: { caminho: { cd_caminho_paxtu: 'asc' } } },
        { nr_ordenacao: 'asc' },
      ],
    });
    const pa_atividades = paAtividadesDb.map((a) => ({
      id: a.id,
      cd_ueb: a.identificacao || '',
      identificacao: a.identificacao || '',
      ds_atividade: a.ds_atividade,
      nr_ordenacao: a.nr_ordenacao,
      cd_caminho_paxtu: a.competencia?.caminho?.cd_caminho_paxtu || null,
      nm_caminho: a.competencia?.caminho?.nm_caminho || null,
      ds_competencia: a.competencia?.ds_competencia || null,
    }));

    // 5. Lista oficial de especialidades do Programa Antigo
    const espResult = await prisma.paEspecialidade.findMany({
      select: {
        cd_especialidade: true,
        ds_especialidade: true,
      },
      orderBy: {
        ds_especialidade: 'asc',
      },
    });

    return NextResponse.json({
      success: true,
      ramo,
      regras,
      eixos,
      blocos,
      pa_atividades,
      especialidades_catalogo: espResult,
    });
  } catch (error: any) {
    console.error('[API Regras Equivalência] Erro ao carregar regras:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao carregar regras de equivalência' },
      { status: 500 }
    );
  }
}
