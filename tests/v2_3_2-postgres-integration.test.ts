/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.3.2 — INTEGRAÇÃO REAL EM POSTGRESQL ISOLADO (PGLITE)
 *
 * Executa as migrações SQL reais e toda a camada de engine/services contra um motor
 * PostgreSQL real (WASM em processo, isolado da produção), validando:
 * 1. Constraints reais CHECK / NOT NULL / UNIQUE INDEX (idx_briefing_delivery_slot).
 * 2. Execução integral das migrações SQL 20261121000001 e 20261121000002 sem erros nem índices redundantes.
 * 3. Persistência real de user_preferences, user_settings (notification_settings, morning_time, evening_time, timezone).
 * 4. Geração real de briefings (period_start, period_end, local_date, position, section enum).
 * 5. Criação idempotente de notificações (7 tipos aceitos) + read / read_at.
 * 6. Isolamento multiusuário real via Row-Level Security (RLS) no PostgreSQL.
 */

import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import {
  briefingEngine,
  setBriefingEngineTestDeps
} from '../api/_lib/briefingEngine.js';
import {
  notificationEngine,
  setNotificationEngineTestDeps
} from '../api/_lib/notificationEngine.js';
import {
  briefingService,
  setTestBriefingServiceClient
} from '../src/services/briefingService.js';
import {
  userService,
  setTestUserServiceClient
} from '../src/services/userService.js';
import { notificationService } from '../src/services/notificationService.js';

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

/**
 * Adaptador Supabase PostgREST -> SQL real em PostgreSQL (PGlite).
 * Traduz selects, filtros, upserts, updates e joins reais para queries parametrizadas SQL,
 * respeitando optionally SET LOCAL ROLE / JWT sub para testar RLS real no PostgreSQL.
 */
function createPgSupabaseAdapter(db: PGlite, rlsUserId?: string) {
  async function execWithContext<T>(fn: () => Promise<T>): Promise<T> {
    if (!rlsUserId) {
      return fn();
    }
    return db.transaction(async (tx) => {
      await tx.exec(`SET LOCAL ROLE authenticated`);
      await tx.exec(`SELECT set_config('request.jwt.claim.sub', '${rlsUserId}', true)`);
      return fnWithConn(tx);
    });
  }

  // Helper when running inside transaction vs root db
  let activeConn: any = db;
  async function fnWithConn(conn: any): Promise<any> {
    const prev = activeConn;
    activeConn = conn;
    try {
      return await pendingAction!();
    } finally {
      activeConn = prev;
    }
  }
  let pendingAction: (() => Promise<any>) | null = null;

  function runSqlQuery<R = any>(sql: string, params: any[] = []): Promise<{ rows: R[] }> {
    if (!rlsUserId) {
      return db.query<R>(sql, params);
    }
    return db.transaction(async (tx) => {
      await tx.exec(`SET LOCAL ROLE authenticated`);
      await tx.exec(`SELECT set_config('request.jwt.claim.sub', '${rlsUserId}', true)`);
      return tx.query<R>(sql, params);
    });
  }

  const from = (table: string) => {
    const state: {
      op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
      selectCols: string;
      payload: any;
      onConflict?: string;
      wheres: Array<{ col: string; op: string; val: any }>;
      orders: Array<{ col: string; asc: boolean }>;
      limitVal?: number;
      rangeFrom?: number;
      rangeTo?: number;
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
          if (arr.length === 0) {
            parts.push('FALSE');
          } else {
            const placeholders = arr.map(() => `$${idx++}`).join(', ');
            parts.push(`"${w.col}" IN (${placeholders})`);
            params.push(...arr);
          }
        } else if (w.op === 'contains') {
          parts.push(`"${w.col}" @> $${idx++}::jsonb`);
          params.push(JSON.stringify(w.val));
        }
      }
      return { clause: ` WHERE ${parts.join(' AND ')}`, params };
    };

    const mapPgError = (err: any) => ({
      code: err?.code || 'P0001',
      message: err?.message || String(err),
    });

    const execute = async (): Promise<any> => {
      try {
        if (state.op === 'select') {
          const hasEventsJoin = table === 'briefing_items' && state.selectCols.includes('events(');
          const { clause, params } = buildWhere(1);
          const orderSql =
            state.orders.length > 0
              ? ` ORDER BY ${state.orders.map((o) => `"${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}`
              : '';
          let limitSql = '';
          if (typeof state.rangeFrom === 'number' && typeof state.rangeTo === 'number') {
            limitSql = ` LIMIT ${state.rangeTo - state.rangeFrom + 1} OFFSET ${state.rangeFrom}`;
          } else if (typeof state.limitVal === 'number') {
            limitSql = ` LIMIT ${state.limitVal}`;
          }

          if (hasEventsJoin) {
            const sql = `
              SELECT bi.id, bi.briefing_id, bi.event_id, bi.position, bi.section,
                     json_build_object(
                       'id', e.id, 'title', e.title, 'slug', e.slug, 'summary', e.summary,
                       'why_it_matters', e.why_it_matters, 'relevance_score', e.relevance_score,
                       'article_count', e.article_count, 'published_at', e.published_at, 'updated_at', e.updated_at
                     ) AS events
              FROM public.briefing_items bi
              JOIN public.events e ON e.id = bi.event_id
              ${clause.replace(/"([a-z_]+)"/g, 'bi."$1"')}
              ${state.orders.length ? ` ORDER BY ${state.orders.map((o) => `bi."${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}` : ''}
              ${limitSql}
            `;
            const res = await runSqlQuery(sql, params);
            return { data: res.rows, error: null };
          }

          const cols = state.selectCols === '*' ? '*' : state.selectCols;
          const sql = `SELECT ${cols} FROM public."${table}"${clause}${orderSql}${limitSql}`;
          const res = await runSqlQuery(sql, params);

          if (state.singleMode === 'maybeSingle') {
            return { data: res.rows[0] ?? null, error: null };
          }
          if (state.singleMode === 'single') {
            if (res.rows.length !== 1) {
              return { data: null, error: { code: 'PGRST116', message: 'Expected single row' } };
            }
            return { data: res.rows[0], error: null };
          }
          return { data: res.rows, error: null };
        }

        if (state.op === 'insert') {
          const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
          const cols = Object.keys(rows[0]);
          const colList = cols.map((c) => `"${c}"`).join(', ');
          const allParams: any[] = [];
          let pIdx = 1;
          const valuesSql = rows
            .map((r) => {
              const placeholders = cols.map((c) => {
                const v = r[c];
                allParams.push(v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
                return `$${pIdx++}`;
              });
              return `(${placeholders.join(', ')})`;
            })
            .join(', ');

          const returning = state.wantSelectAfterWrite ? ` RETURNING ${state.selectCols || '*'}` : '';
          const sql = `INSERT INTO public."${table}" (${colList}) VALUES ${valuesSql}${returning}`;
          const res = await runSqlQuery(sql, allParams);

          if (state.singleMode === 'single') {
            return { data: res.rows[0] ?? null, error: null };
          }
          return { data: res.rows, error: null };
        }

        if (state.op === 'upsert') {
          const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
          const conflictCol = state.onConflict || 'id';
          const cols = Object.keys(rows[0]);
          const colList = cols.map((c) => `"${c}"`).join(', ');
          const updateCols = cols.filter((c) => c !== conflictCol);
          const updateSet = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
          const allParams: any[] = [];
          let pIdx = 1;
          const valuesSql = rows
            .map((r) => {
              const placeholders = cols.map((c) => {
                const v = r[c];
                allParams.push(v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
                return `$${pIdx++}`;
              });
              return `(${placeholders.join(', ')})`;
            })
            .join(', ');

          const sql = `
            INSERT INTO public."${table}" (${colList}) VALUES ${valuesSql}
            ON CONFLICT ("${conflictCol}") DO UPDATE SET ${updateSet}
          `;
          await runSqlQuery(sql, allParams);
          return { data: null, error: null };
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
          const returning = state.wantSelectAfterWrite ? ` RETURNING ${state.selectCols || '*'}` : '';
          const sql = `UPDATE public."${table}" SET ${sets.join(', ')}${clause}${returning}`;
          const res = await runSqlQuery(sql, params);
          return { data: res.rows, error: null };
        }

        if (state.op === 'delete') {
          const { clause, params } = buildWhere(1);
          await runSqlQuery(`DELETE FROM public."${table}"${clause}`, params);
          return { data: null, error: null };
        }

        return { data: null, error: null };
      } catch (err: any) {
        return { data: null, error: mapPgError(err) };
      }
    };

    const chain: any = {
      select(cols = '*') {
        if (state.op === 'insert' || state.op === 'update' || state.op === 'upsert') {
          state.wantSelectAfterWrite = true;
          state.selectCols = cols;
        } else {
          state.op = 'select';
          state.selectCols = cols;
        }
        return chain;
      },
      insert(payload: any) {
        state.op = 'insert';
        state.payload = payload;
        return chain;
      },
      update(payload: any) {
        state.op = 'update';
        state.payload = payload;
        return chain;
      },
      upsert(payload: any, opts?: { onConflict?: string }) {
        state.op = 'upsert';
        state.payload = payload;
        state.onConflict = opts?.onConflict;
        return chain;
      },
      delete() {
        state.op = 'delete';
        return chain;
      },
      eq(col: string, val: any) {
        state.wheres.push({ col, op: 'eq', val });
        return chain;
      },
      gte(col: string, val: any) {
        state.wheres.push({ col, op: 'gte', val });
        return chain;
      },
      lte(col: string, val: any) {
        state.wheres.push({ col, op: 'lte', val });
        return chain;
      },
      in(col: string, val: any[]) {
        state.wheres.push({ col, op: 'in', val });
        return chain;
      },
      contains(col: string, val: any) {
        state.wheres.push({ col, op: 'contains', val });
        return chain;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        state.orders.push({ col, asc: opts?.ascending !== false });
        return chain;
      },
      limit(n: number) {
        state.limitVal = n;
        return chain;
      },
      range(fromIdx: number, toIdx: number) {
        state.rangeFrom = fromIdx;
        state.rangeTo = toIdx;
        return chain;
      },
      single() {
        state.singleMode = 'single';
        return execute();
      },
      maybeSingle() {
        state.singleMode = 'maybeSingle';
        return execute();
      },
      then(resolve: any, reject: any) {
        return execute().then(resolve, reject);
      }
    };

    return chain;
  };

  // Silence unused warning
  void execWithContext;

  return { from };
}

async function setupBaselineSupabaseCompatibleSchema(db: PGlite) {
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

    GRANT USAGE ON SCHEMA public TO authenticated, service_role;
    GRANT USAGE ON SCHEMA auth TO authenticated, service_role;

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

    CREATE TABLE public.user_entity_follows (
      user_id UUID NOT NULL,
      entity_id TEXT NOT NULL,
      PRIMARY KEY (user_id, entity_id)
    );

    CREATE TABLE public.user_topic_follows (
      user_id UUID NOT NULL,
      topic_id TEXT NOT NULL,
      PRIMARY KEY (user_id, topic_id)
    );

    CREATE TABLE public.user_source_follows (
      user_id UUID NOT NULL,
      source_id TEXT NOT NULL,
      PRIMARY KEY (user_id, source_id)
    );

    CREATE TABLE public.event_entities (
      event_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      PRIMARY KEY (event_id, entity_id)
    );

    CREATE TABLE public.event_topics (
      event_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      PRIMARY KEY (event_id, topic_id)
    );

    -- Em produção: user_preferences NÃO possui notification_settings/morning_time antes da V2.3.1
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
      user_id UUID PRIMARY KEY
    );

    -- Contrato real de public.briefings em produção com idx_briefing_delivery_slot
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

    ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "briefings_owner_select" ON public.briefings
      FOR SELECT USING (auth.uid() = user_id);

    -- Contrato real de public.briefing_items em produção (SEM order_index, COM check estrito em section)
    CREATE TABLE public.briefing_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      briefing_id UUID NOT NULL REFERENCES public.briefings(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES public.events(id),
      position INTEGER NOT NULL,
      section TEXT NOT NULL CHECK (section IN ('TOP_STORIES', 'UPDATES', 'DEVELOPING', 'WATCH_NEXT'))
    );

    ALTER TABLE public.briefing_items ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "briefing_items_owner_select" ON public.briefing_items
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.briefings b
          WHERE b.id = briefing_items.briefing_id AND b.user_id = auth.uid()
        )
      );

    -- Contrato real de public.notifications em produção
    CREATE TABLE public.notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      type TEXT NOT NULL CHECK (type IN (
        'NEWS_HIGH_RELEVANCE', 'BRIEFING_READY', 'TRIAL_EXPIRING',
        'TRIAL_EXPIRED', 'SUBSCRIPTION_ACTIVE', 'PAYMENT_FAILED', 'SYSTEM'
      )),
      title TEXT NOT NULL,
      subtitle TEXT,
      category TEXT DEFAULT 'acontecimentos',
      read BOOLEAN NOT NULL DEFAULT FALSE,
      event_id TEXT,
      entity_id TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "notifications_owner_select" ON public.notifications
      FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "notifications_owner_update" ON public.notifications
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
  `);
}

async function run() {
  console.log('======================================================================');
  console.log('🐘 FATOSBR V2.3.2 — INTEGRAÇÃO REAL POSTGRESQL ISOLADO (PGLITE)');
  console.log('======================================================================\n');

  const db = new PGlite();
  await setupBaselineSupabaseCompatibleSchema(db);

  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';

  // ---------------------------------------------------------------------------
  // 1. EXECUTAR MIGRAÇÕES SQL REAIS EM POSTGRESQL
  // ---------------------------------------------------------------------------
  console.log('--- 1. Migrações SQL reais V2.3.1 & V2.3.2 em PostgreSQL ---');
  const mig231Sql = fs.readFileSync(
    path.resolve('supabase/migrations/20261121000001_v2_3_1_canonical_preferences_briefings_notifications.sql'),
    'utf-8'
  );
  const mig232Sql = fs.readFileSync(
    path.resolve('supabase/migrations/20261121000002_v2_3_2_briefings_period_and_items.sql'),
    'utf-8'
  );

  let migOk = true;
  let migErrMsg = '';
  try {
    await db.exec(mig231Sql);
    await db.exec(mig232Sql);
    // Testar idempotência re-executando ambas
    await db.exec(mig231Sql);
    await db.exec(mig232Sql);
  } catch (err: any) {
    migOk = false;
    migErrMsg = err?.message || String(err);
  }
  assert(migOk, 'Migrações 20261121000001 e 20261121000002 executam com idempotência no PostgreSQL real', migErrMsg);

  const indexesRes = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'briefings'`
  );
  const indexNames = indexesRes.rows.map((r) => r.indexname);
  assert(
    indexNames.includes('idx_briefing_delivery_slot') &&
      !indexNames.includes('idx_briefings_user_type_local_date_active') &&
      !indexNames.includes('idx_briefings_user_type_day_active'),
    'Nenhuma criação redundante de índice quando idx_briefing_delivery_slot já existe'
  );

  // Verificar default de section em schema com ADD COLUMN IF NOT EXISTS (tabela sem section prévia)
  const legacyDb = new PGlite();
  await legacyDb.exec(`
    CREATE TABLE public.briefings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('MORNING','EVENING')),
      status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('PENDING','GENERATING','READY','SENT','FAILED','CANCELED')),
      scheduled_for TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE public.briefing_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      briefing_id UUID NOT NULL,
      event_id TEXT NOT NULL,
      CONSTRAINT briefing_items_section_check CHECK (true)
    );
  `);
  await legacyDb.exec(mig232Sql);
  await legacyDb.exec(`
    ALTER TABLE public.briefing_items
      ADD CONSTRAINT briefing_items_section_real_check
      CHECK (section IN ('TOP_STORIES','UPDATES','DEVELOPING','WATCH_NEXT'));
    INSERT INTO public.briefing_items (briefing_id, event_id)
    VALUES ('33333333-3333-4333-8333-333333333333', 'ev-default-test');
  `);
  const defCheck = await legacyDb.query<{ section: string; position: number }>(
    `SELECT section, position FROM public.briefing_items WHERE event_id = 'ev-default-test'`
  );
  assert(
    defCheck.rows[0]?.section === 'TOP_STORIES' && defCheck.rows[0]?.position === 1,
    'Migração V2.3.2 aplica DEFAULT TOP_STORIES compatível com constraint real do PostgreSQL'
  );

  // ---------------------------------------------------------------------------
  // 2. SEED DE ACONTECIMENTOS E SEGUIMENTOS NO POSTGRESQL
  // ---------------------------------------------------------------------------
  await db.query(
    `INSERT INTO public.events (id, title, slug, summary, relevance_score, published_at) VALUES
      ('ev-pg-1', 'Banco Central detalha política monetária', 'bc-politica', 'Ata reforça vigilância inflacionária.', 94, $1),
      ('ev-pg-2', 'Petrobras divulga plano estratégico', 'petr-plano', 'Investimentos em exploração e refino.', 90, $1),
      ('ev-pg-3', 'IBGE registra desaceleração industrial', 'ibge-ind', 'Produção recua na margem.', 86, $1),
      ('ev-pg-4', 'Tesouro publica relatório de dívida pública', 'tesouro-divida', 'Calendário de emissões atualizado.', 78, $1)`,
    ['2026-11-23T09:00:00.000Z']
  );
  await db.query(`INSERT INTO public.user_entity_follows (user_id, entity_id) VALUES ($1, 'ent-petr')`, [userA]);
  await db.query(`INSERT INTO public.event_entities (event_id, entity_id) VALUES ('ev-pg-2', 'ent-petr')`);

  const serviceRoleAdapter = createPgSupabaseAdapter(db);
  const userAAdapter = createPgSupabaseAdapter(db, userA);
  const userBAdapter = createPgSupabaseAdapter(db, userB);

  // ---------------------------------------------------------------------------
  // 3. PREFERÊNCIAS & PERSISTÊNCIA REAL DE USER_PREFERENCES + USER_SETTINGS
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Persistência real de preferências e isolamento RLS ---');
  setTestUserServiceClient({ client: userAAdapter, configured: true });
  const prefSaveA = await userService.updateUserPreferencesDetailed(userA, {
    briefing_email: 'usera@fatosbr.com.br',
    email_morning_briefing: true,
    email_evening_briefing: true,
    email_breaking_alerts: false,
    weekend_edition: true,
    morning_time: '07:15',
    evening_time: '20:45',
    timezone: 'America/Sao_Paulo',
    notification_settings: {
      urgentEvents: false,
      entityUpdates: true,
      topicAlerts: false,
      sourcesDigest: true,
      dailyBriefings: true,
      onlyHighRelevance: true
    }
  });
  const prefLoadA = await userService.getUserPreferencesDetailed(userA);
  assert(
    prefSaveA.success &&
      prefLoadA.data?.morning_time === '07:15' &&
      prefLoadA.data?.evening_time === '20:45' &&
      prefLoadA.data?.notification_settings?.urgentEvents === false &&
      prefLoadA.data?.notification_settings?.dailyBriefings === true,
    'userService persiste e recarrega via RLS user_preferences + user_settings no PostgreSQL real'
  );

  // Cross-user isolation check via RLS
  setTestUserServiceClient({ client: userBAdapter, configured: true });
  const prefLoadB = await userService.getUserPreferencesDetailed(userA);
  assert(
    prefLoadB.data === null && !prefLoadB.error,
    'RLS bloqueia Usuário B de ler preferências do Usuário A'
  );
  setTestUserServiceClient(null);

  // ---------------------------------------------------------------------------
  // 4. BRIEFING ENGINE CONTRA CONSTRAINTS REAIS + TIMEZONE + DEDUP + RESEND
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. briefingEngine contra CHECK/UNIQUE constraints reais do PostgreSQL ---');
  setNotificationEngineTestDeps({
    isPostgresConfigured: () => false,
    getServerSupabase: () => serviceRoleAdapter as any
  });
  setBriefingEngineTestDeps({
    getServerSupabase: () => serviceRoleAdapter as any,
    getServerKeys: () => ({ RESEND: '' } as any)
  });

  // 1) Rejeição direta pela constraint do PostgreSQL se alguém tentar valor inválido
  let invalidSectionRejected = false;
  try {
    await db.query(
      `INSERT INTO public.briefing_items (briefing_id, event_id, position, section)
       VALUES ('00000000-0000-4000-8000-000000000001', 'ev-pg-1', 1, 'Destaques')`
    );
  } catch (err: any) {
    invalidSectionRejected = err?.code === '23514';
  }
  assert(invalidSectionRejected, 'Constraint CHECK real do PostgreSQL rejeita section="Destaques" com 23514');

  // 2) Geração real MORNING em America/Sao_Paulo
  const pgGen = await briefingEngine.generateForUser({
    userId: userA,
    type: 'MORNING',
    sendEmail: false,
    referenceDate: new Date('2026-11-23T10:20:00.000Z') // 07:20 BRT
  });
  assert(
    pgGen.status === 'READY' && pgGen.eventsCount === 4 && pgGen.notificationCreated === true,
    'briefingEngine gera briefing + briefing_items + BRIEFING_READY no PostgreSQL sem violar constraints'
  );

  const dbBriefings = await db.query<any>(
    `SELECT id, status, local_date::text AS ld, period_start, period_end FROM public.briefings WHERE user_id = $1`,
    [userA]
  );
  const dbItems = await db.query<any>(
    `SELECT position, section, event_id FROM public.briefing_items WHERE briefing_id = $1 ORDER BY position ASC`,
    [dbBriefings.rows[0].id]
  );

  assert(
    dbBriefings.rows[0].ld === '2026-11-23' &&
      dbBriefings.rows[0].status === 'READY' &&
      Boolean(dbBriefings.rows[0].period_start) &&
      Boolean(dbBriefings.rows[0].period_end) &&
      dbItems.rows.length === 4 &&
      dbItems.rows[0].event_id === 'ev-pg-2' &&
      dbItems.rows[0].section === 'TOP_STORIES' &&
      dbItems.rows[3].section === 'WATCH_NEXT',
    'PostgreSQL armazena local_date, period_start/end, position ordenado (evento seguido primeiro) e section enum válido'
  );

  // 3) Duplicidade no mesmo dia local -> SKIPPED_DUPLICATE + tentativa SQL direta bate em idx_briefing_delivery_slot (23505)
  const pgDup = await briefingEngine.generateForUser({
    userId: userA,
    type: 'MORNING',
    referenceDate: new Date('2026-11-23T13:00:00.000Z')
  });
  let raw23505Hit = false;
  try {
    await db.query(
      `INSERT INTO public.briefings (user_id, type, local_date, title, status, period_start, period_end, scheduled_for)
       VALUES ($1, 'MORNING', '2026-11-23', 'Duplicado', 'READY', NOW(), NOW(), NOW())`,
      [userA]
    );
  } catch (err: any) {
    raw23505Hit = err?.code === '23505';
  }
  assert(
    pgDup.status === 'SKIPPED_DUPLICATE' && raw23505Hit,
    'Deduplicação por (user_id, type, local_date) + idx_briefing_delivery_slot bloqueia duplicidade com 23505'
  );

  // 4) Virada de dia UTC: 2026-11-24T01:30Z = 2026-11-23 22:30 BRT -> EVENING do dia 2026-11-23 com Resend 200 -> SENT
  setBriefingEngineTestDeps({
    getServerSupabase: () => serviceRoleAdapter as any,
    getServerKeys: () => ({ RESEND: 're_pg_integration' } as any),
    fetchFn: (async () => new Response(JSON.stringify({ id: 'msg-pg-1' }), { status: 200 })) as any
  });
  const pgEvening = await briefingEngine.generateForUser({
    userId: userA,
    type: 'EVENING',
    briefingEmail: 'usera@fatosbr.com.br',
    sendEmail: true,
    referenceDate: new Date('2026-11-24T01:30:00.000Z')
  });
  const eveningRow = await db.query<any>(
    `SELECT status, sent_at, local_date::text AS ld FROM public.briefings WHERE id = $1`,
    [pgEvening.briefingId]
  );
  assert(
    pgEvening.status === 'SENT' &&
      eveningRow.rows[0]?.status === 'SENT' &&
      Boolean(eveningRow.rows[0]?.sent_at) &&
      eveningRow.rows[0]?.ld === '2026-11-23',
    'EVENING às 01:30Z (22:30 BRT) grava local_date=2026-11-23 e avança para SENT/sent_at com Resend 200'
  );

  // ---------------------------------------------------------------------------
  // 5. BRIEFINGSERVICE + NOTIFICATIONSERVICE COM RLS MULTI-USUÁRIO REAL
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Leitura frontend via RLS real + persistência de read/read_at ---');
  setTestBriefingServiceClient({ client: userAAdapter, configured: true });
  const readAsA = await briefingService.getUserBriefingsDetailed(userA, []);
  setTestBriefingServiceClient({ client: userBAdapter, configured: true });
  const readAsB = await briefingService.getUserBriefingsDetailed(userA, []); // Tentativa cruzada bloqueada pelo RLS

  assert(
    readAsA.items.length === 2 &&
      readAsA.items[1]?.itemSections?.['ev-pg-2']?.label === 'Principais fatos' &&
      readAsB.items.length === 0,
    'briefingService lê briefings e seções traduzidas para Usuário A; RLS isola Usuário B (0 registros)'
  );

  notificationService.setTestClient({ client: userAAdapter, configured: true });
  const notifsA = await notificationService.getUserNotificationsDetailed(userA);
  const firstNotifId = notifsA.items[0]?.id;
  const markReadRes = await notificationService.markAsReadDetailed(firstNotifId, userA);
  const dbNotifCheck = await db.query<any>(`SELECT read, read_at FROM public.notifications WHERE id = $1`, [firstNotifId]);

  notificationService.setTestClient({ client: userBAdapter, configured: true });
  const notifsCrossB = await notificationService.getUserNotificationsDetailed(userA);

  assert(
    notifsA.items.length === 2 &&
      markReadRes.success &&
      dbNotifCheck.rows[0]?.read === true &&
      Boolean(dbNotifCheck.rows[0]?.read_at) &&
      notifsCrossB.items.length === 0,
    'notificationService persiste read=true + read_at e RLS impede leitura cruzada entre usuários'
  );

  setBriefingEngineTestDeps(null);
  setNotificationEngineTestDeps(null);
  setTestBriefingServiceClient(null);
  notificationService.setTestClient(null);

  console.log('\n======================================================================');
  console.log(`🎉 RESULTADO POSTGRESQL ISOLADO: ${passed} passaram, ${failed} falharam.`);
  console.log('======================================================================\n');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Erro inesperado na integração PostgreSQL:', err);
  process.exit(1);
});
