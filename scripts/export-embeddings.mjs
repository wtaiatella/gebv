import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';

const { Pool } = pg;

function roundEmbedding(arr) {
  if (!arr || !Array.isArray(arr)) return [];
  return arr.map((n) => Math.round(n * 100000) / 100000);
}

async function exportEmbeddings() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ ERRO: Defina DATABASE_URL no .env');
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('📦 EXPORTADOR DE EMBEDDINGS CURRICULARES (PRODUÇÃO / OFFLINE)');
  console.log('='.repeat(70));

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    const outDir = path.join(process.cwd(), 'data', 'embeddings');
    await mkdir(outDir, { recursive: true });

    // 1. Exporta Progressoes (PA e PN)
    console.log('\n1. Extraindo embeddings de Progressão (PA e PN)...');
    const paAtivRes = await client.query(`
      SELECT ds_ramo, identificacao, embedding
      FROM pa_atividades
      WHERE cardinality(embedding) > 0
    `);

    const pnAcoesRes = await client.query(`
      SELECT a.ds_ramo, b.nm_bloco, a.nr_ordem, a.embedding
      FROM pn_acoes_educativas a
      JOIN pn_blocos b ON a.bloco_id = b.id
      WHERE cardinality(a.embedding) > 0
    `);

    const progressaoPayload = {
      pa_atividades: paAtivRes.rows.map((r) => ({
        ds_ramo: r.ds_ramo,
        identificacao: r.identificacao,
        embedding: roundEmbedding(r.embedding),
      })),
      pn_acoes: pnAcoesRes.rows.map((r) => ({
        ds_ramo: r.ds_ramo,
        nm_bloco: r.nm_bloco,
        nr_ordem: r.nr_ordem,
        embedding: roundEmbedding(r.embedding),
      })),
    };

    const gzProg = zlib.gzipSync(Buffer.from(JSON.stringify(progressaoPayload)));
    const progPath = path.join(outDir, 'embeddings_progressao.json.gz');
    await writeFile(progPath, gzProg);
    console.log(`   ✓ Progressoes gravadas em: ${progPath}`);
    console.log(`     - PA: ${paAtivRes.rows.length} itens | PN: ${pnAcoesRes.rows.length} itens`);
    console.log(`     - Tamanho: ${(gzProg.length / 1024 / 1024).toFixed(2)} MB`);

    // 2. Exporta Especialidades (PA e PN)
    console.log('\n2. Extraindo embeddings de Especialidades (PA e PN)...');
    const paEspRes = await client.query(`
      SELECT cd_especialidade, cd_item, embedding
      FROM pa_especialidades_itens
      WHERE cardinality(embedding) > 0
    `);

    const pnEspRes = await client.query(`
      SELECT e.slug, i.ds_item, i.embedding
      FROM pn_especialidades_itens i
      JOIN pn_especialidades e ON i.especialidade_id = e.id
      WHERE cardinality(i.embedding) > 0
    `);

    const especialidadesPayload = {
      pa_itens: paEspRes.rows.map((r) => ({
        cd_especialidade: r.cd_especialidade,
        cd_item: r.cd_item,
        embedding: roundEmbedding(r.embedding),
      })),
      pn_itens: pnEspRes.rows.map((r) => ({
        slug: r.slug,
        ds_item: r.ds_item,
        embedding: roundEmbedding(r.embedding),
      })),
    };

    const gzEsp = zlib.gzipSync(Buffer.from(JSON.stringify(especialidadesPayload)));
    const espPath = path.join(outDir, 'embeddings_especialidades.json.gz');
    await writeFile(espPath, gzEsp);
    console.log(`   ✓ Especialidades gravadas em: ${espPath}`);
    console.log(`     - PA: ${paEspRes.rows.length} itens | PN: ${pnEspRes.rows.length} itens`);
    console.log(`     - Tamanho: ${(gzEsp.length / 1024 / 1024).toFixed(2)} MB`);

    console.log('\n' + '='.repeat(70));
    console.log('🎉 EXPORTAÇÃO DE EMBEDDINGS CONCLUÍDA COM SUCESSO!');
    console.log('='.repeat(70));
  } finally {
    client.release();
    await pool.end();
  }
}

exportEmbeddings().catch((err) => {
  console.error('❌ Erro na exportação:', err);
  process.exit(1);
});
