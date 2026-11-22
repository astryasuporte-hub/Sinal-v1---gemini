/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CaktoPaymentProvider — Implementação Oficial Cakto para FatosBR Payments V1
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
 *    - oferta estiver disabled ou produto em waiting_config na Cakto
 *    - método proibido (pix avulso, boleto, picpay etc.) estiver ativo na oferta ou solicitado
 * 5. Métodos permitidos exclusivamente: credit_card e pix_auto.
 * 6. Webhook HMAC-SHA256 com proteção contra replay (<= 300s) e crypto.timingSafeEqual.
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

  // Cakto pode enviar decimal em reais (ex: 34.9 ou 34.90) ou inteiro em centavos (ex: 3490).
  if (Number.isInteger(num) && num >= 100) {
    return num;
  }
  return Math.round(num * 100);
}

function extractOfferMethods(offerData: any): string[] {
  if (!offerData || typeof offerData !== 'object') return [];
  const rawList: unknown[] = [];

  if (Array.isArray(offerData.paymentMethods)) rawList.push(...offerData.paymentMethods);
  if (Array.isArray(offerData.payment_methods)) rawList.push(...offerData.payment_methods);
  if (Array.isArray(offerData.allowed_methods)) rawList.push(...offerData.allowed_methods);
  if (Array.isArray(offerData.methods)) rawList.push(...offerData.methods);

  if (offerData.pix === true || offerData.accepts_pix === true) rawList.push('pix');
  if (offerData.boleto === true || offerData.accepts_boleto === true) rawList.push('boleto');
  if (offerData.picpay === true || offerData.accepts_picpay === true) rawList.push('picpay');
  if (offerData.credit_card === true || offerData.accepts_credit_card === true) rawList.push('credit_card');
  if (offerData.pix_auto === true || offerData.accepts_pix_auto === true || offerData.pix_automatico === true) {
    rawList.push('pix_auto');
  }

  return Array.from(new Set(rawList.map((m) => normalizePaymentMethod(String(m))).filter((m) => m && m !== 'unknown')));
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

    // 1. Trava comercial server-side explícita
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

    // 2. Exige confirmação explícita de métodos permitidos (credit_card + pix_auto sem pix avulso)
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

    // 3. Exige credenciais configuradas para inspecionar e validar oferta/produto antes de liberar
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

    // 4. Consulta oferta e produto oficiais na API Cakto para impedir ativação indevida ou Pix avulso
    const [offerRes, productRes] = await Promise.all([
      this.client.getOffer(plan.offerId),
      this.client.getProduct(plan.productId),
    ]);

    if (!offerRes.ok || !productRes.ok) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Não foi possível validar o status comercial da oferta ${plan.offerId} na Cakto (${offerRes.error || productRes.error || 'erro upstream'}).`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      };
    }

    const offerData = offerRes.data?.data || offerRes.data || {};
    const productData = productRes.data?.data || productRes.data || {};
    const offerStatus = String(offerData.status || (offerData.active === false ? 'disabled' : 'active')).toLowerCase();
    const productStatus = String(productData.status || 'unknown').toLowerCase();

    if (offerStatus === 'disabled' || offerStatus === 'inactive' || productStatus === 'waiting_config') {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Oferta Cakto '${plan.offerId}' (${offerStatus}) ou produto '${plan.productId}' (${productStatus}) ainda não está liberado comercialmente.`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
        offerStatus,
        productStatus,
      };
    }

    const detectedMethods = extractOfferMethods(offerData);
    const hasProhibited = detectedMethods.some((m) => isProhibitedPaymentMethod(m));
    const hasAtLeastOneAllowed = detectedMethods.some((m) => isAllowedPaymentMethod(m));

    if (hasProhibited || !hasAtLeastOneAllowed) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_DISALLOWED_PAYMENT_METHOD_ENABLED',
        blockedMessage: hasProhibited
          ? `Oferta Cakto possui método proibido habilitado (${detectedMethods.filter((m) => isProhibitedPaymentMethod(m)).join(', ')}). Apenas credit_card e pix_auto são permitidos.`
          : 'Oferta Cakto não possui credit_card ou pix_auto verificados na resposta oficial.',
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
        detectedProviderMethods: detectedMethods,
        offerStatus,
        productStatus,
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

    // Monta URL oficial de checkout hospedado sem vazar segredos, email/preço manipulável:
    // Usa attemptId opaco como external_id/sck para correlação no webhook.
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

    const providedHex = sigHeader.startsWith('v1=') ? sigHeader.slice(3).trim() : sigHeader;
    const tsHeader = (normalizedHeaders['x-cakto-timestamp'] || '').trim();

    if (tsHeader) {
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

      const signedPayload = `${tsHeader}.${params.rawBody}`;
      const expectedHmac = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

      if (!safeCompare(providedHex, expectedHmac)) {
        return {
          valid: false,
          errorCode: 'INVALID_SIGNATURE',
          reason: 'Assinatura HMAC Cakto inválida.',
        };
      }

      return { valid: true, timestampIso: new Date(tsMs).toISOString() };
    }

    // Modo fallback quando header x-cakto-timestamp não é enviado: exige assinatura HMAC-SHA256 sobre rawBody
    const expectedRawHmac = crypto.createHmac('sha256', secret).update(params.rawBody).digest('hex');
    if (!safeCompare(providedHex, expectedRawHmac)) {
      return {
        valid: false,
        errorCode: 'INVALID_SIGNATURE',
        reason: 'Assinatura HMAC Cakto inválida (ou x-cakto-timestamp ausente).',
      };
    }

    return { valid: true, timestampIso: new Date().toISOString() };
  }

  parseWebhookEvent(rawPayload: Record<string, any>): NormalizedPaymentWebhookEvent {
    const eventType = String(rawPayload?.event || rawPayload?.type || 'unknown')
      .trim()
      .toLowerCase();
    const data = rawPayload?.data && typeof rawPayload.data === 'object' ? rawPayload.data : rawPayload;

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

    let canonicalAction: NormalizedPaymentWebhookEvent['canonicalAction'] = 'IGNORE';
    if (eventType === 'purchase_approved' || eventType === 'subscription_created' || eventType === 'order_paid') {
      canonicalAction = 'ACTIVATE';
    } else if (eventType === 'subscription_renewed' || eventType === 'subscription_resumed') {
      canonicalAction = 'RENEW';
    } else if (eventType === 'subscription_late') {
      canonicalAction = 'PAST_DUE';
    } else if (eventType === 'purchase_refused') {
      canonicalAction = 'REFUSED';
    } else if (eventType === 'subscription_canceled' || eventType === 'subscription_paused') {
      canonicalAction = 'CANCEL';
    } else if (eventType === 'subscription_expired') {
      canonicalAction = 'EXPIRE';
    } else if (eventType === 'refund' || eventType === 'refund_requested' || eventType === 'chargeback') {
      canonicalAction = 'REFUND';
    } else if (
      eventType === 'waiting_payment' ||
      eventType === 'pix_gerado' ||
      eventType === 'boleto_gerado' ||
      eventType === 'picpay_gerado'
    ) {
      canonicalAction = 'PENDING';
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
      occurredAt: String(rawPayload?.createdAt || data?.paidAt || data?.createdAt || new Date().toISOString()),
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

    if (params.providerOrderId) {
      const orderRes = await this.client.getOrder(params.providerOrderId);
      if (orderRes.ok && orderRes.data) {
        const order = orderRes.data?.data || orderRes.data;
        results.push(this.mapCaktoOrder(order));
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
          results.push(this.mapCaktoOrder(row));
        }
      }
    }

    return results;
  }

  private mapCaktoOrder(order: any): ProviderReconcileOrder {
    const rawStatus = String(order?.status || '').trim().toLowerCase();
    let status: ProviderReconcileOrder['status'] = 'unknown';
    if (rawStatus === 'paid' || rawStatus === 'approved' || rawStatus === 'active') status = 'paid';
    else if (rawStatus === 'waiting_payment' || rawStatus === 'pending') status = 'pending';
    else if (rawStatus === 'refused' || rawStatus === 'failed') status = 'refused';
    else if (rawStatus === 'refunded' || rawStatus === 'chargedback') status = 'refunded';
    else if (rawStatus === 'canceled' || rawStatus === 'cancelled') status = 'canceled';
    else if (rawStatus === 'expired') status = 'expired';

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
      paidAt: order?.paidAt || undefined,
    };
  }
}

export const caktoPaymentProvider = new CaktoPaymentProvider();
