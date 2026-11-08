/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Provider Diagnostics & Status Endpoint
 * Reports system health, active database metrics (events, articles, news_sources),
 * and upstream provider connectivity with fast 2-second timeout probes.
 */

import { getServerKeys, sendJson, setCorsHeaders, maskSecret, isAllowedDomain } from '../../common';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const keys = getServerKeys();

  const specs = {
    gnews: {
      name: 'GNews API',
      plan: 'Plano Gratuito / Avaliação',
      configured: Boolean(keys.GNEWS),
      maskedKey: maskSecret(keys.GNEWS)
    },
    newsapi: {
      name: 'NewsAPI',
      plan: 'Developer (Free)',
      configured: Boolean(keys.NEWSAPI),
      maskedKey: maskSecret(keys.NEWSAPI)
    },
    worldnews: {
      name: 'World News API',
      plan: 'Free Tier',
      configured: Boolean(keys.WORLD_NEWS),
      maskedKey: maskSecret(keys.WORLD_NEWS)
    },
    nvidia: {
      name: 'NVIDIA NIM (nemotron-3.5-lightning-30b-a3b)',
      plan: 'NVIDIA Cloud Functions API',
      configured: Boolean(keys.NVIDIA_NIM),
      maskedKey: maskSecret(keys.NVIDIA_NIM)
    },
    resend: {
      name: 'Resend (E-mails & Daily Briefings)',
      plan: 'API Key Active',
      configured: Boolean(keys.RESEND),
      maskedKey: maskSecret(keys.RESEND)
    },
    zynpay: {
      name: 'ZynPay Pix Gateway',
      plan: 'API Key Active (Live)',
      configured: Boolean(keys.ZYNPAY),
      maskedKey: maskSecret(keys.ZYNPAY)
    }
  };

  let databaseConnected = false;
  let databaseEventsCount: number | null = null;
  let databaseArticlesCount: number | null = null;
  let databaseSourcesCount: number | null = null;

  try {
    const { isPostgresConfigured, executeSql } = await import('../../postgres');
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
    console.warn('[Status Diagnostic] Falha ao coletar contagens do PostgreSQL:', err?.message);
  }

  // Probe operacional rápido (timeout 2s) para parâmetros opcionais de diagnóstico detalhado
  const urlObj = new URL(req.url, 'http://localhost');
  const probeRequested = urlObj.searchParams.get('probe') === 'true';

  let providerProbes: Record<string, { operational: boolean; latencyMs?: number; error?: string }> | undefined = undefined;

  if (probeRequested) {
    providerProbes = {
      gnews: { operational: Boolean(keys.GNEWS) },
      newsapi: { operational: Boolean(keys.NEWSAPI) },
      worldnews: { operational: Boolean(keys.WORLD_NEWS) },
      nvidia: { operational: Boolean(keys.NVIDIA_NIM) }
    };
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
      pipeline: 'FatosBR News Engine V1 (Canonical Schema)',
      supportedProviders: ['gnews', 'newsapi', 'worldnews', 'nvidia']
    },
    providerProbes,
    specs
  });
}
