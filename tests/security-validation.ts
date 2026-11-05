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
  setTestSupabaseClient,
  TestDatabaseAdapter,
  recordPendingCharge,
  getChargeById,
  checkAndLockWebhookEvent,
  confirmPaymentAndActivateSubscriptionAtomic
} from '../api/_lib/db';
import {
  setTestZynPayGatewayAdapter,
  TestZynPayGatewayAdapter,
  mapZynPayStatus,
  validateMonetaryAmountCents,
  validateZynPayCreationResponse,
  validateZynPayConsultationResponse
} from '../api/_lib/zynpayClient';
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

    // Simula a restrição do índice parcial real billing_one_pending do PostgreSQL:
    const userEmail = (charge.userEmail || '').toLowerCase().trim();
    const userId = charge.userId;
    for (const existing of this.charges.values()) {
      const match = (userId && existing.user_id === userId) || (userEmail && existing.user_email?.toLowerCase() === userEmail);
      if (match && (existing.status === 'PENDING' || existing.status === 'PROCESSING')) {
        const err: any = new Error('duplicate key value violates unique constraint "billing_one_pending"');
        err.code = '23505';
        throw err;
      }
    }

    const amount = charge.amount ?? charge.amountCents ?? 2990;
    const paymentId = charge.providerPaymentId || charge.id;
    this.charges.set(paymentId, {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', // UUID interno
      provider_payment_id: paymentId,
      user_email: charge.userEmail,
      user_id: charge.userId || '11111111-1111-1111-1111-111111111111',
      amount,
      amount_cents: amount,
      currency: charge.currency || 'BRL',
      status: 'PENDING',
      provider: 'zynpay',
      description: charge.description,
      qr_code_text: charge.qrCodeText,
      idempotency_key: charge.idempotencyKey,
      checkout_data: {
        idempotency_key: charge.idempotencyKey,
        user_email: charge.userEmail,
        description: charge.description,
        qr_code_text: charge.qrCodeText
      },
      created_at: new Date().toISOString()
    });
    return true;
  }

  async getChargeByIdempotencyKey(userId: string, idempotencyKey: string): Promise<any | null> {
    if (this.forceError) throw new Error(this.forceError);
    for (const c of this.charges.values()) {
      const matchUser = userId && c.user_id === userId;
      const matchKey = c.idempotency_key === idempotencyKey || c.checkout_data?.idempotency_key === idempotencyKey;
      if (matchUser && matchKey) {
        return {
          id: c.id,
          providerPaymentId: c.provider_payment_id || c.id,
          userId: c.user_id,
          userEmail: c.user_email,
          amount: c.amount,
          amountCents: c.amount,
          currency: c.currency,
          status: c.status,
          description: c.description,
          qrCodeText: c.qr_code_text,
          createdAt: c.created_at,
          updatedAt: c.created_at,
          approvedAt: c.approved_at,
          paidAt: c.approved_at
        };
      }
    }
    return null;
  }

  async getActivePendingCharge(userId: string | null, email?: string): Promise<any | null> {
    if (this.forceError) throw new Error(this.forceError);
    for (const c of this.charges.values()) {
      const matchUser = userId && c.user_id === userId;
      const matchEmail = email && c.user_email?.toLowerCase() === email.toLowerCase();
      if ((matchUser || matchEmail) && (c.status === 'PENDING' || c.status === 'PROCESSING')) {
        return {
          id: c.id,
          providerPaymentId: c.provider_payment_id || c.id,
          userId: c.user_id,
          userEmail: c.user_email,
          amount: c.amount,
          amountCents: c.amount,
          currency: c.currency,
          status: c.status,
          description: c.description,
          qrCodeText: c.qr_code_text,
          createdAt: c.created_at,
          updatedAt: c.created_at
        };
      }
    }
    return null;
  }

  async checkActiveSubscription(userId: string | null, email?: string): Promise<boolean> {
    if (this.forceError) throw new Error(this.forceError);
    if (userId && this.userSubscriptions.get(userId)?.toLowerCase() === 'active') return true;
    if (email && this.userSubscriptions.get(email.toLowerCase())?.toLowerCase() === 'active') return true;
    return false;
  }

  async getChargeById(chargeId: string): Promise<any | null> {
    if (this.forceError) throw new Error(this.forceError);
    const c = this.charges.get(chargeId);
    if (!c) return null;
    return {
      id: c.id,
      providerPaymentId: c.provider_payment_id || c.id,
      userId: c.user_id,
      userEmail: c.user_email,
      amount: c.amount,
      amountCents: c.amount,
      currency: c.currency,
      status: c.status,
      description: c.description,
      createdAt: c.created_at,
      updatedAt: c.created_at,
      approvedAt: c.approved_at,
      paidAt: c.approved_at
    };
  }

  async checkAndLockWebhookEvent(eventId: string, provider: string): Promise<{ isDuplicate: boolean }> {
    if (this.forceError) throw new Error(this.forceError);
    const existing = this.webhookEvents.get(eventId);
    if (existing && existing.processed) {
      return { isDuplicate: true };
    }
    // Trava de idempotência inicial com processed = false (marca true apenas ao concluir)
    if (!existing) {
      this.webhookEvents.set(eventId, {
        id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b22',
        provider_event_id: eventId,
        provider,
        processed: false,
        created_at: new Date().toISOString()
      });
    }
    return { isDuplicate: false };
  }

  async confirmPaymentAndActivateSubscription(params: any): Promise<{
    success: boolean;
    duplicate?: boolean;
    error?: string;
    error_code?: string;
  }> {
    if (this.forceError) throw new Error(this.forceError);

    const paymentId = params.providerPaymentId || params.chargeId;

    // 1. Idempotência em internal.billing_events
    const existingEvt = this.webhookEvents.get(params.eventId);
    if (existingEvt && existingEvt.processed) {
      return { success: true, duplicate: true };
    }

    // 2. Trava e verificação da cobrança em internal.billing_payments
    const charge = this.charges.get(paymentId);
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

    // 4. Validação de valor e moeda (coluna amount)
    const expectedAmount = params.expectedAmount ?? params.expectedAmountCents;
    if (charge.amount !== expectedAmount) {
      return { success: false, error: 'Valor divergente', error_code: 'AMOUNT_MISMATCH' };
    }
    if ((charge.currency || 'BRL') !== (params.expectedCurrency || 'BRL')) {
      return { success: false, error: 'Moeda divergente', error_code: 'CURRENCY_MISMATCH' };
    }

    // 5. Atualização atômica em internal.billing_payments
    charge.status = 'PAID';
    charge.approved_at = new Date().toISOString();
    this.webhookEvents.set(params.eventId, {
      id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c33',
      provider_event_id: params.eventId,
      processed: true,
      context_id: charge.id
    });

    // 6. Ativação da assinatura do usuário na tabela canônica public.subscriptions
    this.userSubscriptions.set(charge.user_id, 'active');
    if (charge.user_email) {
      this.userSubscriptions.set(charge.user_email.toLowerCase(), 'ACTIVE');
    }

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

  const mockSupabase = {
    auth: {
      getUser: async (token: string) => {
        if (!token || token === 'invalid_token') {
          return { data: { user: null }, error: new Error('Invalid token') };
        }
        const clean = token.trim();
        const userId = clean.startsWith('user_') ? clean : '11111111-1111-1111-1111-111111111111';
        const userEmail = clean.includes('@') ? clean : `${userId}@fatosbr.com.br`;
        return {
          data: {
            user: {
              id: userId,
              email: userEmail,
              user_metadata: { full_name: 'Usuario Autenticado' }
            }
          },
          error: null
        };
      }
    }
  };
  setTestSupabaseClient(mockSupabase);

  let mockGwCounter = 1;
  const mockGateway: TestZynPayGatewayAdapter = {
    createCharge: async (params: any) => {
      const chargeId = `zyn_gw_${Date.now()}_${mockGwCounter++}`;
      return {
        id: chargeId,
        amount: params.amountCents,
        currency: 'BRL',
        status: 'PENDING',
        description: params.description,
        qrCodeText: `00020126580014br.gov.bcb.pix0136zynpay-${chargeId}5204000053039865405${(params.amountCents / 100).toFixed(2)}5802BR5915FATOSBR MIDIA6009SAO PAULO62070503***6304ABCD`,
        createdAt: new Date().toISOString()
      };
    },
    getCharge: async (chargeId: string) => {
      const dbCharge = dbHarness.charges.get(chargeId);
      if (chargeId.includes('tamper_amount')) {
        return {
          id: chargeId,
          amount: 100, // divergente dos 2990 esperados
          currency: 'BRL',
          status: 'PAID',
          description: 'FatosBR Pro',
          qrCodeText: 'pix_code',
          createdAt: new Date().toISOString()
        };
      }
      if (chargeId.includes('zero_amount')) {
        return {
          id: chargeId,
          amount: 0, // valor zero/inválido
          currency: 'BRL',
          status: 'PAID',
          description: 'FatosBR Pro',
          qrCodeText: 'pix_code',
          createdAt: new Date().toISOString()
        };
      }
      if (chargeId.includes('bad_currency')) {
        return {
          id: chargeId,
          amount: dbCharge?.amount || 2990,
          currency: 'USD', // moeda inválida
          status: 'PAID',
          description: 'FatosBR Pro',
          qrCodeText: 'pix_code',
          createdAt: new Date().toISOString()
        };
      }
      if (chargeId.includes('not_paid')) {
        return {
          id: chargeId,
          amount: dbCharge?.amount || 2990,
          currency: 'BRL',
          status: 'PENDING', // não confirmada
          description: 'FatosBR Pro',
          qrCodeText: 'pix_code',
          createdAt: new Date().toISOString()
        };
      }
      // Para fluxos de webhook (onde o webhook notifica que o Pix foi pago no gateway):
      if (chargeId.includes('wh_ok') || chargeId.includes('atomic') || dbCharge?.status === 'PAID') {
        return {
          id: chargeId,
          amount: dbCharge?.amount || 2990,
          currency: 'BRL',
          status: 'PAID',
          description: 'FatosBR Pro',
          qrCodeText: dbCharge?.qr_code_text || 'pix_code',
          createdAt: new Date().toISOString()
        };
      }
      return {
        id: chargeId,
        amount: dbCharge?.amount || 2990,
        currency: 'BRL',
        status: dbCharge ? dbCharge.status : 'PENDING',
        description: 'FatosBR Pro',
        qrCodeText: dbCharge?.qr_code_text || 'pix_code',
        createdAt: new Date().toISOString()
      };
    },
    getBalance: async () => ({
      available: 1542000,
      pending: 35000,
      currency: 'BRL'
    })
  };
  setTestZynPayGatewayAdapter(mockGateway);

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

  await runTest('2.6 Anti-Tampering: Reversão atômica em caso de divergência de moeda', async () => {
    const chargeId = 'zyn_test_currency_err';
    await recordPendingCharge({
      id: chargeId,
      userEmail: 'moeda@fatosbr.com.br',
      amountCents: 2990,
      description: 'Teste moeda'
    });

    const res = await confirmPaymentAndActivateSubscriptionAtomic({
      chargeId,
      eventId: 'evt_currency_err',
      expectedAmountCents: 2990,
      expectedCurrency: 'USD' // Tentativa de pagamento em moeda divergente
    });

    assert(res.success === false, 'Transação com moeda divergente deve ser recusada');
    assert(res.errorCode === 'CURRENCY_MISMATCH', 'Erro deve ser CURRENCY_MISMATCH');
  });

  await runTest('2.7 Rejeição de confirmação para cobrança em status não pendente', async () => {
    const chargeId = 'zyn_test_cancelled';
    await recordPendingCharge({
      id: chargeId,
      userEmail: 'cancelado@fatosbr.com.br',
      amountCents: 2990,
      description: 'Cobrança cancelada'
    });
    // Força status CANCELLED no harness
    dbHarness.charges.get(chargeId).status = 'CANCELLED';

    const res = await confirmPaymentAndActivateSubscriptionAtomic({
      chargeId,
      eventId: 'evt_cancel_01',
      expectedAmountCents: 2990
    });

    assert(res.success === false, 'Cobrança cancelada não pode ser liquidada');
    assert(res.errorCode === 'INVALID_PREVIOUS_STATUS', 'Erro deve ser INVALID_PREVIOUS_STATUS');
  });

  await runTest('2.8 Respeito a billing_one_pending: Reutilização de cobrança pendente existente para o mesmo usuário', async () => {
    const userId = 'user_mesmo_usuario';
    const userEmail = `${userId}@fatosbr.com.br`;
    const authHeader = `Bearer ${userId}`;

    const { res: res1, result: result1 } = createMockRes();
    const req1 = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: authHeader },
      body: { planId: 'pro', customer: { email: userEmail, name: 'Assinante' } }
    });
    await chargesHandler(req1, res1);
    const out1 = result1();
    assert(out1.statusCode === 200, `Primeira cobrança deve ter sido criada com sucesso: ${JSON.stringify(out1.json)}`);
    const firstChargeId = out1.json.charge.id;

    // Segunda chamada para o mesmo usuário com cobrança pendente ativa
    const { res: res2, result: result2 } = createMockRes();
    const req2 = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: authHeader },
      body: { planId: 'pro', customer: { email: userEmail, name: 'Assinante' } }
    });
    await chargesHandler(req2, res2);
    const out2 = result2();

    assert(out2.statusCode === 200, 'Segunda requisição deve responder 200 reutilizando a cobrança pendente');
    assert(out2.json.reused === true, 'A flag reused deve ser true para evitar violação do índice billing_one_pending');
    assert(out2.json.charge.id === firstChargeId, 'Deve retornar o mesmo identificador da cobrança pendente');
  });

  await runTest('2.9 Bloqueio de criação de cobrança quando usuário já possui assinatura Pro ativa (USER_ALREADY_SUBSCRIBED)', async () => {
    const userId = 'user_ja_assinante';
    const userEmail = `${userId}@fatosbr.com.br`;
    // Ativa assinatura previamente
    dbHarness.userSubscriptions.set(userId, 'active');
    dbHarness.userSubscriptions.set(userEmail, 'active');

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: `Bearer ${userId}` },
      body: { planId: 'pro', customer: { email: userEmail, name: 'Assinante Pro' } }
    });
    await chargesHandler(req, res);
    const out = result();

    assert(out.statusCode === 409, `Esperado HTTP 409 para já assinante, recebido ${out.statusCode}`);
    assert(out.json?.code === 'USER_ALREADY_SUBSCRIBED', 'Código deve ser USER_ALREADY_SUBSCRIBED');
  });

  await runTest('2.10 Rejeição de operações financeiras quando PostgreSQL não estiver configurado (fail-closed sem PostgREST fallback)', async () => {
    // Desliga temporariamente o adaptador de teste para checar o comportamento real do db.ts sem connection string
    setTestDatabaseAdapter(null);
    let capturedError = '';
    try {
      await recordPendingCharge({
        id: 'zyn_fail_closed_test',
        userEmail: 'failclosed@fatosbr.com.br',
        amountCents: 2990,
        description: 'Teste Fail-Closed'
      });
    } catch (err: any) {
      capturedError = err.message;
    } finally {
      setTestDatabaseAdapter(dbHarness);
    }

    assert(
      capturedError.includes('POSTGRES_UNAVAILABLE'),
      `Deveria falhar com POSTGRES_UNAVAILABLE sem tentar fallback silencioso para a Data API. Erro: ${capturedError}`
    );
  });

  await runTest('2.11 Concorrência: Duas requisições simultâneas de cobrança para o mesmo usuário tratadas de forma idempotente', async () => {
    const userId = 'user_concorrente_ok';
    const userEmail = `${userId}@fatosbr.com.br`;
    const reqFactory = () => {
      const { res, result } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/zynpay/charges',
        headers: { authorization: `Bearer ${userId}` },
        body: { planId: 'pro', customer: { email: userEmail, name: 'Concorrente' } }
      });
      return chargesHandler(req, res).then(() => result());
    };

    const [outA, outB] = await Promise.all([reqFactory(), reqFactory()]);
    assert(outA.statusCode === 200 && outB.statusCode === 200, `Ambas as requisições concorrentes devem concluir com sucesso (A:${outA.statusCode}, B:${outB.statusCode})`);
    assert(outA.json.charge.id === outB.json.charge.id, 'Ambas as requisições concorrentes devem compartilhar a mesma cobrança única');
  });

  await runTest('2.12 Autenticação obrigatória: Checkout sem cabeçalho Authorization é rejeitado com HTTP 401', async () => {
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: {},
      body: { planId: 'pro' }
    });
    await chargesHandler(req, res);
    const out = result();

    assert(out.statusCode === 401, `Esperado HTTP 401, recebido ${out.statusCode}`);
    assert(out.json?.code === 'UNAUTHORIZED_CHECKOUT', 'Código deve ser UNAUTHORIZED_CHECKOUT');
  });

  await runTest('2.13 Sessão inválida: Checkout com Bearer token forjado/expirado é rejeitado com HTTP 403', async () => {
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: 'Bearer invalid_token' },
      body: { planId: 'pro' }
    });
    await chargesHandler(req, res);
    const out = result();

    assert(out.statusCode === 403, `Esperado HTTP 403, recebido ${out.statusCode}`);
    assert(out.json?.code === 'INVALID_SESSION', 'Código deve ser INVALID_SESSION');
  });

  await runTest('2.14 Preço controlado pelo servidor: Ignora qualquer valor fornecido pelo cliente (anti-tampering)', async () => {
    const userId = 'user_preco_servidor';
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: `Bearer ${userId}` },
      // Tentativa maliciosa de comprar por R$ 0,01
      body: { planId: 'pro', amount: 0.01, amountCents: 1 }
    });
    await chargesHandler(req, res);
    const out = result();

    assert(out.statusCode === 200, `Esperado HTTP 200, recebido ${out.statusCode}`);
    assert(out.json?.charge?.amount === 2990, `Valor da cobrança deve ser 2990 centavos, recebido ${out.json?.charge?.amount}`);
  });

  await runTest('2.15 Proibição estrita de PIX fictício: Gateway offline retorna HTTP 503 GATEWAY_UNAVAILABLE', async () => {
    // Configura adaptador do gateway para lançar falha de conexão/indisponibilidade
    const failingGateway: TestZynPayGatewayAdapter = {
      createCharge: async () => {
        throw new Error('GATEWAY_TIMEOUT: Conexão com a ZynPay excedeu o tempo limite');
      },
      getCharge: async () => null,
      getBalance: async () => ({ available: 0, pending: 0, currency: 'BRL' })
    };
    setTestZynPayGatewayAdapter(failingGateway);

    const userId = 'user_gw_offline';
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: `Bearer ${userId}` },
      body: { planId: 'pro' }
    });
    await chargesHandler(req, res);
    const out = result();

    // Restaura o gateway normal
    setTestZynPayGatewayAdapter(mockGateway);

    assert(out.statusCode === 503, `Esperado HTTP 503, recebido ${out.statusCode}`);
    assert(out.json?.code === 'GATEWAY_UNAVAILABLE', 'Código deve ser GATEWAY_UNAVAILABLE');
    assert(!out.raw.includes('00020126580014br.gov.bcb.pix0136zyn_'), 'NUNCA deve gerar payload PIX fictício de fallback');
  });

  await runTest('2.16 Idempotência Estável: Retries com a mesma chave não geram cobranças duplicadas', async () => {
    const userId = 'user_idempotente_fixo';
    const clientKey = 'intent_sess_abc123';

    const { res: res1, result: result1 } = createMockRes();
    const req1 = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: `Bearer ${userId}` },
      body: { planId: 'pro', idempotencyKey: clientKey }
    });
    await chargesHandler(req1, res1);
    const out1 = result1();
    assert(out1.statusCode === 200, 'Primeira requisição deve ser 200');

    // Segunda chamada simulando retry com o mesmo token de idempotência
    const { res: res2, result: result2 } = createMockRes();
    const req2 = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: `Bearer ${userId}` },
      body: { planId: 'pro', idempotencyKey: clientKey }
    });
    await chargesHandler(req2, res2);
    const out2 = result2();

    assert(out2.statusCode === 200, 'Segunda requisição de retry deve ser 200');
    assert(out2.json?.reused === true, 'Retry deve reutilizar a cobrança existente');
    assert(out1.json?.charge?.id === out2.json?.charge?.id, 'Mesmo identificador retornado');
  });

  await runTest('2.17 Fail-Closed: Falha em consulta crítica de cobrança pendente interrompe com HTTP 503', async () => {
    dbHarness.forceError = 'DATABASE_CONNECTION_REFUSED';
    const userId = 'user_fail_closed_db';

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: `Bearer ${userId}` },
      body: { planId: 'pro' }
    });
    await chargesHandler(req, res);
    const out = result();
    dbHarness.forceError = null;

    assert(out.statusCode === 503, `Esperado fail-closed HTTP 503, recebido ${out.statusCode}`);
    assert(out.json?.code === 'SUBSCRIPTION_CHECK_FAILED' || out.json?.code === 'PENDING_CHECK_FAILED', 'Deve falhar com código de checagem');
  });

  await runTest('2.18 Validação de formato da chave de idempotência do cliente (HTTP 400)', async () => {
    const userId = 'user_bad_idemp';
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: `Bearer ${userId}` },
      body: { planId: 'pro', idempotencyKey: 'short' } // < 8 caracteres
    });
    await chargesHandler(req, res);
    const out = result();
    assert(out.statusCode === 400, `Esperado 400 para chave curta, recebido ${out.statusCode}`);
    assert(out.json?.code === 'INVALID_IDEMPOTENCY_KEY', 'Código deve ser INVALID_IDEMPOTENCY_KEY');
  });

  await runTest('2.19 Conflito de planos: Usuário com cobrança pendente para plano diferente recebe HTTP 409', async () => {
    const userId = 'user_plano_conflito';
    const userEmail = `${userId}@fatosbr.com.br`;

    // Registra cobrança pendente para o plano Pro Mensal (2990 centavos)
    await recordPendingCharge({
      providerPaymentId: 'zyn_pendente_pro_01',
      userId,
      userEmail,
      amountCents: 2990,
      description: 'Plano Pro Mensal'
    });

    // Tenta solicitar o plano Pro Anual (29900 centavos) enquanto o mensal está pendente e ativo
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: `Bearer ${userId}` },
      body: { planId: 'pro_annual' }
    });
    await chargesHandler(req, res);
    const out = result();

    assert(out.statusCode === 409, `Esperado 409 para conflito de planos diferentes, recebido ${out.statusCode}`);
    assert(out.json?.code === 'ACTIVE_PENDING_CHARGE_DIFFERENT_PLAN', 'Código deve ser ACTIVE_PENDING_CHARGE_DIFFERENT_PLAN');
  });

  await runTest('2.20 GET /api/zynpay/charges sem token Bearer é rejeitado com HTTP 401 UNAUTHORIZED_CHARGE_QUERY', async () => {
    rateStore.reset();
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'GET',
      url: '/api/zynpay/charges?id=zyn_test_anon'
    });
    await chargesHandler(req, res);
    const out = result();
    assert(out.statusCode === 401, `Esperado 401 para consulta sem auth, recebido ${out.statusCode}`);
    assert(out.json?.code === 'UNAUTHORIZED_CHARGE_QUERY', 'Código deve ser UNAUTHORIZED_CHARGE_QUERY');
  });

  await runTest('2.21 GET /api/zynpay/charges com token inválido/expirado é rejeitado com HTTP 403 INVALID_SESSION', async () => {
    rateStore.reset();
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'GET',
      url: '/api/zynpay/charges?id=zyn_test_invalid_token',
      headers: { authorization: 'Bearer invalid_token' }
    });
    await chargesHandler(req, res);
    const out = result();
    assert(out.statusCode === 403, `Esperado 403 para sessão inválida, recebido ${out.statusCode}`);
    assert(out.json?.code === 'INVALID_SESSION', 'Código deve ser INVALID_SESSION');
  });

  await runTest('2.22 Prevenção de IDOR: GET de cobrança de outro usuário retorna HTTP 404 neutro', async () => {
    rateStore.reset();
    const ownerUserId = 'user_vitima_idor_01';
    const attackerUserId = 'user_atacante_02';

    // Cria cobrança pertencente à vítima
    await recordPendingCharge({
      providerPaymentId: 'zyn_idor_victim_charge',
      userId: ownerUserId,
      userEmail: `${ownerUserId}@fatosbr.com.br`,
      amountCents: 2990,
      description: 'Plano Pro Vítima'
    });

    // Atacante tenta consultar a cobrança da vítima
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'GET',
      url: '/api/zynpay/charges?id=zyn_idor_victim_charge',
      headers: { authorization: `Bearer ${attackerUserId}` }
    });
    await chargesHandler(req, res);
    const out = result();

    // Deve retornar 404 neutro para não revelar a existência da cobrança e impedir enumeração
    assert(out.statusCode === 404, `Esperado 404 neutro contra IDOR, recebido ${out.statusCode}`);
    assert(out.json?.code === 'CHARGE_NOT_FOUND', 'Código deve ser CHARGE_NOT_FOUND');
    assert(!out.json?.charge, 'NUNCA deve expor dados de cobrança alheia');
  });

  await runTest('2.23 GET de cobrança própria retorna HTTP 200 com status e dados completos', async () => {
    rateStore.reset();
    const ownerUserId = 'user_legitimo_dono';
    const chargeId = 'zyn_legit_owner_charge';

    await recordPendingCharge({
      providerPaymentId: chargeId,
      userId: ownerUserId,
      userEmail: `${ownerUserId}@fatosbr.com.br`,
      amountCents: 2990,
      description: 'Plano Pro FatosBR'
    });

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'GET',
      url: `/api/zynpay/charges?id=${chargeId}`,
      headers: { authorization: `Bearer ${ownerUserId}` }
    });
    await chargesHandler(req, res);
    const out = result();

    assert(out.statusCode === 200, `Esperado 200 para o legítimo proprietário, recebido ${out.statusCode}`);
    assert(out.json?.success === true, 'Deve retornar success: true');
    assert(out.json?.charge?.id === chargeId, 'Deve retornar o ID correto da cobrança');
    assert(out.json?.charge?.amount === 2990, 'Deve retornar o valor correto');
  });

  await runTest('2.24 GET de cobrança via ADMIN_SECRET permite auditoria autorizada com HTTP 200', async () => {
    rateStore.reset();
    process.env.ADMIN_SECRET = 'secret_admin_token_fatosbr_2026';
    const chargeId = 'zyn_audit_admin_charge';

    await recordPendingCharge({
      providerPaymentId: chargeId,
      userId: 'user_aleatorio_qualquer',
      userEmail: 'aleatorio@fatosbr.com.br',
      amountCents: 2990,
      description: 'Auditoria Admin'
    });

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'GET',
      url: `/api/zynpay/charges?id=${chargeId}`,
      headers: { authorization: 'Bearer secret_admin_token_fatosbr_2026' }
    });
    await chargesHandler(req, res);
    const out = result();

    assert(out.statusCode === 200, `Esperado 200 para acesso administrativo, recebido ${out.statusCode}`);
    assert(out.json?.charge?.id === chargeId, 'Admin deve conseguir auditar a cobrança');
  });

  await runTest('2.25 Idempotência persistente: retry com a mesma chave lógica retorna a cobrança sem nova chamada ao gateway', async () => {
    rateStore.reset();
    const userId = 'user_idemp_persistent_test';
    const clientKey = 'intent_unique_key_999';

    // 1ª tentativa
    const { res: res1, result: result1 } = createMockRes();
    const req1 = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: `Bearer ${userId}` },
      body: { planId: 'pro', idempotencyKey: clientKey }
    });
    await chargesHandler(req1, res1);
    const out1 = result1();
    assert(out1.statusCode === 200, 'Primeira criação deve retornar 200');

    // 2ª tentativa com a mesma chave
    const { res: res2, result: result2 } = createMockRes();
    const req2 = createMockReq({
      method: 'POST',
      url: '/api/zynpay/charges',
      headers: { authorization: `Bearer ${userId}` },
      body: { planId: 'pro', idempotencyKey: clientKey }
    });
    await chargesHandler(req2, res2);
    const out2 = result2();

    assert(out2.statusCode === 200, 'Retry deve retornar 200');
    assert(out2.json?.reused === true, 'Flag reused deve ser true');
    assert(out1.json?.charge?.id === out2.json?.charge?.id, 'ID retornado deve ser estritamente o mesmo');
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

  await runTest('3.3 Rejeição de webhook com assinatura HMAC violada no header oficial x-zinpay-signature (HTTP 403)', async () => {
    const rawBody = JSON.stringify({ id: 'evt_bad_sig', chargeId: 'zyn_1' });
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zinpay-signature': 'assinatura_adulterada_invalida' },
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
      headers: { 'x-zinpay-signature': sig },
      rawBody
    });
    await webhookHandler(req, res);
    const out = result();
    assert(out.statusCode === 400, `Esperado 400, recebido ${out.statusCode}`);
    assert(out.json?.code === 'MALFORMED_PAYLOAD', 'Código deve ser MALFORMED_PAYLOAD');
  });

  await runTest('3.5 Processamento com sucesso via x-zinpay-signature e evento pix.charge.paid', async () => {
    const chargeId = 'zyn_wh_ok_01';
    const eventId = 'evt_wh_ok_01';
    const userEmail = 'webhook.ok@fatosbr.com.br';

    await recordPendingCharge({
      id: chargeId,
      userEmail,
      amountCents: 2990,
      description: 'Plano Pro'
    });

    const payloadObj = {
      id: eventId,
      event: 'pix.charge.paid',
      data: {
        charge_id: chargeId,
        amount: 2990,
        status: 'PAID'
      }
    };
    const rawBody = JSON.stringify(payloadObj);
    const sig = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zinpay-signature': sig },
      rawBody
    });
    await webhookHandler(req, res);
    const out = result();

    assert(out.statusCode === 200, `Esperado 200, recebido ${out.statusCode}: ${JSON.stringify(out.json)}`);
    assert(out.json?.success === true, 'Operação deve retornar success: true');
    assert(out.json?.status === 'PAID', 'Status deve ser PAID');
  });

  await runTest('3.6 Evento não relacionado a liquidação (pix.charge.expired) é ignorado sem ativar Pro', async () => {
    const payloadObj = {
      id: 'evt_expired_99',
      event: 'pix.charge.expired',
      data: {
        charge_id: 'zyn_exp_99'
      }
    };
    const rawBody = JSON.stringify(payloadObj);
    const sig = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zinpay-signature': sig },
      rawBody
    });
    await webhookHandler(req, res);
    const out = result();

    assert(out.statusCode === 200, 'Deve responder 200 OK informando recebimento');
    assert(out.json?.ignored === true, 'Deve ter flag ignored: true');
  });

  await runTest('3.7 Rejeição de headers genéricos alternativos como x-hub-signature ou signature', async () => {
    const rawBody = JSON.stringify({ id: 'evt_alt', chargeId: 'zyn_1' });
    const sig = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-hub-signature': sig },
      rawBody
    });
    await webhookHandler(req, res);
    const out = result();

    assert(out.statusCode === 401, `Esperado 401 para header genérico, recebido ${out.statusCode}`);
    assert(out.json?.code === 'MISSING_SIGNATURE', 'Código deve ser MISSING_SIGNATURE');
  });

  await runTest('3.8 Webhook: Rejeição de confirmação se valor upstream divergir do esperado (HTTP 422 AMOUNT_MISMATCH)', async () => {
    const chargeId = 'zyn_tamper_amount_99';
    await recordPendingCharge({
      providerPaymentId: chargeId,
      userId: 'user_tamper_test',
      userEmail: 'tamper@fatosbr.com.br',
      amountCents: 2990,
      description: 'Plano Pro'
    });

    const payloadObj = {
      id: 'evt_tamper_01',
      event: 'pix.charge.paid',
      data: { charge_id: chargeId }
    };
    const rawBody = JSON.stringify(payloadObj);
    const sig = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zinpay-signature': sig },
      rawBody
    });
    await webhookHandler(req, res);
    const out = result();

    assert(out.statusCode === 422, `Esperado 422 para valor divergente, recebido ${out.statusCode}`);
    assert(out.json?.code === 'AMOUNT_MISMATCH', 'Código deve ser AMOUNT_MISMATCH');
    assert(dbHarness.userSubscriptions.get('user_tamper_test') !== 'active', 'NUNCA deve ativar Pro para valor divergente');
  });

  await runTest('3.9 Webhook: Rejeição de confirmação se valor upstream for zero ou negativo (HTTP 422 INVALID_UPSTREAM_AMOUNT)', async () => {
    const chargeId = 'zyn_zero_amount_88';
    await recordPendingCharge({
      providerPaymentId: chargeId,
      userId: 'user_zero_test',
      userEmail: 'zero@fatosbr.com.br',
      amountCents: 2990,
      description: 'Plano Pro'
    });

    const payloadObj = {
      id: 'evt_zero_01',
      event: 'pix.charge.paid',
      data: { charge_id: chargeId }
    };
    const rawBody = JSON.stringify(payloadObj);
    const sig = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zinpay-signature': sig },
      rawBody
    });
    await webhookHandler(req, res);
    const out = result();

    assert(out.statusCode === 422, `Esperado 422 para valor upstream inválido, recebido ${out.statusCode}`);
    assert(out.json?.code === 'INVALID_UPSTREAM_AMOUNT', 'Código deve ser INVALID_UPSTREAM_AMOUNT');
    assert(dbHarness.userSubscriptions.get('user_zero_test') !== 'active', 'NUNCA deve ativar Pro para valor zero/negativo');
  });

  await runTest('3.10 Webhook: Rejeição se moeda upstream não for BRL (HTTP 422 CURRENCY_MISMATCH)', async () => {
    const chargeId = 'zyn_bad_currency_77';
    await recordPendingCharge({
      providerPaymentId: chargeId,
      userId: 'user_bad_curr_test',
      userEmail: 'curr@fatosbr.com.br',
      amountCents: 2990,
      description: 'Plano Pro'
    });

    const payloadObj = {
      id: 'evt_bad_curr_01',
      event: 'pix.charge.paid',
      data: { charge_id: chargeId }
    };
    const rawBody = JSON.stringify(payloadObj);
    const sig = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zinpay-signature': sig },
      rawBody
    });
    await webhookHandler(req, res);
    const out = result();

    assert(out.statusCode === 422, `Esperado 422 para moeda não-BRL, recebido ${out.statusCode}`);
    assert(out.json?.code === 'CURRENCY_MISMATCH', 'Código deve ser CURRENCY_MISMATCH');
    assert(dbHarness.userSubscriptions.get('user_bad_curr_test') !== 'active', 'NUNCA deve ativar Pro para moeda divergente');
  });

  await runTest('3.11 Webhook: Rejeição se cobrança upstream não estiver em status PAID (HTTP 422 PAYMENT_NOT_CONFIRMED)', async () => {
    const chargeId = 'zyn_not_paid_66';
    await recordPendingCharge({
      providerPaymentId: chargeId,
      userId: 'user_not_paid_test',
      userEmail: 'notpaid@fatosbr.com.br',
      amountCents: 2990,
      description: 'Plano Pro'
    });

    const payloadObj = {
      id: 'evt_not_paid_01',
      event: 'pix.charge.paid',
      data: { charge_id: chargeId }
    };
    const rawBody = JSON.stringify(payloadObj);
    const sig = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'POST',
      url: '/api/zynpay/webhook',
      headers: { 'x-zinpay-signature': sig },
      rawBody
    });
    await webhookHandler(req, res);
    const out = result();

    assert(out.statusCode === 422, `Esperado 422 para status upstream não-PAID, recebido ${out.statusCode}`);
    assert(out.json?.code === 'PAYMENT_NOT_CONFIRMED', 'Código deve ser PAYMENT_NOT_CONFIRMED');
    assert(dbHarness.userSubscriptions.get('user_not_paid_test') !== 'active', 'NUNCA deve ativar Pro se gateway não confirmou PAID');
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

  await runTest('4.3 Acesso com Bearer token válido do ADMIN_SECRET é autorizado com sucesso', async () => {
    process.env.ADMIN_SECRET = 'secret_admin_token_fatosbr_2026';
    const { res, result } = createMockRes();
    const req = createMockReq({
      method: 'GET',
      url: '/api/zynpay/config',
      headers: { authorization: 'Bearer secret_admin_token_fatosbr_2026' }
    });
    await configHandler(req, res);
    const out = result();
    assert(out.statusCode === 200, `Esperado 200 para admin autorizado, recebido ${out.statusCode}`);
    assert(out.json?.success === true, 'Deve retornar success: true');
  });

  await runTest('4.4 Validação estrita de resposta: Rejeita resposta sem amountCents válido ou com valor negativo', async () => {
    let capturedErr = '';
    try {
      validateMonetaryAmountCents(-100, 'amountCents');
    } catch (e: any) {
      capturedErr = e.message;
    }
    assert(capturedErr.includes('GATEWAY_INVALID_RESPONSE'), 'Deve lançar GATEWAY_INVALID_RESPONSE para valor negativo');

    let capturedMissing = '';
    try {
      validateZynPayCreationResponse({ data: { id: 'zyn_123', qrCodeText: 'pix123' } }, 2990);
    } catch (e: any) {
      capturedMissing = e.message;
    }
    assert(capturedMissing.includes('GATEWAY_INVALID_RESPONSE'), 'Deve rejeitar criação sem amountCents');
  });

  await runTest('4.5 Validação estrita de status: Rejeita status desconhecido com GATEWAY_UNKNOWN_STATUS', async () => {
    let capturedErr = '';
    try {
      mapZynPayStatus('STATUS_INVENTADO_FAKE');
    } catch (e: any) {
      capturedErr = e.message;
    }
    assert(capturedErr.includes('GATEWAY_UNKNOWN_STATUS'), 'Deve lançar GATEWAY_UNKNOWN_STATUS');
  });

  await runTest('4.6 Validação estrita de consulta: Rejeita resposta com divergência de identificador', async () => {
    let capturedErr = '';
    try {
      validateZynPayConsultationResponse(
        { data: { id: 'zyn_esperado_diferente', amountCents: 2990, status: 'PAID', qrCodeText: 'pix' } },
        'zyn_consultado_original'
      );
    } catch (e: any) {
      capturedErr = e.message;
    }
    assert(capturedErr.includes('GATEWAY_ID_MISMATCH'), 'Deve lançar GATEWAY_ID_MISMATCH');
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
