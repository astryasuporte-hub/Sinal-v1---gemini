/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Event, Entity } from '../types/sinal';
import { FatosBrLogo } from './FatosBrLogo';
import { EntityAvatar } from './EntityAvatar';
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
  Clock
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
  const [heroImgError, setHeroImgError] = useState(false);

  // Reseta estado da imagem e menu ao trocar de matéria
  useEffect(() => {
    setHeroImgError(false);
    setIsMenuOpen(false);
  }, [event?.id]);

  // Fecha o modal com tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isMenuOpen) {
          setIsMenuOpen(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isMenuOpen]);

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

  const primarySource = event.sources[0]?.sourceName || 'Redação FatosBR';
  const sourceCount = event.sources?.length || 0;
  const hasHeroImage = Boolean(event.imageUrl && event.imageUrl.trim().length > 0 && !heroImgError);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-reading-title"
      className="fixed inset-0 z-50 w-full h-full bg-[#000000] text-zinc-100 flex flex-col overflow-hidden animate-fade-in"
    >
      {/* Toast Notification Flutuante */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs font-medium shadow-2xl flex items-center gap-2">
          <Check className="w-3.5 h-3.5 text-white" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ========================================================
          CABEÇALHO EDITORIAL COMPACTO E UNIFICADO COM A HOME
      ======================================================== */}
      <header className="sticky top-0 z-40 w-full bg-[#050507]/95 backdrop-blur-md border-b border-zinc-900/90 px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between shrink-0">
        {/* Esquerda: Botão Voltar + Logotipo Oficial FatosBR */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-xl text-zinc-300 hover:text-white hover:bg-zinc-900/80 transition cursor-pointer active:scale-95"
            aria-label="Voltar para o feed"
            title="Voltar"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2]" />
          </button>

          <FatosBrLogo size="sm" variant="compact" glow={false} onClick={onClose} />
        </div>

        {/* Direita: Ações Consistentes (Salvar, Compartilhar e Menu) */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              onToggleSave(event.id);
              showToast(event.isSaved ? 'Notícia removida dos salvos' : 'Notícia salva nos seus itens');
            }}
            className={`min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center transition cursor-pointer active:scale-95 ${
              event.isSaved
                ? 'text-white bg-zinc-900/90'
                : 'text-zinc-300 hover:text-white hover:bg-zinc-900/80'
            }`}
            aria-label={event.isSaved ? 'Remover dos salvos' : 'Salvar notícia'}
            title={event.isSaved ? 'Salvo' : 'Salvar notícia'}
          >
            {event.isSaved ? (
              <BookmarkCheck className="w-5 h-5 text-white fill-white" />
            ) : (
              <Bookmark className="w-5 h-5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleShare}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-900/80 transition cursor-pointer active:scale-95"
            aria-label="Compartilhar notícia"
            title="Compartilhar"
          >
            <Share2 className="w-5 h-5" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-900/80 transition cursor-pointer active:scale-95"
              aria-label="Mais opções"
              aria-expanded={isMenuOpen}
              title="Opções"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>

            {isMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsMenuOpen(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 top-12 w-56 rounded-2xl bg-[#0e1015] border border-zinc-800 shadow-2xl p-1.5 z-50 text-xs space-y-1 animate-fade-in">
                  <button
                    type="button"
                    onClick={() => {
                      handleShare();
                      setIsMenuOpen(false);
                    }}
                    className="w-full min-h-[40px] text-left px-3 py-2 rounded-xl text-zinc-200 hover:bg-zinc-800/80 transition flex items-center justify-between cursor-pointer"
                  >
                    <span>Copiar link</span>
                    <Share2 className="w-3.5 h-3.5 text-zinc-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      cycleFontSize();
                      setIsMenuOpen(false);
                    }}
                    className="w-full min-h-[40px] text-left px-3 py-2 rounded-xl text-zinc-200 hover:bg-zinc-800/80 transition flex items-center justify-between cursor-pointer"
                  >
                    <span>Tamanho da fonte</span>
                    <span className="font-mono text-[10px] text-zinc-400 uppercase">
                      {fontSize === 'normal' ? 'Padrão' : fontSize === 'large' ? 'Grande' : 'Extra'}
                    </span>
                  </button>
                  {event.sources[0]?.url && (
                    <a
                      href={event.sources[0].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setIsMenuOpen(false)}
                      className="w-full min-h-[40px] text-left px-3 py-2 rounded-xl text-zinc-200 hover:bg-zinc-800/80 transition flex items-center justify-between"
                    >
                      <span>Ler na fonte original</span>
                      <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                    </a>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ========================================================
          CORPO EDITORIAL PRINCIPAL (SCROLLÁVEL)
      ======================================================== */}
      <main className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8 pt-6 sm:pt-9 pb-28">
        <div className="max-w-[680px] mx-auto">
          {/* Bloco de Abertura: Categoria, Título, Subtítulo e Metadados */}
          <div className="space-y-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
              {event.category || 'Geral'}
            </div>

            <h1
              id="news-reading-title"
              className="text-[26px] sm:text-[34px] font-bold text-white tracking-[-0.02em] leading-[1.2] [text-wrap:balance] break-words"
            >
              {event.title}
            </h1>

            {event.summary && (
              <p className="text-base sm:text-[18px] text-zinc-400 font-normal leading-[1.6] break-words">
                {event.summary}
              </p>
            )}

            {/* Metadados Limpos com Tipografia Tabular */}
            <div className="flex items-center gap-2.5 text-xs text-zinc-400 font-mono tabular-nums flex-wrap pt-3 border-t border-zinc-900">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>{formatDateTime(event.publishedAt)}</span>
              </span>

              <span className="text-zinc-700 select-none">·</span>

              <span className="inline-flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span className="text-zinc-200 font-semibold font-sans">{primarySource}</span>
              </span>

              {sourceCount > 1 && (
                <>
                  <span className="text-zinc-700 select-none">·</span>
                  <span className="text-zinc-400 font-sans">
                    {sourceCount} fontes apuradas
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Imagem Editorial Principal (exibida somente se válida) */}
          {hasHeroImage && (
            <figure className="mt-6 mb-8">
              <div className="w-full aspect-[16/10] sm:aspect-video rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-900 shadow-2xl">
                <img
                  src={event.imageUrl}
                  alt={event.title}
                  width={1200}
                  height={675}
                  referrerPolicy="no-referrer"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  onError={() => setHeroImgError(true)}
                  className="w-full h-full object-cover object-center"
                />
              </div>
            </figure>
          )}

          {/* Corpo do Artigo / Matéria Editorial */}
          <article
            className={`space-y-5 text-zinc-200 font-normal selection:bg-white selection:text-black transition-all ${
              !hasHeroImage ? 'mt-7 pt-6 border-t border-zinc-900' : ''
            } ${
              fontSize === 'normal'
                ? 'text-base sm:text-[17px] leading-[1.8]'
                : fontSize === 'large'
                ? 'text-lg sm:text-[19px] leading-[1.88]'
                : 'text-xl sm:text-[21px] leading-[1.95]'
            }`}
          >
            {event.whatHappened ? (
              <p className="text-[#EAECEF]">{event.whatHappened}</p>
            ) : null}

            {event.marketImpact && (
              <p className="text-zinc-300">{event.marketImpact}</p>
            )}

            {event.nextSteps && (
              <p className="text-zinc-300">{event.nextSteps}</p>
            )}

            {/* Seção "Por que isso importa" */}
            {event.whyItMatters && event.whyItMatters.trim().length > 0 && (
              <section className="my-8 p-5 sm:p-6 rounded-2xl bg-[#0c0d11] border border-zinc-800/80 border-l-2 border-l-white space-y-2">
                <h3 className="text-[11px] font-bold font-mono uppercase tracking-[0.12em] text-zinc-300">
                  Por que isso importa
                </h3>
                <p className="text-sm sm:text-base text-zinc-200 leading-relaxed font-normal">
                  {event.whyItMatters}
                </p>
              </section>
            )}

            {/* Cronologia Fidedigna */}
            {event.timeline && event.timeline.length > 0 && (
              <section className="pt-7 my-8 border-t border-zinc-900 space-y-4">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-300 font-mono flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Cronologia dos fatos</span>
                </h3>
                <div className="space-y-4 pl-3 border-l border-zinc-800">
                  {event.timeline.map((item, idx) => (
                    <div key={item.id || idx} className="text-xs sm:text-sm pl-3 relative">
                      <div className="absolute -left-[17px] top-1.5 w-2 h-2 rounded-full bg-zinc-500 border border-black" />
                      <div className="font-mono tabular-nums text-zinc-400 font-semibold mb-1 text-[11px]">
                        {item.time || item.date}
                      </div>
                      <div className="text-zinc-300 leading-relaxed">
                        <strong className="text-white font-semibold">{item.title}:</strong> {item.description}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </article>

          {/* Entidades Relacionadas ao Fato */}
          {event.entities && event.entities.length > 0 && (
            <section className="mt-8 pt-6 border-t border-zinc-900 space-y-3">
              <h3 className="text-[11px] font-mono uppercase tracking-[0.12em] text-zinc-400 font-semibold">
                Entidades e personalidades citadas
              </h3>
              <div className="flex flex-wrap gap-2">
                {event.entities.map((ent) => (
                  <button
                    key={ent.id}
                    type="button"
                    onClick={() => onOpenEntity?.(ent)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0c0d11] hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 text-xs text-zinc-200 transition cursor-pointer"
                  >
                    <EntityAvatar
                      name={ent.name}
                      type={ent.type}
                      imageUrl={ent.imageUrl}
                      logoUrl={ent.logoUrl || ent.avatarUrl}
                      website={ent.website}
                      brandColor={ent.brandColor}
                      size="xs"
                    />
                    <span className="font-medium">{ent.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Fontes Jornalísticas Verificadas */}
          {event.sources && event.sources.length > 0 && (
            <section className="mt-10 pt-7 border-t border-zinc-900 space-y-3.5">
              <h3 className="text-[11px] font-mono uppercase tracking-[0.12em] text-zinc-400 font-semibold">
                Fontes jornalísticas verificadas
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {event.sources.map((src) => (
                  <a
                    key={src.id}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#0c0d11] hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 text-xs text-zinc-300 hover:text-white transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <EntityAvatar
                        name={src.sourceName}
                        type="source"
                        logoUrl={src.logoUrl}
                        domain={src.domain}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">{src.sourceName}</div>
                        {src.domain && (
                          <div className="text-zinc-500 font-mono text-[11px] truncate">{src.domain}</div>
                        )}
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  </a>
                ))}
              </div>
            </section>
          )}
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
