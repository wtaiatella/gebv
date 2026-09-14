import { processarTransicaoTodos } from '../app/lib/services/transicao-service.ts';
import { prisma } from '../app/lib/prisma.ts';

async function run() {
  console.log('=== EXECUTANDO MOTOR DE TRANSIÇÃO (MODELO ANTIGO -> NOVO PROGRAMA) ===\n');
  const start = Date.now();
  
  try {
    const res = await processarTransicaoTodos('ESCOTEIRO');
    const duration = Date.now() - start;

    console.log(`✓ Processados ${res.totalProcessados} associados em ${duration}ms.\n`);
    console.log('---------------------------------------------------------------------------------');
    console.log('| Associado ID | Nome / Detalhes                | Ações Novo Mod. | Blocos 100% |');
    console.log('---------------------------------------------------------------------------------');

    for (const r of res.resultados.slice(0, 30)) {
      const cdStr = String(r.associado?.cd_associado || '');
      const nome = r.associado?.nm_associado || `Associado ${cdStr}`;
      const acoes = r.estatisticas?.total_concluidas ?? 0;
      const blocos = `${r.estatisticas?.blocos_concluidos ?? 0}/${r.estatisticas?.total_blocos ?? 18}`;
      console.log(
        `| ${cdStr.padEnd(12)} | ${nome.slice(0, 30).padEnd(30)} | ${String(acoes).padStart(15)} | ${blocos.padStart(11)} |`
      );
    }
    console.log('---------------------------------------------------------------------------------');

    // Mostra detalhe do primeiro jovem com atividades
    const firstWithActions = res.resultados.find((r) => (r.estatisticas?.total_concluidas ?? 0) > 0);
    if (firstWithActions) {
      const cdStr = String(firstWithActions.associado?.cd_associado || '');
      const nome = firstWithActions.associado?.nm_associado || cdStr;
      console.log(`\n📋 Exemplo de Detalhamento dos 18 Blocos para: ${nome} (${cdStr})`);
      for (const b of firstWithActions.blocos || []) {
        const status = b.fl_concluido ? '✅ CONCLUÍDO' : `${b.pct_conclusao}%`;
        console.log(`  [${b.nm_eixo}] ${b.nm_bloco.padEnd(45)}: ${status} (Fixas: ${b.nr_fixas_concluidas}/${b.nr_acoes_fixas_obrigatorias}, Var: ${b.nr_variaveis_concluidas}/${b.nr_acoes_variaveis_exigidas})`);
      }
    }
  } catch (err) {
    console.error('Erro na execução da transição:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
