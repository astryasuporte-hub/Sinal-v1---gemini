/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Event } from '../types/sinal';
import {
  Bookmark,
  Clock,
  Search,
  MoreVertical,
  Trash2,
  ExternalLink,
  Share2,
  FolderPlus,
  Folder,
  Eye,
  EyeOff,
  X,
  Compass,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  Bell,
  ArrowUpRight,
  EyeClosed,
  Plus
} from 'lucide-react';

export interface HistoryItem {
  event: Event;
  openedAt: string; // ex: "Há 1 hora", "Há 3 horas", "Hoje às 10:15"
  timestamp: number;
}

export function formatHistoryRelativeTime(timestamp: number, fallbackText?: string): string {
  if (!timestamp) return fallbackText || 'Recente';
  const now = Date.now();
  const diffMs = now - timestamp;
  if (diffMs < 0) return 'Agora há pouco';
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 2) return 'Agora há pouco';
  if (diffMin < 60) return `Há ${diffMin} min`;
  if (diffHour === 1) return 'Há 1 hora';
  if (diffHour < 24) return `Há ${diffHour} horas`;
  if (diffDay === 1) {
    const d = new Date(timestamp);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `Ontem às ${hh}:${mm}`;
  }
  if (diffDay < 7) return `Há ${diffDay} dias`;
  const d = new Date(timestamp);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

interface SavedHistoryViewProps {
  initialTab?: 'saved' | 'history';
  events: Event[];
  historyItems: HistoryItem[];
  onOpenEvent: (event: Event) => void;
  onToggleSaveEvent: (eventId: string) => void;
  onRemoveFromHistory: (eventId: string) => void;
  onClearHistory: () => void;
  onNavigateExplore: () => void;
  onNavigateHome: () => void;
  onHideEvent?: (eventId: string) => void;
  unreadCount?: number;
  onNavigateNotifications?: () => void;
  onNavigateProfile?: () => void;
  onTabChange?: (tab: 'saved' | 'history') => void;
}

export const SavedHistoryView: React.FC<SavedHistoryViewProps> = ({
  initialTab = 'saved',
  events,
  historyItems,
  onOpenEvent,
  onToggleSaveEvent,
  onRemoveFromHistory,
  onClearHistory,
  onNavigateExplore,
  onNavigateHome,
  onHideEvent,
  unreadCount = 0,
  onNavigateNotifications,
  onNavigateProfile,
  onTabChange
}) => {
  // Tabs: Salvos vs Histórico
  const [activeTab, setActiveTab] = useState<'saved' | 'history'>(initialTab);

  // Sincroniza tab inicial se a prop mudar via sidebar
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const handleSelectTab = (tab: 'saved' | 'history') => {
    setActiveTab(tab);
    if (onTabChange) {
      onTabChange(tab);
    }
  };

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'oldest'>('recent');

  // UI state
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [activeMenuEvent, setActiveMenuEvent] = useState<Event | null>(null);
  const [isClearHistoryModalOpen, setIsClearHistoryModalOpen] = useState(false);
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showTipsCard, setShowTipsCard] = useState(true);
  const [mobileSearchActive, setMobileSearchActive] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Atalho de teclado ⌘K / Ctrl+K para focar na busca
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMobileSearchActive(true);
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Pastas de organização (Mockup 06 Desktop)
  const [customFolders, setCustomFolders] = useState<string[]>([
    'Tecnologia',
    'Economia',
    'Política',
    'Esportes',
    'IA'
  ]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Itens Salvos reais baseados no estado `isSaved`
  const savedEvents = useMemo(() => {
    return events.filter((e) => e.isSaved);
  }, [events]);

  // Contadores para o Resumo Desktop (Mockup 06)
  const savedTotalCount = savedEvents.length;
  const notViewedCount = useMemo(() => {
    return savedEvents.filter((e) => !e.isViewed).length;
  }, [savedEvents]);
  const viewedCount = useMemo(() => {
    return savedEvents.filter((e) => e.isViewed).length;
  }, [savedEvents]);

  // Lista dinâmica filtrada e ordenada para a aba ativa
  const displayedItems = useMemo(() => {
    if (activeTab === 'saved') {
      let result = [...savedEvents];

      // Busca textual
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        result = result.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.summary.toLowerCase().includes(q) ||
            e.category.toLowerCase().includes(q) ||
            e.entities.some((ent) => ent.name.toLowerCase().includes(q)) ||
            e.topics.some((top) => top.name.toLowerCase().includes(q))
        );
      }

      // Filtro por categoria
      if (selectedCategory !== 'all') {
        result = result.filter(
          (e) => e.category.toLowerCase() === selectedCategory.toLowerCase()
        );
      }

      // Filtro por pasta
      if (selectedFolder !== 'all') {
        result = result.filter(
          (e) =>
            e.category.toLowerCase() === selectedFolder.toLowerCase() ||
            e.topics.some((top) => top.name.toLowerCase() === selectedFolder.toLowerCase()) ||
            e.entities.some((ent) => ent.name.toLowerCase() === selectedFolder.toLowerCase())
        );
      }

      // Ordenação
      if (sortBy === 'recent') {
        result.sort((a, b) => {
          const timeA = a.savedAt ? new Date(a.savedAt).getTime() : 0;
          const timeB = b.savedAt ? new Date(b.savedAt).getTime() : 0;
          return timeB - timeA;
        });
      } else if (sortBy === 'oldest') {
        result.sort((a, b) => {
          const timeA = a.savedAt ? new Date(a.savedAt).getTime() : 0;
          const timeB = b.savedAt ? new Date(b.savedAt).getTime() : 0;
          return timeA - timeB;
        });
      }

      return result.map((event) => ({
        event,
        metaText: `${event.category} · ${event.relativeTime || 'Recente'}`,
        timestamp: event.savedAt ? new Date(event.savedAt).getTime() : 0
      }));
    } else {
      // Histórico
      let result = [...historyItems];

      // Busca textual no histórico
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        result = result.filter(
          (item) =>
            item.event.title.toLowerCase().includes(q) ||
            item.event.summary.toLowerCase().includes(q) ||
            item.event.category.toLowerCase().includes(q) ||
            item.event.entities.some((ent) => ent.name.toLowerCase().includes(q)) ||
            item.event.topics.some((top) => top.name.toLowerCase().includes(q))
        );
      }

      // Filtro por categoria no histórico
      if (selectedCategory !== 'all') {
        result = result.filter(
          (item) => item.event.category.toLowerCase() === selectedCategory.toLowerCase()
        );
      }

      // Ordenação do histórico
      if (sortBy === 'recent') {
        result.sort((a, b) => b.timestamp - a.timestamp);
      } else if (sortBy === 'oldest') {
        result.sort((a, b) => a.timestamp - b.timestamp);
      }

      return result.map((item) => ({
        event: item.event,
        metaText: `${item.event.category} · ${formatHistoryRelativeTime(item.timestamp, item.openedAt || item.event.relativeTime)}`,
        timestamp: item.timestamp
      }));
    }
  }, [
    activeTab,
    savedEvents,
    historyItems,
    searchQuery,
    selectedCategory,
    selectedFolder,
    sortBy
  ]);

  // Contagem de itens por pasta / categoria para o Card Pastas (Mockup 06)
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    customFolders.forEach((folder) => {
      counts[folder] = savedEvents.filter(
        (e) =>
          e.category.toLowerCase() === folder.toLowerCase() ||
          e.topics.some((top) => top.name.toLowerCase() === folder.toLowerCase()) ||
          e.entities.some((ent) => ent.name.toLowerCase() === folder.toLowerCase())
      ).length;
    });
    return counts;
  }, [customFolders, savedEvents]);

  // Contagem por categoria para o Card Categorias do Histórico (Mockup 07)
  const historyCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: historyItems.length,
      Tecnologia: 0,
      Economia: 0,
      Política: 0,
      Esportes: 0,
      Mundo: 0,
      Saúde: 0,
      Mercado: 0
    };

    historyItems.forEach((item) => {
      const cat = item.event.category;
      if (counts[cat] !== undefined) {
        counts[cat]++;
      } else {
        counts[cat] = 1;
      }
    });

    return counts;
  }, [historyItems]);

  // Handle Criar Nova Pasta
  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    if (!customFolders.includes(trimmed)) {
      setCustomFolders((prev) => [...prev, trimmed]);
      setSelectedFolder(trimmed);
      showToast(`Pasta "${trimmed}" criada.`);
    }
    setNewFolderName('');
    setIsNewFolderModalOpen(false);
  };

  // Handle Compartilhar Link
  const handleShare = async (event: Event) => {
    const shareData = {
      title: `${event.title} — FatosBR`,
      text: event.summary,
      url: window.location.href
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        setActiveMenuEvent(null);
        return;
      } catch {}
    }
    navigator.clipboard.writeText(window.location.href);
    showToast('Link do acontecimento copiado!');
    setActiveMenuEvent(null);
  };

  // Categorias disponíveis para filtros rápidos (Mockup 03)
  const availableCategories = [
    { id: 'all', label: 'Todos' },
    { id: 'Tecnologia', label: 'Tecnologia' },
    { id: 'Economia', label: 'Economia' },
    { id: 'Política', label: 'Política' },
    { id: 'Esportes', label: 'Esportes' },
    { id: 'Mercado', label: 'Mercado' },
    { id: 'Mundo', label: 'Mundo' },
    { id: 'Saúde', label: 'Saúde' }
  ];

  return (
    <div className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-6">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs font-medium shadow-2xl flex items-center gap-2 animate-bounce-short">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Modal: Confirmar Limpar Histórico (Mockup 07 / Requisito 20) */}
      {isClearHistoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#111216] border border-[#202229] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl text-left">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <Trash2 className="w-5 h-5" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-white tracking-tight">
                Limpar seu histórico?
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                O registro dos acontecimentos que você abriu será removido. Seus itens salvos não serão afetados.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800/80">
              <button
                onClick={() => setIsClearHistoryModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  onClearHistory();
                  setIsClearHistoryModalOpen(false);
                  showToast('Histórico limpo com sucesso.');
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white shadow transition cursor-pointer"
              >
                Limpar histórico
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Criar Nova Pasta (Mockup 06 / Requisito 22) */}
      {isNewFolderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <form
            onSubmit={handleCreateFolder}
            className="bg-[#111216] border border-[#202229] rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-left"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white tracking-tight">
                Nova pasta
              </h3>
              <button
                type="button"
                onClick={() => setIsNewFolderModalOpen(false)}
                className="text-zinc-500 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-400">Nome da pasta</label>
              <input
                type="text"
                autoFocus
                placeholder="Ex: Inteligência Artificial, Finanças..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full bg-[#16181f] border border-[#262832] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsNewFolderModalOpen(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!newFolderName.trim()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition disabled:opacity-40 cursor-pointer"
              >
                Criar pasta
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= 04 - MENU DE AÇÕES (MOBILE BOTTOM SHEET MOCKUP) ================= */}
      {activeMenuEvent && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          {/* Backdrop click */}
          <div
            className="absolute inset-0"
            onClick={() => setActiveMenuEvent(null)}
          />

          <div className="relative w-full sm:max-w-md bg-[#111216] border-t sm:border border-[#222530] rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-2xl text-left z-10 animate-slide-up sm:animate-scale-in">
            {/* Drag handle no mobile */}
            <div className="sm:hidden w-12 h-1 bg-zinc-700 rounded-full mx-auto -mt-1 mb-2" />

            {/* Mini preview do item (Mockup 04) */}
            <div className="flex items-center gap-3 pb-3 border-b border-zinc-800/80">
              {activeMenuEvent.imageUrl ? (
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-900 border border-[#202229] shrink-0">
                  <img
                    src={activeMenuEvent.imageUrl}
                    alt={activeMenuEvent.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-[#202229] flex items-center justify-center text-zinc-500 shrink-0">
                  <Bookmark className="w-5 h-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <span className="text-[11px] text-zinc-400 font-medium">
                  {activeMenuEvent.category} · {activeMenuEvent.relativeTime || 'Recente'}
                </span>
                <h4 className="text-xs font-bold text-white truncate leading-snug">
                  {activeMenuEvent.title}
                </h4>
              </div>
            </div>

            {/* Opções de Ação com Chevron (Mockup 04) */}
            <div className="space-y-1 text-xs">
              {/* 1. Abrir acontecimento */}
              <button
                onClick={() => {
                  onOpenEvent(activeMenuEvent);
                  setActiveMenuEvent(null);
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl text-zinc-200 hover:bg-zinc-800/60 hover:text-white transition cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <ArrowUpRight className="w-4 h-4 text-zinc-400" />
                  <span className="font-medium">Abrir acontecimento</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
              </button>

              {/* 2. Salvar ou Remover dos Salvos */}
              {activeTab === 'saved' ? (
                <button
                  onClick={() => {
                    onToggleSaveEvent(activeMenuEvent.id);
                    setActiveMenuEvent(null);
                    showToast('Acontecimento removido dos salvos.');
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl text-zinc-200 hover:bg-zinc-800/60 hover:text-white transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <Trash2 className="w-4 h-4 text-zinc-400" />
                    <span className="font-medium">Remover dos salvos</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600" />
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      onToggleSaveEvent(activeMenuEvent.id);
                      setActiveMenuEvent(null);
                      showToast(
                        activeMenuEvent.isSaved
                          ? 'Removido dos salvos.'
                          : 'Acontecimento guardado nos salvos.'
                      );
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-xl text-zinc-200 hover:bg-zinc-800/60 hover:text-white transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <Bookmark className="w-4 h-4 text-zinc-400" />
                      <span className="font-medium">
                        {activeMenuEvent.isSaved ? 'Remover dos salvos' : 'Guardar nos salvos'}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-600" />
                  </button>

                  <button
                    onClick={() => {
                      onRemoveFromHistory(activeMenuEvent.id);
                      setActiveMenuEvent(null);
                      showToast('Item removido do histórico.');
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-xl text-zinc-200 hover:bg-zinc-800/60 hover:text-white transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <Trash2 className="w-4 h-4 text-zinc-400" />
                      <span className="font-medium">Remover do histórico</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-600" />
                  </button>
                </>
              )}

              {/* 3. Compartilhar */}
              <button
                onClick={() => handleShare(activeMenuEvent)}
                className="w-full flex items-center justify-between p-3 rounded-xl text-zinc-200 hover:bg-zinc-800/60 hover:text-white transition cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Share2 className="w-4 h-4 text-zinc-400" />
                  <span className="font-medium">Compartilhar</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
              </button>

              {/* 4. Ocultar do meu FatosBR */}
              <button
                onClick={() => {
                  if (onHideEvent) {
                    onHideEvent(activeMenuEvent.id);
                  }
                  setActiveMenuEvent(null);
                  showToast('Acontecimento ocultado do seu FatosBR.');
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl text-zinc-200 hover:bg-zinc-800/60 hover:text-white transition cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <EyeClosed className="w-4 h-4 text-zinc-400" />
                  <span className="font-medium">Ocultar do meu FatosBR</span>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
              </button>
            </div>

            {/* Botão Cancelar (Mockup 04) */}
            <div className="pt-2 border-t border-zinc-800/80">
              <button
                onClick={() => setActiveMenuEvent(null)}
                className="w-full py-2.5 rounded-xl text-xs font-bold text-zinc-300 hover:text-white hover:bg-zinc-800/60 transition cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Grid Principal: Conteúdo Central + Coluna Lateral Leve no Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* ================= COLUNA PRINCIPAL (LIVRARIA PESSOAL) ================= */}
        <div className="lg:col-span-8 space-y-4">
          
          {/* ================= 1. CABEÇALHO EDITORIAL (MOCKUP 01, 02, 06 & 07) ================= */}
          <div className="space-y-3">
            
            {/* Top row: Título & Subtítulo + Busca Desktop (Mockup 06 & 07) */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {activeTab === 'saved' ? 'Salvos' : 'Histórico'}
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">
                  {activeTab === 'saved'
                    ? 'Acontecimentos que você salvou para ver depois.'
                    : 'Acontecimentos que você já abriu recentemente.'}
                </p>
              </div>

              {/* Busca Desktop Integrada com Atalho ⌘K (Mockup 06 & 07) */}
              <div className="hidden sm:flex items-center gap-3">
                <div className="relative w-64 lg:w-72">
                  <Search className="w-4 h-4 absolute left-3.5 top-3 text-zinc-500" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder={activeTab === 'saved' ? "Buscar nos salvos..." : "Buscar no histórico..."}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[#111216] border border-[#1e2026] rounded-xl pl-10 pr-12 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-700 transition"
                  />
                  {searchQuery ? (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3.5 top-2.5 text-zinc-500 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <span className="absolute right-3 top-2.5 text-[10px] font-mono text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                      ⌘ K
                    </span>
                  )}
                </div>

                {/* Notificações e Perfil Desktop Header */}
                {onNavigateNotifications && (
                  <button
                    onClick={onNavigateNotifications}
                    className="relative p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer"
                    title="Notificações"
                  >
                    <Bell className="w-4 h-4" />
                    {unreadCount > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
                    )}
                  </button>
                )}

                {onNavigateProfile && (
                  <button
                    onClick={onNavigateProfile}
                    className="w-8 h-8 rounded-full overflow-hidden border border-[#1e2026] hover:border-zinc-500 transition cursor-pointer shrink-0"
                    title="Perfil"
                  >
                    <img
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80"
                      alt="Perfil"
                      className="w-full h-full object-cover"
                    />
                  </button>
                )}
              </div>
            </div>

            {/* ================= 03 - BUSCA EXPANDIDA NO MOBILE (MOCKUP 03) ================= */}
            {mobileSearchActive && (
              <div className="sm:hidden space-y-2 pt-1 animate-fade-in">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3.5 top-3 text-zinc-500" />
                  <input
                    type="text"
                    autoFocus
                    placeholder={activeTab === 'saved' ? "Buscar nos salvos..." : "Buscar no histórico..."}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[#111216] border border-[#20222a] rounded-xl pl-10 pr-10 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
                  />
                  {searchQuery ? (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3.5 top-3 text-zinc-500 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  ) : (
                    <span className="absolute right-3.5 top-3 text-[10px] font-mono text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                      ⌘ K
                    </span>
                  )}
                </div>

                {/* Filtros em Pílulas com Scroll Horizontal (Mockup 03) */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                  {availableCategories.map((cat) => {
                    const isSelected = selectedCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition cursor-pointer ${
                          isSelected
                            ? 'bg-white text-black shadow-sm'
                            : 'bg-[#121317] text-zinc-400 hover:text-white border border-[#202229]'
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ================= 2. TABS: [ Salvos ] [ Histórico ] + CONTROLES ================= */}
            <div className="flex items-center justify-between pt-1 pb-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    handleSelectTab('saved');
                    setSelectedCategory('all');
                  }}
                  className={`px-4 sm:px-5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                    activeTab === 'saved'
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-[#121317] text-zinc-400 hover:text-white border border-[#202229]'
                  }`}
                >
                  Salvos
                </button>

                <button
                  onClick={() => {
                    handleSelectTab('history');
                    setSelectedCategory('all');
                  }}
                  className={`px-4 sm:px-5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                    activeTab === 'history'
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-[#121317] text-zinc-400 hover:text-white border border-[#202229]'
                  }`}
                >
                  Histórico
                </button>
              </div>

              {/* Botão Sliders no Mobile (Mockup 01 & 02) */}
              <div className="flex sm:hidden items-center gap-2">
                <button
                  onClick={() => setMobileSearchActive(!mobileSearchActive)}
                  className={`p-2 rounded-xl transition cursor-pointer ${
                    mobileSearchActive
                      ? 'bg-white text-black'
                      : 'bg-[#121317] border border-[#202229] text-zinc-400 hover:text-white'
                  }`}
                  title="Buscar e filtrar"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
              </div>

              {/* Controles Desktop: Filtrar ⌵ e Ordenar ⌵ (Mockup 06 & 07) */}
              <div className="hidden sm:flex items-center gap-2.5">
                {/* Dropdown: Filtrar */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setIsFilterDropdownOpen(!isFilterDropdownOpen);
                      setIsSortDropdownOpen(false);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer border ${
                      selectedCategory !== 'all'
                        ? 'bg-white text-black border-white'
                        : 'bg-[#111216] text-zinc-300 border-[#1e2026] hover:text-white'
                    }`}
                  >
                    <span>{selectedCategory === 'all' ? 'Filtrar' : selectedCategory}</span>
                    <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                  </button>

                  {isFilterDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-48 rounded-xl bg-[#121317] border border-[#202229] py-1.5 shadow-2xl z-30 space-y-0.5 text-xs animate-fade-in">
                      <div className="px-3 py-1 text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                        Categorias
                      </div>
                      {availableCategories.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => {
                            setSelectedCategory(cat.id);
                            setIsFilterDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-zinc-800 transition cursor-pointer ${
                            selectedCategory === cat.id ? 'text-white font-bold' : 'text-zinc-400'
                          }`}
                        >
                          <span>{cat.label}</span>
                          {selectedCategory === cat.id && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Dropdown: Ordenar */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setIsSortDropdownOpen(!isSortDropdownOpen);
                      setIsFilterDropdownOpen(false);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-300 hover:text-white text-xs font-medium transition cursor-pointer"
                  >
                    <span>
                      {sortBy === 'recent' ? 'Ordenar' : 'Mais antigos'}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                  </button>

                  {isSortDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-44 rounded-xl bg-[#121317] border border-[#202229] py-1.5 shadow-2xl z-30 space-y-0.5 text-xs animate-fade-in">
                      {[
                        { id: 'recent', label: 'Mais recentes' },
                        { id: 'oldest', label: 'Mais antigos' }
                      ].map((sortOption) => (
                        <button
                          key={sortOption.id}
                          onClick={() => {
                            setSortBy(sortOption.id as any);
                            setIsSortDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-zinc-800 transition cursor-pointer ${
                            sortBy === sortOption.id ? 'text-white font-bold' : 'text-zinc-400'
                          }`}
                        >
                          <span>{sortOption.label}</span>
                          {sortBy === sortOption.id && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ================= 3. LISTAGEM COMPACTA DE BIBLIOTECA PESSOAL ================= */}
          <div className="space-y-3">
            {displayedItems.length > 0 ? (
              displayedItems.map(({ event, metaText }) => {
                return (
                  <div
                    key={event.id}
                    onClick={() => onOpenEvent(event)}
                    className="group relative p-3 sm:p-4 rounded-2xl border border-[#1a1c22] bg-[#0e1014] hover:bg-[#13151b] hover:border-[#252832] transition-all cursor-pointer flex items-start gap-3 sm:gap-4"
                  >
                    {/* Thumbnail Quadrada Nítida (Mockup 01, 02, 06 & 07) */}
                    {event.imageUrl ? (
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-zinc-900 border border-[#202229] shrink-0">
                        <img
                          src={event.imageUrl}
                          alt={event.title}
                          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-zinc-900 border border-[#202229] flex items-center justify-center text-zinc-500 shrink-0">
                        <Bookmark className="w-6 h-6 stroke-[1.5]" />
                      </div>
                    )}

                    {/* Conteúdo Central */}
                    <div className="flex-1 min-w-0 space-y-1">
                      {/* Metadados: Categoria · Tempo decorrido (Mockup) */}
                      <div className="text-[11px] sm:text-xs font-medium text-zinc-400 flex items-center gap-1.5 truncate">
                        <span>{metaText}</span>
                      </div>

                      {/* Título Principal (2 a 3 linhas, fonte bold e limpa) */}
                      <h3 className="text-xs sm:text-sm font-bold text-white group-hover:text-zinc-100 transition-colors leading-snug line-clamp-2">
                        {event.title}
                      </h3>

                      {/* Resumo Curto no Desktop (Mockup 06 & 07) */}
                      <p className="hidden sm:block text-xs text-zinc-400 line-clamp-2 leading-relaxed pt-0.5">
                        {event.summary}
                      </p>

                      {/* Rodapé do Item: Contagem de fontes e Chips de entidades */}
                      <div className="flex items-center flex-wrap gap-2 pt-1">
                        <div className="flex items-center gap-1 text-[11px] font-medium text-zinc-400">
                          <Clock className="w-3 h-3 text-zinc-500" />
                          <span>{event.sources?.length || 5} fontes</span>
                        </div>

                        {/* Chips no Desktop (Mockup 06 & 07) */}
                        <div className="hidden sm:flex items-center gap-1.5">
                          {event.entities?.slice(0, 1).map((ent) => (
                            <span
                              key={ent.id}
                              className="px-2 py-0.5 rounded-md bg-[#16181f] border border-[#222530] text-[10px] text-zinc-300"
                            >
                              {ent.name}
                            </span>
                          ))}
                          {event.topics?.slice(0, 2).map((top) => (
                            <span
                              key={top.id}
                              className="px-2 py-0.5 rounded-md bg-[#16181f] border border-[#222530] text-[10px] text-zinc-400"
                            >
                              {top.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Ações à Direita: Botão Salvar / Desalvar + Menu "..." */}
                    <div
                      className="flex items-center gap-1 shrink-0 ml-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* No Histórico Mobile, botão de seta de abertura direta opcional */}
                      {activeTab === 'history' ? (
                        <button
                          onClick={() => onOpenEvent(event)}
                          className="sm:hidden p-2 rounded-xl text-zinc-400 hover:text-white transition cursor-pointer"
                          title="Abrir acontecimento"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      ) : null}

                      {/* Botão Marcador Salvar */}
                      <button
                        onClick={() => {
                          onToggleSaveEvent(event.id);
                          showToast(
                            event.isSaved
                              ? 'Acontecimento removido dos salvos.'
                              : 'Acontecimento guardado nos salvos.'
                          );
                        }}
                        className={`p-2 rounded-xl transition cursor-pointer ${
                          event.isSaved
                            ? 'text-white hover:text-zinc-300'
                            : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40'
                        }`}
                        title={event.isSaved ? 'Remover dos salvos' : 'Salvar acontecimento'}
                      >
                        <Bookmark
                          className="w-4 h-4"
                          fill={event.isSaved ? 'currentColor' : 'none'}
                        />
                      </button>

                      {/* Menu de Ações "..." (Dispara Action Sheet no Mobile ou Dropdown) */}
                      <button
                        onClick={() => setActiveMenuEvent(event)}
                        className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-zinc-800/50 transition cursor-pointer"
                        title="Mais opções"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              /* ================= 05 - EMPTY STATES (MOCKUP 05) ================= */
              <div className="py-16 px-6 text-center rounded-2xl border border-dashed border-[#1e2026] bg-[#0c0d11] space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
                  {activeTab === 'saved' ? (
                    <Bookmark className="w-6 h-6 stroke-[1.5]" />
                  ) : (
                    <Clock className="w-6 h-6 stroke-[1.5]" />
                  )}
                </div>

                <div className="max-w-sm mx-auto space-y-1.5">
                  <h3 className="text-base font-bold text-white">
                    {activeTab === 'saved' ? 'Salvos vazios' : 'Histórico vazio'}
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-line">
                    {activeTab === 'saved'
                      ? 'Nada salvo ainda.\nQuando encontrar um acontecimento que queira guardar, toque em Salvar.'
                      : 'Seu histórico ainda está vazio.\nOs acontecimentos que você abrir aparecerão aqui.'}
                  </p>
                </div>

                <div className="pt-2">
                  <button
                    onClick={onNavigateExplore}
                    className="px-6 py-2 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-bold transition shadow-sm cursor-pointer"
                  >
                    Explorar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ================= COLUNA LATERAL DESKTOP (MOCKUP 06 & 07 - 1440px) ================= */}
        <aside className="hidden lg:block lg:col-span-4 space-y-5 sticky top-6">
          
          {activeTab === 'saved' ? (
            /* ================= COLUNA LATERAL DE SALVOS (MOCKUP 06) ================= */
            <>
              {/* CARD 1: RESUMO (MOCKUP 06) */}
              <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3.5">
                <h4 className="text-xs font-bold text-white tracking-wide">
                  Resumo
                </h4>

                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#16181f] border border-[#20222a]">
                    <span className="text-zinc-400">Salvos no total</span>
                    <span className="font-mono font-bold text-white text-sm">
                      {savedTotalCount}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#16181f] border border-[#20222a]">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <EyeOff className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Não revisitados</span>
                    </div>
                    <span className="font-mono font-bold text-white text-sm">
                      {notViewedCount}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#16181f] border border-[#20222a]">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <Eye className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Já abertos</span>
                    </div>
                    <span className="font-mono font-bold text-white text-sm">
                      {viewedCount}
                    </span>
                  </div>
                </div>
              </div>

              {/* CARD 2: PASTAS (MOCKUP 06) */}
              <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white tracking-wide">
                    Pastas
                  </h4>
                  <button
                    onClick={() => setIsNewFolderModalOpen(true)}
                    className="w-6 h-6 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                    title="Criar nova pasta"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1 text-xs">
                  {/* Todos os salvos */}
                  <button
                    onClick={() => setSelectedFolder('all')}
                    className={`w-full flex items-center justify-between p-2 rounded-xl transition cursor-pointer ${
                      selectedFolder === 'all'
                        ? 'bg-zinc-800 text-white font-bold'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Folder className="w-4 h-4 text-zinc-400" />
                      <span>Todos os salvos</span>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {savedTotalCount}
                    </span>
                  </button>

                  {/* Pastas customizadas */}
                  {customFolders.map((folder) => {
                    const count = folderCounts[folder] || 0;
                    const isSelected = selectedFolder.toLowerCase() === folder.toLowerCase();

                    return (
                      <button
                        key={folder}
                        onClick={() =>
                          setSelectedFolder(isSelected ? 'all' : folder)
                        }
                        className={`w-full flex items-center justify-between p-2 rounded-xl transition cursor-pointer ${
                          isSelected
                            ? 'bg-zinc-800 text-white font-bold'
                            : 'text-zinc-400 hover:text-white hover:bg-zinc-800/40'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Folder className="w-4 h-4 text-zinc-500" />
                          <span>{folder}</span>
                        </div>
                        <span className="font-mono text-[11px] text-zinc-400">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* CARD 3: DICAS (MOCKUP 06) */}
              {showTipsCard && (
                <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111216] relative space-y-2">
                  <button
                    onClick={() => setShowTipsCard(false)}
                    className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
                    title="Fechar dica"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>

                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <Bookmark className="w-3.5 h-3.5 text-zinc-300" />
                    <span>Dica</span>
                  </div>

                  <p className="text-xs text-zinc-400 leading-relaxed pr-2">
                    Salve acontecimentos para ler depois e eles ficam organizados aqui.
                  </p>
                </div>
              )}
            </>
          ) : (
            /* ================= COLUNA LATERAL DE HISTÓRICO (MOCKUP 07) ================= */
            <>
              {/* CARD 1: AÇÕES (MOCKUP 07) */}
              <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
                <h4 className="text-xs font-bold text-white tracking-wide">
                  Ações
                </h4>

                <button
                  onClick={() => setIsClearHistoryModalOpen(true)}
                  disabled={historyItems.length === 0}
                  className="w-full py-2.5 rounded-xl border border-zinc-700 bg-transparent hover:bg-red-950/20 hover:border-red-900/40 text-white hover:text-red-400 text-xs font-bold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  Limpar histórico
                </button>

                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  O registro dos acontecimentos que você abrir será removido. Seus itens salvos não serão afetados.
                </p>
              </div>

              {/* CARD 2: CATEGORIAS (MOCKUP 07) */}
              <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
                <h4 className="text-xs font-bold text-white tracking-wide">
                  Categorias
                </h4>

                <div className="space-y-1 text-xs">
                  {/* Todos */}
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className={`w-full flex items-center justify-between p-2 rounded-xl transition cursor-pointer ${
                      selectedCategory === 'all'
                        ? 'bg-zinc-800 text-white font-bold'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Folder className="w-4 h-4 text-zinc-400" />
                      <span>Todos</span>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {historyCategoryCounts['all'] || 0}
                    </span>
                  </button>

                  {/* Lista de Categorias Reais do Mockup 07 */}
                  {['Tecnologia', 'Economia', 'Política', 'Esportes', 'Mundo', 'Saúde', 'Mercado'].map((cat) => {
                    const isSelected = selectedCategory.toLowerCase() === cat.toLowerCase();
                    const count = historyCategoryCounts[cat] || 0;

                    return (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(isSelected ? 'all' : cat)}
                        className={`w-full flex items-center justify-between p-2 rounded-xl transition cursor-pointer ${
                          isSelected
                            ? 'bg-zinc-800 text-white font-bold'
                            : 'text-zinc-400 hover:text-white hover:bg-zinc-800/40'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Folder className="w-4 h-4 text-zinc-500" />
                          <span>{cat}</span>
                        </div>
                        <span className="font-mono text-[11px] text-zinc-400">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
};
