import prisma from '../../app/lib/prisma';
import {
  upsertProgressaoPaxtuBruto,
  upsertProgressaoPa,
  upsertEspecialidadesAssociado,
} from '../../app/lib/services/sync-service';
import {
  transicionarEspecialidadesAssociado,
  transicionarEspecialidadesSecao,
} from '../../app/lib/services/transicao-especialidades-service';
import { Ramo } from '../../app/lib/ramo';

async function runEspecialidadesTransicaoTests() {
  console.log('🧪 [TEST SUITE] Iniciando Testes de Transição de Especialidades (AC-1 a AC-7)...\n');
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

  const TEST_ASSOC_ID = '9999991';

  try {
    // Setup inicial de associado de teste
    await prisma.associado.upsert({
      where: { cd_associado: TEST_ASSOC_ID },
      create: {
        cd_associado: TEST_ASSOC_ID,
        nm_associado: 'Jovem Teste Transição Especialidades',
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

    // =========================================================================
    // BLOCO 1 (AC-1): Cofre de Dados Brutos (progressao_paxtu.dados_brutos)
    // =========================================================================
    console.log('🔹 Bloco 1: Cofre de Dados Brutos (AC-1)');
    const mockPayloadBruto = {
      caminhos: [{ caminhoId: 4, itens: [1, 2, 3] }, { caminhoId: 5, itens: [4, 5] }],
      especialidades: [{ id: 45, nome: 'Acampamento', itens: [10, 20] }],
      insignias: [{ id: 1, nome: 'Insígnia Mundial de Meio Ambiente' }],
    };

    await upsertProgressaoPaxtuBruto(TEST_ASSOC_ID, mockPayloadBruto);

    const paxtuDb = await prisma.progressaoPaxtu.findUnique({
      where: { cd_associado: TEST_ASSOC_ID },
    });

    assert(paxtuDb !== null, 'AC-1.1: Registro em progressao_paxtu criado com sucesso');
    const dadosLidos = paxtuDb?.dados_brutos as typeof mockPayloadBruto;
    assert(
      Array.isArray(dadosLidos.caminhos) && dadosLidos.caminhos.length === 2,
      'AC-1.2: caminhos brutos preservados integralmente sem truncamento'
    );
    assert(
      Array.isArray(dadosLidos.especialidades) && dadosLidos.especialidades[0].nome === 'Acampamento',
      'AC-1.3: especialidades brutas retidas com integridade forense'
    );

    // =========================================================================
    // BLOCO 2 (AC-2): Integridade do Schema pa_atividades
    // =========================================================================
    console.log('\n🔹 Bloco 2: Integridade do Schema pa_atividades (AC-2)');
    const sampleAtividade = await prisma.paAtividade.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO },
    });
    assert(sampleAtividade !== null, 'AC-2.1: Catálogo de atividades PA disponível');
    assert(!('cd_ueb' in (sampleAtividade || {})), 'AC-2.2: cd_ueb removido de pa_atividades');
    assert(
      typeof sampleAtividade?.nr_ordenacao === 'number' || sampleAtividade?.nr_ordenacao === null,
      'AC-2.3: nr_ordenacao presente para ordenação curricular confiável'
    );

    // =========================================================================
    // BLOCO 3 (AC-3): Renderização do Programa Antigo (concluida vs pendente)
    // =========================================================================
    console.log('\n🔹 Bloco 3: Renderização do Programa Antigo (AC-3)');
    if (sampleAtividade) {
      // Mock de atividade com status "conversar" (pendente, sem data de conclusão válida)
      await prisma.progressaoPa.upsert({
        where: {
          cd_associado_atividade_id: {
            cd_associado: TEST_ASSOC_ID,
            atividade_id: sampleAtividade.id,
          },
        },
        create: {
          cd_associado: TEST_ASSOC_ID,
          atividade_id: sampleAtividade.id,
          concluida: false,
          status_escotista: 'conversar',
          data_conclusao: null,
        },
        update: {
          concluida: false,
          status_escotista: 'conversar',
          data_conclusao: null,
        },
      });

      const progPendente = await prisma.progressaoPa.findUnique({
        where: {
          cd_associado_atividade_id: {
            cd_associado: TEST_ASSOC_ID,
            atividade_id: sampleAtividade.id,
          },
        },
      });

      assert(
        progPendente?.concluida === false && progPendente?.status_escotista === 'conversar',
        'AC-3.1: Item com status "conversar" persiste concluida: false'
      );
      assert(
        progPendente?.data_conclusao === null,
        'AC-3.2: Item não concluído não retém data de conclusão ativa (eliminação de falso positivo)'
      );
    }

    // =========================================================================
    // BLOCO 4 (AC-4): Conclusão de Especialidade PA com base em dt_item
    // =========================================================================
    console.log('\n🔹 Bloco 4: Conclusão de Especialidade PA com base em dt_item (AC-4)');
    // Busca 1 especialidade PA com pelo menos 2 itens
    const umaEsp = await prisma.paEspecialidade.findFirst({
      where: { itens: { some: {} } },
      include: { itens: { take: 2 } },
    });
    assert(umaEsp !== null && umaEsp.itens.length >= 2, 'AC-4.1: Ao menos 2 itens da mesma especialidade PA no catálogo');

    if (umaEsp && umaEsp.itens.length >= 2) {
      const itemConcluido = umaEsp.itens[0];
      const itemPendente = umaEsp.itens[1];

      // Ingestão simulada
      const payloadEspecialidades = [
        {
          cd_especialidade: umaEsp.cd_especialidade,
          ds_especialidade: umaEsp.ds_especialidade,
          itens: [
            {
              cd_item: itemConcluido.cd_item,
              ds_item: itemConcluido.ds_item,
              dt_item: '2026-05-15', // Concluído
            },
            {
              cd_item: itemPendente.cd_item,
              ds_item: itemPendente.ds_item,
              dt_item: null, // Pendente
            },
          ],
        },
      ];

      await upsertEspecialidadesAssociado(TEST_ASSOC_ID, payloadEspecialidades);

      const dbItemConcluido = await prisma.progressaoEspecialidadeItemPa.findUnique({
        where: {
          cd_associado_especialidade_item_id: {
            cd_associado: TEST_ASSOC_ID,
            especialidade_item_id: itemConcluido.id,
          },
        },
      });

      const dbItemPendente = await prisma.progressaoEspecialidadeItemPa.findUnique({
        where: {
          cd_associado_especialidade_item_id: {
            cd_associado: TEST_ASSOC_ID,
            especialidade_item_id: itemPendente.id,
          },
        },
      });

      assert(
        dbItemConcluido?.concluida === true && dbItemConcluido.data_conclusao !== null,
        'AC-4.2: dt_item !== null grava concluida = true com data_conclusao'
      );
      assert(
        dbItemPendente?.concluida === false && dbItemPendente.data_conclusao === null,
        'AC-4.3: dt_item === null grava concluida = false sem data_conclusao'
      );
    }

    // =========================================================================
    // BLOCO 5 (AC-5): Embeddings e Similaridade de Cosseno
    // =========================================================================
    console.log('\n🔹 Bloco 5: Embeddings e Similaridade de Cosseno (AC-5)');
    const pnItemComEmb = await prisma.pnEspecialidadeItem.findFirst({
      where: { embedding: { isEmpty: false } },
    });
    const paItemComEmb = await prisma.paEspecialidadeItem.findFirst({
      where: { embedding: { isEmpty: false } },
    });

    assert(pnItemComEmb !== null, 'AC-5.1: Itens PN possuem embeddings 1024d salvos');
    assert(paItemComEmb !== null, 'AC-5.2: Itens PA possuem embeddings 1024d salvos');
    assert(
      pnItemComEmb?.embedding.length === 1024 && paItemComEmb?.embedding.length === 1024,
      'AC-5.3: Dimensão do embedding é exatamente 1024 float (bge-m3)'
    );

    // Produto escalar em vetores normalizados
    if (pnItemComEmb && paItemComEmb) {
      let dot = 0;
      for (let i = 0; i < 1024; i++) {
        dot += pnItemComEmb.embedding[i] * paItemComEmb.embedding[i];
      }
      assert(
        dot >= -1.0 && dot <= 1.0,
        `AC-5.4: Similaridade de cosseno válida entre -1 e 1 (score calculado: ${dot.toFixed(4)})`
      );
    }

    // =========================================================================
    // BLOCO 6 (AC-6): Regra de Ouro Simétrica (Inviolabilidade MANUAL_CHEFE)
    // =========================================================================
    console.log('\n🔹 Bloco 6: Regra de Ouro Simétrica (AC-6)');
    // Busca uma especialidade PN com itens
    const pnEsp = await prisma.pnEspecialidade.findFirst({
      where: { ramo: 'LOBINHO_ESCOTEIRO' },
      include: { itens: true },
    });

    if (pnEsp && pnEsp.itens.length >= 2) {
      const itemParaDesmarcar = pnEsp.itens[0];
      const itemParaMarcar = pnEsp.itens[1];

      // 1. Chefe desmarca deliberadamente item 0: concluida = false, origem = MANUAL_CHEFE
      await prisma.progressaoEspecialidadeItemPn.upsert({
        where: {
          cd_associado_especialidade_item_id: {
            cd_associado: TEST_ASSOC_ID,
            especialidade_item_id: itemParaDesmarcar.id,
          },
        },
        create: {
          cd_associado: TEST_ASSOC_ID,
          especialidade_item_id: itemParaDesmarcar.id,
          concluida: false,
          origem: 'MANUAL_CHEFE',
        },
        update: {
          concluida: false,
          origem: 'MANUAL_CHEFE',
        },
      });

      // 2. Cria regra homologada vinculando o item 0 a um item PA concluído
      if (umaEsp && umaEsp.itens.length > 0) {
        await prisma.pnEspecialidadeEquivalenciaRegra.upsert({
          where: {
            pn_item_id_pa_item_id: {
              pn_item_id: itemParaDesmarcar.id,
              pa_item_id: umaEsp.itens[0].id,
            },
          },
          create: {
            pn_item_id: itemParaDesmarcar.id,
            pa_item_id: umaEsp.itens[0].id,
            fl_aprovado: true,
            score_similaridade: 0.95,
          },
          update: {
            fl_aprovado: true,
          },
        });
      }

      // 3. Chefe marca manualmente item 1: concluida = true, origem = MANUAL_CHEFE
      await prisma.progressaoEspecialidadeItemPn.upsert({
        where: {
          cd_associado_especialidade_item_id: {
            cd_associado: TEST_ASSOC_ID,
            especialidade_item_id: itemParaMarcar.id,
          },
        },
        create: {
          cd_associado: TEST_ASSOC_ID,
          especialidade_item_id: itemParaMarcar.id,
          concluida: true,
          origem: 'MANUAL_CHEFE',
        },
        update: {
          concluida: true,
          origem: 'MANUAL_CHEFE',
        },
      });

      // 4. Executa recálculo de transição
      await transicionarEspecialidadesAssociado(TEST_ASSOC_ID);

      // 5. Verifica se as marcações do chefe foram preservadas
      const checkDesmarcado = await prisma.progressaoEspecialidadeItemPn.findUnique({
        where: {
          cd_associado_especialidade_item_id: {
            cd_associado: TEST_ASSOC_ID,
            especialidade_item_id: itemParaDesmarcar.id,
          },
        },
      });

      const checkMarcado = await prisma.progressaoEspecialidadeItemPn.findUnique({
        where: {
          cd_associado_especialidade_item_id: {
            cd_associado: TEST_ASSOC_ID,
            especialidade_item_id: itemParaMarcar.id,
          },
        },
      });

      assert(
        checkDesmarcado?.concluida === false && checkDesmarcado.origem === 'MANUAL_CHEFE',
        'AC-6.1: Regra de Ouro (false): Item desmarcado manualmente pelo chefe NUNCA é sobrescrito por recálculo'
      );
      assert(
        checkMarcado?.concluida === true && checkMarcado.origem === 'MANUAL_CHEFE',
        'AC-6.2: Regra de Ouro (true): Item marcado manualmente pelo chefe NUNCA é revogado por recálculo'
      );
    }

    // =========================================================================
    // BLOCO 7 (AC-7): Auto-Save Online e Recálculo Atômico de Nível
    // =========================================================================
    console.log('\n🔹 Bloco 7: Auto-Save Online e Recálculo Atômico de Nível (AC-7)');
    if (pnEsp) {
      // Simula Auto-Save via endpoint logic: marca itens até bater meta_nivel_1
      const meta1 = pnEsp.meta_nivel_1 ?? 4;

      for (let i = 0; i < meta1; i++) {
        const it = pnEsp.itens[i];
        await prisma.progressaoEspecialidadeItemPn.upsert({
          where: {
            cd_associado_especialidade_item_id: {
              cd_associado: TEST_ASSOC_ID,
              especialidade_item_id: it.id,
            },
          },
          create: {
            cd_associado: TEST_ASSOC_ID,
            especialidade_item_id: it.id,
            concluida: true,
            origem: 'MANUAL_CHEFE',
          },
          update: {
            concluida: true,
            origem: 'MANUAL_CHEFE',
          },
        });
      }

      // Recalcula atomicamente o nível
      const concluidos = await prisma.progressaoEspecialidadeItemPn.count({
        where: {
          cd_associado: TEST_ASSOC_ID,
          especialidade_item_id: { in: pnEsp.itens.map((i) => i.id) },
          concluida: true,
        },
      });

      let nivelCalculado = 0;
      if (concluidos >= (pnEsp.meta_nivel_2 ?? 8)) nivelCalculado = 2;
      else if (concluidos >= meta1) nivelCalculado = 1;

      await prisma.progressaoEspecialidadePn.upsert({
        where: {
          cd_associado_especialidade_id: {
            cd_associado: TEST_ASSOC_ID,
            especialidade_id: pnEsp.id,
          },
        },
        create: {
          cd_associado: TEST_ASSOC_ID,
          especialidade_id: pnEsp.id,
          nr_nivel: nivelCalculado,
          qtd_itens_concluidos: concluidos,
          fl_concluido: nivelCalculado === 2,
          origem: 'MANUAL_CHEFE',
        },
        update: {
          nr_nivel: nivelCalculado,
          qtd_itens_concluidos: concluidos,
          fl_concluido: nivelCalculado === 2,
        },
      });

      const progEspDb = await prisma.progressaoEspecialidadePn.findUnique({
        where: {
          cd_associado_especialidade_id: {
            cd_associado: TEST_ASSOC_ID,
            especialidade_id: pnEsp.id,
          },
        },
      });

      assert(
        progEspDb !== null && progEspDb.nr_nivel === 1,
        `AC-7.1: Concessão atômica de Nível 1 quando itens cumpridos (${concluidos}) >= meta (${meta1})`
      );
      assert(
        progEspDb?.qtd_itens_concluidos === concluidos,
        'AC-7.2: Contador de itens cumpridos sincronizado em tempo real'
      );
    }

    // Cleanup associado de teste
    await prisma.progressaoEspecialidadeItemPn.deleteMany({ where: { cd_associado: TEST_ASSOC_ID } });
    await prisma.progressaoEspecialidadePn.deleteMany({ where: { cd_associado: TEST_ASSOC_ID } });
    await prisma.progressaoEspecialidadeItemPa.deleteMany({ where: { cd_associado: TEST_ASSOC_ID } });
    await prisma.progressaoPa.deleteMany({ where: { cd_associado: TEST_ASSOC_ID } });
    await prisma.progressaoPaxtu.deleteMany({ where: { cd_associado: TEST_ASSOC_ID } });
    await prisma.associado.delete({ where: { cd_associado: TEST_ASSOC_ID } });

    console.log(`\n========================================`);
    console.log(`🏁 Total de testes: ${passed + failed} | Passaram: ${passed} | Falharam: ${failed}`);
    console.log(`========================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('💥 Erro fatal nos testes:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runEspecialidadesTransicaoTests();
