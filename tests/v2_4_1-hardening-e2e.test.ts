/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.4.1 — HARDENING END-TO-END SUITE (PGlite Isolado + Mocks HTTP)
 *
 * Valida integralmente:
 * 1. notifications.body NOT NULL + dedup concorrente BRIEFING_READY (PG & Supabase).
 * 2. Distributed Lease Lock (PostgreSQL internal.distributed_job_locks), heartbeat, lease expiry recovery e fail-closed HTTP 503.
 * 3. Resend End-to-End: remetente padrão verificado, Idempotency-Key, retry 429/500->200, reconciliação ACCEPTED->SENT após falha parcial e webhook Svix HMAC.
 * 4. Entity Matcher determinístico (acentos, fronteiras, siglas case-sensitive), backfill multi-lote e Outbox durável (/api/notifications/process-outbox).
 * 5. Segregação estrita entre in-app (urgentEvents) e canal e-mail (email_breaking_alerts).
 * 6. Telemetria exata no Admin Center (>120 briefings e >260 notificações) sem truncamento e sem PII.
 * 7. Agendamento multi-fuso horário (Sao_Paulo, Manaus, New_York com DST, Lisbon, Tokyo), fins de semana locais e catch-up seguro.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import {
  briefingEngine,
  computeNextUserBriefingAt,
  getBriefingPeriodWindow,
  isUserWithinScheduleWindow,
  setBriefingEngineTestDeps,
} from '../api/_lib/briefingEngine.js';
import {
  notificationEngine,
  setNotificationEngineTestDeps,
} from '../api/_lib/notificationEngine.js';
import {
  acquireDistributedLeaseLock,
  DistributedLockUnavailableError,
  setDistributedLockTestDeps,
} from '../api/_lib/distributedLock.js';
import {
  backfillEventEntities,
  compileEntityMatchers,
  linkEventEntities,
  loadActiveEntityCatalog,
  matchCompiledEntities,
} from '../api/_lib/entityMatcher.js';
import {
  enqueueNotificationOutbox,
  getNotificationOutboxStats,
  processNotificationOutboxBatch,
  setNotificationOutboxTestDeps,
} from '../api/_lib/notificationOutbox.js';
import {
  buildBriefingEmailIdempotencyKey,
  DEFAULT_VERIFIED_RESEND_FROM,
  getResendFromEmail,
  sendResendEmailWithRetry,
  verifyResendWebhookSignature,
} from '../api/_lib/resendClient.js';
import generateBriefingsHandler from '../api/_lib/handlers/notifications/generateBriefings.js';
import processOutboxHandler from '../api/_lib/handlers/notifications/processOutbox.js';
import resendWebhookHandler, {
  setResendWebhookTestDeps,
} from '../api/_lib/handlers/resend/webhook.js';
import briefingsOpsHandler, {
  setBriefingsOpsTestDeps,
} from '../api/_lib/handlers/admin/briefingsOps.js';

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

function createPgSupabaseAdapter(db: PGlite, opts?: { failNextBriefingsSentUpdate?: boolean }) {
  function runSqlQuery<R = any>(sql: string, params: any[] = []): Promise<{ rows: R[] }> {
    return db.query<R>(sql, params);
  }

  const from = (table: string) => {
    const state: {
      op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
      selectCols: string;
      selectOpts?: { count?: string; head?: boolean };
      payload: any;
      onConflict?: string;
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
        } else if (w.op === 'lte') {
          parts.push(`"${w.col}" <= $${idx++}`);
          params.push(w.val);
        } else if (w.op === 'in') {
          const arr = Array.isArray(w.val) ? w.val : [];
          if (arr.length === 0) parts.push('FALSE');
          else {
            const ph = arr.map(() => `$${idx++}`).join(', ');
            parts.push(`"${w.col}" IN (${ph})`);
            params.push(...arr);
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
          if (state.selectOpts?.head && state.selectOpts?.count === 'exact') {
            const cntRes = await runSqlQuery<{ cnt: number }>(
              `SELECT COUNT(*)::int AS cnt FROM public."${table}"${clause}`,
              params
            );
            return { data: null, count: Number(cntRes.rows[0]?.cnt || 0), error: null };
          }
          const cols = state.selectCols === '*' ? '*' : state.selectCols;
          const res = await runSqlQuery(
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
          const res = await runSqlQuery(
            `INSERT INTO public."${table}" (${colList}) VALUES ${valuesSql}${returning}`,
            allParams
          );
          if (state.singleMode === 'single') return { data: res.rows[0] ?? null, error: null };
          return { data: res.rows, error: null };
        }

        if (state.op === 'update') {
          if (
            table === 'briefings' &&
            state.payload?.status === 'SENT' &&
            opts?.failNextBriefingsSentUpdate
          ) {
            opts.failNextBriefingsSentUpdate = false;
            return { data: null, error: { code: '08006', message: 'Simulated DB timeout after Resend 2xx' } };
          }
          const entries = Object.entries(state.payload || {});
          const params: any[] = [];
          let idx = 1;
          const sets = entries.map(([k, v]) => {
            params.push(v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
            return `"${k}" = $${idx++}`;
          });
          const { clause, params: wParams } = buildWhere(idx);
          params.push(...wParams);
          const returning = state.wantSelectAfterWrite ? ` RETURNING ${state.selectCols || '*'}` : '';
          const res = await runSqlQuery(
            `UPDATE public."${table}" SET ${sets.join(', ')}${clause}${returning}`,
            params
          );
          return { data: res.rows, error: null };
        }

        if (state.op === 'delete') {
          const { clause, params } = buildWhere(1);
          await runSqlQuery(`DELETE FROM public."${table}"${clause}`, params);
          return { data: null, error: null };
        }
        return { data: null, error: null };
      } catch (err: any) {
        return { data: null, error: { code: err?.code || 'P0001', message: err?.message || String(err) } };
      }
    };

    const chain: any = {
      select(cols = '*', selOpts?: { count?: string; head?: boolean }) {
        if (state.op === 'insert' || state.op === 'update' || state.op === 'upsert') {
          state.wantSelectAfterWrite = true;
          state.selectCols = cols;
        } else {
          state.op = 'select';
          state.selectCols = cols;
          state.selectOpts = selOpts;
        }
        return chain;
      },
      insert(payload: any) { state.op = 'insert'; state.payload = payload; return chain; },
      update(payload: any) { state.op = 'update'; state.payload = payload; return chain; },
      delete() { state.op = 'delete'; return chain; },
      eq(col: string, val: any) { state.wheres.push({ col, op: 'eq', val }); return chain; },
      gte(col: string, val: any) { state.wheres.push({ col, op: 'gte', val }); return chain; },
      lte(col: string, val: any) { state.wheres.push({ col, op: 'lte', val }); return chain; },
      in(col: string, val: any[]) { state.wheres.push({ col, op: 'in', val }); return chain; },
      contains(col: string, val: any) { state.wheres.push({ col, op: 'contains', val }); return chain; },
      order(col: string, ordOpts?: { ascending?: boolean }) {
        state.orders.push({ col, asc: ordOpts?.ascending !== false });
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
        const res = await runSqlQuery(`SELECT public."${fnName}"() AS data`);
        return { data: res.rows?.[0]?.data ?? null, error: null };
      }
      const params: any[] = [];
      const namedArgs = entries.map(([k, v], i) => {
        params.push(v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
        return `"${k}" := $${i + 1}`;
      });
      const res = await runSqlQuery(`SELECT public."${fnName}"(${namedArgs.join(', ')}) AS data`, params);
      return { data: res.rows?.[0]?.data ?? null, error: null };
    } catch (err: any) {
      return { data: null, error: { code: err?.code || 'P0001', message: err?.message || String(err) } };
    }
  };

  return { from, rpc };
}

async function setupIsolatedSchema(db: PGlite) {
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    CREATE TABLE public.entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      type TEXT
    );

    CREATE TABLE public.events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT,
      summary TEXT,
      why_it_matters TEXT,
      relevance_score INTEGER NOT NULL DEFAULT 75,
      article_count INTEGER DEFAULT 1,
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE public.articles (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, title TEXT NOT NULL);
    CREATE TABLE public.event_articles (event_id TEXT NOT NULL, article_id TEXT NOT NULL, PRIMARY KEY (event_id, article_id));
    CREATE TABLE public.user_entity_follows (user_id UUID NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY (user_id, entity_id));
    CREATE TABLE public.user_topic_follows (user_id UUID NOT NULL, topic_id TEXT NOT NULL, PRIMARY KEY (user_id, topic_id));
    CREATE TABLE public.user_source_follows (user_id UUID NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY (user_id, source_id));
    CREATE TABLE public.event_entities (event_id TEXT NOT NULL, entity_id TEXT NOT NULL, PRIMARY KEY (event_id, entity_id));
    CREATE TABLE public.event_topics (event_id TEXT NOT NULL, topic_id TEXT NOT NULL, PRIMARY KEY (event_id, topic_id));

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

    CREATE TABLE public.user_settings (user_id UUID PRIMARY KEY);

    CREATE TABLE public.briefings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('MORNING', 'EVENING')),
      local_date DATE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'GENERATING', 'READY', 'SENT', 'FAILED', 'CANCELED')),
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      scheduled_for TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX idx_briefing_delivery_slot
      ON public.briefings (user_id, type, local_date)
      WHERE status NOT IN ('FAILED', 'CANCELED');

    CREATE TABLE public.briefing_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      briefing_id UUID NOT NULL REFERENCES public.briefings(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES public.events(id),
      position INTEGER NOT NULL,
      section TEXT NOT NULL CHECK (section IN ('TOP_STORIES', 'UPDATES', 'DEVELOPING', 'WATCH_NEXT'))
    );

    -- Schema estrito de produção com body NOT NULL + subtitle
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
    'supabase/migrations/20261121000002_v2_3_2_briefings_period_and_items.sql',
    'supabase/migrations/20261122000002_v2_4_1_notifications_body_and_dedup.sql',
    'supabase/migrations/20261122000003_v2_4_1_distributed_locks_and_job_runs.sql',
    'supabase/migrations/20261122000004_v2_4_1_resend_deliveries_and_outbox.sql',
    'supabase/migrations/20261122000005_v2_4_1_entity_aliases_and_event_entities.sql',
  ];

  for (const mf of migrationFiles) {
    const sql = fs.readFileSync(path.resolve(mf), 'utf-8');
    await db.exec(sql);
    // Reexecução idempotente obrigatória
    await db.exec(sql);
  }
}

async function run() {
  console.log('\n🛡️ Iniciando FatosBR V2.4.1 Hardening E2E (PGlite Isolado + Mocks HTTP)...');
  const db = new PGlite();
  await setupIsolatedSchema(db);

  const adapterFlags = { failNextBriefingsSentUpdate: false };
  const sbAdapter = createPgSupabaseAdapter(db, adapterFlags);

  const USER_A = '11111111-1111-4111-8111-111111111111';
  const USER_B = '22222222-2222-4222-8222-222222222222';
  const USER_INAPP = '33333333-3333-4333-8333-333333333333';

  const prevCronSecret = process.env.CRON_SECRET;
  const prevAdminSecret = process.env.ADMIN_SECRET;
  const prevWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const prevResendFrom = process.env.RESEND_FROM_EMAIL;
  process.env.CRON_SECRET = 'v241-cron-secret';
  process.env.ADMIN_SECRET = 'v241-admin-secret';
  const rawWhSecretB64 = Buffer.from('fatosbr_v241_wh_secret_key_32b').toString('base64');
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${rawWhSecretB64}`;
  delete process.env.RESEND_FROM_EMAIL;

  try {
    // -------------------------------------------------------------------------
    // TESTE 1: notifications.body NOT NULL + dedup concorrente BRIEFING_READY
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 1: notifications.body NOT NULL + dedup concorrente BRIEFING_READY');
    setNotificationEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
    });

    const bId1 = 'aaaaaaaa-0000-4000-8000-000000000001';
    const [rPg1, rPg2] = await Promise.all([
      notificationEngine.createBriefingReadyNotification({
        userId: USER_A,
        briefingId: bId1,
        briefingType: 'MORNING',
        title: 'Briefing Matinal • 23/11/2026',
        eventsCount: 4,
      }),
      notificationEngine.createBriefingReadyNotification({
        userId: USER_A,
        briefingId: bId1,
        briefingType: 'MORNING',
        title: 'Briefing Matinal • 23/11/2026',
        eventsCount: 4,
      }),
    ]);

    const notifPgRows = await db.query<any>(
      `SELECT id, title, body, subtitle FROM public.notifications WHERE user_id = $1 AND type = 'BRIEFING_READY'`,
      [USER_A]
    );
    assert(
      notifPgRows.rows.length === 1 &&
        Boolean(notifPgRows.rows[0].body?.trim()) &&
        Boolean(notifPgRows.rows[0].subtitle?.trim()) &&
        rPg1.success &&
        rPg2.success,
      'Modo PG: notifications.body NOT NULL preenchido e concorrência BRIEFING_READY gera exatamente 1 registro',
      `rows=${notifPgRows.rows.length} body=${notifPgRows.rows[0]?.body}`
    );

    // Agora valida caminho Supabase adapter (isPostgresConfigured = false)
    setNotificationEngineTestDeps({
      isPostgresConfigured: () => false,
      getServerSupabase: () => sbAdapter as any,
    });
    const bId2 = 'aaaaaaaa-0000-4000-8000-000000000002';
    const [rSb1, rSb2] = await Promise.all([
      notificationEngine.createBriefingReadyNotification({
        userId: USER_A,
        briefingId: bId2,
        briefingType: 'EVENING',
        title: 'Briefing Noturno • 23/11/2026',
        eventsCount: 3,
      }),
      notificationEngine.createBriefingReadyNotification({
        userId: USER_A,
        briefingId: bId2,
        briefingType: 'EVENING',
        title: 'Briefing Noturno • 23/11/2026',
        eventsCount: 3,
      }),
    ]);
    const notifSbRows = await db.query<any>(
      `SELECT id, body, subtitle FROM public.notifications WHERE user_id = $1 AND metadata->>'briefingId' = $2`,
      [USER_A, bId2]
    );
    assert(
      notifSbRows.rows.length === 1 &&
        Boolean(notifSbRows.rows[0].body?.trim()) &&
        rSb1.success &&
        rSb2.success,
      'Modo Supabase RPC/PostgREST: body NOT NULL e deduplicação BRIEFING_READY sem duplicidade',
      `rows=${notifSbRows.rows.length}`
    );

    // -------------------------------------------------------------------------
    // TESTE 2: Distributed Lock Hardening, Lease Expiry, Renewal & Fail-Closed 503
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 2: Lock distribuído persistente, expiração, owner check e fail-closed 503');
    const lockDeps = {
      isPostgresConfigured: () => true,
      executeSql: (sql: string, params?: any[]) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
    };

    const lock1 = await acquireDistributedLeaseLock({
      lockKey: 'test:v241:lock',
      ttlMs: 30_000,
      heartbeatIntervalMs: 10_000,
      deps: lockDeps,
    });
    const lock2 = await acquireDistributedLeaseLock({
      lockKey: 'test:v241:lock',
      ttlMs: 30_000,
      deps: lockDeps,
    });

    assert(
      lock1.acquired === true && lock2.acquired === false,
      'Aquisição simultânea garante exclusão mútua real no PostgreSQL'
    );

    // Tentativa de soltar lock com dono errado não pode remover o lock
    const wrongRelease = await db.query<{ rel: boolean }>(
      `SELECT public.release_distributed_job_lock($1, $2) AS rel`,
      ['test:v241:lock', 'worker_intruso']
    );
    assert(
      wrongRelease.rows[0]?.rel === false,
      'Worker intruso não consegue liberar lease pertencente a outro owner_id'
    );

    const renewedOk = await lock1.renew();
    assert(renewedOk === true, 'Heartbeat do dono legítimo renova expires_at no PostgreSQL');

    // Simula crash do worker1 expirando lease no banco -> worker3 recupera atomicamente
    await db.query(
      `UPDATE internal.distributed_job_locks SET expires_at = NOW() - INTERVAL '10 seconds' WHERE lock_key = $1`,
      ['test:v241:lock']
    );
    const lock3 = await acquireDistributedLeaseLock({
      lockKey: 'test:v241:lock',
      ttlMs: 30_000,
      deps: lockDeps,
    });
    assert(
      lock3.acquired === true && lock3.ownerId !== lock1.ownerId,
      'Lease expirado é recuperado atomicamente por novo worker sem deadlock'
    );
    await lock1.release();
    await lock3.release();

    // Fail-closed: backend indisponível lança DistributedLockUnavailableError e gera HTTP 503
    let failClosedThrew = false;
    try {
      await acquireDistributedLeaseLock({
        lockKey: 'test:v241:unavailable',
        deps: {
          isPostgresConfigured: () => true,
          executeSql: async () => {
            throw Object.assign(new Error('relation "internal.distributed_job_locks" does not exist'), { code: '42P01' });
          },
          getServerSupabase: () => ({}) as any,
        },
      });
    } catch (err: any) {
      failClosedThrew = err instanceof DistributedLockUnavailableError && err.statusCode === 503;
    }
    assert(
      failClosedThrew,
      'DistributedLock falha fechada (503 DistributedLockUnavailableError) quando backend está indisponível — zero fallback em memória'
    );

    setBriefingEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: async () => {
        throw new Error('PG down for lock fail-closed test');
      },
      getServerSupabase: () => ({}) as any,
    });
    const res503 = createMockRes();
    await generateBriefingsHandler(
      {
        method: 'POST',
        url: '/api/notifications/generate-briefings',
        headers: { authorization: 'Bearer v241-cron-secret' },
        body: { type: 'MORNING', referenceDate: '2026-11-23T10:00:00.000Z' },
      },
      res503
    );
    assert(
      res503.statusCode === 503 && res503.json()?.error === 'BRIEFING_LOCK_STORE_UNAVAILABLE',
      'POST /api/notifications/generate-briefings retorna HTTP 503 BRIEFING_LOCK_STORE_UNAVAILABLE quando lock store falha',
      `status=${res503.statusCode} body=${res503.body}`
    );

    // -------------------------------------------------------------------------
    // TESTE 3: Resend End-to-End, Retry, Partial Failure Recovery & Webhook Svix
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 3: Resend from verificado, retry 429/500->200, reconciliação ACCEPTED->SENT e Webhook HMAC');
    assert(
      getResendFromEmail() === DEFAULT_VERIFIED_RESEND_FROM &&
        DEFAULT_VERIFIED_RESEND_FROM === 'FatosBR Briefings <briefings@fatosbr.com.br>',
      'Remetente padrão verificado padronizado como FatosBR Briefings <briefings@fatosbr.com.br>'
    );

    let retryCallCount = 0;
    const retryRes = await sendResendEmailWithRetry({
      apiKey: 're_test_key',
      to: ['dest@fatosbr.com.br'],
      subject: 'Teste retry',
      html: '<p>Oi</p>',
      text: 'Oi',
      idempotencyKey: buildBriefingEmailIdempotencyKey('br-retry', 'MORNING', '2026-11-23'),
      retryDelayBaseMs: 5,
      fetchFn: (async () => {
        retryCallCount++;
        if (retryCallCount === 1) return new Response(JSON.stringify({ message: 'rate limit' }), { status: 429 });
        if (retryCallCount === 2) return new Response(JSON.stringify({ message: 'upstream 500' }), { status: 500 });
        return new Response(JSON.stringify({ id: 're_msg_retry_ok' }), { status: 200 });
      }) as any,
    });
    assert(
      retryRes.accepted && retryRes.attemptsMade === 3 && retryRes.messageId === 're_msg_retry_ok',
      'sendResendEmailWithRetry recupera após 429 -> 500 -> 200 com retries limitados'
    );

    let fourXxCount = 0;
    const fourXxRes = await sendResendEmailWithRetry({
      apiKey: 're_test_key',
      to: ['invalid'],
      subject: 'Teste 400',
      html: '<p>Oi</p>',
      text: 'Oi',
      retryDelayBaseMs: 5,
      fetchFn: (async () => {
        fourXxCount++;
        return new Response(JSON.stringify({ message: 'invalid recipient' }), { status: 400 });
      }) as any,
    });
    assert(
      !fourXxRes.accepted && !fourXxRes.retryable && fourXxCount === 1,
      'sendResendEmailWithRetry NÃO repete erro definitivo 400 (attemptsMade=1)'
    );

    // Seed eventos + usuário A para testar falha parcial após Resend 2xx -> reconciliação -> webhook
    const refMonday = new Date('2026-11-23T11:00:00.000Z'); // 08:00 BRT
    await db.query(
      `INSERT INTO public.events (id, title, slug, summary, relevance_score, published_at) VALUES
        ('evt-v241-1', 'Petrobras expande produção no pré-sal em parceria', 'petr-presal', 'Novos campos na Bacia de Santos', 92, $1),
        ('evt-v241-2', 'Banco Central publica comunicado após decisão do Copom', 'bc-comunicado', 'Autoridade avalia inflação de serviços', 89, $1)`,
      [refMonday.toISOString()]
    );
    await db.query(
      `INSERT INTO public.user_preferences (id, briefing_email, email_morning_briefing, email_evening_briefing, email_breaking_alerts, weekend_edition, timezone, morning_time, evening_time)
       VALUES ($1, 'leitora@fatosbr.local', true, true, true, false, 'America/Sao_Paulo', '07:00', '20:00')`,
      [USER_A]
    );

    let resendPostCount = 0;
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = {};

    setNotificationEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
    });
    setBriefingEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
      getServerKeys: () => ({ RESEND: 're_mock_v241' } as any),
      fetchFn: (async (_url: any, init?: any) => {
        resendPostCount++;
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        capturedBody = init?.body ? JSON.parse(String(init.body)) : {};
        return new Response(JSON.stringify({ id: 're_msg_partial_1' }), { status: 200 });
      }) as any,
    });

    // Simula falha exatamente no UPDATE public.briefings -> SENT após HTTP 200 do Resend
    adapterFlags.failNextBriefingsSentUpdate = true;
    const partialRes = await briefingEngine.generateForUser({
      userId: USER_A,
      type: 'MORNING',
      sendEmail: true,
      referenceDate: refMonday,
      retryDelayBaseMs: 1,
    });

    const delivAfterPartial = await db.query<any>(
      `SELECT status, provider_message_id, from_email, idempotency_key FROM internal.briefing_email_deliveries WHERE briefing_id = $1`,
      [partialRes.briefingId]
    );

    assert(
      partialRes.status === 'READY' &&
        partialRes.emailSent === true &&
        resendPostCount === 1 &&
        Boolean(capturedHeaders['Idempotency-Key']) &&
        capturedBody.from === DEFAULT_VERIFIED_RESEND_FROM &&
        delivAfterPartial.rows[0]?.status === 'ACCEPTED' &&
        delivAfterPartial.rows[0]?.provider_message_id === 're_msg_partial_1',
      'Falha após HTTP 200 Resend preserva ACCEPTED em briefing_email_deliveries com from verificado e Idempotency-Key',
      JSON.stringify({ partialRes, row: delivAfterPartial.rows[0] })
    );

    // Reexecução reconcilia public.briefings -> SENT SEM fazer segundo POST ao Resend!
    const reconciledRes = await briefingEngine.generateForUser({
      userId: USER_A,
      type: 'MORNING',
      sendEmail: true,
      referenceDate: refMonday,
      retryDelayBaseMs: 1,
    });
    assert(
      reconciledRes.status === 'SENT' &&
        reconciledRes.reconciledFromDelivery === true &&
        resendPostCount === 1,
      'Reexecução reconcilia public.briefings para SENT sem reenvio duplicado ao Resend (POST count permanece 1)',
      JSON.stringify({ reconciledRes, resendPostCount })
    );

    // Webhook Resend: assinatura inválida -> 401; assinatura Svix válida -> atualiza DELIVERED
    setResendWebhookTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      verifyAdminRequest: async (req) => req?.headers?.authorization === 'Bearer v241-admin-secret',
    });

    const unauthWhGet = createMockRes();
    await resendWebhookHandler({ method: 'GET', headers: {} }, unauthWhGet);
    assert(unauthWhGet.statusCode === 401, 'GET /api/resend/webhook sem admin retorna 401');

    const badWhPost = createMockRes();
    await resendWebhookHandler(
      {
        method: 'POST',
        headers: { 'svix-id': 'msg_1', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,invalida' },
        rawBody: JSON.stringify({ type: 'email.delivered', data: { email_id: 're_msg_partial_1' } }),
      },
      badWhPost
    );
    assert(badWhPost.statusCode === 401, 'POST /api/resend/webhook rejeita assinatura Svix inválida (401)');

    const whBodyStr = JSON.stringify({
      id: 'evt_wh_deliv_1',
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: { email_id: 're_msg_partial_1' },
    });
    const svixId = 'msg_v241_ok';
    const svixTs = String(Math.floor(Date.now() / 1000));
    const sigKey = Buffer.from(rawWhSecretB64, 'base64');
    const expectedSig = crypto
      .createHmac('sha256', sigKey)
      .update(`${svixId}.${svixTs}.${whBodyStr}`)
      .digest('base64');

    const goodWhPost = createMockRes();
    await resendWebhookHandler(
      {
        method: 'POST',
        headers: {
          'svix-id': svixId,
          'svix-timestamp': svixTs,
          'svix-signature': `v1,${expectedSig}`,
        },
        rawBody: whBodyStr,
      },
      goodWhPost
    );
    const delivAfterWebhook = await db.query<any>(
      `SELECT status, webhook_event_type FROM internal.briefing_email_deliveries WHERE provider_message_id = 're_msg_partial_1'`
    );
    assert(
      goodWhPost.statusCode === 200 &&
        goodWhPost.json()?.deliveryUpdated === true &&
        delivAfterWebhook.rows[0]?.status === 'DELIVERED',
      'POST /api/resend/webhook com assinatura Svix válida atualiza status ACCEPTED -> DELIVERED no banco',
      JSON.stringify({ statusCode: goodWhPost.statusCode, row: delivAfterWebhook.rows[0] })
    );

    const directSigCheck = verifyResendWebhookSignature({
      rawBody: '{"ok":true}',
      headers: {
        'x-resend-signature': `sha256=${crypto
          .createHmac('sha256', process.env.RESEND_WEBHOOK_SECRET!)
          .update('{"ok":true}')
          .digest('hex')}`,
      },
      secret: process.env.RESEND_WEBHOOK_SECRET!,
    });
    assert(directSigCheck.valid === true, 'verifyResendWebhookSignature valida HMAC direto x-resend-signature');

    // -------------------------------------------------------------------------
    // TESTE 4: Entity Matcher, Multi-batch Backfill & Notification Outbox Worker
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 4: Entity Matcher determinístico, backfill multi-lote e Outbox durável');
    await db.query(
      `INSERT INTO public.entities (id, name, slug, type) VALUES
        ('ent-petro', 'Petrobras S.A.', 'petrobras', 'COMPANY'),
        ('ent-bc', 'Banco Central (BC)', 'banco-central', 'INSTITUTION'),
        ('ent-vale', 'Vale', 'vale', 'COMPANY'),
        ('ent-stf', 'STF', 'stf', 'INSTITUTION')`
    );
    await db.query(
      `INSERT INTO public.entity_aliases (entity_id, alias, normalized_alias) VALUES
        ('ent-stf', 'Supremo Tribunal Federal', 'supremo tribunal federal'),
        ('ent-bc', 'Copom', 'copom')`
    );
    await db.query(
      `INSERT INTO public.events (id, title, summary, relevance_score, published_at) VALUES
        ('evt-match-neg', 'Valor equivalente do mercado sem stf em minúscula no governo', 'Análise genérica', 75, $1),
        ('evt-match-pos', 'Supremo Tribunal Federal analisa ação sobre dividendos da Petrobras', 'BC acompanha impactos', 88, $1)`,
      [refMonday.toISOString()]
    );

    const catalog = await loadActiveEntityCatalog((sql, params) => db.query(sql, params));
    const matchers = compileEntityMatchers(catalog);

    const negMatches = matchCompiledEntities(
      'Valor equivalente do mercado sem stf em minúscula no governo',
      matchers
    );
    const posMatches = matchCompiledEntities(
      'Supremo Tribunal Federal analisa ação sobre dividendos da Petrobras e BC acompanha',
      matchers
    );
    assert(
      negMatches.length === 0 &&
        posMatches.includes('ent-stf') &&
        posMatches.includes('ent-petro') &&
        posMatches.includes('ent-bc') &&
        !posMatches.includes('ent-vale'),
      'Entity matcher respeita fronteira de palavra (equivalente != Vale), sigla em caixa alta (stf != STF) e aliases reais',
      JSON.stringify({ negMatches, posMatches })
    );

    // Backfill dry-run multi-lote (batchSize=2 sobre >2 eventos)
    const dryRunRes = await backfillEventEntities({
      queryFn: (sql, params) => db.query(sql, params),
      batchSize: 2,
      limit: 100,
      dryRun: true,
      onlyMissing: true,
    });
    const applyRes = await backfillEventEntities({
      queryFn: (sql, params) => db.query(sql, params),
      batchSize: 2,
      limit: 100,
      dryRun: false,
      onlyMissing: true,
    });
    const secondApplyRes = await backfillEventEntities({
      queryFn: (sql, params) => db.query(sql, params),
      batchSize: 2,
      limit: 100,
      dryRun: false,
      onlyMissing: true,
    });
    const insertedLinks = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.event_entities`
    );
    assert(
      dryRunRes.scanned >= 4 &&
        dryRunRes.linksInserted === 0 &&
        dryRunRes.linksPlanned > 0 &&
        applyRes.linksInserted === dryRunRes.linksPlanned &&
        secondApplyRes.linksInserted === 0 &&
        insertedLinks.rows[0].cnt === applyRes.linksInserted,
      'Backfill multi-lote dry-run vs apply persiste vínculos reais e segunda execução é 100% idempotente',
      JSON.stringify({ dryRunRes, applyRes, secondApplyRes })
    );

    // linkEventEntities direto
    const directLinkCnt = await linkEventEntities(
      (sql, params) => db.query(sql, params),
      'evt-match-pos',
      ['ent-petro', 'ent-bc']
    );
    assert(directLinkCnt === 0, 'linkEventEntities é idempotente via ON CONFLICT DO NOTHING');

    // Outbox: enqueue deduplicado + retry + dead letter + worker HTTP endpoint
    await db.query(
      `INSERT INTO public.user_entity_follows (user_id, entity_id) VALUES ($1, 'ent-petro')`,
      [USER_A]
    );
    setNotificationOutboxTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
      dispatchFn: notificationEngine.dispatchSegmentedNotificationsForEvent.bind(notificationEngine),
    });

    await enqueueNotificationOutbox(
      {
        eventId: 'evt-match-pos',
        title: 'Supremo analisa Petrobras',
        summary: 'Notícia vinculada',
        relevanceScore: 88,
        entityIds: ['ent-petro', 'ent-stf'],
      },
      { maxAttempts: 2 }
    );
    // Dedup pela mesma eventId
    await enqueueNotificationOutbox(
      {
        eventId: 'evt-match-pos',
        title: 'Supremo analisa Petrobras (dup)',
        summary: 'Notícia vinculada',
        relevanceScore: 88,
        entityIds: ['ent-petro', 'ent-stf'],
      },
      { maxAttempts: 2 }
    );
    const outboxCount = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM internal.notification_outbox`
    );
    assert(outboxCount.rows[0]?.cnt === 1, 'Outbox deduplica enfileiramento por event_id');

    // Testa retry + DEAD_LETTER para item que falha
    await enqueueNotificationOutbox(
      {
        eventId: 'evt-fail-dlq',
        title: 'Evento falha DLQ',
        relevanceScore: 95,
      },
      { maxAttempts: 2 }
    );

    let failAttemptTrigger = true;
    setNotificationOutboxTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      dispatchFn: async (payload) => {
        if (payload.eventId === 'evt-fail-dlq' && failAttemptTrigger) {
          return { eligibleUsers: 1, created: 0, skippedDuplicates: 0, errors: 1, errorDetails: ['Falha simulada'] };
        }
        return notificationEngine.dispatchSegmentedNotificationsForEvent(payload);
      },
    });

    const batch1 = await processNotificationOutboxBatch({ limit: 10 });
    await db.query(
      `UPDATE internal.notification_outbox SET next_retry_at = NOW() - INTERVAL '1 second' WHERE event_id = 'evt-fail-dlq'`
    );
    const batch2 = await processNotificationOutboxBatch({ limit: 10 });
    const dlqRow = await db.query<any>(
      `SELECT status, attempts FROM internal.notification_outbox WHERE event_id = 'evt-fail-dlq'`
    );
    assert(
      batch1.completed === 1 &&
        batch1.retried === 1 &&
        batch2.deadLettered === 1 &&
        dlqRow.rows[0]?.status === 'DEAD_LETTER' &&
        dlqRow.rows[0]?.attempts === 2,
      'Outbox processa COMPLETED, aplica backoff (FAILED) e move para DEAD_LETTER após max_attempts',
      JSON.stringify({ batch1, batch2, dlq: dlqRow.rows[0] })
    );

    // HTTP /api/notifications/process-outbox auth & execution
    setDistributedLockTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
    });
    const unauthOutboxRes = createMockRes();
    await processOutboxHandler({ method: 'POST', headers: {}, body: {} }, unauthOutboxRes);
    assert(unauthOutboxRes.statusCode === 401, 'POST /api/notifications/process-outbox sem auth retorna 401');

    const okOutboxRes = createMockRes();
    await processOutboxHandler(
      { method: 'POST', headers: { authorization: 'Bearer v241-cron-secret' }, body: { limit: 10 } },
      okOutboxRes
    );
    const outboxStats = await getNotificationOutboxStats();
    assert(
      okOutboxRes.statusCode === 200 &&
        okOutboxRes.json()?.success === true &&
        outboxStats.completed >= 1 &&
        outboxStats.deadLetter === 1,
      'Endpoint protegido /api/notifications/process-outbox executa sob lock distribuído e atualiza stats'
    );

    // -------------------------------------------------------------------------
    // TESTE 5: Segregação In-App (urgentEvents) vs Canal E-mail (email_breaking_alerts)
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 5: Segregação in-app urgentEvents vs email_breaking_alerts');
    await db.query(
      `INSERT INTO public.user_preferences (id, email_breaking_alerts) VALUES ($1, false)`,
      [USER_INAPP]
    );
    await db.query(
      `INSERT INTO public.user_settings (user_id, email_breaking_alerts, notification_settings)
       VALUES ($1, false, '{"urgentEvents":true,"entityUpdates":true,"onlyHighRelevance":false,"dailyBriefings":true}'::jsonb)`,
      [USER_INAPP]
    );
    await db.query(
      `INSERT INTO public.user_preferences (id, email_breaking_alerts) VALUES ($1, true)`,
      [USER_B]
    );
    await db.query(
      `INSERT INTO public.user_settings (user_id, email_breaking_alerts, notification_settings)
       VALUES ($1, true, '{"urgentEvents":false,"entityUpdates":true,"onlyHighRelevance":false,"dailyBriefings":true}'::jsonb)`,
      [USER_B]
    );
    await db.query(
      `INSERT INTO public.user_entity_follows (user_id, entity_id) VALUES ($1, 'ent-petro'), ($2, 'ent-petro')
       ON CONFLICT DO NOTHING`,
      [USER_INAPP, USER_B]
    );

    const segRes = await notificationEngine.dispatchSegmentedNotificationsForEvent({
      eventId: 'evt-v241-1',
      title: 'Fato urgente de teste segregado',
      summary: 'Resumo urgente',
      relevanceScore: 93,
      entityIds: ['ent-petro'],
      type: 'NEWS_HIGH_RELEVANCE',
    });
    const inAppUserRow = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.notifications WHERE user_id = $1 AND event_id = 'evt-v241-1'`,
      [USER_INAPP]
    );
    const optedOutUrgentRow = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.notifications WHERE user_id = $1 AND event_id = 'evt-v241-1'`,
      [USER_B]
    );
    assert(
      inAppUserRow.rows[0]?.cnt === 1 &&
        optedOutUrgentRow.rows[0]?.cnt === 0 &&
        segRes.created >= 1,
      'Usuário com email_breaking_alerts=false e urgentEvents=true recebe alerta in-app; urgentEvents=false NÃO recebe',
      JSON.stringify({ inApp: inAppUserRow.rows[0], optOut: optedOutUrgentRow.rows[0] })
    );

    // -------------------------------------------------------------------------
    // TESTE 6: Admin Center Ops Telemetria Exata (>120 briefings, >260 notificações) sem PII
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 6: Admin Center Telemetria Exata (>120 briefings e >260 notificações) sem PII');
    await db.query(`
      INSERT INTO public.briefings (user_id, type, local_date, title, status, period_start, period_end, scheduled_for)
      SELECT
        gen_random_uuid(),
        CASE WHEN g % 2 = 0 THEN 'MORNING' ELSE 'EVENING' END,
        ('2026-01-01'::date + (g || ' days')::interval)::date,
        'Briefing Seed #' || g,
        CASE WHEN g % 5 = 0 THEN 'FAILED' WHEN g % 3 = 0 THEN 'SENT' ELSE 'READY' END,
        NOW() - INTERVAL '12 hours',
        NOW(),
        NOW()
      FROM generate_series(1, 125) AS g;
    `);
    await db.query(`
      INSERT INTO public.notifications (user_id, type, title, body, subtitle, read)
      SELECT
        gen_random_uuid(),
        CASE WHEN g % 2 = 0 THEN 'BRIEFING_READY' ELSE 'NEWS_HIGH_RELEVANCE' END,
        'Notif Seed #' || g,
        'Corpo exato #' || g,
        'Subtitulo #' || g,
        (g % 2 = 0)
      FROM generate_series(1, 265) AS g;
    `);

    await briefingEngine.runGenerationCycle({
      type: 'MORNING',
      sendEmail: false,
      referenceDate: new Date('2026-11-24T12:00:00.000Z'),
    });

    setBriefingsOpsTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
      verifyAdminRequest: async (req) => req?.headers?.authorization === 'Bearer v241-admin-secret',
    });
    const exactOpsRes = createMockRes();
    await briefingsOpsHandler(
      { method: 'GET', url: '/api/admin/briefings-ops', headers: { authorization: 'Bearer v241-admin-secret' } },
      exactOpsRes
    );
    const snap = exactOpsRes.json()?.snapshot;
    const opsRaw = JSON.stringify(snap);
    assert(
      exactOpsRes.statusCode === 200 &&
        snap?.briefingsSummary?.total >= 126 &&
        snap?.notificationsSummary?.totalProcessed >= 268 &&
        snap?.resendSummary?.delivered >= 1 &&
        snap?.outboxSummary?.deadLetter === 1 &&
        snap?.recentRunLogs?.length >= 1 &&
        !opsRaw.includes('leitora@fatosbr.local'),
      'Admin Ops retorna contagens exatas (>120 briefings, >260 notificações), stats Resend/Outbox/Runs e zero PII',
      JSON.stringify({
        briefingsTotal: snap?.briefingsSummary?.total,
        notifsTotal: snap?.notificationsSummary?.totalProcessed,
        resend: snap?.resendSummary,
        outbox: snap?.outboxSummary,
      })
    );

    // -------------------------------------------------------------------------
    // TESTE 7: Agendamento Multi-Timezone, DST e Catch-Up Seguro
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 7: Multi-Timezone, DST (New York / Lisbon) e Catch-Up Local');
    const spWindow = getBriefingPeriodWindow('MORNING', new Date('2026-11-23T10:30:00.000Z'), {
      timezone: 'America/Sao_Paulo',
      morningTime: '07:00',
      eveningTime: '20:00',
    });
    const manausWindow = getBriefingPeriodWindow('MORNING', new Date('2026-11-23T10:30:00.000Z'), {
      timezone: 'America/Manaus', // UTC-4: 06:30 local -> ainda antes das 07:00
      morningTime: '07:00',
      eveningTime: '20:00',
    });
    const tokyoWindow = getBriefingPeriodWindow('EVENING', new Date('2026-11-23T12:00:00.000Z'), {
      timezone: 'Asia/Tokyo', // UTC+9 -> 21:00 em 2026-11-23
      morningTime: '07:00',
      eveningTime: '20:00',
    });
    // DST New York: antes de 2026-11-01 (EDT UTC-4) vs depois de 2026-11-01 (EST UTC-5)
    const nySummerScheduled = getBriefingPeriodWindow('MORNING', new Date('2026-10-30T12:00:00.000Z'), {
      timezone: 'America/New_York',
      morningTime: '07:00',
    });
    const nyWinterScheduled = getBriefingPeriodWindow('MORNING', new Date('2026-11-03T13:00:00.000Z'), {
      timezone: 'America/New_York',
      morningTime: '07:00',
    });
    // Verifica offsets reais de UTC: 07:00 EDT = 11:00 UTC; 07:00 EST = 12:00 UTC
    const summerUtcHour = new Date(nySummerScheduled.scheduledFor).getUTCHours();
    const winterUtcHour = new Date(nyWinterScheduled.scheduledFor).getUTCHours();

    const spEligibleNow = isUserWithinScheduleWindow(
      { timezone: 'America/Sao_Paulo', morningTime: '07:00', eveningTime: '20:00' },
      'MORNING',
      new Date('2026-11-23T10:30:00.000Z') // 07:30 SP >= 07:00 (catch-up ativo!)
    );
    const manausEligibleNow = isUserWithinScheduleWindow(
      { timezone: 'America/Manaus', morningTime: '07:00', eveningTime: '20:00' },
      'MORNING',
      new Date('2026-11-23T10:30:00.000Z') // 06:30 Manaus < 07:00 (aguarda!)
    );
    // Sexta-feira à noite sem weekendEdition -> próximo briefing MORNING deve pular sábado/domingo e cair na segunda
    const nextWeekdayMorning = computeNextUserBriefingAt(
      { timezone: 'Europe/Lisbon', morningTime: '07:30', eveningTime: '20:00', weekendEdition: false },
      'MORNING',
      new Date('2026-11-20T18:00:00.000Z') // Sexta-feira
    );

    assert(
      spWindow.localDate === '2026-11-23' &&
        manausWindow.localDate === '2026-11-23' &&
        tokyoWindow.localDate === '2026-11-23' &&
        summerUtcHour === 11 &&
        winterUtcHour === 12 &&
        spEligibleNow === true &&
        manausEligibleNow === false &&
        nextWeekdayMorning.startsWith('2026-11-23T07:30'), // Lisboa em novembro = UTC+0, segunda 23/11
      'Multi-timezone, transição DST (NY 11hZ->12hZ), catch-up local e exclusão de fim de semana validados',
      JSON.stringify({ summerUtcHour, winterUtcHour, spEligibleNow, manausEligibleNow, nextWeekdayMorning })
    );
  } finally {
    setBriefingEngineTestDeps(null);
    setNotificationEngineTestDeps(null);
    setDistributedLockTestDeps(null);
    setNotificationOutboxTestDeps(null);
    setResendWebhookTestDeps(null);
    setBriefingsOpsTestDeps(null);
    if (prevCronSecret !== undefined) process.env.CRON_SECRET = prevCronSecret;
    else delete process.env.CRON_SECRET;
    if (prevAdminSecret !== undefined) process.env.ADMIN_SECRET = prevAdminSecret;
    else delete process.env.ADMIN_SECRET;
    if (prevWebhookSecret !== undefined) process.env.RESEND_WEBHOOK_SECRET = prevWebhookSecret;
    else delete process.env.RESEND_WEBHOOK_SECRET;
    if (prevResendFrom !== undefined) process.env.RESEND_FROM_EMAIL = prevResendFrom;
    else delete process.env.RESEND_FROM_EMAIL;
  }

  console.log(`\n📊 RESULTADO V2.4.1 HARDENING E2E: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('❌ Erro fatal nos testes V2.4.1:', err);
  process.exit(1);
});
