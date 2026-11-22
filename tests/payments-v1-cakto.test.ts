/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR PAYMENTS V1 — SUÍTE DE TESTES UNITÁRIOS & INTEGRAÇÃO CAKTO
 *
 * Valida com mocks de HTTP e Store em memória:
 * 1. Plano pago único FatosBR PRO (R$ 34,90 / 3490 centavos BRL, ciclo 30 dias, 0 trial na Cakto, 7 dias no SaaS).
 * 2. IDs oficiais imutáveis (product c8731178-55c9-47f6-8b98-987f31206ed8, offer vjw92gx, checkout 1356033).
 * 3. Travas comerciais obrigatórias:
 *    - CAKTO_COMMERCIAL_ENABLED=false -> bloqueia (CAKTO_CHECKOUT_COMMERCIAL_BLOCKED)
 *    - CAKTO_METHODS_VERIFIED=false -> bloqueia (CAKTO_PAYMENT_METHODS_NOT_VERIFIED)
 *    - oferta disabled / produto waiting_config -> bloqueia (CAKTO_CHECKOUT_COMMERCIAL_BLOCKED)
 *    - oferta com pix avulso ativo na Cakto -> bloqueia (CAKTO_DISALLOWED_PAYMENT_METHOD_ENABLED)
 * 4. Bloqueio de métodos proibidos (pix avulso, boleto, picpay) no checkout E no webhook/reconciliação.
 * 5. Fluxo completo quando habilitado + métodos exclusivamente credit_card & pix_auto.
 * 6. Ciclo de vida completo da assinatura via webhook HMAC + replay protection + idempotência + cancelamento + reconciliação.
 * 7. Ausência de qualquer endpoint de simulação ou ativação gratuita de PRO.
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
import { SubscriptionService } from '../api/_lib/payments/SubscriptionService.js';
import { WebhookVerificationService } from '../api/_lib/payments/WebhookVerificationService.js';
import {
  PaymentsPersistenceAdapter,
  DbSubscriptionRow,
  DbAttemptRow,
  setPaymentsPersistenceAdapter,
} from '../api/_lib/payments/PaymentsStore.js';
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

  async findSubscriptionByUserId(userId: string) {
    return this.subscriptions.get(userId) || null;
  }
  async findSubscriptionByProviderSubId(providerSubId: string) {
    for (const row of this.subscriptions.values()) {
      if (row.provider_subscription_id === providerSubId) return row;
    }
    return null;
  }
  async findUserByEmail(email: string) {
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
    this.events.set(key, {
      id: crypto.randomUUID(),
      provider: params.provider,
      provider_event_id: params.providerEventId,
      event_type: params.eventType,
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
  async upsertPaymentLedgerRecord(params: any) {
    this.payments.set(params.providerPaymentId, {
      id: crypto.randomUUID(),
      ...params,
      created_at: new Date().toISOString(),
    });
  }
  async listUserBillingHistory(userId: string) {
    return Array.from(this.payments.values()).filter((p) => p.userId === userId);
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
  console.log('💳 FATOSBR PAYMENTS V1 — SUÍTE CAKTO & ASSINATURAS');
  console.log('======================================================\n');

  const store = new MemoryPaymentsStore();
  setPaymentsPersistenceAdapter(store);
  setTestRateLimiterStore({
    checkAndIncrement: async () => ({ allowed: true, current: 1, limit: 100, retry_after: 0, remaining: 99 }),
  });

  const userId = '22222222-2222-4222-8222-222222222222';
  const userEmail = 'assinante@fatosbr.com.br';
  store.usersByEmail.set(userEmail, { id: userId, email: userEmail });

  setTestSupabaseClient({
    auth: {
      getUser: async (token: string) => ({
        data: {
          user: token === 'valid_user'
            ? { id: userId, email: userEmail, created_at: new Date().toISOString(), app_metadata: {}, user_metadata: { full_name: 'Assinante PRO' } }
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

  // Rejeição de método proibido antes mesmo de criar tentativa
  const blockedPixAvulso = await checkoutService.initiateCheckout({ userId, userEmail, planId: 'pro', requestedMethod: 'pix' });
  assert(blockedPixAvulso.httpStatus === 400 && blockedPixAvulso.result.errorCode === 'PAYMENT_METHOD_NOT_ALLOWED', 'Bloqueia explicitamente pix avulso');

  // Simular oferta Cakto com pix avulso ativo na resposta da API -> trava automática
  process.env.CAKTO_METHODS_VERIFIED = 'true';
  const originalFetch = globalThis.fetch;
  let mockOfferPayload: any = { id: 'vjw92gx', status: 'active', paymentMethods: ['credit_card', 'pix'] };
  let mockProductPayload: any = { id: CAKTO_OFFICIAL_PRODUCT_ID, status: 'active' };
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

    mockOfferPayload = { id: 'vjw92gx', status: 'disabled', paymentMethods: ['credit_card', 'pix_auto'] };
    const blockedDisabledOffer = await checkoutService.initiateCheckout({ userId, userEmail, planId: 'pro', requestedMethod: 'credit_card' });
    assert(
      blockedDisabledOffer.httpStatus === 423 && blockedDisabledOffer.result.errorCode === 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
      'Bloqueia quando oferta está disabled na Cakto'
    );

    // 3. Fluxo liberado apenas com oferta ativa + métodos exclusivamente credit_card e pix_auto
    mockOfferPayload = { id: 'vjw92gx', status: 'active', paymentMethods: ['credit_card', 'pix_auto'] };
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
      'Libera checkout Cakto vjw92gx com attemptId UUID quando oferta ativa e somente credit_card/pix_auto'
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

    // Aprovação com pix_auto -> active
    const approveVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_approve_01',
      data: {
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
    });
    assert(approveVal.accepted && approveVal.normalizedEvent?.amountCents === 3490, 'Webhook purchase_approved validado com 3490 centavos');

    const proc1 = await processor.processEvent(approveVal.normalizedEvent!);
    assert(proc1.success && proc1.resultingSubscriptionStatus === 'active', 'Transição para active no banco');

    const subActive = await subService.getUserSubscriptionStatus({ userId, userEmail });
    assert(subActive.status === 'ACTIVE' && subActive.hasProAccess === true && subActive.paymentMethod === 'Pix Automático', 'SubscriptionService retorna ACTIVE com Pix Automático');

    // Idempotência do mesmo eventId
    const procDup = await processor.processEvent(approveVal.normalizedEvent!);
    assert(procDup.success && procDup.duplicate === true, 'Reenvio idempotente retorna duplicate: true sem reprocessar');

    // Atraso -> past_due (carência 3 dias)
    const lateVal = signAndValidate({
      event: 'subscription_late',
      id: 'evt_late_01',
      data: { id: 'ord_ok_01', subscription: { id: 'sub_cakto_01' }, paymentMethod: 'credit_card', amount: 34.9, currency: 'BRL' },
    });
    const procLate = await processor.processEvent(lateVal.normalizedEvent!);
    assert(procLate.resultingSubscriptionStatus === 'past_due', 'Transição subscription_late -> past_due');

    // Renovação -> active
    const renewVal = signAndValidate({
      event: 'subscription_renewed',
      id: 'evt_renew_01',
      data: { id: 'ord_ok_02', subscription: { id: 'sub_cakto_01' }, paymentMethod: 'credit_card', amount: 34.9, currency: 'BRL' },
    });
    const procRenew = await processor.processEvent(renewVal.normalizedEvent!);
    assert(procRenew.resultingSubscriptionStatus === 'active', 'Transição subscription_renewed -> active');

    // Cancelamento pelo usuário chama Cakto e atualiza local
    const cancelRes = await subService.cancelUserSubscription(userId);
    assert(cancelRes.success && cancelCalledOnCakto, 'Cancelamento aciona API Cakto e atualiza status para canceled');

    // Reembolso -> canceled + REFUNDED no ledger
    const refundVal = signAndValidate({
      event: 'refund',
      id: 'evt_refund_01',
      data: { id: 'ord_ok_02', subscription: { id: 'sub_cakto_01' }, paymentMethod: 'credit_card', amount: 34.9, currency: 'BRL' },
    });
    const procRefund = await processor.processEvent(refundVal.normalizedEvent!);
    assert(procRefund.resultingSubscriptionStatus === 'canceled', 'Refund revoga assinatura para canceled');
    const subAfterRefund = await subService.getUserSubscriptionStatus({ userId, userEmail });
    assert(subAfterRefund.hasProAccess === false, 'Acesso PRO revogado imediatamente após refund');

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

    // 5. Garantir ausência de rotas falsas de simulação
    const mockRes = { statusCode: 200, headers: {} as any, body: '', setHeader() {}, end(d: string) { this.body = d; } };
    await paymentsRouter({ method: 'POST', url: '/api/payments/simulate', headers: {} } as any, mockRes as any);
    assert(mockRes.statusCode === 404, 'Rota inexistente /api/payments/simulate retorna HTTP 404');
  } finally {
    globalThis.fetch = originalFetch;
    setPaymentsPersistenceAdapter(null);
    setTestRateLimiterStore(null as any);
  }

  console.log('\n------------------------------------------------------');
  console.log(`📊 PAYMENTS V1 CAKTO: ${passed} passaram, ${failed} falharam.`);
  console.log('------------------------------------------------------\n');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Erro fatal nos testes Payments V1:', err);
  process.exit(1);
});
