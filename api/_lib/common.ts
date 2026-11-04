/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR Backend - Common Serverless Utilities & Security Layer
 */

import dotenv from 'dotenv';
dotenv.config();

// Allowed Upstream Domains for SSRF Protection
export const ALLOWED_UPSTREAM_DOMAINS = [
  'gnews.io',
  'newsapi.org',
  'api.worldnewsapi.com',
  'integrate.api.nvidia.com',
  'api.resend.com',
  'api.zynpay.com.br'
];

export function isAllowedDomain(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return ALLOWED_UPSTREAM_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

// In-memory rate limiting per IP / client identifier
interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}
const rateLimitMap = new Map<string, RateLimitBucket>();

export function checkRateLimit(clientId: string, maxTokens = 60, refillIntervalMs = 60000): boolean {
  const now = Date.now();
  let bucket = rateLimitMap.get(clientId);

  if (!bucket) {
    bucket = { tokens: maxTokens - 1, lastRefill: now };
    rateLimitMap.set(clientId, bucket);
    return true;
  }

  // Refill tokens
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= refillIntervalMs) {
    bucket.tokens = maxTokens - 1;
    bucket.lastRefill = now;
    return true;
  }

  if (bucket.tokens > 0) {
    bucket.tokens -= 1;
    return true;
  }

  return false;
}

export function maskSecret(secret?: string | null): string {
  if (!secret || secret.trim().length === 0) return 'Não configurado';
  const clean = secret.trim();
  if (clean.length <= 8) return '••••••••';
  return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
}

export function getClientIp(req: any): string {
  return (
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers?.['x-real-ip'] ||
    req.socket?.remoteAddress ||
    '127.0.0.1'
  );
}

export function setCorsHeaders(res: any): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

export function sendJson(res: any, statusCode: number, data: any): void {
  setCorsHeaders(res);
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

export async function readJsonBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  const buffers: Buffer[] = [];
  for await (const chunk of req) {
    buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const str = Buffer.concat(buffers).toString('utf-8');
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

// Server Secret Keys strictly resolved from process.env
export function getServerKeys() {
  return {
    GNEWS: process.env.GNEWS_API_KEY || '',
    NEWSAPI: process.env.NEWSAPI_API_KEY || '',
    WORLD_NEWS: process.env.WORLD_NEWS_API_KEY || '',
    NVIDIA_NIM: process.env.NVIDIA_NIM_API_KEY || '',
    RESEND: process.env.RESEND_API_KEY || '',
    ZYNPAY: process.env.ZYNPAY_API_KEY || '',
    ZYNPAY_WEBHOOK_SECRET: process.env.ZYNPAY_WEBHOOK_SECRET || 'whsec_zynpay_live_prod'
  };
}
