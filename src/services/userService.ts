/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';

export type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'ERROR';

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
  error?: string;
}

type SupabaseClientLike = typeof supabase;
let testSupabaseOverride: { client: SupabaseClientLike; configured: boolean } | null = null;

/**
 * Permite injeção controlada de cliente mockado exclusivamente em suítes de teste.
 */
export function setTestUserServiceClient(
  override: { client: any; configured?: boolean } | null
): void {
  if (override) {
    testSupabaseOverride = {
      client: override.client as SupabaseClientLike,
      configured: override.configured ?? true,
    };
  } else {
    testSupabaseOverride = null;
  }
}

function getDb(): { client: SupabaseClientLike; configured: boolean } {
  if (testSupabaseOverride) {
    return testSupabaseOverride;
  }
  return { client: supabase, configured: isSupabaseConfigured };
}

function isMissingColumnError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    msg.includes('schema cache')
  );
}

function isMissingRelationError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (msg.includes('relation') && msg.includes('does not exist')) ||
    msg.includes('could not find the table')
  );
}

export function normalizeOnboardingStatus(raw: unknown): Exclude<OnboardingStatus, 'ERROR'> | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'COMPLETED') return 'COMPLETED';
  if (upper === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (upper === 'NOT_STARTED') return 'NOT_STARTED';
  return null;
}

export const userService = {
  /**
   * Retorna os IDs dos acontecimentos salvos pelo usuário
   */
  async getSavedEventIds(userId: string): Promise<string[]> {
    const { client, configured } = getDb();
    if (!configured || !userId) return [];
    try {
      const { data, error } = await client
        .from('user_saved_events')
        .select('event_id')
        .eq('user_id', userId);

      if (error || !data) return [];
      return data.map((item: any) => item.event_id);
    } catch {
      return [];
    }
  },

  /**
   * Alterna estado de salvo/bookmark no Supabase
   */
  async toggleSaveEvent(userId: string, eventId: string, isCurrentlySaved: boolean): Promise<boolean> {
    const { client, configured } = getDb();
    if (!configured || !userId) return !isCurrentlySaved;

    try {
      if (isCurrentlySaved) {
        const { error } = await client
          .from('user_saved_events')
          .delete()
          .eq('user_id', userId)
          .eq('event_id', eventId);
        return error ? isCurrentlySaved : false;
      } else {
        const { error } = await client
          .from('user_saved_events')
          .insert({ user_id: userId, event_id: eventId });
        return error ? isCurrentlySaved : true;
      }
    } catch {
      return isCurrentlySaved;
    }
  },

  /**
   * Retorna tópicos seguidos pelo usuário (`public.user_topic_follows`)
   */
  async getFollowedTopicIds(userId: string): Promise<string[]> {
    const { client, configured } = getDb();
    if (!configured || !userId) return [];
    try {
      const { data, error } = await client
        .from('user_topic_follows')
        .select('topic_id')
        .eq('user_id', userId);

      if (error || !data) return [];
      return data.map((item: any) => item.topic_id);
    } catch {
      return [];
    }
  },

  /**
   * Retorna entidades seguidas pelo usuário no Supabase (`public.user_entity_follows`)
   */
  async getFollowedEntityIds(userId: string): Promise<string[]> {
    const { client, configured } = getDb();
    if (!configured || !userId) return [];
    try {
      const { data, error } = await client
        .from('user_entity_follows')
        .select('entity_id')
        .eq('user_id', userId);

      if (error || !data) return [];
      return data.map((item: any) => item.entity_id);
    } catch {
      return [];
    }
  },

  /**
   * Retorna fontes seguidas pelo usuário no Supabase (`public.user_source_follows`)
   */
  async getFollowedSourceIds(userId: string): Promise<string[]> {
    const { client, configured } = getDb();
    if (!configured || !userId) return [];
    try {
      const { data, error } = await client
        .from('user_source_follows')
        .select('source_id')
        .eq('user_id', userId);

      if (error || !data) return [];
      return data.map((item: any) => item.source_id);
    } catch {
      return [];
    }
  },

  /**
   * Alterna tópico seguido (`public.user_topic_follows`)
   */
  async toggleFollowTopic(userId: string, topicId: string, isCurrentlyFollowed: boolean): Promise<boolean> {
    const { client, configured } = getDb();
    if (!configured || !userId) return !isCurrentlyFollowed;

    try {
      if (isCurrentlyFollowed) {
        const { error } = await client
          .from('user_topic_follows')
          .delete()
          .eq('user_id', userId)
          .eq('topic_id', topicId);
        return error ? isCurrentlyFollowed : false;
      } else {
        const { error } = await client
          .from('user_topic_follows')
          .upsert({ user_id: userId, topic_id: topicId }, { onConflict: 'user_id,topic_id' });
        return error ? isCurrentlyFollowed : true;
      }
    } catch {
      return isCurrentlyFollowed;
    }
  },

  /**
   * Alterna entidade seguida no Supabase (`public.user_entity_follows`)
   */
  async toggleFollowEntity(userId: string, entityId: string, isCurrentlyFollowed: boolean): Promise<boolean> {
    const { client, configured } = getDb();
    if (!configured || !userId) return !isCurrentlyFollowed;

    try {
      if (isCurrentlyFollowed) {
        const { error } = await client
          .from('user_entity_follows')
          .delete()
          .eq('user_id', userId)
          .eq('entity_id', entityId);
        return error ? isCurrentlyFollowed : false;
      } else {
        const { error } = await client
          .from('user_entity_follows')
          .upsert({ user_id: userId, entity_id: entityId }, { onConflict: 'user_id,entity_id' });
        return error ? isCurrentlyFollowed : true;
      }
    } catch {
      return isCurrentlyFollowed;
    }
  },

  /**
   * Alterna fonte seguida no Supabase (`public.user_source_follows`)
   */
  async toggleFollowSource(userId: string, sourceId: string, isCurrentlyFollowed: boolean): Promise<boolean> {
    const { client, configured } = getDb();
    if (!configured || !userId) return !isCurrentlyFollowed;

    try {
      if (isCurrentlyFollowed) {
        const { error } = await client
          .from('user_source_follows')
          .delete()
          .eq('user_id', userId)
          .eq('source_id', sourceId);
        return error ? isCurrentlyFollowed : false;
      } else {
        const { error } = await client
          .from('user_source_follows')
          .upsert({ user_id: userId, source_id: sourceId }, { onConflict: 'user_id,source_id' });
        return error ? isCurrentlyFollowed : true;
      }
    } catch {
      return isCurrentlyFollowed;
    }
  },

  /**
   * Detecta erro de sessão expirada ou token JWT inválido do Supabase
   */
  isSessionExpiredError(err: any): boolean {
    if (!err) return false;
    const msg = String(err?.message || '').toLowerCase();
    const code = String(err?.code || '').toUpperCase();
    const status = Number(err?.status || 0);
    return (
      status === 401 ||
      code === 'PGRST301' ||
      msg.includes('jwt expired') ||
      msg.includes('invalid jwt') ||
      msg.includes('session not found') ||
      msg.includes('refresh_token')
    );
  },

  /**
   * Carrega preferências detalhadas do usuário consolidando de forma canônica
   * `public.user_preferences` (entrega de briefings) e `public.user_settings` (configurações e `notification_settings`).
   * Diferencia ausência de registro de falha real de rede/sessão expirada.
   */
  async getUserPreferencesDetailed(userId: string): Promise<{
    data: any | null;
    error?: string;
    sessionExpired?: boolean;
  }> {
    const { client, configured } = getDb();
    if (!configured || !userId) return { data: null };

    try {
      const [prefRes, settingsRes] = await Promise.all([
        client.from('user_preferences').select('*').eq('id', userId).maybeSingle(),
        client.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
      ]);

      const prefErr = prefRes.error;
      const settingsErr = settingsRes.error;

      if (this.isSessionExpiredError(prefErr) || this.isSessionExpiredError(settingsErr)) {
        return { data: null, error: 'Sua sessão expirou. Faça login novamente.', sessionExpired: true };
      }

      const prefFatal = prefErr && !isMissingRelationError(prefErr) ? prefErr : null;
      const settingsFatal = settingsErr && !isMissingRelationError(settingsErr) ? settingsErr : null;

      if (prefFatal && settingsFatal) {
        return { data: null, error: prefFatal.message || settingsFatal.message || 'Falha ao carregar preferências do Supabase.' };
      }
      if (prefFatal && isMissingRelationError(settingsErr)) {
        return { data: null, error: prefFatal.message || 'Falha ao carregar preferências do Supabase.' };
      }
      if (settingsFatal && isMissingRelationError(prefErr)) {
        return { data: null, error: settingsFatal.message || 'Falha ao carregar configurações do usuário.' };
      }

      const prefData = !prefErr ? prefRes.data : null;
      const settingsData = !settingsErr ? settingsRes.data : null;

      if (!prefData && !settingsData) {
        if (prefFatal || settingsFatal) {
          return { data: null, error: (prefFatal || settingsFatal)?.message || 'Falha ao carregar preferências.' };
        }
        return { data: null };
      }

      const mergedNotificationSettings =
        (settingsData?.notification_settings && typeof settingsData.notification_settings === 'object'
          ? settingsData.notification_settings
          : null) ??
        (prefData?.notification_settings && typeof prefData.notification_settings === 'object'
          ? prefData.notification_settings
          : undefined);

      const merged = {
        ...(settingsData || {}),
        ...(prefData || {}),
        email_morning_briefing:
          typeof prefData?.email_morning_briefing === 'boolean'
            ? prefData.email_morning_briefing
            : settingsData?.email_morning_briefing,
        email_evening_briefing:
          typeof prefData?.email_evening_briefing === 'boolean'
            ? prefData.email_evening_briefing
            : settingsData?.email_evening_briefing,
        email_breaking_alerts:
          typeof prefData?.email_breaking_alerts === 'boolean'
            ? prefData.email_breaking_alerts
            : settingsData?.email_breaking_alerts,
        weekend_edition:
          typeof prefData?.weekend_edition === 'boolean'
            ? prefData.weekend_edition
            : settingsData?.weekend_edition,
        briefing_email: prefData?.briefing_email || settingsData?.briefing_email,
        morning_time: prefData?.morning_time || settingsData?.morning_time,
        evening_time: prefData?.evening_time || settingsData?.evening_time,
        timezone: prefData?.timezone || settingsData?.timezone,
        notification_settings: mergedNotificationSettings,
        updated_at:
          prefData?.updated_at && settingsData?.updated_at
            ? new Date(prefData.updated_at).getTime() >= new Date(settingsData.updated_at).getTime()
              ? prefData.updated_at
              : settingsData.updated_at
            : prefData?.updated_at || settingsData?.updated_at,
      };

      return { data: merged };
    } catch (err: any) {
      return { data: null, error: err?.message || 'Erro de conexão ao consultar preferências.' };
    }
  },

  /**
   * Carrega preferências do usuário (`user_preferences` + `user_settings` canônicos)
   */
  async getUserPreferences(userId: string) {
    const res = await this.getUserPreferencesDetailed(userId);
    if (res.error) {
      console.warn('[UserService] Falha ao carregar preferências do Supabase:', res.error);
    }
    return res.data;
  },

  /**
   * Atualiza preferências no Supabase de forma estritamente consistente:
   * - Nunca descarta campos solicitados para retornar falso sucesso.
   * - Persiste preferências de entrega em `public.user_preferences` (ou `user_settings`)
   *   e `notification_settings` no armazenamento canônico (`user_settings` ou `user_preferences`).
   * - Retorna erro explícito se algum campo solicitado não puder ser gravado no esquema atual.
   */
  async updateUserPreferencesDetailed(
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
      notification_settings?: Record<string, any>;
    }
  ): Promise<{ success: boolean; error?: string; sessionExpired?: boolean; updatedAt?: string }> {
    const { client, configured } = getDb();
    if (!configured || !userId) {
      return { success: false, error: 'Sessão ou conexão Supabase indisponível.' };
    }

    const nowIso = new Date().toISOString();
    const cleanedUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates || {})) {
      if (v !== undefined) cleanedUpdates[k] = v;
    }

    if (Object.keys(cleanedUpdates).length === 0) {
      return { success: false, error: 'Nenhuma preferência informada para atualização.' };
    }

    const hasNotificationSettings = Object.prototype.hasOwnProperty.call(cleanedUpdates, 'notification_settings');
    const baseBriefingKeys = [
      'email_morning_briefing',
      'email_evening_briefing',
      'email_breaking_alerts',
      'weekend_edition',
      'briefing_email',
    ];
    const scheduleKeys = ['morning_time', 'evening_time', 'timezone'];

    const baseUpdates: Record<string, any> = {};
    const scheduleUpdates: Record<string, any> = {};
    for (const k of baseBriefingKeys) {
      if (k in cleanedUpdates) baseUpdates[k] = cleanedUpdates[k];
    }
    for (const k of scheduleKeys) {
      if (k in cleanedUpdates) scheduleUpdates[k] = cleanedUpdates[k];
    }

    const upsertTable = async (
      table: 'user_preferences' | 'user_settings',
      pkCol: 'id' | 'user_id',
      fields: Record<string, any>
    ): Promise<{ ok: boolean; error?: any }> => {
      const payload = { [pkCol]: userId, ...fields, updated_at: nowIso };
      const { error } = await client.from(table).upsert(payload, { onConflict: pkCol });
      return { ok: !error, error };
    };

    try {
      // 1. Persistir `notification_settings` quando solicitado (armazenamento canônico: user_settings, fallback user_preferences)
      if (hasNotificationSettings) {
        const nsPayload: Record<string, any> = {
          notification_settings: cleanedUpdates.notification_settings,
        };
        if ('email_breaking_alerts' in cleanedUpdates) {
          nsPayload.email_breaking_alerts = cleanedUpdates.email_breaking_alerts;
        }

        const settingsWrite = await upsertTable('user_settings', 'user_id', nsPayload);
        if (!settingsWrite.ok) {
          if (this.isSessionExpiredError(settingsWrite.error)) {
            return { success: false, sessionExpired: true, error: 'Sua sessão expirou. Faça login novamente.' };
          }

          if (isMissingColumnError(settingsWrite.error) || isMissingRelationError(settingsWrite.error)) {
            // Tenta armazenar notification_settings em user_preferences somente se a coluna existir lá
            const prefNsWrite = await upsertTable('user_preferences', 'id', nsPayload);
            if (!prefNsWrite.ok) {
              if (this.isSessionExpiredError(prefNsWrite.error)) {
                return { success: false, sessionExpired: true, error: 'Sua sessão expirou. Faça login novamente.' };
              }
              if (isMissingColumnError(prefNsWrite.error) || isMissingRelationError(prefNsWrite.error)) {
                return {
                  success: false,
                  error:
                    'Não foi possível persistir notification_settings: coluna ausente no banco de dados (migração V2.3.1 pendente).'
                };
              }
              return {
                success: false,
                error: prefNsWrite.error?.message || 'Falha ao salvar preferências de notificação no banco.'
              };
            }
          } else {
            return {
              success: false,
              error: settingsWrite.error?.message || 'Falha ao salvar preferências de notificação no banco.'
            };
          }
        }
      }

      // 2. Persistir preferências de entrega e horários de briefings sem descartar campos solicitados
      const briefingFields = { ...baseUpdates, ...scheduleUpdates };
      if (Object.keys(briefingFields).length > 0) {
        const prefWrite = await upsertTable('user_preferences', 'id', briefingFields);

        if (!prefWrite.ok) {
          if (this.isSessionExpiredError(prefWrite.error)) {
            return { success: false, sessionExpired: true, error: 'Sua sessão expirou. Faça login novamente.' };
          }

          if (isMissingRelationError(prefWrite.error)) {
            // Ambiente usa exclusivamente user_settings
            const settingsAllWrite = await upsertTable('user_settings', 'user_id', briefingFields);
            if (!settingsAllWrite.ok) {
              if (this.isSessionExpiredError(settingsAllWrite.error)) {
                return { success: false, sessionExpired: true, error: 'Sua sessão expirou. Faça login novamente.' };
              }
              if (isMissingColumnError(settingsAllWrite.error)) {
                return {
                  success: false,
                  error:
                    'Não foi possível salvar todas as preferências solicitadas: colunas de agendamento/entrega ausentes em user_settings.'
                };
              }
              return {
                success: false,
                error: settingsAllWrite.error?.message || 'Falha ao salvar configurações do usuário.'
              };
            }
          } else if (isMissingColumnError(prefWrite.error)) {
            // user_preferences não possui colunas de horário/fuso -> só aceita se user_settings persistir integralmente essas colunas
            let schedulePersistedInSettings = Object.keys(scheduleUpdates).length === 0;
            if (Object.keys(scheduleUpdates).length > 0) {
              const settingsSchedWrite = await upsertTable('user_settings', 'user_id', scheduleUpdates);
              if (this.isSessionExpiredError(settingsSchedWrite.error)) {
                return { success: false, sessionExpired: true, error: 'Sua sessão expirou. Faça login novamente.' };
              }
              schedulePersistedInSettings = settingsSchedWrite.ok;
            }

            if (!schedulePersistedInSettings) {
              return {
                success: false,
                error:
                  'Não foi possível persistir horários ou fuso horário de briefings: colunas ausentes no banco de dados (migração V2.3.1 pendente).'
              };
            }

            if (Object.keys(baseUpdates).length > 0) {
              const prefBaseWrite = await upsertTable('user_preferences', 'id', baseUpdates);
              if (!prefBaseWrite.ok) {
                if (this.isSessionExpiredError(prefBaseWrite.error)) {
                  return { success: false, sessionExpired: true, error: 'Sua sessão expirou. Faça login novamente.' };
                }
                return {
                  success: false,
                  error: prefBaseWrite.error?.message || 'Falha ao salvar preferências de entrega no banco.'
                };
              }
            }
          } else {
            return {
              success: false,
              error: prefWrite.error?.message || 'Falha ao persistir preferências no Supabase.'
            };
          }
        }
      }

      return { success: true, updatedAt: nowIso };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro de conexão ao salvar preferências.' };
    }
  },

  /**
   * Atualiza ou cria as preferências do usuário no Supabase (`user_preferences` / `user_settings`)
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
      notification_settings?: Record<string, any>;
    }
  ): Promise<boolean> {
    const res = await this.updateUserPreferencesDetailed(userId, updates);
    if (!res.success && res.error) {
      console.error('[UserService] Erro ao persistir preferências no Supabase:', res.error);
    }
    return res.success;
  },

  /**
   * Verifica evidência real nas tabelas canônicas de seguidos para reconciliação segura de usuários legados.
   * Nunca marca COMPLETED apenas por existir linha padrão em user_settings ou user_preferences.
   */
  async checkLegacyOnboardingEvidence(userId: string): Promise<{
    hasEvidence: boolean;
    followedEntityIds: string[];
    followedTopicIds: string[];
    followedSourceIds: string[];
    error?: string;
  }> {
    const { client, configured } = getDb();
    if (!configured || !userId) {
      return { hasEvidence: false, followedEntityIds: [], followedTopicIds: [], followedSourceIds: [] };
    }

    try {
      const [topicsRes, entitiesRes, sourcesRes] = await Promise.all([
        client.from('user_topic_follows').select('topic_id').eq('user_id', userId),
        client.from('user_entity_follows').select('entity_id').eq('user_id', userId),
        client.from('user_source_follows').select('source_id').eq('user_id', userId),
      ]);

      // Se todas falharem por erro real de banco/rede (não tabela ausente), sinaliza erro para não resetar usuário
      const realErrors = [topicsRes.error, entitiesRes.error, sourcesRes.error].filter(
        (e) => e && !isMissingRelationError(e)
      );
      if (realErrors.length > 0) {
        return {
          hasEvidence: false,
          followedEntityIds: [],
          followedTopicIds: [],
          followedSourceIds: [],
          error: realErrors[0]?.message || 'Falha ao consultar seguidos do usuário.',
        };
      }

      const followedTopicIds = Array.isArray(topicsRes.data) ? topicsRes.data.map((r: any) => r.topic_id) : [];
      const followedEntityIds = Array.isArray(entitiesRes.data) ? entitiesRes.data.map((r: any) => r.entity_id) : [];
      const followedSourceIds = Array.isArray(sourcesRes.data) ? sourcesRes.data.map((r: any) => r.source_id) : [];

      const hasEvidence =
        followedTopicIds.length > 0 ||
        followedEntityIds.length > 0 ||
        followedSourceIds.length > 0;

      return { hasEvidence, followedEntityIds, followedTopicIds, followedSourceIds };
    } catch (err: any) {
      return {
        hasEvidence: false,
        followedEntityIds: [],
        followedTopicIds: [],
        followedSourceIds: [],
        error: err?.message || 'Falha de conexão ao verificar histórico do usuário.',
      };
    }
  },

  /**
   * Consulta o estado canônico do onboarding diretamente em `public.profiles` usando `user_id`.
   * Em caso de falha de consulta no banco, retorna `status: 'ERROR'` para permitir recuperação
   * sem jamais redirecionar erroneamente usuários antigos para o onboarding.
   */
  async getOnboardingState(userId: string): Promise<CanonicalOnboardingState> {
    const { client, configured } = getDb();
    if (!configured || !userId) {
      return {
        status: 'NOT_STARTED',
        step: 1,
        completedAt: null,
        data: {},
        persistedInDb: false,
      };
    }

    try {
      let profile: any = null;
      let missingAuxColumns = false;

      const { data: fullProfile, error } = await client
        .from('profiles')
        .select('id, user_id, onboarding_status, onboarding_step, onboarding_completed_at, onboarding_data')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        if (isMissingColumnError(error)) {
          missingAuxColumns = true;
          const { data: baseProfile, error: baseError } = await client
            .from('profiles')
            .select('id, user_id, onboarding_status')
            .eq('user_id', userId)
            .maybeSingle();

          if (baseError) {
            return {
              status: 'ERROR',
              step: 1,
              completedAt: null,
              data: {},
              persistedInDb: false,
              error: baseError.message || 'Falha ao consultar perfil no Supabase.',
            };
          }
          profile = baseProfile;
        } else {
          return {
            status: 'ERROR',
            step: 1,
            completedAt: null,
            data: {},
            persistedInDb: false,
            error: error.message || 'Falha ao consultar estado do onboarding no Supabase.',
          };
        }
      } else {
        profile = fullProfile;
      }

      if (profile) {
        const normalizedStatus = normalizeOnboardingStatus(profile.onboarding_status);
        const savedData = (profile.onboarding_data && typeof profile.onboarding_data === 'object'
          ? profile.onboarding_data
          : {}) as OnboardingSavedData;

        if (normalizedStatus === 'COMPLETED' || Boolean(profile.onboarding_completed_at)) {
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(`sinal_onboarded_${userId}`, 'true');
            }
          } catch {}
          return {
            status: 'COMPLETED',
            step: Number(profile.onboarding_step) || 7,
            completedAt: profile.onboarding_completed_at || null,
            data: savedData,
            persistedInDb: true,
          };
        }

        if (normalizedStatus === 'IN_PROGRESS') {
          return {
            status: 'IN_PROGRESS',
            step: Math.max(1, Math.min(7, Number(profile.onboarding_step) || 1)),
            completedAt: null,
            data: savedData,
            persistedInDb: true,
          };
        }
      }

      // Perfil ausente ou ainda em NOT_STARTED: verifica evidências reais legadas nas tabelas de seguidos
      const legacy = await this.checkLegacyOnboardingEvidence(userId);
      if (legacy.error) {
        return {
          status: 'ERROR',
          step: 1,
          completedAt: null,
          data: {},
          persistedInDb: false,
          error: legacy.error,
        };
      }

      if (legacy.hasEvidence) {
        const completedAt = new Date().toISOString();
        const reconciledData: OnboardingSavedData = {
          followedEntityIds: legacy.followedEntityIds,
          followedTopicIds: legacy.followedTopicIds,
          followedSourceIds: legacy.followedSourceIds,
        };

        if (profile) {
          try {
            const payload = missingAuxColumns
              ? { onboarding_status: 'COMPLETED', updated_at: completedAt }
              : {
                  onboarding_status: 'COMPLETED',
                  onboarding_step: 7,
                  onboarding_completed_at: completedAt,
                  onboarding_data: reconciledData,
                  updated_at: completedAt,
                };
            await client.from('profiles').update(payload).eq('user_id', userId);
          } catch {}
        }

        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`sinal_onboarded_${userId}`, 'true');
          }
        } catch {}

        return {
          status: 'COMPLETED',
          step: 7,
          completedAt,
          data: reconciledData,
          persistedInDb: true,
          reconciledFromLegacy: true,
        };
      }

      return {
        status: 'NOT_STARTED',
        step: 1,
        completedAt: null,
        data: {},
        persistedInDb: Boolean(profile),
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        step: 1,
        completedAt: null,
        data: {},
        persistedInDb: false,
        error: err?.message || 'Erro de conexão ao verificar seu perfil.',
      };
    }
  },

  /**
   * Salva progresso parcial do onboarding (`IN_PROGRESS`) em `public.profiles` usando `user_id`.
   * Nunca regride um perfil que já esteja `COMPLETED`.
   */
  async saveOnboardingProgress(
    userId: string,
    step: number,
    data: OnboardingSavedData
  ): Promise<boolean> {
    try {
      if (typeof localStorage !== 'undefined') {
        if (Array.isArray(data.themes)) {
          localStorage.setItem('fatosbr_user_interests', JSON.stringify(data.themes));
        }
        if (Array.isArray(data.feedPreferences)) {
          localStorage.setItem('fatosbr_feed_preferences', JSON.stringify(data.feedPreferences));
        }
        if (data.userLocation) {
          localStorage.setItem('fatosbr_user_region', data.userLocation);
        }
      }
    } catch {}

    const { client, configured } = getDb();
    if (!configured || !userId) return false;

    try {
      const nowIso = new Date().toISOString();
      const { data: existing, error: fetchErr } = await client
        .from('profiles')
        .select('onboarding_status')
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchErr) return false;

      const existingStatus = normalizeOnboardingStatus(existing?.onboarding_status);
      const nextStatus: Exclude<OnboardingStatus, 'ERROR'> =
        existingStatus === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS';

      const { error } = await client
        .from('profiles')
        .update({
          onboarding_status: nextStatus,
          onboarding_step: step,
          onboarding_data: data,
          updated_at: nowIso,
        })
        .eq('user_id', userId);

      if (error) {
        if (isMissingColumnError(error)) {
          const { error: baseErr } = await client
            .from('profiles')
            .update({
              onboarding_status: nextStatus,
              updated_at: nowIso,
            })
            .eq('user_id', userId);
          return !baseErr;
        }
        console.warn('[UserService] Falha ao salvar progresso do onboarding:', error.message);
        return false;
      }

      return true;
    } catch {
      return false;
    }
  },

  /**
   * Conclui o onboarding definitivamente em `public.profiles` (`user_id = userId`, `onboarding_status = 'COMPLETED'`)
   * e persiste seguidos em `user_entity_follows`, `user_source_follows` e `user_topic_follows`.
   */
  async completeOnboarding(
    userId: string,
    payload: OnboardingSavedData,
    userEmail?: string | null
  ): Promise<{ success: boolean; persistedInDb: boolean; error?: string }> {
    const completedAt = new Date().toISOString();

    try {
      if (typeof localStorage !== 'undefined') {
        if (Array.isArray(payload.themes)) {
          localStorage.setItem('fatosbr_user_interests', JSON.stringify(payload.themes));
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('fatosbr_interests_updated', { detail: { interests: payload.themes } }));
          }
        }
        if (Array.isArray(payload.feedPreferences)) {
          localStorage.setItem('fatosbr_feed_preferences', JSON.stringify(payload.feedPreferences));
        }
        if (payload.userLocation) {
          localStorage.setItem('fatosbr_user_region', payload.userLocation);
        }
      }
    } catch {}

    const { client, configured } = getDb();
    if (!configured || !userId) {
      return { success: true, persistedInDb: false };
    }

    let profileUpdated = false;
    let lastError: string | undefined;

    try {
      const { data: updatedRows, error: updateErr } = await client
        .from('profiles')
        .update({
          onboarding_status: 'COMPLETED',
          onboarding_step: 7,
          onboarding_completed_at: completedAt,
          onboarding_data: payload,
          updated_at: completedAt,
        })
        .eq('user_id', userId)
        .select('id, user_id');

      if (!updateErr && Array.isArray(updatedRows) && updatedRows.length > 0) {
        profileUpdated = true;
      } else if (updateErr && isMissingColumnError(updateErr)) {
        const { data: fallbackRows, error: fallbackErr } = await client
          .from('profiles')
          .update({
            onboarding_status: 'COMPLETED',
            updated_at: completedAt,
          })
          .eq('user_id', userId)
          .select('id, user_id');

        if (!fallbackErr && Array.isArray(fallbackRows) && fallbackRows.length > 0) {
          profileUpdated = true;
        } else if (!fallbackErr && (!fallbackRows || fallbackRows.length === 0)) {
          const fallbackName = userEmail ? userEmail.split('@')[0] : 'Leitor';
          const { error: insertBaseErr } = await client.from('profiles').insert({
            user_id: userId,
            name: fallbackName,
            onboarding_status: 'COMPLETED',
            updated_at: completedAt,
          });
          profileUpdated = !insertBaseErr;
          if (insertBaseErr) lastError = insertBaseErr.message;
        } else if (fallbackErr) {
          lastError = fallbackErr.message;
        }
      } else if (!updateErr && (!updatedRows || updatedRows.length === 0)) {
        const fallbackName = userEmail ? userEmail.split('@')[0] : 'Leitor';
        const { error: insertErr } = await client.from('profiles').insert({
          user_id: userId,
          name: fallbackName,
          onboarding_status: 'COMPLETED',
          onboarding_step: 7,
          onboarding_completed_at: completedAt,
          onboarding_data: payload,
          updated_at: completedAt,
        });
        if (!insertErr) {
          profileUpdated = true;
        } else if (isMissingColumnError(insertErr)) {
          const { error: insertBaseErr } = await client.from('profiles').insert({
            user_id: userId,
            name: fallbackName,
            onboarding_status: 'COMPLETED',
            updated_at: completedAt,
          });
          profileUpdated = !insertBaseErr;
          if (insertBaseErr) lastError = insertBaseErr.message;
        } else {
          lastError = insertErr.message;
        }
      } else if (updateErr) {
        lastError = updateErr.message;
      }
    } catch (err: any) {
      lastError = err?.message || 'Erro de rede ao concluir onboarding.';
    }

    if (profileUpdated) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`sinal_onboarded_${userId}`, 'true');
        }
      } catch {}
    }

    // Persistir preferências de notificação/briefing (user_preferences com fallback para user_settings)
    try {
      const notifs = new Set(payload.notificationsPreferences || []);
      await this.updateUserPreferences(userId, {
        email_morning_briefing: notifs.has('daily_email') || notifs.size === 0,
        email_evening_briefing: notifs.has('daily_email'),
        email_breaking_alerts: notifs.has('app_realtime') || notifs.size === 0,
        briefing_email: userEmail || undefined,
        timezone: 'America/Sao_Paulo',
      });
    } catch {}

    // Persistir entidades seguidas em public.user_entity_follows
    if (Array.isArray(payload.followedEntityIds) && payload.followedEntityIds.length > 0) {
      try {
        await client.from('user_entity_follows').delete().eq('user_id', userId);
        const rows = payload.followedEntityIds.map((entityId) => ({ user_id: userId, entity_id: entityId }));
        await client.from('user_entity_follows').upsert(rows, { onConflict: 'user_id,entity_id' });
      } catch {}
    }

    // Persistir fontes seguidas em public.user_source_follows
    if (Array.isArray(payload.followedSourceIds) && payload.followedSourceIds.length > 0) {
      try {
        await client.from('user_source_follows').delete().eq('user_id', userId);
        const rows = payload.followedSourceIds.map((sourceId) => ({ user_id: userId, source_id: sourceId }));
        await client.from('user_source_follows').upsert(rows, { onConflict: 'user_id,source_id' });
      } catch {}
    }

    // Persistir tópicos seguidos em public.user_topic_follows
    if (Array.isArray(payload.followedTopicIds) && payload.followedTopicIds.length > 0) {
      try {
        const rows = payload.followedTopicIds.map((topicId) => ({ user_id: userId, topic_id: topicId }));
        await client.from('user_topic_follows').upsert(rows, { onConflict: 'user_id,topic_id' });
      } catch {}
    }

    return {
      success: profileUpdated,
      persistedInDb: profileUpdated,
      error: profileUpdated ? undefined : lastError || 'Não foi possível salvar seu onboarding no banco de dados.',
    };
  },

  /**
   * Atualiza interesses selecionados (ex: RecalibrateInterestsModal) em `public.profiles` via `user_id`.
   */
  async updateUserInterests(userId: string, themes: string[]): Promise<boolean> {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('fatosbr_user_interests', JSON.stringify(themes));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('fatosbr_interests_updated', { detail: { interests: themes } }));
        }
      }
    } catch {}

    const { client, configured } = getDb();
    if (!configured || !userId) return false;

    try {
      const { data: profile, error: fetchErr } = await client
        .from('profiles')
        .select('onboarding_data, onboarding_status')
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchErr && !isMissingColumnError(fetchErr)) {
        return false;
      }

      const currentData =
        profile?.onboarding_data && typeof profile.onboarding_data === 'object'
          ? (profile.onboarding_data as OnboardingSavedData)
          : {};

      const nowIso = new Date().toISOString();
      const { error } = await client
        .from('profiles')
        .update({
          onboarding_data: {
            ...currentData,
            themes,
          },
          onboarding_status: 'COMPLETED',
          onboarding_completed_at: nowIso,
          updated_at: nowIso,
        })
        .eq('user_id', userId);

      if (error && isMissingColumnError(error)) {
        const { error: baseErr } = await client
          .from('profiles')
          .update({
            onboarding_status: 'COMPLETED',
            updated_at: nowIso,
          })
          .eq('user_id', userId);
        return !baseErr;
      }

      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Sincroniza apenas metadados reais do perfil em `public.profiles` (`user_id`, `name`, `avatar_url`, `updated_at`)
   * de forma estritamente NÃO destrutiva:
   * - Nunca altera `id`, `onboarding_status` ou `subscriptions`.
   * - Nunca grava colunas inexistentes (`email`, `full_name`, `plan_name`, `subscription_status`, `is_admin`).
   */
  async syncUserProfile(user: any): Promise<void> {
    if (!user || !user.id) return;

    const email: string = user.email || '';
    const userId: string = user.id;
    const userMeta = user.user_metadata || null;
    const appMeta = user.app_metadata || null;

    const displayName =
      userMeta?.full_name ||
      userMeta?.name ||
      user.full_name ||
      user.name ||
      (email ? email.split('@')[0] : 'Leitor');

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
      'viniciusfelipedearaujo@gmail.com',
    ];
    const normalizedEmail = email.toLowerCase().trim();
    const isAdmin =
      Boolean(normalizedEmail) &&
      (ADMIN_EMAILS.includes(normalizedEmail) || normalizedEmail.includes('yleao') || normalizedEmail.includes('astrya'));
    const defaultPlanName = isAdmin ? 'PRO_UNLIMITED' : 'TRIAL_7D';
    const defaultSubscriptionStatus = isAdmin ? 'ACTIVE' : 'TRIAL_ACTIVE';
    const nowIso = new Date().toISOString();

    const { client, configured } = getDb();
    if (configured && user.id) {
      try {
        const { data: existingProfile, error: fetchError } = await client
          .from('profiles')
          .select('id, user_id, name, avatar_url')
          .eq('user_id', user.id)
          .maybeSingle();

        if (!fetchError && existingProfile) {
          await client
            .from('profiles')
            .update({
              name: existingProfile.name || displayName,
              avatar_url: avatarUrl || existingProfile.avatar_url || null,
              updated_at: nowIso,
            })
            .eq('user_id', user.id);
        } else if (!fetchError) {
          const { error: insertErr } = await client.from('profiles').insert({
            user_id: user.id,
            name: displayName,
            avatar_url: avatarUrl || null,
            timezone: 'America/Sao_Paulo',
            locale: 'pt-BR',
            onboarding_status: 'NOT_STARTED',
            updated_at: nowIso,
          });

          if (insertErr && isMissingColumnError(insertErr)) {
            await client.from('profiles').insert({
              user_id: user.id,
              name: displayName,
              avatar_url: avatarUrl || null,
              updated_at: nowIso,
            });
          }
        }
      } catch (err) {
        console.warn('[UserService] Falha na sincronização segura de public.profiles:', err);
      }
    }

    // Atualizar espelho local para o Painel Admin sem afetar o banco
    try {
      if (typeof localStorage !== 'undefined' && email) {
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
          id: userId,
          email,
          fullName: displayName,
          avatarUrl,
          provider,
          planName: existingIdx >= 0 && registry[existingIdx].planName ? registry[existingIdx].planName : defaultPlanName,
          subscriptionStatus:
            existingIdx >= 0 && registry[existingIdx].subscriptionStatus
              ? registry[existingIdx].subscriptionStatus
              : defaultSubscriptionStatus,
          isAdmin,
          createdAt: existingIdx >= 0 && registry[existingIdx].createdAt ? registry[existingIdx].createdAt : nowIso,
          lastSignInAt: nowIso,
        };

        if (existingIdx >= 0) {
          registry[existingIdx] = { ...registry[existingIdx], ...accountData };
        } else {
          registry.unshift(accountData);
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
      }
    } catch {}
  },
};
