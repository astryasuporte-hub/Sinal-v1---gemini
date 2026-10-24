/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Zap,
  Coffee,
  ShieldCheck,
  X,
  RotateCcw,
  Volume2,
  VolumeX,
  ExternalLink,
  Radio,
  Clock,
  Sparkles
} from 'lucide-react';
import {
  creatorNotificationService,
  CreatorNotification,
  CreatorUrgency
} from '../services/creatorNotificationService';

interface CreatorAlertBannerProps {
  onOpenAction?: (notification: CreatorNotification) => void;
}

export const CreatorAlertBanner: React.FC<CreatorAlertBannerProps> = ({ onOpenAction }) => {
  const [notification, setNotification] = useState<CreatorNotification | null>(() =>
    creatorNotificationService.getActiveNotification()
  );
  const [soundMuted, setSoundMuted] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    return creatorNotificationService.subscribe((active) => {
      setNotification(active);
      setIsExiting(false);
    });
  }, []);

  if (!notification) return null;

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      creatorNotificationService.dismiss();
      setIsExiting(false);
    }, 250);
  };

  const handleRepeatTake = (seconds: number = 5) => {
    creatorNotificationService.repeatTake(seconds);
  };

  // Cores, gradientes e estilos conforme o nível de urgência
  const getUrgencyConfig = (urgency: CreatorUrgency) => {
    switch (urgency) {
      case 'breaking':
        return {
          glowClass: 'shadow-[0_15px_45px_-5px_rgba(239,68,68,0.45)] border-red-500/80',
          badgeBg: 'bg-red-500/15 border-red-500/40 text-red-300',
          badgeText: 'PLANTÃO URGENTE',
          accentGradient: 'from-red-600 via-rose-500 to-amber-500',
          dotColor: 'bg-red-500',
          icon: AlertTriangle,
          soundChime: true
        };
      case 'flash':
        return {
          glowClass: 'shadow-[0_15px_45px_-5px_rgba(6,182,212,0.45)] border-cyan-400/80',
          badgeBg: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300',
          badgeText: 'SINAL FLASH',
          accentGradient: 'from-cyan-500 via-blue-500 to-indigo-500',
          dotColor: 'bg-cyan-400',
          icon: Zap,
          soundChime: true
        };
      case 'editorial':
        return {
          glowClass: 'shadow-[0_15px_45px_-5px_rgba(245,158,11,0.45)] border-amber-400/80',
          badgeBg: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
          badgeText: 'BRIEFING 07h00',
          accentGradient: 'from-amber-500 via-orange-500 to-emerald-500',
          dotColor: 'bg-amber-400',
          icon: Coffee,
          soundChime: true
        };
      case 'high':
      default:
        return {
          glowClass: 'shadow-[0_15px_45px_-5px_rgba(168,85,247,0.45)] border-purple-500/80',
          badgeBg: 'bg-purple-500/15 border-purple-500/40 text-purple-300',
          badgeText: 'ALERTA ANALÍTICO',
          accentGradient: 'from-purple-500 via-indigo-500 to-blue-500',
          dotColor: 'bg-purple-400',
          icon: ShieldCheck,
          soundChime: true
        };
    }
  };

  const config = getUrgencyConfig(notification.urgency);
  const IconComponent = config.icon;

  return (
    <div
      role="alert"
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-[9999] w-[95%] max-w-2xl transition-all duration-300 ease-out transform ${
        isExiting ? '-translate-y-8 opacity-0 scale-95' : 'translate-y-0 opacity-100 scale-100'
      }`}
    >
      <div
        className={`relative overflow-hidden rounded-2xl bg-[#090d18]/95 backdrop-blur-2xl border ${config.glowClass} text-white shadow-2xl p-4 sm:p-5`}
      >
        {/* Barra superior de gradiente iridescente pulsante */}
        <div
          className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${config.accentGradient} animate-pulse`}
        />

        {/* Linha de Cabeçalho: Badge, Categoria, Timestamp e Controles */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Indicador de Transmissão ao Vivo */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] font-mono tracking-wider text-zinc-200 uppercase">
              <span className={`w-2 h-2 rounded-full ${config.dotColor} animate-ping`} />
              <span className="font-bold flex items-center gap-1">
                <Radio className="w-3 h-3 text-white" />
                AO VIVO
              </span>
            </div>

            {/* Tag de Urgência Personalizada */}
            <span
              className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold tracking-wider font-mono border uppercase ${config.badgeBg}`}
            >
              {notification.sourceBadge || config.badgeText}
            </span>

            {/* Categoria */}
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">
              {notification.category}
            </span>
          </div>

          {/* Controles de Direita: Hora, Som e Fechar */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1 bg-[#121727] px-2 py-0.5 rounded border border-zinc-800">
              <Clock className="w-3 h-3 text-zinc-400" />
              {notification.timestampText || 'Agora há pouco'}
            </span>

            <button
              onClick={() => {
                if (soundMuted) {
                  creatorNotificationService.playAlertChime();
                }
                setSoundMuted(!soundMuted);
              }}
              className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition cursor-pointer"
              title={soundMuted ? 'Ativar som' : 'Silenciar som'}
            >
              {soundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-blue-400" />}
            </button>

            <button
              onClick={handleDismiss}
              className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition cursor-pointer"
              title="Fechar alerta"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Título Principal com Tipografia de Capa */}
        <div className="flex items-start gap-3 my-1.5">
          <div
            className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center bg-white/5 border border-white/10 shadow-inner mt-0.5`}
          >
            <IconComponent className="w-4 h-4 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-sm sm:text-base font-extrabold text-white leading-snug tracking-tight">
              {notification.title}
            </h3>

            {/* Resumo Analítico Sintetizado */}
            <p className="text-xs sm:text-[13px] text-zinc-200/90 leading-relaxed mt-1.5 font-normal">
              {notification.summary}
            </p>
          </div>
        </div>

        {/* Barra de Ações Rápidas & Utilitários de Gravação */}
        <div className="mt-3.5 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenAction?.(notification)}
              className="px-3 py-1.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-md"
            >
              <span>Explorar no Feed</span>
              <ExternalLink className="w-3 h-3" />
            </button>

            <button
              onClick={() => handleRepeatTake(5)}
              className="px-2.5 py-1.5 rounded-xl bg-[#161c2e] hover:bg-[#1e263d] border border-[#232c45] text-zinc-300 hover:text-white font-medium text-xs flex items-center gap-1.5 transition cursor-pointer"
              title="Dispara este mesmo alerta novamente em 5 segundos para você regravar o take"
            >
              <RotateCcw className="w-3 h-3 text-amber-400" />
              <span>Regravar Take (5s)</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-400">
              FatosBR Intelligence • Modo Criador
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
