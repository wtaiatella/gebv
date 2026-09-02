import { Pool, QueryResult, QueryResultRow } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('[DB] DATABASE_URL não configurada no ambiente.');
    }

    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[DB Pool Error] Erro inesperado no cliente do pool:', err);
    });
  }

  return pool;
}

export async function query<R extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<R>> {
  const p = getPool();
  return p.query<R>(text, params);
}

export async function withTransaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
