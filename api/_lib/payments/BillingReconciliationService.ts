/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BillingReconciliationService — Reconciliação Ativa de Assinaturas e Tentativas Abertas
 */

import { isProhibitedPaymentMethod, resolvePlanPrice } from '../plans.js';
import { BillingEventProcessor, billingEventProcessor } from './BillingEventProcessor.js';
import { getActivePaymentProviderId, getPaymentProvider } from './PaymentProviderRegistry.js';
import { getPaymentsPersistence, PaymentsPersistenceAdapter } from './PaymentsStore.js';
import type { NormalizedPaymentWebhookEvent } from './types.js';

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

    const openAttempts = await store.listOpenAttemptsForUser(params.userId).catch(() => []);
    const subRow = await store.findSubscriptionByUserId(params.userId).catch(() => null);

    const searchQueries: Array<{
      attemptId?: string;
      providerOrderId?: string;
      providerSubscriptionId?: string;
      customerEmail?: string;
    }> = [];

    if (params.providerOrderId) {
      searchQueries.push({ providerOrderId: params.providerOrderId });
    }
    for (const attempt of openAttempts.slice(0, 3)) {
      searchQueries.push({ attemptId: attempt.id, providerOrderId: attempt.provider_order_id || undefined });
    }
    if (searchQueries.length === 0 && (subRow?.provider_subscription_id || (params.userEmail && params.userEmail.includes('@')))) {
      searchQueries.push({
        providerSubscriptionId: subRow?.provider_subscription_id || undefined,
        customerEmail: params.userEmail || undefined,
      });
    }

    const seenOrders = new Set<string>();
    const details: ReconciliationResult['details'] = [];
    let reconciledCount = 0;
    let rejectedProhibitedCount = 0;

    for (const query of searchQueries) {
      const orders = await provider.fetchReconcilableOrders(query).catch(() => []);
      for (const order of orders) {
        if (!order.providerOrderId || seenOrders.has(order.providerOrderId)) continue;
        seenOrders.add(order.providerOrderId);

        if (isProhibitedPaymentMethod(order.paymentMethod)) {
          rejectedProhibitedCount += 1;
          details.push({
            providerOrderId: order.providerOrderId,
            status: order.status,
            paymentMethod: order.paymentMethod,
            outcome: 'REJECTED_PROHIBITED_METHOD',
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

        const canonicalAction: NormalizedPaymentWebhookEvent['canonicalAction'] =
          order.status === 'paid'
            ? 'ACTIVATE'
            : order.status === 'refunded'
            ? 'REFUND'
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
          paymentMethod: order.paymentMethod,
          amountCents: order.amountCents,
          currency: order.currency,
          occurredAt: order.paidAt || new Date().toISOString(),
          rawPayload: { source: 'reconciliation', order },
        };

        const outcome = await this.processor.processEvent(syntheticEvent, { signatureValid: true });
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
