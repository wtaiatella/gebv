import { prisma } from '../../app/lib/prisma';
import {
  processarTransicaoAssociado,
  getProgressoNovoModelo,
  toggleAcaoNovoModelo,
} from '../../app/lib/services/transicao-service';
import { normalizeRamo, Ramo } from '../../app/lib/ramo';
import { resolveSessionCookie } from '../../app/lib/paxtu/client';

async function runTestSuite() {
  console.log('🧪 [TEST SUITE] Iniciando Testes Integrados de Ponta a Ponta (T021 / SC-2)...\n');
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

  // 1. Validação dos 4 Ramos
  console.log('🔹 1. Validação e Normalização dos 4 Ramos Oficiais:');
  try {
    assert(normalizeRamo('Lobinho') === Ramo.LOBINHO, 'Normaliza "Lobinho" -> LOBINHO');
    assert(normalizeRamo('ESCOTEIRO') === Ramo.ESCOTEIRO, 'Normaliza "ESCOTEIRO" -> ESCOTEIRO');
    assert(normalizeRamo('sênior') === Ramo.SENIOR, 'Normaliza "sênior" -> SENIOR');
    assert(normalizeRamo('Pioneiro') === Ramo.PIONEIRO, 'Normaliza "Pioneiro" -> PIONEIRO');

    let threw = false;
    try {
      normalizeRamo('Invalido');
    } catch {
      threw = true;
    }
    assert(threw, 'Rejeita ramo inválido com exceção controlada');
  } catch (e: any) {
    console.error('Erro no bloco de ramos:', e.message);
    failed++;
  }

  // 2. Simulação de 5 Requisições Simultâneas com Cookies Distintos (SC-2 Multi-Sessão)
  console.log('\n🔹 2. Validação de Isolamento Multi-Sessão (SC-2 — 5 Sessões Concorrentes):');
  try {
    const fakeSessions = [
      'session_escotista_tropa_1=token_alpha_123',
      'session_escotista_alcateia_2=token_beta_456',
      'session_escotista_senior_3=token_gamma_789',
      'session_escotista_cla_4=token_delta_101',
      'session_dirigente_grupo_5=token_epsilon_202',
    ];

    const concurrentResults = await Promise.all(
      fakeSessions.map(async (cookie, index) => {
        // Simula delay de rede assíncrono ligeiramente variável
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 50) + 10));
        const resolved = resolveSessionCookie(cookie);
        return { index, cookie, resolved };
      })
    );

    let allIsolated = true;
    for (const res of concurrentResults) {
      if (res.resolved !== res.cookie) {
        allIsolated = false;
        break;
      }
    }
    assert(allIsolated, '5 requisições simultâneas preservam seus cookies isolados sem poluição cruzada');
  } catch (e: any) {
    console.error('Erro no teste multi-sessão:', e.message);
    failed++;
  }

  // 3. Teste do Motor de Transição com Banco de Dados Real
  console.log('\n🔹 3. Validação do Motor de Transição e Regras de Equivalência:');
  try {
    const escoteiro = await prisma.associado.findFirst({
      where: { ds_ramo: Ramo.ESCOTEIRO, ds_categoria: 'BENEFICIARIO', fl_status: 'ATIVO' },
    });

    if (!escoteiro) {
      console.log('  ⚠️ Nenhum associado ativo encontrado para teste de banco');
    } else {
      const transicao = await processarTransicaoAssociado(escoteiro.cd_associado, Ramo.ESCOTEIRO);
      assert(transicao.associado.cd_associado === escoteiro.cd_associado, 'Retorna dados do associado correto');
      assert(transicao.blocos.length === 18, 'Gera exatamente os 18 blocos do Novo Programa');
      assert(transicao.estatisticas.total_acoes === 448, 'Avalia as 448 ações catalogadas para o ramo Escoteiro');
      assert(transicao.estatisticas.pct_global >= 0 && transicao.estatisticas.pct_global <= 100, 'Percentual global válido (0 a 100)');

      // 4. Teste de Toggle Manual com Rollback
      console.log('\n🔹 4. Validação de Ajuste Manual de Ação (Prisma Transaction):');
      const bloco1 = transicao.blocos[0];
      const acao1 = transicao.acoes_por_bloco[bloco1.bloco_id][0];

      await toggleAcaoNovoModelo(escoteiro.cd_associado, acao1.id, true, 'TESTER', 'Teste unitário', Ramo.ESCOTEIRO);
      const posToggle = await getProgressoNovoModelo(escoteiro.cd_associado, Ramo.ESCOTEIRO);
      const acaoAtualizada = posToggle.acoes_por_bloco[bloco1.bloco_id].find((a) => a.id === acao1.id);
      assert(acaoAtualizada?.fl_concluido === true, 'Ação comutada para concluída com sucesso');
      assert(acaoAtualizada?.origem === 'MANUAL_CHEFE', 'Origem gravada como MANUAL_CHEFE');

      // Reverte status
      await toggleAcaoNovoModelo(escoteiro.cd_associado, acao1.id, false, undefined, undefined, Ramo.ESCOTEIRO);
      const posReversao = await getProgressoNovoModelo(escoteiro.cd_associado, Ramo.ESCOTEIRO);
      const acaoRevertida = posReversao.acoes_por_bloco[bloco1.bloco_id].find((a) => a.id === acao1.id);
      assert(acaoRevertida?.fl_concluido === false, 'Ação revertida com sucesso');
    }
  } catch (e: any) {
    console.error('Erro no teste de banco:', e);
    failed++;
  }

  console.log(`\n=============================================`);
  console.log(`Resultado dos Testes: ${passed} passaram, ${failed} falharam.`);
  console.log(`=============================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite()
  .catch((e) => {
    console.error('Erro fatal na suite de testes:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
