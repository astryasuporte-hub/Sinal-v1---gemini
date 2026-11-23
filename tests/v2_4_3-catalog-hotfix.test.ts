/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.4.3 — SUÍTE ISOLADA DE VALIDAÇÃO DO HOTFIX DO CATÁLOGO
 *
 * Valida integralmente contra o schema real de produção:
 * 1. GET /api/proxy/catalog com 8 entidades + 67 fontes em PostgreSQL (PGlite schema real).
 * 2. Filtragem de registros inativos (is_active = false) e mapeamento de imageUrl/logoUrl/avatarUrl/website.
 * 3. Ausência absoluta de consultas às colunas inexistentes (sector, role, organization, website, avatar_url, brand_color, category).
 * 4. GET /api/proxy/events?limit=3 e GET /api/proxy/feed?limit=3 com entidades e fontes hidratadas.
 * 5. Fallback Supabase com colunas válidas quando PostgreSQL indisponível.
 * 6. Resposta HTTP 503 CATALOG_UNAVAILABLE quando todo o catálogo falha (sem vazar segredos/detalhes do banco).
 * 7. Resposta parcial explícita (partial: true, degraded) preservando dados recuperados quando apenas metade falha.
 * 8. Distinção explícita entre erro (503) e base legitimamente vazia (200 []).
 */

import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import eventsHandler from '../api/_lib/handlers/proxy/events.js';
import { setTestPostgresPool } from '../api/_lib/postgres.js';
import { setTestSupabaseClient } from '../api/_lib/db.js';

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

async function createRealCatalogDb() {
  const db = new PGlite();
  // Schema estrito igual ao Supabase de produção (sem sector/role/organization/website/avatar_url/brand_color/category)
  await db.exec(`
    CREATE TABLE public.entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      description TEXT,
      image_url TEXT,
      website_url TEXT,
      country_code TEXT,
      is_verified BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      search_vector TEXT
    );

    CREATE TABLE public.news_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      domain TEXT NOT NULL,
      logo_url TEXT,
      country_code TEXT,
      language_code TEXT,
      authority_score INTEGER DEFAULT 80,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      search_vector TEXT
    );

    CREATE TABLE public.events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT,
      summary TEXT,
      why_it_matters TEXT,
      relevance_score INTEGER DEFAULT 85,
      article_count INTEGER DEFAULT 1,
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE public.articles (
      id TEXT PRIMARY KEY,
      source_id TEXT REFERENCES public.news_sources(id),
      title TEXT,
      url TEXT,
      canonical_url TEXT,
      description TEXT,
      published_at TIMESTAMPTZ,
      image_url TEXT
    );

    CREATE TABLE public.event_articles (
      event_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      is_primary BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE public.topics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE public.event_topics (
      event_id TEXT NOT NULL,
      topic_id TEXT NOT NULL
    );

    CREATE TABLE public.event_entities (
      event_id TEXT NOT NULL,
      entity_id TEXT NOT NULL
    );
  `);
  return db;
}

async function runTests() {
  console.log('\n=== FATOSBR V2.4.3 — TESTES DO HOTFIX DE CATÁLOGO ===\n');
  process.env.FATOSBR_TEST_MODE = 'true';

  // -------------------------------------------------------------------------
  // 1. Inspeção estática: ausência de colunas inválidas nas queries de catálogo
  // -------------------------------------------------------------------------
  console.log('1. Verificação estática de colunas válidas no schema real');
  {
    const eventsCode = fs.readFileSync(path.resolve('api/_lib/handlers/proxy/events.ts'), 'utf8');
    const eventSvcCode = fs.readFileSync(path.resolve('src/services/eventService.ts'), 'utf8');

    const forbiddenEntityCols = ['ent.sector', 'ent.role', 'ent.organization', 'ent.website,', 'ent.avatar_url', 'ent.brand_color'];
    for (const col of forbiddenEntityCols) {
      assert(!eventsCode.includes(col), `events.ts não consulta coluna inexistente "${col}"`);
    }

    assert(
      !eventsCode.includes('domain, category, logo_url, brand_color') &&
        !eventSvcCode.includes('domain, category, logo_url, brand_color'),
      'events.ts e eventService.ts não consultam category/brand_color em public.news_sources'
    );
    assert(
      !eventSvcCode.includes('sector, role, organization, website, image_url, logo_url, avatar_url, brand_color'),
      'eventService.ts não consulta colunas inexistentes em public.entities'
    );
  }

  // -------------------------------------------------------------------------
  // 2. PGlite com schema exato (8 entidades ativas + 1 inativa, 67 fontes)
  // -------------------------------------------------------------------------
  console.log('\n2. Catálogo PostgreSQL com schema real (8 entidades + 67 fontes) + Events/Feed');
  {
    const db = await createRealCatalogDb();

    await db.exec(`
      INSERT INTO public.entities (id, type, name, slug, description, image_url, website_url, country_code, is_verified, is_active)
      VALUES
        ('ent-1', 'company', 'Petrobras', 'petrobras', 'Energia brasileira', 'https://cdn.example/petrobras.png', 'https://petrobras.com.br', 'BR', true, true),
        ('ent-2', 'company', 'Banco Central', 'banco-central', 'Autoridade monetária', 'https://cdn.example/bcb.png', 'https://bcb.gov.br', 'BR', true, true),
        ('ent-3', 'person', 'Roberto Campos', 'roberto-campos', 'Economista', 'https://cdn.example/rc.png', 'https://example.com/rc', 'BR', true, true),
        ('ent-4', 'organization', 'STF', 'stf', 'Supremo Tribunal Federal', 'https://cdn.example/stf.png', 'https://stf.jus.br', 'BR', true, true),
        ('ent-5', 'company', 'Vale', 'vale', 'Mineração global', 'https://cdn.example/vale.png', 'https://vale.com', 'BR', true, true),
        ('ent-6', 'company', 'Embraer', 'embraer', 'Aeroespacial', 'https://cdn.example/embraer.png', 'https://embraer.com', 'BR', true, true),
        ('ent-7', 'company', 'Nubank', 'nubank', 'Serviços financeiros', 'https://cdn.example/nu.png', 'https://nubank.com.br', 'BR', true, true),
        ('ent-8', 'organization', 'BNDES', 'bndes', 'Banco de desenvolvimento', 'https://cdn.example/bndes.png', 'https://bndes.gov.br', 'BR', true, true),
        ('ent-inactive', 'company', 'Entidade Inativa', 'inativa', 'Não deve aparecer', null, null, 'BR', false, false);

      INSERT INTO public.news_sources (id, name, slug, domain, logo_url, country_code, language_code, authority_score, is_active)
      SELECT
        'src-' || g,
        'Fonte ' || LPAD(g::text, 2, '0'),
        'fonte-' || g,
        'fonte' || g || '.com.br',
        'https://cdn.example/logos/' || g || '.png',
        'BR',
        'pt',
        85,
        true
      FROM generate_series(1, 67) AS g;

      INSERT INTO public.news_sources (id, name, slug, domain, is_active)
      VALUES ('src-inactive', 'Fonte Inativa', 'fonte-inativa', 'inativa.com.br', false);

      INSERT INTO public.topics (id, name) VALUES ('top-eco', 'Economia');
      INSERT INTO public.events (id, title, slug, summary, why_it_matters, relevance_score, article_count, published_at)
      VALUES
        ('ev-1', 'Decisão sobre juros e investimentos', 'juros-investimentos', 'Resumo 1', 'Importância 1', 94, 2, NOW() - interval '10 minutes'),
        ('ev-2', 'Expansão energética nacional', 'expansao-energetica', 'Resumo 2', 'Importância 2', 91, 1, NOW() - interval '20 minutes'),
        ('ev-3', 'Avanço aeroespacial brasileiro', 'avanco-aeroespacial', 'Resumo 3', 'Importância 3', 89, 1, NOW() - interval '30 minutes'),
        ('ev-4', 'Evento extra para paginação', 'evento-4', 'Resumo 4', 'Importância 4', 80, 1, NOW() - interval '40 minutes');

      INSERT INTO public.articles (id, source_id, title, url, canonical_url, description, published_at, image_url)
      VALUES
        ('art-1', 'src-1', 'Matéria principal 1', 'https://fonte1.com.br/1', 'https://fonte1.com.br/1', 'Desc 1', NOW(), 'https://cdn.example/img1.jpg'),
        ('art-2', 'src-2', 'Matéria principal 2', 'https://fonte2.com.br/2', 'https://fonte2.com.br/2', 'Desc 2', NOW(), 'https://cdn.example/img2.jpg'),
        ('art-3', 'src-3', 'Matéria principal 3', 'https://fonte3.com.br/3', 'https://fonte3.com.br/3', 'Desc 3', NOW(), 'https://cdn.example/img3.jpg');

      INSERT INTO public.event_articles (event_id, article_id, is_primary)
      VALUES ('ev-1', 'art-1', true), ('ev-2', 'art-2', true), ('ev-3', 'art-3', true);

      INSERT INTO public.event_topics (event_id, topic_id) VALUES ('ev-1', 'top-eco');
      INSERT INTO public.event_entities (event_id, entity_id) VALUES ('ev-1', 'ent-2'), ('ev-1', 'ent-3'), ('ev-2', 'ent-1'), ('ev-3', 'ent-6');
    `);

    const fakePool = {
      connect: async () => ({
        query: async (sql: string, params: any[]) => db.query(sql, params),
        release: () => {},
      }),
    };
    setTestPostgresPool(fakePool);
    setTestSupabaseClient(null);

    try {
      const catRes = createMockRes();
      await eventsHandler({ method: 'GET', url: '/api/proxy/catalog', headers: {} }, catRes);
      const catBody = catRes.json();

      assert(catRes.statusCode === 200, 'GET /api/proxy/catalog retorna HTTP 200', `status=${catRes.statusCode}`);
      assert(
        catBody?.success === true && catBody?.partial === false,
        'GET /api/proxy/catalog sinaliza success=true e partial=false'
      );
      assert(
        Array.isArray(catBody?.entities) && catBody.entities.length === 8,
        'Retorna exatamente 8 entidades ativas (excluindo is_active=false)',
        `count=${catBody?.entities?.length}`
      );
      assert(
        Array.isArray(catBody?.sources) && catBody.sources.length === 67,
        'Retorna exatamente 67 fontes ativas (excluindo is_active=false)',
        `count=${catBody?.sources?.length}`
      );

      const person = catBody.entities.find((e: any) => e.id === 'ent-3');
      const company = catBody.entities.find((e: any) => e.id === 'ent-1');
      assert(
        person?.avatarUrl === 'https://cdn.example/rc.png' &&
          person?.imageUrl === 'https://cdn.example/rc.png' &&
          person?.website === 'https://example.com/rc' &&
          person?.websiteUrl === 'https://example.com/rc',
        'Entidade person mapeia imageUrl, avatarUrl, website e websiteUrl corretamente'
      );
      assert(
        company?.logoUrl === 'https://cdn.example/petrobras.png' &&
          company?.website === 'https://petrobras.com.br' &&
          company?.isVerified === true &&
          company?.countryCode === 'BR',
        'Entidade company mapeia logoUrl, website, isVerified e countryCode corretamente'
      );

      // ETag 304
      const etag = catRes.headers['ETag'];
      const cat304Res = createMockRes();
      await eventsHandler(
        { method: 'GET', url: '/api/proxy/catalog', headers: { 'if-none-match': etag } },
        cat304Res
      );
      assert(cat304Res.statusCode === 304, 'GET /api/proxy/catalog suporta ETag 304 Not Modified');

      // GET /api/proxy/events?limit=3
      const evRes = createMockRes();
      await eventsHandler({ method: 'GET', url: '/api/proxy/events?limit=3', headers: {} }, evRes);
      const evBody = evRes.json();
      assert(
        evRes.statusCode === 200 && evBody?.count === 3 && evBody?.hasMore === true,
        'GET /api/proxy/events?limit=3 retorna 3 eventos com hasMore=true'
      );
      const ev1 = evBody.events.find((e: any) => e.id === 'ev-1');
      assert(
        Array.isArray(ev1?.entities) &&
          ev1.entities.length === 2 &&
          ev1.entities.some((ent: any) => ent.id === 'ent-2' && ent.imageUrl === 'https://cdn.example/bcb.png'),
        'Eventos hidratam entidades vinculadas via event_entities com imageUrl e website_url',
        JSON.stringify(ev1?.entities)
      );
      assert(
        Array.isArray(ev1?.sources) && ev1.sources[0]?.logoUrl === 'https://cdn.example/logos/1.png',
        'Eventos hidratam logotipo das fontes via news_sources'
      );

      // GET /api/proxy/feed?limit=3
      const feedRes = createMockRes();
      await eventsHandler({ method: 'GET', url: '/api/proxy/feed?limit=3', headers: {} }, feedRes);
      const feedBody = feedRes.json();
      assert(
        feedRes.statusCode === 200 && feedBody?.count === 3,
        'GET /api/proxy/feed?limit=3 retorna 3 eventos com sucesso'
      );
    } finally {
      setTestPostgresPool(null);
      await db.close();
    }
  }

  // -------------------------------------------------------------------------
  // 3. Fallback Supabase, Erro 503 CATALOG_UNAVAILABLE, Parcial & Base Vazia
  // -------------------------------------------------------------------------
  console.log('\n3. Fallback Supabase, Erro 503 CATALOG_UNAVAILABLE, Parcial e Base Vazia');
  {
    const selectedColsByTable: Record<string, string> = {};

    // 3.1 PG falha -> fallback Supabase funciona com colunas válidas
    const brokenPgPool = {
      connect: async () => ({
        query: async () => {
          throw new Error('PG_DOWN_SIMULATED');
        },
        release: () => {},
      }),
    };
    const healthySbClient = {
      from: (table: string) => {
        const chain: any = {
          select: (cols: string) => {
            selectedColsByTable[table] = cols;
            return chain;
          },
          or: () => chain,
          in: () => chain,
          order: () => chain,
          lt: () => chain,
          limit: () => chain,
          range: () => chain,
          then: (resolve: any) => {
            if (table === 'entities') {
              return resolve({
                data: [
                  {
                    id: 'sb-ent-1',
                    type: 'company',
                    name: 'WEG',
                    slug: 'weg',
                    description: 'Motores',
                    image_url: 'https://cdn.example/weg.png',
                    website_url: 'https://weg.net',
                    country_code: 'BR',
                    is_verified: true,
                    is_active: true,
                  },
                ],
                error: null,
              });
            }
            if (table === 'news_sources') {
              return resolve({
                data: [
                  {
                    id: 'sb-src-1',
                    name: 'Valor',
                    slug: 'valor',
                    domain: 'valor.globo.com',
                    logo_url: 'https://cdn.example/valor.png',
                    country_code: 'BR',
                    language_code: 'pt',
                    authority_score: 95,
                    is_active: true,
                  },
                ],
                error: null,
              });
            }
            if (table === 'events') {
              return resolve({
                data: [
                  {
                    id: 'sb-ev-1',
                    title: 'Evento Fallback',
                    slug: 'evento-fallback',
                    summary: 'Resumo',
                    why_it_matters: 'Impacto',
                    published_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    relevance_score: 90,
                    article_count: 1,
                  },
                ],
                error: null,
              });
            }
            if (table === 'event_entities') {
              return resolve({ data: [{ event_id: 'sb-ev-1', entity_id: 'sb-ent-1' }], error: null });
            }
            if (table === 'event_articles') {
              return resolve({ data: [{ event_id: 'sb-ev-1', article_id: 'sb-art-1', is_primary: true }], error: null });
            }
            if (table === 'articles') {
              return resolve({
                data: [
                  {
                    id: 'sb-art-1',
                    source_id: 'sb-src-1',
                    title: 'Título Artigo',
                    url: 'https://valor.globo.com/a1',
                    published_at: new Date().toISOString(),
                    image_url: 'https://cdn.example/hero.jpg',
                  },
                ],
                error: null,
              });
            }
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
    };

    setTestPostgresPool(brokenPgPool);
    setTestSupabaseClient(healthySbClient);
    try {
      const fbRes = createMockRes();
      await eventsHandler({ method: 'GET', url: '/api/proxy/catalog', headers: {} }, fbRes);
      const fbBody = fbRes.json();

      assert(
        fbRes.statusCode === 200 &&
          fbBody?.entities?.length === 1 &&
          fbBody?.sources?.length === 1 &&
          fbBody?.entities?.[0]?.website === 'https://weg.net',
        'Fallback Supabase retorna entidades e fontes válidas quando PostgreSQL falha'
      );
      assert(
        !selectedColsByTable['entities']?.includes('sector') &&
          !selectedColsByTable['news_sources']?.includes('brand_color'),
        'Fallback Supabase consulta exclusivamente colunas válidas',
        JSON.stringify(selectedColsByTable)
      );

      // Também valida hidratação no fallback de /api/proxy/events?limit=3
      const sbEvRes = createMockRes();
      await eventsHandler({ method: 'GET', url: '/api/proxy/events?limit=3', headers: {} }, sbEvRes);
      const sbEvBody = sbEvRes.json();
      assert(
        sbEvRes.statusCode === 200 &&
          sbEvBody?.events?.[0]?.entities?.[0]?.name === 'WEG' &&
          sbEvBody?.events?.[0]?.sources?.[0]?.logoUrl === 'https://cdn.example/valor.png',
        'Fallback Supabase de /api/proxy/events?limit=3 hidrata entidades e fontes'
      );
    } finally {
      setTestPostgresPool(null);
      setTestSupabaseClient(null);
    }

    // 3.2 PG falha E Supabase falha -> HTTP 503 CATALOG_UNAVAILABLE sem vazar segredos
    const failingSbClient = {
      from: () => {
        const chain: any = {
          select: () => chain,
          or: () => chain,
          order: async () => ({
            data: null,
            error: { code: 'PGRST000', message: 'postgres://secret:pass@db.internal:5432 failed' },
          }),
        };
        return chain;
      },
    };
    setTestPostgresPool(brokenPgPool);
    setTestSupabaseClient(failingSbClient);
    try {
      const errRes = createMockRes();
      await eventsHandler({ method: 'GET', url: '/api/proxy/catalog', headers: {} }, errRes);
      const errBody = errRes.json();
      assert(
        errRes.statusCode === 503 && errBody?.error === 'CATALOG_UNAVAILABLE' && errBody?.success === false,
        'Indisponibilidade total retorna HTTP 503 CATALOG_UNAVAILABLE em vez de HTTP 200 vazio',
        `status=${errRes.statusCode} body=${errRes.body}`
      );
      assert(
        !errRes.body.includes('secret:pass') && !errRes.body.includes('db.internal'),
        'Resposta HTTP 503 não expõe detalhes internos do banco nem credenciais'
      );
    } finally {
      setTestPostgresPool(null);
      setTestSupabaseClient(null);
    }

    // 3.3 Disponibilidade parcial: entities OK no PG, news_sources falha no PG e no Supabase
    const partialPgPool = {
      connect: async () => ({
        query: async (sql: string) => {
          if (sql.includes('FROM public.entities')) {
            return {
              rows: [
                {
                  id: 'ent-ok',
                  type: 'company',
                  name: 'Itaú',
                  slug: 'itau',
                  description: 'Banco',
                  image_url: 'https://cdn.example/itau.png',
                  website_url: 'https://itau.com.br',
                  country_code: 'BR',
                  is_verified: true,
                  is_active: true,
                },
              ],
            };
          }
          throw new Error('NEWS_SOURCES_LOCKED');
        },
        release: () => {},
      }),
    };
    setTestPostgresPool(partialPgPool);
    setTestSupabaseClient(failingSbClient);
    try {
      const partRes = createMockRes();
      await eventsHandler({ method: 'GET', url: '/api/proxy/catalog', headers: {} }, partRes);
      const partBody = partRes.json();
      assert(
        partRes.statusCode === 200 &&
          partBody?.partial === true &&
          partBody?.code === 'CATALOG_PARTIAL_UNAVAILABLE' &&
          Array.isArray(partBody?.degraded) &&
          partBody.degraded.includes('sources') &&
          partBody?.entities?.length === 1 &&
          partBody?.entities?.[0]?.name === 'Itaú',
        'Resposta parcial preserva entidades recuperadas e sinaliza degraded=[sources] explicitamente',
        partRes.body
      );
    } finally {
      setTestPostgresPool(null);
      setTestSupabaseClient(null);
    }

    // 3.4 Banco legitimamente vazio (sem erro) -> HTTP 200 com arrays vazios
    const emptySbClient = {
      from: () => {
        const chain: any = {
          select: () => chain,
          or: () => chain,
          order: async () => ({ data: [], error: null }),
        };
        return chain;
      },
    };
    setTestPostgresPool(null);
    setTestSupabaseClient(emptySbClient);
    try {
      const emptyRes = createMockRes();
      await eventsHandler({ method: 'GET', url: '/api/proxy/catalog', headers: {} }, emptyRes);
      const emptyBody = emptyRes.json();
      assert(
        emptyRes.statusCode === 200 &&
          emptyBody?.success === true &&
          emptyBody?.partial === false &&
          emptyBody?.entities?.length === 0 &&
          emptyBody?.sources?.length === 0,
        'Base legitimamente vazia retorna HTTP 200 sem falso erro'
      );
    } finally {
      setTestSupabaseClient(null);
    }
  }

  console.log(`\nResumo V2.4.3 Catalog Hotfix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
