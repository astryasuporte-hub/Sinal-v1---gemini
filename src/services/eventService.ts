/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Event, Topic, Source, Entity, SourceReference } from '../types/sinal';

function mapEntityRow(e: any): Entity {
  const normType = String(e.type || 'company').trim().toLowerCase();
  const type: Entity['type'] =
    normType === 'person' ? 'person' : normType === 'organization' ? 'organization' : 'company';
  const resolvedImage = e.image_url || e.logo_url || e.avatar_url || undefined;

  return {
    id: String(e.id),
    name: e.name,
    slug: e.slug || undefined,
    type,
    description: e.description || '',
    sector: e.sector || undefined,
    role: e.role || undefined,
    organization: e.organization || undefined,
    website: e.website || undefined,
    imageUrl: resolvedImage,
    avatarUrl: type === 'person' ? resolvedImage : e.avatar_url || undefined,
    logoUrl: resolvedImage,
    isFollowed: false,
    brandColor: e.brand_color || '#10b981'
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
    brandColor: s.brand_color || '#64748b'
  };
}

export const eventService = {
  /**
   * Busca a lista de acontecimentos (Events) cadastrados no Supabase com suas fontes e entidades reais
   */
  async getEvents(): Promise<Event[]> {
    try {
      const proxyRes = await fetch('/api/proxy/events').catch(() => null);
      if (proxyRes && proxyRes.ok) {
        const body = await proxyRes.json();
        if (Array.isArray(body.events) && body.events.length > 0) {
          return body.events;
        }
      }
    } catch {}

    if (!isSupabaseConfigured) {
      return [];
    }

    try {
      const { data: eventsData, error } = await supabase
        .from('events')
        .select('*')
        .order('published_at', { ascending: false });

      if (error || !eventsData || eventsData.length === 0) {
        return [];
      }

      const eventIds = eventsData.map((e) => e.id);
      const sourcesMap: Record<string, SourceReference[]> = {};

      try {
        const { data: sourcesData } = await supabase
          .from('event_sources')
          .select('*')
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

      return eventsData.map((row: any) => {
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
      });
    } catch {
      return [];
    }
  },

  /**
   * Busca tópicos cadastrados no banco
   */
  async getTopics(): Promise<Topic[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('topics')
        .select('*')
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
  },

  /**
   * Busca fontes canônicas (public.news_sources com logo_url do Supabase Storage).
   * Não depende de localStorage.
   */
  async getSources(): Promise<Source[]> {
    if (isSupabaseConfigured) {
      try {
        const { data: newsSourcesData, error } = await supabase
          .from('news_sources')
          .select('*')
          .order('name');

        if (!error && Array.isArray(newsSourcesData) && newsSourcesData.length > 0) {
          return newsSourcesData.map(mapSourceRow);
        }
      } catch {}
    }

    try {
      const res = await fetch('/api/proxy/catalog').catch(() => null);
      if (res && res.ok) {
        const body = await res.json();
        if (Array.isArray(body.sources) && body.sources.length > 0) {
          return body.sources;
        }
      }
    } catch {}

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.from('sources').select('*').order('name');
        if (!error && Array.isArray(data)) {
          return data.map(mapSourceRow);
        }
      } catch {}
    }

    return [];
  },

  /**
   * Busca entidades canônicas (public.entities com image_url do Supabase Storage).
   * Não depende de localStorage.
   */
  async getEntities(): Promise<Entity[]> {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('entities')
          .select('*')
          .order('name');

        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map(mapEntityRow);
        }
      } catch {}
    }

    try {
      const res = await fetch('/api/proxy/catalog').catch(() => null);
      if (res && res.ok) {
        const body = await res.json();
        if (Array.isArray(body.entities) && body.entities.length > 0) {
          return body.entities;
        }
      }
    } catch {}

    return [];
  }
};
