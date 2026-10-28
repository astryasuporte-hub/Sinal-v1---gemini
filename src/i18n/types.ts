/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type LanguageCode =
  | 'pt-BR'
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'ja'
  | 'zh-CN'
  | 'ar'
  | 'hi';

export type TextDirection = 'ltr' | 'rtl';

export interface LanguageMeta {
  code: LanguageCode;
  name: string;
  nativeName: string;
  flag: string;
  direction: TextDirection;
  locale: string;
  region: string;
}

export const SUPPORTED_LANGUAGES: LanguageMeta[] = [
  {
    code: 'pt-BR',
    name: 'Português (Brasil)',
    nativeName: 'Português',
    flag: '🇧🇷',
    direction: 'ltr',
    locale: 'pt-BR',
    region: 'Brasil'
  },
  {
    code: 'en',
    name: 'Inglês',
    nativeName: 'English',
    flag: '🇺🇸',
    direction: 'ltr',
    locale: 'en-US',
    region: 'Global'
  },
  {
    code: 'es',
    name: 'Espanhol',
    nativeName: 'Español',
    flag: '🇪🇸',
    direction: 'ltr',
    locale: 'es-ES',
    region: 'Hispanoamérica'
  },
  {
    code: 'fr',
    name: 'Francês',
    nativeName: 'Français',
    flag: '🇫🇷',
    direction: 'ltr',
    locale: 'fr-FR',
    region: 'France'
  },
  {
    code: 'de',
    name: 'Alemão',
    nativeName: 'Deutsch',
    flag: '🇩🇪',
    direction: 'ltr',
    locale: 'de-DE',
    region: 'Deutschland'
  },
  {
    code: 'it',
    name: 'Italiano',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    direction: 'ltr',
    locale: 'it-IT',
    region: 'Italia'
  },
  {
    code: 'ja',
    name: 'Japonês',
    nativeName: '日本語',
    flag: '🇯🇵',
    direction: 'ltr',
    locale: 'ja-JP',
    region: '日本'
  },
  {
    code: 'zh-CN',
    name: 'Chinês Simplificado',
    nativeName: '简体中文',
    flag: '🇨🇳',
    direction: 'ltr',
    locale: 'zh-CN',
    region: '中国'
  },
  {
    code: 'ar',
    name: 'Árabe',
    nativeName: 'العربية',
    flag: '🇸🇦',
    direction: 'rtl',
    locale: 'ar-SA',
    region: 'العالم العربي'
  },
  {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    flag: '🇮🇳',
    direction: 'ltr',
    locale: 'hi-IN',
    region: 'भारत'
  }
];

export const DEFAULT_LANGUAGE: LanguageCode = 'pt-BR';
