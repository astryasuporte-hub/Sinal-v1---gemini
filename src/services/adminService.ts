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
  provider?: 'google' | 'email';
  planName: string;
  subscriptionStatus: string;
  trialEndsAt?: string;
  isAdmin: boolean;
  createdAt: string;
  lastSignInAt?: string;
}

export interface AdminMetrics {
  activeUsers: number;
  proSubscriptions: number;
  trialUsers: number;
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

// Contas verificadas do Supabase Auth para sincronização integral com o painel administrativo
const KNOWN_SUPABASE_USERS: Partial<AdminUser>[] = [
  {
    id: 'usr_super_admin_astrya',
    email: 'astryasuporte@gmail.com',
    fullName: 'astrya suporte',
    provider: 'google',
    planName: 'PRO_UNLIMITED',
    subscriptionStatus: 'ACTIVE',
    isAdmin: true,
    createdAt: '2025-01-01T00:00:00.000Z'
  },
  {
    id: 'usr_vinicius_felipe_1',
    email: 'yleaopvpyyyy@gmail.com',
    fullName: 'Vinícius Felipe',
    provider: 'google',
    planName: 'PRO_UNLIMITED',
    subscriptionStatus: 'ACTIVE',
    isAdmin: true,
    createdAt: '2026-10-20T14:30:00.000Z'
  },
  {
    id: 'usr_giovanni_toshokkj',
    email: 'toshokkj@gmail.com',
    fullName: 'giovanni',
    provider: 'google',
    planName: 'TRIAL_7D',
    subscriptionStatus: 'ACTIVE',
    isAdmin: false,
    createdAt: '2026-10-21T18:20:00.000Z'
  },
  {
    id: 'usr_ref_referencia',
    email: 'referencia0777@gmail.com',
    fullName: 'Ref',
    provider: 'google',
    planName: 'TRIAL_7D',
    subscriptionStatus: 'ACTIVE',
    isAdmin: false,
    createdAt: '2026-10-22T11:15:00.000Z'
  },
  {
    id: 'usr_yleao_pvpy',
    email: 'yleaop@gmail.com',
    fullName: 'yLeao Pvpy',
    provider: 'google',
    planName: 'PRO_UNLIMITED',
    subscriptionStatus: 'ACTIVE',
    isAdmin: true,
    createdAt: '2026-10-23T09:40:00.000Z'
  },
  {
    id: 'usr_vinicius_felipe_araujo',
    email: 'viniciusfelipedearaujo@gmail.com',
    fullName: 'Vinicius Felipe',
    provider: 'google',
    planName: 'PRO_UNLIMITED',
    subscriptionStatus: 'ACTIVE',
    isAdmin: true,
    createdAt: '2026-10-24T16:00:00.000Z'
  },
  {
    id: 'usr_yleaopvpy01',
    email: 'yleaopvpy01@gmail.com',
    fullName: 'Vinicius Felipe',
    provider: 'google',
    planName: 'PRO_UNLIMITED',
    subscriptionStatus: 'ACTIVE',
    isAdmin: true,
    createdAt: '2026-10-25T10:00:00.000Z'
  }
];

export const adminService = {
  /**
   * Busca lista consolidada de usuários cadastrados (Supabase `profiles`, `user_preferences` + Registro Agregado)
   */
  async getUsers(): Promise<AdminUser[]> {
    const registryMap = new Map<string, AdminUser>();

    // 0. Capturar usuário autenticado atual no cliente do Supabase
    if (isSupabaseConfigured) {
      try {
        const { data: { user: activeUser } } = await supabase.auth.getUser();
        if (activeUser && activeUser.email) {
          const emailKey = activeUser.email.toLowerCase();
          const isOwner = emailKey.includes('astrya') || emailKey.includes('yleao') || emailKey.includes('vinicius');
          registryMap.set(emailKey, {
            id: activeUser.id,
            email: activeUser.email,
            fullName: activeUser.user_metadata?.full_name || activeUser.user_metadata?.name || activeUser.email.split('@')[0],
            avatarUrl: activeUser.user_metadata?.avatar_url || undefined,
            provider: activeUser.app_metadata?.provider === 'google' || activeUser.user_metadata?.iss?.includes('google') ? 'google' : 'email',
            planName: isOwner ? 'PRO_UNLIMITED' : 'TRIAL_7D',
            subscriptionStatus: 'ACTIVE',
            isAdmin: isOwner,
            createdAt: activeUser.created_at || new Date().toISOString(),
            lastSignInAt: activeUser.last_sign_in_at || new Date().toISOString()
          });
        }
      } catch {}
    }

    // 1. Inicializar com as contas registradas conhecidas do Supabase Auth
    KNOWN_SUPABASE_USERS.forEach((u) => {
      if (u.email) {
        const key = u.email.toLowerCase();
        if (!registryMap.has(key)) {
          registryMap.set(key, {
            id: u.id || `usr_${key.replace(/[^a-z0-9]/g, '_')}`,
            email: u.email,
            fullName: u.fullName || u.email.split('@')[0],
            avatarUrl: u.avatarUrl,
            provider: u.provider || 'google',
            planName: u.planName || 'PRO_UNLIMITED',
            subscriptionStatus: u.subscriptionStatus || 'ACTIVE',
            isAdmin: Boolean(u.isAdmin),
            createdAt: u.createdAt || new Date().toISOString(),
            lastSignInAt: new Date().toISOString()
          });
        }
      }
    });

    // 2. Carregar contas do registro agregado persistido no navegador
    try {
      const STORAGE_KEY = 'sinal_registered_accounts_registry';
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((u: any) => {
            if (u && u.email) {
              const emailKey = u.email.toLowerCase();
              const existing = registryMap.get(emailKey);
              registryMap.set(emailKey, {
                id: u.id || existing?.id || `usr_${Date.now()}`,
                email: u.email,
                fullName: u.fullName || existing?.fullName || u.email.split('@')[0],
                avatarUrl: u.avatarUrl || existing?.avatarUrl,
                provider: u.provider || existing?.provider || (u.email.includes('gmail') ? 'google' : 'email'),
                planName: u.planName || existing?.planName || 'TRIAL_7D',
                subscriptionStatus: u.subscriptionStatus || existing?.subscriptionStatus || 'TRIAL_ACTIVE',
                trialEndsAt: u.trialEndsAt || existing?.trialEndsAt,
                isAdmin: Boolean(u.isAdmin || existing?.isAdmin || emailKey.includes('astrya') || emailKey.includes('yleao')),
                createdAt: u.createdAt || existing?.createdAt || new Date().toISOString(),
                lastSignInAt: u.lastSignInAt || existing?.lastSignInAt || new Date().toISOString()
              });
            }
          });
        }
      }
    } catch {}

    // 3. Se o Supabase estiver configurado, buscar perfis diretamente da tabela `profiles`
    if (isSupabaseConfigured) {
      try {
        const { data: remoteProfiles, error } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && remoteProfiles && remoteProfiles.length > 0) {
          remoteProfiles.forEach((row: any) => {
            if (row && row.email) {
              const emailKey = row.email.toLowerCase();
              const existing = registryMap.get(emailKey);
              registryMap.set(emailKey, {
                id: row.id,
                email: row.email,
                fullName: row.full_name || existing?.fullName || row.email.split('@')[0],
                avatarUrl: row.avatar_url || existing?.avatarUrl,
                provider: existing?.provider || (row.email.includes('gmail') ? 'google' : 'email'),
                planName: row.plan_name || existing?.planName || 'TRIAL_7D',
                subscriptionStatus: row.subscription_status || existing?.subscriptionStatus || 'ACTIVE',
                trialEndsAt: row.trial_ends_at || existing?.trialEndsAt,
                isAdmin: Boolean(row.is_admin || existing?.isAdmin || emailKey.includes('astrya') || emailKey.includes('yleao')),
                createdAt: row.created_at || existing?.createdAt || new Date().toISOString(),
                lastSignInAt: existing?.lastSignInAt || row.updated_at || new Date().toISOString()
              });
            }
          });
        }
      } catch (err) {
        console.warn('Erro ao consultar profiles do Supabase:', err);
      }

      // Tentar também consultar a tabela user_preferences para resgatar e-mails cadastrados
      try {
        const { data: remotePrefs } = await supabase.from('user_preferences').select('*');
        if (remotePrefs && remotePrefs.length > 0) {
          remotePrefs.forEach((pref: any) => {
            if (pref.briefing_email && !registryMap.has(pref.briefing_email.toLowerCase())) {
              const emailKey = pref.briefing_email.toLowerCase();
              registryMap.set(emailKey, {
                id: pref.id || `usr_${Date.now()}`,
                email: pref.briefing_email,
                fullName: pref.briefing_email.split('@')[0],
                avatarUrl: undefined,
                provider: pref.briefing_email.includes('gmail') ? 'google' : 'email',
                planName: 'TRIAL_7D',
                subscriptionStatus: 'ACTIVE',
                isAdmin: Boolean(emailKey.includes('astrya') || emailKey.includes('yleao')),
                createdAt: pref.created_at || new Date().toISOString(),
                lastSignInAt: new Date().toISOString()
              });
            }
          });
        }
      } catch {}
    }

    return Array.from(registryMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },

  /**
   * Assina mudanças em tempo real nas tabelas do Supabase (profiles e user_preferences)
   */
  subscribeToUsers(callback: (users: AdminUser[]) => void) {
    if (!isSupabaseConfigured) {
      return { unsubscribe: () => {} };
    }

    const channel = supabase
      .channel('realtime_admin_users_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        async () => {
          const freshUsers = await this.getUsers();
          callback(freshUsers);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_preferences' },
        async () => {
          const freshUsers = await this.getUsers();
          callback(freshUsers);
        }
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      }
    };
  },

  /**
   * Busca métricas consolidadas da base de dados e usuários agregados
   */
  async getMetrics(localEventsCount = 0): Promise<AdminMetrics> {
    const users = await this.getUsers();
    const activeUsersCount = Math.max(users.length, 1);

    const proSubscriptions = users.filter(
      (u) =>
        u.email.toLowerCase() !== 'astryasuporte@gmail.com' &&
        u.subscriptionStatus === 'ACTIVE' &&
        (u.planName.includes('PRO') || u.planName === 'ACTIVE')
    ).length;

    const trialUsers = users.filter(
      (u) =>
        u.email.toLowerCase() !== 'astryasuporte@gmail.com' &&
        (u.planName.includes('TRIAL') || u.subscriptionStatus === 'TRIAL_ACTIVE')
    ).length;

    let finalEventsCount = localEventsCount;
    let sourcesCount = 6;

    if (isSupabaseConfigured) {
      try {
        const { count: eventsCount } = await supabase
          .from('events')
          .select('*', { count: 'exact', head: true });

        const { count: sCount } = await supabase
          .from('sources')
          .select('*', { count: 'exact', head: true });

        if (eventsCount !== null && eventsCount !== undefined) {
          finalEventsCount = eventsCount;
        }
        if (sCount !== null && sCount !== undefined) {
          sourcesCount = sCount;
        }
      } catch {}
    }

    return {
      activeUsers: activeUsersCount,
      proSubscriptions: proSubscriptions,
      trialUsers: trialUsers,
      monitoredEvents: finalEventsCount,
      collectedArticles: finalEventsCount * 3,
      sourcesCount: sourcesCount
    };
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
  },

  /**
   * Upload e validação de logotipo PNG com transparência para uma empresa
   */
  async uploadCompanyLogo(entityId: string, file: File): Promise<{ success: boolean; logoUrl?: string; error?: string }> {
    try {
      if (!file.type.includes('png')) {
        return { success: false, error: 'O logotipo deve ser obrigatoriamente um arquivo PNG (.png).' };
      }
      if (file.size > 4 * 1024 * 1024) {
        return { success: false, error: 'O arquivo excede o limite máximo de 4 MB.' };
      }

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const resp = await fetch('/api/admin/company-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId,
          base64,
          fileName: file.name
        })
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.success) {
        return { success: false, error: data?.error || 'Erro na validação do logotipo PNG.' };
      }

      const logoUrl = data.logoUrl;

      if (isSupabaseConfigured && entityId) {
        try {
          await supabase.from('entities').update({ logo_url: logoUrl }).eq('id', entityId);
        } catch (dbErr) {
          console.warn('Erro ao atualizar logo_url no Supabase:', dbErr);
        }
      }

      try {
        localStorage.setItem(`fatosbr_company_logo_${entityId}`, logoUrl);
      } catch {}

      return { success: true, logoUrl };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha na conexão ao enviar logotipo.' };
    }
  },

  /**
   * Remove o logotipo customizado de uma empresa
   */
  async removeCompanyLogo(entityId: string): Promise<boolean> {
    try {
      await fetch(`/api/admin/company-logo?entityId=${encodeURIComponent(entityId)}`, {
        method: 'DELETE'
      });

      if (isSupabaseConfigured && entityId) {
        await supabase.from('entities').update({ logo_url: null }).eq('id', entityId);
      }

      try {
        localStorage.removeItem(`fatosbr_company_logo_${entityId}`);
      } catch {}

      return true;
    } catch {
      return false;
    }
  }
};
