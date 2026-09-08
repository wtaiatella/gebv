import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERRO: Defina DATABASE_URL no .env');
    process.exit(1);
  }

  console.log('=== EXECUTANDO MIGRATION RUNNER DO POSTGRESQL ===');
  console.log('Conectando ao banco de dados...');
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    // 1. Garante que a tabela de controle de migrações existe
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Consulta migrações já executadas
    const appliedRes = await client.query(`SELECT name FROM _migrations`);
    const appliedSet = new Set(appliedRes.rows.map((r) => r.name));

    // 3. Lê pasta de migrations
    const migrationsDir = path.join(process.cwd(), 'app', 'lib', 'db', 'migrations');
    const files = await readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

    let executedCount = 0;

    for (const file of sqlFiles) {
      if (appliedSet.has(file)) {
        console.log(`  [OK] ${file} (já aplicada anteriormente)`);
        continue;
      }

      console.log(`  [EXECUTANDO] ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = await readFile(filePath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
        await client.query('COMMIT');
        console.log(`  ✓ ${file} aplicada com sucesso.`);
        executedCount++;
      } catch (migrationErr) {
        await client.query('ROLLBACK');
        console.error(`ERRO ao aplicar migração ${file}:`, migrationErr);
        throw migrationErr;
      }
    }

    if (executedCount === 0) {
      console.log('✓ Banco de dados já está 100% atualizado com todas as migrações.');
    } else {
      console.log(`✓ ${executedCount} nova(s) migração(ões) aplicada(s) com sucesso.`);
    }
  } catch (err) {
    console.error('Falha geral no processo de migração:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
