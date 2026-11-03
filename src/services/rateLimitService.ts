/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const STORAGE_KEY_DATE = 'sinal_user_refresh_date';
const STORAGE_KEY_COUNT = 'sinal_user_refresh_count';
const STORAGE_KEY_FEED_CACHE = 'sinal_cached_feed_v1';
const STORAGE_KEY_FEED_TIMESTAMP = 'sinal_cached_feed_time';
export const MAX_DAILY_USER_REFRESHES = 5;

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Armazenamento em memória (Tier 1: Ultra-rápido, 0ms latency)
let memoryFeedCache: any[] | null = null;
let memoryFeedTimestamp: number = 0;

export const rateLimitService = {
  /**
   * Retorna quantas atualizações manuais o usuário já realizou hoje
   */
  getUserRefreshCount(): number {
    if (typeof window === 'undefined') return 0;
    try {
      const today = getTodayString();
      const savedDate = localStorage.getItem(STORAGE_KEY_DATE);
      if (savedDate !== today) {
        // Novo dia: reseta contagem
        localStorage.setItem(STORAGE_KEY_DATE, today);
        localStorage.setItem(STORAGE_KEY_COUNT, '0');
        return 0;
      }
      const raw = localStorage.getItem(STORAGE_KEY_COUNT);
      return raw ? parseInt(raw, 10) || 0 : 0;
    } catch {
      return 0;
    }
  },

  /**
   * Retorna quantas atualizações manuais ainda restam para hoje (0 a 5)
   */
  getRemainingRefreshes(): number {
    const count = this.getUserRefreshCount();
    return Math.max(0, MAX_DAILY_USER_REFRESHES - count);
  },

  /**
   * Verifica se o usuário pode realizar uma atualização manual
   */
  canUserRefresh(): boolean {
    return this.getRemainingRefreshes() > 0;
  },

  /**
   * Registra uma atualização manual. Retorna true se permitida, false se atingiu limite.
   */
  recordUserRefresh(): { allowed: boolean; remaining: number; count: number } {
    if (typeof window === 'undefined') {
      return { allowed: true, remaining: 5, count: 0 };
    }
    const current = this.getUserRefreshCount();
    if (current >= MAX_DAILY_USER_REFRESHES) {
      return { allowed: false, remaining: 0, count: current };
    }

    const nextCount = current + 1;
    const today = getTodayString();
    localStorage.setItem(STORAGE_KEY_DATE, today);
    localStorage.setItem(STORAGE_KEY_COUNT, String(nextCount));

    return {
      allowed: true,
      remaining: Math.max(0, MAX_DAILY_USER_REFRESHES - nextCount),
      count: nextCount
    };
  },

  /**
   * Salva feed em cache em duas camadas (Tier 1: Memória + Tier 2: localStorage)
   */
  saveCachedFeed(events: any[]): void {
    if (!Array.isArray(events) || events.length === 0) return;
    const now = Date.now();
    // 1. Tier 1: Cache em Memória
    memoryFeedCache = [...events];
    memoryFeedTimestamp = now;

    // 2. Tier 2: Persistência no localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_FEED_CACHE, JSON.stringify(events));
        localStorage.setItem(STORAGE_KEY_FEED_TIMESTAMP, String(now));
      } catch (e) {
        console.warn('Não foi possível salvar cache de notícias no localStorage:', e);
      }
    }
  },

  /**
   * Obtém feed do cache de duas camadas (Tier 1 Memória prioritário, Tier 2 localStorage fallback)
   */
  getCachedFeed(maxAgeMs = 15 * 60 * 1000): any[] | null {
    const now = Date.now();

    // 1. Verifica Tier 1 (Memória RAM instantânea)
    if (memoryFeedCache && memoryFeedCache.length >= 20 && now - memoryFeedTimestamp < maxAgeMs) {
      return memoryFeedCache;
    }

    // 2. Verifica Tier 2 (localStorage)
    if (typeof window === 'undefined') return null;
    try {
      const rawTime = localStorage.getItem(STORAGE_KEY_FEED_TIMESTAMP);
      if (!rawTime) return null;
      const age = now - parseInt(rawTime, 10);
      if (age > maxAgeMs) return null; // expirado

      const rawFeed = localStorage.getItem(STORAGE_KEY_FEED_CACHE);
      if (!rawFeed) return null;
      const parsed = JSON.parse(rawFeed);
      if (Array.isArray(parsed) && parsed.length >= 20) {
        // Aquece Tier 1 de Memória para chamadas subsequentes
        memoryFeedCache = parsed;
        memoryFeedTimestamp = parseInt(rawTime, 10);
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  },

  /**
   * Retorna qualquer feed disponível imediatamente no Tier 1 ou Tier 2 (mesmo stale)
   * para exibição instantânea no mount sem tela em branco ou loading
   */
  getInstantFeedSync(): any[] | null {
    if (memoryFeedCache && memoryFeedCache.length > 0) {
      return memoryFeedCache;
    }
    if (typeof window === 'undefined') return null;
    try {
      const rawFeed = localStorage.getItem(STORAGE_KEY_FEED_CACHE);
      if (!rawFeed) return null;
      const parsed = JSON.parse(rawFeed);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryFeedCache = parsed;
        return parsed;
      }
    } catch {}
    return null;
  },

  /**
   * Limpa cache de notícias em ambas as camadas (Memória + localStorage)
   */
  clearCache(): void {
    memoryFeedCache = null;
    memoryFeedTimestamp = 0;
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(STORAGE_KEY_FEED_CACHE);
      localStorage.removeItem(STORAGE_KEY_FEED_TIMESTAMP);
    } catch (e) {
      console.warn('Erro ao limpar cache local de feed:', e);
    }
  }
};
