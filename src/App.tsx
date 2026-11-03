/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  INITIAL_ENTITIES,
  INITIAL_TOPICS,
  INITIAL_SOURCES,
  INITIAL_SUBSCRIPTION,
  INITIAL_NOTIFICATIONS,
  HIGHLIGHTED_ENTITIES,
  TRENDING_SUBJECTS
} from './data/mockData';
import { Event, Entity, Topic, Source, UserSubscription, SinalNotification } from './types/sinal';
import { EventCard } from './components/EventCard';
import { FeaturedTopCarousel } from './components/FeaturedTopCarousel';
import { EventDetailModal } from './components/EventDetailModal';
import { EntityDetailModal } from './components/EntityDetailModal';
import { ExploreView } from './components/ExploreView';
import { FollowingView } from './components/FollowingView';
import { NotificationsView } from './components/NotificationsView';
import { ProfileView } from './components/ProfileView';
import { BillingModal } from './components/BillingModal';
import { FatosBrLogo } from './components/FatosBrLogo';
import { OnboardingModal } from './components/OnboardingModal';
import { AuthModal } from './components/AuthModal';
import { BriefingView } from './components/BriefingView';
import { LandingPage } from './components/LandingPage';
import { AdminPanel } from './components/AdminPanel';
import { SavedHistoryView, HistoryItem } from './components/SavedHistoryView';
import { authService } from './services/authService';
import { userService } from './services/userService';
import { eventService } from './services/eventService';
import { newsIngestionService } from './services/newsIngestionService';
import { isSupabaseConfigured } from './lib/supabase';
import { User as SupabaseUser } from '@supabase/supabase-js';
import {
  SinalLoading,
  FeedSkeleton,
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
  Layers,
  ArrowRight,
  Settings,
  FileText,
  Clock,
  Globe2,
  RefreshCw,
  Sun,
  Moon,
  Command,
  AlertTriangle,
  X,
  Volume2,
  VolumeX,
  Headphones,
  Instagram,
  Check,
  CheckCircle2,
  SlidersHorizontal,
  ChevronDown,
  Menu
} from 'lucide-react';
import { rateLimitService } from './services/rateLimitService';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { soundAlertService } from './services/soundAlertService';
import { notificationService } from './services/notificationService';
import { motion, AnimatePresence } from 'motion/react';
import { EditorialPushBanner, PushNotificationPayload } from './components/EditorialPushBanner';
import { FatosBRControlView } from './components/FatosBRControlView';
import { LoginPage } from './components/LoginPage';
import { OnboardingFlow } from './components/OnboardingFlow';
import { LanguageSelector } from './components/LanguageSelector';
import { useI18n, useTranslation } from './i18n';
import { RecalibrateInterestsModal, ALL_ONBOARDING_THEMES } from './components/RecalibrateInterestsModal';
import { LegalCenterModal } from './components/LegalCenterModal';
import { CookieConsentBanner } from './components/CookieConsentBanner';

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
      if (view === 'app' || view === 'home') return 'home';
      if (view === 'admin') return 'admin';
      if (view === 'control' || view === 'instagram') return 'control';
      if (view === 'profile') return 'profile';
      if (view === 'explore') return 'explore';
      if (view === 'landing') return 'landing';
      if (window.location.hash === '#app' || window.location.hash === '#home') return 'home';
      if (window.location.hash === '#control') return 'control';

      // Persistência de sessão: se o usuário já fez login ou tem perfil ativo, permanece logado na última tela
      const isSessionActive = localStorage.getItem('fatosbr_session_active') === 'true';
      const hasSavedProfile = Boolean(localStorage.getItem('sinal_user_profile'));
      const lastNav = localStorage.getItem('fatosbr_last_nav') as any;

      if (isSessionActive || hasSavedProfile) {
        if (lastNav && lastNav !== 'landing' && lastNav !== 'login') {
          return lastNav;
        }
        return 'home';
      }
    }
    return 'landing';
  });
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

  // Sincronização em tempo real de logotipos de empresas cadastrados via AdminPanel
  useEffect(() => {
    const handleEntitiesUpdated = () => {
      setEntities((prev) =>
        prev.map((ent) => {
          try {
            const savedLogo = localStorage.getItem('fatosbr_company_logo_' + ent.id);
            if (savedLogo) return { ...ent, logoUrl: savedLogo };
          } catch {}
          return ent;
        })
      );
    };
    window.addEventListener('fatosbr_entities_updated', handleEntitiesUpdated);
    return () => window.removeEventListener('fatosbr_entities_updated', handleEntitiesUpdated);
  }, []);

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

  // Domain state - Notícias em tempo real com hidratação instantânea via cache de duas camadas (Memória + localStorage)
  const [events, setEvents] = useState<Event[]>(() => {
    const instant = rateLimitService.getInstantFeedSync();
    return Array.isArray(instant) && instant.length > 0 ? (instant as Event[]) : [];
  });
  const [isFeedRefreshing, setIsFeedRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>(() => {
    return INITIAL_ENTITIES.map((ent) => {
      try {
        const savedLogo = localStorage.getItem('fatosbr_company_logo_' + ent.id);
        if (savedLogo) return { ...ent, logoUrl: savedLogo };
      } catch {}
      return ent;
    });
  });
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

  // Função para buscar notícias reais via provedores e alimentar o feed em tempo real com cache em 2 camadas (Memória + localStorage)
  const loadRealTimeNews = async (isManualRefresh = false) => {
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
      // 1. Camada 1 & 2: Verifica cache de duas camadas (Memória + localStorage)
      const cached = rateLimitService.getCachedFeed();
      if (cached && cached.length >= 20) {
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
        setFeedAnimationKey((k) => k + 1);
        return;
      }

      // Se há cache instantâneo prévio, exibe imediatamente para 0ms de tela branca
      const instantFallback = rateLimitService.getInstantFeedSync();
      if (instantFallback && instantFallback.length > 0 && events.length === 0) {
        setEvents(instantFallback as Event[]);
        setIsLoading(false);
      } else if (events.length === 0) {
        setIsLoading(true);
      }
    }

    setHasError(false);

    try {
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
      }
    } catch (err) {
      console.error('Falha ao buscar notícias em tempo real:', err);
      if (events.length === 0) {
        setHasError(true);
      }
    } finally {
      setIsLoading(false);
      setIsFeedRefreshing(false);
      setFeedAnimationKey((k) => k + 1);
    }
  };

  // Coleta automática de notícias reais em tempo real ao carregar o Início + Pré-carregamento de Briefings
  useEffect(() => {
    loadRealTimeNews(false);

    // Pré-carregamento imediato em segundo plano para abertura instantânea da aba de Briefings
    const b1 = new Image();
    b1.src = '/assets/aistudio/Amanhecer_sobre_a_cidade__1__638f4414.png';
    const b2 = new Image();
    b2.src = '/assets/aistudio/Horizonte_urbano_ao_anoitecer__2__4a1dd254.png';
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
        localStorage.setItem('fatosbr_session_active', 'true');
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

      // Sincronizar ativamente no Supabase public.profiles e no registro consolidado do painel admin
      userService.syncUserProfile(user);

      // Sincronizar itens salvos do usuário
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
    }
  };

  // Supabase Auth & Dados Reais Listener
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // Carregar dados reais do Supabase se existirem
    eventService.getEvents().then((remoteEvents) => {
      if (remoteEvents && remoteEvents.length > 0) {
        setEvents(remoteEvents);
      }
    });

    eventService.getTopics().then((remoteTopics) => {
      if (remoteTopics && remoteTopics.length > 0) {
        setTopics(remoteTopics);
      }
    });

    eventService.getSources().then((remoteSources) => {
      if (remoteSources && remoteSources.length > 0) {
        setSources(remoteSources);
      }
    });

    eventService.getEntities().then((remoteEntities) => {
      if (remoteEntities && remoteEntities.length > 0) {
        setEntities(remoteEntities);
      }
    });

    // Validação assíncrona da sessão no Supabase antes de qualquer redirecionamento
    const restoreSessionAsync = async () => {
      try {
        const session = await authService.getSession();
        const user = session?.user || (await authService.getCurrentUser());

        if (user) {
          handleUserSession(user);
          localStorage.setItem('fatosbr_session_active', 'true');

          const params = new URLSearchParams(window.location.search);
          const explicitView = params.get('view') || params.get('page');
          const lastNav = localStorage.getItem('fatosbr_last_nav') as any;

          if (!explicitView && (window.location.pathname === '/' || window.location.pathname === '')) {
            setCurrentNav((prev) => {
              if (prev === 'landing' || prev === 'login') {
                return lastNav && lastNav !== 'landing' && lastNav !== 'login' ? lastNav : 'home';
              }
              return prev;
            });
          }
        }
      } catch (err) {
        console.warn('Erro ao validar sessão assíncrona:', err);
      }
    };

    restoreSessionAsync();

    // Detectar retorno de OAuth (/auth/callback, /auth/confirm, query/hash com tokens)
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      const search = window.location.search;
      const hash = window.location.hash;

      const isAuthCallback =
        pathname.includes('/auth/callback') ||
        pathname.includes('/auth/confirm') ||
        hash.includes('access_token') ||
        search.includes('code=') ||
        search.includes('error=');

      if (isAuthCallback) {
        authService.getCurrentUser().then((user) => {
          if (user) {
            handleUserSession(user);
            localStorage.setItem('fatosbr_session_active', 'true');
            localStorage.setItem('fatosbr_last_nav', 'home');
            const hasOnboarded = localStorage.getItem('sinal_onboarded_' + user.id) === 'true';
            if (!hasOnboarded) {
              setCurrentNav('onboarding');
            } else {
              setCurrentNav('home');
            }
          }
          // Limpa a barra de navegação para a raiz sem deixar tokens ou parâmetros expostos
          window.history.replaceState(null, '', '/');
        });
      }
    }

    const { data: authListener } = authService.onAuthStateChange((_event, session) => {
      handleUserSession(session?.user ?? null);
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

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
  const [isSearchingExternalApis, setIsSearchingExternalApis] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('sinal_notifications_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((n: any) => !n.read).length;
        }
      }
    } catch {}
    return 2;
  });

  // Sincronização em tempo real do contador de notificações não lidas
  useEffect(() => {
    const handleNotifsChanged = () => {
      try {
        const saved = localStorage.getItem('sinal_notifications_v1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setUnreadCount(parsed.filter((n: any) => !n.read).length);
          }
        }
      } catch {}
    };
    window.addEventListener('fatosbr_notifications_updated', handleNotifsChanged);
    window.addEventListener('storage', handleNotifsChanged);
    return () => {
      window.removeEventListener('fatosbr_notifications_updated', handleNotifsChanged);
      window.removeEventListener('storage', handleNotifsChanged);
    };
  }, []);
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

  // Toggle Save Event com sincronização total
  const handleToggleSave = (eventId: string) => {
    const isCurrentlySaved = savedEventIds.has(eventId);
    if (currentUser?.id) {
      userService.toggleSaveEvent(currentUser.id, eventId, isCurrentlySaved);
    }

    setSavedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });

    setEvents((prev) =>
      prev.map((e) => {
        if (e.id === eventId) {
          const nextSaved = !e.isSaved;
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

  // Follow / Unfollow Handlers com persistência e feedback instantâneo
  const handleToggleFollowEntity = (id: string) => {
    setEntities((prev) =>
      prev.map((e) => (e.id === id ? { ...e, isFollowed: !e.isFollowed } : e))
    );
  };

  const handleToggleFollowTopic = (id: string) => {
    const topic = topics.find((t) => t.id === id);
    if (topic && currentUser?.id) {
      userService.toggleFollowTopic(currentUser.id, id, topic.isFollowed);
    }
    setTopics((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isFollowed: !t.isFollowed } : t))
    );
  };

  const handleToggleFollowSource = (id: string) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isFollowed: !s.isFollowed } : s))
    );
  };

  // Hide Event ("Não quero ver isso")
  const handleHideEvent = (eventId: string) => {
    setHiddenEventIds((prev) => new Set([...prev, eventId]));
  };

  // Trigger simulated new events
  const handleSimulateNewEvents = () => {
    setHasNewEventsBanner(true);
  };

  const handleRefreshTop = () => {
    setHasNewEventsBanner(false);
    setFeedAnimationKey((prev) => prev + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Filtragem dos eventos de acordo com a tab ativa na Home
  const visibleEvents = events
    .filter((e) => !hiddenEventIds.has(e.id))
    .filter((e) => {
      if (searchQuery.trim().length > 0) {
        return (
          e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.category.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }
      if (activeTab === 'following') {
        const followedEntIds = new Set(entities.filter((ent) => ent.isFollowed).map((ent) => ent.id));
        const followedEntNames = new Set(entities.filter((ent) => ent.isFollowed).map((ent) => ent.name.toLowerCase()));
        const followedTopSlugs = new Set(topics.filter((top) => top.isFollowed).map((top) => top.slug.toLowerCase()));
        const followedTopNames = new Set(topics.filter((top) => top.isFollowed).map((top) => top.name.toLowerCase()));
        const followedSourceNames = new Set(sources.filter((s) => s.isFollowed).map((s) => s.name.toLowerCase()));

        // Se o usuário não segue nada, retorna false para exibir o estado vazio orientativo
        if (followedEntIds.size === 0 && followedTopSlugs.size === 0 && followedSourceNames.size === 0) {
          return false;
        }

        const matchesEntity = e.entities?.some(
          (ent) => followedEntIds.has(ent.id) || followedEntNames.has(ent.name?.toLowerCase())
        );
        const matchesTopic = e.topics?.some(
          (top) => followedTopSlugs.has(top.slug?.toLowerCase()) || followedTopNames.has(top.name?.toLowerCase())
        );
        const matchesSource = e.sources?.some(
          (src) => followedSourceNames.has(src.sourceName?.toLowerCase())
        );

        return Boolean(matchesEntity || matchesTopic || matchesSource);
      }
      if (activeTab === 'trending') {
        return e.relevanceScore >= 90;
      }
      if (activeTab === 'for-you') {
        // Filtragem estrita pelas categorias escolhidas no Onboarding / Recalibração
        if (userInterests && userInterests.length > 0) {
          return eventMatchesAnyUserTheme(e.category, e.title, e.summary, userInterests);
        }
        return true;
      }
      return true;
    })
    .filter((e) => {
      if (homeCategoryFilter === 'all') return true;
      return eventMatchesAnyUserTheme(e.category, e.title, e.summary, [homeCategoryFilter]);
    });

  // Manchetes e acontecimentos em destaque para o carrossel do topo do feed Home
  const topFeaturedEvents = useMemo(() => {
    // Quando houver pesquisa ativa, não exibe o carrossel para focar nos resultados da busca
    if (searchQuery.trim().length > 0 || visibleEvents.length === 0) return [];
    // Prioriza eventos com imagem de capa nítida para o banner de alto impacto
    const withImages = visibleEvents.filter((e) => Boolean(e.imageUrl));
    if (withImages.length >= 2) {
      return withImages.slice(0, 4);
    }
    return visibleEvents.slice(0, 3);
  }, [visibleEvents, searchQuery]);

  const featuredEventIds = useMemo(() => {
    return new Set(topFeaturedEvents.map((e) => e.id));
  }, [topFeaturedEvents]);

  // Feed vertical padrão (remove os acontecimentos já promovidos para o carrossel de manchetes do topo)
  const verticalFeedEvents = useMemo(() => {
    if (topFeaturedEvents.length === 0) return visibleEvents;
    return visibleEvents.filter((e) => !featuredEventIds.has(e.id));
  }, [visibleEvents, topFeaturedEvents, featuredEventIds]);

  // Disparo automático nas APIs externas caso o termo pesquisado não exista no cache local
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length >= 3 && visibleEvents.length === 0 && !isSearchingExternalApis && externalSearchFailed !== q) {
      const timer = setTimeout(() => {
        handleSearchExternalApis(q);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [searchQuery, visibleEvents.length, isSearchingExternalApis, externalSearchFailed, handleSearchExternalApis]);

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

  // Renderização de Telas Especiais: Landing Page, Login, Onboarding ou Admin Panel
  if (currentNav === 'landing') {
    return (
      <div className="min-h-screen bg-[#07080b] text-zinc-100 font-sans selection:bg-white selection:text-black">
        <LandingPage
          onStartFreeTrial={() => setCurrentNav('login')}
          onEnterApp={() => setCurrentNav(currentUser ? 'home' : 'login')}
          onOpenAuth={() => setCurrentNav('login')}
          onOpenLegal={handleOpenLegal}
        />
        <LegalCenterModal
          isOpen={isLegalModalOpen}
          onClose={() => setIsLegalModalOpen(false)}
          initialTab={legalModalTab}
        />
        <BillingModal
          isOpen={isBillingModalOpen}
          onClose={() => setIsBillingModalOpen(false)}
          subscription={subscription}
          onUpgradeApproved={() => {
            setSubscription((prev) => ({
              ...prev,
              status: 'ACTIVE',
              planName: 'FatosBR Pro (Ativo)'
            }));
          }}
        />
      </div>
    );
  }

  if (currentNav === 'login') {
    return (
      <LoginPage
        onBackToLanding={() => setCurrentNav('landing')}
        onAuthSuccess={(_email, _name) => {
          userService.syncUserProfile({
            email: _email,
            full_name: _name || _email.split('@')[0],
            name: _name || _email.split('@')[0]
          });
          authService.getCurrentUser().then((user) => {
            if (user) {
              handleUserSession(user);
              const hasOnboarded = localStorage.getItem('sinal_onboarded_' + user.id) === 'true';
              if (!hasOnboarded) {
                setCurrentNav('onboarding');
              } else {
                setCurrentNav('home');
              }
            } else {
              const hasOnboarded = localStorage.getItem('sinal_onboarded_' + _email) === 'true';
              if (!hasOnboarded) {
                setCurrentNav('onboarding');
              } else {
                setCurrentNav('home');
              }
            }
          });
        }}
      />
    );
  }

  if (currentNav === 'onboarding') {
    return (
      <OnboardingFlow
        entities={entities}
        topics={topics}
        sources={sources}
        onOpenLogin={() => setCurrentNav('login')}
        onComplete={(newThemes) => {
          if (Array.isArray(newThemes) && newThemes.length > 0) {
            setUserInterests(newThemes);
          }
          const userKey = currentUser?.id || currentUser?.email || 'guest';
          localStorage.setItem('sinal_onboarded_' + userKey, 'true');
          setCurrentNav('home');
        }}
      />
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
                  <img src={currentUserAvatar} alt={currentUser.email} className="w-full h-full object-cover" />
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
              prev.map((e) => (e.id === entityId ? { ...e, logoUrl: logoUrl || undefined } : e))
            );
          }}
          onAddEntity={(newEntity) => {
            setEntities((prev) => [newEntity, ...prev]);
          }}
        />
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
              >
                <FatosBrLogo size="md" glow={true} />
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

          {/* Bottom Card da Sidebar: Plano Pro */}
          <div
            onClick={() => setIsBillingModalOpen(true)}
            className="p-3.5 rounded-2xl border transition group cursor-pointer flex items-center space-x-3 border-[#202229] hover:border-zinc-700 bg-[#121418] hover:bg-[#16181f]"
          >
            <div className="w-8 h-8 rounded-xl border flex items-center justify-center text-xs font-bold shrink-0 transition bg-zinc-800 border-zinc-700 text-white">
              <Shield className="w-4 h-4 text-zinc-300" />
            </div>
            <div className="overflow-hidden">
              <div className="text-xs font-bold leading-tight text-white">Plano Pro</div>
              <div className="text-[11px] truncate text-zinc-400">FatosBR mais completo.</div>
            </div>
          </div>
        </aside>

        {/* ================= 2. CABEÇALHO MOBILE (390px/430px MOCKUP) ================= */}
        <header className="md:hidden sticky top-0 z-40 backdrop-blur-md border-b px-4 py-3 flex items-center justify-between bg-[#08090b]/95 border-[#1a1c22]">
          {/* Logo FatosBR */}
          <div
            onClick={() => setCurrentNav('home')}
            className="flex items-center space-x-2 cursor-pointer py-0.5"
          >
            <FatosBrLogo size="sm" glow={true} />
          </div>

          {/* Botões de Ação no Topo Mobile */}
          <div className="flex items-center space-x-1.5">
            {currentNav === 'profile' ? (
              <button
                onClick={() => {}}
                className="p-2 rounded-full transition cursor-pointer text-zinc-300 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
                title="Configurações"
              >
                <Settings className="w-5 h-5" />
              </button>
            ) : currentNav === 'explore' || currentNav === 'following' || currentNav === 'notifications' || currentNav === 'saved' || currentNav === 'history' ? (
              <button
                onClick={() => {}}
                className="p-2 rounded-full transition cursor-pointer text-zinc-300 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
                title="Buscar"
              >
                <Search className="w-5 h-5" />
              </button>
            ) : (
              <>
                <button
                  onClick={() => setCurrentNav('explore')}
                  className="p-2 text-zinc-300 hover:text-white rounded-full transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                  title="Explorar e Buscar"
                >
                  <Search className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setCurrentNav('notifications')}
                  className="relative p-2 text-zinc-300 hover:text-white rounded-full transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                  title="Notificações"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-white" />
                  )}
                </button>
              </>
            )}
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
            <FatosBRControlView
              onBackToApp={() => setCurrentNav('home')}
              onOpenCarouselStudio={() => setCurrentNav('admin')}
            />
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
                  className="w-full h-full object-cover"
                />
              </button>
            </div>

            <ExploreView
              entities={entities}
              topics={topics}
              sources={sources}
              events={events}
              onToggleFollowEntity={handleToggleFollowEntity}
              onToggleFollowTopic={handleToggleFollowTopic}
              onToggleFollowSource={handleToggleFollowSource}
              onOpenEntity={(ent) => setActiveEntityModal(ent)}
              onOpenEvent={(ev) => handleOpenEventDetail(ev)}
            />
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
                  className="w-full h-full object-cover"
                />
              </button>
            </div>

            <FollowingView
              entities={entities}
              topics={topics}
              sources={sources}
              onToggleFollowEntity={handleToggleFollowEntity}
              onToggleFollowTopic={handleToggleFollowTopic}
              onToggleFollowSource={handleToggleFollowSource}
              onOpenEntity={(ent) => setActiveEntityModal(ent)}
              onNavigateExplore={() => setCurrentNav('explore')}
            />
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
                  className="w-full h-full object-cover"
                />
              </button>
            </div>

            <NotificationsView
              events={events}
              entities={entities}
              onOpenEvent={(ev) => handleOpenEventDetail(ev)}
              onOpenEntity={(ent) => setActiveEntityModal(ent)}
              onBack={() => setCurrentNav('home')}
            />
          </div>
        ) : currentNav === 'saved' || currentNav === 'history' ? (
          /* ================= SALVOS & HISTÓRICO (MOCKUP 01 & 02) ================= */
          <div className="flex-1 w-full px-2 sm:px-6 py-4 sm:py-6 overflow-y-auto">
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
                  className="w-full h-full object-cover"
                />
              </button>
            </div>

            <BriefingView
              events={events}
              subscription={subscription}
              onOpenEventDetail={(ev) => handleOpenEventDetail(ev)}
              onOpenBilling={() => setIsBillingModalOpen(true)}
              isSuperAdmin={isSuperAdmin}
            />
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
                  className="w-full h-full object-cover"
                />
              </button>
            </div>

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
                await authService.signOut();
                setCurrentUser(null);
                setCurrentUserAvatar(null);
                try {
                  localStorage.removeItem('fatosbr_session_active');
                  localStorage.removeItem('sinal_user_profile');
                } catch {}
                setCurrentNav('landing');
                if (typeof window !== 'undefined') {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  window.history.replaceState(null, '', '/');
                }
              }}
            />
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

                      <motion.div
                        variants={{
                          hidden: { opacity: 0 },
                          show: {
                            opacity: 1,
                            transition: {
                              staggerChildren: 0.035,
                              delayChildren: 0.01
                            }
                          }
                        }}
                        initial="hidden"
                        animate="show"
                        className="space-y-4"
                      >
                        {verticalFeedEvents.map((event, index) => (
                          <motion.div
                            key={`${event.id}-${activeTab}-${homeCategoryFilter}`}
                            variants={{
                              hidden: { opacity: 0, y: 8 },
                              show: {
                                opacity: 1,
                                y: 0,
                                transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
                              }
                            }}
                            style={{ willChange: 'transform, opacity' }}
                          >
                            <EventCard
                              event={event}
                              index={index}
                              onOpenDetail={(ev) => handleOpenEventDetail(ev)}
                              onToggleSave={handleToggleSave}
                              onHideEvent={handleHideEvent}
                              onOpenEntity={(entity) => setActiveEntityModal(entity)}
                            />
                          </motion.div>
                        ))}
                      </motion.div>

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

      {/* ================= 6. MODAIS CENTRAIS COM TRANSIÇÕES SPRING E LAYOUT SHIFT ================= */}
      <AnimatePresence mode="wait">
        {activeEventModal && (
          <EventDetailModal
            key={`event-modal-${activeEventModal.id}`}
            event={activeEventModal}
            onClose={() => setActiveEventModal(null)}
            onToggleSave={handleToggleSave}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {activeEntityModal && (
          <EntityDetailModal
            key={`entity-modal-${activeEntityModal.id}`}
            entity={activeEntityModal}
            onClose={() => setActiveEntityModal(null)}
            allEvents={events}
            onOpenEventDetail={(ev) => setActiveEventModal(ev)}
            onToggleSaveEvent={handleToggleSave}
            onToggleFollow={handleToggleFollowEntity}
          />
        )}
      </AnimatePresence>

      <BillingModal
        isOpen={isBillingModalOpen}
        onClose={() => setIsBillingModalOpen(false)}
        subscription={subscription}
        onUpgradeApproved={() => {
          setSubscription((prev) => ({
            ...prev,
            status: 'ACTIVE',
            planName: 'FatosBR Pro (Ativo)'
          }));
        }}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(_email) => {
          setIsAuthModalOpen(false);
        }}
      />

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
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => {
          const userKey = currentUser?.id || currentUser?.email || 'guest';
          localStorage.setItem('sinal_onboarded_' + userKey, 'true');
          setIsOnboardingOpen(false);
        }}
        entities={entities}
        topics={topics}
        sources={sources}
        onToggleEntity={handleToggleFollowEntity}
        onToggleTopic={handleToggleFollowTopic}
        onToggleSource={handleToggleFollowSource}
        onComplete={() => {
          const userKey = currentUser?.id || currentUser?.email || 'guest';
          localStorage.setItem('sinal_onboarded_' + userKey, 'true');
          setIsOnboardingOpen(false);
          setCurrentNav('home');
        }}
      />

      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* ================= 9.1 MODAL DE RECALIBRAÇÃO DE INTERESSES DO LEITOR ================= */}
      <RecalibrateInterestsModal
        isOpen={isRecalibrateModalOpen}
        currentInterests={userInterests}
        onClose={() => setIsRecalibrateModalOpen(false)}
        onSave={(newInterests) => {
          setUserInterests(newInterests);
        }}
        onFullOnboarding={() => {
          setIsRecalibrateModalOpen(false);
          setCurrentNav('onboarding');
        }}
      />

      {/* ================= 10. TOAST FLUTUANTE DE RATE LIMIT ================= */}
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

      {/* ================= 11. INDICADOR VISUAL DO ATALHO G ================= */}
      {pendingGSequence && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-zinc-900/95 border border-zinc-700 text-white text-xs font-medium shadow-2xl backdrop-blur-md flex items-center space-x-2 animate-pulse">
          <Command className="w-3.5 h-3.5 text-zinc-300" />
          <span>Atalho G +: <strong>H</strong> Início · <strong>E</strong> Explorar · <strong>F</strong> Seguindo · <strong>B</strong> Briefings · <strong>N</strong> Notif. · <strong>P</strong> Perfil</span>
        </div>
      )}

      {/* ================= 12. CENTRAL DE CONFORMIDADE LEGAL & BANNER LGPD ================= */}
      <LegalCenterModal
        isOpen={isLegalModalOpen}
        onClose={() => setIsLegalModalOpen(false)}
        initialTab={legalModalTab}
      />

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

    </div>
  );
}
