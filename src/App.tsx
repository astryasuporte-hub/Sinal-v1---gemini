/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense, useRef } from 'react';
import {
  INITIAL_ENTITIES,
  INITIAL_TOPICS,
  INITIAL_SOURCES,
  INITIAL_SUBSCRIPTION,
  HIGHLIGHTED_ENTITIES,
  TRENDING_SUBJECTS
} from './data/mockData';
import { Event, Entity, Topic, Source, UserSubscription } from './types/sinal';
import { EventCard } from './components/EventCard';
import { FeaturedTopCarousel } from './components/FeaturedTopCarousel';
import { FatosBrLogo } from './components/FatosBrLogo';
import type { HistoryItem } from './components/SavedHistoryView';
import { authService } from './services/authService';
import { userService } from './services/userService';
import { eventService } from './services/eventService';
import { newsIngestionService } from './services/newsIngestionService';
import { notificationService } from './services/notificationService';
import { briefingService } from './services/briefingService';
import { paymentsService } from './services/paymentsService';
import { isSupabaseConfigured } from './lib/supabase';
import { User as SupabaseUser } from '@supabase/supabase-js';
import {
  SinalLoading,
  FeedSkeleton,
  EventDetailSkeleton,
  EmptyFeedState,
  EmptyFollowingState,
  EmptySavedState,
  EmptyHistoryState,
  EmptyNotificationsState,
  NoResultsState,
  ErrorState,
  OfflineState,
  OfflineBanner,
  NotFoundState,
  PaywallState,
  UnauthorizedState,
  ForbiddenState,
  SessionExpiredState,
  MaintenanceState,
  GeneralStatesShowcaseModal,
  GeneralStateType
} from './components/GeneralStates';
import {
  Search,
  Bell,
  Home,
  Compass,
  Bookmark,
  User,
  Shield,
  Sparkles,
  ArrowUp,
  FileText,
  Clock,
  Globe2,
  RefreshCw,
  Command,
  AlertTriangle,
  X,
  Instagram,
  Check,
  SlidersHorizontal,
  ChevronDown,
  Menu
} from 'lucide-react';
import { rateLimitService } from './services/rateLimitService';
import { soundAlertService } from './services/soundAlertService';
import { motion, AnimatePresence } from 'motion/react';
import { LanguageSelector } from './components/LanguageSelector';
import { useI18n, useTranslation } from './i18n';
import { CookieConsentBanner } from './components/CookieConsentBanner';
import { useDebounce } from './hooks/useDebounce';
import { runOptimisticMutation } from './utils/optimisticToggle';
import { performanceMonitor } from './services/performanceMonitor';

// Code splitting de rotas e modais pesados via React.lazy (reduz drasticamente o bundle inicial)
const LandingPage = lazy(() => import('./components/LandingPage').then((m) => ({ default: m.LandingPage })));
const AdminPanel = lazy(() => import('./components/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const ProfileView = lazy(() => import('./components/ProfileView').then((m) => ({ default: m.ProfileView })));
const BriefingView = lazy(() => import('./components/BriefingView').then((m) => ({ default: m.BriefingView })));
const ExploreView = lazy(() => import('./components/ExploreView').then((m) => ({ default: m.ExploreView })));
const FollowingView = lazy(() => import('./components/FollowingView').then((m) => ({ default: m.FollowingView })));
const NotificationsView = lazy(() => import('./components/NotificationsView').then((m) => ({ default: m.NotificationsView })));
const SavedHistoryView = lazy(() => import('./components/SavedHistoryView').then((m) => ({ default: m.SavedHistoryView })));
const OnboardingFlow = lazy(() => import('./components/OnboardingFlow').then((m) => ({ default: m.OnboardingFlow })));
const FatosBRControlView = lazy(() => import('./components/FatosBRControlView').then((m) => ({ default: m.FatosBRControlView })));
const LoginPage = lazy(() => import('./components/LoginPage').then((m) => ({ default: m.LoginPage })));
const BillingModal = lazy(() => import('./components/BillingModal').then((m) => ({ default: m.BillingModal })));
const EntityDetailModal = lazy(() => import('./components/EntityDetailModal').then((m) => ({ default: m.EntityDetailModal })));
const EventDetailModal = lazy(() => import('./components/EventDetailModal').then((m) => ({ default: m.EventDetailModal })));
const LegalCenterModal = lazy(() => import('./components/LegalCenterModal').then((m) => ({ default: m.LegalCenterModal })));
const OnboardingModal = lazy(() => import('./components/OnboardingModal').then((m) => ({ default: m.OnboardingModal })));
const AuthModal = lazy(() => import('./components/AuthModal').then((m) => ({ default: m.AuthModal })));
const QuickSearchModal = lazy(() => import('./components/QuickSearchModal').then((m) => ({ default: m.QuickSearchModal })));
const KeyboardShortcutsModal = lazy(() => import('./components/KeyboardShortcutsModal').then((m) => ({ default: m.KeyboardShortcutsModal })));
const RecalibrateInterestsModal = lazy(() => import('./components/RecalibrateInterestsModal').then((m) => ({ default: m.RecalibrateInterestsModal })));

const HISTORY_STORAGE_KEY = 'sinal_history_items_v1';
const MAX_HISTORY_ITEMS = 50;

export const THEME_LABEL_MAP: Record<string, string> = {
  tech: 'Tecnologia',
  business: 'Negócios',
  politics: 'Política',
  economy: 'Economia',
  world: 'Mundo',
  science: 'Ciência',
  health: 'Saúde',
  sports: 'Esportes',
  culture: 'Cultura',
  entertainment: 'Entretenimento',
  environment: 'Meio Ambiente',
  education: 'Educação'
};

export const AVAILABLE_THEMES = [
  { id: 'all', label: 'Todas as Notícias' },
  { id: 'tech', label: 'Tecnologia & IA' },
  { id: 'politics', label: 'Política' },
  { id: 'business', label: 'Negócios' },
  { id: 'economy', label: 'Economia' },
  { id: 'science', label: 'Ciência' },
  { id: 'world', label: 'Mundo' },
  { id: 'culture', label: 'Cultura' },
  { id: 'health', label: 'Saúde' },
  { id: 'environment', label: 'Meio Ambiente' }
];

/**
 * Classifica estritamente o gênero/tema de uma notícia com base na sua categoria editorial
 */
export function getEventGenres(category: string, title?: string, summary?: string): string[] {
  const cat = (category || '').toLowerCase().trim();
  const genres = new Set<string>();

  // Mapeamento direto e prioritário pela categoria editorial da notícia
  if (cat.includes('polític') || cat.includes('politic') || cat.includes('governo') || cat.includes('eleiç') || cat.includes('planalto') || cat.includes('stf') || cat.includes('congresso') || cat.includes('senado') || cat.includes('câmara')) {
    genres.add('politics');
  }
  if (cat.includes('econ') || cat.includes('finan') || cat.includes('fiscal') || cat.includes('mercado') || cat.includes('selic') || cat.includes('câmbio') || cat.includes('inflação')) {
    genres.add('economy');
  }
  if (cat.includes('tec') || cat.includes(' ia') || cat.includes('ia ') || cat.includes('ai') || cat.includes('software') || cat.includes('computa') || cat.includes('digital') || cat.includes('chip')) {
    genres.add('tech');
  }
  if (cat.includes('negóci') || cat.includes('negoci') || cat.includes('empresa') || cat.includes('corporat') || cat.includes('m&a') || cat.includes('startup') || cat.includes('varejo')) {
    genres.add('business');
  }
  if (cat.includes('ciênc') || cat.includes('ciencia') || cat.includes('scienc') || cat.includes('espacial') || cat.includes('física') || cat.includes('astronom') || cat.includes('nasa')) {
    genres.add('science');
  }
  if (cat.includes('mundo') || cat.includes('internacional') || cat.includes('geopolític') || cat.includes('exterior') || cat.includes('europa') || cat.includes('eua') || cat.includes('global')) {
    genres.add('world');
  }
  if (cat.includes('saúde') || cat.includes('saude') || cat.includes('medic') || cat.includes('hospital') || cat.includes('sanitár') || cat.includes('anvisa') || cat.includes('vacina')) {
    genres.add('health');
  }
  if (cat.includes('esporte') || cat.includes('futebol') || cat.includes('olimpíad') || cat.includes('brasileirão') || cat.includes('fifa')) {
    genres.add('sports');
  }
  if (cat.includes('cultur') || cat.includes('arte') || cat.includes('música') || cat.includes('literatur') || cat.includes('teatro')) {
    genres.add('culture');
  }
  if (cat.includes('entreten') || cat.includes('cinema') || cat.includes('filme') || cat.includes('série') || cat.includes('streaming') || cat.includes('hollywood')) {
    genres.add('entertainment');
  }
  if (cat.includes('ambiente') || cat.includes('clima') || cat.includes('sustent') || cat.includes('ecolog') || cat.includes('energia') || cat.includes('amazônia')) {
    genres.add('environment');
  }
  if (cat.includes('educa') || cat.includes('sociedade') || cat.includes('escola') || cat.includes('universidade') || cat.includes('enem') || cat.includes('ensino')) {
    genres.add('education');
  }

  // Se a categoria for ampla/genérica (ex: "Brasil & Atualidades", "Geral", "Regulação"), determina pelo título específico
  if (genres.size === 0) {
    const t = (title || '').toLowerCase();
    if (t.includes('lula') || t.includes('bolsonaro') || t.includes('governo') || t.includes('congresso') || t.includes('stf') || t.includes('senado') || t.includes('câmara') || t.includes('ministr') || t.includes('moraes') || t.includes('polític')) {
      genres.add('politics');
    } else if (t.includes('dólar') || t.includes('ibovespa') || t.includes('inflação') || t.includes('selic') || t.includes('banco central') || t.includes('pib') || t.includes('juros') || t.includes('fisco') || t.includes('economi')) {
      genres.add('economy');
    } else if (t.includes('ia') || t.includes('inteligência artificial') || t.includes('nvidia') || t.includes('openai') || t.includes('google') || t.includes('apple') || t.includes('meta') || t.includes('microsoft') || t.includes('chatgpt') || t.includes('tecnolog')) {
      genres.add('tech');
    } else if (t.includes('empresa') || t.includes('lucro') || t.includes('aquisição') || t.includes('startup') || t.includes('fusão') || t.includes('ceo') || t.includes('negóci')) {
      genres.add('business');
    } else if (t.includes('guerra') || t.includes('eua') || t.includes('china') || t.includes('rússia') || t.includes('ucrânia') || t.includes('oriente médio') || t.includes('mundo')) {
      genres.add('world');
    } else if (t.includes('vacina') || t.includes('dengue') || t.includes('vírus') || t.includes('médico') || t.includes('saúde')) {
      genres.add('health');
    } else if (t.includes('futebol') || t.includes('gol') || t.includes('campeonato') || t.includes('esporte')) {
      genres.add('sports');
    }
  }

  return Array.from(genres);
}

export function eventMatchesAnyUserTheme(
  category: string,
  title: string,
  summary: string,
  themeIds: string[]
): boolean {
  if (!themeIds || themeIds.length === 0) return true;
  if (themeIds.includes('all')) return true;

  const genres = getEventGenres(category, title, summary);
  if (genres.length === 0) {
    // Fallback de correspondência textual caso não categorizado
    const combined = `${category || ''} ${title || ''} ${summary || ''}`.toLowerCase();
    return themeIds.some((id) => combined.includes(id));
  }
  return themeIds.some((id) => genres.includes(id));
}

export default function App() {
  const [currentNav, setCurrentNav] = useState<
    'landing' | 'login' | 'onboarding' | 'home' | 'explore' | 'following' | 'notifications' | 'briefings' | 'profile' | 'saved' | 'history' | 'admin' | 'control' | 'oauth_consent'
  >(() => {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      if (pathname === '/oauth/consent' || pathname.startsWith('/oauth/consent')) return 'oauth_consent';
      if (pathname === '/auth/callback' || pathname.startsWith('/auth/callback')) return 'home';
      if (pathname === '/login' || pathname.startsWith('/login')) return 'login';
      if (pathname === '/onboarding' || pathname.startsWith('/onboarding')) return 'onboarding';
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view') || params.get('page');
      if (view === 'oauth_consent' || view === 'consent') return 'oauth_consent';
      if (view === 'login') return 'login';
      if (view === 'onboarding') return 'onboarding';
      if (view === 'admin') return 'admin';
      if (view === 'control' || view === 'instagram') return 'control';
      if (view === 'landing') return 'landing';
    }
    return 'landing';
  });
  const [pendingBriefingId, setPendingBriefingId] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && isSupabaseConfigured) {
      const pathname = window.location.pathname;
      const hash = window.location.hash;
      const search = window.location.search;
      if (
        pathname.includes('/auth/callback') ||
        pathname.includes('/auth/confirm') ||
        hash.includes('access_token') ||
        search.includes('code=')
      ) {
        return true;
      }
    }
    return false;
  });
  const [onboardingResumeState, setOnboardingResumeState] = useState<{
    step: number;
    data: import('./services/userService').OnboardingSavedData;
  } | null>(null);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [isRetryingProfile, setIsRetryingProfile] = useState<boolean>(false);
  const pendingTargetNavRef = React.useRef<'home' | 'explore' | 'following' | 'notifications' | 'briefings' | 'profile' | 'saved' | 'history' | 'admin' | 'control' | undefined>(undefined);
  const recoverySessionActiveRef = React.useRef(false);
  const { language, isRTL } = useI18n();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'for-you' | 'following' | 'trending'>('for-you');
  const [homeCategoryFilter, setHomeCategoryFilter] = useState<string>('all');
  const [isThemeDrawerOpen, setIsThemeDrawerOpen] = useState<boolean>(false);
  const [feedAnimationKey, setFeedAnimationKey] = useState<number>(0);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(() => {
    try {
      const dedicated = localStorage.getItem('fatosbr_user_avatar');
      if (dedicated) return dedicated;
      const saved = localStorage.getItem('sinal_user_profile');
      if (saved) return JSON.parse(saved).avatarUrl;
    } catch {}
    return null;
  });
  const [currentUser, setCurrentUser] = useState<SupabaseUser | null>(null);
  const [, setAvatarSyncCounter] = useState<number>(0);

  // Interesses selecionados no Onboarding para filtrar estritamente o feed "Para você"
  const [userInterests, setUserInterests] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('fatosbr_user_interests');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return ['tech', 'business', 'politics', 'economy', 'science'];
  });
  const [isRecalibrateModalOpen, setIsRecalibrateModalOpen] = useState<boolean>(false);

  // Sincronização reativa de interesses do leitor entre abas e componentes
  useEffect(() => {
    const handleInterestsUpdated = (e: any) => {
      if (Array.isArray(e.detail?.interests)) {
        setUserInterests(e.detail.interests);
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'fatosbr_user_interests' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) setUserInterests(parsed);
        } catch {}
      }
    };
    window.addEventListener('fatosbr_interests_updated', handleInterestsUpdated);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('fatosbr_interests_updated', handleInterestsUpdated);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Sincronização automática do avatar em todos os componentes reativos via fatosbr_avatar_updated e storage
  useEffect(() => {
    const handleAvatarUpdateEvent = (e: any) => {
      const newAvatar = e.detail?.avatarUrl !== undefined ? e.detail.avatarUrl : localStorage.getItem('fatosbr_user_avatar');
      setCurrentUserAvatar(newAvatar || null);
      setAvatarSyncCounter((c) => c + 1);
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'fatosbr_user_avatar') {
        setCurrentUserAvatar(e.newValue || null);
        setAvatarSyncCounter((c) => c + 1);
      }
    };

    window.addEventListener('fatosbr_avatar_updated', handleAvatarUpdateEvent);
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      window.removeEventListener('fatosbr_avatar_updated', handleAvatarUpdateEvent);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, []);

  const [catalogStatus, setCatalogStatus] = useState<{
    loading: boolean;
    error: string | null;
    partial: boolean;
    warning: string | null;
  }>({
    loading: false,
    error: null,
    partial: false,
    warning: null
  });

  // Catálogo oficial (entidades, fontes e opcionalmente eventos) atualizado a partir do Supabase
  const refreshCatalogFromSupabase = useCallback(async (includeEvents = false, forceRefresh = false) => {
    setCatalogStatus((prev) => ({ ...prev, loading: true }));
    try {
      const [catalogRes, remoteEvents] = await Promise.all([
        eventService.getCatalogDetailed({ forceRefresh }),
        includeEvents ? eventService.getEvents().catch(() => []) : Promise.resolve([])
      ]);

      const remoteEntities = catalogRes.entities || [];
      const remoteSources = catalogRes.sources || [];

      if (remoteEntities.length > 0) {
        setEntities((prev) => {
          const prevFollowById = new Map(prev.map((e) => [e.id, e.isFollowed]));
          const prevFollowByName = new Map(prev.map((e) => [e.name.trim().toLowerCase(), e.isFollowed]));
          return remoteEntities.map((ent) => ({
            ...ent,
            isFollowed:
              prevFollowById.get(ent.id) ??
              prevFollowByName.get(ent.name.trim().toLowerCase()) ??
              ent.isFollowed
          }));
        });
      }

      if (remoteSources.length > 0) {
        setSources((prev) => {
          const prevFollowById = new Map(prev.map((s) => [s.id, s.isFollowed]));
          const prevFollowByDomain = new Map(prev.map((s) => [s.domain.trim().toLowerCase(), s.isFollowed]));
          return remoteSources.map((src) => ({
            ...src,
            isFollowed:
              prevFollowById.get(src.id) ??
              prevFollowByDomain.get(src.domain.trim().toLowerCase()) ??
              src.isFollowed
          }));
        });
      }

      if (includeEvents && Array.isArray(remoteEvents) && remoteEvents.length > 0) {
        setEvents(remoteEvents);
      }

      if (catalogRes.unavailable) {
        setCatalogStatus({
          loading: false,
          error: catalogRes.error || 'Não foi possível carregar entidades e fontes no momento.',
          partial: false,
          warning: null
        });
      } else {
        setCatalogStatus({
          loading: false,
          error: null,
          partial: Boolean(catalogRes.partial),
          warning: catalogRes.warning || null
        });
      }
    } catch (err: any) {
      setCatalogStatus({
        loading: false,
        error: err?.message || 'Erro de conexão ao consultar catálogo de entidades e fontes.',
        partial: false,
        warning: null
      });
    }
  }, []);

  // Sincronização em tempo real do catálogo quando houver importação ou alteração de imagens
  useEffect(() => {
    const handleEntitiesUpdated = () => {
      void refreshCatalogFromSupabase(true);
    };
    window.addEventListener('fatosbr_entities_updated', handleEntitiesUpdated);
    return () => window.removeEventListener('fatosbr_entities_updated', handleEntitiesUpdated);
  }, [refreshCatalogFromSupabase]);

  // Notificações Push Editoriais (Desativadas visualmente)

  // Notificações Push Editoriais (Desativadas até envio de novo layout HTML pelo usuário)

  // Conectividade e Estados Gerais da Experiência
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isStatesShowcaseOpen, setIsStatesShowcaseOpen] = useState(false);
  const [activeStateSimulation, setActiveStateSimulation] = useState<GeneralStateType | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);



  // Atalhos Globais de Teclado
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [pendingGSequence, setPendingGSequence] = useState(false);

  // Rate Limit do Usuário (5 atualizações por dia)
  const [dailyRefreshRemaining, setDailyRefreshRemaining] = useState<number>(() =>
    rateLimitService.getRemainingRefreshes()
  );
  const [rateLimitToast, setRateLimitToast] = useState<string | null>(null);
  const [actionErrorToast, setActionErrorToast] = useState<string | null>(null);

  const showActionError = useCallback((msg: string) => {
    setActionErrorToast(msg);
    setTimeout(() => {
      setActionErrorToast((curr) => (curr === msg ? null : curr));
    }, 4000);
  }, []);

  // Domain state - Notícias em tempo real com hidratação instantânea via cache de duas camadas (Memória + localStorage)
  const [events, setEvents] = useState<Event[]>(() => {
    const instant = rateLimitService.getInstantFeedSync();
    return Array.isArray(instant) && instant.length > 0 ? (instant as Event[]) : [];
  });
  const [isFeedRefreshing, setIsFeedRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>(INITIAL_ENTITIES);
  const [topics, setTopics] = useState<Topic[]>(INITIAL_TOPICS);
  const [sources, setSources] = useState<Source[]>(INITIAL_SOURCES);
  const [subscription, setSubscription] = useState<UserSubscription>(INITIAL_SUBSCRIPTION);
  const [hiddenEventIds, setHiddenEventIds] = useState<Set<string>>(new Set());
  const [savedEventIds, setSavedEventIds] = useState<Set<string>>(new Set());

  // Histórico de Acontecimentos Abertos (Biblioteca Pessoal) persistido no localStorage (máx 50 itens)
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed.slice(0, MAX_HISTORY_ITEMS);
          }
        }
      }
    } catch (err) {
      console.warn('Erro ao restaurar histórico de leitura do localStorage:', err);
    }
    return [];
  });

  // Sincronização persistente do histórico no localStorage com limite de 50 itens
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(
          HISTORY_STORAGE_KEY,
          JSON.stringify(historyItems.slice(0, MAX_HISTORY_ITEMS))
        );
      }
    } catch (err) {
      console.error('Falha ao persistir histórico no localStorage:', err);
      try {
        if (historyItems.length > 20) {
          localStorage.setItem(
            HISTORY_STORAGE_KEY,
            JSON.stringify(historyItems.slice(0, 20))
          );
        }
      } catch {}
    }
  }, [historyItems]);

  // Função para buscar notícias reais via provedores e alimentar o feed em tempo real com Stale-While-Revalidate (SWR)
  const loadRealTimeNews = async (isManualRefresh = false) => {
    let hasShownStale = false;

    if (isManualRefresh) {
      const check = rateLimitService.recordUserRefresh();
      if (!check.allowed) {
        setRateLimitToast(
          'Você atingiu o limite de 5 atualizações manuais diárias. Novas matérias serão sincronizadas automaticamente para respeitar as cotas das APIs.'
        );
        setTimeout(() => setRateLimitToast(null), 5000);
        return;
      }
      setDailyRefreshRemaining(check.remaining);
      setIsFeedRefreshing(true);
    } else {
      // 1. Stale-While-Revalidate: Exibe imediatamente dados em cache (Tier 1/2) para 0ms de tela branca
      const cached = rateLimitService.getCachedFeed();
      if (cached && cached.length > 0) {
        const viewedIds = new Set(historyItems.map((h) => h.event.id));
        const cachedWithViewed = cached.map((e) => ({
          ...e,
          isViewed: viewedIds.has(e.id) ? true : Boolean(e.isViewed),
        }));
        setEvents(cachedWithViewed);
        setLastSyncTime(
          new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        );
        setIsLoading(false);
        hasShownStale = true;
        performanceMonitor.markFeedLoaded();
        setFeedAnimationKey((k) => k + 1);
        // Não encerra a execução: prossegue com a revalidação assíncrona em segundo plano
      } else {
        const instantFallback = rateLimitService.getInstantFeedSync();
        if (instantFallback && instantFallback.length > 0) {
          setEvents(instantFallback as Event[]);
          setIsLoading(false);
          hasShownStale = true;
        } else if (events.length === 0) {
          setIsLoading(true);
        }
      }
    }

    setHasError(false);

    try {
      // 2. Revalidação em segundo plano consultando Supabase / backend canônico / provedores reais
      const realEvents = await newsIngestionService.fetchRealTimeEventsFeed(savedEventIds);
      if (realEvents && realEvents.length > 0) {
        const viewedIds = new Set(historyItems.map((h) => h.event.id));
        const eventsWithViewed = realEvents.map((e) => ({
          ...e,
          isViewed: viewedIds.has(e.id) ? true : Boolean(e.isViewed),
        }));
        setEvents(eventsWithViewed);
        // Persiste nas duas camadas (Memória RAM + localStorage)
        rateLimitService.saveCachedFeed(eventsWithViewed);
        performanceMonitor.markFeedLoaded();
        setLastSyncTime(
          new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        );

        // Alerta sonoro suave e notificação push para breaking news
        const breakingEvent = realEvents.find((e) => (e.relevanceScore || 0) >= 90);
        if (breakingEvent) {
          if (isManualRefresh) {
            soundAlertService.playNotificationChime();
          }
          notificationService.sendBreakingNewsNotification(breakingEvent, () => {
            handleOpenEventDetail(breakingEvent);
          });
        }
      } else if (!hasShownStale && events.length === 0) {
        // Se a busca retornar vazia e não há dados prévios
        setHasError(false);
      }
    } catch (err) {
      console.warn('[News Engine SWR] Revalidação em segundo plano falhou:', err);
      // Mantém os dados stale na tela para não quebrar a experiência do usuário
      if (events.length === 0 && !hasShownStale) {
        setHasError(true);
      }
    } finally {
      setIsLoading(false);
      setIsFeedRefreshing(false);
      setFeedAnimationKey((k) => k + 1);
    }
  };

  // Coleta automática de notícias reais em tempo real ao carregar o Início
  useEffect(() => {
    loadRealTimeNews(false);
  }, []);

  // Listener Global de Atalhos de Teclado (G+H, G+E, G+F, G+B, G+N, G+P, G+S, R, T, ?)
  useEffect(() => {
    let timer: any;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'Escape') {
        if (pendingGSequence) {
          setPendingGSequence(false);
          clearTimeout(timer);
          return;
        }
        if (isShortcutsModalOpen) {
          setIsShortcutsModalOpen(false);
          return;
        }
        if (activeEventModal) {
          setActiveEventModal(null);
          return;
        }
        if (activeEntityModal) {
          setActiveEntityModal(null);
          return;
        }
      }

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setIsShortcutsModalOpen((prev) => !prev);
        return;
      }

      if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !pendingGSequence) {
        e.preventDefault();
        loadRealTimeNews(true);
        return;
      }

      if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey) {
        setPendingGSequence(true);
        clearTimeout(timer);
        timer = setTimeout(() => {
          setPendingGSequence(false);
        }, 1600);
        return;
      }

      if (pendingGSequence) {
        const k = e.key.toLowerCase();
        if (k === 'h') {
          e.preventDefault();
          setCurrentNav('home');
          setPendingGSequence(false);
          clearTimeout(timer);
        } else if (k === 'e') {
          e.preventDefault();
          setCurrentNav('explore');
          setPendingGSequence(false);
          clearTimeout(timer);
        } else if (k === 'f') {
          e.preventDefault();
          setCurrentNav('following');
          setPendingGSequence(false);
          clearTimeout(timer);
        } else if (k === 'b') {
          e.preventDefault();
          setCurrentNav('briefings');
          setPendingGSequence(false);
          clearTimeout(timer);
        } else if (k === 'n') {
          e.preventDefault();
          setCurrentNav('notifications');
          setPendingGSequence(false);
          clearTimeout(timer);
        } else if (k === 'p') {
          e.preventDefault();
          setCurrentNav('profile');
          setPendingGSequence(false);
          clearTimeout(timer);
        } else if (k === 's') {
          e.preventDefault();
          setCurrentNav('saved');
          setPendingGSequence(false);
          clearTimeout(timer);
        } else if (k === 'x') {
          e.preventDefault();
          setCurrentNav('history');
          setPendingGSequence(false);
          clearTimeout(timer);
        } else {
          setPendingGSequence(false);
          clearTimeout(timer);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [pendingGSequence, isShortcutsModalOpen]);

  // Modals
  const [activeEventModal, setActiveEventModal] = useState<Event | null>(null);
  const [activeEntityModal, setActiveEntityModal] = useState<Entity | null>(null);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isLegalModalOpen, setIsLegalModalOpen] = useState(false);
  const [isQuickSearchOpen, setIsQuickSearchOpen] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<'terms' | 'lgpd' | 'cdc' | 'owner-rights' | 'dpo'>('terms');

  const handleOpenLegal = (tab: 'terms' | 'lgpd' | 'cdc' | 'owner-rights' | 'dpo' = 'terms') => {
    setLegalModalTab(tab);
    setIsLegalModalOpen(true);
  };

  // Salva última rota visitada para persistência consistente
  useEffect(() => {
    if (currentNav !== 'landing' && currentNav !== 'login') {
      try {
        localStorage.setItem('fatosbr_last_nav', currentNav);
      } catch {}
    }
  }, [currentNav]);

  const hydrateAndResolveOnboarding = useCallback(async (user: SupabaseUser, preferredTargetNav?: 'home' | 'explore' | 'following' | 'notifications' | 'briefings' | 'profile' | 'saved' | 'history' | 'admin' | 'control') => {
    pendingTargetNavRef.current = preferredTargetNav;
    try {
      const [onboardingState, followedEntityIds, followedTopicIds, followedSourceIds] = await Promise.all([
        userService.getOnboardingState(user.id),
        userService.getFollowedEntityIds(user.id),
        userService.getFollowedTopicIds(user.id),
        userService.getFollowedSourceIds(user.id),
      ]);

      if (onboardingState.status === 'ERROR') {
        setProfileLoadError(
          onboardingState.error ||
            'Não foi possível carregar seu perfil e preferências no banco de dados. Tente novamente.'
        );
        return;
      }

      setProfileLoadError(null);

      // Restaurar temas salvos no perfil canônico
      if (Array.isArray(onboardingState.data?.themes) && onboardingState.data.themes.length > 0) {
        setUserInterests(onboardingState.data.themes);
        try {
          localStorage.setItem('fatosbr_user_interests', JSON.stringify(onboardingState.data.themes));
          window.dispatchEvent(new CustomEvent('fatosbr_interests_updated', { detail: { interests: onboardingState.data.themes } }));
        } catch {}
      }

      if (Array.isArray(onboardingState.data?.feedPreferences) && onboardingState.data.feedPreferences.length > 0) {
        try {
          localStorage.setItem('fatosbr_feed_preferences', JSON.stringify(onboardingState.data.feedPreferences));
        } catch {}
      }

      if (onboardingState.data?.userLocation) {
        try {
          localStorage.setItem('fatosbr_user_region', onboardingState.data.userLocation);
        } catch {}
      }

      // Hidratar entidades, tópicos e fontes seguidos no Supabase
      const dbEntitySet = new Set(
        followedEntityIds.length > 0
          ? followedEntityIds
          : (onboardingState.data?.followedEntityIds || [])
      );
      if (dbEntitySet.size > 0) {
        setEntities((prev) => prev.map((e) => ({ ...e, isFollowed: dbEntitySet.has(e.id) })));
      }

      const dbTopicSet = new Set(
        followedTopicIds.length > 0
          ? followedTopicIds
          : (onboardingState.data?.followedTopicIds || [])
      );
      if (dbTopicSet.size > 0) {
        setTopics((prev) => prev.map((t) => ({ ...t, isFollowed: dbTopicSet.has(t.id) })));
      }

      const dbSourceSet = new Set(
        followedSourceIds.length > 0
          ? followedSourceIds
          : (onboardingState.data?.followedSourceIds || [])
      );
      if (dbSourceSet.size > 0) {
        setSources((prev) => prev.map((s) => ({ ...s, isFollowed: dbSourceSet.has(s.id) })));
      }

      if (onboardingState.status === 'COMPLETED') {
        setOnboardingResumeState(null);
        setCurrentNav(preferredTargetNav || 'home');
      } else {
        setOnboardingResumeState({
          step: onboardingState.step || 1,
          data: onboardingState.data || {},
        });
        setCurrentNav('onboarding');
      }
    } catch {
      setProfileLoadError(
        'Falha temporária ao consultar seu perfil no Supabase. Seus dados não foram alterados.'
      );
    }
  }, []);

  const handleUserSession = (user: SupabaseUser | null) => {
    setCurrentUser(user);
    if (user) {
      const dedicatedAvatar = typeof window !== 'undefined' ? localStorage.getItem('fatosbr_user_avatar') : null;
      const metaName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        (user.email ? user.email.split('@')[0] : 'Leitor');
      const metaAvatar = dedicatedAvatar || user.user_metadata?.avatar_url || null;
      if (metaAvatar) {
        setCurrentUserAvatar(metaAvatar);
      }

      try {
        localStorage.setItem(
          'sinal_user_profile',
          JSON.stringify({
            name: metaName,
            displayName: metaName,
            email: user.email,
            avatarUrl: metaAvatar,
            timezone: 'America/Sao_Paulo'
          })
        );
      } catch {}

      userService.syncUserProfile(user);

      userService.getSavedEventIds(user.id).then((savedIds) => {
        if (savedIds && savedIds.length > 0) {
          setSavedEventIds(new Set(savedIds));
          setEvents((prev) =>
            prev.map((e) => ({
              ...e,
              isSaved: savedIds.includes(e.id),
            }))
          );
        }
      });

      paymentsService.getStatus().then((payStatus) => {
        if (payStatus.success && payStatus.subscription) {
          setSubscription(payStatus.subscription);
        }
      });
    } else {
      setUnreadCount(0);
      setCurrentUserAvatar(null);
      try {
        localStorage.removeItem('fatosbr_session_active');
        localStorage.removeItem('sinal_user_profile');
        localStorage.removeItem('sinal_briefing_subscriber_email');
        localStorage.removeItem('sinal_notif_settings');
      } catch {}
    }
  };

  // Carrega catálogo público via proxy mesmo quando anon key não estiver configurada no cliente
  useEffect(() => {
    void refreshCatalogFromSupabase();
  }, [refreshCatalogFromSupabase]);

  // Supabase Auth & Dados Reais Listener
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsAuthChecking(false);
      return;
    }

    eventService.getTopics().then((remoteTopics) => {
      if (remoteTopics && remoteTopics.length > 0) {
        setTopics(remoteTopics);
      }
    });

    const restoreSessionAsync = async () => {
      try {
        const session = await authService.getSession();
        const user = session?.user || (await authService.getCurrentUser());

        const pathname = window.location.pathname;
        const search = window.location.search;
        const hash = window.location.hash;
        const isAuthCallback =
          pathname.includes('/auth/callback') ||
          pathname.includes('/auth/confirm') ||
          hash.includes('access_token') ||
          search.includes('code=');

        if (user) {
          handleUserSession(user);
          const params = new URLSearchParams(search);
          const explicitView = params.get('view') || params.get('page');
          const lastNav = localStorage.getItem('fatosbr_last_nav') as any;
          const validLastNav =
            lastNav &&
            lastNav !== 'landing' &&
            lastNav !== 'login' &&
            lastNav !== 'onboarding' &&
            lastNav !== 'oauth_consent'
              ? lastNav
              : 'home';

          if (!recoverySessionActiveRef.current) {
            if (isAuthCallback || !explicitView || explicitView === 'app' || explicitView === 'home') {
              await hydrateAndResolveOnboarding(user, validLastNav);
            }
          }

          if (isAuthCallback) {
            window.history.replaceState(null, '', '/');
          }
        } else {
          handleUserSession(null);
          if (pathname.startsWith('/onboarding')) {
            setCurrentNav('login');
          }
        }
      } catch (err) {
        console.warn('Erro ao validar sessão assíncrona:', err);
      } finally {
        setIsAuthChecking(false);
      }
    };

    restoreSessionAsync();

    const { data: authListener } = authService.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        recoverySessionActiveRef.current = true;
      }
      if (event === 'SIGNED_OUT') {
        recoverySessionActiveRef.current = false;
        handleUserSession(null);
        return;
      }
      handleUserSession(session?.user ?? null);
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [hydrateAndResolveOnboarding]);

  // Deep linking para acontecimento compartilhado (?event={id})
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sharedEventId = params.get('event');
      if (sharedEventId && events.length > 0) {
        const target = events.find((e) => e.id === sharedEventId);
        if (target) {
          setActiveEventModal(target);
        }
      }
    } catch {
      // Ignorar erros de URL
    }
  }, [events]);

  // UI state for testing states
  const [hasNewEventsBanner, setHasNewEventsBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 200);
  const [visibleFeedLimit, setVisibleFeedLimit] = useState(12);
  const feedLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const [isSearchingExternalApis, setIsSearchingExternalApis] = useState(false);
  // Contador real de notificações não lidas baseado no usuário autenticado (fonte canônica: Supabase)
  const [unreadCount, setUnreadCount] = useState<number>(0);

  // Sincronização em tempo real do contador de notificações não lidas
  useEffect(() => {
    setUnreadCount(0);

    if (!currentUser?.id) {
      return;
    }

    let cancelled = false;
    const syncUnread = async () => {
      try {
        const res = await notificationService.getUnreadCountDetailed(currentUser.id);
        if (cancelled) return;
        if (!res.error) {
          setUnreadCount(res.count);
        } else if (res.sessionExpired) {
          setUnreadCount(0);
        }
      } catch {}
    };

    // 1. Hidratação instantânea do cache privado deste usuário
    try {
      const cacheKey = notificationService.getUserCacheKey(currentUser.id);
      const saved = localStorage.getItem(cacheKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setUnreadCount(parsed.filter((n: any) => !n.read).length);
        }
      }
    } catch {}

    // 2. Consulta canônica no Supabase
    syncUnread();

    const handleNotifsChanged = () => {
      void syncUnread();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncUnread();
      }
    };

    window.addEventListener('fatosbr_notifications_updated', handleNotifsChanged);
    window.addEventListener('storage', handleNotifsChanged);
    window.addEventListener('focus', handleNotifsChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 3. Realtime leve escopo exclusivo do usuário (sem polling redundante)
    const unsubscribeRealtime = notificationService.subscribeToUserNotifications(
      currentUser.id,
      handleNotifsChanged
    );

    return () => {
      cancelled = true;
      window.removeEventListener('fatosbr_notifications_updated', handleNotifsChanged);
      window.removeEventListener('storage', handleNotifsChanged);
      window.removeEventListener('focus', handleNotifsChanged);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeRealtime();
    };
  }, [currentUser?.id]);
  const [externalSearchFailed, setExternalSearchFailed] = useState<string | null>(null);

  // Busca real em APIs externas (GNews / World News API) quando o termo não existe no cache local
  const handleSearchExternalApis = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q || q.length < 2 || isSearchingExternalApis) return;
    setIsSearchingExternalApis(true);
    setExternalSearchFailed(null);
    try {
      const liveResults = await newsIngestionService.searchLiveApis(q, savedEventIds);
      if (liveResults && liveResults.length > 0) {
        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const newOnes = liveResults.filter((e) => !existingIds.has(e.id));
          return [...newOnes, ...prev];
        });
      } else {
        setExternalSearchFailed(q);
      }
    } catch (err) {
      setExternalSearchFailed(q);
    } finally {
      setIsSearchingExternalApis(false);
    }
  }, [isSearchingExternalApis, savedEventIds]);

  // Handler para abrir detalhe do evento e registrar no histórico real silenciosamente
  const handleOpenEventDetail = (event: Event) => {
    setActiveEventModal(event);
    const now = Date.now();
    const isoString = new Date(now).toISOString();

    setHistoryItems((prev) => {
      // Reabertura: remove ocorrência anterior se já existia para reposicioná-la no topo com novo horário
      const filtered = prev.filter((item) => item.event.id !== event.id);
      const updatedItem: HistoryItem = {
        event: { ...event, isViewed: true, viewedAt: isoString },
        openedAt: 'Agora há pouco',
        timestamp: now
      };
      return [updatedItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
    });

    setEvents((prev) =>
      prev.map((e) =>
        e.id === event.id ? { ...e, isViewed: true, viewedAt: isoString } : e
      )
    );
  };

  const handleRemoveFromHistory = (eventId: string) => {
    setHistoryItems((prev) => prev.filter((item) => item.event.id !== eventId));
  };

  const handleClearHistory = () => {
    setHistoryItems([]);
  };

  // Toggle Save Event com UI otimista e rollback automático em caso de falha
  const handleToggleSave = useCallback((eventId: string) => {
    const isCurrentlySaved = savedEventIds.has(eventId);
    const applySavedState = (nextSaved: boolean) => {
      setSavedEventIds((prev) => {
        const next = new Set(prev);
        if (nextSaved) next.add(eventId);
        else next.delete(eventId);
        return next;
      });
      setEvents((prev) =>
        prev.map((e) => {
          if (e.id === eventId) {
            return {
              ...e,
              isSaved: nextSaved,
              savedAt: nextSaved ? (e.savedAt || new Date().toISOString()) : undefined
            };
          }
          return e;
        })
      );
    };

    if (!currentUser?.id) {
      applySavedState(!isCurrentlySaved);
      return;
    }

    void runOptimisticMutation({
      previousState: isCurrentlySaved,
      applyOptimistic: applySavedState,
      persist: () => userService.toggleSaveEvent(currentUser.id, eventId, isCurrentlySaved),
      onRollback: () => showActionError('Não foi possível salvar a alteração. Tente novamente.')
    });
  }, [savedEventIds, currentUser?.id, showActionError]);

  // Follow / Unfollow Handlers com UI otimista + rollback em erro do Supabase
  const handleToggleFollowEntity = useCallback((id: string) => {
    const entity = entities.find((e) => e.id === id);
    const prevFollowed = Boolean(entity?.isFollowed);
    const applyState = (nextFollowed: boolean) => {
      setEntities((prev) =>
        prev.map((e) => (e.id === id ? { ...e, isFollowed: nextFollowed } : e))
      );
    };

    if (!entity || !currentUser?.id) {
      applyState(!prevFollowed);
      return;
    }

    void runOptimisticMutation({
      previousState: prevFollowed,
      applyOptimistic: applyState,
      persist: () => userService.toggleFollowEntity(currentUser.id, id, prevFollowed),
      onRollback: () => showActionError('Falha ao atualizar entidade seguida. Alteração revertida.')
    });
  }, [entities, currentUser?.id, showActionError]);

  const handleToggleFollowTopic = useCallback((id: string) => {
    const topic = topics.find((t) => t.id === id);
    const prevFollowed = Boolean(topic?.isFollowed);
    const applyState = (nextFollowed: boolean) => {
      setTopics((prev) =>
        prev.map((t) => (t.id === id ? { ...t, isFollowed: nextFollowed } : t))
      );
    };

    if (!topic || !currentUser?.id) {
      applyState(!prevFollowed);
      return;
    }

    void runOptimisticMutation({
      previousState: prevFollowed,
      applyOptimistic: applyState,
      persist: () => userService.toggleFollowTopic(currentUser.id, id, prevFollowed),
      onRollback: () => showActionError('Falha ao atualizar tema seguido. Alteração revertida.')
    });
  }, [topics, currentUser?.id, showActionError]);

  const handleToggleFollowSource = useCallback((id: string) => {
    const source = sources.find((s) => s.id === id);
    const prevFollowed = Boolean(source?.isFollowed);
    const applyState = (nextFollowed: boolean) => {
      setSources((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isFollowed: nextFollowed } : s))
      );
    };

    if (!source || !currentUser?.id) {
      applyState(!prevFollowed);
      return;
    }

    void runOptimisticMutation({
      previousState: prevFollowed,
      applyOptimistic: applyState,
      persist: () => userService.toggleFollowSource(currentUser.id, id, prevFollowed),
      onRollback: () => showActionError('Falha ao atualizar fonte seguida. Alteração revertida.')
    });
  }, [sources, currentUser?.id, showActionError]);

  // Hide Event ("Não quero ver isso")
  const handleHideEvent = useCallback((eventId: string) => {
    setHiddenEventIds((prev) => new Set([...prev, eventId]));
  }, []);

  // Trigger simulated new events
  const handleSimulateNewEvents = () => {
    setHasNewEventsBanner(true);
  };

  const handleRefreshTop = () => {
    setHasNewEventsBanner(false);
    setFeedAnimationKey((prev) => prev + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Sets de itens seguidos pré-computados uma única vez fora do filtro do feed
  const followedSets = useMemo(() => {
    const followedEntIds = new Set<string>();
    const followedEntNames = new Set<string>();
    for (const ent of entities) {
      if (ent.isFollowed) {
        followedEntIds.add(ent.id);
        followedEntNames.add(ent.name.toLowerCase());
      }
    }

    const followedTopSlugs = new Set<string>();
    const followedTopNames = new Set<string>();
    for (const top of topics) {
      if (top.isFollowed) {
        followedTopSlugs.add(top.slug.toLowerCase());
        followedTopNames.add(top.name.toLowerCase());
      }
    }

    const followedSourceNames = new Set<string>();
    for (const s of sources) {
      if (s.isFollowed) {
        followedSourceNames.add(s.name.toLowerCase());
      }
    }

    return {
      followedEntIds,
      followedEntNames,
      followedTopSlugs,
      followedTopNames,
      followedSourceNames,
      hasAnyFollow: followedEntIds.size > 0 || followedTopSlugs.size > 0 || followedSourceNames.size > 0
    };
  }, [entities, topics, sources]);

  // Filtragem memoizada dos eventos com busca debounced
  const visibleEvents = useMemo(() => {
    const trimmedSearch = debouncedSearchQuery.trim().toLowerCase();

    return events.filter((e) => {
      if (hiddenEventIds.has(e.id)) return false;

      if (trimmedSearch.length > 0) {
        const matchesSearch =
          e.title.toLowerCase().includes(trimmedSearch) ||
          e.summary.toLowerCase().includes(trimmedSearch) ||
          e.category.toLowerCase().includes(trimmedSearch);
        if (!matchesSearch) return false;
      } else if (activeTab === 'following') {
        if (!followedSets.hasAnyFollow) return false;
        const matchesEntity = e.entities?.some(
          (ent) => followedSets.followedEntIds.has(ent.id) || followedSets.followedEntNames.has(ent.name?.toLowerCase())
        );
        const matchesTopic = e.topics?.some(
          (top) => followedSets.followedTopSlugs.has(top.slug?.toLowerCase()) || followedSets.followedTopNames.has(top.name?.toLowerCase())
        );
        const matchesSource = e.sources?.some(
          (src) => followedSets.followedSourceNames.has(src.sourceName?.toLowerCase())
        );
        if (!matchesEntity && !matchesTopic && !matchesSource) return false;
      } else if (activeTab === 'trending') {
        if (e.relevanceScore < 90) return false;
      } else if (activeTab === 'for-you') {
        if (userInterests && userInterests.length > 0) {
          if (!eventMatchesAnyUserTheme(e.category, e.title, e.summary, userInterests)) return false;
        }
      }

      if (homeCategoryFilter !== 'all') {
        if (!eventMatchesAnyUserTheme(e.category, e.title, e.summary, [homeCategoryFilter])) return false;
      }

      return true;
    });
  }, [events, hiddenEventIds, debouncedSearchQuery, activeTab, followedSets, userInterests, homeCategoryFilter]);

  // Manchetes e acontecimentos em destaque para o carrossel do topo do feed Home
  const topFeaturedEvents = useMemo(() => {
    if (debouncedSearchQuery.trim().length > 0 || visibleEvents.length === 0) return [];
    const withImages = visibleEvents.filter((e) => Boolean(e.imageUrl));
    if (withImages.length >= 2) {
      return withImages.slice(0, 4);
    }
    return visibleEvents.slice(0, 3);
  }, [visibleEvents, debouncedSearchQuery]);

  const featuredEventIds = useMemo(() => {
    return new Set(topFeaturedEvents.map((e) => e.id));
  }, [topFeaturedEvents]);

  // Feed vertical padrão (remove os acontecimentos já promovidos para o carrossel de manchetes do topo)
  const verticalFeedEvents = useMemo(() => {
    if (topFeaturedEvents.length === 0) return visibleEvents;
    return visibleEvents.filter((e) => !featuredEventIds.has(e.id));
  }, [visibleEvents, topFeaturedEvents, featuredEventIds]);

  const renderedFeedEvents = useMemo(() => {
    return verticalFeedEvents.slice(0, visibleFeedLimit);
  }, [verticalFeedEvents, visibleFeedLimit]);

  // Reseta limite de renderização progressiva ao trocar filtros
  useEffect(() => {
    setVisibleFeedLimit(12);
  }, [activeTab, homeCategoryFilter, debouncedSearchQuery]);

  // Renderização progressiva sob demanda via IntersectionObserver (evita montar todos os cards de uma vez)
  useEffect(() => {
    if (currentNav !== 'home') return;
    const sentinel = feedLoadMoreRef.current;
    if (!sentinel || visibleFeedLimit >= verticalFeedEvents.length) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleFeedLimit((prev) => Math.min(prev + 12, verticalFeedEvents.length));
        }
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [currentNav, visibleFeedLimit, verticalFeedEvents.length]);

  // Disparo automático nas APIs externas caso o termo pesquisado não exista no cache local
  useEffect(() => {
    const q = debouncedSearchQuery.trim();
    if (q.length >= 3 && visibleEvents.length === 0 && !isSearchingExternalApis && externalSearchFailed !== q) {
      const timer = setTimeout(() => {
        handleSearchExternalApis(q);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [debouncedSearchQuery, visibleEvents.length, isSearchingExternalApis, externalSearchFailed, handleSearchExternalApis]);

  // Super Admin oficial e contas autorizadas de administração do FatosBR
  const ADMIN_EMAILS = [
    'astryasuporte@gmail.com',
    'yleaopvpy01@gmail.com',
    'yleaop@gmail.com',
    'yleaopvpyyyy@gmail.com',
    'viniciusfelipedearaujo@gmail.com'
  ];
  const userEffectiveEmail = (currentUser?.email || (() => {
    try {
      const p = localStorage.getItem('sinal_user_profile');
      return p ? JSON.parse(p).email : '';
    } catch {
      return '';
    }
  })() || '').toLowerCase();

  const isSuperAdmin = Boolean(userEffectiveEmail && ADMIN_EMAILS.includes(userEffectiveEmail));
  const SUPER_ADMIN_EMAIL = 'astryasuporte@gmail.com';

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-[#050505] text-zinc-100 flex items-center justify-center p-6">
        <SinalLoading message="Verificando sua sessão..." />
      </div>
    );
  }

  if (currentUser && profileLoadError && currentNav !== 'landing' && currentNav !== 'login') {
    return (
      <div className="min-h-screen bg-[#050505] text-zinc-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#111216] border border-zinc-800 rounded-3xl p-6 sm:p-8 text-center space-y-5 shadow-2xl">
          <div className="flex justify-center">
            <FatosBrLogo size="md" variant="compact" glow={false} />
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-white">Erro ao carregar seu perfil</h2>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              {profileLoadError}
            </p>
          </div>
          <div className="flex flex-col gap-2.5 pt-1">
            <button
              type="button"
              disabled={isRetryingProfile}
              onClick={async () => {
                if (!currentUser) return;
                setIsRetryingProfile(true);
                try {
                  await hydrateAndResolveOnboarding(currentUser, pendingTargetNavRef.current || 'home');
                } finally {
                  setIsRetryingProfile(false);
                }
              }}
              className="w-full min-h-[46px] py-3 px-4 bg-white text-black hover:bg-zinc-200 font-bold text-sm rounded-2xl transition cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isRetryingProfile ? 'animate-spin' : ''}`} />
              <span>{isRetryingProfile ? 'Tentando novamente...' : 'Tentar novamente'}</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const loggedOutId = currentUser?.id;
                setProfileLoadError(null);
                await authService.signOut();
                if (loggedOutId) {
                  notificationService.clearUserCache(loggedOutId);
                  briefingService.clearUserCache(loggedOutId);
                }
                handleUserSession(null);
                setCurrentNav('login');
              }}
              className="w-full min-h-[44px] py-2.5 px-4 bg-transparent border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white font-medium text-xs rounded-2xl transition cursor-pointer"
            >
              Voltar para o login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Renderização de Telas Especiais: Landing Page, Login, Onboarding ou Admin Panel
  if (currentNav === 'landing') {
    return (
      <div className="min-h-screen bg-[#07080b] text-zinc-100 font-sans selection:bg-white selection:text-black">
        <Suspense fallback={<div className="min-h-screen bg-[#07080b] flex items-center justify-center"><SinalLoading message="Carregando FatosBR..." /></div>}>
          <LandingPage
            onStartFreeTrial={() => setCurrentNav('login')}
            onEnterApp={() => setCurrentNav(currentUser ? 'home' : 'login')}
            onOpenAuth={() => setCurrentNav('login')}
            onOpenLegal={handleOpenLegal}
          />
        </Suspense>
        {isLegalModalOpen && (
          <Suspense fallback={null}>
            <LegalCenterModal
              isOpen={isLegalModalOpen}
              onClose={() => setIsLegalModalOpen(false)}
              initialTab={legalModalTab}
            />
          </Suspense>
        )}
      </div>
    );
  }

  if (currentNav === 'login') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#07080b] flex items-center justify-center"><SinalLoading message="Carregando acesso..." /></div>}>
        <LoginPage
          onBackToLanding={() => {
            recoverySessionActiveRef.current = false;
            setProfileLoadError(null);
            setCurrentNav('landing');
          }}
          onRecoveryModeChange={(active) => {
            recoverySessionActiveRef.current = active;
          }}
          onAuthSuccess={async (_email, _name) => {
            recoverySessionActiveRef.current = false;
            setProfileLoadError(null);
            const user = await authService.getCurrentUser();
            if (user) {
              handleUserSession(user);
              await hydrateAndResolveOnboarding(user, 'home');
            }
          }}
        />
      </Suspense>
    );
  }

  if (currentNav === 'onboarding') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#07080b] flex items-center justify-center"><SinalLoading message="Preparando onboarding..." /></div>}>
        <OnboardingFlow
          entities={entities}
          topics={topics}
          sources={sources}
          initialStep={onboardingResumeState?.step || 1}
          initialData={onboardingResumeState?.data}
          onToggleEntity={handleToggleFollowEntity}
          onToggleSource={handleToggleFollowSource}
          onOpenLogin={() => setCurrentNav('login')}
          onSaveProgress={(step, data) => {
            if (currentUser?.id) {
              void userService.saveOnboardingProgress(currentUser.id, step, data);
            }
          }}
          onComplete={async (payload) => {
            if (Array.isArray(payload.themes) && payload.themes.length > 0) {
              setUserInterests(payload.themes);
            }
            if (currentUser?.id) {
              const res = await userService.completeOnboarding(currentUser.id, payload, currentUser.email);
              if (isSupabaseConfigured && !res.persistedInDb) {
                throw new Error(
                  res.error || 'Não foi possível salvar suas preferências no momento. Tente novamente.'
                );
              }
            }
            setOnboardingResumeState(null);
            setCurrentNav('home');
          }}
        />
      </Suspense>
    );
  }

  if (currentNav === 'oauth_consent') {
    return (
      <div className="min-h-screen bg-[#08090b] text-zinc-100 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#0e121a] border border-[#1e273a] rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="flex items-center justify-center">
            <FatosBrLogo size="lg" glow={true} />
          </div>

          <div className="text-center space-y-2">
            <h2 className="text-lg font-bold text-white">Autorização de Acesso (OAuth 2.1)</h2>
            <p className="text-xs text-zinc-400">
              Um aplicativo externo ou integração está solicitando autorização para conectar à sua conta FatosBR.
            </p>
          </div>

          {currentUser ? (
            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-[#080b12] border border-[#162035]">
              <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm font-bold text-white overflow-hidden shrink-0">
                {currentUserAvatar ? (
                  <img
                    src={currentUserAvatar}
                    alt={currentUser.email}
                    width={40}
                    height={40}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{(currentUser.email || 'U').substring(0, 2).toUpperCase()}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-white truncate">
                  {currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0]}
                </div>
                <div className="text-[11px] text-zinc-400 font-mono truncate">{currentUser.email}</div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                Conectado
              </span>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-center text-xs text-zinc-400">
              Você ainda não está autenticado no FatosBR. Faça login para conceder autorização.
            </div>
          )}

          <div className="space-y-2 text-xs">
            <span className="text-[11px] font-mono text-zinc-500 uppercase">Permissões Solicitadas:</span>
            <div className="p-3 rounded-xl bg-black/40 border border-zinc-800 space-y-2 text-zinc-300">
              <div className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-zinc-300" />
                <span>Identificação básica do usuário (e-mail, nome e avatar)</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-zinc-300" />
                <span>Leitura segura do feed de notícias e preferências</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 pt-2">
            {currentUser ? (
              <button
                onClick={() => {
                  const params = new URLSearchParams(window.location.search);
                  const redirectUri = params.get('redirect_uri');
                  const state = params.get('state');
                  if (redirectUri) {
                    try {
                      const url = new URL(redirectUri);
                      url.searchParams.set('code', 'fbr_' + Math.random().toString(36).substring(2, 12));
                      if (state) url.searchParams.set('state', state);
                      window.location.href = url.toString();
                      return;
                    } catch {}
                  }
                  setCurrentNav('home');
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer"
              >
                Autorizar Aplicativo
              </button>
            ) : (
              <button
                onClick={() => setCurrentNav('login')}
                className="w-full py-2.5 px-4 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer"
              >
                Fazer Login no FatosBR
              </button>
            )}

            <button
              onClick={() => {
                window.history.replaceState(null, '', '/');
                setCurrentNav('home');
              }}
              className="w-full py-2.5 px-4 rounded-xl border border-zinc-800 hover:bg-zinc-900 text-zinc-400 hover:text-white text-xs font-semibold transition cursor-pointer"
            >
              Cancelar e Voltar ao Início
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (currentNav === 'admin') {
    // Blindagem de segurança: Apenas o Super Admin tem permissão para carregar o AdminPanel
    if (!isSuperAdmin) {
      // Redirecionamento defensivo caso usuário comum tente forçar estado de admin
      return (
        <div className="min-h-screen bg-[#08090b] text-zinc-100 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md p-6 rounded-2xl bg-[#111216] border border-red-500/30 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto">
              <Shield className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-white">Acesso Restrito ao Super Admin</h2>
            <p className="text-xs text-zinc-400">
              O painel administrativo é estritamente restrito a <span className="font-mono text-zinc-200">{SUPER_ADMIN_EMAIL}</span>. Nenhuma rota pública está exposta.
            </p>
            <button
              onClick={() => setCurrentNav('home')}
              className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer"
            >
              Voltar ao Início
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="animate-view-fade min-h-screen">
        <Suspense fallback={<div className="min-h-screen bg-[#08090b] flex items-center justify-center"><SinalLoading message="Carregando painel administrativo..." /></div>}>
          <AdminPanel
            onBackToApp={() => setCurrentNav('profile')}
            onOpenControl={() => setCurrentNav('control')}
            events={events}
            sources={sources}
            topics={topics}
            entities={entities}
            onAddEvent={(newEvent) => setEvents((prev) => [newEvent, ...prev])}
            onDeleteEvent={(eventId) => setEvents((prev) => prev.filter((e) => e.id !== eventId))}
            onClearEvents={() => setEvents([])}
            onResetEvents={() => loadRealTimeNews(true)}
            onAddSource={(newSource) => setSources((prev) => [newSource, ...prev])}
            onDeleteSource={(sourceId) => setSources((prev) => prev.filter((s) => s.id !== sourceId))}
            onUpdateEntityLogo={(entityId, logoUrl) => {
              setEntities((prev) =>
                prev.map((e) =>
                  e.id === entityId
                    ? {
                        ...e,
                        imageUrl: logoUrl || undefined,
                        logoUrl: logoUrl || undefined,
                        avatarUrl: e.type === 'person' ? logoUrl || undefined : e.avatarUrl
                      }
                    : e
                )
              );
            }}
            onRefreshCatalog={() => refreshCatalogFromSupabase(true)}
            onAddEntity={(newEntity) => {
              setEntities((prev) => [newEntity, ...prev]);
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans selection:bg-white selection:text-black bg-[#08090b] text-zinc-100">
      {/* Banner Global de Conectividade Offline */}
      {(!isOnline || activeStateSimulation === 'offline') && (
        <OfflineBanner
          onDismiss={() => {
            setIsOnline(true);
            if (activeStateSimulation === 'offline') setActiveStateSimulation(null);
          }}
        />
      )}


      {/* Container Principal Desktop / Mobile */}
      <div className="max-w-[1440px] mx-auto min-h-screen flex flex-col md:flex-row overflow-x-hidden w-full">
        
        {/* ================= 1. SIDEBAR DESKTOP (1440px MOCKUP) ================= */}
        <aside className="hidden md:flex flex-col justify-between w-64 lg:w-72 border-r p-6 shrink-0 sticky top-0 h-screen bg-[#08090b] border-[#1a1c22]">
          <div className="space-y-6">
            {/* macOS Window Dots & Logo */}
            <div className="space-y-5">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-zinc-700" />
                <div className="w-3 h-3 rounded-full bg-zinc-600" />
                <div className="w-3 h-3 rounded-full bg-zinc-500" />
              </div>

              {/* Logo: FatosBR */}
              <div
                onClick={() => setCurrentNav('home')}
                className="flex items-center space-x-2.5 cursor-pointer py-1"
                title="FatosBR • Início"
              >
                <FatosBrLogo size="md" variant="compact" glow={false} />
              </div>
            </div>

            {/* BUSCA GLOBAL NA BARRA LATERAL (Pesquisa por palavras-chave em todos os feeds) */}
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-500 group-focus-within:text-white transition-colors pointer-events-none" />
              <input
                type="text"
                placeholder="Pesquisar em todos os feeds..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (currentNav !== 'home' && currentNav !== 'explore') {
                    setCurrentNav('home');
                  }
                }}
                className="w-full bg-[#111216] border border-[#1e2026] focus:border-zinc-500 rounded-xl pl-9 pr-8 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none transition-all shadow-inner"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 p-0.5 text-zinc-500 hover:text-white transition cursor-pointer"
                  title="Limpar pesquisa"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <span className="absolute right-2.5 top-2.5 text-[9px] font-mono text-zinc-600 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 pointer-events-none">
                  ⌘K
                </span>
              )}
            </div>

            {/* Menu Links */}
            <nav className="space-y-1.5 text-sm">
              <button
                onClick={() => setCurrentNav('home')}
                className={`w-full flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                  currentNav === 'home'
                    ? 'bg-[#15171c] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-[#121317]'
                }`}
              >
                <Home className="w-4 h-4" />
                <span>{t('nav.home')}</span>
              </button>

              <button
                onClick={() => setCurrentNav('explore')}
                className={`w-full flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                  currentNav === 'explore'
                    ? 'bg-[#15171c] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-[#121317]'
                }`}
              >
                <Compass className="w-4 h-4" />
                <span>{t('nav.explore')}</span>
              </button>

              <button
                onClick={() => setCurrentNav('following')}
                className={`w-full flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                  currentNav === 'following'
                    ? 'bg-[#15171c] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-[#121317]'
                }`}
              >
                <Bookmark className="w-4 h-4" />
                <span>{t('nav.following')}</span>
              </button>

              <button
                onClick={() => setCurrentNav('notifications')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                  currentNav === 'notifications'
                    ? 'bg-[#15171c] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-[#121317]'
                }`}
              >
                <div className="flex items-center space-x-3.5">
                  <Bell className="w-4 h-4" />
                  <span>{t('nav.notifications')}</span>
                </div>
                {unreadCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-white shadow-sm" />
                )}
              </button>

              <button
                onClick={() => setCurrentNav('saved')}
                className={`w-full flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                  currentNav === 'saved'
                    ? 'bg-[#15171c] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-[#121317]'
                }`}
              >
                <Bookmark className="w-4 h-4" />
                <span>{t('nav.saved')}</span>
              </button>

              <button
                onClick={() => setCurrentNav('history')}
                className={`w-full flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                  currentNav === 'history'
                    ? 'bg-[#15171c] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-[#121317]'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>{t('nav.history')}</span>
              </button>

              <button
                onClick={() => setCurrentNav('briefings')}
                className={`w-full flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                  currentNav === 'briefings'
                    ? 'bg-[#15171c] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-[#121317]'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>{t('nav.briefings')}</span>
              </button>

              <button
                onClick={() => setCurrentNav('control')}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                  currentNav === 'control'
                    ? 'bg-[#15171c] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-[#121317]'
                }`}
                title="Central de Operações do Instagram"
              >
                <div className="flex items-center space-x-3.5">
                  <Instagram className="w-4 h-4 text-zinc-300" />
                  <span>FatosBR Control</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-700">
                  IG
                </span>
              </button>

              <button
                onClick={() => setCurrentNav('landing')}
                className="w-full flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-colors cursor-pointer text-zinc-400 hover:text-white hover:bg-[#121317]"
              >
                <Globe2 className="w-4 h-4 text-zinc-300" />
                <span>{t('nav.landing')}</span>
              </button>

              <button
                onClick={() => setCurrentNav('profile')}
                className={`w-full flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-colors cursor-pointer ${
                  currentNav === 'profile'
                    ? 'bg-[#15171c] text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-[#121317]'
                }`}
              >
                <User className="w-4 h-4" />
                <span>{t('nav.profile')}</span>
              </button>
            </nav>

            {/* Atalhos Rápidos na Sidebar & Seletor de Idioma */}
            <div className="pt-2 border-t border-[#1a1c22] space-y-2">
              <button
                onClick={() => setIsShortcutsModalOpen(true)}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-xl transition text-xs cursor-pointer text-zinc-400 hover:text-white hover:bg-[#121317]"
                title="Atalhos de teclado globais (tecla ?)"
              >
                <div className="flex items-center space-x-2.5">
                  <Command className="w-4 h-4 text-zinc-300" />
                  <span>{t('nav.shortcuts')}</span>
                </div>
                <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300">
                  ?
                </kbd>
              </button>

              <div className="pt-1">
                <LanguageSelector variant="dropdown" />
              </div>
            </div>
          </div>
        </aside>

        {/* ================= 2. CABEÇALHO MOBILE COMPARTILHADO E CONSISTENTE (V2.2) ================= */}
        <header className="md:hidden sticky top-0 z-40 backdrop-blur-md border-b px-4 py-2.5 flex items-center justify-between bg-[#08090b]/95 border-[#1a1c22]">
          {/* Logo Oficial FatosBR (Símbolo + Wordmark) */}
          <div
            onClick={() => {
              setCurrentNav('home');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex items-center cursor-pointer py-1 active:opacity-80 transition"
            title="Voltar ao início"
          >
            <FatosBrLogo size="md" variant="compact" glow={false} />
          </div>

          {/* Botões de Ação no Topo Mobile (Busca Rápida + Notificações em Todas as Abas) */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setIsQuickSearchOpen(true)}
              className="p-2 text-zinc-300 hover:text-white rounded-full transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95"
              title="Buscar acontecimentos, empresas e temas"
              aria-label="Abrir busca"
            >
              <Search className="w-5 h-5" />
            </button>

            <button
              onClick={() => setCurrentNav('notifications')}
              className="relative p-2 text-zinc-300 hover:text-white rounded-full transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95"
              title="Notificações"
              aria-label="Abrir notificações"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-white ring-2 ring-[#08090b]" />
              )}
            </button>
          </div>
        </header>

        {/* ================= 3. ÁREA DE CONTEÚDO PRINCIPAL (COM TRANSIÇÃO SUAVE FRAMER MOTION) ================= */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentNav}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 flex flex-col min-w-0 pb-20 md:pb-0"
          >
        {currentNav === 'control' ? (
          /* ================= FATOSBR CONTROL: OPERAÇÃO DO INSTAGRAM ================= */
          <div className="flex-1 w-full overflow-y-auto">
            <Suspense fallback={<div className="p-6"><FeedSkeleton count={3} /></div>}>
              <FatosBRControlView
                onBackToApp={() => setCurrentNav('home')}
                onOpenCarouselStudio={() => setCurrentNav('admin')}
              />
            </Suspense>
          </div>
        ) : currentNav === 'explore' ? (
          /* ================= EXPLORAR (MOCKUP 01 & 02) ================= */
          <div className="flex-1 w-full px-4 sm:px-8 py-4 sm:py-6 overflow-y-auto">
            {/* Header Desktop do Explorar com Notificação e Avatar */}
            <div className="hidden md:flex items-center justify-end space-x-3 pb-3">
              <button
                onClick={() => setCurrentNav('notifications')}
                className="relative p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-white ring-2 ring-[#111216]" />
                )}
              </button>

              <button
                onClick={() => setCurrentNav('profile')}
                className="w-8 h-8 rounded-full overflow-hidden border border-[#1e2026] hover:border-zinc-500 transition cursor-pointer shrink-0"
              >
                <img
                  src={currentUserAvatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80"}
                  alt="Perfil"
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </button>
            </div>

            <Suspense fallback={<FeedSkeleton count={3} />}>
              <ExploreView
                entities={entities}
                topics={topics}
                sources={sources}
                events={events}
                catalogStatus={catalogStatus}
                onRetryCatalog={() => void refreshCatalogFromSupabase(false, true)}
                onToggleFollowEntity={handleToggleFollowEntity}
                onToggleFollowTopic={handleToggleFollowTopic}
                onToggleFollowSource={handleToggleFollowSource}
                onOpenEntity={(ent) => setActiveEntityModal(ent)}
                onOpenEvent={(ev) => handleOpenEventDetail(ev)}
              />
            </Suspense>
          </div>
        ) : currentNav === 'following' ? (
          /* ================= SEGUINDO (MOCKUP 01 & 02) ================= */
          <div className="flex-1 w-full px-4 sm:px-8 py-4 sm:py-6 overflow-y-auto">
            {/* Header Desktop do Seguindo com Notificação e Avatar */}
            <div className="hidden md:flex items-center justify-end space-x-3 pb-3">
              <button
                onClick={() => setCurrentNav('notifications')}
                className="relative p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-white ring-2 ring-[#111216]" />
                )}
              </button>

              <button
                onClick={() => setCurrentNav('profile')}
                className="w-8 h-8 rounded-full overflow-hidden border border-[#1e2026] hover:border-zinc-500 transition cursor-pointer shrink-0"
              >
                <img
                  src={currentUserAvatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80"}
                  alt="Perfil"
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </button>
            </div>

            <Suspense fallback={<FeedSkeleton count={3} />}>
              <FollowingView
                entities={entities}
                topics={topics}
                sources={sources}
                catalogStatus={catalogStatus}
                onRetryCatalog={() => void refreshCatalogFromSupabase(false, true)}
                onToggleFollowEntity={handleToggleFollowEntity}
                onToggleFollowTopic={handleToggleFollowTopic}
                onToggleFollowSource={handleToggleFollowSource}
                onOpenEntity={(ent) => setActiveEntityModal(ent)}
                onNavigateExplore={() => setCurrentNav('explore')}
              />
            </Suspense>
          </div>
        ) : currentNav === 'notifications' ? (
          /* ================= NOTIFICAÇÕES (MOCKUP 01 & 02) ================= */
          <div className="flex-1 w-full px-2 sm:px-6 py-4 sm:py-6 overflow-y-auto">
            {/* Header Desktop de Notificações com Notificação e Avatar */}
            <div className="hidden md:flex items-center justify-end space-x-3 pb-3">
              <button
                onClick={() => setCurrentNav('notifications')}
                className="relative p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-white transition cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-white ring-2 ring-[#111216]" />
                )}
              </button>

              <button
                onClick={() => setCurrentNav('profile')}
                className="w-8 h-8 rounded-full overflow-hidden border border-[#1e2026] hover:border-zinc-500 transition cursor-pointer shrink-0"
              >
                <img
                  src={currentUserAvatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80"}
                  alt="Perfil"
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </button>
            </div>

            <Suspense fallback={<FeedSkeleton count={3} />}>
              <NotificationsView
                events={events}
                entities={entities}
                currentUser={currentUser}
                onOpenEvent={(ev) => handleOpenEventDetail(ev)}
                onOpenEntity={(ent) => setActiveEntityModal(ent)}
                onOpenBriefing={(briefingId) => {
                  setPendingBriefingId(briefingId || null);
                  setCurrentNav('briefings');
                }}
                onRequireAuth={() => setIsAuthModalOpen(true)}
                onBack={() => setCurrentNav('home')}
              />
            </Suspense>
          </div>
        ) : currentNav === 'saved' || currentNav === 'history' ? (
          /* ================= SALVOS & HISTÓRICO (MOCKUP 01 & 02) ================= */
          <div className="flex-1 w-full px-2 sm:px-6 py-4 sm:py-6 overflow-y-auto">
            <Suspense fallback={<FeedSkeleton count={3} />}>
              <SavedHistoryView
                initialTab={currentNav === 'history' ? 'history' : 'saved'}
                events={events}
                historyItems={historyItems}
                onOpenEvent={handleOpenEventDetail}
                onToggleSaveEvent={handleToggleSave}
                onRemoveFromHistory={handleRemoveFromHistory}
                onClearHistory={handleClearHistory}
                onNavigateExplore={() => setCurrentNav('explore')}
                onNavigateHome={() => setCurrentNav('home')}
                onHideEvent={(id) => setHiddenEventIds((prev) => new Set(prev).add(id))}
                unreadCount={unreadCount}
                onNavigateNotifications={() => setCurrentNav('notifications')}
                onNavigateProfile={() => setCurrentNav('profile')}
                onTabChange={(tab) => setCurrentNav(tab)}
              />
            </Suspense>
          </div>
        ) : currentNav === 'briefings' ? (
          /* ================= BRIEFINGS (MOCKUP 01 & 02) ================= */
          <div className="flex-1 w-full px-2 sm:px-6 py-4 sm:py-6 overflow-y-auto">
            {/* Header Desktop de Briefings com Notificação e Avatar */}
            <div className="hidden md:flex items-center justify-end space-x-3 pb-3">
              <button
                onClick={() => setCurrentNav('notifications')}
                className="relative p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-white ring-2 ring-[#111216]" />
                )}
              </button>

              <button
                onClick={() => setCurrentNav('profile')}
                className="w-8 h-8 rounded-full overflow-hidden border border-[#1e2026] hover:border-zinc-500 transition cursor-pointer shrink-0"
              >
                <img
                  src={currentUserAvatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80"}
                  alt="Perfil"
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </button>
            </div>

            <Suspense fallback={<FeedSkeleton count={3} />}>
              <BriefingView
                events={events}
                subscription={subscription}
                currentUser={currentUser}
                initialBriefingId={pendingBriefingId}
                onClearInitialBriefing={() => setPendingBriefingId(null)}
                onOpenEventDetail={(ev) => handleOpenEventDetail(ev)}
                onOpenBilling={() => setIsBillingModalOpen(true)}
                onRequireAuth={() => setIsAuthModalOpen(true)}
                isSuperAdmin={isSuperAdmin}
              />
            </Suspense>
          </div>
        ) : currentNav === 'profile' ? (
          /* ================= PERFIL & PREFERÊNCIAS (MOCKUP 01 & 02) ================= */
          <div className="flex-1 w-full px-2 sm:px-6 py-4 sm:py-6 overflow-y-auto">
            {/* Header Desktop de Perfil com Notificação e Avatar */}
            <div className="hidden md:flex items-center justify-end space-x-3 pb-3">
              <button
                onClick={() => setCurrentNav('notifications')}
                className="relative p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-white ring-2 ring-[#111216]" />
                )}
              </button>

              <button
                onClick={() => setCurrentNav('profile')}
                className="w-8 h-8 rounded-full overflow-hidden border border-white transition cursor-pointer shrink-0"
              >
                <img
                  src={currentUserAvatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80"}
                  alt="Perfil"
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </button>
            </div>

            <Suspense fallback={<FeedSkeleton count={3} />}>
              <ProfileView
                currentUser={currentUser}
                entities={entities}
                topics={topics}
                sources={sources}
                subscription={subscription}
                savedCount={events.filter((e) => e.isSaved).length}
                onNavigateFollowing={(tab) => {
                  setCurrentNav('following');
                }}
                onNavigateSaved={() => setCurrentNav('saved')}
                onOpenBilling={() => setIsBillingModalOpen(true)}
                onOpenLanding={() => setCurrentNav('landing')}
                onOpenAuth={() => setCurrentNav('login')}
                onOpenAdmin={() => setCurrentNav('admin')}
                onOpenOnboarding={() => setIsRecalibrateModalOpen(true)}
                isSuperAdmin={isSuperAdmin}
                onOpenLegal={handleOpenLegal}
                onProfileUpdated={(updated) => setCurrentUserAvatar(updated.avatarUrl)}
                onClearCacheAndSync={async () => {
                  rateLimitService.clearCache();
                  await loadRealTimeNews(true);
                }}
                onLogout={async () => {
                  const loggedOutId = currentUser?.id;
                  await authService.signOut();
                  if (loggedOutId) {
                    notificationService.clearUserCache(loggedOutId);
                    briefingService.clearUserCache(loggedOutId);
                    try {
                      localStorage.removeItem(`fatosbr_briefing_prefs_${loggedOutId}`);
                    } catch {}
                  }
                  handleUserSession(null);
                  setCurrentNav('landing');
                  if (typeof window !== 'undefined') {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    window.history.replaceState(null, '', '/');
                  }
                }}
              />
            </Suspense>
          </div>
        ) : (
          /* ================= HOME / FEED PRINCIPAL ================= */
          <div className="flex-1 flex flex-col lg:flex-row w-full">
            <main className="flex-1 max-w-2xl w-full mx-auto px-3.5 sm:px-6 pt-3 pb-36 sm:pb-36 md:pb-12 space-y-4 overflow-x-hidden">
              
              {/* Desktop Search & Top Actions */}
              <div className="hidden md:flex items-center justify-between gap-4 pb-1">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3.5 top-3 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Buscar no FatosBR..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[#111216] border border-[#1e2026] rounded-xl pl-10 pr-12 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-700"
                  />
                  <span className="absolute right-3.5 top-3 text-[10px] font-mono text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                    ⌘ K
                  </span>
                </div>

                <div className="flex items-center space-x-3 shrink-0">
                  <button
                    onClick={() => setCurrentNav('notifications')}
                    className="relative p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer"
                  >
                    <Bell className="w-4 h-4" />
                    {unreadCount > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-white ring-2 ring-[#111216]" />
                    )}
                  </button>

                  <button
                    onClick={() => setCurrentNav('profile')}
                    className="w-8 h-8 rounded-full overflow-hidden border border-[#1e2026] hover:border-zinc-500 transition cursor-pointer shrink-0"
                  >
                    <img
                      src={currentUserAvatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80"}
                      alt="Perfil"
                      width={32}
                      height={32}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  </button>
                </div>
              </div>

              {/* Linha Principal Unificada: Subtabs amplas ("Para você", "Seguindo", "Em alta") + 3 Barrinhas à Direita */}
              <div className="flex items-center justify-between gap-2 pb-1 pt-0.5 w-full">
                <div className="flex items-center gap-2 sm:gap-2.5">
                  {[
                    { id: 'for-you', label: t('feed.forYou') },
                    { id: 'following', label: t('feed.following') },
                    { id: 'trending', label: t('feed.trending') }
                  ].map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <motion.button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        whileTap={{ scale: 0.96 }}
                        className={`relative px-4 sm:px-5 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-colors duration-150 cursor-pointer min-h-[42px] flex items-center justify-center ${
                          isActive
                            ? 'text-black font-bold'
                            : 'text-zinc-400 hover:text-white bg-[#111216] border border-[#1e2026] hover:border-zinc-700'
                        }`}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="activeFeedSubtabIndicator"
                            className="absolute inset-0 bg-white rounded-full shadow-sm z-0"
                            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                          />
                        )}
                        <span className="relative z-10 select-none">{tab.label}</span>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Botão das 3 Barrinhas (Temas / Gêneros) posicionado no local exato do X indicado pelo usuário */}
                <button
                  onClick={() => setIsThemeDrawerOpen(true)}
                  className="relative p-2.5 rounded-full bg-[#111216] hover:bg-zinc-800 border border-[#1e2026] hover:border-zinc-700 text-white transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 active:scale-95"
                  title="Selecionar temas e gêneros de notícias"
                  aria-label="Abrir seleção de temas"
                >
                  <Menu className="w-5 h-5 text-white" />
                  {homeCategoryFilter !== 'all' && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-white ring-2 ring-[#08090b]" />
                  )}
                </button>
              </div>

              {/* Banner de separação entre idioma da interface e idioma original das notícias */}
              {language !== 'pt-BR' && (
                <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300">
                  <Globe2 className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                  <span>{t('common.newsNotice')}</span>
                </div>
              )}

              {/* Feed Refreshing Bar */}
              {isFeedRefreshing && (
                <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden my-1.5 border border-zinc-800/50">
                  <div className="h-full bg-gradient-to-r from-transparent via-white to-transparent w-2/5 rounded-full animate-indeterminate" />
                </div>
              )}

              {/* Floating Pill: Novos Acontecimentos */}
              {hasNewEventsBanner && (
                <div className="flex justify-center pt-1 pb-1">
                  <button
                    onClick={handleRefreshTop}
                    className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white text-black text-xs font-bold shadow-xl hover:bg-zinc-200 transition-all cursor-pointer animate-fade-in"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                    <span>3 novos acontecimentos</span>
                  </button>
                </div>
              )}

              {/* SKELETON LOADING STATE */}
              {isLoading && (
                <FeedSkeleton count={3} />
              )}

              {/* ERROR STATE */}
              {hasError && (
                <ErrorState
                  onRetry={() => {
                    setHasError(false);
                    setIsLoading(true);
                    setTimeout(() => setIsLoading(false), 800);
                  }}
                  onHome={() => {
                    setHasError(false);
                    setSearchQuery('');
                  }}
                />
              )}

              {/* SIMULATED GENERAL STATE OVERRIDE */}
              {activeStateSimulation && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#14151a] border border-[#22242c] text-xs">
                    <span className="font-mono text-zinc-300">
                      Visualizando Estado: <strong>{activeStateSimulation.toUpperCase()}</strong>
                    </span>
                    <button
                      onClick={() => setActiveStateSimulation(null)}
                      className="text-xs font-semibold text-zinc-400 hover:text-white underline cursor-pointer"
                    >
                      Restaurar visualização normal
                    </button>
                  </div>
                  {activeStateSimulation === 'loading' && <SinalLoading />}
                  {activeStateSimulation === 'skeletons' && <FeedSkeleton count={3} />}
                  {activeStateSimulation === 'empty_feed' && (
                    <EmptyFeedState onExplore={() => { setActiveStateSimulation(null); setCurrentNav('explore'); }} />
                  )}
                  {activeStateSimulation === 'empty_saved' && (
                    <EmptySavedState onExplore={() => { setActiveStateSimulation(null); setCurrentNav('explore'); }} />
                  )}
                  {activeStateSimulation === 'empty_history' && (
                    <EmptyHistoryState onHome={() => setActiveStateSimulation(null)} />
                  )}
                  {activeStateSimulation === 'empty_following' && (
                    <EmptyFollowingState onExplore={() => { setActiveStateSimulation(null); setCurrentNav('explore'); }} />
                  )}
                  {activeStateSimulation === 'empty_notifications' && (
                    <EmptyNotificationsState />
                  )}
                  {activeStateSimulation === 'no_results' && (
                    <NoResultsState
                      query="computação quântica"
                      onClear={() => setActiveStateSimulation(null)}
                      onExplore={() => { setActiveStateSimulation(null); setCurrentNav('explore'); }}
                    />
                  )}
                  {activeStateSimulation === 'error' && (
                    <ErrorState
                      onRetry={() => setActiveStateSimulation(null)}
                      onHome={() => setActiveStateSimulation(null)}
                    />
                  )}
                  {activeStateSimulation === 'offline' && (
                    <OfflineState
                      onCheckConnection={() => setActiveStateSimulation(null)}
                      onViewSaved={() => { setActiveStateSimulation(null); setCurrentNav('saved'); }}
                    />
                  )}
                  {activeStateSimulation === 'paywall' && (
                    <PaywallState
                      onUpgrade={() => {
                        setActiveStateSimulation(null);
                        setIsBillingModalOpen(true);
                      }}
                      onBack={() => setActiveStateSimulation(null)}
                    />
                  )}
                  {activeStateSimulation === 'not_found' && (
                    <NotFoundState onHome={() => setActiveStateSimulation(null)} />
                  )}
                  {activeStateSimulation === 'unauthorized' && (
                    <UnauthorizedState
                      onLogin={() => setActiveStateSimulation(null)}
                      onHome={() => setActiveStateSimulation(null)}
                    />
                  )}
                  {activeStateSimulation === 'forbidden' && (
                    <ForbiddenState onBack={() => setActiveStateSimulation(null)} />
                  )}
                  {activeStateSimulation === 'session_expired' && (
                    <SessionExpiredState onReconnect={() => setActiveStateSimulation(null)} />
                  )}
                  {activeStateSimulation === 'maintenance' && (
                    <MaintenanceState onCheckStatus={() => setActiveStateSimulation(null)} />
                  )}
                </div>
              )}

              {/* TIMELINE DE ACONTECIMENTOS COM TRANSIÇÕES SUAVES FRAMER MOTION */}
              {!isLoading && !hasError && !activeStateSimulation && (
                <AnimatePresence mode="wait">
                  {visibleEvents.length > 0 ? (
                    <motion.div
                      key={`feed-tab-${activeTab}-${homeCategoryFilter}-${searchQuery}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="space-y-4"
                    >
                      {/* Carrossel Superior de Manchetes em Destaque (movendo-as para fora do feed vertical) */}
                      {topFeaturedEvents.length > 0 && (
                        <FeaturedTopCarousel
                          events={topFeaturedEvents}
                          onOpenDetail={(ev) => handleOpenEventDetail(ev)}
                          onToggleSave={handleToggleSave}
                        />
                      )}

                      <div className="space-y-4">
                        {renderedFeedEvents.map((event, index) => (
                          <div
                            key={`${event.id}-${activeTab}-${homeCategoryFilter}`}
                            className={index >= 4 ? '[content-visibility:auto] [contain-intrinsic-size:auto_280px]' : undefined}
                          >
                            <EventCard
                              event={event}
                              index={index}
                              onOpenDetail={handleOpenEventDetail}
                              onToggleSave={handleToggleSave}
                              onHideEvent={handleHideEvent}
                              onOpenEntity={setActiveEntityModal}
                            />
                          </div>
                        ))}
                        {visibleFeedLimit < verticalFeedEvents.length && (
                          <div ref={feedLoadMoreRef} className="pt-2 flex justify-center">
                            <button
                              type="button"
                              onClick={() => setVisibleFeedLimit((prev) => Math.min(prev + 12, verticalFeedEvents.length))}
                              className="px-4 py-2 rounded-xl border border-zinc-800 bg-[#111216] hover:bg-zinc-900 text-xs font-semibold text-zinc-300 hover:text-white transition cursor-pointer"
                            >
                              Carregar mais acontecimentos ({verticalFeedEvents.length - visibleFeedLimit} restantes)
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Status em Tempo Real & Botão de Atualização com Rate Limit (5/5) ao final das matérias */}
                      <div className="pt-8 pb-24 sm:pb-12 flex flex-col items-center justify-center gap-2.5 text-center">
                        <button
                          onClick={() => loadRealTimeNews(true)}
                          disabled={isFeedRefreshing || isLoading}
                          className={`inline-flex items-center gap-2.5 px-5 py-3 rounded-2xl border text-xs sm:text-sm font-semibold transition cursor-pointer disabled:opacity-60 shadow-lg ${
                            dailyRefreshRemaining === 0
                              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                              : 'bg-[#111215] hover:bg-[#181a20] border-[#1e2026] hover:border-zinc-700 text-zinc-200 hover:text-white'
                          }`}
                          title={`Atualizar feed de notícias (${dailyRefreshRemaining} de 5 atualizações restantes hoje)`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                          <span className="font-mono">
                            {lastSyncTime ? `Ao vivo (${lastSyncTime})` : 'Ao vivo'}
                          </span>
                          <span
                            className={`text-xs font-mono px-2 py-0.5 rounded-lg ${
                              dailyRefreshRemaining === 0
                                ? 'bg-zinc-800 text-zinc-300 font-bold'
                                : 'bg-zinc-800 text-zinc-300'
                            }`}
                          >
                            {dailyRefreshRemaining}/5
                          </span>
                          <RefreshCw
                            className={`w-4 h-4 ${
                              isFeedRefreshing ? 'animate-spin text-white' : 'text-zinc-400'
                            }`}
                          />
                          <span>Atualizar feed de notícias</span>
                        </button>
                        <p className="text-[11px] text-zinc-500 font-mono">
                          {dailyRefreshRemaining} de 5 atualizações manuais restantes hoje
                        </p>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key={`empty-${activeTab}-${searchQuery}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                    >
                      {searchQuery.trim().length > 0 ? (
                        isSearchingExternalApis ? (
                          <div className="p-8 rounded-2xl bg-[#0e1117] border border-[#1e2330] text-center space-y-3 animate-fade-in my-6">
                            <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 text-white flex items-center justify-center mx-auto">
                              <RefreshCw className="w-5 h-5 animate-spin text-white" />
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-white">
                                Buscando nas APIs Integradas (GNews & World News API)...
                              </h3>
                              <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
                                O termo &quot;{searchQuery}&quot; não estava no cache local de eventos. Realizando requisição em tempo real às agências e provedores de notícias...
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <NoResultsState
                              query={searchQuery}
                              onClear={() => {
                                setSearchQuery('');
                                setExternalSearchFailed(null);
                              }}
                              onExplore={() => {
                                setSearchQuery('');
                                setExternalSearchFailed(null);
                                setCurrentNav('explore');
                              }}
                            />
                            <div className="p-4 rounded-xl bg-[#0f121a] border border-[#1b2233] text-center space-y-2 text-xs">
                              <p className="text-zinc-400">
                                Não encontrou o que procurava no cache local?
                              </p>
                              <button
                                onClick={() => handleSearchExternalApis(searchQuery)}
                                disabled={isSearchingExternalApis}
                                className="px-4 py-2 rounded-xl bg-[#2378D4] hover:bg-[#1e6ac0] text-white text-xs font-bold cursor-pointer transition shadow-md flex items-center justify-center gap-2 mx-auto disabled:opacity-50"
                              >
                                <Search className="w-3.5 h-3.5" />
                                <span>Buscar &quot;{searchQuery}&quot; nas APIs de Notícias</span>
                              </button>
                            </div>
                          </div>
                        )
                      ) : activeTab === 'following' ? (
                        <EmptyFollowingState onExplore={() => setCurrentNav('explore')} />
                      ) : activeTab === 'for-you' ? (
                        <div className="p-8 rounded-2xl bg-[#0e1015] border border-zinc-800/80 text-center space-y-4 my-6">
                          <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 flex items-center justify-center mx-auto">
                            <Sparkles className="w-6 h-6 text-zinc-300" />
                          </div>
                          <div className="space-y-1.5 max-w-md mx-auto">
                            <h3 className="text-sm font-bold text-white">
                              Nenhuma notícia recente para as categorias selecionadas
                            </h3>
                            <p className="text-xs text-zinc-400 leading-relaxed">
                              Seu feed está filtrado estritamente por:{' '}
                              <strong className="text-zinc-200">
                                {userInterests.map((id) => THEME_LABEL_MAP[id] || id).join(', ')}
                              </strong>.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                            <button
                              onClick={() => setIsRecalibrateModalOpen(true)}
                              className="px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-zinc-200 transition cursor-pointer"
                            >
                              Recalibrar categorias
                            </button>
                            <button
                              onClick={() => setActiveTab('trending')}
                              className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-xs font-semibold transition cursor-pointer"
                            >
                              Ver em alta
                            </button>
                          </div>
                        </div>
                      ) : (
                        <EmptyFeedState onExplore={() => setCurrentNav('explore')} />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </main>

            {/* Coluna Direita Desktop (Home) */}
            <aside className="hidden lg:block w-72 xl:w-80 border-l border-[#1a1c22] p-6 shrink-0 sticky top-0 h-screen overflow-y-auto space-y-7">
              <div className="space-y-3.5">
                <h3 className="text-xs font-bold text-white tracking-wide">
                  Em destaque
                </h3>
                <div className="space-y-2.5">
                  {HIGHLIGHTED_ENTITIES.map((ent) => (
                    <div
                      key={ent.id}
                      onClick={() => {
                        const found = entities.find((e) => e.name.toLowerCase() === ent.name.toLowerCase());
                        if (found) setActiveEntityModal(found);
                      }}
                      className="flex items-center justify-between p-2.5 rounded-xl hover:bg-[#121418] transition cursor-pointer group"
                    >
                      <div className="flex items-center space-x-3">
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-sm"
                          style={{ backgroundColor: ent.iconColor }}
                        >
                          {ent.name.charAt(0)}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-white group-hover:text-zinc-200">
                            {ent.name}
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            +{ent.eventsToday} eventos hoje
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3.5 pt-2 border-t border-[#1a1c22]">
                <h3 className="text-xs font-bold text-white tracking-wide">
                  Assuntos em alta
                </h3>
                <div className="space-y-2">
                  {TRENDING_SUBJECTS.map((item) => (
                    <div
                      key={item.rank}
                      onClick={() => setSearchQuery(item.name)}
                      className="flex items-center space-x-3.5 py-1.5 px-2 rounded-lg hover:bg-[#121418] transition cursor-pointer text-xs group"
                    >
                      <span className="font-mono text-zinc-400 w-4">{item.rank}</span>
                      <span className="font-medium text-zinc-300 group-hover:text-white">
                        {item.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rodapé Jurídico & Compliance (LGPD, Marco Civil, CDC) */}
              <div className="pt-4 border-t border-[#1a1c22] space-y-2 text-[11px] text-zinc-500">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    onClick={() => handleOpenLegal('terms')}
                    className="hover:text-zinc-300 transition cursor-pointer"
                  >
                    Termos de Uso
                  </button>
                  <span>•</span>
                  <button
                    onClick={() => handleOpenLegal('lgpd')}
                    className="hover:text-white transition cursor-pointer text-zinc-400"
                  >
                    Privacidade & LGPD
                  </button>
                  <span>•</span>
                  <button
                    onClick={() => handleOpenLegal('cdc')}
                    className="hover:text-white transition cursor-pointer text-zinc-400"
                  >
                    CDC & Pix
                  </button>
                  <span>•</span>
                  <button
                    onClick={() => handleOpenLegal('dpo')}
                    className="hover:text-white transition cursor-pointer text-zinc-400"
                  >
                    Canal DPO
                  </button>
                </div>
                <div className="text-[10px] text-zinc-600 leading-tight">
                  © 2026 FatosBR • Em conformidade com a Legislação Federal Brasileira (ctresb/leis).
                </div>
              </div>

            </aside>
          </div>
        )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ================= 5. BOTTOM NAVIGATION MOBILE (TOUCH TARGETS >= 44PX COM BRIEFINGS) ================= */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 backdrop-blur-lg border-t px-1.5 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] flex items-center justify-around shadow-2xl bg-[#08090b]/98 border-[#1a1c22]">
        <button
          onClick={() => setCurrentNav('home')}
          className={`min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'home'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label={t('nav.home')}
        >
          <Home className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          <span>{t('nav.home')}</span>
        </button>

        <button
          onClick={() => setCurrentNav('explore')}
          className={`min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'explore'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label={t('nav.explore')}
        >
          <Compass className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          <span>{t('nav.explore')}</span>
        </button>

        <button
          onClick={() => setCurrentNav('following')}
          className={`min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'following'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label={t('nav.following')}
        >
          <Bookmark className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          <span>{t('nav.following')}</span>
        </button>

        <button
          onClick={() => setCurrentNav('briefings')}
          className={`min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'briefings'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label={t('nav.briefings')}
        >
          <FileText className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          <span>{t('nav.briefings')}</span>
        </button>

        <button
          onClick={() => setCurrentNav('notifications')}
          className={`relative min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'notifications'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label={t('nav.notifications')}
        >
          <Bell className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          {unreadCount > 0 && (
            <span className="absolute top-2 right-2.5 w-2 h-2 rounded-full bg-white ring-2 ring-[#08090b]" />
          )}
          <span>{t('nav.notifications')}</span>
        </button>

        <button
          onClick={() => setCurrentNav('profile')}
          className={`min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'profile'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label={t('nav.profile')}
        >
          <User className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          <span>{t('nav.profile')}</span>
        </button>
      </nav>

      {/* ================= 6. MODAIS CENTRAIS COM TRANSIÇÕES SPRING E LAZY SUSPENSE ================= */}
      <AnimatePresence mode="wait">
        {activeEventModal && (
          <Suspense fallback={<EventDetailSkeleton />}>
            <EventDetailModal
              key={`event-modal-${activeEventModal.id}`}
              event={activeEventModal}
              onClose={() => setActiveEventModal(null)}
              onToggleSave={handleToggleSave}
            />
          </Suspense>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {activeEntityModal && (
          <Suspense fallback={null}>
            <EntityDetailModal
              key={`entity-modal-${activeEntityModal.id}`}
              entity={activeEntityModal}
              onClose={() => setActiveEntityModal(null)}
              allEvents={events}
              onOpenEventDetail={(ev) => setActiveEventModal(ev)}
              onToggleSaveEvent={handleToggleSave}
              onToggleFollow={handleToggleFollowEntity}
            />
          </Suspense>
        )}
      </AnimatePresence>

      {isAuthModalOpen && (
        <Suspense fallback={null}>
          <AuthModal
            isOpen={isAuthModalOpen}
            onClose={() => {
              recoverySessionActiveRef.current = false;
              setIsAuthModalOpen(false);
            }}
            onRecoveryModeChange={(active) => {
              recoverySessionActiveRef.current = active;
            }}
            onAuthSuccess={async () => {
              recoverySessionActiveRef.current = false;
              setIsAuthModalOpen(false);
              const user = await authService.getCurrentUser();
              if (user) {
                handleUserSession(user);
                await hydrateAndResolveOnboarding(user, 'home');
              }
            }}
          />
        </Suspense>
      )}

      {/* ================= 7. CATÁLOGO DE ESTADOS GERAIS DO SISTEMA ================= */}
      <GeneralStatesShowcaseModal
        isOpen={isStatesShowcaseOpen}
        onClose={() => setIsStatesShowcaseOpen(false)}
        onSelectState={(state) => {
          setActiveStateSimulation(state);
          setIsStatesShowcaseOpen(false);
          setCurrentNav('home');
        }}
      />

      {/* ================= 8. ONBOARDING & CALIBRAGEM INICIAL DO FEED ================= */}
      {isOnboardingOpen && (
        <Suspense fallback={null}>
          <OnboardingModal
            isOpen={isOnboardingOpen}
            onClose={() => {
              setIsOnboardingOpen(false);
            }}
            entities={entities}
            topics={topics}
            sources={sources}
            onToggleEntity={handleToggleFollowEntity}
            onToggleTopic={handleToggleFollowTopic}
            onToggleSource={handleToggleFollowSource}
            onComplete={async () => {
              if (currentUser?.id) {
                await userService.completeOnboarding(
                  currentUser.id,
                  {
                    themes: userInterests,
                    followedEntityIds: entities.filter((e) => e.isFollowed).map((e) => e.id),
                    followedTopicIds: topics.filter((t) => t.isFollowed).map((t) => t.id),
                    followedSourceIds: sources.filter((s) => s.isFollowed).map((s) => s.id),
                  },
                  currentUser.email
                );
              }
              setIsOnboardingOpen(false);
              setCurrentNav('home');
            }}
          />
        </Suspense>
      )}

      {isShortcutsModalOpen && (
        <Suspense fallback={null}>
          <KeyboardShortcutsModal
            isOpen={isShortcutsModalOpen}
            onClose={() => setIsShortcutsModalOpen(false)}
          />
        </Suspense>
      )}

      {/* ================= 8.1 MODAL DE BUSCA RÁPIDA UNIFICADA (V2.2) ================= */}
      {isQuickSearchOpen && (
        <Suspense fallback={null}>
          <QuickSearchModal
            isOpen={isQuickSearchOpen}
            onClose={() => setIsQuickSearchOpen(false)}
            events={events}
            entities={entities}
            onSelectEvent={(ev) => setActiveEventModal(ev)}
            onSelectEntity={(ent) => setActiveEntityModal(ent)}
            onSelectCategory={(cat) => {
              setHomeCategoryFilter(cat.toLowerCase());
              setCurrentNav('home');
            }}
          />
        </Suspense>
      )}

      {/* ================= 9.1 MODAL DE RECALIBRAÇÃO DE INTERESSES DO LEITOR ================= */}
      {isRecalibrateModalOpen && (
        <Suspense fallback={null}>
          <RecalibrateInterestsModal
            isOpen={isRecalibrateModalOpen}
            currentInterests={userInterests}
            onClose={() => setIsRecalibrateModalOpen(false)}
            onSave={(newInterests) => {
              setUserInterests(newInterests);
              if (currentUser?.id) {
                void userService.updateUserInterests(currentUser.id, newInterests);
              }
            }}
            onFullOnboarding={() => {
              setIsRecalibrateModalOpen(false);
              setOnboardingResumeState({
                step: 2,
                data: {
                  themes: userInterests,
                  followedEntityIds: entities.filter((e) => e.isFollowed).map((e) => e.id),
                  followedSourceIds: sources.filter((s) => s.isFollowed).map((s) => s.id),
                },
              });
              setCurrentNav('onboarding');
            }}
          />
        </Suspense>
      )}

      {/* ================= 10. TOAST FLUTUANTE DE RATE LIMIT & ERRO OTIMISTA ================= */}
      {rateLimitToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-300 shadow-2xl backdrop-blur-md flex items-start space-x-3 animate-fadeIn">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs flex-1 space-y-0.5">
            <div className="font-bold">Limite de Atualizações Diárias</div>
            <div className="text-amber-200/90">{rateLimitToast}</div>
          </div>
          <button onClick={() => setRateLimitToast(null)} className="text-zinc-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionErrorToast && (
        <div className="fixed bottom-24 md:bottom-6 right-4 z-50 max-w-sm p-3.5 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-200 shadow-2xl backdrop-blur-md flex items-center space-x-3 animate-fadeIn">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-xs flex-1">{actionErrorToast}</span>
          <button onClick={() => setActionErrorToast(null)} className="text-zinc-400 hover:text-white p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ================= 11. INDICADOR VISUAL DO ATALHO G ================= */}
      {pendingGSequence && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-zinc-900/95 border border-zinc-700 text-white text-xs font-medium shadow-2xl backdrop-blur-md flex items-center space-x-2 animate-pulse">
          <Command className="w-3.5 h-3.5 text-zinc-300" />
          <span>Atalho G +: <strong>H</strong> Início · <strong>E</strong> Explorar · <strong>F</strong> Seguindo · <strong>B</strong> Briefings · <strong>N</strong> Notif. · <strong>P</strong> Perfil</span>
        </div>
      )}

      {/* ================= 12. CENTRAL DE CONFORMIDADE LEGAL & BANNER LGPD ================= */}
      {isLegalModalOpen && (
        <Suspense fallback={null}>
          <LegalCenterModal
            isOpen={isLegalModalOpen}
            onClose={() => setIsLegalModalOpen(false)}
            initialTab={legalModalTab}
          />
        </Suspense>
      )}

      <CookieConsentBanner
        onOpenLegal={handleOpenLegal}
      />

      {/* ================= 13. GAVETA LATERAL MINIMALISTA DE TEMAS (3 BARRINHAS) ================= */}
      <AnimatePresence>
        {isThemeDrawerOpen && (
          <div className="fixed inset-0 z-50 flex">
            {/* Backdrop escurecido */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsThemeDrawerOpen(false)}
              className="fixed inset-0 bg-black/85 backdrop-blur-sm cursor-pointer"
            />

            {/* Painel lateral deslizante em preto e branco */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="relative w-full max-w-xs sm:max-w-sm h-full bg-[#000000] border-r border-zinc-800 flex flex-col z-10 shadow-2xl overflow-hidden"
            >
              {/* Topo da Gaveta */}
              <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white">
                    <SlidersHorizontal className="w-4 h-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-white tracking-tight">Filtrar por Tema</h3>
                    <p className="text-[11px] text-zinc-400">Selecione a cobertura editorial</p>
                  </div>
                </div>

                <button
                  onClick={() => setIsThemeDrawerOpen(false)}
                  className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-900 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label="Fechar gaveta de temas"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Lista de Temas com Touch Target >= 48px para Samsung Galaxy A35 */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1.5 no-scrollbar">
                {AVAILABLE_THEMES.map((theme) => {
                  const isSelected = homeCategoryFilter === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => {
                        setHomeCategoryFilter(theme.id);
                        setIsThemeDrawerOpen(false);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className={`w-full min-h-[48px] px-4 py-3 rounded-xl text-left text-xs sm:text-sm font-medium flex items-center justify-between transition cursor-pointer active:scale-[0.98] ${
                        isSelected
                          ? 'bg-white text-black font-bold shadow-md'
                          : 'text-zinc-300 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800'
                      }`}
                    >
                      <span>{theme.label}</span>
                      {isSelected ? (
                        <Check className="w-4 h-4 text-black shrink-0" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Opção para personalizar os gêneros do feed "Para você" */}
              <div className="px-3 sm:px-4 py-2 border-t border-zinc-800/80 bg-zinc-950/60">
                <button
                  onClick={() => {
                    setIsThemeDrawerOpen(false);
                    setIsRecalibrateModalOpen(true);
                  }}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-white flex items-center justify-between transition cursor-pointer active:scale-[0.98]"
                >
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Personalizar meus gêneros (Para você)</span>
                  </div>
                  <ChevronDown className="w-4 h-4 text-zinc-500 -rotate-90" />
                </button>
              </div>

              {/* Rodapé da Gaveta */}
              <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    setHomeCategoryFilter('all');
                    setIsThemeDrawerOpen(false);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="flex-1 py-2.5 px-3 rounded-xl border border-zinc-700 text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 transition font-medium min-h-[44px]"
                >
                  Mostrar Todas
                </button>
                <button
                  onClick={() => setIsThemeDrawerOpen(false)}
                  className="py-2.5 px-4 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition min-h-[44px]"
                >
                  Concluir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {isBillingModalOpen && (
        <Suspense fallback={null}>
          <BillingModal
            isOpen={isBillingModalOpen}
            onClose={() => setIsBillingModalOpen(false)}
            subscription={subscription}
            onUpgradeApproved={(updatedSub) => {
              if (updatedSub) {
                setSubscription(updatedSub);
              } else {
                void paymentsService.getStatus().then((res) => {
                  if (res.success && res.subscription) {
                    setSubscription(res.subscription);
                  }
                });
              }
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
