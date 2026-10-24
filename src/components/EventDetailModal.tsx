/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Event, Entity } from '../types/sinal';
import {
  ChevronLeft,
  X,
  Bookmark,
  BookmarkCheck,
  Share2,
  ExternalLink,
  Layers,
  Clock,
  Check,
  Plus,
  Building2,
  User,
  Landmark,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Link as LinkIcon,
  Headphones,
  Play,
  Pause,
  Volume2
} from 'lucide-react';
import { audioSpeechService } from '../services/audioSpeechService';

interface EventDetailModalProps {
  event: Event | null;
  onClose: () => void;
  onToggleSave: (eventId: string) => void;
  onOpenEntity?: (entity: Entity) => void;
  onToggleFollowEntity?: (entityId: string) => void;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  event,
  onClose,
  onToggleSave,
  onOpenEntity,
  onToggleFollowEntity
}) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [localFollowedMap, setLocalFollowedMap] = useState<Record<string, boolean>>({});

  // Sync followed entities when event changes
  useEffect(() => {
    if (event) {
      const initialMap: Record<string, boolean> = {};
      event.entities.forEach((ent) => {
        initialMap[ent.id] = ent.isFollowed;
      });
      setLocalFollowedMap(initialMap);
    }
  }, [event]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Audio Speech state for this event
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  useEffect(() => {
    if (!event) return;
    return audioSpeechService.subscribe((s) => {
      setIsPlayingAudio(s.currentEvent?.id === event.id && s.isPlaying);
    });
  }, [event?.id]);

  // Modo padrão: 'full' (notícia íntegra completa) com opção de alternar para 'summary' (resumo)
  const [readingMode, setReadingMode] = useState<'full' | 'summary'>('full');

  useEffect(() => {
    if (event?.id) {
      setReadingMode('full');
    }
  }, [event?.id]);

  if (!event) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  const handleShare = async () => {
    const shareData = {
      title: event.title,
      text: `${event.title} — FatosBR`,
      url: window.location.href
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // Fallback to clipboard if cancelled or not supported
      }
    }

    try {
      await navigator.clipboard.writeText(`${event.title}\n\n${event.summary}\n\nVia FatosBR: ${window.location.href}`);
      showToast('Link copiado para a área de transferência');
    } catch {
      showToast('Acontecimento pronto para compartilhar');
    }
  };

  const handleToggleFollow = (entityId: string) => {
    setLocalFollowedMap((prev) => {
      const nextState = !prev[entityId];
      if (onToggleFollowEntity) {
        onToggleFollowEntity(entityId);
      }
      showToast(nextState ? 'Você agora está acompanhando esta entidade' : 'Entidade removida dos seguidos');
      return { ...prev, [entityId]: nextState };
    });
  };

  const handleToggleAudio = () => {
    if (!event) return;
    if (isPlayingAudio) {
      audioSpeechService.pause();
    } else {
      audioSpeechService.playEvent(event);
    }
  };

  const wordCount = (
    event.title +
    ' ' +
    event.summary +
    ' ' +
    (event.whyItMatters || '') +
    ' ' +
    (event.timeline?.map((t) => t.title + ' ' + t.description).join(' ') || '')
  )
    .split(/\s+/)
    .filter(Boolean).length;
  const readingTimeMin = Math.max(1, Math.ceil(wordCount / 160));
  const audioDurationSec = Math.max(25, Math.ceil((wordCount / 130) * 60));
  const audioDurationFormatted =
    audioDurationSec >= 60
      ? `${Math.floor(audioDurationSec / 60)}min ${audioDurationSec % 60}s`
      : `${audioDurationSec}s`;

  const getSourceBadge = (sourceName: string) => {
    const nameLower = sourceName.toLowerCase();
    if (nameLower.includes('reuters')) return { bg: '#ff8000', label: 'R' };
    if (nameLower.includes('bloomberg')) return { bg: '#2b2b2b', label: 'BBG' };
    if (nameLower.includes('valor')) return { bg: '#004b87', label: 'Valor' };
    if (nameLower.includes('cnbc')) return { bg: '#005596', label: 'CNBC' };
    if (nameLower.includes('estadão')) return { bg: '#002b49', label: 'Estadão' };
    if (nameLower.includes('folha')) return { bg: '#003366', label: 'Folha' };
    if (nameLower.includes('g1')) return { bg: '#c4170c', label: 'g1' };
    if (nameLower.includes('cnn')) return { bg: '#cc0000', label: 'CNN' };
    if (nameLower.includes('infomoney')) return { bg: '#00a86b', label: 'IM' };
    if (nameLower.includes('financial')) return { bg: '#fcd0a1', text: '#333', label: 'FT' };
    return { bg: '#27272a', label: sourceName.slice(0, 2).toUpperCase() };
  };

  const defaultFallbackImage =
    event.category === 'Tecnologia & IA' || event.category === 'Tecnologia'
      ? 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80'
      : event.category === 'Economia'
      ? 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80'
      : event.category === 'Política'
      ? 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=1200&q=80'
      : 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-modal-title"
      className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-center bg-black/95 sm:bg-black/85 backdrop-blur-md p-0 sm:p-4 overflow-hidden animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs font-medium shadow-2xl flex items-center gap-2 animate-bounce-short">
          <Check className="w-3.5 h-3.5 text-white" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Editorial Container - Tela cheia no Mobile com cantos arredondados no Desktop */}
      <div className="relative w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-3xl border-0 sm:border border-[#1f2229] bg-[#0c0d10] text-zinc-100 shadow-2xl flex flex-col overflow-hidden">
        {/* ================= HEADER EDITORIAL / NAVEGAÇÃO FIXA ================= */}
        <header className="sticky top-0 z-40 flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3.5 bg-[#0c0d10]/98 backdrop-blur-md border-b border-[#1f2229] shrink-0">
          <div className="flex items-center gap-2">
            {/* Botão de Voltar Proeminente (com texto visível e hitbox touch >= 44px) */}
            <button
              onClick={onClose}
              className="min-h-[44px] px-3.5 py-2 -ml-1 text-white bg-zinc-900 border border-zinc-700/80 hover:bg-zinc-800 hover:border-zinc-500 rounded-xl transition cursor-pointer text-xs font-bold flex items-center gap-1.5 active:scale-95 shadow-md shrink-0"
              title="Voltar ao feed de notícias"
              aria-label="Voltar"
            >
              <ChevronLeft className="w-4 h-4 text-white stroke-[2.5]" />
              <span>Voltar</span>
            </button>

            <span className="text-zinc-600 hidden sm:inline">/</span>

            <span className="text-[11px] font-mono tracking-wider uppercase text-zinc-300 font-semibold truncate max-w-[130px] sm:max-w-none px-2 py-0.5 rounded bg-zinc-900/60 border border-zinc-800">
              {event.category}
            </span>
          </div>

          <div className="flex items-center space-x-1 sm:space-x-1.5">
            <button
              onClick={() => {
                onToggleSave(event.id);
                showToast(event.isSaved ? 'Acontecimento removido dos salvos' : 'Acontecimento salvo nos seus itens');
              }}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border transition cursor-pointer ${
                event.isSaved
                  ? 'bg-white text-black border-white'
                  : 'text-zinc-300 hover:text-white border-zinc-800 bg-zinc-900 hover:bg-zinc-800'
              }`}
              title={event.isSaved ? 'Salvo' : 'Salvar acontecimento'}
              aria-label="Salvar"
            >
              {event.isSaved ? (
                <BookmarkCheck className="w-4 h-4 fill-black" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={handleShare}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-300 hover:text-white rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 transition cursor-pointer"
              title="Compartilhar acontecimento"
              aria-label="Compartilhar"
            >
              <Share2 className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-400 hover:text-white rounded-xl border border-zinc-800/80 bg-zinc-900/60 hover:bg-zinc-800 transition cursor-pointer ml-0.5"
              title="Fechar"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* ================= CORPO EDITORIAL ================= */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8 pt-4 pb-28 space-y-6">
          {/* Barra de Ações & Metadados Superior */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
              <span className="px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-white font-bold uppercase text-[10px] tracking-wider">
                {event.category}
              </span>
              <span className="text-zinc-600">·</span>
              <span>{event.relativeTime || 'Hoje'}</span>
              <span className="text-zinc-600">·</span>
              <span className="inline-flex items-center gap-1.5 text-zinc-300">
                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                <span>{event.sources.length} {event.sources.length === 1 ? 'fonte' : 'fontes'}</span>
              </span>
            </div>

            {/* Botão de Resumo/Íntegra */}
            {readingMode === 'full' ? (
              <button
                onClick={() => setReadingMode('summary')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-700 hover:border-white text-zinc-200 hover:text-white text-xs font-semibold transition cursor-pointer shadow-sm"
                title="Resumir a notícia"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Resumir a notícia</span>
              </button>
            ) : (
              <button
                onClick={() => setReadingMode('full')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition cursor-pointer shadow-sm"
                title="Ver notícia completa na íntegra"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Ver notícia na íntegra</span>
              </button>
            )}
          </div>

          {/* Imagem de Capa Cinematográfica (permanece visível no resumo e na íntegra) */}
          <div className="relative w-full aspect-video sm:h-64 rounded-2xl overflow-hidden border border-[#1f2229] bg-zinc-950 shadow-lg">
            <img
              src={event.imageUrl || defaultFallbackImage}
              alt={event.title}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = defaultFallbackImage;
              }}
              className="w-full h-full object-cover object-center filter brightness-95 contrast-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-transparent to-black/30" />
            <div className="absolute bottom-2.5 left-3 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-sm border border-white/10 text-[10px] text-zinc-300 font-mono">
              {event.sources[0]?.sourceName || 'Cobertura de Imprensa'}
            </div>
          </div>

          {/* Título Principal & Linha Fina */}
          <div className="space-y-2.5">
            <h1
              id="event-modal-title"
              className="text-lg sm:text-2xl lg:text-[26px] font-bold text-white tracking-tight leading-snug break-words"
            >
              {event.title}
            </h1>

            <p className="text-sm sm:text-base text-zinc-300 font-normal leading-relaxed break-words">
              {event.summary}
            </p>
          </div>

          {readingMode === 'summary' ? (
            /* ================= MODO RESUMIDO ================= */
            <div className="space-y-5 pt-1">
              {/* Card 1: Fato Central */}
              <div className="p-5 rounded-2xl border border-zinc-800 bg-[#0e1014] space-y-2">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-zinc-300 font-bold">
                  <span className="w-2 h-2 rounded-full bg-white" />
                  <span>1. Fato Central</span>
                </div>
                <p className="text-sm sm:text-[15px] text-zinc-200 leading-relaxed font-light">
                  {event.whatHappened || event.summary}
                </p>
              </div>

              {/* Card 2: Impacto no Mercado & Negócios */}
              <div className="p-5 rounded-2xl border border-zinc-800 bg-black space-y-2">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-zinc-300 font-bold">
                  <span className="w-2 h-2 rounded-full bg-zinc-400" />
                  <span>2. Impacto Estratégico & nos Mercados</span>
                </div>
                <p className="text-sm sm:text-[15px] text-zinc-300 leading-relaxed font-light">
                  {event.marketImpact || event.whyItMatters || 'Repercussão direta na alocação setorial, avaliação de risco e tomada de decisão estratégica.'}
                </p>
              </div>

              {/* Card 3: Desdobramentos & O que Monitorar */}
              <div className="p-5 rounded-2xl border border-zinc-800/80 bg-[#0a0b0e] space-y-2">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-zinc-300 font-bold">
                  <span className="w-2 h-2 rounded-full bg-zinc-500" />
                  <span>3. Desdobramentos & O que Monitorar</span>
                </div>
                <p className="text-sm sm:text-[15px] text-zinc-400 leading-relaxed font-light">
                  {event.nextSteps || 'Acompanhar desdobramentos nas próximas 24h a 48h, reações de órgãos reguladores e comunicados oficiais ao mercado.'}
                </p>
              </div>

              {/* Fontes Checadas */}
              <div className="p-4 rounded-2xl border border-zinc-800 bg-[#0e1014] space-y-2.5">
                <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                  <span className="uppercase tracking-wider font-semibold">
                    Fontes Consultadas ({event.sources.length})
                  </span>
                  <span className="text-[11px]">Links originais verificados</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {event.sources.map((src) => (
                    <a
                      key={src.id}
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 text-xs text-zinc-300 hover:text-white transition cursor-pointer"
                    >
                      <span>{src.sourceName}</span>
                      <ExternalLink className="w-3 h-3 text-zinc-500" />
                    </a>
                  ))}
                </div>
              </div>

              {/* Botão de Destaque para Ler a Notícia Inteira */}
              <div className="pt-2">
                <button
                  onClick={() => setReadingMode('full')}
                  className="w-full py-3.5 px-4 rounded-2xl bg-white hover:bg-zinc-200 text-black font-bold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-xl cursor-pointer"
                >
                  <Layers className="w-4 h-4" />
                  <span>Ler Notícia Completa na Íntegra</span>
                </button>
              </div>
            </div>
          ) : (
            /* ================= MODO ÍNTEGRA ================= */
            <div className="space-y-6">
              {/* Reportagem na Íntegra: O que Aconteceu */}
              <section className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-3.5 bg-white rounded-full"></span>
                  <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white">
                    Reportagem Completa & Apuração
                  </h2>
                </div>
                <div className="p-5 rounded-2xl border border-zinc-800 bg-[#0e1014] text-sm sm:text-[15px] text-zinc-200 leading-relaxed font-normal space-y-3">
                  <p>{event.whatHappened}</p>
                  {event.summary !== event.whatHappened && (
                    <p className="text-zinc-300">{event.summary}</p>
                  )}
                </div>
              </section>

              {/* Contexto: Por que isso importa */}
              {event.whyItMatters && (
                <section className="space-y-3 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-3.5 bg-zinc-400 rounded-full"></span>
                    <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white">
                      Análise de Impacto
                    </h2>
                  </div>
                  <div className="p-4 sm:p-5 rounded-2xl border border-[#1f2229] bg-[#121418]/90 text-sm sm:text-[15px] text-zinc-200 leading-relaxed font-normal">
                    {event.whyItMatters}
                  </div>
                </section>
              )}

              {/* Linha do Tempo e Evolução */}
              {event.timeline && event.timeline.length > 0 && (
                <section className="space-y-4 pt-3 border-t border-[#1f2229]">
                  <div>
                    <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white">
                      Evolução cronológica
                    </h2>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Linha do tempo dos fatos verificados.
                    </p>
                  </div>

                  <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[2px] before:bg-[#1f2229]">
                    {event.timeline.map((item, idx) => (
                      <div key={item.id || idx} className="relative group">
                        <div className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-[#0c0d10] border-2 border-zinc-400 flex items-center justify-center">
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                            <Clock className="w-3 h-3 text-zinc-400" />
                            <span>{item.time || item.date}</span>
                          </div>

                          <h4 className="text-xs sm:text-sm font-bold text-white leading-tight">
                            {item.title}
                          </h4>

                          <p className="text-xs text-zinc-300 leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Fontes Jornalísticas Detalhadas */}
              <section id="secao-fontes" className="space-y-4 pt-3 border-t border-[#1f2229]">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white">
                      Fontes Jornalísticas ({event.sources.length})
                    </h2>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Artigos originais consultados para esta cobertura.
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {event.sources.map((src) => {
                    const badge = getSourceBadge(src.sourceName);
                    return (
                      <a
                        key={src.id}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-3.5 sm:p-4 rounded-xl border border-[#1f2229] bg-[#121418] hover:bg-[#16181f] hover:border-zinc-700 transition flex items-start justify-between gap-3 group block"
                      >
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div
                            style={{ backgroundColor: badge.bg, color: badge.text || '#ffffff' }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-extrabold shrink-0 mt-0.5"
                          >
                            {badge.label.slice(0, 3)}
                          </div>

                          <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-semibold text-white group-hover:text-zinc-100">
                                {src.sourceName}
                              </span>
                              <span className="text-[11px] text-zinc-400 font-mono">
                                · {src.domain}
                              </span>
                            </div>

                            <p className="text-xs sm:text-[13px] text-zinc-300 group-hover:text-white leading-snug line-clamp-2">
                              {src.headline}
                            </p>
                          </div>
                        </div>

                        <div className="p-1 text-zinc-400 group-hover:text-white shrink-0 mt-0.5 transition">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </div>
                      </a>
                    );
                  })}
                </div>
              </section>

              {/* Botão Inferior para Resumir */}
              <div className="pt-3 border-t border-zinc-800">
                <button
                  onClick={() => setReadingMode('summary')}
                  className="w-full py-3 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white font-semibold text-xs tracking-wider transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>Resumir a notícia</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ================= BARRA INFERIOR FIXA (STICKY BOTTOM BAR) ================= */}
        <footer className="sticky bottom-0 z-30 px-4 sm:px-6 py-3.5 bg-[#0c0d10]/95 border-t border-[#1f2229] backdrop-blur-md flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                onToggleSave(event.id);
                showToast(event.isSaved ? 'Removido dos salvos' : 'Salvo nos seus favoritos');
              }}
              className={`p-2.5 rounded-xl border transition cursor-pointer ${
                event.isSaved
                  ? 'bg-white text-black border-white'
                  : 'bg-zinc-900 text-zinc-300 border-[#1f2229] hover:text-white hover:bg-zinc-800'
              }`}
              title="Salvar"
            >
              {event.isSaved ? (
                <BookmarkCheck className="w-4 h-4 fill-black" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={handleShare}
              className="p-2.5 rounded-xl bg-zinc-900 border border-[#1f2229] text-zinc-300 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
              title="Compartilhar"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>

          <a
            href={event.sources[0]?.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 max-w-sm py-2.5 px-4 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg cursor-pointer ml-auto"
          >
            <span>Ver na fonte principal ({event.sources[0]?.sourceName || 'Externa'})</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </footer>
      </div>
    </div>
  );
};
