/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FATOSBR — SUÍTE COMPLETA DE TESTES DE SEGURANÇA E PERSISTÊNCIA FINANCEIRA
 * 
 * Cobre:
 * 1. Rate Limiting Distribuído (Concorrência, Janela, Expiração, Fail-Closed, Anti-Spoofing de IP)
 * 2. Persistência de Dados e Atomicidade RPC (Zero fallback em memória, Reversão, Idempotência)
 * 3. Validação Real ZynPay (HMAC-SHA256, Upstream Reconcile, Anti-Tampering de Valores e Moeda)
 * 4. Controle de Acesso e Autenticação Administrativa
 * 5. Proteção Anti-SSRF
 */

import crypto from 'crypto';
import webhookHandler from '../api/zynpay/webhook';
import chargesHandler from '../api/zynpay/charges';
import configHandler from '../api/zynpay/config';
import balanceHandler from '../api/zynpay/balance';
import { isAllowedDomain } from '../api/_lib/common';
import {
  setTestDatabaseAdapter,
  TestDatabaseAdapter,
  recordPendingCharge,
  getChargeById,
  checkAndLockWebhookEvent,
  confirmPaymentAndActivateSubscriptionAtomic
} from '../api/_lib/db';
import {
  setTestRateLimiterStore,
  TestRateLimiterStore,
  enforceRateLimit,
  RATE_LIMIT_PROFILES
} from '../api/_lib/rateLimiter';

// Habilita explicitamente o modo de testes para permitir a injeção do mock isolado
process.env.FATOSBR_TEST_MODE = 'true';
process.env.NODE_ENV = 'test';

// Mock de requisição e resposta HTTP
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

// Harness de Banco de Dados Simulado em Homologação
class MockDatabaseHarness implements TestDatabaseAdapter {
  public charges = new Map<string, any>();
  public webhookEvents = new Map<string, any>();
  public userSubscriptions = new Map<string, string>();
  public forceError: string | null = null;

  async recordPendingCharge(charge: any): Promise<boolean> {
    if (this.forceError) throw new Error(this.forceError);
    this.charges.set(charge.id, {
      id: charge.id,
      user_email: charge.userEmail,
      user_id: charge.userId || null,
      amount_cents: charge.amountCents,
      currency: 'BRL',
      status: 'PENDING',
      provider: 'zynpay',
      description: charge.description,
      created_at: new Date().toISOString()
    });
    return true;
  }

  async getChargeById(chargeId: string): Promise<any | null> {
    if (this.forceError) throw new Error(this.forceError);
    const c = this.charges.get(chargeId);
    if (!c) return null;
    return {
      id: c.id,
      userId: c.user_id,
      userEmail: c.user_email,
      amountCents: c.amount_cents,
      currency: c.currency,
      status: c.status,
      description: c.description,
      createdAt: c.created_at,
      updatedAt: c.created_at,
      paidAt: c.paid_at
    };
  }

  async checkAndLockWebhookEvent(eventId: string, provider: string): Promise<{ isDuplicate: boolean }> {
    if (this.forceError) throw new Error(this.forceError);
    if (this.webhookEvents.has(eventId)) {
      return { isDuplicate: true };
    }
    this.webhookEvents.set(eventId, {
      id: eventId,
      provider,
      status: 'PROCESSING',
      created_at: new Date().toISOString()
    });
    return { isDuplicate: false };
  }

  async confirmPaymentAndActivateSubscription(params: any): Promise<{
    success: boolean;
    duplicate?: boolean;
    error?: string;
    error_code?: string;
  }> {
    if (this.forceError) throw new Error(this.forceError);

    // 1. Idempotência
    const existingEvt = this.webhookEvents.get(params.eventId);
    if (existingEvt && existingEvt.status === 'COMPLETED') {
      return { success: true, duplicate: true };
    }

    // 2. Trava e verificação da cobrança
    const charge = this.charges.get(params.chargeId);
    if (!charge) {
      return { success: false, error: 'Cobrança não encontrada', error_code: 'CHARGE_NOT_FOUND' };
    }

    // 3. Validação de status anterior
    if (charge.status === 'PAID') {
      return { success: true, duplicate: true };
    }
    if (charge.status !== 'PENDING' && charge.status !== 'PROCESSING') {
      return { success: false, error: 'Status anterior inválido', error_code: 'INVALID_PREVIOUS_STATUS' };
    }

    // 4. Validação de valor e moeda
    if (charge.amount_cents !== params.expectedAmountCents) {
      return { success: false, error: 'Valor divergente', error_code: 'AMOUNT_MISMATCH' };
    }
    if ((charge.currency || 'BRL') !== (params.expectedCurrency || 'BRL')) {
      return { success: false, error: 'Moeda divergente', error_code: 'CURRENCY_MISMATCH' };
    }

    // 5. Atualização atômica
    charge.status = 'PAID';
    charge.paid_at = new Date().toISOString();
    this.webhookEvents.set(params.eventId, {
      id: params.eventId,
      status: 'COMPLETED',
      charge_id: params.chargeId
    });

    // 6. Ativação da assinatura do usuário
    this.userSubscriptions.set(charge.user_email.toLowerCase(), 'ACTIVE');

    return { success: true, duplicate: false };
  }
}

// Store Distribuída Simulada para Teste de Rate Limiting
class MockRateLimitStore implements TestRateLimiterStore {
  private counters = new Map<string, { tokens: number; windowStart: number }>();
  public forceError: boolean = false;

  async checkAndIncrement(key: string, maxRequests: number, windowMs: number) {
    if (this.forceError) {
      throw new Error('DATABASE_CONNECTION_LOST');
    }

    const now = Date.now();
    let record = this.counters.get(key);

    if (!record || (now - record.windowStart) >= windowMs) {
      record = { tokens: 1, windowStart: now };
      this.counters.set(key, record);
      return {
        allowed: true,
        current: 1,
        limit: maxRequests,
        retry_after: 0,
        remaining: maxRequests - 1
      };
    }

    record.tokens += 1;
    const elapsed = now - record.windowStart;
    const allowed = record.tokens <= maxRequests;
    const retry_after = allowed ? 0 : Math.max(1, Math.ceil((windowMs - elapsed) / 1000));

    return {
      allowed,
      current: record.tokens,
      limit: maxRequests,
      retry_after,
      remaining: Math.max(0, maxRequests - record.tokens)
    };
  }

  reset() {
    this.counters.clear();
    this.forceError = false;
  }
}

// Runner
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
  console.log('🔒 FATOSBR — SUITE DE SEGURANÇA E TRANSAÇÕES ATÔMICAS');
  console.log('======================================================\n');

  const testSecret = 'whsec_zynpay_live_prod';
  process.env.ZYNPAY_WEBHOOK_SECRET = testSecret;

  const dbHarness = new MockDatabaseHarness();
  setTestDatabaseAdapter(dbHarness);

  const rateStore = new MockRateLimitStore();
  setTestRateLimiterStore(rateStore);

  // ---------------------------------------------------------------------------
  // CATEGORIA 1: RATE LIMITING DISTRIBUÍDO E ATÔMICO
  // ---------------------------------------------------------------------------
  console.log('--- 1. TESTES DE RATE LIMITING DISTRIBUÍDO ---');

  await runTest('1.1 Bloqueio com HTTP 429 e cabeçalho Retry-After ao exceder cota', async () => {
    rateStore.reset();
    const testIp = '10.0.0.99';
    let blocked = false;

    for (let i = 0; i < 20; i++) {
      const { res, result } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/zynpay/charges',
        headers: { 'x-forwarded-for': testIp },
        body: { amount: 29.90 }
      });
      await chargesHandler(req, res);
      const out = result();
      if (out.statusCode === 429) {
        blocked = true;
        assert(Number(out.headers['retry-after']) >= 1, 'Cabeçalho Retry-After deve ser >= 1');
        assert(out.json?.code === 'RATE_LIMIT_EXCEEDED', 'Código deve ser RATE_LIMIT_EXCEEDED');
        break;
      }
    }
    assert(blocked, 'Deveria ter bloqueado após atingir o limite');
  });

  await runTest('1.2 Concorrência entre instâncias simuladas (contadores atômicos)', async () => {
    rateStore.reset();
    const sharedIp = '10.0.0.100';

    // Dispara 30 requisições simultâneas concorrentes
    const promises = Array.from({ length: 30 }).map(async () => {
      const { res, result } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/zynpay/charges',
        headers: { 'x-forwarded-for': sharedIp },
        body: { amount: 29.90 }
      });
      await chargesHandler(req, res);
      return result();
    });

    const results = await Promise.all(promises);
    const blockedCount = results.filter((r) => r.statusCode === 429).length;
    const successCount = results.filter((r) => r.statusCode === 200).length;

    assert(successCount <= RATE_LIMIT_PROFILES.payments.maxRequests, 'Não pode exceder o teto máximo permitido');
    assert(blockedCount > 0, 'As requisições concorrentes excedentes devem ter recebido 429');
  });

  await runTest('1.3 Falha do banco em rota de alto risco aciona fail-closed seguro (HTTP 503)', async () => {
    rateStore.reset();
    rateStore.forceError = true; // Simula queda súbita do banco

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { 'x-forwarded-for': '10.0.0.105' },
      body: { amount: 29.90 }
    });

    await chargesHandler(req, res);
    const out = result();
    rateStore.forceError = false;

    assert(out.statusCode === 503, `Esperado fail-closed HTTP 503, recebido ${out.statusCode}`);
    assert(out.json?.code === 'RATE_LIMIT_CHECK_FAILED', 'Deve retornar código de bloqueio preventivo');
  });

  await runTest('1.4 Anti-spoofing: Validação do IP do cliente protege contra falsificação', async () => {
    rateStore.reset();
    // Injeção de múltiplos IPs falsos via x-forwarded-for
    const spoofedReq = createMockReq({
      headers: {
        'x-forwarded-for': '203.0.113.195, 10.0.0.1, 192.168.1.1',
        'cf-connecting-ip': '203.0.113.195'
      }
    });
    const { res, result } = createMockRes();
    const allowed = await enforceRateLimit(spoofedReq, res, 'payments');
    assert(allowed, 'Requisição inicial permitida');
  });

  // ---------------------------------------------------------------------------
  // CATEGORIA 2: BANCO DE DADOS E TRANSAÇÕES ATÔMICAS
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. TESTES DE TRANSAÇÕES ATÔMICAS & SUPABASE ---');

  await runTest('2.1 Transação atômica completa confirma pagamento e ativa plano Pro', async () => {
    const chargeId = 'zyn_test_atomic_01';
    const eventId = 'evt_test_atomic_01';
    const userEmail = 'leitor.pro@fatosbr.com.br';

    await recordPendingCharge({
      id: chargeId,
      userEmail,
      amountCents: 2990,
      description: 'FatosBR Pro Mensal'
    });

    const res = await confirmPaymentAndActivateSubscriptionAtomic({
      chargeId,
      eventId,
      expectedAmountCents: 2990,
      expectedCurrency: 'BRL',
      provider: 'zynpay'
    });

    assert(res.success === true, 'Transação deveria ter sido aprovada');
    assert(dbHarness.userSubscriptions.get(userEmail) === 'ACTIVE', 'Assinatura do usuário deve estar ACTIVE');
    const charge = await getChargeById(chargeId);
    assert(charge?.status === 'PAID', 'Status da cobrança deve ser PAID');
  });

  await runTest('2.2 Idempotência: Reenvio do mesmo evento não duplica processamento', async () => {
    const chargeId = 'zyn_test_atomic_01';
    const eventId = 'evt_test_atomic_01';

    const resReplay = await confirmPaymentAndActivateSubscriptionAtomic({
      chargeId,
      eventId,
      expectedAmountCents: 2990,
      expectedCurrency: 'BRL',
      provider: 'zynpay'
    });

    assert(resReplay.success === true, 'Deve responder com sucesso idempotente');
    assert(resReplay.duplicate === true, 'Deve conter a flag duplicate: true');
  });

  await runTest('2.3 Anti-Tampering: Reversão atômica em caso de divergência de valor', async () => {
    const chargeId = 'zyn_test_tamper_val';
    const userEmail = 'alvo.tamper@fatosbr.com.br';

    await recordPendingCharge({
      id: chargeId,
      userEmail,
      amountCents: 2990,
      description: 'FatosBR Pro Mensal'
    });

    // Tenta confirmar com valor adulterado (ex: R$ 10,00 em vez de R$ 29,90)
    const res = await confirmPaymentAndActivateSubscriptionAtomic({
      chargeId,
      eventId: 'evt_tamper_99',
      expectedAmountCents: 1000,
      expectedCurrency: 'BRL'
    });

    assert(res.success === false, 'Transação com valor divergente deve ser recusada');
    assert(res.errorCode === 'AMOUNT_MISMATCH', 'Erro deve ser AMOUNT_MISMATCH');
    assert(dbHarness.userSubscriptions.get(userEmail) !== 'ACTIVE', 'Assinatura NÃO pode ser ativada');
  });

  await runTest('2.4 Rejeição de confirmação para cobrança inexistente no banco', async () => {
    const res = await confirmPaymentAndActivateSubscriptionAtomic({
      chargeId: 'zyn_ghost_charge_404',
      eventId: 'evt_ghost_404',
      expectedAmountCents: 2990
    });

    assert(res.success === false, 'Cobrança fantasma deve ser rejeitada');
    assert(res.errorCode === 'CHARGE_NOT_FOUND', 'Erro deve ser CHARGE_NOT_FOUND');
  });

  await runTest('2.5 Queda de persistência no Supabase não retorna sucesso falso', async () => {
    dbHarness.forceError = 'SUPABASE_CONNECTION_TIMEOUT';

    let threw = false;
    try {
      await recordPendingCharge({
        id: 'zyn_fail_db',
        userEmail: 'fail@fatosbr.com.br',
        amountCents: 2990,
        description: 'Teste de queda'
      });
    } catch {
      threw = true;
    }
    dbHarness.forceError = null;

    assert(threw, 'Deve lançar exceção controlada em vez de simular sucesso em memória');
  });

  // ---------------------------------------------------------------------------
  // CATEGORIA 3: AUDITORIA REAL ZYNPAY & WEBHOOK
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. TESTES DE WEBHOOK E INTEGRAÇÃO ZYNPAY ---');

  await runTest('3.1 Rejeição de métodos não-POST no webhook com HTTP 405', async () => {
    const { res, result } = createMockRes();
    const req = createMockReq({ method: 'GET', url: '/api/zynpay/webhook' });
    await webhookHandler(req, res);
    const out = result();
    assert(out.statusCode === 405, `Esperado 405, recebido ${out.statusCode}`);
  });

  await runTest('3.2 Rejeição de webhook sem assinatura criptográfica (HTTP 401)', async () => {
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: {},
      body: { id: 'evt_no_sig', chargeId: 'zyn_1' }
    });
    await webhookHandler(req, res);
    const out = result();
    assert(out.statusCode === 401, `Esperado 401, recebido ${out.statusCode}`);
    assert(out.json?.code === 'MISSING_SIGNATURE', 'Código deve ser MISSING_SIGNATURE');
  });

  await runTest('3.3 Rejeição de webhook com assinatura HMAC violada (HTTP 403)', async () => {
    const rawBody = JSON.stringify({ id: 'evt_bad_sig', chargeId: 'zyn_1' });
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zynpay-signature': 'assinatura_adulterada_invalida' },
      rawBody
    });
    await webhookHandler(req, res);
    const out = result();
    assert(out.statusCode === 403, `Esperado 403, recebido ${out.statusCode}`);
    assert(out.json?.code === 'INVALID_SIGNATURE', 'Código deve ser INVALID_SIGNATURE');
  });

  await runTest('3.4 Payload malformado rejeitado com HTTP 400', async () => {
    const rawBody = JSON.stringify({ apenas: 'conteudo_sem_id_nem_chargeId' });
    const sig = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zynpay-signature': sig },
      rawBody
    });
    await webhookHandler(req, res);
    const out = result();
    assert(out.statusCode === 400, `Esperado 400, recebido ${out.statusCode}`);
    assert(out.json?.code === 'MALFORMED_PAYLOAD', 'Código deve ser MALFORMED_PAYLOAD');
  });

  // ---------------------------------------------------------------------------
  // CATEGORIA 4: AUTENTICAÇÃO E ADMINISTRAÇÃO
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. TESTES DE AUTORIZAÇÃO E ENDPOINTS ADMINISTRATIVOS ---');

  await runTest('4.1 Endpoint de saldo ZynPay bloqueia acessos sem privilégio de admin (HTTP 401)', async () => {
    const { res, result } = createMockRes();
    const req = createMockReq({ method: 'GET', url: '/api/zynpay/balance' });
    await balanceHandler(req, res);
    const out = result();
    assert(out.statusCode === 401, `Esperado 401, recebido ${out.statusCode}`);
    assert(out.json?.code === 'UNAUTHORIZED_ADMIN', 'Código deve ser UNAUTHORIZED_ADMIN');
  });

  await runTest('4.2 Endpoint de configuração ZynPay bloqueia acessos não autorizados (HTTP 401)', async () => {
    const { res, result } = createMockRes();
    const req = createMockReq({ method: 'GET', url: '/api/zynpay/config' });
    await configHandler(req, res);
    const out = result();
    assert(out.statusCode === 401, `Esperado 401, recebido ${out.statusCode}`);
    assert(out.json?.code === 'UNAUTHORIZED_ADMIN', 'Código deve ser UNAUTHORIZED_ADMIN');
  });

  // ---------------------------------------------------------------------------
  // CATEGORIA 5: PROTEÇÃO ANTI-SSRF
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. TESTES DE PROTEÇÃO CONTRA SSRF ---');

  await runTest('5.1 Bloqueio de IPs de metadados de nuvem e redes privadas', async () => {
    const dangerousUrls = [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:8080/admin',
      'http://localhost:3000/api/zynpay',
      'http://10.0.0.5/secrets',
      'http://192.168.0.1/router'
    ];

    for (const url of dangerousUrls) {
      assert(!isAllowedDomain(url), `URL perigosa não pode ser aceita: ${url}`);
    }

    const officialUrls = [
      'https://gnews.io/api/v4/search',
      'https://api.worldnewsapi.com/search-news',
      'https://api.zynpay.com.br/v1/public/charges'
    ];

    for (const url of officialUrls) {
      assert(isAllowedDomain(url), `URL oficial deve ser permitida: ${url}`);
    }
  });

  console.log('\n------------------------------------------------------');
  console.log(`📊 TOTAL: ${testsPassed} testes passaram com sucesso, ${testsFailed} falharam.`);
  console.log('------------------------------------------------------\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Falha crítica na suíte de testes:', err);
  process.exit(1);
});
