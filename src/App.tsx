/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  Instagram
} from 'lucide-react';
import { rateLimitService } from './services/rateLimitService';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { soundAlertService } from './services/soundAlertService';
import { notificationService } from './services/notificationService';
import { motion, AnimatePresence } from 'motion/react';
import { EditorialPushBanner, PushNotificationPayload } from './components/EditorialPushBanner';
import { FatosBRControlView } from './components/FatosBRControlView';

const HISTORY_STORAGE_KEY = 'sinal_history_items_v1';
const MAX_HISTORY_ITEMS = 50;

export default function App() {
  // Navigation & Subtabs
  const [currentNav, setCurrentNav] = useState<
    'landing' | 'home' | 'explore' | 'following' | 'notifications' | 'briefings' | 'profile' | 'saved' | 'history' | 'admin' | 'control'
  >(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view') || params.get('page');
      if (view === 'app' || view === 'home') return 'home';
      if (view === 'admin') return 'admin';
      if (view === 'control' || view === 'instagram') return 'control';
      if (view === 'profile') return 'profile';
      if (view === 'explore') return 'explore';
      if (view === 'landing') return 'landing';
      if (window.location.hash === '#app' || window.location.hash === '#home') return 'home';
      if (window.location.hash === '#control') return 'control';
    }
    return 'landing';
  });
  const [activeTab, setActiveTab] = useState<'for-you' | 'following' | 'trending'>('for-you');
  const [homeCategoryFilter, setHomeCategoryFilter] = useState<'all' | 'tech' | 'politics' | 'business' | 'science'>('all');
  const [feedAnimationKey, setFeedAnimationKey] = useState<number>(0);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem('sinal_user_profile');
      if (saved) return JSON.parse(saved).avatarUrl;
    } catch {}
    return null;
  });
  const [currentUser, setCurrentUser] = useState<SupabaseUser | null>(null);

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

  // Domain state - Notícias em tempo real (dados mockados removidos)
  const [events, setEvents] = useState<Event[]>([]);
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

  // Função para buscar notícias reais via provedores e alimentar o feed em tempo real (25 a 40 notícias)
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
      // Carregamento inicial / automático: verifica cache recente para economizar cotas de APIs
      const cached = rateLimitService.getCachedFeed();
      if (cached && cached.length >= 25) {
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
      setIsLoading(true);
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

    // Verificar sessão existente
    authService.getCurrentUser().then((user) => {
      if (user) {
        setCurrentUser(user);
        // Sincronizar itens salvos do usuário
        userService.getSavedEventIds(user.id).then((savedIds) => {
          if (savedIds.length > 0) {
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
    });

    const { data: authListener } = authService.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
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
  const [unreadCount, setUnreadCount] = useState(2);

  // Handler para abrir detalhe do evento e registrar no histórico real
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
      return true;
    })
    .filter((e) => {
      if (homeCategoryFilter === 'all') return true;
      const cat = (e.category || '').toLowerCase();
      if (homeCategoryFilter === 'tech') return cat.includes('tec') || cat.includes('ia') || cat.includes('tech');
      if (homeCategoryFilter === 'politics') return cat.includes('pol') || cat.includes('reg') || cat.includes('gov');
      if (homeCategoryFilter === 'business') return cat.includes('neg') || cat.includes('econ') || cat.includes('mercad') || cat.includes('fin');
      if (homeCategoryFilter === 'science') return cat.includes('ciên') || cat.includes('cien') || cat.includes('scien') || cat.includes('pesq');
      return true;
    });



  // Super Admin oficial com acesso irrestrito
  const SUPER_ADMIN_EMAIL = 'astryasuporte@gmail.com';
  const isSuperAdmin = currentUser?.email
    ? currentUser.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()
    : true; // Padrão ativo para o ambiente local/Super Admin

  // Renderização de Telas Especiais: Landing Page ou Admin Panel
  if (currentNav === 'landing') {
    return (
      <div className="min-h-screen bg-[#07080b] text-zinc-100 font-sans selection:bg-white selection:text-black">
        <LandingPage
          onStartFreeTrial={() => setIsAuthModalOpen(true)}
          onEnterApp={() => setCurrentNav('home')}
          onOpenAuth={() => setIsAuthModalOpen(true)}
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
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          onAuthSuccess={(_email) => {
            setIsAuthModalOpen(false);
            setCurrentNav('home');
          }}
        />
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

      {/* Banner de Notificação Push (Desativado conforme solicitação até envio do novo HTML/imagem pelo usuário) */}

      {/* Container Principal Desktop / Mobile */}
      <div className="max-w-[1440px] mx-auto min-h-screen flex flex-col md:flex-row">
        
        {/* ================= 1. SIDEBAR DESKTOP (1440px MOCKUP) ================= */}
        <aside className="hidden md:flex flex-col justify-between w-64 lg:w-72 border-r p-6 shrink-0 sticky top-0 h-screen bg-[#08090b] border-[#1a1c22]">
          <div className="space-y-8">
            {/* macOS Window Dots & Logo */}
            <div className="space-y-6">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>

              {/* Logo: FatosBR */}
              <div
                onClick={() => setCurrentNav('home')}
                className="flex items-center space-x-2.5 cursor-pointer py-1"
              >
                <FatosBrLogo size="md" glow={true} />
              </div>
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
                <span>Início</span>
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
                <span>Explorar</span>
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
                <span>Seguindo</span>
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
                  <span>Notificações</span>
                </div>
                {unreadCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-red-500" />
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
                <span>Salvos</span>
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
                <span>Histórico</span>
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
                <span>Briefings</span>
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
                  <Instagram className="w-4 h-4 text-emerald-400" />
                  <span>FatosBR Control</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-emerald-400 border border-emerald-500/30">
                  IG
                </span>
              </button>

              <button
                onClick={() => setCurrentNav('landing')}
                className="w-full flex items-center space-x-3.5 px-4 py-3 rounded-xl transition-colors cursor-pointer text-zinc-400 hover:text-white hover:bg-[#121317]"
              >
                <Globe2 className="w-4 h-4 text-emerald-400" />
                <span>Landing Page</span>
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
                <span>Perfil</span>
              </button>
            </nav>

            {/* Atalhos Rápidos na Sidebar */}
            <div className="pt-2 border-t border-[#1a1c22] space-y-1">

              <button
                onClick={() => setIsShortcutsModalOpen(true)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition text-xs cursor-pointer text-zinc-400 hover:text-white hover:bg-[#121317]"
                title="Atalhos de teclado globais (tecla ?)"
              >
                <div className="flex items-center space-x-2.5">
                  <Command className="w-4 h-4 text-emerald-400" />
                  <span>Atalhos Globais</span>
                </div>
                <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300">
                  ?
                </kbd>
              </button>
            </div>
          </div>

          {/* Bottom Card da Sidebar: Plano Pro */}
          <div
            onClick={() => setIsBillingModalOpen(true)}
            className="p-3.5 rounded-2xl border transition group cursor-pointer flex items-center space-x-3 border-[#202229] hover:border-zinc-700 bg-[#121418] hover:bg-[#16181f]"
          >
            <div className="w-8 h-8 rounded-xl border flex items-center justify-center text-xs font-bold shrink-0 transition bg-zinc-800 border-zinc-700 text-white">
              <Shield className="w-4 h-4 text-emerald-400" />
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

          {/* Botões de Ação no Topo Mobile (Briefings e Notificações/Busca) */}
          <div className="flex items-center space-x-1.5">

            {/* Botão Briefings no Topo Mobile */}
            <button
              onClick={() => setCurrentNav('briefings')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition active:scale-95 cursor-pointer ${
                currentNav === 'briefings'
                  ? 'bg-zinc-800 border-zinc-700 text-white font-bold'
                  : 'bg-[#12141a] border-[#202432] text-zinc-300 hover:text-white'
              }`}
              title="Acessar Briefings Diários"
            >
              <FileText className="w-3.5 h-3.5 text-zinc-300" />
              <span>Briefings</span>
            </button>

            {/* Botão FatosBR Control no Topo Mobile */}
            <button
              onClick={() => setCurrentNav('control')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition active:scale-95 cursor-pointer ${
                currentNav === 'control'
                  ? 'bg-zinc-800 border-zinc-700 text-white font-bold'
                  : 'bg-[#12141a] border-[#202432] text-zinc-300 hover:text-white'
              }`}
              title="Acessar FatosBR Control"
            >
              <Instagram className="w-3.5 h-3.5 text-emerald-400" />
              <span>Control</span>
            </button>

            {currentNav === 'profile' ? (
              <button
                onClick={() => {}}
                className="p-1.5 rounded-full transition cursor-pointer text-zinc-300 hover:text-white"
                title="Configurações"
              >
                <Settings className="w-5 h-5" />
              </button>
            ) : currentNav === 'explore' || currentNav === 'following' || currentNav === 'notifications' || currentNav === 'saved' || currentNav === 'history' ? (
              <button
                onClick={() => {}}
                className="p-1.5 rounded-full transition cursor-pointer text-zinc-300 hover:text-white"
              >
                <Search className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={() => setCurrentNav('notifications')}
                className="relative p-2 text-zinc-300 hover:text-white rounded-full transition cursor-pointer"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
                )}
              </button>
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
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
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
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
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
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
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
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
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
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
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
              onOpenAuth={() => setIsAuthModalOpen(true)}
              onOpenAdmin={() => setCurrentNav('admin')}
              isSuperAdmin={isSuperAdmin}
              onProfileUpdated={(updated) => setCurrentUserAvatar(updated.avatarUrl)}
              onLogout={async () => {
                await authService.signOut();
                setCurrentUser(null);
                setCurrentUserAvatar(null);
                try {
                  localStorage.removeItem('sinal_user_profile');
                } catch {}
                setCurrentNav('landing');
                if (typeof window !== 'undefined') {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
            />
          </div>
        ) : (
          /* ================= HOME / FEED PRINCIPAL ================= */
          <div className="flex-1 flex flex-col lg:flex-row w-full">
            <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 pt-4 pb-36 sm:pb-36 md:pb-12 space-y-4">
              
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
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
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

              {/* Subtabs: "Para você", "Seguindo", "Em alta" */}
              <div className="flex items-center space-x-2 pb-1">
                <button
                  onClick={() => setActiveTab('for-you')}
                  className={`px-3.5 sm:px-4 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'for-you'
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-[#111215] text-zinc-400 hover:text-white border border-[#1e2026]'
                  }`}
                >
                  Para você
                </button>

                <button
                  onClick={() => setActiveTab('following')}
                  className={`px-3.5 sm:px-4 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'following'
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-[#111215] text-zinc-400 hover:text-white border border-[#1e2026]'
                  }`}
                >
                  Seguindo
                </button>

                <button
                  onClick={() => setActiveTab('trending')}
                  className={`px-3.5 sm:px-4 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'trending'
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-[#111215] text-zinc-400 hover:text-white border border-[#1e2026]'
                  }`}
                >
                  Em alta
                </button>
              </div>

              {/* Sistema de Filtro por Categorias (Seleção única: Todas, Tech, Política, Negócios, Ciência) */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                {[
                  { id: 'all', label: 'Todas' },
                  { id: 'tech', label: 'Tecnologia & IA' },
                  { id: 'politics', label: 'Política' },
                  { id: 'business', label: 'Negócios & Economia' },
                  { id: 'science', label: 'Ciência' }
                ].map((cat) => {
                  const isSelected = homeCategoryFilter === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setHomeCategoryFilter(cat.id as any)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition cursor-pointer active:scale-95 ${
                        isSelected
                          ? 'bg-white text-black font-bold shadow-sm'
                          : 'bg-[#111215] text-zinc-400 hover:text-white border border-[#1e2026] hover:border-zinc-700'
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>

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

              {/* TIMELINE DE ACONTECIMENTOS */}
              {!isLoading && !hasError && !activeStateSimulation && visibleEvents.length > 0 && (
                <div
                  key={`feed-container-${feedAnimationKey}-${activeTab}-${homeCategoryFilter}-${searchQuery}`}
                  className="space-y-4 animate-feed-fade"
                >
                  {visibleEvents.map((event, index) => (
                    <EventCard
                      key={`${event.id}-${feedAnimationKey}-${activeTab}-${homeCategoryFilter}`}
                      event={event}
                      index={index}
                      onOpenDetail={(ev) => handleOpenEventDetail(ev)}
                      onToggleSave={handleToggleSave}
                      onHideEvent={handleHideEvent}
                      onOpenEntity={(entity) => setActiveEntityModal(entity)}
                    />
                  ))}

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
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-mono">
                        {lastSyncTime ? `Ao vivo (${lastSyncTime})` : 'Ao vivo'}
                      </span>
                      <span
                        className={`text-xs font-mono px-2 py-0.5 rounded-lg ${
                          dailyRefreshRemaining === 0
                            ? 'bg-amber-500/20 text-amber-300 font-bold'
                            : 'bg-zinc-800 text-zinc-300'
                        }`}
                      >
                        {dailyRefreshRemaining}/5
                      </span>
                      <RefreshCw
                        className={`w-4 h-4 ${
                          isFeedRefreshing ? 'animate-spin text-emerald-400' : 'text-zinc-400'
                        }`}
                      />
                      <span>Atualizar feed de notícias</span>
                    </button>
                    <p className="text-[11px] text-zinc-500 font-mono">
                      {dailyRefreshRemaining} de 5 atualizações manuais restantes hoje
                    </p>
                  </div>
                </div>
              )}

              {/* EMPTY STATE / NO RESULTS */}
              {!isLoading && !hasError && !activeStateSimulation && visibleEvents.length === 0 && (
                searchQuery.trim().length > 0 ? (
                  <NoResultsState
                    query={searchQuery}
                    onClear={() => setSearchQuery('')}
                    onExplore={() => {
                      setSearchQuery('');
                      setCurrentNav('explore');
                    }}
                  />
                ) : activeTab === 'following' ? (
                  <EmptyFollowingState onExplore={() => setCurrentNav('explore')} />
                ) : (
                  <EmptyFeedState onExplore={() => setCurrentNav('explore')} />
                )
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
          aria-label="Início"
        >
          <Home className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          <span>Início</span>
        </button>

        <button
          onClick={() => setCurrentNav('explore')}
          className={`min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'explore'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label="Explorar"
        >
          <Compass className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          <span>Explorar</span>
        </button>

        <button
          onClick={() => setCurrentNav('following')}
          className={`min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'following'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label="Seguindo"
        >
          <Bookmark className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          <span>Seguindo</span>
        </button>

        <button
          onClick={() => setCurrentNav('briefings')}
          className={`min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'briefings'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label="Briefings"
        >
          <FileText className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          <span>Briefings</span>
        </button>

        <button
          onClick={() => setCurrentNav('notifications')}
          className={`relative min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'notifications'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label="Notificações"
        >
          <Bell className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          {unreadCount > 0 && (
            <span className="absolute top-2 right-2.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#08090b]" />
          )}
          <span>Notificações</span>
        </button>

        <button
          onClick={() => setCurrentNav('profile')}
          className={`min-h-[48px] min-w-[42px] flex flex-col items-center justify-center py-1 px-1.5 text-[9px] sm:text-[10px] transition cursor-pointer active:scale-95 ${
            currentNav === 'profile'
              ? 'text-white font-bold'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          aria-label="Perfil"
        >
          <User className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
          <span>Perfil</span>
        </button>
      </nav>

      {/* ================= 6. MODAIS CENTRAIS ================= */}
      <EventDetailModal
        event={activeEventModal}
        onClose={() => setActiveEventModal(null)}
        onToggleSave={handleToggleSave}
      />

      <EntityDetailModal
        entity={activeEntityModal}
        onClose={() => setActiveEntityModal(null)}
        allEvents={events}
        onOpenEventDetail={(ev) => setActiveEventModal(ev)}
        onToggleSaveEvent={handleToggleSave}
        onToggleFollow={handleToggleFollowEntity}
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
        onClose={() => setIsOnboardingOpen(false)}
        entities={entities}
        topics={topics}
        sources={sources}
        onToggleEntity={handleToggleFollowEntity}
        onToggleTopic={handleToggleFollowTopic}
        onToggleSource={handleToggleFollowSource}
        onComplete={() => {
          setIsOnboardingOpen(false);
          setCurrentNav('home');
        }}
      />

      {/* ================= 9. MODAL DE ATALHOS GLOBAIS DE TECLADO ================= */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
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
          <Command className="w-3.5 h-3.5 text-emerald-400" />
          <span>Atalho G +: <strong>H</strong> Início · <strong>E</strong> Explorar · <strong>F</strong> Seguindo · <strong>B</strong> Briefings · <strong>N</strong> Notif. · <strong>P</strong> Perfil</span>
        </div>
      )}

    </div>
  );
}
