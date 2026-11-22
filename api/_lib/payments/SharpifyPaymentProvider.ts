/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SharpifyPaymentProvider — Adaptador preservado na abstração multi-provedor do FatosBR.
 * Mantém a arquitetura desacoplada enquanto o provedor ativo oficial é Cakto.
 */

import { ALLOWED_CAKTO_METHODS, PROHIBITED_PAYMENT_METHODS, resolvePlanPrice } from '../plans.js';
import type { PaymentProvider, WebhookVerificationOutcome } from './PaymentProvider.js';
import type {
  CheckoutCommercialReadiness,
  CheckoutSessionInput,
  CheckoutSessionResult,
  NormalizedPaymentWebhookEvent,
  ProviderCancelResult,
  ProviderReconcileOrder,
} from './types.js';

export class SharpifyPaymentProvider implements PaymentProvider {
  readonly id = 'sharpify' as const;
  readonly displayName = 'Sharpify Payments Adapter';

  async getCommercialReadiness(): Promise<CheckoutCommercialReadiness> {
    return {
      ready: false,
      blockedReasonCode: 'PROVIDER_NOT_IMPLEMENTED',
      blockedMessage: 'Provedor Sharpify reservado como adaptador secundário; provedor ativo oficial é Cakto.',
      commercialEnabled: false,
      methodsVerified: false,
      allowedMethods: ALLOWED_CAKTO_METHODS,
      prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
    };
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const plan = resolvePlanPrice(input.planId);
    return {
      success: false,
      blocked: true,
      errorCode: 'PROVIDER_NOT_IMPLEMENTED',
      error: 'O provedor Sharpify não está ativo para emissão de checkout nesta versão.',
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

  verifyWebhookSignature(): WebhookVerificationOutcome {
    return {
      valid: false,
      errorCode: 'PROVIDER_NOT_IMPLEMENTED',
      reason: 'Webhook Sharpify não habilitado.',
    };
  }

  parseWebhookEvent(rawPayload: Record<string, any>): NormalizedPaymentWebhookEvent {
    return {
      provider: this.id,
      providerEventId: String(rawPayload?.id || `sharpify_${Date.now()}`),
      eventType: String(rawPayload?.event || 'unknown'),
      canonicalAction: 'IGNORE',
      paymentMethod: String(rawPayload?.paymentMethod || 'unknown'),
      currency: String(rawPayload?.currency || 'BRL'),
      occurredAt: new Date().toISOString(),
      rawPayload,
    };
  }

  async cancelSubscription(): Promise<ProviderCancelResult> {
    return {
      success: false,
      canceledAt: new Date().toISOString(),
      error: 'Cancelamento via Sharpify não habilitado.',
    };
  }

  async fetchReconcilableOrders(): Promise<ProviderReconcileOrder[]> {
    return [];
  }
}
