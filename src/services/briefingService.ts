/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR — Serviço de Briefings Executivos Reais (Supabase Integration)
 *
 * Diretrizes V2.3:
 * 1. Não inventar briefings fictícios quando o banco estiver vazio ou falhar.
 * 2. Consultar `public.briefings` e `public.briefing_items` do usuário autenticado via Supabase.
 * 3. Associar os itens aos acontecimentos reais (`public.events`) preservando fontes e datas.
 * 4. Cache privado em localStorage indexado exclusivamente pelo `user_id` da sessão ativa.
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Event } from '../types/sinal';

export type BriefingStatusLabel = 'Pronto' | 'Enviado' | 'Em preparação' | 'Falha na geração';

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
  status: BriefingStatusLabel;
  rawStatus: 'PENDING' | 'PROCESSING' | 'READY' | 'SENT' | 'FAILED';
  bgImage: string;
  rawEvents: Event[];
  createdAt: string;
  scheduledFor: string;
}

export interface BriefingsFetchResult {
  items: RealBriefingItem[];
  error?: string;
  sessionExpired?: boolean;
}

const MORNING_IMG = '/assets/aistudio/Amanhecer_sobre_a_cidade__1__638f4414.png';
const EVENING_IMG = '/assets/aistudio/Horizonte_urbano_ao_anoitecer__2__4a1dd254.png';

function isSessionExpiredError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '').toUpperCase();
  const status = Number(err?.status || 0);
  return (
    status === 401 ||
    code === 'PGRST301' ||
    msg.includes('jwt expired') ||
    msg.includes('invalid jwt') ||
    msg.includes('session not found')
  );
}

function mapDbEventToFrontendEvent(dbEv: any): Event | null {
  if (!dbEv || !dbEv.id) return null;
  const published = dbEv.published_at || dbEv.updated_at || dbEv.created_at || new Date().toISOString();
  return {
    id: dbEv.id,
    title: dbEv.title || 'Acontecimento registrado',
    summary: dbEv.summary || dbEv.what_happened || '',
    whatHappened: dbEv.what_happened || dbEv.summary || '',
    whyItMatters: dbEv.why_it_matters || '',
    category: dbEv.category || 'Geral',
    relevanceScore: Number(dbEv.relevance_score || 70),
    imageUrl: dbEv.image_url || undefined,
    publishedAt: published,
    updatedAt: dbEv.updated_at || published,
    relativeTime: new Date(published).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    sources: Array.isArray(dbEv.sources) ? dbEv.sources : [],
    entities: Array.isArray(dbEv.entities) ? dbEv.entities : [],
    topics: Array.isArray(dbEv.topics) ? dbEv.topics : [],
    timeline: Array.isArray(dbEv.timeline) ? dbEv.timeline : []
  };
}

export const briefingService = {
  getUserCacheKey(userId: string): string {
    return `fatosbr_briefings_cache_${userId}`;
  },

  clearUserCache(userId: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(this.getUserCacheKey(userId));
    } catch {}
  },

  /**
   * Carrega briefings reais do usuário autenticado retornando status detalhado de erro/sessão.
   */
  async getUserBriefingsDetailed(userId: string, allEvents: Event[] = []): Promise<BriefingsFetchResult> {
    if (!isSupabaseConfigured || !userId) {
      return { items: [] };
    }

    try {
      const { data: briefings, error: briefingsError } = await (supabase as any)
        .from('briefings')
        .select('*')
        .eq('user_id', userId)
        .order('scheduled_for', { ascending: false })
        .limit(20);

      if (briefingsError) {
        const expired = isSessionExpiredError(briefingsError);
        return {
          items: [],
          sessionExpired: expired,
          error: expired
            ? 'Sua sessão expirou. Faça login novamente para acessar seus briefings.'
            : briefingsError.message || 'Falha ao carregar seus briefings no banco de dados.'
        };
      }

      if (!briefings || briefings.length === 0) {
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(this.getUserCacheKey(userId), JSON.stringify([]));
          } catch {}
        }
        return { items: [] };
      }

      const briefingIds = briefings.map((b: any) => b.id);
      let items: any[] = [];

      // Busca itens com join de eventos e fallback seguro caso a FK/relacionamento não esteja exposto
      const { data: joinedItems, error: joinErr } = await (supabase as any)
        .from('briefing_items')
        .select('id, briefing_id, event_id, order_index, events(id, title, summary, what_happened, why_it_matters, category, relevance_score, image_url, published_at, updated_at)')
        .in('briefing_id', briefingIds)
        .order('order_index', { ascending: true });

      if (!joinErr && Array.isArray(joinedItems)) {
        items = joinedItems;
      } else {
        const { data: plainItems } = await (supabase as any)
          .from('briefing_items')
          .select('id, briefing_id, event_id, order_index')
          .in('briefing_id', briefingIds)
          .order('order_index', { ascending: true });
        items = plainItems || [];
      }

      const eventsMap = new Map<string, Event>();
      allEvents.forEach((ev) => eventsMap.set(ev.id, ev));

      const now = new Date();
      const todayStr = now.toLocaleDateString('pt-BR');
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('pt-BR');

      const result: RealBriefingItem[] = briefings.map((b: any) => {
        const briefingItems = items.filter((it: any) => it.briefing_id === b.id);
        const relatedEvents: Event[] = briefingItems
          .map((it: any) => {
            if (it.event_id && eventsMap.has(it.event_id)) {
              return eventsMap.get(it.event_id)!;
            }
            if (it.events) {
              return mapDbEventToFrontendEvent(it.events);
            }
            return null;
          })
          .filter((ev: any): ev is Event => Boolean(ev));

        const scheduledIso = b.scheduled_for || b.created_at;
        const scheduledDate = new Date(scheduledIso);
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

        const count = relatedEvents.length > 0 ? relatedEvents.length : briefingItems.length;
        const readMinutes = Math.max(1, Math.ceil(Math.max(count, 1) * 0.6));

        const rawStatus = String(b.status || 'READY').toUpperCase() as RealBriefingItem['rawStatus'];
        let statusLabel: BriefingStatusLabel = 'Pronto';
        if (rawStatus === 'SENT') statusLabel = 'Enviado';
        else if (rawStatus === 'PENDING' || rawStatus === 'PROCESSING') statusLabel = 'Em preparação';
        else if (rawStatus === 'FAILED') statusLabel = 'Falha na geração';

        const dateLabel = `${groupDate} · ${timeFormatted} · ${statusLabel}`;

        return {
          id: b.id,
          type: isMorning ? 'morning' : 'evening',
          title: b.title,
          description:
            b.description ||
            (isMorning
              ? 'Os principais acontecimentos organizados para você.'
              : 'O fechamento dos mercados e acontecimentos do dia.'),
          eventsCount: count,
          readTime: `${readMinutes} min de leitura`,
          timeFormatted,
          dateLabel,
          groupDate,
          status: statusLabel,
          rawStatus,
          bgImage,
          rawEvents: relatedEvents,
          createdAt: b.created_at,
          scheduledFor: scheduledIso
        };
      });

      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(this.getUserCacheKey(userId), JSON.stringify(result));
        } catch {}
      }

      return { items: result };
    } catch (err: any) {
      return {
        items: [],
        error: err?.message || 'Erro de conexão ao carregar briefings.'
      };
    }
  },

  /**
   * Wrapper compatível que retorna apenas a lista de briefings reais
   */
  async getUserBriefings(userId: string, allEvents: Event[] = []): Promise<RealBriefingItem[]> {
    const res = await this.getUserBriefingsDetailed(userId, allEvents);
    if (res.error) {
      console.warn('[BriefingService] Falha ao carregar briefings:', res.error);
    }
    return res.items;
  }
};
