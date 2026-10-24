/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
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
  ChevronLeft
} from 'lucide-react';
import { CompanyLogoBadge } from './CompanyLogoBadge';
import { notificationService } from '../services/notificationService';

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
}

interface NotificationsViewProps {
  events?: Event[];
  entities?: Entity[];
  onOpenEvent?: (event: Event) => void;
  onOpenEntity?: (entity: Entity) => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  events = [],
  entities = [],
  onOpenEvent,
  onOpenEntity
}) => {
  // Notificações reais: inicia vazio na fase beta conforme solicitado
  const [notifications, setNotifications] = useState<SinalNotificationItem[]>(() => {
    try {
      const saved = localStorage.getItem('sinal_notifications_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignorar erro de parse
    }
    return [];
  });

  const [activeTab, setActiveTab] = useState<NotificationCategory>('todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOnlyUnread, setFilterOnlyUnread] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  // Settings State
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('sinal_notif_settings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      urgentEvents: true,
      entityUpdates: true,
      topicAlerts: true,
      sourcesDigest: true,
      dailyBriefings: true,
      onlyHighRelevance: true
    };
  });

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

  const handleItemClick = (item: SinalNotificationItem) => {
    const updated = notifications.map((n) => (n.id === item.id ? { ...n, read: true } : n));
    setNotifications(updated);
    try {
      localStorage.setItem('sinal_notifications_v1', JSON.stringify(updated));
    } catch {}

    if (item.eventId && onOpenEvent) {
      const foundEvent = events.find((e) => e.id === item.eventId);
      if (foundEvent) {
        onOpenEvent(foundEvent);
        return;
      }
    }

    if (item.entityId && onOpenEntity) {
      const foundEntity = entities.find((e) => e.id === item.entityId);
      if (foundEntity) {
        onOpenEntity(foundEntity);
        return;
      }
    }
  };

  const handleMarkAllAsRead = () => {
    const updated = notifications.map((n) => ({ ...n, read: true }));
    setNotifications(updated);
    try {
      localStorage.setItem('sinal_notifications_v1', JSON.stringify(updated));
    } catch {}
    setFilterOnlyUnread(false);
  };

  const handleSaveSettings = () => {
    try {
      localStorage.setItem('sinal_notif_settings', JSON.stringify(settings));
    } catch {}
    setIsSettingsOpen(false);
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
      if (searchQuery.trim().length > 0) {
        const query = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(query) ||
          item.subtitle.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [notifications, activeTab, filterOnlyUnread, searchQuery]);

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
    <div className="flex-1 flex flex-col lg:flex-row w-full max-w-7xl mx-auto text-zinc-100">
      {/* ================= COLUNA PRINCIPAL ================= */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
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

          {/* Desktop Search & Ações Rápidas */}
          <div className="hidden sm:flex items-center gap-3">
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

            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer"
                title="Marcar todas como lidas"
              >
                <CheckCheck className="w-4 h-4" />
              </button>
            )}



            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-xl bg-[#111216] border border-[#1e2026] text-zinc-400 hover:text-white transition cursor-pointer"
              title="Configurações de notificações"
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
            onClick={() => setFilterOnlyUnread(!filterOnlyUnread)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ml-auto shrink-0 flex items-center gap-1.5 ${
              filterOnlyUnread
                ? 'bg-zinc-800 text-white border border-zinc-700'
                : 'bg-[#111216] text-zinc-400 hover:text-white border border-[#1e2026]'
            }`}
          >
            <span>Não lidas</span>
            {unreadCount > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            )}
          </button>
        </div>

        {/* LISTAGEM DE NOTIFICAÇÕES OU EMPTY STATE AUTÊNTICO */}
        {dateGroupKeys.length === 0 ? (
          <div className="p-10 sm:p-14 rounded-3xl border border-[#1e2026] bg-[#111216] text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500 shadow-lg">
              <Bell className="w-6 h-6 text-zinc-400" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h3 className="text-base font-bold text-white">Nenhuma notificação no momento</h3>
              <p className="text-xs sm:text-[13px] text-zinc-400 leading-relaxed">
                Você receberá notificações aqui em tempo real assim que surgirem acontecimentos urgentes, comunicados corporativos ou sínteses sobre as entidades que você segue.
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
                  className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer"
                >
                  Limpar filtros
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {dateGroupKeys.map((group) => (
              <section key={group} className="space-y-3">
                <h2 className="text-xs sm:text-sm font-bold text-zinc-300 tracking-wide">
                  {group}
                </h2>

                <div className="space-y-2">
                  {groupedByDate[group].map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleItemClick(item)}
                      className={`group relative p-3.5 sm:p-4 rounded-2xl border transition flex items-center justify-between gap-3.5 cursor-pointer ${
                        !item.read
                          ? 'bg-[#111216] border-[#22252e] hover:border-zinc-600 shadow-sm'
                          : 'bg-[#0d0e12] border-[#181a20] hover:bg-[#111216] hover:border-zinc-800 text-zinc-400'
                      }`}
                    >
                      {!item.read && (
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              item.unreadDotColor === 'blue' ? 'bg-blue-500' : 'bg-red-500'
                            }`}
                          />
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
              <label className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/50 cursor-pointer">
                <span>Acontecimentos urgentes</span>
                <input
                  type="checkbox"
                  checked={settings.urgentEvents}
                  onChange={(e) => setSettings({ ...settings, urgentEvents: e.target.checked })}
                  className="rounded border-zinc-700"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/50 cursor-pointer">
                <span>Atualizações de empresas seguidas</span>
                <input
                  type="checkbox"
                  checked={settings.entityUpdates}
                  onChange={(e) => setSettings({ ...settings, entityUpdates: e.target.checked })}
                  className="rounded border-zinc-700"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/50 cursor-pointer">
                <span>Alertas de temas monitorados</span>
                <input
                  type="checkbox"
                  checked={settings.topicAlerts}
                  onChange={(e) => setSettings({ ...settings, topicAlerts: e.target.checked })}
                  className="rounded border-zinc-700"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/50 cursor-pointer">
                <span>Avisos de Briefings diários</span>
                <input
                  type="checkbox"
                  checked={settings.dailyBriefings}
                  onChange={(e) => setSettings({ ...settings, dailyBriefings: e.target.checked })}
                  className="rounded border-zinc-700"
                />
              </label>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200"
              >
                Salvar Preferências
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
