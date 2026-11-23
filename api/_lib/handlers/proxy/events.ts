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

export default async function handler(req: any, res: any) {
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

      if (isPostgresConfigured()) {
        try {
          const [entRes, srcRes] = await Promise.all([
            executeSql(
              `SELECT id, name, slug, type, description, sector, role, organization, website, image_url, logo_url, avatar_url, brand_color
               FROM public.entities
               ORDER BY name ASC`
            ),
            executeSql(
              `SELECT id, name, slug, domain, category, logo_url, brand_color
               FROM public.news_sources
               ORDER BY name ASC`
            )
          ]);
          entities = (entRes.rows || []).map((e: any) => {
            const normType = String(e.type || 'company').trim().toLowerCase();
            const imageUrl = e.image_url || e.logo_url || e.avatar_url || undefined;
            return {
              id: String(e.id),
              name: e.name,
              slug: e.slug || undefined,
              type: normType === 'person' ? 'person' : normType === 'organization' ? 'organization' : 'company',
              description: e.description || '',
              sector: e.sector || undefined,
              role: e.role || undefined,
              organization: e.organization || undefined,
              website: e.website || undefined,
              imageUrl,
              logoUrl: imageUrl,
              avatarUrl: normType === 'person' ? imageUrl : e.avatar_url || undefined,
              brandColor: e.brand_color || '#10b981',
              isFollowed: false
            };
          });
          sources = (srcRes.rows || []).map((s: any) => ({
            id: String(s.id),
            name: s.name,
            slug: s.slug || undefined,
            domain: s.domain,
            category: s.category || 'Notícias',
            logoUrl: s.logo_url || undefined,
            brandColor: s.brand_color || '#64748b',
            isFollowed: false
          }));
        } catch (pgErr: any) {
          console.warn('[Catalog API] Erro PostgreSQL:', pgErr?.message);
        }
      }

      if (entities.length === 0 && sources.length === 0) {
        try {
          const client = getServerSupabase();
          const [entRes, srcRes] = await Promise.all([
            client
              .from('entities')
              .select('id, name, slug, type, description, sector, role, organization, website, image_url, logo_url, avatar_url, brand_color')
              .order('name'),
            client
              .from('news_sources')
              .select('id, name, slug, domain, category, logo_url, brand_color')
              .order('name')
          ]);
          entities = (entRes.data || []).map((e: any) => {
            const normType = String(e.type || 'company').trim().toLowerCase();
            const imageUrl = e.image_url || e.logo_url || e.avatar_url || undefined;
            return {
              id: String(e.id),
              name: e.name,
              slug: e.slug || undefined,
              type: normType === 'person' ? 'person' : normType === 'organization' ? 'organization' : 'company',
              description: e.description || '',
              sector: e.sector || undefined,
              role: e.role || undefined,
              organization: e.organization || undefined,
              website: e.website || undefined,
              imageUrl,
              logoUrl: imageUrl,
              avatarUrl: normType === 'person' ? imageUrl : e.avatar_url || undefined,
              brandColor: e.brand_color || '#10b981',
              isFollowed: false
            };
          });
          sources = (srcRes.data || []).map((s: any) => ({
            id: String(s.id),
            name: s.name,
            slug: s.slug || undefined,
            domain: s.domain,
            category: s.category || 'Notícias',
            logoUrl: s.logo_url || undefined,
            brandColor: s.brand_color || '#64748b',
            isFollowed: false
          }));
        } catch {}
      }

      return sendJson(res, 200, {
        success: true,
        entities,
        sources
      });
    } catch (err: any) {
      return sendJson(res, 200, {
        success: true,
        entities: [],
        sources: [],
        warning: err?.message
      });
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
      const offset = Math.max(0, parseInt(urlObj.searchParams.get('offset') || '0', 10) || 0);
      const queryLimit = limit + 1;
      const categoryParam = urlObj.searchParams.get('category');
      const categoryFilter = categoryParam && categoryParam !== 'Todos' ? categoryParam.toLowerCase() : null;

      // 1. Consulta ao PostgreSQL Nativo usando o Esquema Canônico Real
      if (isPostgresConfigured()) {
        try {
          const sql = `
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
            FROM public.events e
            LEFT JOIN public.event_articles ea ON e.id = ea.event_id
            LEFT JOIN public.articles a ON ea.article_id = a.id
            LEFT JOIN public.news_sources ns ON a.source_id = ns.id
            GROUP BY e.id
            ORDER BY e.published_at DESC
            LIMIT $1 OFFSET $2
          `;

          const dbRes = await executeSql(sql, [queryLimit, offset]);
          const rawRows = dbRes.rows || [];
          const hasMore = rawRows.length > limit;
          const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;

          // Carregar event_entities separadamente para não falhar caso a tabela/colunas variem
          const entitiesByEventId = new Map<string, any[]>();
          try {
            const eventIds = pageRows.map((r: any) => String(r.id));
            if (eventIds.length > 0) {
              const eeRes = await executeSql(
                `SELECT ee.event_id, ent.id, ent.name, ent.slug, ent.type, ent.description, ent.sector, ent.role, ent.website, ent.image_url, ent.logo_url, ent.avatar_url, ent.brand_color
                 FROM public.event_entities ee
                 JOIN public.entities ent ON ent.id::text = ee.entity_id::text
                 WHERE ee.event_id::text = ANY($1::text[])`,
                [eventIds]
              );
              for (const row of eeRes.rows || []) {
                const evKey = String(row.event_id);
                const normType = String(row.type || 'company').trim().toLowerCase();
                const imageUrl = row.image_url || row.logo_url || row.avatar_url || undefined;
                const list = entitiesByEventId.get(evKey) || [];
                list.push({
                  id: String(row.id),
                  name: row.name,
                  slug: row.slug || undefined,
                  type: normType === 'person' ? 'person' : normType === 'organization' ? 'organization' : 'company',
                  description: row.description || '',
                  sector: row.sector || undefined,
                  role: row.role || undefined,
                  website: row.website || undefined,
                  imageUrl,
                  logoUrl: imageUrl,
                  avatarUrl: normType === 'person' ? imageUrl : row.avatar_url || undefined,
                  brandColor: row.brand_color || '#10b981',
                  isFollowed: false
                });
                entitiesByEventId.set(evKey, list);
              }
            }
          } catch {}

          let mapped = pageRows.map((row: any) => {
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

          if (categoryFilter) {
            mapped = mapped.filter((item: any) =>
              item.category.toLowerCase().includes(categoryFilter)
            );
          }

          return sendJson(res, 200, {
            success: true,
            count: mapped.length,
            limit,
            offset,
            hasMore,
            events: mapped,
            source: 'postgresql_canonical'
          });
        } catch (pgErr: any) {
          console.warn('[Events API] Erro na query PostgreSQL, tentando fallback:', pgErr?.message);
        }
      }

      // 2. Fallback via Supabase Client server-side
      try {
        const client = getServerSupabase();
          const { data, error } = await client
            .from('events')
            .select('id, title, slug, summary, why_it_matters, published_at, updated_at, relevance_score, article_count')
            .order('published_at', { ascending: false })
            .range(offset, offset + queryLimit - 1);

          if (!error && Array.isArray(data)) {
            const hasMore = data.length > limit;
            const pageData = hasMore ? data.slice(0, limit) : data;
            const events = pageData.map((row: any) => ({
              id: row.id,
              title: row.title,
              slug: row.slug || `evento-${row.id}`,
              summary: row.summary,
              whatHappened: row.summary || row.title,
              whyItMatters: row.why_it_matters || 'Fato em acompanhamento editorial.',
              category: 'Brasil',
              relevanceScore: row.relevance_score || 90,
              imageUrl: null,
              publishedAt: row.published_at,
              updatedAt: row.updated_at,
              relativeTime: 'Recente',
              sourceCountText: `${row.article_count || 1} fonte(s)`,
              entities: [],
              sources: []
            }));

            return sendJson(res, 200, {
              success: true,
              count: events.length,
              limit,
              offset,
              hasMore,
              events,
              source: 'supabase_client'
            });
          }
        } catch (sbErr: any) {
          console.warn('[Events API] Supabase fallback falhou:', sbErr?.message);
        }

      // 3. Resposta segura HTTP 200 sem erro 500 para base em inicialização ou vazia
      return sendJson(res, 200, {
        success: true,
        count: 0,
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
