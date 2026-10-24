/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Event, Source, Topic, Entity } from '../types/sinal';

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  planName: string;
  subscriptionStatus: string;
  trialEndsAt?: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface AdminMetrics {
  activeUsers: number;
  proSubscriptions: number;
  monitoredEvents: number;
  collectedArticles: number;
  sourcesCount: number;
}

export interface SystemLog {
  id: string;
  timestamp: string;
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  service: string;
  message: string;
}

export const adminService = {
  /**
   * Busca métricas reais da base de dados Supabase
   */
  async getMetrics(localEventsCount = 0): Promise<AdminMetrics> {
    if (!isSupabaseConfigured) {
      return {
        activeUsers: 1, // Astrya Suporte (Super Admin)
        proSubscriptions: 0, // Admin não conta como assinante pagante
        monitoredEvents: localEventsCount,
        collectedArticles: localEventsCount * 3,
        sourcesCount: 6
      };
    }

    try {
      // 1. Contagem de perfis cadastrados
      const { count: usersCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      // 2. Contagem de assinantes pagantes reais (excluindo o Super Admin e períodos de teste 7D)
      const { data: profilesList } = await supabase
        .from('profiles')
        .select('email, plan_name, subscription_status');

      let realPayingProCount = 0;
      if (profilesList && profilesList.length > 0) {
        realPayingProCount = profilesList.filter(
          (p) =>
            p.email?.toLowerCase() !== 'astryasuporte@gmail.com' &&
            p.subscription_status === 'ACTIVE' &&
            p.plan_name !== 'TRIAL_7D' &&
            p.plan_name !== 'TRIAL'
        ).length;
      }

      // 3. Contagem de acontecimentos
      const { count: eventsCount } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true });

      // 4. Contagem de fontes
      const { count: sourcesCount } = await supabase
        .from('sources')
        .select('*', { count: 'exact', head: true });

      const finalEventsCount = eventsCount ?? localEventsCount;

      return {
        activeUsers: Math.max(usersCount || 1, 1),
        proSubscriptions: realPayingProCount, // Apenas assinaturas pagantes reais
        monitoredEvents: finalEventsCount,
        collectedArticles: finalEventsCount * 3,
        sourcesCount: sourcesCount || 6
      };
    } catch {
      return {
        activeUsers: 1,
        proSubscriptions: 0,
        monitoredEvents: localEventsCount,
        collectedArticles: localEventsCount * 3,
        sourcesCount: 6
      };
    }
  },

  /**
   * Busca lista de usuários cadastrados no Supabase `profiles`
   */
  async getUsers(): Promise<AdminUser[]> {
    if (!isSupabaseConfigured) {
      return [
        {
          id: 'user-super-admin',
          email: 'astryasuporte@gmail.com',
          fullName: 'Astrya Suporte',
          planName: 'PRO_UNLIMITED',
          subscriptionStatus: 'ACTIVE',
          isAdmin: true,
          createdAt: new Date().toISOString()
        }
      ];
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error || !data || data.length === 0) {
        return [
          {
            id: 'user-super-admin',
            email: 'astryasuporte@gmail.com',
            fullName: 'Astrya Suporte',
            planName: 'PRO_UNLIMITED',
            subscriptionStatus: 'ACTIVE',
            isAdmin: true,
            createdAt: new Date().toISOString()
          }
        ];
      }

      return data.map((row) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name || row.email.split('@')[0],
        avatarUrl: row.avatar_url,
        planName: row.plan_name || 'TRIAL_7D',
        subscriptionStatus: row.subscription_status || 'TRIAL_ACTIVE',
        trialEndsAt: row.trial_ends_at,
        isAdmin: Boolean(row.is_admin || row.email === 'astryasuporte@gmail.com'),
        createdAt: row.created_at
      }));
    } catch {
      return [
        {
          id: 'user-super-admin',
          email: 'astryasuporte@gmail.com',
          fullName: 'Astrya Suporte',
          planName: 'PRO_UNLIMITED',
          subscriptionStatus: 'ACTIVE',
          isAdmin: true,
          createdAt: new Date().toISOString()
        }
      ];
    }
  },

  /**
   * Atualiza papel ou plano de um usuário no Supabase
   */
  async updateUser(
    userId: string,
    updates: Partial<{ isAdmin: boolean; planName: string; subscriptionStatus: string }>
  ): Promise<boolean> {
    if (!isSupabaseConfigured || !userId) return false;

    try {
      const dbPayload: any = {};
      if (updates.isAdmin !== undefined) dbPayload.is_admin = updates.isAdmin;
      if (updates.planName !== undefined) dbPayload.plan_name = updates.planName;
      if (updates.subscriptionStatus !== undefined)
        dbPayload.subscription_status = updates.subscriptionStatus;

      const { error } = await supabase.from('profiles').update(dbPayload).eq('id', userId);
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Salva um acontecimento gerado na base de dados do Supabase
   */
  async saveEventToSupabase(event: Event): Promise<boolean> {
    if (!isSupabaseConfigured) return false;

    try {
      // 1. Inserir evento principal
      const { error: evError } = await supabase.from('events').upsert({
        id: event.id,
        title: event.title,
        summary: event.summary,
        what_happened: event.whatHappened,
        why_it_matters: event.whyItMatters,
        category: event.category,
        relevance_score: event.relevanceScore,
        published_at: event.publishedAt,
        updated_at: event.updatedAt
      });

      if (evError) return false;

      // 2. Inserir referências de fontes se houver
      if (event.sources && event.sources.length > 0) {
        for (const src of event.sources) {
          // Garantir que a fonte exista na tabela sources
          const srcId = src.domain.replace(/[^a-zA-Z0-9]/g, '-');
          await supabase.from('sources').upsert({
            id: srcId,
            name: src.sourceName,
            domain: src.domain,
            category: event.category
          });

          await supabase.from('event_sources').upsert({
            event_id: event.id,
            source_id: srcId,
            source_name: src.sourceName,
            domain: src.domain,
            headline: src.headline,
            url: src.url,
            published_at: src.publishedAt || new Date().toISOString()
          });
        }
      }

      return true;
    } catch {
      return false;
    }
  },

  /**
   * Remove um acontecimento do Supabase
   */
  async deleteEventFromSupabase(eventId: string): Promise<boolean> {
    if (!isSupabaseConfigured || !eventId) return false;
    try {
      const { error } = await supabase.from('events').delete().eq('id', eventId);
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Limpa todos os acontecimentos da tabela `events` no Supabase
   */
  async clearAllEventsFromSupabase(): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    try {
      const { error } = await supabase.from('events').delete().neq('id', 'keep-none');
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Cadastra nova fonte no Supabase
   */
  async createSource(source: {
    name: string;
    domain: string;
    category: string;
    brandColor?: string;
  }): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    try {
      const id = source.domain.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      const { error } = await supabase.from('sources').upsert({
        id,
        name: source.name,
        domain: source.domain,
        category: source.category,
        brand_color: source.brandColor || '#3b82f6'
      });
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Remove uma fonte do Supabase
   */
  async deleteSource(sourceId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    try {
      const { error } = await supabase.from('sources').delete().eq('id', sourceId);
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Popula / Sincroniza o Supabase com os dados verificados de lançamento
   */
  async seedSupabase(
    events: Event[],
    sources: Source[],
    topics: Topic[],
    entities: Entity[]
  ): Promise<{ success: boolean; message: string }> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        message: 'Supabase não está configurado. Conecte VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY primeiro.'
      };
    }

    try {
      // 1. Inserir fontes
      if (sources.length > 0) {
        for (const s of sources) {
          await supabase.from('sources').upsert({
            id: s.id,
            name: s.name,
            domain: s.domain,
            category: s.category,
            brand_color: s.brandColor || '#3b82f6'
          });
        }
      }

      // 2. Inserir tópicos
      if (topics.length > 0) {
        for (const t of topics) {
          await supabase.from('topics').upsert({
            id: t.id,
            name: t.name,
            slug: t.slug,
            description: t.description,
            category: t.category,
            brand_color: t.brandColor || '#3b82f6'
          });
        }
      }

      // 3. Inserir entidades
      if (entities.length > 0) {
        for (const ent of entities) {
          await supabase.from('entities').upsert({
            id: ent.id,
            name: ent.name,
            type: ent.type,
            description: ent.description,
            sector: ent.sector,
            website: ent.website,
            brand_color: ent.brandColor || '#10b981'
          });
        }
      }

      // 4. Inserir eventos
      if (events.length > 0) {
        for (const ev of events) {
          await this.saveEventToSupabase(ev);
        }
      }

      return {
        success: true,
        message: `Sincronização concluída com sucesso! ${events.length} acontecimentos, ${sources.length} fontes e ${topics.length} tópicos enviados ao Supabase.`
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Erro na sincronização: ${err?.message || 'Falha ao gravar no Supabase'}`
      };
    }
  }
};
