/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — Motor Canônico de Ingestão, Deduplicação e Agrupamento de Notícias Reais V1.1
 * 
 * Esquema Canônico Real no PostgreSQL (Supabase):
 * - public.news_sources (id UUID, name, slug, domain UNIQUE, logo_url, country_code, language_code, authority_score, is_active, created_at, updated_at)
 * - public.articles (id UUID, source_id UUID, canonical_url, url UNIQUE, title, description, author, image_url, language_code, published_at, created_at, updated_at, search_vector)
 * - public.events (id UUID, title, slug NOT NULL, summary, why_it_matters, status, relevance_score, primary_article_id UUID, article_count, first_seen_at, last_updated_at, published_at, created_at, updated_at, key_points, revision, content_hash, enrichment_status, search_vector)
 * - public.event_articles (event_id UUID, article_id UUID, similarity_score, is_primary, created_at, PRIMARY KEY (event_id, article_id))
 * - public.topics (id, name, slug, category, brand_color, created_at)
 * - public.event_topics (event_id UUID, topic_id, PRIMARY KEY (event_id, topic_id))
 */

import crypto from 'crypto';
import { executeSql, withTransaction, isPostgresConfigured } from './postgres.js';
import { getServerKeys, isAllowedDomain } from './common.js';

// Namespace fixo oficial para UUID v5 (FatosBR News Engine)
const FATOSBR_NAMESPACE_UUID = '8f4c2c10-9b42-5f8e-a612-4f81023a845d';

export interface UpstreamArticle {
  title: string;
  url: string;
  canonicalUrl: string;
  description: string;
  sourceName: string;
  domain: string;
  author?: string;
  imageUrl?: string;
  publishedAt: string;
  category: string;
  topicSlug: string;
}

export interface IngestionResult {
  success: boolean;
  articlesFetched: number;
  deduplicatedCount: number;
  articlesPersisted: number;
  eventsCreated: number;
  eventsUpdated: number;
  sourcesUpserted: number;
  durationMs: number;
  providers: Record<string, { configured: boolean; count: number; error?: string }>;
  error?: string;
}

/**
 * Converte UUID string em Buffer de 16 bytes.
 */
function parseUuidToBuffer(uuidStr: string): Buffer {
  const hex = uuidStr.replace(/-/g, '');
  return Buffer.from(hex, 'hex');
}

/**
 * Gera um UUID v5 canônico determinístico (RFC 4122 v5) baseado em SHA-1 e Namespace estável.
 * Produz identificadores criptograficamente padronizados e 100% compatíveis com PostgreSQL UUID.
 */
export function generateDeterministicUuidV5(name: string, namespace: string = FATOSBR_NAMESPACE_UUID): string {
  const nsBuffer = parseUuidToBuffer(namespace);
  const nameBuffer = Buffer.from(name, 'utf8');

  const hash = crypto.createHash('sha1').update(nsBuffer).update(nameBuffer).digest();

  // Define bits de versão 5 (0x50) e variante RFC 4122 (0x80)
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString('hex', 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Alias de retrocompatibilidade
export const generateDeterministicUuid = generateDeterministicUuidV5;

/**
 * Normaliza e sanitiza URLs eliminando parâmetros de telemetria (UTM, fbclid, etc.) e âncoras.
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    u.hash = '';
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'source', 'platform', 'sp_attack'
    ];
    for (const p of trackingParams) {
      u.searchParams.delete(p);
    }
    // Remove barras finais redundantes
    return u.toString().replace(/\/+$/, '');
  } catch {
    return rawUrl.trim().replace(/\/+$/, '');
  }
}

/**
 * Gera slug sem caracteres especiais compatível com índices únicos e SEO.
 */
export function generateSlug(text: string, maxLength = 80): string {
  const clean = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  const truncated = clean.slice(0, maxLength).replace(/-+$/, '');
  return truncated || 'noticia-geral';
}

/**
 * Categorização lexical em português para definição temática canônica.
 */
export function detectCategory(title: string, description: string): { category: string; topicSlug: string } {
  const text = `${title} ${description}`.toLowerCase();

  if (text.includes('ia') || text.includes('inteligencia artificial') || text.includes('tecnologia') ||
      text.includes('apple') || text.includes('google') || text.includes('software') ||
      text.includes('nvidia') || text.includes('semicondutor') || text.includes('openai') || text.includes('meta')) {
    return { category: 'Tecnologia', topicSlug: 'tecnologia' };
  }
  if (text.includes('dolar') || text.includes('inflacao') || text.includes('selic') ||
      text.includes('juros') || text.includes('banco') || text.includes('mercado') ||
      text.includes('ibovespa') || text.includes('economia') || text.includes('petrobras') ||
      text.includes('vale') || text.includes('acoes') || text.includes('pib')) {
    return { category: 'Economia', topicSlug: 'economia' };
  }
  if (text.includes('lula') || text.includes('stf') || text.includes('senado') ||
      text.includes('congresso') || text.includes('governo') || text.includes('politica') ||
      text.includes('lei') || text.includes('pec') || text.includes('eleicoes')) {
    return { category: 'Política', topicSlug: 'politica' };
  }
  if (text.includes('futebol') || text.includes('copa') || text.includes('gol') ||
      text.includes('selecao') || text.includes('campeonato') || text.includes('flamengo') || text.includes('palmeiras')) {
    return { category: 'Esportes', topicSlug: 'esportes' };
  }
  if (text.includes('escola') || text.includes('professor') || text.includes('saude') ||
      text.includes('clima') || text.includes('meio ambiente') || text.includes('educacao') || text.includes('sus')) {
    return { category: 'Sociedade', topicSlug: 'sociedade' };
  }

  return { category: 'Brasil', topicSlug: 'brasil' };
}

/**
 * Coleta matérias reais de provedores de notícias com timeout estrito e isolamento de falhas.
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
                try { domain = new URL(art.url).hostname.replace(/^www\./, '').toLowerCase(); } catch {}
                const canUrl = canonicalizeUrl(art.url);
                const desc = String(art.description || art.content || art.title || '').trim();
                const cat = detectCategory(art.title, desc);

                collected.push({
                  title: String(art.title).trim(),
                  url: art.url,
                  canonicalUrl: canUrl,
                  description: desc,
                  sourceName: art.source?.name || domain,
                  domain,
                  imageUrl: art.image || undefined,
                  publishedAt: art.publishedAt || new Date().toISOString(),
                  category: cat.category,
                  topicSlug: cat.topicSlug
                });
                providers.gnews.count++;
              }
            }
          } else {
            providers.gnews.error = `HTTP ${res.status}`;
          }
        }
      } catch (err: any) {
        providers.gnews.error = err?.message || 'Timeout/Erro de rede';
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
                try { domain = new URL(art.url).hostname.replace(/^www\./, '').toLowerCase(); } catch {}
                const canUrl = canonicalizeUrl(art.url);
                const desc = String(art.description || art.content || art.title || '').trim();
                const cat = detectCategory(art.title, desc);

                collected.push({
                  title: String(art.title).trim(),
                  url: art.url,
                  canonicalUrl: canUrl,
                  description: desc,
                  sourceName: art.source?.name || domain,
                  domain,
                  author: art.author || undefined,
                  imageUrl: art.urlToImage || undefined,
                  publishedAt: art.publishedAt || new Date().toISOString(),
                  category: cat.category,
                  topicSlug: cat.topicSlug
                });
                providers.newsapi.count++;
              }
            }
          } else {
            providers.newsapi.error = `HTTP ${res.status}`;
          }
        }
      } catch (err: any) {
        providers.newsapi.error = err?.message || 'Timeout/Erro de rede';
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
              try { domain = new URL(item.url).hostname.replace(/^www\./, '').toLowerCase(); } catch {}
              const canUrl = canonicalizeUrl(item.url);
              const desc = String(item.text || item.title || '').slice(0, 400).trim();
              const cat = detectCategory(item.title, desc);

              collected.push({
                title: String(item.title).trim(),
                url: item.url,
                canonicalUrl: canUrl,
                description: desc,
                sourceName: domain.split('.')[0].toUpperCase(),
                domain,
                author: item.authors?.[0] || undefined,
                imageUrl: item.image || undefined,
                publishedAt: item.publish_date || new Date().toISOString(),
                category: cat.category,
                topicSlug: cat.topicSlug
              });
              providers.worldnews.count++;
            }
          }
        } else {
          providers.worldnews.error = `HTTP ${res.status}`;
        }
      }
    } catch (err: any) {
      providers.worldnews.error = err?.message || 'Timeout/Erro de rede';
    }
  }

  return { articles: collected, providers };
}

/**
 * Pipeline Canônico Server-Side de Ingestão e Persistência no PostgreSQL.
 * Usa estritamente o esquema real das tabelas:
 * - public.news_sources (sem category / brand_color)
 * - public.articles (com description, sem snippet / category)
 * - public.events (com slug obrigatório, why_it_matters, key_points, primary_article_id)
 * - public.event_articles (com similarity_score, is_primary)
 * - public.event_topics e public.topics
 */
export async function runServerSideIngestion(options?: {
  keywords?: string[];
}): Promise<IngestionResult> {
  const startTime = Date.now();

  if (!isPostgresConfigured()) {
    return {
      success: false,
      articlesFetched: 0,
      deduplicatedCount: 0,
      articlesPersisted: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      sourcesUpserted: 0,
      durationMs: Date.now() - startTime,
      providers: {},
      error: 'PostgreSQL não configurado no ambiente server-side.'
    };
  }

  try {
    // 1. Coleta das matérias reais
    const { articles: rawArticles, providers } = await fetchAllUpstreamArticles(options?.keywords);

    // 2. Deduplicação em memória por canonicalUrl e hash normalizado de título
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const deduplicatedArticles: UpstreamArticle[] = [];

    for (const art of rawArticles) {
      if (!art.title || art.title.length < 6) continue;
      const normTitle = art.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 36);

      if (seenUrls.has(art.canonicalUrl) || seenTitles.has(normTitle)) continue;
      seenUrls.add(art.canonicalUrl);
      seenTitles.add(normTitle);
      deduplicatedArticles.push(art);
    }

    if (deduplicatedArticles.length === 0) {
      return {
        success: true,
        articlesFetched: rawArticles.length,
        deduplicatedCount: 0,
        articlesPersisted: 0,
        eventsCreated: 0,
        eventsUpdated: 0,
        sourcesUpserted: 0,
        durationMs: Date.now() - startTime,
        providers
      };
    }

    let sourcesUpserted = 0;
    let articlesPersisted = 0;
    let eventsCreated = 0;
    let eventsUpdated = 0;

    // 3. Execução em Transação Atômica Parametrizada
    await withTransaction(async (client) => {
      // 3.1 Garantir existência dos tópicos em public.topics com UUID v5 determinístico
      const topicCategories = [
        { name: 'Tecnologia', slug: 'tecnologia', category: 'Tecnologia', color: '#3b82f6' },
        { name: 'Economia', slug: 'economia', category: 'Economia', color: '#10b981' },
        { name: 'Política', slug: 'politica', category: 'Política', color: '#ef4444' },
        { name: 'Esportes', slug: 'esportes', category: 'Esportes', color: '#f59e0b' },
        { name: 'Sociedade', slug: 'sociedade', category: 'Sociedade', color: '#8b5cf6' },
        { name: 'Brasil', slug: 'brasil', category: 'Brasil', color: '#06b6d4' }
      ];

      const topicMap = new Map<string, string>(); // slug -> topic UUID

      for (const t of topicCategories) {
        const topicUuid = generateDeterministicUuidV5(`topic:${t.slug}`);
        const res = await client.query(
          `INSERT INTO public.topics (id, name, slug, category, brand_color, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (slug) DO UPDATE SET
             name = EXCLUDED.name,
             category = EXCLUDED.category,
             brand_color = EXCLUDED.brand_color
           RETURNING id`,
          [topicUuid, t.name, t.slug, t.category, t.color]
        );
        const realTopicId = res.rows[0]?.id || topicUuid;
        topicMap.set(t.slug, realTopicId);
      }

      // 3.2 Upsert de Fontes em public.news_sources (usando colunas REAIS)
      const sourceMap = new Map<string, string>(); // domain -> id UUID

      for (const art of deduplicatedArticles) {
        if (sourceMap.has(art.domain)) continue;

        const sourceUuid = generateDeterministicUuidV5(`source:${art.domain}`);
        const sourceSlug = generateSlug(art.sourceName || art.domain, 50);

        const srcRes = await client.query(
          `INSERT INTO public.news_sources (
            id, name, slug, domain, country_code, language_code, authority_score, is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'BR', 'pt', 80, true, NOW(), NOW())
          ON CONFLICT (domain) DO UPDATE SET
            name = EXCLUDED.name,
            updated_at = NOW()
          RETURNING id`,
          [sourceUuid, art.sourceName, sourceSlug, art.domain]
        );

        const realSourceId = srcRes.rows[0]?.id || sourceUuid;
        sourceMap.set(art.domain, realSourceId);
        sourcesUpserted++;
      }

      // 3.3 Inserção / Upsert de Matérias em public.articles (usando colunas REAIS e constraint canonical_url)
      interface SavedArticleRecord {
        id: string;
        article: UpstreamArticle;
        isNew: boolean;
      }
      const savedArticles: SavedArticleRecord[] = [];

      for (const art of deduplicatedArticles) {
        const sourceId = sourceMap.get(art.domain) || generateDeterministicUuidV5(`source:${art.domain}`);
        const articleUuid = generateDeterministicUuidV5(`article:${art.canonicalUrl}`);

        const artRes = await client.query(
          `INSERT INTO public.articles (
            id, source_id, canonical_url, url, title, description, author, image_url,
            language_code, published_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pt', $9, NOW(), NOW())
          ON CONFLICT (canonical_url) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            url = EXCLUDED.url,
            image_url = COALESCE(EXCLUDED.image_url, public.articles.image_url),
            updated_at = NOW()
          RETURNING id, (xmax = 0) AS is_new`,
          [
            articleUuid,
            sourceId,
            art.canonicalUrl,
            art.url,
            art.title,
            art.description,
            art.author || null,
            art.imageUrl || null,
            art.publishedAt ? new Date(art.publishedAt) : new Date()
          ]
        );

        const savedId = artRes.rows[0]?.id || articleUuid;
        const isNew = Boolean(artRes.rows[0]?.is_new);
        savedArticles.push({ id: savedId, article: art, isNew });
        if (isNew) articlesPersisted++;
      }

      // 3.4 Agrupamento Canônico em Acontecimentos (Event Clusters)
      // Agrupa artigos que compartilham contexto temático e palavras-chave específicas
      interface ClusterGroup {
        anchorArticle: SavedArticleRecord;
        relatedArticles: SavedArticleRecord[];
        category: string;
        topicSlug: string;
      }

      const clusters: ClusterGroup[] = [];
      const assigned = new Set<string>();

      for (let i = 0; i < savedArticles.length; i++) {
        const current = savedArticles[i];
        if (assigned.has(current.id)) continue;
        assigned.add(current.id);

        const cluster: ClusterGroup = {
          anchorArticle: current,
          relatedArticles: [current],
          category: current.article.category,
          topicSlug: current.article.topicSlug
        };

        const anchorWords = new Set(
          current.article.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 4)
        );

        for (let j = i + 1; j < savedArticles.length; j++) {
          const candidate = savedArticles[j];
          if (assigned.has(candidate.id)) continue;

          if (candidate.article.topicSlug === current.article.topicSlug) {
            const candWords = candidate.article.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 4);
            const shared = candWords.filter(w => anchorWords.has(w));
            if (shared.length >= 2) {
              cluster.relatedArticles.push(candidate);
              assigned.add(candidate.id);
            }
          }
        }

        clusters.push(cluster);
      }

      // 3.5 Persistência de Acontecimentos em public.events (usando colunas REAIS)
      for (const cl of clusters) {
        const primary = cl.anchorArticle;
        // Identidade estável do acontecimento baseada na âncora canônica permanente
        const eventUuid = generateDeterministicUuidV5(`event:${primary.article.canonicalUrl}`);
        const baseSlug = generateSlug(primary.article.title, 70);
        const eventSlug = `${baseSlug}-${eventUuid.slice(0, 8)}`;

        const summary = primary.article.description || primary.article.title;
        const whyItMatters = `Cobertura confirmada por ${cl.relatedArticles.length} fonte(s) independente(s) com relevância para ${cl.category} no Brasil.`;
        const relevanceScore = Math.min(98, 85 + cl.relatedArticles.length * 3);

        const keyPoints = JSON.stringify(
          cl.relatedArticles.slice(0, 4).map(r => `• ${r.article.title} (${r.article.sourceName})`)
        );

        // Status em conformidade com o CHECK constraint: 'DEVELOPING', 'CONFIRMED', 'UPDATED', 'ARCHIVED'
        const eventStatus = cl.relatedArticles.length >= 3 ? 'CONFIRMED' : 'DEVELOPING';
        // Enrichment status em conformidade com o CHECK constraint: 'PENDING', 'FAILED', 'COMPLETED'
        const enrichmentStatus = 'PENDING';

        // Verifica se o evento já existe
        const existingEvt = await client.query(
          `SELECT id, article_count FROM public.events WHERE id = $1 LIMIT 1`,
          [eventUuid]
        );

        if (existingEvt.rows.length === 0) {
          // Inserção de Novo Acontecimento
          await client.query(
            `INSERT INTO public.events (
              id, title, slug, summary, why_it_matters, status, relevance_score,
              primary_article_id, article_count, first_seen_at, last_updated_at,
              published_at, created_at, updated_at, key_points, revision, enrichment_status
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              $8, $9, NOW(), NOW(),
              $10, NOW(), NOW(), $11, 1, $12
            )`,
            [
              eventUuid,
              primary.article.title,
              eventSlug,
              summary,
              whyItMatters,
              eventStatus,
              relevanceScore,
              primary.id,
              cl.relatedArticles.length,
              primary.article.publishedAt ? new Date(primary.article.publishedAt) : new Date(),
              keyPoints,
              enrichmentStatus
            ]
          );
          eventsCreated++;
        } else {
          // Atualização de Acontecimento Existente
          const newCount = Math.max(existingEvt.rows[0].article_count || 1, cl.relatedArticles.length);
          await client.query(
            `UPDATE public.events SET
              article_count = $2,
              status = CASE WHEN $2 >= 3 AND status = 'DEVELOPING' THEN 'CONFIRMED' ELSE 'UPDATED' END,
              last_updated_at = NOW(),
              updated_at = NOW(),
              key_points = $3,
              why_it_matters = $4
            WHERE id = $1`,
            [eventUuid, newCount, keyPoints, whyItMatters]
          );
          eventsUpdated++;
        }

        // Relacionar Artigos em public.event_articles
        for (let idx = 0; idx < cl.relatedArticles.length; idx++) {
          const item = cl.relatedArticles[idx];
          const isPrimary = idx === 0;
          const similarityScore = isPrimary ? 1.0 : 0.85;

          await client.query(
            `INSERT INTO public.event_articles (event_id, article_id, similarity_score, is_primary, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (event_id, article_id) DO UPDATE SET
               is_primary = EXCLUDED.is_primary,
               similarity_score = EXCLUDED.similarity_score`,
            [eventUuid, item.id, similarityScore, isPrimary]
          );
        }

        // Relacionar com public.event_topics usando o UUID real do tópico
        const realTopicId = topicMap.get(cl.topicSlug) || generateDeterministicUuidV5(`topic:${cl.topicSlug}`);
        await client.query(
          `INSERT INTO public.event_topics (event_id, topic_id)
           VALUES ($1, $2)
           ON CONFLICT (event_id, topic_id) DO NOTHING`,
          [eventUuid, realTopicId]
        );
      }
    });

    return {
      success: true,
      articlesFetched: rawArticles.length,
      deduplicatedCount: deduplicatedArticles.length,
      articlesPersisted,
      eventsCreated,
      eventsUpdated,
      sourcesUpserted,
      durationMs: Date.now() - startTime,
      providers
    };
  } catch (err: any) {
    console.error('[Canonical Ingestion Error]', err);
    return {
      success: false,
      articlesFetched: 0,
      deduplicatedCount: 0,
      articlesPersisted: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      sourcesUpserted: 0,
      durationMs: Date.now() - startTime,
      providers: {},
      error: err?.message || 'Falha no ciclo canônico de ingestão'
    };
  }
}
