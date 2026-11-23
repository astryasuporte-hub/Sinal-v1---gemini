/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR — Motor Server-side Seguro de Notificações (V2.3.1)
 *
 * Diretrizes V2.3.1:
 * 1. Execução exclusivamente server-side com PostgreSQL nativo ou Supabase service_role.
 * 2. Tipos canônicos 100% compatíveis com a constraint auditada de public.notifications:
 *    NEWS_HIGH_RELEVANCE | BRIEFING_READY | TRIAL_EXPIRING | TRIAL_EXPIRED |
 *    SUBSCRIPTION_ACTIVE | PAYMENT_FAILED | SYSTEM.
 * 3. Consulta canônica de preferências em public.user_settings e public.user_preferences
 *    sem falhas silenciosas e com fail-closed se preferências não puderem ser verificadas.
 * 4. Idempotência concorrente via constraint/índice único + tratamento de violação 23505.
 */

import { executeSql, isPostgresConfigured } from './postgres.js';
import { getServerSupabase } from './db.js';

export const ALLOWED_NOTIFICATION_TYPES = [
  'NEWS_HIGH_RELEVANCE',
  'BRIEFING_READY',
  'TRIAL_EXPIRING',
  'TRIAL_EXPIRED',
  'SUBSCRIPTION_ACTIVE',
  'PAYMENT_FAILED',
  'SYSTEM',
] as const;

export type NotificationType = (typeof ALLOWED_NOTIFICATION_TYPES)[number];

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType | 'EVENT_UPDATED' | 'OPERATIONAL_ALERT';
  title: string;
  subtitle?: string;
  body?: string;
  category?: 'acontecimentos' | 'entidades' | 'temas' | 'fontes' | 'atualizacoes';
  eventId?: string;
  entityId?: string;
  eventRevision?: number;
  metadata?: Record<string, any>;
}

export interface SegmentedEventDispatchInput {
  eventId: string;
  title: string;
  summary?: string;
  relevanceScore?: number;
  topicIds?: string[];
  entityIds?: string[];
  sourceIds?: string[];
  type?: 'NEWS_HIGH_RELEVANCE' | 'EVENT_UPDATED';
  eventRevision?: number;
  significantChangeReason?: string;
}

export interface UserAlertPreferencesRecord {
  userId: string;
  emailBreakingAlerts: boolean;
  urgentEvents: boolean;
  entityUpdates: boolean;
  topicAlerts: boolean;
  sourcesDigest: boolean;
  dailyBriefings: boolean;
  onlyHighRelevance: boolean;
}

interface NotificationEngineDeps {
  executeSql: typeof executeSql;
  isPostgresConfigured: typeof isPostgresConfigured;
  getServerSupabase: typeof getServerSupabase;
}

let customDeps: NotificationEngineDeps | null = null;

export function setNotificationEngineTestDeps(deps: Partial<NotificationEngineDeps> | null): void {
  if (!deps) {
    customDeps = null;
    return;
  }
  customDeps = {
    executeSql: deps.executeSql || executeSql,
    isPostgresConfigured: deps.isPostgresConfigured || isPostgresConfigured,
    getServerSupabase: deps.getServerSupabase || getServerSupabase,
  };
}

function getDeps(): NotificationEngineDeps {
  return (
    customDeps || {
      executeSql,
      isPostgresConfigured,
      getServerSupabase,
    }
  );
}

/**
 * Normaliza o tipo para valores estritamente aceitos pela constraint de public.notifications.
 * Valores legados fora da constraint (ex: EVENT_UPDATED, OPERATIONAL_ALERT) são mapeados
 * sem violar o contrato do PostgreSQL.
 */
export function normalizeNotificationType(raw: unknown): NotificationType {
  const upper = String(raw || 'NEWS_HIGH_RELEVANCE').trim().toUpperCase();
  if ((ALLOWED_NOTIFICATION_TYPES as readonly string[]).includes(upper)) {
    return upper as NotificationType;
  }
  if (upper === 'EVENT_UPDATED') return 'NEWS_HIGH_RELEVANCE';
  if (upper === 'OPERATIONAL_ALERT') return 'SYSTEM';
  return 'SYSTEM';
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

function isUniqueViolationError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return code === '23505' || msg.includes('duplicate key value') || msg.includes('unique constraint');
}

function mapPreferenceRow(userId: string, prefRow: any, settingsRow: any): UserAlertPreferencesRecord {
  const ns =
    (settingsRow?.notification_settings && typeof settingsRow.notification_settings === 'object'
      ? settingsRow.notification_settings
      : null) ??
    (prefRow?.notification_settings && typeof prefRow.notification_settings === 'object'
      ? prefRow.notification_settings
      : null);

  const baseBreaking =
    typeof prefRow?.email_breaking_alerts === 'boolean'
      ? prefRow.email_breaking_alerts
      : typeof settingsRow?.email_breaking_alerts === 'boolean'
        ? settingsRow.email_breaking_alerts
        : true;

  return {
    userId,
    emailBreakingAlerts: baseBreaking,
    urgentEvents: typeof ns?.urgentEvents === 'boolean' ? ns.urgentEvents : true,
    entityUpdates: typeof ns?.entityUpdates === 'boolean' ? ns.entityUpdates : true,
    topicAlerts: typeof ns?.topicAlerts === 'boolean' ? ns.topicAlerts : true,
    sourcesDigest: typeof ns?.sourcesDigest === 'boolean' ? ns.sourcesDigest : true,
    dailyBriefings: typeof ns?.dailyBriefings === 'boolean' ? ns.dailyBriefings : true,
    onlyHighRelevance: typeof ns?.onlyHighRelevance === 'boolean' ? ns.onlyHighRelevance : true,
  };
}

async function fetchUserAlertPreferences(
  userIds: string[]
): Promise<{ map: Map<string, UserAlertPreferencesRecord>; error?: string }> {
  const { getServerSupabase: getSb } = getDeps();
  const map = new Map<string, UserAlertPreferencesRecord>();
  if (userIds.length === 0) return { map };

  const supabase = getSb();
  const prefByUser = new Map<string, any>();
  const settingsByUser = new Map<string, any>();

  // 1. Consulta public.user_preferences (tenta com notification_settings; se ausente, lê colunas base sem falhar)
  let prefErrorMsg: string | null = null;
  let prefAvailable = false;
  try {
    let { data: prefRows, error: prefErr } = await (supabase as any)
      .from('user_preferences')
      .select('id, email_breaking_alerts, email_morning_briefing, email_evening_briefing, notification_settings')
      .in('id', userIds);

    if (prefErr && isMissingColumnError(prefErr)) {
      const retry = await (supabase as any)
        .from('user_preferences')
        .select('id, email_breaking_alerts, email_morning_briefing, email_evening_briefing')
        .in('id', userIds);
      prefRows = retry.data;
      prefErr = retry.error;
    }

    if (prefErr) {
      if (!isMissingRelationError(prefErr)) {
        prefErrorMsg = prefErr.message || 'Erro ao consultar user_preferences';
      }
    } else {
      prefAvailable = true;
      for (const row of prefRows || []) {
        if (row?.id) prefByUser.set(String(row.id), row);
      }
    }
  } catch (err: any) {
    prefErrorMsg = err?.message || 'Exceção ao consultar user_preferences';
  }

  // 2. Consulta armazenamento canônico em public.user_settings
  let settingsErrorMsg: string | null = null;
  let settingsAvailable = false;
  try {
    let { data: settingsRows, error: settingsErr } = await (supabase as any)
      .from('user_settings')
      .select('user_id, email_breaking_alerts, notification_settings')
      .in('user_id', userIds);

    if (settingsErr && isMissingColumnError(settingsErr)) {
      const retry = await (supabase as any)
        .from('user_settings')
        .select('user_id')
        .in('user_id', userIds);
      settingsRows = retry.data;
      settingsErr = retry.error;
    }

    if (settingsErr) {
      if (!isMissingRelationError(settingsErr)) {
        settingsErrorMsg = settingsErr.message || 'Erro ao consultar user_settings';
      }
    } else {
      settingsAvailable = true;
      for (const row of settingsRows || []) {
        if (row?.user_id) settingsByUser.set(String(row.user_id), row);
      }
    }
  } catch (err: any) {
    settingsErrorMsg = err?.message || 'Exceção ao consultar user_settings';
  }

  if ((!prefAvailable && !settingsAvailable) || Boolean(settingsErrorMsg)) {
    const errText = settingsErrorMsg || prefErrorMsg || 'Nenhuma fonte de preferências de usuário disponível.';
    console.error('[NotificationEngine] Falha ao carregar preferências (fail-closed):', errText);
    return { map, error: errText };
  }

  if (prefErrorMsg) {
    console.warn('[NotificationEngine] Aviso ao consultar user_preferences:', prefErrorMsg);
  }

  for (const uid of userIds) {
    map.set(uid, mapPreferenceRow(uid, prefByUser.get(uid), settingsByUser.get(uid)));
  }

  return { map };
}

export const notificationEngine = {
  fetchUserAlertPreferences,

  /**
   * Cria uma notificação no Supabase de forma segura, compatível com a constraint de tipos
   * e idempotente mesmo sob requisições concorrentes.
   */
  async createNotification(
    params: CreateNotificationParams
  ): Promise<{ success: boolean; id?: string; duplicate?: boolean; error?: string }> {
    const {
      userId,
      type,
      title,
      subtitle,
      body,
      category = 'acontecimentos',
      eventId,
      entityId,
      eventRevision: rawEventRevision,
      metadata = {},
    } = params;

    if (!userId || !title) {
      return { success: false, error: 'INVALID_PARAMS' };
    }

    const canonicalType = normalizeNotificationType(type);
    const eventRevision = Math.max(
      1,
      Math.floor(Number(rawEventRevision ?? metadata?.eventRevision ?? 1) || 1)
    );
    const resolvedBody = String(body || subtitle || title).trim();
    const resolvedSubtitle = String(subtitle || resolvedBody).trim();
    const enrichedMetadata: Record<string, any> = {
      ...metadata,
      notification_type: canonicalType,
      ...(eventId ? { eventRevision } : {}),
    };
    const { executeSql: runSql, isPostgresConfigured: pgConfigured, getServerSupabase: getSb } = getDeps();

    // 1. Tentar persistência direta via PostgreSQL nativo se configurado
    if (pgConfigured()) {
      const findExistingPg = async (): Promise<string | undefined> => {
        if (eventId) {
          try {
            const existingRes = await runSql(
              `SELECT id FROM public.notifications
               WHERE user_id = $1 AND event_id = $2 AND category = $3 AND event_revision = $4
               LIMIT 1`,
              [userId, eventId, category, eventRevision]
            );
            if (existingRes.rows[0]?.id) return String(existingRes.rows[0].id);
          } catch (colErr: any) {
            if (!isMissingColumnError(colErr)) throw colErr;
            const legacyExisting = await runSql(
              `SELECT id FROM public.notifications
               WHERE user_id = $1 AND event_id = $2 AND category = $3
               LIMIT 1`,
              [userId, eventId, category]
            );
            if (legacyExisting.rows[0]?.id) return String(legacyExisting.rows[0].id);
          }
        }
        if (enrichedMetadata?.briefingId) {
          const existingBriefing = await runSql(
            `SELECT id FROM public.notifications
             WHERE user_id = $1 AND metadata->>'briefingId' = $2 AND type = $3
             LIMIT 1`,
            [userId, String(enrichedMetadata.briefingId), canonicalType]
          );
          if (existingBriefing.rows[0]?.id) return String(existingBriefing.rows[0].id);
        }
        return undefined;
      };

      const runPgInsert = async (
        includeBody: boolean,
        includeSubtitle: boolean,
        includeEventRevision: boolean
      ) => {
        const cols = ['user_id', 'type', 'title'];
        const vals: any[] = [userId, canonicalType, title];
        if (includeBody) {
          cols.push('body');
          vals.push(resolvedBody);
        }
        if (includeSubtitle) {
          cols.push('subtitle');
          vals.push(resolvedSubtitle);
        }
        if (includeEventRevision) {
          cols.push('event_revision');
          vals.push(eventRevision);
        }
        cols.push('category', 'read', 'event_id', 'entity_id', 'metadata', 'created_at');
        vals.push(
          category,
          false,
          eventId || null,
          entityId || null,
          JSON.stringify(enrichedMetadata)
        );
        const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(', ');
        return runSql(
          `INSERT INTO public.notifications (${cols.join(', ')})
           VALUES (${placeholders}, NOW())
           ON CONFLICT DO NOTHING
           RETURNING id`,
          vals
        );
      };

      try {
        let insertRes;
        try {
          insertRes = await runPgInsert(true, true, true);
        } catch (colErr: any) {
          if (!isMissingColumnError(colErr)) throw colErr;
          const msg = String(colErr.message || '').toLowerCase();
          insertRes = await runPgInsert(
            !msg.includes('body'),
            !msg.includes('subtitle'),
            !msg.includes('event_revision')
          );
        }

        if (insertRes.rows[0]?.id) {
          return { success: true, id: insertRes.rows[0].id };
        }

        const existingId = await findExistingPg();
        return { success: true, id: existingId, duplicate: true };
      } catch (err: any) {
        if (isUniqueViolationError(err)) {
          const existingId = await findExistingPg().catch(() => undefined);
          return { success: true, id: existingId, duplicate: true };
        }
        console.warn('[NotificationEngine] Falha ao gravar via PostgreSQL direto:', err?.code || err?.message);
      }
    }

    // 2. Persistência via Supabase Client server-side (service_role)
    try {
      const supabase = getSb();

      if (eventId) {
        let { data: existing, error: checkErr } = await (supabase as any)
          .from('notifications')
          .select('id')
          .eq('user_id', userId)
          .eq('event_id', eventId)
          .eq('category', category)
          .eq('event_revision', eventRevision)
          .maybeSingle();

        if (checkErr && isMissingColumnError(checkErr)) {
          const legacyCheck = await (supabase as any)
            .from('notifications')
            .select('id')
            .eq('user_id', userId)
            .eq('event_id', eventId)
            .eq('category', category)
            .maybeSingle();
          existing = legacyCheck.data;
          checkErr = legacyCheck.error;
        }

        if (!checkErr && existing?.id) {
          return { success: true, id: existing.id, duplicate: true };
        }
      }

      if (canonicalType === 'BRIEFING_READY' && enrichedMetadata?.briefingId) {
        const { data: existingBr, error: brCheckErr } = await (supabase as any)
          .from('notifications')
          .select('id')
          .eq('user_id', userId)
          .eq('type', 'BRIEFING_READY')
          .contains('metadata', { briefingId: String(enrichedMetadata.briefingId) })
          .maybeSingle();

        if (!brCheckErr && existingBr?.id) {
          return { success: true, id: existingBr.id, duplicate: true };
        }
      }

      const rowPayload: Record<string, any> = {
        user_id: userId,
        type: canonicalType,
        title,
        body: resolvedBody,
        subtitle: resolvedSubtitle,
        category,
        read: false,
        read_at: null,
        event_id: eventId || null,
        entity_id: entityId || null,
        event_revision: eventRevision,
        metadata: enrichedMetadata,
      };

      let { data, error } = await (supabase as any)
        .from('notifications')
        .insert(rowPayload)
        .select('id')
        .single();

      // Tolerância estrita apenas para colunas ausentes em esquemas antigos (read_at / subtitle / body / event_revision)
      if (error && isMissingColumnError(error)) {
        const fallbackPayload = { ...rowPayload };
        const msg = String(error.message || '').toLowerCase();
        if (msg.includes('read_at')) delete fallbackPayload.read_at;
        if (msg.includes('subtitle')) delete fallbackPayload.subtitle;
        if (msg.includes('body')) delete fallbackPayload.body;
        if (msg.includes('event_revision')) delete fallbackPayload.event_revision;
        const retry = await (supabase as any)
          .from('notifications')
          .insert(fallbackPayload)
          .select('id')
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        if (isUniqueViolationError(error)) {
          if (eventId) {
            let { data: existing, error: revErr } = await (supabase as any)
              .from('notifications')
              .select('id')
              .eq('user_id', userId)
              .eq('event_id', eventId)
              .eq('category', category)
              .eq('event_revision', eventRevision)
              .maybeSingle();
            if (revErr && isMissingColumnError(revErr)) {
              const legacyExisting = await (supabase as any)
                .from('notifications')
                .select('id')
                .eq('user_id', userId)
                .eq('event_id', eventId)
                .eq('category', category)
                .maybeSingle();
              existing = legacyExisting.data;
            }
            return { success: true, id: existing?.id, duplicate: true };
          }
          if (enrichedMetadata?.briefingId) {
            const { data: existingBr } = await (supabase as any)
              .from('notifications')
              .select('id')
              .eq('user_id', userId)
              .eq('type', canonicalType)
              .contains('metadata', { briefingId: enrichedMetadata.briefingId })
              .maybeSingle();
            return { success: true, id: existingBr?.id, duplicate: true };
          }
          return { success: true, duplicate: true };
        }

        console.error('[NotificationEngine] Erro ao inserir notificação no Supabase:', {
          code: error.code,
          type: canonicalType,
          message: error.message,
        });
        return { success: false, error: error.message };
      }

      return { success: true, id: data?.id };
    } catch (err: any) {
      console.error('[NotificationEngine] Erro geral ao criar notificação:', err?.message);
      return { success: false, error: err?.message };
    }
  },

  /**
   * Cria notificação de Briefing pronto vinculada ao usuário e ao ID real do briefing persistido,
   * respeitando a preferência dailyBriefings do usuário e garantindo deduplicação por briefingId.
   */
  async createBriefingReadyNotification(params: {
    userId: string;
    briefingId: string;
    briefingType: 'morning' | 'evening' | 'MORNING' | 'EVENING';
    title: string;
    eventsCount: number;
  }): Promise<{ success: boolean; id?: string; duplicate?: boolean; skipped?: boolean; error?: string }> {
    const { getServerSupabase: getSb } = getDeps();
    const supabase = getSb();

    const prefCheck = await fetchUserAlertPreferences([params.userId]);
    if (prefCheck.error) {
      return { success: false, error: prefCheck.error };
    }
    const userPrefs = prefCheck.map.get(params.userId);
    if (userPrefs && !userPrefs.dailyBriefings) {
      return { success: true, skipped: true };
    }

    try {
      const { data: existing, error: dupErr } = await (supabase as any)
        .from('notifications')
        .select('id')
        .eq('user_id', params.userId)
        .eq('type', 'BRIEFING_READY')
        .contains('metadata', { briefingId: params.briefingId })
        .maybeSingle();

      if (!dupErr && existing?.id) {
        return { success: true, id: existing.id, duplicate: true };
      }
    } catch (err: any) {
      console.warn('[NotificationEngine] Aviso ao checar duplicidade de briefingId:', err?.message);
    }

    const isEvening = String(params.briefingType).toUpperCase() === 'EVENING';
    const summaryText = `${params.eventsCount} acontecimentos consolidados no seu ${
      isEvening ? 'resumo da noite' : 'resumo da manhã'
    }.`;

    return this.createNotification({
      userId: params.userId,
      type: 'BRIEFING_READY',
      category: 'atualizacoes',
      title: params.title,
      body: summaryText,
      subtitle: summaryText,
      metadata: {
        briefingId: params.briefingId,
        briefingType: isEvening ? 'EVENING' : 'MORNING',
      },
    });
  },

  /**
   * Serviço isolado de segmentação para acontecimentos reais persistidos.
   * Respeita interesses seguidos (entidades, temas, fontes), relevância e preferências reais do usuário.
   */
  async dispatchSegmentedNotificationsForEvent(
    input: SegmentedEventDispatchInput
  ): Promise<{
    targetedUsers: number;
    created: number;
    duplicates: number;
    skippedByPreferences: number;
    errors: number;
    errorDetails?: string[];
  }> {
    const stats: {
      targetedUsers: number;
      created: number;
      duplicates: number;
      skippedByPreferences: number;
      errors: number;
      errorDetails?: string[];
    } = {
      targetedUsers: 0,
      created: 0,
      duplicates: 0,
      skippedByPreferences: 0,
      errors: 0,
    };

    if (!input.eventId || !input.title) return stats;

    const relevanceScore = typeof input.relevanceScore === 'number' ? input.relevanceScore : 75;
    if (relevanceScore < 70) {
      return stats;
    }

    const { getServerSupabase: getSb } = getDeps();
    const supabase = getSb();
    const errorDetails: string[] = [];

    const userSignals = new Map<
      string,
      { entityId?: string; hasEntity: boolean; hasTopic: boolean; hasSource: boolean }
    >();

    const ensureSignal = (uid: string) => {
      let cur = userSignals.get(uid);
      if (!cur) {
        cur = { hasEntity: false, hasTopic: false, hasSource: false };
        userSignals.set(uid, cur);
      }
      return cur;
    };

    try {
      // 1. Seguidores de entidades relacionadas
      if (input.entityIds && input.entityIds.length > 0) {
        const { data: entFollows, error: entErr } = await (supabase as any)
          .from('user_entity_follows')
          .select('user_id, entity_id')
          .in('entity_id', input.entityIds);

        if (entErr) {
          errorDetails.push(`user_entity_follows: ${entErr.message}`);
          stats.errors++;
        } else {
          for (const row of entFollows || []) {
            if (row?.user_id) {
              const s = ensureSignal(String(row.user_id));
              s.hasEntity = true;
              if (!s.entityId && row.entity_id) s.entityId = String(row.entity_id);
            }
          }
        }
      }

      // 2. Seguidores de tópicos relacionados
      if (input.topicIds && input.topicIds.length > 0) {
        const { data: topicFollows, error: topicErr } = await (supabase as any)
          .from('user_topic_follows')
          .select('user_id')
          .in('topic_id', input.topicIds);

        if (topicErr) {
          errorDetails.push(`user_topic_follows: ${topicErr.message}`);
          stats.errors++;
        } else {
          for (const row of topicFollows || []) {
            if (row?.user_id) {
              ensureSignal(String(row.user_id)).hasTopic = true;
            }
          }
        }
      }

      // 3. Seguidores de fontes relacionadas
      if (input.sourceIds && input.sourceIds.length > 0) {
        const { data: srcFollows, error: srcErr } = await (supabase as any)
          .from('user_source_follows')
          .select('user_id')
          .in('source_id', input.sourceIds);

        if (srcErr) {
          errorDetails.push(`user_source_follows: ${srcErr.message}`);
          stats.errors++;
        } else {
          for (const row of srcFollows || []) {
            if (row?.user_id) {
              ensureSignal(String(row.user_id)).hasSource = true;
            }
          }
        }
      }

      stats.targetedUsers = userSignals.size;
      if (stats.targetedUsers === 0) {
        if (errorDetails.length > 0) stats.errorDetails = errorDetails;
        return stats;
      }

      // 4. Carrega preferências canônicas com fail-closed se falhar
      const userIds = Array.from(userSignals.keys());
      const prefsResult = await fetchUserAlertPreferences(userIds);
      if (prefsResult.error) {
        stats.errors += userIds.length;
        stats.errorDetails = [...errorDetails, prefsResult.error];
        return stats;
      }

      const canonicalType = normalizeNotificationType(input.type || 'NEWS_HIGH_RELEVANCE');

      for (const [userId, signals] of userSignals.entries()) {
        const prefs = prefsResult.map.get(userId);

        if (!prefs) {
          stats.errors++;
          continue;
        }

        // Bloqueio in-app depende exclusivamente da preferência in-app (urgentEvents),
        // sem acoplamento indevido com o canal de e-mail (emailBreakingAlerts).
        if (!prefs.urgentEvents) {
          stats.skippedByPreferences++;
          continue;
        }

        // Filtro estrito de alta relevância quando ativado pelo usuário
        if (prefs.onlyHighRelevance && relevanceScore < 85) {
          stats.skippedByPreferences++;
          continue;
        }

        // Seleciona a categoria mais prioritária habilitada nas preferências do usuário
        let chosenCategory: 'entidades' | 'temas' | 'fontes' | null = null;
        let chosenEntityId: string | undefined;

        if (signals.hasEntity && prefs.entityUpdates) {
          chosenCategory = 'entidades';
          chosenEntityId = signals.entityId;
        } else if (signals.hasTopic && prefs.topicAlerts) {
          chosenCategory = 'temas';
        } else if (signals.hasSource && prefs.sourcesDigest) {
          chosenCategory = 'fontes';
        }

        if (!chosenCategory) {
          stats.skippedByPreferences++;
          continue;
        }

        const eventRevision = Math.max(1, Math.floor(Number(input.eventRevision ?? 1) || 1));
        const baseDescription = (input.summary || input.title).trim();
        const descriptionText =
          eventRevision > 1 && input.significantChangeReason
            ? `Atualização relevante (rev. ${eventRevision}): ${baseDescription}`
            : baseDescription;
        const res = await this.createNotification({
          userId,
          type: canonicalType,
          category: chosenCategory,
          title: input.title,
          body: descriptionText,
          subtitle: descriptionText,
          eventId: input.eventId,
          entityId: chosenEntityId,
          eventRevision,
          metadata: {
            relevanceScore,
            eventRevision,
            ...(input.significantChangeReason
              ? { significantChangeReason: input.significantChangeReason }
              : {}),
          },
        });

        if (res.duplicate) stats.duplicates++;
        else if (res.success) stats.created++;
        else {
          stats.errors++;
          if (res.error) errorDetails.push(res.error);
        }
      }
    } catch (err: any) {
      console.error('[NotificationEngine] Erro crítico na segmentação de notificações:', err?.message);
      stats.errors++;
      errorDetails.push(err?.message || 'Erro inesperado na segmentação.');
    }

    if (errorDetails.length > 0) {
      stats.errorDetails = errorDetails;
    }
    return stats;
  },
};
