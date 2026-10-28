/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { LanguageCode, LanguageMeta, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, TextDirection } from './types';
import { translations } from './translations';
import {
  formatLocalizedDate,
  formatLocalizedTime,
  formatLocalizedRelativeTime,
  formatLocalizedNumber,
  formatLocalizedCurrency
} from './formatters';

interface I18nContextValue {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  direction: TextDirection;
  isRTL: boolean;
  currentLanguageMeta: LanguageMeta;
  availableLanguages: LanguageMeta[];
  t: (key: string, params?: Record<string, string | number>) => string;
  formatDate: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatRelativeTime: (date: Date | string | number) => string;
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (value: number, currency?: string) => string;
}

const STORAGE_KEY = 'fatosbr_language_preference';

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY) as LanguageCode;
        if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
          return saved;
        }
      } catch {}
    }
    return DEFAULT_LANGUAGE;
  });

  const currentLanguageMeta = useMemo(() => {
    return SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0];
  }, [language]);

  const direction: TextDirection = currentLanguageMeta.direction;
  const isRTL = direction === 'rtl';

  // Sincroniza atributos do HTML (dir e lang) para suporte completo a layouts RTL (árabe)
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = direction;
      document.documentElement.lang = language;

      if (isRTL) {
        document.documentElement.classList.add('rtl-layout');
      } else {
        document.documentElement.classList.remove('rtl-layout');
      }
    }
  }, [direction, language, isRTL]);

  const setLanguage = useCallback((newLang: LanguageCode) => {
    if (!SUPPORTED_LANGUAGES.some((l) => l.code === newLang)) return;
    setLanguageState(newLang);
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
      // Dispara evento customizado para componentes que escutam fora do React tree
      window.dispatchEvent(new CustomEvent('fatosbr_language_changed', { detail: { language: newLang } }));
    } catch {}
  }, []);

  // Função central de tradução com fallback estrito para Português (pt-BR)
  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const activeDict = translations[language] || {};
      const fallbackDict = translations[DEFAULT_LANGUAGE] || {};

      let text = activeDict[key] || fallbackDict[key] || key;

      if (params) {
        Object.entries(params).forEach(([pKey, pVal]) => {
          text = text.replace(new RegExp(`{${pKey}}`, 'g'), String(pVal));
        });
      }

      return text;
    },
    [language]
  );

  const formatDate = useCallback(
    (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => {
      return formatLocalizedDate(date, language, options);
    },
    [language]
  );

  const formatTime = useCallback(
    (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => {
      return formatLocalizedTime(date, language, options);
    },
    [language]
  );

  const formatRelativeTime = useCallback(
    (date: Date | string | number) => {
      return formatLocalizedRelativeTime(date, language);
    },
    [language]
  );

  const formatNumber = useCallback(
    (num: number, options?: Intl.NumberFormatOptions) => {
      return formatLocalizedNumber(num, language, options);
    },
    [language]
  );

  const formatCurrency = useCallback(
    (value: number, currency = 'BRL') => {
      return formatLocalizedCurrency(value, currency, language);
    },
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      direction,
      isRTL,
      currentLanguageMeta,
      availableLanguages: SUPPORTED_LANGUAGES,
      t,
      formatDate,
      formatTime,
      formatRelativeTime,
      formatNumber,
      formatCurrency
    }),
    [
      language,
      setLanguage,
      direction,
      isRTL,
      currentLanguageMeta,
      t,
      formatDate,
      formatTime,
      formatRelativeTime,
      formatNumber,
      formatCurrency
    ]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback gracioso caso chamado fora do provider
    return {
      language: DEFAULT_LANGUAGE,
      setLanguage: () => {},
      direction: 'ltr',
      isRTL: false,
      currentLanguageMeta: SUPPORTED_LANGUAGES[0],
      availableLanguages: SUPPORTED_LANGUAGES,
      t: (key: string) => translations[DEFAULT_LANGUAGE]?.[key] || key,
      formatDate: (d) => formatLocalizedDate(d, DEFAULT_LANGUAGE),
      formatTime: (d) => formatLocalizedTime(d, DEFAULT_LANGUAGE),
      formatRelativeTime: (d) => formatLocalizedRelativeTime(d, DEFAULT_LANGUAGE),
      formatNumber: (n) => formatLocalizedNumber(n, DEFAULT_LANGUAGE),
      formatCurrency: (v) => formatLocalizedCurrency(v, 'BRL', DEFAULT_LANGUAGE)
    };
  }
  return ctx;
}

export const useTranslation = useI18n;
