/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: System Health & Provider Diagnostics Endpoint V1.1
 * 
 * Diretrizes de Segurança e Transparência:
 * 1. Zero exposição de credenciais ou chaves parciais/mascaradas no endpoint público.
 * 2. Métricas canônicas reais extraídas do PostgreSQL (events, articles, news_sources).
 * 3. Probes reais com verificação de conectividade e sem falsos "operational: true".
 * 4. Informações administrativas e telemetria profunda restritas a administradores autenticados.
 */

import { getServerKeys, sendJson, setCorsHeaders, isAllowedDomain } from '../../common.js';
import { safeCompare } from '../../crypto.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const keys = getServerKeys();
  const authHeader = String(req.headers['authorization'] || '').trim();
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  // Checagem de privilégio administrativo para exibição de diagnósticos aprofundados
  let isAdmin = false;
  if (bearerToken && process.env.ADMIN_SECRET && safeCompare(bearerToken, process.env.ADMIN_SECRET)) {
    isAdmin = true;
  } else if (bearerToken) {
    try {
      const { verifyAdminRequest } = await import('../../adminAuth.js');
      isAdmin = await verifyAdminRequest(req);
    } catch {}
  }

  // 1. Diagnóstico de Banco de Dados Canônico
  let databaseConnected = false;
  let databaseEventsCount: number | null = null;
  let databaseArticlesCount: number | null = null;
  let databaseSourcesCount: number | null = null;

  try {
    const { isPostgresConfigured, executeSql } = await import('../../postgres.js');
    if (isPostgresConfigured()) {
      const [eventsRes, articlesRes, sourcesRes] = await Promise.allSettled([
        executeSql('SELECT count(*)::int as total FROM public.events'),
        executeSql('SELECT count(*)::int as total FROM public.articles'),
        executeSql('SELECT count(*)::int as total FROM public.news_sources')
      ]);

      if (eventsRes.status === 'fulfilled') {
        databaseEventsCount = eventsRes.value.rows[0]?.total ?? 0;
        databaseConnected = true;
      }
      if (articlesRes.status === 'fulfilled') {
        databaseArticlesCount = articlesRes.value.rows[0]?.total ?? 0;
      }
      if (sourcesRes.status === 'fulfilled') {
        databaseSourcesCount = sourcesRes.value.rows[0]?.total ?? 0;
      }
    }
  } catch (err: any) {
    console.warn('[Status Diagnostic] Erro ao consultar métricas PostgreSQL:', err?.message);
  }

  // 2. Metadados de Provedores Sanitizados (Zero Chaves no Payload Público)
  const providersPublic = {
    gnews: {
      name: 'GNews API',
      configured: Boolean(keys.GNEWS)
    },
    newsapi: {
      name: 'NewsAPI',
      configured: Boolean(keys.NEWSAPI)
    },
    worldnews: {
      name: 'World News API',
      configured: Boolean(keys.WORLD_NEWS)
    },
    nvidia: {
      name: 'NVIDIA NIM',
      configured: Boolean(keys.NVIDIA_NIM)
    },
    resend: {
      name: 'Resend E-mails',
      configured: Boolean(keys.RESEND)
    },
    zynpay: {
      name: 'ZynPay Pix Gateway',
      configured: Boolean(keys.ZYNPAY)
    }
  };

  // 3. Probes Reais de Conectividade (Apenas se requisitado e autenticado)
  const urlObj = new URL(req.url, 'http://localhost');
  const probeRequested = urlObj.searchParams.get('probe') === 'true';
  let providerProbes: Record<string, { operational: boolean; latencyMs?: number; error?: string }> | undefined = undefined;

  if (probeRequested && isAdmin) {
    providerProbes = {};

    // Probe real rápido GNews
    if (keys.GNEWS) {
      const start = Date.now();
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 2000);
        const r = await fetch(`https://gnews.io/api/v4/top-headlines?max=1&lang=pt&country=br&apikey=${keys.GNEWS}`, { signal: ctrl.signal });
        clearTimeout(to);
        providerProbes.gnews = { operational: r.ok, latencyMs: Date.now() - start };
      } catch (err: any) {
        providerProbes.gnews = { operational: false, latencyMs: Date.now() - start, error: err?.message };
      }
    } else {
      providerProbes.gnews = { operational: false, error: 'Chave não configurada' };
    }

    // Probe real rápido NewsAPI
    if (keys.NEWSAPI) {
      const start = Date.now();
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 2000);
        const r = await fetch(`https://newsapi.org/v2/top-headlines?country=br&pageSize=1&apiKey=${keys.NEWSAPI}`, {
          signal: ctrl.signal,
          headers: { 'User-Agent': 'FatosBR-Engine/1.3' }
        });
        clearTimeout(to);
        providerProbes.newsapi = { operational: r.ok, latencyMs: Date.now() - start };
      } catch (err: any) {
        providerProbes.newsapi = { operational: false, latencyMs: Date.now() - start, error: err?.message };
      }
    } else {
      providerProbes.newsapi = { operational: false, error: 'Chave não configurada' };
    }

    // Probe real rápido World News
    if (keys.WORLD_NEWS) {
      const start = Date.now();
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 2000);
        const r = await fetch(`https://api.worldnewsapi.com/search-news?number=1&api-key=${keys.WORLD_NEWS}`, { signal: ctrl.signal });
        clearTimeout(to);
        providerProbes.worldnews = { operational: r.ok, latencyMs: Date.now() - start };
      } catch (err: any) {
        providerProbes.worldnews = { operational: false, latencyMs: Date.now() - start, error: err?.message };
      }
    } else {
      providerProbes.worldnews = { operational: false, error: 'Chave não configurada' };
    }
  }

  return sendJson(res, 200, {
    status: 'ONLINE',
    environment: process.env.NODE_ENV || 'production',
    serverTime: new Date().toISOString(),
    newsEngine: {
      databaseConnected,
      databaseEventsCount,
      databaseArticlesCount,
      databaseSourcesCount,
      pipeline: 'FatosBR News Engine V1.3 (Canonical Schema + Strict TLS)',
      supportedProviders: ['gnews', 'newsapi', 'worldnews', 'nvidia']
    },
    providers: providersPublic,
    providerProbes,
    // Specs para compatibilidade de testes existentes
    specs: providersPublic
  });
}
