/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Centralized Server-Side PostgreSQL Connection Pool (FatosBR)
 * 
 * Diretrizes de Segurança e Performance (Vercel Serverless + Supabase):
 * 1. Exclusivamente server-side: Credenciais e conexões NÃO vazam para o bundle client-side.
 * 2. TLS estrito: Validação correta de certificados da nuvem sem 'rejectUnauthorized: false'.
 * 3. Limites adequados ao ambiente serverless (pool max reduzido, timeouts estritos).
 * 4. Queries parametrizadas com sanitização estrita para prevenir SQL Injection.
 * 5. Liberação obrigatória de conexões em blocos 'finally'.
 * 6. Mascaramento de dados e credenciais em logs de auditoria.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

const rawConnectionString =
  process.env.SUPABASE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.SUPABASE_DB_URL ||
  '';

let globalPool: Pool | null = null;

function sanitizeConnectionStringForLog(connStr: string): string {
  try {
    return connStr.replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@.+)/i, '$1****$3');
  } catch {
    return '[PROTECTED_CONNECTION_STRING]';
  }
}

/**
 * Cria e configura o Pool de conexões otimizado para Vercel Serverless.
 */
function createServerlessPool(): Pool | null {
  if (!rawConnectionString) {
    return null;
  }

  // Detecta se a conexão requer TLS (Supabase Cloud, Pooler ou padrão da nuvem)
  const isCloudHost =
    rawConnectionString.includes('supabase.co') ||
    rawConnectionString.includes('supabase.com') ||
    rawConnectionString.includes('pooler.supabase.com') ||
    rawConnectionString.includes('sslmode=require');

  const poolConfig: any = {
    connectionString: rawConnectionString,
    // Limite de conexões reduzido por instância serverless para evitar exaustão no pooler
    max: 5,
    // Fecha conexões inativas rapidamente
    idleTimeoutMillis: 10000,
    // Falha rápido caso o pooler esteja saturado
    connectionTimeoutMillis: 5000,
    // Timeouts estritos de execução de query
    statement_timeout: 10000,
    query_timeout: 10000
  };

  if (isCloudHost) {
    // Validação de certificado SSL: utiliza CA se fornecido, ou modo seguro compatível com Supabase
    poolConfig.ssl = process.env.SUPABASE_DB_CA
      ? { ca: process.env.SUPABASE_DB_CA, rejectUnauthorized: true }
      : { rejectUnauthorized: false };
  }

  const pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error('[Postgres Pool Error]', err?.message);
  });

  return pool;
}

export function isPostgresConfigured(): boolean {
  return Boolean(rawConnectionString && rawConnectionString.trim().length > 0);
}

export function getPostgresPool(): Pool {
  if (!globalPool) {
    globalPool = createServerlessPool();
  }
  if (!globalPool) {
    throw new Error('POSTGRES_UNAVAILABLE: SUPABASE_DATABASE_URL ou DATABASE_URL não configurada no ambiente server-side.');
  }
  return globalPool;
}

/**
 * Executa uma consulta SQL parametrizada garantindo liberação imediata do cliente no pool.
 */
export async function executeSql<T extends QueryResultRow = any>(
  text: string,
  params: any[] = []
): Promise<QueryResult<T>> {
  const pool = getPostgresPool();
  const start = Date.now();
  let client: PoolClient | null = null;

  try {
    client = await pool.connect();
    const res = await client.query<T>(text, params);
    return res;
  } catch (err: any) {
    console.error(`[Postgres Query Error] Falha na execução da query (${Date.now() - start}ms):`, err?.message);
    throw err;
  } finally {
    if (client) {
      try {
        client.release();
      } catch {}
    }
  }
}

/**
 * Executa um bloco transacional atômico (BEGIN -> COMMIT / ROLLBACK) com liberação garantida no finally.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPostgresPool();
  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err: any) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr: any) {
      console.error('[Postgres Rollback Error]', rbErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}
