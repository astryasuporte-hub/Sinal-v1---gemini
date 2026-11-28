/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.5.1 — SUÍTE DE VALIDAÇÃO DO NOTIFICATION OUTBOX WORKER (SPRINT 01)
 *
 * Executa em PostgreSQL real isolado (PGlite WASM) com migrações V2.3.1..V2.5.1:
 * 1. Idempotência da migração V2.5.1 (2x) + menor privilégio (`PUBLIC`/`anon`/`authenticated` bloqueados).
 * 2. Dry-run & preview de audiência sem mutar outbox nem inserir notificações.
 * 3. Backlog de 100 itens: arquivamento seguro de obsoletos (`DISCARDED`, sem DELETE) e drenagem em lotes.
 * 4. Políticas reais de acesso da conta (`account_controls`, `profiles`, `subscriptions`/trial, isenção admin).
 * 5. Proteção anti-flood por usuário (limite por janela e acumulador no lote/run).
 * 6. Recuperação de `PROCESSING` expirado sem loop infinito (incrementa attempts -> `DEAD_LETTER`).
 * 7. Falha parcial (progresso parcial + retry idempotente sem duplicar) e payload inválido -> `DEAD_LETTER` direto.
 * 8. Lock distribuído (`409` conflito e `503` fail-closed), replay administrativo (`403` para cron, `200` para admin),
 *    `getNotificationOutboxStats()` via RPC Supabase e rollback V2.5.1 não destrutivo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

import {
  notificationEngine,
  setNotificationEngineTestDeps,
} from '../api/_lib/notificationEngine.js';
import {
  enqueueNotificationOutbox,
  getNotificationOutboxStats,
  getOutboxOpsSnapshot,
  processNotificationOutboxBatch,
  setNotificationOutboxTestDeps,
} from '../api/_lib/notificationOutbox.js';
import processOutboxHandler, {
  setProcessOutboxTestDeps,
} from '../api/_lib/handlers/notifications/processOutbox.js';
import adminRouterHandler from '../api/admin/[...action].js';
import {
  acquireDistributedLeaseLock,
  setDistributedLockTestDeps,
} from '../api/_lib/distributedLock.js';

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

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    end(chunk?: string) {
      if (chunk) this.body += chunk;
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
  return res;
}

function createPgSupabaseAdapter(db: PGlite) {
  const from = (table: string) => {
    const state: {
      op: 'select' | 'insert' | 'update' | 'delete';
      selectCols: string;
      payload: any;
      wheres: Array<{ col: string; op: string; val: any }>;
      orders: Array<{ col: string; asc: boolean }>;
      limitVal?: number;
      wantSelectAfterWrite?: boolean;
      singleMode?: 'single' | 'maybeSingle';
    } = {
      op: 'select',
      selectCols: '*',
      payload: null,
      wheres: [],
      orders: [],
    };

    const buildWhere = (startIdx = 1) => {
      if (state.wheres.length === 0) return { clause: '', params: [] as any[] };
      const parts: string[] = [];
      const params: any[] = [];
      let idx = startIdx;
      for (const w of state.wheres) {
        if (w.op === 'eq') {
          parts.push(`"${w.col}" = $${idx++}`);
          params.push(w.val);
        } else if (w.op === 'gte') {
          parts.push(`"${w.col}" >= $${idx++}`);
          params.push(w.val);
        } else if (w.op === 'in') {
          const arr = Array.isArray(w.val) ? w.val : [];
          if (arr.length === 0) parts.push('FALSE');
          else {
            const ph = arr.map(() => `$${idx++}`).join(', ');
            parts.push(`"${w.col}"::text IN (${ph})`);
            params.push(...arr.map(String));
          }
        } else if (w.op === 'contains') {
          parts.push(`"${w.col}" @> $${idx++}::jsonb`);
          params.push(JSON.stringify(w.val));
        }
      }
      return { clause: ` WHERE ${parts.join(' AND ')}`, params };
    };

    const execute = async (): Promise<any> => {
      try {
        if (state.op === 'select') {
          const { clause, params } = buildWhere(1);
          const orderSql =
            state.orders.length > 0
              ? ` ORDER BY ${state.orders.map((o) => `"${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}`
              : '';
          const limitSql = typeof state.limitVal === 'number' ? ` LIMIT ${state.limitVal}` : '';
          const cols = state.selectCols === '*' ? '*' : state.selectCols;
          const res = await db.query(
            `SELECT ${cols} FROM public."${table}"${clause}${orderSql}${limitSql}`,
            params
          );
          if (state.singleMode === 'maybeSingle') return { data: res.rows[0] ?? null, error: null };
          if (state.singleMode === 'single') {
            if (res.rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'Expected single row' } };
            return { data: res.rows[0], error: null };
          }
          return { data: res.rows, count: res.rows.length, error: null };
        }

        if (state.op === 'insert') {
          const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
          const cols = Object.keys(rows[0]);
          const colList = cols.map((c) => `"${c}"`).join(', ');
          const allParams: any[] = [];
          let pIdx = 1;
          const valuesSql = rows
            .map((r) => {
              const ph = cols.map((c) => {
                const v = r[c];
                allParams.push(v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
                return `$${pIdx++}`;
              });
              return `(${ph.join(', ')})`;
            })
            .join(', ');
          const returning = state.wantSelectAfterWrite ? ` RETURNING ${state.selectCols || '*'}` : '';
          const res = await db.query(
            `INSERT INTO public."${table}" (${colList}) VALUES ${valuesSql}${returning}`,
            allParams
          );
          if (state.singleMode === 'single') return { data: res.rows[0] ?? null, error: null };
          return { data: res.rows, error: null };
        }

        if (state.op === 'update') {
          const entries = Object.entries(state.payload || {});
          const params: any[] = [];
          let idx = 1;
          const sets = entries.map(([k, v]) => {
            params.push(v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
            return `"${k}" = $${idx++}`;
          });
          const { clause, params: wParams } = buildWhere(idx);
          params.push(...wParams);
          const res = await db.query(
            `UPDATE public."${table}" SET ${sets.join(', ')}${clause}`,
            params
          );
          return { data: res.rows, error: null };
        }
        return { data: null, error: null };
      } catch (err: any) {
        return { data: null, error: { code: err?.code || 'P0001', message: err?.message || String(err) } };
      }
    };

    const chain: any = {
      select(cols = '*') {
        if (state.op === 'insert' || state.op === 'update') {
          state.wantSelectAfterWrite = true;
          state.selectCols = cols;
        } else {
          state.op = 'select';
          state.selectCols = cols;
        }
        return chain;
      },
      insert(payload: any) { state.op = 'insert'; state.payload = payload; return chain; },
      update(payload: any) { state.op = 'update'; state.payload = payload; return chain; },
      delete() { state.op = 'delete'; return chain; },
      eq(col: string, val: any) { state.wheres.push({ col, op: 'eq', val }); return chain; },
      gte(col: string, val: any) { state.wheres.push({ col, op: 'gte', val }); return chain; },
      in(col: string, val: any[]) { state.wheres.push({ col, op: 'in', val }); return chain; },
      contains(col: string, val: any) { state.wheres.push({ col, op: 'contains', val }); return chain; },
      order(col: string, optsArg?: { ascending?: boolean }) {
        state.orders.push({ col, asc: optsArg?.ascending !== false });
        return chain;
      },
      limit(n: number) { state.limitVal = n; return chain; },
      single() { state.singleMode = 'single'; return execute(); },
      maybeSingle() { state.singleMode = 'maybeSingle'; return execute(); },
      then(resolve: any, reject: any) { return execute().then(resolve, reject); },
    };
    return chain;
  };

  const rpc = async (fnName: string, args: Record<string, any> = {}) => {
    try {
      const entries = Object.entries(args || {});
      if (entries.length === 0) {
        const res = await db.query(`SELECT public."${fnName}"() AS data`);
        return { data: res.rows?.[0]?.data ?? null, error: null };
      }
      const params: any[] = [];
      const namedArgs = entries.map(([k, v], i) => {
        params.push(v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
        return `"${k}" := $${i + 1}`;
      });
      const res = await db.query(`SELECT public."${fnName}"(${namedArgs.join(', ')}) AS data`, params);
      return { data: res.rows?.[0]?.data ?? null, error: null };
    } catch (err: any) {
      return { data: null, error: { code: err?.code || 'P0001', message: err?.message || String(err) } };
    }
  };

  return { from, rpc };
}

async function setupIsolatedDatabase(): Promise<PGlite> {
  const db = new PGlite();

  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS internal;

    CREATE TABLE auth.users (
      id UUID PRIMARY KEY,
      email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    CREATE TABLE internal.user_roles (
      user_id UUID NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (user_id, role)
    );

    CREATE TABLE public.profiles (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      name TEXT,
      status TEXT DEFAULT 'ACTIVE',
      is_active BOOLEAN DEFAULT TRUE,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE public.subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      plan TEXT NOT NULL DEFAULT 'TRIAL',
      plan_id TEXT DEFAULT 'pro',
      status TEXT NOT NULL DEFAULT 'TRIAL_ACTIVE',
      provider TEXT,
      provider_subscription_id TEXT,
      payment_method TEXT,
      trial_starts_at TIMESTAMPTZ,
      trial_ends_at TIMESTAMPTZ,
      current_period_start TIMESTAMPTZ,
      current_period_end TIMESTAMPTZ,
      grace_until TIMESTAMPTZ,
      cancel_at_period_end BOOLEAN DEFAULT FALSE,
      canceled_at TIMESTAMPTZ,
      billing_metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE public.user_entity_follows (user_id UUID NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY (user_id, entity_id));
    CREATE TABLE public.user_topic_follows (user_id UUID NOT NULL, topic_id TEXT NOT NULL, PRIMARY KEY (user_id, topic_id));
    CREATE TABLE public.user_source_follows (user_id UUID NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY (user_id, source_id));

    CREATE TABLE public.user_preferences (
      id UUID PRIMARY KEY,
      briefing_email TEXT,
      email_morning_briefing BOOLEAN DEFAULT TRUE,
      email_evening_briefing BOOLEAN DEFAULT TRUE,
      email_breaking_alerts BOOLEAN DEFAULT TRUE,
      weekend_edition BOOLEAN DEFAULT FALSE,
      timezone TEXT DEFAULT 'America/Sao_Paulo',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE public.user_settings (
      user_id UUID PRIMARY KEY,
      account_controls JSONB DEFAULT '{}'::jsonb,
      is_suspended BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE public.briefings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('MORNING', 'EVENING')),
      local_date DATE NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      scheduled_for TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE public.notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      type TEXT NOT NULL CHECK (type IN (
        'NEWS_HIGH_RELEVANCE', 'BRIEFING_READY', 'TRIAL_EXPIRING',
        'TRIAL_EXPIRED', 'SUBSCRIPTION_ACTIVE', 'PAYMENT_FAILED', 'SYSTEM'
      )),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      subtitle TEXT,
      category TEXT DEFAULT 'acontecimentos',
      read BOOLEAN NOT NULL DEFAULT FALSE,
      event_id TEXT,
      entity_id TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationFiles = [
    'supabase/migrations/20261121000001_v2_3_1_canonical_preferences_briefings_notifications.sql',
    'supabase/migrations/20261122000002_v2_4_1_notifications_body_and_dedup.sql',
    'supabase/migrations/20261122000003_v2_4_1_distributed_locks_and_job_runs.sql',
    'supabase/migrations/20261122000004_v2_4_1_resend_deliveries_and_outbox.sql',
    'supabase/migrations/20261123000001_v2_4_2_webhook_idempotency_and_revision_dedup.sql',
    'supabase/migrations/20261128000001_v2_5_1_outbox_hardening.sql',
    // Executa V2.5.1 duas vezes para comprovar idempotência estrita
    'supabase/migrations/20261128000001_v2_5_1_outbox_hardening.sql',
  ];

  for (const mf of migrationFiles) {
    const sql = fs.readFileSync(path.resolve(mf), 'utf8');
    await db.exec(sql);
  }

  return db;
}

async function main() {
  console.log('\n==============================================================================');
  console.log('🛡️  FATOSBR V2.5.1 — SPRINT 01: NOTIFICATION OUTBOX WORKER HARDENING');
  console.log('==============================================================================\n');

  const savedCron = process.env.CRON_SECRET;
  const savedAdmin = process.env.ADMIN_SECRET;
  process.env.CRON_SECRET = 'cron_v251_test_secret';
  process.env.ADMIN_SECRET = 'admin_v251_test_secret';

  const db = await setupIsolatedDatabase();
  const sbAdapter = createPgSupabaseAdapter(db);

  const USER_ACTIVE = '11111111-1111-4111-8111-111111111111';
  const USER_ADMIN = '22222222-2222-4222-8222-222222222222';
  const USER_SUSPENDED = '33333333-3333-4333-8333-333333333333';
  const USER_EXPIRED = '44444444-4444-4444-8444-444444444444';
  const USER_OPT_OUT = '55555555-5555-4555-8555-555555555555';

  try {
    // -------------------------------------------------------------------------
    // 1. Segurança SQL / DCL de menor privilégio
    // -------------------------------------------------------------------------
    console.log('📋 1. Segurança SQL, Idempotência da Migração V2.5.1 & Menor Privilégio');

    let anonBlocked = false;
    let authBlocked = false;
    try {
      await db.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE anon');
        await tx.query('SELECT public.claim_notification_outbox_batch(5)');
      });
    } catch (err: any) {
      anonBlocked = String(err?.code || '') === '42501' || /permission denied/i.test(String(err?.message));
    }

    try {
      await db.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE authenticated');
        await tx.query('SELECT public.requeue_notification_outbox_items(NULL, TRUE, TRUE, 10, FALSE, TRUE)');
      });
    } catch (err: any) {
      authBlocked = String(err?.code || '') === '42501' || /permission denied/i.test(String(err?.message));
    }

    const colCheck = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt
         FROM information_schema.columns
        WHERE table_schema = 'internal'
          AND table_name = 'notification_outbox'
          AND column_name IN ('discarded_at', 'discard_reason', 'stale_recovery_count', 'execution_meta', 'last_run_id')`
    );

    assert(
      anonBlocked && authBlocked && colCheck.rows[0].cnt === 5,
      'Migração V2.5.1 aplicada 2x de forma idempotente, com colunas de auditoria e bloqueio para anon/authenticated',
      JSON.stringify({ anonBlocked, authBlocked, cols: colCheck.rows[0].cnt })
    );

    // -------------------------------------------------------------------------
    // 2. Seed realista de usuários, políticas de acesso e backlog de 100 itens
    // -------------------------------------------------------------------------
    console.log('\n📋 2. Seed de Políticas de Acesso + Backlog Histórico de 100 Itens');

    const futureIso = new Date(Date.now() + 20 * 24 * 3600_000).toISOString();
    const pastIso = new Date(Date.now() - 10 * 24 * 3600_000).toISOString();

    for (const uid of [USER_ACTIVE, USER_ADMIN, USER_SUSPENDED, USER_EXPIRED, USER_OPT_OUT]) {
      await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [uid, `${uid}@fatosbr.local`]);
      await db.query(
        `INSERT INTO public.profiles (id, user_id, name, status, is_active) VALUES ($1, $1, 'User', 'ACTIVE', true)`,
        [uid]
      );
      await db.query(
        `INSERT INTO public.user_preferences (id, email_breaking_alerts) VALUES ($1, true)`,
        [uid]
      );
      await db.query(
        `INSERT INTO public.user_entity_follows (user_id, entity_id) VALUES ($1, 'ent-petro')`,
        [uid]
      );
    }

    // Políticas distintas por usuário:
    await db.query(`INSERT INTO internal.user_roles (user_id, role) VALUES ($1, 'admin')`, [USER_ADMIN]);
    await db.query(
      `INSERT INTO public.subscriptions (user_id, plan, status, current_period_end) VALUES ($1, 'PRO', 'ACTIVE', $2)`,
      [USER_ACTIVE, futureIso]
    );
    await db.query(
      `INSERT INTO public.subscriptions (user_id, plan, status, current_period_end) VALUES ($1, 'PRO', 'ACTIVE', $2)`,
      [USER_SUSPENDED, futureIso]
    );
    await db.query(
      `INSERT INTO public.subscriptions (user_id, plan, status, trial_ends_at) VALUES ($1, 'TRIAL', 'TRIAL_EXPIRED', $2)`,
      [USER_EXPIRED, pastIso]
    );
    await db.query(
      `INSERT INTO public.subscriptions (user_id, plan, status, current_period_end) VALUES ($1, 'PRO', 'ACTIVE', $2)`,
      [USER_OPT_OUT, futureIso]
    );

    await db.query(
      `INSERT INTO public.user_settings (user_id, is_suspended, account_controls, notification_settings) VALUES
        ($1, false, '{}'::jsonb, '{"urgentEvents":true,"entityUpdates":true,"onlyHighRelevance":false}'::jsonb),
        ($2, false, '{}'::jsonb, '{"urgentEvents":true,"entityUpdates":true,"onlyHighRelevance":false}'::jsonb),
        ($3, true,  '{"suspended":true}'::jsonb, '{"urgentEvents":true,"entityUpdates":true,"onlyHighRelevance":false}'::jsonb),
        ($4, false, '{}'::jsonb, '{"urgentEvents":true,"entityUpdates":true,"onlyHighRelevance":false}'::jsonb),
        ($5, false, '{}'::jsonb, '{"urgentEvents":false,"entityUpdates":true,"onlyHighRelevance":false}'::jsonb)`,
      [USER_ACTIVE, USER_ADMIN, USER_SUSPENDED, USER_EXPIRED, USER_OPT_OUT]
    );

    // Simula backlog realista de 100 itens (90 obsoletos > 96h + 9 frescos + 1 payload inválido)
    for (let i = 1; i <= 90; i++) {
      const staleAt = new Date(Date.now() - 100 * 3600_000 + i * 1000).toISOString();
      await db.query(
        `INSERT INTO internal.notification_outbox
          (dedup_key, event_id, event_type, payload, status, created_at, updated_at, next_retry_at)
         VALUES ($1, $2, 'NEWS_HIGH_RELEVANCE', $3::jsonb, 'PENDING', $4::timestamptz, $4::timestamptz, $4::timestamptz)`,
        [
          `event:old-${i}`,
          `old-${i}`,
          JSON.stringify({ eventId: `old-${i}`, title: `Evento antigo ${i}`, relevanceScore: 90, entityIds: ['ent-petro'] }),
          staleAt,
        ]
      );
    }
    for (let i = 1; i <= 9; i++) {
      await enqueueNotificationOutbox(
        {
          eventId: `fresh-${i}`,
          title: `Petrobras evento recente ${i}`,
          relevanceScore: 92,
          entityIds: ['ent-petro'],
        },
        { queryFn: (sql, params) => db.query(sql, params) }
      );
    }
    await db.query(
      `INSERT INTO internal.notification_outbox
        (dedup_key, event_id, event_type, payload, status, created_at, next_retry_at)
       VALUES ('event:corrupted-1', 'corrupted-1', 'NEWS_HIGH_RELEVANCE', '{"eventId":"corrupted-1","title":""}'::jsonb, 'PENDING', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')`
    );

    setNotificationEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
    });
    setDistributedLockTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
    });
    setNotificationOutboxTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
      dispatchFn: notificationEngine.dispatchSegmentedNotificationsForEvent.bind(notificationEngine),
    });

    const initialStats = await getNotificationOutboxStats();
    assert(initialStats.pending === 100, `Backlog inicial exato com 100 itens PENDING (got ${initialStats.pending})`);

    // -------------------------------------------------------------------------
    // 3. Dry-Run Preview & Zero Mutação
    // -------------------------------------------------------------------------
    console.log('\n📋 3. Dry-Run & Preview de Audiência (Zero Mutação)');

    // Preview focado nos 10 itens mais antigos (obsoletos)
    const previewObsoleteRes = createMockRes();
    await processOutboxHandler(
      {
        method: 'GET',
        url: '/api/notifications/process-outbox?mode=preview&limit=10&maxAgeHours=72',
        headers: { authorization: 'Bearer cron_v251_test_secret' },
      },
      previewObsoleteRes
    );
    const previewObsJson = previewObsoleteRes.json();

    // Verifica que nada foi mutado na outbox nem em public.notifications
    const statsAfterPreview = await getNotificationOutboxStats();
    const notifsAfterPreview = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM public.notifications`);
    assert(
      previewObsoleteRes.statusCode === 200 &&
        previewObsJson?.dryRun === true &&
        previewObsJson?.claimed === 10 &&
        previewObsJson?.discarded === 10 &&
        statsAfterPreview.pending === 100 &&
        notifsAfterPreview.rows[0].cnt === 0,
      'Dry-run identifica 10 itens obsoletos sem mutar outbox nem inserir notificações',
      JSON.stringify({ previewObsJson, statsAfterPreview, notifCnt: notifsAfterPreview.rows[0].cnt })
    );

    // -------------------------------------------------------------------------
    // 4. Arquivamento Seguro de Obsoletos (DISCARDED) & Guarda Admin
    // -------------------------------------------------------------------------
    console.log('\n📋 4. Arquivamento Seguro de Backlog Obsoleto (Sem DELETE & Com Guarda Admin)');

    const cronDiscardBlocked = createMockRes();
    await processOutboxHandler(
      {
        method: 'POST',
        url: '/api/notifications/process-outbox',
        headers: { authorization: 'Bearer cron_v251_test_secret' },
        body: { mode: 'discard_obsolete', dryRun: false, maxAgeHours: 72 },
      },
      cronDiscardBlocked
    );

    const adminDiscardDry = createMockRes();
    await processOutboxHandler(
      {
        method: 'POST',
        url: '/api/notifications/process-outbox',
        headers: { authorization: 'Bearer admin_v251_test_secret' },
        body: { mode: 'discard_obsolete', dryRun: true, maxAgeHours: 72 },
      },
      adminDiscardDry
    );

    const adminDiscardApply = createMockRes();
    await processOutboxHandler(
      {
        method: 'POST',
        url: '/api/notifications/process-outbox',
        headers: { authorization: 'Bearer admin_v251_test_secret' },
        body: { mode: 'discard_obsolete', dryRun: false, maxAgeHours: 72 },
      },
      adminDiscardApply
    );

    const statsAfterDiscard = await getNotificationOutboxStats();
    const totalRowsPreserved = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM internal.notification_outbox`);

    assert(
      cronDiscardBlocked.statusCode === 403 &&
        adminDiscardDry.statusCode === 200 &&
        adminDiscardDry.json()?.discardResult?.matchedCount === 90 &&
        adminDiscardDry.json()?.discardResult?.discardedCount === 0 &&
        adminDiscardApply.statusCode === 200 &&
        adminDiscardApply.json()?.discardResult?.discardedCount === 90 &&
        statsAfterDiscard.discarded === 90 &&
        statsAfterDiscard.pending === 10 &&
        totalRowsPreserved.rows[0].cnt === 100,
      'Descarte mutante exige admin (403 p/ cron), arquiva 90 obsoletos para DISCARDED e preserva 100% dos registros',
      JSON.stringify({ cronCode: cronDiscardBlocked.statusCode, statsAfterDiscard, total: totalRowsPreserved.rows[0].cnt })
    );

    // -------------------------------------------------------------------------
    // 5. Dry-Run em Itens Frescos (Políticas de Acesso + Anti-Flood)
    // -------------------------------------------------------------------------
    console.log('\n📋 5. Dry-Run em Itens Frescos: Políticas de Acesso & Anti-Flood');

    const previewFreshRes = createMockRes();
    await processOutboxHandler(
      {
        method: 'POST',
        url: '/api/notifications/process-outbox',
        headers: { authorization: 'Bearer cron_v251_test_secret' },
        body: { mode: 'preview', limit: 10, maxPerUserPerWindow: 2, floodWindowMinutes: 60 },
      },
      previewFreshRes
    );
    const previewFreshJson = previewFreshRes.json();
    const notifsStillZero = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM public.notifications`);

    assert(
      previewFreshRes.statusCode === 200 &&
        previewFreshJson?.dryRun === true &&
        previewFreshJson?.deadLettered === 1 &&
        previewFreshJson?.notificationsCreated === 4 && // 2 usuários elegíveis (ACTIVE + ADMIN) * cap 2 = 4!
        previewFreshJson?.accessBlockedSkipped >= 18 && // USER_SUSPENDED + USER_EXPIRED em 9 eventos = 18
        previewFreshJson?.floodCappedSkipped >= 14 && // 7 eventos excedentes * 2 usuários elegíveis = 14
        notifsStillZero.rows[0].cnt === 0,
      'Preview simula corretamente acesso bloqueado, opt-out, anti-flood (cap=2) e payload inválido sem escrever no banco',
      JSON.stringify({
        deadLettered: previewFreshJson?.deadLettered,
        created: previewFreshJson?.notificationsCreated,
        blocked: previewFreshJson?.accessBlockedSkipped,
        flood: previewFreshJson?.floodCappedSkipped,
        notifs: notifsStillZero.rows[0].cnt,
      })
    );

    // -------------------------------------------------------------------------
    // 6. Processamento Real em Lotes Pequenos + Anti-Flood + Políticas de Acesso
    // -------------------------------------------------------------------------
    console.log('\n📋 6. Processamento Real Controlado (Acesso, Anti-Flood & Payload Inválido -> DEAD_LETTER)');

    const processRes = createMockRes();
    await processOutboxHandler(
      {
        method: 'POST',
        url: '/api/notifications/process-outbox',
        headers: { authorization: 'Bearer cron_v251_test_secret' },
        body: { limit: 5, maxBatches: 2, maxPerUserPerWindow: 2, floodWindowMinutes: 60 },
      },
      processRes
    );
    const procJson = processRes.json();

    const perUserNotifs = await db.query<{ user_id: string; cnt: number }>(
      `SELECT user_id::text, COUNT(*)::int AS cnt FROM public.notifications GROUP BY user_id`
    );
    const countMap = new Map(perUserNotifs.rows.map((r) => [r.user_id, r.cnt]));
    const corruptedRow = await db.query<any>(
      `SELECT status, attempts, last_error FROM internal.notification_outbox WHERE event_id = 'corrupted-1'`
    );

    assert(
      processRes.statusCode === 200 &&
        procJson?.claimed === 10 &&
        procJson?.deadLettered === 1 &&
        procJson?.completed === 9 &&
        countMap.get(USER_ACTIVE) === 2 &&
        countMap.get(USER_ADMIN) === 2 &&
        !countMap.has(USER_SUSPENDED) &&
        !countMap.has(USER_EXPIRED) &&
        !countMap.has(USER_OPT_OUT) &&
        corruptedRow.rows[0]?.status === 'DEAD_LETTER' &&
        corruptedRow.rows[0]?.attempts === 1,
      'Processamento respeita anti-flood (máx 2/usuário), bloqueia suspenso/expirado/opt-out, libera admin e move payload inválido para DEAD_LETTER',
      JSON.stringify({ procJson, counts: Object.fromEntries(countMap), corrupted: corruptedRow.rows[0] })
    );

    // -------------------------------------------------------------------------
    // 7. Recuperação de PROCESSING Expirado (Sem Loop Infinito)
    // -------------------------------------------------------------------------
    console.log('\n📋 7. Recuperação de PROCESSING Expirado (Incrementa Attempts -> DEAD_LETTER)');

    await db.query(
      `INSERT INTO internal.notification_outbox
        (dedup_key, event_id, event_type, payload, status, attempts, max_attempts, locked_until, next_retry_at)
       VALUES
        ('event:stale-crash', 'stale-crash', 'NEWS_HIGH_RELEVANCE', '{"eventId":"stale-crash","title":"Worker Crash Test","relevanceScore":90}'::jsonb,
         'PROCESSING', 1, 3, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes')`
    );

    const claim1 = await db.query<any>(`SELECT public.claim_notification_outbox_batch(5) AS items`);
    const claimedItem = claim1.rows[0]?.items?.[0];
    // Simula segundo crash do worker expirando o lock novamente
    await db.query(
      `UPDATE internal.notification_outbox SET locked_until = NOW() - INTERVAL '10 minutes' WHERE event_id = 'stale-crash'`
    );
    const claim2 = await db.query<any>(`SELECT public.claim_notification_outbox_batch(5) AS items`);
    const staleFinalRow = await db.query<any>(
      `SELECT status, attempts, stale_recovery_count, locked_until FROM internal.notification_outbox WHERE event_id = 'stale-crash'`
    );

    assert(
      claimedItem?.event_id === 'stale-crash' &&
        Number(claimedItem?.attempts) === 2 &&
        Number(claimedItem?.stale_recovery_count) === 1 &&
        Array.isArray(claim2.rows[0]?.items) &&
        claim2.rows[0].items.length === 0 &&
        staleFinalRow.rows[0]?.status === 'DEAD_LETTER' &&
        staleFinalRow.rows[0]?.attempts === 3 &&
        staleFinalRow.rows[0]?.stale_recovery_count === 2 &&
        staleFinalRow.rows[0]?.locked_until === null,
      'PROCESSING expirado incrementa attempts + stale_recovery_count e vai para DEAD_LETTER ao atingir max_attempts',
      JSON.stringify({ claimedItem, claim2: claim2.rows[0], staleFinal: staleFinalRow.rows[0] })
    );

    // -------------------------------------------------------------------------
    // 8. Falha Parcial + Retry Idempotente (Sem Duplicar Usuário que Já Recebeu)
    // -------------------------------------------------------------------------
    console.log('\n📋 8. Falha Parcial & Retry Idempotente');

    await enqueueNotificationOutbox(
      {
        eventId: 'evt-partial-v251',
        title: 'Evento falha parcial multiusuário',
        relevanceScore: 95,
        entityIds: ['ent-petro'],
      },
      { queryFn: (sql, params) => db.query(sql, params) }
    );

    let failSecondUserOnce = true;
    const origCreateNotif = notificationEngine.createNotification.bind(notificationEngine);
    notificationEngine.createNotification = async (params) => {
      if (params.eventId === 'evt-partial-v251' && params.userId === USER_ADMIN && failSecondUserOnce) {
        failSecondUserOnce = false;
        return { success: false, error: 'SIMULATED_TRANSIENT_USER_WRITE_ERROR' };
      }
      return origCreateNotif(params);
    };

    const partialTry1 = await processNotificationOutboxBatch({
      limit: 5,
      maxPerUserPerWindow: 20,
      runId: 'run_partial_1',
    });
    const partialRow1 = await db.query<any>(
      `SELECT status, attempts, execution_meta FROM internal.notification_outbox WHERE event_id = 'evt-partial-v251'`
    );

    await db.query(
      `UPDATE internal.notification_outbox SET next_retry_at = NOW() - INTERVAL '1 second' WHERE event_id = 'evt-partial-v251'`
    );
    const partialTry2 = await processNotificationOutboxBatch({
      limit: 5,
      maxPerUserPerWindow: 20,
      runId: 'run_partial_2',
    });
    notificationEngine.createNotification = origCreateNotif;

    const partialRow2 = await db.query<any>(
      `SELECT status, dispatched_count, execution_meta FROM internal.notification_outbox WHERE event_id = 'evt-partial-v251'`
    );
    const partialNotifs = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.notifications WHERE event_id = 'evt-partial-v251'`
    );

    assert(
      partialTry1.retried === 1 &&
        partialTry1.partialFailuresCount === 1 &&
        partialRow1.rows[0]?.status === 'FAILED' &&
        partialRow1.rows[0]?.execution_meta?.partialFailure === true &&
        partialTry2.completed === 1 &&
        partialTry2.duplicatesSkipped === 1 &&
        partialTry2.notificationsCreated === 1 &&
        partialRow2.rows[0]?.status === 'COMPLETED' &&
        partialNotifs.rows[0].cnt === 2,
      'Falha parcial registra partialFailure em execution_meta, agenda retry e conclui usuário pendente sem duplicar o primeiro',
      JSON.stringify({ partialTry1, partialRow1: partialRow1.rows[0], partialTry2, partialRow2: partialRow2.rows[0], cnt: partialNotifs.rows[0].cnt })
    );

    // -------------------------------------------------------------------------
    // 9. Lock Concorrente (409), Lock Store Indisponível (503), Replay Admin & Ops
    // -------------------------------------------------------------------------
    console.log('\n📋 9. Lock (409/503), Replay Admin (403/200), Fallback Supabase RPC & Ops');

    const heldLock = await acquireDistributedLeaseLock({
      lockKey: 'fatosbr:notification-outbox:worker',
      ttlMs: 30_000,
    });
    const res409 = createMockRes();
    await processOutboxHandler(
      {
        method: 'GET',
        url: '/api/notifications/process-outbox',
        headers: { authorization: 'Bearer cron_v251_test_secret' },
      },
      res409
    );
    await heldLock.release();

    setProcessOutboxTestDeps({
      acquireDistributedLeaseLock: async () => {
        const err: any = new Error('LOCK_STORE_DOWN');
        err.code = 'LOCK_STORE_UNAVAILABLE';
        err.statusCode = 503;
        throw err;
      },
    });
    const res503 = createMockRes();
    await processOutboxHandler(
      {
        method: 'POST',
        url: '/api/notifications/process-outbox',
        headers: { authorization: 'Bearer cron_v251_test_secret' },
        body: { limit: 5 },
      },
      res503
    );
    setProcessOutboxTestDeps(null);

    // Replay exige admin (403 p/ cron; 200 p/ admin)
    const replayCronForbidden = createMockRes();
    await processOutboxHandler(
      {
        method: 'POST',
        url: '/api/notifications/process-outbox',
        headers: { authorization: 'Bearer cron_v251_test_secret' },
        body: { mode: 'replay', includeDeadLetter: true, dryRun: false },
      },
      replayCronForbidden
    );

    const replayAdminApply = createMockRes();
    await adminRouterHandler(
      {
        method: 'POST',
        url: '/api/admin/outbox-ops',
        headers: { authorization: 'Bearer admin_v251_test_secret' },
        body: { mode: 'replay', includeDeadLetter: true, includeFailed: false, limit: 1, dryRun: false },
      },
      replayAdminApply
    );

    // Ops snapshot via /api/admin/outbox-ops + getNotificationOutboxStats via Supabase RPC fallback
    const opsRes = createMockRes();
    await adminRouterHandler(
      {
        method: 'GET',
        url: '/api/admin/outbox-ops?mode=ops',
        headers: { authorization: 'Bearer admin_v251_test_secret' },
      },
      opsRes
    );
    const opsJson = opsRes.json();

    setNotificationOutboxTestDeps({
      isPostgresConfigured: () => false,
      getServerSupabase: () => sbAdapter as any,
    });
    const rpcOnlyStats = await getNotificationOutboxStats();
    const rpcOnlySnapshot = await getOutboxOpsSnapshot();

    assert(
      heldLock.acquired &&
        res409.statusCode === 409 &&
        res503.statusCode === 503 &&
        replayCronForbidden.statusCode === 403 &&
        replayAdminApply.statusCode === 200 &&
        replayAdminApply.json()?.replayResult?.requeuedCount === 1 &&
        opsRes.statusCode === 200 &&
        Array.isArray(opsJson?.snapshot?.recentRuns) &&
        opsJson.snapshot.recentRuns.length >= 4 &&
        rpcOnlyStats.discarded === 90 &&
        rpcOnlyStats.completed >= 10 &&
        rpcOnlySnapshot.recentRuns.length >= 4,
      'Lock 409/503 fail-closed, replay protegido p/ admin via /api/admin/outbox-ops, histórico outbox_job_runs e RPC Supabase fallback validados',
      JSON.stringify({
        c409: res409.statusCode,
        c503: res503.statusCode,
        c403: replayCronForbidden.statusCode,
        replay: replayAdminApply.json()?.replayResult,
        runs: opsJson?.snapshot?.recentRuns?.length,
        rpcOnlyStats,
      })
    );

    // -------------------------------------------------------------------------
    // 10. Rollback V2.5.1 Não Destrutivo em PGlite
    // -------------------------------------------------------------------------
    console.log('\n📋 10. Validação do Rollback V2.5.1 (Preservação Integral dos Registros)');

    const rollbackSql = fs.readFileSync(
      path.resolve('supabase/rollbacks/20261128000001_rollback_v2_5_1_outbox_hardening.sql'),
      'utf8'
    );
    await db.exec(rollbackSql);

    const rowsAfterRollback = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM internal.notification_outbox`);
    const v241ClaimTest = await db.query<any>(`SELECT public.claim_notification_outbox_batch(2) AS items`);
    const jobRunsTableExists = await db.query<{ exists_flag: boolean }>(
      `SELECT to_regclass('internal.outbox_job_runs') IS NOT NULL AS exists_flag`
    );

    assert(
      rowsAfterRollback.rows[0].cnt === 102 &&
        Array.isArray(v241ClaimTest.rows[0]?.items) &&
        jobRunsTableExists.rows[0].exists_flag === false,
      'Rollback V2.5.1 reverte objetos aditivos preservando 100% dos 102 registros e restaurando RPCs V2.4.1',
      JSON.stringify({ rows: rowsAfterRollback.rows[0].cnt, jobRunsExists: jobRunsTableExists.rows[0].exists_flag })
    );
  } finally {
    setNotificationEngineTestDeps(null);
    setNotificationOutboxTestDeps(null);
    setDistributedLockTestDeps(null);
    setProcessOutboxTestDeps(null);
    if (savedCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedCron;
    if (savedAdmin === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = savedAdmin;
    await db.close();
  }

  console.log('\n------------------------------------------------------------------------------');
  console.log(`Resultado Final V2.5.1: ${passed} passou | ${failed} falhou`);
  console.log('------------------------------------------------------------------------------\n');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('❌ Erro fatal na suíte V2.5.1:', err);
  process.exit(1);
});
