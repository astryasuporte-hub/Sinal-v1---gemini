/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Shared Rate Limiter with Anti-Spoofing and Retry-After headers
 */

import { getClientIp, sendJson } from './common';

interface RateRecord {
  count: number;
  resetTime: number;
}

const rateBuckets = new Map<string, RateRecord>();

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export function enforceRateLimit(
  req: any,
  res: any,
  options: RateLimitOptions = { windowMs: 60000, maxRequests: 30, keyPrefix: 'rl' }
): boolean {
  const ip = getClientIp(req);
  const key = `${options.keyPrefix || 'rl'}:${ip}`;
  const now = Date.now();

  let record = rateBuckets.get(key);
  if (!record || now >= record.resetTime) {
    record = { count: 1, resetTime: now + options.windowMs };
    rateBuckets.set(key, record);
    return true;
  }

  if (record.count >= options.maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
    sendJson(
      res,
      429,
      {
        error: 'Limite de requisições excedido. Tente novamente mais tarde.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: retryAfterSec
      },
      {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(options.maxRequests),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(record.resetTime / 1000))
      }
    );
    return false;
  }

  record.count += 1;
  return true;
}
