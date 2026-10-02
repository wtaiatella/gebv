import { processarTransicaoTodos } from '../app/lib/services/transicao-service.ts';
import { prisma } from '../app/lib/prisma.ts';

async function run() {
  console.log('=== EXECUTANDO MOTOR DE TRANSIÇÃO (MODELO ANTIGO -> NOVO PROGRAMA) ===\n');
  const start = Date.now();
  
  const ramos = ['LOBINHO', 'ESCOTEIRO', 'SENIOR', 'PIONEIRO'];
  let totalGeral = 0;

  try {
    for (const ramo of ramos) {
      console.log(`⏳ Processando transição do Ramo ${ramo}...`);
      const res = await processarTransicaoTodos(ramo);
      totalGeral += res.totalProcessados;
      console.log(`✓ Ramo ${ramo}: ${res.totalProcessados} associados processados.`);
    }

    const duration = Date.now() - start;
    console.log(`\n🎉 Transição concluída para todos os ramos: ${totalGeral} associados processados em ${duration}ms.\n`);
  } catch (err) {
    console.error('Erro na execução da transição:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
