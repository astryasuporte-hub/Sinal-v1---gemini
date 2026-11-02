/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Banner de Consentimento & Conformidade LGPD (Lei nº 13.709/2018)
 * Discreto, estritamente monocromático e otimizado para mobile.
 */

import React, { useState, useEffect } from 'react';
import { Shield, ChevronRight, Check } from 'lucide-react';

export interface CookieConsentBannerProps {
  onOpenLegal: (tab?: 'terms' | 'lgpd' | 'cdc' | 'owner-rights' | 'dpo') => void;
}

export const CookieConsentBanner: React.FC<CookieConsentBannerProps> = ({
  onOpenLegal
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      const consent = localStorage.getItem('fatosbr_lgpd_consent_v1');
      if (!consent) {
        const timer = setTimeout(() => setIsVisible(true), 1200);
        return () => clearTimeout(timer);
      }
    } catch {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    try {
      localStorage.setItem('fatosbr_lgpd_consent_v1', 'accepted');
      localStorage.setItem('fatosbr_lgpd_consent_timestamp', new Date().toISOString());
    } catch {}
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-20 md:bottom-5 left-3 right-3 md:left-auto md:right-5 md:max-w-md z-40 animate-fadeIn">
      <div className="p-4 rounded-2xl bg-black/95 backdrop-blur-md border border-zinc-800 shadow-2xl text-zinc-200 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center text-white shrink-0 mt-0.5">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white">Privacidade & LGPD</span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-700 font-bold">
                Lei 13.709/18
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Utilizamos dados estritamente necessários para personalizar seus temas e compor os briefings editoriais. Não comercializamos suas informações com terceiros.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
          <button
            onClick={() => onOpenLegal('lgpd')}
            className="px-3 py-2 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 min-h-[40px]"
          >
            <span>Ler Termos & Direitos</span>
            <ChevronRight className="w-3 h-3 text-zinc-400" />
          </button>

          <button
            onClick={handleAccept}
            className="flex-1 px-3 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-[11px] transition cursor-pointer flex items-center justify-center gap-1 shadow-sm min-h-[40px]"
          >
            <Check className="w-3.5 h-3.5 text-black" />
            <span>Concordar e Continuar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
