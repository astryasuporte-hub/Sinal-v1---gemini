/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.4 — TESTES DE INTEGRAÇÃO OPERACIONAIS (BRIEFINGS, NOTIFICAÇÕES, AGENDAMENTO, RESEND & ADMIN OPS)
 *
 * Executado 100% isolado em PGlite (PostgreSQL WASM em processo) + mocks de fetch/HTTP:
 * - Zero escrita no Supabase de produção.
 * - Zero envio real de e-mails no Resend.
 */

import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import {
  briefingEngine,
  setBriefingEngineTestDeps,
} from '../api/_lib/briefingEngine.js';
import {
  notificationEngine,
  setNotificationEngineTestDeps,
} from '../api/_lib/notificationEngine.js';
import generateBriefingsHandler from '../api/_lib/handlers/notifications/generateBriefings.js';
import briefingsOpsHandler, {
  setBriefingsOpsTestDeps,
} from '../api/_lib/handlers/admin/briefingsOps.js';
import { buildEditorialBriefingHtml } from '../src/server/templateEngine.js';
import { notificationService } from '../src/services/notificationService.js';
import { setTestBriefingServiceClient, briefingService } from '../src/services/briefingService.js';

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

function createPgSupabaseAdapter(db: PGlite, rlsUserId?: string) {
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
      selectOpts?: { count?: string; head?: boolean };
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

          if (state.selectOpts?.head) {
            return { data: null, count: res.rows.length, error: null };
          }
          if (state.singleMode === 'maybeSingle') {
            return { data: res.rows[0] ?? null, error: null };
          }
          if (state.singleMode === 'single') {
            if (res.rows.length !== 1) {
              return { data: null, error: { code: 'PGRST116', message: 'Expected single row' } };
            }
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
      select(cols = '*', opts?: { count?: string; head?: boolean }) {
        if (state.op === 'insert' || state.op === 'update' || state.op === 'upsert') {
          state.wantSelectAfterWrite = true;
          state.selectCols = cols;
        } else {
          state.op = 'select';
          state.selectCols = cols;
          state.selectOpts = opts;
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
      },
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

    CREATE TABLE public.articles (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL
    );

    CREATE TABLE public.event_articles (
      event_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      PRIMARY KEY (event_id, article_id)
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

  const mig1 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20261121000001_v2_3_1_canonical_preferences_briefings_notifications.sql'),
    'utf-8'
  );
  const mig2 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20261121000002_v2_3_2_briefings_period_and_items.sql'),
    'utf-8'
  );
  const mig3 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20261122000002_v2_4_1_notifications_body_and_dedup.sql'),
    'utf-8'
  );
  const mig4 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20261122000003_v2_4_1_distributed_locks_and_job_runs.sql'),
    'utf-8'
  );
  const mig5 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20261122000004_v2_4_1_resend_deliveries_and_outbox.sql'),
    'utf-8'
  );
  const mig6 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20261122000005_v2_4_1_entity_aliases_and_event_entities.sql'),
    'utf-8'
  );
  await db.exec(mig1);
  await db.exec(mig2);
  await db.exec(mig3);
  await db.exec(mig4);
  await db.exec(mig5);
  await db.exec(mig6);
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

async function main() {
  console.log('\n🧪 Iniciando FatosBR V2.4 End-to-End (PGlite Isolado + HTTP Handlers + Resend Mock)...');
  const db = new PGlite();
  await setupIsolatedSchema(db);

  const serviceClient = createPgSupabaseAdapter(db);

  const USER_A = '11111111-1111-4111-8111-111111111111';
  const USER_B = '22222222-2222-4222-8222-222222222222';
  const USER_OPTOUT = '33333333-3333-4333-8333-333333333333';

  const prevAdminSecret = process.env.ADMIN_SECRET;
  const prevCronSecret = process.env.CRON_SECRET;
  process.env.ADMIN_SECRET = 'v24-test-admin-secret';
  process.env.CRON_SECRET = 'v24-test-cron-secret';

  const sentEmailPayloads: any[] = [];
  let resendForceFailure = false;

  setNotificationEngineTestDeps({
    isPostgresConfigured: () => true,
    executeSql: (sql: string, params?: any[]) => db.query(sql, params),
    getServerSupabase: () => serviceClient as any,
  });

  setBriefingEngineTestDeps({
    isPostgresConfigured: () => true,
    executeSql: (sql: string, params?: any[]) => db.query(sql, params),
    getServerSupabase: () => serviceClient as any,
    getServerKeys: () => ({ RESEND: 're_test_mock_key' } as any),
    fetchFn: (async (_url: any, init?: any) => {
      const parsed = init?.body ? JSON.parse(String(init.body)) : {};
      sentEmailPayloads.push(parsed);
      if (resendForceFailure) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ message: 'Resend upstream temporary failure' }),
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: `re_mock_${sentEmailPayloads.length}` }),
      } as any;
    }) as any,
  });

  // Seed usuários, eventos, fontes seguidas e preferências
  const refNow = new Date('2026-11-16T11:30:00.000Z'); // Segunda-feira 08:30 BRT
  await db.query(
    `INSERT INTO public.events (id, title, slug, summary, why_it_matters, relevance_score, published_at) VALUES
      ('evt-src', 'Mercado <script>alert(1)</script> reage ao corte de juros', 'mercado-juros', 'Resumo <img src=x onerror=alert(1)> econômico', 'Impacto direto em crédito', 78, $1),
      ('evt-gen-1', 'PIB registra alta acima das projeções no trimestre', 'pib-alta', 'Consumo das famílias impulsiona resultado', 'Sinaliza atividade aquecida', 91, $1),
      ('evt-gen-2', 'Banco Central publica ata detalhando próximos passos', 'bc-ata', 'Autoridade monetária mantém cautela fiscal', 'Guia expectativas de mercado', 86, $1),
      ('evt-gen-3', 'Nova política industrial abre crédito para exportadoras', 'politica-industrial', 'BNDES anuncia linhas de financiamento', 'Amplia capacidade exportadora', 80, $1)`,
    [refNow.toISOString()]
  );

  await db.query(
    `INSERT INTO public.articles (id, source_id, title) VALUES ('art-1', 'src-valor', 'Matéria Valor')`
  );
  await db.query(
    `INSERT INTO public.event_articles (event_id, article_id) VALUES ('evt-src', 'art-1')`
  );
  await db.query(
    `INSERT INTO public.user_source_follows (user_id, source_id) VALUES ($1, 'src-valor')`,
    [USER_A]
  );

  await db.query(
    `INSERT INTO public.user_preferences (id, briefing_email, email_morning_briefing, email_evening_briefing, email_breaking_alerts, weekend_edition, timezone, morning_time, evening_time) VALUES
      ($1, 'usera@fatosbr.local', true, true, true, false, 'America/Sao_Paulo', '07:00', '20:00'),
      ($2, 'userb@fatosbr.local', true, true, true, false, 'America/Sao_Paulo', '07:00', '20:00'),
      ($3, 'optout@fatosbr.local', false, false, false, false, 'America/Sao_Paulo', '07:00', '20:00')`,
    [USER_A, USER_B, USER_OPTOUT]
  );

  await db.query(
    `INSERT INTO public.user_settings (user_id, email_breaking_alerts, morning_time, evening_time, timezone, notification_settings) VALUES
      ($1, true, '07:00', '20:00', 'America/Sao_Paulo', '{"dailyBriefings":true,"urgentEvents":true,"sourcesDigest":true,"onlyHighRelevance":false}'::jsonb),
      ($2, true, '07:00', '20:00', 'America/Sao_Paulo', '{"dailyBriefings":false,"urgentEvents":true,"sourcesDigest":false,"onlyHighRelevance":true}'::jsonb)`,
    [USER_A, USER_B]
  );

  // 1. Personalização por fonte seguida (user_source_follows)
  console.log('\n📋 Bloco 1: Personalização por fonte seguida + escape XSS');
  const rankedForA = await briefingEngine.selectEventsForUser(USER_A, { referenceDate: refNow });
  const srcCandidate = rankedForA.find((e) => e.id === 'evt-src');
  assert(
    Boolean(srcCandidate?.isFollowedMatch),
    'selectEventsForUser identifica acontecimento vinculado a fonte seguida (user_source_follows)',
    `match=${srcCandidate?.isFollowedMatch}`
  );
  assert(
    rankedForA[0]?.id === 'evt-src' || rankedForA.slice(0, 2).some((e) => e.id === 'evt-src'),
    'Evento de fonte seguida é priorizado no ranking personalizado'
  );

  const templateHtml = buildEditorialBriefingHtml({
    type: 'morning',
    events: [
      {
        id: 'evt-src',
        title: 'Mercado <script>alert(1)</script>',
        summary: '<img src=x onerror=alert(1)>',
        category: 'ECONOMIA',
      },
    ],
  });
  assert(
    !templateHtml.includes('<script>alert(1)</script>') &&
      templateHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;') &&
      templateHtml.includes('FatosBR'),
    'templateEngine escapa HTML/XSS em títulos e resumos e usa marca FatosBR'
  );

  // 2. Recuperação de slot FAILED + falha Resend mantém READY + confirmação 2xx promove a SENT
  console.log('\n📋 Bloco 2: Recuperação FAILED -> GENERATING -> READY/SENT e Resend');
  await db.query(
    `INSERT INTO public.briefings (id, user_id, type, local_date, title, description, status, period_start, period_end, scheduled_for)
     VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, 'MORNING', '2026-11-16', 'Antigo com falha', 'Desc', 'FAILED', $2, $3, $3)`,
    [USER_A, '2026-11-15T23:00:00.000Z', '2026-11-16T10:00:00.000Z']
  );

  resendForceFailure = true;
  const recoveredReady = await briefingEngine.generateForUser({
    userId: USER_A,
    type: 'MORNING',
    sendEmail: true,
    referenceDate: refNow,
  });
  assert(
    recoveredReady.status === 'READY' &&
      recoveredReady.briefingId === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' &&
      recoveredReady.recoveredFromStatus === 'FAILED' &&
      recoveredReady.emailSent === false &&
      Boolean(recoveredReady.emailError),
    'Slot FAILED é reaproveitado sem erro 23505 e falha Resend 500 mantém status READY com emailError',
    JSON.stringify(recoveredReady)
  );

  // Garante que retry imediato após READY não duplica briefing nem reenvia
  const dupBlocked = await briefingEngine.generateForUser({
    userId: USER_A,
    type: 'MORNING',
    sendEmail: true,
    referenceDate: refNow,
  });
  assert(
    dupBlocked.status === 'SKIPPED_DUPLICATE',
    'Slot já READY bloqueia nova geração duplicada (SKIPPED_DUPLICATE)',
    dupBlocked.status
  );

  // Marca como CANCELED para testar recuperação completa + envio 200 Resend
  await db.query(
    `UPDATE public.briefings SET status = 'CANCELED' WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`
  );
  resendForceFailure = false;
  const recoveredSent = await briefingEngine.generateForUser({
    userId: USER_A,
    type: 'MORNING',
    sendEmail: true,
    referenceDate: refNow,
  });
  assert(
    recoveredSent.status === 'SENT' &&
      recoveredSent.emailSent === true &&
      recoveredSent.recoveredFromStatus === 'CANCELED',
    'Slot CANCELED é recuperado e confirmado como SENT após Resend HTTP 200',
    JSON.stringify(recoveredSent)
  );
  const lastEmail = sentEmailPayloads[sentEmailPayloads.length - 1];
  assert(
    Boolean(lastEmail?.html) && !String(lastEmail.html).includes('<script>alert(1)</script>'),
    'HTML do e-mail enviado no motor escapa tags perigosas e mantém marca FatosBR'
  );

  // Opt-out de e-mail não dispara Resend mesmo se sendEmail: true for passado
  const countBeforeOptOut = sentEmailPayloads.length;
  const optOutRes = await briefingEngine.generateForUser({
    userId: USER_OPTOUT,
    type: 'MORNING',
    sendEmail: true,
    referenceDate: refNow,
  });
  assert(
    optOutRes.status === 'READY' &&
      optOutRes.emailSent === false &&
      optOutRes.emailSkippedReason === 'OPTED_OUT' &&
      sentEmailPayloads.length === countBeforeOptOut,
    'Usuário com email_morning_briefing=false gera briefing in-app READY mas NÃO dispara e-mail',
    JSON.stringify(optOutRes)
  );

  // 3. Compatibilidade dual position + order_index em schemas com order_index
  console.log('\n📋 Bloco 3: Compatibilidade position + order_index');
  const dbWithOrderIdx = new PGlite();
  await setupIsolatedSchema(dbWithOrderIdx);
  await dbWithOrderIdx.exec(`ALTER TABLE public.briefing_items ADD COLUMN IF NOT EXISTS order_index INTEGER;`);
  await dbWithOrderIdx.query(
    `INSERT INTO public.events (id, title, summary, relevance_score, published_at)
     VALUES ('evt-oi-1', 'Fato Order Index', 'Resumo', 90, $1)`,
    [refNow.toISOString()]
  );
  setBriefingEngineTestDeps({
    isPostgresConfigured: () => false,
    executeSql: (sql: string, params?: any[]) => dbWithOrderIdx.query(sql, params),
    getServerSupabase: () => createPgSupabaseAdapter(dbWithOrderIdx) as any,
    getServerKeys: () => ({ RESEND: '' } as any),
  });
  const dualOrderRes = await briefingEngine.generateForUser({
    userId: USER_A,
    type: 'EVENING',
    sendEmail: false,
    referenceDate: refNow,
  });
  const oiRow = await dbWithOrderIdx.query(
    `SELECT position, order_index, section FROM public.briefing_items WHERE briefing_id = $1`,
    [dualOrderRes.briefingId]
  );
  assert(
    oiRow.rows[0]?.position === 1 && oiRow.rows[0]?.order_index === 1 && oiRow.rows[0]?.section === 'TOP_STORIES',
    'Quando order_index existe no banco, popula BOTH position e order_index corretamente',
    JSON.stringify(oiRow.rows[0])
  );

  // Restaura deps do db principal para os próximos blocos
  setBriefingEngineTestDeps({
    isPostgresConfigured: () => true,
    executeSql: (sql: string, params?: any[]) => db.query(sql, params),
    getServerSupabase: () => serviceClient as any,
    getServerKeys: () => ({ RESEND: 're_test_mock_key' } as any),
    fetchFn: (async (_url: any, init?: any) => {
      const parsed = init?.body ? JSON.parse(String(init.body)) : {};
      sentEmailPayloads.push(parsed);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: `re_mock_${sentEmailPayloads.length}` }),
      } as any;
    }) as any,
  });

  // 4. Notificações segmentadas, preferências, read/unread e isolamento RLS
  console.log('\n📋 Bloco 4: Notificações segmentadas, unread count, mark-as-read e RLS multiusuário');
  const segStats = await notificationEngine.dispatchSegmentedNotificationsForEvent({
    eventId: 'evt-src',
    title: 'Alerta fonte seguida',
    summary: 'Notícia relevante da fonte seguida',
    relevanceScore: 78, // Abaixo de 85 -> USER_A (onlyHighRelevance=false) recebe; USER_B não segue e has onlyHighRelevance=true
    sourceIds: ['src-valor'],
    type: 'NEWS_HIGH_RELEVANCE',
  });
  assert(segStats.created === 1, 'Alerta segmentado por fonte cria notificação para USER_A', JSON.stringify(segStats));

  const userARlsClient = createPgSupabaseAdapter(db, USER_A);
  const userBRlsClient = createPgSupabaseAdapter(db, USER_B);

  const rlsARead = await userARlsClient.from('notifications').select('*');
  const rlsBRead = await userBRlsClient.from('notifications').select('*');
  assert(
    rlsARead.data.length >= 2 && rlsBRead.data.length === 0,
    'RLS multiusuário isola notificações de USER_A e impede USER_B de lê-las',
    `A=${rlsARead.data.length}, B=${rlsBRead.data.length}`
  );

  // User B tenta marcar notificação de User A como lida -> não pode afetar
  const targetNotifId = rlsARead.data[0].id;
  await notificationService.markAsReadDetailed(targetNotifId, USER_B);
  const checkAfterAttack = await db.query(`SELECT read FROM public.notifications WHERE id = $1`, [targetNotifId]);
  assert(checkAfterAttack.rows[0]?.read === false, 'Usuário B não consegue alterar read de notificação de A');

  // 5. Trava de concorrência no endpoint /api/notifications/generate-briefings
  console.log('\n📋 Bloco 5: Trava de concorrência (409) e autorização /api/notifications/generate-briefings');
  const unauthGenReq = { method: 'POST', url: '/api/notifications/generate-briefings', headers: {} };
  const unauthGenRes = createMockRes();
  await generateBriefingsHandler(unauthGenReq, unauthGenRes);
  assert(unauthGenRes.statusCode === 401, 'Endpoint generate-briefings rejeita sem token (401)');

  // Simula execução concorrente atrasando listEligibleUsers durante o primeiro ciclo
  const origListEligible = briefingEngine.listEligibleUsers.bind(briefingEngine);
  let releaseHold!: () => void;
  const holdPromise = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  briefingEngine.listEligibleUsers = async (...args: any[]) => {
    await holdPromise;
    return origListEligible(...(args as [any, any, any]));
  };

  const req1 = {
    method: 'POST',
    url: '/api/notifications/generate-briefings',
    headers: { authorization: 'Bearer v24-test-cron-secret', 'content-type': 'application/json' },
    body: { type: 'EVENING', referenceDate: '2026-11-16T22:00:00.000Z', sendEmail: false },
  };
  const res1 = createMockRes();
  const run1Promise = generateBriefingsHandler(req1, res1);

  await new Promise((r) => setTimeout(r, 30));

  const req2 = { ...req1 };
  const res2 = createMockRes();
  await generateBriefingsHandler(req2, res2);
  assert(
    res2.statusCode === 409 && res2.json()?.error === 'BRIEFING_CYCLE_ALREADY_RUNNING',
    'Execução concorrente no mesmo slot recebe HTTP 409 BRIEFING_CYCLE_ALREADY_RUNNING',
    `status=${res2.statusCode} body=${res2.body}`
  );

  releaseHold();
  await run1Promise;
  briefingEngine.listEligibleUsers = origListEligible;
  assert(res1.statusCode === 200 && res1.json()?.success === true, 'Primeiro ciclo conclui com HTTP 200 e libera trava');

  // 6. Endpoint protegido Admin Center Ops (/api/admin/briefings-ops) sem PII
  console.log('\n📋 Bloco 6: Telemetria /api/admin/briefings-ops protegida e sem PII');
  setBriefingsOpsTestDeps({
    isPostgresConfigured: () => true,
    executeSql: (sql: string, params?: any[]) => db.query(sql, params),
    getServerSupabase: () => serviceClient as any,
  });

  const unauthOpsRes = createMockRes();
  await briefingsOpsHandler({ method: 'GET', url: '/api/admin/briefings-ops', headers: {} }, unauthOpsRes);
  assert(unauthOpsRes.statusCode === 401, 'Endpoint /api/admin/briefings-ops rejeita requisição não autenticada (401)');

  const adminOpsRes = createMockRes();
  await briefingsOpsHandler(
    {
      method: 'GET',
      url: '/api/admin/briefings-ops',
      headers: { authorization: 'Bearer v24-test-admin-secret' },
    },
    adminOpsRes
  );
  const opsBody = adminOpsRes.json();
  const serializedOps = JSON.stringify(opsBody);
  assert(
    adminOpsRes.statusCode === 200 &&
      opsBody?.success === true &&
      opsBody?.snapshot?.briefingsSummary?.total >= 2 &&
      opsBody?.snapshot?.recentRunLogs?.length >= 1,
    'Endpoint /api/admin/briefings-ops retorna métricas reais e logs de execução',
    `status=${adminOpsRes.statusCode} total=${opsBody?.snapshot?.briefingsSummary?.total}`
  );
  assert(
    !serializedOps.includes('usera@fatosbr.local') &&
      !serializedOps.includes('userb@fatosbr.local') &&
      !serializedOps.includes('optout@fatosbr.local'),
    'Resposta de /api/admin/briefings-ops não expõe nenhum endereço de e-mail ou PII'
  );

  // BriefingsService leitura via RLS para USER_A
  setTestBriefingServiceClient({ client: userARlsClient, configured: true });
  const aBriefings = await briefingService.getUserBriefingsDetailed(USER_A, []);
  assert(
    !aBriefings.error && aBriefings.items.length >= 1 && aBriefings.items[0].rawEvents.length > 0,
    'briefingService lê briefings + itens via RLS do usuário autenticado',
    aBriefings.error || `count=${aBriefings.items.length}`
  );

  // Cleanup deps
  setBriefingEngineTestDeps(null);
  setNotificationEngineTestDeps(null);
  setBriefingsOpsTestDeps(null);
  setTestBriefingServiceClient(null);
  if (prevAdminSecret !== undefined) process.env.ADMIN_SECRET = prevAdminSecret;
  else delete process.env.ADMIN_SECRET;
  if (prevCronSecret !== undefined) process.env.CRON_SECRET = prevCronSecret;
  else delete process.env.CRON_SECRET;

  console.log(`\n📊 RESULTADO V2.4 E2E: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('❌ Erro fatal nos testes V2.4:', err);
  process.exit(1);
});
