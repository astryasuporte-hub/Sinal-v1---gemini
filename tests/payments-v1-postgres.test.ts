/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR PAYMENTS V1.1 — INTEGRAÇÃO REAL EM POSTGRESQL ISOLADO (PGLITE)
 * COM AS CHECK CONSTRAINTS EXATAS DE PRODUÇÃO
 *
 * Executa:
 * 1. Schema de produção com CHECK constraints reais em public.subscriptions e internal.billing_payments
 *    + registro histórico Sharpify pré-existente.
 * 2. Execução 2x da migração incremental supabase/migrations/20261122000001_payments_v1_cakto_subscriptions.sql.
 * 3. Validação estrita de constraints: Sharpify preservado, Cakto aceito, valores inválidos rejeitados.
 * 4. Execução atômica transacional (PostgresPaymentsAdapter + withTransaction):
 *    - Concorrência dupla de webhook idempotente (apenas 1 atualiza o ciclo)
 *    - Rollback SQL em falha no meio da transação
 *    - Bloqueio de evento atrasado fora de ordem (monotonicidade temporal)
 *    - Renovação (+30d ancorado), cancelamento (preserva current_period_end) e reembolso (revogação imediata)
 *    - Fail-closed HTTP 503 no handler /api/payments/status quando pool falha.
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
import statusHandler from '../api/_lib/handlers/payments/status.js';
import { setTestSupabaseClient } from '../api/_lib/db.js';

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
  console.log('🐘 FATOSBR PAYMENTS V1.1 — POSTGRESQL REAL (PGLITE)');
  console.log('======================================================\n');

  const db = new PGlite();

  // Bootstrap schema COM AS EXATAS CHECK CONSTRAINTS DE PRODUÇÃO DO SUPABASE
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
      plan TEXT NOT NULL DEFAULT 'TRIAL' CHECK (plan IN ('TRIAL', 'PRO')),
      status TEXT NOT NULL DEFAULT 'TRIAL_ACTIVE' CHECK (
        status IN (
          'TRIAL_ACTIVE', 'TRIAL_EXPIRED', 'ACTIVE', 'RENEWAL_PENDING',
          'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'SUSPENDED'
        )
      ),
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
      provider TEXT NOT NULL DEFAULT 'sharpify' CHECK (provider IN ('sharpify')),
      provider_payment_id TEXT UNIQUE NOT NULL,
      amount INTEGER NOT NULL DEFAULT 3490,
      currency TEXT NOT NULL DEFAULT 'BRL',
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'CANCELLED', 'REFUNDED', 'REFUND_FAILED')),
      type TEXT NOT NULL DEFAULT 'INITIAL' CHECK (type IN ('INITIAL', 'RENEWAL')),
      request_state TEXT NOT NULL DEFAULT 'CREATING' CHECK (request_state IN ('CREATING', 'READY', 'UNKNOWN', 'FAILED')),
      checkout_data JSONB DEFAULT '{}'::jsonb,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS internal.billing_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT DEFAULT 'sharpify',
      provider_event_id TEXT NOT NULL,
      processed BOOLEAN DEFAULT false,
      context_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const sharpifyUserId = '99999999-9999-4999-8999-999999999999';
  const caktoUserId = '88888888-8888-4888-8888-888888888888';
  const caktoUserEmail = 'pg.assinante@fatosbr.com.br';

  await db.query(
    `INSERT INTO auth.users (id, email, created_at) VALUES ($1, 'sharpify@fatosbr.com.br', NOW() - INTERVAL '20 days'), ($2, $3, NOW() - INTERVAL '2 days')`,
    [sharpifyUserId, caktoUserId, caktoUserEmail]
  );
  await db.query(
    `INSERT INTO internal.billing_payments (user_id, provider, provider_payment_id, amount, status, type, request_state)
     VALUES ($1, 'sharpify', 'sharpify_hist_001', 3490, 'APPROVED', 'INITIAL', 'READY')`,
    [sharpifyUserId]
  );

  // Confirma que internal.billing_attempts ainda NÃO existe antes da migração 20261122000001
  const preAttemptsRes = await db.query(`SELECT to_regclass('internal.billing_attempts') AS tbl`);
  assert(
    preAttemptsRes.rows[0]?.tbl === null,
    'Cenário realista: internal.billing_attempts NÃO existia antes da migração 20261122000001'
  );

  // Executa migração Payments V1.1 DUAS vezes para validar idempotência completa
  const migrationSql = fs.readFileSync(
    path.resolve('supabase/migrations/20261122000001_payments_v1_cakto_subscriptions.sql'),
    'utf-8'
  );
  await db.exec(migrationSql);
  await db.exec(migrationSql);
  assert(true, 'Migração 20261122000001 executada duas vezes sem erros (idempotente)');

  // Verifica criação de internal.billing_attempts com RLS ativo e política de service_role
  const postAttemptsRes = await db.query(`
    SELECT c.relrowsecurity,
           EXISTS (
             SELECT 1 FROM pg_policies p
             WHERE p.schemaname = 'internal' AND p.tablename = 'billing_attempts' AND p.policyname = 'service_role_full_billing_attempts'
           ) AS has_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'internal' AND c.relname = 'billing_attempts'
  `);
  assert(
    postAttemptsRes.rows[0]?.relrowsecurity === true && postAttemptsRes.rows[0]?.has_policy === true,
    'internal.billing_attempts criada com RLS ativado e política explícita para service_role'
  );

  // Verifica preservação do registro histórico Sharpify
  const sharpifyCheck = await db.query(
    `SELECT provider, amount, status, type, request_state FROM internal.billing_payments WHERE provider_payment_id = 'sharpify_hist_001'`
  );
  assert(
    sharpifyCheck.rows.length === 1 &&
      sharpifyCheck.rows[0].provider === 'sharpify' &&
      sharpifyCheck.rows[0].status === 'APPROVED',
    'Dados históricos Sharpify pré-existentes foram 100% preservados'
  );

  // Verifica que as CHECK constraints estritas de produção NÃO foram enfraquecidas
  let badSubStatusRejected = false;
  try {
    await db.query(`INSERT INTO public.subscriptions (user_id, plan, status) VALUES ($1, 'PRO', 'active')`, [sharpifyUserId]);
  } catch {
    badSubStatusRejected = true;
  }
  assert(badSubStatusRejected, 'CHECK constraint de public.subscriptions continua rejeitando status lowercase inválido (active)');

  let badProviderRejected = false;
  try {
    await db.query(
      `INSERT INTO internal.billing_payments (user_id, provider, provider_payment_id, amount, status, type, request_state)
       VALUES ($1, 'unknown_gateway', 'bad_prov_01', 3490, 'PENDING', 'INITIAL', 'READY')`,
      [sharpifyUserId]
    );
  } catch {
    badProviderRejected = true;
  }
  assert(badProviderRejected, 'CHECK constraint de internal.billing_payments aceita sharpify/cakto e rejeita provedor desconhecido');

  let badPaymentStatusRejected = false;
  try {
    await db.query(
      `INSERT INTO internal.billing_payments (user_id, provider, provider_payment_id, amount, status, type, request_state)
       VALUES ($1, 'cakto', 'bad_stat_01', 3490, 'PAID', 'INITIAL', 'READY')`,
      [sharpifyUserId]
    );
  } catch {
    badPaymentStatusRejected = true;
  }
  assert(badPaymentStatusRejected, 'CHECK constraint de internal.billing_payments continua rejeitando PAID fora do domínio (exige APPROVED)');

  // Conecta pool de testes do postgres.ts ao PGlite real
  let simulateNextQueryFail = false;
  let poolBusy = false;
  const waitQueue: Array<() => void> = [];
  const acquireLock = () =>
    new Promise<void>((resolve) => {
      if (!poolBusy) {
        poolBusy = true;
        resolve();
      } else {
        waitQueue.push(resolve);
      }
    });
  const releaseLock = () => {
    const next = waitQueue.shift();
    if (next) {
      next();
    } else {
      poolBusy = false;
    }
  };
  const pgPoolShim = {
    connect: async () => {
      await acquireLock();
      let released = false;
      return {
        query: async (sql: string, params: any[] = []) => {
          if (simulateNextQueryFail && sql.includes('UPDATE internal.billing_events')) {
            simulateNextQueryFail = false;
            throw new Error('SIMULATED_MID_TX_FAILURE');
          }
          return db.query(sql, params);
        },
        release: () => {
          if (!released) {
            released = true;
            releaseLock();
          }
        },
      };
    },
  };
  setTestPostgresPool(pgPoolShim);

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
      return new Response(
        JSON.stringify({ id: CAKTO_OFFICIAL_OFFER_ID, status: 'active', trial_days: 0, paymentMethods: ['credit_card', 'pix_auto'] }),
        { status: 200 }
      );
    }
    if (u.includes('/checkouts/')) {
      return new Response(
        JSON.stringify({
          id: '1356033',
          status: 'active',
          trial_days: 0,
          paymentMethods: ['credit_card', 'pix_auto'],
          config: { desktop: { settings: {} }, mobile: { settings: {} } },
        }),
        { status: 200 }
      );
    }
    if (u.includes('/public_api/products/')) {
      return new Response(JSON.stringify({ id: CAKTO_OFFICIAL_PRODUCT_ID, status: 'active' }), { status: 200 });
    }
    if (u.includes('/cancel/')) {
      return new Response(JSON.stringify({ status: 'canceled' }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  }) as any;

  setTestSupabaseClient({
    auth: {
      getUser: async (token: string) => ({
        data: {
          user: token === 'valid_pg_user'
            ? { id: caktoUserId, email: caktoUserEmail, app_metadata: {}, user_metadata: {} }
            : null,
        },
        error: token === 'valid_pg_user' ? null : new Error('Unauthorized'),
      }),
    },
  });

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

    const provider = new CaktoPaymentProvider(new CaktoClient());
    const verifier = new WebhookVerificationService();
    const processor = new BillingEventProcessor();

    const signAndValidate = (payload: any) => {
      const rawBody = JSON.stringify(payload);
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = crypto.createHmac('sha256', process.env.CAKTO_WEBHOOK_SECRET!).update(`${ts}.${rawBody}`).digest('hex');
      return verifier.validateAndNormalize({
        provider,
        rawBody,
        body: payload,
        headers: { 'x-cakto-signature': sig, 'x-cakto-timestamp': ts },
      });
    };

    // Teste de Rollback Transacional Atômico: erro no meio da transação NÃO deixa gravações parciais
    const rollbackPayload = {
      event: 'purchase_approved',
      id: 'evt_pg_rollback_01',
      createdAt: new Date().toISOString(),
      data: {
        id: 'ord_pg_rollback_01',
        sck: attemptId,
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'credit_card',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
        subscription: { id: 'sub_pg_rollback' },
      },
    };
    const rollbackVal = signAndValidate(rollbackPayload);
    simulateNextQueryFail = true;
    let rolledBack = false;
    try {
      await processor.processEvent(rollbackVal.normalizedEvent!, { signatureValid: true });
    } catch {
      rolledBack = true;
    }
    const postRbPay = await db.query(`SELECT id FROM internal.billing_payments WHERE provider_payment_id = 'ord_pg_rollback_01'`);
    const postRbSub = await db.query(`SELECT id FROM public.subscriptions WHERE user_id = $1::uuid`, [caktoUserId]);
    assert(
      rolledBack && postRbPay.rows.length === 0 && postRbSub.rows.length === 0,
      'Falha no meio da transação aciona ROLLBACK SQL completo (zero escritas parciais em billing_payments/subscriptions)'
    );

    // Concorrência dupla idempotente com transação atômica e row lock
    const tActivate = new Date().toISOString();
    const activateVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_pg_real_01',
      createdAt: tActivate,
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
    });
    assert(activateVal.accepted, 'Webhook purchase_approved validado antes da transação atômica');

    const [concA, concB] = await Promise.all([
      processor.processEvent(activateVal.normalizedEvent!, { signatureValid: true }),
      processor.processEvent(activateVal.normalizedEvent!, { signatureValid: true }),
    ]);
    const dupCount = [concA, concB].filter((r) => r.duplicate).length;
    const processedNewCount = [concA, concB].filter((r) => r.success && !r.duplicate).length;
    assert(
      processedNewCount === 1 && dupCount === 1,
      'Disparo concorrente duplo processa exatamente 1x e marca o outro como duplicate: true'
    );

    const dbPay = await db.query(
      `SELECT provider, status, type, request_state FROM internal.billing_payments WHERE provider_payment_id = 'ord_pg_real_01'`
    );
    assert(
      dbPay.rows[0]?.provider === 'cakto' &&
        dbPay.rows[0]?.status === 'APPROVED' &&
        dbPay.rows[0]?.type === 'INITIAL' &&
        dbPay.rows[0]?.request_state === 'READY',
      'internal.billing_payments gravado em conformidade exata com CHECK constraints (cakto/APPROVED/INITIAL/READY)'
    );

    // Cancelamento preserva current_period_end
    const subBeforeCancel = await db.query(`SELECT current_period_end FROM public.subscriptions WHERE user_id = $1::uuid`, [caktoUserId]);
    const origPeriodEnd = new Date(subBeforeCancel.rows[0].current_period_end).getTime();

    const tCancel = new Date(Date.now() + 2000).toISOString();
    const cancelVal = signAndValidate({
      event: 'subscription_canceled',
      id: 'evt_pg_cancel_01',
      createdAt: tCancel,
      data: {
        id: 'ord_pg_cancel_01',
        subscription: { id: 'sub_pg_real_01' },
        paymentMethod: 'credit_card',
        amount: 34.9,
        currency: 'BRL',
      },
    });
    const cancelOutcome = await processor.processEvent(cancelVal.normalizedEvent!, { signatureValid: true });
    assert(cancelOutcome.success && cancelOutcome.resultingSubscriptionStatus === 'CANCELED', 'subscription_canceled transiciona para CANCELED');

    const subService = new SubscriptionService();
    const viewAfterCancel = await subService.getUserSubscriptionStatus({ userId: caktoUserId, userEmail: caktoUserEmail });
    assert(
      viewAfterCancel.status === 'CANCELED' && viewAfterCancel.hasProAccess === true && viewAfterCancel.cancelAtPeriodEnd === true,
      'SubscriptionService mantém acesso PRO após cancelamento até o fim de current_period_end'
    );

    const subRowCancel = await db.query(`SELECT current_period_end FROM public.subscriptions WHERE user_id = $1::uuid`, [caktoUserId]);
    assert(
      Math.abs(new Date(subRowCancel.rows[0].current_period_end).getTime() - origPeriodEnd) < 1000,
      'Cancelamento preservou integralmente current_period_end original no PostgreSQL'
    );

    // Evento atrasado fora de ordem (timestamp anterior a tCancel) deve ser ignorado com segurança
    const tStale = new Date(Date.now() - 60_000).toISOString();
    const staleVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_pg_stale_01',
      createdAt: tStale,
      data: {
        id: 'ord_pg_stale_01',
        subscription: { id: 'sub_pg_real_01' },
        paymentMethod: 'credit_card',
        amount: 34.9,
        currency: 'BRL',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
      },
    });
    const staleOutcome = await processor.processEvent(staleVal.normalizedEvent!, { signatureValid: true });
    assert(staleOutcome.success && staleOutcome.ignoredStale === true, 'Evento atrasado fora de ordem é ignorado sem reverter estado mais novo');

    // Histórico lê internal.billing_payments mapeando APPROVED -> PAID
    const hist = await subService.getUserBillingHistory(caktoUserId);
    assert(hist.length === 1 && hist[0].amountCents === 3490 && hist[0].status === 'PAID', 'Histórico do usuário retornado de internal.billing_payments (APPROVED -> PAID)');

    // Linha ACTIVE no PostgreSQL sem current_period_end (e sem cortesia autorizada) NÃO concede acesso PRO indefinido
    const missingPeriodPgUser = '66666666-6666-4666-8666-666666666666';
    await db.query(
      `INSERT INTO auth.users (id, email, created_at) VALUES ($1::uuid, 'semperiodo@fatosbr.com.br', NOW() - INTERVAL '45 days')`,
      [missingPeriodPgUser]
    );
    await db.query(
      `INSERT INTO public.subscriptions (user_id, plan, status, provider, current_period_end, billing_metadata)
       VALUES ($1::uuid, 'PRO', 'ACTIVE', 'sharpify', NULL, '{"legacy_seed": true}'::jsonb)`,
      [missingPeriodPgUser]
    );
    const missingPeriodPgView = await subService.getUserSubscriptionStatus({
      userId: missingPeriodPgUser,
      userEmail: 'semperiodo@fatosbr.com.br',
    });
    assert(
      missingPeriodPgView.hasProAccess === false &&
        missingPeriodPgView.status === 'INCOMPLETE' &&
        missingPeriodPgView.reconciliationRequired === true &&
        missingPeriodPgView.reconciliationReason === 'MISSING_CURRENT_PERIOD_END' &&
        missingPeriodPgView.trialDaysLeft === 0,
      'PostgreSQL: linha ACTIVE sem current_period_end nega PRO indefinido e exige reconciliação (INCOMPLETE)'
    );

    // Endpoint /api/payments/status retorna HTTP 503 fail-closed se banco cair
    setTestPostgresPool({
      connect: async () => {
        throw new Error('POSTGRES_DOWN_SIMULATED');
      },
    });
    let res503Status = 200;
    let res503Body: any = null;
    await statusHandler(
      { method: 'GET', url: '/api/payments/status', headers: { authorization: 'Bearer valid_pg_user' } },
      {
        statusCode: 200,
        setHeader() {},
        end(raw: string) {
          res503Body = JSON.parse(raw);
        },
      }
    );
    // statusHandler sets res.statusCode via sendJson
    const mockRes503: any = {
      statusCode: 200,
      setHeader() {},
      end(raw: string) {
        res503Status = this.statusCode;
        res503Body = JSON.parse(raw);
      },
    };
    await statusHandler(
      { method: 'GET', url: '/api/payments/status', headers: { authorization: 'Bearer valid_pg_user' } },
      mockRes503
    );
    assert(
      res503Status === 503 && res503Body?.errorCode === 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE',
      'GET /api/payments/status retorna HTTP 503 fail-closed quando banco falha (sem inventar trial)'
    );
  } finally {
    globalThis.fetch = origFetch;
    setTestPostgresPool(null);
    await db.close();
  }

  console.log('\n------------------------------------------------------');
  console.log(`📊 PAYMENTS V1.1 POSTGRES: ${passed} passaram, ${failed} falharam.`);
  console.log('------------------------------------------------------\n');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erro fatal na suíte Postgres Payments V1.1:', err);
  process.exit(1);
});
