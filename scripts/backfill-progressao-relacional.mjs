import { prisma } from '../app/lib/prisma.ts';
import {
  upsertProgressaoPa,
  upsertItensEspecialidadeAssociado,
  logSync,
} from '../app/lib/services/sync-service.ts';
import { Ramo } from '../app/lib/ramo.ts';

export async function runBackfill() {
  console.log('=== EXECUTANDO BACKFILL HISTÓRICO DE PROGRESSÃO RELACIONAL ===\n');
  console.log('Restrito ao Ramo: ESCOTEIRO | Categoria: BENEFICIARIO\n');
  const start = Date.now();

  let associadosProcessados = 0;
  let associadosComDivergencia = 0;
  let totalAtividadesMigradas = 0;
  let totalItensEspecialidadeProcessados = 0;
  let totalItensEspecialidadeMigrados = 0;
  let totalItensEspecialidadeIgnorados = 0;

  try {
    // -----------------------------------------------------------------------
    // 1. Backfill de Atividades PA a partir de progressao_paxtu
    // -----------------------------------------------------------------------
    console.log('1. Reprocessando backup bruto de atividades (progressao_paxtu)...');
    const backupsPaxtu = await prisma.progressaoPaxtu.findMany({
      where: {
        associado: {
          ds_ramo: Ramo.ESCOTEIRO,
          ds_categoria: 'BENEFICIARIO',
        },
      },
      select: {
        cd_associado: true,
        caminhos: true,
      },
    });

    for (const b of backupsPaxtu) {
      associadosProcessados++;
      const caminhos = Array.isArray(b.caminhos) ? b.caminhos : [];

      const countAntes = await prisma.progressaoPa.count({
        where: { cd_associado: b.cd_associado },
      });

      await upsertProgressaoPa(b.cd_associado, caminhos, Ramo.ESCOTEIRO);

      const countDepois = await prisma.progressaoPa.count({
        where: { cd_associado: b.cd_associado },
      });

      const novasAtividades = countDepois - countAntes;
      if (novasAtividades > 0) {
        associadosComDivergencia++;
        totalAtividadesMigradas += novasAtividades;
      }
    }

    console.log(`✓ ${backupsPaxtu.length} registros de backup bruto processados.`);

    // -----------------------------------------------------------------------
    // 2. Backfill de Itens de Especialidade a partir de progressao_especialidade_pa
    // -----------------------------------------------------------------------
    console.log('\n2. Reprocessando itens detalhados de especialidades...');
    const especialidadesDb = await prisma.progressaoEspecialidadePa.findMany({
      where: {
        associado: {
          ds_ramo: Ramo.ESCOTEIRO,
          ds_categoria: 'BENEFICIARIO',
        },
      },
      select: {
        cd_associado: true,
        cd_especialidade: true,
        itens_detalhados: true,
      },
    });

    for (const esp of especialidadesDb) {
      const itens = Array.isArray(esp.itens_detalhados) ? esp.itens_detalhados : [];
      if (itens.length === 0) continue;

      const res = await upsertItensEspecialidadeAssociado(
        esp.cd_associado,
        esp.cd_especialidade,
        itens
      );

      totalItensEspecialidadeProcessados += res.processados;
      totalItensEspecialidadeMigrados += res.migrados;
      totalItensEspecialidadeIgnorados += res.ignorados;
    }

    console.log(`✓ ${especialidadesDb.length} registros de especialidade processados.`);

    const duration = Date.now() - start;

    const summary = {
      processados: associadosProcessados,
      associadosComDivergencia,
      atividadesMigradas: totalAtividadesMigradas,
      itensEspecialidadeProcessados: totalItensEspecialidadeProcessados,
      itensEspecialidadeMigrados: totalItensEspecialidadeMigrados,
      itensEspecialidadeIgnorados: totalItensEspecialidadeIgnorados,
      migrados: totalAtividadesMigradas + totalItensEspecialidadeMigrados,
      ignorados: totalItensEspecialidadeIgnorados,
      duration_ms: duration,
    };

    // Auditoria via sync_logs (FR-13 / FR-14)
    await logSync(
      'backfill',
      'sucesso',
      null,
      summary,
      duration
    );

    // Impressão estruturada em stdout para conferência imediata
    console.log('\n================================================================');
    console.log('             RESUMO DO BACKFILL HISTÓRICO (FR-13)               ');
    console.log('================================================================');
    console.log(`• Associados avaliados (Ramo Escoteiro): ${summary.processados}`);
    console.log(`• Associados com progresso divergente:   ${summary.associadosComDivergencia}`);
    console.log(`• Novas atividades relacionais inseridas:${summary.atividadesMigradas}`);
    console.log(`• Itens de especialidade processados:    ${summary.itensEspecialidadeProcessados}`);
    console.log(`• Itens de especialidade migrados:       ${summary.itensEspecialidadeMigrados}`);
    console.log(`• Itens fora de catálogo (ignorados):    ${summary.itensEspecialidadeIgnorados}`);
    console.log(`• Duração total do processamento:        ${summary.duration_ms}ms`);
    console.log('================================================================\n');

    return summary;
  } catch (err) {
    const duration = Date.now() - start;
    console.error('ERRO na execução do backfill:', err);
    await logSync(
      'backfill',
      'erro',
      null,
      { error: err?.message || String(err) },
      duration
    );
    throw err;
  }
}

// Execução direta via CLI
if (process.argv[1] && process.argv[1].includes('backfill-progressao-relacional')) {
  runBackfill()
    .then(() => {
      console.log('✓ Script de backfill concluído com sucesso.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('✗ Script de backfill falhou:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
