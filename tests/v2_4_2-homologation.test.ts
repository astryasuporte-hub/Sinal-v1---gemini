/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.4.2 — SUÍTE DE HOMOLOGAÇÃO FINAL (ATIVAÇÃO CONTROLADA, 100% ISOLADA)
 *
 * Valida em PostgreSQL real embarcado (PGlite) + migrações reais V2.3.1..V2.4.2 sem chamadas externas:
 * 1. Backfill determinístico de entidades (catálogo real de 8 entidades, dry-run -> apply -> idempotência).
 * 2. Transactional Outbox Atômica na Ingestão + Rollback + Política Anti-Spam por Revisão Significativa (event_revision).
 * 3. /api/notifications/process-outbox: lote pequeno, segmentação, preferências, dedup, retries/backoff, dead-letter, locks e runLog.
 * 4. /api/resend/webhook: contrato oficial Svix, idempotência durável em internal.resend_webhook_events
 *    (CONCORRÊNCIA IN_FLIGHT -> 503; FALHA -> 503; PROCESSED -> 200 duplicate), todos os eventos Resend e proteção out-of-order.
 * 5. Briefings end-to-end (MORNING/EVENING, personalização com articles/follows, seções canônicas, dedup, RLS,
 *    BRIEFING_READY, Resend mockado, horários personalizados e múltiplos timezones/DST).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

import {
  runServerSideIngestion,
  setIngestionEngineTestDeps,
} from '../api/_lib/ingestionEngine.js';
import {
  setNotificationOutboxTestDeps,
  processNotificationOutboxBatch,
  recoverMissingNotificationOutbox,
  getNotificationOutboxStats,
  enqueueNotificationOutbox,
} from '../api/_lib/notificationOutbox.js';
import { notificationEngine, setNotificationEngineTestDeps } from '../api/_lib/notificationEngine.js';
import {
  briefingEngine,
  computeNextUserBriefingAt,
  getBriefingPeriodWindow,
  isUserWithinScheduleWindow,
  setBriefingEngineTestDeps,
} from '../api/_lib/briefingEngine.js';
import {
  backfillEventEntities,
  compileEntityMatchers,
  loadActiveEntityCatalog,
  matchCompiledEntities,
} from '../api/_lib/entityMatcher.js';
import {
  DEFAULT_VERIFIED_RESEND_FROM,
  verifyResendWebhookSignature,
} from '../api/_lib/resendClient.js';
import resendWebhookHandler, {
  clearResendWebhookReplayCache,
  setResendWebhookTestDeps,
} from '../api/_lib/handlers/resend/webhook.js';
import resendStatusHandler from '../api/_lib/handlers/resend/status.js';
import processOutboxHandler from '../api/_lib/handlers/notifications/processOutbox.js';
import { acquireDistributedLeaseLock, setDistributedLockTestDeps } from '../api/_lib/distributedLock.js';

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
      op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
      selectCols: string;
      selectOpts?: { count?: string; head?: boolean };
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
            const cntRes = await db.query<{ cnt: number }>(
              `SELECT COUNT(*)::int AS cnt FROM public."${table}"${clause}`,
              params
            );
            return { data: null, count: Number(cntRes.rows[0]?.cnt || 0), error: null };
          }
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
          const returning = state.wantSelectAfterWrite ? ` RETURNING ${state.selectCols || '*'}` : '';
          const res = await db.query(
            `UPDATE public."${table}" SET ${sets.join(', ')}${clause}${returning}`,
            params
          );
          return { data: res.rows, error: null };
        }

        if (state.op === 'delete') {
          const { clause, params } = buildWhere(1);
          await db.query(`DELETE FROM public."${table}"${clause}`, params);
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

    CREATE TABLE public.news_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      domain TEXT UNIQUE NOT NULL,
      logo_url TEXT,
      country_code TEXT,
      language_code TEXT,
      authority_score INTEGER DEFAULT 80,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE public.articles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id UUID REFERENCES public.news_sources(id) ON DELETE SET NULL,
      canonical_url TEXT UNIQUE,
      url TEXT UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      author TEXT,
      image_url TEXT,
      language_code TEXT DEFAULT 'pt',
      published_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE public.topics (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT,
      image_url TEXT,
      is_active BOOLEAN DEFAULT true,
      is_featured BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

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
      status TEXT NOT NULL DEFAULT 'CONFIRMED',
      relevance_score INTEGER NOT NULL DEFAULT 75,
      primary_article_id UUID,
      article_count INTEGER DEFAULT 1,
      first_seen_at TIMESTAMPTZ DEFAULT NOW(),
      last_updated_at TIMESTAMPTZ DEFAULT NOW(),
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      key_points JSONB DEFAULT '[]'::jsonb,
      revision INTEGER DEFAULT 1,
      enrichment_status TEXT DEFAULT 'PENDING'
    );

    CREATE TABLE public.event_articles (
      event_id TEXT NOT NULL,
      article_id UUID NOT NULL,
      similarity_score NUMERIC DEFAULT 1.0,
      is_primary BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (event_id, article_id)
    );

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
    'supabase/migrations/20261123000001_v2_4_2_webhook_idempotency_and_revision_dedup.sql',
    // Executa V2.4.2 duas vezes em isolamento para comprovar idempotência estrita da nova migração incremental:
    'supabase/migrations/20261123000001_v2_4_2_webhook_idempotency_and_revision_dedup.sql',
  ];

  for (const mf of migrationFiles) {
    const sql = fs.readFileSync(path.resolve(mf), 'utf-8');
    await db.exec(sql);
  }

  await db.exec(`
    ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.briefing_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS briefings_own_select ON public.briefings;
    CREATE POLICY briefings_own_select ON public.briefings
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS briefing_items_own_select ON public.briefing_items;
    CREATE POLICY briefing_items_own_select ON public.briefing_items
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.briefings b WHERE b.id = briefing_id AND b.user_id = auth.uid()));

    DROP POLICY IF EXISTS notifications_own_select ON public.notifications;
    CREATE POLICY notifications_own_select ON public.notifications
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);

    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT ON public.briefings TO authenticated;
    GRANT SELECT ON public.briefing_items TO authenticated;
    GRANT SELECT ON public.notifications TO authenticated;
  `);

  return db;
}

async function runV242HomologationSuite() {
  console.log('==============================================================================');
  console.log('🛡️  FATOSBR V2.4.2 — HOMOLOGAÇÃO FINAL DE ATIVAÇÃO CONTROLADA (ISOLADA)');
  console.log('==============================================================================\n');

  const db = await setupIsolatedDatabase();
  const sbAdapter = createPgSupabaseAdapter(db);

  const USER_A = '11111111-1111-4111-8111-111111111111';
  const USER_B = '22222222-2222-4222-8222-222222222222';
  const USER_C_OPT_OUT_HIGH = '33333333-3333-4333-8333-333333333333';
  const USER_D_OPTOUT_URGENT = '44444444-4444-4444-8444-444444444444';

  const rawWhSecretB64 = Buffer.from('fatosbr_v242_webhook_test_key_32b').toString('base64');
  const testWebhookSecret = `whsec_${rawWhSecretB64}`;

  const savedEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
  };

  process.env.CRON_SECRET = 'cron_v242_isolated_test_secret';

  const withPgTx = async <T>(cb: (client: any) => Promise<T>): Promise<T> => {
    await db.exec('BEGIN');
    try {
      const res = await cb({ query: (q: string, p?: any[]) => db.query(q, p) });
      await db.exec('COMMIT');
      return res;
    } catch (err) {
      try {
        await db.exec('ROLLBACK');
      } catch {}
      throw err;
    }
  };

  try {
    // -------------------------------------------------------------------------
    // BLOCO 1: Backfill & Associação Determinística (Catálogo Real de 8 Entidades)
    // -------------------------------------------------------------------------
    console.log('📋 Bloco 1: Associação Determinística com Catálogo de 8 Entidades & Backfill');

    await db.query(
      `INSERT INTO public.entities (id, name, slug, type) VALUES
        ('ent-petro', 'Petrobras S.A.', 'petrobras', 'COMPANY'),
        ('ent-bc', 'Banco Central (BC)', 'banco-central', 'INSTITUTION'),
        ('ent-stf', 'Supremo Tribunal Federal (STF)', 'stf', 'INSTITUTION'),
        ('ent-vale', 'Vale', 'vale', 'COMPANY'),
        ('ent-b3', 'B3 S.A.', 'b3', 'COMPANY'),
        ('ent-fazenda', 'Ministério da Fazenda', 'ministerio-da-fazenda', 'INSTITUTION'),
        ('ent-itau', 'Itaú Unibanco', 'itau-unibanco', 'COMPANY'),
        ('ent-ibge', 'IBGE', 'ibge', 'INSTITUTION')`
    );

    await db.query(
      `INSERT INTO public.entity_aliases (entity_id, alias, normalized_alias) VALUES
        ('ent-bc', 'Copom', 'copom'),
        ('ent-fazenda', 'Equipe Econômica', 'equipe economica')`
    );

    // Segunda-feira 2026-11-23 às 11:00 UTC (08:00 BRT)
    const refMondayMorning = new Date('2026-11-23T11:00:00.000Z');
    const histPublishedAt = new Date(refMondayMorning.getTime() - 2 * 3600_000).toISOString();

    await db.query(
      `INSERT INTO public.events (id, title, summary, why_it_matters, relevance_score, status, published_at) VALUES
        ('hist-evt-1', 'Supremo Tribunal Federal analisa ação sobre dividendos da Petrobras', 'Julgamento envolve impacto fiscal e governança.', 'Relevante para mercado.', 92, 'CONFIRMED', $1),
        ('hist-evt-2', 'Banco Central mantém Selic e indica cautela com inflação medida pelo IBGE', 'IPCA segue no centro do debate monetário.', 'Impacta renda fixa.', 90, 'CONFIRMED', $1),
        ('hist-evt-3', 'B3 registra volume recorde com avanço de ações da Vale', 'Mineração impulsiona pregão na bolsa paulista.', 'Alta liquidez no Ibovespa.', 86, 'CONFIRMED', $1),
        ('hist-evt-4', 'Ministério da Fazenda detalha meta fiscal em reunião com bancos', 'Projeções foram apresentadas em Brasília.', 'Âncora fiscal em foco.', 85, 'CONFIRMED', $1),
        ('hist-evt-5', 'Relatório trimestral destaca crédito corporativo no Brasil', 'Resumo setorial divulgado hoje.', 'Cobertura em andamento.', 82, 'DEVELOPING', $1),
        ('hist-evt-neg', 'Valor equivalente do mercado sem stf nem bc nem vale em minúscula', 'Texto genérico sem entidades oficiais.', 'Sem vínculo de entidade.', 74, 'DEVELOPING', $1)`,
      [histPublishedAt]
    );

    // Vincula matéria real ao hist-evt-5 citando Itaú Unibanco (enriquecimento via articles)
    await db.query(
      `INSERT INTO public.articles (id, canonical_url, url, title, description, published_at)
       VALUES ('33333333-3333-4333-8333-333333333335', 'https://valor.globo.com/financas/itau', 'https://valor.globo.com/financas/itau', 'Itaú Unibanco amplia carteira de crédito corporativo', 'Resultado trimestral superou projeções.', $1)`,
      [histPublishedAt]
    );
    await db.query(
      `INSERT INTO public.event_articles (event_id, article_id, is_primary) VALUES ('hist-evt-5', '33333333-3333-4333-8333-333333333335', true)`
    );

    const catalog = await loadActiveEntityCatalog((sql, params) => db.query(sql, params));
    const matchers = compileEntityMatchers(catalog);
    const stfWithoutAcronym = matchCompiledEntities('Supremo Tribunal Federal julga recurso hoje', matchers);
    const petroDotSuffix = matchCompiledEntities('Petrobras aprova novo plano estratégico', matchers);
    const b3ShortAcronym = matchCompiledEntities('Ibovespa sobe na B3 após balanço', matchers);
    const negCheck = matchCompiledEntities('Valor equivalente em vale-transporte e b3 em minúscula', matchers);

    assert(
      catalog.length === 8 &&
        stfWithoutAcronym.includes('ent-stf') &&
        petroDotSuffix.includes('ent-petro') &&
        b3ShortAcronym.includes('ent-b3') &&
        negCheck.length === 0,
      'EntityMatcher deriva corretamente nomes sem parênteses (STF), sufixo S.A. (Petrobras/B3) e bloqueia falsos positivos',
      JSON.stringify({ stfWithoutAcronym, petroDotSuffix, b3ShortAcronym, negCheck })
    );

    // Backfill DRY-RUN + APPLY + Idempotência
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
    const reApplyRes = await backfillEventEntities({
      queryFn: (sql, params) => db.query(sql, params),
      batchSize: 2,
      limit: 100,
      dryRun: false,
      onlyMissing: true,
    });
    const linksAfterApply = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM public.event_entities`);

    assert(
      dryRunRes.linksPlanned === 8 &&
        dryRunRes.linksInserted === 0 &&
        applyRes.linksInserted === 8 &&
        reApplyRes.linksInserted === 0 &&
        linksAfterApply.rows[0].cnt === 8,
      'Backfill dry-run -> apply persiste 8 vínculos reais em public.event_entities e 2ª execução é idempotente',
      JSON.stringify({ dryRunRes, applyRes, reApplyRes })
    );

    // -------------------------------------------------------------------------
    // BLOCO 2: Outbox Atômica, Rollback & Política de Revisão Significativa (Anti-Spam)
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 2: Transactional Outbox Atômica, Rollback e Deduplicação por Revisão Significativa');

    const firstRecover = await recoverMissingNotificationOutbox({
      queryFn: (sql, params) => db.query(sql, params),
      sinceHours: 240,
      limit: 50,
    });
    const secondRecover = await recoverMissingNotificationOutbox({
      queryFn: (sql, params) => db.query(sql, params),
      sinceHours: 240,
      limit: 50,
    });
    assert(
      firstRecover.recovered === 6 && secondRecover.scanned === 0 && secondRecover.recovered === 0,
      'recoverMissingNotificationOutbox recupera acontecimentos legados sem outbox de forma idempotente'
    );

    // Rollback atômico quando outbox falha
    setIngestionEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      withTransaction: withPgTx,
      fetchUpstreamFn: async () => ({
        articles: [
          {
            title: 'Petrobras anuncia investimento bilionário em refino nacional',
            url: 'https://g1.globo.com/economia/petrobras-refino-rollback',
            canonicalUrl: 'https://g1.globo.com/economia/petrobras-refino-rollback',
            description: 'Aporte prevê expansão da capacidade até 2029.',
            sourceName: 'G1',
            domain: 'g1.globo.com',
            publishedAt: refMondayMorning.toISOString(),
            category: 'Empresas',
            topicSlug: 'empresas',
          },
        ],
        providers: { gnews: { configured: true, count: 1 } },
      }),
      enqueueOutboxFn: async () => ({
        enqueued: false,
        error: 'Simulated internal.notification_outbox disk write failure',
        errorCode: '53100',
      }),
    });

    const eventsBeforeFail = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM public.events`);
    const failedIngestRes = await runServerSideIngestion({ keywords: ['petrobras'] });
    const eventsAfterFail = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM public.events`);

    assert(
      failedIngestRes.success === false &&
        String(failedIngestRes.error || '').includes('OUTBOX_ATOMIC_ENQUEUE_FAILED') &&
        eventsAfterFail.rows[0].cnt === eventsBeforeFail.rows[0].cnt,
      'Falha na gravação da outbox faz rollback atômico de public.events e public.articles'
    );

    // Ciclo de vida por revisão significativa:
    // Fase 1: Acontecimento DEVELOPING (1 veículo, score=86 -> rev 1)
    let ingestArticlePhase: 'DEVELOPING' | 'CONFIRMED' = 'DEVELOPING';
    setIngestionEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      withTransaction: withPgTx,
      fetchUpstreamFn: async () => {
        const baseArticle = {
          title: 'Petrobras anuncia plano recorde de refino em conjunto com B3',
          url: 'https://g1.globo.com/economia/petrobras-b3-plano',
          canonicalUrl: 'https://g1.globo.com/economia/petrobras-b3-plano',
          description: 'Investidores repercutem o anúncio na B3.',
          sourceName: 'G1',
          domain: 'g1.globo.com',
          publishedAt: refMondayMorning.toISOString(),
          category: 'Empresas',
          topicSlug: 'empresas',
        };
        if (ingestArticlePhase === 'DEVELOPING') {
          return {
            articles: [baseArticle],
            providers: { gnews: { configured: true, count: 1 } },
          };
        }
        return {
          articles: [
            baseArticle,
            {
              title: 'Plano de refino da Petrobras movimenta ações na B3 hoje',
              url: 'https://valor.globo.com/empresas/petrobras-b3-plano',
              canonicalUrl: 'https://valor.globo.com/empresas/petrobras-b3-plano',
              description: 'Corretoras avaliam dividendos e capex.',
              sourceName: 'Valor Econômico',
              domain: 'valor.globo.com',
              publishedAt: refMondayMorning.toISOString(),
              category: 'Empresas',
              topicSlug: 'empresas',
            },
          ],
          providers: { gnews: { configured: true, count: 2 } },
        };
      },
      enqueueOutboxFn: enqueueNotificationOutbox,
    });

    const ingRev1 = await runServerSideIngestion({ keywords: ['petrobras'] });
    const ingRev1Trivial = await runServerSideIngestion({ keywords: ['petrobras'] }); // Re-ingestão idêntica -> zero spam

    ingestArticlePhase = 'CONFIRMED';
    const ingRev2Significant = await runServerSideIngestion({ keywords: ['petrobras'] }); // Promoção DEVELOPING -> CONFIRMED (rev 2!)
    const ingRev2Trivial = await runServerSideIngestion({ keywords: ['petrobras'] }); // Re-ingestão idêntica após CONFIRMED -> zero spam!

    const revEventRows = await db.query<any>(
      `SELECT id, status, revision, article_count FROM public.events WHERE title LIKE 'Petrobras anuncia plano recorde%'`
    );
    const revOutboxRows = await db.query<any>(
      `SELECT dedup_key, event_type, status, (payload->>'eventRevision')::int AS rev
         FROM internal.notification_outbox
        WHERE event_id = $1
        ORDER BY created_at ASC`,
      [revEventRows.rows[0]?.id]
    );

    assert(
      ingRev1.outboxEnqueued === 1 &&
        ingRev1Trivial.outboxEnqueued === 0 &&
        ingRev2Significant.eventsUpdated === 1 &&
        ingRev2Significant.outboxEnqueued === 1 &&
        ingRev2Trivial.outboxEnqueued === 0 &&
        revEventRows.rows[0]?.status === 'CONFIRMED' &&
        Number(revEventRows.rows[0]?.revision) === 2 &&
        revOutboxRows.rows.length === 2 &&
        revOutboxRows.rows[0]?.dedup_key === `event:${revEventRows.rows[0]?.id}` &&
        revOutboxRows.rows[1]?.dedup_key === `event:${revEventRows.rows[0]?.id}:rev:2`,
      'Política de revisão significativa enfileira rev=1 e rev=2 (CONFIRMED), ignorando re-execuções triviais sem spam',
      JSON.stringify({ ingRev1, ingRev1Trivial, ingRev2Significant, ingRev2Trivial, evt: revEventRows.rows[0], outbox: revOutboxRows.rows })
    );

    // Teste direto de integridade do índice único em public.notifications (mesma revisão bloqueada, revisão 2 permitida)
    setNotificationEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
    });
    const revIdxTestEvt = 'evt-rev-idx-integrity';
    const nRev1A = await notificationEngine.createNotification({
      userId: USER_A,
      type: 'NEWS_HIGH_RELEVANCE',
      category: 'entidades',
      title: 'Evento Teste Rev 1',
      eventId: revIdxTestEvt,
      eventRevision: 1,
    });
    const nRev1Dup = await notificationEngine.createNotification({
      userId: USER_A,
      type: 'NEWS_HIGH_RELEVANCE',
      category: 'entidades',
      title: 'Evento Teste Rev 1 Duplicado',
      eventId: revIdxTestEvt,
      eventRevision: 1,
    });
    const nRev2 = await notificationEngine.createNotification({
      userId: USER_A,
      type: 'EVENT_UPDATED',
      category: 'entidades',
      title: 'Evento Teste Rev 2 Confirmado',
      eventId: revIdxTestEvt,
      eventRevision: 2,
    });
    const idxCountRes = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.notifications WHERE user_id = $1 AND event_id = $2`,
      [USER_A, revIdxTestEvt]
    );
    assert(
      nRev1A.success && !nRev1A.duplicate && nRev1Dup.duplicate === true && nRev2.success && !nRev2.duplicate && idxCountRes.rows[0].cnt === 2,
      'Índice único idx_notifications_dedup_user_event_cat bloqueia duplicata na mesma revisão e permite nova revisão significativa'
    );

    // -------------------------------------------------------------------------
    // BLOCO 3: Worker /api/notifications/process-outbox (Lote Pequeno, Preferências, Retries, DLQ, Locks e Logs)
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 3: /api/notifications/process-outbox — Lote, Preferências, Backoff, DLQ, Locks & Logs');

    await db.query(
      `INSERT INTO public.user_preferences (id, email_morning_briefing, email_evening_briefing, email_breaking_alerts, briefing_email, weekend_edition, timezone, morning_time, evening_time)
       VALUES
         ($1, true, true, true, 'usuario.a@fatosbr.local', true, 'America/Sao_Paulo', '07:00', '20:00'),
         ($2, true, true, true, 'usuario.b@fatosbr.local', true, 'America/Sao_Paulo', '07:00', '20:00'),
         ($3, false, false, true, 'usuario.c@fatosbr.local', false, 'America/Manaus', '07:00', '20:00'),
         ($4, false, false, false, 'usuario.d@fatosbr.local', false, 'America/New_York', '07:00', '20:00')`,
      [USER_A, USER_B, USER_C_OPT_OUT_HIGH, USER_D_OPTOUT_URGENT]
    );
    await db.query(
      `INSERT INTO public.user_settings (user_id, email_morning_briefing, email_evening_briefing, email_breaking_alerts, timezone, notification_settings)
       VALUES
         ($1, true, true, true, 'America/Sao_Paulo', '{"urgentEvents":true,"entityUpdates":true,"onlyHighRelevance":false,"dailyBriefings":true}'::jsonb),
         ($2, true, true, true, 'America/Sao_Paulo', '{"urgentEvents":true,"entityUpdates":true,"onlyHighRelevance":false,"dailyBriefings":true}'::jsonb),
         ($3, false, false, true, 'America/Manaus', '{"urgentEvents":true,"entityUpdates":true,"onlyHighRelevance":true,"dailyBriefings":true}'::jsonb),
         ($4, false, false, false, 'America/New_York', '{"urgentEvents":false,"entityUpdates":true,"onlyHighRelevance":false,"dailyBriefings":false}'::jsonb)`,
      [USER_A, USER_B, USER_C_OPT_OUT_HIGH, USER_D_OPTOUT_URGENT]
    );
    await db.query(
      `INSERT INTO public.user_entity_follows (user_id, entity_id) VALUES
        ($1, 'ent-petro'),
        ($1, 'ent-bc'),
        ($2, 'ent-vale'),
        ($3, 'ent-itau'),
        ($4, 'ent-petro')`,
      [USER_A, USER_B, USER_C_OPT_OUT_HIGH, USER_D_OPTOUT_URGENT]
    );

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

    // Unauthorized & Method Not Allowed checks
    const outboxUnauth = createMockRes();
    await processOutboxHandler({ method: 'GET', url: '/api/notifications/process-outbox', headers: {} }, outboxUnauth);
    const outboxBadMethod = createMockRes();
    await processOutboxHandler({ method: 'DELETE', url: '/api/notifications/process-outbox', headers: {} }, outboxBadMethod);
    assert(
      outboxUnauth.statusCode === 401 && outboxBadMethod.statusCode === 405,
      'Endpoint /api/notifications/process-outbox exige auth (401) e método GET/POST (405)'
    );

    // Concurrent distributed lock check -> HTTP 409
    const workerLockHolder = await acquireDistributedLeaseLock({
      lockKey: 'fatosbr:notification-outbox:worker',
      ttlMs: 30_000,
    });
    const outboxLockedRes = createMockRes();
    await processOutboxHandler(
      {
        method: 'GET',
        url: '/api/notifications/process-outbox?limit=5',
        headers: { authorization: 'Bearer cron_v242_isolated_test_secret' },
      },
      outboxLockedRes
    );
    await workerLockHolder.release();
    assert(
      workerLockHolder.acquired === true &&
        outboxLockedRes.statusCode === 409 &&
        outboxLockedRes.json()?.error === 'OUTBOX_WORKER_ALREADY_RUNNING',
      'Trava distribuída impede concorrência no worker da outbox retornando HTTP 409'
    );

    // Lote controlado (limit=4, maxBatches=2) -> processa até 8 itens via GET estilo Vercel/Cron
    const cronOutboxRes = createMockRes();
    await processOutboxHandler(
      {
        method: 'GET',
        url: '/api/notifications/process-outbox?limit=4&maxBatches=2',
        headers: { authorization: 'Bearer cron_v242_isolated_test_secret' },
      },
      cronOutboxRes
    );
    const cronJson = cronOutboxRes.json();

    // Verifica preferências: USER_C (onlyHighRelevance=true) NÃO recebe hist-evt-5 (score 82 < 85), USER_D (urgentEvents=false) NÃO recebe Petrobras, USER_A recebe rev=1 e rev=2 de Petrobras!
    const userCHighCheck = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.notifications WHERE user_id = $1 AND event_id = 'hist-evt-5'`,
      [USER_C_OPT_OUT_HIGH]
    );
    const userDUrgentCheck = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.notifications WHERE user_id = $1`,
      [USER_D_OPTOUT_URGENT]
    );
    const userAPetroRevs = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.notifications WHERE user_id = $1 AND event_id = $2`,
      [USER_A, revEventRows.rows[0]?.id]
    );

    assert(
      cronOutboxRes.statusCode === 200 &&
        cronJson?.success === true &&
        cronJson?.completed >= 7 &&
        Boolean(cronJson?.runLog?.runId) &&
        typeof cronJson?.runLog?.durationMs === 'number' &&
        userCHighCheck.rows[0].cnt === 0 &&
        userDUrgentCheck.rows[0].cnt === 0 &&
        userAPetroRevs.rows[0].cnt === 2,
      'GET /api/notifications/process-outbox processa lote com runLog estruturado, respeita preferências e entrega rev=1 + rev=2',
      JSON.stringify({ cronJson, userC: userCHighCheck.rows[0], userD: userDUrgentCheck.rows[0], userAPetroRevs: userAPetroRevs.rows[0] })
    );

    // Testa retries com backoff + DEAD_LETTER via endpoint HTTP
    await enqueueNotificationOutbox(
      { eventId: 'evt-outbox-dlq-v242', title: 'Evento falha persistente', relevanceScore: 95 },
      { maxAttempts: 2 }
    );
    setNotificationOutboxTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
      dispatchFn: async (payload) => {
        if (payload.eventId === 'evt-outbox-dlq-v242') {
          return {
            targetedUsers: 1,
            created: 0,
            duplicates: 0,
            skippedByPreferences: 0,
            errors: 1,
            errorDetails: ['Erro transitório simulado no dispatch'],
          };
        }
        return notificationEngine.dispatchSegmentedNotificationsForEvent(payload);
      },
    });

    const retryRes1 = createMockRes();
    await processOutboxHandler(
      { method: 'POST', headers: { authorization: 'Bearer cron_v242_isolated_test_secret' }, body: { limit: 5 } },
      retryRes1
    );
    const failedRow = await db.query<any>(
      `SELECT status, attempts, next_retry_at > NOW() AS backoff_future FROM internal.notification_outbox WHERE event_id = 'evt-outbox-dlq-v242'`
    );
    await db.query(
      `UPDATE internal.notification_outbox SET next_retry_at = NOW() - INTERVAL '1 second' WHERE event_id = 'evt-outbox-dlq-v242'`
    );
    const retryRes2 = createMockRes();
    await processOutboxHandler(
      { method: 'POST', headers: { authorization: 'Bearer cron_v242_isolated_test_secret' }, body: { limit: 5 } },
      retryRes2
    );
    const dlqRow = await db.query<any>(
      `SELECT status, attempts, last_error FROM internal.notification_outbox WHERE event_id = 'evt-outbox-dlq-v242'`
    );
    assert(
      retryRes1.json()?.retried === 1 &&
        failedRow.rows[0]?.status === 'FAILED' &&
        failedRow.rows[0]?.backoff_future === true &&
        retryRes2.json()?.deadLettered === 1 &&
        dlqRow.rows[0]?.status === 'DEAD_LETTER' &&
        dlqRow.rows[0]?.attempts === 2,
      'Outbox worker aplica backoff exponencial (FAILED -> next_retry_at futuro) e move para DEAD_LETTER ao esgotar max_attempts',
      JSON.stringify({ r1: retryRes1.json(), failedRow: failedRow.rows[0], r2: retryRes2.json(), dlqRow: dlqRow.rows[0] })
    );

    // Restaura dispatch real para o restante
    setNotificationOutboxTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
      dispatchFn: notificationEngine.dispatchSegmentedNotificationsForEvent.bind(notificationEngine),
    });

    // -------------------------------------------------------------------------
    // BLOCO 4: Briefings End-to-End (Personalização, Seções, Dedup, RLS, Multi-Timezone/DST & Mock Resend)
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 4: Briefings End-to-End (MORNING/EVENING, Personalização, RLS, Multi-TZ/DST & Mock Resend)');

    let resendMockSendCount = 0;
    setBriefingEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
      getServerKeys: () => ({ RESEND: 're_mock_v242' } as any),
      fetchFn: (async () => {
        resendMockSendCount++;
        return new Response(JSON.stringify({ id: `re_v242_msg_${resendMockSendCount}` }), { status: 200 });
      }) as any,
    });

    // Garante múltiplas confirmações para cobrir todas as seções canônicas no briefing de USER_A
    const morningA = await briefingEngine.generateForUser({
      userId: USER_A,
      type: 'MORNING',
      sendEmail: true,
      referenceDate: refMondayMorning,
      retryDelayBaseMs: 1,
    });
    const morningADup = await briefingEngine.generateForUser({
      userId: USER_A,
      type: 'MORNING',
      sendEmail: true,
      referenceDate: refMondayMorning,
      retryDelayBaseMs: 1,
    });
    const morningB = await briefingEngine.generateForUser({
      userId: USER_B,
      type: 'MORNING',
      sendEmail: true,
      referenceDate: refMondayMorning,
      retryDelayBaseMs: 1,
    });

    await db.query(
      `INSERT INTO public.events (id, title, summary, why_it_matters, relevance_score, status, published_at)
       VALUES ('hist-evt-eve', 'Banco Central publica ata com projeções atualizadas do Copom', 'Ata traz cenário de juros para 2027.', 'Direciona curva futura.', 91, 'CONFIRMED', $1)`,
      ['2026-11-23T20:30:00.000Z']
    );
    const eveningA = await briefingEngine.generateForUser({
      userId: USER_A,
      type: 'EVENING',
      sendEmail: true,
      referenceDate: new Date('2026-11-23T23:00:00.000Z'), // 20:00 BRT
      retryDelayBaseMs: 1,
    });
    // Briefing #4 de email (para testar 4o evento webhook email.failed posteriormente)
    const eveningB = await briefingEngine.generateForUser({
      userId: USER_B,
      type: 'EVENING',
      sendEmail: true,
      referenceDate: new Date('2026-11-23T23:00:00.000Z'),
      retryDelayBaseMs: 1,
    });

    const userAMorningItems = await db.query<{ event_id: string; section: string; position: number }>(
      `SELECT event_id, section, position FROM public.briefing_items WHERE briefing_id = $1 ORDER BY position ASC`,
      [morningA.briefingId]
    );
    const allAllowedSections = ['TOP_STORIES', 'UPDATES', 'DEVELOPING', 'WATCH_NEXT'];
    const sectionsValid = userAMorningItems.rows.every((r) => allAllowedSections.includes(r.section));
    const userAPrioritizedPetro = userAMorningItems.rows.some((r) =>
      r.event_id === 'hist-evt-1' || r.event_id === revEventRows.rows[0]?.id
    );

    assert(
      morningA.status === 'SENT' &&
        morningADup.status === 'SKIPPED_DUPLICATE' &&
        morningB.status === 'SENT' &&
        eveningA.status === 'SENT' &&
        eveningB.status === 'SENT' &&
        resendMockSendCount === 4 &&
        sectionsValid &&
        userAPrioritizedPetro,
      'Briefings MORNING/EVENING geram itens personalizados com seções canônicas, dedup por slot, BRIEFING_READY e 4 envios mockados',
      JSON.stringify({ morningA, morningADup, sections: userAMorningItems.rows.map((r) => r.section), resendMockSendCount })
    );

    // Horários personalizados & Multi-Timezone / DST (Sao_Paulo, Manaus, New_York, Lisbon, Tokyo)
    const spEarly = isUserWithinScheduleWindow(
      { timezone: 'America/Sao_Paulo', morningTime: '08:15', eveningTime: '20:00' },
      'MORNING',
      new Date('2026-11-23T11:00:00.000Z') // 08:00 BRT < 08:15
    );
    const spDue = isUserWithinScheduleWindow(
      { timezone: 'America/Sao_Paulo', morningTime: '07:45', eveningTime: '20:00' },
      'MORNING',
      new Date('2026-11-23T11:00:00.000Z') // 08:00 BRT >= 07:45
    );
    const manausWait = isUserWithinScheduleWindow(
      { timezone: 'America/Manaus', morningTime: '07:30', eveningTime: '20:00' },
      'MORNING',
      new Date('2026-11-23T11:00:00.000Z') // 07:00 Manaus < 07:30
    );
    const tokyoEvening = isUserWithinScheduleWindow(
      { timezone: 'Asia/Tokyo', morningTime: '07:00', eveningTime: '20:00' },
      'EVENING',
      new Date('2026-11-23T11:30:00.000Z') // 20:30 JST >= 20:00
    );
    const nyEdt = getBriefingPeriodWindow('MORNING', new Date('2026-10-30T12:00:00.000Z'), {
      timezone: 'America/New_York',
      morningTime: '07:00',
    });
    const nyEst = getBriefingPeriodWindow('MORNING', new Date('2026-11-03T13:00:00.000Z'), {
      timezone: 'America/New_York',
      morningTime: '07:00',
    });
    const lisbonNextWeekday = computeNextUserBriefingAt(
      { timezone: 'Europe/Lisbon', morningTime: '07:30', eveningTime: '20:00', weekendEdition: false },
      'MORNING',
      new Date('2026-11-20T18:00:00.000Z')
    );

    assert(
      !spEarly &&
        spDue &&
        !manausWait &&
        tokyoEvening &&
        new Date(nyEdt.scheduledFor).getUTCHours() === 11 &&
        new Date(nyEst.scheduledFor).getUTCHours() === 12 &&
        lisbonNextWeekday.startsWith('2026-11-23T07:30'),
      'Janelas personalizadas (morning_time/evening_time), multi-timezone (SP/Manaus/Tokyo/NY/Lisbon) e transição DST validados'
    );

    // -------------------------------------------------------------------------
    // BLOCO 5: Homologação Completa Resend Webhooks (Concorrência IN_FLIGHT, 503 Retry,
    //          Idempotência Durável, Todos os Eventos & Out-of-Order)
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 5: Resend Webhooks — Svix Estrito, Idempotência Durável, IN_FLIGHT->503 & Out-of-Order');
    clearResendWebhookReplayCache();

    // Sem RESEND_WEBHOOK_SECRET -> 503 (zero segredos inventados)
    delete process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_FROM_EMAIL = DEFAULT_VERIFIED_RESEND_FROM;
    delete process.env.RESEND_API_KEY;

    const statusResNoKey = createMockRes();
    await resendStatusHandler({ method: 'GET', headers: {} }, statusResNoKey);
    const noSecretWhRes = createMockRes();
    await resendWebhookHandler(
      {
        method: 'POST',
        headers: { 'svix-id': 'msg_no_sec', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,abc' },
        rawBody: JSON.stringify({ type: 'email.delivered', data: { email_id: 're_v242_msg_1' } }),
      },
      noSecretWhRes
    );
    assert(
      statusResNoKey.json()?.webhookConfigured === false &&
        noSecretWhRes.statusCode === 503 &&
        noSecretWhRes.json()?.error === 'RESEND_WEBHOOK_SECRET_UNCONFIGURED',
      'Sem RESEND_WEBHOOK_SECRET: status reporta webhookConfigured=false e webhook retorna HTTP 503'
    );

    process.env.RESEND_WEBHOOK_SECRET = testWebhookSecret;
    process.env.RESEND_API_KEY = 're_test_v242_isolated_no_network';

    const nowSec = Math.floor(Date.now() / 1000);
    const sigKey = Buffer.from(rawWhSecretB64, 'base64');
    const signSvix = (id: string, ts: string, body: string) =>
      `v1,${crypto.createHmac('sha256', sigKey).update(`${id}.${ts}.${body}`).digest('base64')}`;

    const sendSignedWebhook = async (svixId: string, eventType: string, emailId: string) => {
      const ts = String(Math.floor(Date.now() / 1000));
      const bodyStr = JSON.stringify({
        id: `evt_${svixId}`,
        type: eventType,
        created_at: new Date().toISOString(),
        data: { email_id: emailId },
      });
      const resObj = createMockRes();
      await resendWebhookHandler(
        {
          method: 'POST',
          headers: {
            'svix-id': svixId,
            'svix-timestamp': ts,
            'svix-signature': signSvix(svixId, ts, bodyStr),
          },
          rawBody: bodyStr,
        },
        resObj
      );
      return resObj;
    };

    // Rejeições Svix estritas
    const samplePayload = JSON.stringify({ id: 'evt_svix', type: 'email.delivered', data: { email_id: 're_v242_msg_1' } });
    const expiredSig = verifyResendWebhookSignature({
      rawBody: samplePayload,
      headers: { 'svix-id': 'msg_exp', 'svix-timestamp': String(nowSec - 305), 'svix-signature': signSvix('msg_exp', String(nowSec - 305), samplePayload) },
      secret: testWebhookSecret,
      nowMs: nowSec * 1000,
    });
    const aliasSig = verifyResendWebhookSignature({
      rawBody: samplePayload,
      headers: { 'webhook-id': 'msg_al', 'webhook-timestamp': String(nowSec), 'webhook-signature': signSvix('msg_al', String(nowSec), samplePayload) },
      secret: testWebhookSecret,
      nowMs: nowSec * 1000,
    });
    assert(!expiredSig.valid && !aliasSig.valid, 'Contrato Svix rejeita expiração > 300s e headers alias webhook-*');

    // 5.1 Teste CRÍTICO DE CONCORRÊNCIA (IN_FLIGHT):
    // Simula Instância A com PROCESSING ativo em internal.resend_webhook_events (ainda não persistiu)
    const inflightSvixId = 'msg_v242_concurrent_inflight';
    await db.query(
      `INSERT INTO internal.resend_webhook_events (svix_id, event_type, provider_message_id, status, processing_started_at)
       VALUES ($1, 'email.delivered', 're_v242_msg_1', 'PROCESSING', NOW())`,
      [inflightSvixId]
    );
    setResendWebhookTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      verifyAdminRequest: async () => false,
    });
    const concurrentRes = await sendSignedWebhook(inflightSvixId, 'email.delivered', 're_v242_msg_1');
    const deliveryDuringInflight = await db.query<{ status: string }>(
      `SELECT status FROM internal.briefing_email_deliveries WHERE provider_message_id = 're_v242_msg_1'`
    );
    assert(
      concurrentRes.statusCode === 503 &&
        concurrentRes.json()?.error === 'WEBHOOK_IN_FLIGHT_RETRYABLE' &&
        concurrentRes.json()?.retryable === true &&
        concurrentRes.json()?.duplicate === false &&
        deliveryDuringInflight.rows[0]?.status === 'ACCEPTED',
      'Concorrência IN_FLIGHT (outra instância ainda processando) retorna HTTP 503 retryable e NUNCA 200 duplicate falso',
      JSON.stringify({ statusCode: concurrentRes.statusCode, json: concurrentRes.json(), delivery: deliveryDuringInflight.rows[0] })
    );

    // 5.2 Falha durante apply_resend_webhook_event -> marca FAILED na tabela durável + HTTP 503 -> Retry depois conclui PROCESSED!
    let simulateApplyFailure = true;
    let applySqlCallCount = 0;
    setResendWebhookTestDeps({
      isPostgresConfigured: () => true,
      executeSql: async (sql, params) => {
        if (sql.includes('apply_resend_webhook_event')) {
          applySqlCallCount++;
          if (simulateApplyFailure) {
            throw new Error('ECONNRESET: Simulated temporary DB outage during webhook persist');
          }
        }
        return db.query(sql, params);
      },
      verifyAdminRequest: async () => false,
    });

    const retrySvixId = 'msg_v242_retry_flow_1';
    const failWhRes = await sendSignedWebhook(retrySvixId, 'email.delivered', 're_v242_msg_1');
    const inboxAfterFail = await db.query<{ status: string; attempt_count: number }>(
      `SELECT status, attempt_count FROM internal.resend_webhook_events WHERE svix_id = $1`,
      [retrySvixId]
    );

    simulateApplyFailure = false;
    const recoveredWhRes = await sendSignedWebhook(retrySvixId, 'email.delivered', 're_v242_msg_1');
    const inboxAfterRecover = await db.query<{ status: string; attempt_count: number; delivery_status: string }>(
      `SELECT status, attempt_count, delivery_status FROM internal.resend_webhook_events WHERE svix_id = $1`,
      [retrySvixId]
    );
    const deliveryAfterDelivered = await db.query<{ status: string }>(
      `SELECT status FROM internal.briefing_email_deliveries WHERE provider_message_id = 're_v242_msg_1'`
    );

    assert(
      failWhRes.statusCode === 503 &&
        inboxAfterFail.rows[0]?.status === 'FAILED' &&
        recoveredWhRes.statusCode === 200 &&
        recoveredWhRes.json()?.duplicate === false &&
        inboxAfterRecover.rows[0]?.status === 'PROCESSED' &&
        inboxAfterRecover.rows[0]?.attempt_count === 2 &&
        deliveryAfterDelivered.rows[0]?.status === 'DELIVERED',
      'Falha marca FAILED + 503; retry com mesmo svix-id conclui DELIVERED -> PROCESSED na tentativa 2',
      JSON.stringify({ inboxAfterFail: inboxAfterFail.rows[0], inboxAfterRecover: inboxAfterRecover.rows[0], recovered: recoveredWhRes.json() })
    );

    // 5.3 Replay APENAS quando PROCESSED durável -> 200 duplicate:true (sem reexecutar apply_resend_webhook_event)
    const callsBeforeReplay = applySqlCallCount;
    clearResendWebhookReplayCache();
    const replayRes = await sendSignedWebhook(retrySvixId, 'email.delivered', 're_v242_msg_1');
    assert(
      replayRes.statusCode === 200 &&
        replayRes.json()?.duplicate === true &&
        replayRes.json()?.replayProtected === true &&
        applySqlCallCount === callsBeforeReplay,
      'Replay após confirmação durável PROCESSED retorna 200 { duplicate: true } sem mutar banco novamente'
    );

    // 5.4 Out-of-Order (email.delivery_delayed tardio após DELIVERED não rebaixa!) + demais eventos Resend:
    //     email.delivery_delayed -> DELAYED (msg_2), email.bounced -> BOUNCED (msg_2),
    //     email.complained -> COMPLAINED (msg_3), email.failed -> FAILED (msg_4)
    const lateDelayRes = await sendSignedWebhook('msg_v242_late_delay_1', 'email.delivery_delayed', 're_v242_msg_1');
    const delayedRes2 = await sendSignedWebhook('msg_v242_delay_2', 'email.delivery_delayed', 're_v242_msg_2');
    const bouncedRes2 = await sendSignedWebhook('msg_v242_bounce_2', 'email.bounced', 're_v242_msg_2');
    const complainedRes3 = await sendSignedWebhook('msg_v242_complain_3', 'email.complained', 're_v242_msg_3');
    const failedRes4 = await sendSignedWebhook('msg_v242_fail_4', 'email.failed', 're_v242_msg_4');

    const finalDeliveries = await db.query<{ provider_message_id: string; status: string }>(
      `SELECT provider_message_id, status FROM internal.briefing_email_deliveries ORDER BY provider_message_id ASC`
    );
    const statusByMsg = Object.fromEntries(finalDeliveries.rows.map((r) => [r.provider_message_id, r.status]));

    assert(
      lateDelayRes.statusCode === 200 &&
        lateDelayRes.json()?.reason === 'OUT_OF_ORDER_IGNORED' &&
        statusByMsg['re_v242_msg_1'] === 'DELIVERED' &&
        delayedRes2.statusCode === 200 &&
        bouncedRes2.statusCode === 200 &&
        statusByMsg['re_v242_msg_2'] === 'BOUNCED' &&
        complainedRes3.statusCode === 200 &&
        statusByMsg['re_v242_msg_3'] === 'COMPLAINED' &&
        failedRes4.statusCode === 200 &&
        statusByMsg['re_v242_msg_4'] === 'FAILED',
      'Homologação Resend valida email.delivered, delivery_delayed, bounced, complained, failed e proteção out-of-order',
      JSON.stringify({ lateDelay: lateDelayRes.json(), statusByMsg })
    );

    // -------------------------------------------------------------------------
    // BLOCO 6: RLS Isolado + Evidências Sanitizadas de Banco
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 6: RLS Estrito (authenticated) & Evidências Persistidas no PostgreSQL Isolado');

    const rlsCheck = await withPgTx(async (client) => {
      await client.query(`SET LOCAL ROLE authenticated`);
      await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [USER_A]);
      const aBriefings = await client.query<{ id: string; user_id: string }>(`SELECT id, user_id FROM public.briefings`);
      const aNotifs = await client.query<{ id: string; user_id: string }>(`SELECT id, user_id FROM public.notifications`);

      await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [USER_B]);
      const bBriefings = await client.query<{ id: string; user_id: string }>(`SELECT id, user_id FROM public.briefings`);
      const bNotifs = await client.query<{ id: string; user_id: string }>(`SELECT id, user_id FROM public.notifications`);

      let internalDenied = false;
      try {
        await client.query(`SELECT * FROM internal.resend_webhook_events LIMIT 1`);
      } catch {
        internalDenied = true;
      }

      return {
        aBriefingsAllOwn: aBriefings.rows.length >= 2 && aBriefings.rows.every((r: any) => r.user_id === USER_A),
        aNotifsAllOwn: aNotifs.rows.length >= 2 && aNotifs.rows.every((r: any) => r.user_id === USER_A),
        bBriefingsAllOwn: bBriefings.rows.length >= 2 && bBriefings.rows.every((r: any) => r.user_id === USER_B),
        bNotifsAllOwn: bNotifs.rows.length >= 2 && bNotifs.rows.every((r: any) => r.user_id === USER_B),
        internalDenied,
      };
    });

    assert(
      rlsCheck.aBriefingsAllOwn &&
        rlsCheck.aNotifsAllOwn &&
        rlsCheck.bBriefingsAllOwn &&
        rlsCheck.bNotifsAllOwn &&
        rlsCheck.internalDenied,
      'RLS isola briefings/notifications por auth.uid() e bloqueia schema internal para authenticated'
    );

    const briefingsEvidence = await db.query(
      `SELECT id, left(user_id::text, 8) AS user_prefix, type, local_date::text AS local_date, status, period_start, period_end
         FROM public.briefings ORDER BY created_at ASC`
    );
    const outboxEvidence = await db.query(
      `SELECT status, COUNT(*)::int AS cnt FROM internal.notification_outbox GROUP BY status ORDER BY status ASC`
    );
    const webhookInboxEvidence = await db.query(
      `SELECT svix_id, event_type, status, attempt_count, delivery_status, reason
         FROM internal.resend_webhook_events ORDER BY created_at ASC`
    );
    const notificationsEvidence = await db.query(
      `SELECT left(user_id::text, 8) AS user_prefix, type, category, event_revision, left(title, 42) AS title_preview,
              body IS NOT NULL AS has_body, subtitle IS NOT NULL AS has_subtitle
         FROM public.notifications ORDER BY created_at ASC LIMIT 12`
    );

    console.log('\n📄 Evidência — public.briefings:', JSON.stringify(briefingsEvidence.rows, null, 2));
    console.log('📄 Evidência — internal.notification_outbox:', JSON.stringify(outboxEvidence.rows, null, 2));
    console.log('📄 Evidência — internal.briefing_email_deliveries:', JSON.stringify(statusByMsg, null, 2));
    console.log('📄 Evidência — internal.resend_webhook_events:', JSON.stringify(webhookInboxEvidence.rows, null, 2));
    console.log('📄 Evidência — public.notifications (amostra):', JSON.stringify(notificationsEvidence.rows, null, 2));

    assert(
      briefingsEvidence.rows.length === 4 &&
        notificationsEvidence.rows.length >= 6 &&
        notificationsEvidence.rows.every((r: any) => r.has_body === true),
      'Evidências persistidas completas confirmadas em todas as tabelas auditadas'
    );
  } finally {
    setIngestionEngineTestDeps(null);
    setNotificationOutboxTestDeps(null);
    setNotificationEngineTestDeps(null);
    setBriefingEngineTestDeps(null);
    setResendWebhookTestDeps(null);
    setDistributedLockTestDeps(null);
    clearResendWebhookReplayCache();

    if (savedEnv.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedEnv.RESEND_API_KEY;

    if (savedEnv.RESEND_FROM_EMAIL === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = savedEnv.RESEND_FROM_EMAIL;

    if (savedEnv.RESEND_WEBHOOK_SECRET === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = savedEnv.RESEND_WEBHOOK_SECRET;

    if (savedEnv.CRON_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedEnv.CRON_SECRET;

    await db.close();
  }

  console.log('\n==============================================================================');
  console.log(`📊 RESULTADO FINAL V2.4.2: ${passed} passaram, ${failed} falharam.`);
  console.log('==============================================================================');
  if (failed > 0) process.exit(1);
}

runV242HomologationSuite().catch((err) => {
  console.error('Erro fatal na suíte V2.4.2:', err);
  process.exit(1);
});
