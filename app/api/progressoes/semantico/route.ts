import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { normalizeRamo, Ramo } from '@/app/lib/ramo';

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

interface CachedPaAtividade {
  id: number;
  identificacao: string;
  ds_atividade: string;
  caminho: string;
  competencia: string;
  embedding: number[];
}

let cachedAtividadesPa: CachedPaAtividade[] | null = null;
let loadingPromise: Promise<CachedPaAtividade[]> | null = null;

async function getAtividadesPaCached(ds_ramo: Ramo): Promise<CachedPaAtividade[]> {
  if (cachedAtividadesPa && cachedAtividadesPa.length > 0) {
    return cachedAtividadesPa;
  }

  if (!loadingPromise) {
    loadingPromise = (async () => {
      const rows = await prisma.paAtividade.findMany({
        where: { ds_ramo },
        select: {
          id: true,
          identificacao: true,
          ds_atividade: true,
          cd_caminho_paxtu: true,
          embedding: true,
          competencia: {
            select: {
              ds_competencia: true,
              caminho: {
                select: {
                  nm_caminho: true,
                },
              },
            },
          },
        },
      });

      cachedAtividadesPa = rows.map((r) => ({
        id: r.id,
        identificacao: r.identificacao || '',
        ds_atividade: r.ds_atividade,
        caminho: r.competencia?.caminho?.nm_caminho || r.cd_caminho_paxtu || '',
        competencia: r.competencia?.ds_competencia || '',
        embedding: r.embedding,
      }));

      return cachedAtividadesPa;
    })();
  }

  return loadingPromise;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const acaoPnIdParam = searchParams.get('acao_pn_id');
    const ramoParam = searchParams.get('ramo');

    if (!acaoPnIdParam) {
      return NextResponse.json(
        { success: false, error: 'Parâmetro acao_pn_id é obrigatório' },
        { status: 400 }
      );
    }

    const acaoPnId = parseInt(acaoPnIdParam, 10);
    if (isNaN(acaoPnId)) {
      return NextResponse.json(
        { success: false, error: 'Parâmetro acao_pn_id deve ser um número válido' },
        { status: 400 }
      );
    }

    const ramo = ramoParam ? normalizeRamo(ramoParam) : Ramo.ESCOTEIRO;

    // 1. Busca ação educativa do PN com seu embedding
    const acaoPn = await prisma.pnAcaoEducativa.findUnique({
      where: { id: acaoPnId },
      select: {
        id: true,
        ds_acao: true,
        embedding: true,
      },
    });

    if (!acaoPn) {
      return NextResponse.json(
        { success: false, error: 'Ação educativa do PN não encontrada' },
        { status: 404 }
      );
    }

    // 2. Carrega catálogo de PA em memória (cache)
    const atividadesPa = await getAtividadesPaCached(ramo);

    // 3. Se a ação não tiver embedding calculado ainda, retorna lista padrão
    if (!acaoPn.embedding || acaoPn.embedding.length === 0) {
      return NextResponse.json({
        success: true,
        acao_pn_id: acaoPn.id,
        total_correspondencias: 0,
        sugestoes: [],
        aviso: 'Embedding da ação PN não calculado ainda. Execute o script de embeddings.',
      });
    }

    // 4. Calcula similaridade de cosseno em memória
    const pontuados = atividadesPa
      .filter((pa) => pa.embedding && pa.embedding.length > 0)
      .map((pa) => ({
        pa_atividade_id: pa.id,
        identificacao: pa.identificacao,
        ds_atividade: pa.ds_atividade,
        caminho: pa.caminho,
        competencia: pa.competencia,
        score: Math.round(cosineSimilarity(acaoPn.embedding, pa.embedding) * 1000) / 1000,
      }))
      .sort((a, b) => b.score - a.score);

    // 5. Retorna Top 10
    const top10 = pontuados.slice(0, 10);

    return NextResponse.json({
      success: true,
      acao_pn_id: acaoPn.id,
      total_correspondencias: top10.length,
      sugestoes: top10,
    });
  } catch (error: any) {
    console.error('[API Progressoes Semantico GET] Erro:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao calcular similaridade semântica' },
      { status: 500 }
    );
  }
}
