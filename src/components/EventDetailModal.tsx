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
  Link as LinkIcon
} from 'lucide-react';

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

        {/* ================= CORPO EDITORIAL — MODO LEITURA FOCADO (ZEN) ================= */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8 pt-4 pb-20 space-y-6">
          {/* Metadados Unboxed (Zero-Pill) */}
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 flex-wrap">
            <span className="text-white font-bold uppercase tracking-wider text-[11px]">
              {event.category}
            </span>
            <span className="text-zinc-600">·</span>
            <span>{event.relativeTime || 'Hoje'}</span>
            <span className="text-zinc-600">·</span>
            <span>{readingTimeMin} min de leitura</span>
            {event.sources[0] && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-300 font-semibold">{event.sources[0].sourceName}</span>
              </>
            )}
          </div>

          {/* Imagem de Capa Cinematográfica */}
          <div className="relative w-full aspect-video sm:h-72 rounded-2xl overflow-hidden border border-[#1f2229] bg-zinc-950 shadow-xl">
            <img
              src={event.imageUrl || defaultFallbackImage}
              alt={event.title}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = defaultFallbackImage;
              }}
              className="w-full h-full object-cover object-center filter brightness-95 contrast-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-transparent to-transparent opacity-80" />
            <div className="absolute bottom-3 left-4 px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md border border-white/10 text-[11px] text-zinc-300 font-mono">
              Fonte apurada: {event.sources[0]?.sourceName || 'FatosBR News Engine'}
            </div>
          </div>

          {/* Cabeçalho da Notícia: Título Completo e Subtítulo */}
          <div className="space-y-3 pt-1">
            <h1
              id="event-modal-title"
              className="text-2xl sm:text-3xl lg:text-[32px] font-bold text-white tracking-tight leading-[1.25] break-words"
            >
              {event.title}
            </h1>

            <p className="text-base sm:text-lg text-zinc-300 font-normal leading-relaxed break-words border-l-2 border-zinc-700 pl-4 py-1 italic">
              {event.summary}
            </p>
          </div>

          {/* Notícia Completa na Íntegra — Leitura Fluída e Tranquila */}
          <article className="space-y-5 text-[16px] sm:text-[17px] text-zinc-200 leading-[1.85] font-normal selection:bg-zinc-700 selection:text-white pt-2">
            {/* Parágrafo de Abertura / Fato Principal */}
            <p className="first-letter:text-3xl first-letter:font-bold first-letter:mr-1 first-letter:float-left first-letter:text-white">
              {event.whatHappened || event.summary}
            </p>

            {/* Parágrafo de Aprofundamento Editorial */}
            {event.summary && event.summary !== event.whatHappened && (
              <p>
                {event.summary}
              </p>
            )}

            {/* Análise de Contexto e Relevância em Texto Corrido */}
            {event.whyItMatters && (
              <div className="my-6 p-5 rounded-2xl bg-[#111216]/80 border-l-4 border-white/60 space-y-2">
                <span className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-bold block">
                  Por que este acontecimento é relevante
                </span>
                <p className="text-[15px] sm:text-base text-zinc-300 leading-relaxed font-normal">
                  {event.whyItMatters}
                </p>
              </div>
            )}

            {/* Impacto de Mercado e Regulatório (se disponível) */}
            {event.marketImpact && (
              <p>
                {event.marketImpact}
              </p>
            )}

            {/* Próximos Passos e Monitoramento */}
            {event.nextSteps && (
              <p className="text-zinc-300">
                {event.nextSteps}
              </p>
            )}

            {/* Linha do Tempo Discreta (se houver histórico) */}
            {event.timeline && event.timeline.length > 0 && (
              <div className="pt-6 mt-8 border-t border-zinc-800/80 space-y-4">
                <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white">
                  Cronologia dos acontecimentos
                </h3>
                <div className="space-y-3">
                  {event.timeline.map((item, idx) => (
                    <div key={item.id || idx} className="flex items-start gap-3 text-xs sm:text-sm">
                      <span className="font-mono text-zinc-400 shrink-0 mt-0.5 font-semibold">
                        {item.time || item.date}
                      </span>
                      <span className="text-zinc-600">·</span>
                      <span className="text-zinc-200">
                        <strong className="text-white font-semibold">{item.title}:</strong> {item.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </article>

          {/* Rodapé do Artigo: Fonte Original e Créditos */}
          <div className="pt-8 border-t border-zinc-800/80 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
              <span>Fontes Jornalísticas ({event.sources.length})</span>
              <span>Cobertura Verificada</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {event.sources.map((src) => (
                <a
                  key={src.id}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#111216] hover:bg-[#16181f] border border-zinc-800 hover:border-zinc-600 text-xs text-zinc-300 hover:text-white transition cursor-pointer"
                >
                  <span className="font-semibold text-white">{src.sourceName}</span>
                  <span className="text-zinc-500 font-mono">({src.domain})</span>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* ================= BARRA INFERIOR FIXA TRANQUILA ================= */}
        <footer className="sticky bottom-0 z-30 px-4 sm:px-6 py-3 bg-[#0c0d10]/98 border-t border-[#1f2229] backdrop-blur-md flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onToggleSave(event.id);
                showToast(event.isSaved ? 'Removido dos salvos' : 'Salvo nos seus favoritos');
              }}
              className={`min-h-[42px] px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
                event.isSaved
                  ? 'bg-white text-black border-white'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {event.isSaved ? (
                <>
                  <BookmarkCheck className="w-4 h-4 fill-black" />
                  <span>Salvo</span>
                </>
              ) : (
                <>
                  <Bookmark className="w-4 h-4" />
                  <span>Salvar notícia</span>
                </>
              )}
            </button>

            <button
              onClick={handleShare}
              className="min-h-[42px] px-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition cursor-pointer text-xs font-semibold flex items-center gap-1.5"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Compartilhar</span>
            </button>
          </div>

          <a
            href={event.sources[0]?.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[42px] px-4 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition flex items-center justify-center gap-2 shadow-md cursor-pointer ml-auto"
          >
            <span>Ler matéria na íntegra no {event.sources[0]?.sourceName || 'Veículo Original'}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </footer>
      </div>
    </div>
  );
};
