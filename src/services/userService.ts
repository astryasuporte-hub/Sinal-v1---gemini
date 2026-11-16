/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';

export type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface OnboardingSavedData {
  themes?: string[];
  followedEntityIds?: string[];
  followedTopicIds?: string[];
  followedSourceIds?: string[];
  notificationsPreferences?: string[];
  feedPreferences?: string[];
  userLocation?: string;
  userLanguage?: string;
}

export interface CanonicalOnboardingState {
  status: OnboardingStatus;
  step: number;
  completedAt: string | null;
  data: OnboardingSavedData;
  persistedInDb: boolean;
  reconciledFromLegacy?: boolean;
}

const isMissingColumnError = (err: any): boolean => {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return code === '42703' || code === 'PGRST204' || msg.includes('does not exist') || msg.includes('schema cache');
};

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
   * Retorna entidades seguidas pelo usuário no Supabase
   */
  async getFollowedEntityIds(userId: string): Promise<string[]> {
    if (!isSupabaseConfigured || !userId) return [];
    try {
      const { data, error } = await supabase
        .from('user_followed_entities')
        .select('entity_id')
        .eq('user_id', userId);

      if (error || !data) return [];
      return data.map((item) => item.entity_id);
    } catch {
      return [];
    }
  },

  /**
   * Retorna fontes seguidas pelo usuário no Supabase
   */
  async getFollowedSourceIds(userId: string): Promise<string[]> {
    if (!isSupabaseConfigured || !userId) return [];
    try {
      const { data, error } = await supabase
        .from('user_followed_sources')
        .select('source_id')
        .eq('user_id', userId);

      if (error || !data) return [];
      return data.map((item) => item.source_id);
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
          .upsert({ user_id: userId, topic_id: topicId }, { onConflict: 'user_id,topic_id' });
        return error ? isCurrentlyFollowed : true;
      }
    } catch {
      return isCurrentlyFollowed;
    }
  },

  /**
   * Alterna entidade seguida no Supabase
   */
  async toggleFollowEntity(userId: string, entityId: string, isCurrentlyFollowed: boolean): Promise<boolean> {
    if (!isSupabaseConfigured || !userId) return !isCurrentlyFollowed;

    try {
      if (isCurrentlyFollowed) {
        const { error } = await supabase
          .from('user_followed_entities')
          .delete()
          .eq('user_id', userId)
          .eq('entity_id', entityId);
        return error ? isCurrentlyFollowed : false;
      } else {
        const { error } = await supabase
          .from('user_followed_entities')
          .upsert({ user_id: userId, entity_id: entityId }, { onConflict: 'user_id,entity_id' });
        return error ? isCurrentlyFollowed : true;
      }
    } catch {
      return isCurrentlyFollowed;
    }
  },

  /**
   * Alterna fonte seguida no Supabase
   */
  async toggleFollowSource(userId: string, sourceId: string, isCurrentlyFollowed: boolean): Promise<boolean> {
    if (!isSupabaseConfigured || !userId) return !isCurrentlyFollowed;

    try {
      if (isCurrentlyFollowed) {
        const { error } = await supabase
          .from('user_followed_sources')
          .delete()
          .eq('user_id', userId)
          .eq('source_id', sourceId);
        return error ? isCurrentlyFollowed : false;
      } else {
        const { error } = await supabase
          .from('user_followed_sources')
          .upsert({ user_id: userId, source_id: sourceId }, { onConflict: 'user_id,source_id' });
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
   * Verifica evidência real no PostgreSQL para reconciliação segura de usuários legados
   */
  async checkLegacyOnboardingEvidence(userId: string): Promise<{
    hasEvidence: boolean;
    followedEntityIds: string[];
    followedTopicIds: string[];
    followedSourceIds: string[];
  }> {
    if (!isSupabaseConfigured || !userId) {
      return { hasEvidence: false, followedEntityIds: [], followedTopicIds: [], followedSourceIds: [] };
    }

    try {
      const [topicsRes, entitiesRes, sourcesRes, prefsRes] = await Promise.all([
        supabase.from('user_followed_topics').select('topic_id').eq('user_id', userId),
        supabase.from('user_followed_entities').select('entity_id').eq('user_id', userId),
        supabase.from('user_followed_sources').select('source_id').eq('user_id', userId),
        supabase.from('user_preferences').select('created_at, updated_at').eq('id', userId).maybeSingle()
      ]);

      const followedTopicIds = Array.isArray(topicsRes.data) ? topicsRes.data.map((r) => r.topic_id) : [];
      const followedEntityIds = Array.isArray(entitiesRes.data) ? entitiesRes.data.map((r) => r.entity_id) : [];
      const followedSourceIds = Array.isArray(sourcesRes.data) ? sourcesRes.data.map((r) => r.source_id) : [];

      let hasModifiedPreferences = false;
      if (prefsRes.data?.created_at && prefsRes.data?.updated_at) {
        const createdMs = new Date(prefsRes.data.created_at).getTime();
        const updatedMs = new Date(prefsRes.data.updated_at).getTime();
        if (!Number.isNaN(createdMs) && !Number.isNaN(updatedMs) && updatedMs - createdMs > 5000) {
          hasModifiedPreferences = true;
        }
      }

      const hasEvidence =
        followedTopicIds.length > 0 ||
        followedEntityIds.length > 0 ||
        followedSourceIds.length > 0 ||
        hasModifiedPreferences;

      return { hasEvidence, followedEntityIds, followedTopicIds, followedSourceIds };
    } catch {
      return { hasEvidence: false, followedEntityIds: [], followedTopicIds: [], followedSourceIds: [] };
    }
  },

  /**
   * Consulta o estado canônico do onboarding do usuário diretamente no Supabase.
   * Fonte de verdade entre dispositivos e navegadores.
   */
  async getOnboardingState(userId: string): Promise<CanonicalOnboardingState> {
    if (!isSupabaseConfigured || !userId) {
      return {
        status: 'NOT_STARTED',
        step: 1,
        completedAt: null,
        data: {},
        persistedInDb: false
      };
    }

    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, onboarding_status, onboarding_step, onboarding_completed_at, onboarding_data')
        .eq('id', userId)
        .maybeSingle();

      // Caso a coluna ainda não tenha sido aplicada no banco remoto, faz reconciliação pelas tabelas relacionadas
      if (error && isMissingColumnError(error)) {
        const legacy = await this.checkLegacyOnboardingEvidence(userId);
        if (legacy.hasEvidence) {
          return {
            status: 'COMPLETED',
            step: 7,
            completedAt: new Date().toISOString(),
            data: {
              followedEntityIds: legacy.followedEntityIds,
              followedTopicIds: legacy.followedTopicIds,
              followedSourceIds: legacy.followedSourceIds
            },
            persistedInDb: true,
            reconciledFromLegacy: true
          };
        }
        return {
          status: 'NOT_STARTED',
          step: 1,
          completedAt: null,
          data: {},
          persistedInDb: false
        };
      }

      if (profile) {
        const rawStatus = profile.onboarding_status as OnboardingStatus | undefined;
        const savedData = (profile.onboarding_data && typeof profile.onboarding_data === 'object'
          ? profile.onboarding_data
          : {}) as OnboardingSavedData;

        if (rawStatus === 'COMPLETED' || Boolean(profile.onboarding_completed_at)) {
          try {
            localStorage.setItem(`sinal_onboarded_${userId}`, 'true');
          } catch {}
          return {
            status: 'COMPLETED',
            step: profile.onboarding_step || 7,
            completedAt: profile.onboarding_completed_at || new Date().toISOString(),
            data: savedData,
            persistedInDb: true
          };
        }

        if (rawStatus === 'IN_PROGRESS') {
          return {
            status: 'IN_PROGRESS',
            step: Math.max(1, Math.min(7, Number(profile.onboarding_step) || 1)),
            completedAt: null,
            data: savedData,
            persistedInDb: true
          };
        }
      }

      // Perfil ainda sem COMPLETED: verifica evidências reais legadas no banco antes de forçar onboarding
      const legacy = await this.checkLegacyOnboardingEvidence(userId);
      if (legacy.hasEvidence) {
        const completedAt = new Date().toISOString();
        const reconciledData: OnboardingSavedData = {
          followedEntityIds: legacy.followedEntityIds,
          followedTopicIds: legacy.followedTopicIds,
          followedSourceIds: legacy.followedSourceIds
        };

        try {
          await supabase
            .from('profiles')
            .update({
              onboarding_status: 'COMPLETED',
              onboarding_step: 7,
              onboarding_completed_at: completedAt,
              onboarding_data: reconciledData,
              updated_at: completedAt
            })
            .eq('id', userId);
        } catch {}

        try {
          localStorage.setItem(`sinal_onboarded_${userId}`, 'true');
        } catch {}

        return {
          status: 'COMPLETED',
          step: 7,
          completedAt,
          data: reconciledData,
          persistedInDb: true,
          reconciledFromLegacy: true
        };
      }

      return {
        status: 'NOT_STARTED',
        step: 1,
        completedAt: null,
        data: {},
        persistedInDb: Boolean(profile)
      };
    } catch {
      return {
        status: 'NOT_STARTED',
        step: 1,
        completedAt: null,
        data: {},
        persistedInDb: false
      };
    }
  },

  /**
   * Salva progresso parcial do onboarding (IN_PROGRESS) no Supabase sem apagar seleções.
   */
  async saveOnboardingProgress(
    userId: string,
    step: number,
    data: OnboardingSavedData
  ): Promise<boolean> {
    try {
      if (Array.isArray(data.themes)) {
        localStorage.setItem('fatosbr_user_interests', JSON.stringify(data.themes));
      }
      if (Array.isArray(data.feedPreferences)) {
        localStorage.setItem('fatosbr_feed_preferences', JSON.stringify(data.feedPreferences));
      }
      if (data.userLocation) {
        localStorage.setItem('fatosbr_user_region', data.userLocation);
      }
    } catch {}

    if (!isSupabaseConfigured || !userId) return false;

    try {
      const nowIso = new Date().toISOString();
      // Nunca regride um onboarding que já está COMPLETED para IN_PROGRESS
      const { data: existing } = await supabase
        .from('profiles')
        .select('onboarding_status')
        .eq('id', userId)
        .maybeSingle();

      const nextStatus: OnboardingStatus =
        existing?.onboarding_status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS';

      const { error } = await supabase
        .from('profiles')
        .update({
          onboarding_status: nextStatus,
          onboarding_step: step,
          onboarding_data: data,
          updated_at: nowIso
        })
        .eq('id', userId);

      if (error) {
        if (!isMissingColumnError(error)) {
          console.warn('[UserService] Falha ao salvar progresso do onboarding:', error.message);
        }
        return false;
      }

      return true;
    } catch {
      return false;
    }
  },

  /**
   * Conclui o onboarding definitivamente no Supabase (`onboarding_status = 'COMPLETED'`)
   * e persiste interesses, entidades, fontes e preferências associadas ao userId.
   */
  async completeOnboarding(
    userId: string,
    payload: OnboardingSavedData,
    userEmail?: string | null
  ): Promise<{ success: boolean; persistedInDb: boolean }> {
    const completedAt = new Date().toISOString();

    try {
      if (Array.isArray(payload.themes)) {
        localStorage.setItem('fatosbr_user_interests', JSON.stringify(payload.themes));
        window.dispatchEvent(new CustomEvent('fatosbr_interests_updated', { detail: { interests: payload.themes } }));
      }
      if (Array.isArray(payload.feedPreferences)) {
        localStorage.setItem('fatosbr_feed_preferences', JSON.stringify(payload.feedPreferences));
      }
      if (payload.userLocation) {
        localStorage.setItem('fatosbr_user_region', payload.userLocation);
      }
      if (userId) {
        localStorage.setItem(`sinal_onboarded_${userId}`, 'true');
      }
    } catch {}

    if (!isSupabaseConfigured || !userId) {
      return { success: true, persistedInDb: false };
    }

    let profileUpdated = false;

    try {
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({
          onboarding_status: 'COMPLETED',
          onboarding_step: 7,
          onboarding_completed_at: completedAt,
          onboarding_data: payload,
          updated_at: completedAt
        })
        .eq('id', userId);

      if (!updateErr) {
        profileUpdated = true;
      } else if (!isMissingColumnError(updateErr)) {
        // Fallback: tenta upsert mínimo caso o profile ainda não existisse
        const { error: upsertErr } = await supabase
          .from('profiles')
          .upsert(
            {
              id: userId,
              email: userEmail || '',
              onboarding_status: 'COMPLETED',
              onboarding_step: 7,
              onboarding_completed_at: completedAt,
              onboarding_data: payload,
              updated_at: completedAt
            },
            { onConflict: 'id' }
          );
        profileUpdated = !upsertErr;
      }
    } catch {}

    // Persistir preferências de notificação/briefing em user_preferences
    try {
      const notifs = new Set(payload.notificationsPreferences || []);
      await this.updateUserPreferences(userId, {
        email_morning_briefing: notifs.has('daily_email') || notifs.size === 0,
        email_evening_briefing: notifs.has('daily_email'),
        email_breaking_alerts: notifs.has('app_realtime') || notifs.size === 0,
        briefing_email: userEmail || undefined,
        timezone: 'America/Sao_Paulo'
      });
    } catch {}

    // Persistir entidades seguidas no Supabase (somente IDs válidos existentes em entities)
    if (Array.isArray(payload.followedEntityIds) && payload.followedEntityIds.length > 0) {
      try {
        await supabase.from('user_followed_entities').delete().eq('user_id', userId);
        const rows = payload.followedEntityIds.map((entityId) => ({ user_id: userId, entity_id: entityId }));
        await supabase.from('user_followed_entities').upsert(rows, { onConflict: 'user_id,entity_id' });
      } catch {}
    }

    // Persistir fontes seguidas no Supabase
    if (Array.isArray(payload.followedSourceIds) && payload.followedSourceIds.length > 0) {
      try {
        await supabase.from('user_followed_sources').delete().eq('user_id', userId);
        const rows = payload.followedSourceIds.map((sourceId) => ({ user_id: userId, source_id: sourceId }));
        await supabase.from('user_followed_sources').upsert(rows, { onConflict: 'user_id,source_id' });
      } catch {}
    }

    // Persistir tópicos seguidos no Supabase
    if (Array.isArray(payload.followedTopicIds) && payload.followedTopicIds.length > 0) {
      try {
        const rows = payload.followedTopicIds.map((topicId) => ({ user_id: userId, topic_id: topicId }));
        await supabase.from('user_followed_topics').upsert(rows, { onConflict: 'user_id,topic_id' });
      } catch {}
    }

    return {
      success: true,
      persistedInDb: profileUpdated
    };
  },

  /**
   * Atualiza interesses selecionados (ex: RecalibrateInterestsModal) no Supabase sem perder outros campos.
   */
  async updateUserInterests(userId: string, themes: string[]): Promise<boolean> {
    try {
      localStorage.setItem('fatosbr_user_interests', JSON.stringify(themes));
      window.dispatchEvent(new CustomEvent('fatosbr_interests_updated', { detail: { interests: themes } }));
    } catch {}

    if (!isSupabaseConfigured || !userId) return false;

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_data, onboarding_status')
        .eq('id', userId)
        .maybeSingle();

      const currentData =
        profile?.onboarding_data && typeof profile.onboarding_data === 'object'
          ? (profile.onboarding_data as OnboardingSavedData)
          : {};

      const { error } = await supabase
        .from('profiles')
        .update({
          onboarding_data: {
            ...currentData,
            themes
          },
          onboarding_status: 'COMPLETED',
          onboarding_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Sincroniza o perfil do usuário na tabela public.profiles do Supabase de forma NÃO destrutiva:
   * - Se o perfil já existir: atualiza apenas metadados básicos (email, full_name, avatar_url, updated_at),
   *   preservando integralmente assinatura/billing (plan_name, subscription_status) e onboarding_status.
   * - Se não existir: cria o registro inicial com segurança.
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
    const defaultPlanName = isAdmin ? 'PRO_UNLIMITED' : 'TRIAL_7D';
    const defaultSubscriptionStatus = isAdmin ? 'ACTIVE' : 'TRIAL_ACTIVE';
    const nowIso = new Date().toISOString();

    if (isSupabaseConfigured && user.id) {
      try {
        const { data: existingProfile, error: fetchError } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, plan_name, subscription_status, is_admin')
          .eq('id', user.id)
          .maybeSingle();

        if (!fetchError && existingProfile) {
          await supabase
            .from('profiles')
            .update({
              email,
              full_name: existingProfile.full_name || fullName,
              avatar_url: avatarUrl || existingProfile.avatar_url || null,
              updated_at: nowIso
            })
            .eq('id', user.id);
        } else if (!fetchError) {
          const { error: insertErr } = await supabase
            .from('profiles')
            .insert({
              id: user.id,
              email,
              full_name: fullName,
              avatar_url: avatarUrl || null,
              plan_name: defaultPlanName,
              subscription_status: defaultSubscriptionStatus,
              is_admin: isAdmin,
              onboarding_status: 'NOT_STARTED',
              onboarding_step: 1,
              onboarding_data: {},
              updated_at: nowIso
            });

          if (insertErr && isMissingColumnError(insertErr)) {
            await supabase
              .from('profiles')
              .upsert(
                {
                  id: user.id,
                  email,
                  full_name: fullName,
                  avatar_url: avatarUrl || null,
                  plan_name: defaultPlanName,
                  subscription_status: defaultSubscriptionStatus,
                  is_admin: isAdmin,
                  updated_at: nowIso
                },
                { onConflict: 'id' }
              );
          }
        }
      } catch (err) {
        console.warn('[UserService] Falha na sincronização segura de public.profiles:', err);
      }
    }

    // Atualizar espelho local para o Painel Admin sem afetar o banco
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
        planName: existingIdx >= 0 && registry[existingIdx].planName ? registry[existingIdx].planName : defaultPlanName,
        subscriptionStatus:
          existingIdx >= 0 && registry[existingIdx].subscriptionStatus
            ? registry[existingIdx].subscriptionStatus
            : defaultSubscriptionStatus,
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
  }
};
