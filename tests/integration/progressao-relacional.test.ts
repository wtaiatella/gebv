import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../../app/lib/prisma';
import {
  resolveAtividadeCatalogo,
  upsertProgressaoPa,
  upsertEspecialidadesAssociado,
  upsertItensEspecialidadeAssociado,
} from '../../app/lib/services/sync-service';
import { Ramo } from '../../app/lib/ramo';
import { runBackfill } from '../../scripts/backfill-progressao-relacional.mjs';
import { getEscoteiros } from '../../app/lib/data';
import { DataAccessError } from '../../app/lib/errors';

async function runProgressaoRelacionalTests() {
  console.log('🧪 [TEST SUITE] Iniciando Testes de Progressão Relacional (US1)...\n');
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

  // =========================================================================
  // BLOCO 1 (US1 / AC.1): Resolução de Atividade do Catálogo em 2 Etapas
  // =========================================================================
  console.log('🔹 1. Resolução de Atividade do Catálogo (resolveAtividadeCatalogo):');
  try {
    const mockMapCaminhoUeb = new Map<string, number>([
      ['4_P1', 101],
      ['5_PT1', 201],
    ]);
    const mockMapCdAtividade = new Map<string, number>([
      ['999', 101],
      ['888', 201],
    ]);

    // Critério 1: caminho + cd_ueb normal
    const res1 = resolveAtividadeCatalogo(mockMapCaminhoUeb, mockMapCdAtividade, {
      cdCaminho: '4',
      cdUeb: 'P1',
      cdAtividade: '999',
    });
    assert(res1 === 101, 'Critério 1: resolve por caminho + cd_ueb normal (4_P1 -> 101)');

    // Critério 2: fallback quando cd_ueb degrada para o ID da atividade no Paxtu
    const res2 = resolveAtividadeCatalogo(mockMapCaminhoUeb, mockMapCdAtividade, {
      cdCaminho: '4',
      cdUeb: '999', // cdUeb degradado para o ID da atividade
      cdAtividade: '999',
    });
    assert(res2 === 101, 'Critério 2: resolve via cd_atividade_paxtu quando cd_ueb degrada (999 -> 101)');

    // Critério 2 alternativo: cdUeb ausente/diferente, mas cdAtividade conhecido
    const res3 = resolveAtividadeCatalogo(mockMapCaminhoUeb, mockMapCdAtividade, {
      cdCaminho: '5',
      cdUeb: 'DESCONHECIDO',
      cdAtividade: '888',
    });
    assert(res3 === 201, 'Critério 2: fallback por cdAtividade quando cdUeb não bate (888 -> 201)');

    // Item não encontrado
    const res4 = resolveAtividadeCatalogo(mockMapCaminhoUeb, mockMapCdAtividade, {
      cdCaminho: '9',
      cdUeb: 'INEXISTENTE',
      cdAtividade: '000',
    });
    assert(res4 === undefined, 'Retorna undefined quando item não existe no catálogo');
  } catch (err: any) {
    console.error('Erro no bloco 1:', err);
    failed++;
  }

  // =========================================================================
  // BLOCO 2 (US1 / AC.2 / D4): Fidelidade de Estado e Desmarcação (Unmark)
  // =========================================================================
  console.log('\n🔹 2. Fidelidade ao Estado Atual e Desmarcação (Mark -> Unmark):');
  const TEST_ASSOC_ID = 'TEST_US1_ASSOC_001';
  try {
    // Garante associado de teste no banco
    await prisma.associado.upsert({
      where: { cd_associado: TEST_ASSOC_ID },
      create: {
        cd_associado: TEST_ASSOC_ID,
        nm_associado: 'Associado Teste US1',
        ds_ramo: Ramo.ESCOTEIRO,
        ds_categoria: 'BENEFICIARIO',
      },
      update: {},
    });

    // Busca uma atividade real do catálogo para o teste
    const atvReal = await prisma.paAtividade.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO, cd_caminho_paxtu: { not: null } },
    });
    if (!atvReal || !atvReal.cd_caminho_paxtu) {
      throw new Error('Nenhuma atividade encontrada no catálogo com cd_caminho_paxtu');
    }

    const payloadMarcado: any[] = [
      {
        totalCount: 1,
        data: [
          {
            cdCaminho: atvReal.cd_caminho_paxtu,
            cdUeb: atvReal.cd_ueb,
            cdAtividade: atvReal.cd_atividade_paxtu || '0',
            checkJovem: 'feitoJovem',
            dtCheckJovem: '2026-09-01',
            checkEscotista: 'confirmadoEscotista',
            dtCheckEscotista: '2026-09-02',
          },
        ],
      },
    ];

    // Sincroniza marcado
    await upsertProgressaoPa(TEST_ASSOC_ID, payloadMarcado, Ramo.ESCOTEIRO);

    const check1 = await prisma.progressaoPa.findUnique({
      where: {
        cd_associado_atividade_id: {
          cd_associado: TEST_ASSOC_ID,
          atividade_id: atvReal.id,
        },
      },
    });
    assert(
      check1 !== null && check1.fl_check_jovem === true && check1.fl_check_escotista === true,
      'Marcação: atividade persistida como concluída (fl_check = true)'
    );
    assert(
      check1?.dt_check_jovem !== null && check1?.dt_check_escotista !== null,
      'Marcação: datas de conclusão preenchidas'
    );

    // Agora sincroniza desmarcado (unmark)
    const payloadDesmarcado: any[] = [
      {
        totalCount: 1,
        data: [
          {
            cdCaminho: atvReal.cd_caminho_paxtu,
            cdUeb: atvReal.cd_ueb,
            cdAtividade: atvReal.cd_atividade_paxtu || '0',
            checkJovem: '',
            dtCheckJovem: '',
            checkEscotista: '',
            dtCheckEscotista: '',
          },
        ],
      },
    ];

    await upsertProgressaoPa(TEST_ASSOC_ID, payloadDesmarcado, Ramo.ESCOTEIRO);

    const check2 = await prisma.progressaoPa.findUnique({
      where: {
        cd_associado_atividade_id: {
          cd_associado: TEST_ASSOC_ID,
          atividade_id: atvReal.id,
        },
      },
    });
    assert(
      check2 !== null && check2.fl_check_jovem === false && check2.fl_check_escotista === false,
      'Desmarcação: flags atualizadas para false após unmark no Paxtu'
    );
    assert(
      check2?.dt_check_jovem === null && check2?.dt_check_escotista === null,
      'Desmarcação: datas de conclusão zeradas (null) no banco'
    );
  } catch (err: any) {
    console.error('Erro no bloco 2:', err);
    failed++;
  } finally {
    // Cleanup do associado de teste
    await prisma.progressaoPa.deleteMany({ where: { cd_associado: TEST_ASSOC_ID } });
    await prisma.associado.deleteMany({ where: { cd_associado: TEST_ASSOC_ID } });
  }

  // =========================================================================
  // BLOCO 3 (AC.3): Unicidade Estrutural do Catálogo (Constraints P2002)
  // =========================================================================
  console.log('\n🔹 3. Unicidade Estrutural das Chaves de Resolução (AC.3 / P2002):');
  const TEST_COMPETENCIA_ID = 999999;
  try {
    const compReal = await prisma.paCompetencia.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO },
    });
    const competenciaId = compReal ? compReal.id : 1;

    // Teste 1: Colisão no índice 1 (ds_ramo, cd_caminho_paxtu, cd_ueb)
    let p2002Index1 = false;
    const atvBase1 = await prisma.paAtividade.create({
      data: {
        ds_ramo: Ramo.ESCOTEIRO,
        competencia_id: competenciaId,
        cd_caminho_paxtu: 'TEST_CAM',
        cd_ueb: 'TEST_UEB_1',
        ds_atividade: 'Atividade Teste Unicidade 1',
      },
    });

    try {
      await prisma.paAtividade.create({
        data: {
          ds_ramo: Ramo.ESCOTEIRO,
          competencia_id: competenciaId,
          cd_caminho_paxtu: 'TEST_CAM',
          cd_ueb: 'TEST_UEB_1', // mesma chave
          ds_atividade: 'Atividade Teste Colisão 1',
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        p2002Index1 = true;
      }
    } finally {
      await prisma.paAtividade.deleteMany({ where: { id: atvBase1.id } });
    }
    assert(p2002Index1, 'Rejeita duplicação em (ds_ramo, cd_caminho_paxtu, cd_ueb) com P2002');

    // Teste 2: Colisão no índice 2 (ds_ramo, cd_atividade_paxtu)
    let p2002Index2 = false;
    const atvBase2 = await prisma.paAtividade.create({
      data: {
        ds_ramo: Ramo.ESCOTEIRO,
        competencia_id: competenciaId,
        cd_caminho_paxtu: 'TEST_CAM_2',
        cd_ueb: 'TEST_UEB_2',
        cd_atividade_paxtu: 'TEST_ATV_ID_999',
        ds_atividade: 'Atividade Teste Unicidade 2',
      },
    });

    try {
      await prisma.paAtividade.create({
        data: {
          ds_ramo: Ramo.ESCOTEIRO,
          competencia_id: competenciaId,
          cd_caminho_paxtu: 'TEST_CAM_3',
          cd_ueb: 'TEST_UEB_3',
          cd_atividade_paxtu: 'TEST_ATV_ID_999', // mesmo código paxtu
          ds_atividade: 'Atividade Teste Colisão 2',
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        p2002Index2 = true;
      }
    } finally {
      await prisma.paAtividade.deleteMany({ where: { id: atvBase2.id } });
    }
    assert(p2002Index2, 'Rejeita duplicação em (ds_ramo, cd_atividade_paxtu) com P2002');
  } catch (err: any) {
    console.error('Erro no bloco 3:', err);
    failed++;
  }

  // =========================================================================
  // BLOCO 4 (US2 / AC.4): Schema Relacional de Itens de Especialidade
  // =========================================================================
  console.log('\n🔹 4. Status Relacional de Itens de Especialidade (US2 / AC.4):');
  const TEST_US2_ASSOC = 'TEST_US2_ASSOC_001';
  try {
    // Garante associado de teste
    await prisma.associado.upsert({
      where: { cd_associado: TEST_US2_ASSOC },
      create: {
        cd_associado: TEST_US2_ASSOC,
        nm_associado: 'Associado Teste US2',
        ds_ramo: Ramo.ESCOTEIRO,
        ds_categoria: 'BENEFICIARIO',
      },
      update: {},
    });

    // Busca uma especialidade e item reais no catálogo semeado
    const espItemReal = await prisma.paEspecialidadeItem.findFirst({
      include: { especialidade: true },
    });
    if (!espItemReal) {
      throw new Error('Nenhum item de especialidade encontrado no catálogo');
    }

    const payloadEspMarcado = [
      {
        cd_especialidade: espItemReal.cd_especialidade,
        ds_especialidade: espItemReal.especialidade.ds_especialidade,
        nr_nivel: 1,
        dt_nivel: '2026-09-01',
        itens_conquistados: [
          {
            cd_item: espItemReal.cd_item,
            ds_item: espItemReal.ds_item,
            dt_item: '2026-09-01',
            check_escotista: 'confirmadoEscotista',
            check_jovem: 'feitoJovem',
          },
        ],
      },
    ];

    // Sincroniza especialidade com item marcado
    await upsertEspecialidadesAssociado(TEST_US2_ASSOC, payloadEspMarcado);

    // Consulta DIRETAMENTE na tabela relacional progressao_especialidade_item_pa (AC.4)
    const itemRelacional1 = await prisma.progressaoEspecialidadeItemPa.findUnique({
      where: {
        cd_associado_especialidade_item_id: {
          cd_associado: TEST_US2_ASSOC,
          especialidade_item_id: espItemReal.id,
        },
      },
    });

    assert(
      itemRelacional1 !== null &&
        itemRelacional1.fl_check_jovem === true &&
        itemRelacional1.fl_check_escotista === true,
      'AC.4: item de especialidade persistido na tabela relacional com fl_check = true'
    );
    assert(
      itemRelacional1?.dt_check_jovem !== null && itemRelacional1?.dt_check_escotista !== null,
      'AC.4: data de conclusão do item relacional persistida corretamente'
    );

    // Testa desmarcação (unmark) do item de especialidade (FR-2 / D4)
    const payloadEspDesmarcado = [
      {
        cd_especialidade: espItemReal.cd_especialidade,
        ds_especialidade: espItemReal.especialidade.ds_especialidade,
        nr_nivel: 1,
        dt_nivel: '2026-09-01',
        itens_conquistados: [
          {
            cd_item: espItemReal.cd_item,
            ds_item: espItemReal.ds_item,
            dt_item: '',
            check_escotista: '',
            check_jovem: '',
          },
        ],
      },
    ];

    await upsertEspecialidadesAssociado(TEST_US2_ASSOC, payloadEspDesmarcado);

    const itemRelacional2 = await prisma.progressaoEspecialidadeItemPa.findUnique({
      where: {
        cd_associado_especialidade_item_id: {
          cd_associado: TEST_US2_ASSOC,
          especialidade_item_id: espItemReal.id,
        },
      },
    });

    assert(
      itemRelacional2 !== null &&
        itemRelacional2.fl_check_jovem === false &&
        itemRelacional2.fl_check_escotista === false,
      'AC.4 / FR-2: desmarcação de item de especialidade atualiza flags para false'
    );
    assert(
      itemRelacional2?.dt_check_jovem === null && itemRelacional2?.dt_check_escotista === null,
      'AC.4 / FR-2: desmarcação de item de especialidade zera as datas (null)'
    );
  } catch (err: any) {
    console.error('Erro no bloco 4:', err);
    failed++;
  } finally {
    // Cleanup do associado US2
    await prisma.progressaoEspecialidadeItemPa.deleteMany({ where: { cd_associado: TEST_US2_ASSOC } });
    await prisma.progressaoEspecialidadePa.deleteMany({ where: { cd_associado: TEST_US2_ASSOC } });
    await prisma.associado.deleteMany({ where: { cd_associado: TEST_US2_ASSOC } });
  }

  // =========================================================================
  // BLOCO 5 (US3 / AC.5 / AC.6): Backfill Histórico e Idempotência
  // =========================================================================
  console.log('\n🔹 5. Backfill Histórico e Idempotência (US3 / AC.5 / AC.6):');
  const TEST_US3_ASSOC = 'TEST_US3_BACKFILL_001';
  try {
    // 1. Cria associado no Ramo Escoteiro
    await prisma.associado.upsert({
      where: { cd_associado: TEST_US3_ASSOC },
      create: {
        cd_associado: TEST_US3_ASSOC,
        nm_associado: 'Associado Teste US3 Backfill',
        ds_ramo: Ramo.ESCOTEIRO,
        ds_categoria: 'BENEFICIARIO',
      },
      update: {},
    });

    const atvReal = await prisma.paAtividade.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO, cd_caminho_paxtu: { not: null } },
    });
    const espItemReal = await prisma.paEspecialidadeItem.findFirst({
      include: { especialidade: true },
    });

    if (!atvReal || !atvReal.cd_caminho_paxtu || !espItemReal) {
      throw new Error('Dados insuficientes no catálogo para teste de backfill');
    }

    // 2. Insere dados no backup bruto e semi-estruturado SEM preencher tabelas relacionais
    await prisma.progressaoPaxtu.upsert({
      where: { cd_associado: TEST_US3_ASSOC },
      create: {
        cd_associado: TEST_US3_ASSOC,
        caminhos: [
          {
            totalCount: 1,
            data: [
              {
                cdCaminho: atvReal.cd_caminho_paxtu,
                cdUeb: atvReal.cd_ueb,
                cdAtividade: atvReal.cd_atividade_paxtu || '0',
                checkJovem: 'feitoJovem',
                dtCheckJovem: '2026-08-15',
                checkEscotista: 'confirmadoEscotista',
                dtCheckEscotista: '2026-08-16',
              },
            ],
          },
        ],
      },
      update: {},
    });

    await prisma.progressaoEspecialidadePa.upsert({
      where: {
        cd_associado_cd_especialidade: {
          cd_associado: TEST_US3_ASSOC,
          cd_especialidade: espItemReal.cd_especialidade,
        },
      },
      create: {
        cd_associado: TEST_US3_ASSOC,
        especialidade_id: espItemReal.especialidade_id,
        cd_especialidade: espItemReal.cd_especialidade,
        ds_especialidade: espItemReal.especialidade.ds_especialidade,
        nr_nivel: 1,
        qtd_itens_concluidos: 1,
        itens_detalhados: [
          {
            cd_item: espItemReal.cd_item,
            ds_item: espItemReal.ds_item,
            dt_item: '2026-08-15',
            check_jovem: 'feitoJovem',
            check_escotista: 'confirmadoEscotista',
          },
        ],
      },
      update: {},
    });

    // Confirma estado divergente inicial: ausente nas tabelas relacionais
    const antesAtv = await prisma.progressaoPa.findUnique({
      where: {
        cd_associado_atividade_id: {
          cd_associado: TEST_US3_ASSOC,
          atividade_id: atvReal.id,
        },
      },
    });
    const antesItem = await prisma.progressaoEspecialidadeItemPa.findUnique({
      where: {
        cd_associado_especialidade_item_id: {
          cd_associado: TEST_US3_ASSOC,
          especialidade_item_id: espItemReal.id,
        },
      },
    });
    assert(antesAtv === null && antesItem === null, 'Divergência inicial: registros ausentes nas tabelas relacionais');

    // 3. Executa o backfill pela 1ª vez
    const summary1 = await runBackfill();
    assert(summary1.migrados > 0, 'Execução 1 do backfill: migrou com sucesso os registros pendentes');

    // Verifica que agora foram populados nas tabelas relacionais (AC.5)
    const depoisAtv = await prisma.progressaoPa.findUnique({
      where: {
        cd_associado_atividade_id: {
          cd_associado: TEST_US3_ASSOC,
          atividade_id: atvReal.id,
        },
      },
    });
    const depoisItem = await prisma.progressaoEspecialidadeItemPa.findUnique({
      where: {
        cd_associado_especialidade_item_id: {
          cd_associado: TEST_US3_ASSOC,
          especialidade_item_id: espItemReal.id,
        },
      },
    });

    assert(
      depoisAtv !== null && depoisAtv.fl_check_jovem === true,
      'AC.5: atividade histórica do backup agora refletida em progressao_pa'
    );
    assert(
      depoisItem !== null && depoisItem.fl_check_jovem === true,
      'AC.5: item de especialidade histórico agora refletido em progressao_especialidade_item_pa'
    );

    // 4. Salva contagens no banco antes da 2ª execução
    const countAtv1 = await prisma.progressaoPa.count();
    const countItem1 = await prisma.progressaoEspecialidadeItemPa.count();

    // Executa o backfill pela 2ª vez (AC.6 - Idempotência)
    const summary2 = await runBackfill();
    const countAtv2 = await prisma.progressaoPa.count();
    const countItem2 = await prisma.progressaoEspecialidadeItemPa.count();

    assert(
      countAtv1 === countAtv2 && countItem1 === countItem2,
      'AC.6: re-execução do backfill mantém contagem de linhas inalterada (idempotência estrita)'
    );
    assert(
      summary2.associadosComDivergencia === 0,
      'AC.6: re-execução reporta zero associados com divergência residual'
    );
  } catch (err: any) {
    console.error('Erro no bloco 5:', err);
    failed++;
  } finally {
    // Cleanup do associado US3
    await prisma.progressaoEspecialidadeItemPa.deleteMany({ where: { cd_associado: TEST_US3_ASSOC } });
    await prisma.progressaoPa.deleteMany({ where: { cd_associado: TEST_US3_ASSOC } });
    await prisma.progressaoEspecialidadePa.deleteMany({ where: { cd_associado: TEST_US3_ASSOC } });
    await prisma.progressaoPaxtu.deleteMany({ where: { cd_associado: TEST_US3_ASSOC } });
    await prisma.associado.deleteMany({ where: { cd_associado: TEST_US3_ASSOC } });
  }

  // =========================================================================
  // BLOCO 6 (US4 / AC.7 / AC.8): Purificação de data.ts e Desacoplamento
  // =========================================================================
  console.log('\n🔹 6. Desacoplamento e Purificação de data.ts (US4 / AC.7 / AC.8):');
  const TEST_US4_ASSOC = 'TEST_US4_PURIFY_001';
  try {
    // 6a. Verificação estática do código-fonte de data.ts (AC.7 / AC.8)
    const dataTsPath = path.resolve(__dirname, '../../app/lib/data.ts');
    const dataTsContent = readFileSync(dataTsPath, 'utf-8');

    assert(
      !dataTsContent.includes('progressao_paxtu'),
      'AC.7: data.ts não referencia progressao_paxtu'
    );
    assert(
      !dataTsContent.includes('itens_detalhados'),
      'AC.7: data.ts não referencia itens_detalhados'
    );
    assert(
      !dataTsContent.includes('readJson'),
      'AC.8: data.ts não contém função readJson'
    );
    assert(
      !dataTsContent.includes("from 'data/") &&
        !dataTsContent.includes("('data/") &&
        !dataTsContent.includes('("data/'),
      'AC.8: data.ts não referencia arquivos locais em data/*.json'
    );

    // 6b. Verificação comportamental: lê apenas do relacional mesmo com JSON zerado
    await prisma.associado.upsert({
      where: { cd_associado: TEST_US4_ASSOC },
      create: {
        cd_associado: TEST_US4_ASSOC,
        nm_associado: 'Associado Teste US4 Purify',
        ds_ramo: Ramo.ESCOTEIRO,
        ds_categoria: 'BENEFICIARIO',
        fl_status: 'ATIVO',
      },
      update: {
        fl_status: 'ATIVO',
      },
    });

    const atvReal = await prisma.paAtividade.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO, cd_caminho_paxtu: { not: null } },
    });
    const espItemReal = await prisma.paEspecialidadeItem.findFirst({
      include: { especialidade: true },
    });

    if (!atvReal || !espItemReal) {
      throw new Error('Dados de catálogo insuficientes para teste US4');
    }

    // Insere dados nas tabelas relacionais
    await prisma.progressaoPa.upsert({
      where: {
        cd_associado_atividade_id: {
          cd_associado: TEST_US4_ASSOC,
          atividade_id: atvReal.id,
        },
      },
      create: {
        cd_associado: TEST_US4_ASSOC,
        atividade_id: atvReal.id,
        fl_check_jovem: true,
        fl_check_escotista: true,
        dt_check_jovem: new Date('2026-09-01'),
        dt_check_escotista: new Date('2026-09-01'),
      },
      update: {
        fl_check_jovem: true,
        fl_check_escotista: true,
      },
    });

    await prisma.progressaoEspecialidadePa.upsert({
      where: {
        cd_associado_cd_especialidade: {
          cd_associado: TEST_US4_ASSOC,
          cd_especialidade: espItemReal.cd_especialidade,
        },
      },
      create: {
        cd_associado: TEST_US4_ASSOC,
        especialidade_id: espItemReal.especialidade_id,
        cd_especialidade: espItemReal.cd_especialidade,
        ds_especialidade: espItemReal.especialidade.ds_especialidade,
        nr_nivel: 1,
        qtd_itens_concluidos: 1,
        itens_detalhados: [], // ZERADO!
      },
      update: {
        itens_detalhados: [], // ZERADO!
      },
    });

    await prisma.progressaoEspecialidadeItemPa.upsert({
      where: {
        cd_associado_especialidade_item_id: {
          cd_associado: TEST_US4_ASSOC,
          especialidade_item_id: espItemReal.id,
        },
      },
      create: {
        cd_associado: TEST_US4_ASSOC,
        especialidade_item_id: espItemReal.id,
        fl_check_jovem: true,
        fl_check_escotista: true,
        dt_check_jovem: new Date('2026-09-01'),
        dt_check_escotista: new Date('2026-09-01'),
      },
      update: {
        fl_check_jovem: true,
        fl_check_escotista: true,
      },
    });

    // Backup bruto ZERADO explicitamente
    await prisma.progressaoPaxtu.upsert({
      where: { cd_associado: TEST_US4_ASSOC },
      create: {
        cd_associado: TEST_US4_ASSOC,
        caminhos: [], // ZERADO!
      },
      update: {
        caminhos: [], // ZERADO!
      },
    });

    // Chama getEscoteiros()
    const { escoteiros, catalogoDisponivel } = await getEscoteiros('Escoteiro');
    assert(catalogoDisponivel === true, 'AC.7: getEscoteiros(Escoteiro) retorna catalogoDisponivel = true');

    const foundAssoc = escoteiros.find((e) => e.associado.cd_associado === TEST_US4_ASSOC);
    assert(foundAssoc !== undefined, 'AC.7: Associado encontrado na lista de domínio');

    const atvEncontrada = foundAssoc?.progressao
      .flatMap((c) => c.data)
      .find((a) => a.cdAtividade === String(atvReal.cd_atividade_paxtu || atvReal.id) || a.cdUeb === atvReal.cd_ueb);
    assert(
      atvEncontrada?.checkEscotista === 'confirmadoEscotista',
      'AC.7: Atividade relacional marcada mesmo com backup bruto zerado'
    );

    const espEncontrada = foundAssoc?.especialidades?.find(
      (e) => e.cd_especialidade === espItemReal.cd_especialidade
    );
    const itemEncontrado = espEncontrada?.itens.find((it) => it.cd_item === espItemReal.cd_item);
    assert(
      itemEncontrado?.fl_check_escotista === true,
      'AC.7: Item de especialidade relacional marcado mesmo com itens_detalhados zerado'
    );

    // 6c. Ausência de DATABASE_URL lança DataAccessError (AC.8 / FR-8 / D5)
    const origDbUrl = process.env.DATABASE_URL;
    let threwDataAccessError = false;
    try {
      delete process.env.DATABASE_URL;
      await getEscoteiros('Escoteiro');
    } catch (err: any) {
      if (err instanceof DataAccessError && err.message.includes('DATABASE_URL não configurada')) {
        threwDataAccessError = true;
      }
    } finally {
      process.env.DATABASE_URL = origDbUrl;
    }
    assert(threwDataAccessError, 'AC.8: ausência de DATABASE_URL lança DataAccessError explícito');
  } catch (err: any) {
    console.error('Erro no bloco 6:', err);
    failed++;
  } finally {
    await prisma.progressaoEspecialidadeItemPa.deleteMany({ where: { cd_associado: TEST_US4_ASSOC } });
    await prisma.progressaoPa.deleteMany({ where: { cd_associado: TEST_US4_ASSOC } });
    await prisma.progressaoEspecialidadePa.deleteMany({ where: { cd_associado: TEST_US4_ASSOC } });
    await prisma.progressaoPaxtu.deleteMany({ where: { cd_associado: TEST_US4_ASSOC } });
    await prisma.associado.deleteMany({ where: { cd_associado: TEST_US4_ASSOC } });
  }

  // =========================================================================
  // BLOCO 7 (US5 / AC.10): Sinalização de Catálogo por Ramo (Lobinho vs Escoteiro)
  // =========================================================================
  console.log('\n🔹 7. Sinalização de Catálogo por Ramo (US5 / AC.10):');
  try {
    const resEscoteiro = await getEscoteiros('Escoteiro');
    assert(
      resEscoteiro.catalogoDisponivel === true,
      'AC.10: getEscoteiros(Escoteiro) retorna catalogoDisponivel = true'
    );

    const resLobinho = await getEscoteiros('Lobinho');
    assert(
      resLobinho.catalogoDisponivel === false,
      'AC.10: getEscoteiros(Lobinho) retorna catalogoDisponivel = false (sem catálogo estruturado)'
    );
    assert(
      resLobinho.escoteiros.every((e) => e.progressao.length === 0),
      'AC.10: getEscoteiros(Lobinho) retorna caminhos vazios com segurança'
    );
  } catch (err: any) {
    console.error('Erro no bloco 7:', err);
    failed++;
  }

  console.log(`\n========================================`);
  console.log(`Resultado dos Testes (US1 + US2 + US3 + US4 + US5): ${passed} passaram, ${failed} falharam`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runProgressaoRelacionalTests()
  .catch((err) => {
    console.error('Falha fatal na execução dos testes:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
