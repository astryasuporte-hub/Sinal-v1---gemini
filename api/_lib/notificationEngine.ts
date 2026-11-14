/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — Motor Server-side Seguro de Notificações
 * 
 * Diretrizes V2.3:
 * 1. Execução exclusivamente server-side com conexão segura ao PostgreSQL / Supabase service_role.
 * 2. Idempotência estrita: Prevenção de duplicação por (user_id, event_id, category).
 * 3. Segmentação editorial: Alertas de alta relevância respeitam temas ou entidades seguidas pelo leitor.
 * 4. Tipos canônicos: BRIEFING_READY, NEWS_HIGH_RELEVANCE, EVENT_UPDATED.
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
  category?: 'acontecimentos' | 'entidades' | 'temas' | 'briefings' | 'sistema';
  eventId?: string;
  entityId?: string;
  metadata?: Record<string, any>;
}

export const notificationEngine = {
  /**
   * Cria uma notificação no Supabase de forma segura e idempotente
   */
  async createNotification(params: CreateNotificationParams): Promise<{ success: boolean; id?: string; duplicate?: boolean }> {
    const { userId, type, title, subtitle, category = 'acontecimentos', eventId, entityId, metadata = {} } = params;

    if (!userId || !title) {
      return { success: false };
    }

    // 1. Tentar persistência direta via PostgreSQL nativo se configurado
    if (isPostgresConfigured()) {
      try {
        // Checagem de deduplicação se houver eventId associado
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
          [userId, title, subtitle || null, category, eventId || null, entityId || null, JSON.stringify({ ...metadata, notification_type: type })]
        );

        const newId = insertRes.rows[0]?.id;
        return { success: true, id: newId };
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
          metadata: { ...metadata, notification_type: type }
        })
        .select('id')
        .single();

      if (error) {
        console.warn('[NotificationEngine] Erro ao inserir via Supabase:', error.message);
        return { success: false };
      }

      return { success: true, id: data?.id };
    } catch (err: any) {
      console.warn('[NotificationEngine] Erro geral ao criar notificação:', err?.message);
      return { success: false };
    }
  }
};
