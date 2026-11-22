/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.3.6 + PAYMENTS V1.3 — INTEGRAÇÃO REAL EM POSTGRESQL ISOLADO (PGLITE)
 * COM ESPELHO FIEL DO ESQUEMA DE PRODUÇÃO SUPABASE
 *
 * Valida:
 * 1. Pré-estado realista de produção:
 *    - 9 registros TRIAL / TRIAL_ACTIVE em public.subscriptions com trial_starts_at/trial_ends_at reais
 *    - 1 registro legado Sharpify PRO + histórico em internal.billing_payments
 *    - Constraint legada billing_events_provider_event_id_key (UNIQUE em 1 coluna provider_event_id)
 *      e registros históricos em internal.billing_events (incluindo provider IS NULL)
 *    - internal.billing_attempts ainda inexistente
 * 2. Execução 2x da migração incremental supabase/migrations/20261122000001_payments_v1_cakto_subscriptions.sql:
 *    - Preserva 100% dos 9 trials (plan='TRIAL', plan_id='trial', provider=NULL, amount_cents=NULL, datas intactas)
 *    - ZERO trials promovidos a PRO; ZERO defaults perigosos ('pro', 'cakto', 3490)
 *    - subscriptions_plan_id_consistency_check rejeita TRIAL+pro e PRO+trial
 *    - billing_events_provider_event_id_key substituída com segurança por índice único composto (provider, provider_event_id)
 *    - Mesmo provider_event_id aceito entre provedores diferentes (sharpify vs cakto) e protegido contra duplicata no mesmo provedor
 * 3. Todos os 9 cenários obrigatórios de idempotência contextualizada em internal.billing_attempts:
 *    - Mesmo usuário + mesma chave
 *    - Mesmo usuário + chaves diferentes
 *    - Usuários diferentes + mesma chave (sem colisão global)
 *    - Requisições simultâneas concorrentes (Promise.all + 23505)
 *    - Falha entre persistência da tentativa e criação do checkout
 *    - Retry após timeout reaproveitando CREATED sem duplicar linha
 *    - Tentativa expirada (nunca libera URL, retorna 409 ATTEMPT_EXPIRED)
 *    - Tentativa paga (409 RECONCILIATION_REQUIRED)
 *    - Tentativa bloqueada (423 preservando motivo) e isolamento cross-user via JWT
 * 4. Eventos financeiros, assinatura, concorrência, rollback SQL e RLS (anon / authenticated / service_role).
 * 5. Teste de rollback seguro da migração 20261122000001 em instância isolada.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PGlite } from '@electric-sql/pglite';
import { setTestPostgresPool } from '../api/_lib/postgres.js';
import { CheckoutService } from '../api/_lib/payments/CheckoutService.js';
import { BillingEventProcessor } from '../api/_lib/payments/BillingEventProcessor.js';
import { BillingReconciliationService } from '../api/_lib/payments/BillingReconciliationService.js';
import { SubscriptionService } from '../api/_lib/payments/SubscriptionService.js';
import { CaktoClient } from '../api/_lib/payments/CaktoClient.js';
import { CaktoPaymentProvider } from '../api/_lib/payments/CaktoPaymentProvider.js';
import { WebhookVerificationService } from '../api/_lib/payments/WebhookVerificationService.js';
import { CAKTO_OFFICIAL_IDS } from '../api/_lib/plans.js';
import statusHandler from '../api/_lib/handlers/payments/status.js';
import checkoutHandler from '../api/_lib/handlers/payments/checkout.js';
import { setTestSupabaseClient } from '../api/_lib/db.js';
import { setTestRateLimiterStore } from '../api/_lib/rateLimiter.js';

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

async function createProductionMirrorDb(): Promise<{
  db: PGlite;
  trialUsers: Array<{ id: string; email: string; startIso: string; endIso: string }>;
  sharpifyUserId: string;
}> {
  const db = new PGlite();

  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS internal;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

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

    -- Espelho EXATO do estado de public.subscriptions antes da migração 20261122000001
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

    -- Espelho EXATO da tabela real com constraint legada de 1 coluna billing_events_provider_event_id_key
    CREATE TABLE IF NOT EXISTS internal.billing_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT DEFAULT 'sharpify',
      provider_event_id TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT 'webhook',
      processed BOOLEAN DEFAULT false,
      context_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT billing_events_provider_event_id_key UNIQUE (provider_event_id)
    );
  `);

  const trialUsers: Array<{ id: string; email: string; startIso: string; endIso: string }> = [];
  for (let i = 1; i <= 9; i++) {
    const uid = `10000000-0000-4000-8000-00000000000${i}`;
    const email = `trial${i}@fatosbr.com.br`;
    const startMs = Date.now() - i * 12 * 3600 * 1000;
    const endMs = startMs + 7 * 24 * 3600 * 1000;
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();
    trialUsers.push({ id: uid, email, startIso, endIso });

    await db.query(
      `INSERT INTO auth.users (id, email, created_at) VALUES ($1::uuid, $2, $3::timestamptz)`,
      [uid, email, startIso]
    );
    await db.query(
      `INSERT INTO public.subscriptions (user_id, plan, status, trial_starts_at, trial_ends_at)
       VALUES ($1::uuid, 'TRIAL', 'TRIAL_ACTIVE', $2::timestamptz, $3::timestamptz)`,
      [uid, startIso, endIso]
    );
  }

  const sharpifyUserId = '99999999-9999-4999-8999-999999999999';
  await db.query(
    `INSERT INTO auth.users (id, email, created_at) VALUES ($1::uuid, 'sharpify@fatosbr.com.br', NOW() - INTERVAL '40 days')`,
    [sharpifyUserId]
  );
  await db.query(
    `INSERT INTO public.subscriptions (user_id, plan, status, provider, current_period_start, current_period_end)
     VALUES ($1::uuid, 'PRO', 'ACTIVE', NULL, NOW() - INTERVAL '10 days', NOW() + INTERVAL '20 days')`,
    [sharpifyUserId]
  );
  await db.query(
    `INSERT INTO internal.billing_payments (user_id, provider, provider_payment_id, amount, status, type, request_state)
     VALUES ($1::uuid, 'sharpify', 'sharpify_hist_001', 3490, 'APPROVED', 'INITIAL', 'READY')`,
    [sharpifyUserId]
  );
  await db.query(
    `INSERT INTO internal.billing_events (provider, provider_event_id, processed)
     VALUES ('sharpify', 'evt_shared_external_001', true), (NULL, 'evt_legacy_null_provider', true)`
  );

  return { db, trialUsers, sharpifyUserId };
}

async function main() {
  console.log('\n======================================================');
  console.log('🐘 FATOSBR V2.3.6 + PAYMENTS V1.3 — POSTGRESQL REAL (PGLITE)');
  console.log('======================================================\n');

  const { db, trialUsers, sharpifyUserId } = await createProductionMirrorDb();
  const caktoUserId = '88888888-8888-4888-8888-888888888888';
  const caktoUserEmail = 'pg.assinante@fatosbr.com.br';
  const secondUserId = '88888888-8888-4888-8888-888888888899';
  const secondUserEmail = 'pg.assinante2@fatosbr.com.br';

  await db.query(
    `INSERT INTO auth.users (id, email, created_at) VALUES
       ($1::uuid, $2, NOW() - INTERVAL '2 days'),
       ($3::uuid, $4, NOW() - INTERVAL '2 days')`,
    [caktoUserId, caktoUserEmail, secondUserId, secondUserEmail]
  );

  // Confirma cenário pré-migração
  const preAttemptsRes = await db.query(`SELECT to_regclass('internal.billing_attempts') AS tbl`);
  const preConstraintRes = await db.query(
    `SELECT conname FROM pg_constraint WHERE conname = 'billing_events_provider_event_id_key'`
  );
  assert(
    preAttemptsRes.rows[0]?.tbl === null && preConstraintRes.rows.length === 1,
    'Cenário realista pré-migração: 9 TRIALs, sem billing_attempts e com constraint legada billing_events_provider_event_id_key'
  );

  // Executa migração DUAS VEZES para validar idempotência completa
  const migrationSql = fs.readFileSync(
    path.resolve('supabase/migrations/20261122000001_payments_v1_cakto_subscriptions.sql'),
    'utf-8'
  );
  await db.exec(migrationSql);
  await db.exec(migrationSql);
  assert(true, 'Migração 20261122000001 executada 2x sem erros (idempotente)');

  // 1. Verificar defaults e os 9 TRIALs preservados integralmente
  const defaultsRes = await db.query(`
    SELECT column_name, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name IN ('plan_id', 'provider', 'amount_cents')
  `);
  const hasDangerousDefault = defaultsRes.rows.some((r: any) => Boolean(r.column_default));
  assert(!hasDangerousDefault, 'public.subscriptions NÃO possui DEFAULT perigoso em plan_id, provider ou amount_cents');

  const trialsAfter = await db.query(`
    SELECT user_id, plan, plan_id, status, provider, amount_cents, trial_starts_at, trial_ends_at
    FROM public.subscriptions
    WHERE user_id::text LIKE '10000000-0000-4000-8000-00000000000%'
    ORDER BY user_id
  `);
  const all9Preserved =
    trialsAfter.rows.length === 9 &&
    trialsAfter.rows.every((row: any, idx: number) => {
      const expected = trialUsers[idx];
      return (
        row.plan === 'TRIAL' &&
        row.plan_id === 'trial' &&
        row.status === 'TRIAL_ACTIVE' &&
        row.provider === null &&
        row.amount_cents === null &&
        Math.abs(new Date(row.trial_starts_at).getTime() - Date.parse(expected.startIso)) < 1000 &&
        Math.abs(new Date(row.trial_ends_at).getTime() - Date.parse(expected.endIso)) < 1000
      );
    });
  assert(all9Preserved, 'Todos os 9 TRIAL / TRIAL_ACTIVE preservados: plan=TRIAL, plan_id=trial, provider=NULL, amount_cents=NULL e datas intactas');

  // Sharpify PRO backfilled somente quando há pagamento comprovado em billing_payments
  const sharpifySubAfter = await db.query(
    `SELECT plan, plan_id, status, provider FROM public.subscriptions WHERE user_id = $1::uuid`,
    [sharpifyUserId]
  );
  assert(
    sharpifySubAfter.rows[0]?.plan === 'PRO' &&
      sharpifySubAfter.rows[0]?.plan_id === 'pro' &&
      sharpifySubAfter.rows[0]?.provider === 'sharpify',
    'Registro PRO histórico vinculado a pagamento Sharpify recebeu backfill seguro provider=sharpify e plan_id=pro'
  );

  // CHECK constraint subscriptions_plan_id_consistency_check bloqueia inconsistência
  let trialWithProRejected = false;
  try {
    await db.query(`UPDATE public.subscriptions SET plan_id = 'pro' WHERE user_id = $1::uuid`, [trialUsers[0].id]);
  } catch {
    trialWithProRejected = true;
  }
  assert(trialWithProRejected, 'CHECK subscriptions_plan_id_consistency_check rejeita TRIAL com plan_id=pro');

  // 2. Reconciliação de internal.billing_events
  const postLegacyConstraint = await db.query(
    `SELECT conname FROM pg_constraint WHERE conname = 'billing_events_provider_event_id_key'`
  );
  const compositeEventIdx = await db.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'internal' AND tablename = 'billing_events' AND indexname = 'idx_billing_events_provider_event_uidx'`
  );
  const legacyEventsCheck = await db.query(
    `SELECT provider, provider_event_id FROM internal.billing_events ORDER BY provider_event_id`
  );
  assert(
    postLegacyConstraint.rows.length === 0 &&
      compositeEventIdx.rows.length === 1 &&
      legacyEventsCheck.rows.length === 2 &&
      legacyEventsCheck.rows.every((r: any) => r.provider === 'sharpify'),
    'Constraint legada billing_events_provider_event_id_key substituída por índice único composto (provider, provider_event_id) com histórico Sharpify/NULL preservado'
  );

  // Mesmo provider_event_id aceito entre provedores distintos e protegido por ON CONFLICT (provider, provider_event_id)
  await db.query(
    `INSERT INTO internal.billing_events (provider, provider_event_id, event_type, processed)
     VALUES ('cakto', 'evt_shared_external_001', 'purchase_approved', true)
     ON CONFLICT (provider, provider_event_id) DO NOTHING`
  );
  const crossProviderEvCount = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM internal.billing_events WHERE provider_event_id = 'evt_shared_external_001'`
  );
  assert(
    crossProviderEvCount.rows[0]?.cnt === 2,
    'Mesmo provider_event_id é aceito em provedores distintos (sharpify e cakto) sem colisão global'
  );

  // 3. Conecta pool shim para serviços reais em PGlite
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
    if (next) next();
    else poolBusy = false;
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
  setTestRateLimiterStore({
    checkAndIncrement: async () => ({ allowed: true, current: 1, limit: 100, retry_after: 0, remaining: 99 }),
  });

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
      return new Response(
        JSON.stringify({
          id: CAKTO_OFFICIAL_PRODUCT_ID,
          status: 'active',
          price: 34.9,
          paymentMethods: ['credit_card', 'pix_auto'],
        }),
        { status: 200 }
      );
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
          user:
            token === 'valid_pg_user'
              ? { id: caktoUserId, email: caktoUserEmail, app_metadata: {}, user_metadata: {} }
              : token === 'valid_pg_user_2'
              ? { id: secondUserId, email: secondUserEmail, app_metadata: {}, user_metadata: {} }
              : null,
        },
        error: token === 'valid_pg_user' || token === 'valid_pg_user_2' ? null : new Error('Unauthorized'),
      }),
    },
  });

  try {
    const checkoutService = new CheckoutService();
    const provider = new CaktoPaymentProvider(new CaktoClient());
    const verifier = new WebhookVerificationService();
    const processor = new BillingEventProcessor();
    const subService = new SubscriptionService();

    // Bloqueio comercial não grava em internal.billing_attempts
    process.env.CAKTO_COMMERCIAL_ENABLED = 'false';
    const preBlockOut = await checkoutService.initiateCheckout({
      userId: caktoUserId,
      userEmail: caktoUserEmail,
      planId: 'pro',
      requestedMethod: 'credit_card',
    });
    const preAttemptsCount = await db.query(`SELECT COUNT(*)::int AS cnt FROM internal.billing_attempts`);
    assert(
      preBlockOut.httpStatus === 423 && preAttemptsCount.rows[0]?.cnt === 0,
      'PostgreSQL: Checkout bloqueado comercialmente NÃO grava tentativa em internal.billing_attempts'
    );
    process.env.CAKTO_COMMERCIAL_ENABLED = 'true';

    // === TODOS OS 9 CENÁRIOS DE IDEMPOTÊNCIA CONTEXTUALIZADA ===

    // Caso 1: Mesmo usuário, mesma chave
    const out1a = await checkoutService.initiateCheckout({
      userId: caktoUserId,
      userEmail: caktoUserEmail,
      planId: 'pro',
      requestedMethod: 'credit_card',
      idempotencyKey: 'pg_idemp_key_001',
    });
    const out1b = await checkoutService.initiateCheckout({
      userId: caktoUserId,
      userEmail: caktoUserEmail,
      planId: 'pro',
      requestedMethod: 'credit_card',
      idempotencyKey: 'pg_idemp_key_001',
    });
    assert(
      out1a.httpStatus === 200 &&
        out1b.httpStatus === 200 &&
        out1a.result.attemptId === out1b.result.attemptId &&
        out1a.result.checkoutUrl === out1b.result.checkoutUrl,
      'Idempotência Caso 1: Mesmo usuário + mesma chave retorna mesmo attemptId e checkoutUrl sem duplicar'
    );

    // Caso 2: Mesmo usuário, chaves diferentes
    const out2 = await checkoutService.initiateCheckout({
      userId: caktoUserId,
      userEmail: caktoUserEmail,
      planId: 'pro',
      requestedMethod: 'pix_auto',
      idempotencyKey: 'pg_idemp_key_002',
    });
    assert(
      out2.httpStatus === 200 && Boolean(out2.result.attemptId) && out2.result.attemptId !== out1a.result.attemptId,
      'Idempotência Caso 2: Mesmo usuário + chaves diferentes cria tentativas distintas'
    );

    // Caso 3: Usuários diferentes, mesma chave (não colide globalmente!)
    const outOtherSameKey = await checkoutService.initiateCheckout({
      userId: secondUserId,
      userEmail: secondUserEmail,
      planId: 'pro',
      requestedMethod: 'credit_card',
      idempotencyKey: 'pg_idemp_key_001',
    });
    assert(
      outOtherSameKey.httpStatus === 200 &&
        Boolean(outOtherSameKey.result.attemptId) &&
        outOtherSameKey.result.attemptId !== out1a.result.attemptId,
      'Idempotência Caso 3: Usuários diferentes com a mesma idempotencyKey criam tentativas isoladas sem conflito 23505'
    );

    // Caso 4: Requisições simultâneas concorrentes (Promise.all)
    const [raceA, raceB] = await Promise.all([
      checkoutService.initiateCheckout({
        userId: secondUserId,
        userEmail: secondUserEmail,
        planId: 'pro',
        requestedMethod: 'credit_card',
        idempotencyKey: 'pg_concurrent_race_01',
      }),
      checkoutService.initiateCheckout({
        userId: secondUserId,
        userEmail: secondUserEmail,
        planId: 'pro',
        requestedMethod: 'credit_card',
        idempotencyKey: 'pg_concurrent_race_01',
      }),
    ]);
    const raceRows = await db.query(
      `SELECT id, status FROM internal.billing_attempts WHERE user_id = $1::uuid AND idempotency_key = 'pg_concurrent_race_01'`,
      [secondUserId]
    );
    assert(
      raceRows.rows.length === 1 &&
        raceA.httpStatus === 200 &&
        raceB.httpStatus === 200 &&
        raceA.result.attemptId === raceB.result.attemptId &&
        raceA.result.attemptId === raceRows.rows[0].id,
      'Idempotência Caso 4: Requisições simultâneas concorrentes geram exatamente 1 linha e convergem no mesmo attemptId'
    );

    // Caso 5 & 6: Falha entre persistência da tentativa e criação do checkout + retry após timeout
    const originalCreateSession = CaktoPaymentProvider.prototype.createCheckoutSession;
    let failOnce = true;
    CaktoPaymentProvider.prototype.createCheckoutSession = async function (input: any) {
      if (failOnce) {
        failOnce = false;
        throw new Error('CAKTO_TIMEOUT_SIMULATED');
      }
      return originalCreateSession.call(this, input);
    };
    const timeoutOut = await checkoutService.initiateCheckout({
      userId: secondUserId,
      userEmail: secondUserEmail,
      planId: 'pro',
      requestedMethod: 'credit_card',
      idempotencyKey: 'pg_timeout_retry_01',
    });
    const createdMidFailRows = await db.query(
      `SELECT id, status, metadata FROM internal.billing_attempts WHERE user_id = $1::uuid AND idempotency_key = 'pg_timeout_retry_01'`,
      [secondUserId]
    );
    CaktoPaymentProvider.prototype.createCheckoutSession = originalCreateSession;
    const retryAfterTimeout = await checkoutService.initiateCheckout({
      userId: secondUserId,
      userEmail: secondUserEmail,
      planId: 'pro',
      requestedMethod: 'credit_card',
      idempotencyKey: 'pg_timeout_retry_01',
    });
    const recoveredRows = await db.query(
      `SELECT id, status, checkout_url FROM internal.billing_attempts WHERE user_id = $1::uuid AND idempotency_key = 'pg_timeout_retry_01'`,
      [secondUserId]
    );
    assert(
      timeoutOut.httpStatus === 503 &&
        createdMidFailRows.rows.length === 1 &&
        createdMidFailRows.rows[0].status === 'CREATED' &&
        retryAfterTimeout.httpStatus === 200 &&
        recoveredRows.rows.length === 1 &&
        recoveredRows.rows[0].id === timeoutOut.result.attemptId &&
        retryAfterTimeout.result.attemptId === createdMidFailRows.rows[0].id &&
        recoveredRows.rows[0].status === 'REDIRECTED',
      'Idempotência Casos 5 & 6: Falha/timeout pós-INSERT mantém CREATED recuperável e retry com mesma chave reaproveita attemptId sem duplicar'
    );

    // Caso 7: Tentativa expirada não libera checkoutUrl
    const expiredId = crypto.randomUUID();
    await db.query(
      `INSERT INTO internal.billing_attempts (
        id, user_id, provider, plan_id, product_id, offer_id, checkout_id,
        amount_cents, currency, status, checkout_url, idempotency_key, expires_at
      ) VALUES (
        $1::uuid, $2::uuid, 'cakto', 'pro', $3, $4, '1356033',
        3490, 'BRL', 'REDIRECTED', 'https://pay.cakto.com.br/vjw92gx?expired=1', 'pg_expired_key_01', NOW() - INTERVAL '5 minutes'
      )`,
      [expiredId, secondUserId, CAKTO_OFFICIAL_PRODUCT_ID, CAKTO_OFFICIAL_OFFER_ID]
    );
    const expiredReplay = await checkoutService.initiateCheckout({
      userId: secondUserId,
      userEmail: secondUserEmail,
      planId: 'pro',
      requestedMethod: 'credit_card',
      idempotencyKey: 'pg_expired_key_01',
    });
    const expiredStatusDb = await db.query(`SELECT status FROM internal.billing_attempts WHERE id = $1::uuid`, [expiredId]);
    assert(
      expiredReplay.httpStatus === 409 &&
        expiredReplay.result.errorCode === 'ATTEMPT_EXPIRED' &&
        !expiredReplay.result.checkoutUrl &&
        expiredStatusDb.rows[0]?.status === 'EXPIRED',
      'Idempotência Caso 7: Tentativa expirada nunca libera checkoutUrl e transiciona para EXPIRED (409)'
    );

    // Caso 8: Tentativa bloqueada preserva motivo original
    const blockedId = crypto.randomUUID();
    await db.query(
      `INSERT INTO internal.billing_attempts (
        id, user_id, provider, plan_id, product_id, offer_id, checkout_id,
        amount_cents, currency, status, idempotency_key, metadata, expires_at
      ) VALUES (
        $1::uuid, $2::uuid, 'cakto', 'pro', $3, $4, '1356033',
        3490, 'BRL', 'BLOCKED', 'pg_blocked_key_01',
        '{"blocked_reason":"CAKTO_DISALLOWED_PAYMENT_METHOD_ENABLED","blocked_message":"Motivo preservado do bloqueio"}'::jsonb,
        NOW() + INTERVAL '1 hour'
      )`,
      [blockedId, secondUserId, CAKTO_OFFICIAL_PRODUCT_ID, CAKTO_OFFICIAL_OFFER_ID]
    );
    const blockedReplay = await checkoutService.initiateCheckout({
      userId: secondUserId,
      userEmail: secondUserEmail,
      planId: 'pro',
      requestedMethod: 'credit_card',
      idempotencyKey: 'pg_blocked_key_01',
    });
    assert(
      blockedReplay.httpStatus === 423 &&
        blockedReplay.result.errorCode === 'CAKTO_DISALLOWED_PAYMENT_METHOD_ENABLED' &&
        blockedReplay.result.error === 'Motivo preservado do bloqueio',
      'Idempotência Caso 8: Tentativa bloqueada preserva o motivo exato do bloqueio (HTTP 423)'
    );

    // Caso 9: Isolamento cross-user + Tentativa PAID (409)
    let crossStatus = 200;
    let crossBody: any = null;
    await checkoutHandler(
      {
        method: 'POST',
        url: '/api/payments/checkout',
        headers: { authorization: 'Bearer valid_pg_user_2' },
        body: {
          userId: caktoUserId, // tentativa de forjar userId no body deve ser ignorada
          planId: 'pro',
          paymentMethod: 'credit_card',
          idempotencyKey: 'pg_idemp_key_002', // chave que pertence apenas ao usuário 1
        },
      },
      {
        statusCode: 200,
        setHeader() {},
        end(raw: string) {
          crossStatus = this.statusCode;
          crossBody = JSON.parse(raw);
        },
      }
    );
    assert(
      crossStatus === 200 &&
        crossBody?.attemptId &&
        crossBody.attemptId !== out2.result.attemptId,
      'Idempotência Caso 9: Handler usa userId exclusivamente do JWT e usuário B nunca acessa ou sequestra tentativa do usuário A'
    );

    const paidAttemptId = out1a.result.attemptId!;
    await db.query(`UPDATE internal.billing_attempts SET status = 'PAID' WHERE id = $1::uuid`, [paidAttemptId]);
    const paidReplay = await checkoutService.initiateCheckout({
      userId: caktoUserId,
      userEmail: caktoUserEmail,
      planId: 'pro',
      requestedMethod: 'credit_card',
      idempotencyKey: 'pg_idemp_key_001',
    });
    assert(
      paidReplay.httpStatus === 409 && paidReplay.result.errorCode === 'RECONCILIATION_REQUIRED',
      'Tentativa já PAID bloqueia nova cobrança com HTTP 409 RECONCILIATION_REQUIRED'
    );
    // Restaura REDIRECTED para continuar testes do fluxo do usuário 1
    await db.query(`UPDATE internal.billing_attempts SET status = 'REDIRECTED' WHERE id = $1::uuid`, [paidAttemptId]);

    // === EVENTOS, WEBS, TRANSAÇÕES E REGRA DE TRIAL ===
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

    // Teste específico: subscription_created sobre um TRIAL existente mantém plan='TRIAL' e plan_id='trial' (compatível com CHECK!)
    const trialCheckout = await checkoutService.initiateCheckout({
      userId: trialUsers[1].id,
      userEmail: trialUsers[1].email,
      planId: 'pro',
      requestedMethod: 'credit_card',
      idempotencyKey: 'pg_trial_sub_created_01',
    });
    const trialSubCreatedVal = signAndValidate({
      event: 'subscription_created',
      id: 'evt_trial_sub_created_01',
      createdAt: new Date().toISOString(),
      data: {
        id: 'ord_trial_sub_created_01',
        sck: trialCheckout.result.attemptId,
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'credit_card',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
        subscription: { id: 'sub_trial_link_01' },
      },
    });
    const trialSubCreatedOut = await processor.processEvent(trialSubCreatedVal.normalizedEvent!, { signatureValid: true });
    const trial2Row = await db.query(
      `SELECT plan, plan_id, status, amount_cents, provider_subscription_id FROM public.subscriptions WHERE user_id = $1::uuid`,
      [trialUsers[1].id]
    );
    assert(
      trialSubCreatedOut.success &&
        trial2Row.rows[0]?.plan === 'TRIAL' &&
        trial2Row.rows[0]?.plan_id === 'trial' &&
        trial2Row.rows[0]?.status === 'TRIAL_ACTIVE' &&
        trial2Row.rows[0]?.amount_cents === null &&
        trial2Row.rows[0]?.provider_subscription_id === 'sub_trial_link_01',
      'subscription_created em usuário TRIAL preserva plan=TRIAL, plan_id=trial e amount_cents=NULL sem violar CHECK'
    );

    // Rollback transacional em erro no meio da transação
    const rollbackVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_pg_rollback_01',
      createdAt: new Date().toISOString(),
      data: {
        id: 'ord_pg_rollback_01',
        sck: paidAttemptId,
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'credit_card',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
        subscription: { id: 'sub_pg_rollback' },
      },
    });
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
      'Falha no meio da transação aciona ROLLBACK SQL completo (zero escritas parciais)'
    );

    // Eventos concorrentes idempotentes (purchase_approved duplo)
    const tActivate = new Date().toISOString();
    const activateVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_pg_real_01',
      createdAt: tActivate,
      data: {
        id: 'ord_pg_real_01',
        sck: paidAttemptId,
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'credit_card',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
        subscription: { id: 'sub_pg_real_01' },
        customer: { email: caktoUserEmail },
      },
    });
    const [concA, concB] = await Promise.all([
      processor.processEvent(activateVal.normalizedEvent!, { signatureValid: true }),
      processor.processEvent(activateVal.normalizedEvent!, { signatureValid: true }),
    ]);
    assert(
      [concA, concB].filter((r) => r.success && !r.duplicate).length === 1 &&
        [concA, concB].filter((r) => r.duplicate).length === 1,
      'Eventos simultâneos duplicados Cakto: 1 processa e 1 retorna duplicate: true sem corrida'
    );

    // Replay explícito sequencial
    const replayOutcome = await processor.processEvent(activateVal.normalizedEvent!, { signatureValid: true });
    assert(replayOutcome.success && replayOutcome.duplicate === true, 'Replay posterior do mesmo evento é absorvido de forma idempotente');

    // Evento sem âncora gera RECONCILIATION_REQUIRED e depois retry/reconciliação autenticada conclui
    const unanchoredVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_pg_unanchored_01',
      createdAt: new Date(Date.now() + 500).toISOString(),
      data: {
        id: 'ord_pg_reconcile_01',
        amount: 34.9,
        currency: 'BRL',
        paymentMethod: 'credit_card',
        product: { id: CAKTO_OFFICIAL_PRODUCT_ID },
        offer: { id: CAKTO_OFFICIAL_OFFER_ID },
      },
    });
    const unanchoredOutcome = await processor.processEvent(unanchoredVal.normalizedEvent!, { signatureValid: true });
    assert(
      !unanchoredOutcome.success && unanchoredOutcome.reconciliationRequired === true,
      'Evento sem âncora retorna RECONCILIATION_REQUIRED em internal.billing_events'
    );
    const retryAnchoredOutcome = await processor.processEvent(unanchoredVal.normalizedEvent!, {
      signatureValid: true,
      trustedUserId: secondUserId,
    });
    assert(
      retryAnchoredOutcome.success && !retryAnchoredOutcome.duplicate && retryAnchoredOutcome.resultingSubscriptionStatus === 'ACTIVE',
      'Retry/reconciliação autenticada reprocessa o mesmo evento antes pendente (processed=false -> true)'
    );

    // Reconciliação via API autenticada do provedor (com orders mockado)
    const recService = new BillingReconciliationService(undefined, processor);
    const recRes = await recService.reconcileUser({ userId: secondUserId, userEmail: secondUserEmail });
    assert(recRes.success, 'BillingReconciliationService conclui fluxo sobre PostgreSQL sem erros de SQL/schema');

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
    const viewAfterCancel = await subService.getUserSubscriptionStatus({ userId: caktoUserId, userEmail: caktoUserEmail });
    const subRowCancel = await db.query(`SELECT current_period_end FROM public.subscriptions WHERE user_id = $1::uuid`, [caktoUserId]);
    assert(
      cancelOutcome.resultingSubscriptionStatus === 'CANCELED' &&
        viewAfterCancel.hasProAccess === true &&
        Math.abs(new Date(subRowCancel.rows[0].current_period_end).getTime() - origPeriodEnd) < 1000,
      'Cancelamento mantém acesso PRO e preserva current_period_end original no PostgreSQL'
    );

    // Evento atrasado fora de ordem é ignorado
    const staleVal = signAndValidate({
      event: 'purchase_approved',
      id: 'evt_pg_stale_01',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
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
    assert(staleOutcome.success && staleOutcome.ignoredStale === true, 'Evento fora de ordem ignorado sem regredir assinatura');

    // === VERIFICAÇÃO RLS E MENOR PRIVILÉGIO NO POSTGRESQL ===
    let anonDeniedInternal = false;
    let anonDeniedSubs = false;
    let authDeniedInternal = false;
    let authDeniedInsertSub = false;
    let authReadOwnCount = 0;

    await db.exec('BEGIN');
    try {
      await db.exec('SET LOCAL ROLE anon');
      await db.query('SELECT * FROM internal.billing_attempts');
    } catch {
      anonDeniedInternal = true;
    } finally {
      await db.exec('ROLLBACK');
    }

    await db.exec('BEGIN');
    try {
      await db.exec('SET LOCAL ROLE anon');
      await db.query('SELECT * FROM public.subscriptions');
    } catch {
      anonDeniedSubs = true;
    } finally {
      await db.exec('ROLLBACK');
    }

    await db.exec('BEGIN');
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [caktoUserId]);
      await db.exec('SET LOCAL ROLE authenticated');
      await db.query('SELECT * FROM internal.billing_events');
    } catch {
      authDeniedInternal = true;
    } finally {
      await db.exec('ROLLBACK');
    }

    await db.exec('BEGIN');
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [caktoUserId]);
      await db.exec('SET LOCAL ROLE authenticated');
      await db.query(
        `INSERT INTO public.subscriptions (user_id, plan, status) VALUES ($1::uuid, 'PRO', 'ACTIVE')`,
        [caktoUserId]
      );
    } catch {
      authDeniedInsertSub = true;
    } finally {
      await db.exec('ROLLBACK');
    }

    await db.exec('BEGIN');
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [caktoUserId]);
      await db.exec('SET LOCAL ROLE authenticated');
      const ownSubs = await db.query('SELECT user_id FROM public.subscriptions');
      authReadOwnCount = ownSubs.rows.length;
    } finally {
      await db.exec('ROLLBACK');
    }

    assert(
      anonDeniedInternal &&
        anonDeniedSubs &&
        authDeniedInternal &&
        authDeniedInsertSub &&
        authReadOwnCount === 1,
      'RLS & Privilégios: anon bloqueado em tudo, authenticated bloqueado em internal.* e escrita em subscriptions, lê apenas sua própria linha'
    );

    // Histórico lê internal.billing_payments
    const hist = await subService.getUserBillingHistory(caktoUserId);
    assert(hist.length === 1 && hist[0].amountCents === 3490 && hist[0].status === 'PAID', 'Histórico do usuário retornado de internal.billing_payments');

    // Fail-closed HTTP 503 se pool cair
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
          res503Status = this.statusCode;
          res503Body = JSON.parse(raw);
        },
      }
    );
    assert(
      res503Status === 503 && res503Body?.errorCode === 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE',
      'GET /api/payments/status falha fechado com HTTP 503 em queda do banco'
    );

    // === VALIDAÇÃO DE ROLLBACK SEGURO EM BANCO ISOLADO ===
    const rbMirror = await createProductionMirrorDb();
    try {
      await rbMirror.db.exec(migrationSql);
      await rbMirror.db.exec(`
        ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_id_consistency_check;
        DROP INDEX IF EXISTS internal.idx_billing_attempts_user_provider_idemp_uidx;
        DROP INDEX IF EXISTS internal.idx_billing_events_provider_event_uidx;
        ALTER TABLE internal.billing_events
          ADD CONSTRAINT billing_events_provider_event_id_key UNIQUE (provider_event_id);
      `);
      const rbTrials = await rbMirror.db.query(
        `SELECT COUNT(*)::int AS cnt FROM public.subscriptions WHERE plan = 'TRIAL' AND status = 'TRIAL_ACTIVE'`
      );
      const rbEvents = await rbMirror.db.query(`SELECT COUNT(*)::int AS cnt FROM internal.billing_events`);
      assert(
        rbTrials.rows[0]?.cnt === 9 && rbEvents.rows[0]?.cnt === 2,
        'Rollback SQL testado em instância isolada restaura constraints sem perder os 9 trials ou histórico de eventos'
      );
    } finally {
      await rbMirror.db.close();
    }
  } finally {
    globalThis.fetch = origFetch;
    setTestPostgresPool(null);
    setTestRateLimiterStore(null as any);
    await db.close();
  }

  console.log('\n------------------------------------------------------');
  console.log(`📊 PAYMENTS V1.3 POSTGRES: ${passed} passaram, ${failed} falharam.`);
  console.log('------------------------------------------------------\n');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erro fatal na suíte Postgres Payments V1.3:', err);
  process.exit(1);
});
