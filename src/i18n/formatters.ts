/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LanguageCode, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from './types';

export function getLocaleForLanguage(lang: LanguageCode): string {
  const meta = SUPPORTED_LANGUAGES.find((l) => l.code === lang);
  return meta?.locale || 'pt-BR';
}

/**
 * Formatação de data completa localizada
 */
export function formatLocalizedDate(
  dateInput: Date | string | number,
  lang: LanguageCode = DEFAULT_LANGUAGE,
  options?: Intl.DateTimeFormatOptions
): string {
  try {
    const date = typeof dateInput === 'string' || typeof dateInput === 'number'
      ? new Date(dateInput)
      : dateInput;

    if (isNaN(date.getTime())) return '';

    const locale = getLocaleForLanguage(lang);
    const defaultOptions: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...options
    };

    return new Intl.DateTimeFormat(locale, defaultOptions).format(date);
  } catch {
    return String(dateInput);
  }
}

/**
 * Formatação de horário localizado
 */
export function formatLocalizedTime(
  dateInput: Date | string | number,
  lang: LanguageCode = DEFAULT_LANGUAGE,
  options?: Intl.DateTimeFormatOptions
): string {
  try {
    const date = typeof dateInput === 'string' || typeof dateInput === 'number'
      ? new Date(dateInput)
      : dateInput;

    if (isNaN(date.getTime())) return '';

    const locale = getLocaleForLanguage(lang);
    const defaultOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      ...options
    };

    return new Intl.DateTimeFormat(locale, defaultOptions).format(date);
  } catch {
    return '';
  }
}

/**
 * Formatação de tempo relativo (ex: "há 2 horas", "2 hours ago", "منذ ساعتين")
 */
export function formatLocalizedRelativeTime(
  dateInput: Date | string | number,
  lang: LanguageCode = DEFAULT_LANGUAGE
): string {
  try {
    const date = typeof dateInput === 'string' || typeof dateInput === 'number'
      ? new Date(dateInput)
      : dateInput;

    if (isNaN(date.getTime())) return '';

    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    const locale = getLocaleForLanguage(lang);

    // Usa Intl.RelativeTimeFormat se suportado
    if (typeof Intl !== 'undefined' && Intl.RelativeTimeFormat) {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      if (diffSec < 60) return rtf.format(-Math.max(1, diffSec), 'second');
      if (diffMin < 60) return rtf.format(-diffMin, 'minute');
      if (diffHour < 24) return rtf.format(-diffHour, 'hour');
      if (diffDay < 30) return rtf.format(-diffDay, 'day');
    }

    return formatLocalizedDate(date, lang);
  } catch {
    return '';
  }
}

/**
 * Formatação de número localizado (separadores de milhar e decimais)
 */
export function formatLocalizedNumber(
  value: number,
  lang: LanguageCode = DEFAULT_LANGUAGE,
  options?: Intl.NumberFormatOptions
): string {
  try {
    const locale = getLocaleForLanguage(lang);
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Formatação de moeda localizada
 */
export function formatLocalizedCurrency(
  value: number,
  currency = 'BRL',
  lang: LanguageCode = DEFAULT_LANGUAGE
): string {
  try {
    const locale = getLocaleForLanguage(lang);
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
