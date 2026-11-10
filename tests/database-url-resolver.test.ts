/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FATOSBR — SUITE DE TESTES UNITÁRIOS DO PARSER E RESOLVER POSTGRESQL V1.5
 * 
 * Cobertura Obrigatória:
 * 1. URL PostgreSQL válida.
 * 2. URL com parâmetros SSL (?sslmode=require).
 * 3. URL com múltiplos parâmetros (?sslmode=require&supa=base-pooler.x).
 * 4. Senha com caracteres especiais percent-encoded.
 * 5. Nome de banco correto ("postgres") sem contaminação por query params.
 * 6. Teste de regressão específico contra o bug "postgres&supa=base-pooler.x".
 * 7. URL malformada (rejeição com erro explícito).
 * 8. Host inesperado / inválido.
 * 9. Porta inválida (fora de 1-65535).
 * 10. Priorização estrita de SUPABASE_DATABASE_URL sobre variáveis conflitantes.
 */

import assert from 'assert';
import { parseDatabaseUrl, resolveCanonicalDbConfig, getDatabaseDiagnosticInfo } from '../api/_lib/postgres';

function runResolverTests() {
  console.log('======================================================================');
  console.log('🧪 FATOSBR — SUITE DE TESTES UNITÁRIOS: PARSER & RESOLVER POSTGRESQL');
  console.log('======================================================================\n');

  // 1. URL PostgreSQL válida padrão
  console.log('--- 1. URL PostgreSQL Válida Padrão ---');
  const valid1 = parseDatabaseUrl('postgresql://postgres:secret123@db.zopbitgtexefmqfvwgzj.supabase.co:5432/postgres');
  assert.strictEqual(valid1.host, 'db.zopbitgtexefmqfvwgzj.supabase.co');
  assert.strictEqual(valid1.port, 5432);
  assert.strictEqual(valid1.user, 'postgres');
  assert.strictEqual(valid1.password, 'secret123');
  assert.strictEqual(valid1.database, 'postgres');
  console.log('  ✅ [PASS] URL padrão decomposta com sucesso');

  // 2. URL com parâmetros SSL (?sslmode=require)
  console.log('\n--- 2. URL com Parâmetros SSL (?sslmode=require) ---');
  const validSsl = parseDatabaseUrl('postgresql://postgres.zopbitgtexefmqfvwgzj:Pass123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require');
  assert.strictEqual(validSsl.host, 'aws-0-sa-east-1.pooler.supabase.com');
  assert.strictEqual(validSsl.port, 6543);
  assert.strictEqual(validSsl.user, 'postgres.zopbitgtexefmqfvwgzj');
  assert.strictEqual(validSsl.password, 'Pass123');
  assert.strictEqual(validSsl.database, 'postgres');
  console.log('  ✅ [PASS] Parâmetro sslmode=require isolado sem corromper o nome do banco');

  // 3. URL com múltiplos parâmetros (?sslmode=require&supa=base-pooler.x)
  console.log('\n--- 3. URL com Múltiplos Parâmetros (?sslmode=require&supa=base-pooler.x) ---');
  const multiParams = parseDatabaseUrl('postgresql://postgres.zopbitgtexefmqfvwgzj:Pass123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x');
  assert.strictEqual(multiParams.database, 'postgres', `Esperado "postgres", recebido "${multiParams.database}"`);
  assert.strictEqual(multiParams.port, 6543);
  assert.strictEqual(multiParams.user, 'postgres.zopbitgtexefmqfvwgzj');
  console.log('  ✅ [PASS] Múltiplos parâmetros de query mantidos fora do nome do banco');

  // 4. Teste de Regressão Específico: "postgres&supa=base-pooler.x"
  console.log('\n--- 4. TESTE DE REGRESSÃO: Prevenção do erro "postgres&supa=base-pooler.x" ---');
  // Se a URL contiver parâmetros malformados colados diretamente ao path
  const corruptedPathUrl = 'postgresql://postgres.zopbitgtexefmqfvwgzj:Pass123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres&supa=base-pooler.x';
  const regressionResult = parseDatabaseUrl(corruptedPathUrl);
  assert.strictEqual(regressionResult.database, 'postgres', 'O parser deve isolar "postgres" e nunca retornar "postgres&supa=base-pooler.x"');
  assert(!regressionResult.database.includes('&'), 'Nome do banco não pode conter caractere "&"');
  assert(!regressionResult.database.includes('='), 'Nome do banco não pode conter caractere "="');
  console.log('  ✅ [PASS] Regressão validada: banco extraído rigorosamente como "postgres"');

  // 5. Senha com caracteres percent-encoded (@, #, :, /, etc.)
  console.log('\n--- 5. Senha com Caracteres Especiais Percent-Encoded ---');
  const encodedPassUrl = 'postgresql://postgres.zopbitgtexefmqfvwgzj:MyP%40ssw%23rd%21@db.zopbitgtexefmqfvwgzj.supabase.co:5432/postgres';
  const encodedResult = parseDatabaseUrl(encodedPassUrl);
  assert.strictEqual(encodedResult.password, 'MyP@ssw#rd!');
  console.log('  ✅ [PASS] Senha decodificada com integridade ("MyP@ssw#rd!")');

  // 6. Protocolo "postgres:" vs "postgresql:"
  console.log('\n--- 6. Suporte aos Esquemas "postgres:" e "postgresql:" ---');
  const schemaPg = parseDatabaseUrl('postgres://user:pass@host.supabase.co:5432/my_db');
  assert.strictEqual(schemaPg.database, 'my_db');
  assert.strictEqual(schemaPg.host, 'host.supabase.co');
  console.log('  ✅ [PASS] Ambos os esquemas postgres: e postgresql: suportados');

  // 7. Rejeição de URLs Malformadas / Protocolos Inválidos
  console.log('\n--- 7. Falha Fechada para URLs Malformadas ---');
  assert.throws(() => parseDatabaseUrl('http://invalido.com/postgres'), /INVALID_PROTOCOL/);
  assert.throws(() => parseDatabaseUrl('mysql://root:pass@localhost:3306/db'), /INVALID_PROTOCOL/);
  assert.throws(() => parseDatabaseUrl(''), /EMPTY_URL/);
  console.log('  ✅ [PASS] Protocolos inválidos ou URLs vazias rejeitados com falha fechada');

  // 8. Rejeição de Hostname Inválido
  console.log('\n--- 8. Rejeição de Hostname Inválido ---');
  assert.throws(() => parseDatabaseUrl('postgresql://user:pass@localhost space:5432/db'), /INVALID_HOST/);
  assert.throws(() => parseDatabaseUrl('postgresql://user:pass@invalid/db'), /INVALID_HOST/);
  console.log('  ✅ [PASS] Hostnames inválidos rejeitados com erro explícito');

  // 9. Rejeição de Porta Inválida
  console.log('\n--- 9. Rejeição de Porta Inválida ---');
  assert.throws(() => parseDatabaseUrl('postgresql://user:pass@db.supabase.co:99999/db'), /INVALID_PORT/);
  assert.throws(() => parseDatabaseUrl('postgresql://user:pass@db.supabase.co:0/db'), /INVALID_PORT/);
  assert.throws(() => parseDatabaseUrl('postgresql://user:pass@db.supabase.co:abc/db'), /INVALID_PORT/);
  console.log('  ✅ [PASS] Portas fora do intervalo 1-65535 rejeitadas com erro explícito');

  // 10. Priorização Absoluta de SUPABASE_DATABASE_URL
  console.log('\n--- 10. Priorização Absoluta de SUPABASE_DATABASE_URL ---');
  const originalEnv = { ...process.env };
  try {
    process.env.POSTGRES_URL = 'postgresql://default:pass@ep-other-neon.us-east-1.aws.neon.tech:5432/verceldb';
    process.env.DATABASE_URL = 'postgresql://default:pass@ep-other-neon.us-east-1.aws.neon.tech:5432/verceldb';
    process.env.SUPABASE_DATABASE_URL = 'postgresql://postgres.zopbitgtexefmqfvwgzj:RealSecret@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x';

    const resolved = resolveCanonicalDbConfig();
    assert(resolved !== null, 'Configuração canônica deve ser resolvida');
    assert.strictEqual(resolved.sourceVariable, 'SUPABASE_DATABASE_URL', 'SUPABASE_DATABASE_URL deve ter prioridade máxima absoluta');
    assert.strictEqual(resolved.host, 'aws-0-sa-east-1.pooler.supabase.com');
    assert.strictEqual(resolved.port, 6543);
    assert.strictEqual(resolved.database, 'postgres');
    assert.strictEqual(resolved.isCanonicalProject, true);
    assert.strictEqual(resolved.connectionType, 'pooler_supabase');

    const diag = getDatabaseDiagnosticInfo();
    assert.strictEqual(diag.selectedVariable, 'SUPABASE_DATABASE_URL');
    assert.strictEqual(diag.database, 'postgres');
    assert.strictEqual(diag.host, 'aws-0-sa-east-1.pooler.supabase.com');
  } finally {
    process.env = originalEnv;
  }
  console.log('  ✅ [PASS] SUPABASE_DATABASE_URL priorizada com sucesso sobre variáveis de terceiros');

  console.log('\n======================================================================');
  console.log('🎉 TODOS OS 10 TESTES UNITÁRIOS DO RESOLVER PASSARAM COM SUCESSO!');
  console.log('======================================================================\n');
}

runResolverTests();
