/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Entity, Topic, Source } from '../types/sinal';
import {
  Search,
  Check,
  MoreHorizontal,
  ChevronDown,
  Users,
  Sparkles,
  Bell,
  BellOff,
  X,
  ExternalLink,
  ChevronRight,
  GraduationCap,
  Layers,
  ArrowRight,
  AlertTriangle
} from 'lucide-react';
import { CompanyLogoBadge } from './CompanyLogoBadge';
import { HorizontalFilterTabs } from './HorizontalFilterTabs';

interface FollowingViewProps {
  entities: Entity[];
  topics: Topic[];
  sources: Source[];
  onToggleFollowEntity: (id: string) => void;
  onToggleFollowTopic: (id: string) => void;
  onToggleFollowSource: (id: string) => void;
  onOpenEntity: (entity: Entity) => void;
  onNavigateExplore: () => void;
}

export type FollowedItemType = 'topic' | 'company' | 'person' | 'organization' | 'source';

export interface FollowedItem {
  id: string;
  name: string;
  itemType: FollowedItemType;
  typeLabel: string;
  category: string;
  description: string;
  recentEventsCount: number;
  brandColor?: string;
  website?: string;
  notificationsEnabled: boolean;
  briefingEnabled: boolean;
  originalRef: Entity | Topic | Source;
}

export const FollowingView: React.FC<FollowingViewProps> = ({
  entities,
  topics,
  sources,
  onToggleFollowEntity,
  onToggleFollowTopic,
  onToggleFollowSource,
  onOpenEntity,
  onNavigateExplore
}) => {
  // Filters & Search State
  const [activeTypeFilter, setActiveTypeFilter] = useState<'all' | 'topics' | 'companies' | 'people' | 'organizations' | 'sources'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'az' | 'active'>('recent');
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Unfollow Confirmation State
  const [unfollowTarget, setUnfollowTarget] = useState<FollowedItem | null>(null);

  // Active Menu / Notification Popover State
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [notificationConfigTarget, setNotificationConfigTarget] = useState<FollowedItem | null>(null);

  // Local notification preference overrides (item id -> config)
  const [itemNotifOverrides, setItemNotifOverrides] = useState<Record<string, { alerts: boolean; briefing: boolean }>>({});

  // Construir lista unificada de todos os itens seguidos
  const followedItems: FollowedItem[] = useMemo(() => {
    const list: FollowedItem[] = [];

    // 1. Entidades seguidas (Empresas, Pessoas, Organizações)
    entities
      .filter((e) => e.isFollowed)
      .forEach((e) => {
        let itemType: FollowedItemType = 'company';
        let typeLabel = 'Empresa';
        if (e.type === 'person') {
          itemType = 'person';
          typeLabel = 'Pessoa';
        } else if (e.type === 'organization') {
          itemType = 'organization';
          typeLabel = 'Organização';
        }

        const notif = itemNotifOverrides[e.id] || { alerts: true, briefing: true };

        list.push({
          id: e.id,
          name: e.name,
          itemType,
          typeLabel,
          category: e.sector || e.role || 'Tecnologia',
          description: e.description,
          recentEventsCount: e.recentEventsCount || 12,
          brandColor: e.brandColor,
          website: e.website,
          notificationsEnabled: notif.alerts,
          briefingEnabled: notif.briefing,
          originalRef: e
        });
      });

    // 2. Temas seguidos
    topics
      .filter((t) => t.isFollowed)
      .forEach((t) => {
        const notif = itemNotifOverrides[t.id] || { alerts: true, briefing: true };
        list.push({
          id: t.id,
          name: t.name,
          itemType: 'topic',
          typeLabel: 'Tema',
          category: t.category,
          description: t.description,
          recentEventsCount: t.recentEventsCount || 15,
          brandColor: t.brandColor,
          notificationsEnabled: notif.alerts,
          briefingEnabled: notif.briefing,
          originalRef: t
        });
      });

    // 3. Fontes seguidas
    sources
      .filter((s) => s.isFollowed)
      .forEach((s) => {
        const notif = itemNotifOverrides[s.id] || { alerts: true, briefing: true };
        list.push({
          id: s.id,
          name: s.name,
          itemType: 'source',
          typeLabel: 'Fonte de Notícias',
          category: s.category,
          description: `Veículo jornalístico • ${s.domain}`,
          recentEventsCount: s.recentEventsCount || 50,
          brandColor: s.brandColor,
          notificationsEnabled: notif.alerts,
          briefingEnabled: notif.briefing,
          originalRef: s
        });
      });

    return list;
  }, [entities, topics, sources, itemNotifOverrides]);

  // Contagens reais por tipo para os filtros do topo
  const countAll = followedItems.length;
  const countTopics = followedItems.filter((i) => i.itemType === 'topic').length;
  const countCompanies = followedItems.filter((i) => i.itemType === 'company').length;
  const countPeople = followedItems.filter((i) => i.itemType === 'person').length;
  const countOrganizations = followedItems.filter((i) => i.itemType === 'organization').length;
  const countSources = followedItems.filter((i) => i.itemType === 'source').length;

  // Filtragem e Ordenação
  const filteredAndSortedItems = useMemo(() => {
    let result = followedItems;

    // Filtro por tipo
    if (activeTypeFilter === 'topics') result = result.filter((i) => i.itemType === 'topic');
    else if (activeTypeFilter === 'companies') result = result.filter((i) => i.itemType === 'company');
    else if (activeTypeFilter === 'people') result = result.filter((i) => i.itemType === 'person');
    else if (activeTypeFilter === 'organizations') result = result.filter((i) => i.itemType === 'organization');
    else if (activeTypeFilter === 'sources') result = result.filter((i) => i.itemType === 'source');

    // Busca apenas no que o usuário segue
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q)
      );
    }

    // Ordenação
    if (sortBy === 'az') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'active') {
      result = [...result].sort((a, b) => b.recentEventsCount - a.recentEventsCount);
    }

    return result;
  }, [followedItems, activeTypeFilter, searchQuery, sortBy]);

  // Executar Unfollow com confirmação
  const confirmUnfollow = () => {
    if (!unfollowTarget) return;

    if (unfollowTarget.id.startsWith('ent-')) {
      onToggleFollowEntity(unfollowTarget.id);
    } else if (unfollowTarget.id.startsWith('top-')) {
      onToggleFollowTopic(unfollowTarget.id);
    } else if (unfollowTarget.id.startsWith('src-')) {
      onToggleFollowSource(unfollowTarget.id);
    }

    setUnfollowTarget(null);
  };

  // Helper de renderização do logo ou ícone
  const renderItemLogo = (item: FollowedItem) => {
    return (
      <CompanyLogoBadge
        name={item.name}
        brandColor={item.brandColor}
        type={item.itemType}
        size="md"
      />
    );
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-7 pb-20 sm:pb-12 text-zinc-100 font-sans">
      
      {/* 1. Header do Painel Seguindo */}
      <div className="space-y-1 pt-1">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Seguindo
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400">
          Tudo o que você acompanha no seu FatosBR.
        </p>
      </div>

      {/* 2. Campo de Busca no que você segue (com ⌘ K) */}
      <div className="relative w-full">
        <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-zinc-500" />
        <input
          type="text"
          placeholder="Buscar no que você segue..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[#111216] border border-[#1e2026] rounded-xl pl-10 pr-12 py-3 text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 transition shadow-sm"
        />
        {searchQuery ? (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3.5 top-3 text-zinc-500 hover:text-white p-0.5 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <span className="hidden sm:inline-block absolute right-3.5 top-3 text-[10px] font-mono text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
            ⌘ K
          </span>
        )}
      </div>

      {/* 3. Filtros por Tipo (HorizontalFilterTabs padronizado sem scrollbar defeituosa) */}
      <HorizontalFilterTabs
        tabs={[
          { id: 'all', label: 'Todos', count: countAll },
          { id: 'topics', label: 'Temas', count: countTopics },
          { id: 'companies', label: 'Empresas', count: countCompanies },
          { id: 'people', label: 'Pessoas', count: countPeople },
          { id: 'organizations', label: 'Organizações', count: countOrganizations },
          { id: 'sources', label: 'Fontes', count: countSources }
        ]}
        activeTabId={activeTypeFilter}
        onSelectTab={(id) => setActiveTypeFilter(id as any)}
        ariaLabel="Filtros por tipo de item seguido"
      />

      {/* 4. Resumo de Contadores Desktop (6 Cards Estatísticos no Mockup 02) */}
      <div className="hidden sm:grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111215] space-y-1">
          <div className="text-xl font-bold text-white">{countAll}</div>
          <div className="text-xs font-semibold text-white">Itens seguidos</div>
          <div className="text-[11px] text-zinc-500">Total no seu FatosBR</div>
        </div>

        <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111215] space-y-1">
          <div className="text-xl font-bold text-white">{countTopics}</div>
          <div className="text-xs font-semibold text-white">Temas</div>
          <div className="text-[11px] text-zinc-500">Assuntos que você acompanha</div>
        </div>

        <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111215] space-y-1">
          <div className="text-xl font-bold text-white">{countCompanies}</div>
          <div className="text-xs font-semibold text-white">Empresas</div>
          <div className="text-[11px] text-zinc-500">Empresas e marcas</div>
        </div>

        <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111215] space-y-1">
          <div className="text-xl font-bold text-white">{countPeople}</div>
          <div className="text-xs font-semibold text-white">Pessoas</div>
          <div className="text-[11px] text-zinc-500">Personalidades</div>
        </div>

        <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111215] space-y-1">
          <div className="text-xl font-bold text-white">{countSources}</div>
          <div className="text-xs font-semibold text-white">Fontes</div>
          <div className="text-[11px] text-zinc-500">Veículos de notícias</div>
        </div>

        <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111215] space-y-1">
          <div className="text-xl font-bold text-white">{countOrganizations}</div>
          <div className="text-xs font-semibold text-white">Organizações</div>
          <div className="text-[11px] text-zinc-500">Instituições e entidades</div>
        </div>
      </div>

      {/* Versão Resumo Mobile (Card Compacto Conforme Mockup 01) */}
      <div className="sm:hidden p-3.5 rounded-2xl border border-[#1e2026] bg-[#111215] flex items-center justify-between">
        <div className="flex items-center space-x-3 text-xs text-zinc-300 font-semibold">
          <Users className="w-4 h-4 text-zinc-400" />
          <span>{countAll} itens seguidos</span>
        </div>
        <ChevronRight className="w-4 h-4 text-zinc-500" />
      </div>

      {/* 5. Lista de Itens Seguidos */}
      <section className="space-y-4">
        {/* Header da Lista com Ordenação */}
        <div className="flex items-center justify-between pb-1">
          <h2 className="text-base font-bold text-white tracking-tight">
            Seus seguidos
          </h2>

          <div className="relative">
            <div className="flex items-center space-x-2 text-xs text-zinc-400">
              <span className="hidden sm:inline">Ordenar por</span>
              <button
                onClick={() => setShowSortDropdown(!showSortDropdown)}
                className="px-3 py-1.5 rounded-xl border border-[#1e2026] bg-[#111215] hover:border-zinc-700 text-zinc-200 flex items-center gap-1.5 cursor-pointer text-xs font-medium"
              >
                <span>
                  {sortBy === 'recent' ? 'Mais recentes' : sortBy === 'az' ? 'A-Z' : 'Mais ativos'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            </div>

            {/* Dropdown de Ordenação */}
            {showSortDropdown && (
              <div className="absolute right-0 top-9 w-40 rounded-xl border border-zinc-800 bg-[#0e0f13] shadow-2xl p-1 z-30 text-xs space-y-0.5">
                <button
                  onClick={() => {
                    setSortBy('recent');
                    setShowSortDropdown(false);
                  }}
                  className={`w-full px-3 py-1.5 rounded-lg text-left transition cursor-pointer ${
                    sortBy === 'recent' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Mais recentes
                </button>
                <button
                  onClick={() => {
                    setSortBy('az');
                    setShowSortDropdown(false);
                  }}
                  className={`w-full px-3 py-1.5 rounded-lg text-left transition cursor-pointer ${
                    sortBy === 'az' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  A-Z
                </button>
                <button
                  onClick={() => {
                    setSortBy('active');
                    setShowSortDropdown(false);
                  }}
                  className={`w-full px-3 py-1.5 rounded-lg text-left transition cursor-pointer ${
                    sortBy === 'active' ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Mais ativos
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Lista de Rows Compactas */}
        {filteredAndSortedItems.length > 0 ? (
          <div className="space-y-2.5">
            {filteredAndSortedItems.map((item) => (
              <div
                key={item.id}
                className="p-3.5 sm:p-4 rounded-2xl border border-[#1e2026] bg-[#111215] hover:border-zinc-700/80 transition flex items-center justify-between gap-3 group"
              >
                {/* Lado Esquerdo: Logo, Nome, Categoria e Descrição */}
                <div
                  onClick={() => {
                    if (item.id.startsWith('ent-')) {
                      onOpenEntity(item.originalRef as Entity);
                    }
                  }}
                  className="flex items-center space-x-3.5 flex-1 overflow-hidden cursor-pointer"
                >
                  {renderItemLogo(item)}

                  <div className="space-y-0.5 overflow-hidden flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-bold text-white group-hover:underline truncate">
                        {item.name}
                      </span>
                    </div>

                    <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 truncate">
                      <span>{item.typeLabel}</span>
                      <span className="text-zinc-600">•</span>
                      <span>{item.category}</span>
                    </div>

                    {/* Descrição em telas maiores */}
                    <p className="hidden md:block text-xs text-zinc-400 truncate max-w-xl">
                      {item.description}
                    </p>
                  </div>
                </div>

                {/* Centro/Direita: Eventos Recentes */}
                <div className="hidden lg:block text-right pr-2 shrink-0">
                  <div className="text-xs text-zinc-400 font-mono">
                    {item.recentEventsCount} eventos recentes
                  </div>
                </div>

                {/* Lado Direito: Botão "Seguindo" & Menu "..." */}
                <div className="flex items-center space-x-2 shrink-0">
                  {/* Botão "Seguindo" com visual do Mockup */}
                  <button
                    onClick={() => setUnfollowTarget(item)}
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#252830] bg-[#16181e] hover:bg-[#1a1d24] text-xs font-semibold text-zinc-200 transition cursor-pointer"
                    title="Gerenciar follow"
                  >
                    <span>Seguindo</span>
                    <ChevronDown className="w-3 h-3 text-zinc-400" />
                  </button>

                  {/* Menu "..." */}
                  <div className="relative">
                    <button
                      onClick={() => setActiveMenuId(activeMenuId === item.id ? null : item.id)}
                      className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer"
                      title="Mais ações"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>

                    {/* Dropdown de Ações */}
                    {activeMenuId === item.id && (
                      <div
                        className="absolute right-0 top-9 w-52 rounded-xl border border-zinc-800 bg-[#0e0f13] shadow-2xl p-1.5 z-30 text-xs space-y-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.id.startsWith('ent-') && (
                          <button
                            onClick={() => {
                              setActiveMenuId(null);
                              onOpenEntity(item.originalRef as Entity);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-zinc-300 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                            <span>Ver página da entidade</span>
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setActiveMenuId(null);
                            setNotificationConfigTarget(item);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-zinc-300 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                        >
                          <Bell className="w-3.5 h-3.5 text-zinc-400" />
                          <span>Ajustar notificações</span>
                        </button>

                        <button
                          onClick={() => {
                            setActiveMenuId(null);
                            setUnfollowTarget(item);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-red-400 hover:text-red-300 hover:bg-red-950/30 transition cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Deixar de seguir</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Empty State Conforme Diretriz 29 */
          <div className="rounded-2xl border border-[#1e2026] bg-[#111215] p-10 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
              <Users className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">
                {searchQuery ? 'Nenhum item seguido encontrado.' : 'Você ainda não segue nada.'}
              </h3>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto leading-relaxed">
                {searchQuery
                  ? 'Tente ajustar os termos da sua pesquisa ou limpe o filtro.'
                  : 'Explore temas, pessoas, empresas e fontes para montar o seu FatosBR personalizado.'}
              </p>
            </div>
            <div>
              {searchQuery ? (
                <button
                  onClick={() => setSearchQuery('')}
                  className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer"
                >
                  Limpar busca
                </button>
              ) : (
                <button
                  onClick={onNavigateExplore}
                  className="px-5 py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer flex items-center gap-2 mx-auto"
                >
                  <span>Explorar agora</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ================= 6. MODAL DE CONFIRMAÇÃO: DEIXAR DE SEGUIR (Diretrizes 11 e 12) ================= */}
      {unfollowTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0e0f13] p-6 space-y-4 shadow-2xl text-center">
            <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-300">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">
                Deixar de seguir {unfollowTarget.name}?
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Você deixará de receber acontecimentos prioritários sobre este item no seu feed &ldquo;Para você&rdquo; e nos briefings diários.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-2">
              <button
                onClick={() => setUnfollowTarget(null)}
                className="py-2.5 px-3 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-semibold text-zinc-300 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={confirmUnfollow}
                className="py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition cursor-pointer shadow-lg shadow-red-900/20"
              >
                Deixar de seguir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 7. MODAL DE AJUSTE DE NOTIFICAÇÕES (Diretriz 14) ================= */}
      {notificationConfigTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0e0f13] p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <Bell className="w-4 h-4 text-zinc-300" />
                <h3 className="text-sm font-bold text-white">
                  Notificações • {notificationConfigTarget.name}
                </h3>
              </div>
              <button
                onClick={() => setNotificationConfigTarget(null)}
                className="p-1 text-zinc-500 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="flex items-center justify-between p-3 rounded-xl border border-[#1e2026] bg-[#121418]">
                <div>
                  <div className="font-semibold text-white">Alertas importantes</div>
                  <div className="text-[11px] text-zinc-400">Avisos imediatos no app</div>
                </div>
                <input
                  type="checkbox"
                  checked={notificationConfigTarget.notificationsEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setItemNotifOverrides((prev) => ({
                      ...prev,
                      [notificationConfigTarget.id]: {
                        alerts: checked,
                        briefing: prev[notificationConfigTarget.id]?.briefing ?? true
                      }
                    }));
                    setNotificationConfigTarget((prev) =>
                      prev ? { ...prev, notificationsEnabled: checked } : null
                    );
                  }}
                  className="w-4 h-4 accent-white cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl border border-[#1e2026] bg-[#121418]">
                <div>
                  <div className="font-semibold text-white">Incluir no Briefing</div>
                  <div className="text-[11px] text-zinc-400">Resumo da manhã e noite</div>
                </div>
                <input
                  type="checkbox"
                  checked={notificationConfigTarget.briefingEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setItemNotifOverrides((prev) => ({
                      ...prev,
                      [notificationConfigTarget.id]: {
                        alerts: prev[notificationConfigTarget.id]?.alerts ?? true,
                        briefing: checked
                      }
                    }));
                    setNotificationConfigTarget((prev) =>
                      prev ? { ...prev, briefingEnabled: checked } : null
                    );
                  }}
                  className="w-4 h-4 accent-white cursor-pointer"
                />
              </div>
            </div>

            <button
              onClick={() => setNotificationConfigTarget(null)}
              className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer"
            >
              Salvar preferências
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
