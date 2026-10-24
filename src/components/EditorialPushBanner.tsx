/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ArrowRight, Bell, Sparkles } from 'lucide-react';
import { Event } from '../types/sinal';

export interface PushNotificationPayload {
  id: string;
  title: string;
  summary: string;
  category?: string;
  timestamp?: string;
  event?: Event;
}

interface EditorialPushBannerProps {
  notification: PushNotificationPayload | null;
  onClose: () => void;
  onOpenEvent?: (event: Event) => void;
  autoDismissMs?: number;
}

export const EditorialPushBanner: React.FC<EditorialPushBannerProps> = ({
  notification,
  onClose,
  onOpenEvent,
  autoDismissMs = 8000
}) => {
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (!notification || autoDismissMs <= 0 || isPaused) return;

    const timer = setTimeout(() => {
      onClose();
    }, autoDismissMs);

    return () => clearTimeout(timer);
  }, [notification, autoDismissMs, isPaused, onClose]);

  if (!notification) return null;

  const handleBannerClick = () => {
    if (notification.event && onOpenEvent) {
      onOpenEvent(notification.event);
      onClose();
    }
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-2rem)] max-w-xl pointer-events-none">
      <motion.div
        initial={{ y: -40, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -40, opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        className="pointer-events-auto relative rounded-2xl bg-[#08090d]/95 backdrop-blur-md border border-zinc-700/80 hover:border-zinc-500 shadow-2xl shadow-black/90 p-4 sm:p-5 text-zinc-100 transition-colors group cursor-pointer"
        onClick={handleBannerClick}
      >
        {/* Top Header Row: Editorial Kicker & Dismiss Button */}
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/80">
          <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-zinc-400">
            <span className="font-bold text-white">FATOS BR</span>
            <span aria-hidden="true" className="text-zinc-600">·</span>
            <span>{notification.category || 'URGENTE'}</span>
            <span aria-hidden="true" className="text-zinc-600">·</span>
            <span className="text-zinc-500">{notification.timestamp || 'Agora'}</span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="p-1 -mr-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition cursor-pointer"
            aria-label="Fechar notificação"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content Body: High-contrast Editorial Serif Headline & Summary */}
        <div className="space-y-1.5 pr-2">
          <h4 className="text-sm sm:text-base font-serif font-bold text-white tracking-tight leading-snug line-clamp-2">
            {notification.title}
          </h4>
          <p className="text-xs text-zinc-300 font-sans leading-relaxed line-clamp-2">
            {notification.summary}
          </p>
        </div>

        {/* Footer Action Strip */}
        <div className="flex items-center justify-between pt-3 mt-3 border-t border-zinc-800/60 text-[11px]">
          <span className="text-zinc-500 font-mono text-[10px]">
            Toque para inspecionar fontes e análise
          </span>
          <span className="inline-flex items-center gap-1 font-semibold text-white group-hover:text-cyan-400 transition-colors">
            <span>Ler matéria</span>
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </div>
      </motion.div>
    </div>
  );
};
