/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Event, Entity } from '../types/sinal';
import {
  Bookmark,
  BookmarkCheck,
  MoreHorizontal,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Layers,
  Clock,
  Share2,
  Check
} from 'lucide-react';
import { CompanyLogoBadge } from './CompanyLogoBadge';

export function formatDetailedRelativeTime(publishedAt?: string, fallback?: string): string {
  if (!publishedAt) return fallback || 'há pouco';
  const date = new Date(publishedAt);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  if (isNaN(diffInMs)) return fallback || 'há pouco';

  const diffInSec = Math.max(0, Math.floor(diffInMs / 1000));
  if (diffInSec < 60) {
    return diffInSec <= 10 ? 'agora mesmo' : `há ${diffInSec} segundos`;
  }
  const diffInMin = Math.floor(diffInSec / 60);
  if (diffInMin < 60) {
    return diffInMin === 1 ? 'há 1 minuto' : `há ${diffInMin} minutos`;
  }
  const diffInHours = Math.floor(diffInMin / 60);
  if (diffInHours < 24) {
    return diffInHours === 1 ? 'há 1 hora' : `há ${diffInHours} horas`;
  }
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return diffInDays === 1 ? 'há 1 dia' : `há ${diffInDays} dias`;
  }
  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInDays < 30) {
    return diffInWeeks === 1 ? 'há 1 semana' : `há ${diffInWeeks} semanas`;
  }
  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) {
    return diffInMonths === 1 ? 'há 1 mês' : `há ${diffInMonths} meses`;
  }
  const diffInYears = Math.floor(diffInDays / 365);
  return diffInYears === 1 ? 'há 1 ano' : `há ${diffInYears} anos`;
}

interface EventCardProps {
  event: Event;
  index?: number;
  onOpenDetail: (event: Event) => void;
  onToggleSave?: (eventId: string) => void;
  onHideEvent?: (eventId: string) => void;
  onOpenEntity?: (entity: Entity) => void;
}

export const EventCard: React.FC<EventCardProps> = ({
  event,
  index = 0,
  onOpenDetail,
  onToggleSave,
  onHideEvent,
  onOpenEntity
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [, setSaveFeedback] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [shareTooltip, setShareTooltip] = useState<string | null>(null);

  const handleShareClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const eventUrl = `${window.location.origin}/?event=${encodeURIComponent(event.id)}`;
    const shareData = {
      title: `${event.title} — FatosBR`,
      text: event.summary,
      url: eventUrl
    };

    if (navigator.share && /mobile|android|iphone|ipad/i.test(navigator.userAgent)) {
      try {
        await navigator.share(shareData);
        setIsCopied(true);
        setShareTooltip('Compartilhado!');
        setTimeout(() => {
          setIsCopied(false);
          setShareTooltip(null);
        }, 2200);
        return;
      } catch {
        // Fallback para clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(eventUrl);
      setIsCopied(true);
      setShareTooltip('Link copiado!');
      setTimeout(() => {
        setIsCopied(false);
        setShareTooltip(null);
      }, 2200);
    } catch {
      setIsCopied(true);
      setShareTooltip('Link gerado!');
      setTimeout(() => {
        setIsCopied(false);
        setShareTooltip(null);
      }, 2200);
    }
  };

  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSave?.(event.id);
    setSaveFeedback(true);
    setTimeout(() => setSaveFeedback(false), 1200);
  };

  const handleHideClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    onHideEvent?.(event.id);
  };

  const renderSourceBadge = (source: { name: string; color: string; label: string }, idx: number) => {
    return (
      <div
        key={idx}
        title={source.name}
        className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0 shadow-sm border border-black/40 overflow-hidden"
        style={{ backgroundColor: source.color }}
      >
        {source.label}
      </div>
    );
  };

  const wordCount = (event.title + ' ' + event.summary + ' ' + (event.whyItMatters || '')).split(/\s+/).length;
  const readingTimeMin = Math.max(1, Math.ceil(wordCount / 160));

  const displayTime = formatDetailedRelativeTime(event.publishedAt, event.relativeTime);
  const primaryEntity = event.entities && event.entities[0];

  return (
    <article
      onClick={() => onOpenDetail(event)}
      style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
      className="animate-feed-card group relative rounded-2xl bg-[#111215] hover:border-zinc-700/80 transition-all duration-200 overflow-hidden cursor-pointer w-full max-w-full border border-[#1e2025]"
    >
      {/* Imagem sutil integrada à direita com gradiente escuro de fusão editorial */}
      {event.imageUrl && !imgError && (
        <div className="absolute right-0 top-0 bottom-0 w-2/5 sm:w-1/2 pointer-events-none overflow-hidden opacity-30 sm:opacity-45 group-hover:opacity-60 transition-opacity">
          <img
            src={event.imageUrl}
            alt={event.title}
            onError={() => setImgError(true)}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center filter saturate-[0.85]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#111215] via-[#111215]/85 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#111215] via-transparent to-[#111215]/60" />
        </div>
      )}

      {/* Conteúdo do Card */}
      <div className="relative z-10 p-4 sm:p-6 space-y-3.5 w-full max-w-full overflow-hidden">
        {/* Top Header: Categoria, Tempo Preciso e Ações (Bookmark + Menu + Share) */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {/* Logo da Entidade/Empresa em Destaque */}
            {primaryEntity && (
              <div
                onClick={(e) => {
                  if (onOpenEntity) {
                    e.stopPropagation();
                    onOpenEntity(primaryEntity);
                  }
                }}
                className="inline-flex items-center gap-1.5 hover:opacity-85 transition shrink-0"
                title={`Ver detalhes de ${primaryEntity.name}`}
              >
                <CompanyLogoBadge
                  name={primaryEntity.name}
                  brandColor={primaryEntity.brandColor}
                  type={primaryEntity.type}
                  size="sm"
                />
                <span className="text-xs font-semibold text-zinc-300 hover:text-white truncate max-w-[110px] sm:max-w-[160px]">
                  {primaryEntity.name}
                </span>
                <span className="text-zinc-600 text-xs select-none">·</span>
              </div>
            )}

            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-900/90 text-zinc-300 text-[11px] font-mono border border-zinc-800/80 shrink-0">
              <Clock className="w-3 h-3 text-zinc-400 shrink-0" />
              <span>{displayTime}</span>
              <span className="text-zinc-600 hidden sm:inline">·</span>
              <span className="text-zinc-400 hidden sm:inline">{readingTimeMin} min</span>
            </span>
          </div>

          <div className="flex items-center space-x-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {/* Botão Salvar */}
            <button
              onClick={handleSaveClick}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-colors cursor-pointer ${
                event.isSaved
                  ? 'text-white bg-zinc-800'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60 active:bg-zinc-700'
              }`}
              title={event.isSaved ? 'Salvo' : 'Salvar acontecimento'}
              aria-label="Salvar acontecimento"
            >
              {event.isSaved ? (
                <BookmarkCheck className="w-5 h-5 fill-white text-white" />
              ) : (
                <Bookmark className="w-5 h-5" />
              )}
            </button>

            {/* Botão Compartilhar */}
            <div className="relative">
              <button
                onClick={handleShareClick}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer ${
                  isCopied
                    ? 'bg-white text-black font-bold scale-105 shadow-md'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60 active:bg-zinc-700'
                }`}
                title={isCopied ? 'Link copiado!' : 'Compartilhar acontecimento'}
                aria-label="Compartilhar acontecimento"
              >
                {isCopied ? (
                  <Check className="w-4 h-4 text-black stroke-[2.5]" />
                ) : (
                  <Share2 className="w-4 h-4" />
                )}
              </button>
              {shareTooltip && (
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-white text-black font-mono text-[10px] font-bold whitespace-nowrap shadow-lg animate-fade-in pointer-events-none z-50">
                  {shareTooltip}
                </div>
              )}
            </div>

            {/* Menu Dropdown de Ações */}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800/60 active:bg-zinc-700 transition-colors cursor-pointer"
                title="Mais opções"
                aria-label="Mais opções"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>

              {showMenu && (
                <div
                  className="absolute right-0 top-11 w-56 rounded-xl border border-zinc-800 bg-zinc-950/98 backdrop-blur-md shadow-2xl p-1.5 z-40 text-xs space-y-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handleHideClick}
                    className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
                  >
                    <EyeOff className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span>Não quero ver isso</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onOpenDetail(event);
                    }}
                    className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
                  >
                    <Layers className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span>Ver todas as fontes</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Título & Resumo */}
        <div className="space-y-1.5 max-w-full overflow-hidden">
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug group-hover:text-zinc-100 break-words">
            {event.title}
          </h2>
          <p className="text-xs sm:text-[13px] text-zinc-300 leading-relaxed line-clamp-2 break-words">
            {event.summary}
          </p>
        </div>

        {/* Preview Expansível de "Por que isso importa" */}
        {isExpanded && (
          <div
            className="pt-2 pb-1 space-y-1.5 border-t border-zinc-800/80 text-xs text-zinc-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-300"></span>
              Por que isso importa
            </div>
            <p className="text-xs text-zinc-200 leading-relaxed bg-zinc-950/80 p-3 rounded-xl border border-zinc-800/80 break-words">
              {event.whyItMatters}
            </p>
          </div>
        )}

        {/* Bottom Bar: Categoria + Fontes Convergentes & Botão Contexto */}
        <div className="pt-2.5 border-t border-zinc-800/60 flex items-center justify-between gap-2 text-xs text-zinc-400">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="px-2 py-0.5 rounded-full bg-zinc-800/90 text-zinc-300 text-[11px] font-medium border border-zinc-700/50 backdrop-blur-sm shrink-0">
              {event.category}
            </span>
            <span className="text-zinc-600 text-xs select-none">·</span>
            <span className="font-medium text-zinc-300 text-xs shrink-0">
              {event.sources?.length || 1} fontes
            </span>

            {/* Mini Logos / Badges dos Veículos Jornalísticos */}
            <div className="flex items-center -space-x-1 ml-0.5 overflow-hidden">
              {event.featuredSourceLogos?.slice(0, 3).map((srcLogo, i) =>
                renderSourceBadge(srcLogo, i)
              )}
              {(event.sources?.length || 0) > 3 && (
                <div className="w-5 h-5 rounded-full bg-zinc-800 border border-black/40 flex items-center justify-center text-[9px] text-zinc-300 font-mono font-medium shrink-0">
                  +{event.sources.length - 3}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center shrink-0">
            {/* Botão Contexto */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="min-h-[44px] px-3 -mr-2 text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 transition-colors cursor-pointer active:text-zinc-200"
              aria-label={isExpanded ? 'Recolher contexto' : 'Expandir contexto'}
            >
              <span>{isExpanded ? 'Recolher' : 'Contexto'}</span>
              {isExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};
