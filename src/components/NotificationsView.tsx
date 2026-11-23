/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Event, Entity } from '../types/sinal';
import {
  Search,
  ChevronRight,
  Newspaper,
  BarChart3,
  Hash,
  Bell,
  Check,
  CheckCheck,
  X,
  SlidersHorizontal,
  ChevronLeft,
  AlertCircle,
  RefreshCw,
  Rss,
  FileText
} from 'lucide-react';
import { CompanyLogoBadge } from './CompanyLogoBadge';
import { ListRowSkeleton } from './GeneralStates';
import { useDebounce } from '../hooks/useDebounce';
import { notificationService } from '../services/notificationService';
import { userService } from '../services/userService';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { User as SupabaseUser } from '@supabase/supabase-js';

export type NotificationCategory =
  | 'todas'
  | 'acontecimentos'
  | 'entidades'
  | 'temas'
  | 'fontes'
  | 'atualizacoes';

export interface SinalNotificationItem {
  id: string;
  category: 'acontecimentos' | 'entidades' | 'temas' | 'fontes' | 'atualizacoes';
  dateGroup: string;
  title: string;
  subtitle: string;
  timestamp: string;
  read: boolean;
  unreadDotColor?: 'red' | 'blue';
  iconType?: string;
  thumbnailUrl?: string;
  eventId?: string;
  entityId?: string;
  metadata?: Record<string, any>;
}

interface NotificationsViewProps {
  events?: Event[];
  entities?: Entity[];
  currentUser?: SupabaseUser | null;
  onOpenEvent?: (event: Event) => void;
  onOpenEntity?: (entity: Entity) => void;
  onOpenBriefing?: (briefingId?: string) => void;
  onRequireAuth?: () => void;
  onBack?: () => void;
}

const DEFAULT_NOTIF_SETTINGS = {
  urgentEvents: true,
  entityUpdates: true,
  topicAlerts: true,
  sourcesDigest: true,
  dailyBriefings: true,
  onlyHighRelevance: true
};

const PAGE_SIZE = 25;

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  events = [],
  entities = [],
  currentUser,
  onOpenEvent,
  onOpenEntity,
  onOpenBriefing,
  onRequireAuth,
  onBack
}) => {
  const [notifications, setNotifications] = useState<SinalNotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [toastMsg, setToastMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  const [activeTab, setActiveTab] = useState<NotificationCategory>('todas');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 180);
  const [filterOnlyUnread, setFilterOnlyUnread] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_NOTIF_SETTINGS);

  const showToast = useCallback((text: string, isError = false) => {
    setToastMsg({ text, isError });
    setTimeout(() => setToastMsg(null), 4000);
  }, []);

  // Carrega notificações reais e preferências isoladas do usuário autenticado
  useEffect(() => {
    setLoadError(null);
    setSessionExpired(false);
    setHasMore(false);

    if (!currentUser?.id) {
      setNotifications([]);
      setSettings(DEFAULT_NOTIF_SETTINGS);
      return;
    }

    let cancelled = false;
    setNotifications([]);
    setSettings(DEFAULT_NOTIF_SETTINGS);

    // 1. Hidratação imediata do cache privado deste usuário
    try {
      const cacheKey = notificationService.getUserCacheKey(currentUser.id);
      const saved = localStorage.getItem(cacheKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setNotifications(parsed);
      }

      const settingsCacheKey = notificationService.getUserSettingsCacheKey(currentUser.id);
      const savedSettings = localStorage.getItem(settingsCacheKey);
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        if (parsedSettings && typeof parsedSettings === 'object') {
          setSettings({ ...DEFAULT_NOTIF_SETTINGS, ...parsedSettings });
        }
      }
    } catch {}

    // 2. Consulta paginada real no Supabase
    setIsLoading(true);
    notificationService.getUserNotificationsDetailed(currentUser.id, { limit: PAGE_SIZE, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setLoadError(res.error);
          setSessionExpired(Boolean(res.sessionExpired));
          return;
        }
        setNotifications(res.items);
        setHasMore(res.hasMore);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    // 3. Sincroniza preferências de alerta do usuário no Supabase (fonte canônica)
    userService.getUserPreferencesDetailed(currentUser.id)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          if (res.sessionExpired) setSessionExpired(true);
          showToast(res.error, true);
          return;
        }
        if (!res.data) return;

        const remoteSettings = res.data.notification_settings;
        const merged =
          remoteSettings && typeof remoteSettings === 'object'
            ? {
                ...DEFAULT_NOTIF_SETTINGS,
                ...remoteSettings
              }
            : {
                ...DEFAULT_NOTIF_SETTINGS
              };

        setSettings(merged);
        try {
          localStorage.setItem(
            notificationService.getUserSettingsCacheKey(currentUser.id),
            JSON.stringify(merged)
          );
        } catch {}
      })
      .catch(() => {
        if (!cancelled) {
          showToast('Erro de conexão ao sincronizar preferências de alerta.', true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, reloadNonce]);

  const handleLoadMore = async () => {
    if (!currentUser?.id || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const res = await notificationService.getUserNotificationsDetailed(currentUser.id, {
        limit: PAGE_SIZE,
        offset: notifications.length
      });
      if (res.error) {
        showToast(res.error, true);
        if (res.sessionExpired) setSessionExpired(true);
        return;
      }
      setNotifications((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const nextOnes = res.items.filter((it: SinalNotificationItem) => !existingIds.has(it.id));
        return [...prev, ...nextOnes];
      });
      setHasMore(res.hasMore);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  // Contagens dinâmicas reais por categoria
  const counts = useMemo(() => {
    return {
      acontecimentos: notifications.filter((n) => n.category === 'acontecimentos').length,
      entidades: notifications.filter((n) => n.category === 'entidades').length,
      temas: notifications.filter((n) => n.category === 'temas').length,
      fontes: notifications.filter((n) => n.category === 'fontes').length,
      atualizacoes: notifications.filter((n) => n.category === 'atualizacoes').length
    };
  }, [notifications]);

  const handleItemClick = async (item: SinalNotificationItem) => {
    const previousList = notifications;

    // 1. Atualização otimista com rollback caso o Supabase rejeite
    if (!item.read) {
      const updated = notifications.map((n) => (n.id === item.id ? { ...n, read: true } : n));
      setNotifications(updated);

      if (currentUser?.id) {
        try {
          localStorage.setItem(notificationService.getUserCacheKey(currentUser.id), JSON.stringify(updated));
        } catch {}

        const res = await notificationService.markAsReadDetailed(item.id, currentUser.id);
        if (!res.success) {
          setNotifications(previousList);
          try {
            localStorage.setItem(notificationService.getUserCacheKey(currentUser.id), JSON.stringify(previousList));
          } catch {}
          showToast(res.error || 'Não foi possível marcar a notificação como lida.', true);
          if (res.sessionExpired) {
            setSessionExpired(true);
            onRequireAuth?.();
          }
          return;
        }
      }
    }

    // 2. Navegação segura para destinos reais
    if (item.eventId) {
      const foundEvent = events.find((e) => e.id === item.eventId);
      if (foundEvent && onOpenEvent) {
        onOpenEvent(foundEvent);
        return;
      }
      if (isSupabaseConfigured && onOpenEvent) {
        try {
          const { data: evRow } = await (supabase as any)
            .from('events')
            .select('id, title, slug, summary, why_it_matters, relevance_score, article_count, published_at, updated_at')
            .eq('id', item.eventId)
            .maybeSingle();
          if (evRow?.id) {
            const published = evRow.published_at || evRow.updated_at || new Date().toISOString();
            onOpenEvent({
              id: String(evRow.id),
              title: evRow.title || 'Acontecimento registrado',
              summary: evRow.summary || '',
              whatHappened: evRow.summary || '',
              whyItMatters: evRow.why_it_matters || 'Fato apurado pelo motor editorial da FatosBR.',
              category: 'Brasil',
              relevanceScore: Number(evRow.relevance_score || 75),
              publishedAt: published,
              updatedAt: evRow.updated_at || published,
              relativeTime: new Date(published).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
              sources: [],
              entities: [],
              topics: [],
              timeline: [],
            });
            return;
          }
        } catch {}
      }
      showToast('Este acontecimento não está mais disponível no catálogo atual.', true);
      return;
    }

    if (item.entityId) {
      const foundEntity = entities.find((e) => e.id === item.entityId);
      if (foundEntity && onOpenEntity) {
        onOpenEntity(foundEntity);
        return;
      }
      showToast('Esta entidade não está disponível no momento.', true);
      return;
    }

    if (item.metadata?.briefingId || item.category === 'atualizacoes') {
      if (onOpenBriefing) {
        onOpenBriefing(item.metadata?.briefingId);
        return;
      }
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!currentUser?.id) {
      onRequireAuth?.();
      return;
    }

    const previousList = notifications;
    const updated = notifications.map((n) => ({ ...n, read: true }));
    setNotifications(updated);

    try {
      localStorage.setItem(notificationService.getUserCacheKey(currentUser.id), JSON.stringify(updated));
    } catch {}

    const res = await notificationService.markAllAsReadDetailed(currentUser.id);
    if (!res.success) {
      setNotifications(previousList);
      try {
        localStorage.setItem(notificationService.getUserCacheKey(currentUser.id), JSON.stringify(previousList));
      } catch {}
      showToast(res.error || 'Não foi possível marcar todas como lidas.', true);
      if (res.sessionExpired) {
        setSessionExpired(true);
        onRequireAuth?.();
      }
      return;
    }

    setFilterOnlyUnread(false);
    showToast('Todas as notificações foram marcadas como lidas.');
  };

  const handleSaveSettings = async () => {
    if (!currentUser?.id) {
      onRequireAuth?.();
      return;
    }

    setIsSavingSettings(true);
    try {
      const res = await userService.updateUserPreferencesDetailed(currentUser.id, {
        notification_settings: settings
      });

      if (!res.success) {
        showToast(res.error || 'Não foi possível salvar preferências de alerta.', true);
        if (res.sessionExpired) onRequireAuth?.();
        return;
      }

      try {
        localStorage.setItem(
          notificationService.getUserSettingsCacheKey(currentUser.id),
          JSON.stringify(settings)
        );
      } catch {}

      setIsSettingsOpen(false);
      showToast('Preferências de alerta salvas!');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Filtragem
  const filteredNotifications = useMemo(() => {
    return notifications.filter((item) => {
      if (activeTab === 'acontecimentos' && item.category !== 'acontecimentos') return false;
      if (activeTab === 'entidades' && item.category !== 'entidades') return false;
      if (activeTab === 'temas' && item.category !== 'temas') return false;
      if (activeTab === 'fontes' && item.category !== 'fontes') return false;
      if (activeTab === 'atualizacoes' && item.category !== 'atualizacoes') return false;
      if (filterOnlyUnread && item.read) return false;
      if (debouncedSearchQuery.trim().length > 0) {
        const query = debouncedSearchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(query) ||
          item.subtitle.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [notifications, activeTab, filterOnlyUnread, debouncedSearchQuery]);

  // Agrupamento por Data
  const groupedByDate = useMemo(() => {
    const groups: { [key: string]: SinalNotificationItem[] } = {};
    filteredNotifications.forEach((item) => {
      if (!groups[item.dateGroup]) {
        groups[item.dateGroup] = [];
      }
      groups[item.dateGroup].push(item);
    });
    return groups;
  }, [filteredNotifications]);

  const dateGroupKeys = Object.keys(groupedByDate);

  return (
    <div className="flex-1 flex flex-col lg:flex-row w-full max-w-7xl mx-auto text-zinc-100 overflow-x-hidden">
      {/* Toast de feedback */}
      {toastMsg && (
        <div
          role="status"
          className={`fixed top-5 right-5 z-50 border px-4 py-2.5 rounded-xl shadow-2xl text-xs flex items-center gap-2 animate-fade-in font-medium max-w-[90vw] ${
            toastMsg.isError
              ? 'bg-[#1a1114] border-red-800/70 text-red-100'
              : 'bg-[#161820] border-zinc-700 text-white'
          }`}
        >
          {toastMsg.isError ? <AlertCircle className="w-4 h-4 text-red-400 shrink-0" /> : <Check className="w-4 h-4 text-white shrink-0" />}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* ================= COLUNA PRINCIPAL ================= */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6 min-w-0">
        {/* Voltar ao feed (Mobile & Desktop) */}
        {onBack && (
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-300 hover:text-white px-3.5 py-2 rounded-xl bg-[#111216] border border-[#1e2026] hover:border-zinc-700 transition cursor-pointer min-h-[44px] active:scale-95"
            aria-label="Voltar para a página inicial"
          >
            <ChevronLeft className="w-4 h-4 text-zinc-300" />
            <span>Voltar ao feed</span>
          </button>
        )}

        {/* Header do Título & Subtítulo */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Notificações
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1">
              Alertas em tempo real sobre empresas, temas e acontecimentos que você acompanha.
            </p>
          </div>

          {/* Ações Mobile */}
          <div className="flex sm:hidden items-center gap-2">
            <button
              type="button"
              onClick={() => setIsMobileSearchOpen((v) => !v)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-300 hover:text-white transition cursor-pointer"
              aria-label="Buscar notificações"
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              disabled={isLoading}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-300 hover:text-white transition cursor-pointer disabled:opacity-50"
              aria-label="Recarregar notificações"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAllAsRead()}
                className="min-h-[44px] px-3 flex items-center gap-1.5 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-200 hover:text-white text-xs font-semibold transition cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
                <span>Ler todas</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-300 hover:text-white transition cursor-pointer ml-auto"
              aria-label="Configurações de notificações"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>

          {/* Desktop Search & Ações Rápidas */}
          <div className="hidden sm:flex items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Buscar notificações..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 lg:w-56 bg-[#111216] border border-[#1e2026] rounded-xl pl-9 pr-4 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-700"
              />
            </div>

            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              disabled={isLoading}
              className="p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer disabled:opacity-50"
              title="Recarregar notificações"
              aria-label="Recarregar notificações"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAllAsRead()}
                className="p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer"
                title="Marcar todas como lidas"
                aria-label="Marcar todas como lidas"
              >
                <CheckCheck className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer"
              title="Configurações de notificações"
              aria-label="Configurações de notificações"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile Search Input */}
        {isMobileSearchOpen && (
          <div className="sm:hidden relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar notificações..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#111216] border border-[#1e2026] rounded-xl pl-9 pr-9 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-700"
            />
            <button
              onClick={() => {
                setIsMobileSearchOpen(false);
                setSearchQuery('');
              }}
              className="absolute right-2.5 top-2 text-zinc-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Filtros em Abas de Categoria */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setActiveTab('todas')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'todas'
                ? 'bg-white text-black shadow-sm'
                : 'bg-[#111216] text-zinc-400 hover:text-white border border-[#1e2026]'
            }`}
          >
            Todas {notifications.length > 0 && `(${notifications.length})`}
          </button>

          <button
            onClick={() => setActiveTab('acontecimentos')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'acontecimentos'
                ? 'bg-white text-black shadow-sm'
                : 'bg-[#111216] text-zinc-400 hover:text-white border border-[#1e2026]'
            }`}
          >
            Acontecimentos
          </button>

          <button
            onClick={() => setActiveTab('entidades')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'entidades'
                ? 'bg-white text-black shadow-sm'
                : 'bg-[#111216] text-zinc-400 hover:text-white border border-[#1e2026]'
            }`}
          >
            Entidades
          </button>

          <button
            onClick={() => setActiveTab('temas')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'temas'
                ? 'bg-white text-black shadow-sm'
                : 'bg-[#111216] text-zinc-400 hover:text-white border border-[#1e2026]'
            }`}
          >
            Temas
          </button>

          <button
            onClick={() => setActiveTab('fontes')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'fontes'
                ? 'bg-white text-black shadow-sm'
                : 'bg-[#111216] text-zinc-400 hover:text-white border border-[#1e2026]'
            }`}
          >
            Fontes
          </button>

          <button
            onClick={() => setActiveTab('atualizacoes')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'atualizacoes'
                ? 'bg-white text-black shadow-sm'
                : 'bg-[#111216] text-zinc-400 hover:text-white border border-[#1e2026]'
            }`}
          >
            Briefings
          </button>

          <button
            onClick={() => setFilterOnlyUnread(!filterOnlyUnread)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ml-auto shrink-0 flex items-center gap-1.5 ${
              filterOnlyUnread
                ? 'bg-zinc-800 text-white border border-zinc-700'
                : 'bg-[#111216] text-zinc-400 hover:text-white border border-[#1e2026]'
            }`}
          >
            <span>Não lidas</span>
            {unreadCount > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
            )}
          </button>
        </div>

        {/* LISTAGEM DE NOTIFICAÇÕES, SKELETON, ERRO OU EMPTY STATE AUTÊNTICO */}
        {isLoading && notifications.length === 0 ? (
          <div className="p-4 sm:p-6 rounded-3xl border border-[#1e2026] bg-[#111216]">
            <ListRowSkeleton count={5} />
          </div>
        ) : loadError && notifications.length === 0 ? (
          <div className="p-10 sm:p-14 rounded-3xl border border-[#1e2026] bg-[#111216] text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-300">
              <AlertCircle className="w-6 h-6 text-zinc-300" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h3 className="text-base font-bold text-white">
                {sessionExpired ? 'Sessão expirada' : 'Erro de sincronização'}
              </h3>
              <p className="text-xs sm:text-[13px] text-zinc-400 leading-relaxed">
                {loadError}
              </p>
            </div>
            <div className="pt-1 flex items-center justify-center gap-2">
              {sessionExpired ? (
                <button
                  type="button"
                  onClick={() => onRequireAuth?.()}
                  className="px-4 py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer min-h-[44px]"
                >
                  Fazer login novamente
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setReloadNonce((n) => n + 1)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer min-h-[44px]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Tentar novamente</span>
                </button>
              )}
            </div>
          </div>
        ) : dateGroupKeys.length === 0 ? (
          <div className="p-10 sm:p-14 rounded-3xl border border-[#1e2026] bg-[#111216] text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500 shadow-lg">
              {filterOnlyUnread && notifications.length > 0 ? (
                <CheckCheck className="w-6 h-6 text-zinc-400" />
              ) : (
                <Bell className="w-6 h-6 text-zinc-400" />
              )}
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h3 className="text-base font-bold text-white">
                {filterOnlyUnread && notifications.length > 0
                  ? 'Todas as notificações foram lidas'
                  : activeTab !== 'todas' || searchQuery
                    ? 'Nenhuma notificação encontrada'
                    : 'Nenhuma notificação no momento'}
              </h3>
              <p className="text-xs sm:text-[13px] text-zinc-400 leading-relaxed">
                {filterOnlyUnread && notifications.length > 0
                  ? 'Você está em dia com todos os alertas da sua conta.'
                  : activeTab !== 'todas' || searchQuery
                    ? 'Tente limpar os filtros ou ajustar o termo de busca.'
                    : 'Você receberá notificações aqui assim que surgirem acontecimentos relevantes ou resumos vinculados aos temas e empresas que você segue.'}
              </p>
            </div>
            {(activeTab !== 'todas' || filterOnlyUnread || searchQuery) && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={() => {
                    setActiveTab('todas');
                    setFilterOnlyUnread(false);
                    setSearchQuery('');
                  }}
                  className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer min-h-[44px]"
                >
                  Limpar filtros
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {loadError && (
              <div className="rounded-2xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-xs text-red-200 flex items-center justify-between gap-3">
                <span>{loadError}</span>
                <button
                  type="button"
                  onClick={() => setReloadNonce((n) => n + 1)}
                  className="text-white underline font-semibold shrink-0 cursor-pointer"
                >
                  Recarregar
                </button>
              </div>
            )}

            {dateGroupKeys.map((group) => (
              <section key={group} className="space-y-3">
                <h2 className="text-xs sm:text-sm font-bold text-zinc-300 tracking-wide">
                  {group}
                </h2>

                <div className="space-y-2">
                  {groupedByDate[group].map((item) => (
                    <div
                      key={item.id}
                      onClick={() => void handleItemClick(item)}
                      className={`group relative p-3.5 sm:p-4 rounded-2xl border transition flex items-center justify-between gap-3.5 cursor-pointer ${
                        !item.read
                          ? 'bg-[#111216] border-[#22252e] hover:border-zinc-600 shadow-sm'
                          : 'bg-[#0d0e12] border-[#181a20] hover:bg-[#111216] hover:border-zinc-800 text-zinc-400'
                      }`}
                    >
                      {!item.read && (
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center">
                          <span className="w-2 h-2 rounded-full bg-white shadow-sm ring-2 ring-[#111216]" />
                        </div>
                      )}

                      <div className="flex items-center gap-3.5 min-w-0 flex-1 pl-3">
                        <CompanyLogoBadge
                          name={item.title.split(' ')[0] || 'FatosBR'}
                          type={item.category === 'entidades' ? 'company' : 'topic'}
                          size="md"
                        />

                        <div className="min-w-0 flex-1">
                          <h3
                            className={`text-xs sm:text-sm font-bold leading-snug truncate ${
                              !item.read ? 'text-white' : 'text-zinc-300 group-hover:text-white'
                            }`}
                          >
                            {item.title}
                          </h3>

                          <p className="text-[11px] sm:text-xs text-zinc-400 line-clamp-1 mt-0.5 leading-tight">
                            {item.subtitle}
                          </p>

                          <div className="text-[10px] font-mono text-zinc-500 mt-1">
                            {item.timestamp}
                          </div>
                        </div>
                      </div>

                      <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors shrink-0" />
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {/* Paginação */}
            {hasMore && (
              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => void handleLoadMore()}
                  disabled={isLoadingMore}
                  className="px-5 py-2.5 rounded-xl bg-[#111216] border border-[#1e2026] hover:border-zinc-700 text-xs font-semibold text-zinc-200 hover:text-white transition cursor-pointer disabled:opacity-50 min-h-[44px]"
                >
                  {isLoadingMore ? 'Carregando mais...' : 'Carregar mais notificações'}
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ================= COLUNA DIREITA (DESKTOP) ================= */}
      <aside className="hidden lg:block w-72 xl:w-80 border-l border-[#1a1c22] p-6 shrink-0 sticky top-0 h-screen overflow-y-auto space-y-6">
        <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3.5">
          <h3 className="text-xs font-bold text-white tracking-wide">
            Categorias de Alertas
          </h3>

          <div className="space-y-1.5 text-xs">
            <button
              onClick={() => {
                setActiveTab('acontecimentos');
                setFilterOnlyUnread(false);
              }}
              className={`w-full flex items-center justify-between p-2 rounded-xl transition cursor-pointer ${
                activeTab === 'acontecimentos'
                  ? 'bg-zinc-800 text-white font-semibold'
                  : 'text-zinc-300 hover:bg-[#16181f] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Newspaper className="w-4 h-4 text-zinc-400" />
                <span>Acontecimentos</span>
              </div>
              <span className="font-mono text-zinc-500 text-[11px]">{counts.acontecimentos}</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('entidades');
                setFilterOnlyUnread(false);
              }}
              className={`w-full flex items-center justify-between p-2 rounded-xl transition cursor-pointer ${
                activeTab === 'entidades'
                  ? 'bg-zinc-800 text-white font-semibold'
                  : 'text-zinc-300 hover:bg-[#16181f] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <BarChart3 className="w-4 h-4 text-zinc-400" />
                <span>Entidades</span>
              </div>
              <span className="font-mono text-zinc-500 text-[11px]">{counts.entidades}</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('temas');
                setFilterOnlyUnread(false);
              }}
              className={`w-full flex items-center justify-between p-2 rounded-xl transition cursor-pointer ${
                activeTab === 'temas'
                  ? 'bg-zinc-800 text-white font-semibold'
                  : 'text-zinc-300 hover:bg-[#16181f] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Hash className="w-4 h-4 text-zinc-400" />
                <span>Temas</span>
              </div>
              <span className="font-mono text-zinc-500 text-[11px]">{counts.temas}</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('fontes');
                setFilterOnlyUnread(false);
              }}
              className={`w-full flex items-center justify-between p-2 rounded-xl transition cursor-pointer ${
                activeTab === 'fontes'
                  ? 'bg-zinc-800 text-white font-semibold'
                  : 'text-zinc-300 hover:bg-[#16181f] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Rss className="w-4 h-4 text-zinc-400" />
                <span>Fontes</span>
              </div>
              <span className="font-mono text-zinc-500 text-[11px]">{counts.fontes}</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('atualizacoes');
                setFilterOnlyUnread(false);
              }}
              className={`w-full flex items-center justify-between p-2 rounded-xl transition cursor-pointer ${
                activeTab === 'atualizacoes'
                  ? 'bg-zinc-800 text-white font-semibold'
                  : 'text-zinc-300 hover:bg-[#16181f] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-zinc-400" />
                <span>Briefings</span>
              </div>
              <span className="font-mono text-zinc-500 text-[11px]">{counts.atualizacoes}</span>
            </button>
          </div>
        </div>

        {/* Card: Preferências */}
        <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
          <h3 className="text-xs font-bold text-white tracking-wide">
            Preferências de Alerta
          </h3>
          <p className="text-[11px] text-zinc-400 leading-snug">
            Configure quais acontecimentos e resumos geram avisos imediatos.
          </p>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="w-full py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold transition cursor-pointer text-center block"
          >
            Ajustar Notificações
          </button>
        </div>
      </aside>

      {/* Modal de Configurações */}
      {isSettingsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-[#111216] border border-zinc-800 p-6 space-y-5 text-white"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold">Configurações de Alertas</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/50 cursor-pointer">
                <span>Acontecimentos importantes</span>
                <input
                  type="checkbox"
                  checked={settings.urgentEvents}
                  onChange={(e) => setSettings({ ...settings, urgentEvents: e.target.checked })}
                  className="rounded border-zinc-700"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/50 cursor-pointer">
                <span>Atualizações de entidades seguidas</span>
                <input
                  type="checkbox"
                  checked={settings.entityUpdates}
                  onChange={(e) => setSettings({ ...settings, entityUpdates: e.target.checked })}
                  className="rounded border-zinc-700"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/50 cursor-pointer">
                <span>Alertas sobre temas</span>
                <input
                  type="checkbox"
                  checked={settings.topicAlerts}
                  onChange={(e) => setSettings({ ...settings, topicAlerts: e.target.checked })}
                  className="rounded border-zinc-700"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/50 cursor-pointer">
                <span>Notícias de fontes seguidas</span>
                <input
                  type="checkbox"
                  checked={settings.sourcesDigest}
                  onChange={(e) => setSettings({ ...settings, sourcesDigest: e.target.checked })}
                  className="rounded border-zinc-700"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/50 cursor-pointer">
                <span>Briefings prontos</span>
                <input
                  type="checkbox"
                  checked={settings.dailyBriefings}
                  onChange={(e) => setSettings({ ...settings, dailyBriefings: e.target.checked })}
                  className="rounded border-zinc-700"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/50 cursor-pointer">
                <span>Apenas notificações de alta relevância</span>
                <input
                  type="checkbox"
                  checked={settings.onlyHighRelevance}
                  onChange={(e) => setSettings({ ...settings, onlyHighRelevance: e.target.checked })}
                  className="rounded border-zinc-700"
                />
              </label>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-semibold min-h-[44px] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingSettings}
                onClick={() => void handleSaveSettings()}
                className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 min-h-[44px] cursor-pointer disabled:opacity-50"
              >
                {isSavingSettings ? 'Salvando...' : 'Salvar Preferências'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
