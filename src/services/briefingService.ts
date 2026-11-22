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

export type BriefingStatusLabel =
  | 'Agendado'
  | 'Em preparação'
  | 'Pronto'
  | 'Enviado'
  | 'Falha na geração'
  | 'Cancelado';

export type CanonicalBriefingType = 'MORNING' | 'EVENING';
export type CanonicalBriefingStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'READY'
  | 'SENT'
  | 'FAILED'
  | 'CANCELED';

export interface RealBriefingItem {
  id: string;
  type: 'morning' | 'evening';
  rawType: CanonicalBriefingType;
  title: string;
  description: string;
  eventsCount: number;
  readTime: string;
  timeFormatted: string;
  dateLabel: string;
  groupDate: string; // 'Hoje' | 'Ontem' | Data formatada
  status: BriefingStatusLabel;
  rawStatus: CanonicalBriefingStatus;
  bgImage: string;
  rawEvents: Event[];
  createdAt: string;
  scheduledFor: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface BriefingsFetchResult {
  items: RealBriefingItem[];
  error?: string;
  sessionExpired?: boolean;
}

const MORNING_IMG = '/assets/aistudio/Amanhecer_sobre_a_cidade__1__638f4414.png';
const EVENING_IMG = '/assets/aistudio/Horizonte_urbano_ao_anoitecer__2__4a1dd254.png';

type SupabaseClientLike = typeof supabase;
let testBriefingClientOverride: { client: SupabaseClientLike; configured: boolean } | null = null;

export function setTestBriefingServiceClient(
  override: { client: any; configured?: boolean } | null
): void {
  if (override) {
    testBriefingClientOverride = {
      client: override.client as SupabaseClientLike,
      configured: override.configured ?? true,
    };
  } else {
    testBriefingClientOverride = null;
  }
}

function getDb(): { client: any; configured: boolean } {
  if (testBriefingClientOverride) {
    return testBriefingClientOverride;
  }
  return { client: supabase as any, configured: isSupabaseConfigured };
}

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

export function normalizeBriefingType(raw: unknown): CanonicalBriefingType {
  const upper = String(raw || 'MORNING').trim().toUpperCase();
  return upper === 'EVENING' ? 'EVENING' : 'MORNING';
}

export function mapBriefingStatus(raw: unknown): {
  rawStatus: CanonicalBriefingStatus;
  label: BriefingStatusLabel;
} {
  const upper = String(raw || 'PENDING').trim().toUpperCase();
  switch (upper) {
    case 'PENDING':
      return { rawStatus: 'PENDING', label: 'Agendado' };
    case 'GENERATING':
    case 'PROCESSING':
      return { rawStatus: 'GENERATING', label: 'Em preparação' };
    case 'READY':
      return { rawStatus: 'READY', label: 'Pronto' };
    case 'SENT':
      return { rawStatus: 'SENT', label: 'Enviado' };
    case 'FAILED':
      return { rawStatus: 'FAILED', label: 'Falha na geração' };
    case 'CANCELED':
    case 'CANCELLED':
      return { rawStatus: 'CANCELED', label: 'Cancelado' };
    default:
      // Nunca apresenta estado desconhecido como 'Pronto'
      return { rawStatus: 'PENDING', label: 'Agendado' };
  }
}

function mapDbEventToFrontendEvent(dbEv: any): Event | null {
  if (!dbEv || !dbEv.id) return null;
  const published = dbEv.published_at || dbEv.updated_at || dbEv.created_at || new Date().toISOString();
  return {
    id: String(dbEv.id),
    title: dbEv.title || 'Acontecimento registrado',
    summary: dbEv.summary || dbEv.what_happened || '',
    whatHappened: dbEv.what_happened || dbEv.summary || '',
    whyItMatters: dbEv.why_it_matters || 'Fato apurado pelo motor editorial da FatosBR.',
    category: dbEv.category || 'Brasil',
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
    const { client, configured } = getDb();
    if (!configured || !userId) {
      return { items: [] };
    }

    try {
      const { data: briefings, error: briefingsError } = await client
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

      // Busca itens usando exclusivamente colunas canônicas reais de `public.briefing_items` e `public.events`
      const { data: joinedItems, error: joinErr } = await client
        .from('briefing_items')
        .select('id, briefing_id, event_id, position, section, events(id, title, slug, summary, why_it_matters, relevance_score, article_count, published_at, updated_at)')
        .in('briefing_id', briefingIds)
        .order('position', { ascending: true });

      if (!joinErr && Array.isArray(joinedItems)) {
        items = joinedItems;
      } else {
        const { data: plainItems, error: plainErr } = await client
          .from('briefing_items')
          .select('*')
          .in('briefing_id', briefingIds);

        if (plainErr) {
          return {
            items: [],
            sessionExpired: isSessionExpiredError(plainErr),
            error: plainErr.message || 'Falha ao carregar itens dos briefings.'
          };
        }
        items = Array.isArray(plainItems) ? plainItems : [];
      }

      const eventsMap = new Map<string, Event>();
      allEvents.forEach((ev) => eventsMap.set(String(ev.id), ev));

      // Busca direta complementar caso o relacionamento aninhado não tenha retornado todos os events
      const missingEventIds = Array.from(
        new Set(
          items
            .map((it: any) => (it.event_id ? String(it.event_id) : null))
            .filter((eid: string | null): eid is string => Boolean(eid))
            .filter((eid: string) => !eventsMap.has(eid) && !items.some((x: any) => String(x.event_id) === eid && x.events))
        )
      );

      if (missingEventIds.length > 0) {
        try {
          const { data: directEvents } = await client
            .from('events')
            .select('id, title, slug, summary, why_it_matters, relevance_score, article_count, published_at, updated_at')
            .in('id', missingEventIds);
          for (const evRow of directEvents || []) {
            const mapped = mapDbEventToFrontendEvent(evRow);
            if (mapped) eventsMap.set(mapped.id, mapped);
          }
        } catch {}
      }

      const now = new Date();
      const todayStr = now.toLocaleDateString('pt-BR');
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('pt-BR');

      const result: RealBriefingItem[] = briefings.map((b: any) => {
        const briefingItems = items
          .filter((it: any) => it.briefing_id === b.id)
          .sort((a: any, bItem: any) => Number(a.position ?? a.order_index ?? 0) - Number(bItem.position ?? bItem.order_index ?? 0));

        const relatedEvents: Event[] = briefingItems
          .map((it: any) => {
            const evId = it.event_id ? String(it.event_id) : null;
            if (evId && eventsMap.has(evId)) {
              return eventsMap.get(evId)!;
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

        const rawType = normalizeBriefingType(b.type);
        const isMorning = rawType === 'MORNING';
        const bgImage = isMorning ? MORNING_IMG : EVENING_IMG;

        const count = relatedEvents.length > 0 ? relatedEvents.length : briefingItems.length;
        const readMinutes = Math.max(1, Math.ceil(Math.max(count, 1) * 0.6));

        const { rawStatus, label: statusLabel } = mapBriefingStatus(b.status);
        const dateLabel = `${groupDate} · ${timeFormatted} · ${statusLabel}`;

        return {
          id: String(b.id),
          type: isMorning ? 'morning' : 'evening',
          rawType,
          title: b.title || (isMorning ? 'Briefing Matinal' : 'Briefing Noturno'),
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
          scheduledFor: scheduledIso,
          periodStart: b.period_start || undefined,
          periodEnd: b.period_end || undefined
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
