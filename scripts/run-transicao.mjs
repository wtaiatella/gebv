import pg from 'pg';
import { processarTransicaoTodos } from '../app/lib/services/transicao-service.ts';

async function run() {
  console.log('=== EXECUTANDO MOTOR DE TRANSIÇÃO (MODELO ANTIGO -> NOVO PROGRAMA) ===\n');
  const start = Date.now();
  
  try {
    const res = await processarTransicaoTodos();
    const duration = Date.now() - start;

    console.log(`✓ Processados ${res.totalProcessados} associados em ${duration}ms.\n`);
    console.log('---------------------------------------------------------------------------------');
    console.log('| Associado ID | Nome / Detalhes                | Ações Novo Mod. | Blocos 100% |');
    console.log('---------------------------------------------------------------------------------');

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    
    for (const r of res.resultados.slice(0, 15)) {
      const aRes = await client.query('SELECT nm_associado FROM associados WHERE cd_associado = $1', [r.cd_associado]);
      const nome = aRes.rows[0]?.nm_associado || `Associado ${r.cd_associado}`;
      console.log(
        `| ${r.cd_associado.padEnd(12)} | ${nome.slice(0, 30).padEnd(30)} | ${String(r.total_acoes_conquistadas_novo).padStart(15)} | ${String(r.blocos_concluidos + '/' + r.total_blocos).padStart(11)} |`
      );
    }
    console.log('---------------------------------------------------------------------------------');

    // Mostra detalhe do primeiro jovem com atividades
    const firstWithActions = res.resultados.find((r) => r.total_acoes_conquistadas_novo > 0);
    if (firstWithActions) {
      const aRes = await client.query('SELECT nm_associado FROM associados WHERE cd_associado = $1', [firstWithActions.cd_associado]);
      const nome = aRes.rows[0]?.nm_associado || firstWithActions.cd_associado;
      console.log(`\n📋 Exemplo de Detalhamento dos 18 Blocos para: ${nome} (${firstWithActions.cd_associado})`);
      for (const b of firstWithActions.blocos) {
        const status = b.fl_concluido ? '✅ CONCLUÍDO' : `${b.pct_conclusao}%`;
        console.log(`  [${b.nm_eixo}] ${b.nm_bloco.padEnd(45)}: ${status} (Fixas: ${b.nr_fixas_concluidas}/${b.nr_acoes_fixas_obrigatorias}, Var: ${b.nr_variaveis_concluidas}/${b.nr_acoes_variaveis_exigidas})`);
      }
    }

    client.release();
    await pool.end();
  } catch (err) {
    console.error('Erro na execução da transição:', err);
    process.exit(1);
  }
}

run();
