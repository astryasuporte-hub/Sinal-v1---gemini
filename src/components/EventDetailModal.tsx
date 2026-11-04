/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Event, Entity } from '../types/sinal';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Share2,
  MoreHorizontal,
  Calendar,
  Landmark,
  Play,
  Pause,
  ExternalLink,
  Check,
  Clock,
  Layers,
  Sparkles
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
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>('normal');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Fecha o modal com tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Interrompe qualquer áudio em reprodução ao fechar ou trocar de matéria
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [event?.id]);

  if (!event) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  const handleShare = async () => {
    const shareUrl = `https://fatosbr.com.br/?event=${encodeURIComponent(event.id)}`;
    const shareData = {
      title: `${event.title} — FatosBR`,
      text: `${event.summary}\n\nLeia no FatosBR:`,
      url: shareUrl
    };

    if (navigator.share && /mobile|android|iphone|ipad/i.test(navigator.userAgent)) {
      try {
        await navigator.share(shareData);
        showToast('Compartilhado com sucesso!');
        return;
      } catch {
        // Fallback para área de transferência se cancelar
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Link copiado para a área de transferência');
    } catch {
      showToast('Link pronto para compartilhar');
    }
  };

  // Alternador de reprodução em áudio (Web Speech Synthesis nativa)
  const toggleAudio = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      showToast('Síntese de áudio não suportada neste dispositivo');
      return;
    }

    if (isPlayingAudio) {
      window.speechSynthesis.cancel();
      setIsPlayingAudio(false);
      showToast('Leitura pausada');
      return;
    }

    window.speechSynthesis.cancel();
    const narrationText = `${event.title}. ${event.summary}. ${event.whatHappened || ''}`;
    const utterance = new SpeechSynthesisUtterance(narrationText);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.95;

    utterance.onend = () => setIsPlayingAudio(false);
    utterance.onerror = () => setIsPlayingAudio(false);

    window.speechSynthesis.speak(utterance);
    setIsPlayingAudio(true);
    showToast('Ouvindo matéria...');
  };

  // Ciclo de tamanho da tipografia (Acessibilidade para idosos e leitura zen)
  const cycleFontSize = () => {
    setFontSize((prev) => {
      if (prev === 'normal') {
        showToast('Tamanho do texto: Grande');
        return 'large';
      }
      if (prev === 'large') {
        showToast('Tamanho do texto: Muito Grande');
        return 'xlarge';
      }
      showToast('Tamanho do texto: Padrão');
      return 'normal';
    });
  };

  // Formatação de data e horário conforme referência oficial
  const formatDateTime = (dateString?: string) => {
    if (!dateString) return '18 de abr. de 2025 · 14:51';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;

    const formattedDate = date.toLocaleDateString('pt-BR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    const formattedTime = date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    return `${formattedDate} · ${formattedTime}`;
  };

  const primarySource = event.sources[0]?.sourceName || 'InfoMoney';

  const defaultImage =
    event.category === 'Economia'
      ? 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80'
      : event.category === 'Tecnologia & IA' || event.category === 'Tecnologia'
      ? 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80'
      : 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-reading-title"
      className="fixed inset-0 z-50 w-full h-full bg-[#000000] text-zinc-100 flex flex-col overflow-hidden animate-fade-in"
    >
      {/* Toast Notification Flutuante */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs font-medium shadow-2xl flex items-center gap-2 animate-bounce-short">
          <Check className="w-3.5 h-3.5 text-white" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ========================================================
          CABEÇALHO EDITORIAL COMPACTO & DISCRETO
          (<- | FatosBR | Bookmark | Share | Menu)
      ======================================================== */}
      <header className="sticky top-0 z-40 w-full bg-[#000000]/95 backdrop-blur-md border-b border-zinc-900/80 px-4 sm:px-6 h-14 flex items-center justify-between shrink-0">
        {/* Esquerda: Botão Voltar + Logotipo FatosBR */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center text-zinc-200 hover:text-white transition cursor-pointer active:scale-95"
            aria-label="Voltar para a página anterior"
            title="Voltar"
          >
            <ArrowLeft className="w-5 h-5 text-white stroke-[2.2]" />
          </button>

          <span className="font-extrabold text-lg sm:text-xl text-white tracking-tight select-none">
            Fatos<span className="text-zinc-400 font-semibold">BR</span>
          </span>
        </div>

        {/* Direita: Salvar, Compartilhar e Menu de Opções */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => {
              onToggleSave(event.id);
              showToast(event.isSaved ? 'Notícia removida dos salvos' : 'Notícia salva nos seus itens');
            }}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-300 hover:text-white transition cursor-pointer active:scale-95"
            aria-label={event.isSaved ? 'Notícia Salva' : 'Salvar Notícia'}
            title={event.isSaved ? 'Salva' : 'Salvar notícia'}
          >
            {event.isSaved ? (
              <BookmarkCheck className="w-5 h-5 text-white fill-white" />
            ) : (
              <Bookmark className="w-5 h-5 text-zinc-300 hover:text-white" />
            )}
          </button>

          <button
            onClick={handleShare}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-300 hover:text-white transition cursor-pointer active:scale-95"
            aria-label="Compartilhar Notícia"
            title="Compartilhar"
          >
            <Share2 className="w-5 h-5 text-zinc-300 hover:text-white" />
          </button>

          <div className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-zinc-300 hover:text-white transition cursor-pointer active:scale-95"
              aria-label="Mais opções"
              title="Opções"
            >
              <MoreHorizontal className="w-5 h-5 text-zinc-300 hover:text-white" />
            </button>

            {/* Menu Dropdown Discreto */}
            {isMenuOpen && (
              <div className="absolute right-0 top-12 w-52 rounded-xl bg-[#111216] border border-zinc-800 shadow-2xl p-1.5 z-50 text-xs space-y-1 animate-fade-in">
                <button
                  onClick={() => {
                    handleShare();
                    setIsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-zinc-200 hover:bg-zinc-800 transition flex items-center justify-between"
                >
                  <span>Copiar link</span>
                  <Share2 className="w-3.5 h-3.5 text-zinc-400" />
                </button>
                <button
                  onClick={() => {
                    cycleFontSize();
                    setIsMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-zinc-200 hover:bg-zinc-800 transition flex items-center justify-between"
                >
                  <span>Ajustar tamanho da fonte</span>
                  <span className="font-mono text-[10px] text-zinc-400 uppercase">{fontSize}</span>
                </button>
                {event.sources[0]?.url && (
                  <a
                    href={event.sources[0].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsMenuOpen(false)}
                    className="w-full text-left px-3 py-2.5 rounded-lg text-zinc-200 hover:bg-zinc-800 transition flex items-center justify-between"
                  >
                    <span>Ver matéria original</span>
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ========================================================
          CORPO EDITORIAL PRINCIPAL (SCROLLÁVEL)
          Legibilidade máxima, contraste elevado, tipografia moderna
      ======================================================== */}
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-6 pb-28">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Categoria em Etiqueta Simples e Discreta */}
          <div>
            <span className="inline-block px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-medium tracking-wide">
              {event.category || 'Geral'}
            </span>
          </div>

          {/* Título Principal com Destaque e Quebra Natural */}
          <h1
            id="news-reading-title"
            className="text-2xl sm:text-3xl lg:text-[34px] font-bold text-white tracking-tight leading-[1.28] break-words font-sans"
          >
            {event.title}
          </h1>

          {/* Subtítulo Complementar (sem redundâncias) */}
          {event.summary && (
            <p className="text-base sm:text-lg text-zinc-400 font-normal leading-relaxed break-words font-sans">
              {event.summary}
            </p>
          )}

          {/* Metadados Monocromáticos Discretos */}
          <div className="flex items-center gap-3 text-xs text-zinc-400 font-mono flex-wrap pt-1 border-t border-zinc-900">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>{formatDateTime(event.publishedAt)}</span>
            </div>

            <span className="text-zinc-700 select-none">|</span>

            <div className="flex items-center gap-1.5">
              <Landmark className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="text-zinc-300 font-semibold">{primarySource}</span>
            </div>
          </div>

          {/* Imagem Principal Ampla com Cantos Arredondados (Sem etiquetas sobrepostas) */}
          <div className="w-full aspect-[16/10] sm:aspect-video rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-900 shadow-xl">
            <img
              src={event.imageUrl || defaultImage}
              alt={event.title}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = defaultImage;
              }}
              className="w-full h-full object-cover object-center"
            />
          </div>

          {/* Corpo do Artigo / Matéria Editorial */}
          <article
            className={`space-y-5 text-zinc-200 font-normal selection:bg-zinc-800 selection:text-white transition-all ${
              fontSize === 'normal'
                ? 'text-base sm:text-[17px] leading-[1.8]'
                : fontSize === 'large'
                ? 'text-lg sm:text-[19px] leading-[1.9]'
                : 'text-xl sm:text-[22px] leading-[2.0]'
            }`}
          >
            {/* Parágrafos jornalísticos estruturados */}
            {event.whatHappened ? (
              <p className="text-zinc-100">{event.whatHappened}</p>
            ) : null}

            {event.marketImpact && (
              <p className="text-zinc-300">{event.marketImpact}</p>
            )}

            {event.nextSteps && (
              <p className="text-zinc-300">{event.nextSteps}</p>
            )}

            {/* Seção "Por que isso importa?" (Opcional, curta e específica; oculta se vazia) */}
            {event.whyItMatters && event.whyItMatters.trim().length > 0 && (
              <section className="my-8 p-5 rounded-2xl bg-zinc-950 border border-zinc-800/80 space-y-2">
                <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Por que isso importa</span>
                </h3>
                <p className="text-sm sm:text-base text-zinc-300 leading-relaxed font-normal">
                  {event.whyItMatters}
                </p>
              </section>
            )}

            {/* Cronologia Fidedigna (apenas quando houver marcos e horários distintos) */}
            {event.timeline && event.timeline.length > 0 && (
              <section className="pt-6 my-6 border-t border-zinc-900 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white font-mono flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Cronologia dos fatos</span>
                </h3>
                <div className="space-y-3 pl-2 border-l border-zinc-800">
                  {event.timeline.map((item, idx) => (
                    <div key={item.id || idx} className="text-xs sm:text-sm pl-3 relative">
                      <div className="absolute -left-[17px] top-1.5 w-2 h-2 rounded-full bg-zinc-600 border border-black" />
                      <div className="font-mono text-zinc-400 font-semibold mb-0.5">
                        {item.time || item.date}
                      </div>
                      <div className="text-zinc-200">
                        <strong className="text-white font-semibold">{item.title}:</strong> {item.description}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </article>

          {/* Fontes Jornalísticas Compactas */}
          <section className="pt-8 border-t border-zinc-900 space-y-3">
            <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-400">
              Fontes jornalísticas verificadas
            </h3>
            <div className="flex flex-wrap gap-2">
              {event.sources.map((src) => (
                <a
                  key={src.id}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-white transition cursor-pointer"
                >
                  <span className="font-semibold text-white">{src.sourceName}</span>
                  <span className="text-zinc-500 font-mono text-[11px]">({src.domain})</span>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                </a>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* ========================================================
          BARRA DE AÇÕES INFERIOR EDITORIAL (DOCK FIXO)
          [ Aa Texto ] | [ ▷ Ouvir matéria ] | [ Bookmark Salvar ]
      ======================================================== */}
      <footer className="fixed bottom-0 inset-x-0 z-40 bg-[#000000] border-t border-zinc-900/90 py-2.5 px-4 sm:px-6">
        <div className="max-w-md mx-auto grid grid-cols-3 items-center text-center">
          {/* Ação 1: Ajustar Tamanho do Texto */}
          <button
            onClick={cycleFontSize}
            className="flex flex-col items-center justify-center gap-1 py-1 text-zinc-300 hover:text-white transition cursor-pointer group active:scale-95"
            title="Ajustar tamanho da fonte"
            aria-label="Ajustar tamanho do texto"
          >
            <span className="text-base sm:text-lg font-bold font-serif leading-none tracking-tight group-hover:scale-105 transition-transform">
              Aa
            </span>
            <span className="text-[11px] text-zinc-400 font-sans group-hover:text-zinc-200">
              Texto
            </span>
          </button>

          {/* Divisor Vertical */}
          <div className="flex items-center justify-center">
            <button
              onClick={toggleAudio}
              className="flex flex-col items-center justify-center gap-1 py-1 text-zinc-300 hover:text-white transition cursor-pointer group active:scale-95 w-full border-x border-zinc-800/80 px-2"
              title={isPlayingAudio ? 'Pausar reprodução de voz' : 'Ouvir matéria com síntese de voz'}
              aria-label={isPlayingAudio ? 'Pausar áudio' : 'Ouvir matéria'}
            >
              {isPlayingAudio ? (
                <Pause className="w-5 h-5 text-white animate-pulse" />
              ) : (
                <Play className="w-5 h-5 text-zinc-300 group-hover:text-white group-hover:scale-105 transition-transform" />
              )}
              <span className="text-[11px] text-zinc-400 font-sans group-hover:text-zinc-200">
                {isPlayingAudio ? 'Pausar áudio' : 'Ouvir matéria'}
              </span>
            </button>
          </div>

          {/* Ação 3: Salvar Notícia */}
          <button
            onClick={() => {
              onToggleSave(event.id);
              showToast(event.isSaved ? 'Removido dos salvos' : 'Salvo nos seus favoritos');
            }}
            className="flex flex-col items-center justify-center gap-1 py-1 text-zinc-300 hover:text-white transition cursor-pointer group active:scale-95"
            title={event.isSaved ? 'Notícia salva' : 'Salvar notícia'}
            aria-label="Salvar notícia"
          >
            {event.isSaved ? (
              <BookmarkCheck className="w-5 h-5 text-white fill-white group-hover:scale-105 transition-transform" />
            ) : (
              <Bookmark className="w-5 h-5 text-zinc-300 group-hover:text-white group-hover:scale-105 transition-transform" />
            )}
            <span className="text-[11px] text-zinc-400 font-sans group-hover:text-zinc-200">
              {event.isSaved ? 'Salvo' : 'Salvar'}
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
};
