/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.4.2 — SUÍTE DE HOMOLOGAÇÃO FINAL DE BRIEFINGS & NOTIFICAÇÕES (100% ISOLADA)
 *
 * Valida em PostgreSQL real embarcado (PGlite) + migrações reais V2.3.1..V2.4.1 sem chamadas externas:
 * 1. Associação determinística de entidades (catálogo realista de 8 entidades, dry-run -> apply -> idempotência).
 * 2. Transactional Outbox Atômica na Ingestão + Rollback se Outbox falhar + Catch-up idempotente.
 * 3. Contrato oficial Svix em /api/resend/webhook, erros recuperáveis (HTTP 503), retentativas e anti-replay.
 * 4. Geração de Briefings (MORNING/EVENING), Outbox -> Notificações segmentadas, RLS estrito e evidências sanitizadas.
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
import { briefingEngine, setBriefingEngineTestDeps } from '../api/_lib/briefingEngine.js';
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
import { setDistributedLockTestDeps } from '../api/_lib/distributedLock.js';

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
  console.log('🛡️  FATOSBR V2.4.2 — HOMOLOGAÇÃO FINAL DE BRIEFINGS & NOTIFICAÇÕES (ISOLADA)');
  console.log('==============================================================================\n');

  const db = await setupIsolatedDatabase();
  const sbAdapter = createPgSupabaseAdapter(db);

  const USER_A = '11111111-1111-4111-8111-111111111111';
  const USER_B = '22222222-2222-4222-8222-222222222222';
  const rawWhSecretB64 = Buffer.from('fatosbr_v242_webhook_test_key_32b').toString('base64');
  const testWebhookSecret = `whsec_${rawWhSecretB64}`;

  const savedEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  };

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

    // Confere bugs corrigidos diretamente no matcher:
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

    // Backfill DRY-RUN
    const emptyBefore = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM public.event_entities`);
    const dryRunRes = await backfillEventEntities({
      queryFn: (sql, params) => db.query(sql, params),
      batchSize: 2,
      limit: 100,
      dryRun: true,
      onlyMissing: true,
    });
    const emptyAfterDry = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM public.event_entities`);

    assert(
      emptyBefore.rows[0].cnt === 0 &&
        emptyAfterDry.rows[0].cnt === 0 &&
        dryRunRes.dryRun === true &&
        dryRunRes.scanned === 6 &&
        dryRunRes.eventsWithMatches === 5 &&
        dryRunRes.linksPlanned === 8 &&
        dryRunRes.linksInserted === 0 &&
        dryRunRes.matchesPreview.length === 5,
      'Backfill dry-run identifica exatamente 8 vínculos em 5 acontecimentos reais sem gravar nem inventar entidades',
      JSON.stringify({ dryRunRes })
    );

    // Backfill APPLY + Idempotência
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
    const entityCountAfter = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM public.entities`);
    const linksAfterApply = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM public.event_entities`);
    const negEvtLinks = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.event_entities WHERE event_id = 'hist-evt-neg'`
    );

    assert(
      applyRes.linksInserted === 8 &&
        reApplyRes.linksInserted === 0 &&
        linksAfterApply.rows[0].cnt === 8 &&
        entityCountAfter.rows[0].cnt === 8 &&
        negEvtLinks.rows[0].cnt === 0,
      'Backfill apply persiste 8 vínculos reais em public.event_entities, mantém 8 entidades originais e 2ª execução é idempotente',
      JSON.stringify({ applyRes, reApplyRes, links: linksAfterApply.rows[0].cnt })
    );

    // -------------------------------------------------------------------------
    // BLOCO 2: Transactional Outbox na Ingestão (Atomicidade, Rollback e Recovery)
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 2: Transactional Outbox Atômica na Ingestão, Rollback e Recovery');

    // Simula outbox para os eventos históricos ainda sem outbox via recoverMissingNotificationOutbox
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
      'recoverMissingNotificationOutbox recupera acontecimentos legados sem outbox de forma 100% idempotente',
      JSON.stringify({ firstRecover, secondRecover })
    );

    // Teste de atomicidade: falha na gravação da outbox dentro de runServerSideIngestion -> ROLLBACK completo do acontecimento
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
    const outboxBeforeFail = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM internal.notification_outbox`
    );

    const failedIngestRes = await runServerSideIngestion({ keywords: ['petrobras'] });
    const eventsAfterFail = await db.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM public.events`);
    const articlesAfterFail = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.articles WHERE canonical_url = 'https://g1.globo.com/economia/petrobras-refino-rollback'`
    );
    const outboxAfterFail = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM internal.notification_outbox`
    );

    assert(
      failedIngestRes.success === false &&
        String(failedIngestRes.error || '').includes('OUTBOX_ATOMIC_ENQUEUE_FAILED') &&
        eventsAfterFail.rows[0].cnt === eventsBeforeFail.rows[0].cnt &&
        articlesAfterFail.rows[0].cnt === 0 &&
        outboxAfterFail.rows[0].cnt === outboxBeforeFail.rows[0].cnt,
      'Falha na gravação da outbox faz rollback atômico de public.events e public.articles (zero eventos órfãos sem alerta)',
      JSON.stringify({
        failedIngestRes,
        eventsBefore: eventsBeforeFail.rows[0].cnt,
        eventsAfter: eventsAfterFail.rows[0].cnt,
      })
    );

    // Agora executa ingestão com outbox atômica saudável + re-execução idempotente
    setIngestionEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      withTransaction: withPgTx,
      fetchUpstreamFn: async () => ({
        articles: [
          {
            title: 'Petrobras anuncia plano recorde de refino em conjunto com B3',
            url: 'https://g1.globo.com/economia/petrobras-b3-plano',
            canonicalUrl: 'https://g1.globo.com/economia/petrobras-b3-plano',
            description: 'Investidores repercutem o anúncio na B3.',
            sourceName: 'G1',
            domain: 'g1.globo.com',
            publishedAt: refMondayMorning.toISOString(),
            category: 'Empresas',
            topicSlug: 'empresas',
          },
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
      }),
      enqueueOutboxFn: enqueueNotificationOutbox,
    });

    const okIngest1 = await runServerSideIngestion({ keywords: ['petrobras'] });
    const okIngest2 = await runServerSideIngestion({ keywords: ['petrobras'] });
    const outboxTotalAfterOk = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM internal.notification_outbox`
    );

    assert(
      okIngest1.success === true &&
        okIngest1.eventsCreated === 1 &&
        okIngest1.outboxEnqueued === 1 &&
        (okIngest1.entityLinksCreated || 0) >= 2 &&
        okIngest2.success === true &&
        outboxTotalAfterOk.rows[0].cnt === outboxBeforeFail.rows[0].cnt + 1,
      'Ingestão grava acontecimentos, event_entities e internal.notification_outbox na mesma transação atômica com idempotência',
      JSON.stringify({ okIngest1, okIngest2, outboxCount: outboxTotalAfterOk.rows[0].cnt })
    );

    // -------------------------------------------------------------------------
    // BLOCO 3: Webhook Resend (Contrato Svix Estrito, Erro 503 Retryável & Anti-Replay)
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 3: /api/resend/webhook — Contrato Oficial Svix, 503 Recuperável e Anti-Replay');
    clearResendWebhookReplayCache();

    // 3.1 Sem RESEND_WEBHOOK_SECRET -> 503 (sem inventar segredo)
    delete process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_FROM_EMAIL = DEFAULT_VERIFIED_RESEND_FROM;
    delete process.env.RESEND_API_KEY;

    const statusResNoKey = createMockRes();
    await resendStatusHandler({ method: 'GET', headers: {} }, statusResNoKey);
    assert(
      statusResNoKey.statusCode === 200 &&
        statusResNoKey.json()?.provider === 'Resend' &&
        statusResNoKey.json()?.sender === DEFAULT_VERIFIED_RESEND_FROM &&
        statusResNoKey.json()?.webhookConfigured === false,
      'GET /api/resend/status reporta sender configurado e webhookConfigured=false sem RESEND_WEBHOOK_SECRET'
    );

    const noSecretWhRes = createMockRes();
    await resendWebhookHandler(
      {
        method: 'POST',
        headers: { 'svix-id': 'msg_no_sec', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,abc' },
        rawBody: JSON.stringify({ type: 'email.delivered', data: { email_id: 're_any' } }),
      },
      noSecretWhRes
    );
    assert(
      noSecretWhRes.statusCode === 503 && noSecretWhRes.json()?.error === 'RESEND_WEBHOOK_SECRET_UNCONFIGURED',
      'POST /api/resend/webhook sem RESEND_WEBHOOK_SECRET retorna HTTP 503'
    );

    process.env.RESEND_WEBHOOK_SECRET = testWebhookSecret;
    process.env.RESEND_API_KEY = 're_test_v242_isolated_no_network';

    const nowSec = Math.floor(Date.now() / 1000);
    const sigKey = Buffer.from(rawWhSecretB64, 'base64');
    const signSvix = (id: string, ts: string, body: string) =>
      `v1,${crypto.createHmac('sha256', sigKey).update(`${id}.${ts}.${body}`).digest('base64')}`;

    const samplePayload = JSON.stringify({
      id: 'evt_svix_test',
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: { email_id: 're_v242_msg_1' },
    });

    // Rejeições estritas do contrato Svix:
    const expiredSig = verifyResendWebhookSignature({
      rawBody: samplePayload,
      headers: {
        'svix-id': 'msg_exp',
        'svix-timestamp': String(nowSec - 305),
        'svix-signature': signSvix('msg_exp', String(nowSec - 305), samplePayload),
      },
      secret: testWebhookSecret,
      nowMs: nowSec * 1000,
    });
    const futureSig = verifyResendWebhookSignature({
      rawBody: samplePayload,
      headers: {
        'svix-id': 'msg_fut',
        'svix-timestamp': String(nowSec + 305),
        'svix-signature': signSvix('msg_fut', String(nowSec + 305), samplePayload),
      },
      secret: testWebhookSecret,
      nowMs: nowSec * 1000,
    });
    const decimalTsSig = verifyResendWebhookSignature({
      rawBody: samplePayload,
      headers: {
        'svix-id': 'msg_dec',
        'svix-timestamp': `${nowSec}.5`,
        'svix-signature': signSvix('msg_dec', `${nowSec}.5`, samplePayload),
      },
      secret: testWebhookSecret,
      nowMs: nowSec * 1000,
    });
    const aliasHeaderSig = verifyResendWebhookSignature({
      rawBody: samplePayload,
      headers: {
        'webhook-id': 'msg_alias',
        'webhook-timestamp': String(nowSec),
        'webhook-signature': signSvix('msg_alias', String(nowSec), samplePayload),
      },
      secret: testWebhookSecret,
      nowMs: nowSec * 1000,
    });
    const legacyDirectSig = verifyResendWebhookSignature({
      rawBody: samplePayload,
      headers: {
        'x-resend-signature': `sha256=${crypto.createHmac('sha256', testWebhookSecret).update(samplePayload).digest('hex')}`,
      },
      secret: testWebhookSecret,
      nowMs: nowSec * 1000,
    });

    assert(
      !expiredSig.valid &&
        !futureSig.valid &&
        !decimalTsSig.valid &&
        !aliasHeaderSig.valid &&
        !legacyDirectSig.valid,
      'Contrato oficial Svix rejeita timestamp expirado/futuro/decimal, aliases webhook-* e fallback x-resend-signature',
      JSON.stringify({ expiredSig, futureSig, decimalTsSig, aliasHeaderSig, legacyDirectSig })
    );

    // Prepara registro ACCEPTED em internal.briefing_email_deliveries via briefingEngine (fetch mockado)
    await db.query(
      `INSERT INTO public.user_preferences (id, email_morning_briefing, email_evening_briefing, email_breaking_alerts, briefing_email, weekend_edition, timezone, morning_time, evening_time)
       VALUES
         ($1, true, true, true, 'usuario.a@fatosbr.local', true, 'America/Sao_Paulo', '07:00', '20:00'),
         ($2, true, true, true, 'usuario.b@fatosbr.local', true, 'America/Sao_Paulo', '07:00', '20:00')`,
      [USER_A, USER_B]
    );
    await db.query(
      `INSERT INTO public.user_settings (user_id, email_morning_briefing, email_evening_briefing, email_breaking_alerts, timezone, notification_settings)
       VALUES
         ($1, true, true, true, 'America/Sao_Paulo', '{"urgentEvents":true,"entityUpdates":true,"onlyHighRelevance":false,"dailyBriefings":true}'::jsonb),
         ($2, true, true, true, 'America/Sao_Paulo', '{"urgentEvents":true,"entityUpdates":true,"onlyHighRelevance":false,"dailyBriefings":true}'::jsonb)`,
      [USER_A, USER_B]
    );
    await db.query(
      `INSERT INTO public.user_entity_follows (user_id, entity_id) VALUES
        ($1, 'ent-petro'),
        ($1, 'ent-bc'),
        ($2, 'ent-vale')`,
      [USER_A, USER_B]
    );

    let resendMockSendCount = 0;
    setNotificationEngineTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
    });
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

    const morningA = await briefingEngine.generateForUser({
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
    // Evento noturno para EVENING briefing (20:30 UTC / 17:30 BRT)
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

    assert(
      morningA.status === 'SENT' &&
        morningB.status === 'SENT' &&
        eveningA.status === 'SENT' &&
        resendMockSendCount === 3,
      'Motor de Briefings gera e persiste MORNING e EVENING para múltiplos usuários usando fetch mockado (sem e-mails reais)',
      JSON.stringify({ morningA, morningB, eveningA, resendMockSendCount })
    );

    // Simula falha de persistência durante webhook -> DEVE retornar HTTP 503 (e NÃO 200) e permitir retry com mesmo svix-id!
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
    const retryTs = String(Math.floor(Date.now() / 1000));
    const retryBody = JSON.stringify({
      id: 'evt_v242_retry_1',
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: { email_id: 're_v242_msg_1' },
    });
    const retryHeaders = {
      'svix-id': retrySvixId,
      'svix-timestamp': retryTs,
      'svix-signature': signSvix(retrySvixId, retryTs, retryBody),
    };

    const failWhRes = createMockRes();
    await resendWebhookHandler({ method: 'POST', headers: retryHeaders, rawBody: retryBody }, failWhRes);

    const statusBeforeRetry = await db.query<any>(
      `SELECT status FROM internal.briefing_email_deliveries WHERE provider_message_id = 're_v242_msg_1'`
    );

    assert(
      failWhRes.statusCode === 503 &&
        failWhRes.json()?.retryable === true &&
        failWhRes.json()?.error === 'WEBHOOK_PERSISTENCE_RETRYABLE' &&
        statusBeforeRetry.rows[0]?.status === 'ACCEPTED',
      'POST /api/resend/webhook retorna HTTP 503 recuperável quando persistência falha (nunca retorna 200 falso)',
      JSON.stringify({ statusCode: failWhRes.statusCode, json: failWhRes.json(), row: statusBeforeRetry.rows[0] })
    );

    // Agora banco se recupera e Resend retenta exatamente o mesmo svix-id:
    simulateApplyFailure = false;
    const recoveredWhRes = createMockRes();
    await resendWebhookHandler({ method: 'POST', headers: retryHeaders, rawBody: retryBody }, recoveredWhRes);
    const statusAfterRetry = await db.query<any>(
      `SELECT status, webhook_event_type, webhook_payload FROM internal.briefing_email_deliveries WHERE provider_message_id = 're_v242_msg_1'`
    );

    assert(
      recoveredWhRes.statusCode === 200 &&
        recoveredWhRes.json()?.duplicate === false &&
        recoveredWhRes.json()?.deliveryUpdated === true &&
        statusAfterRetry.rows[0]?.status === 'DELIVERED' &&
        statusAfterRetry.rows[0]?.webhook_payload?.svix_id === retrySvixId,
      'Retentativa do webhook com mesmo svix-id após 503 persiste ACCEPTED -> DELIVERED com sucesso',
      JSON.stringify({ json: recoveredWhRes.json(), row: statusAfterRetry.rows[0] })
    );

    // Anti-replay: reenvio em memória warm E após limpar cache em memória (anti-replay persistente distribuído!)
    const callsBeforeReplay = applySqlCallCount;
    const warmReplayRes = createMockRes();
    await resendWebhookHandler({ method: 'POST', headers: retryHeaders, rawBody: retryBody }, warmReplayRes);

    clearResendWebhookReplayCache();
    const coldReplayRes = createMockRes();
    await resendWebhookHandler({ method: 'POST', headers: retryHeaders, rawBody: retryBody }, coldReplayRes);

    assert(
      warmReplayRes.statusCode === 200 &&
        warmReplayRes.json()?.duplicate === true &&
        warmReplayRes.json()?.replayProtected === true &&
        coldReplayRes.statusCode === 200 &&
        coldReplayRes.json()?.duplicate === true &&
        coldReplayRes.json()?.replayProtected === true &&
        applySqlCallCount === callsBeforeReplay,
      'Anti-replay bloqueia reprocessamento duplicado (warm e cold start distribuído) sem mutar banco novamente',
      JSON.stringify({ warm: warmReplayRes.json(), cold: coldReplayRes.json(), callsBeforeReplay, applySqlCallCount })
    );

    // -------------------------------------------------------------------------
    // BLOCO 4: Outbox -> Notificações Segmentadas, RLS Estrito e Evidências Reais
    // -------------------------------------------------------------------------
    console.log('\n📋 Bloco 4: Worker Outbox, Notificações Segmentadas, Isolamento RLS & Evidências');

    setNotificationOutboxTestDeps({
      isPostgresConfigured: () => true,
      executeSql: (sql, params) => db.query(sql, params),
      getServerSupabase: () => sbAdapter as any,
      dispatchFn: notificationEngine.dispatchSegmentedNotificationsForEvent.bind(notificationEngine),
    });

    const outboxBatch = await processNotificationOutboxBatch({ limit: 50 });
    const outboxStats = await getNotificationOutboxStats();
    const userBReceivedPetro = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.notifications n
        JOIN public.events e ON e.id = n.event_id
        WHERE n.user_id = $1 AND e.title ILIKE '%Petrobras%' AND n.type <> 'BRIEFING_READY'`,
      [USER_B]
    );
    const userAReceivedPetro = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM public.notifications n
        JOIN public.events e ON e.id = n.event_id
        WHERE n.user_id = $1 AND e.title ILIKE '%Petrobras%' AND n.type <> 'BRIEFING_READY'`,
      [USER_A]
    );

    assert(
      outboxBatch.completed >= 6 &&
        outboxStats.completed >= 6 &&
        userAReceivedPetro.rows[0].cnt >= 1 &&
        userBReceivedPetro.rows[0].cnt === 0,
      'Worker da Outbox materializa notificações segmentadas em public.notifications apenas para usuários elegíveis',
      JSON.stringify({ outboxBatch, outboxStats, userAReceivedPetro: userAReceivedPetro.rows[0], userBReceivedPetro: userBReceivedPetro.rows[0] })
    );

    // Teste real de RLS com SET LOCAL ROLE authenticated e auth.uid() para USER_A e USER_B
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
        await client.query(`SELECT * FROM internal.notification_outbox LIMIT 1`);
      } catch {
        internalDenied = true;
      }

      return {
        aBriefingsAllOwn: aBriefings.rows.length >= 2 && aBriefings.rows.every((r: any) => r.user_id === USER_A),
        aNotifsAllOwn: aNotifs.rows.length >= 2 && aNotifs.rows.every((r: any) => r.user_id === USER_A),
        bBriefingsAllOwn: bBriefings.rows.length >= 1 && bBriefings.rows.every((r: any) => r.user_id === USER_B),
        bNotifsAllOwn: bNotifs.rows.length >= 1 && bNotifs.rows.every((r: any) => r.user_id === USER_B),
        internalDenied,
      };
    });

    assert(
      rlsCheck.aBriefingsAllOwn &&
        rlsCheck.aNotifsAllOwn &&
        rlsCheck.bBriefingsAllOwn &&
        rlsCheck.bNotifsAllOwn &&
        rlsCheck.internalDenied,
      'RLS isola briefings/notifications por auth.uid() entre USER_A e USER_B e nega acesso de authenticated ao schema internal',
      JSON.stringify(rlsCheck)
    );

    // Evidências reais sanitizadas persistidas no PostgreSQL isolado
    const briefingsEvidence = await db.query(
      `SELECT id, left(user_id::text, 8) AS user_prefix, type, local_date::text AS local_date, status, period_start, period_end
         FROM public.briefings
        ORDER BY created_at ASC`
    );
    const briefingItemsEvidence = await db.query(
      `SELECT left(briefing_id::text, 8) AS briefing_prefix, event_id, section, position
         FROM public.briefing_items
        ORDER BY briefing_id, position ASC`
    );
    const notificationsEvidence = await db.query(
      `SELECT id, left(user_id::text, 8) AS user_prefix, type, left(title, 52) AS title_preview,
              subtitle IS NOT NULL AS has_subtitle, body IS NOT NULL AS has_body, read, read_at IS NOT NULL AS has_read_at
         FROM public.notifications
        ORDER BY created_at ASC
        LIMIT 12`
    );
    const deliveriesEvidence = await db.query(
      `SELECT left(briefing_id::text, 8) AS briefing_prefix, edition_type, status, provider_message_id, from_email, webhook_event_type
         FROM internal.briefing_email_deliveries
        ORDER BY created_at ASC`
    );

    console.log('\n📄 Evidência — public.briefings:', JSON.stringify(briefingsEvidence.rows, null, 2));
    console.log('📄 Evidência — public.briefing_items (amostra):', JSON.stringify(briefingItemsEvidence.rows.slice(0, 8), null, 2));
    console.log('📄 Evidência — public.notifications (amostra):', JSON.stringify(notificationsEvidence.rows, null, 2));
    console.log('📄 Evidência — internal.briefing_email_deliveries:', JSON.stringify(deliveriesEvidence.rows, null, 2));

    assert(
      briefingsEvidence.rows.length === 3 &&
        briefingItemsEvidence.rows.length >= 6 &&
        notificationsEvidence.rows.length >= 4 &&
        notificationsEvidence.rows.every((r: any) => r.has_body === true),
      'Evidências persistidas de briefings, briefing_items, notifications (body NOT NULL) e briefing_email_deliveries confirmadas'
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
