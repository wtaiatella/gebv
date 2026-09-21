import { readFileSync } from 'node:fs';
import path from 'node:path';
import prisma from '../../app/lib/prisma';
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
  console.log('🧪 [TEST SUITE] Iniciando Testes de Progressão Relacional (US1-US5)...\n');
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
    const mockMapCaminhoAtividade = new Map<string, number>([
      ['4_999', 101],
      ['5_888', 201],
    ]);
    const mockMapCdAtividade = new Map<string, number>([
      ['999', 101],
      ['888', 201],
    ]);

    // Critério 1: caminho + cd_atividade_paxtu
    const res1 = resolveAtividadeCatalogo(mockMapCaminhoAtividade, mockMapCdAtividade, {
      cdCaminho: '4',
      cdAtividade: '999',
    });
    assert(res1 === 101, 'Critério 1: resolve por caminho + cd_atividade_paxtu (4_999 -> 101)');

    // Critério 2: fallback cd_atividade_paxtu isolado
    const res2 = resolveAtividadeCatalogo(mockMapCaminhoAtividade, mockMapCdAtividade, {
      cdCaminho: 'outro',
      cdAtividade: '999',
    });
    assert(res2 === 101, 'Critério 2: fallback via cd_atividade_paxtu isolado (999 -> 101)');

    // Item não encontrado
    const res3 = resolveAtividadeCatalogo(mockMapCaminhoAtividade, mockMapCdAtividade, {
      cdCaminho: '9',
      cdAtividade: '000',
    });
    assert(res3 == null, 'Retorna falsy/null quando item não existe no catálogo');
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
      where: { ds_ramo: Ramo.ESCOTEIRO, cd_caminho_paxtu: { not: '' } },
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
      check1 !== null && check1.concluida === true && check1.status_escotista === 'confirmadoEscotista',
      'Marcação: atividade persistida como concluída (concluida = true)'
    );
    assert(
      check1?.data_conclusao !== null,
      'Marcação: data de conclusão preenchida'
    );

    // Agora sincroniza desmarcado (unmark)
    const payloadDesmarcado: any[] = [
      {
        totalCount: 1,
        data: [
          {
            cdCaminho: atvReal.cd_caminho_paxtu,
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
      check2 !== null && check2.concluida === false,
      'Desmarcação: flag atualizada para false após unmark no Paxtu'
    );
    assert(
      check2?.data_conclusao === null,
      'Desmarcação: data de conclusão zerada (null) no banco'
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
  // BLOCO 3 (AC.3): Unicidade Estrutural do Catálogo (Constraint P2002)
  // =========================================================================
  console.log('\n🔹 3. Unicidade Estrutural das Chaves de Resolução (AC.3 / P2002):');
  try {
    const compReal = await prisma.paCompetencia.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO },
    });
    const competenciaId = compReal ? compReal.id : 1;

    // Colisão na chave natural (ds_ramo, cd_caminho_paxtu, cd_atividade_paxtu)
    let p2002Index = false;
    const atvBase1 = await prisma.paAtividade.create({
      data: {
        ds_ramo: Ramo.ESCOTEIRO,
        competencia_id: competenciaId,
        cd_caminho_paxtu: 'TEST_CAM',
        cd_atividade_paxtu: 'TEST_ATV_ID_999',
        ds_atividade: 'Atividade Teste Unicidade 1',
      },
    });

    try {
      await prisma.paAtividade.create({
        data: {
          ds_ramo: Ramo.ESCOTEIRO,
          competencia_id: competenciaId,
          cd_caminho_paxtu: 'TEST_CAM',
          cd_atividade_paxtu: 'TEST_ATV_ID_999', // mesma chave composta
          ds_atividade: 'Atividade Teste Colisão 1',
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        p2002Index = true;
      }
    } finally {
      await prisma.paAtividade.deleteMany({ where: { id: atvBase1.id } });
    }
    assert(p2002Index, 'Rejeita duplicação em (ds_ramo, cd_caminho_paxtu, cd_atividade_paxtu) com P2002');
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
      itemRelacional1 !== null && itemRelacional1.concluida === true,
      'AC.4: item de especialidade persistido na tabela relacional com concluida = true'
    );
    assert(
      itemRelacional1?.data_conclusao !== null,
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
      itemRelacional2 !== null && itemRelacional2.concluida === false,
      'AC.4 / FR-2: desmarcação de item de especialidade atualiza concluida para false'
    );
    assert(
      itemRelacional2?.data_conclusao === null,
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
  // BLOCO 5 (US3 / AC.5 & AC.6): Migração e Idempotência do Backfill
  // =========================================================================
  console.log('\n🔹 5. Migração e Idempotência do Backfill (US3 / AC.5 & AC.6):');
  const TEST_US3_ASSOC = 'TEST_US3_ASSOC_001';
  try {
    // 1. Cria associado de teste sem dados relacionais
    await prisma.associado.upsert({
      where: { cd_associado: TEST_US3_ASSOC },
      create: {
        cd_associado: TEST_US3_ASSOC,
        nm_associado: 'Associado Teste US3 Backfill',
        ds_ramo: Ramo.ESCOTEIRO,
        ds_categoria: 'BENEFICIARIO',
        fl_status: 'ATIVO',
      },
      update: {},
    });

    const atvReal = await prisma.paAtividade.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO, cd_caminho_paxtu: { not: '' } },
    });
    const espItemReal = await prisma.paEspecialidadeItem.findFirst({
      include: { especialidade: true },
    });

    if (!atvReal || !atvReal.cd_caminho_paxtu || !espItemReal) {
      throw new Error('Dados insuficientes no catálogo para teste de backfill');
    }

    // 2. Insere dados no backup bruto
    await prisma.progressaoPaxtu.upsert({
      where: { cd_associado: TEST_US3_ASSOC },
      create: {
        cd_associado: TEST_US3_ASSOC,
        dados_brutos: {
          caminhos: [
            {
              totalCount: 1,
              data: [
                {
                  cdCaminho: atvReal.cd_caminho_paxtu,
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
      depoisAtv !== null && depoisAtv.concluida === true,
      'AC.5: atividade histórica do backup agora refletida em progressao_pa com concluida = true'
    );
    assert(
      depoisItem !== null && depoisItem.concluida === true,
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
      'AC.6: zero divergências detectadas na re-execução do backfill'
    );
  } catch (err: any) {
    console.error('Erro no bloco 5:', err);
    failed++;
  } finally {
    await prisma.progressaoEspecialidadeItemPa.deleteMany({ where: { cd_associado: TEST_US3_ASSOC } });
    await prisma.progressaoPa.deleteMany({ where: { cd_associado: TEST_US3_ASSOC } });
    await prisma.progressaoEspecialidadePa.deleteMany({ where: { cd_associado: TEST_US3_ASSOC } });
    await prisma.progressaoPaxtu.deleteMany({ where: { cd_associado: TEST_US3_ASSOC } });
    await prisma.associado.deleteMany({ where: { cd_associado: TEST_US3_ASSOC } });
  }

  // =========================================================================
  // BLOCO 6 (US4 / AC.7 & AC.8): Leitura de Domínio via getEscoteiros()
  // =========================================================================
  console.log('\n🔹 6. Leitura de Domínio via getEscoteiros() (US4 / AC.7 & AC.8):');
  const TEST_US4_ASSOC = 'TEST_US4_ASSOC_001';
  try {
    await prisma.associado.upsert({
      where: { cd_associado: TEST_US4_ASSOC },
      create: {
        cd_associado: TEST_US4_ASSOC,
        nm_associado: 'Associado Teste US4 Leitura',
        ds_ramo: Ramo.ESCOTEIRO,
        ds_categoria: 'BENEFICIARIO',
        fl_status: 'ATIVO',
      },
      update: {
        fl_status: 'ATIVO',
      },
    });

    const atvReal = await prisma.paAtividade.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO, cd_caminho_paxtu: { not: '' } },
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
        concluida: true,
        status_escotista: 'confirmadoEscotista',
        data_conclusao: new Date('2026-09-01'),
      },
      update: {
        concluida: true,
        status_escotista: 'confirmadoEscotista',
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
        concluida: true,
        data_conclusao: new Date('2026-09-01'),
      },
      update: {
        concluida: true,
      },
    });

    // Backup bruto ZERADO explicitamente
    await prisma.progressaoPaxtu.upsert({
      where: { cd_associado: TEST_US4_ASSOC },
      create: {
        cd_associado: TEST_US4_ASSOC,
        dados_brutos: {},
      },
      update: {
        dados_brutos: {},
      },
    });

    // Chama getEscoteiros()
    const { escoteiros, catalogoDisponivel } = await getEscoteiros('Escoteiro');
    assert(catalogoDisponivel === true, 'AC.7: getEscoteiros(Escoteiro) retorna catalogoDisponivel = true');

    const foundAssoc = escoteiros.find((e) => e.associado.cd_associado === TEST_US4_ASSOC);
    assert(foundAssoc !== undefined, 'AC.7: Associado encontrado na lista de domínio');

    const atvEncontrada = foundAssoc?.progressao
      .flatMap((c) => c.data)
      .find((a) => a.cdAtividade === String(atvReal.cd_atividade_paxtu || atvReal.id));
    assert(
      atvEncontrada?.status_escotista === 'confirmadoEscotista' || atvEncontrada?.concluida === true,
      'AC.7: Atividade relacional marcada mesmo com backup bruto zerado'
    );

    const espEncontrada = foundAssoc?.especialidades?.find(
      (e) => e.cd_especialidade === espItemReal.cd_especialidade
    );
    const itemEncontrado = espEncontrada?.itens.find((it) => it.cd_item === espItemReal.cd_item);
    assert(
      itemEncontrado?.concluida === true || itemEncontrado?.fl_conquistado === true,
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
