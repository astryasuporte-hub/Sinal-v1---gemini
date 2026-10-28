/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useI18n, LanguageCode, SUPPORTED_LANGUAGES } from '../i18n';

interface LanguageSelectorProps {
  variant?: 'compact' | 'dropdown' | 'inline' | 'minimal';
  className?: string;
  onLanguageChange?: (lang: LanguageCode) => void;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  variant = 'dropdown',
  className = '',
  onLanguageChange
}) => {
  const { language, setLanguage, currentLanguageMeta, t, isRTL } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (code: LanguageCode) => {
    setLanguage(code);
    setIsOpen(false);
    onLanguageChange?.(code);
  };

  // Modo Inline (para modais de configurações/aparência)
  if (variant === 'inline') {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = lang.code === language;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => handleSelect(lang.code)}
                className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition cursor-pointer text-xs ${
                  isSelected
                    ? 'bg-zinc-800 border-zinc-500 text-white shadow-sm ring-1 ring-zinc-500'
                    : 'bg-[#121418] border-[#1e2026] text-zinc-400 hover:text-white hover:bg-[#16181f]'
                }`}
              >
                <span className="text-base select-none">{lang.flag}</span>
                <div className="overflow-hidden min-w-0 flex-1">
                  <div className="font-bold text-white truncate text-[11px] leading-tight">
                    {lang.nativeName}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate">
                    {lang.code === 'ar' ? 'العربية (RTL)' : lang.name}
                  </div>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Modo Compacto (para Sidebar / Navbar)
  if (variant === 'compact') {
    return (
      <div className={`relative ${className}`} ref={containerRef}>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#111216] border border-[#1e2026] hover:border-zinc-700 text-xs text-zinc-300 hover:text-white transition cursor-pointer"
          title={t('common.languageSelector')}
          aria-expanded={isOpen}
          aria-label={t('common.languageSelector')}
        >
          <span className="text-sm select-none">{currentLanguageMeta.flag}</span>
          <span className="font-semibold text-[11px] uppercase tracking-wider font-mono">
            {currentLanguageMeta.code.split('-')[0]}
          </span>
          <ChevronDown className={`w-3 h-3 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div
            className={`absolute z-50 mt-1.5 w-52 rounded-2xl bg-[#0c0d12]/98 backdrop-blur-xl border border-zinc-800 shadow-2xl p-1.5 space-y-0.5 ${
              isRTL ? 'left-0' : 'right-0'
            }`}
          >
            <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800/80 mb-1 flex items-center justify-between">
              <span>{t('common.language')}</span>
              <span className="text-[9px] text-emerald-400">10 idiomas</span>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-0.5 custom-scrollbar">
              {SUPPORTED_LANGUAGES.map((lang) => {
                const isSelected = lang.code === language;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => handleSelect(lang.code)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-800 text-white font-bold'
                        : 'text-zinc-400 hover:text-white hover:bg-[#16181f]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base select-none">{lang.flag}</span>
                      <span className="truncate">{lang.nativeName}</span>
                    </div>
                    {isSelected ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <span className="text-[10px] text-zinc-600 font-mono uppercase">
                        {lang.code.split('-')[0]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Modo Dropdown Padrão
  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[#111216] border border-[#1e2026] hover:border-zinc-700 text-xs text-zinc-300 hover:text-white transition cursor-pointer group"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate font-medium">{currentLanguageMeta.name}</span>
          <span className="text-xs select-none">{currentLanguageMeta.flag}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 group-hover:text-white transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className={`absolute z-50 bottom-full mb-1.5 left-0 right-0 rounded-2xl bg-[#0c0d12]/98 backdrop-blur-xl border border-zinc-800 shadow-2xl p-1.5 space-y-0.5`}
        >
          <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800/80 mb-1 flex items-center justify-between">
            <span>{t('common.languageSelector')}</span>
            <span className="text-[9px] text-zinc-400">{currentLanguageMeta.nativeName}</span>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-0.5 custom-scrollbar">
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isSelected = lang.code === language;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => handleSelect(lang.code)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition cursor-pointer ${
                    isSelected
                      ? 'bg-zinc-800 text-white font-bold'
                      : 'text-zinc-400 hover:text-white hover:bg-[#16181f]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base select-none">{lang.flag}</span>
                    <span className="truncate">{lang.nativeName}</span>
                    <span className="text-[10px] text-zinc-500 font-normal">({lang.name})</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
