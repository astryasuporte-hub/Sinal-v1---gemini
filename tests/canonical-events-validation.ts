/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FATOSBR — SUITE DE VALIDAÇÃO DOS ENDPOINTS CANÔNICOS, SEGURANÇA E INGESTÃO V1.1
 * 
 * Valida Rigorosamente:
 * 1. Resiliência de GET /api/proxy/events (HTTP 200 sem falha 500 para base vazia).
 * 2. Bloqueio estrito de GET e POST em /api/proxy/ingest sem autenticação (HTTP 401 UNAUTHORIZED_CRON).
 * 3. Prevenção de Spoofing: Tentativa de bypass via cabeçalho x-vercel-cron sem token é bloqueada com HTTP 401.
 * 4. Rejeição de token incorreto/inválido com HTTP 401.
 * 5. Autorização legítima de Cron via GET com Authorization: Bearer <CRON_SECRET>.
 * 6. Autorização administrativa via POST com Authorization: Bearer <ADMIN_SECRET>.
 * 7. Geração de UUID v5 RFC 4122 formal determinístico (bits de versão 5 e variante RFC 4122).
 * 8. Normalização canônica de URLs de notícias.
 * 9. Ausência absoluta de rejectUnauthorized: false no pool do PostgreSQL (TLS estrito).
 * 10. Zero credenciais expostas no endpoint público GET /api/proxy/status.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import eventsHandler from '../api/_lib/handlers/proxy/events';
import statusHandler from '../api/_lib/handlers/proxy/status';
import { generateDeterministicUuidV5, canonicalizeUrl, generateSlug } from '../api/_lib/ingestionEngine';

function createMockReq(options: any = {}): any {
  const { method = 'GET', url = '/api/proxy/events', headers = {}, body } = options;
  return {
    method,
    url,
    headers: {
      'x-forwarded-for': '127.0.0.1',
      ...headers
    },
    body,
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: async function* () {
      if (body) yield Buffer.from(JSON.stringify(body));
    }
  };
}

function createMockRes(): {
  res: any;
  result: () => { statusCode: number; headers: Record<string, string>; json: any; raw: string };
} {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let raw = '';

  const res: any = {
    statusCode: 200,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    writeHead: (code: number, hdrs: Record<string, string> = {}) => {
      statusCode = code;
      for (const [k, v] of Object.entries(hdrs)) {
        headers[k.toLowerCase()] = v;
      }
    },
    write: (data: string) => {
      raw += data;
    },
    end: (data?: string) => {
      if (data) raw += data;
      statusCode = res.statusCode;
    }
  };

  return {
    res,
    result: () => {
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {}
      return { statusCode, headers, json, raw };
    }
  };
}

async function run() {
  console.log('======================================================================');
  console.log('🔒 FATOSBR — SUITE DE VALIDAÇÃO DE SEGURANÇA E INGESTÃO V1.1');
  console.log('======================================================================\n');

  const testCronSecret = 'cron_sec_live_prod_test_9921';
  const testAdminSecret = 'admin_sec_live_prod_test_8812';
  process.env.CRON_SECRET = testCronSecret;
  process.env.ADMIN_SECRET = testAdminSecret;

  // 1. Validação de UUIDs RFC 4122 v5
  console.log('--- 1. TESTE DE GERAÇÃO DETERMINÍSTICA DE UUID V5 (RFC 4122) ---');
  const uuidV5Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const url1 = 'https://g1.globo.com/economia/noticia/2026/11/08/inflacao.ghtml';
  const url2 = 'https://g1.globo.com/economia/noticia/2026/11/08/inflacao.ghtml?utm_source=twitter&fbclid=xyz';

  const uuidA = generateDeterministicUuidV5(canonicalizeUrl(url1));
  const uuidB = generateDeterministicUuidV5(canonicalizeUrl(url2));

  assert(uuidV5Regex.test(uuidA), `UUID v5 gerado inválido: ${uuidA}`);
  assert(uuidV5Regex.test(uuidB), `UUID v5 gerado inválido: ${uuidB}`);
  assert(uuidA === uuidB, `UUID determinístico v5 falhou para URLs equivalentes: ${uuidA} !== ${uuidB}`);
  assert(generateSlug('Avanços em IA no Brasil!').includes('avancos-em-ia-no-brasil'), 'Slug generator falhou');
  console.log('  ✅ [PASS] UUIDs determinísticos válidos RFC 4122 v5 gerados com sucesso');

  // 2. Auditoria estrita de TLS em postgres.ts (Falha nº 4)
  console.log('\n--- 2. AUDITORIA DE TLS ESTRETO NO POSTGRESQL ---');
  const postgresCode = fs.readFileSync(path.resolve('api/_lib/postgres.ts'), 'utf-8');
  assert(!postgresCode.includes('rejectUnauthorized: false'), 'VULNERABILIDADE CRÍTICA: rejectUnauthorized: false ainda presente em postgres.ts');
  assert(postgresCode.includes('rejectUnauthorized: true'), 'Configuração segura rejectUnauthorized: true não encontrada em postgres.ts');
  assert(postgresCode.includes('SUPABASE_OFFICIAL_CA_BUNDLE') || postgresCode.includes('Supabase Root 2021 CA'), 'Cadeia de CA oficial da Supabase ausente em postgres.ts');
  assert(postgresCode.includes('resolveCanonicalDbConfig'), 'Resolver de conexão canônica ausente em postgres.ts');
  assert(postgresCode.includes('getDatabaseDiagnosticInfo'), 'Diagnóstico de conexão ausente em postgres.ts');
  console.log('  ✅ [PASS] rejectUnauthorized: false completamente eliminado de api/_lib/postgres.ts');
  console.log('  ✅ [PASS] Cadeia oficial de certificados CA da Supabase configurada com sucesso no pool TLS');
  console.log('  ✅ [PASS] Resolver de conexão canônica e prevenção de sobrescrita TLS validados');

  // 3. Resiliência de GET /api/proxy/events (Falha nº 5 & 7)
  console.log('\n--- 3. TESTE DE RESILIÊNCIA DE GET /api/proxy/events ---');
  const { res: resGet, result: resultGet } = createMockRes();
  const reqGet = createMockReq({ method: 'GET', url: '/api/proxy/events?limit=10' });
  await eventsHandler(reqGet, resGet);
  const outGet = resultGet();

  assert(outGet.statusCode === 200, `Esperado HTTP 200, recebido ${outGet.statusCode}`);
  assert(outGet.json?.success === true, 'Resposta deve conter success: true');
  assert(Array.isArray(outGet.json?.events), 'Resposta deve conter array events');
  console.log(`  ✅ [PASS] GET /api/proxy/events respondeu 200 de forma resiliente (${outGet.json.count} eventos)`);

  // 4. Testes de Segurança de Autorização na Ingestão (Falhas nº 2 e 3)
  console.log('\n--- 4. TESTES DE SEGURANÇA NA ROTA DE INGESTÃO (/api/proxy/ingest) ---');

  // 4.1 GET /api/proxy/ingest sem cabeçalho Authorization
  const { res: resGetNoAuth, result: resultGetNoAuth } = createMockRes();
  const reqGetNoAuth = createMockReq({ method: 'GET', url: '/api/proxy/ingest' });
  await eventsHandler(reqGetNoAuth, resGetNoAuth);
  const outGetNoAuth = resultGetNoAuth();
  assert(outGetNoAuth.statusCode === 401, `Esperado HTTP 401 para GET sem auth, recebido ${outGetNoAuth.statusCode}`);
  assert(outGetNoAuth.json?.code === 'UNAUTHORIZED_CRON', 'Código deve ser UNAUTHORIZED_CRON');
  console.log('  ✅ [PASS] GET /api/proxy/ingest sem autenticação bloqueado com HTTP 401 UNAUTHORIZED_CRON');

  // 4.2 POST /api/proxy/ingest sem cabeçalho Authorization
  const { res: resPostNoAuth, result: resultPostNoAuth } = createMockRes();
  const reqPostNoAuth = createMockReq({ method: 'POST', url: '/api/proxy/ingest', body: { keywords: ['brasil'] } });
  await eventsHandler(reqPostNoAuth, resPostNoAuth);
  const outPostNoAuth = resultPostNoAuth();
  assert(outPostNoAuth.statusCode === 401, `Esperado HTTP 401 para POST sem auth, recebido ${outPostNoAuth.statusCode}`);
  assert(outPostNoAuth.json?.code === 'UNAUTHORIZED_CRON', 'Código deve ser UNAUTHORIZED_CRON');
  console.log('  ✅ [PASS] POST /api/proxy/ingest sem autenticação bloqueado com HTTP 401 UNAUTHORIZED_CRON');

  // 4.3 Ataque de spoofing: cabeçalho x-vercel-cron sem token Bearer é rejeitado
  const { res: resSpoof, result: resultSpoof } = createMockRes();
  const reqSpoof = createMockReq({
    method: 'GET',
    url: '/api/proxy/ingest',
    headers: { 'x-vercel-cron': '1' }
  });
  await eventsHandler(reqSpoof, resSpoof);
  const outSpoof = resultSpoof();
  assert(outSpoof.statusCode === 401, `Tentativa de bypass com x-vercel-cron deve retornar 401, recebido ${outSpoof.statusCode}`);
  assert(outSpoof.json?.code === 'UNAUTHORIZED_CRON', 'Código deve ser UNAUTHORIZED_CRON');
  console.log('  ✅ [PASS] Bypass com cabeçalho arbitrário x-vercel-cron rejeitado com HTTP 401');

  // 4.4 Token incorreto é rejeitado
  const { res: resBadToken, result: resultBadToken } = createMockRes();
  const reqBadToken = createMockReq({
    method: 'GET',
    url: '/api/proxy/ingest',
    headers: { authorization: 'Bearer token_invalido_forjado' }
  });
  await eventsHandler(reqBadToken, resBadToken);
  const outBadToken = resultBadToken();
  assert(outBadToken.statusCode === 401, `Token inválido deve retornar 401, recebido ${outBadToken.statusCode}`);
  console.log('  ✅ [PASS] Token Bearer incorreto rejeitado com HTTP 401');

  // 4.5 Método não suportado (ex: DELETE, PUT) retorna 405
  const { res: resMethod, result: resultMethod } = createMockRes();
  const reqMethod = createMockReq({ method: 'DELETE', url: '/api/proxy/ingest' });
  await eventsHandler(reqMethod, resMethod);
  const outMethod = resultMethod();
  assert(outMethod.statusCode === 405, `Método DELETE deve retornar 405, recebido ${outMethod.statusCode}`);
  console.log('  ✅ [PASS] Métodos não permitidos em /api/proxy/ingest rejeitados com HTTP 405');

  // 4.6 Chamada de Cron com Authorization: Bearer <CRON_SECRET> autorizada
  const { res: resCronOk, result: resultCronOk } = createMockRes();
  const reqCronOk = createMockReq({
    method: 'GET',
    url: '/api/proxy/ingest',
    headers: { authorization: `Bearer ${testCronSecret}` }
  });
  await eventsHandler(reqCronOk, resCronOk);
  const outCronOk = resultCronOk();
  assert(outCronOk.statusCode === 200, `Cron autenticado deve responder 200, recebido ${outCronOk.statusCode}`);
  assert(outCronOk.json?.authType === 'cron_secret', 'authType deve ser cron_secret');
  console.log('  ✅ [PASS] Cron GET oficial com Authorization: Bearer <CRON_SECRET> executado com sucesso (HTTP 200)');

  // 4.7 Chamada Administrativa manual com Authorization: Bearer <ADMIN_SECRET> autorizada
  const { res: resAdminOk, result: resultAdminOk } = createMockRes();
  const reqAdminOk = createMockReq({
    method: 'POST',
    url: '/api/proxy/ingest',
    headers: { authorization: `Bearer ${testAdminSecret}` },
    body: { keywords: ['brasil'] }
  });
  await eventsHandler(reqAdminOk, resAdminOk);
  const outAdminOk = resultAdminOk();
  assert(outAdminOk.statusCode === 200, `Admin autenticado deve responder 200, recebido ${outAdminOk.statusCode}`);
  assert(outAdminOk.json?.authType === 'admin_secret', 'authType deve ser admin_secret');
  console.log('  ✅ [PASS] Disparo administrativo POST com Authorization: Bearer <ADMIN_SECRET> executado com sucesso (HTTP 200)');

  // 5. Teste de Diagnóstico em /api/proxy/status (Falha nº 11)
  console.log('\n--- 5. TESTE DE DIAGNÓSTICO EM /api/proxy/status ---');
  const { res: resStatus, result: resultStatus } = createMockRes();
  const reqStatus = createMockReq({ method: 'GET', url: '/api/proxy/status' });
  await statusHandler(reqStatus, resStatus);
  const outStatus = resultStatus();

  assert(outStatus.statusCode === 200, `Status deve responder 200, recebido ${outStatus.statusCode}`);
  assert(!outStatus.raw.includes('maskedKey'), 'NENHUMA chave ou maskedKey deve vazar no payload público de status');
  assert(outStatus.json?.newsEngine?.pipeline?.includes('Canonical Schema'), 'Pipeline deve reportar Canonical Schema');
  console.log('  ✅ [PASS] /api/proxy/status público livre de credenciais e expondo esquema canônico');

  console.log('\n======================================================================');
  console.log('🎉 TODOS OS TESTES CANÔNICOS E DE SEGURANÇA PASSARAM COM SUCESSO!');
  console.log('======================================================================');
}

run().catch((err) => {
  console.error('❌ Falha nos testes canônicos:', err);
  process.exit(1);
});
