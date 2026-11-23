/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR — SUÍTE DE VALIDAÇÃO DE PERFORMANCE EXTREMA (100% ISOLADA)
 *
 * Valida todas as otimizações implementadas sem depender de produção:
 * 1. Request deduplication (dedupInFlight) e SWR cache (swrFetch + invalidateRequestCache)
 * 2. Timeout (AbortController) + retry com backoff em fetchWithTimeoutAndRetry
 * 3. Mutação otimista com rollback automático em runOptimisticMutation
 * 4. Streaming SSE + fallback JSON em aiSummarizerService.streamNvidiaNemotron
 * 5. Monitor RUM (performanceMonitor) sem PII e POST /api/proxy/perf (202 Accepted)
 * 6. Paginação real (limit, offset, hasMore) em /api/proxy/events contra PGlite
 * 7. Eliminação de N+1 no briefingEngine via prefetchEventPool (O(1) event queries para N usuários)
 * 8. Migração 20261123000002_perf_indexes_composite_hot_paths.sql + EXPLAIN + rollback no PGlite
 * 9. Limite estrito de <= 8 Serverless Functions na Vercel (api/) e headers de cache em vercel.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

import {
  dedupInFlight,
  swrFetch,
  invalidateRequestCache,
  fetchWithTimeoutAndRetry,
} from '../src/services/requestCache.js';
import { runOptimisticMutation } from '../src/utils/optimisticToggle.js';
import { aiSummarizerService } from '../src/services/aiSummarizerService.js';
import { performanceMonitor } from '../src/services/performanceMonitor.js';
import { setTestPostgresPool } from '../api/_lib/postgres.js';
import eventsProxyHandler from '../api/_lib/handlers/proxy/events.js';
import proxyRouterHandler from '../api/proxy/[...action].js';
import { briefingEngine, setBriefingEngineTestDeps } from '../api/_lib/briefingEngine.js';
import { setNotificationEngineTestDeps } from '../api/_lib/notificationEngine.js';
import { userService, setTestUserServiceClient } from '../src/services/userService.js';
import { optimizeExternalImageUrl } from '../src/utils/imageOptimize.js';
import { computeVirtualWindow } from '../src/components/VirtualizedList.js';

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

async function runTests() {
  console.log('\n=== FATOSBR — TESTES DE OTIMIZAÇÃO DE PERFORMANCE ===\n');
  process.env.FATOSBR_TEST_MODE = 'true';

  // ---------------------------------------------------------------------------
  // 1. dedupInFlight & swrFetch & invalidateRequestCache
  // ---------------------------------------------------------------------------
  console.log('1. Deduplicação in-flight & SWR Cache');
  {
    let execCount = 0;
    const fn = async () => {
      execCount++;
      await new Promise((r) => setTimeout(r, 25));
      return { ok: true, seq: execCount };
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => dedupInFlight('test:dedup:1', fn))
    );
    assert(execCount === 1, '10 chamadas concorrentes dedupInFlight executam apenas 1 vez', `execCount=${execCount}`);
    assert(results.every((r) => r.seq === 1), 'Todas as 10 promessas recebem o mesmo resultado');

    invalidateRequestCache('test:swr:');
    let swrCalls = 0;
    const swrFn = async () => {
      swrCalls++;
      return `val-${swrCalls}`;
    };

    const v1 = await swrFetch('test:swr:k1', 5000, swrFn);
    const v2 = await swrFetch('test:swr:k1', 5000, swrFn);
    assert(v1 === 'val-1' && v2 === 'val-1' && swrCalls === 1, 'swrFetch retorna hit em memória dentro do TTL');

    let revalidatedVal = '';
    const vStale = await swrFetch('test:swr:k1', 0, swrFn, {
      forceRefresh: false,
      onRevalidate: (fresh) => {
        revalidatedVal = fresh;
      },
    });
    // Com ttlMs original = 5000, ainda está fresco; testemos expiração forçando outro chave com ttl=1ms
    await swrFetch('test:swr:k2', 1, swrFn);
    await new Promise((r) => setTimeout(r, 15));
    const staleHit = await swrFetch('test:swr:k2', 1, swrFn, {
      onRevalidate: (fresh) => {
        revalidatedVal = fresh;
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    assert(staleHit === 'val-2', 'swrFetch expirado retorna valor stale imediato', `staleHit=${staleHit}, vStale=${vStale}`);
    assert(revalidatedVal === 'val-3', 'swrFetch revalida em segundo plano via onRevalidate', `revalidatedVal=${revalidatedVal}`);

    invalidateRequestCache('test:swr:');
    const afterInv = await swrFetch('test:swr:k1', 5000, swrFn);
    assert(afterInv === 'val-4', 'invalidateRequestCache limpa prefixo corretamente');
  }

  // ---------------------------------------------------------------------------
  // 2. fetchWithTimeoutAndRetry
  // ---------------------------------------------------------------------------
  console.log('\n2. fetchWithTimeoutAndRetry (Timeout AbortController & Transient Retry)');
  {
    const origFetch = globalThis.fetch;
    try {
      let attempt = 0;
      globalThis.fetch = (async () => {
        attempt++;
        if (attempt === 1) {
          return new Response(JSON.stringify({ err: 'unavailable' }), { status: 503 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as any;

      const res = await fetchWithTimeoutAndRetry('https://example.test/api', {
        retries: 1,
        retryDelayMs: 10,
        timeoutMs: 2000,
      });
      assert(attempt === 2 && res.status === 200, 'fetchWithTimeoutAndRetry retenta HTTP 503 e resolve 200');

      globalThis.fetch = ((_url: any, init: any) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            (err as any).name = 'AbortError';
            reject(err);
          });
        });
      }) as any;

      let timedOut = false;
      try {
        await fetchWithTimeoutAndRetry('https://example.test/slow', {
          retries: 0,
          timeoutMs: 30,
        });
      } catch (e: any) {
        timedOut = String(e?.message || '').includes('timeout');
      }
      assert(timedOut, 'fetchWithTimeoutAndRetry aborta requisição lenta por AbortController');
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. runOptimisticMutation (Optimistic UI + Rollback automático)
  // ---------------------------------------------------------------------------
  console.log('\n3. Mutação Otimista com Rollback Automático');
  {
    const states: boolean[] = [];
    let current = false;
    let rolledBack = false;

    const okRes = await runOptimisticMutation({
      previousState: current,
      applyOptimistic: (next) => {
        current = next;
        states.push(next);
      },
      persist: async () => true,
      onRollback: () => {
        rolledBack = true;
      },
    });
    assert(okRes.ok && current === true && !rolledBack, 'Mutação otimista bem-sucedida mantém novo estado imediato');

    const failRes = await runOptimisticMutation({
      previousState: current,
      applyOptimistic: (next) => {
        current = next;
        states.push(next);
      },
      persist: async () => {
        throw new Error('DB_ERROR');
      },
      onRollback: () => {
        rolledBack = true;
      },
    });
    assert(!failRes.ok && current === true && rolledBack, 'Falha na persistência reverte estado e aciona onRollback');
    assert(states.join(',') === 'true,false,true', 'Ordem exata de transições otimistas + rollback', states.join(','));
  }

  // ---------------------------------------------------------------------------
  // 4. Streaming SSE NVIDIA NIM + Fallback JSON
  // ---------------------------------------------------------------------------
  console.log('\n4. Streaming SSE NVIDIA NIM e Fallback JSON');
  {
    const origFetch = globalThis.fetch;
    try {
      const encoder = new TextEncoder();
      const sseStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Olá "}}]}\n\n'));
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"FatosBR"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      globalThis.fetch = (async () =>
        new Response(sseStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        })) as any;

      const deltas: string[] = [];
      const streamed = await aiSummarizerService.streamNvidiaNemotron(
        'Teste SSE',
        (d) => deltas.push(d)
      );
      assert(streamed.content === 'Olá FatosBR' && deltas.length === 2, 'streamNvidiaNemotron acumula chunks SSE progressivamente');

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'Resposta JSON única' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )) as any;

      let fallbackChunk = '';
      const fallbackRes = await aiSummarizerService.streamNvidiaNemotron(
        'Teste Fallback',
        (_d, acc) => {
          fallbackChunk = acc;
        }
      );
      assert(fallbackRes.content === 'Resposta JSON única' && fallbackChunk === 'Resposta JSON única', 'streamNvidiaNemotron faz fallback limpo para JSON');
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. performanceMonitor RUM & /api/proxy/perf (zero PII, 202 Accepted)
  // ---------------------------------------------------------------------------
  console.log('\n5. RUM performanceMonitor & endpoint /api/proxy/perf');
  {
    performanceMonitor.trackApiCall('/api/proxy/events?token=secret123&email=user@test.com', 142.7, 200);
    const snap = performanceMonitor.getSnapshot();
    const lastTiming = snap.apiTimings[snap.apiTimings.length - 1];
    assert(
      lastTiming?.route === '/api/proxy/events' && !JSON.stringify(snap).includes('secret123') && !JSON.stringify(snap).includes('user@test.com'),
      'performanceMonitor remove query string / PII das rotas rastreadas'
    );

    const reqPost: any = {
      method: 'POST',
      url: '/api/proxy/perf',
      headers: { host: 'localhost:3000' },
      body: {
        lcpMs: 1450.25,
        inpMs: 85,
        cls: 0.02,
        ttfbMs: 210,
        feedLoadMs: 390,
        deviceTier: 'high',
        effectiveType: '4g',
        jsErrors: 0,
        apiCount: 3,
        path: '/feed?email=vazamento@test.com',
        extraSecret: 'nao-deve-persistir',
      },
    };
    const resPost = createMockRes();
    await proxyRouterHandler(reqPost, resPost);
    assert(
      resPost.statusCode === 202 && resPost.json()?.accepted === true,
      'POST /api/proxy/perf retorna HTTP 202 { accepted: true } com feedLoadMs/deviceTier/effectiveType',
      `status=${resPost.statusCode} body=${resPost.body}`
    );

    performanceMonitor.markFeedLoaded(321.4);
    assert(
      performanceMonitor.getSnapshot().feedLoadMs === 321,
      'performanceMonitor.markFeedLoaded registra feedLoadMs arredondado sem PII'
    );

    const reqGet: any = { method: 'GET', url: '/api/proxy/perf', headers: { host: 'localhost:3000' } };
    const resGet = createMockRes();
    await proxyRouterHandler(reqGet, resGet);
    assert(resGet.statusCode === 405, 'GET /api/proxy/perf retorna HTTP 405', `status=${resGet.statusCode} body=${resGet.body}`);
  }

  // ---------------------------------------------------------------------------
  // 6 & 8. PGlite: Paginação /api/proxy/events + Migração de Índices + EXPLAIN + Rollback
  // ---------------------------------------------------------------------------
  console.log('\n6 & 8. PGlite: Paginação /api/proxy/events + Índices Compostos + EXPLAIN + Rollback');
  {
    const db = new PGlite();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS public.events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT,
        summary TEXT,
        why_it_matters TEXT,
        relevance_score INTEGER DEFAULT 75,
        article_count INTEGER DEFAULT 1,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS public.news_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT,
        domain TEXT,
        category TEXT,
        logo_url TEXT,
        brand_color TEXT
      );
      CREATE TABLE IF NOT EXISTS public.articles (
        id TEXT PRIMARY KEY,
        source_id TEXT,
        title TEXT,
        url TEXT,
        canonical_url TEXT,
        description TEXT,
        published_at TIMESTAMPTZ,
        image_url TEXT
      );
      CREATE TABLE IF NOT EXISTS public.event_articles (
        event_id TEXT NOT NULL,
        article_id TEXT NOT NULL,
        is_primary BOOLEAN DEFAULT FALSE
      );
      CREATE TABLE IF NOT EXISTS public.topics (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS public.event_topics (
        event_id TEXT NOT NULL,
        topic_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS public.entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT,
        type TEXT,
        description TEXT,
        sector TEXT,
        role TEXT,
        organization TEXT,
        website TEXT,
        image_url TEXT,
        logo_url TEXT,
        avatar_url TEXT,
        brand_color TEXT
      );
      CREATE TABLE IF NOT EXISTS public.event_entities (
        event_id TEXT NOT NULL,
        entity_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS public.user_saved_events (
        user_id TEXT NOT NULL,
        event_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS public.user_entity_follows (
        user_id TEXT NOT NULL,
        entity_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS public.user_topic_follows (
        user_id TEXT NOT NULL,
        topic_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS public.user_source_follows (
        user_id TEXT NOT NULL,
        source_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS public.briefings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS public.notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Popula massa sintética para paginação e plano de execução real no PostgreSQL
    await db.exec(`
      INSERT INTO public.events (id, title, slug, summary, relevance_score, published_at)
      SELECT
        'evt-' || g,
        'Acontecimento ' || g,
        'acontecimento-' || g,
        'Resumo ' || g,
        50 + (g % 50),
        NOW() - (g || ' minutes')::interval
      FROM generate_series(1, 300) AS g;

      INSERT INTO public.notifications (id, user_id, read, created_at)
      SELECT
        'notif-' || g,
        CASE WHEN g <= 10 THEN 'user-target' ELSE 'user-' || (g % 40) END,
        (g % 2 = 0),
        NOW() - (g || ' minutes')::interval
      FROM generate_series(1, 400) AS g;
    `);

    // Adapter Pool compatível com api/_lib/postgres.ts
    const fakePool = {
      connect: async () => ({
        query: async (sql: string, params: any[]) => db.query(sql, params),
        release: () => {},
      }),
    };
    setTestPostgresPool(fakePool);

    try {
      const page1Res = createMockRes();
      await eventsProxyHandler({ method: 'GET', url: '/api/proxy/events?limit=12&offset=0', headers: {} }, page1Res);
      const p1 = page1Res.json();

      const page2Res = createMockRes();
      await eventsProxyHandler({ method: 'GET', url: '/api/proxy/events?limit=12&offset=12', headers: {} }, page2Res);
      const p2 = page2Res.json();

      assert(
        p1?.success === true && p1?.count === 12 && p1?.hasMore === true && p1?.offset === 0 && typeof p1?.nextCursor === 'string',
        'GET /api/proxy/events página 1 retorna 12 itens com hasMore=true e nextCursor opaco'
      );
      assert(
        p2?.success === true && p2?.count === 12 && p2?.offset === 12 && p1?.events?.[0]?.id !== p2?.events?.[0]?.id,
        'GET /api/proxy/events página 2 retorna offset=12 sem sobrepor página 1'
      );

      // Paginação Keyset via ?cursor= deve produzir exatamente os mesmos itens da página 2 sem OFFSET
      const cursorPage2Res = createMockRes();
      await eventsProxyHandler(
        { method: 'GET', url: `/api/proxy/events?limit=12&cursor=${encodeURIComponent(p1.nextCursor)}`, headers: {} },
        cursorPage2Res
      );
      const cp2 = cursorPage2Res.json();
      assert(
        cp2?.success === true &&
          cp2?.count === 12 &&
          cp2?.events?.[0]?.id === p2?.events?.[0]?.id &&
          cp2?.events?.[11]?.id === p2?.events?.[11]?.id,
        'Paginação Keyset (?cursor=) casa exatamente com página 2 e devolve Server-Timing + ETag'
      );

      // Valida cabeçalhos Server-Timing, X-Request-Id, ETag e 304 Not Modified via If-None-Match
      const p1Etag = page1Res.headers['ETag'];
      assert(
        Boolean(p1Etag) &&
          typeof page1Res.headers['Server-Timing'] === 'string' &&
          page1Res.headers['Server-Timing'].includes('db_events') &&
          typeof page1Res.headers['X-Request-Id'] === 'string',
        'Resposta inclui ETag fraca, Server-Timing e X-Request-Id'
      );

      const notModRes = createMockRes();
      await eventsProxyHandler(
        { method: 'GET', url: '/api/proxy/events?limit=12&offset=0', headers: { 'if-none-match': p1Etag } },
        notModRes
      );
      assert(
        notModRes.statusCode === 304 && notModRes.body === '',
        'GET /api/proxy/events retorna HTTP 304 Not Modified quando ETag coincide',
        `status=${notModRes.statusCode}`
      );

      // Testa filtro SQL de categoria pushdown
      await db.exec(`
        INSERT INTO public.topics (id, name) VALUES ('top-eco', 'Economia'), ('top-tech', 'Tecnologia');
        INSERT INTO public.event_topics (event_id, topic_id) VALUES ('evt-1', 'top-eco'), ('evt-2', 'top-tech');
      `);
      const catRes = createMockRes();
      await eventsProxyHandler({ method: 'GET', url: '/api/proxy/events?limit=10&category=Economia', headers: {} }, catRes);
      const catBody = catRes.json();
      assert(
        catBody?.success === true && catBody?.events?.length === 1 && catBody?.events?.[0]?.id === 'evt-1',
        'Filtro ?category=Economia é empurrado ao SQL e retorna apenas evt-1'
      );

      // EXPLAIN antes dos índices
      const explainBeforeRes = await db.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, created_at FROM public.notifications WHERE user_id = 'user-target' AND read = false ORDER BY created_at DESC LIMIT 20`
      );
      const planBefore = explainBeforeRes.rows.map((r) => r['QUERY PLAN']).join(' ');

      const migrationSql = fs.readFileSync(
        path.resolve('supabase/migrations/20261123000002_perf_indexes_composite_hot_paths.sql'),
        'utf8'
      );
      await db.exec(migrationSql);
      // Reexecuta para garantir idempotência absoluta
      await db.exec(migrationSql);
      await db.exec('ANALYZE;');

      const idxRes = await db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%'`
      );
      const idxNames = new Set(idxRes.rows.map((r) => r.indexname));
      assert(
        idxNames.has('idx_events_published_at_desc') &&
          idxNames.has('idx_notifications_user_unread_created_desc') &&
          idxNames.has('idx_briefings_user_scheduled_desc'),
        'Migração 20261123000002 cria índices de hot paths de forma idempotente',
        `encontrados=${idxNames.size}`
      );

      const explainAfterRes = await db.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, created_at FROM public.notifications WHERE user_id = 'user-target' AND read = false ORDER BY created_at DESC LIMIT 20`
      );
      const planAfter = explainAfterRes.rows.map((r) => r['QUERY PLAN']).join(' ');
      assert(
        planBefore.includes('Seq Scan') &&
          (planAfter.includes('Index') || planAfter.includes('idx_notifications_user_unread_created_desc')),
        'EXPLAIN confirma substituição de Seq Scan por Index Scan após migração',
        `before=[${planBefore.slice(0, 80)}] after=[${planAfter.slice(0, 80)}]`
      );

      // Valida nova migração 20261123000003 (índice keyset + joins) + EXPLAIN
      const migration3Sql = fs.readFileSync(
        path.resolve('supabase/migrations/20261123000003_perf_cursor_and_join_indexes.sql'),
        'utf8'
      );
      await db.exec(migration3Sql);
      await db.exec(migration3Sql); // idempotência
      await db.exec('ANALYZE;');

      const explainCursorRes = await db.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id, published_at FROM public.events WHERE published_at < NOW() - interval '100 minutes' ORDER BY published_at DESC, id DESC LIMIT 12`
      );
      const planCursor = explainCursorRes.rows.map((r) => r['QUERY PLAN']).join(' ');
      assert(
        planCursor.includes('Index') || planCursor.includes('idx_events_published_id_desc'),
        'Migração 20261123000003 habilita Index Scan no cursor composto (published_at DESC, id DESC)',
        planCursor.slice(0, 120)
      );

      // Valida scripts de rollback (20261123000002 e 20261123000003)
      const rollbackSql = fs.readFileSync(
        path.resolve('supabase/migrations/20261123000002_rollback_perf_indexes.sql'),
        'utf8'
      );
      const rollback3Sql = fs.readFileSync(
        path.resolve('supabase/migrations/20261123000003_rollback_perf_cursor_indexes.sql'),
        'utf8'
      );
      await db.exec(rollbackSql);
      await db.exec(rollback3Sql);
      const idxAfterRollback = await db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_notifications_user_unread_created_desc', 'idx_events_published_id_desc')`
      );
      assert(idxAfterRollback.rows.length === 0, 'Scripts de rollback removem todos os índices das migrações 0002 e 0003 com segurança');
    } finally {
      setTestPostgresPool(null);
      await db.close();
    }
  }

  // ---------------------------------------------------------------------------
  // 7. briefingEngine: Batch Prefetch elimina queries N+1 em runGenerationCycle
  // ---------------------------------------------------------------------------
  console.log('\n7. briefingEngine: Eliminação de queries N+1 via prefetchEventPool');
  {
    const tableQueries: Record<string, number> = {};
    const countQuery = (tbl: string) => {
      tableQueries[tbl] = (tableQueries[tbl] || 0) + 1;
    };

    const mockUsers = Array.from({ length: 5 }, (_, i) => ({
      id: `user-${i + 1}`,
      briefing_email: null,
      email_morning_briefing: true,
      email_evening_briefing: true,
      weekend_edition: true,
      timezone: 'America/Sao_Paulo',
      morning_time: '07:00',
      evening_time: '20:00',
    }));

    const mockEvents = [
      {
        id: 'ev-101',
        title: 'Selic mantida pelo Copom',
        summary: 'Decisão unânime',
        why_it_matters: 'Impacta crédito e câmbio',
        relevance_score: 95,
        published_at: new Date().toISOString(),
      },
      {
        id: 'ev-102',
        title: 'Nova infraestrutura de dados',
        summary: 'Expansão nacional',
        why_it_matters: 'Reduz latência regional',
        relevance_score: 88,
        published_at: new Date().toISOString(),
      },
    ];

    const createdBriefings: any[] = [];
    const mockSupabase: any = {
      from: (table: string) => {
        countQuery(table);
        const chain: any = {
          _op: 'select',
          _payload: null as any,
          select: () => chain,
          insert: (p: any) => {
            chain._op = 'insert';
            chain._payload = p;
            if (table === 'briefings') {
              createdBriefings.push(p);
            }
            return chain;
          },
          update: () => {
            chain._op = 'update';
            return chain;
          },
          upsert: () => {
            chain._op = 'upsert';
            return chain;
          },
          delete: () => chain,
          eq: () => chain,
          gte: () => chain,
          lte: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          single: async () => {
            if (table === 'briefings' && chain._op === 'insert') {
              return { data: { id: `br-${createdBriefings.length}` }, error: null };
            }
            return { data: null, error: null };
          },
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: any) => {
            if (table === 'user_preferences') return resolve({ data: mockUsers, error: null });
            if (table === 'user_settings') return resolve({ data: [], error: null });
            if (table === 'events') return resolve({ data: mockEvents, error: null });
            if (table === 'user_entity_follows') return resolve({ data: [{ entity_id: 'ent-1' }], error: null });
            if (table === 'event_entities') return resolve({ data: [{ event_id: 'ev-102', entity_id: 'ent-1' }], error: null });
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc: async (fnName: string, args: any) => {
        if (fnName === 'acquire_distributed_job_lock') {
          const key = String(args?.p_lock_key || 'k');
          if (locks.has(key)) return { data: { acquired: false, owner_id: 'other' }, error: null };
          locks.add(key);
          return { data: { acquired: true }, error: null };
        }
        if (fnName === 'release_distributed_job_lock') {
          locks.delete(String(args?.p_lock_key || 'k'));
          return { data: { released: true }, error: null };
        }
        return { data: true, error: null };
      },
    };

    const locks = new Set<string>();
    const fakePgPool = {
      connect: async () => ({
        query: async (sql: string, params: any[] = []) => {
          if (sql.includes('acquire_distributed_job_lock')) {
            const key = String(params[0] || 'k');
            if (locks.has(key)) return { rows: [{ result: { acquired: false } }] };
            locks.add(key);
            return { rows: [{ result: { acquired: true } }] };
          }
          if (sql.includes('release_distributed_job_lock')) {
            locks.delete(String(params[0] || 'k'));
            return { rows: [{ result: { released: true } }] };
          }
          return { rows: [] };
        },
        release: () => {},
      }),
    };

    setBriefingEngineTestDeps({
      getServerSupabase: () => mockSupabase,
      isPostgresConfigured: () => true,
      getPostgresPool: () => fakePgPool as any,
      executeSql: async (sql: string, params: any[] = []) => {
        if (sql.includes('acquire_distributed_job_lock')) {
          const key = String(params[0] || 'k');
          if (locks.has(key)) return { rows: [{ result: { acquired: false } }] } as any;
          locks.add(key);
          return { rows: [{ result: { acquired: true } }] } as any;
        }
        if (sql.includes('release_distributed_job_lock')) {
          locks.delete(String(params[0] || 'k'));
          return { rows: [{ result: { released: true } }] } as any;
        }
        return { rows: [] } as any;
      },
    });

    setNotificationEngineTestDeps({
      getServerSupabase: () => mockSupabase,
    });

    try {
      const cycleRes = await briefingEngine.runGenerationCycle({
        type: 'MORNING',
        sendEmail: false,
        respectScheduleWindow: false,
      });

      assert(cycleRes.eligibleUsers === 5 && cycleRes.ready === 5, 'Ciclo em lote processa todos os 5 usuários elegíveis', JSON.stringify(cycleRes));
      assert(
        (tableQueries['events'] || 0) === 1 && (tableQueries['event_entities'] || 0) === 1,
        'Queries de events e event_entities executam apenas 1 vez (O(1)) para 5 usuários',
        `events=${tableQueries['events']}, event_entities=${tableQueries['event_entities']}`
      );

      // Modo standalone ainda funciona sem prefetchedPool
      const standalone = await briefingEngine.selectEventsForUser('user-standalone');
      assert(standalone.length === 2 && standalone[0].id === 'ev-102', 'selectEventsForUser preserva personalização no modo standalone');
    } finally {
      setNotificationEngineTestDeps(null);
      setBriefingEngineTestDeps(null);
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Vercel Function Cap (<= 8) & Headers de Cache
  // ---------------------------------------------------------------------------
  console.log('\n9. Limite de Serverless Functions (<= 8) & Headers Vercel');
  {
    const apiFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '_lib') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) apiFiles.push(full);
      }
    };
    walk(path.resolve('api'));

    assert(apiFiles.length === 8, 'Quantidade de Serverless Functions Vercel mantida em exatas 8 (<= limite Hobby)', `encontradas=${apiFiles.length}`);

    const vercelConfig = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
    const headersList: any[] = vercelConfig.headers || [];
    const assetsHeader = headersList.find((h) => h.source === '/assets/(.*)');
    const apiHeader = headersList.find((h) => h.source === '/api/(.*)');
    assert(
      Boolean(assetsHeader?.headers?.some((x: any) => String(x.value).includes('immutable'))),
      'vercel.json configura cache imutável de 1 ano para /assets/*'
    );
    assert(
      Boolean(apiHeader?.headers?.some((x: any) => String(x.value).includes('no-store'))),
      'vercel.json mantém no-store para respostas dinâmicas/autenticadas de /api/*'
    );
  }

  // ---------------------------------------------------------------------------
  // 10. userService SWR Deduplication & Cache Invalidation
  // ---------------------------------------------------------------------------
  console.log('\n10. userService SWR Deduplication & Invalidation');
  {
    let dbPrefReads = 0;
    let savedMorning = false;
    const mockPrefClient: any = {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          upsert: async (payload: any) => {
            if (table === 'user_preferences' && typeof payload?.email_morning_briefing === 'boolean') {
              savedMorning = payload.email_morning_briefing;
            }
            return { error: null };
          },
          maybeSingle: async () => {
            if (table === 'user_preferences') dbPrefReads++;
            await new Promise((r) => setTimeout(r, 15));
            return {
              data: {
                id: 'u-swr-1',
                email_morning_briefing: savedMorning,
                timezone: 'America/Sao_Paulo',
                updated_at: new Date().toISOString(),
              },
              error: null,
            };
          },
        };
        return chain;
      },
    };

    setTestUserServiceClient({ client: mockPrefClient, configured: true });
    try {
      const batch = await Promise.all(
        Array.from({ length: 5 }, () => userService.getUserPreferencesDetailed('u-swr-1'))
      );
      assert(
        dbPrefReads === 1 && batch.every((r) => r.data?.email_morning_briefing === false),
        '5 leituras simultâneas de getUserPreferencesDetailed deduplicam em 1 query',
        `dbPrefReads=${dbPrefReads}`
      );

      await userService.updateUserPreferencesDetailed('u-swr-1', { email_morning_briefing: true });
      const fresh = await userService.getUserPreferencesDetailed('u-swr-1');
      assert(
        fresh.data?.email_morning_briefing === true && dbPrefReads === 2,
        'updateUserPreferencesDetailed invalida cache SWR e lê dado atualizado',
        `morning=${fresh.data?.email_morning_briefing}, reads=${dbPrefReads}`
      );
    } finally {
      setTestUserServiceClient(null);
    }
  }

  // ---------------------------------------------------------------------------
  // 11. Otimização de URLs de Imagem (WebP/w) & Virtualização DOM (computeVirtualWindow)
  // ---------------------------------------------------------------------------
  console.log('\n11. imageOptimize & computeVirtualWindow');
  {
    const unsplashRaw = 'https://images.unsplash.com/photo-1500000000000-abcdef123456';
    const optUnsplash = optimizeExternalImageUrl(unsplashRaw, { width: 800, quality: 80 });
    assert(
      optUnsplash.includes('fm=webp') && optUnsplash.includes('auto=format') && optUnsplash.includes('w=800'),
      'optimizeExternalImageUrl adiciona auto=format, fm=webp e w=800 em URLs Unsplash',
      optUnsplash
    );

    const otherUrl = 'https://cdn.example.com/news/cover.jpg';
    assert(
      optimizeExternalImageUrl(otherUrl, { width: 800 }) === otherUrl,
      'optimizeExternalImageUrl preserva domínios externos sem suporte conhecido'
    );

    const win = computeVirtualWindow(10000, 44000, 440, 44, 6);
    const renderedCount = win.endIndex - win.startIndex;
    assert(
      win.totalHeight === 440000 &&
        win.startIndex === 994 &&
        renderedCount <= 25 &&
        win.offsetTop === win.startIndex * 44,
      'computeVirtualWindow limita nós renderizados em <= 25 itens para lista de 10.000 linhas',
      JSON.stringify(win)
    );
  }

  console.log(`\nResumo: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
