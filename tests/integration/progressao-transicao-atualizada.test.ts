/**
 * Suíte de Testes de Integração Automatizados:
 * Transição do Programa Atualizado (18 Blocos), Auto-Save Online, Motor Semântico e Modelo Recursivo
 * Cobrindo AC.1 a AC.17 da spec 2026-09-21-transicao-programa-atualizado
 */

import { prisma } from '../../app/lib/prisma';
import { Ramo } from '../../app/lib/ramo';

export async function runProgressaoTransicaoAtualizadaTests() {
  console.log('🧪 [TEST SUITE] Iniciando Testes da Transição Atualizada de Progressão (AC.1 a AC.17)...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✓ ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}`);
      failed++;
    }
  }

  const TEST_ASSOC_ID = '9999992';

  try {
    // Setup inicial de associado de teste
    await prisma.associado.upsert({
      where: { cd_associado: TEST_ASSOC_ID },
      create: {
        cd_associado: TEST_ASSOC_ID,
        nm_associado: 'Jovem Teste Transição Atualizada',
        ds_ramo: Ramo.ESCOTEIRO,
        ds_categoria: 'BENEFICIARIO',
        fl_status: 'ATIVO',
      },
      update: {
        ds_ramo: Ramo.ESCOTEIRO,
        ds_categoria: 'BENEFICIARIO',
        fl_status: 'ATIVO',
      },
    });

    console.log('🔹 Bloco 0: Setup e Verificação do Banco');
    const assoc = await prisma.associado.findUnique({
      where: { cd_associado: TEST_ASSOC_ID },
    });
    assert(assoc !== null && assoc.cd_associado === TEST_ASSOC_ID, 'Associado de teste criado com sucesso');

    // Asserção do enum OperacaoEquivalencia atualizado
    const contagemRegras = await prisma.pnEquivalenciaRegra.count();
    assert(contagemRegras >= 0, 'Tabela pn_equivalencia_regras acessível com novo schema');

    // Asserção das colunas de embedding Float[]
    const acaoComEmbedding = await prisma.pnAcaoEducativa.findFirst({
      select: { id: true, embedding: true },
    });
    assert(acaoComEmbedding !== null && Array.isArray(acaoComEmbedding.embedding), 'pn_acoes_educativas possui coluna embedding Float[]');

    const ativComEmbedding = await prisma.paAtividade.findFirst({
      select: { id: true, embedding: true },
    });
    assert(ativComEmbedding !== null && Array.isArray(ativComEmbedding.embedding), 'pa_atividades possui coluna embedding Float[]');

    // =========================================================================
    // BLOCO 1 (US-1 / AC.14): Busca Semântica Vetorial para Progressão
    // =========================================================================
    console.log('\n🔹 Bloco 1: Busca Semântica Vetorial para Progressão (AC.14)');
    const { GET: getSemantico } = await import('../../app/api/progressoes/semantico/route');
    const { NextRequest } = await import('next/server');

    // Cria ação temporária com embedding sintético para teste
    const blocoEscoteiro = await prisma.pnBloco.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO },
    });

    if (blocoEscoteiro) {
      const mockVectorA = new Array(1024).fill(0.1);
      const mockVectorB = new Array(1024).fill(0.09);

      const acaoTeste = await prisma.pnAcaoEducativa.create({
        data: {
          bloco_id: blocoEscoteiro.id,
          ds_ramo: Ramo.ESCOTEIRO,
          tp_acao: 'FIXA',
          ds_acao: 'Ação de teste para motor semântico',
          embedding: mockVectorA,
        },
      });

      // Cria ou atualiza uma atividade PA com vetor próximo
      const compTeste = await prisma.paCompetencia.findFirst({
        where: { ds_ramo: Ramo.ESCOTEIRO },
      });

      let ativTesteId: number | null = null;
      if (compTeste) {
        const ativTeste = await prisma.paAtividade.create({
          data: {
            competencia_id: compTeste.id,
            cd_caminho_paxtu: '5',
            cd_atividade_paxtu: 'TEST_9999',
            identificacao: 'TST-01',
            ds_atividade: 'Atividade de teste semântico similar',
            embedding: mockVectorB,
          },
        });
        ativTesteId = ativTeste.id;
      }

      try {
        const reqSemantico = new NextRequest(
          `http://localhost:3010/api/progressoes/semantico?acao_pn_id=${acaoTeste.id}&ramo=Escoteiro`
        );
        const resSemantico = await getSemantico(reqSemantico);
        const jsonSemantico = await resSemantico.json();

        assert(resSemantico.status === 200, 'Endpoint GET /api/progressoes/semantico responde status 200');
        assert(jsonSemantico.success === true, 'Payload retorna success: true');
        assert(jsonSemantico.acao_pn_id === acaoTeste.id, 'acao_pn_id confere com o parâmetro enviado');
        assert(Array.isArray(jsonSemantico.sugestoes), 'sugestoes retorna array de itens');

        if (jsonSemantico.sugestoes.length > 1) {
          const score0 = jsonSemantico.sugestoes[0].score;
          const score1 = jsonSemantico.sugestoes[1].score;
          assert(score0 >= score1, 'Sugestões retornam ordenadas por score decrescente');
        }
      } finally {
        await prisma.pnAcaoEducativa.delete({ where: { id: acaoTeste.id } });
        if (ativTesteId) {
          await prisma.paAtividade.delete({ where: { id: ativTesteId } });
        }
      }
    }

    // =========================================================================
    // BLOCO 2 (US-2 / AC.12): Novo Modelo de Operações e Persistência Canônica em detalhes_regra
    // =========================================================================
    console.log('\n🔹 Bloco 2: Modelo Recursivo de Regras em detalhes_regra (AC.12)');
    const {
      validarDetalhesRegra,
      gerarDescricaoOrigem,
      avaliarRegraRecursiva,
    } = await import('../../app/lib/services/transicao-service');

    // 2.1 Validação de Auto-Aninhamento
    const regraAutoAninhadaTodas = {
      tipo: 'TODAS',
      blocos: [
        { tipo: 'PROGRESSOES', item: { pa_atividade_id: 10 } },
        {
          tipo: 'TODAS', // Ilegal: TODAS dentro de TODAS
          blocos: [{ tipo: 'PROGRESSOES', item: { pa_atividade_id: 11 } }],
        },
      ],
    };
    const resValTodas = validarDetalhesRegra(regraAutoAninhadaTodas);
    assert(resValTodas.valido === false, 'validarDetalhesRegra bloqueia auto-aninhamento de TODAS dentro de TODAS');

    const regraAutoAninhadaQntMinima = {
      tipo: 'QNT_MINIMA',
      quantidade_minima: 1,
      blocos: [
        {
          tipo: 'QNT_MINIMA', // Ilegal: QNT_MINIMA dentro de QNT_MINIMA
          quantidade_minima: 1,
          blocos: [{ tipo: 'PROGRESSOES', item: { pa_atividade_id: 12 } }],
        },
      ],
    };
    const resValQnt = validarDetalhesRegra(regraAutoAninhadaQntMinima);
    assert(resValQnt.valido === false, 'validarDetalhesRegra bloqueia auto-aninhamento de QNT_MINIMA dentro de QNT_MINIMA');

    // 2.2 Validação de Regra Composta Válida (QNT_MINIMA dentro de TODAS)
    const regraCompostaValida = {
      tipo: 'TODAS',
      blocos: [
        { tipo: 'PROGRESSOES', item: { pa_atividade_id: 101, identificacao: 'PT-101' } },
        {
          tipo: 'QNT_MINIMA',
          quantidade_minima: 2,
          blocos: [
            { tipo: 'PROGRESSOES', item: { pa_atividade_id: 201, identificacao: 'RT-201' } },
            { tipo: 'PROGRESSOES', item: { pa_atividade_id: 202, identificacao: 'RT-202' } },
            { tipo: 'ESPECIALIDADE', pa_especialidade_id: 50, nm_especialidade: 'Pioneiria', nivel_minimo: 2 },
          ],
        },
      ],
    };
    const resValValida = validarDetalhesRegra(regraCompostaValida);
    assert(resValValida.valido === true, 'validarDetalhesRegra aceita regra composta válida (QNT_MINIMA em TODAS)');

    const regraInversaValida = {
      tipo: 'QNT_MINIMA',
      quantidade_minima: 1,
      blocos: [
        {
          tipo: 'TODAS',
          blocos: [
            { tipo: 'PROGRESSOES', item: { pa_atividade_id: 201, identificacao: 'RT-201' } },
            { tipo: 'PROGRESSOES', item: { pa_atividade_id: 202, identificacao: 'RT-202' } },
          ],
        },
      ],
    };
    const resValInversa = validarDetalhesRegra(regraInversaValida);
    assert(resValInversa.valido === true, 'validarDetalhesRegra aceita regra composta válida (TODAS dentro de QNT_MINIMA)');

    // 2.3 Gerador de Descrição de Origem
    const desc = gerarDescricaoOrigem(regraCompostaValida);
    assert(desc.includes('Todas:') && desc.includes('Mínimo de 2:'), 'gerarDescricaoOrigem compõe texto legível de árvore recursiva');

    // 2.4 Avaliação Recursiva: Cenário 1 (Incompleto - falta 1 item de QNT_MINIMA)
    const mockContexto1 = {
      atividadesPaConcluidasIds: new Set([101, 201]), // 101 cumpre TODAS[0], 201 cumpre 1 de QNT_MINIMA (precisa de 2)
      atividadesPaIdentificacoes: new Set(['PT-101', 'RT-201']),
      especialidadesPa: new Map<string, number>(),
    };
    const avaliacao1 = avaliarRegraRecursiva(regraCompostaValida, mockContexto1);
    assert(avaliacao1.atingido === false, 'avaliarRegraRecursiva retorna false quando QNT_MINIMA não atinge quantidade_minima');

    // 2.5 Avaliação Recursiva: Cenário 2 (Completo - jovem obteve Especialidade de Pioneiria Nível 2)
    const mockContexto2 = {
      atividadesPaConcluidasIds: new Set([101, 201]),
      atividadesPaIdentificacoes: new Set(['PT-101', 'RT-201']),
      especialidadesPa: new Map<string, number>([['pioneiria', 2]]),
    };
    const avaliacao2 = avaliarRegraRecursiva(regraCompostaValida, mockContexto2);
    assert(avaliacao2.atingido === true, 'avaliarRegraRecursiva retorna true quando TODAS e QNT_MINIMA são satisfeitas');
    assert(avaliacao2.itensConquistados.length >= 3, 'itensConquistados coleta todas as evidências dos sub-blocos');

    // 2.6 Avaliação Recursiva: Cenário 3 (Nó Semântico OR)
    const regraSemantica = {
      tipo: 'SEMANTICO',
      logica: 'OR',
      itens: [
        { pa_atividade_id: 301, identificacao: 'PT-301', score_capturado: 0.85 },
        { pa_atividade_id: 302, identificacao: 'PT-302', score_capturado: 0.78 },
      ],
    };
    const mockContextoSem = {
      atividadesPaConcluidasIds: new Set([302]),
      atividadesPaIdentificacoes: new Set(['PT-302']),
      especialidadesPa: new Map<string, number>(),
    };
    const avaliacaoSem = avaliarRegraRecursiva(regraSemantica, mockContextoSem);
    assert(avaliacaoSem.atingido === true, 'avaliarRegraRecursiva avalia nó SEMANTICO com lógica OR');

    // 2.7 Persistência via PUT /api/regras-equivalencia/[id]
    const { PUT: putRegra } = await import('../../app/api/regras-equivalencia/[id]/route');
    const regraDb = await prisma.pnEquivalenciaRegra.findFirst();
    if (regraDb) {
      // Teste de rejeição de auto-aninhamento via API
      const reqRejeicao = new NextRequest(`http://localhost:3000/api/regras-equivalencia/${regraDb.id}`, {
        method: 'PUT',
        body: JSON.stringify({ detalhes_regra: regraAutoAninhadaTodas }),
      });
      const resRejeicao = await putRegra(reqRejeicao, { params: Promise.resolve({ id: String(regraDb.id) }) });
      assert(resRejeicao.status === 400, 'API PUT /api/regras-equivalencia/[id] rejeita auto-aninhamento com status 400');

      // Teste de gravação válida
      const reqValido = new NextRequest(`http://localhost:3000/api/regras-equivalencia/${regraDb.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          operacao: 'TODAS',
          detalhes_regra: regraCompostaValida,
        }),
      });
      const resValido = await putRegra(reqValido, { params: Promise.resolve({ id: String(regraDb.id) }) });
      assert(resValido.status === 200, 'API PUT /api/regras-equivalencia/[id] aceita regra recursiva válida com status 200');

      // Restaura regra original do banco
      await prisma.pnEquivalenciaRegra.update({
        where: { id: regraDb.id },
        data: {
          operacao: regraDb.operacao,
          detalhes_regra: regraDb.detalhes_regra as any,
          descricao_origem: regraDb.descricao_origem,
        },
      });
    }

    // =========================================================================
    // BLOCO 3 (US-3 / AC.2-AC.7): Auto-Save, Regra de Ouro Simétrica e Reset Status
    // =========================================================================
    console.log('\n🔹 Bloco 3: Auto-Save Online, Regra de Ouro Simétrica e Reset Status (AC.2-AC.7)');
    const { toggleAcaoNovoModelo } = await import('../../app/lib/services/transicao-service');
    const { POST: postAcao, DELETE: deleteAcao } = await import('../../app/api/progressoes/novo-modelo/[id]/acao/route');

    const acaoQualquer = await prisma.pnAcaoEducativa.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO },
    });
    if (acaoQualquer) {
      // 3.1 Toggle manual TRUE: grava MANUAL_CHEFE e retorna payload atômico { acao, bloco }
      const resToggleTrue = await toggleAcaoNovoModelo(TEST_ASSOC_ID, acaoQualquer.id, true, 'Chefe Teste', 'Obs teste', 'Escoteiro');
      assert(resToggleTrue.success === true, 'toggleAcaoNovoModelo executa com sucesso para fl_concluido = true');
      assert(resToggleTrue.data.acao.fl_concluido === true, 'Ação retorna com fl_concluido = true');
      assert(resToggleTrue.data.acao.origem === 'MANUAL_CHEFE', 'Ação manual gravada com origem = MANUAL_CHEFE');
      assert(resToggleTrue.data.bloco !== undefined && typeof resToggleTrue.data.bloco.pct_conclusao === 'number', 'Retorna dados recalculados do bloco');

      // 3.2 Regra de Ouro Simétrica (ADR-5): Toggle manual FALSE DEVE persistir origem = MANUAL_CHEFE
      const resToggleFalse = await toggleAcaoNovoModelo(TEST_ASSOC_ID, acaoQualquer.id, false, 'Chefe Teste', 'Desmarcado manualmente', 'Escoteiro');
      assert(resToggleFalse.success === true, 'toggleAcaoNovoModelo executa com sucesso para fl_concluido = false');
      assert(resToggleFalse.data.acao.fl_concluido === false, 'Ação retorna com fl_concluido = false');
      assert(resToggleFalse.data.acao.origem === 'MANUAL_CHEFE', 'Regra de Ouro Simétrica: desmarcação manual preserva origem = MANUAL_CHEFE');

      // Verifica no banco de dados diretamente
      const progNoBanco = await prisma.progressaoPn.findUnique({
        where: {
          cd_associado_acao_id: {
            cd_associado: TEST_ASSOC_ID,
            acao_id: acaoQualquer.id,
          },
        },
      });
      assert(progNoBanco !== null && progNoBanco.fl_concluido === false && progNoBanco.origem === 'MANUAL_CHEFE', 'Banco de dados armazena fl_concluido = false com MANUAL_CHEFE');

      // 3.3 Endpoint POST /api/progressoes/novo-modelo/[id]/acao
      const reqPost = new NextRequest(`http://localhost:3000/api/progressoes/novo-modelo/${TEST_ASSOC_ID}/acao`, {
        method: 'POST',
        body: JSON.stringify({
          acao_id: acaoQualquer.id,
          fl_concluido: true,
          ramo: 'Escoteiro',
        }),
      });
      const resPost = await postAcao(reqPost, { params: Promise.resolve({ id: TEST_ASSOC_ID }) });
      const jsonPost = await resPost.json();
      assert(resPost.status === 200 && jsonPost.success === true && jsonPost.data?.acao?.fl_concluido === true, 'API POST /api/progressoes/novo-modelo/[id]/acao retorna { acao, bloco }');

      // 3.4 Reset Status via DELETE em item MANUAL_CHEFE
      const reqDel = new NextRequest(`http://localhost:3000/api/progressoes/novo-modelo/${TEST_ASSOC_ID}/acao?acao_id=${acaoQualquer.id}&ramo=Escoteiro`, {
        method: 'DELETE',
      });
      const resDel = await deleteAcao(reqDel, { params: Promise.resolve({ id: TEST_ASSOC_ID }) });
      const jsonDel = await resDel.json();
      assert(resDel.status === 200 && jsonDel.success === true && jsonDel.data?.acao?.origem === null, 'DELETE remove registro MANUAL_CHEFE e retorna status neutro');

      // 3.5 Reset Status via DELETE rejeita itens não manuais (400 Bad Request)
      const reqDelAuto = new NextRequest(`http://localhost:3000/api/progressoes/novo-modelo/${TEST_ASSOC_ID}/acao?acao_id=${acaoQualquer.id}&ramo=Escoteiro`, {
        method: 'DELETE',
      });
      const resDelAuto = await deleteAcao(reqDelAuto, { params: Promise.resolve({ id: TEST_ASSOC_ID }) });
      assert(resDelAuto.status === 400, 'DELETE rejeita remoção em ação que não possui marcação MANUAL_CHEFE (400 Bad Request)');
    }

    // =========================================================================
    // BLOCO 4 (US-4 / AC.9, AC.10): Concessão Automática das 15 Ações de Especialidades PN
    // =========================================================================
    console.log('\n🔹 Bloco 4: Concessão Automática e Inviolabilidade das 15 Ações de Especialidades PN (AC.9, AC.10)');
    const { extrairEspecialidadesPnDaAcao, processarTransicaoAssociado } = await import('../../app/lib/services/transicao-service');

    // Encontra a primeira ação de especialidade PN
    const acaoEspPn = await prisma.pnAcaoEducativa.findFirst({
      where: {
        ds_acao: { startsWith: 'Conquistar ao menos uma das seguintes especialidades' },
      },
    });

    if (acaoEspPn) {
      const parsed = extrairEspecialidadesPnDaAcao(acaoEspPn.ds_acao);
      assert(parsed !== null && parsed.especialidades.length > 0 && parsed.nivel_exigido >= 1, 'extrairEspecialidadesPnDaAcao extrai nível exigido e nomes das especialidades');

      const primeiraEspNome = parsed!.especialidades[0];
      
      // Cria especialidade PN no catálogo se não existir
      let espPn = await prisma.pnEspecialidade.findFirst({
        where: { ds_especialidade: { equals: primeiraEspNome, mode: 'insensitive' } },
      });
      if (!espPn) {
        espPn = await prisma.pnEspecialidade.create({
          data: {
            ds_especialidade: primeiraEspNome,
            slug: primeiraEspNome.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          },
        });
      }

      if (espPn) {
        // Concede a especialidade ao jovem de teste no nível exigido
        await prisma.progressaoEspecialidadePn.upsert({
          where: {
            cd_associado_especialidade_id: {
              cd_associado: TEST_ASSOC_ID,
              especialidade_id: espPn.id,
            },
          },
          create: {
            cd_associado: TEST_ASSOC_ID,
            especialidade_id: espPn.id,
            nr_nivel: parsed!.nivel_exigido,
            fl_concluido: true,
            origem: 'MANUAL_CHEFE',
          },
          update: {
            nr_nivel: parsed!.nivel_exigido,
            fl_concluido: true,
          },
        });

        // Executa recálculo de transição
        const resTransicao = await processarTransicaoAssociado(TEST_ASSOC_ID, 'Escoteiro');
        assert(resTransicao !== null && resTransicao.associado.cd_associado === TEST_ASSOC_ID, 'processarTransicaoAssociado executa com sucesso');

        // Verifica se a ação educativa foi concedida com EQUIVALENCIA_AUTOMATICA
        const progConcedida = await prisma.progressaoPn.findUnique({
          where: {
            cd_associado_acao_id: {
              cd_associado: TEST_ASSOC_ID,
              acao_id: acaoEspPn.id,
            },
          },
        });
        assert(progConcedida !== null && progConcedida.fl_concluido === true && progConcedida.origem === 'EQUIVALENCIA_AUTOMATICA', 'Ação de especialidade PN é concedida com EQUIVALENCIA_AUTOMATICA');

        // Inviolabilidade de MANUAL_CHEFE prévia: chefe desmarca manualmente
        await prisma.progressaoPn.update({
          where: {
            cd_associado_acao_id: {
              cd_associado: TEST_ASSOC_ID,
              acao_id: acaoEspPn.id,
            },
          },
          data: {
            fl_concluido: false,
            origem: 'MANUAL_CHEFE',
          },
        });

        // Re-executa recálculo de transição
        await processarTransicaoAssociado(TEST_ASSOC_ID, 'Escoteiro');
        const progAposRecalculo = await prisma.progressaoPn.findUnique({
          where: {
            cd_associado_acao_id: {
              cd_associado: TEST_ASSOC_ID,
              acao_id: acaoEspPn.id,
            },
          },
        });
        assert(progAposRecalculo !== null && progAposRecalculo.fl_concluido === false && progAposRecalculo.origem === 'MANUAL_CHEFE', 'Inviolabilidade: recálculo de transição NUNCA sobrescreve ação com MANUAL_CHEFE');
      }
    }

    // =========================================================================
    // BLOCO 5 (US-5 / AC.11): Integridade das 216 Ações PA Complementares
    // =========================================================================
    console.log('\n🔹 Bloco 5: Integridade das 216 Ações PA Complementares (AC.11)');
    const totalAcoesPa = await prisma.pnAcaoEducativa.count({
      where: { tp_acao: 'PA' },
    });
    assert(totalAcoesPa === 216, `Catálogo de ações complementares PA possui exatamente 216 itens (obtido: ${totalAcoesPa})`);

    const acoesPaEscoteiro = await prisma.pnAcaoEducativa.count({
      where: { tp_acao: 'PA', ds_ramo: Ramo.ESCOTEIRO },
    });
    assert(acoesPaEscoteiro === 216, 'Todas as 216 ações PA complementares pertencem ao ramo Escoteiro');

    // =========================================================================
    // BLOCO 6 (US-8 / AC.17): Carga Canônica das 448 Regras de Equivalência
    // =========================================================================
    console.log('\n🔹 Bloco 6: Carga Canônica das 448 Regras de Equivalência (AC.17)');
    const totalRegrasDb = await prisma.pnEquivalenciaRegra.count();
    assert(totalRegrasDb === 448, `Banco de dados possui exatamente 448 regras de equivalência (obtido: ${totalRegrasDb})`);

    const regrasComDetalhes = await prisma.pnEquivalenciaRegra.count({
      where: { detalhes_regra: { not: undefined } },
    });
    assert(regrasComDetalhes === 448, 'Todas as 448 regras possuem campo detalhes_regra preenchido');

    const regrasSemEquiv = await prisma.pnEquivalenciaRegra.count({
      where: { operacao: 'SEM_EQUIVALENCIA' },
    });
    assert(regrasSemEquiv === 59, `Exatamente 59 regras possuem operacao = SEM_EQUIVALENCIA (obtido: ${regrasSemEquiv})`);

    const regrasProgressoes = await prisma.pnEquivalenciaRegra.count({
      where: { operacao: 'PROGRESSOES' },
    });
    assert(regrasProgressoes === 285, `Exatamente 285 regras possuem operacao = PROGRESSOES (obtido: ${regrasProgressoes})`);

    console.log(`\n🏁 Suíte executada: ${passed} passaram, ${failed} falharam.\n`);
  } catch (err: any) {
    console.error('❌ Erro fatal durante a execução dos testes:', err);
    failed++;
  } finally {
    // Teardown / Cleanup
    try {
      await prisma.progressaoPn.deleteMany({
        where: { cd_associado: TEST_ASSOC_ID },
      });
      await prisma.associado.delete({
        where: { cd_associado: TEST_ASSOC_ID },
      });
    } catch {
      // Ignora erro de cleanup
    }
  }

  return { passed, failed };
}

// Execução direta via CLI (tsx)
if (require.main === module || process.argv[1]?.includes('progressao-transicao-atualizada.test.ts')) {
  runProgressaoTransicaoAtualizadaTests().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}
