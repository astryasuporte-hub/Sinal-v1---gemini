/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR — Motor Server-side Seguro de Notificações (V2.3)
 *
 * Diretrizes V2.3:
 * 1. Execução exclusivamente server-side com conexão segura ao PostgreSQL / Supabase service_role.
 * 2. Idempotência estrita: Prevenção de duplicação por (user_id, event_id, category).
 * 3. Segmentação editorial: Alertas de alta relevância respeitam temas, entidades ou fontes seguidas e preferências do usuário.
 * 4. Tipos canônicos: BRIEFING_READY, NEWS_HIGH_RELEVANCE, EVENT_UPDATED, OPERATIONAL_ALERT.
 */

import { executeSql, isPostgresConfigured } from './postgres.js';
import { getServerSupabase } from './db.js';

export type NotificationType =
  | 'BRIEFING_READY'
  | 'NEWS_HIGH_RELEVANCE'
  | 'EVENT_UPDATED'
  | 'OPERATIONAL_ALERT';

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  subtitle?: string;
  category?: 'acontecimentos' | 'entidades' | 'temas' | 'fontes' | 'atualizacoes';
  eventId?: string;
  entityId?: string;
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
}

export const notificationEngine = {
  /**
   * Cria uma notificação no Supabase de forma segura e idempotente (deduplicada por user_id + event_id + category).
   */
  async createNotification(
    params: CreateNotificationParams
  ): Promise<{ success: boolean; id?: string; duplicate?: boolean; error?: string }> {
    const {
      userId,
      type,
      title,
      subtitle,
      category = 'acontecimentos',
      eventId,
      entityId,
      metadata = {}
    } = params;

    if (!userId || !title) {
      return { success: false, error: 'INVALID_PARAMS' };
    }

    const enrichedMetadata = { ...metadata, notification_type: type };

    // 1. Tentar persistência direta via PostgreSQL nativo se configurado
    if (isPostgresConfigured()) {
      try {
        if (eventId) {
          const checkRes = await executeSql(
            `SELECT id FROM public.notifications
             WHERE user_id = $1 AND event_id = $2 AND category = $3
             LIMIT 1`,
            [userId, eventId, category]
          );
          if (checkRes.rows.length > 0) {
            return { success: true, id: checkRes.rows[0].id, duplicate: true };
          }
        }

        const insertRes = await executeSql(
          `INSERT INTO public.notifications (user_id, title, subtitle, category, read, event_id, entity_id, metadata, created_at)
           VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7, NOW())
           RETURNING id`,
          [
            userId,
            title,
            subtitle || null,
            category,
            eventId || null,
            entityId || null,
            JSON.stringify(enrichedMetadata)
          ]
        );

        return { success: true, id: insertRes.rows[0]?.id };
      } catch (err: any) {
        console.warn('[NotificationEngine] Falha ao gravar via PostgreSQL direto:', err?.message);
      }
    }

    // 2. Fallback controlado via Supabase Client server-side (service_role)
    try {
      const supabase = getServerSupabase();

      if (eventId) {
        const { data: existing } = await (supabase as any)
          .from('notifications')
          .select('id')
          .eq('user_id', userId)
          .eq('event_id', eventId)
          .eq('category', category)
          .maybeSingle();

        if (existing?.id) {
          return { success: true, id: existing.id, duplicate: true };
        }
      }

      const { data, error } = await (supabase as any)
        .from('notifications')
        .insert({
          user_id: userId,
          title,
          subtitle: subtitle || null,
          category,
          read: false,
          event_id: eventId || null,
          entity_id: entityId || null,
          metadata: enrichedMetadata
        })
        .select('id')
        .single();

      if (error) {
        console.warn('[NotificationEngine] Erro ao inserir via Supabase:', error.message);
        return { success: false, error: error.message };
      }

      return { success: true, id: data?.id };
    } catch (err: any) {
      console.warn('[NotificationEngine] Erro geral ao criar notificação:', err?.message);
      return { success: false, error: err?.message };
    }
  },

  /**
   * Cria notificação de Briefing pronto vinculada ao usuário e ao ID real do briefing persistido.
   */
  async createBriefingReadyNotification(params: {
    userId: string;
    briefingId: string;
    briefingType: 'morning' | 'evening';
    title: string;
    eventsCount: number;
  }): Promise<{ success: boolean; id?: string; duplicate?: boolean }> {
    const supabase = getServerSupabase();
    try {
      // Deduplicação por briefingId no metadata
      const { data: existing } = await (supabase as any)
        .from('notifications')
        .select('id')
        .eq('user_id', params.userId)
        .eq('category', 'atualizacoes')
        .contains('metadata', { briefingId: params.briefingId })
        .maybeSingle();

      if (existing?.id) {
        return { success: true, id: existing.id, duplicate: true };
      }
    } catch {}

    return this.createNotification({
      userId: params.userId,
      type: 'BRIEFING_READY',
      category: 'atualizacoes',
      title: params.title,
      subtitle: `${params.eventsCount} acontecimentos consolidados no seu ${
        params.briefingType === 'evening' ? 'resumo da noite' : 'resumo da manhã'
      }.`,
      metadata: {
        briefingId: params.briefingId,
        briefingType: params.briefingType
      }
    });
  },

  /**
   * Serviço isolado de segmentação para acontecimentos reais persistidos.
   * Não dispara alertas globais indiscriminados: apenas para usuários que seguem
   * tópicos, entidades ou fontes relacionados E têm alertas habilitados.
   */
  async dispatchSegmentedNotificationsForEvent(
    input: SegmentedEventDispatchInput
  ): Promise<{ targetedUsers: number; created: number; duplicates: number; errors: number }> {
    const stats = { targetedUsers: 0, created: 0, duplicates: 0, errors: 0 };
    if (!input.eventId || !input.title) return stats;

    // Respeita limiar mínimo de relevância para evitar fadiga de alertas
    if (typeof input.relevanceScore === 'number' && input.relevanceScore < 70) {
      return stats;
    }

    const supabase = getServerSupabase();
    const targetUsersMap = new Map<
      string,
      { category: 'acontecimentos' | 'entidades' | 'temas' | 'fontes'; entityId?: string }
    >();

    try {
      // 1. Seguidores de entidades relacionadas (prioridade alta)
      if (input.entityIds && input.entityIds.length > 0) {
        const { data: entFollows } = await (supabase as any)
          .from('user_entity_follows')
          .select('user_id, entity_id')
          .in('entity_id', input.entityIds);

        for (const row of entFollows || []) {
          if (row.user_id && !targetUsersMap.has(row.user_id)) {
            targetUsersMap.set(row.user_id, { category: 'entidades', entityId: row.entity_id });
          }
        }
      }

      // 2. Seguidores de tópicos relacionados
      if (input.topicIds && input.topicIds.length > 0) {
        const { data: topicFollows } = await (supabase as any)
          .from('user_topic_follows')
          .select('user_id')
          .in('topic_id', input.topicIds);

        for (const row of topicFollows || []) {
          if (row.user_id && !targetUsersMap.has(row.user_id)) {
            targetUsersMap.set(row.user_id, { category: 'temas' });
          }
        }
      }

      // 3. Seguidores de fontes relacionadas
      if (input.sourceIds && input.sourceIds.length > 0) {
        const { data: srcFollows } = await (supabase as any)
          .from('user_source_follows')
          .select('user_id')
          .in('source_id', input.sourceIds);

        for (const row of srcFollows || []) {
          if (row.user_id && !targetUsersMap.has(row.user_id)) {
            targetUsersMap.set(row.user_id, { category: 'fontes' });
          }
        }
      }

      stats.targetedUsers = targetUsersMap.size;
      if (stats.targetedUsers === 0) return stats;

      // 4. Filtra preferências de alertas de cada usuário e persiste com deduplicação
      const userIds = Array.from(targetUsersMap.keys());
      const disabledUsers = new Set<string>();

      try {
        const { data: prefsRows } = await (supabase as any)
          .from('user_preferences')
          .select('id, email_breaking_alerts, notification_settings')
          .in('id', userIds);

        for (const p of prefsRows || []) {
          if (p.email_breaking_alerts === false) disabledUsers.add(p.id);
          if (p.notification_settings?.urgentEvents === false) disabledUsers.add(p.id);
        }
      } catch {}

      for (const [userId, target] of targetUsersMap.entries()) {
        if (disabledUsers.has(userId)) continue;

        const res = await this.createNotification({
          userId,
          type: input.type || 'NEWS_HIGH_RELEVANCE',
          category: target.category === 'entidades' ? 'entidades' : target.category === 'temas' ? 'temas' : 'acontecimentos',
          title: input.title,
          subtitle: input.summary,
          eventId: input.eventId,
          entityId: target.entityId,
          metadata: { relevanceScore: input.relevanceScore ?? null }
        });

        if (res.duplicate) stats.duplicates++;
        else if (res.success) stats.created++;
        else stats.errors++;
      }
    } catch (err: any) {
      console.warn('[NotificationEngine] Erro na segmentação de notificações:', err?.message);
    }

    return stats;
  }
};
