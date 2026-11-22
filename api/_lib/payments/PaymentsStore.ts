/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PaymentsStore — Camada Server-Side de Persistência SQL e Adaptador de Testes para Payments V1
 *
 * Opera estritamente via executeSql (PostgreSQL direto) para acessar:
 * - public.subscriptions
 * - internal.billing_attempts
 * - internal.billing_payments
 * - internal.billing_events
 * - auth.users (leitura de fallback de e-mail / created_at)
 */

import { executeSql, isPostgresConfigured } from '../postgres.js';
import type { BillingHistoryEntry } from './types.js';

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
  canceled_at?: string | null;
  grace_until?: string | null;
  last_event_id?: string | null;
  billing_metadata?: any;
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

export interface PaymentsPersistenceAdapter {
  findSubscriptionByUserId(userId: string): Promise<DbSubscriptionRow | null>;
  findSubscriptionByProviderSubId(providerSubId: string): Promise<DbSubscriptionRow | null>;
  findUserByEmail(email: string): Promise<{ id: string; email: string; created_at?: string } | null>;
  upsertSubscription(params: {
    userId: string;
    plan: string;
    planId: string;
    status: string;
    provider: string;
    productId?: string | null;
    offerId?: string | null;
    checkoutId?: string | null;
    paymentMethod?: string | null;
    amountCents: number;
    currency: string;
    providerSubscriptionId?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    canceledAt?: string | null;
    graceUntil?: string | null;
    lastEventId?: string | null;
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
  findBillingAttemptByIdempotencyKey(userId: string, key: string): Promise<DbAttemptRow | null>;
  updateBillingAttempt(
    attemptId: string,
    patch: { status?: string; checkoutUrl?: string | null; providerOrderId?: string | null; providerSubscriptionId?: string | null; metadata?: Record<string, any> }
  ): Promise<void>;
  listOpenAttemptsForUser(userId: string): Promise<DbAttemptRow[]>;
  acquireWebhookEventLock(params: {
    provider: string;
    providerEventId: string;
    eventType: string;
    signatureValid: boolean;
    eventTimestamp?: string | null;
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
    paymentMethod: string;
    amountCents: number;
    currency: string;
    status: string;
    checkoutData: Record<string, any>;
  }): Promise<void>;
  listUserBillingHistory(userId: string): Promise<BillingHistoryEntry[]>;
  listRecentWebhookEvents(limit?: number): Promise<any[]>;
}

class PostgresPaymentsAdapter implements PaymentsPersistenceAdapter {
  private ensurePg(): void {
    if (!isPostgresConfigured()) {
      throw new Error('POSTGRES_UNAVAILABLE: Persistência financeira requer conexão PostgreSQL configurada.');
    }
  }

  async findSubscriptionByUserId(userId: string): Promise<DbSubscriptionRow | null> {
    this.ensurePg();
    const res = await executeSql(
      `SELECT * FROM public.subscriptions WHERE user_id = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`,
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

  async upsertSubscription(params: {
    userId: string;
    plan: string;
    planId: string;
    status: string;
    provider: string;
    productId?: string | null;
    offerId?: string | null;
    checkoutId?: string | null;
    paymentMethod?: string | null;
    amountCents: number;
    currency: string;
    providerSubscriptionId?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    canceledAt?: string | null;
    graceUntil?: string | null;
    lastEventId?: string | null;
    billingMetadata?: Record<string, any>;
  }): Promise<DbSubscriptionRow> {
    this.ensurePg();
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
             current_period_start = COALESCE($13::timestamptz, current_period_start),
             current_period_end = COALESCE($14::timestamptz, current_period_end),
             canceled_at = $15::timestamptz,
             grace_until = $16::timestamptz,
             last_event_id = COALESCE($17, last_event_id),
             billing_metadata = COALESCE(billing_metadata, '{}'::jsonb) || $18::jsonb,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          existing.id,
          params.plan,
          params.planId,
          params.status,
          params.provider,
          params.productId ?? null,
          params.offerId ?? null,
          params.checkoutId ?? null,
          params.paymentMethod ?? null,
          params.amountCents,
          params.currency,
          params.providerSubscriptionId ?? null,
          params.currentPeriodStart ?? null,
          params.currentPeriodEnd ?? null,
          params.canceledAt ?? null,
          params.graceUntil ?? null,
          params.lastEventId ?? null,
          metaJson,
        ]
      );
      return updateRes.rows[0];
    }

    const insertRes = await executeSql(
      `INSERT INTO public.subscriptions (
        id,
        user_id,
        plan,
        plan_id,
        status,
        provider,
        product_id,
        offer_id,
        checkout_id,
        payment_method,
        amount_cents,
        currency,
        provider_subscription_id,
        current_period_start,
        current_period_end,
        canceled_at,
        grace_until,
        last_event_id,
        billing_metadata,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13::timestamptz, $14::timestamptz, $15::timestamptz, $16::timestamptz,
        $17, $18::jsonb, NOW(), NOW()
      )
      RETURNING *`,
      [
        params.userId,
        params.plan,
        params.planId,
        params.status,
        params.provider,
        params.productId ?? null,
        params.offerId ?? null,
        params.checkoutId ?? null,
        params.paymentMethod ?? null,
        params.amountCents,
        params.currency,
        params.providerSubscriptionId ?? null,
        params.currentPeriodStart ?? null,
        params.currentPeriodEnd ?? null,
        params.canceledAt ?? null,
        params.graceUntil ?? null,
        params.lastEventId ?? null,
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
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId);
    if (!isUuid) return null;
    const res = await executeSql(`SELECT * FROM internal.billing_attempts WHERE id = $1::uuid LIMIT 1`, [attemptId]);
    return res.rows[0] || null;
  }

  async findBillingAttemptByIdempotencyKey(userId: string, key: string): Promise<DbAttemptRow | null> {
    this.ensurePg();
    const res = await executeSql(
      `SELECT * FROM internal.billing_attempts
       WHERE user_id = $1::uuid AND idempotency_key = $2
       ORDER BY created_at DESC LIMIT 1`,
      [userId, key]
    );
    return res.rows[0] || null;
  }

  async updateBillingAttempt(
    attemptId: string,
    patch: { status?: string; checkoutUrl?: string | null; providerOrderId?: string | null; providerSubscriptionId?: string | null; metadata?: Record<string, any> }
  ): Promise<void> {
    this.ensurePg();
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

  async listOpenAttemptsForUser(userId: string): Promise<DbAttemptRow[]> {
    this.ensurePg();
    const res = await executeSql(
      `SELECT * FROM internal.billing_attempts
       WHERE user_id = $1::uuid AND status IN ('CREATED', 'REDIRECTED')
       ORDER BY created_at DESC LIMIT 10`,
      [userId]
    );
    return res.rows;
  }

  async acquireWebhookEventLock(params: {
    provider: string;
    providerEventId: string;
    eventType: string;
    signatureValid: boolean;
    eventTimestamp?: string | null;
    attemptId?: string | null;
    payload: Record<string, any>;
  }): Promise<{ isDuplicate: boolean }> {
    this.ensurePg();
    const existing = await executeSql(
      `SELECT processed FROM internal.billing_events
       WHERE provider = $1 AND provider_event_id = $2 LIMIT 1`,
      [params.provider, params.providerEventId]
    );
    if (existing.rows.length > 0 && existing.rows[0].processed === true) {
      return { isDuplicate: true };
    }

    const attemptUuid =
      params.attemptId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.attemptId)
        ? params.attemptId
        : null;

    await executeSql(
      `INSERT INTO internal.billing_events (
        id, provider, provider_event_id, event_type, signature_valid, event_timestamp, attempt_id, payload, processed, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5::timestamptz, $6::uuid, $7::jsonb, false, NOW()
      )
      ON CONFLICT (provider, provider_event_id) DO UPDATE
      SET signature_valid = EXCLUDED.signature_valid,
          event_type = EXCLUDED.event_type,
          payload = EXCLUDED.payload`,
      [
        params.provider,
        params.providerEventId,
        params.eventType,
        params.signatureValid,
        params.eventTimestamp ?? null,
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

  async upsertPaymentLedgerRecord(params: {
    userId: string | null;
    attemptId?: string | null;
    provider: string;
    providerPaymentId: string;
    providerSubscriptionId?: string | null;
    productId?: string | null;
    offerId?: string | null;
    paymentMethod: string;
    amountCents: number;
    currency: string;
    status: string;
    checkoutData: Record<string, any>;
  }): Promise<void> {
    this.ensurePg();
    const attemptUuid =
      params.attemptId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.attemptId)
        ? params.attemptId
        : null;

    const existing = await executeSql(
      `SELECT id FROM internal.billing_payments WHERE provider_payment_id = $1 LIMIT 1`,
      [params.providerPaymentId]
    );

    if (existing.rows.length > 0) {
      await executeSql(
        `UPDATE internal.billing_payments
         SET status = $2,
             payment_method = COALESCE($3, payment_method),
             provider_subscription_id = COALESCE($4, provider_subscription_id),
             product_id = COALESCE($5, product_id),
             offer_id = COALESCE($6, offer_id),
             attempt_id = COALESCE($7::uuid, attempt_id),
             checkout_data = COALESCE(checkout_data, '{}'::jsonb) || $8::jsonb,
             approved_at = CASE WHEN $2 = 'PAID' THEN COALESCE(approved_at, NOW()) ELSE approved_at END,
             updated_at = NOW()
         WHERE id = $1`,
        [
          existing.rows[0].id,
          params.status,
          params.paymentMethod,
          params.providerSubscriptionId ?? null,
          params.productId ?? null,
          params.offerId ?? null,
          attemptUuid,
          JSON.stringify(params.checkoutData || {}),
        ]
      );
      return;
    }

    await executeSql(
      `INSERT INTO internal.billing_payments (
        id, user_id, attempt_id, provider, provider_payment_id, provider_subscription_id,
        product_id, offer_id, payment_method, amount, currency, status, type, request_state,
        checkout_data, approved_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, 'SUBSCRIPTION', 'COMPLETED',
        $12::jsonb, CASE WHEN $11 = 'PAID' THEN NOW() ELSE NULL END, NOW(), NOW()
      )`,
      [
        params.userId,
        attemptUuid,
        params.provider,
        params.providerPaymentId,
        params.providerSubscriptionId ?? null,
        params.productId ?? null,
        params.offerId ?? null,
        params.paymentMethod,
        params.amountCents,
        params.currency,
        params.status,
        JSON.stringify(params.checkoutData || {}),
      ]
    );
  }

  async listUserBillingHistory(userId: string): Promise<BillingHistoryEntry[]> {
    this.ensurePg();
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
      status: normalizeHistoryStatus(r.status),
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
      status: normalizeHistoryStatus(r.status),
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

function normalizeHistoryStatus(raw: string): BillingHistoryEntry['status'] {
  const s = String(raw || '').toUpperCase();
  if (s === 'PAID' || s === 'APPROVED' || s === 'COMPLETED') return 'PAID';
  if (s === 'REFUSED' || s === 'FAILED') return 'REFUSED';
  if (s === 'REFUNDED' || s === 'CHARGEBACK') return 'REFUNDED';
  if (s === 'CANCELED' || s === 'CANCELLED') return 'CANCELED';
  if (s === 'EXPIRED') return 'EXPIRED';
  if (s === 'BLOCKED') return 'BLOCKED';
  return 'PENDING';
}

function formatMethodLabel(raw?: string | null): string {
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
