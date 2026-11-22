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
  pendingReconciliationCount: number;
  rejectedProhibitedCount: number;
  rejectedForeignCount: number;
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

    const userAttempts = store.listUserAttemptsForReconciliation
      ? await store.listUserAttemptsForReconciliation(params.userId)
      : await store.listOpenAttemptsForUser(params.userId);
    const subRow = await store.findSubscriptionByUserId(params.userId);
    const persistedUserOrderIds = store.listUserPaymentOrderIds
      ? new Set(await store.listUserPaymentOrderIds(params.userId))
      : new Set<string>();

    const userAttemptIds = new Set(userAttempts.map((a) => a.id));
    const userAttemptOrderIds = new Set(
      userAttempts.map((a) => a.provider_order_id).filter((v): v is string => Boolean(v))
    );
    const userAttemptSubIds = new Set(
      userAttempts.map((a) => a.provider_subscription_id).filter((v): v is string => Boolean(v))
    );

    const searchQueries: Array<{
      attemptId?: string;
      providerOrderId?: string;
      providerSubscriptionId?: string;
      customerEmail?: string;
    }> = [];

    if (params.providerOrderId) {
      // Verifica previamente se o providerOrderId explícito já pertence a outro usuário no banco
      const foreignPayment = store.findPaymentByProviderPaymentId
        ? await store.findPaymentByProviderPaymentId(params.providerOrderId).catch(() => null)
        : null;
      const foreignAttempt = store.findBillingAttemptByProviderOrderId
        ? await store.findBillingAttemptByProviderOrderId(params.providerOrderId).catch(() => null)
        : null;
      const foreignSub = store.findSubscriptionByProviderOrderId
        ? await store.findSubscriptionByProviderOrderId(params.providerOrderId).catch(() => null)
        : null;

      const belongsToOther =
        (foreignPayment?.user_id && foreignPayment.user_id !== params.userId) ||
        (foreignAttempt?.user_id && foreignAttempt.user_id !== params.userId) ||
        (foreignSub?.user_id && foreignSub.user_id !== params.userId);

      if (belongsToOther) {
        return {
          success: true,
          reconciledCount: 0,
          pendingReconciliationCount: 0,
          rejectedProhibitedCount: 0,
          rejectedForeignCount: 1,
          checkedAttempts: userAttempts.length,
          details: [
            {
              providerOrderId: params.providerOrderId,
              status: 'foreign_owner',
              paymentMethod: 'unknown',
              outcome: 'REJECTED_FOREIGN_OWNER',
            },
          ],
        };
      }

      searchQueries.push({
        providerOrderId: params.providerOrderId,
        providerSubscriptionId: subRow?.provider_subscription_id || undefined,
      });
    }

    for (const attempt of userAttempts.slice(0, 5)) {
      searchQueries.push({
        attemptId: attempt.id,
        providerOrderId: attempt.provider_order_id || undefined,
        providerSubscriptionId: attempt.provider_subscription_id || subRow?.provider_subscription_id || undefined,
      });
    }

    if (subRow?.provider_subscription_id) {
      searchQueries.push({
        providerSubscriptionId: subRow.provider_subscription_id,
      });
    }

    // O e-mail serve apenas para localizar registros candidatos para auditoria/pendência,
    // NUNCA como prova suficiente isolada para ativar PRO.
    if (params.userEmail && params.userEmail.includes('@')) {
      searchQueries.push({
        customerEmail: params.userEmail.trim().toLowerCase(),
      });
    }

    const seenOrders = new Set<string>();
    const details: ReconciliationResult['details'] = [];
    let reconciledCount = 0;
    let pendingReconciliationCount = 0;
    let rejectedProhibitedCount = 0;
    let rejectedForeignCount = 0;

    for (const query of searchQueries) {
      const orders = await provider.fetchReconcilableOrders(query).catch(() => []);
      for (const order of orders) {
        if (!order.providerOrderId || seenOrders.has(order.providerOrderId)) continue;
        seenOrders.add(order.providerOrderId);

        // 1. Bloqueio de associação cruzada: verifica se QUALQUER identificador pertence a outro usuário
        const attemptInDb = order.attemptId
          ? await store.getBillingAttemptById(order.attemptId).catch(() => null)
          : null;
        const subInDb = order.providerSubscriptionId
          ? await store.findSubscriptionByProviderSubId(order.providerSubscriptionId).catch(() => null)
          : null;
        const payInDb = store.findPaymentByProviderPaymentId
          ? await store.findPaymentByProviderPaymentId(order.providerOrderId).catch(() => null)
          : null;
        const attemptByOrderInDb = store.findBillingAttemptByProviderOrderId
          ? await store.findBillingAttemptByProviderOrderId(order.providerOrderId).catch(() => null)
          : null;

        const isForeignAttempt = Boolean(attemptInDb && attemptInDb.user_id !== params.userId);
        const isForeignSub = Boolean(subInDb && subInDb.user_id !== params.userId);
        const isForeignPay = Boolean(payInDb?.user_id && payInDb.user_id !== params.userId);
        const isForeignAttemptOrder = Boolean(attemptByOrderInDb && attemptByOrderInDb.user_id !== params.userId);

        if (isForeignAttempt || isForeignSub || isForeignPay || isForeignAttemptOrder) {
          rejectedForeignCount += 1;
          details.push({
            providerOrderId: order.providerOrderId,
            status: order.status,
            paymentMethod: order.paymentMethod,
            outcome: 'REJECTED_FOREIGN_OWNER',
          });
          continue;
        }

        // 2. Exigir âncora persistida e verificada vinculada ao usuário autenticado
        const matchesAttempt = Boolean(
          order.attemptId &&
            (userAttemptIds.has(order.attemptId) || (attemptInDb && attemptInDb.user_id === params.userId))
        );
        const matchesSub = Boolean(
          order.providerSubscriptionId &&
            ((subRow?.provider_subscription_id &&
              order.providerSubscriptionId === subRow.provider_subscription_id) ||
              userAttemptSubIds.has(order.providerSubscriptionId) ||
              (subInDb && subInDb.user_id === params.userId))
        );
        const matchesPersistedOrder = Boolean(
          persistedUserOrderIds.has(order.providerOrderId) ||
            userAttemptOrderIds.has(order.providerOrderId) ||
            payInDb?.user_id === params.userId ||
            attemptByOrderInDb?.user_id === params.userId
        );

        const hasPersistedAnchor = matchesAttempt || matchesSub || matchesPersistedOrder;

        // 3. Sem âncora persistida (mesmo se customerEmail coincidir!), permanece pendente sem ativar PRO
        if (!hasPersistedAnchor) {
          pendingReconciliationCount += 1;
          if (order.status === 'paid') {
            await this.processor.processEvent(
              {
                provider: provider.id,
                providerEventId: `reconcile_unanchored_${order.providerOrderId}_${order.status}`,
                eventType: `reconcile.unanchored.${order.status}`,
                canonicalAction: 'ACTIVATE',
                providerOrderId: order.providerOrderId,
                providerSubscriptionId: order.providerSubscriptionId,
                customerEmail: order.customerEmail,
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
                rawPayload: { source: 'reconciliation_unanchored', order },
              },
              { signatureValid: true }
            );
          }
          details.push({
            providerOrderId: order.providerOrderId,
            status: order.status,
            paymentMethod: order.paymentMethod,
            outcome: 'PENDING_RECONCILIATION_NO_PERSISTED_ANCHOR',
          });
          continue;
        }

        if (
          isProhibitedPaymentMethod(order.paymentMethod) ||
          (order.status === 'paid' && !isAllowedPaymentMethod(order.paymentMethod))
        ) {
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
      pendingReconciliationCount,
      rejectedProhibitedCount,
      rejectedForeignCount,
      checkedAttempts: userAttempts.length,
      details,
    };
  }
}

export const billingReconciliationService = new BillingReconciliationService();
