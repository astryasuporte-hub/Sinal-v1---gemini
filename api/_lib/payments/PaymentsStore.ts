/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PaymentsStore — Camada Server-Side de Persistência SQL e Adaptador de Testes (Payments V1.1)
 *
 * Opera estritamente via executeSql / withTransaction (PostgreSQL direto) para acessar:
 * - public.subscriptions
 * - internal.billing_attempts
 * - internal.billing_payments
 * - internal.billing_events
 * - auth.users (leitura autoritativa de created_at / e-mail)
 *
 * Toda gravação em public.subscriptions e internal.billing_payments passa pelo
 * DbContractMapper para garantir aderência 100% às CHECK constraints reais do Supabase.
 */

import crypto from 'crypto';
import { executeSql, isPostgresConfigured, withTransaction } from '../postgres.js';
import { resolvePlanPrice } from '../plans.js';
import {
  toBillingHistoryStatus,
  toDbPaymentProvider,
  toDbPaymentRequestState,
  toDbPaymentStatus,
  toDbPaymentType,
  toDbSubscriptionPlan,
  toDbSubscriptionStatus,
} from './DbContractMapper.js';
import type { BillingHistoryEntry, NormalizedPaymentWebhookEvent } from './types.js';

export interface DbSubscriptionRow {
  id: string;
  user_id: string;
  plan: string;
  plan_id?: string | null;
  status: string;
  provider?: string | null;
  product_id?: string | null;
  offer_id?: string | null;
  checkout_id?: string | null;
  payment_method?: string | null;
  amount_cents?: number | null;
  currency?: string | null;
  provider_subscription_id?: string | null;
  provider_customer_id?: string | null;
  trial_starts_at?: string | null;
  trial_ends_at?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  next_billing_at?: string | null;
  cancel_at_period_end?: boolean | null;
  canceled_at?: string | null;
  grace_until?: string | null;
  last_event_id?: string | null;
  last_event_at?: string | null;
  billing_metadata?: any;
  billing_updated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DbAttemptRow {
  id: string;
  user_id: string;
  provider: string;
  plan_id: string;
  product_id: string;
  offer_id: string;
  checkout_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  checkout_url?: string | null;
  idempotency_key?: string | null;
  provider_order_id?: string | null;
  provider_subscription_id?: string | null;
  metadata?: any;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface AtomicBillingTransitionInput {
  event: NormalizedPaymentWebhookEvent;
  signatureValid: boolean;
  eventTimestamp?: string | null;
  trustedUserId?: string | null;
}

export interface AtomicBillingTransitionOutcome {
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

export interface PaymentsPersistenceAdapter {
  findSubscriptionByUserId(userId: string): Promise<DbSubscriptionRow | null>;
  findSubscriptionByProviderSubId(providerSubId: string): Promise<DbSubscriptionRow | null>;
  findSubscriptionByProviderOrderId?(providerOrderId: string): Promise<DbSubscriptionRow | null>;
  findUserByEmail(email: string): Promise<{ id: string; email: string; created_at?: string } | null>;
  findUserCreatedAt?(userId: string): Promise<string | null>;
  upsertSubscription(params: {
    userId: string;
    plan: string;
    planId: string;
    status: string;
    provider: string | null;
    productId?: string | null;
    offerId?: string | null;
    checkoutId?: string | null;
    paymentMethod?: string | null;
    amountCents: number | null;
    currency: string;
    providerSubscriptionId?: string | null;
    trialStartsAt?: string | null;
    trialEndsAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    nextBillingAt?: string | null;
    cancelAtPeriodEnd?: boolean;
    canceledAt?: string | null;
    graceUntil?: string | null;
    lastEventId?: string | null;
    lastEventAt?: string | null;
    billingMetadata?: Record<string, any>;
  }): Promise<DbSubscriptionRow>;
  createBillingAttempt(params: {
    id: string;
    userId: string;
    provider: string;
    planId: string;
    productId: string;
    offerId: string;
    checkoutId: string;
    amountCents: number;
    currency: string;
    status: string;
    checkoutUrl?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, any>;
    expiresAt: string;
  }): Promise<DbAttemptRow>;
  getBillingAttemptById(attemptId: string): Promise<DbAttemptRow | null>;
  findBillingAttemptByProviderOrderId?(providerOrderId: string): Promise<DbAttemptRow | null>;
  findBillingAttemptByIdempotencyKey(userId: string, key: string, provider?: string): Promise<DbAttemptRow | null>;
  updateBillingAttempt(
    attemptId: string,
    patch: {
      status?: string;
      checkoutUrl?: string | null;
      providerOrderId?: string | null;
      providerSubscriptionId?: string | null;
      metadata?: Record<string, any>;
    }
  ): Promise<void>;
  listOpenAttemptsForUser(userId: string): Promise<DbAttemptRow[]>;
  listUserAttemptsForReconciliation?(userId: string): Promise<DbAttemptRow[]>;
  listUserPaymentOrderIds?(userId: string): Promise<string[]>;
  acquireWebhookEventLock(params: {
    provider: string;
    providerEventId: string;
    eventType: string;
    signatureValid: boolean;
    eventTimestamp?: string | null;
    eventHash?: string | null;
    attemptId?: string | null;
    payload: Record<string, any>;
  }): Promise<{ isDuplicate: boolean }>;
  finalizeWebhookEvent(params: {
    provider: string;
    providerEventId: string;
    processed: boolean;
    processingError?: string | null;
  }): Promise<void>;
  upsertPaymentLedgerRecord(params: {
    userId: string | null;
    attemptId?: string | null;
    provider: string;
    providerPaymentId: string;
    providerSubscriptionId?: string | null;
    productId?: string | null;
    offerId?: string | null;
    checkoutId?: string | null;
    paymentMethod: string;
    amountCents: number;
    currency: string;
    status: string;
    type?: string;
    requestState?: string;
    approvedAt?: string | null;
    checkoutData: Record<string, any>;
  }): Promise<void>;
  findPaymentByProviderPaymentId?(providerPaymentId: string): Promise<{ id: string; user_id: string | null; status: string } | null>;
  runAtomicEventTransition?(input: AtomicBillingTransitionInput): Promise<AtomicBillingTransitionOutcome>;
  listUserBillingHistory(userId: string): Promise<BillingHistoryEntry[]>;
  listRecentWebhookEvents(limit?: number): Promise<any[]>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(val?: string | null): val is string {
  return Boolean(val && UUID_REGEX.test(val.trim()));
}

export function computeTransitionState(params: {
  event: NormalizedPaymentWebhookEvent;
  existingSub: DbSubscriptionRow | null;
}) {
  const { event, existingSub } = params;
  const plan = resolvePlanPrice('pro');
  const now = new Date();
  const parsedEventMs = Date.parse(event.paidAt || event.occurredAt);
  const eventTime = Number.isFinite(parsedEventMs) ? new Date(parsedEventMs) : now;
  const periodMs = plan.periodDays * 24 * 60 * 60 * 1000;

  let nextSubPlan: 'TRIAL' | 'PRO' | null = null;
  let nextSubStatus: string | null = null;
  let ledgerStatus: string | null = null;
  let ledgerType: 'INITIAL' | 'RENEWAL' = 'INITIAL';
  let ledgerRequestState: 'CREATING' | 'READY' | 'UNKNOWN' | 'FAILED' = 'READY';
  let attemptStatus: string | null = null;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let nextBillingAt: string | null = null;
  let cancelAtPeriodEnd: boolean | undefined = undefined;
  let canceledAt: string | null | undefined = undefined;
  let graceUntil: string | null | undefined = undefined;
  let approvedAt: string | null = null;
  const metadataPatch: Record<string, any> = {
    last_event_type: event.eventType,
    last_canonical_action: event.canonicalAction,
    recurrence: plan.recurrence,
  };

  switch (event.canonicalAction) {
    case 'ACTIVATE':
    case 'RECOVER': {
      nextSubPlan = 'PRO';
      nextSubStatus = 'ACTIVE';
      ledgerStatus = 'APPROVED';
      ledgerType = event.canonicalAction === 'RECOVER' && existingSub?.plan === 'PRO' ? 'RENEWAL' : 'INITIAL';
      ledgerRequestState = 'READY';
      attemptStatus = 'PAID';
      periodStart = event.periodStart || eventTime.toISOString();
      const startMs = Date.parse(periodStart) || eventTime.getTime();
      periodEnd = event.periodEnd || event.nextBillingAt || new Date(startMs + periodMs).toISOString();
      nextBillingAt = event.nextBillingAt || periodEnd;
      cancelAtPeriodEnd = false;
      canceledAt = null;
      graceUntil = null;
      approvedAt = event.paidAt || eventTime.toISOString();
      metadataPatch.had_paid_cycle = true;
      metadataPatch.refunded = false;
      metadataPatch.chargeback = false;
      metadataPatch.expired = false;
      metadataPatch.refused = false;
      break;
    }

    case 'RENEW': {
      nextSubPlan = 'PRO';
      nextSubStatus = 'ACTIVE';
      ledgerStatus = 'APPROVED';
      ledgerType = 'RENEWAL';
      ledgerRequestState = 'READY';
      attemptStatus = 'PAID';
      const existingEndMs = existingSub?.current_period_end ? Date.parse(existingSub.current_period_end) : 0;
      const anchorMs = Math.max(Number.isFinite(existingEndMs) ? existingEndMs : 0, eventTime.getTime());
      periodStart = event.periodStart || eventTime.toISOString();
      periodEnd = event.periodEnd || event.nextBillingAt || new Date(anchorMs + periodMs).toISOString();
      nextBillingAt = event.nextBillingAt || periodEnd;
      cancelAtPeriodEnd = false;
      canceledAt = null;
      graceUntil = null;
      approvedAt = event.paidAt || eventTime.toISOString();
      metadataPatch.had_paid_cycle = true;
      metadataPatch.refunded = false;
      metadataPatch.chargeback = false;
      metadataPatch.expired = false;
      metadataPatch.refused = false;
      break;
    }

    case 'SUBSCRIPTION_CREATED': {
      // NUNCA libera PRO por subscription_created; apenas vincula provider_subscription_id sem conceder acesso pago
      metadataPatch.subscription_created_at = event.occurredAt;
      if (existingSub) {
        nextSubPlan = toDbSubscriptionPlan(existingSub.plan || 'TRIAL');
        nextSubStatus = toDbSubscriptionStatus(existingSub.status);
      } else {
        nextSubPlan = 'PRO';
        nextSubStatus = 'RENEWAL_PENDING';
        metadataPatch.pro_paid = false;
      }
      break;
    }

    case 'PAST_DUE': {
      nextSubPlan = 'PRO';
      nextSubStatus = 'PAST_DUE';
      graceUntil = new Date(eventTime.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
      break;
    }

    case 'REFUSED': {
      ledgerStatus = 'CANCELLED';
      ledgerType = event.eventType === 'subscription_renewal_refused' ? 'RENEWAL' : 'INITIAL';
      ledgerRequestState = 'FAILED';
      attemptStatus = 'REFUSED';
      metadataPatch.refused = true;
      metadataPatch.refused_at = event.occurredAt;
      const isRenewalRefusal =
        event.eventType === 'subscription_renewal_refused' ||
        (existingSub && (String(existingSub.status).toUpperCase() === 'ACTIVE' || String(existingSub.status).toUpperCase() === 'PAST_DUE'));
      nextSubPlan = 'PRO';
      nextSubStatus = isRenewalRefusal ? 'PAST_DUE' : 'INCOMPLETE';
      if (isRenewalRefusal) {
        graceUntil = new Date(eventTime.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
      }
      break;
    }

    case 'CANCEL': {
      nextSubPlan = 'PRO';
      nextSubStatus = 'CANCELED';
      cancelAtPeriodEnd = true;
      canceledAt = now.toISOString();
      // PRESERVA current_period_end existente para manter acesso PRO até o fim do ciclo pago
      periodEnd = event.periodEnd || existingSub?.current_period_end || null;
      nextBillingAt = null;
      attemptStatus = 'CANCELED';
      metadataPatch.canceled_at_event = event.occurredAt;
      break;
    }

    case 'EXPIRE': {
      nextSubPlan = 'PRO';
      nextSubStatus = 'SUSPENDED';
      attemptStatus = 'EXPIRED';
      const existingEndMs = existingSub?.current_period_end ? Date.parse(existingSub.current_period_end) : 0;
      const cappedEnd =
        existingEndMs > 0 && existingEndMs < now.getTime()
          ? new Date(existingEndMs).toISOString()
          : now.toISOString();
      periodEnd = event.periodEnd || cappedEnd;
      nextBillingAt = null;
      graceUntil = null;
      metadataPatch.expired = true;
      metadataPatch.expired_at = event.occurredAt;
      break;
    }

    case 'REFUND_REQUESTED': {
      // Apenas registra solicitação sem revogar acesso nem marcar REFUNDED antes da efetivação
      metadataPatch.refund_requested_at = event.occurredAt;
      metadataPatch.refund_requested_event_id = event.providerEventId;
      if (existingSub) {
        nextSubPlan = toDbSubscriptionPlan(existingSub.plan || 'PRO');
        nextSubStatus = toDbSubscriptionStatus(existingSub.status);
      }
      break;
    }

    case 'REFUND': {
      nextSubPlan = 'PRO';
      nextSubStatus = 'CANCELED';
      ledgerStatus = 'REFUNDED';
      ledgerType = existingSub?.plan === 'PRO' ? 'RENEWAL' : 'INITIAL';
      ledgerRequestState = 'READY';
      canceledAt = now.toISOString();
      periodEnd = now.toISOString();
      nextBillingAt = null;
      cancelAtPeriodEnd = true;
      graceUntil = null;
      metadataPatch.refunded = true;
      metadataPatch.refunded_at = event.occurredAt;
      break;
    }

    case 'CHARGEBACK': {
      nextSubPlan = 'PRO';
      nextSubStatus = 'SUSPENDED';
      ledgerStatus = 'REFUNDED';
      ledgerType = 'INITIAL';
      ledgerRequestState = 'READY';
      canceledAt = now.toISOString();
      periodEnd = now.toISOString();
      nextBillingAt = null;
      cancelAtPeriodEnd = true;
      graceUntil = null;
      metadataPatch.chargeback = true;
      metadataPatch.chargeback_at = event.occurredAt;
      break;
    }

    case 'PENDING_PAYMENT': {
      ledgerStatus = 'PENDING';
      ledgerType = 'INITIAL';
      ledgerRequestState = 'READY';
      if (!existingSub) {
        nextSubPlan = 'PRO';
        nextSubStatus = 'RENEWAL_PENDING';
        metadataPatch.pro_paid = false;
      }
      break;
    }

    default:
      break;
  }

  return {
    nextSubPlan,
    nextSubStatus,
    ledgerStatus,
    ledgerType,
    ledgerRequestState,
    attemptStatus,
    periodStart,
    periodEnd,
    nextBillingAt,
    cancelAtPeriodEnd,
    canceledAt,
    graceUntil,
    approvedAt,
    metadataPatch,
  };
}

class PostgresPaymentsAdapter implements PaymentsPersistenceAdapter {
  private ensurePg(): void {
    if (!isPostgresConfigured()) {
      throw new Error('POSTGRES_UNAVAILABLE: Persistência financeira requer conexão PostgreSQL configurada.');
    }
  }

  async findSubscriptionByUserId(userId: string): Promise<DbSubscriptionRow | null> {
    this.ensurePg();
    if (!isUuid(userId)) return null;
    const res = await executeSql(
      `SELECT * FROM public.subscriptions WHERE user_id = $1::uuid ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`,
      [userId]
    );
    return res.rows[0] || null;
  }

  async findSubscriptionByProviderSubId(providerSubId: string): Promise<DbSubscriptionRow | null> {
    this.ensurePg();
    const res = await executeSql(
      `SELECT * FROM public.subscriptions WHERE provider_subscription_id = $1 LIMIT 1`,
      [providerSubId]
    );
    return res.rows[0] || null;
  }

  async findSubscriptionByProviderOrderId(providerOrderId: string): Promise<DbSubscriptionRow | null> {
    this.ensurePg();
    const res = await executeSql(
      `SELECT s.*
       FROM public.subscriptions s
       JOIN internal.billing_payments bp ON bp.user_id = s.user_id
       WHERE bp.provider_payment_id = $1 AND bp.user_id IS NOT NULL
       ORDER BY s.updated_at DESC NULLS LAST
       LIMIT 1`,
      [providerOrderId]
    );
    return res.rows[0] || null;
  }

  async findUserByEmail(email: string): Promise<{ id: string; email: string; created_at?: string } | null> {
    this.ensurePg();
    const clean = email.trim().toLowerCase();
    const authRes = await executeSql(
      `SELECT id, email, created_at FROM auth.users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
      [clean]
    );
    if (authRes.rows[0]) return authRes.rows[0];

    try {
      const profileRes = await executeSql(
        `SELECT id, email, created_at FROM public.profiles WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
        [clean]
      );
      if (profileRes.rows[0]) return profileRes.rows[0];
    } catch {}
    return null;
  }

  async findUserCreatedAt(userId: string): Promise<string | null> {
    this.ensurePg();
    if (!isUuid(userId)) return null;
    const authRes = await executeSql(
      `SELECT created_at FROM auth.users WHERE id = $1::uuid LIMIT 1`,
      [userId]
    );
    if (authRes.rows[0]?.created_at) {
      return new Date(authRes.rows[0].created_at).toISOString();
    }
    try {
      const profileRes = await executeSql(
        `SELECT created_at FROM public.profiles WHERE id = $1::uuid LIMIT 1`,
        [userId]
      );
      if (profileRes.rows[0]?.created_at) {
        return new Date(profileRes.rows[0].created_at).toISOString();
      }
    } catch {}
    return null;
  }

  async upsertSubscription(params: {
    userId: string;
    plan: string;
    planId: string;
    status: string;
    provider: string | null;
    productId?: string | null;
    offerId?: string | null;
    checkoutId?: string | null;
    paymentMethod?: string | null;
    amountCents: number | null;
    currency: string;
    providerSubscriptionId?: string | null;
    trialStartsAt?: string | null;
    trialEndsAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    nextBillingAt?: string | null;
    cancelAtPeriodEnd?: boolean;
    canceledAt?: string | null;
    graceUntil?: string | null;
    lastEventId?: string | null;
    lastEventAt?: string | null;
    billingMetadata?: Record<string, any>;
  }): Promise<DbSubscriptionRow> {
    this.ensurePg();
    const canonicalPlan = toDbSubscriptionPlan(params.plan);
    const canonicalPlanId = canonicalPlan === 'PRO' ? 'pro' : 'trial';
    const canonicalStatus = toDbSubscriptionStatus(params.status);
    const metaJson = JSON.stringify(params.billingMetadata || {});
    const existing = await this.findSubscriptionByUserId(params.userId);

    if (existing?.id) {
      const updateRes = await executeSql(
        `UPDATE public.subscriptions
         SET plan = $2,
             plan_id = $3,
             status = $4,
             provider = $5,
             product_id = COALESCE($6, product_id),
             offer_id = COALESCE($7, offer_id),
             checkout_id = COALESCE($8, checkout_id),
             payment_method = COALESCE($9, payment_method),
             amount_cents = $10,
             currency = $11,
             provider_subscription_id = COALESCE($12, provider_subscription_id),
             trial_starts_at = COALESCE($13::timestamptz, trial_starts_at),
             trial_ends_at = COALESCE($14::timestamptz, trial_ends_at),
             current_period_start = COALESCE($15::timestamptz, current_period_start),
             current_period_end = COALESCE($16::timestamptz, current_period_end),
             next_billing_at = $17::timestamptz,
             cancel_at_period_end = COALESCE($18, cancel_at_period_end),
             canceled_at = $19::timestamptz,
             grace_until = $20::timestamptz,
             last_event_id = COALESCE($21, last_event_id),
             last_event_at = COALESCE($22::timestamptz, last_event_at),
             billing_metadata = COALESCE(billing_metadata, '{}'::jsonb) || $23::jsonb,
             billing_updated_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          existing.id,
          canonicalPlan,
          canonicalPlanId,
          canonicalStatus,
          params.provider,
          params.productId ?? null,
          params.offerId ?? null,
          params.checkoutId ?? null,
          params.paymentMethod ?? null,
          params.amountCents,
          params.currency,
          params.providerSubscriptionId ?? null,
          params.trialStartsAt ?? null,
          params.trialEndsAt ?? null,
          params.currentPeriodStart ?? null,
          params.currentPeriodEnd ?? null,
          params.nextBillingAt === undefined ? existing.next_billing_at ?? null : params.nextBillingAt,
          params.cancelAtPeriodEnd ?? null,
          params.canceledAt === undefined ? existing.canceled_at ?? null : params.canceledAt,
          params.graceUntil === undefined ? existing.grace_until ?? null : params.graceUntil,
          params.lastEventId ?? null,
          params.lastEventAt ?? null,
          metaJson,
        ]
      );
      return updateRes.rows[0];
    }

    const insertRes = await executeSql(
      `INSERT INTO public.subscriptions (
        id, user_id, plan, plan_id, status, provider,
        product_id, offer_id, checkout_id, payment_method,
        amount_cents, currency, provider_subscription_id,
        trial_starts_at, trial_ends_at,
        current_period_start, current_period_end, next_billing_at,
        cancel_at_period_end, canceled_at, grace_until,
        last_event_id, last_event_at, billing_metadata,
        billing_updated_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12,
        $13::timestamptz, $14::timestamptz,
        $15::timestamptz, $16::timestamptz, $17::timestamptz,
        COALESCE($18, false), $19::timestamptz, $20::timestamptz,
        $21, $22::timestamptz, $23::jsonb,
        NOW(), NOW(), NOW()
      )
      RETURNING *`,
      [
        params.userId,
        canonicalPlan,
        canonicalPlanId,
        canonicalStatus,
        params.provider,
        params.productId ?? null,
        params.offerId ?? null,
        params.checkoutId ?? null,
        params.paymentMethod ?? null,
        params.amountCents,
        params.currency,
        params.providerSubscriptionId ?? null,
        params.trialStartsAt ?? null,
        params.trialEndsAt ?? null,
        params.currentPeriodStart ?? null,
        params.currentPeriodEnd ?? null,
        params.nextBillingAt ?? null,
        params.cancelAtPeriodEnd ?? false,
        params.canceledAt ?? null,
        params.graceUntil ?? null,
        params.lastEventId ?? null,
        params.lastEventAt ?? null,
        metaJson,
      ]
    );
    return insertRes.rows[0];
  }

  async createBillingAttempt(params: {
    id: string;
    userId: string;
    provider: string;
    planId: string;
    productId: string;
    offerId: string;
    checkoutId: string;
    amountCents: number;
    currency: string;
    status: string;
    checkoutUrl?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, any>;
    expiresAt: string;
  }): Promise<DbAttemptRow> {
    this.ensurePg();
    const res = await executeSql(
      `INSERT INTO internal.billing_attempts (
        id, user_id, provider, plan_id, product_id, offer_id, checkout_id,
        amount_cents, currency, status, checkout_url, idempotency_key, metadata, expires_at, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13::jsonb, $14::timestamptz, NOW(), NOW()
      )
      RETURNING *`,
      [
        params.id,
        params.userId,
        params.provider,
        params.planId,
        params.productId,
        params.offerId,
        params.checkoutId,
        params.amountCents,
        params.currency,
        params.status,
        params.checkoutUrl ?? null,
        params.idempotencyKey ?? null,
        JSON.stringify(params.metadata || {}),
        params.expiresAt,
      ]
    );
    return res.rows[0];
  }

  async getBillingAttemptById(attemptId: string): Promise<DbAttemptRow | null> {
    this.ensurePg();
    if (!isUuid(attemptId)) return null;
    const res = await executeSql(`SELECT * FROM internal.billing_attempts WHERE id = $1::uuid LIMIT 1`, [attemptId]);
    return res.rows[0] || null;
  }

  async findBillingAttemptByIdempotencyKey(userId: string, key: string, provider = 'cakto'): Promise<DbAttemptRow | null> {
    this.ensurePg();
    if (!isUuid(userId)) return null;
    const res = await executeSql(
      `SELECT * FROM internal.billing_attempts
       WHERE user_id = $1::uuid AND provider = $2 AND idempotency_key = $3
       ORDER BY created_at DESC LIMIT 1`,
      [userId, provider, key]
    );
    return res.rows[0] || null;
  }

  async updateBillingAttempt(
    attemptId: string,
    patch: {
      status?: string;
      checkoutUrl?: string | null;
      providerOrderId?: string | null;
      providerSubscriptionId?: string | null;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    this.ensurePg();
    if (!isUuid(attemptId)) return;
    await executeSql(
      `UPDATE internal.billing_attempts
       SET status = COALESCE($2, status),
           checkout_url = COALESCE($3, checkout_url),
           provider_order_id = COALESCE($4, provider_order_id),
           provider_subscription_id = COALESCE($5, provider_subscription_id),
           metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
           updated_at = NOW()
       WHERE id = $1::uuid`,
      [
        attemptId,
        patch.status ?? null,
        patch.checkoutUrl ?? null,
        patch.providerOrderId ?? null,
        patch.providerSubscriptionId ?? null,
        JSON.stringify(patch.metadata || {}),
      ]
    );
  }

  async findBillingAttemptByProviderOrderId(providerOrderId: string): Promise<DbAttemptRow | null> {
    this.ensurePg();
    if (!providerOrderId) return null;
    const res = await executeSql(
      `SELECT * FROM internal.billing_attempts WHERE provider_order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [providerOrderId]
    );
    return res.rows[0] || null;
  }

  async listOpenAttemptsForUser(userId: string): Promise<DbAttemptRow[]> {
    this.ensurePg();
    if (!isUuid(userId)) return [];
    const res = await executeSql(
      `SELECT * FROM internal.billing_attempts
       WHERE user_id = $1::uuid AND status IN ('CREATED', 'REDIRECTED')
       ORDER BY created_at DESC LIMIT 10`,
      [userId]
    );
    return res.rows;
  }

  async listUserAttemptsForReconciliation(userId: string): Promise<DbAttemptRow[]> {
    this.ensurePg();
    if (!isUuid(userId)) return [];
    const res = await executeSql(
      `SELECT * FROM internal.billing_attempts
       WHERE user_id = $1::uuid AND status IN ('CREATED', 'REDIRECTED', 'EXPIRED', 'PAID')
       ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );
    return res.rows;
  }

  async listUserPaymentOrderIds(userId: string): Promise<string[]> {
    this.ensurePg();
    if (!isUuid(userId)) return [];
    const res = await executeSql(
      `SELECT provider_payment_id FROM internal.billing_payments
       WHERE user_id = $1::uuid AND provider_payment_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 25`,
      [userId]
    );
    return res.rows.map((r: any) => String(r.provider_payment_id)).filter(Boolean);
  }

  async acquireWebhookEventLock(params: {
    provider: string;
    providerEventId: string;
    eventType: string;
    signatureValid: boolean;
    eventTimestamp?: string | null;
    eventHash?: string | null;
    attemptId?: string | null;
    payload: Record<string, any>;
  }): Promise<{ isDuplicate: boolean }> {
    this.ensurePg();
    const existing = await executeSql(
      `SELECT processed FROM internal.billing_events
       WHERE provider = $1 AND (provider_event_id = $2 OR ($3::text IS NOT NULL AND event_hash = $3::text))
       LIMIT 1`,
      [params.provider, params.providerEventId, params.eventHash ?? null]
    );
    if (existing.rows.length > 0 && existing.rows[0].processed === true) {
      return { isDuplicate: true };
    }

    const attemptUuid = isUuid(params.attemptId) ? params.attemptId : null;

    await executeSql(
      `INSERT INTO internal.billing_events (
        id, provider, provider_event_id, event_type, signature_valid, event_timestamp, event_hash, attempt_id, payload, processed, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5::timestamptz, $6, $7::uuid, $8::jsonb, false, NOW()
      )
      ON CONFLICT (provider, provider_event_id) DO UPDATE
      SET signature_valid = EXCLUDED.signature_valid,
          event_type = EXCLUDED.event_type,
          event_hash = COALESCE(EXCLUDED.event_hash, internal.billing_events.event_hash),
          payload = EXCLUDED.payload`,
      [
        params.provider,
        params.providerEventId,
        params.eventType,
        params.signatureValid,
        params.eventTimestamp ?? null,
        params.eventHash ?? null,
        attemptUuid,
        JSON.stringify(params.payload || {}),
      ]
    );
    return { isDuplicate: false };
  }

  async finalizeWebhookEvent(params: {
    provider: string;
    providerEventId: string;
    processed: boolean;
    processingError?: string | null;
  }): Promise<void> {
    this.ensurePg();
    await executeSql(
      `UPDATE internal.billing_events
       SET processed = $3,
           processing_error = $4,
           processed_at = NOW()
       WHERE provider = $1 AND provider_event_id = $2`,
      [params.provider, params.providerEventId, params.processed, params.processingError ?? null]
    );
  }

  async findPaymentByProviderPaymentId(providerPaymentId: string): Promise<{ id: string; user_id: string | null; status: string } | null> {
    this.ensurePg();
    const res = await executeSql(
      `SELECT id, user_id, status FROM internal.billing_payments WHERE provider_payment_id = $1 LIMIT 1`,
      [providerPaymentId]
    );
    return res.rows[0] || null;
  }

  async upsertPaymentLedgerRecord(params: {
    userId: string | null;
    attemptId?: string | null;
    provider: string;
    providerPaymentId: string;
    providerSubscriptionId?: string | null;
    productId?: string | null;
    offerId?: string | null;
    checkoutId?: string | null;
    paymentMethod: string;
    amountCents: number;
    currency: string;
    status: string;
    type?: string;
    requestState?: string;
    approvedAt?: string | null;
    checkoutData: Record<string, any>;
  }): Promise<void> {
    this.ensurePg();
    const attemptUuid = isUuid(params.attemptId) ? params.attemptId : null;
    const dbProvider = toDbPaymentProvider(params.provider);
    const dbStatus = toDbPaymentStatus(params.status);
    const dbType = toDbPaymentType(params.type);
    const dbReqState = toDbPaymentRequestState(params.requestState);

    const existing = await executeSql(
      `SELECT id FROM internal.billing_payments WHERE provider_payment_id = $1 LIMIT 1`,
      [params.providerPaymentId]
    );

    if (existing.rows.length > 0) {
      await executeSql(
        `UPDATE internal.billing_payments
         SET user_id = COALESCE($2::uuid, user_id),
             status = $3,
             type = COALESCE($4, type),
             request_state = $5,
             payment_method = COALESCE($6, payment_method),
             provider_subscription_id = COALESCE($7, provider_subscription_id),
             product_id = COALESCE($8, product_id),
             offer_id = COALESCE($9, offer_id),
             checkout_id = COALESCE($10, checkout_id),
             attempt_id = COALESCE($11::uuid, attempt_id),
             checkout_data = COALESCE(checkout_data, '{}'::jsonb) || $12::jsonb,
             approved_at = CASE WHEN $3 = 'APPROVED' THEN COALESCE(approved_at, $13::timestamptz, NOW()) ELSE approved_at END,
             updated_at = NOW()
         WHERE id = $1`,
        [
          existing.rows[0].id,
          params.userId,
          dbStatus,
          dbType,
          dbReqState,
          params.paymentMethod,
          params.providerSubscriptionId ?? null,
          params.productId ?? null,
          params.offerId ?? null,
          params.checkoutId ?? null,
          attemptUuid,
          JSON.stringify(params.checkoutData || {}),
          params.approvedAt ?? null,
        ]
      );
      return;
    }

    await executeSql(
      `INSERT INTO internal.billing_payments (
        id, user_id, attempt_id, provider, provider_payment_id, provider_subscription_id,
        product_id, offer_id, checkout_id, payment_method, amount, currency, status, type, request_state,
        checkout_data, approved_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15::jsonb, CASE WHEN $12 = 'APPROVED' THEN COALESCE($16::timestamptz, NOW()) ELSE NULL END, NOW(), NOW()
      )`,
      [
        params.userId,
        attemptUuid,
        dbProvider,
        params.providerPaymentId,
        params.providerSubscriptionId ?? null,
        params.productId ?? null,
        params.offerId ?? null,
        params.checkoutId ?? null,
        params.paymentMethod,
        params.amountCents,
        params.currency,
        dbStatus,
        dbType,
        dbReqState,
        JSON.stringify(params.checkoutData || {}),
        params.approvedAt ?? null,
      ]
    );
  }

  /**
   * Executa TODO o fluxo de webhook/reconciliação em uma única transação PostgreSQL atômica
   * com locks explícitos (SELECT ... FOR UPDATE), proteção contra replay/duplicidade e ordenação temporal.
   */
  async runAtomicEventTransition(input: AtomicBillingTransitionInput): Promise<AtomicBillingTransitionOutcome> {
    this.ensurePg();
    const { event } = input;
    const plan = resolvePlanPrice('pro');
    const attemptUuid = isUuid(event.attemptId) ? event.attemptId : null;

    return withTransaction(async (client) => {
      // 1. Inserir/bloquear linha de evento em internal.billing_events (SAVEPOINT protege contra colisão de event_hash)
      let eventRowId: string | null = null;
      let alreadyProcessed = false;

      await client.query('SAVEPOINT sp_billing_event_insert');
      try {
        const ins = await client.query(
          `INSERT INTO internal.billing_events (
            id, provider, provider_event_id, event_type, signature_valid,
            event_timestamp, event_hash, attempt_id, payload, processed, created_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4,
            $5::timestamptz, $6, $7::uuid, $8::jsonb, false, NOW()
          )
          ON CONFLICT (provider, provider_event_id) DO NOTHING
          RETURNING id, processed`,
          [
            event.provider,
            event.providerEventId,
            event.eventType,
            input.signatureValid,
            input.eventTimestamp || event.occurredAt,
            event.eventHash || null,
            attemptUuid,
            JSON.stringify(event.rawPayload || {}),
          ]
        );
        await client.query('RELEASE SAVEPOINT sp_billing_event_insert');
        if (ins.rows.length > 0) {
          eventRowId = ins.rows[0].id;
          alreadyProcessed = Boolean(ins.rows[0].processed);
        }
      } catch (insErr: any) {
        await client.query('ROLLBACK TO SAVEPOINT sp_billing_event_insert');
        await client.query('RELEASE SAVEPOINT sp_billing_event_insert');
        if (insErr?.code !== '23505') {
          throw insErr;
        }
      }

      if (!eventRowId) {
        const lockEv = await client.query(
          `SELECT id, processed FROM internal.billing_events
           WHERE provider = $1
             AND (provider_event_id = $2 OR ($3::text IS NOT NULL AND event_hash = $3::text))
           ORDER BY created_at ASC
           LIMIT 1
           FOR UPDATE`,
          [event.provider, event.providerEventId, event.eventHash || null]
        );
        if (lockEv.rows.length > 0) {
          eventRowId = lockEv.rows[0].id;
          alreadyProcessed = Boolean(lockEv.rows[0].processed);
        }
      } else {
        // Garante lock exclusivo caso outro worker acesse a linha
        await client.query(`SELECT id FROM internal.billing_events WHERE id = $1::uuid FOR UPDATE`, [eventRowId]);
      }

      if (alreadyProcessed) {
        return {
          success: true,
          duplicate: true,
          processed: true,
        };
      }

      // 2. Resolver usuário EXCLUSIVAMENTE via âncoras confiáveis (NUNCA confiar em userId/email solto de webhook)
      let resolvedUserId: string | null = null;
      let lockedAttempt: DbAttemptRow | null = null;

      if (input.trustedUserId && isUuid(input.trustedUserId)) {
        resolvedUserId = input.trustedUserId;
      }

      if (attemptUuid) {
        const attRes = await client.query(
          `SELECT * FROM internal.billing_attempts WHERE id = $1::uuid FOR UPDATE LIMIT 1`,
          [attemptUuid]
        );
        const attRow: DbAttemptRow | undefined = attRes.rows[0];
        if (attRow) {
          lockedAttempt = attRow;
          const attemptValid =
            attRow.product_id === plan.productId &&
            attRow.offer_id === plan.offerId &&
            attRow.currency === plan.currency &&
            (event.amountCents === undefined || Number(attRow.amount_cents) === event.amountCents);

          if (!attemptValid) {
            await client.query(
              `UPDATE internal.billing_events
               SET processed = false, processing_error = $2, processed_at = NOW()
               WHERE id = $1::uuid`,
              [eventRowId, 'RECONCILIATION_REQUIRED:ATTEMPT_INTEGRITY_MISMATCH']
            );
            return {
              success: false,
              processed: false,
              reconciliationRequired: true,
              errorCode: 'RECONCILIATION_REQUIRED',
              error: 'Divergência entre tentativa persistida e payload financeiro recebido.',
            };
          }

          if (event.userId && isUuid(event.userId) && event.userId !== attRow.user_id) {
            await client.query(
              `UPDATE internal.billing_events
               SET processed = false, processing_error = $2, processed_at = NOW()
               WHERE id = $1::uuid`,
              [eventRowId, 'RECONCILIATION_REQUIRED:ATTEMPT_USER_MISMATCH']
            );
            return {
              success: false,
              processed: false,
              reconciliationRequired: true,
              errorCode: 'RECONCILIATION_REQUIRED',
              error: 'Identidade informada no evento diverge da tentativa registrada no servidor.',
            };
          }

          resolvedUserId = resolvedUserId || attRow.user_id;
        }
      }

      if (!resolvedUserId && event.providerSubscriptionId) {
        const subByProv = await client.query(
          `SELECT user_id FROM public.subscriptions WHERE provider_subscription_id = $1 FOR UPDATE LIMIT 1`,
          [event.providerSubscriptionId]
        );
        if (subByProv.rows[0]?.user_id) {
          resolvedUserId = subByProv.rows[0].user_id;
        }
      }

      if (!resolvedUserId && event.providerOrderId) {
        const payByOrder = await client.query(
          `SELECT user_id FROM internal.billing_payments
           WHERE provider_payment_id = $1 AND user_id IS NOT NULL
           LIMIT 1`,
          [event.providerOrderId]
        );
        if (payByOrder.rows[0]?.user_id) {
          resolvedUserId = payByOrder.rows[0].user_id;
        } else {
          const attByOrder = await client.query(
            `SELECT user_id FROM internal.billing_attempts WHERE provider_order_id = $1 LIMIT 1`,
            [event.providerOrderId]
          );
          if (attByOrder.rows[0]?.user_id) {
            resolvedUserId = attByOrder.rows[0].user_id;
          }
        }
      }

      if (!resolvedUserId) {
        await client.query(
          `UPDATE internal.billing_events
           SET processed = false, processing_error = 'RECONCILIATION_REQUIRED', processed_at = NOW()
           WHERE id = $1::uuid`,
          [eventRowId]
        );
        return {
          success: false,
          processed: false,
          reconciliationRequired: true,
          errorCode: 'RECONCILIATION_REQUIRED',
          error: 'Evento sem âncora persistida confiável (attempt_id / subscription_id / order_id). Encaminhado para reconciliação autenticada.',
        };
      }

      // 3. Lock exclusivo na assinatura do usuário
      const subRes = await client.query(
        `SELECT * FROM public.subscriptions
         WHERE user_id = $1::uuid
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [resolvedUserId]
      );
      const existingSub: DbSubscriptionRow | null = subRes.rows[0] || null;

      // 4. Proteção contra evento atrasado fora de ordem (monotonicidade temporal)
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
        await client.query(
          `UPDATE internal.billing_events
           SET processed = true, processing_error = 'STALE_OUT_OF_ORDER_IGNORED', processed_at = NOW()
           WHERE id = $1::uuid`,
          [eventRowId]
        );
        return {
          success: true,
          processed: true,
          ignoredStale: true,
          userId: resolvedUserId,
          resultingSubscriptionStatus: existingSub?.status || 'unchanged',
        };
      }

      // 5. Proteção contra dupla liquidação do mesmo pedido (order_id já APPROVED)
      const paymentId = event.providerOrderId || `${event.provider}_${event.providerEventId}`;
      const isSettleAction =
        event.canonicalAction === 'ACTIVATE' ||
        event.canonicalAction === 'RENEW' ||
        event.canonicalAction === 'RECOVER';

      let existingPaymentRow: any = null;
      if (event.providerOrderId) {
        const payLock = await client.query(
          `SELECT id, status, user_id FROM internal.billing_payments WHERE provider_payment_id = $1 FOR UPDATE LIMIT 1`,
          [paymentId]
        );
        existingPaymentRow = payLock.rows[0] || null;
        if (isSettleAction && existingPaymentRow?.status === 'APPROVED') {
          await client.query(
            `UPDATE internal.billing_events
             SET processed = true, processing_error = NULL, processed_at = NOW()
             WHERE id = $1::uuid`,
            [eventRowId]
          );
          return {
            success: true,
            duplicate: true,
            processed: true,
            userId: resolvedUserId,
            resultingSubscriptionStatus: existingSub?.status || 'ACTIVE',
          };
        }
      }

      // 6. Calcular transição canônica e validar estritamente com DbContractMapper
      const transition = computeTransitionState({ event, existingSub });
      const dbProvider = toDbPaymentProvider(event.provider);

      if (transition.ledgerStatus) {
        const dbPayStatus = toDbPaymentStatus(transition.ledgerStatus);
        const dbPayType = toDbPaymentType(transition.ledgerType);
        const dbReqState = toDbPaymentRequestState(transition.ledgerRequestState);
        const checkoutDataJson = JSON.stringify({
          description: plan.description,
          event_type: event.eventType,
          canonical_action: event.canonicalAction,
          provider_event_id: event.providerEventId,
          payment_method: event.paymentMethod,
          user_email: event.customerEmail || null,
        });

        if (!existingPaymentRow) {
          const payCheck = await client.query(
            `SELECT id FROM internal.billing_payments WHERE provider_payment_id = $1 FOR UPDATE LIMIT 1`,
            [paymentId]
          );
          existingPaymentRow = payCheck.rows[0] || null;
        }

        if (existingPaymentRow?.id) {
          await client.query(
            `UPDATE internal.billing_payments
             SET user_id = COALESCE($2::uuid, user_id),
                 status = $3,
                 type = COALESCE($4, type),
                 request_state = $5,
                 payment_method = COALESCE($6, payment_method),
                 provider_subscription_id = COALESCE($7, provider_subscription_id),
                 product_id = COALESCE($8, product_id),
                 offer_id = COALESCE($9, offer_id),
                 checkout_id = COALESCE($10, checkout_id),
                 attempt_id = COALESCE($11::uuid, attempt_id),
                 checkout_data = COALESCE(checkout_data, '{}'::jsonb) || $12::jsonb,
                 approved_at = CASE WHEN $3 = 'APPROVED' THEN COALESCE(approved_at, $13::timestamptz, NOW()) ELSE approved_at END,
                 updated_at = NOW()
             WHERE id = $1`,
            [
              existingPaymentRow.id,
              resolvedUserId,
              dbPayStatus,
              dbPayType,
              dbReqState,
              event.paymentMethod,
              event.providerSubscriptionId ?? null,
              event.productId || plan.productId,
              event.offerId || plan.offerId,
              event.checkoutId || plan.checkoutId,
              attemptUuid,
              checkoutDataJson,
              transition.approvedAt ?? null,
            ]
          );
        } else {
          await client.query(
            `INSERT INTO internal.billing_payments (
              id, user_id, attempt_id, provider, provider_payment_id, provider_subscription_id,
              product_id, offer_id, checkout_id, payment_method, amount, currency,
              status, type, request_state, checkout_data, approved_at, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5,
              $6, $7, $8, $9, $10, $11,
              $12, $13, $14, $15::jsonb,
              CASE WHEN $12 = 'APPROVED' THEN COALESCE($16::timestamptz, NOW()) ELSE NULL END,
              NOW(), NOW()
            )
            ON CONFLICT (provider_payment_id) DO UPDATE SET
              user_id = COALESCE(EXCLUDED.user_id, internal.billing_payments.user_id),
              status = EXCLUDED.status,
              type = COALESCE(EXCLUDED.type, internal.billing_payments.type),
              request_state = EXCLUDED.request_state,
              payment_method = COALESCE(EXCLUDED.payment_method, internal.billing_payments.payment_method),
              provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, internal.billing_payments.provider_subscription_id),
              product_id = COALESCE(EXCLUDED.product_id, internal.billing_payments.product_id),
              offer_id = COALESCE(EXCLUDED.offer_id, internal.billing_payments.offer_id),
              checkout_id = COALESCE(EXCLUDED.checkout_id, internal.billing_payments.checkout_id),
              attempt_id = COALESCE(EXCLUDED.attempt_id, internal.billing_payments.attempt_id),
              checkout_data = COALESCE(internal.billing_payments.checkout_data, '{}'::jsonb) || EXCLUDED.checkout_data,
              approved_at = CASE WHEN EXCLUDED.status = 'APPROVED' THEN COALESCE(internal.billing_payments.approved_at, EXCLUDED.approved_at, NOW()) ELSE internal.billing_payments.approved_at END,
              updated_at = NOW()`,
            [
              resolvedUserId,
              attemptUuid,
              dbProvider,
              paymentId,
              event.providerSubscriptionId ?? null,
              event.productId || plan.productId,
              event.offerId || plan.offerId,
              event.checkoutId || plan.checkoutId,
              event.paymentMethod,
              event.amountCents || plan.amountCents,
              event.currency || plan.currency,
              dbPayStatus,
              dbPayType,
              dbReqState,
              checkoutDataJson,
              transition.approvedAt ?? null,
            ]
          );
        }
      } else if (event.canonicalAction === 'REFUND_REQUESTED' && event.providerOrderId) {
        await client.query(
          `UPDATE internal.billing_payments
           SET checkout_data = COALESCE(checkout_data, '{}'::jsonb) || $2::jsonb,
               updated_at = NOW()
           WHERE provider_payment_id = $1`,
          [
            paymentId,
            JSON.stringify({
              refund_requested_at: event.occurredAt,
              refund_requested_event_id: event.providerEventId,
            }),
          ]
        );
      }

      if (attemptUuid && transition.attemptStatus) {
        const keepPaidAttempt =
          lockedAttempt?.status === 'PAID' &&
          transition.attemptStatus !== 'PAID' &&
          event.canonicalAction !== 'REFUND' &&
          event.canonicalAction !== 'CHARGEBACK';
        if (!keepPaidAttempt) {
          await client.query(
            `UPDATE internal.billing_attempts
             SET status = $2,
                 provider_order_id = COALESCE($3, provider_order_id),
                 provider_subscription_id = COALESCE($4, provider_subscription_id),
                 metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
                 updated_at = NOW()
             WHERE id = $1::uuid`,
            [
              attemptUuid,
              transition.attemptStatus,
              event.providerOrderId ?? null,
              event.providerSubscriptionId ?? null,
              JSON.stringify({
                last_event_id: event.providerEventId,
                payment_method: event.paymentMethod,
              }),
            ]
          );
        }
      }

      let resultingDbStatus = existingSub?.status || 'unchanged';
      if (transition.nextSubStatus && transition.nextSubPlan) {
        const dbSubPlan = toDbSubscriptionPlan(transition.nextSubPlan);
        const dbSubPlanId = dbSubPlan === 'PRO' ? 'pro' : 'trial';
        const resolvedSubAmountCents =
          dbSubPlan === 'PRO' ? (event.amountCents || plan.amountCents) : (existingSub?.amount_cents ?? null);
        const dbSubStatus = toDbSubscriptionStatus(transition.nextSubStatus);
        resultingDbStatus = dbSubStatus;
        const subMetaJson = JSON.stringify(transition.metadataPatch);
        const effectiveEventAt = Number.isFinite(incomingEventMs)
          ? new Date(incomingEventMs).toISOString()
          : new Date().toISOString();

        if (existingSub?.id) {
          await client.query(
            `UPDATE public.subscriptions
             SET plan = $2,
                 plan_id = $3,
                 status = $4,
                 provider = $5,
                 product_id = COALESCE($6, product_id),
                 offer_id = COALESCE($7, offer_id),
                 checkout_id = COALESCE($8, checkout_id),
                 payment_method = COALESCE(NULLIF($9, 'unknown'), payment_method),
                 amount_cents = $10,
                 currency = $11,
                 provider_subscription_id = COALESCE($12, provider_subscription_id),
                 current_period_start = COALESCE($13::timestamptz, current_period_start),
                 current_period_end = COALESCE($14::timestamptz, current_period_end),
                 next_billing_at = $15::timestamptz,
                 cancel_at_period_end = COALESCE($16, cancel_at_period_end),
                 canceled_at = $17::timestamptz,
                 grace_until = $18::timestamptz,
                 last_event_id = $19,
                 last_event_at = GREATEST(COALESCE(last_event_at, $20::timestamptz), $20::timestamptz),
                 billing_metadata = COALESCE(billing_metadata, '{}'::jsonb) || $21::jsonb,
                 billing_updated_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [
              existingSub.id,
              dbSubPlan,
              dbSubPlanId,
              dbSubStatus,
              dbProvider,
              event.productId || plan.productId,
              event.offerId || plan.offerId,
              event.checkoutId || plan.checkoutId,
              event.paymentMethod || 'unknown',
              resolvedSubAmountCents,
              event.currency || plan.currency,
              event.providerSubscriptionId ?? null,
              transition.periodStart ?? null,
              transition.periodEnd ?? null,
              transition.nextBillingAt === undefined ? existingSub.next_billing_at ?? null : transition.nextBillingAt,
              transition.cancelAtPeriodEnd ?? null,
              transition.canceledAt === undefined ? existingSub.canceled_at ?? null : transition.canceledAt,
              transition.graceUntil === undefined ? existingSub.grace_until ?? null : transition.graceUntil,
              event.providerEventId,
              effectiveEventAt,
              subMetaJson,
            ]
          );
        } else {
          await client.query(
            `INSERT INTO public.subscriptions (
              id, user_id, plan, plan_id, status, provider,
              product_id, offer_id, checkout_id, payment_method,
              amount_cents, currency, provider_subscription_id,
              current_period_start, current_period_end, next_billing_at,
              cancel_at_period_end, canceled_at, grace_until,
              last_event_id, last_event_at, billing_metadata,
              billing_updated_at, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), $1::uuid, $2, $3, $4, $5,
              $6, $7, $8, NULLIF($9, 'unknown'),
              $10, $11, $12,
              $13::timestamptz, $14::timestamptz, $15::timestamptz,
              COALESCE($16, false), $17::timestamptz, $18::timestamptz,
              $19, $20::timestamptz, $21::jsonb,
              NOW(), NOW(), NOW()
            )`,
            [
              resolvedUserId,
              dbSubPlan,
              dbSubPlanId,
              dbSubStatus,
              dbProvider,
              event.productId || plan.productId,
              event.offerId || plan.offerId,
              event.checkoutId || plan.checkoutId,
              event.paymentMethod || 'unknown',
              resolvedSubAmountCents,
              event.currency || plan.currency,
              event.providerSubscriptionId ?? null,
              transition.periodStart ?? null,
              transition.periodEnd ?? null,
              transition.nextBillingAt ?? null,
              transition.cancelAtPeriodEnd ?? false,
              transition.canceledAt ?? null,
              transition.graceUntil ?? null,
              event.providerEventId,
              effectiveEventAt,
              subMetaJson,
            ]
          );
        }
      }

      // 7. Finaliza registro do webhook dentro da mesma transação atômica
      await client.query(
        `UPDATE internal.billing_events
         SET processed = true, processing_error = NULL, processed_at = NOW()
         WHERE id = $1::uuid`,
        [eventRowId]
      );

      return {
        success: true,
        duplicate: false,
        processed: true,
        userId: resolvedUserId,
        resultingSubscriptionStatus: resultingDbStatus,
      };
    });
  }

  async listUserBillingHistory(userId: string): Promise<BillingHistoryEntry[]> {
    this.ensurePg();
    if (!isUuid(userId)) return [];
    const paymentsRes = await executeSql(
      `SELECT id, provider_payment_id, provider, payment_method, amount, currency, status, checkout_data, approved_at, created_at
       FROM internal.billing_payments
       WHERE user_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 30`,
      [userId]
    );

    const mappedPayments: BillingHistoryEntry[] = paymentsRes.rows.map((r: any) => ({
      id: String(r.id),
      date: String(r.approved_at || r.created_at),
      amountCents: Number(r.amount || 0),
      amount: Number(r.amount || 0) / 100,
      currency: 'BRL',
      status: toBillingHistoryStatus(r.status, r.checkout_data),
      paymentMethod: formatMethodLabel(r.payment_method || r.checkout_data?.payment_method),
      provider: String(r.provider || 'cakto'),
      referenceId: String(r.provider_payment_id || r.id),
      description: String(r.checkout_data?.description || 'Assinatura FatosBR PRO'),
    }));

    if (mappedPayments.length > 0) return mappedPayments;

    const attemptsRes = await executeSql(
      `SELECT id, provider, amount_cents, currency, status, metadata, created_at
       FROM internal.billing_attempts
       WHERE user_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    );

    return attemptsRes.rows.map((r: any) => ({
      id: String(r.id),
      date: String(r.created_at),
      amountCents: Number(r.amount_cents || 3490),
      amount: Number(r.amount_cents || 3490) / 100,
      currency: 'BRL',
      status: toBillingHistoryStatus(r.status, r.metadata),
      paymentMethod: formatMethodLabel(r.metadata?.requested_method),
      provider: String(r.provider || 'cakto'),
      referenceId: String(r.id),
      description: 'Tentativa FatosBR PRO',
    }));
  }

  async listRecentWebhookEvents(limit = 20): Promise<any[]> {
    this.ensurePg();
    const res = await executeSql(
      `SELECT id, provider, provider_event_id, event_type, signature_valid, processed, processing_error, event_timestamp, processed_at, created_at
       FROM internal.billing_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.min(Math.max(1, limit), 100)]
    );
    return res.rows;
  }
}

export function formatMethodLabel(raw?: string | null): string {
  const m = String(raw || '').toLowerCase().trim();
  if (m === 'credit_card') return 'Cartão de Crédito';
  if (m === 'pix_auto') return 'Pix Automático';
  if (m === 'pix') return 'Pix (Bloqueado)';
  return 'Cartão / Pix Automático';
}

const defaultAdapter = new PostgresPaymentsAdapter();
let testPersistenceOverride: PaymentsPersistenceAdapter | null = null;

export function setPaymentsPersistenceAdapter(adapter: PaymentsPersistenceAdapter | null): void {
  const isTestEnv = process.env.NODE_ENV === 'test' || process.env.FATOSBR_TEST_MODE === 'true';
  if (!isTestEnv && adapter !== null) {
    throw new Error('SECURITY_VIOLATION: Adaptador de teste Payments V1 só é permitido em ambiente de teste.');
  }
  testPersistenceOverride = adapter;
}

export function getPaymentsPersistence(): PaymentsPersistenceAdapter {
  return testPersistenceOverride || defaultAdapter;
}

export function generateDeterministicEventHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
