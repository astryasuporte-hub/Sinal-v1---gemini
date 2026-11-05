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



export function maskSecret(secret?: string | null): string {
  if (!secret || secret.trim().length === 0) return 'Não configurado';
  const clean = secret.trim();
  if (clean.length <= 8) return '••••••••';
  return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
}

export function getClientIp(req: any): string {
  // Use trusted header from proxy/Vercel or socket address, preventing client spoofing
  const cfIp = req.headers?.['cf-connecting-ip'];
  const realIp = req.headers?.['x-real-ip'];
  const forwarded = req.headers?.['x-forwarded-for'];
  
  if (cfIp && typeof cfIp === 'string') return cfIp.trim();
  if (realIp && typeof realIp === 'string') return realIp.trim();
  if (forwarded && typeof forwarded === 'string') {
    // Leftmost is original client, following are proxies
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

export function setCorsHeaders(res: any): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, x-zynpay-signature, x-signature');
}

export function sendJson(res: any, statusCode: number, data: any, headers?: Record<string, string>): void {
  setCorsHeaders(res);
  res.setHeader('Content-Type', 'application/json');
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      res.setHeader(k, v);
    }
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

export async function readRawAndJsonBody(req: any): Promise<{ rawBody: string; body: any }> {
  if (req.rawBody && typeof req.rawBody === 'string') {
    let body = {};
    try {
      body = JSON.parse(req.rawBody);
    } catch {}
    return { rawBody: req.rawBody, body };
  }

  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    const raw = JSON.stringify(req.body);
    return { rawBody: raw, body: req.body };
  }

  const buffers: Buffer[] = [];
  for await (const chunk of req) {
    buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(buffers).toString('utf-8');
  let body = {};
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = {};
    }
  }
  return { rawBody, body };
}

export async function readJsonBody(req: any): Promise<any> {
  const { body } = await readRawAndJsonBody(req);
  return body;
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
    ZYNPAY_WEBHOOK_SECRET: process.env.ZYNPAY_WEBHOOK_SECRET || 'whsec_zynpay_live_prod',
    ADMIN_SECRET: process.env.ADMIN_SECRET || ''
  };
}
