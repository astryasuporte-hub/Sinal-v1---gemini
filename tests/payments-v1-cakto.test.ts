/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR PAYMENTS V1.1 — SUÍTE DE TESTES UNITÁRIOS & INTEGRAÇÃO CAKTO
 *
 * Valida com mocks de HTTP e Store em memória:
 * 1. Plano pago único FatosBR PRO (R$ 34,90 / 3490 centavos BRL, ciclo 30 dias, 0 trial na Cakto, 7 dias no SaaS).
 * 2. IDs oficiais imutáveis (product c8731178-55c9-47f6-8b98-987f31206ed8, offer vjw92gx, checkout 1356033).
 * 3. Travas comerciais obrigatórias:
 *    - CAKTO_COMMERCIAL_ENABLED=false -> bloqueia (CAKTO_CHECKOUT_COMMERCIAL_BLOCKED)
 *    - CAKTO_METHODS_VERIFIED=false -> bloqueia (CAKTO_PAYMENT_METHODS_NOT_VERIFIED)
 *    - oferta disabled / produto waiting_config / trial_days != 0 -> bloqueia
 *    - oferta sem AMBOS credit_card e pix_auto ou com pix avulso ativo -> bloqueia
 * 4. Assinatura HMAC-SHA256 exige x-cakto-timestamp obrigatório (<= 300s), rejeita fallback sem timestamp (401 MISSING_TIMESTAMP).
 * 5. Suporte a payload data como objeto ou array, e estados canônicos:
 *    - subscription_created NÃO ativa PRO
 *    - refund_requested NÃO revoga nem marca REFUNDED
 *    - subscription_canceled preserva current_period_end mantendo acesso até fim do ciclo
 *    - chargeback/refund revogam acesso imediatamente
 *    - webhook sem âncora persistida retorna RECONCILIATION_REQUIRED (HTTP 202) sem ativar PRO
 * 6. Fail-closed no SubscriptionService (HTTP 503 em falha de banco, nunca inventa trial).
 */

import crypto from 'crypto';
import paymentsRouter from '../api/payments/[...action].js';
import {
  CAKTO_OFFICIAL_IDS,
  getProPlanConfig,
  resolvePlanPrice,
  isAllowedPaymentMethod,
  isProhibitedPaymentMethod,
} from '../api/_lib/plans.js';

const {
  productId: CAKTO_OFFICIAL_PRODUCT_ID,
  offerId: CAKTO_OFFICIAL_OFFER_ID,
  checkoutId: CAKTO_OFFICIAL_CHECKOUT_ID,
} = CAKTO_OFFICIAL_IDS;
import { CaktoClient, clearCaktoTokenCache } from '../api/_lib/payments/CaktoClient.js';
import { CaktoPaymentProvider } from '../api/_lib/payments/CaktoPaymentProvider.js';
import { CheckoutService } from '../api/_lib/payments/CheckoutService.js';
import { BillingEventProcessor } from '../api/_lib/payments/BillingEventProcessor.js';
import { BillingReconciliationService } from '../api/_lib/payments/BillingReconciliationService.js';
import { SubscriptionService, SubscriptionVerificationUnavailableError } from '../api/_lib/payments/SubscriptionService.js';
import { WebhookVerificationService } from '../api/_lib/payments/WebhookVerificationService.js';
import {
  PaymentsPersistenceAdapter,
  DbSubscriptionRow,
  DbAttemptRow,
  setPaymentsPersistenceAdapter,
} from '../api/_lib/payments/PaymentsStore.js';
import { toBillingHistoryStatus } from '../api/_lib/payments/DbContractMapper.js';
import { setTestSupabaseClient } from '../api/_lib/db.js';
import { setTestRateLimiterStore } from '../api/_lib/rateLimiter.js';

process.env.FATOSBR_TEST_MODE = 'true';
process.env.NODE_ENV = 'test';

class MemoryPaymentsStore implements PaymentsPersistenceAdapter {
  public subscriptions = new Map<string, DbSubscriptionRow>();
  public attempts = new Map<string, DbAttemptRow>();
  public payments = new Map<string, any>();
  public events = new Map<string, any>();
  public usersByEmail = new Map<string, { id: string; email: string; created_at?: string }>();
  public throwOnFindSubscription = false;

  async findSubscriptionByUserId(userId: string) {
    if (this.throwOnFindSubscription) {
      throw new Error('SIMULATED_PG_CONNECTION_ERROR');
    }
    return this.subscriptions.get(userId) || null;
  }
  async findSubscriptionByProviderSubId(providerSubId: string) {
    for (const row of this.subscriptions.values()) {
      if (row.provider_subscription_id === providerSubId) return row;
    }
    return null;
  }
  async findSubscriptionByProviderOrderId(providerOrderId: string) {
    const pay = this.payments.get(providerOrderId);
    if (pay?.userId) return this.subscriptions.get(pay.userId) || null;
    return null;
  }
  async findUserByEmail(email: string) {
    return this.usersByEmail.get(email.toLowerCase().trim()) || null;
  }
  async findUserCreatedAt(userId: string) {
    for (const u of this.usersByEmail.values()) {
      if (u.id === userId) return u.created_at || null;
    }
    return null;
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
      trial_starts_at: params.trialStartsAt ?? existing?.trial_starts_at ?? null,
      trial_ends_at: params.trialEndsAt ?? existing?.trial_ends_at ?? null,
      current_period_start: params.currentPeriodStart ?? existing?.current_period_start ?? null,
      current_period_end: params.currentPeriodEnd ?? existing?.current_period_end ?? null,
      next_billing_at: params.nextBillingAt !== undefined ? params.nextBillingAt : existing?.next_billing_at ?? null,
      cancel_at_period_end:
        params.cancelAtPeriodEnd !== undefined ? params.cancelAtPeriodEnd : existing?.cancel_at_period_end ?? false,
      canceled_at: params.canceledAt !== undefined ? params.canceledAt : existing?.canceled_at ?? null,
      grace_until: params.graceUntil !== undefined ? params.graceUntil : existing?.grace_until ?? null,
      last_event_id: params.lastEventId ?? existing?.last_event_id ?? null,
      last_event_at: params.lastEventAt ?? existing?.last_event_at ?? null,
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
  async getBillingAttemptById(id: string) {
    return this.attempts.get(id) || null;
  }
  async findBillingAttemptByIdempotencyKey(userId: string, key: string) {
    for (const a of this.attempts.values()) {
      if (a.user_id === userId && a.idempotency_key === key) return a;
    }
    return null;
  }
  async updateBillingAttempt(id: string, patch: any) {
    const row = this.attempts.get(id);
    if (!row) return;
    if (patch.status) row.status = patch.status;
    if (patch.checkoutUrl !== undefined) row.checkout_url = patch.checkoutUrl;
    if (patch.providerOrderId !== undefined) row.provider_order_id = patch.providerOrderId;
    if (patch.providerSubscriptionId !== undefined) row.provider_subscription_id = patch.providerSubscriptionId;
    if (patch.metadata) row.metadata = { ...(row.metadata || {}), ...patch.metadata };
  }
  async listOpenAttemptsForUser(userId: string) {
    return Array.from(this.attempts.values()).filter((a) => a.user_id === userId && (a.status === 'CREATED' || a.status === 'REDIRECTED'));
  }
  async acquireWebhookEventLock(params: any) {
    const key = `${params.provider}:${params.providerEventId}`;
    const existing = this.events.get(key);
    if (existing && existing.processed) return { isDuplicate: true };
    if (params.eventHash) {
      for (const ev of this.events.values()) {
        if (ev.provider === params.provider && ev.event_hash === params.eventHash && ev.processed) {
          return { isDuplicate: true };
        }
      }
    }
    this.events.set(key, {
      id: crypto.randomUUID(),
      provider: params.provider,
      provider_event_id: params.providerEventId,
      event_type: params.eventType,
      event_hash: params.eventHash || null,
      processed: false,
      created_at: new Date().toISOString(),
    });
    return { isDuplicate: false };
  }
  async finalizeWebhookEvent(params: any) {
    const key = `${params.provider}:${params.providerEventId}`;
    const row = this.events.get(key);
    if (row) {
      row.processed = params.processed;
      row.processing_error = params.processingError ?? null;
    }
  }
  async findPaymentByProviderPaymentId(providerPaymentId: string) {
    const p = this.payments.get(providerPaymentId);
    if (!p) return null;
    return { id: p.id, user_id: p.userId, status: p.status };
  }
  async upsertPaymentLedgerRecord(params: any) {
    this.payments.set(params.providerPaymentId, {
      id: crypto.randomUUID(),
      ...params,
      created_at: new Date().toISOString(),
    });
  }
  async listUserBillingHistory(userId: string) {
    return Array.from(this.payments.values())
      .filter((p) => p.userId === userId)
      .map((p) => ({
        id: p.id,
        date: p.created_at,
        amountCents: p.amountCents,
        amount: p.amountCents / 100,
        currency: 'BRL' as const,
        status: toBillingHistoryStatus(p.status, p.checkoutData),
        paymentMethod: p.paymentMethod,
        provider: p.provider,
        referenceId: p.providerPaymentId,
        description: p.checkoutData?.description || 'Assinatura FatosBR PRO',
      }));
  }
  async listRecentWebhookEvents() {
    return Array.from(this.events.values());
  }
}

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function run() {
  console.log('\n======================================================');
  console.log('💳 FATOSBR PAYMENTS V1.1 — SUÍTE CAKTO & ASSINATURAS');
  console.log('======================================================\n');

  const store = new MemoryPaymentsStore();
  setPaymentsPersistenceAdapter(store);
  setTestRateLimiterStore({
    checkAndIncrement: async () => ({ allowed: true, current: 1, limit: 100, retry_after: 0, remaining: 99 }),
  });

  const userId = '22222222-2222-4222-8222-222222222222';
  const userEmail = 'assinante@fatosbr.com.br';
  const userCreatedAt = new Date().toISOString();
  store.usersByEmail.set(userEmail, { id: userId, email: userEmail, created_at: userCreatedAt });

  setTestSupabaseClient({
    auth: {
      getUser: async (token: string) => ({
        data: {
          user: token === 'valid_user'
            ? { id: userId, email: userEmail, created_at: userCreatedAt, app_metadata: {}, user_metadata: { full_name: 'Assinante PRO' } }
            : null,
        },
        error: token === 'valid_user' ? null : new Error('Unauthorized'),
      }),
    },
  });

  // 1. Plano oficial e IDs Cakto
  const plan = getProPlanConfig();
  assert(plan.amountCents === 3490 && plan.amountFormatted === 'R$ 34,90', 'Plano único FatosBR PRO é R$ 34,90 (3490 centavos BRL)');
  assert(plan.productId === CAKTO_OFFICIAL_PRODUCT_ID && plan.productId === 'c8731178-55c9-47f6-8b98-987f31206ed8', 'Product ID oficial Cakto preservado');
  assert(plan.offerId === CAKTO_OFFICIAL_OFFER_ID && plan.offerId === 'vjw92gx', 'Offer ID oficial Cakto preservado');
  assert(plan.checkoutId === CAKTO_OFFICIAL_CHECKOUT_ID && plan.checkoutId === '1356033', 'Checkout ID oficial Cakto preservado');
  assert(plan.saasTrialDays === 7 && plan.providerTrialDays === 0, 'Trial 7 dias apenas no SaaS e 0 dias na Cakto');
  assert(resolvePlanPrice('fatosbr_pro').amountCents === 3490, 'Alias fatosbr_pro resolve para 3490 centavos');
  let annualRejected = false;
  try {
    resolvePlanPrice('pro_annual');
  } catch (e: any) {
    annualRejected = String(e?.message || '').includes('PLAN_NOT_AVAILABLE');
  }
  assert(annualRejected, 'Plano legado inexistente pro_annual é rejeitado com PLAN_NOT_AVAILABLE');
  assert(isAllowedPaymentMethod('credit_card') && isAllowedPaymentMethod('pix_auto'), 'credit_card e pix_auto são permitidos');
  assert(isProhibitedPaymentMethod('pix') && isProhibitedPaymentMethod('boleto') && isProhibitedPaymentMethod('picpay'), 'pix avulso, boleto e picpay são proibidos');

  // 2. Bloqueios comerciais da Cakto
  process.env.CAKTO_COMMERCIAL_ENABLED = 'false';
  process.env.CAKTO_METHODS_VERIFIED = 'false';
  process.env.CAKTO_CLIENT_ID = 'mock_id';
  process.env.CAKTO_CLIENT_SECRET = 'mock_sec';
  process.env.CAKTO_WEBHOOK_SECRET = 'whsec_test_cakto_v1';

  const checkoutService = new CheckoutService(() => store);

  const blockedCommercial = await checkoutService.initiateCheckout({ userId, userEmail, planId: 'pro', requestedMethod: 'credit_card' });
  assert(blockedCommercial.httpStatus === 423 && blockedCommercial.result.errorCode === 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED', 'Bloqueia checkout quando CAKTO_COMMERCIAL_ENABLED=false');

  process.env.CAKTO_COMMERCIAL_ENABLED = 'true';
  process.env.CAKTO_METHODS_VERIFIED = 'false';
  const blockedUnverified = await checkoutService.initiateCheckout({ userId, userEmail, planId: 'pro', requestedMethod: 'pix_auto' });
  assert(blockedUnverified.httpStatus === 423 && blockedUnverified.result.errorCode === 'CAKTO_PAYMENT_METHODS_NOT_VERIFIED', 'Bloqueia checkout quando CAKTO_METHODS_VERIFIED=false');

  const blockedPixAvulso = await checkoutService.initiateCheckout({ userId, userEmail, planId: 'pro', requestedMethod: 'pix' });
  assert(blockedPixAvulso.httpStatus === 400 && blockedPixAvulso.result.errorCode === 'PAYMENT_METHOD_NOT_ALLOWED', 'Bloqueia explicitamente pix avulso');

  process.env.CAKTO_METHODS_VERIFIED = 'true';
  const originalFetch = globalThis.fetch;
  let mockOfferPayload: any = { id: 'vjw92gx', status: 'active', trial_days: 0, paymentMethods: ['credit_card', 'pix'] };
  let mockProductPayload: any = { id: CAKTO_OFFICIAL_PRODUCT_ID, status: 'active' };
  let mockCheckoutPayload: any = { id: '1356033', status: 'active', trial_days: 0, paymentMethods: ['credit_card', 'pix_auto'] };
  let mockOrdersPayload: any = [];
  let cancelCalledOnCakto = false;

  globalThis.fetch = (async (input: any) => {
    const u = String(input);
    if (u.includes('/public_api/token/')) {
      return new Response(JSON.stringify({ access_token: 'cakto_mock_tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('/public_api/offers/')) {
      return new Response(JSON.stringify(mockOfferPayload), { status: 200 });
    }
    if (u.includes('/public_api/products/')) {
      return new Response(JSON.stringify(mockProductPayload), { status: 200 });
    }
    if (u.includes('/public_api/checkouts/')) {
      return new Response(JSON.stringify(mockCheckoutPayload), { status: 200 });
    }
    if (u.includes('/cancel/')) {
      cancelCalledOnCakto = true;
      return new Response(JSON.stringify({ status: 'canceled' }), { status: 200 });
    }
    if (u.includes('/public_api/orders/')) {
      return new Response(JSON.stringify({ results: mockOrdersPayload }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  }) as any;

  try {
    clearCaktoTokenCache();
    const blockedDisallowedUpstream = await checkoutService.initiateCheckout({ userId, userEmail, planId: 'pro', requestedMethod: 'credit_card' });
    assert(
      blockedDisallowedUpstream.httpStatus === 423 &&
        blockedDisallowedUpstream.result.errorCode === 'CAKTO_DISALLOWED_PAYMENT_METHOD_ENABLED',
      'Bloqueia automaticamente quando oferta na Cakto tem pix avulso ativo'
    );

    // Oferta com apenas credit_card (sem pix_auto) deve bloquear
    mockOfferPayload = { id: 'vjw92gx', status: 'active', trial_days: 0, paymentMethods: ['credit_card'] };
    mockCheckoutPayload = { id: '1356033', status: 'active', trial_days: 0, paymentMethods: ['credit_card'] };
    const blockedPartialMethods = await checkoutService.initiateCheckout({ userId, userEmail, planId: 'pro', requestedMethod: 'credit_card' });
    assert(
      blockedPartialMethods.httpStatus === 423 &&
        blockedPartialMethods.result.errorCode === 'CAKTO_DISALLOWED_PAYMENT_METHOD_ENABLED',
      'Bloqueia quando apenas credit_card está ativo sem pix_auto'
    );

    // Oferta ou Checkout com trial_days > 0 deve bloquear
    mockOfferPayload = { id: 'vjw92gx', status: 'active', trial_days: 7, paymentMethods: ['credit_card', 'pix_auto'] };
    mockCheckoutPayload = { id: '1356033', status: 'active', trial_days: 0, paymentMethods: ['credit_card', 'pix_auto'] };
    const blockedTrialOffer = await checkoutService.initiateCheckout({ userId, userEmail, planId: 'pro', requestedMethod: 'credit_card' });
    assert(
      blockedTrialOffer.httpStatus === 423 && blockedTrialOffer.result.errorCode === 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
      'Bloqueia quando oferta na Cakto possui trial_days != 0'
    );

    mockOfferPayload = { id: 'vjw92gx', status: 'active', trial_days: 0, paymentMethods: ['credit_card', 'pix_auto'] };
    mockCheckoutPayload = { id: '1356033', status: 'active', trial_days: 7, paymentMethods: ['credit_card', 'pix_auto'] };
    const blockedTrialCheckout = await checkoutService.initiateCheckout({ userId, userEmail, planId: 'pro', requestedMethod: 'credit_card' });
    assert(
      blockedTrialCheckout.httpStatus === 423 && blockedTrialCheckout.result.errorCode === 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
      'Bloqueia quando checkout na Cakto possui trial_days != 0 mesmo com oferta trial_days=0'
    );

    mockOfferPayload = { id: 'vjw92gx', status: 'disabled', trial_days: 0, paymentMethods: ['credit_card', 'pix_auto'] };
    const blockedDisabledOffer = await checkoutService.initiateCheckout({ userId, userEmail, planId: 'pro', requestedMethod: 'credit_card' });
    assert(
      blockedDisabledOffer.httpStatus === 423 && blockedDisabledOffer.result.errorCode === 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
      'Bloqueia quando oferta está disabled na Cakto'
    );

    // 3. Fluxo liberado apenas com oferta e checkout ativos + credit_card e pix_auto + trial_days=0
    mockOfferPayload = { id: 'vjw92gx', status: 'active', trial_days: 0, paymentMethods: ['credit_card', 'pix_auto'] };
    mockCheckoutPayload = { id: '1356033', status: 'active', trial_days: 0, paymentMethods: ['credit_card', 'pix_auto'] };
    const okCheckout = await checkoutService.initiateCheckout({
      userId,
      userEmail,
      userName: 'Assinante Teste',
      planId: 'pro',
      requestedMethod: 'pix_auto',
      idempotencyKey: 'chk_idemp_2026_01',
    });
    assert(
      okCheckout.httpStatus === 200 &&
        okCheckout.result.success === true &&
        Boolean(okCheckout.result.checkoutUrl?.includes('https://pay.cakto.com.br/vjw92gx')) &&
        Boolean(okCheckout.result.attemptId),
      'Libera checkout Cakto vjw92gx com attemptId UUID quando oferta e checkout válidos'
    );

    const attemptId = okCheckout.result.attemptId!;

    // 4. Webhooks e Máquina de Estados Completa
    const provider = new CaktoPaymentProvider(new CaktoClient());
    const verifier = new WebhookVerificationService();
    const processor = new BillingEventProcessor(() => store);
    const subService = new SubscriptionService(() => store);

    const signAndValidate = (payload: any) => {
      const rawBody = JSON.stringify(payload);
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = crypto.createHmac('sha256', process.env.CAKTO_WEBHOOK_SECRET!).update(`${ts}.${rawBody}`).digest('hex');
      return verifier.validateAndNormalize({
        provider,
        rawBody,
        body: payload,
        headers: { 'x-cakto-signature': sig, 'x-cakto-timestamp': ts },
      });
    };

    // Rejeita webhook sem x-cakto-timestamp (sem fallback vulnerável)
    const noTsPayload = { event: 'purchase_approved', id: 'evt_no_ts', data: { id: 'ord_no_ts' } };
    const noTsRaw = JSON.stringify(noTsPayload);
    const noTsSig = crypto.createHmac('sha256', process.env.CAKTO_WEBHOOK_SECRET!).update(noTsRaw).digest('hex');
    const noTsVal = verifier.validateAndNormalize({
      provider,
      rawBody: noTsRaw,
      body: noTsPayload,
      headers: { 'x-cakto-signature': noTsSig },
    });
    assert(!noTsVal.accepted && noTsVal.httpStatus === 401 && noTsVal.errorCode === 'MISSING_TIMESTAMP', 'Webhook sem x-cakto-timestamp é rejeitado com HTTP 401 MISSING_TIMESTAMP');

    // Bloqueia webhook com pix avulso
    const pixWebhookVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_pix_forbidden',
      data: {
        id: 'ord_pix_bad',
        sck: attemptId,
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'pix',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
        customer: { email: userEmail },
      },
    });
    assert(!pixWebhookVal.accepted && pixWebhookVal.errorCode === 'PROHIBITED_PAYMENT_METHOD', 'Webhook com Pix avulso é bloqueado com PROHIBITED_PAYMENT_METHOD');

    // Webhook sem âncora persistida (apenas customer.email ou metadata.user_id) NÃO ativa PRO
    const unanchoredVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_unanchored_01',
      data: {
        id: 'ord_unanchored_01',
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'credit_card',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
        customer: { email: userEmail },
        metadata: { user_id: userId },
      },
    });
    const procUnanchored = await processor.processEvent(unanchoredVal.normalizedEvent!);
    assert(
      !procUnanchored.success && procUnanchored.reconciliationRequired === true && procUnanchored.errorCode === 'RECONCILIATION_REQUIRED',
      'Webhook externo sem attemptId/subscription/order confiável retorna RECONCILIATION_REQUIRED sem ativar PRO'
    );

    // subscription_created NÃO ativa PRO
    const subCreatedVal = signAndValidate({
      event: 'subscription_created',
      id: 'evt_sub_created_01',
      data: {
        id: 'ord_sub_created_01',
        sck: attemptId,
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'pix_auto',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
        subscription: { id: 'sub_cakto_01' },
      },
    });
    const procCreated = await processor.processEvent(subCreatedVal.normalizedEvent!);
    assert(procCreated.success && procCreated.resultingSubscriptionStatus === 'RENEWAL_PENDING', 'subscription_created registra vínculo sem ativar PRO');

    // Aprovação com pix_auto (testando também payload data como array!) -> ACTIVE
    const t0 = new Date().toISOString();
    const approveVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_approve_01',
      createdAt: t0,
      data: [
        {
          id: 'ord_ok_01',
          sck: attemptId,
          amount: 34.9,
          currency: 'BRL',
          paymentMethod: 'pix_auto',
          product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
          offer: { id: CAKTO_OFFICIAL_OFFER_ID },
          subscription: { id: 'sub_cakto_01' },
          customer: { email: userEmail },
        },
      ],
    });
    assert(approveVal.accepted && approveVal.normalizedEvent?.amountCents === 3490, 'Webhook purchase_approved (array data) validado com 3490 centavos');

    const proc1 = await processor.processEvent(approveVal.normalizedEvent!);
    assert(proc1.success && proc1.resultingSubscriptionStatus === 'ACTIVE', 'Transição para ACTIVE (UPPERCASE) no banco');

    const subActive = await subService.getUserSubscriptionStatus({ userId, userEmail });
    assert(subActive.status === 'ACTIVE' && subActive.hasProAccess === true && subActive.paymentMethod === 'Pix Automático', 'SubscriptionService retorna ACTIVE com Pix Automático');

    // Idempotência do mesmo eventId
    const procDup = await processor.processEvent(approveVal.normalizedEvent!);
    assert(procDup.success && procDup.duplicate === true, 'Reenvio idempotente retorna duplicate: true sem reprocessar');

    // refund_requested NÃO revoga acesso nem marca REFUNDED
    const t1 = new Date(Date.now() + 1000).toISOString();
    const refundReqVal = signAndValidate({
      event: 'refund_requested',
      id: 'evt_refund_req_01',
      createdAt: t1,
      data: { id: 'ord_ok_01', subscription: { id: 'sub_cakto_01' }, paymentMethod: 'pix_auto', amount: 34.9, currency: 'BRL' },
    });
    const procRefundReq = await processor.processEvent(refundReqVal.normalizedEvent!);
    assert(procRefundReq.success && procRefundReq.resultingSubscriptionStatus === 'ACTIVE', 'refund_requested mantém ACTIVE sem revogação prematura');

    // Atraso -> PAST_DUE (carência 3 dias)
    const t2 = new Date(Date.now() + 2000).toISOString();
    const lateVal = signAndValidate({
      event: 'subscription_late',
      id: 'evt_late_01',
      createdAt: t2,
      data: { id: 'ord_ok_01', subscription: { id: 'sub_cakto_01' }, paymentMethod: 'credit_card', amount: 34.9, currency: 'BRL' },
    });
    const procLate = await processor.processEvent(lateVal.normalizedEvent!);
    assert(procLate.resultingSubscriptionStatus === 'PAST_DUE', 'Transição subscription_late -> PAST_DUE');

    // Recuperação -> ACTIVE
    const t3 = new Date(Date.now() + 3000).toISOString();
    const recoverVal = signAndValidate({
      event: 'subscription_late_recovered',
      id: 'evt_recover_01',
      createdAt: t3,
      data: { id: 'ord_ok_recover', subscription: { id: 'sub_cakto_01' }, paymentMethod: 'credit_card', amount: 34.9, currency: 'BRL' },
    });
    const procRecover = await processor.processEvent(recoverVal.normalizedEvent!);
    assert(procRecover.resultingSubscriptionStatus === 'ACTIVE', 'Transição subscription_late_recovered -> ACTIVE');

    // Renovação -> ACTIVE
    const t4 = new Date(Date.now() + 4000).toISOString();
    const renewVal = signAndValidate({
      event: 'subscription_renewed',
      id: 'evt_renew_01',
      createdAt: t4,
      data: { id: 'ord_ok_02', subscription: { id: 'sub_cakto_01' }, paymentMethod: 'credit_card', amount: 34.9, currency: 'BRL' },
    });
    const procRenew = await processor.processEvent(renewVal.normalizedEvent!);
    assert(procRenew.resultingSubscriptionStatus === 'ACTIVE', 'Transição subscription_renewed -> ACTIVE');

    // Cancelamento pelo usuário chama Cakto, atualiza para CANCELED e PRESERVA acesso até current_period_end
    const cancelRes = await subService.cancelUserSubscription(userId);
    assert(cancelRes.success && cancelCalledOnCakto, 'Cancelamento aciona API Cakto e atualiza status para CANCELED');
    const subAfterCancel = await subService.getUserSubscriptionStatus({ userId, userEmail });
    assert(
      subAfterCancel.status === 'CANCELED' && subAfterCancel.hasProAccess === true && subAfterCancel.cancelAtPeriodEnd === true,
      'Após cancelamento voluntário, usuário mantém acesso PRO até o término do período já pago'
    );

    // Reembolso efetivado -> CANCELED + REFUNDED no ledger + revogação imediata
    const t5 = new Date(Date.now() + 5000).toISOString();
    const refundVal = signAndValidate({
      event: 'refund',
      id: 'evt_refund_01',
      createdAt: t5,
      data: { id: 'ord_ok_02', subscription: { id: 'sub_cakto_01' }, paymentMethod: 'credit_card', amount: 34.9, currency: 'BRL' },
    });
    const procRefund = await processor.processEvent(refundVal.normalizedEvent!);
    assert(procRefund.resultingSubscriptionStatus === 'CANCELED', 'Refund efetivado revoga assinatura');
    const subAfterRefund = await subService.getUserSubscriptionStatus({ userId, userEmail });
    assert(subAfterRefund.hasProAccess === false, 'Acesso PRO revogado imediatamente após refund efetivado');

    // Chargeback -> SUSPENDED + revogação imediata
    const t6 = new Date(Date.now() + 6000).toISOString();
    const cbVal = signAndValidate({
      event: 'chargeback',
      id: 'evt_cb_01',
      createdAt: t6,
      data: { id: 'ord_ok_02', subscription: { id: 'sub_cakto_01' }, paymentMethod: 'credit_card', amount: 34.9, currency: 'BRL' },
    });
    const procCb = await processor.processEvent(cbVal.normalizedEvent!);
    assert(procCb.resultingSubscriptionStatus === 'SUSPENDED', 'Chargeback marca assinatura como SUSPENDED');
    const subAfterCb = await subService.getUserSubscriptionStatus({ userId, userEmail });
    assert(subAfterCb.hasProAccess === false && subAfterCb.status === 'SUSPENDED', 'Chargeback revoga acesso imediatamente sem re-grant de trial');

    // Reconciliação ativa ignora Pix avulso e aprova Cartão válido
    const recUser = '33333333-3333-4333-8333-333333333333';
    mockOrdersPayload = [
      { id: 'ord_rec_pix', amount: 34.9, currency: 'BRL', paymentMethod: 'pix', status: 'paid', customer: { email: 'rec@fatosbr.com.br' } },
      { id: 'ord_rec_card', amount: 34.9, currency: 'BRL', paymentMethod: 'credit_card', status: 'paid', customer: { email: 'rec@fatosbr.com.br' }, subscription: { id: 'sub_rec_1' } },
    ];
    const reconciler = new BillingReconciliationService(() => store, processor);
    const recResult = await reconciler.reconcileUser({ userId: recUser, userEmail: 'rec@fatosbr.com.br' });
    assert(
      recResult.rejectedProhibitedCount === 1 && recResult.reconciledCount === 1,
      'Reconciliação rejeita 1 pedido Pix avulso e concilia 1 pedido Cartão válido'
    );
    const recSub = await subService.getUserSubscriptionStatus({ userId: recUser, userEmail: 'rec@fatosbr.com.br' });
    assert(recSub.status === 'ACTIVE', 'Usuário reconciliado ativado para ACTIVE via pedido válido');

    // Usuário já assinante ativo não pode abrir novo checkout (HTTP 409)
    const alreadyActiveCheckout = await checkoutService.initiateCheckout({
      userId: recUser,
      userEmail: 'rec@fatosbr.com.br',
      planId: 'pro',
      requestedMethod: 'credit_card',
    });
    assert(
      alreadyActiveCheckout.httpStatus === 409 && alreadyActiveCheckout.result.errorCode === 'SUBSCRIPTION_ALREADY_ACTIVE',
      'Usuário já assinante ativo recebe HTTP 409 SUBSCRIPTION_ALREADY_ACTIVE ao tentar novo checkout'
    );

    // Reconciliação bloqueia tentativa de usar providerOrderId pertencente a outro usuário
    mockOrdersPayload = [
      { id: 'ord_foreign_user', amount: 34.9, currency: 'BRL', paymentMethod: 'credit_card', status: 'paid', customer: { email: 'outro@fatosbr.com.br' } },
    ];
    const attackerUser = '44444444-4444-4444-8444-444444444444';
    const crossUserRec = await reconciler.reconcileUser({
      userId: attackerUser,
      userEmail: 'atacante@fatosbr.com.br',
      providerOrderId: 'ord_foreign_user',
    });
    assert(
      crossUserRec.reconciledCount === 0,
      'Reconciliação bloqueia providerOrderId pertencente a outro e-mail/usuário'
    );

    // Trial expirado (> 7 dias) retorna TRIAL_EXPIRED com hasProAccess=false
    const expiredTrialSub = await subService.getUserSubscriptionStatus({
      userId: attackerUser,
      userEmail: 'atacante@fatosbr.com.br',
      userCreatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    assert(
      expiredTrialSub.status === 'TRIAL_EXPIRED' && expiredTrialSub.hasProAccess === false,
      'Trial de usuário criado há > 7 dias retorna TRIAL_EXPIRED sem acesso PRO'
    );

    // Cobrança recusada (purchase_refused) -> PAYMENT_REFUSED sem liberar PRO
    const refusedUser = '55555555-5555-4555-8555-555555555555';
    const refusedCheckout = await checkoutService.initiateCheckout({
      userId: refusedUser,
      userEmail: 'recusado@fatosbr.com.br',
      planId: 'pro',
      requestedMethod: 'credit_card',
    });
    const refusedVal = signAndValidate({
      event: 'purchase_refused',
      id: 'evt_refused_01',
      createdAt: new Date(Date.now() + 7000).toISOString(),
      data: {
        id: 'ord_refused_01',
        sck: refusedCheckout.result.attemptId,
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'credit_card',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
      },
    });
    const procRefused = await processor.processEvent(refusedVal.normalizedEvent!);
    const subRefused = await subService.getUserSubscriptionStatus({ userId: refusedUser, userEmail: 'recusado@fatosbr.com.br' });
    assert(
      procRefused.success && subRefused.status === 'PAYMENT_REFUSED' && subRefused.hasProAccess === false,
      'purchase_refused marca PAYMENT_REFUSED sem liberar acesso PRO'
    );

    // next_payment_date do provedor ancora current_period_end (sem somar 30 dias aleatórios)
    const exactNextPayment = '2027-03-15T12:00:00.000Z';
    const nextPayUser = '66666666-6666-4666-8666-666666666666';
    const nextPayCheckout = await checkoutService.initiateCheckout({
      userId: nextPayUser,
      userEmail: 'periodo@fatosbr.com.br',
      planId: 'pro',
      requestedMethod: 'pix_auto',
    });
    const nextPayVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_next_pay_01',
      createdAt: new Date(Date.now() + 8000).toISOString(),
      data: {
        id: 'ord_next_pay_01',
        sck: nextPayCheckout.result.attemptId,
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'pix_auto',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
        subscription: { id: 'sub_next_pay_01', next_payment_date: exactNextPayment },
      },
    });
    await processor.processEvent(nextPayVal.normalizedEvent!);
    const nextPaySubRow = await store.findSubscriptionByUserId(nextPayUser);
    assert(
      nextPaySubRow?.current_period_end === exactNextPayment && nextPaySubRow?.next_billing_at === exactNextPayment,
      'Webhook usa next_payment_date confirmado do provedor para ancorar current_period_end e next_billing_at'
    );

    // Fail-closed quando banco falha (SubscriptionService lança SubscriptionVerificationUnavailableError)
    store.throwOnFindSubscription = true;
    let threwUnavailable = false;
    try {
      await subService.getUserSubscriptionStatus({ userId, userEmail });
    } catch (e: any) {
      threwUnavailable = e instanceof SubscriptionVerificationUnavailableError || e?.code === 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE';
    } finally {
      store.throwOnFindSubscription = false;
    }
    assert(threwUnavailable, 'SubscriptionService falha fechado (SUBSCRIPTION_VERIFICATION_UNAVAILABLE) em erro de banco sem conceder trial');

    // Garantir ausência de rotas falsas de simulação
    const mockRes = { statusCode: 200, headers: {} as any, body: '', setHeader() {}, end(d: string) { this.body = d; } };
    await paymentsRouter({ method: 'POST', url: '/api/payments/simulate', headers: {} } as any, mockRes as any);
    assert(mockRes.statusCode === 404, 'Rota inexistente /api/payments/simulate retorna HTTP 404');
  } finally {
    globalThis.fetch = originalFetch;
    setPaymentsPersistenceAdapter(null);
    setTestRateLimiterStore(null as any);
  }

  console.log('\n------------------------------------------------------');
  console.log(`📊 PAYMENTS V1.1 CAKTO: ${passed} passaram, ${failed} falharam.`);
  console.log('------------------------------------------------------\n');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Erro fatal nos testes Payments V1.1:', err);
  process.exit(1);
});
