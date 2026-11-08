/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FATOSBR — SUITE DE VALIDAÇÃO DOS ENDPOINTS CANÔNICOS DE EVENTOS E INGESTÃO
 * Valida:
 * 1. Resiliência de GET /api/proxy/events (200 com array vazio em caso de banco inicial, NUNCA 500).
 * 2. Bloqueio estrito de POST não autorizado em /api/proxy/ingest (403 Forbidden).
 * 3. Geração determinística de UUIDs RFC 4122 v4 para deduplicação canônica.
 * 4. Normalização canônica de URLs de notícias.
 */

import assert from 'assert';
import eventsHandler from '../api/_lib/handlers/proxy/events';
import statusHandler from '../api/_lib/handlers/proxy/status';
import { generateDeterministicUuid, canonicalizeUrl } from '../api/_lib/ingestionEngine';

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
  result: () => { statusCode: number; headers: Record<string, string>; json: any };
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
      return { statusCode, headers, json };
    }
  };
}

async function run() {
  console.log('======================================================');
  console.log('🔍 FATOSBR — TESTE DE VALIDAÇÃO DOS ENDPOINTS CANÔNICOS');
  console.log('======================================================\n');

  // 1. Validação de UUIDs RFC 4122 v4
  console.log('--- 1. TESTE DE GERAÇÃO DETERMINÍSTICA DE UUIDS ---');
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const url1 = 'https://g1.globo.com/economia/noticia/2026/11/08/inflacao.ghtml';
  const url2 = 'https://g1.globo.com/economia/noticia/2026/11/08/inflacao.ghtml?utm_source=twitter';

  const uuidA = generateDeterministicUuid(canonicalizeUrl(url1));
  const uuidB = generateDeterministicUuid(canonicalizeUrl(url2));

  assert(uuidRegex.test(uuidA), `UUID gerado inválido: ${uuidA}`);
  assert(uuidRegex.test(uuidB), `UUID gerado inválido: ${uuidB}`);
  assert(uuidA === uuidB, `UUID determinístico falhou para URLs equivalentes: ${uuidA} !== ${uuidB}`);
  console.log('  ✅ [PASS] UUIDs determinísticos válidos RFC 4122 v4 gerados com sucesso');

  // 2. GET /api/proxy/events não quebra com 500 mesmo sem PostgreSQL provisionado localmente
  console.log('\n--- 2. TESTE DE RESILIÊNCIA DE GET /api/proxy/events ---');
  const { res: resGet, result: resultGet } = createMockRes();
  const reqGet = createMockReq({ method: 'GET', url: '/api/proxy/events?limit=10' });
  await eventsHandler(reqGet, resGet);
  const outGet = resultGet();

  assert(outGet.statusCode === 200, `Esperado HTTP 200, recebido ${outGet.statusCode}`);
  assert(outGet.json?.success === true, 'Resposta deve conter success: true');
  assert(Array.isArray(outGet.json?.events), 'Resposta deve conter array events');
  console.log(`  ✅ [PASS] GET /api/proxy/events respondeu 200 de forma resiliente (${outGet.json.count} eventos)`);

  // 3. POST /api/proxy/ingest bloqueia gravação direta desautorizada
  console.log('\n--- 3. TESTE DE PROTEÇÃO DE SEGURANÇA EM /api/proxy/ingest ---');
  const { res: resIngestBad, result: resultIngestBad } = createMockRes();
  const reqIngestBad = createMockReq({
    method: 'POST',
    url: '/api/proxy/ingest',
    body: { events: [{ title: 'Noticia arbitrária forjada' }] }
  });
  await eventsHandler(reqIngestBad, resIngestBad);
  const outIngestBad = resultIngestBad();

  assert(outIngestBad.statusCode === 403, `Esperado HTTP 403 para cliente desautorizado, recebido ${outIngestBad.statusCode}`);
  assert(outIngestBad.json?.code === 'UNAUTHORIZED_INGESTION', 'Código deve ser UNAUTHORIZED_INGESTION');
  console.log('  ✅ [PASS] POST desautorizado em /api/proxy/ingest bloqueado com HTTP 403 UNAUTHORIZED_INGESTION');

  // 4. Status endpoint reporta métricas canônicas
  console.log('\n--- 4. TESTE DE DIAGNÓSTICO EM /api/proxy/status ---');
  const { res: resStatus, result: resultStatus } = createMockRes();
  const reqStatus = createMockReq({ method: 'GET', url: '/api/proxy/status' });
  await statusHandler(reqStatus, resStatus);
  const outStatus = resultStatus();

  assert(outStatus.statusCode === 200, `Status deve responder 200, recebido ${outStatus.statusCode}`);
  assert(outStatus.json?.newsEngine?.pipeline?.includes('Canonical Schema'), 'Pipeline deve reportar Canonical Schema');
  console.log('  ✅ [PASS] /api/proxy/status expõe estrutura operacional e esquema canônico');

  console.log('\n======================================================');
  console.log('🎉 TODOS OS TESTES CANÔNICOS PASSARAM COM SUCESSO!');
  console.log('======================================================');
}

run().catch((err) => {
  console.error('❌ Falha nos testes canônicos:', err);
  process.exit(1);
});
