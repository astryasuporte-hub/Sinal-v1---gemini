/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BillingEventProcessor — Inbox Idempotente & Máquina de Estados de Assinatura (Payments V1)
 *
 * Transições canônicas:
 * - ACTIVATE / RENEW -> status='active' (+30 dias), internal.billing_payments='PAID', billing_attempts='PAID'
 * - PAST_DUE -> status='past_due' (carência 3 dias)
 * - REFUSED -> status='payment_refused' (sem acesso PRO)
 * - CANCEL -> status='canceled', canceled_at=NOW()
 * - EXPIRE -> status='expired' (revoga acesso PRO)
 * - REFUND -> status='canceled', payment='REFUNDED' (revoga acesso PRO)
 * - PENDING -> status='pending' / billing_payments='PENDING' (não libera acesso PRO)
 */

import { resolvePlanPrice } from '../plans.js';
import { getPaymentsPersistence, PaymentsPersistenceAdapter } from './PaymentsStore.js';
import type { NormalizedPaymentWebhookEvent } from './types.js';

export interface ProcessWebhookOutcome {
  success: boolean;
  duplicate?: boolean;
  processed: boolean;
  resultingSubscriptionStatus?: string;
  userId?: string | null;
  errorCode?: string;
  error?: string;
}

export class BillingEventProcessor {
  constructor(private readonly storeProvider: () => PaymentsPersistenceAdapter = getPaymentsPersistence) {}

  async processEvent(
    event: NormalizedPaymentWebhookEvent,
    options: { signatureValid?: boolean; eventTimestamp?: string } = {}
  ): Promise<ProcessWebhookOutcome> {
    const store = this.storeProvider();
    const lock = await store.acquireWebhookEventLock({
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      signatureValid: Boolean(options.signatureValid ?? true),
      eventTimestamp: options.eventTimestamp || event.occurredAt,
      attemptId: event.attemptId || null,
      payload: event.rawPayload,
    });

    if (lock.isDuplicate) {
      return {
        success: true,
        duplicate: true,
        processed: true,
      };
    }

    try {
      const plan = resolvePlanPrice('pro');
      const targetUserId = await this.resolveUserId(store, event);

      if (!targetUserId) {
        await store.finalizeWebhookEvent({
          provider: event.provider,
          providerEventId: event.providerEventId,
          processed: false,
          processingError: 'USER_NOT_RESOLVED',
        });
        return {
          success: false,
          processed: false,
          errorCode: 'USER_NOT_RESOLVED',
          error: 'Não foi possível associar o evento de pagamento a nenhum usuário do FatosBR.',
        };
      }

      const now = new Date();
      const plus30DaysIso = new Date(now.getTime() + plan.periodDays * 24 * 60 * 60 * 1000).toISOString();
      const grace3DaysIso = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const paymentId = event.providerOrderId || `${event.provider}_${event.providerEventId}`;

      let nextSubStatus: string | null = null;
      let ledgerStatus: string | null = null;
      let attemptStatus: string | null = null;
      let periodStart: string | null = null;
      let periodEnd: string | null = null;
      let canceledAt: string | null = null;
      let graceUntil: string | null = null;

      switch (event.canonicalAction) {
        case 'ACTIVATE':
        case 'RENEW':
          nextSubStatus = 'active';
          ledgerStatus = 'PAID';
          attemptStatus = 'PAID';
          periodStart = now.toISOString();
          periodEnd = plus30DaysIso;
          canceledAt = null;
          graceUntil = null;
          break;
        case 'PAST_DUE':
          nextSubStatus = 'past_due';
          graceUntil = grace3DaysIso;
          break;
        case 'REFUSED':
          nextSubStatus = 'payment_refused';
          ledgerStatus = 'FAILED';
          attemptStatus = 'REFUSED';
          break;
        case 'CANCEL':
          nextSubStatus = 'canceled';
          canceledAt = now.toISOString();
          break;
        case 'EXPIRE':
          nextSubStatus = 'expired';
          attemptStatus = 'EXPIRED';
          periodEnd = now.toISOString();
          break;
        case 'REFUND':
          nextSubStatus = 'canceled';
          ledgerStatus = 'REFUNDED';
          canceledAt = now.toISOString();
          periodEnd = now.toISOString();
          break;
        case 'PENDING':
          ledgerStatus = 'PENDING';
          nextSubStatus = 'pending';
          break;
        default:
          break;
      }

      if (ledgerStatus) {
        await store.upsertPaymentLedgerRecord({
          userId: targetUserId,
          attemptId: event.attemptId || null,
          provider: event.provider,
          providerPaymentId: paymentId,
          providerSubscriptionId: event.providerSubscriptionId || null,
          productId: event.productId || plan.productId,
          offerId: event.offerId || plan.offerId,
          paymentMethod: event.paymentMethod,
          amountCents: event.amountCents || plan.amountCents,
          currency: event.currency || plan.currency,
          status: ledgerStatus,
          checkoutData: {
            description: plan.description,
            event_type: event.eventType,
            provider_event_id: event.providerEventId,
            payment_method: event.paymentMethod,
            user_email: event.customerEmail || null,
          },
        });
      }

      if (event.attemptId && attemptStatus) {
        await store.updateBillingAttempt(event.attemptId, {
          status: attemptStatus,
          providerOrderId: event.providerOrderId || null,
          providerSubscriptionId: event.providerSubscriptionId || null,
          metadata: { last_event_id: event.providerEventId, payment_method: event.paymentMethod },
        });
      }

      if (nextSubStatus) {
        await store.upsertSubscription({
          userId: targetUserId,
          plan: plan.id,
          planId: plan.id,
          status: nextSubStatus,
          provider: event.provider,
          productId: event.productId || plan.productId,
          offerId: event.offerId || plan.offerId,
          checkoutId: event.checkoutId || plan.checkoutId,
          paymentMethod: event.paymentMethod,
          amountCents: event.amountCents || plan.amountCents,
          currency: event.currency || plan.currency,
          providerSubscriptionId: event.providerSubscriptionId || null,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          canceledAt,
          graceUntil,
          lastEventId: event.providerEventId,
          billingMetadata: {
            last_event_type: event.eventType,
            recurrence: plan.recurrence,
          },
        });
      }

      await store.finalizeWebhookEvent({
        provider: event.provider,
        providerEventId: event.providerEventId,
        processed: true,
        processingError: null,
      });

      return {
        success: true,
        duplicate: false,
        processed: true,
        userId: targetUserId,
        resultingSubscriptionStatus: nextSubStatus || 'unchanged',
      };
    } catch (err: any) {
      await store.finalizeWebhookEvent({
        provider: event.provider,
        providerEventId: event.providerEventId,
        processed: false,
        processingError: err?.message || 'INTERNAL_PROCESSING_ERROR',
      });
      return {
        success: false,
        processed: false,
        errorCode: 'EVENT_PROCESSING_FAILED',
        error: err?.message || 'Erro ao processar evento financeiro.',
      };
    }
  }

  private async resolveUserId(
    store: PaymentsPersistenceAdapter,
    event: NormalizedPaymentWebhookEvent
  ): Promise<string | null> {
    if (event.attemptId) {
      const attempt = await store.getBillingAttemptById(event.attemptId);
      if (attempt?.user_id) return attempt.user_id;
    }

    if (event.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.userId)) {
      return event.userId;
    }

    if (event.providerSubscriptionId) {
      const sub = await store.findSubscriptionByProviderSubId(event.providerSubscriptionId);
      if (sub?.user_id) return sub.user_id;
    }

    if (event.customerEmail) {
      const user = await store.findUserByEmail(event.customerEmail);
      if (user?.id) return user.id;
    }

    return null;
  }
}

export const billingEventProcessor = new BillingEventProcessor();
