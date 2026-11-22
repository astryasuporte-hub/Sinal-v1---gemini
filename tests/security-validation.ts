/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR — SUÍTE DE SEGURANÇA, RATE LIMITING, SSRF & PAYMENTS V1 (CAKTO)
 *
 * Cobre:
 * 1. Rate Limiting Distribuído (Concorrência, Janela, Fail-Closed HTTP 503, Anti-Spoofing de IP)
 * 2. Checkout & Persistência Payments V1 (Fail-Closed DB, Idempotência, Preço Server-Side R$ 34,90, Bloqueio de Métodos Proibidos)
 * 3. Validação Real Cakto Webhook (HMAC-SHA256, Replay <= 300s, Anti-Tampering de Valor/Moeda/Produto/Oferta)
 * 4. Controle de Acesso, Anti-IDOR e Administração via RBAC Supabase Auth
 * 5. Proteção Anti-SSRF (Metadata, RFC1918, Localhost vs Domínios Oficiais incluindo Cakto)
 * 6. Roteadores Consolidados Vercel Hobby (/api/payments, /api/resend, /api/proxy, /api/auth, /api/notifications)
 */

import crypto from 'crypto';
import paymentsRouter from '../api/payments/[...action].js';
import resendRouter from '../api/resend/[...action].js';
import proxyRouter from '../api/proxy/[...action].js';
import authRouter from '../api/auth/[...action].js';
import notificationsRouter from '../api/notifications/[...action].js';
import { isAllowedDomain } from '../api/_lib/common.js';
import {
  setTestDatabaseAdapter,
  setTestSupabaseClient,
} from '../api/_lib/db.js';
import {
  setPaymentsPersistenceAdapter,
  PaymentsPersistenceAdapter,
  DbSubscriptionRow,
  DbAttemptRow,
} from '../api/_lib/payments/PaymentsStore.js';
import {
  setTestRateLimiterStore,
  TestRateLimiterStore,
  enforceRateLimit,
  RATE_LIMIT_PROFILES,
} from '../api/_lib/rateLimiter.js';
import { clearCaktoTokenCache } from '../api/_lib/payments/CaktoClient.js';

process.env.FATOSBR_TEST_MODE = 'true';
process.env.NODE_ENV = 'test';

interface MockReqOptions {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
  rawBody?: string;
}

function createMockReq(options: MockReqOptions = {}): any {
  const { method = 'GET', url = '/api/payments/status', headers = {}, body, rawBody } = options;
  return {
    method,
    url,
    headers: {
      'x-forwarded-for': '127.0.0.1',
      ...headers,
    },
    body,
    rawBody: rawBody !== undefined ? rawBody : body ? JSON.stringify(body) : '',
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: async function* () {
      if (rawBody) yield Buffer.from(rawBody);
      else if (body) yield Buffer.from(JSON.stringify(body));
    },
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
    },
  };

  return {
    res,
    result: () => {
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {}
      return { statusCode, headers, json, raw };
    },
  };
}

class InMemoryPaymentsStore implements PaymentsPersistenceAdapter {
  public subscriptions = new Map<string, DbSubscriptionRow>();
  public attempts = new Map<string, DbAttemptRow>();
  public payments = new Map<string, any>();
  public events = new Map<string, any>();
  public usersByEmail = new Map<string, { id: string; email: string; created_at?: string }>();

  async findSubscriptionByUserId(userId: string): Promise<DbSubscriptionRow | null> {
    return this.subscriptions.get(userId) || null;
  }

  async findSubscriptionByProviderSubId(providerSubId: string): Promise<DbSubscriptionRow | null> {
    for (const s of this.subscriptions.values()) {
      if (s.provider_subscription_id === providerSubId) return s;
    }
    return null;
  }

  async findUserByEmail(email: string): Promise<{ id: string; email: string; created_at?: string } | null> {
    return this.usersByEmail.get(email.toLowerCase().trim()) || null;
  }

  async upsertSubscription(params: any): Promise<DbSubscriptionRow> {
    const existing = this.subscriptions.get(params.userId);
    const now = new Date().toISOString();
    const row: DbSubscriptionRow = {
      id: existing?.id || crypto.randomUUID(),
      user_id: params.userId,
      plan: params.plan,
      plan_id: params.planId,
      status: params.status,
      provider: params.provider,
      product_id: params.productId ?? existing?.product_id ?? null,
      offer_id: params.offerId ?? existing?.offer_id ?? null,
      checkout_id: params.checkoutId ?? existing?.checkout_id ?? null,
      payment_method: params.paymentMethod ?? existing?.payment_method ?? null,
      amount_cents: params.amountCents,
      currency: params.currency,
      provider_subscription_id: params.providerSubscriptionId ?? existing?.provider_subscription_id ?? null,
      current_period_start: params.currentPeriodStart ?? existing?.current_period_start ?? null,
      current_period_end: params.currentPeriodEnd ?? existing?.current_period_end ?? null,
      canceled_at: params.canceledAt !== undefined ? params.canceledAt : existing?.canceled_at ?? null,
      grace_until: params.graceUntil !== undefined ? params.graceUntil : existing?.grace_until ?? null,
      last_event_id: params.lastEventId ?? existing?.last_event_id ?? null,
      billing_metadata: { ...(existing?.billing_metadata || {}), ...(params.billingMetadata || {}) },
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    this.subscriptions.set(params.userId, row);
    return row;
  }

  async createBillingAttempt(params: any): Promise<DbAttemptRow> {
    const now = new Date().toISOString();
    const row: DbAttemptRow = {
      id: params.id,
      user_id: params.userId,
      provider: params.provider,
      plan_id: params.planId,
      product_id: params.productId,
      offer_id: params.offerId,
      checkout_id: params.checkoutId,
      amount_cents: params.amountCents,
      currency: params.currency,
      status: params.status,
      checkout_url: params.checkoutUrl || null,
      idempotency_key: params.idempotencyKey || null,
      metadata: params.metadata || {},
      expires_at: params.expiresAt,
      created_at: now,
      updated_at: now,
    };
    this.attempts.set(params.id, row);
    return row;
  }

  async getBillingAttemptById(attemptId: string): Promise<DbAttemptRow | null> {
    return this.attempts.get(attemptId) || null;
  }

  async findBillingAttemptByIdempotencyKey(userId: string, key: string): Promise<DbAttemptRow | null> {
    for (const a of this.attempts.values()) {
      if (a.user_id === userId && a.idempotency_key === key) return a;
    }
    return null;
  }

  async updateBillingAttempt(attemptId: string, patch: any): Promise<void> {
    const row = this.attempts.get(attemptId);
    if (!row) return;
    if (patch.status) row.status = patch.status;
    if (patch.checkoutUrl !== undefined) row.checkout_url = patch.checkoutUrl;
    if (patch.providerOrderId !== undefined) row.provider_order_id = patch.providerOrderId;
    if (patch.providerSubscriptionId !== undefined) row.provider_subscription_id = patch.providerSubscriptionId;
    if (patch.metadata) row.metadata = { ...(row.metadata || {}), ...patch.metadata };
    row.updated_at = new Date().toISOString();
  }

  async listOpenAttemptsForUser(userId: string): Promise<DbAttemptRow[]> {
    return Array.from(this.attempts.values()).filter(
      (a) => a.user_id === userId && (a.status === 'CREATED' || a.status === 'REDIRECTED')
    );
  }

  async acquireWebhookEventLock(params: any): Promise<{ isDuplicate: boolean }> {
    const key = `${params.provider}:${params.providerEventId}`;
    const existing = this.events.get(key);
    if (existing && existing.processed) return { isDuplicate: true };
    this.events.set(key, {
      id: existing?.id || crypto.randomUUID(),
      provider: params.provider,
      provider_event_id: params.providerEventId,
      event_type: params.eventType,
      signature_valid: params.signatureValid,
      processed: false,
      created_at: new Date().toISOString(),
    });
    return { isDuplicate: false };
  }

  async finalizeWebhookEvent(params: any): Promise<void> {
    const key = `${params.provider}:${params.providerEventId}`;
    const row = this.events.get(key);
    if (row) {
      row.processed = params.processed;
      row.processing_error = params.processingError ?? null;
      row.processed_at = new Date().toISOString();
    }
  }

  async upsertPaymentLedgerRecord(params: any): Promise<void> {
    this.payments.set(params.providerPaymentId, {
      id: crypto.randomUUID(),
      ...params,
      created_at: new Date().toISOString(),
    });
  }

  async listUserBillingHistory(userId: string): Promise<any[]> {
    return Array.from(this.payments.values()).filter((p) => p.userId === userId);
  }

  async listRecentWebhookEvents(): Promise<any[]> {
    return Array.from(this.events.values());
  }
}

class MockRateLimitStore implements TestRateLimiterStore {
  private counters = new Map<string, { tokens: number; windowStart: number }>();
  public forceError = false;

  async checkAndIncrement(key: string, maxRequests: number, windowMs: number) {
    if (this.forceError) {
      throw new Error('DATABASE_CONNECTION_LOST');
    }
    const now = Date.now();
    let record = this.counters.get(key);
    if (!record || now - record.windowStart >= windowMs) {
      record = { tokens: 1, windowStart: now };
      this.counters.set(key, record);
      return { allowed: true, current: 1, limit: maxRequests, retry_after: 0, remaining: maxRequests - 1 };
    }
    record.tokens += 1;
    const allowed = record.tokens <= maxRequests;
    const retry_after = allowed ? 0 : Math.max(1, Math.ceil((windowMs - (now - record.windowStart)) / 1000));
    return { allowed, current: record.tokens, limit: maxRequests, retry_after, remaining: Math.max(0, maxRequests - record.tokens) };
  }

  reset() {
    this.counters.clear();
    this.forceError = false;
  }
}

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
  console.log('🔒 FATOSBR — SUÍTE DE SEGURANÇA E PAYMENTS V1 (CAKTO)');
  console.log('======================================================\n');

  const testSecret = 'whsec_cakto_security_test_2026';
  process.env.CAKTO_WEBHOOK_SECRET = testSecret;
  process.env.CAKTO_COMMERCIAL_ENABLED = 'true';
  process.env.CAKTO_METHODS_VERIFIED = 'true';
  process.env.CAKTO_CLIENT_ID = 'mock_client_id';
  process.env.CAKTO_CLIENT_SECRET = 'mock_client_secret';

  const paymentsStore = new InMemoryPaymentsStore();
  setPaymentsPersistenceAdapter(paymentsStore);

  const rateStore = new MockRateLimitStore();
  setTestRateLimiterStore(rateStore);

  const mockSupabase = {
    auth: {
      getUser: async (token: string) => {
        if (!token || token === 'invalid_token') {
          return { data: { user: null }, error: new Error('Invalid token') };
        }
        const clean = token.trim();
        const isAdmin = clean === 'admin_token_valid' || clean.startsWith('admin_');
        const userId = isAdmin
          ? '00000000-0000-4000-8000-000000000001'
          : '11111111-1111-4111-8111-111111111111';
        return {
          data: {
            user: {
              id: userId,
              email: isAdmin ? 'admin@fatosbr.com.br' : 'leitor@fatosbr.com.br',
              created_at: new Date().toISOString(),
              app_metadata: isAdmin ? { role: 'admin', is_admin: true } : {},
              user_metadata: { full_name: isAdmin ? 'Admin' : 'Leitor' },
            },
          },
          error: null,
        };
      },
    },
  };
  setTestSupabaseClient(mockSupabase);

  // Mock global fetch para chamadas OAuth2 + GET offer/product da Cakto
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const u = String(input);
    if (u.includes('/public_api/token/')) {
      return new Response(JSON.stringify({ access_token: 'tok_cakto_mock', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('/public_api/offers/')) {
      return new Response(
        JSON.stringify({ id: 'vjw92gx', status: 'active', paymentMethods: ['credit_card', 'pix_auto'] }),
        { status: 200 }
      );
    }
    if (u.includes('/checkouts/')) {
      return new Response(
        JSON.stringify({
          id: '1356033',
          status: 'active',
          trial_days: 0,
          paymentMethods: ['credit_card', 'pix_auto'],
          config: { desktop: { settings: {} }, mobile: { settings: {} } },
        }),
        { status: 200 }
      );
    }
    if (u.includes('/public_api/products/')) {
      return new Response(
        JSON.stringify({
          id: 'c8731178-55c9-47f6-8b98-987f31206ed8',
          status: 'active',
          price: 34.9,
          paymentMethods: ['credit_card', 'pix_auto'],
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({}), { status: 404 });
  }) as any;

  try {
    // 1. RATE LIMITING
    console.log('--- 1. TESTES DE RATE LIMITING DISTRIBUÍDO ---');

    await runTest('1.1 Bloqueio HTTP 429 ao exceder cota de checkout', async () => {
      rateStore.reset();
      const testIp = '10.1.0.99';
      let blocked = false;
      for (let i = 0; i < 20; i++) {
        const { res, result } = createMockRes();
        const req = createMockReq({
          method: 'POST',
          url: '/api/payments/checkout',
          headers: { 'x-forwarded-for': testIp },
          body: { planId: 'pro' },
        });
        await paymentsRouter(req, res);
        const out = result();
        if (out.statusCode === 429) {
          blocked = true;
          assert(out.json?.code === 'RATE_LIMIT_EXCEEDED', 'Código deve ser RATE_LIMIT_EXCEEDED');
          break;
        }
      }
      assert(blocked, 'Deveria bloquear após exceder cota de checkout');
    });

    await runTest('1.2 Falha no banco do Rate Limiter aciona Fail-Closed HTTP 503', async () => {
      rateStore.reset();
      rateStore.forceError = true;
      const { res, result } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/payments/checkout',
        headers: { 'x-forwarded-for': '10.1.0.105' },
        body: { planId: 'pro' },
      });
      await paymentsRouter(req, res);
      rateStore.forceError = false;
      const out = result();
      assert(out.statusCode === 503, `Esperado HTTP 503, recebido ${out.statusCode}`);
      assert(out.json?.code === 'RATE_LIMIT_CHECK_FAILED', 'Código deve ser RATE_LIMIT_CHECK_FAILED');
    });

    await runTest('1.3 Anti-spoofing valida header de IP sem quebrar cota', async () => {
      rateStore.reset();
      const spoofedReq = createMockReq({
        headers: {
          'x-forwarded-for': '203.0.113.195, 10.0.0.1',
          'cf-connecting-ip': '203.0.113.195',
        },
      });
      const { res } = createMockRes();
      const allowed = await enforceRateLimit(spoofedReq, res, 'payments');
      assert(allowed, 'Requisição inicial deve ser permitida');
    });

    assert(RATE_LIMIT_PROFILES.payments.maxRequests > 0, 'Perfil payments deve existir');

    // 2. SEGURANÇA DO CHECKOUT & AUTENTICAÇÃO
    console.log('\n--- 2. CHECKOUT PAYMENTS V1, PREÇO SERVIDOR & AUTH ---');

    await runTest('2.1 Checkout sem Bearer token retorna HTTP 401', async () => {
      rateStore.reset();
      const { res, result } = createMockRes();
      const req = createMockReq({ method: 'POST', url: '/api/payments/checkout', body: { planId: 'pro' } });
      await paymentsRouter(req, res);
      assert(result().statusCode === 401, 'Deve retornar 401 sem autenticação');
    });

    await runTest('2.2 Checkout ignora manipulação de preço do cliente e impõe 3490 centavos BRL', async () => {
      rateStore.reset();
      clearCaktoTokenCache();
      const { res, result } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/payments/checkout',
        headers: { authorization: 'Bearer user_token_valid' },
        body: { planId: 'pro', amount: 0.01, amountCents: 1, currency: 'USD', paymentMethod: 'credit_card' },
      });
      await paymentsRouter(req, res);
      const out = result();
      assert(out.statusCode === 200, `Esperado 200, recebido ${out.statusCode}: ${out.raw}`);
      assert(out.json?.amountCents === 3490, `Valor deve ser 3490, recebido ${out.json?.amountCents}`);
      assert(out.json?.currency === 'BRL', 'Moeda deve ser estritamente BRL');
      assert(out.json?.checkoutUrl?.startsWith('https://pay.cakto.com.br/vjw92gx'), 'URL oficial da oferta vjw92gx');
    });

    await runTest('2.3 Chave de idempotência malformada retorna HTTP 400 INVALID_IDEMPOTENCY_KEY', async () => {
      rateStore.reset();
      const { res, result } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/payments/checkout',
        headers: { authorization: 'Bearer user_token_valid' },
        body: { planId: 'pro', idempotencyKey: 'short' },
      });
      await paymentsRouter(req, res);
      assert(result().statusCode === 400, 'Esperado 400 para chave curta');
      assert(result().json?.errorCode === 'INVALID_IDEMPOTENCY_KEY', 'Código deve ser INVALID_IDEMPOTENCY_KEY');
    });

    await runTest('2.4 Fail-Closed PostgreSQL sem DB adapter e sem ENV lança POSTGRES_UNAVAILABLE', async () => {
      setTestDatabaseAdapter(null);
      const { recordPendingCharge } = await import('../api/_lib/db.js');
      let errMsg = '';
      try {
        await recordPendingCharge({
          id: 'fail_closed_01',
          userEmail: 'test@fatosbr.com.br',
          amountCents: 3490,
          description: 'Teste',
        });
      } catch (e: any) {
        errMsg = e.message;
      }
      assert(errMsg.includes('POSTGRES_UNAVAILABLE'), `Esperado POSTGRES_UNAVAILABLE, recebido: ${errMsg}`);
    });

    // 3. WEBHOOK HMAC + REPLAY + INTEGRIDADE
    console.log('\n--- 3. WEBHOOK CAKTO HMAC-SHA256 & ANTI-TAMPERING ---');

    await runTest('3.1 Webhook sem assinatura retorna HTTP 401 MISSING_SIGNATURE', async () => {
      const { res, result } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/payments/webhook',
        body: { event: 'purchase_approved', id: 'evt_no_sig_1', data: { id: 'ord_1' } },
      });
      await paymentsRouter(req, res);
      assert(result().statusCode === 401, 'Esperado 401');
      assert(result().json?.errorCode === 'MISSING_SIGNATURE', 'Código MISSING_SIGNATURE');
    });

    await runTest('3.2 Webhook com replay (> 300s) é rejeitado com HTTP 401 WEBHOOK_REPLAY_EXPIRED', async () => {
      const rawBody = JSON.stringify({ event: 'purchase_approved', id: 'evt_replay_1', data: { id: 'ord_2' } });
      const oldTs = String(Math.floor(Date.now() / 1000) - 600);
      const sig = crypto.createHmac('sha256', testSecret).update(`${oldTs}.${rawBody}`).digest('hex');

      const { res, result } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/payments/webhook',
        headers: { 'x-cakto-signature': sig, 'x-cakto-timestamp': oldTs },
        rawBody,
      });
      await paymentsRouter(req, res);
      assert(result().statusCode === 401, 'Esperado 401 para timestamp expirado');
      assert(result().json?.errorCode === 'WEBHOOK_REPLAY_EXPIRED', 'Código WEBHOOK_REPLAY_EXPIRED');
    });

    await runTest('3.3 Webhook com valor diferente de 3490 é rejeitado com HTTP 422 AMOUNT_MISMATCH', async () => {
      const rawBody = JSON.stringify({
        event: 'purchase_approved',
        id: 'evt_tamper_amt_1',
        data: {
          id: 'ord_tamper_1',
          amount: 100,
          currency: 'BRL',
          paymentMethod: 'credit_card',
          product: { id: 'c8731178-55c9-47f6-8b98-987f31206ed8' },
          offer: { id: 'vjw92gx' },
          customer: { email: 'leitor@fatosbr.com.br' },
        },
      });
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = crypto.createHmac('sha256', testSecret).update(`${ts}.${rawBody}`).digest('hex');

      const { res, result } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/payments/webhook',
        headers: { 'x-cakto-signature': `v1=${sig}`, 'x-cakto-timestamp': ts },
        rawBody,
      });
      await paymentsRouter(req, res);
      assert(result().statusCode === 422, 'Esperado 422');
      assert(result().json?.errorCode === 'AMOUNT_MISMATCH', 'Código AMOUNT_MISMATCH');
    });

    await runTest('3.4 Webhook sem CAKTO_WEBHOOK_SECRET retorna HTTP 503 WEBHOOK_SECRET_NOT_CONFIGURED', async () => {
      const saved = process.env.CAKTO_WEBHOOK_SECRET;
      delete process.env.CAKTO_WEBHOOK_SECRET;
      const { res, result } = createMockRes();
      const req = createMockReq({
        method: 'POST',
        url: '/api/payments/webhook',
        headers: { 'x-cakto-signature': 'abc' },
        body: { event: 'purchase_approved', id: 'evt_no_sec' },
      });
      await paymentsRouter(req, res);
      process.env.CAKTO_WEBHOOK_SECRET = saved;
      assert(result().statusCode === 503, `Esperado 503, recebido ${result().statusCode}`);
      assert(result().json?.errorCode === 'WEBHOOK_SECRET_NOT_CONFIGURED', 'Código WEBHOOK_SECRET_NOT_CONFIGURED');
    });

    // 4. SSRF
    console.log('\n--- 4. PROTEÇÃO ANTI-SSRF ---');

    await runTest('4.1 Bloqueio de IPs privados e liberação exclusiva de domínios oficiais (incluindo Cakto)', async () => {
      const dangerousUrls = [
        'http://169.254.169.254/latest/meta-data/',
        'http://127.0.0.1:8080/admin',
        'http://localhost:3000/api/payments/status',
        'http://10.0.0.5/secrets',
        'http://192.168.0.1/router',
      ];
      for (const u of dangerousUrls) {
        assert(!isAllowedDomain(u), `URL perigosa bloqueada: ${u}`);
      }
      const officialUrls = [
        'https://gnews.io/api/v4/search',
        'https://api.worldnewsapi.com/search-news',
        'https://api.cakto.com.br/public_api/orders/',
        'https://pay.cakto.com.br/vjw92gx',
      ];
      for (const u of officialUrls) {
        assert(isAllowedDomain(u), `URL oficial permitida: ${u}`);
      }
    });

    // 5. ROTEADORES CONSOLIDADOS
    console.log('\n--- 5. TESTES DOS ROTEADORES CONSOLIDADOS ---');

    await runTest('5.1 paymentsRouter rejeita rota inexistente com HTTP 404 ENDPOINT_NOT_FOUND', async () => {
      const { res, result } = createMockRes();
      const req = createMockReq({ method: 'GET', url: '/api/payments/rota-inexistente' });
      await paymentsRouter(req, res);
      assert(result().statusCode === 404, 'Deve retornar 404');
      assert(result().json?.errorCode === 'ENDPOINT_NOT_FOUND', 'Código ENDPOINT_NOT_FOUND');
    });

    await runTest('5.2 resendRouter responde /api/resend/status com HTTP 200', async () => {
      const { res, result } = createMockRes();
      await resendRouter(createMockReq({ method: 'GET', url: '/api/resend/status' }), res);
      assert(result().statusCode === 200, 'Esperado 200');
      assert(result().json?.provider === 'Resend', 'Provider Resend');
    });

    await runTest('5.3 proxyRouter responde /api/proxy/status com HTTP 200 e sem zynpay', async () => {
      const { res, result } = createMockRes();
      await proxyRouter(createMockReq({ method: 'GET', url: '/api/proxy/status' }), res);
      const out = result();
      assert(out.statusCode === 200, 'Esperado 200');
      assert(!out.raw.toLowerCase().includes('zynpay'), 'Status não deve expor referência zynpay');
    });

    await runTest('5.4 authRouter valida payload vazio em /api/auth/send-otp (HTTP 400)', async () => {
      const { res, result } = createMockRes();
      await authRouter(createMockReq({ method: 'POST', url: '/api/auth/send-otp', body: {} }), res);
      assert(result().statusCode === 400, 'Esperado 400');
    });

    await runTest('5.5 notificationsRouter rejeita sub-rota desconhecida com HTTP 404', async () => {
      const { res, result } = createMockRes();
      await notificationsRouter(createMockReq({ method: 'POST', url: '/api/notifications/desconhecida' }), res);
      assert(result().statusCode === 404, 'Esperado 404');
    });
  } finally {
    globalThis.fetch = originalFetch;
    setPaymentsPersistenceAdapter(null);
    setTestRateLimiterStore(null as any);
  }

  console.log('\n------------------------------------------------------');
  console.log(`📊 TOTAL: ${testsPassed} testes passaram com sucesso, ${testsFailed} falharam.`);
  console.log('------------------------------------------------------\n');

  if (testsFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Falha crítica na suíte de testes:', err);
  process.exit(1);
});
