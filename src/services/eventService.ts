/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Event, Topic, Source, Entity, SourceReference } from '../types/sinal';

export const eventService = {
  /**
   * Busca a lista de acontecimentos (Events) cadastrados no Supabase com suas fontes reais
   */
  async getEvents(): Promise<Event[]> {
    if (!isSupabaseConfigured) {
      try {
        const proxyRes = await fetch('/api/proxy/events').catch(() => null);
        if (proxyRes && proxyRes.ok) {
          const body = await proxyRes.json();
          if (Array.isArray(body.events) && body.events.length > 0) {
            return body.events;
          }
        }
      } catch {}
      return [];
    }

    try {
      const { data: eventsData, error } = await supabase
        .from('events')
        .select('*')
        .order('published_at', { ascending: false });

      if (error || !eventsData || eventsData.length === 0) {
        // Fallback para o backend seguro caso o client PostgREST retorne vazio ou com restrição
        try {
          const proxyRes = await fetch('/api/proxy/events').catch(() => null);
          if (proxyRes && proxyRes.ok) {
            const body = await proxyRes.json();
            if (Array.isArray(body.events) && body.events.length > 0) {
              return body.events;
            }
          }
        } catch {}
        return [];
      }

      // Buscar fontes associadas em lote
      const eventIds = eventsData.map((e) => e.id);
      let sourcesMap: Record<string, SourceReference[]> = {};

      try {
        const { data: sourcesData } = await supabase
          .from('event_sources')
          .select('*')
          .in('event_id', eventIds);

        if (sourcesData && sourcesData.length > 0) {
          sourcesData.forEach((row) => {
            if (!sourcesMap[row.event_id]) {
              sourcesMap[row.event_id] = [];
            }
            sourcesMap[row.event_id].push({
              id: `${row.event_id}-${row.source_id}`,
              sourceName: row.source_name,
              domain: row.domain,
              headline: row.headline,
              url: row.url,
              publishedAt: row.published_at
            });
          });
        }
      } catch {
        // Ignorar falha em event_sources se a tabela não tiver sido populada
      }

      // Mapear os acontecimentos
      const events: Event[] = eventsData.map((row) => {
        const attachedSources = sourcesMap[row.id] || [];
        const sourceCount = attachedSources.length;

        return {
          id: row.id,
          title: row.title,
          summary: row.summary,
          whatHappened: row.what_happened,
          whyItMatters: row.why_it_matters,
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

      return events;
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
      return data.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        description: t.description || '',
        category: t.category,
        isFollowed: false,
        brandColor: t.brand_color || '#3b82f6',
      }));
    } catch {
      return [];
    }
  },

  /**
   * Busca fontes cadastradas no banco
   */
  async getSources(): Promise<Source[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('sources')
        .select('*')
        .order('name');

      if (error || !data) return [];
      return data.map((s) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        category: s.category,
        isFollowed: false,
        brandColor: s.brand_color || '#64748b',
      }));
    } catch {
      return [];
    }
  },

  /**
   * Busca entidades cadastradas no banco
   */
  async getEntities(): Promise<Entity[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('entities')
        .select('*')
        .order('name');

      if (error || !data) return [];
      return data.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type as 'company' | 'person' | 'organization',
        description: e.description || '',
        sector: e.sector,
        website: e.website,
        avatarUrl: e.avatar_url,
        logoUrl: e.logo_url || (typeof window !== 'undefined' ? localStorage.getItem(`fatosbr_company_logo_${e.id}`) || undefined : undefined),
        isFollowed: false,
        brandColor: e.brand_color || '#10b981',
      }));
    } catch {
      return [];
    }
  }
};
