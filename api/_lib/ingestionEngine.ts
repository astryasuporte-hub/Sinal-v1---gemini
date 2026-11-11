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
 * - public.topics (id UUID, name, slug UNIQUE, description, icon, image_url, is_active, is_featured, created_at, updated_at, search_vector)
 * - public.event_topics (event_id UUID, topic_id UUID, PRIMARY KEY (event_id, topic_id))
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
  executionId: string;
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
 * Stop-words em português para filtragem de ruído no agrupamento lexical.
 */
export const PT_STOP_WORDS = new Set([
  'brasil', 'brasileiro', 'brasileira', 'brasileiros', 'governo', 'segundo', 'afirma', 'afirmam',
  'sobre', 'apos', 'diz', 'dizem', 'veja', 'como', 'mais', 'para', 'com', 'por', 'uma', 'uns',
  'umas', 'este', 'esta', 'estes', 'estas', 'esse', 'essa', 'esses', 'essas', 'aquele', 'aquela',
  'aqueles', 'aquelas', 'isso', 'isto', 'aquilo', 'onde', 'quando', 'quem', 'qual', 'quais',
  'cujo', 'cuja', 'cujos', 'cujas', 'entre', 'contra', 'desde', 'ate', 'sem', 'sob', 'tras',
  'pelo', 'pela', 'pelos', 'pelas', 'num', 'numa', 'nuns', 'numas', 'dos', 'das', 'aos',
  'nas', 'nos', 'dele', 'dela', 'deles', 'delas', 'deste', 'desta', 'destes', 'destas',
  'desse', 'dessa', 'desses', 'dessas', 'neste', 'nesta', 'nestes', 'nestas', 'nesse',
  'nessa', 'nesses', 'nessas', 'outro', 'outra', 'outros', 'outras', 'mesmo', 'mesma',
  'mesmos', 'mesmas', 'tanto', 'tanta', 'tantos', 'tantas', 'pouco', 'pouca', 'poucos',
  'poucas', 'muito', 'muita', 'muitos', 'muitas', 'cada', 'tudo', 'nada', 'algo', 'alguem',
  'ninguem', 'tambem', 'ainda', 'sempre', 'nunca', 'jamais', 'agora', 'antes', 'depois',
  'hoje', 'ontem', 'amanha', 'ano', 'anos', 'mes', 'meses', 'dia', 'dias', 'hora', 'horas',
  'tempo', 'caso', 'pode', 'podem', 'deve', 'devem', 'sera', 'serao', 'foi', 'foram', 'era',
  'eram', 'sao', 'tem', 'temos', 'tinha', 'tinham', 'ter', 'estar', 'fazer', 'novo', 'nova',
  'novos', 'novas', 'grande', 'grandes', 'primeiro', 'primeira', 'noticia', 'noticias',
  'entenda', 'saiba', 'confira'
]);

/**
 * Extrai tokens lexicais significativos de um texto, filtrando acentos, caracteres especiais e stop-words.
 */
export function extractSignificantTokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !PT_STOP_WORDS.has(w));
}

/**
 * Calcula afinidade léxica entre duas listas de tokens.
 */
export function calculateTokenSimilarity(tokensA: string[], tokensB: string[]): {
  sharedTokens: string[];
  overlapRatio: number;
  jaccard: number;
} {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 || setB.size === 0) {
    return { sharedTokens: [], overlapRatio: 0, jaccard: 0 };
  }
  const shared: string[] = [];
  for (const t of setA) {
    if (setB.has(t)) {
      shared.push(t);
    }
  }
  const unionSize = new Set([...setA, ...setB]).size;
  const overlapRatio = shared.length / Math.min(setA.size, setB.size);
  const jaccard = unionSize > 0 ? shared.length / unionSize : 0;

  return { sharedTokens: shared, overlapRatio, jaccard };
}

/**
 * Categorização lexical em português para definição temática canônica.
 * Alinhada aos tópicos pré-existentes confirmados no banco Supabase:
 * - tecnologia, inteligencia-artificial, economia, financas, empresas, politica, esportes, ciencia, entretenimento, internacional
 */
export function detectCategory(title: string, description: string): { category: string; topicSlug: string } {
  const text = `${title} ${description}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/\b(ia|ai)\b/.test(text) || text.includes('inteligencia artificial') || text.includes('chatgpt') ||
      text.includes('openai') || text.includes('nvidia') || text.includes('llm') || text.includes('machine learning')) {
    return { category: 'Inteligência Artificial', topicSlug: 'inteligencia-artificial' };
  }
  if (text.includes('tecnologia') || text.includes('apple') || text.includes('google') ||
      text.includes('software') || text.includes('semicondutor') || text.includes('meta') ||
      text.includes('celular') || text.includes('smartphone') || text.includes('computador') || text.includes('app')) {
    return { category: 'Tecnologia', topicSlug: 'tecnologia' };
  }
  if (text.includes('dolar') || text.includes('inflacao') || text.includes('selic') ||
      text.includes('juros') || text.includes('banco central') || text.includes('copom') ||
      text.includes('ibovespa') || text.includes('economia') || text.includes('pib')) {
    return { category: 'Economia', topicSlug: 'economia' };
  }
  if (text.includes('investimento') || text.includes('acoes') || text.includes('mercado financeiro') ||
      text.includes('bolsa de valores') || text.includes('cripto') || text.includes('bitcoin') || text.includes('financas')) {
    return { category: 'Finanças', topicSlug: 'financas' };
  }
  if (text.includes('petrobras') || text.includes('vale') || text.includes('empresas') ||
      text.includes('fusao') || text.includes('startup') || text.includes('lucro') || text.includes('receita')) {
    return { category: 'Empresas', topicSlug: 'empresas' };
  }
  if (text.includes('lula') || text.includes('stf') || text.includes('senado') ||
      text.includes('congresso') || text.includes('governo') || text.includes('politica') ||
      text.includes('lei') || text.includes('pec') || text.includes('eleicoes') || text.includes('camara')) {
    return { category: 'Política', topicSlug: 'politica' };
  }
  if (text.includes('futebol') || text.includes('copa') || text.includes('gol') ||
      text.includes('selecao') || text.includes('campeonato') || text.includes('flamengo') ||
      text.includes('palmeiras') || text.includes('esportes') || text.includes('atleta') || text.includes('olimpiadas')) {
    return { category: 'Esportes', topicSlug: 'esportes' };
  }
  if (text.includes('ciencia') || text.includes('pesquisa') || text.includes('espaco') ||
      text.includes('nasa') || text.includes('vacina') || text.includes('saude') || text.includes('medicina')) {
    return { category: 'Ciência', topicSlug: 'ciencia' };
  }
  if (text.includes('filme') || text.includes('cinema') || text.includes('serie') ||
      text.includes('musica') || text.includes('show') || text.includes('entretenimento') || text.includes('celebridade')) {
    return { category: 'Entretenimento', topicSlug: 'entretenimento' };
  }
  if (text.includes('eua') || text.includes('china') || text.includes('europa') ||
      text.includes('guerra') || text.includes('internacional') || text.includes('exterior') || text.includes('onu')) {
    return { category: 'Internacional', topicSlug: 'internacional' };
  }

  return { category: 'Economia', topicSlug: 'economia' };
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
  const executionId = `ingest-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

  console.log(`[Ingest Engine ${executionId}] Início da ingestão: ${new Date().toISOString()}`);

  if (!isPostgresConfigured()) {
    console.error(`[Ingest Engine ${executionId}] Falha: PostgreSQL não configurado no ambiente server-side.`);
    return {
      executionId,
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
    console.log(`[Ingest Engine ${executionId}] Consultando provedores de notícias...`);
    const { articles: rawArticles, providers } = await fetchAllUpstreamArticles(options?.keywords);

    const providerSummary = Object.entries(providers)
      .map(([name, stat]) => `${name}: ${stat.count} artigos (configurado: ${stat.configured}${stat.error ? `, erro: ${stat.error}` : ''})`)
      .join(' | ');
    console.log(`[Ingest Engine ${executionId}] Coleta finalizada: ${rawArticles.length} matérias recebidas [${providerSummary}]`);

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

    console.log(`[Ingest Engine ${executionId}] Deduplicação concluída: ${rawArticles.length} -> ${deduplicatedArticles.length} matérias únicas.`);

    if (deduplicatedArticles.length === 0) {
      console.warn(`[Ingest Engine ${executionId}] Nenhuma matéria nova para persistir após deduplicação.`);
      return {
        executionId,
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
      // 3.1 Resolução Canônica de Tópicos em public.topics
      // O esquema real confirmado no Supabase é:
      // (id UUID, name TEXT, slug TEXT UNIQUE, description, icon, image_url, is_active, is_featured, created_at, updated_at)
      // NUNCA fazer query com 'category' ou 'brand_color' (Erro 42703)!
      const topicMap = new Map<string, string>(); // slug -> topic UUID real

      // Precarrega todos os tópicos já existentes no Supabase
      const existingTopics = await client.query(
        `SELECT id, slug, name FROM public.topics WHERE is_active = true OR is_active IS NULL`
      );
      for (const row of existingTopics.rows) {
        if (row.slug && row.id) {
          topicMap.set(row.slug, row.id);
        }
      }

      // Garante que todo tópico referenciado pelos artigos deduplicados exista sem violar colunas
      for (const art of deduplicatedArticles) {
        const slug = art.topicSlug;
        if (topicMap.has(slug)) continue;

        const topicUuid = generateDeterministicUuidV5(`topic:${slug}`);
        const topicName = art.category || (slug.charAt(0).toUpperCase() + slug.slice(1));

        const insRes = await client.query(
          `INSERT INTO public.topics (id, name, slug, is_active, is_featured, created_at, updated_at)
           VALUES ($1, $2, $3, true, false, NOW(), NOW())
           ON CONFLICT (slug) DO NOTHING
           RETURNING id`,
          [topicUuid, topicName, slug]
        );

        if (insRes.rows.length > 0 && insRes.rows[0].id) {
          topicMap.set(slug, insRes.rows[0].id);
        } else {
          // Em caso de conflito concorrente, recupera o id existente
          const refetch = await client.query(
            `SELECT id FROM public.topics WHERE slug = $1 LIMIT 1`,
            [slug]
          );
          if (refetch.rows.length > 0 && refetch.rows[0].id) {
            topicMap.set(slug, refetch.rows[0].id);
          } else {
            topicMap.set(slug, topicUuid);
          }
        }
      }

      // 3.2 Upsert Seguro de Fontes em public.news_sources
      // Previne colisão em 'domain' (UNIQUE) e em 'slug' (UNIQUE)
      const sourceMap = new Map<string, string>(); // domain -> id UUID

      for (const art of deduplicatedArticles) {
        if (sourceMap.has(art.domain)) continue;

        // 1. Verifica se a fonte já existe pelo domínio
        const existingSrc = await client.query(
          `SELECT id FROM public.news_sources WHERE domain = $1 LIMIT 1`,
          [art.domain]
        );

        if (existingSrc.rows.length > 0) {
          const srcId = existingSrc.rows[0].id;
          sourceMap.set(art.domain, srcId);
          await client.query(
            `UPDATE public.news_sources SET name = COALESCE($2, name), updated_at = NOW() WHERE id = $1`,
            [srcId, art.sourceName]
          );
          sourcesUpserted++;
          continue;
        }

        // 2. Não existe: gera UUID v5 determinístico e slug único protegido contra colisões
        const sourceUuid = generateDeterministicUuidV5(`source:${art.domain}`);
        const baseSlug = generateSlug(art.sourceName || art.domain, 40);
        const uniqueSlug = `${baseSlug}-${sourceUuid.slice(0, 8)}`;

        const srcRes = await client.query(
          `INSERT INTO public.news_sources (
            id, name, slug, domain, country_code, language_code, authority_score, is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'BR', 'pt', 80, true, NOW(), NOW())
          ON CONFLICT (domain) DO UPDATE SET
            name = EXCLUDED.name,
            updated_at = NOW()
          RETURNING id`,
          [sourceUuid, art.sourceName, uniqueSlug, art.domain]
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
      // Agrupa artigos com base em afinidade léxica rigorosa (>= 3 tokens significativos e overlap >= 0.45)
      interface ClusterGroup {
        anchorArticle: SavedArticleRecord;
        anchorTokens: string[];
        relatedArticles: Array<{
          record: SavedArticleRecord;
          similarityScore: number;
        }>;
        category: string;
        topicSlug: string;
      }

      const clusters: ClusterGroup[] = [];
      const assigned = new Set<string>();

      for (let i = 0; i < savedArticles.length; i++) {
        const current = savedArticles[i];
        if (assigned.has(current.id)) continue;
        assigned.add(current.id);

        const anchorTokens = extractSignificantTokens(current.article.title);

        const cluster: ClusterGroup = {
          anchorArticle: current,
          anchorTokens,
          relatedArticles: [{
            record: current,
            similarityScore: 1.0
          }],
          category: current.article.category,
          topicSlug: current.article.topicSlug
        };

        for (let j = i + 1; j < savedArticles.length; j++) {
          const candidate = savedArticles[j];
          if (assigned.has(candidate.id)) continue;

          // Agrupamento apenas no mesmo tópico
          if (candidate.article.topicSlug === current.article.topicSlug) {
            const candTokens = extractSignificantTokens(candidate.article.title);
            const sim = calculateTokenSimilarity(anchorTokens, candTokens);

            // Requisitos estritos: >= 3 tokens significativos compartilhados E overlapRatio >= 0.45
            if (sim.sharedTokens.length >= 3 && sim.overlapRatio >= 0.45) {
              const score = Math.max(0.45, Math.min(0.99, Number(sim.overlapRatio.toFixed(2))));
              cluster.relatedArticles.push({
                record: candidate,
                similarityScore: score
              });
              assigned.add(candidate.id);
            }
          }
        }

        clusters.push(cluster);
      }

      // 3.5 Persistência de Acontecimentos em public.events (usando colunas REAIS)
      for (const cl of clusters) {
        const primary = cl.anchorArticle;
        const eventUuid = generateDeterministicUuidV5(`event:${primary.article.canonicalUrl}`);
        const baseSlug = generateSlug(primary.article.title, 70);
        const eventSlug = `${baseSlug}-${eventUuid.slice(0, 8)}`;

        const summary = primary.article.description || primary.article.title;

        // Domínios distintos para validação de independência editorial
        const distinctDomains = new Set(cl.relatedArticles.map(a => a.record.article.domain));
        const hasIndependentConfirmation = distinctDomains.size >= 2;

        // Status estrito: 'CONFIRMED' SOMENTE se houver >= 2 domínios independentes
        const eventStatus = hasIndependentConfirmation ? 'CONFIRMED' : 'DEVELOPING';

        // Texto factual sem alegações vazias
        const whyItMatters = hasIndependentConfirmation
          ? `Cobertura confirmada por ${distinctDomains.size} veículos independentes (${Array.from(distinctDomains).slice(0, 3).join(', ')}) com relevância para ${cl.category} no Brasil.`
          : `Notícia em desenvolvimento apurada inicialmente por ${primary.article.sourceName || primary.article.domain} com relevância para ${cl.category}.`;

        const relevanceScore = Math.min(98, 80 + Math.min(distinctDomains.size * 5, 15) + cl.relatedArticles.length);

        const keyPoints = JSON.stringify(
          cl.relatedArticles.slice(0, 4).map(r => `• ${r.record.article.title} (${r.record.article.sourceName})`)
        );

        const enrichmentStatus = 'PENDING';

        // Verifica se o evento já existe
        const existingEvt = await client.query(
          `SELECT id, article_count, status FROM public.events WHERE id = $1 LIMIT 1`,
          [eventUuid]
        );

        if (existingEvt.rows.length === 0) {
          // Inserção com cast explícito $11::jsonb
          await client.query(
            `INSERT INTO public.events (
              id, title, slug, summary, why_it_matters, status, relevance_score,
              primary_article_id, article_count, first_seen_at, last_updated_at,
              published_at, created_at, updated_at, key_points, revision, enrichment_status
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              $8, $9, NOW(), NOW(),
              $10, NOW(), NOW(), $11::jsonb, 1, $12
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
          const existingStatus = existingEvt.rows[0].status;
          const newCount = Math.max(existingEvt.rows[0].article_count || 1, cl.relatedArticles.length);
          const nextStatus = (hasIndependentConfirmation || existingStatus === 'CONFIRMED') ? 'CONFIRMED' : 'UPDATED';

          await client.query(
            `UPDATE public.events SET
              article_count = $2,
              status = $3,
              last_updated_at = NOW(),
              updated_at = NOW(),
              key_points = $4::jsonb,
              why_it_matters = $5
            WHERE id = $1`,
            [eventUuid, newCount, nextStatus, keyPoints, whyItMatters]
          );
          eventsUpdated++;
        }

        // Relacionar Artigos em public.event_articles com similarityScore real
        for (const item of cl.relatedArticles) {
          const isPrimary = item.record.id === primary.id;
          await client.query(
            `INSERT INTO public.event_articles (event_id, article_id, similarity_score, is_primary, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (event_id, article_id) DO UPDATE SET
               is_primary = EXCLUDED.is_primary,
               similarity_score = EXCLUDED.similarity_score`,
            [eventUuid, item.record.id, item.similarityScore, isPrimary]
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

    console.log(`[Ingest Engine ${executionId}] Persistência concluída com sucesso em ${Date.now() - startTime}ms: ` +
      `${articlesPersisted} matérias persistidas, ${sourcesUpserted} fontes atualizadas, ` +
      `${eventsCreated} eventos criados, ${eventsUpdated} eventos atualizados.`);

    return {
      executionId,
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
    const durationMs = Date.now() - startTime;
    console.error(`[Ingest Engine ${executionId}] Falha crítica na transação de persistência (${durationMs}ms):`, err?.message || err);
    return {
      executionId,
      success: false,
      articlesFetched: 0,
      deduplicatedCount: 0,
      articlesPersisted: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      sourcesUpserted: 0,
      durationMs,
      providers: {},
      error: err?.message || 'Falha no ciclo canônico de ingestão'
    };
  }
}
