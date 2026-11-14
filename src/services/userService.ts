/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';

export const userService = {
  /**
   * Retorna os IDs dos acontecimentos salvos pelo usuário
   */
  async getSavedEventIds(userId: string): Promise<string[]> {
    if (!isSupabaseConfigured || !userId) return [];
    try {
      const { data, error } = await supabase
        .from('user_saved_events')
        .select('event_id')
        .eq('user_id', userId);

      if (error || !data) return [];
      return data.map((item) => item.event_id);
    } catch {
      return [];
    }
  },

  /**
   * Alterna estado de salvo/bookmark no Supabase
   */
  async toggleSaveEvent(userId: string, eventId: string, isCurrentlySaved: boolean): Promise<boolean> {
    if (!isSupabaseConfigured || !userId) return !isCurrentlySaved;

    try {
      if (isCurrentlySaved) {
        const { error } = await supabase
          .from('user_saved_events')
          .delete()
          .eq('user_id', userId)
          .eq('event_id', eventId);
        return error ? isCurrentlySaved : false;
      } else {
        const { error } = await supabase
          .from('user_saved_events')
          .insert({ user_id: userId, event_id: eventId });
        return error ? isCurrentlySaved : true;
      }
    } catch {
      return isCurrentlySaved;
    }
  },

  /**
   * Retorna tópicos seguidos pelo usuário
   */
  async getFollowedTopicIds(userId: string): Promise<string[]> {
    if (!isSupabaseConfigured || !userId) return [];
    try {
      const { data, error } = await supabase
        .from('user_followed_topics')
        .select('topic_id')
        .eq('user_id', userId);

      if (error || !data) return [];
      return data.map((item) => item.topic_id);
    } catch {
      return [];
    }
  },

  /**
   * Alterna tópico seguido
   */
  async toggleFollowTopic(userId: string, topicId: string, isCurrentlyFollowed: boolean): Promise<boolean> {
    if (!isSupabaseConfigured || !userId) return !isCurrentlyFollowed;

    try {
      if (isCurrentlyFollowed) {
        const { error } = await supabase
          .from('user_followed_topics')
          .delete()
          .eq('user_id', userId)
          .eq('topic_id', topicId);
        return error ? isCurrentlyFollowed : false;
      } else {
        const { error } = await supabase
          .from('user_followed_topics')
          .insert({ user_id: userId, topic_id: topicId });
        return error ? isCurrentlyFollowed : true;
      }
    } catch {
      return isCurrentlyFollowed;
    }
  },

  /**
   * Carrega preferências do usuário diretamente do Supabase
   */
  async getUserPreferences(userId: string) {
    if (!isSupabaseConfigured || !userId) return null;
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('[UserService] Falha ao carregar preferências do Supabase:', error.message);
        return null;
      }
      return data;
    } catch (err: any) {
      console.warn('[UserService] Erro na consulta de preferências:', err?.message);
      return null;
    }
  },

  /**
   * Atualiza ou cria as preferências do usuário no Supabase (upsert idempotente)
   */
  async updateUserPreferences(
    userId: string,
    updates: {
      email_morning_briefing?: boolean;
      email_evening_briefing?: boolean;
      email_breaking_alerts?: boolean;
      weekend_edition?: boolean;
      briefing_email?: string;
      morning_time?: string;
      evening_time?: string;
      timezone?: string;
    }
  ): Promise<boolean> {
    if (!isSupabaseConfigured || !userId) return false;
    try {
      const payload: any = {
        id: userId,
        ...updates,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('user_preferences')
        .upsert(payload, { onConflict: 'id' });

      if (error) {
        console.error('[UserService] Erro ao persistir preferências no Supabase:', error.message);
        return false;
      }

      return true;
    } catch (err: any) {
      console.error('[UserService] Erro de rede ao persistir preferências:', err?.message);
      return false;
    }
  },

  /**
   * Sincroniza ativamente o perfil do usuário na tabela public.profiles do Supabase
   * e no registro agregado de contas para o painel administrativo.
   */
  async syncUserProfile(user: any): Promise<void> {
    if (!user || !user.email) return;

    const email: string = user.email;
    const userId = user.id || `usr_${Date.now()}`;
    const userMeta = user.user_metadata || null;
    const appMeta = user.app_metadata || null;

    const fullName =
      userMeta?.full_name ||
      userMeta?.name ||
      user.full_name ||
      user.name ||
      email.split('@')[0];

    const avatarUrl =
      userMeta?.avatar_url ||
      userMeta?.picture ||
      user.avatar_url ||
      null;

    const provider: 'google' | 'email' =
      appMeta?.provider === 'google' || (userMeta?.iss && userMeta.iss.includes('google'))
        ? 'google'
        : 'email';

    const ADMIN_EMAILS = [
      'astryasuporte@gmail.com',
      'yleaopvpy01@gmail.com',
      'yleaop@gmail.com',
      'yleaopvpyyyy@gmail.com',
      'viniciusfelipedearaujo@gmail.com'
    ];
    const normalizedEmail = email.toLowerCase().trim();
    const isAdmin = ADMIN_EMAILS.includes(normalizedEmail) || normalizedEmail.includes('yleao') || normalizedEmail.includes('astrya');
    const planName = isAdmin ? 'PRO_UNLIMITED' : 'TRIAL_7D';
    const subscriptionStatus = 'ACTIVE';
    const nowIso = new Date().toISOString();

    // 1. Upsert no Supabase public.profiles com o token da sessão
    if (isSupabaseConfigured && user.id) {
      try {
        await supabase
          .from('profiles')
          .upsert(
            {
              id: user.id,
              email: email,
              full_name: fullName,
              avatar_url: avatarUrl || null,
              plan_name: planName,
              subscription_status: subscriptionStatus,
              is_admin: isAdmin,
              updated_at: nowIso
            },
            { onConflict: 'id' }
          );
      } catch (err) {
        console.warn('Falha no upsert de profiles no Supabase:', err);
      }
    }

    // 2. Persistir no registro agregado de contas (para contagem imediata no Painel Admin)
    try {
      const STORAGE_KEY = 'sinal_registered_accounts_registry';
      const raw = localStorage.getItem(STORAGE_KEY);
      let registry: any[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) registry = parsed;
        } catch {}
      }

      const existingIdx = registry.findIndex(
        (u) => u.email?.toLowerCase() === email.toLowerCase() || (user.id && u.id === user.id)
      );

      const accountData = {
        id: user.id || userId,
        email: email,
        fullName: fullName,
        avatarUrl: avatarUrl,
        provider: provider,
        planName: planName,
        subscriptionStatus: subscriptionStatus,
        isAdmin: isAdmin,
        createdAt: existingIdx >= 0 && registry[existingIdx].createdAt ? registry[existingIdx].createdAt : nowIso,
        lastSignInAt: nowIso
      };

      if (existingIdx >= 0) {
        registry[existingIdx] = { ...registry[existingIdx], ...accountData };
      } else {
        registry.unshift(accountData);
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
    } catch {}
  },
};

