/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FeaturedTopCarousel Component
 * Carrossel superior de manchetes e acontecimentos em destaque no topo do feed Home.
 * - Paleta estritamente monocromática (preto, branco e cinzas)
 * - Design responsivo com touch-swipe e botões de navegação
 * - Destaque editorial com imagem ampla 16:9 e tempo estimado de leitura
 */

import React, { useState, useEffect, useRef } from 'react';
import { Event } from '../types/sinal';
import { ChevronLeft, ChevronRight, Clock, Sparkles, Bookmark, BookmarkCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CompanyLogoBadge } from './CompanyLogoBadge';
import { formatDetailedRelativeTime } from './EventCard';

interface FeaturedTopCarouselProps {
  events: Event[];
  onOpenDetail: (event: Event) => void;
  onToggleSave?: (eventId: string) => void;
}

export const FeaturedTopCarousel: React.FC<FeaturedTopCarouselProps> = ({
  events,
  onOpenDetail,
  onToggleSave
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // Auto-avanço a cada 6 segundos caso o usuário não esteja interagindo
  useEffect(() => {
    if (events.length <= 1 || isPaused) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % events.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [events.length, isPaused]);

  if (!events || events.length === 0) return null;

  const currentEvent = events[currentIndex] || events[0];
  const summaryWords = (currentEvent.summary || '').trim().split(/\s+/).filter(Boolean).length;
  const readingTimeMin = Math.max(1, Math.ceil(summaryWords / 45));
  const primaryEntity = currentEvent.entities && currentEvent.entities[0];
  const displayTime = formatDetailedRelativeTime(currentEvent.publishedAt, currentEvent.relativeTime);

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + events.length) % events.length);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % events.length);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;

    if (Math.abs(diff) > 40) {
      if (diff > 0) {
        // Swipe para a esquerda -> Próximo
        setCurrentIndex((prev) => (prev + 1) % events.length);
      } else {
        // Swipe para a direita -> Anterior
        setCurrentIndex((prev) => (prev - 1 + events.length) % events.length);
      }
    }
    touchStartX.current = null;
  };

  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden bg-[#0c0d10] border border-zinc-800/80 shadow-2xl mb-4 group select-none"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={currentEvent.id || currentIndex}
          initial={{ opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          onClick={() => onOpenDetail(currentEvent)}
          className="relative cursor-pointer overflow-hidden"
        >
          {/* Banner de Imagem 16:9 em Destaque */}
          <div className="relative w-full h-52 sm:h-64 md:h-72 bg-zinc-950 overflow-hidden">
            {currentEvent.imageUrl ? (
              <img
                src={currentEvent.imageUrl}
                alt={currentEvent.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-700 brightness-95"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-zinc-900 to-black flex items-center justify-center">
                <Sparkles className="w-10 h-10 text-zinc-700" />
              </div>
            )}

            {/* Gradiente Escuro Suave para Contraste e Legibilidade do Texto */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-black/40 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent hidden sm:block" />

            {/* Top Badge: Indicador de Destaque / Manchete */}
            <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-20 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white text-black text-[10px] font-bold tracking-wider uppercase shadow-md">
                <Sparkles className="w-3 h-3 text-black" />
                <span>Manchete em Destaque</span>
              </span>

              <span className="text-[10px] font-mono px-2 py-1 rounded-full bg-black/70 backdrop-blur-md text-zinc-300 border border-zinc-700/60 hidden xs:inline-flex">
                {currentEvent.category || 'Geral'}
              </span>
            </div>

            {/* Botão de Salvar Rápido no Topo */}
            {onToggleSave && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSave(currentEvent.id);
                }}
                className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20 p-2 rounded-full bg-black/60 backdrop-blur-md border border-zinc-700/80 text-zinc-300 hover:text-white hover:bg-black/90 transition cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
                title={currentEvent.isSaved ? 'Remover dos salvos' : 'Salvar manchete'}
              >
                {currentEvent.isSaved ? (
                  <BookmarkCheck className="w-4 h-4 text-white" />
                ) : (
                  <Bookmark className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Conteúdo sobreposto na parte inferior do banner */}
            <div className="absolute bottom-0 inset-x-0 p-4 sm:p-5 z-20 space-y-2">
              {/* Metadados: Empresa/Entidade e Tempo */}
              <div className="flex items-center gap-2.5 text-[11px] text-zinc-300 flex-wrap">
                {primaryEntity && (
                  <CompanyLogoBadge
                    name={primaryEntity.name}
                    brandColor={primaryEntity.brandColor}
                    type={primaryEntity.type}
                    logoUrl={primaryEntity.logoUrl}
                  />
                )}
                <span>•</span>
                <span className="text-zinc-300">{displayTime}</span>
                <span>•</span>
                <span className="inline-flex items-center gap-1 text-zinc-400 font-mono">
                  <Clock className="w-3 h-3" />
                  <span>{readingTimeMin} min de leitura</span>
                </span>
              </div>

              {/* Título Principal */}
              <h2 className="text-base sm:text-lg md:text-xl font-bold text-white leading-snug line-clamp-2 drop-shadow-md">
                {currentEvent.title}
              </h2>

              {/* Resumo Direto */}
              <p className="text-xs sm:text-sm text-zinc-300/90 line-clamp-2 max-w-2xl leading-relaxed hidden xs:block">
                {currentEvent.summary}
              </p>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Controles de Navegação: Botões Esquerda / Direita no Desktop */}
      {events.length > 1 && (
        <>
          <button
            onClick={handlePrev}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 z-30 p-2 rounded-full bg-black/60 hover:bg-black/90 border border-zinc-700/80 text-zinc-300 hover:text-white transition opacity-0 group-hover:opacity-100 hidden sm:flex items-center justify-center cursor-pointer shadow-lg"
            aria-label="Manchete anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            onClick={handleNext}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 z-30 p-2 rounded-full bg-black/60 hover:bg-black/90 border border-zinc-700/80 text-zinc-300 hover:text-white transition opacity-0 group-hover:opacity-100 hidden sm:flex items-center justify-center cursor-pointer shadow-lg"
            aria-label="Próxima manchete"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Indicadores de Slide (Barras/Dots no rodapé do carrossel) */}
          <div className="px-4 py-2 bg-[#090a0c] border-t border-zinc-800/80 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {events.map((_, idx) => (
                <button
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentIndex(idx);
                  }}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    currentIndex === idx
                      ? 'w-7 bg-white'
                      : 'w-2 bg-zinc-700 hover:bg-zinc-500'
                  }`}
                  aria-label={`Ir para manchete ${idx + 1}`}
                />
              ))}
            </div>

            <div className="text-[10px] font-mono text-zinc-400">
              {currentIndex + 1} de {events.length} destaques
            </div>
          </div>
        </>
      )}
    </div>
  );
};
