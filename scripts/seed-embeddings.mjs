import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';

const { Pool } = pg;

async function seedEmbeddings() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ ERRO: Defina DATABASE_URL no .env');
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('🧠 SEED DE EMBEDDINGS VETORIAIS PRÉ-CALCULADOS (PRODUÇÃO / LOCAL)');
  console.log('='.repeat(70));

  const embDir = path.join(process.cwd(), 'data', 'embeddings');
  const progPath = path.join(embDir, 'embeddings_progressao.json.gz');
  const espPath = path.join(embDir, 'embeddings_especialidades.json.gz');

  if (!existsSync(progPath) || !existsSync(espPath)) {
    console.warn('⚠️ AVISO: Arquivos de embeddings pré-calculados não encontrados em data/embeddings/.');
    console.warn('  Execute "npm run db:export-embeddings" na máquina de desenvolvimento primeiro.');
    return;
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // -------------------------------------------------------------
    // 1. Injetar Embeddings de Progressão (PA e PN)
    // -------------------------------------------------------------
    console.log('\n1. Carregando embeddings de Progressão...');
    const rawProgGz = await readFile(progPath);
    const progData = JSON.parse(zlib.gunzipSync(rawProgGz).toString('utf-8'));

    // 1.1 PA Atividades
    let paAtivUpdated = 0;
    const CHUNK_SIZE = 100;
    for (let i = 0; i < progData.pa_atividades.length; i += CHUNK_SIZE) {
      const chunk = progData.pa_atividades.slice(i, i + CHUNK_SIZE);
      for (const item of chunk) {
        const res = await client.query(
          `UPDATE pa_atividades
           SET embedding = $1
           WHERE ds_ramo = $2 AND identificacao = $3`,
          [item.embedding, item.ds_ramo, item.identificacao]
        );
        paAtivUpdated += res.rowCount;
      }
    }
    console.log(`   ✓ ${paAtivUpdated} atividades do PA atualizadas com vetores.`);

    // 1.2 PN Ações Educativas
    let pnAcoesUpdated = 0;
    for (let i = 0; i < progData.pn_acoes.length; i += CHUNK_SIZE) {
      const chunk = progData.pn_acoes.slice(i, i + CHUNK_SIZE);
      for (const item of chunk) {
        const res = await client.query(
          `UPDATE pn_acoes_educativas a
           SET embedding = $1
           FROM pn_blocos b
           WHERE a.bloco_id = b.id
             AND a.ds_ramo = $2
             AND b.nm_bloco = $3
             AND a.nr_ordem = $4`,
          [item.embedding, item.ds_ramo, item.nm_bloco, item.nr_ordem]
        );
        pnAcoesUpdated += res.rowCount;
      }
    }
    console.log(`   ✓ ${pnAcoesUpdated} ações educativas do PN atualizadas com vetores.`);

    // -------------------------------------------------------------
    // 2. Injetar Embeddings de Especialidades (PA e PN)
    // -------------------------------------------------------------
    console.log('\n2. Carregando embeddings de Especialidades...');
    const rawEspGz = await readFile(espPath);
    const espData = JSON.parse(zlib.gunzipSync(rawEspGz).toString('utf-8'));

    // 2.1 PA Especialidades Itens
    let paEspUpdated = 0;
    for (let i = 0; i < espData.pa_itens.length; i += CHUNK_SIZE) {
      const chunk = espData.pa_itens.slice(i, i + CHUNK_SIZE);
      for (const item of chunk) {
        const res = await client.query(
          `UPDATE pa_especialidades_itens
           SET embedding = $1
           WHERE cd_especialidade = $2 AND cd_item = $3`,
          [item.embedding, item.cd_especialidade, item.cd_item]
        );
        paEspUpdated += res.rowCount;
      }
    }
    console.log(`   ✓ ${paEspUpdated} itens de especialidades PA atualizados com vetores.`);

    // 2.2 PN Especialidades Itens
    let pnEspUpdated = 0;
    for (let i = 0; i < espData.pn_itens.length; i += CHUNK_SIZE) {
      const chunk = espData.pn_itens.slice(i, i + CHUNK_SIZE);
      for (const item of chunk) {
        const res = await client.query(
          `UPDATE pn_especialidades_itens i
           SET embedding = $1
           FROM pn_especialidades e
           WHERE i.especialidade_id = e.id
             AND e.slug = $2
             AND i.ds_item = $3`,
          [item.embedding, item.slug, item.ds_item]
        );
        pnEspUpdated += res.rowCount;
      }
    }
    console.log(`   ✓ ${pnEspUpdated} itens de especialidades PN atualizados com vetores.`);

    await client.query('COMMIT');

    const totalAtualizado = paAtivUpdated + pnAcoesUpdated + paEspUpdated + pnEspUpdated;
    console.log('\n' + '='.repeat(70));
    console.log(`🎉 SEED DE EMBEDDINGS CONCLUÍDO: ${totalAtualizado} VETORES GRAVADOS!`);
    console.log('='.repeat(70));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro no seed de embeddings:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seedEmbeddings().catch((err) => {
  console.error(err);
  process.exit(1);
});
