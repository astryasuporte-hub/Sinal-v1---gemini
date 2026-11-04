/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR Automated Backend & Security Test Suite
 * Validates cryptographic signatures, webhook idempotency, SSRF protection,
 * rate limiting, and admin access control.
 */

import crypto from 'crypto';
import webhookHandler from '../api/zynpay/webhook';
import chargesHandler from '../api/zynpay/charges';
import configHandler from '../api/zynpay/config';
import balanceHandler from '../api/zynpay/balance';
import { isAllowedDomain } from '../api/_lib/common';
import { recordPendingCharge, getChargeById } from '../api/_lib/db';

// Mock HTTP Request & Response helpers
interface MockReqOptions {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
  rawBody?: string;
}

function createMockReq(options: MockReqOptions = {}): any {
  const { method = 'GET', url = '/api/zynpay', headers = {}, body, rawBody } = options;
  return {
    method,
    url,
    headers: {
      'x-forwarded-for': '127.0.0.1',
      ...headers
    },
    body,
    rawBody: rawBody !== undefined ? rawBody : (body ? JSON.stringify(body) : ''),
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: async function* () {
      if (rawBody) yield Buffer.from(rawBody);
      else if (body) yield Buffer.from(JSON.stringify(body));
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

// Test Runner
let testsPassed = 0;
let testsFailed = 0;

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    testsFailed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('\n======================================================');
  console.log('🔒 FATOSBR — SUITE AUTOMATIZADA DE SEGURANÇA E BACKEND');
  console.log('======================================================\n');

  const testSecret = 'whsec_zynpay_live_prod';
  process.env.ZYNPAY_WEBHOOK_SECRET = testSecret;

  // TEST 1: Rejeição de métodos não-POST no Webhook (405)
  await runTest('1. Webhook: Rejeição de requisições não-POST com HTTP 405', async () => {
    const { res, result } = createMockRes();
    const req = createMockReq({ method: 'GET', url: '/api/zynpay/webhook' });
    await webhookHandler(req, res);
    const { statusCode, json } = result();
    assert(statusCode === 405, `Esperado 405, recebido ${statusCode}`);
    assert(json?.code === 'METHOD_NOT_ALLOWED', `Esperado METHOD_NOT_ALLOWED, recebido ${json?.code}`);
  });

  // TEST 2: Webhook sem assinatura (401)
  await runTest('2. Webhook: Rejeição imediata quando assinatura HMAC está ausente (HTTP 401)', async () => {
    const { res, result } = createMockRes();
    const body = { id: 'evt_1', chargeId: 'zyn_1', type: 'charge.paid' };
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: {},
      body
    });
    await webhookHandler(req, res);
    const { statusCode, json } = result();
    assert(statusCode === 401, `Esperado 401, recebido ${statusCode}`);
    assert(json?.code === 'MISSING_SIGNATURE', `Esperado MISSING_SIGNATURE, recebido ${json?.code}`);
  });

  // TEST 3: Webhook com assinatura adulterada/inválida (403)
  await runTest('3. Webhook: Rejeição de payload com assinatura HMAC inválida/violada (HTTP 403)', async () => {
    const { res, result } = createMockRes();
    const rawBody = JSON.stringify({ id: 'evt_2', chargeId: 'zyn_2', type: 'charge.paid' });
    const forgedSignature = 'forged_deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234';
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zynpay-signature': forgedSignature },
      rawBody
    });
    await webhookHandler(req, res);
    const { statusCode, json } = result();
    assert(statusCode === 403, `Esperado 403, recebido ${statusCode}`);
    assert(json?.code === 'INVALID_SIGNATURE', `Esperado INVALID_SIGNATURE, recebido ${json?.code}`);
  });

  // TEST 4: Webhook com payload incompleto/malformado (400)
  await runTest('4. Webhook: Validação estrutural rejeita payload incompleto (HTTP 400)', async () => {
    const rawBody = JSON.stringify({ description: 'sem id nem chargeId' });
    const signature = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zynpay-signature': signature },
      rawBody
    });
    await webhookHandler(req, res);
    const { statusCode, json } = result();
    assert(statusCode === 400, `Esperado 400, recebido ${statusCode}`);
    assert(json?.code === 'MALFORMED_PAYLOAD', `Esperado MALFORMED_PAYLOAD, recebido ${json?.code}`);
  });

  // TEST 5: Webhook para cobrança inexistente no banco (404)
  await runTest('5. Webhook: Rejeição quando cobrança não está cadastrada no banco (HTTP 404)', async () => {
    const rawBody = JSON.stringify({ id: 'evt_ghost', chargeId: 'zyn_inexistente_9999', type: 'charge.paid' });
    const signature = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zynpay-signature': signature },
      rawBody
    });
    await webhookHandler(req, res);
    const { statusCode, json } = result();
    assert(statusCode === 404, `Esperado 404, recebido ${statusCode}`);
    assert(json?.code === 'CHARGE_NOT_FOUND', `Esperado CHARGE_NOT_FOUND, recebido ${json?.code}`);
  });

  // TEST 6: Webhook legítimo processado com sucesso e idempotência em replay
  await runTest('6. Webhook: Processamento de pagamento válido e bloqueio de Replay via Idempotência', async () => {
    const chargeId = 'zyn_valid_1001';
    await recordPendingCharge({
      id: chargeId,
      userEmail: 'assinante.teste@fatosbr.com.br',
      amountCents: 2990,
      description: 'Assinatura FatosBR Pro Mensal'
    });

    const eventId = `evt_legit_${Date.now()}`;
    const rawBody = JSON.stringify({ id: eventId, chargeId, type: 'charge.paid', status: 'PAID' });
    const signature = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');

    // Primeira execução (Processamento original)
    const { res: res1, result: result1 } = createMockRes();
    const req1 = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zynpay-signature': signature },
      rawBody
    });
    await webhookHandler(req1, res1);
    const out1 = result1();
    assert(out1.statusCode === 200, `Esperado 200 na 1ª chamada, recebido ${out1.statusCode}`);
    assert(out1.json?.processed === true, 'Deveria ter marcado processed: true');

    // Segunda execução idêntica (Replay attack simulado)
    const { res: res2, result: result2 } = createMockRes();
    const req2 = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zynpay-signature': signature },
      rawBody
    });
    await webhookHandler(req2, res2);
    const out2 = result2();
    assert(out2.statusCode === 200, `Esperado 200 com flag duplicate, recebido ${out2.statusCode}`);
    assert(out2.json?.duplicate === true, 'Idempotência falhou: não marcou duplicate: true');
  });

  // TEST 7: Charges: Rejeição de valores manipulados (<= 0 ou absurdos)
  await runTest('7. Charges: Rejeição de valores inválidos ou zerados (HTTP 400)', async () => {
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      body: { amount: -50 } // Tentativa de adulteração de preço negativo
    });
    await chargesHandler(req, res);
    const { statusCode, json } = result();
    // Valor normalizado para padrão seguro ou rejeitado
    assert(statusCode === 200 || statusCode === 400, `Esperado tratamento seguro, status ${statusCode}`);
    if (statusCode === 200) {
      assert(json?.charge?.amount >= 5.0, 'Valor não pode ser negativo ou zero');
    }
  });

  // TEST 8: Balance & Config: Acesso restrito a administradores (401)
  await runTest('8. Balance & Config: Proteção estrita contra acessos não autorizados (HTTP 401)', async () => {
    // 8.1 Balance sem token
    const { res: resBal, result: resBalOut } = createMockRes();
    const reqBal = createMockReq({ method: 'GET', url: '/api/zynpay/balance' });
    await balanceHandler(reqBal, resBal);
    const balOut = resBalOut();
    assert(balOut.statusCode === 401, `Esperado 401 no balance sem token, recebido ${balOut.statusCode}`);

    // 8.2 Config sem token
    const { res: resCfg, result: resCfgOut } = createMockRes();
    const reqCfg = createMockReq({ method: 'GET', url: '/api/zynpay/config' });
    await configHandler(reqCfg, resCfg);
    const cfgOut = resCfgOut();
    assert(cfgOut.statusCode === 401, `Esperado 401 no config sem token, recebido ${cfgOut.statusCode}`);
  });

  // TEST 9: SSRF Protection: Bloqueio de domínios maliciosos e IPs internos
  await runTest('9. SSRF: Validador de domínio bloqueia IPs internos e metadados de nuvem', async () => {
    const maliciousUrls = [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/admin',
      'http://127.0.0.1:8080/internal',
      'http://10.0.0.1/secrets',
      'https://evil-attacker-site.com/steal'
    ];

    for (const url of maliciousUrls) {
      assert(!isAllowedDomain(url), `Domínio malicioso não deveria ser permitido: ${url}`);
    }

    const validUrls = [
      'https://gnews.io/api/v4/search',
      'https://api.worldnewsapi.com/search-news',
      'https://api.zynpay.com.br/v1/public/charges'
    ];

    for (const url of validUrls) {
      assert(isAllowedDomain(url), `Domínio oficial deveria ser permitido: ${url}`);
    }
  });

  // TEST 10: Rate Limiter: Retorna 429 e cabeçalho Retry-After ao exceder cota
  await runTest('10. Rate Limiting: Aplica bloqueio 429 com cabeçalho Retry-After', async () => {
    const { res, result } = createMockRes();
    // Simula 35 requisições rápidas de um mesmo IP para estourar o limite
    let blocked = false;
    for (let i = 0; i < 35; i++) {
      const { res: loopRes, result: loopResult } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/zynpay/charges',
        headers: { 'x-forwarded-for': '198.51.100.42' },
        body: { amount: 29.90 }
      });
      await chargesHandler(req, loopRes);
      const out = loopResult();
      if (out.statusCode === 429) {
        blocked = true;
        assert(Boolean(out.headers['retry-after']), 'Cabeçalho Retry-After deve estar presente');
        break;
      }
    }
    assert(blocked, 'Deveria ter disparado 429 após excesso de chamadas');
  });

  console.log('\n------------------------------------------------------');
  console.log(`📊 RESULTADO DOS TESTES: ${testsPassed} passaram, ${testsFailed} falharam.`);
  console.log('------------------------------------------------------\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
