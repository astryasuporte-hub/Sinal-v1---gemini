/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Entity, Topic, Source, Event } from '../types/sinal';
import {
  EXPLORE_CATEGORIES,
  EXPLORE_TRENDING_ITEMS
} from '../data/mockData';
import { CompanyLogoBadge } from './CompanyLogoBadge';
import {
  Search,
  Check,
  Plus,
  Sparkles,
  Laptop,
  BarChart3,
  Coins,
  Landmark,
  Trophy,
  Film,
  FlaskConical,
  Globe,
  Flame,
  ChevronRight,
  Layers,
  Building2,
  User,
  ExternalLink,
  SlidersHorizontal,
  X
} from 'lucide-react';

interface ExploreViewProps {
  entities: Entity[];
  topics: Topic[];
  sources: Source[];
  events: Event[];
  onToggleFollowEntity: (id: string) => void;
  onToggleFollowTopic: (id: string) => void;
  onToggleFollowSource: (id: string) => void;
  onOpenEntity: (entity: Entity) => void;
  onOpenEvent: (event: Event) => void;
}

export const ExploreView: React.FC<ExploreViewProps> = ({
  entities,
  topics,
  sources,
  events,
  onToggleFollowEntity,
  onToggleFollowTopic,
  onToggleFollowSource,
  onOpenEntity,
  onOpenEvent
}) => {
  // Search & Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPillCategory, setSelectedPillCategory] = useState<string>('all');
  const [selectedSubTab, setSelectedSubTab] = useState<'companies' | 'people' | 'organizations' | 'sources' | 'topics'>('companies');

  // Categories list matching executive intelligence sectors
  const pillCategories = [
    { id: 'all', label: 'Todos' },
    { id: 'Macro & Mercados', label: 'Macro & Mercados' },
    { id: 'Regulação & Políticas Públicas', label: 'Regulação' },
    { id: 'M&A & Finanças Corporativas', label: 'M&A & Finanças' },
    { id: 'Tech & Inovação', label: 'Tech & Inovação' },
    { id: 'Energia & Commodities', label: 'Energia & Commodities' },
    { id: 'Geopolítica Global', label: 'Geopolítica' },
    { id: 'Organizações', label: 'Organizações' },
    { id: 'Fontes', label: 'Fontes' }
  ];
  // Helper para renderizar logo com monograma ou ícone oficial
  const renderEntityLogo = (name: string, brandColor?: string, customType?: string) => {
    return <CompanyLogoBadge name={name} brandColor={brandColor} type={customType} size="md" />;
  };

  // Helper para ícones de categorias
  const renderCategoryIcon = (iconName: string) => {
    switch (iconName) {
      case 'laptop':
        return <Laptop className="w-5 h-5 text-zinc-300" />;
      case 'chart':
        return <BarChart3 className="w-5 h-5 text-zinc-300" />;
      case 'coins':
        return <Coins className="w-5 h-5 text-zinc-300" />;
      case 'landmark':
        return <Landmark className="w-5 h-5 text-zinc-300" />;
      case 'flame':
        return <Flame className="w-5 h-5 text-zinc-300" />;
      case 'soccer':
        return <Trophy className="w-5 h-5 text-zinc-300" />;
      case 'film':
        return <Film className="w-5 h-5 text-zinc-300" />;
      case 'flask':
        return <FlaskConical className="w-5 h-5 text-zinc-300" />;
      case 'globe':
        return <Globe className="w-5 h-5 text-zinc-300" />;
      default:
        return <BarChart3 className="w-5 h-5 text-zinc-300" />;
    }
  };

  // Separação de Entidades por Tipo
  const companies = useMemo(() => entities.filter((e) => e.type === 'company'), [entities]);
  const people = useMemo(() => entities.filter((e) => e.type === 'person'), [entities]);
  const organizations = useMemo(() => entities.filter((e) => e.type === 'organization'), [entities]);

  // Busca Multientidade com Debounce
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;

    const matchedCompanies = companies.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.sector && c.sector.toLowerCase().includes(q))
    );
    const matchedPeople = people.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.role && p.role.toLowerCase().includes(q))
    );
    const matchedOrgs = organizations.filter(
      (o) => o.name.toLowerCase().includes(q) || (o.sector && o.sector.toLowerCase().includes(q))
    );
    const matchedTopics = topics.filter(
      (t) => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
    );
    const matchedSources = sources.filter(
      (s) => s.name.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q)
    );
    const matchedEvents = events.filter(
      (ev) => ev.title.toLowerCase().includes(q) || ev.summary.toLowerCase().includes(q)
    );

    const totalCount =
      matchedCompanies.length +
      matchedPeople.length +
      matchedOrgs.length +
      matchedTopics.length +
      matchedSources.length +
      matchedEvents.length;

    return {
      query: q,
      totalCount,
      companies: matchedCompanies,
      people: matchedPeople,
      organizations: matchedOrgs,
      topics: matchedTopics,
      sources: matchedSources,
      events: matchedEvents
    };
  }, [searchQuery, companies, people, organizations, topics, sources, events]);

  // Trending items list
  const trendingList = EXPLORE_TRENDING_ITEMS.map((item) => {
    // sincroniza follow state
    const foundEntity = entities.find((e) => e.id === item.id);
    const foundTopic = topics.find((t) => t.id === item.id);
    const isFollowed = foundEntity ? foundEntity.isFollowed : foundTopic ? foundTopic.isFollowed : item.isFollowed;
    return { ...item, isFollowed };
  });

  const handleToggleTrending = (item: typeof trendingList[0]) => {
    if (item.id.startsWith('ent-')) {
      onToggleFollowEntity(item.id);
    } else if (item.id.startsWith('top-')) {
      onToggleFollowTopic(item.id);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-7 pb-20 sm:pb-12 text-zinc-100 font-sans">
      
      {/* 1. Header: Título & Subtexto Conforme Mockup */}
      <div className="space-y-1 pt-1">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Explorar
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400">
          Descubra temas, empresas, pessoas e fontes para montar o seu FatosBR.
        </p>
      </div>

      {/* 2. Campo de Busca Principal (com ⌘ K) */}
      <div className="relative w-full">
        <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-zinc-500" />
        <input
          type="text"
          placeholder="Procure temas, pessoas, empresas, organizações ou fontes..."
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

      {/* 3. Pills de Categorias (Horizontal Scroll) */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 no-scrollbar">
        {pillCategories.map((cat) => {
          const isActive = selectedPillCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedPillCategory(cat.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-white text-black shadow-sm'
                  : 'bg-[#111215] text-zinc-400 hover:text-white border border-[#1e2026]'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* ================= SEÇÃO: RESULTADOS DA BUSCA (SE DIGITADO) ================= */}
      {searchResults !== null ? (
        <div className="space-y-6 pt-2">
          <div className="flex items-center justify-between text-xs text-zinc-400 border-b border-zinc-800 pb-3">
            <span>Resultados para &ldquo;{searchResults.query}&rdquo;</span>
            <span className="font-mono">{searchResults.totalCount} encontrado(s)</span>
          </div>

          {searchResults.totalCount === 0 ? (
            <div className="rounded-2xl border border-[#1e2026] bg-[#111215] p-10 text-center space-y-3">
              <Search className="w-8 h-8 mx-auto text-zinc-600" />
              <h3 className="text-sm font-bold text-white">Não encontramos nada para essa busca.</h3>
              <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                Tente outro termo ou explore uma categoria abaixo.
              </p>
              <button
                onClick={() => setSearchQuery('')}
                className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer"
              >
                Limpar busca
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Empresas Encontradas */}
              {searchResults.companies.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">
                    Empresas ({searchResults.companies.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {searchResults.companies.map((c) => (
                      <div
                        key={c.id}
                        className="p-3.5 rounded-xl border border-[#1e2026] bg-[#111215] flex items-center justify-between hover:border-zinc-700 transition"
                      >
                        <div
                          onClick={() => onOpenEntity(c)}
                          className="flex items-center space-x-3 cursor-pointer overflow-hidden"
                        >
                          {renderEntityLogo(c.name, c.brandColor)}
                          <div className="overflow-hidden">
                            <div className="text-xs font-bold text-white truncate">{c.name}</div>
                            <div className="text-[11px] text-zinc-400 truncate">{c.sector}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => onToggleFollowEntity(c.id)}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer shrink-0 ml-2 ${
                            c.isFollowed
                              ? 'bg-zinc-800 text-white border border-zinc-700'
                              : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800'
                          }`}
                        >
                          {c.isFollowed ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pessoas Encontradas */}
              {searchResults.people.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">
                    Pessoas ({searchResults.people.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {searchResults.people.map((p) => (
                      <div
                        key={p.id}
                        className="p-3.5 rounded-xl border border-[#1e2026] bg-[#111215] flex items-center justify-between hover:border-zinc-700 transition"
                      >
                        <div
                          onClick={() => onOpenEntity(p)}
                          className="flex items-center space-x-3 cursor-pointer overflow-hidden"
                        >
                          {renderEntityLogo(p.name, p.brandColor)}
                          <div className="overflow-hidden">
                            <div className="text-xs font-bold text-white truncate">{p.name}</div>
                            <div className="text-[11px] text-zinc-400 truncate">{p.sector || p.role}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => onToggleFollowEntity(p.id)}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer shrink-0 ml-2 ${
                            p.isFollowed
                              ? 'bg-zinc-800 text-white border border-zinc-700'
                              : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800'
                          }`}
                        >
                          {p.isFollowed ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Temas Encontrados */}
              {searchResults.topics.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">
                    Temas ({searchResults.topics.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {searchResults.topics.map((t) => (
                      <div
                        key={t.id}
                        className="p-3.5 rounded-xl border border-[#1e2026] bg-[#111215] flex items-center justify-between hover:border-zinc-700 transition"
                      >
                        <div className="flex items-center space-x-3 overflow-hidden">
                          {renderEntityLogo(t.name, t.brandColor, 'Tema')}
                          <div className="overflow-hidden">
                            <div className="text-xs font-bold text-white truncate">{t.name}</div>
                            <div className="text-[11px] text-zinc-400 truncate">{t.category}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => onToggleFollowTopic(t.id)}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer shrink-0 ml-2 ${
                            t.isFollowed
                              ? 'bg-zinc-800 text-white border border-zinc-700'
                              : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800'
                          }`}
                        >
                          {t.isFollowed ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Fontes Encontradas */}
              {searchResults.sources.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">
                    Fontes ({searchResults.sources.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {searchResults.sources.map((s) => (
                      <div
                        key={s.id}
                        className="p-3.5 rounded-xl border border-[#1e2026] bg-[#111215] flex items-center justify-between hover:border-zinc-700 transition"
                      >
                        <div className="flex items-center space-x-3 overflow-hidden">
                          {renderEntityLogo(s.name, s.brandColor)}
                          <div className="overflow-hidden">
                            <div className="text-xs font-bold text-white truncate">{s.name}</div>
                            <div className="text-[11px] text-zinc-400 truncate">{s.domain}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => onToggleFollowSource(s.id)}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer shrink-0 ml-2 ${
                            s.isFollowed
                              ? 'bg-zinc-800 text-white border border-zinc-700'
                              : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800'
                          }`}
                        >
                          {s.isFollowed ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ================= VISTA PADRÃO: EM ALTA + CATEGORIAS + SUBTABS ================= */
        <div className="space-y-9">
          {/* 4. SEÇÃO: EM ALTA AGORA (Mockup 01 Mobile & 02 Desktop) */}
          <section className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white tracking-tight">
                Em alta agora
              </h2>
              <button
                onClick={() => setSelectedPillCategory('all')}
                className="text-xs text-zinc-400 hover:text-white transition flex items-center gap-0.5 cursor-pointer"
              >
                <span>Ver todos</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Mobile: Lista Vertical Compacta 1-5 / Desktop: Grid Horizontal 6 Cards */}
            {/* Versão Desktop (Grid de 6 cards horizontais) */}
            <div className="hidden sm:grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {trendingList.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-2xl border border-[#1e2026] bg-[#111215] hover:border-zinc-700 transition flex flex-col justify-between space-y-3 text-center items-center group"
                >
                  <div className="w-full flex justify-between items-center text-[10px] text-zinc-500 font-mono">
                    <span className="w-4 h-4 rounded-full bg-zinc-900 flex items-center justify-center font-bold">
                      {item.rank}
                    </span>
                  </div>

                  <div className="flex flex-col items-center space-y-1.5">
                    {renderEntityLogo(item.name, item.brandColor, item.type)}
                    <div>
                      <div className="text-xs font-bold text-white truncate max-w-[120px]">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-zinc-400 font-medium">
                        {item.type}
                      </div>
                    </div>
                  </div>

                  <div className="w-full space-y-2">
                    <div className="text-[10px] text-zinc-500 font-mono">
                      {item.interestCount}
                    </div>
                    <button
                      onClick={() => handleToggleTrending(item)}
                      className={`w-full py-1.5 px-2 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1 ${
                        item.isFollowed
                          ? 'bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700'
                          : 'bg-white text-black hover:bg-zinc-200 shadow-sm'
                      }`}
                    >
                      {item.isFollowed ? (
                        <>
                          <Check className="w-3 h-3" />
                          <span>Seguindo</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" />
                          <span>Seguir</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Versão Mobile (Lista Vertical 1 a 5 exatamente como Painel 01 do Mockup) */}
            <div className="sm:hidden space-y-2.5">
              {trendingList.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-2xl border border-[#1e2026] bg-[#111215] flex items-center justify-between"
                >
                  <div className="flex items-center space-x-3 overflow-hidden">
                    <span className="font-mono text-xs font-bold text-zinc-500 w-4 text-center">
                      {item.rank}
                    </span>
                    {renderEntityLogo(item.name, item.brandColor, item.type)}
                    <div className="overflow-hidden">
                      <div className="text-xs font-bold text-white truncate">{item.name}</div>
                      <div className="text-[10px] text-zinc-400">
                        {item.type} • {item.category}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleToggleTrending(item)}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer shrink-0 ml-2 ${
                      item.isFollowed
                        ? 'bg-zinc-800 text-white border border-zinc-700'
                        : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                    }`}
                  >
                    {item.isFollowed ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* 5. SEÇÃO: CATEGORIAS (Mockup 01 e 02) */}
          <section className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white tracking-tight">
                Categorias
              </h2>
              <button
                onClick={() => setSelectedPillCategory('all')}
                className="text-xs text-zinc-400 hover:text-white transition flex items-center gap-0.5 cursor-pointer"
              >
                <span>Ver todas</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Grid de Categorias com Ícones */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {EXPLORE_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedPillCategory(cat.name)}
                  className="p-3.5 rounded-2xl border border-[#1e2026] bg-[#111215] hover:border-zinc-700/80 hover:bg-[#14161b] transition flex flex-col items-center justify-center text-center space-y-2 cursor-pointer group"
                >
                  <div className="w-9 h-9 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-center group-hover:scale-105 transition-transform">
                    {renderCategoryIcon(cat.icon)}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white leading-snug">{cat.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                      {cat.interestsCount}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* 6. SEÇÃO: SUBTABS (Empresas, Pessoas, Organizações, Fontes, Temas) - Painel 02 */}
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1a1c22] pb-3">
              <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 no-scrollbar">
                <button
                  onClick={() => setSelectedSubTab('companies')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer shrink-0 ${
                    selectedSubTab === 'companies'
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-transparent text-zinc-400 hover:text-white'
                  }`}
                >
                  Empresas
                </button>
                <button
                  onClick={() => setSelectedSubTab('people')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer shrink-0 ${
                    selectedSubTab === 'people'
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-transparent text-zinc-400 hover:text-white'
                  }`}
                >
                  Pessoas
                </button>
                <button
                  onClick={() => setSelectedSubTab('organizations')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer shrink-0 ${
                    selectedSubTab === 'organizations'
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-transparent text-zinc-400 hover:text-white'
                  }`}
                >
                  Organizações
                </button>
                <button
                  onClick={() => setSelectedSubTab('fontes' as any)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer shrink-0 ${
                    selectedSubTab === ('fontes' as any)
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-transparent text-zinc-400 hover:text-white'
                  }`}
                >
                  Fontes
                </button>
                <button
                  onClick={() => setSelectedSubTab('topics')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer shrink-0 ${
                    selectedSubTab === 'topics'
                      ? 'bg-white text-black shadow-sm'
                      : 'bg-transparent text-zinc-400 hover:text-white'
                  }`}
                >
                  Temas
                </button>
              </div>

              <span className="text-xs text-zinc-500 font-mono self-end sm:self-auto">
                {selectedSubTab === 'companies' && `${companies.length} empresas`}
                {selectedSubTab === 'people' && `${people.length} pessoas`}
                {selectedSubTab === 'organizations' && `${organizations.length} organizações`}
                {selectedSubTab === ('fontes' as any) && `${sources.length} fontes`}
                {selectedSubTab === 'topics' && `${topics.length} temas`}
              </span>
            </div>

            {/* Grid 3x3 de Entidades */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              
              {/* Empresas */}
              {selectedSubTab === 'companies' &&
                companies.map((company) => (
                  <div
                    key={company.id}
                    className="p-3.5 rounded-2xl border border-[#1e2026] bg-[#111215] hover:border-zinc-700/80 transition flex items-center justify-between"
                  >
                    <div
                      onClick={() => onOpenEntity(company)}
                      className="flex items-center space-x-3 cursor-pointer overflow-hidden flex-1"
                    >
                      {renderEntityLogo(company.name, company.brandColor)}
                      <div className="overflow-hidden">
                        <div className="text-xs font-bold text-white truncate">{company.name}</div>
                        <div className="text-[11px] text-zinc-400 truncate">{company.sector}</div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                          {company.interestCount || '+ 6K interesses'}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onToggleFollowEntity(company.id)}
                      className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer shrink-0 ml-2 ${
                        company.isFollowed
                          ? 'bg-zinc-800 text-white border border-zinc-700'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                      }`}
                    >
                      {company.isFollowed ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    </button>
                  </div>
                ))}

              {/* Pessoas */}
              {selectedSubTab === 'people' &&
                people.map((person) => (
                  <div
                    key={person.id}
                    className="p-3.5 rounded-2xl border border-[#1e2026] bg-[#111215] hover:border-zinc-700/80 transition flex items-center justify-between"
                  >
                    <div
                      onClick={() => onOpenEntity(person)}
                      className="flex items-center space-x-3 cursor-pointer overflow-hidden flex-1"
                    >
                      {renderEntityLogo(person.name, person.brandColor)}
                      <div className="overflow-hidden">
                        <div className="text-xs font-bold text-white truncate">{person.name}</div>
                        <div className="text-[11px] text-zinc-400 truncate">{person.role || person.sector}</div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                          {person.interestCount || '+ 5K interesses'}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onToggleFollowEntity(person.id)}
                      className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer shrink-0 ml-2 ${
                        person.isFollowed
                          ? 'bg-zinc-800 text-white border border-zinc-700'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                      }`}
                    >
                      {person.isFollowed ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    </button>
                  </div>
                ))}

              {/* Organizações */}
              {selectedSubTab === 'organizations' &&
                organizations.map((org) => (
                  <div
                    key={org.id}
                    className="p-3.5 rounded-2xl border border-[#1e2026] bg-[#111215] hover:border-zinc-700/80 transition flex items-center justify-between"
                  >
                    <div
                      onClick={() => onOpenEntity(org)}
                      className="flex items-center space-x-3 cursor-pointer overflow-hidden flex-1"
                    >
                      {renderEntityLogo(org.name, org.brandColor)}
                      <div className="overflow-hidden">
                        <div className="text-xs font-bold text-white truncate">{org.name}</div>
                        <div className="text-[11px] text-zinc-400 truncate">{org.sector}</div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                          {org.interestCount || '+ 4K interesses'}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onToggleFollowEntity(org.id)}
                      className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer shrink-0 ml-2 ${
                        org.isFollowed
                          ? 'bg-zinc-800 text-white border border-zinc-700'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                      }`}
                    >
                      {org.isFollowed ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    </button>
                  </div>
                ))}

              {/* Fontes */}
              {selectedSubTab === ('fontes' as any) &&
                sources.map((src) => (
                  <div
                    key={src.id}
                    className="p-3.5 rounded-2xl border border-[#1e2026] bg-[#111215] hover:border-zinc-700/80 transition flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3 overflow-hidden flex-1">
                      {renderEntityLogo(src.name, src.brandColor)}
                      <div className="overflow-hidden">
                        <div className="text-xs font-bold text-white truncate">{src.name}</div>
                        <div className="text-[11px] text-zinc-400 truncate">{src.domain}</div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                          {src.interestCount || '+ 8K interesses'}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onToggleFollowSource(src.id)}
                      className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer shrink-0 ml-2 ${
                        src.isFollowed
                          ? 'bg-zinc-800 text-white border border-zinc-700'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                      }`}
                    >
                      {src.isFollowed ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    </button>
                  </div>
                ))}

              {/* Temas */}
              {selectedSubTab === 'topics' &&
                topics.map((topic) => (
                  <div
                    key={topic.id}
                    className="p-3.5 rounded-2xl border border-[#1e2026] bg-[#111215] hover:border-zinc-700/80 transition flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3 overflow-hidden flex-1">
                      {renderEntityLogo(topic.name, topic.brandColor, 'Tema')}
                      <div className="overflow-hidden">
                        <div className="text-xs font-bold text-white truncate">{topic.name}</div>
                        <div className="text-[11px] text-zinc-400 truncate">{topic.category}</div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                          {topic.interestCount || '+ 7K interesses'}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onToggleFollowTopic(topic.id)}
                      className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer shrink-0 ml-2 ${
                        topic.isFollowed
                          ? 'bg-zinc-800 text-white border border-zinc-700'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                      }`}
                    >
                      {topic.isFollowed ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    </button>
                  </div>
                ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
