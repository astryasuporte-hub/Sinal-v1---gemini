/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cache em memória com deduplicação de requisições em andamento (in-flight),
 * SWR leve para dados públicos e utilitário de fetch com timeout e retry com backoff.
 */

interface CacheEntry<T> {
  value: T;
  updatedAt: number;
  ttlMs: number;
}

const inFlightMap = new Map<string, Promise<any>>();
const swrCacheMap = new Map<string, CacheEntry<any>>();
const MAX_SWR_ENTRIES = 120;

export function dedupInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightMap.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      inFlightMap.delete(key);
    });

  inFlightMap.set(key, promise);
  return promise;
}

export async function swrFetch<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  options?: { forceRefresh?: boolean; onRevalidate?: (fresh: T) => void }
): Promise<T> {
  const now = Date.now();
  const cached = swrCacheMap.get(key);

  if (!options?.forceRefresh && cached) {
    const age = now - cached.updatedAt;
    if (age <= cached.ttlMs) {
      return cached.value as T;
    }

    // Stale-while-revalidate: retorna valor anterior imediato e revalida em segundo plano
    dedupInFlight(`swr:${key}`, async () => {
      const fresh = await fn();
      setSwrEntry(key, fresh, ttlMs);
      options?.onRevalidate?.(fresh);
      return fresh;
    }).catch(() => {});

    return cached.value as T;
  }

  return dedupInFlight(`swr:${key}`, async () => {
    const fresh = await fn();
    setSwrEntry(key, fresh, ttlMs);
    return fresh;
  });
}

function setSwrEntry<T>(key: string, value: T, ttlMs: number): void {
  if (swrCacheMap.size >= MAX_SWR_ENTRIES && !swrCacheMap.has(key)) {
    const oldestKey = swrCacheMap.keys().next().value;
    if (oldestKey) swrCacheMap.delete(oldestKey);
  }
  swrCacheMap.set(key, { value, updatedAt: Date.now(), ttlMs });
}

export function invalidateRequestCache(prefix?: string): void {
  if (!prefix) {
    swrCacheMap.clear();
    return;
  }
  for (const k of Array.from(swrCacheMap.keys())) {
    if (k.startsWith(prefix)) {
      swrCacheMap.delete(k);
    }
  }
}

export interface FetchRetryOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

const TRANSIENT_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export async function fetchWithTimeoutAndRetry(
  input: RequestInfo | URL,
  options: FetchRetryOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 9000,
    retries = 1,
    retryDelayMs = 250,
    signal: externalSignal,
    ...fetchInit
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    let timedOut = false;

    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(input, {
        ...fetchInit,
        signal: controller.signal,
      });

      if (attempt < retries && TRANSIENT_HTTP_STATUS.has(response.status)) {
        const jitter = Math.floor(Math.random() * 120);
        await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1) + jitter));
        continue;
      }

      return response;
    } catch (err) {
      lastError = err;
      if (externalSignal?.aborted) {
        throw err;
      }
      if (attempt >= retries) {
        if (timedOut) {
          throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        throw err;
      }
      const jitter = Math.floor(Math.random() * 120);
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1) + jitter));
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Fetch failed after retries');
}
