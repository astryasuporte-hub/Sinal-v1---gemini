/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Event } from '../types/sinal';

export type PlaybackRate = 1.0 | 1.25 | 1.5 | 2.0;

export interface AudioPlaybackState {
  currentEvent: Event | null;
  isPlaying: boolean;
  isPaused: boolean;
  rate: PlaybackRate;
  progressPercent: number; // 0 a 100
  currentIndex: number;
  totalInQueue: number;
  isQueueMode: boolean;
}

type AudioStateListener = (state: AudioPlaybackState) => void;

class AudioSpeechService {
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private queue: Event[] = [];
  private currentQueueIndex = 0;
  private currentRate: PlaybackRate = 1.0;
  private isPlaying = false;
  private isPaused = false;
  private progressInterval: any = null;
  private progressPercent = 0;
  private estimatedDurationSec = 0;
  private elapsedSec = 0;
  private listeners: Set<AudioStateListener> = new Set();
  private bestVoice: SpeechSynthesisVoice | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      this.initVoices();
      try {
        if (this.synth.onvoiceschanged !== undefined) {
          this.synth.onvoiceschanged = () => this.initVoices();
        }
      } catch {}
    }
  }

  private initVoices(): void {
    if (!this.synth) return;
    try {
      const voices = this.synth.getVoices();
      if (!voices || voices.length === 0) return;

      // Prioriza vozes em pt-BR de alta fidelidade
      const ptVoices = voices.filter(
        (v) => v.lang && (v.lang.toLowerCase().startsWith('pt') || v.lang.toLowerCase().includes('br'))
      );

      this.bestVoice =
        ptVoices.find((v) => v.lang === 'pt-BR' && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Luciana') || v.name.includes('Francisca'))) ||
        ptVoices.find((v) => v.lang === 'pt-BR') ||
        ptVoices[0] ||
        voices.find((v) => v.lang.startsWith('pt')) ||
        null;
    } catch {
      this.bestVoice = null;
    }
  }

  public subscribe(listener: AudioStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.warn('Listener de áudio descartado:', err);
      }
    });
  }

  public getState(): AudioPlaybackState {
    const currentEvent = this.queue[this.currentQueueIndex] || null;
    return {
      currentEvent,
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      rate: this.currentRate,
      progressPercent: this.progressPercent,
      currentIndex: this.currentQueueIndex,
      totalInQueue: this.queue.length,
      isQueueMode: this.queue.length > 1
    };
  }

  /**
   * Calcula o texto editorial polido a ser narrado para o evento
   */
  public getSpeechTextForEvent(event: Event): string {
    const category = event.category ? `Na categoria ${event.category}.` : '';
    const title = event.title;
    const summary = event.summary;
    const sourcesCount = event.sources?.length || 1;
    const sourcesText = `Informação consolidada a partir de ${sourcesCount} fontes jornalísticas convergentes.`;

    let implications = '';
    if (event.whyItMatters) {
      implications = `Por que isso importa: ${event.whyItMatters}.`;
    }

    return `${title}. ${category} ${summary} ${implications} ${sourcesText}`;
  }

  /**
   * Estima o tempo de duração da narração em segundos (baseado na média de ~130 palavras/minuto)
   */
  public estimateDurationSeconds(text: string, rate: PlaybackRate = 1.0): number {
    const wordCount = text.trim().split(/\s+/).length;
    const baseSeconds = Math.ceil((wordCount / 130) * 60);
    return Math.max(Math.round(baseSeconds / rate), 15);
  }

  /**
   * Toca um único evento isoladamente
   */
  public playEvent(event: Event): void {
    this.queue = [event];
    this.currentQueueIndex = 0;
    this.startPlayback(event);
  }

  /**
   * Toca uma fila de eventos sequencialmente (ex: "Ouvir Principais do Dia")
   */
  public playQueue(events: Event[], startIndex = 0): void {
    if (!events || events.length === 0) return;
    this.queue = [...events];
    this.currentQueueIndex = Math.min(Math.max(startIndex, 0), events.length - 1);
    this.startPlayback(this.queue[this.currentQueueIndex]);
  }

  private startPlayback(event: Event): void {
    if (!this.synth) {
      console.warn('SpeechSynthesis não suportado neste navegador.');
      return;
    }

    // Limpa reprodução anterior com desconexão de callbacks
    this.stopInternal(false);

    const textToSpeak = this.getSpeechTextForEvent(event);
    this.estimatedDurationSec = this.estimateDurationSeconds(textToSpeak, this.currentRate);
    this.elapsedSec = 0;
    this.progressPercent = 0;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = 'pt-BR';
    utterance.rate = this.currentRate;
    utterance.pitch = 1.0;

    if (!this.bestVoice) {
      this.initVoices();
    }
    if (this.bestVoice) {
      utterance.voice = this.bestVoice;
    }

    utterance.onstart = () => {
      if (this.currentUtterance !== utterance) return;
      this.isPlaying = true;
      this.isPaused = false;
      this.startProgressTracker();
      this.notify();
    };

    utterance.onpause = () => {
      if (this.currentUtterance !== utterance) return;
      this.isPaused = true;
      this.clearIntervalTracker();
      this.notify();
    };

    utterance.onresume = () => {
      if (this.currentUtterance !== utterance) return;
      this.isPaused = false;
      this.startProgressTracker();
      this.notify();
    };

    utterance.onend = () => {
      if (this.currentUtterance !== utterance) return;
      this.clearIntervalTracker();
      this.progressPercent = 100;
      this.notify();

      // Avança para o próximo da fila se houver
      if (this.currentQueueIndex < this.queue.length - 1) {
        setTimeout(() => {
          this.currentQueueIndex++;
          this.startPlayback(this.queue[this.currentQueueIndex]);
        }, 500);
      } else {
        this.isPlaying = false;
        this.isPaused = false;
        this.notify();
      }
    };

    utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
      // Ignora cancelamentos e interrupções normais ao trocar de faixa ou parar o player
      if (e.error === 'canceled' || e.error === 'interrupted') {
        return;
      }
      if (this.currentUtterance !== utterance) return;

      console.warn('Aviso na síntese de voz (Web Speech):', e.error || 'evento cancelado');
      this.clearIntervalTracker();
      this.isPlaying = false;
      this.isPaused = false;
      this.notify();
    };

    this.currentUtterance = utterance;

    try {
      if (this.synth.paused) {
        this.synth.resume();
      }
      this.synth.speak(utterance);
      this.isPlaying = true;
      this.isPaused = false;
      this.notify();
    } catch (err) {
      console.warn('Falha ao iniciar síntese de voz:', err);
      this.isPlaying = false;
      this.isPaused = false;
      this.notify();
    }
  }

  private startProgressTracker(): void {
    this.clearIntervalTracker();
    this.progressInterval = setInterval(() => {
      this.elapsedSec += 0.5;
      if (this.estimatedDurationSec > 0) {
        this.progressPercent = Math.min(Math.round((this.elapsedSec / this.estimatedDurationSec) * 100), 98);
        this.notify();
      }
    }, 500);
  }

  private clearIntervalTracker(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  public pause(): void {
    if (!this.synth || !this.isPlaying) return;
    try {
      this.synth.pause();
    } catch {}
    this.isPaused = true;
    this.clearIntervalTracker();
    this.notify();
  }

  public resume(): void {
    if (!this.synth) return;
    if (this.isPaused) {
      try {
        this.synth.resume();
      } catch {}
      this.isPaused = false;
      this.startProgressTracker();
      this.notify();
    } else if (this.queue[this.currentQueueIndex]) {
      this.startPlayback(this.queue[this.currentQueueIndex]);
    }
  }

  public togglePlayPause(): void {
    if (this.isPaused) {
      this.resume();
    } else if (this.isPlaying) {
      this.pause();
    } else if (this.queue.length > 0) {
      this.startPlayback(this.queue[this.currentQueueIndex]);
    }
  }

  public next(): void {
    if (this.currentQueueIndex < this.queue.length - 1) {
      this.currentQueueIndex++;
      this.startPlayback(this.queue[this.currentQueueIndex]);
    }
  }

  public previous(): void {
    if (this.currentQueueIndex > 0) {
      this.currentQueueIndex--;
      this.startPlayback(this.queue[this.currentQueueIndex]);
    } else if (this.queue[0]) {
      this.startPlayback(this.queue[0]);
    }
  }

  public setRate(rate: PlaybackRate): void {
    this.currentRate = rate;
    if (this.isPlaying && this.queue[this.currentQueueIndex]) {
      // Reinicia a fala com o novo ritmo mantendo a experiência fluida
      this.startPlayback(this.queue[this.currentQueueIndex]);
    } else {
      this.notify();
    }
  }

  public cycleRate(): void {
    const rates: PlaybackRate[] = [1.0, 1.25, 1.5, 2.0];
    const currentIndex = rates.indexOf(this.currentRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    this.setRate(nextRate);
  }

  private stopInternal(resetQueue = true): void {
    this.clearIntervalTracker();
    if (this.currentUtterance) {
      // Desconecta callbacks para evitar que cancelamentos assíncronos interfiram no novo áudio
      this.currentUtterance.onstart = null;
      this.currentUtterance.onpause = null;
      this.currentUtterance.onresume = null;
      this.currentUtterance.onend = null;
      this.currentUtterance.onerror = null;
      this.currentUtterance = null;
    }
    if (this.synth) {
      try {
        this.synth.cancel();
      } catch {}
    }
    this.isPlaying = false;
    this.isPaused = false;
    this.progressPercent = 0;
    if (resetQueue) {
      this.queue = [];
      this.currentQueueIndex = 0;
    }
  }

  public stop(): void {
    this.stopInternal(true);
    this.notify();
  }
}

export const audioSpeechService = new AudioSpeechService();
