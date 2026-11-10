/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Centralized Server-Side PostgreSQL Connection Pool (FatosBR)
 * 
 * Diretrizes de Segurança e Performance (Vercel Serverless + Supabase):
 * 1. Exclusivamente server-side: Credenciais e conexões NÃO vazam para o bundle client-side.
 * 2. TLS estrito: Validação obrigatória de certificados da nuvem com rejectUnauthorized: true.
 * 3. Limites adequados ao ambiente serverless (pool max reduzido, timeouts estritos).
 * 4. Queries parametrizadas com sanitização estrita para prevenir SQL Injection.
 * 5. Liberação obrigatória de conexões em blocos 'finally'.
 * 6. Mascaramento de dados e credenciais em logs de auditoria.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
let globalPool: Pool | null = null;


// Bundle público oficial de CA da Supabase (Root CA 2021 + Intermediate CA 2021)
// Garante validação criptográfica estrita (rejectUnauthorized: true) sem erro de self-signed certificate
const SUPABASE_OFFICIAL_CA_BUNDLE = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDvzCCAqegAwIBAgIUBhalAwMQ7BA1NH7td4msPPwxHzowDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIzMTAyNDA3NTM0NVoXDTMzMTAyMTA3NTM0NVow
czELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEmMCQGA1UEAwwdU3VwYWJhc2Ug
SW50ZXJtZWRpYXRlIDIwMjEgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQDOAMhXirH+EGIn8GaDp8T53rEogf7kM8OKW2uQ5yU/wxPa+w8BXgTzWy3W
JDAUhZE78oUtAd9kk5zKPrLXoT3W61PPnOc/9dceL5gB7/78m7EKCySziAA2c8vR
fnYPfznedDXi2lryttSYmMf2qbZDErAxwJDUm6cyq+HLAfb2qUH28u6jP8I9GDtG
PkQnjqtiRXEKjbTc/ntqCQrhtFK02mHkMSju7nEpkNYryunv5n/c9mrRY9/8GwmP
3uSZz3CQ8yQ/E0f8T9gCca2TcKuTQmW2pQqtHv1MuZ3jfJE5Nr9+Fap5kdzDJtdf
BdKofVNZlnYIru5yhUZywY3xYFfHAgMBAAGjUzBRMB0GA1UdDgQWBBQVoFMuvXJ9
Yv+QJr6/GJX0Z0VA+jAfBgNVHSMEGDAWgBSo17l2N9gs7ZISJp4OMiTVLWlGLDAP
BgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQAwdx0XJRHTf/crGpsrn
07uRziGSswWWTe+kDATMQeRZAEW3grVki5LDzs+JLbVIJYhRXFRXkqTRJdSGAgH
/0LNw7GDUwKOLnIRoYR3ILqSFZbkXbrYQ4Yir5yQZWgiNhRNfpEnMMIEQEZoSuFn
8Uh6M4HNfVuwBPgV0/gvKEja3DjJgwPAYzoXvKh5m3fKTt2c22YcTDdZTUDfrst6
Vpt/M03FY6D+897yfNR+nEzeEwjzHMZkperTwVfmBdyXIgIWexQ/whoky7+I4pjz
eLtkPBlwE3WB9fGZVjZqdUNSasS8mmWIyxHPttTzTHHmElDw2OQ/s9HjfCxJztk2
VCgJ
-----END CERTIFICATE-----`;

const CANONICAL_SUPABASE_PROJECT_ID = 'zopbitgtexefmqfvwgzj';

export interface DatabaseDiagnostic {
  configured: boolean;
  selectedVariable: string | null;
  host: string | null;
  port: number | null;
  database: string | null;
  isCanonicalProject: boolean;
  connectionType: 'direct_supabase' | 'pooler_supabase' | 'external_cloud' | 'local' | 'none';
  sslMode: 'strict_verified' | 'disabled';
  caSource: 'environment_variable' | 'official_embedded_bundle' | 'none';
}

interface ParsedDbConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  database: string;
  sourceVariable: string;
  isCloudHost: boolean;
  isCanonicalProject: boolean;
  connectionType: DatabaseDiagnostic['connectionType'];
  trustedCa: string;
  caSource: DatabaseDiagnostic['caSource'];
}

/**
 * Inspeciona as variáveis de ambiente em ordem prioritária e resolve a conexão canônica.
 * Proteção contra conflitos de variáveis do Vercel Postgres / Neon quando Supabase for o banco alvo.
 */
function resolveCanonicalDbConfig(): ParsedDbConfig | null {
  const candidateVars = [
    'SUPABASE_DATABASE_URL',
    'DATABASE_URL',
    'POSTGRES_URL',
    'POSTGRES_PRISMA_URL',
    'POSTGRES_URL_NON_POOLING',
    'SUPABASE_DB_URL'
  ];

  let chosenVar: string | null = null;
  let rawStr: string = '';

  // 1. Prioriza explicitamente variáveis que apontem para o projeto canônico zopbitgtexefmqfvwgzj
  for (const v of candidateVars) {
    const val = process.env[v]?.trim();
    if (val && val.includes(CANONICAL_SUPABASE_PROJECT_ID)) {
      chosenVar = v;
      rawStr = val;
      break;
    }
  }

  // 2. Se nenhuma apontar explicitamente para o Project ID, segue a ordem canônica padrão
  if (!rawStr) {
    for (const v of candidateVars) {
      const val = process.env[v]?.trim();
      if (val) {
        chosenVar = v;
        rawStr = val;
        break;
      }
    }
  }

  // 3. Fallback para variáveis individuais desmembradas (POSTGRES_HOST, etc.)
  if (!rawStr && process.env.POSTGRES_HOST) {
    chosenVar = 'POSTGRES_HOST';
    const host = process.env.POSTGRES_HOST.trim();
    const port = parseInt(process.env.POSTGRES_PORT?.trim() || '5432', 10);
    const user = process.env.POSTGRES_USER?.trim() || 'postgres';
    const password = process.env.POSTGRES_PASSWORD?.trim();
    const database = process.env.POSTGRES_DATABASE?.trim() || 'postgres';
    const isCloudHost = host.includes('supabase.co') || host.includes('supabase.com') || host.includes('pooler.supabase.com');
    const isCanonical = host.includes(CANONICAL_SUPABASE_PROJECT_ID);
    const trustedCa = process.env.SUPABASE_DB_CA?.trim() || SUPABASE_OFFICIAL_CA_BUNDLE;

    return {
      host,
      port,
      user,
      password,
      database,
      sourceVariable: chosenVar,
      isCloudHost,
      isCanonicalProject: isCanonical,
      connectionType: host.includes('pooler.supabase.com') ? 'pooler_supabase' : isCloudHost ? 'direct_supabase' : 'external_cloud',
      trustedCa,
      caSource: process.env.SUPABASE_DB_CA ? 'environment_variable' : 'official_embedded_bundle'
    };
  }

  if (!rawStr || !chosenVar) {
    return null;
  }

  // 4. Sanitiza a connection string removendo parâmetros conflitantes como ?sslmode=...
  // Causa Raiz Descoberta: o driver pg/lib/connection-parameters sobrescreve config.ssl com {}
  // quando connectionString possui ?sslmode=require, destruindo a CA embutida e causando
  // o erro "self-signed certificate in certificate chain".
  const cleanUrl = rawStr
    .replace(/[?&]sslmode=[^&]+/g, '')
    .replace(/[?&]ssl=[^&]+/g, '')
    .replace(/\?$/, '');

  let host = 'localhost';
  let port = 5432;
  let user: string | undefined = undefined;
  let password: string | undefined = undefined;
  let database = 'postgres';

  try {
    const url = new URL(cleanUrl.startsWith('postgres') ? cleanUrl : `postgresql://${cleanUrl}`);
    host = url.hostname;
    port = url.port ? parseInt(url.port, 10) : (host.includes('pooler.supabase.com') && url.port === '6543' ? 6543 : 5432);
    user = url.username ? decodeURIComponent(url.username) : undefined;
    password = url.password ? decodeURIComponent(url.password) : undefined;
    database = url.pathname ? url.pathname.replace(/^\//, '') : 'postgres';
  } catch (err: any) {
    console.error('[Postgres Config Resolver] Erro ao analisar URL limpa:', err?.message);
    return null;
  }

  const isCloudHost =
    host.includes('supabase.co') ||
    host.includes('supabase.com') ||
    host.includes('pooler.supabase.com') ||
    host.includes('neon.tech') ||
    host.includes('postgres.vercel-storage.com') ||
    rawStr.includes('sslmode=');

  const isCanonical = host.includes(CANONICAL_SUPABASE_PROJECT_ID) || (user ? user.includes(CANONICAL_SUPABASE_PROJECT_ID) : false);

  let connectionType: DatabaseDiagnostic['connectionType'] = 'local';
  if (host.includes('pooler.supabase.com')) {
    connectionType = 'pooler_supabase';
  } else if (host.includes('supabase.co') || host.includes('supabase.com')) {
    connectionType = 'direct_supabase';
  } else if (isCloudHost) {
    connectionType = 'external_cloud';
  }

  const trustedCa = process.env.SUPABASE_DB_CA?.trim() || SUPABASE_OFFICIAL_CA_BUNDLE;

  return {
    host,
    port,
    user,
    password,
    database,
    sourceVariable: chosenVar,
    isCloudHost,
    isCanonicalProject: isCanonical,
    connectionType,
    trustedCa,
    caSource: process.env.SUPABASE_DB_CA ? 'environment_variable' : 'official_embedded_bundle'
  };
}

/**
 * Retorna diagnóstico seguro do banco para status e healthcheck (sem credenciais ou segredos).
 */
export function getDatabaseDiagnosticInfo(): DatabaseDiagnostic {
  const resolved = resolveCanonicalDbConfig();
  if (!resolved) {
    return {
      configured: false,
      selectedVariable: null,
      host: null,
      port: null,
      database: null,
      isCanonicalProject: false,
      connectionType: 'none',
      sslMode: 'disabled',
      caSource: 'none'
    };
  }

  return {
    configured: true,
    selectedVariable: resolved.sourceVariable,
    host: resolved.host,
    port: resolved.port,
    database: resolved.database,
    isCanonicalProject: resolved.isCanonicalProject,
    connectionType: resolved.connectionType,
    sslMode: resolved.isCloudHost ? 'strict_verified' : 'disabled',
    caSource: resolved.caSource
  };
}

/**
 * Cria e configura o Pool de conexões otimizado para Vercel Serverless.
 * IMPORTANTE: Nunca passa a chave 'connectionString' com 'sslmode' para o Pool,
 * evitando a sobrescrita do objeto TLS com {} pelo driver 'pg'.
 */
function createServerlessPool(): Pool | null {
  const resolved = resolveCanonicalDbConfig();
  if (!resolved) {
    return null;
  }

  const poolConfig: any = {
    host: resolved.host,
    port: resolved.port,
    user: resolved.user,
    password: resolved.password,
    database: resolved.database,
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

  if (resolved.isCloudHost) {
    // Validação estrita de certificado TLS sempre ativa com rejectUnauthorized: true.
    // Utiliza a CA oficial da Supabase e ativa Server Name Indication (SNI).
    poolConfig.ssl = {
      ca: resolved.trustedCa,
      rejectUnauthorized: true,
      servername: resolved.host
    };
  }

  const pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error('[Postgres Pool Error]', err?.message);
    // Em caso de falha de conexão, invalida o pool global para forçar reconexão limpa
    if (globalPool === pool) {
      globalPool = null;
    }
  });

  return pool;
}

export function isPostgresConfigured(): boolean {
  return Boolean(resolveCanonicalDbConfig());
}

export function getPostgresPool(): Pool {
  if (!globalPool) {
    globalPool = createServerlessPool();
  }
  if (!globalPool) {
    throw new Error('POSTGRES_UNAVAILABLE: Nenhuma variável de banco de dados PostgreSQL válida configurada no ambiente server-side.');
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
      console.error('[Postgres Rollback Error]', rbErr?.message || rbErr);
    }
    throw err;
  } finally {
    client.release();
  }
}
