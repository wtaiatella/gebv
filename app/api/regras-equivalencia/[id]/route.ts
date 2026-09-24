import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { OperacaoEquivalencia } from '@prisma/client';
import { validarDetalhesRegra, gerarDescricaoOrigem } from '@/app/lib/services/transicao-service';

type Params = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ruleId = parseInt(id, 10);

    if (isNaN(ruleId)) {
      return NextResponse.json({ success: false, error: 'ID inválido' }, { status: 400 });
    }

    const body = await request.json();
    const {
      operacao,
      descricao_origem,
      detalhes_regra,
      origem_pistas_ueb,
      origem_rumo_ueb,
      origem_especialidades,
      nivel_min_especialidade,
      min_count,
      fl_requer_validacao_manual,
    } = body;

    // Validações básicas de operação
    if (operacao && !Object.values(OperacaoEquivalencia).includes(operacao)) {
      return NextResponse.json(
        { success: false, error: `Operação inválida: ${operacao}. Permitidas: ${Object.values(OperacaoEquivalencia).join(', ')}` },
        { status: 400 }
      );
    }

    const dataToUpdate: any = {};
    if (operacao !== undefined) dataToUpdate.operacao = operacao as OperacaoEquivalencia;
    if (fl_requer_validacao_manual !== undefined) dataToUpdate.fl_requer_validacao_manual = Boolean(fl_requer_validacao_manual);

    let finalDetalhes = detalhes_regra;

    // Se detalhes_regra não foi fornecido mas campos legados foram
    if (finalDetalhes === undefined && (origem_pistas_ueb !== undefined || origem_rumo_ueb !== undefined || origem_especialidades !== undefined)) {
      finalDetalhes = {
        origem_pistas_ueb: Array.isArray(origem_pistas_ueb) ? origem_pistas_ueb : [],
        origem_rumo_ueb: Array.isArray(origem_rumo_ueb) ? origem_rumo_ueb : [],
        origem_especialidades: Array.isArray(origem_especialidades) ? origem_especialidades : [],
        nivel_min_especialidade: parseInt(nivel_min_especialidade, 10) || 1,
        min_count: parseInt(min_count, 10) || 1,
      };
    }

    if (finalDetalhes !== undefined) {
      const validacao = validarDetalhesRegra(finalDetalhes);
      if (!validacao.valido) {
        return NextResponse.json(
          { success: false, error: validacao.erro || 'Estrutura de detalhes_regra inválida' },
          { status: 400 }
        );
      }
      dataToUpdate.detalhes_regra = finalDetalhes;
    }

    if (descricao_origem !== undefined && descricao_origem !== '') {
      dataToUpdate.descricao_origem = descricao_origem;
    } else if (finalDetalhes !== undefined) {
      dataToUpdate.descricao_origem = gerarDescricaoOrigem(finalDetalhes, operacao);
    }

    const regra = await prisma.pnEquivalenciaRegra.update({
      where: { id: ruleId },
      data: dataToUpdate,
    });

    return NextResponse.json({
      success: true,
      regra,
    });
  } catch (error: any) {
    console.error('[API Regras Equivalência PUT] Erro ao atualizar regra:', error);
    if (error.code === 'P2025') {
      return NextResponse.json({ success: false, error: 'Regra de equivalência não encontrada' }, { status: 404 });
    }
    return NextResponse.json(
      { success: false, error: error.message || 'Erro ao salvar alterações da regra' },
      { status: 500 }
    );
  }
}
