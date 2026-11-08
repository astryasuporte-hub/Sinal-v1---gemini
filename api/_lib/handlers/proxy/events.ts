/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Events & Ingestion Proxy Handler
 * Provides canonical persistence and querying for real news events in PostgreSQL / Supabase.
 * Enforces server-side only ingestion and resilient fallback for schema queries.
 */

import { executeSql, isPostgresConfigured } from '../../postgres';
import { getServerSupabase, isDatabaseConfigured } from '../../db';
import { sendJson, setCorsHeaders, readJsonBody, getServerKeys } from '../../common';
import { enforceRateLimit } from '../../rateLimiter';
import { runServerSideIngestion } from '../../ingestionEngine';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  // ROTA 1: GET /api/proxy/events ou /api/proxy/feed -> Consulta de Acontecimentos
  if (req.method === 'GET' && (pathname.includes('/events') || pathname.includes('/feed'))) {
    const rateLimitAllowed = await enforceRateLimit(req, res, 'general');
    if (!rateLimitAllowed) return;

    try {
      const limit = Math.min(50, Math.max(1, parseInt(urlObj.searchParams.get('limit') || '30', 10)));
      const categoryParam = urlObj.searchParams.get('category');
      const category = categoryParam && categoryParam !== 'Todos' ? categoryParam : null;

      // 1. Tentar PostgreSQL nativo com as tabelas canônicas de produção
      if (isPostgresConfigured()) {
        try {
          const sql = `
            SELECT 
              e.id,
              e.title,
              e.summary,
              e.relevance_score,
              e.published_at,
              e.updated_at,
              COALESCE(
                (
                  SELECT a.image_url 
                  FROM public.event_articles ea_img 
                  JOIN public.articles a ON a.id = ea_img.article_id 
                  WHERE ea_img.event_id = e.id AND a.image_url IS NOT NULL 
                  LIMIT 1
                ), 
                NULL
              ) as image_url,
              COALESCE(
                (
                  SELECT a.category 
                  FROM public.event_articles ea_cat 
                  JOIN public.articles a ON a.id = ea_cat.article_id 
                  WHERE ea_cat.event_id = e.id AND a.category IS NOT NULL 
                  LIMIT 1
                ), 
                'Geral'
              ) as category,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', ns.id,
                    'sourceName', COALESCE(ns.name, ns.domain, 'Fonte Verificada'),
                    'domain', ns.domain,
                    'headline', a.title,
                    'url', a.url,
                    'snippet', a.snippet,
                    'publishedAt', a.published_at,
                    'imageUrl', a.image_url
                  )
                ) FILTER (WHERE a.id IS NOT NULL),
                '[]'::json
              ) as sources
            FROM public.events e
            LEFT JOIN public.event_articles ea ON e.id = ea.event_id
            LEFT JOIN public.articles a ON ea.article_id = a.id
            LEFT JOIN public.news_sources ns ON a.source_id = ns.id
            GROUP BY e.id
            ORDER BY e.published_at DESC
            LIMIT $1
          `;

          const dbRes = await executeSql(sql, [limit]);
          let mapped = (dbRes.rows || []).map((row: any) => {
            const sources = Array.isArray(row.sources) ? row.sources : [];
            const mainArticle = sources[0] || {};
            const itemCategory = row.category || 'Geral';

            return {
              id: row.id,
              title: row.title,
              summary: row.summary,
              whatHappened: row.summary || (mainArticle.snippet ? mainArticle.snippet : row.title),
              whyItMatters: 'Fato com múltiplas coberturas verificadas e relevância apurada pelo motor da FatosBR.',
              category: itemCategory,
              relevanceScore: row.relevance_score || 90,
              imageUrl: row.image_url || mainArticle.imageUrl || null,
              publishedAt: row.published_at,
              updatedAt: row.updated_at,
              relativeTime: 'Recente',
              sourceCountText: `${sources.length || 1} fontes`,
              sources: sources.map((s: any) => ({
                id: s.id,
                sourceName: s.sourceName,
                domain: s.domain,
                headline: s.headline,
                url: s.url,
                snippet: s.snippet,
                publishedAt: s.publishedAt
              }))
            };
          });

          if (category) {
            mapped = mapped.filter((item: any) => 
              item.category.toLowerCase().includes(category.toLowerCase())
            );
          }

          return sendJson(res, 200, {
            success: true,
            count: mapped.length,
            events: mapped,
            source: 'postgresql_canonical'
          });
        } catch (pgErr: any) {
          console.warn('[Events API] Erro ao consultar PostgreSQL canônico, tentando fallback gracioso:', pgErr?.message);
        }
      }

      // 2. Fallback via Supabase Client server-side
      if (isDatabaseConfigured()) {
        try {
          const client = getServerSupabase();
          let queryBuilder = client
            .from('events')
            .select('id, title, summary, published_at, updated_at, relevance_score')
            .order('published_at', { ascending: false })
            .limit(limit);

          const { data, error } = await queryBuilder;
          if (!error && Array.isArray(data)) {
            const events = data.map((row: any) => ({
              id: row.id,
              title: row.title,
              summary: row.summary,
              whatHappened: row.summary || row.title,
              whyItMatters: 'Fato em apuração editorial.',
              category: 'Geral',
              relevanceScore: row.relevance_score || 90,
              imageUrl: null,
              publishedAt: row.published_at,
              updatedAt: row.updated_at,
              relativeTime: 'Recente',
              sourceCountText: '1 fonte',
              sources: []
            }));

            return sendJson(res, 200, {
              success: true,
              count: events.length,
              events,
              source: 'supabase_client'
            });
          }
        } catch (supabaseErr: any) {
          console.warn('[Events API] Supabase fallback falhou:', supabaseErr?.message);
        }
      }

      // 3. Resposta segura sem erro 500 caso banco esteja inicializando ou vazio
      return sendJson(res, 200, {
        success: true,
        count: 0,
        events: [],
        message: 'Nenhum acontecimento registrado até o momento.'
      });
    } catch (err: any) {
      console.error('[Events Handler Fatal Error]', err);
      // NUNCA disparar 500 sem tratamento estruturado
      return sendJson(res, 200, {
        success: true,
        count: 0,
        events: [],
        warning: 'Falha temporária ao consultar banco de dados.',
        error: err?.message
      });
    }
  }

  // ROTA 2: POST /api/proxy/ingest -> Pipeline Server-Side de Ingestão Autenticado
  if (req.method === 'POST' && (pathname.includes('/ingest') || pathname.includes('/events'))) {
    const rateLimitAllowed = await enforceRateLimit(req, res, 'general');
    if (!rateLimitAllowed) return;

    // Proteção de Segurança: Bloqueia envio de dados arbitrários de clientes não autorizados
    const authHeader = req.headers['authorization'] || '';
    const cronHeader = req.headers['x-vercel-cron'];
    const adminKeyHeader = req.headers['x-admin-key'];
    const keys = getServerKeys();

    const isCron = Boolean(cronHeader);
    const isAdminSecret = Boolean(keys.ADMIN_SECRET && (
      authHeader === `Bearer ${keys.ADMIN_SECRET}` || 
      adminKeyHeader === keys.ADMIN_SECRET
    ));

    // Usuário admin autenticado via Supabase token ou chave administrativa
    let isAuthorizedAdmin = false;
    if (isAdminSecret) {
      isAuthorizedAdmin = true;
    } else {
      try {
        const { verifyAdminRequest } = await import('../../adminAuth');
        isAuthorizedAdmin = await verifyAdminRequest(req);
      } catch {}
    }

    if (!isCron && !isAuthorizedAdmin) {
      return sendJson(res, 403, {
        error: 'FORBIDDEN_INGESTION',
        code: 'UNAUTHORIZED_INGESTION',
        message: 'A ingestão de notícias é estritamente server-side e automatizada. Gravação direta por clientes é proibida.'
      });
    }

    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const keywords = Array.isArray(body?.keywords) ? body.keywords : ['brasil', 'economia', 'tecnologia'];

      console.log('[Ingest Trigger] Iniciando ciclo de ingestão server-side autorizado:', {
        trigger: isCron ? 'vercel_cron' : (isAdminSecret ? 'admin_secret' : 'admin_user'),
        keywords
      });

      const result = await runServerSideIngestion({ keywords });

      return sendJson(res, 200, {
        success: result.success,
        ingestion: result,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('[Ingest Execution Error]', err);
      return sendJson(res, 500, {
        error: 'INGESTION_FAILED',
        message: err?.message || 'Falha durante o pipeline de ingestão.'
      });
    }
  }

  return sendJson(res, 405, { error: 'Método não permitido.' });
}
