/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Events & Ingestion Proxy Handler
 * Provides canonical persistence and querying for real news events in PostgreSQL / Supabase.
 */

import { executeSql, isPostgresConfigured } from '../../postgres';
import { getServerSupabase, isDatabaseConfigured } from '../../db';
import { sendJson, setCorsHeaders, readJsonBody } from '../../common';
import { enforceRateLimit } from '../../rateLimiter';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  // ROTA 1: GET /api/proxy/events -> Retorna acontecimentos canônicos persistidos
  if (req.method === 'GET' && (pathname.includes('/events') || pathname.includes('/feed'))) {
    const rateLimitAllowed = await enforceRateLimit(req, res, 'general');
    if (!rateLimitAllowed) return;

    try {
      const limit = Math.min(50, Math.max(1, parseInt(urlObj.searchParams.get('limit') || '30', 10)));
      const category = urlObj.searchParams.get('category');

      // 1. Tentar PostgreSQL nativo se configurado
      if (isPostgresConfigured()) {
        let query = `
          SELECT 
            e.id, e.title, e.summary, e.what_happened, e.why_it_matters,
            e.category, e.relevance_score, e.image_url, e.published_at, e.updated_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', es.source_id,
                  'sourceName', es.source_name,
                  'domain', es.domain,
                  'headline', es.headline,
                  'url', es.url,
                  'publishedAt', es.published_at
                )
              ) FILTER (WHERE es.source_id IS NOT NULL),
              '[]'::json
            ) as sources
          FROM public.events e
          LEFT JOIN public.event_sources es ON e.id = es.event_id
        `;
        const params: any[] = [];

        if (category && category !== 'Todos') {
          query += ` WHERE e.category = $1 GROUP BY e.id ORDER BY e.published_at DESC LIMIT $2`;
          params.push(category, limit);
        } else {
          query += ` GROUP BY e.id ORDER BY e.published_at DESC LIMIT $1`;
          params.push(limit);
        }

        const dbRes = await executeSql(query, params);
        const mapped = dbRes.rows.map((row: any) => ({
          id: row.id,
          title: row.title,
          summary: row.summary,
          whatHappened: row.what_happened,
          whyItMatters: row.why_it_matters,
          category: row.category,
          relevanceScore: row.relevance_score || 90,
          imageUrl: row.image_url,
          publishedAt: row.published_at,
          updatedAt: row.updated_at,
          relativeTime: 'Recente',
          sourceCountText: `${(row.sources || []).length || 1} fontes`,
          sources: row.sources || []
        }));

        return sendJson(res, 200, {
          success: true,
          count: mapped.length,
          events: mapped,
          source: 'postgresql'
        });
      }

      // 2. Tentar Supabase Client server-side
      try {
        const client = getServerSupabase();
        let queryBuilder = client
          .from('events')
          .select('*, event_sources(*)')
          .order('published_at', { ascending: false })
          .limit(limit);

        if (category && category !== 'Todos') {
          queryBuilder = queryBuilder.eq('category', category);
        }

        const { data, error } = await queryBuilder;
        if (error) {
          throw error;
        }

        const events = (data || []).map((row: any) => ({
          id: row.id,
          title: row.title,
          summary: row.summary,
          whatHappened: row.what_happened,
          whyItMatters: row.why_it_matters,
          category: row.category,
          relevanceScore: row.relevance_score || 90,
          imageUrl: row.image_url,
          publishedAt: row.published_at,
          updatedAt: row.updated_at,
          relativeTime: 'Recente',
          sourceCountText: `${(row.event_sources || []).length || 1} fontes`,
          sources: (row.event_sources || []).map((s: any) => ({
            id: s.source_id,
            sourceName: s.source_name,
            domain: s.domain,
            headline: s.headline,
            url: s.url,
            publishedAt: s.published_at
          }))
        }));

        return sendJson(res, 200, {
          success: true,
          count: events.length,
          events,
          source: 'supabase_client'
        });
      } catch (clientErr: any) {
        console.warn('[Events API] Supabase client query falhou:', clientErr?.message);
      }

      // Se nenhum banco estiver configurado
      return sendJson(res, 200, {
        success: true,
        count: 0,
        events: [],
        message: 'Banco de dados de acontecimentos não provisionado.'
      });
    } catch (err: any) {
      console.error('[Events Handler Error]', err);
      return sendJson(res, 500, {
        error: 'FALHA_CONSULTA_ACONTECIMENTOS',
        message: err?.message || 'Erro ao consultar acontecimentos.'
      });
    }
  }

  // ROTA 2: POST /api/proxy/ingest -> Persiste acontecimentos apurados em lote
  if (req.method === 'POST' && (pathname.includes('/ingest') || pathname.includes('/events'))) {
    const rateLimitAllowed = await enforceRateLimit(req, res, 'general');
    if (!rateLimitAllowed) return;

    try {
      const body = await readJsonBody(req);
      const eventsToIngest = body.events || (body.title ? [body] : []);

      if (!Array.isArray(eventsToIngest) || eventsToIngest.length === 0) {
        return sendJson(res, 400, {
          error: 'PAYLOAD_INVALIDO',
          message: 'Nenhum acontecimento fornecido para ingestão.'
        });
      }

      let insertedCount = 0;

      // 1. Persistência via PostgreSQL nativo se configurado
      if (isPostgresConfigured()) {
        for (const evt of eventsToIngest) {
          if (!evt.id || !evt.title) continue;

          // Inserir / Atualizar Evento
          await executeSql(
            `INSERT INTO public.events (
              id, title, summary, what_happened, why_it_matters, category,
              relevance_score, image_url, published_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              summary = EXCLUDED.summary,
              what_happened = EXCLUDED.what_happened,
              why_it_matters = EXCLUDED.why_it_matters,
              category = EXCLUDED.category,
              relevance_score = EXCLUDED.relevance_score,
              image_url = COALESCE(EXCLUDED.image_url, public.events.image_url),
              updated_at = NOW()`,
            [
              evt.id,
              evt.title,
              evt.summary || evt.title,
              evt.whatHappened || '',
              evt.whyItMatters || '',
              evt.category || 'Geral',
              evt.relevanceScore || 90,
              evt.imageUrl || null,
              evt.publishedAt ? new Date(evt.publishedAt) : new Date()
            ]
          );

          // Inserir / Atualizar Fontes associadas
          if (Array.isArray(evt.sources)) {
            for (const src of evt.sources) {
              if (!src.url || !src.domain) continue;
              const sourceId = `src-${src.domain.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;

              // Garantir existência da fonte em public.sources
              await executeSql(
                `INSERT INTO public.sources (id, name, domain, category)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (id) DO NOTHING`,
                [sourceId, src.sourceName || src.domain, src.domain, evt.category || 'Geral']
              ).catch(() => null);

              // Relacionar em public.event_sources
              await executeSql(
                `INSERT INTO public.event_sources (
                  event_id, source_id, source_name, domain, headline, url, published_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (event_id, source_id, url) DO NOTHING`,
                [
                  evt.id,
                  sourceId,
                  src.sourceName || src.domain,
                  src.domain,
                  src.headline || evt.title,
                  src.url,
                  src.publishedAt ? new Date(src.publishedAt) : new Date()
                ]
              ).catch(() => null);
            }
          }

          insertedCount++;
        }

        return sendJson(res, 200, {
          success: true,
          ingested: insertedCount,
          totalSubmitted: eventsToIngest.length,
          storage: 'postgresql'
        });
      }

      // 2. Persistência via Supabase Client
      try {
        const client = getServerSupabase();
        const upsertData = eventsToIngest.map((evt: any) => ({
          id: evt.id,
          title: evt.title,
          summary: evt.summary || evt.title,
          what_happened: evt.whatHappened || '',
          why_it_matters: evt.whyItMatters || '',
          category: evt.category || 'Geral',
          relevance_score: evt.relevanceScore || 90,
          image_url: evt.imageUrl || null,
          published_at: evt.publishedAt ? new Date(evt.publishedAt) : new Date()
        }));

        const { error } = await client.from('events').upsert(upsertData, { onConflict: 'id' });
        if (error) throw error;

        return sendJson(res, 200, {
          success: true,
          ingested: eventsToIngest.length,
          storage: 'supabase_client'
        });
      } catch (clientErr: any) {
        console.warn('[Ingest API] Supabase client upsert falhou:', clientErr?.message);
      }

      return sendJson(res, 200, {
        success: true,
        ingested: 0,
        message: 'Banco de dados não configurado para persistência permanente.'
      });
    } catch (err: any) {
      console.error('[Ingest Handler Error]', err);
      return sendJson(res, 500, {
        error: 'FALHA_INGESTAO',
        message: err?.message || 'Erro durante a ingestão de acontecimentos.'
      });
    }
  }

  return sendJson(res, 405, { error: 'Método não permitido.' });
}
