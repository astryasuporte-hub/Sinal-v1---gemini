/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Event, Topic, Source, Entity, SourceReference } from '../types/sinal';
import { dedupInFlight, fetchWithTimeoutAndRetry, invalidateRequestCache, swrFetch } from './requestCache';
import { performanceMonitor } from './performanceMonitor';

const EVENT_COLUMNS = 'id, title, summary, what_happened, why_it_matters, category, published_at, updated_at, image_url, relevance_score';
const EVENT_SOURCE_COLUMNS = 'event_id, source_id, source_name, domain, logo_url, headline, url, published_at';
const TOPIC_COLUMNS = 'id, name, slug, description, category, brand_color';
const SOURCE_COLUMNS = 'id, name, slug, domain, logo_url, country_code, language_code, authority_score, is_active';
const ENTITY_COLUMNS = 'id, type, name, slug, description, image_url, website_url, country_code, is_verified, is_active';

function mapEntityRow(e: any): Entity {
  const normType = String(e.type || 'company').trim().toLowerCase();
  const type: Entity['type'] =
    normType === 'person' ? 'person' : normType === 'organization' ? 'organization' : 'company';
  const resolvedImage = e.image_url || undefined;
  const resolvedWebsite = e.website_url || e.website || undefined;
  const defaultBrandColor =
    type === 'person' ? '#8b5cf6' : type === 'organization' ? '#3b82f6' : '#10b981';

  return {
    id: String(e.id),
    name: e.name,
    slug: e.slug || undefined,
    type,
    description: e.description || '',
    website: resolvedWebsite,
    imageUrl: resolvedImage,
    avatarUrl: type === 'person' ? resolvedImage : undefined,
    logoUrl: resolvedImage,
    isFollowed: false,
    brandColor: defaultBrandColor
  };
}

function mapSourceRow(s: any): Source {
  return {
    id: String(s.id),
    name: s.name,
    slug: s.slug || undefined,
    domain: s.domain,
    category: s.category || 'Notícias',
    logoUrl: s.logo_url || undefined,
    isFollowed: false,
    brandColor: '#64748b'
  };
}

function mapEventRow(row: any, sourcesMap: Record<string, SourceReference[]>): Event {
  const attachedSources = sourcesMap[row.id] || [];
  const sourceCount = attachedSources.length;

  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    whatHappened: row.what_happened || row.summary,
    whyItMatters: row.why_it_matters || '',
    category: row.category || 'Geral',
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    imageUrl: row.image_url || undefined,
    relevanceScore: row.relevance_score || 90,
    relativeTime: 'Recente',
    sourceCountText: sourceCount > 0 ? `${sourceCount} fontes cruzadas` : 'Fonte verificada',
    entities: [],
    topics: [
      {
        id: `top-${row.id}`,
        name: row.category || 'Geral',
        slug: (row.category || 'geral').toLowerCase().replace(/\s+/g, '-'),
        description: 'Tópico monitorado',
        category: row.category || 'Geral',
        isFollowed: false
      }
    ],
    sources: attachedSources,
    timeline: [
      {
        id: `tl-${row.id}-1`,
        date: 'Data do fato',
        time: new Date(row.published_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        title: 'Publicação e monitoramento',
        description: 'Fato registrado no banco de dados central do FatosBR.'
      }
    ]
  };
}

export interface CatalogFetchResult {
  entities: Entity[];
  sources: Source[];
  unavailable?: boolean;
  partial?: boolean;
  degraded?: string[];
  warning?: string;
  error?: string;
  code?: string;
}

interface ProxyCatalogPayload {
  entities?: Entity[];
  sources?: Source[];
  unavailable?: boolean;
  partial?: boolean;
  degraded?: string[];
  warning?: string;
  error?: string;
  code?: string;
}

async function fetchCatalogFromProxy(): Promise<ProxyCatalogPayload> {
  const result = await swrFetch('catalog:proxy', 45_000, async (): Promise<ProxyCatalogPayload> => {
    const start = performance.now();
    try {
      const res = await fetchWithTimeoutAndRetry('/api/proxy/catalog', { timeoutMs: 8000, retries: 1 }).catch(() => null);
      performanceMonitor.trackApiCall('/api/proxy/catalog', performance.now() - start, res?.status || 0);
      if (res) {
        let payload: any = null;
        try {
          payload = await res.json();
        } catch {
          payload = null;
        }
        if (res.ok && payload && !payload.error) {
          return payload as ProxyCatalogPayload;
        }
        return {
          unavailable: true,
          code: payload?.code || (res.status >= 500 ? 'CATALOG_UNAVAILABLE' : undefined),
          error: payload?.error || `Falha HTTP ${res.status} ao consultar catálogo.`
        };
      }
    } catch {}
    return {
      unavailable: true,
      code: 'CATALOG_UNAVAILABLE',
      error: 'Não foi possível conectar ao serviço de catálogo.'
    };
  });

  if (result?.unavailable) {
    invalidateRequestCache('catalog:proxy');
  }
  return result || {};
}

export const eventService = {
  /**
   * Busca paginada de acontecimentos com metadata hasMore.
   */
  async getEventsPage(options?: { limit?: number; offset?: number }): Promise<{ events: Event[]; hasMore: boolean }> {
    const limit = Math.max(1, Math.min(50, options?.limit ?? 30));
    const offset = Math.max(0, options?.offset ?? 0);
    const cacheKey = `events:page:${limit}:${offset}`;

    return dedupInFlight(cacheKey, async () => {
      try {
        const start = performance.now();
        const proxyUrl = `/api/proxy/events?limit=${limit}&offset=${offset}`;
        const proxyRes = await fetchWithTimeoutAndRetry(proxyUrl, { timeoutMs: 9000, retries: 1 }).catch(() => null);
        performanceMonitor.trackApiCall('/api/proxy/events', performance.now() - start, proxyRes?.status || 0);
        if (proxyRes && proxyRes.ok) {
          const body = await proxyRes.json();
          if (Array.isArray(body.events) && body.events.length > 0) {
            return {
              events: body.events,
              hasMore: Boolean(body.hasMore)
            };
          }
        }
      } catch {}

      if (!isSupabaseConfigured) {
        return { events: [], hasMore: false };
      }

      try {
        const { data: eventsData, error } = await supabase
          .from('events')
          .select(EVENT_COLUMNS)
          .order('published_at', { ascending: false })
          .range(offset, offset + limit);

        if (error || !eventsData || eventsData.length === 0) {
          return { events: [], hasMore: false };
        }

        const hasMore = eventsData.length > limit;
        const pageRows = hasMore ? eventsData.slice(0, limit) : eventsData;
        const eventIds = pageRows.map((e) => e.id);
        const sourcesMap: Record<string, SourceReference[]> = {};

        try {
          const { data: sourcesData } = await supabase
            .from('event_sources')
            .select(EVENT_SOURCE_COLUMNS)
            .in('event_id', eventIds);

          if (sourcesData && sourcesData.length > 0) {
            sourcesData.forEach((row: any) => {
              if (!sourcesMap[row.event_id]) {
                sourcesMap[row.event_id] = [];
              }
              sourcesMap[row.event_id].push({
                id: `${row.event_id}-${row.source_id}`,
                sourceName: row.source_name,
                domain: row.domain,
                logoUrl: row.logo_url || undefined,
                headline: row.headline,
                url: row.url,
                publishedAt: row.published_at
              });
            });
          }
        } catch {}

        return {
          events: pageRows.map((row: any) => mapEventRow(row, sourcesMap)),
          hasMore
        };
      } catch {
        return { events: [], hasMore: false };
      }
    });
  },

  /**
   * Busca a lista de acontecimentos (Events) cadastrados no Supabase com suas fontes e entidades reais
   */
  async getEvents(options?: { limit?: number; offset?: number }): Promise<Event[]> {
    const page = await this.getEventsPage(options);
    return page.events;
  },

  /**
   * Busca tópicos cadastrados no banco com deduplicação e SWR curto (60s)
   */
  async getTopics(): Promise<Topic[]> {
    if (!isSupabaseConfigured) return [];
    return swrFetch('catalog:topics', 60_000, async () => {
      try {
        const { data, error } = await supabase
          .from('topics')
          .select(TOPIC_COLUMNS)
          .order('name');

        if (error || !data) return [];
        return data.map((t: any) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          description: t.description || '',
          category: t.category,
          isFollowed: false,
          brandColor: t.brand_color || '#3b82f6'
        }));
      } catch {
        return [];
      }
    });
  },

  /**
   * Busca entidades e fontes canônicas preservando diagnósticos de indisponibilidade (503)
   * e degradação parcial (`partial: true`) para exibição segura na interface.
   */
  async getCatalogDetailed(options?: { forceRefresh?: boolean }): Promise<CatalogFetchResult> {
    if (options?.forceRefresh) {
      invalidateRequestCache('catalog:');
    }

    const proxyCatalog = await fetchCatalogFromProxy();
    if (!proxyCatalog.unavailable) {
      const entities = Array.isArray(proxyCatalog.entities) ? proxyCatalog.entities : [];
      const sources = Array.isArray(proxyCatalog.sources) ? proxyCatalog.sources : [];
      const partial = Boolean(proxyCatalog.partial);
      const degraded = Array.isArray(proxyCatalog.degraded) ? proxyCatalog.degraded : undefined;
      return {
        entities,
        sources,
        partial,
        degraded,
        warning:
          proxyCatalog.warning ||
          (partial
            ? 'Parte do catálogo está temporariamente indisponível. Alguns itens podem não aparecer.'
            : undefined),
        code: proxyCatalog.code
      };
    }

    if (isSupabaseConfigured) {
      try {
        const [entitiesRes, sourcesRes] = await Promise.all([
          supabase
            .from('entities')
            .select(ENTITY_COLUMNS)
            .or('is_active.is.null,is_active.eq.true')
            .order('name'),
          supabase
            .from('news_sources')
            .select(SOURCE_COLUMNS)
            .or('is_active.is.null,is_active.eq.true')
            .order('name')
        ]);

        const entitiesOk = !entitiesRes.error && Array.isArray(entitiesRes.data);
        const sourcesOk = !sourcesRes.error && Array.isArray(sourcesRes.data);

        if (entitiesOk || sourcesOk) {
          const entities = entitiesOk ? entitiesRes.data!.map(mapEntityRow) : [];
          const sources = sourcesOk ? sourcesRes.data!.map(mapSourceRow) : [];
          const degraded: string[] = [];
          if (!entitiesOk) degraded.push('entities');
          if (!sourcesOk) degraded.push('sources');
          const partial = degraded.length > 0;
          return {
            entities,
            sources,
            partial,
            degraded: partial ? degraded : undefined,
            warning: partial
              ? 'Parte do catálogo está temporariamente indisponível. Exibindo dados parciais.'
              : undefined
          };
        }

        return {
          entities: [],
          sources: [],
          unavailable: true,
          code: proxyCatalog.code || 'CATALOG_UNAVAILABLE',
          error:
            entitiesRes.error?.message ||
            sourcesRes.error?.message ||
            proxyCatalog.error ||
            'Catálogo temporariamente indisponível.'
        };
      } catch (err: any) {
        return {
          entities: [],
          sources: [],
          unavailable: true,
          code: proxyCatalog.code || 'CATALOG_UNAVAILABLE',
          error: err?.message || proxyCatalog.error || 'Catálogo temporariamente indisponível.'
        };
      }
    }

    return {
      entities: [],
      sources: [],
      unavailable: true,
      code: proxyCatalog.code || 'CATALOG_UNAVAILABLE',
      error: proxyCatalog.error || 'Catálogo temporariamente indisponível.'
    };
  },

  /**
   * Busca fontes canônicas (public.news_sources com logo_url do Supabase Storage).
   */
  async getSources(): Promise<Source[]> {
    const result = await swrFetch('catalog:sources', 60_000, async () => {
      const proxyCatalog = await fetchCatalogFromProxy();
      if (!proxyCatalog.unavailable && Array.isArray(proxyCatalog.sources)) {
        return proxyCatalog.sources;
      }

      if (isSupabaseConfigured) {
        try {
          const { data: newsSourcesData, error } = await supabase
            .from('news_sources')
            .select(SOURCE_COLUMNS)
            .or('is_active.is.null,is_active.eq.true')
            .order('name');

          if (!error && Array.isArray(newsSourcesData)) {
            return newsSourcesData.map(mapSourceRow);
          }
        } catch {}
      }

      return null;
    });

    if (result === null) {
      invalidateRequestCache('catalog:sources');
      return [];
    }
    return result;
  },

  /**
   * Busca entidades canônicas (public.entities com image_url do Supabase Storage).
   */
  async getEntities(): Promise<Entity[]> {
    const result = await swrFetch('catalog:entities', 60_000, async () => {
      const proxyCatalog = await fetchCatalogFromProxy();
      if (!proxyCatalog.unavailable && Array.isArray(proxyCatalog.entities)) {
        return proxyCatalog.entities;
      }

      if (isSupabaseConfigured) {
        try {
          const { data, error } = await supabase
            .from('entities')
            .select(ENTITY_COLUMNS)
            .or('is_active.is.null,is_active.eq.true')
            .order('name');

          if (!error && Array.isArray(data)) {
            return data.map(mapEntityRow);
          }
        } catch {}
      }

      return null;
    });

    if (result === null) {
      invalidateRequestCache('catalog:entities');
      return [];
    }
    return result;
  }
};
