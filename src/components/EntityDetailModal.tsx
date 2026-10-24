/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Entity, Event, Topic, Source } from '../types/sinal';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  Plus,
  Globe,
  MapPin,
  Building2,
  User,
  Landmark,
  Layers,
  Bell,
  BellOff,
  Share2,
  MoreHorizontal,
  ExternalLink,
  Clock,
  Sparkles,
  CheckCircle2,
  Calendar,
  Compass,
  ArrowRight
} from 'lucide-react';
import { CompanyLogoBadge } from './CompanyLogoBadge';

interface EnrichedSource {
  name: string;
  label: string;
  color: string;
  textColor?: string;
}

interface EnrichedEntityData {
  coverImage?: string;
  location?: string;
  sector?: string;
  website?: string;
  websiteUrl?: string;
  founded?: string;
  isVerified?: boolean;
  typeLabel: string;
  relatedTopics: Array<{ name: string; count: string }>;
  relatedPeople: Array<{ name: string; role: string; avatar?: string }>;
  topSources: EnrichedSource[];
}

interface EntityDetailModalProps {
  entity: Entity | null;
  onClose: () => void;
  allEvents: Event[];
  onOpenEventDetail: (event: Event) => void;
  onToggleSaveEvent: (eventId: string) => void;
  onToggleFollow: (entityId: string) => void;
}

export const EntityDetailModal: React.FC<EntityDetailModalProps> = ({
  entity,
  onClose,
  allEvents,
  onOpenEventDetail,
  onToggleSaveEvent,
  onToggleFollow
}) => {
  const [activeTab, setActiveTab] = useState<'events' | 'about' | 'topics' | 'sources'>('events');
  const [isAlertsEnabled, setIsAlertsEnabled] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false);

  // Keyboard navigation: Escape closes modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!entity) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleShare = async () => {
    const shareData = {
      title: `${entity.name} — FatosBR`,
      text: entity.description,
      url: window.location.href
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {}
    }
    navigator.clipboard.writeText(window.location.href);
    showToast('Link da entidade copiado!');
  };

  const handleToggleAlerts = () => {
    setIsAlertsEnabled((prev) => {
      const next = !prev;
      showToast(next ? 'Alertas ativados para esta entidade.' : 'Alertas silenciados.');
      return next;
    });
  };

  // Cobertura de Acontecimentos Reais associados à entidade
  const entityEvents = useMemo(() => {
    const matches = allEvents.filter(
      (ev) =>
        ev.entities.some((e) => e.id === entity.id || e.name.toLowerCase() === entity.name.toLowerCase()) ||
        ev.title.toLowerCase().includes(entity.name.toLowerCase()) ||
        ev.summary.toLowerCase().includes(entity.name.toLowerCase())
    );

    // Se houver poucos eventos nos dados de mock, compor com eventos contextuais da própria entidade
    if (matches.length > 0) return matches;

    // Fallback contextual elegante com os eventos globais de alta relevância
    return allEvents.slice(0, 3);
  }, [allEvents, entity]);

  // Metadados enriquecidos específicos por entidade ou tipo
  const enrichedData = useMemo<EnrichedEntityData>(() => {
    const nameLower = entity.name.toLowerCase();

    if (nameLower.includes('apple')) {
      return {
        coverImage: 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=1200&q=80',
        location: 'Cupertino, Califórnia, EUA',
        sector: 'Tecnologia',
        website: 'apple.com',
        websiteUrl: 'https://apple.com',
        founded: '1976',
        isVerified: true,
        typeLabel: 'Empresa de tecnologia',
        relatedTopics: [
          { name: 'iPhone', count: '12K' },
          { name: 'Inteligência artificial', count: '9K' },
          { name: 'App Store', count: '6K' },
          { name: 'Realidade aumentada', count: '4K' },
          { name: 'Serviços', count: '4K' }
        ],
        relatedPeople: [
          { name: 'Tim Cook', role: 'CEO da Apple', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80' },
          { name: 'Craig Federighi', role: 'SVP de Software Engineering', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80' },
          { name: 'John Ternus', role: 'SVP de Hardware Engineering', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=120&q=80' }
        ],
        topSources: [
          { name: 'Bloomberg', label: 'B', color: '#1d1d1d' },
          { name: 'Reuters', label: 'R', color: '#ff8000' },
          { name: 'The Verge', label: 'V', color: '#e5125b' },
          { name: 'CNBC', label: 'CNBC', color: '#005596' },
          { name: 'Financial Times', label: 'FT', color: '#fcd0a1', textColor: '#333' }
        ]
      };
    }

    if (nameLower.includes('nvidia')) {
      return {
        coverImage: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?auto=format&fit=crop&w=1200&q=80',
        location: 'Santa Clara, Califórnia, EUA',
        sector: 'Semicondutores & IA',
        website: 'nvidia.com',
        websiteUrl: 'https://nvidia.com',
        founded: '1993',
        isVerified: true,
        typeLabel: 'Empresa de semicondutores',
        relatedTopics: [
          { name: 'Inteligência artificial', count: '18K' },
          { name: 'GPUs Blackwell', count: '14K' },
          { name: 'Data Centers', count: '9K' },
          { name: 'Computação Acelerada', count: '7K' }
        ],
        relatedPeople: [
          { name: 'Jensen Huang', role: 'CEO da NVIDIA', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80' }
        ],
        topSources: [
          { name: 'Reuters', label: 'R', color: '#ff8000' },
          { name: 'Bloomberg', label: 'B', color: '#1d1d1d' },
          { name: 'CNBC', label: 'CNBC', color: '#005596' },
          { name: 'Valor Econômico', label: 'Valor', color: '#004b87' }
        ]
      };
    }

    if (entity.type === 'person') {
      return {
        coverImage: undefined,
        location: entity.sector || 'São Paulo, Brasil',
        sector: entity.sector || 'Executivo',
        website: entity.website || undefined,
        websiteUrl: entity.website,
        founded: undefined,
        isVerified: true,
        typeLabel: entity.role ? `Pessoa · ${entity.role}` : 'Pessoa de Relevância',
        relatedTopics: [
          { name: 'Liderança', count: '5K' },
          { name: 'Inovação', count: '4K' },
          { name: 'Economia', count: '3K' }
        ],
        relatedPeople: [],
        topSources: [
          { name: 'Valor Econômico', label: 'Valor', color: '#004b87' },
          { name: 'Folha de S.Paulo', label: 'Folha', color: '#003366' },
          { name: 'Bloomberg', label: 'B', color: '#1d1d1d' }
        ]
      };
    }

    // Default genérico para outras empresas / organizações
    return {
      coverImage: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
      location: entity.sector ? `${entity.sector} · Global` : 'Global',
      sector: entity.sector || 'Corporativo',
      website: entity.website ? entity.website.replace('https://', '').replace('http://', '') : undefined,
      websiteUrl: entity.website,
      founded: '1998',
      isVerified: true,
      typeLabel: entity.type === 'company' ? 'Empresa' : entity.type === 'organization' ? 'Organização' : 'Entidade',
      relatedTopics: [
        { name: 'Mercado', count: '8K' },
        { name: 'Tecnologia', count: '6K' },
        { name: 'Regulação', count: '4K' }
      ],
      relatedPeople: [],
      topSources: [
        { name: 'Reuters', label: 'R', color: '#ff8000' },
        { name: 'Bloomberg', label: 'B', color: '#1d1d1d' },
        { name: 'Valor Econômico', label: 'Valor', color: '#004b87' }
      ]
    };
  }, [entity]);

  // Ícone / Monograma da Entidade
  const renderEntityLogo = () => {
    if (entity.avatarUrl) {
      return (
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden border border-zinc-700 bg-zinc-900 shrink-0 shadow-xl">
          <img src={entity.avatarUrl} alt={entity.name} className="w-full h-full object-cover" />
        </div>
      );
    }

    return (
      <CompanyLogoBadge
        name={entity.name}
        brandColor={entity.brandColor}
        type={entity.type}
        size="xl"
      />
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs font-medium shadow-2xl flex items-center gap-2 animate-bounce-short">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Container */}
      <div className="relative w-full max-w-5xl min-h-screen sm:min-h-0 sm:max-h-[92vh] sm:rounded-3xl border-0 sm:border border-[#1f2229] bg-[#0c0d10] text-zinc-100 shadow-2xl flex flex-col overflow-hidden">
        {/* ================= 1. CAPA PANORÂMICA & TOP BAR ================= */}
        <div className="relative w-full">
          {/* Imagem de Capa (quando aplicável) */}
          {enrichedData.coverImage ? (
            <div className="relative w-full h-36 sm:h-52 overflow-hidden bg-zinc-950">
              <img
                src={enrichedData.coverImage}
                alt={entity.name}
                className="w-full h-full object-cover object-center filter brightness-90"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-black/40 to-black/20" />
            </div>
          ) : (
            <div className="w-full h-24 sm:h-32 bg-gradient-to-r from-zinc-900 to-[#121418] border-b border-[#1f2229]" />
          )}

          {/* Top Bar Sobre a Capa */}
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 sm:px-6 py-3.5">
            <button
              onClick={onClose}
              className="p-2 text-white bg-black/50 hover:bg-black/80 backdrop-blur-md rounded-full border border-white/10 transition cursor-pointer"
              title="Voltar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={handleShare}
                className="p-2 text-white bg-black/50 hover:bg-black/80 backdrop-blur-md rounded-full border border-white/10 transition cursor-pointer"
                title="Compartilhar"
              >
                <Share2 className="w-4 h-4" />
              </button>

              <div className="relative">
                <button
                  onClick={() => setIsOptionsMenuOpen(!isOptionsMenuOpen)}
                  className="p-2 text-white bg-black/50 hover:bg-black/80 backdrop-blur-md rounded-full border border-white/10 transition cursor-pointer"
                  title="Mais opções"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>

                {isOptionsMenuOpen && (
                  <div className="absolute right-0 top-10 w-48 rounded-xl border border-zinc-800 bg-[#121418] p-1.5 shadow-2xl z-30 text-xs space-y-1 animate-fade-in">
                    <button
                      onClick={() => {
                        handleShare();
                        setIsOptionsMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-800 text-zinc-200"
                    >
                      Copiar link oficial
                    </button>
                    <button
                      onClick={() => {
                        onToggleFollow(entity.id);
                        setIsOptionsMenuOpen(false);
                        showToast(entity.isFollowed ? 'Entidade removida dos seguidos' : 'Você agora está acompanhando');
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-800 text-zinc-200"
                    >
                      {entity.isFollowed ? 'Deixar de seguir' : 'Começar a seguir'}
                    </button>
                    <button
                      onClick={() => {
                        setIsOptionsMenuOpen(false);
                        showToast('Preferência salva: menos acontecimentos desta entidade no seu Feed.');
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white"
                    >
                      Ocultar do meu FatosBR
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ================= 2. CABEÇALHO DA ENTIDADE ================= */}
        <div className="px-5 sm:px-8 -mt-10 sm:-mt-12 relative z-10 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            {/* Logo + Título + Tipo */}
            <div className="flex items-end gap-4 min-w-0">
              {renderEntityLogo()}

              <div className="min-w-0 pb-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight truncate">
                    {entity.name}
                  </h1>
                  {enrichedData.isVerified && (
                    <span className="w-4 h-4 rounded-full bg-white text-black flex items-center justify-center shrink-0" title="Verificado">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-zinc-400 truncate mt-0.5 font-medium">
                  {enrichedData.typeLabel}
                </p>
              </div>
            </div>

            {/* Ações: Seguir / Seguindo + Sino de Alertas */}
            <div className="flex items-center gap-2 self-start sm:self-end pb-1">
              <button
                onClick={() => {
                  onToggleFollow(entity.id);
                  showToast(entity.isFollowed ? 'Entidade deixada de seguir' : 'Você agora acompanha esta entidade no seu FatosBR');
                }}
                className={`px-4 sm:px-5 py-2 rounded-full text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-md ${
                  entity.isFollowed
                    ? 'bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700'
                    : 'bg-white text-black hover:bg-zinc-200'
                }`}
              >
                {entity.isFollowed ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Seguindo</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>Seguir</span>
                  </>
                )}
              </button>

              <button
                onClick={handleToggleAlerts}
                className={`p-2 rounded-full border transition cursor-pointer ${
                  isAlertsEnabled
                    ? 'bg-zinc-800 text-white border-zinc-700'
                    : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-white'
                }`}
                title={isAlertsEnabled ? 'Alertas ativados' : 'Silenciar alertas'}
              >
                {isAlertsEnabled ? (
                  <Bell className="w-4 h-4 text-white" />
                ) : (
                  <BellOff className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Descrição & Metadados estruturados */}
          <div className="space-y-3 pt-1">
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-3xl">
              {entity.description}
            </p>

            {/* Unboxed Metadata Row */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400 font-mono">
              {enrichedData.websiteUrl && (
                <a
                  href={enrichedData.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-zinc-300 hover:text-white transition group"
                >
                  <Globe className="w-3.5 h-3.5 text-zinc-500 group-hover:text-white" />
                  <span className="group-hover:underline">{enrichedData.website}</span>
                </a>
              )}

              {enrichedData.location && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                  <span>{enrichedData.location}</span>
                </div>
              )}

              {enrichedData.sector && (
                <div className="flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-zinc-500" />
                  <span>{enrichedData.sector}</span>
                </div>
              )}
            </div>
          </div>

          {/* Abas de Navegação */}
          <div className="flex items-center gap-6 border-b border-[#1f2229] pt-2 text-xs font-semibold overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveTab('events')}
              className={`pb-3 transition cursor-pointer relative ${
                activeTab === 'events' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Acontecimentos ({entityEvents.length})</span>
              {activeTab === 'events' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('about')}
              className={`pb-3 transition cursor-pointer relative ${
                activeTab === 'about' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Sobre</span>
              {activeTab === 'about' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('topics')}
              className={`pb-3 transition cursor-pointer relative ${
                activeTab === 'topics' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Tópicos relacionados</span>
              {activeTab === 'topics' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('sources')}
              className={`pb-3 transition cursor-pointer relative ${
                activeTab === 'sources' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Fontes</span>
              {activeTab === 'sources' && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-full" />
              )}
            </button>
          </div>
        </div>

        {/* ================= 3. CORPO (DUAS COLUNAS NO DESKTOP) ================= */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* COLUNA PRINCIPAL (ACONTECIMENTOS RECENTES) */}
            <div className="lg:col-span-2 space-y-6">
              {activeTab === 'events' && (
                <section className="space-y-4">
                  <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                    Acontecimentos recentes
                  </h3>

                  {entityEvents.length === 0 ? (
                    <div className="p-8 rounded-2xl border border-[#1e2026] bg-[#111216] text-center space-y-2">
                      <p className="text-xs text-zinc-400">
                        Ainda não há acontecimentos recentes registrados envolvendo esta entidade.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {entityEvents.map((ev) => (
                        <div
                          key={ev.id}
                          onClick={() => onOpenEventDetail(ev)}
                          className="group p-4 sm:p-5 rounded-2xl border border-[#1e2026] bg-[#111216] hover:bg-[#15171d] hover:border-zinc-700 transition flex items-start justify-between gap-4 cursor-pointer"
                        >
                          {/* Thumbnail */}
                          {ev.imageUrl && (
                            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-zinc-800 shrink-0 bg-zinc-950">
                              <img
                                src={ev.imageUrl}
                                alt=""
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              />
                            </div>
                          )}

                          {/* Conteúdo do Event */}
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                              <span>{ev.relativeTime || 'há poucas horas'}</span>
                              <span>·</span>
                              <span className="uppercase text-zinc-300 font-semibold">{ev.category}</span>
                            </div>

                            <h4 className="text-xs sm:text-sm font-bold text-white group-hover:text-zinc-100 leading-snug">
                              {ev.title}
                            </h4>

                            <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                              {ev.summary}
                            </p>

                            <div className="flex items-center gap-3 pt-1 text-[11px] font-mono text-zinc-400">
                              <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300">
                                {ev.category}
                              </span>
                              <span className="flex items-center gap-1 text-zinc-400">
                                <Layers className="w-3 h-3 text-zinc-500" />
                                <span>{ev.sources.length} fontes</span>
                              </span>
                            </div>
                          </div>

                          <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition shrink-0 mt-2" />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* ABA: SOBRE */}
              {activeTab === 'about' && (
                <section className="space-y-4 text-xs">
                  <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
                    <h3 className="text-sm font-bold text-white">Sobre {entity.name}</h3>
                    <p className="text-zinc-300 leading-relaxed text-[13px]">
                      {entity.description}
                    </p>

                    <div className="grid grid-cols-2 gap-4 pt-3 border-t border-zinc-800/80 font-mono text-[11px]">
                      <div>
                        <span className="text-zinc-500 block">Setor de atuação</span>
                        <span className="text-white font-medium">{enrichedData.sector || 'Geral'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Sede</span>
                        <span className="text-white font-medium">{enrichedData.location}</span>
                      </div>
                      {enrichedData.founded && (
                        <div>
                          <span className="text-zinc-500 block">Fundação</span>
                          <span className="text-white font-medium">{enrichedData.founded}</span>
                        </div>
                      )}
                      {enrichedData.websiteUrl && (
                        <div>
                          <span className="text-zinc-500 block">Website oficial</span>
                          <a
                            href={enrichedData.websiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white hover:underline flex items-center gap-1 font-sans"
                          >
                            <span>{enrichedData.website}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* ABA: TÓPICOS */}
              {activeTab === 'topics' && (
                <section className="space-y-3">
                  <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                    Tópicos relacionados a {entity.name}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {enrichedData.relatedTopics.map((topic, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-xl border border-[#1e2026] bg-[#111216] flex items-center justify-between"
                      >
                        <span className="text-xs font-semibold text-white">#{topic.name}</span>
                        <span className="text-[10px] font-mono text-zinc-400">{topic.count} interesses</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ABA: FONTES */}
              {activeTab === 'sources' && (
                <section className="space-y-3">
                  <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                    Fontes que cobrem {entity.name}
                  </h3>
                  <div className="space-y-2">
                    {enrichedData.topSources.map((src, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-xl border border-[#1e2026] bg-[#111216] flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            style={{ backgroundColor: src.color, color: src.textColor || '#ffffff' }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold"
                          >
                            {src.label}
                          </div>
                          <span className="text-xs font-semibold text-white">{src.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400">Acompanhamento contínuo</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* COLUNA LATERAL DIREITA (DESKTOP WIDGETS) */}
            <aside className="space-y-6">
              {/* WIDGET 1: TÓPICOS RELACIONADOS */}
              <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white tracking-wide">
                    Tópicos relacionados
                  </h4>
                </div>

                <div className="space-y-1.5 text-xs">
                  {enrichedData.relatedTopics.map((topic, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-xl hover:bg-zinc-800/40 transition flex items-center justify-between cursor-pointer group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 group-hover:bg-white transition-colors" />
                        <span className="font-medium text-zinc-300 group-hover:text-white">
                          {topic.name}
                        </span>
                      </div>
                      <span className="font-mono text-zinc-500 text-[11px]">{topic.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* WIDGET 2: PESSOAS RELACIONADAS (QUANDO APLICÁVEL) */}
              {enrichedData.relatedPeople.length > 0 && (
                <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
                  <h4 className="text-xs font-bold text-white tracking-wide">
                    Pessoas relacionadas
                  </h4>

                  <div className="space-y-2 text-xs">
                    {enrichedData.relatedPeople.map((person, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-xl hover:bg-zinc-800/40 transition"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={person.avatar}
                            alt={person.name}
                            className="w-8 h-8 rounded-full object-cover border border-zinc-700"
                          />
                          <div className="min-w-0">
                            <div className="font-bold text-white truncate text-xs">{person.name}</div>
                            <div className="text-[10px] text-zinc-400 truncate">{person.role}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => showToast(`Você agora segue ${person.name}`)}
                          className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer shrink-0"
                          title="Seguir"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* WIDGET 3: FONTES PRINCIPAIS */}
              <div className="p-4 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
                <h4 className="text-xs font-bold text-white tracking-wide">
                  Fontes principais
                </h4>

                <div className="space-y-2 text-xs">
                  {enrichedData.topSources.map((source, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded-xl hover:bg-zinc-800/40 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          style={{ backgroundColor: source.color, color: source.textColor || '#ffffff' }}
                          className="w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-extrabold shrink-0"
                        >
                          {source.label}
                        </div>
                        <span className="font-semibold text-white text-xs">{source.name}</span>
                      </div>
                      <button
                        onClick={() => showToast(`Fonte ${source.name} favoritada`)}
                        className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                        title="Seguir fonte"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>

        {/* ================= 4. FOOTER ================= */}
        <footer className="sticky bottom-0 z-30 px-5 sm:px-8 py-3 bg-[#0c0d10]/95 border-t border-[#1f2229] backdrop-blur-md flex items-center justify-between text-xs">
          <span className="text-[11px] text-zinc-400 font-mono">
            {entity.name} · Monitoramento inteligente do FatosBR
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition cursor-pointer"
          >
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
};
