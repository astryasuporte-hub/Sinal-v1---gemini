/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CaktoPaymentProvider — Implementação Oficial Cakto para FatosBR Payments V1.1
 *
 * Regras Inegociáveis:
 * 1. Plano pago único: FatosBR PRO — R$ 34,90/mês (3490 centavos BRL).
 * 2. Produto oficial: c8731178-55c9-47f6-8b98-987f31206ed8
 *    Oferta oficial:  vjw92gx
 *    Checkout ID:     1356033 (https://pay.cakto.com.br/vjw92gx)
 * 3. NUNCA cria novos produtos, ofertas ou checkouts na Cakto.
 * 4. NUNCA ativa oferta/produto remotamente e NUNCA libera checkout quando:
 *    - CAKTO_COMMERCIAL_ENABLED !== 'true'
 *    - CAKTO_METHODS_VERIFIED !== 'true'
 *    - oferta/checkout estiver disabled ou produto em waiting_config na Cakto
 *    - ambos credit_card e pix_auto não estiverem habilitados
 *    - método proibido (pix avulso, boleto, picpay etc.) estiver ativo
 *    - trial_days da oferta/checkout for diferente de 0
 * 5. Webhook HMAC-SHA256 com x-cakto-timestamp obrigatório (<= 300s), timingSafeEqual e eventHash.
 */

import crypto from 'crypto';
import {
  ALLOWED_CAKTO_METHODS,
  PROHIBITED_PAYMENT_METHODS,
  isAllowedPaymentMethod,
  isProhibitedPaymentMethod,
  normalizePaymentMethod,
  resolvePlanPrice,
} from '../plans.js';
import { safeCompare } from '../crypto.js';
import { CaktoClient, caktoClient } from './CaktoClient.js';
import type { PaymentProvider, WebhookVerificationOutcome } from './PaymentProvider.js';
import type {
  CanonicalWebhookAction,
  CheckoutCommercialReadiness,
  CheckoutSessionInput,
  CheckoutSessionResult,
  NormalizedPaymentWebhookEvent,
  ProviderCancelResult,
  ProviderReconcileOrder,
} from './types.js';

const WEBHOOK_MAX_AGE_SECONDS = 300;

export function normalizeCaktoAmountToCents(rawAmount: unknown): number | undefined {
  if (rawAmount === null || rawAmount === undefined || rawAmount === '') return undefined;
  const num = Number(rawAmount);
  if (!Number.isFinite(num) || num <= 0) return undefined;

  if (Number.isInteger(num) && num >= 100) {
    return num;
  }
  return Math.round(num * 100);
}

function extractMethodsFromContainer(container: any): string[] {
  if (!container || typeof container !== 'object') return [];
  const rawList: unknown[] = [];

  if (Array.isArray(container.paymentMethods)) rawList.push(...container.paymentMethods);
  if (Array.isArray(container.payment_methods)) rawList.push(...container.payment_methods);
  if (Array.isArray(container.allowed_methods)) rawList.push(...container.allowed_methods);
  if (Array.isArray(container.methods)) rawList.push(...container.methods);

  if (container.pix === true || container.accepts_pix === true) rawList.push('pix');
  if (container.boleto === true || container.accepts_boleto === true) rawList.push('boleto');
  if (container.picpay === true || container.accepts_picpay === true) rawList.push('picpay');
  if (container.credit_card === true || container.accepts_credit_card === true) rawList.push('credit_card');
  if (
    container.pix_auto === true ||
    container.accepts_pix_auto === true ||
    container.pix_automatico === true
  ) {
    rawList.push('pix_auto');
  }

  return Array.from(
    new Set(
      rawList
        .map((m) => normalizePaymentMethod(String(m)))
        .filter((m) => m && m !== 'unknown')
    )
  );
}

function parseIsoOrNull(val: unknown): string | undefined {
  if (!val) return undefined;
  const s = String(val).trim();
  if (!s) return undefined;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

export class CaktoPaymentProvider implements PaymentProvider {
  readonly id = 'cakto' as const;
  readonly displayName = 'Cakto Assinaturas (FatosBR PRO)';

  constructor(private readonly client: CaktoClient = caktoClient) {}

  async getCommercialReadiness(): Promise<CheckoutCommercialReadiness> {
    const plan = resolvePlanPrice('pro');
    const commercialEnabled =
      String(process.env.CAKTO_COMMERCIAL_ENABLED || 'false').trim().toLowerCase() === 'true';
    const methodsVerified =
      String(process.env.CAKTO_METHODS_VERIFIED || 'false').trim().toLowerCase() === 'true';

    if (!commercialEnabled) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage:
          'Checkout Cakto bloqueado comercialmente até liberação explícita (oferta em espera / CAKTO_COMMERCIAL_ENABLED=false).',
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      };
    }

    if (!methodsVerified) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_PAYMENT_METHODS_NOT_VERIFIED',
        blockedMessage:
          'Métodos de pagamento da oferta Cakto ainda não verificados (exigido Cartão de Crédito + Pix Automático; Pix avulso proibido).',
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      };
    }

    if (!this.client.isConfigured()) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CREDENTIALS_MISSING',
        blockedMessage: 'Credenciais OAuth2 da Cakto (CAKTO_CLIENT_ID / CAKTO_CLIENT_SECRET) ausentes.',
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      };
    }

    const [offerRes, productRes, checkoutRes] = await Promise.all([
      this.client.getOffer(plan.offerId),
      this.client.getProduct(plan.productId),
      this.client.getCheckout(plan.checkoutId),
    ]);

    if (!offerRes.ok || !productRes.ok || (!checkoutRes.ok && checkoutRes.status !== 404)) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Não foi possível validar o status comercial da oferta ${plan.offerId} / checkout ${plan.checkoutId} na Cakto (${offerRes.error || productRes.error || checkoutRes.error || 'erro upstream'}).`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      };
    }

    const offerData = offerRes.data?.data || offerRes.data || {};
    const productData = productRes.data?.data || productRes.data || {};
    const checkoutData = checkoutRes.ok
      ? checkoutRes.data?.data || checkoutRes.data || {}
      : offerData?.checkout && typeof offerData.checkout === 'object'
      ? offerData.checkout
      : null;

    const offerStatus = String(offerData.status || (offerData.active === false ? 'disabled' : 'active')).toLowerCase();
    const productStatus = String(productData.status || 'unknown').toLowerCase();
    const checkoutStatus = checkoutData
      ? String(checkoutData.status || (checkoutData.active === false ? 'disabled' : 'active')).toLowerCase()
      : 'embedded_not_exposed';

    const offerTrialDays = Number.isFinite(Number(offerData.trial_days ?? 0)) ? Number(offerData.trial_days ?? 0) : 0;
    const checkoutTrialDays = Number.isFinite(Number(checkoutData?.trial_days ?? 0)) ? Number(checkoutData?.trial_days ?? 0) : 0;
    const trialDays = offerTrialDays !== 0 ? offerTrialDays : checkoutTrialDays;

    if (
      offerStatus === 'disabled' ||
      offerStatus === 'inactive' ||
      productStatus === 'waiting_config' ||
      checkoutStatus === 'disabled' ||
      checkoutStatus === 'inactive'
    ) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Oferta '${plan.offerId}' (${offerStatus}), produto '${plan.productId}' (${productStatus}) ou checkout '${plan.checkoutId}' (${checkoutStatus}) não está liberado comercialmente.`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
        offerStatus,
        productStatus,
        checkoutStatus,
        trialDays,
      };
    }

    if (offerTrialDays !== 0 || checkoutTrialDays !== 0) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Oferta/checkout Cakto configurado com trial_days=${trialDays}. O trial de 7 dias sem cartão pertence exclusivamente ao SaaS (exigido trial_days=0 na Cakto).`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
        offerStatus,
        productStatus,
        checkoutStatus,
        trialDays,
      };
    }

    const offerMethods = extractMethodsFromContainer(offerData);
    const checkoutMethods = extractMethodsFromContainer(checkoutData);
    const detectedMethods = Array.from(new Set([...offerMethods, ...checkoutMethods]));

    const hasProhibited = detectedMethods.some((m) => isProhibitedPaymentMethod(m));
    const hasAllAllowed = ALLOWED_CAKTO_METHODS.every((m) => detectedMethods.includes(m));
    const checkoutConflict =
      checkoutMethods.length > 0 && !ALLOWED_CAKTO_METHODS.every((m) => checkoutMethods.includes(m));

    if (hasProhibited || !hasAllAllowed || checkoutConflict) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_DISALLOWED_PAYMENT_METHOD_ENABLED',
        blockedMessage: hasProhibited
          ? `Oferta/checkout Cakto possui método proibido habilitado (${detectedMethods.filter((m) => isProhibitedPaymentMethod(m)).join(', ')}). Apenas credit_card e pix_auto são permitidos.`
          : `Oferta/checkout Cakto precisa ter ambos os métodos credit_card e pix_auto ativos (detectado: ${detectedMethods.join(', ') || 'nenhum'}).`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
        detectedProviderMethods: detectedMethods,
        offerStatus,
        productStatus,
        checkoutStatus,
        trialDays,
      };
    }

    return {
      ready: true,
      commercialEnabled,
      methodsVerified,
      allowedMethods: ALLOWED_CAKTO_METHODS,
      prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      detectedProviderMethods: detectedMethods,
      offerStatus,
      productStatus,
      checkoutStatus,
      trialDays,
    };
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const plan = resolvePlanPrice(input.planId);

    if (input.requestedMethod && isProhibitedPaymentMethod(input.requestedMethod)) {
      return {
        success: false,
        blocked: true,
        errorCode: 'PAYMENT_METHOD_NOT_ALLOWED',
        error: `O método '${input.requestedMethod}' não é permitido. Utilize Cartão de Crédito ou Pix Automático.`,
        attemptId: input.attemptId,
        provider: this.id,
        productId: plan.productId,
        offerId: plan.offerId,
        checkoutId: plan.checkoutId,
        amountCents: plan.amountCents,
        currency: 'BRL',
        allowedMethods: plan.allowedMethods,
      };
    }

    const readiness = await this.getCommercialReadiness();
    if (!readiness.ready) {
      return {
        success: false,
        blocked: true,
        errorCode: readiness.blockedReasonCode || 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        error: readiness.blockedMessage || 'Checkout comercialmente bloqueado até verificação na Cakto.',
        attemptId: input.attemptId,
        provider: this.id,
        productId: plan.productId,
        offerId: plan.offerId,
        checkoutId: plan.checkoutId,
        amountCents: plan.amountCents,
        currency: 'BRL',
        allowedMethods: plan.allowedMethods,
      };
    }

    const url = new URL(plan.checkoutBaseUrl);
    url.searchParams.set('sck', input.attemptId);
    url.searchParams.set('external_id', input.attemptId);
    if (input.userEmail) {
      url.searchParams.set('email', input.userEmail);
    }
    if (input.userName) {
      url.searchParams.set('name', input.userName);
    }
    if (input.requestedMethod && isAllowedPaymentMethod(input.requestedMethod)) {
      url.searchParams.set('paymentMethod', normalizePaymentMethod(input.requestedMethod));
    }

    return {
      success: true,
      blocked: false,
      attemptId: input.attemptId,
      provider: this.id,
      checkoutUrl: url.toString(),
      productId: plan.productId,
      offerId: plan.offerId,
      checkoutId: plan.checkoutId,
      amountCents: plan.amountCents,
      currency: 'BRL',
      allowedMethods: plan.allowedMethods,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    };
  }

  verifyWebhookSignature(params: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
  }): WebhookVerificationOutcome {
    const secret = (process.env.CAKTO_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      return {
        valid: false,
        errorCode: 'WEBHOOK_SECRET_NOT_CONFIGURED',
        reason: 'CAKTO_WEBHOOK_SECRET ausente no servidor (fail-closed).',
      };
    }

    const normalizedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(params.headers || {})) {
      if (v !== undefined) {
        normalizedHeaders[k.toLowerCase()] = Array.isArray(v) ? String(v[0] || '') : String(v);
      }
    }

    const sigHeader = (
      normalizedHeaders['x-cakto-signature'] ||
      normalizedHeaders['x-signature'] ||
      ''
    ).trim();

    if (!sigHeader) {
      return {
        valid: false,
        errorCode: 'MISSING_SIGNATURE',
        reason: 'Cabeçalho x-cakto-signature ausente.',
      };
    }

    const tsHeader = (normalizedHeaders['x-cakto-timestamp'] || '').trim();
    if (!tsHeader) {
      return {
        valid: false,
        errorCode: 'MISSING_TIMESTAMP',
        reason: 'Cabeçalho x-cakto-timestamp obrigatório para proteção anti-replay.',
      };
    }

    const tsNum = Number(tsHeader);
    const tsMs = Number.isFinite(tsNum)
      ? tsNum > 1e12
        ? tsNum
        : tsNum * 1000
      : Date.parse(tsHeader);

    if (!Number.isFinite(tsMs)) {
      return {
        valid: false,
        errorCode: 'INVALID_TIMESTAMP',
        reason: 'Cabeçalho x-cakto-timestamp inválido.',
      };
    }

    const ageSeconds = Math.abs(Date.now() - tsMs) / 1000;
    if (ageSeconds > WEBHOOK_MAX_AGE_SECONDS) {
      return {
        valid: false,
        errorCode: 'WEBHOOK_REPLAY_EXPIRED',
        reason: `Timestamp do webhook excedeu a janela máxima de ${WEBHOOK_MAX_AGE_SECONDS}s (${Math.round(ageSeconds)}s).`,
      };
    }

    const providedHex = sigHeader.startsWith('v1=') ? sigHeader.slice(3).trim() : sigHeader;
    const signedPayload = `${tsHeader}.${params.rawBody}`;
    const expectedHmac = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    if (!safeCompare(providedHex, expectedHmac)) {
      return {
        valid: false,
        errorCode: 'INVALID_SIGNATURE',
        reason: 'Assinatura HMAC Cakto inválida.',
      };
    }

    try {
      const parsedBody = JSON.parse(params.rawBody);
      if (parsedBody && typeof parsedBody === 'object' && parsedBody.secret !== undefined) {
        if (!safeCompare(String(parsedBody.secret), secret)) {
          return {
            valid: false,
            errorCode: 'INVALID_WEBHOOK_SECRET',
            reason: 'Campo secret do payload Cakto diverge do segredo configurado.',
          };
        }
      }
    } catch {
      return {
        valid: false,
        errorCode: 'INVALID_PAYLOAD',
        reason: 'Payload JSON inválido na verificação de assinatura.',
      };
    }

    const eventHash = crypto.createHash('sha256').update(signedPayload).digest('hex');
    return {
      valid: true,
      timestampIso: new Date(tsMs).toISOString(),
      eventHash,
    };
  }

  parseWebhookEvent(rawPayload: Record<string, any>): NormalizedPaymentWebhookEvent {
    const eventType = String(rawPayload?.event || rawPayload?.type || 'unknown')
      .trim()
      .toLowerCase();

    const rawData = rawPayload?.data;
    const data = Array.isArray(rawData)
      ? rawData[0] && typeof rawData[0] === 'object'
        ? rawData[0]
        : rawPayload
      : rawData && typeof rawData === 'object'
      ? rawData
      : rawPayload;

    const providerEventId = String(
      rawPayload?.event_id ||
        rawPayload?.eventId ||
        rawPayload?.id ||
        `${eventType}:${data?.id || data?.order_id || data?.subscription?.id || Date.now()}`
    ).trim();

    const productId = String(data?.product?.id || data?.product_id || data?.productId || '').trim() || undefined;
    const offerId = String(data?.offer?.id || data?.offer_id || data?.offerId || '').trim() || undefined;
    const checkoutId = String(data?.checkout || data?.checkout_id || data?.checkoutId || '').trim() || undefined;

    const rawMethod =
      data?.paymentMethod ||
      data?.payment_method ||
      data?.method ||
      data?.payment?.method ||
      data?.subscription?.paymentMethod ||
      '';
    const paymentMethod = normalizePaymentMethod(String(rawMethod));

    const amountCents = normalizeCaktoAmountToCents(
      data?.amount_cents ?? data?.amountCents ?? data?.amount ?? data?.paidAmount ?? data?.offer?.price
    );
    const currency = String(data?.currency || 'BRL').trim().toUpperCase();

    const attemptId =
      String(
        data?.sck ||
          data?.external_id ||
          data?.externalId ||
          data?.metadata?.attempt_id ||
          data?.metadata?.attemptId ||
          ''
      ).trim() || undefined;

    const userId =
      String(data?.metadata?.user_id || data?.metadata?.userId || '').trim() || undefined;

    const customerEmail =
      String(data?.customer?.email || data?.customerEmail || data?.email || '')
        .trim()
        .toLowerCase() || undefined;

    const providerOrderId = String(data?.id || data?.order_id || data?.orderId || '').trim() || undefined;
    const providerSubscriptionId =
      String(
        data?.subscription?.id || data?.subscription_id || data?.subscriptionId || ''
      ).trim() || undefined;

    const paidAt = parseIsoOrNull(data?.paidAt || data?.paid_at || data?.approved_at || rawPayload?.paidAt);
    const periodStart = parseIsoOrNull(
      data?.subscription?.current_period_start ||
        data?.current_period_start ||
        data?.period_start ||
        paidAt
    );
    const nextBillingAt = parseIsoOrNull(
      data?.subscription?.next_payment_date ||
        data?.next_payment_date ||
        data?.next_billing_at
    );
    const periodEnd = parseIsoOrNull(
      data?.subscription?.current_period_end ||
        data?.current_period_end ||
        data?.period_end ||
        data?.expires_at ||
        nextBillingAt
    );
    const occurredAt =
      parseIsoOrNull(rawPayload?.createdAt || data?.updatedAt || data?.paidAt || data?.createdAt) ||
      new Date().toISOString();

    let canonicalAction: CanonicalWebhookAction = 'IGNORE';
    if (eventType === 'purchase_approved' || eventType === 'order_paid') {
      canonicalAction = 'ACTIVATE';
    } else if (eventType === 'subscription_created') {
      // subscription_created NUNCA libera PRO por si só; aguarda confirmação financeira real (purchase_approved/order_paid)
      canonicalAction = 'SUBSCRIPTION_CREATED';
    } else if (eventType === 'subscription_renewed') {
      canonicalAction = 'RENEW';
    } else if (eventType === 'subscription_late_recovered') {
      canonicalAction = 'RECOVER';
    } else if (eventType === 'subscription_resumed') {
      const subStatus = String(data?.status || data?.subscription?.status || '').toLowerCase();
      canonicalAction =
        paidAt || subStatus === 'paid' || subStatus === 'active'
          ? 'RECOVER'
          : 'SUBSCRIPTION_CREATED';
    } else if (eventType === 'subscription_late') {
      canonicalAction = 'PAST_DUE';
    } else if (eventType === 'purchase_refused' || eventType === 'subscription_renewal_refused') {
      canonicalAction = 'REFUSED';
    } else if (eventType === 'subscription_canceled' || eventType === 'subscription_paused') {
      canonicalAction = 'CANCEL';
    } else if (eventType === 'subscription_expired') {
      canonicalAction = 'EXPIRE';
    } else if (eventType === 'refund_requested') {
      canonicalAction = 'REFUND_REQUESTED';
    } else if (eventType === 'refund') {
      canonicalAction = 'REFUND';
    } else if (eventType === 'chargeback') {
      canonicalAction = 'CHARGEBACK';
    } else if (
      eventType === 'waiting_payment' ||
      eventType === 'pix_gerado' ||
      eventType === 'boleto_gerado' ||
      eventType === 'picpay_gerado'
    ) {
      canonicalAction = 'PENDING_PAYMENT';
    }

    return {
      provider: this.id,
      providerEventId,
      eventType,
      canonicalAction,
      providerOrderId,
      providerSubscriptionId,
      attemptId,
      userId,
      customerEmail,
      productId,
      offerId,
      checkoutId,
      paymentMethod,
      amountCents,
      currency,
      occurredAt,
      paidAt,
      periodStart,
      periodEnd,
      nextBillingAt,
      rawPayload,
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<ProviderCancelResult> {
    const cleanId = String(providerSubscriptionId || '').trim();
    if (!cleanId) {
      return {
        success: true,
        canceledAt: new Date().toISOString(),
        providerStatus: 'local_only_canceled',
      };
    }

    if (!this.client.isConfigured()) {
      return {
        success: false,
        canceledAt: new Date().toISOString(),
        error: 'CAKTO_CREDENTIALS_MISSING: Não foi possível cancelar remotamente na Cakto.',
      };
    }

    const res = await this.client.cancelSubscription(cleanId);
    if (!res.ok) {
      return {
        success: false,
        canceledAt: new Date().toISOString(),
        error: res.error || `HTTP ${res.status}`,
      };
    }

    return {
      success: true,
      canceledAt: new Date().toISOString(),
      providerStatus: String(res.data?.status || 'canceled'),
    };
  }

  async fetchReconcilableOrders(params: {
    attemptId?: string;
    providerOrderId?: string;
    providerSubscriptionId?: string;
    customerEmail?: string;
  }): Promise<ProviderReconcileOrder[]> {
    if (!this.client.isConfigured()) {
      return [];
    }

    const results: ProviderReconcileOrder[] = [];
    let subDetails: { periodStart?: string; periodEnd?: string; nextBillingAt?: string } = {};

    if (params.providerSubscriptionId) {
      const subRes = await this.client.getSubscription(params.providerSubscriptionId).catch(() => null);
      if (subRes?.ok && subRes.data) {
        const s = subRes.data?.data || subRes.data;
        subDetails = {
          periodStart: parseIsoOrNull(s?.current_period_start),
          periodEnd: parseIsoOrNull(s?.current_period_end),
          nextBillingAt: parseIsoOrNull(s?.next_payment_date || s?.current_period_end),
        };
      }
    }

    if (params.providerOrderId) {
      const orderRes = await this.client.getOrder(params.providerOrderId);
      if (orderRes.ok && orderRes.data) {
        const order = orderRes.data?.data || orderRes.data;
        results.push(this.mapCaktoOrder(order, subDetails));
      }
      return results;
    }

    const searchKey = params.attemptId || params.customerEmail;
    if (searchKey) {
      const listRes = await this.client.listOrders({ search: searchKey, limit: 10 });
      if (listRes.ok && listRes.data) {
        const rows = Array.isArray(listRes.data?.results)
          ? listRes.data.results
          : Array.isArray(listRes.data?.data)
          ? listRes.data.data
          : [];
        for (const row of rows) {
          results.push(this.mapCaktoOrder(row, subDetails));
        }
      }
    }

    return results;
  }

  private mapCaktoOrder(
    order: any,
    subDetails: { periodStart?: string; periodEnd?: string; nextBillingAt?: string } = {}
  ): ProviderReconcileOrder {
    const rawStatus = String(order?.status || '').trim().toLowerCase();
    let status: ProviderReconcileOrder['status'] = 'unknown';
    if (rawStatus === 'paid' || rawStatus === 'approved' || rawStatus === 'active') status = 'paid';
    else if (rawStatus === 'waiting_payment' || rawStatus === 'pending') status = 'pending';
    else if (rawStatus === 'refused' || rawStatus === 'failed') status = 'refused';
    else if (rawStatus === 'chargedback' || rawStatus === 'chargeback') status = 'chargeback';
    else if (rawStatus === 'refunded') status = 'refunded';
    else if (rawStatus === 'past_due' || rawStatus === 'late') status = 'past_due';
    else if (rawStatus === 'canceled' || rawStatus === 'cancelled') status = 'canceled';
    else if (rawStatus === 'expired') status = 'expired';

    const paidAt = parseIsoOrNull(order?.paidAt || order?.paid_at || order?.approved_at);

    return {
      providerOrderId: String(order?.id || ''),
      providerSubscriptionId: String(order?.subscription?.id || order?.subscription_id || '') || undefined,
      attemptId: String(order?.sck || order?.external_id || '') || undefined,
      customerEmail: String(order?.customer?.email || '').toLowerCase() || undefined,
      productId: String(order?.product?.id || order?.product_id || '') || undefined,
      offerId: String(order?.offer?.id || order?.offer_id || '') || undefined,
      paymentMethod: normalizePaymentMethod(String(order?.paymentMethod || order?.payment_method || '')),
      amountCents: normalizeCaktoAmountToCents(order?.amount_cents ?? order?.amount) || 0,
      currency: String(order?.currency || 'BRL').toUpperCase(),
      status,
      paidAt,
      periodStart: parseIsoOrNull(order?.subscription?.current_period_start) || subDetails.periodStart || paidAt,
      periodEnd: parseIsoOrNull(order?.subscription?.current_period_end) || subDetails.periodEnd,
      nextBillingAt: parseIsoOrNull(order?.subscription?.next_payment_date) || subDetails.nextBillingAt,
    };
  }
}

export const caktoPaymentProvider = new CaktoPaymentProvider();
