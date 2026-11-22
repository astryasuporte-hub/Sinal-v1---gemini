/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR PAYMENTS V1 — INTEGRAÇÃO REAL EM POSTGRESQL ISOLADO (PGLITE)
 *
 * Executa:
 * 1. Schema legado + registros legados prévios (ZynPay/históricos) para comprovar preservação sem perdas.
 * 2. Execução 2x da migração incremental supabase/migrations/20261122000001_payments_v1_cakto_subscriptions.sql (idempotência).
 * 3. Execução real de PostgresPaymentsAdapter + CheckoutService + BillingEventProcessor + SubscriptionService
 *    diretamente contra as tabelas PostgreSQL reais (public.subscriptions, internal.billing_attempts,
 *    internal.billing_payments, internal.billing_events).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PGlite } from '@electric-sql/pglite';
import { setTestPostgresPool } from '../api/_lib/postgres.js';
import { CheckoutService } from '../api/_lib/payments/CheckoutService.js';
import { BillingEventProcessor } from '../api/_lib/payments/BillingEventProcessor.js';
import { SubscriptionService } from '../api/_lib/payments/SubscriptionService.js';
import { CaktoClient } from '../api/_lib/payments/CaktoClient.js';
import { CaktoPaymentProvider } from '../api/_lib/payments/CaktoPaymentProvider.js';
import { WebhookVerificationService } from '../api/_lib/payments/WebhookVerificationService.js';
import { CAKTO_OFFICIAL_IDS } from '../api/_lib/plans.js';

const { productId: CAKTO_OFFICIAL_PRODUCT_ID, offerId: CAKTO_OFFICIAL_OFFER_ID } = CAKTO_OFFICIAL_IDS;

process.env.FATOSBR_TEST_MODE = 'true';
process.env.NODE_ENV = 'test';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('🐘 FATOSBR PAYMENTS V1 — POSTGRESQL REAL (PGLITE)');
  console.log('======================================================\n');

  const db = new PGlite();

  // Bootstrap schema mínimo pré-existente no Supabase (auth, public, internal, roles)
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS internal;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      plan TEXT NOT NULL DEFAULT 'trial',
      status TEXT NOT NULL DEFAULT 'trialing',
      provider TEXT,
      provider_subscription_id TEXT,
      provider_customer_id TEXT,
      trial_starts_at TIMESTAMPTZ,
      trial_ends_at TIMESTAMPTZ,
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS internal.billing_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      provider TEXT NOT NULL DEFAULT 'zynpay',
      provider_payment_id TEXT UNIQUE NOT NULL,
      amount INTEGER NOT NULL DEFAULT 2990,
      currency TEXT NOT NULL DEFAULT 'BRL',
      status TEXT NOT NULL DEFAULT 'PENDING',
      type TEXT DEFAULT 'PAYMENT',
      request_state TEXT DEFAULT 'COMPLETED',
      checkout_data JSONB DEFAULT '{}'::jsonb,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS internal.billing_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT DEFAULT 'zynpay',
      provider_event_id TEXT NOT NULL,
      processed BOOLEAN DEFAULT false,
      context_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Insere dados históricos legados ANTES da migração para garantir 100% de preservação
  const legacyUserId = '99999999-9999-4999-8999-999999999999';
  const caktoUserId = '88888888-8888-4888-8888-888888888888';
  const caktoUserEmail = 'pg.assinante@fatosbr.com.br';

  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'legado@fatosbr.com.br'), ($2, $3)`, [
    legacyUserId,
    caktoUserId,
    caktoUserEmail,
  ]);
  await db.query(
    `INSERT INTO internal.billing_payments (user_id, provider, provider_payment_id, amount, status) VALUES ($1, 'zynpay', 'legacy_zyn_001', 2990, 'PAID')`,
    [legacyUserId]
  );

  // Executa migração Payments V1 DUAS vezes para validar idempotência completa
  const migrationSql = fs.readFileSync(
    path.resolve('supabase/migrations/20261122000001_payments_v1_cakto_subscriptions.sql'),
    'utf-8'
  );
  await db.exec(migrationSql);
  await db.exec(migrationSql);
  assert(true, 'Migração 20261122000001 executada duas vezes sem erros (idempotente)');

  // Verifica preservação do dado legado
  const legacyCheck = await db.query(`SELECT provider, amount, status FROM internal.billing_payments WHERE provider_payment_id = 'legacy_zyn_001'`);
  assert(
    legacyCheck.rows.length === 1 && legacyCheck.rows[0].provider === 'zynpay' && legacyCheck.rows[0].amount === 2990,
    'Dados históricos prévios em internal.billing_payments foram 100% preservados'
  );

  // Conecta pool de testes do postgres.ts ao PGlite real
  const pgPoolShim = {
    connect: async () => ({
      query: (sql: string, params: any[] = []) => db.query(sql, params),
      release: () => {},
    }),
  };
  setTestPostgresPool(pgPoolShim);

  // Mock apenas da resposta HTTP externa da Cakto
  process.env.CAKTO_COMMERCIAL_ENABLED = 'true';
  process.env.CAKTO_METHODS_VERIFIED = 'true';
  process.env.CAKTO_CLIENT_ID = 'pg_client_id';
  process.env.CAKTO_CLIENT_SECRET = 'pg_client_secret';
  process.env.CAKTO_WEBHOOK_SECRET = 'whsec_pg_test_2026';

  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const u = String(input);
    if (u.includes('/public_api/token/')) {
      return new Response(JSON.stringify({ access_token: 'pg_tok', expires_in: 3600 }), { status: 200 });
    }
    if (u.includes('/public_api/offers/')) {
      return new Response(JSON.stringify({ id: CAKTO_OFFICIAL_OFFER_ID, status: 'active', paymentMethods: ['credit_card', 'pix_auto'] }), { status: 200 });
    }
    if (u.includes('/public_api/products/')) {
      return new Response(JSON.stringify({ id: CAKTO_OFFICIAL_PRODUCT_ID, status: 'active' }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  }) as any;

  try {
    const checkoutService = new CheckoutService();
    const checkoutOut = await checkoutService.initiateCheckout({
      userId: caktoUserId,
      userEmail: caktoUserEmail,
      userName: 'Assinante PG',
      planId: 'pro',
      requestedMethod: 'credit_card',
      idempotencyKey: 'pg_idemp_key_001',
    });

    assert(checkoutOut.httpStatus === 200 && Boolean(checkoutOut.result.attemptId), 'Checkout grava tentativa real em internal.billing_attempts');
    const attemptId = checkoutOut.result.attemptId!;

    const dbAttempt = await db.query(`SELECT status, amount_cents, offer_id, product_id FROM internal.billing_attempts WHERE id = $1::uuid`, [attemptId]);
    assert(
      dbAttempt.rows.length === 1 && dbAttempt.rows[0].status === 'REDIRECTED' && Number(dbAttempt.rows[0].amount_cents) === 3490,
      'Linha gravada em internal.billing_attempts com status REDIRECTED e amount_cents = 3490'
    );

    // Webhook assinado -> BillingEventProcessor real -> PostgresPaymentsAdapter -> PostgreSQL
    const payload = {
      event: 'purchase_approved',
      id: 'evt_pg_real_01',
      data: {
        id: 'ord_pg_real_01',
        sck: attemptId,
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'credit_card',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
        subscription: { id: 'sub_pg_real_01' },
        customer: { email: caktoUserEmail },
      },
    };
    const rawBody = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', process.env.CAKTO_WEBHOOK_SECRET!).update(`${ts}.${rawBody}`).digest('hex');

    const verifier = new WebhookVerificationService();
    const validation = verifier.validateAndNormalize({
      provider: new CaktoPaymentProvider(new CaktoClient()),
      rawBody,
      body: payload,
      headers: { 'x-cakto-signature': sig, 'x-cakto-timestamp': ts },
    });
    assert(validation.accepted, 'Webhook validado antes da persistência real em PostgreSQL');

    const processor = new BillingEventProcessor();
    const res1 = await processor.processEvent(validation.normalizedEvent!, { signatureValid: true });
    assert(res1.success && res1.resultingSubscriptionStatus === 'active', 'BillingEventProcessor grava em internal.billing_events, internal.billing_payments e public.subscriptions');

    // Reenvio idempotente no índice UNIQUE (provider, provider_event_id)
    const res2 = await processor.processEvent(validation.normalizedEvent!, { signatureValid: true });
    assert(res2.success && res2.duplicate === true, 'Reenvio respeita índice único (provider, provider_event_id) em internal.billing_events');

    const subService = new SubscriptionService();
    const view = await subService.getUserSubscriptionStatus({ userId: caktoUserId, userEmail: caktoUserEmail });
    assert(view.status === 'ACTIVE' && view.hasProAccess === true && view.amountCents === 3490, 'SubscriptionService lê public.subscriptions no PostgreSQL e confirma ACTIVE (R$ 34,90)');

    const hist = await subService.getUserBillingHistory(caktoUserId);
    assert(hist.length === 1 && hist[0].amountCents === 3490 && hist[0].status === 'PAID', 'Histórico do usuário retornado de internal.billing_payments');
  } finally {
    globalThis.fetch = origFetch;
    setTestPostgresPool(null);
    await db.close();
  }

  console.log('\n------------------------------------------------------');
  console.log(`📊 PAYMENTS V1 POSTGRES: ${passed} passaram, ${failed} falharam.`);
  console.log('------------------------------------------------------\n');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erro fatal na suíte Postgres Payments V1:', err);
  process.exit(1);
});
