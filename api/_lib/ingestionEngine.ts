/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — Motor de Ingestão e Persistência Canônica Server-Side V1
 * 
 * Arquitetura de Dados em Produção:
 * - public.events (id UUID, title TEXT, summary TEXT, published_at TIMESTAMPTZ, relevance_score INT)
 * - public.articles (id UUID, title TEXT, url TEXT UNIQUE, snippet TEXT, source_id UUID, image_url TEXT, category TEXT, published_at TIMESTAMPTZ)
 * - public.news_sources (id UUID, name TEXT, domain TEXT UNIQUE, category TEXT, brand_color TEXT)
 * - public.event_articles (event_id UUID, article_id UUID, PRIMARY KEY (event_id, article_id))
 * - public.event_topics (event_id UUID, topic_id TEXT/UUID)
 * - public.event_entities (event_id UUID, entity_id TEXT/UUID)
 */

import { executeSql, isPostgresConfigured } from './postgres';
import { getServerKeys, isAllowedDomain } from './common';

export interface UpstreamArticle {
  title: string;
  url: string;
  snippet: string;
  sourceName: string;
  domain: string;
  imageUrl?: string;
  publishedAt: string;
  category: string;
}

export interface IngestionResult {
  success: boolean;
  articlesFetched: number;
  deduplicatedCount: number;
  eventsCreated: number;
  sourcesUpserted: number;
  durationMs: number;
  providers: Record<string, { configured: boolean; count: number; error?: string }>;
  error?: string;
}

/**
 * Gera um UUID RFC 4122 v4 determinístico e estável baseado numa seed única (URL ou chave).
 * Garante que a mesma matéria ou cluster sempre produza o mesmo UUID no PostgreSQL.
 */
export function generateDeterministicUuid(seed: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  let h3 = 0x12345678, h4 = 0x87654321;
  for (let i = seed.length - 1; i >= 0; i--) {
    const ch = seed.charCodeAt(i);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }

  const hex = [h1, h2, h3, h4]
    .map(n => (n >>> 0).toString(16).padStart(8, '0'))
    .join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Limpa e normaliza uma URL removendo parâmetros de rastreamento (UTM, fbclid, etc.)
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    const dropParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref'];
    for (const p of dropParams) {
      u.searchParams.delete(p);
    }
    return u.toString().replace(/\/+$/, '');
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Classifica a categoria de uma notícia com base lexical em português
 */
export function detectCategory(title: string, snippet: string): string {
  const text = `${title} ${snippet}`.toLowerCase();
  if (text.includes('ia') || text.includes('inteligência artificial') || text.includes('tecnologia') || text.includes('apple') || text.includes('google') || text.includes('software') || text.includes('nvidia') || text.includes('semicondutor') || text.includes('openai') || text.includes('meta')) {
    return 'Tecnologia & IA';
  }
  if (text.includes('dólar') || text.includes('inflação') || text.includes('selic') || text.includes('juros') || text.includes('banco') || text.includes('mercado') || text.includes('ibovespa') || text.includes('economia') || text.includes('petrobras') || text.includes('vale') || text.includes('ações')) {
    return 'Economia';
  }
  if (text.includes('lula') || text.includes('stf') || text.includes('senado') || text.includes('congresso') || text.includes('governo') || text.includes('política') || text.includes('lei') || text.includes('pec')) {
    return 'Política';
  }
  if (text.includes('futebol') || text.includes('copa') || text.includes('gol') || text.includes('seleção') || text.includes('campeonato') || text.includes('flamengo')) {
    return 'Esportes';
  }
  if (text.includes('escola') || text.includes('professor') || text.includes('saúde') || text.includes('clima') || text.includes('meio ambiente') || text.includes('educação') || text.includes('sus')) {
    return 'Educação & Sociedade';
  }
  return 'Brasil & Atualidades';
}

/**
 * Coleta matérias reais de múltiplos provedores upstream com isolamento de falhas
 */
export async function fetchAllUpstreamArticles(keywords = ['brasil', 'economia', 'tecnologia']): Promise<{
  articles: UpstreamArticle[];
  providers: Record<string, { configured: boolean; count: number; error?: string }>;
}> {
  const keys = getServerKeys();
  const collected: UpstreamArticle[] = [];
  const providers: Record<string, { configured: boolean; count: number; error?: string }> = {
    gnews: { configured: Boolean(keys.GNEWS), count: 0 },
    newsapi: { configured: Boolean(keys.NEWSAPI), count: 0 },
    worldnews: { configured: Boolean(keys.WORLD_NEWS), count: 0 }
  };

  // 1. GNews
  if (keys.GNEWS) {
    for (const kw of keywords.slice(0, 2)) {
      try {
        const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(kw)}&lang=pt&country=br&max=10&apikey=${keys.GNEWS}`;
        if (isAllowedDomain(url)) {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 6000);
          const res = await fetch(url, { signal: ctrl.signal });
          clearTimeout(to);

          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.articles)) {
              for (const art of data.articles) {
                if (!art.title || !art.url) continue;
                let domain = 'gnews.io';
                try { domain = new URL(art.url).hostname.replace('www.', ''); } catch {}
                collected.push({
                  title: String(art.title).trim(),
                  url: canonicalizeUrl(art.url),
                  snippet: String(art.description || art.content || art.title || '').trim(),
                  sourceName: art.source?.name || domain,
                  domain,
                  imageUrl: art.image || undefined,
                  publishedAt: art.publishedAt || new Date().toISOString(),
                  category: detectCategory(art.title, art.description || '')
                });
                providers.gnews.count++;
              }
            }
          } else {
            providers.gnews.error = `HTTP ${res.status}`;
          }
        }
      } catch (err: any) {
        providers.gnews.error = err?.message || 'Timeout/Erro de conexão';
      }
    }
  }

  // 2. NewsAPI
  if (keys.NEWSAPI) {
    for (const kw of keywords.slice(0, 2)) {
      try {
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(kw)}&pageSize=10&apiKey=${keys.NEWSAPI}`;
        if (isAllowedDomain(url)) {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 6000);
          const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'FatosBR-Engine/1.0' }
          });
          clearTimeout(to);

          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.articles)) {
              for (const art of data.articles) {
                if (!art.title || !art.url || art.title.includes('[Removed]')) continue;
                let domain = 'newsapi.org';
                try { domain = new URL(art.url).hostname.replace('www.', ''); } catch {}
                collected.push({
                  title: String(art.title).trim(),
                  url: canonicalizeUrl(art.url),
                  snippet: String(art.description || art.content || art.title || '').trim(),
                  sourceName: art.source?.name || domain,
                  domain,
                  imageUrl: art.urlToImage || undefined,
                  publishedAt: art.publishedAt || new Date().toISOString(),
                  category: detectCategory(art.title, art.description || '')
                });
                providers.newsapi.count++;
              }
            }
          } else {
            providers.newsapi.error = `HTTP ${res.status}`;
          }
        }
      } catch (err: any) {
        providers.newsapi.error = err?.message || 'Timeout/Erro de conexão';
      }
    }
  }

  // 3. World News API
  if (keys.WORLD_NEWS) {
    try {
      const url = `https://api.worldnewsapi.com/search-news?text=brasil&language=pt&number=10&api-key=${keys.WORLD_NEWS}`;
      if (isAllowedDomain(url)) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(to);

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.news)) {
            for (const item of data.news) {
              if (!item.title || !item.url) continue;
              let domain = 'worldnewsapi.com';
              try { domain = new URL(item.url).hostname.replace('www.', ''); } catch {}
              collected.push({
                title: String(item.title).trim(),
                url: canonicalizeUrl(item.url),
                snippet: String(item.text || item.title || '').slice(0, 300).trim(),
                sourceName: domain.split('.')[0].toUpperCase(),
                domain,
                imageUrl: item.image || undefined,
                publishedAt: item.publish_date || new Date().toISOString(),
                category: detectCategory(item.title, item.text || '')
              });
              providers.worldnews.count++;
            }
          }
        } else {
          providers.worldnews.error = `HTTP ${res.status}`;
        }
      }
    } catch (err: any) {
      providers.worldnews.error = err?.message || 'Timeout/Erro de conexão';
    }
  }

  return { articles: collected, providers };
}

/**
 * Executa o ciclo completo de ingestão e persistência no PostgreSQL de produção
 */
export async function runServerSideIngestion(options?: {
  keywords?: string[];
  runAi?: boolean;
}): Promise<IngestionResult> {
  const startTime = Date.now();

  if (!isPostgresConfigured()) {
    return {
      success: false,
      articlesFetched: 0,
      deduplicatedCount: 0,
      eventsCreated: 0,
      sourcesUpserted: 0,
      durationMs: Date.now() - startTime,
      providers: {},
      error: 'PostgreSQL não configurado no ambiente server-side.'
    };
  }

  try {
    // 1. Coleta direta dos provedores
    const { articles: rawArticles, providers } = await fetchAllUpstreamArticles(options?.keywords);

    // 2. Deduplicação estrita
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const uniqueArticles: UpstreamArticle[] = [];

    for (const art of rawArticles) {
      const normTitle = art.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
      if (seenUrls.has(art.url) || seenTitles.has(normTitle)) continue;
      seenUrls.add(art.url);
      seenTitles.add(normTitle);
      uniqueArticles.push(art);
    }

    if (uniqueArticles.length === 0) {
      return {
        success: true,
        articlesFetched: rawArticles.length,
        deduplicatedCount: 0,
        eventsCreated: 0,
        sourcesUpserted: 0,
        durationMs: Date.now() - startTime,
        providers
      };
    }

    let sourcesUpserted = 0;
    let articlesSaved = 0;
    let eventsCreated = 0;

    // Cache local de news_sources (domain -> UUID)
    const sourceMap = new Map<string, string>();

    // 3. Upsert em public.news_sources
    for (const art of uniqueArticles) {
      if (sourceMap.has(art.domain)) continue;
      const sourceUuid = generateDeterministicUuid(`src:${art.domain}`);

      try {
        await executeSql(
          `INSERT INTO public.news_sources (id, name, domain, category, brand_color, created_at)
           VALUES ($1, $2, $3, $4, '#64748b', NOW())
           ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [sourceUuid, art.sourceName, art.domain, art.category]
        );
        sourceMap.set(art.domain, sourceUuid);
        sourcesUpserted++;
      } catch {
        // Tenta buscar ID existente caso o conflito seja tratado
        try {
          const existing = await executeSql(`SELECT id FROM public.news_sources WHERE domain = $1 LIMIT 1`, [art.domain]);
          if (existing.rows[0]?.id) {
            sourceMap.set(art.domain, existing.rows[0].id);
          }
        } catch {}
      }
    }

    // 4. Inserção em public.articles
    const savedArticleIds: { articleId: string; article: UpstreamArticle }[] = [];

    for (const art of uniqueArticles) {
      const sourceId = sourceMap.get(art.domain) || generateDeterministicUuid(`src:${art.domain}`);
      const articleUuid = generateDeterministicUuid(`art:${art.url}`);

      try {
        const artRes = await executeSql(
          `INSERT INTO public.articles (id, title, url, snippet, source_id, image_url, category, published_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, snippet = EXCLUDED.snippet
           RETURNING id`,
          [
            articleUuid,
            art.title,
            art.url,
            art.snippet || art.title,
            sourceId,
            art.imageUrl || null,
            art.category,
            art.publishedAt ? new Date(art.publishedAt) : new Date()
          ]
        );

        const realId = artRes.rows[0]?.id || articleUuid;
        savedArticleIds.push({ articleId: realId, article: art });
        articlesSaved++;
      } catch (insertErr: any) {
        // Se já existe, recupera ID
        try {
          const ex = await executeSql(`SELECT id FROM public.articles WHERE url = $1 LIMIT 1`, [art.url]);
          if (ex.rows[0]?.id) {
            savedArticleIds.push({ articleId: ex.rows[0].id, article: art });
          }
        } catch {}
      }
    }

    // 5. Agrupamento em Acontecimentos (Event Clusters)
    // Agrupa artigos que compartilham a mesma categoria e palavras-chave
    const clusters: { eventId: string; title: string; summary: string; publishedAt: string; relevanceScore: number; articles: string[] }[] = [];
    const usedIndices = new Set<number>();

    for (let i = 0; i < savedArticleIds.length; i++) {
      if (usedIndices.has(i)) continue;
      const primary = savedArticleIds[i];
      usedIndices.add(i);

      const clusterArticles = [primary.articleId];
      const primaryWords = new Set(
        primary.article.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 4)
      );

      for (let j = i + 1; j < savedArticleIds.length; j++) {
        if (usedIndices.has(j)) continue;
        const candidate = savedArticleIds[j];
        if (candidate.article.category === primary.article.category) {
          const candWords = candidate.article.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 4);
          const shared = candWords.filter(w => primaryWords.has(w));
          if (shared.length >= 2) {
            clusterArticles.push(candidate.articleId);
            usedIndices.add(j);
          }
        }
      }

      const clusterSeed = `evt:${primary.article.category}:${primary.article.title.toLowerCase().slice(0, 30)}`;
      const eventUuid = generateDeterministicUuid(clusterSeed);

      clusters.push({
        eventId: eventUuid,
        title: primary.article.title,
        summary: primary.article.snippet || primary.article.title,
        publishedAt: primary.article.publishedAt,
        relevanceScore: Math.min(98, 85 + clusterArticles.length * 3),
        articles: clusterArticles
      });
    }

    // 6. Inserção em public.events e public.event_articles
    for (const cl of clusters) {
      try {
        await executeSql(
          `INSERT INTO public.events (id, title, summary, published_at, updated_at, created_at, relevance_score)
           VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary, updated_at = NOW()`,
          [
            cl.eventId,
            cl.title,
            cl.summary,
            cl.publishedAt ? new Date(cl.publishedAt) : new Date(),
            cl.relevanceScore
          ]
        );

        // Relacionar com public.event_articles
        for (const artId of cl.articles) {
          await executeSql(
            `INSERT INTO public.event_articles (event_id, article_id)
             VALUES ($1, $2)
             ON CONFLICT (event_id, article_id) DO NOTHING`,
            [cl.eventId, artId]
          ).catch(() => null);
        }

        eventsCreated++;
      } catch (evtErr: any) {
        console.error('[Ingest Engine] Erro ao persistir evento:', evtErr?.message);
      }
    }

    return {
      success: true,
      articlesFetched: rawArticles.length,
      deduplicatedCount: uniqueArticles.length,
      eventsCreated,
      sourcesUpserted,
      durationMs: Date.now() - startTime,
      providers
    };
  } catch (err: any) {
    console.error('[Ingest Engine Critical Error]', err);
    return {
      success: false,
      articlesFetched: 0,
      deduplicatedCount: 0,
      eventsCreated: 0,
      sourcesUpserted: 0,
      durationMs: Date.now() - startTime,
      providers: {},
      error: err?.message || 'Erro inesperado na ingestão'
    };
  }
}
