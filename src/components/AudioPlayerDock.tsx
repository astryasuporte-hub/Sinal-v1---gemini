/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  X,
  Gauge,
  Headphones,
  Maximize2
} from 'lucide-react';
import { audioSpeechService, AudioPlaybackState } from '../services/audioSpeechService';
import { Event } from '../types/sinal';

interface AudioPlayerDockProps {
  onOpenEventDetail?: (event: Event) => void;
}

export const AudioPlayerDock: React.FC<AudioPlayerDockProps> = ({ onOpenEventDetail }) => {
  const [state, setState] = useState<AudioPlaybackState>(audioSpeechService.getState());

  useEffect(() => {
    const unsubscribe = audioSpeechService.subscribe((newState) => {
      setState(newState);
    });
    return () => unsubscribe();
  }, []);

  const event = state.currentEvent;
  if (!event || (!state.isPlaying && !state.isPaused)) {
    return null;
  }

  return (
    <div className="fixed bottom-20 sm:bottom-6 left-3 right-3 sm:left-auto sm:right-6 sm:w-[440px] z-50 animate-feed-fade">
      <div className="relative rounded-2xl bg-[#0e1117] border border-zinc-700/60 shadow-[0_12px_40px_rgba(0,0,0,0.8)] overflow-hidden backdrop-blur-xl">
        {/* Barra de Progresso Superior */}
        <div className="h-1 w-full bg-zinc-800/80">
          <div
            className="h-full bg-gradient-to-r from-blue-500 via-indigo-400 to-emerald-400 transition-all duration-500"
            style={{ width: `${Math.min(Math.max(state.progressPercent, 2), 100)}%` }}
          />
        </div>

        <div className="p-3.5 sm:p-4 space-y-2.5">
          {/* Linha Superior: Categoria, Fila e Fechar */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-bold truncate">
                {event.category || 'Acontecimento'}
              </span>
              {state.isQueueMode && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/40">
                  {state.currentIndex + 1}/{state.totalInQueue}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onOpenEventDetail && (
                <button
                  onClick={() => onOpenEventDetail(event)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                  title="Expandir matéria completa"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => audioSpeechService.stop()}
                className="p-1 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition cursor-pointer"
                title="Fechar reprodutor"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Linha Central: Título e Detalhe */}
          <div
            onClick={() => onOpenEventDetail && onOpenEventDetail(event)}
            className="flex items-start gap-3 cursor-pointer group"
          >
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0 text-blue-400 shadow-sm group-hover:scale-105 transition-transform">
              <Headphones className="w-4 h-4" />
            </div>

            <div className="min-w-0 flex-1">
              <h4 className="text-xs sm:text-sm font-semibold text-white truncate group-hover:text-blue-300 transition-colors">
                {event.title}
              </h4>
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                {event.summary}
              </p>
            </div>
          </div>

          {/* Linha Inferior: Controles de Reprodução */}
          <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60">
            {/* Controle de Velocidade */}
            <button
              onClick={() => audioSpeechService.cycleRate()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white text-[11px] font-mono font-medium transition cursor-pointer"
              title="Alternar velocidade de reprodução"
            >
              <Gauge className="w-3 h-3 text-zinc-400" />
              <span>{state.rate.toFixed(2).replace('.00', '')}x</span>
            </button>

            {/* Controles: Anterior, Play/Pause, Próximo */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => audioSpeechService.previous()}
                disabled={!state.isQueueMode || state.currentIndex === 0}
                className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/80 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                title="Acontecimento anterior"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                onClick={() => audioSpeechService.togglePlayPause()}
                className="w-8 h-8 rounded-full bg-white hover:bg-zinc-200 text-black flex items-center justify-center transition shadow-md cursor-pointer active:scale-95"
                title={state.isPlaying ? 'Pausar' : 'Reproduzir'}
              >
                {state.isPlaying ? (
                  <Pause className="w-4 h-4 fill-black text-black" />
                ) : (
                  <Play className="w-4 h-4 fill-black text-black ml-0.5" />
                )}
              </button>

              <button
                onClick={() => audioSpeechService.next()}
                disabled={!state.isQueueMode || state.currentIndex >= state.totalInQueue - 1}
                className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/80 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                title="Próximo acontecimento"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Indicador de Status */}
            <div className="text-[10px] font-mono text-zinc-500">
              {state.isPlaying ? 'Reproduzindo' : 'Pausado'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
