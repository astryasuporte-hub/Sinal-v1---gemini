/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BillingReconciliationService — Reconciliação Ativa de Assinaturas e Tentativas Abertas (Payments V1.1)
 */

import { isAllowedPaymentMethod, isProhibitedPaymentMethod, resolvePlanPrice } from '../plans.js';
import { BillingEventProcessor, billingEventProcessor } from './BillingEventProcessor.js';
import { getActivePaymentProviderId, getPaymentProvider } from './PaymentProviderRegistry.js';
import { getPaymentsPersistence, PaymentsPersistenceAdapter } from './PaymentsStore.js';
import type { CanonicalWebhookAction, NormalizedPaymentWebhookEvent } from './types.js';

export interface ReconciliationResult {
  success: boolean;
  reconciledCount: number;
  rejectedProhibitedCount: number;
  checkedAttempts: number;
  details: Array<{
    providerOrderId: string;
    status: string;
    paymentMethod: string;
    outcome: string;
  }>;
}

export class BillingReconciliationService {
  constructor(
    private readonly storeProvider: () => PaymentsPersistenceAdapter = getPaymentsPersistence,
    private readonly processor: BillingEventProcessor = billingEventProcessor
  ) {}

  async reconcileUser(params: {
    userId: string;
    userEmail?: string | null;
    providerOrderId?: string;
  }): Promise<ReconciliationResult> {
    const store = this.storeProvider();
    const provider = getPaymentProvider(getActivePaymentProviderId());
    const plan = resolvePlanPrice('pro');

    const openAttempts = await store.listOpenAttemptsForUser(params.userId);
    const subRow = await store.findSubscriptionByUserId(params.userId);

    const searchQueries: Array<{
      attemptId?: string;
      providerOrderId?: string;
      providerSubscriptionId?: string;
      customerEmail?: string;
    }> = [];

    if (params.providerOrderId) {
      searchQueries.push({
        providerOrderId: params.providerOrderId,
        providerSubscriptionId: subRow?.provider_subscription_id || undefined,
      });
    }
    for (const attempt of openAttempts.slice(0, 3)) {
      searchQueries.push({
        attemptId: attempt.id,
        providerOrderId: attempt.provider_order_id || undefined,
        providerSubscriptionId: attempt.provider_subscription_id || subRow?.provider_subscription_id || undefined,
      });
    }
    if (searchQueries.length === 0 && (subRow?.provider_subscription_id || (params.userEmail && params.userEmail.includes('@')))) {
      searchQueries.push({
        providerSubscriptionId: subRow?.provider_subscription_id || undefined,
        customerEmail: params.userEmail || undefined,
      });
    }

    const openAttemptIds = new Set(openAttempts.map((a) => a.id));
    const normalizedAuthEmail = params.userEmail ? params.userEmail.trim().toLowerCase() : null;

    const seenOrders = new Set<string>();
    const details: ReconciliationResult['details'] = [];
    let reconciledCount = 0;
    let rejectedProhibitedCount = 0;

    for (const query of searchQueries) {
      const orders = await provider.fetchReconcilableOrders(query).catch(() => []);
      for (const order of orders) {
        if (!order.providerOrderId || seenOrders.has(order.providerOrderId)) continue;
        seenOrders.add(order.providerOrderId);

        // Verifica vínculo estrito do pedido com o usuário autenticado (mesmo quando providerOrderId é informado)
        const matchesAttempt = Boolean(order.attemptId && openAttemptIds.has(order.attemptId));
        const matchesSub = Boolean(
          order.providerSubscriptionId &&
            subRow?.provider_subscription_id &&
            order.providerSubscriptionId === subRow.provider_subscription_id
        );
        const matchesEmail = Boolean(
          normalizedAuthEmail &&
            order.customerEmail &&
            order.customerEmail.trim().toLowerCase() === normalizedAuthEmail
        );
        if (!matchesAttempt && !matchesSub && !matchesEmail) {
          continue;
        }

        if (isProhibitedPaymentMethod(order.paymentMethod) || (order.status === 'paid' && !isAllowedPaymentMethod(order.paymentMethod))) {
          rejectedProhibitedCount += 1;
          details.push({
            providerOrderId: order.providerOrderId,
            status: order.status,
            paymentMethod: order.paymentMethod,
            outcome: 'REJECTED_PROHIBITED_METHOD',
          });
          continue;
        }

        if (order.productId && order.productId !== plan.productId) {
          details.push({
            providerOrderId: order.providerOrderId,
            status: order.status,
            paymentMethod: order.paymentMethod,
            outcome: 'REJECTED_PRODUCT_MISMATCH',
          });
          continue;
        }

        if (order.offerId && order.offerId !== plan.offerId) {
          details.push({
            providerOrderId: order.providerOrderId,
            status: order.status,
            paymentMethod: order.paymentMethod,
            outcome: 'REJECTED_OFFER_MISMATCH',
          });
          continue;
        }

        if (order.currency !== plan.currency || (order.status === 'paid' && order.amountCents !== plan.amountCents)) {
          details.push({
            providerOrderId: order.providerOrderId,
            status: order.status,
            paymentMethod: order.paymentMethod,
            outcome: 'REJECTED_AMOUNT_OR_CURRENCY_MISMATCH',
          });
          continue;
        }

        const canonicalAction: CanonicalWebhookAction =
          order.status === 'paid'
            ? 'ACTIVATE'
            : order.status === 'chargeback'
            ? 'CHARGEBACK'
            : order.status === 'refunded'
            ? 'REFUND'
            : order.status === 'past_due'
            ? 'PAST_DUE'
            : order.status === 'canceled'
            ? 'CANCEL'
            : order.status === 'refused'
            ? 'REFUSED'
            : order.status === 'expired'
            ? 'EXPIRE'
            : 'IGNORE';

        if (canonicalAction === 'IGNORE') {
          details.push({
            providerOrderId: order.providerOrderId,
            status: order.status,
            paymentMethod: order.paymentMethod,
            outcome: 'STILL_PENDING',
          });
          continue;
        }

        const syntheticEvent: NormalizedPaymentWebhookEvent = {
          provider: provider.id,
          providerEventId: `reconcile_${order.providerOrderId}_${order.status}`,
          eventType: `reconcile.${order.status}`,
          canonicalAction,
          providerOrderId: order.providerOrderId,
          providerSubscriptionId: order.providerSubscriptionId,
          attemptId: order.attemptId || query.attemptId,
          userId: params.userId,
          customerEmail: order.customerEmail || params.userEmail || undefined,
          productId: order.productId || plan.productId,
          offerId: order.offerId || plan.offerId,
          checkoutId: plan.checkoutId,
          paymentMethod: order.paymentMethod,
          amountCents: order.amountCents,
          currency: order.currency,
          occurredAt: order.paidAt || new Date().toISOString(),
          paidAt: order.paidAt,
          periodStart: order.periodStart,
          periodEnd: order.periodEnd,
          nextBillingAt: order.nextBillingAt,
          rawPayload: { source: 'reconciliation', order },
        };

        const outcome = await this.processor.processEvent(syntheticEvent, {
          signatureValid: true,
          trustedUserId: params.userId,
        });
        if (outcome.success) reconciledCount += 1;
        details.push({
          providerOrderId: order.providerOrderId,
          status: order.status,
          paymentMethod: order.paymentMethod,
          outcome: outcome.duplicate ? 'ALREADY_RECONCILED' : outcome.resultingSubscriptionStatus || 'RECONCILED',
        });
      }
    }

    return {
      success: true,
      reconciledCount,
      rejectedProhibitedCount,
      checkedAttempts: openAttempts.length,
      details,
    };
  }
}

export const billingReconciliationService = new BillingReconciliationService();
