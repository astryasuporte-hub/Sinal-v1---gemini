/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Events & Ingestion Proxy Handler V1.1
 * 
 * Correções Críticas Implementadas:
 * 1. GET /api/proxy/ingest: Suporte a GET exclusivo para o Cron oficial da Vercel.
 * 2. POST /api/proxy/ingest: Suporte a POST para execuções administrativas manuais.
 * 3. Autenticação Criptográfica Estrita: Validação com safeCompare de Authorization: Bearer <CRON_SECRET>.
 * 4. Bloqueio absoluto de spoofing de cabeçalhos arbitrários (x-vercel-cron sem token é rejeitado com 401).
 * 5. Consultas SQL estritas ao esquema real do Supabase:
 *    - public.events (slug, why_it_matters, key_points, primary_article_id)
 *    - public.articles (description, canonical_url, image_url)
 *    - public.news_sources (slug, domain, logo_url)
 *    - public.event_topics e public.topics (category)
 * 6. Resiliência: Retorno 200 com array vazio e zero falhas HTTP 500 quando a base estiver vazia.
 */

import { executeSql, isPostgresConfigured } from '../../postgres.js';
import { getServerSupabase } from '../../db.js';
import { sendJson, setCorsHeaders, readJsonBody, getServerKeys } from '../../common.js';
import { enforceRateLimit } from '../../rateLimiter.js';
import { safeCompare } from '../../crypto.js';
import { runServerSideIngestion } from '../../ingestionEngine.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import {
  attachTelemetryHeaders,
  computeWeakEtag,
  createTraceContext,
  withSpan,
} from '../../telemetry.js';

export function encodeEventCursor(publishedAt: string | Date, id: string): string {
  const iso = publishedAt instanceof Date ? publishedAt.toISOString() : String(publishedAt || '');
  return Buffer.from(JSON.stringify({ p: iso, i: String(id) }), 'utf8').toString('base64url');
}

export function decodeEventCursor(raw: string | null): { publishedAt: string; id: string } | null {
  if (!raw || typeof raw !== 'string' || raw.length > 512) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded.p !== 'string' || typeof decoded.i !== 'string') return null;
    const ms = Date.parse(decoded.p);
    const id = decoded.i.trim().slice(0, 128);
    if (!Number.isFinite(ms) || !id) return null;
    return { publishedAt: new Date(ms).toISOString(), id };
  } catch {
    return null;
  }
}

const ENTITY_SELECT_COLUMNS =
  'id, type, name, slug, description, image_url, website_url, country_code, is_verified, is_active, created_at, updated_at';

const NEWS_SOURCE_SELECT_COLUMNS =
  'id, name, slug, domain, logo_url, country_code, language_code, authority_score, is_active, created_at, updated_at';

const EVENT_ENTITY_SELECT_COLUMNS =
  'ent.id, ent.type, ent.name, ent.slug, ent.description, ent.image_url, ent.website_url, ent.country_code, ent.is_verified, ent.is_active';

function mapEntityRecord(row: any) {
  const normTypeRaw = String(row?.type || 'company').trim().toLowerCase();
  const type =
    normTypeRaw === 'person'
      ? 'person'
      : normTypeRaw === 'organization'
        ? 'organization'
        : 'company';
  const imageUrl = row?.image_url || undefined;
  const website = row?.website_url || undefined;
  const brandColor =
    type === 'person' ? '#8b5cf6' : type === 'organization' ? '#3b82f6' : '#10b981';

  return {
    id: String(row.id),
    name: row.name,
    slug: row.slug || undefined,
    type,
    description: row.description || '',
    website,
    websiteUrl: website,
    countryCode: row.country_code || undefined,
    isVerified: typeof row.is_verified === 'boolean' ? row.is_verified : undefined,
    isActive: typeof row.is_active === 'boolean' ? row.is_active : true,
    imageUrl,
    logoUrl: imageUrl,
    avatarUrl: type === 'person' ? imageUrl : undefined,
    brandColor,
    isFollowed: false
  };
}

function mapSourceRecord(row: any) {
  return {
    id: String(row.id),
    name: row.name,
    slug: row.slug || undefined,
    domain: row.domain,
    category: 'Notícias',
    logoUrl: row.logo_url || undefined,
    countryCode: row.country_code || undefined,
    languageCode: row.language_code || undefined,
    authorityScore: typeof row.authority_score === 'number' ? row.authority_score : undefined,
    isActive: typeof row.is_active === 'boolean' ? row.is_active : true,
    brandColor: '#64748b',
    isFollowed: false
  };
}

export default async function handler(req: any, res: any) {
  const traceCtx = createTraceContext(req);
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  // ===========================================================================
  // ROTA 1: INGESTÃO CANÔNICA SERVER-SIDE (GET via Cron Vercel / POST via Admin)
  // ===========================================================================
  if (pathname.includes('/ingest')) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return sendJson(res, 405, {
        error: 'METHOD_NOT_ALLOWED',
        message: 'Endpoint de ingestão aceita apenas GET (Vercel Cron) ou POST (Admin Trigger).'
      });
    }

    // 1. Extração segura de credenciais do cabeçalho Authorization
    const authHeader = String(req.headers['authorization'] || '').trim();
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    const cronSecret = process.env.CRON_SECRET || '';
    const adminSecret = process.env.ADMIN_SECRET || '';

    let isAuthorized = false;
    let authType = 'unauthorized';

    // 1.1 Verificação de token CRON_SECRET (padrão oficial Vercel Cron)
    if (bearerToken && cronSecret && safeCompare(bearerToken, cronSecret)) {
      isAuthorized = true;
      authType = 'cron_secret';
    }

    // 1.2 Verificação de token ADMIN_SECRET do servidor
    if (!isAuthorized && bearerToken && adminSecret && safeCompare(bearerToken, adminSecret)) {
      isAuthorized = true;
      authType = 'admin_secret';
    }

    // 1.3 Se for POST administrativo manual, valida sessão real Supabase via RBAC
    if (!isAuthorized && req.method === 'POST') {
      try {
        const isAdminSession = await verifyAdminRequest(req);
        if (isAdminSession) {
          isAuthorized = true;
          authType = 'admin_rbac_session';
        }
      } catch {}
    }

    // Bloqueio rigoroso: falha fechada se não autenticado (com rate limiting preventivo contra brute-force)
    // A presença isolada do cabeçalho 'x-vercel-cron' SEM token válido é expressamente rejeitada!
    if (!isAuthorized) {
      const rateLimitAllowed = await enforceRateLimit(req, res, 'general');
      if (!rateLimitAllowed) return;

      return sendJson(res, 401, {
        error: 'UNAUTHORIZED_CRON',
        code: 'UNAUTHORIZED_CRON',
        message: 'Acesso negado. A ingestão requer token de autorização criptográfico via Authorization: Bearer <CRON_SECRET>.'
      });
    }

    // 2. Execução da Ingestão Canônica Server-Side
    try {
      let keywords = ['brasil', 'economia', 'tecnologia'];

      if (req.method === 'POST') {
        const body = await readJsonBody(req).catch(() => ({}));
        if (Array.isArray(body?.keywords) && body.keywords.length > 0) {
          keywords = body.keywords.map(String).slice(0, 5);
        }
      }

      console.log(`[Ingest Handler] Iniciando ciclo de ingestão (${authType}, método ${req.method})...`);
      const result = await runServerSideIngestion({ keywords });

      return sendJson(res, 200, {
        success: result.success,
        ingestion: {
          executionId: result.executionId,
          articlesFetched: result.articlesFetched,
          deduplicatedCount: result.deduplicatedCount,
          articlesPersisted: result.articlesPersisted,
          eventsCreated: result.eventsCreated,
          eventsUpdated: result.eventsUpdated,
          sourcesUpserted: result.sourcesUpserted,
          durationMs: result.durationMs,
          providers: result.providers,
          error: result.error
        },
        authType,
        serverTime: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('[Ingest Handler Critical Error]', err?.message);
      return sendJson(res, 500, {
        error: 'INGESTION_FAILED',
        message: err?.message || 'Falha durante o pipeline de ingestão.'
      });
    }
  }

  // ===========================================================================
  // ROTA 2: CATÁLOGO PÚBLICO DE ENTIDADES & FONTES COM IMAGENS DO SUPABASE
  // ===========================================================================
  if (req.method === 'GET' && pathname.includes('/catalog')) {
    const rateLimitAllowed = await enforceRateLimit(req, res, 'general');
    if (!rateLimitAllowed) return;

    try {
      let entities: any[] = [];
      let sources: any[] = [];
      let entitiesOk = false;
      let sourcesOk = false;

      if (isPostgresConfigured()) {
        const [entSettled, srcSettled] = await withSpan(traceCtx, 'db_catalog', () =>
          Promise.allSettled([
            executeSql(
              `SELECT ${ENTITY_SELECT_COLUMNS}
               FROM public.entities
               WHERE COALESCE(is_active, TRUE) = TRUE
               ORDER BY name ASC`
            ),
            executeSql(
              `SELECT ${NEWS_SOURCE_SELECT_COLUMNS}
               FROM public.news_sources
               WHERE COALESCE(is_active, TRUE) = TRUE
               ORDER BY name ASC`
            )
          ])
        );

        if (entSettled.status === 'fulfilled') {
          entitiesOk = true;
          entities = (entSettled.value.rows || []).map(mapEntityRecord);
        } else {
          console.error('[Catalog API][PG entities] Falha na consulta:', entSettled.reason?.message || entSettled.reason);
        }

        if (srcSettled.status === 'fulfilled') {
          sourcesOk = true;
          sources = (srcSettled.value.rows || []).map(mapSourceRecord);
        } else {
          console.error('[Catalog API][PG news_sources] Falha na consulta:', srcSettled.reason?.message || srcSettled.reason);
        }
      }

      if (!entitiesOk || !sourcesOk) {
        try {
          const client = getServerSupabase();
          const [entRes, srcRes] = await withSpan(traceCtx, 'sb_catalog', () =>
            Promise.all([
              !entitiesOk
                ? client
                    .from('entities')
                    .select(ENTITY_SELECT_COLUMNS)
                    .or('is_active.is.null,is_active.eq.true')
                    .order('name')
                : Promise.resolve(null),
              !sourcesOk
                ? client
                    .from('news_sources')
                    .select(NEWS_SOURCE_SELECT_COLUMNS)
                    .or('is_active.is.null,is_active.eq.true')
                    .order('name')
                : Promise.resolve(null)
            ])
          );

          if (entRes) {
            if (entRes.error) {
              console.error('[Catalog API][Supabase entities] Erro na consulta:', entRes.error.code || '', entRes.error.message || entRes.error);
            } else if (Array.isArray(entRes.data)) {
              entitiesOk = true;
              entities = entRes.data.map(mapEntityRecord);
            }
          }

          if (srcRes) {
            if (srcRes.error) {
              console.error('[Catalog API][Supabase news_sources] Erro na consulta:', srcRes.error.code || '', srcRes.error.message || srcRes.error);
            } else if (Array.isArray(srcRes.data)) {
              sourcesOk = true;
              sources = srcRes.data.map(mapSourceRecord);
            }
          }
        } catch (sbErr: any) {
          console.error('[Catalog API][Supabase Fallback] Erro ao inicializar cliente:', sbErr?.message || sbErr);
        }
      }

      attachTelemetryHeaders(res, traceCtx);

      if (!entitiesOk && !sourcesOk) {
        return sendJson(
          res,
          503,
          {
            success: false,
            error: 'CATALOG_UNAVAILABLE',
            code: 'CATALOG_UNAVAILABLE',
            message: 'Catálogo temporariamente indisponível. Tente novamente em instantes.',
            entities: [],
            sources: []
          },
          {
            'Cache-Control': 'no-store'
          }
        );
      }

      if (!entitiesOk || !sourcesOk) {
        const degraded = [!entitiesOk ? 'entities' : null, !sourcesOk ? 'sources' : null].filter(Boolean);
        return sendJson(
          res,
          200,
          {
            success: true,
            partial: true,
            code: 'CATALOG_PARTIAL_UNAVAILABLE',
            degraded,
            warning: 'Parte do catálogo está temporariamente indisponível.',
            entities,
            sources
          },
          {
            'Cache-Control': 'no-store'
          }
        );
      }

      const catalogEtag = computeWeakEtag(
        JSON.stringify({
          e: entities.map((x) => `${x.id}:${x.imageUrl || ''}:${x.website || ''}`),
          s: sources.map((x) => `${x.id}:${x.logoUrl || ''}`),
        })
      );
      const ifNoneMatch = String(req.headers?.['if-none-match'] || '').trim();
      if (ifNoneMatch && ifNoneMatch === catalogEtag) {
        res.setHeader('ETag', catalogEtag);
        res.setHeader('Vary', 'Accept-Encoding');
        res.statusCode = 304;
        res.end();
        return;
      }

      return sendJson(
        res,
        200,
        {
          success: true,
          partial: false,
          entities,
          sources
        },
        {
          ETag: catalogEtag,
          Vary: 'Accept-Encoding',
        }
      );
    } catch (err: any) {
      console.error('[Catalog API Critical Error]', err?.message || err);
      attachTelemetryHeaders(res, traceCtx);
      return sendJson(
        res,
        503,
        {
          success: false,
          error: 'CATALOG_UNAVAILABLE',
          code: 'CATALOG_UNAVAILABLE',
          message: 'Catálogo temporariamente indisponível. Tente novamente em instantes.',
          entities: [],
          sources: []
        },
        {
          'Cache-Control': 'no-store'
        }
      );
    }
  }

  // ===========================================================================
  // ROTA 3: CONSULTA CANÔNICA DE ACONTECIMENTOS (GET /api/proxy/events ou /feed)
  // ===========================================================================
  if (req.method === 'GET' && (pathname.includes('/events') || pathname.includes('/feed'))) {
    const rateLimitAllowed = await enforceRateLimit(req, res, 'general');
    if (!rateLimitAllowed) return;

    try {
      const limit = Math.min(50, Math.max(1, parseInt(urlObj.searchParams.get('limit') || '30', 10)));
      const decodedCursor = decodeEventCursor(urlObj.searchParams.get('cursor'));
      const offset = decodedCursor ? 0 : Math.max(0, parseInt(urlObj.searchParams.get('offset') || '0', 10) || 0);
      const queryLimit = limit + 1;
      const categoryParam = urlObj.searchParams.get('category');
      const categoryFilter = categoryParam && categoryParam !== 'Todos' ? categoryParam.toLowerCase().trim() : null;

      // 1. Consulta ao PostgreSQL Nativo com CTE-first + Paginação Keyset/Cursor e Filtro SQL
      if (isPostgresConfigured()) {
        try {
          const sql = `
            WITH paged_events AS (
              SELECT
                e.id,
                e.title,
                e.slug,
                e.summary,
                e.why_it_matters,
                e.relevance_score,
                e.article_count,
                e.published_at,
                e.updated_at
              FROM public.events e
              WHERE
                ($3::text IS NULL OR EXISTS (
                  SELECT 1
                  FROM public.event_topics et_f
                  JOIN public.topics t_f ON t_f.id = et_f.topic_id
                  WHERE et_f.event_id = e.id AND LOWER(t_f.name) LIKE ('%' || $3::text || '%')
                ))
                AND ($4::timestamptz IS NULL OR (
                  e.published_at < $4::timestamptz
                  OR (e.published_at = $4::timestamptz AND e.id::text < $5::text)
                ))
              ORDER BY e.published_at DESC, e.id DESC
              LIMIT $1 OFFSET $2
            )
            SELECT 
              e.id,
              e.title,
              e.slug,
              e.summary,
              e.why_it_matters,
              e.relevance_score,
              e.article_count,
              e.published_at,
              e.updated_at,
              COALESCE(
                (
                  SELECT a.image_url 
                  FROM public.event_articles ea_img 
                  JOIN public.articles a ON a.id = ea_img.article_id 
                  WHERE ea_img.event_id = e.id AND a.image_url IS NOT NULL AND a.image_url != ''
                  ORDER BY ea_img.is_primary DESC
                  LIMIT 1
                ), 
                NULL
              ) as image_url,
              COALESCE(
                (
                  SELECT t.name 
                  FROM public.event_topics et 
                  JOIN public.topics t ON t.id = et.topic_id 
                  WHERE et.event_id = e.id 
                  LIMIT 1
                ), 
                'Brasil'
              ) as category,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', ns.id,
                    'sourceName', COALESCE(ns.name, ns.domain, 'Fonte Verificada'),
                    'domain', ns.domain,
                    'logoUrl', ns.logo_url,
                    'headline', a.title,
                    'url', a.url,
                    'canonicalUrl', a.canonical_url,
                    'description', a.description,
                    'publishedAt', a.published_at,
                    'imageUrl', a.image_url,
                    'isPrimary', ea.is_primary
                  ) ORDER BY ea.is_primary DESC, a.published_at DESC
                ) FILTER (WHERE a.id IS NOT NULL),
                '[]'::json
              ) as sources,
              COALESCE(
                (
                  SELECT a.description 
                  FROM public.event_articles ea_desc 
                  JOIN public.articles a ON a.id = ea_desc.article_id 
                  WHERE ea_desc.event_id = e.id 
                  ORDER BY ea_desc.is_primary DESC 
                  LIMIT 1
                ),
                e.summary
              ) as primary_description
            FROM paged_events e
            LEFT JOIN public.event_articles ea ON e.id = ea.event_id
            LEFT JOIN public.articles a ON ea.article_id = a.id
            LEFT JOIN public.news_sources ns ON a.source_id = ns.id
            GROUP BY e.id, e.title, e.slug, e.summary, e.why_it_matters, e.relevance_score, e.article_count, e.published_at, e.updated_at
            ORDER BY e.published_at DESC, e.id DESC
          `;

          const dbRes = await withSpan(traceCtx, 'db_events', () =>
            executeSql(sql, [
              queryLimit,
              offset,
              categoryFilter,
              decodedCursor ? decodedCursor.publishedAt : null,
              decodedCursor ? decodedCursor.id : null,
            ])
          );
          const rawRows = dbRes.rows || [];
          const hasMore = rawRows.length > limit;
          const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
          const lastRow = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
          const nextCursor = hasMore && lastRow ? encodeEventCursor(lastRow.published_at, String(lastRow.id)) : null;

          // Carregar event_entities separadamente usando apenas colunas reais de public.entities
          const entitiesByEventId = new Map<string, any[]>();
          try {
            const eventIds = pageRows.map((r: any) => String(r.id));
            if (eventIds.length > 0) {
              const eeRes = await withSpan(traceCtx, 'db_event_entities', () =>
                executeSql(
                  `SELECT ee.event_id, ${EVENT_ENTITY_SELECT_COLUMNS}
                   FROM public.event_entities ee
                   JOIN public.entities ent ON ent.id::text = ee.entity_id::text
                   WHERE ee.event_id::text = ANY($1::text[])
                     AND COALESCE(ent.is_active, TRUE) = TRUE`,
                  [eventIds]
                )
              );
              for (const row of eeRes.rows || []) {
                const evKey = String(row.event_id);
                const list = entitiesByEventId.get(evKey) || [];
                list.push(mapEntityRecord(row));
                entitiesByEventId.set(evKey, list);
              }
            }
          } catch (eeErr: any) {
            console.warn('[Events API] Falha ao carregar event_entities:', eeErr?.message || eeErr);
          }

          const mapped = pageRows.map((row: any) => {
            const sources = Array.isArray(row.sources) ? row.sources : [];
            const mainArticle = sources[0] || {};
            const itemCategory = row.category || 'Brasil';

            return {
              id: row.id,
              title: row.title,
              slug: row.slug || `evento-${row.id}`,
              summary: row.summary,
              whatHappened: row.summary || (row.primary_description ? row.primary_description : row.title),
              whyItMatters: row.why_it_matters || 'Fato apurado com múltiplas coberturas verificadas pelo motor FatosBR.',
              category: itemCategory,
              relevanceScore: row.relevance_score || 90,
              imageUrl: row.image_url || mainArticle.imageUrl || null,
              publishedAt: row.published_at,
              updatedAt: row.updated_at,
              relativeTime: 'Recente',
              sourceCountText: `${sources.length || row.article_count || 1} fontes`,
              entities: entitiesByEventId.get(String(row.id)) || [],
              sources: sources.map((s: any) => ({
                id: s.id,
                sourceName: s.sourceName,
                domain: s.domain,
                logoUrl: s.logoUrl || undefined,
                headline: s.headline,
                url: s.url,
                description: s.description,
                publishedAt: s.publishedAt
              }))
            };
          });

          const etag = computeWeakEtag(
            JSON.stringify({
              c: categoryFilter || '',
              cur: decodedCursor ? `${decodedCursor.publishedAt}:${decodedCursor.id}` : offset,
              items: pageRows.map((r: any) => `${r.id}:${r.updated_at || r.published_at}`),
            })
          );
          attachTelemetryHeaders(res, traceCtx);
          const ifNoneMatch = String(req.headers?.['if-none-match'] || '').trim();
          if (ifNoneMatch && ifNoneMatch === etag) {
            res.setHeader('ETag', etag);
            res.setHeader('Vary', 'Accept-Encoding');
            res.statusCode = 304;
            res.end();
            return;
          }

          return sendJson(
            res,
            200,
            {
              success: true,
              count: mapped.length,
              limit,
              offset,
              hasMore,
              nextCursor,
              events: mapped,
              source: 'postgresql_canonical'
            },
            {
              ETag: etag,
              Vary: 'Accept-Encoding',
            }
          );
        } catch (pgErr: any) {
          console.warn('[Events API] Erro na query PostgreSQL, tentando fallback:', pgErr?.message);
        }
      }

      // 2. Fallback via Supabase Client server-side (com hidratação de entidades e fontes com colunas válidas)
      try {
        const client = getServerSupabase();
        let sbQuery = client
          .from('events')
          .select('id, title, slug, summary, why_it_matters, published_at, updated_at, relevance_score, article_count')
          .order('published_at', { ascending: false });

        if (decodedCursor) {
          sbQuery = sbQuery.lt('published_at', decodedCursor.publishedAt).limit(queryLimit);
        } else {
          sbQuery = sbQuery.range(offset, offset + queryLimit - 1);
        }

        const { data, error } = await withSpan(traceCtx, 'sb_events', async () => sbQuery);

        if (!error && Array.isArray(data)) {
          const hasMore = data.length > limit;
          const pageData = hasMore ? data.slice(0, limit) : data;
          const lastRow = pageData.length > 0 ? pageData[pageData.length - 1] : null;
          const nextCursor = hasMore && lastRow ? encodeEventCursor(lastRow.published_at, String(lastRow.id)) : null;

          const sbEntitiesByEvent = new Map<string, any[]>();
          const sbSourcesByEvent = new Map<string, any[]>();
          const sbImageByEvent = new Map<string, string>();
          const eventIds = pageData.map((r: any) => String(r.id)).filter(Boolean);

          if (eventIds.length > 0) {
            try {
              const [eeLinksRes, eaLinksRes] = await Promise.all([
                client.from('event_entities').select('event_id, entity_id').in('event_id', eventIds),
                client.from('event_articles').select('event_id, article_id, is_primary').in('event_id', eventIds),
              ]);

              const eeLinks = Array.isArray(eeLinksRes?.data) ? eeLinksRes.data : [];
              const entityIds = Array.from(new Set(eeLinks.map((l: any) => String(l.entity_id)).filter(Boolean)));
              if (entityIds.length > 0) {
                const { data: entRows } = await client
                  .from('entities')
                  .select(ENTITY_SELECT_COLUMNS)
                  .in('id', entityIds)
                  .or('is_active.is.null,is_active.eq.true');
                const entById = new Map((entRows || []).map((e: any) => [String(e.id), mapEntityRecord(e)]));
                for (const link of eeLinks) {
                  const mappedEnt = entById.get(String(link.entity_id));
                  if (mappedEnt) {
                    const list = sbEntitiesByEvent.get(String(link.event_id)) || [];
                    list.push(mappedEnt);
                    sbEntitiesByEvent.set(String(link.event_id), list);
                  }
                }
              }

              const eaLinks = Array.isArray(eaLinksRes?.data) ? eaLinksRes.data : [];
              const articleIds = Array.from(new Set(eaLinks.map((l: any) => String(l.article_id)).filter(Boolean)));
              if (articleIds.length > 0) {
                const { data: artRows } = await client
                  .from('articles')
                  .select('id, source_id, title, url, canonical_url, description, published_at, image_url')
                  .in('id', articleIds);
                const artList = Array.isArray(artRows) ? artRows : [];
                const sourceIds = Array.from(new Set(artList.map((a: any) => String(a.source_id)).filter(Boolean)));
                let srcById = new Map<string, any>();
                if (sourceIds.length > 0) {
                  const { data: srcRows } = await client
                    .from('news_sources')
                    .select(NEWS_SOURCE_SELECT_COLUMNS)
                    .in('id', sourceIds);
                  srcById = new Map((srcRows || []).map((s: any) => [String(s.id), s]));
                }
                const artById = new Map(artList.map((a: any) => [String(a.id), a]));
                for (const link of eaLinks) {
                  const art = artById.get(String(link.article_id));
                  if (!art) continue;
                  const src = srcById.get(String(art.source_id));
                  const evId = String(link.event_id);
                  if (art.image_url && !sbImageByEvent.has(evId)) {
                    sbImageByEvent.set(evId, art.image_url);
                  }
                  const list = sbSourcesByEvent.get(evId) || [];
                  list.push({
                    id: src?.id || art.source_id,
                    sourceName: src?.name || src?.domain || 'Fonte Verificada',
                    domain: src?.domain,
                    logoUrl: src?.logo_url || undefined,
                    headline: art.title,
                    url: art.url,
                    description: art.description,
                    publishedAt: art.published_at
                  });
                  sbSourcesByEvent.set(evId, list);
                }
              }
            } catch (hydrateErr: any) {
              console.warn('[Events API][Supabase fallback] Falha ao hidratar entidades/fontes:', hydrateErr?.message);
            }
          }

          const events = pageData.map((row: any) => {
            const evId = String(row.id);
            const sources = sbSourcesByEvent.get(evId) || [];
            return {
              id: row.id,
              title: row.title,
              slug: row.slug || `evento-${row.id}`,
              summary: row.summary,
              whatHappened: row.summary || row.title,
              whyItMatters: row.why_it_matters || 'Fato em acompanhamento editorial.',
              category: 'Brasil',
              relevanceScore: row.relevance_score || 90,
              imageUrl: sbImageByEvent.get(evId) || null,
              publishedAt: row.published_at,
              updatedAt: row.updated_at,
              relativeTime: 'Recente',
              sourceCountText: `${sources.length || row.article_count || 1} fonte(s)`,
              entities: sbEntitiesByEvent.get(evId) || [],
              sources
            };
          });

          attachTelemetryHeaders(res, traceCtx);
          return sendJson(res, 200, {
            success: true,
            count: events.length,
            limit,
            offset,
            hasMore,
            nextCursor,
            events,
            source: 'supabase_client'
          });
        }
      } catch (sbErr: any) {
        console.warn('[Events API] Supabase fallback falhou:', sbErr?.message);
      }

      // 3. Resposta segura HTTP 200 sem erro 500 para base em inicialização ou vazia
      attachTelemetryHeaders(res, traceCtx);
      return sendJson(res, 200, {
        success: true,
        count: 0,
        nextCursor: null,
        events: [],
        message: 'Nenhum acontecimento registrado até o momento.'
      });
    } catch (err: any) {
      console.error('[Events Handler Fatal Error]', err);
      // NUNCA disparar 500 não tratado para o cliente
      return sendJson(res, 200, {
        success: true,
        count: 0,
        events: [],
        warning: 'Falha temporária ao consultar banco de dados.',
        error: err?.message
      });
    }
  }

  return sendJson(res, 405, { error: 'Método não permitido.' });
}
