/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — Serviço de Briefings Executivos Reais (Supabase Integration)
 * 
 * Diretrizes V2.3:
 * 1. Não inventar briefings fictícios com datas hardcoded quando o banco estiver vazio.
 * 2. Consultar `public.briefings` e `public.briefing_items` do usuário autenticado via Supabase.
 * 3. Associar os itens aos acontecimentos reais (`public.events`).
 * 4. Cache privado em localStorage indexado exclusivamente pelo `user_id` da sessão ativa.
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Event } from '../types/sinal';

export interface RealBriefingItem {
  id: string;
  type: 'morning' | 'evening';
  title: string;
  description: string;
  eventsCount: number;
  readTime: string;
  timeFormatted: string;
  dateLabel: string;
  groupDate: string; // 'Hoje' | 'Ontem' | Data formatada
  status: 'Pronto' | 'Enviado' | 'Em preparação';
  bgImage: string;
  rawEvents?: Event[];
  createdAt: string;
}

const MORNING_IMG = '/assets/aistudio/Amanhecer_sobre_a_cidade__1__638f4414.png';
const EVENING_IMG = '/assets/aistudio/Horizonte_urbano_ao_anoitecer__2__4a1dd254.png';

export const briefingService = {
  /**
   * Obtém a chave de cache privado para um usuário específico
   */
  getUserCacheKey(userId: string): string {
    return `fatosbr_briefings_cache_${userId}`;
  },

  /**
   * Limpa o cache privado de briefings de um usuário
   */
  clearUserCache(userId: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(this.getUserCacheKey(userId));
    } catch {}
  },

  /**
   * Carrega os briefings reais do usuário autenticado no Supabase
   */
  async getUserBriefings(userId: string, allEvents: Event[] = []): Promise<RealBriefingItem[]> {
    if (!isSupabaseConfigured || !userId) {
      return [];
    }

    try {
      // 1. Consultar briefings do usuário ordenados pelos mais recentes
      const { data: briefings, error: briefingsError } = await (supabase as any)
        .from('briefings')
        .select('*')
        .eq('user_id', userId)
        .order('scheduled_for', { ascending: false })
        .limit(20);

      if (briefingsError) {
        // Se a tabela ainda não tiver sido criada em produção, retorna lista vazia segura
        console.warn('[BriefingService] Tabela de briefings ainda não populada ou inacessível:', briefingsError.message);
        return [];
      }

      if (!briefings || briefings.length === 0) {
        return [];
      }

      // 2. Coletar os IDs de briefings para buscar os itens relacionados
      const briefingIds = briefings.map((b: any) => b.id);
      const { data: items } = await (supabase as any)
        .from('briefing_items')
        .select('*')
        .in('briefing_id', briefingIds)
        .order('order_index', { ascending: true });

      // Mapa rápido de acontecimentos por ID para enriquecimento
      const eventsMap = new Map<string, Event>();
      allEvents.forEach((ev) => eventsMap.set(ev.id, ev));

      const now = new Date();
      const todayStr = now.toLocaleDateString('pt-BR');
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('pt-BR');

      // 3. Montar lista de briefings estruturados reais
      const result: RealBriefingItem[] = briefings.map((b: any) => {
        const briefingItems = (items || []).filter((it: any) => it.briefing_id === b.id);
        const relatedEvents: Event[] = briefingItems
          .map((it: any) => eventsMap.get(it.event_id))
          .filter((ev: any): ev is Event => Boolean(ev));

        const scheduledDate = new Date(b.scheduled_for || b.created_at);
        const dateStr = scheduledDate.toLocaleDateString('pt-BR');

        let groupDate = dateStr;
        if (dateStr === todayStr) {
          groupDate = 'Hoje';
        } else if (dateStr === yesterdayStr) {
          groupDate = 'Ontem';
        }

        const hours = scheduledDate.getHours().toString().padStart(2, '0');
        const minutes = scheduledDate.getMinutes().toString().padStart(2, '0');
        const timeFormatted = `${hours}:${minutes}`;

        const isMorning = b.type === 'morning';
        const bgImage = isMorning ? MORNING_IMG : EVENING_IMG;

        const count = briefingItems.length > 0 ? briefingItems.length : relatedEvents.length;
        const readMinutes = Math.max(1, Math.ceil(count * 0.6));

        let statusLabel: 'Pronto' | 'Enviado' | 'Em preparação' = 'Pronto';
        if (b.status === 'SENT') statusLabel = 'Enviado';
        else if (b.status === 'PENDING' || b.status === 'PROCESSING') statusLabel = 'Em preparação';

        const dateLabel = `${groupDate} · ${timeFormatted} · ${statusLabel}`;

        return {
          id: b.id,
          type: b.type,
          title: b.title,
          description: b.description || (isMorning ? 'Os principais acontecimentos organizados para você.' : 'O fechamento dos mercados e acontecimentos do dia.'),
          eventsCount: count,
          readTime: `${readMinutes} min de leitura`,
          timeFormatted,
          dateLabel,
          groupDate,
          status: statusLabel,
          bgImage,
          rawEvents: relatedEvents,
          createdAt: b.created_at
        };
      });

      // Salva no cache privado do usuário
      if (typeof window !== 'undefined' && result.length > 0) {
        try {
          localStorage.setItem(this.getUserCacheKey(userId), JSON.stringify(result));
        } catch {}
      }

      return result;
    } catch (err: any) {
      console.warn('[BriefingService] Erro ao carregar briefings:', err?.message);
      return [];
    }
  }
};
