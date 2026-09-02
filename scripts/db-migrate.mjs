import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERRO: Defina DATABASE_URL no .env');
    process.exit(1);
  }

  console.log('Conectando ao PostgreSQL...');
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    const schemaPath = path.join(process.cwd(), 'app', 'lib', 'db', 'schema.sql');
    const sql = await readFile(schemaPath, 'utf-8');

    console.log('Executando DDL em app/lib/db/schema.sql...');
    await client.query(sql);
    console.log('✓ Tabelas e índices criados/verificados com sucesso!');

    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('associados', 'progressoes_escoteiro', 'atividades_escoteiro', 'sync_logs')
      ORDER BY table_name;
    `);

    console.log('Tabelas existentes no banco:');
    for (const row of res.rows) {
      console.log(`  - ${row.table_name}`);
    }
  } catch (err) {
    console.error('Erro na migração:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
