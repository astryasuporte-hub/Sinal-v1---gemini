/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BillingEventProcessor — Inbox Idempotente & Máquina de Estados Canônica (Payments V1.1)
 *
 * Garantias:
 * 1. Execução em transação atômica PostgreSQL (via runAtomicEventTransition quando disponível).
 * 2. Resolução estrita da identidade do comprador via âncora confiável persistida:
 *    - attempt_id em internal.billing_attempts (com validação de produto/oferta/valor/moeda)
 *    - provider_subscription_id em public.subscriptions
 *    - provider_order_id em internal.billing_payments
 *    - trustedUserId explícito da reconciliação autenticada
 *    Eventos sem âncora confiável NÃO ativam assinatura e retornam RECONCILIATION_REQUIRED.
 * 3. Escrita 100% compatível com DbContractMapper (UPPERCASE canônico).
 */

import { resolvePlanPrice } from '../plans.js';
import { toDbSubscriptionPlan, toDbSubscriptionStatus } from './DbContractMapper.js';
import {
  computeTransitionState,
  getPaymentsPersistence,
  isUuid,
  PaymentsPersistenceAdapter,
} from './PaymentsStore.js';
import type { NormalizedPaymentWebhookEvent } from './types.js';

export interface ProcessWebhookOutcome {
  success: boolean;
  duplicate?: boolean;
  processed: boolean;
  reconciliationRequired?: boolean;
  ignoredStale?: boolean;
  resultingSubscriptionStatus?: string;
  userId?: string | null;
  errorCode?: string;
  error?: string;
}

export class BillingEventProcessor {
  constructor(private readonly storeProvider: () => PaymentsPersistenceAdapter = getPaymentsPersistence) {}

  async processEvent(
    event: NormalizedPaymentWebhookEvent,
    options: { signatureValid?: boolean; eventTimestamp?: string; trustedUserId?: string } = {}
  ): Promise<ProcessWebhookOutcome> {
    const store = this.storeProvider();

    if (typeof store.runAtomicEventTransition === 'function') {
      return store.runAtomicEventTransition({
        event,
        signatureValid: Boolean(options.signatureValid ?? true),
        eventTimestamp: options.eventTimestamp || event.occurredAt,
        trustedUserId: options.trustedUserId || null,
      });
    }

    // Fallback estruturado para adaptadores em memória usados em testes unitários
    const lock = await store.acquireWebhookEventLock({
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      signatureValid: Boolean(options.signatureValid ?? true),
      eventTimestamp: options.eventTimestamp || event.occurredAt,
      eventHash: event.eventHash || null,
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
      const resolved = await this.resolveTrustedUserId(store, event, options.trustedUserId);

      if (!resolved.userId) {
        await store.finalizeWebhookEvent({
          provider: event.provider,
          providerEventId: event.providerEventId,
          processed: false,
          processingError: resolved.reasonCode || 'RECONCILIATION_REQUIRED',
        });
        return {
          success: false,
          processed: false,
          reconciliationRequired: true,
          errorCode: 'RECONCILIATION_REQUIRED',
          error: resolved.error || 'Evento sem âncora confiável persistida para associação segura.',
        };
      }

      const targetUserId = resolved.userId;
      const existingSub = await store.findSubscriptionByUserId(targetUserId);

      const incomingEventMs = Date.parse(event.occurredAt);
      const existingLastEventMs = existingSub?.last_event_at ? Date.parse(existingSub.last_event_at) : 0;
      const isStateChanging = event.canonicalAction !== 'IGNORE' && event.canonicalAction !== 'PENDING_PAYMENT';
      if (
        isStateChanging &&
        existingLastEventMs > 0 &&
        Number.isFinite(incomingEventMs) &&
        incomingEventMs < existingLastEventMs &&
        existingSub?.last_event_id !== event.providerEventId
      ) {
        await store.finalizeWebhookEvent({
          provider: event.provider,
          providerEventId: event.providerEventId,
          processed: true,
          processingError: 'STALE_OUT_OF_ORDER_IGNORED',
        });
        return {
          success: true,
          processed: true,
          ignoredStale: true,
          userId: targetUserId,
          resultingSubscriptionStatus: existingSub?.status || 'unchanged',
        };
      }

      const paymentId = event.providerOrderId || `${event.provider}_${event.providerEventId}`;
      const isSettleAction =
        event.canonicalAction === 'ACTIVATE' ||
        event.canonicalAction === 'RENEW' ||
        event.canonicalAction === 'RECOVER';

      if (isSettleAction && event.providerOrderId && store.findPaymentByProviderPaymentId) {
        const prevPay = await store.findPaymentByProviderPaymentId(paymentId);
        if (prevPay?.status === 'APPROVED') {
          await store.finalizeWebhookEvent({
            provider: event.provider,
            providerEventId: event.providerEventId,
            processed: true,
            processingError: null,
          });
          return {
            success: true,
            duplicate: true,
            processed: true,
            userId: targetUserId,
            resultingSubscriptionStatus: existingSub?.status || 'ACTIVE',
          };
        }
      }

      const transition = computeTransitionState({ event, existingSub });

      if (transition.ledgerStatus) {
        await store.upsertPaymentLedgerRecord({
          userId: targetUserId,
          attemptId: event.attemptId || null,
          provider: event.provider,
          providerPaymentId: paymentId,
          providerSubscriptionId: event.providerSubscriptionId || null,
          productId: event.productId || plan.productId,
          offerId: event.offerId || plan.offerId,
          checkoutId: event.checkoutId || plan.checkoutId,
          paymentMethod: event.paymentMethod,
          amountCents: event.amountCents || plan.amountCents,
          currency: event.currency || plan.currency,
          status: transition.ledgerStatus,
          type: transition.ledgerType,
          requestState: transition.ledgerRequestState,
          approvedAt: transition.approvedAt,
          checkoutData: {
            description: plan.description,
            event_type: event.eventType,
            canonical_action: event.canonicalAction,
            provider_event_id: event.providerEventId,
            payment_method: event.paymentMethod,
            user_email: event.customerEmail || null,
          },
        });
      }

      if (event.attemptId && transition.attemptStatus) {
        await store.updateBillingAttempt(event.attemptId, {
          status: transition.attemptStatus,
          providerOrderId: event.providerOrderId || null,
          providerSubscriptionId: event.providerSubscriptionId || null,
          metadata: { last_event_id: event.providerEventId, payment_method: event.paymentMethod },
        });
      }

      let resultingDbStatus = existingSub?.status || 'unchanged';
      if (transition.nextSubStatus && transition.nextSubPlan) {
        const dbPlan = toDbSubscriptionPlan(transition.nextSubPlan);
        const dbStatus = toDbSubscriptionStatus(transition.nextSubStatus);
        resultingDbStatus = dbStatus;

        await store.upsertSubscription({
          userId: targetUserId,
          plan: dbPlan,
          planId: plan.id,
          status: dbStatus,
          provider: event.provider,
          productId: event.productId || plan.productId,
          offerId: event.offerId || plan.offerId,
          checkoutId: event.checkoutId || plan.checkoutId,
          paymentMethod: event.paymentMethod !== 'unknown' ? event.paymentMethod : existingSub?.payment_method || null,
          amountCents: event.amountCents || plan.amountCents,
          currency: event.currency || plan.currency,
          providerSubscriptionId: event.providerSubscriptionId || null,
          currentPeriodStart: transition.periodStart,
          currentPeriodEnd: transition.periodEnd,
          nextBillingAt: transition.nextBillingAt,
          cancelAtPeriodEnd: transition.cancelAtPeriodEnd,
          canceledAt: transition.canceledAt,
          graceUntil: transition.graceUntil,
          lastEventId: event.providerEventId,
          lastEventAt: event.occurredAt,
          billingMetadata: transition.metadataPatch,
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
        resultingSubscriptionStatus: resultingDbStatus,
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

  private async resolveTrustedUserId(
    store: PaymentsPersistenceAdapter,
    event: NormalizedPaymentWebhookEvent,
    trustedUserId?: string
  ): Promise<{ userId: string | null; reasonCode?: string; error?: string }> {
    const plan = resolvePlanPrice('pro');

    if (trustedUserId && isUuid(trustedUserId)) {
      return { userId: trustedUserId };
    }

    if (event.attemptId) {
      const attempt = await store.getBillingAttemptById(event.attemptId);
      if (attempt?.user_id) {
        const integrityOk =
          attempt.product_id === plan.productId &&
          attempt.offer_id === plan.offerId &&
          attempt.currency === plan.currency &&
          (event.amountCents === undefined || Number(attempt.amount_cents) === event.amountCents);

        if (!integrityOk) {
          return {
            userId: null,
            reasonCode: 'RECONCILIATION_REQUIRED:ATTEMPT_INTEGRITY_MISMATCH',
            error: 'Divergência entre tentativa persistida e evento financeiro recebido.',
          };
        }

        if (event.userId && isUuid(event.userId) && event.userId !== attempt.user_id) {
          return {
            userId: null,
            reasonCode: 'RECONCILIATION_REQUIRED:ATTEMPT_USER_MISMATCH',
            error: 'userId do evento diverge da tentativa registrada.',
          };
        }

        return { userId: attempt.user_id };
      }
    }

    if (event.providerSubscriptionId) {
      const sub = await store.findSubscriptionByProviderSubId(event.providerSubscriptionId);
      if (sub?.user_id) return { userId: sub.user_id };
    }

    if (event.providerOrderId && store.findSubscriptionByProviderOrderId) {
      const subByOrder = await store.findSubscriptionByProviderOrderId(event.providerOrderId);
      if (subByOrder?.user_id) return { userId: subByOrder.user_id };
    }

    // Nunca associa webhook externo apenas por userId ou customerEmail não ancorado
    return {
      userId: null,
      reasonCode: 'RECONCILIATION_REQUIRED',
      error: 'Evento sem âncora persistida confiável; associação exige reconciliação autenticada.',
    };
  }
}

export const billingEventProcessor = new BillingEventProcessor();
