/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Provider Diagnostics & Status Endpoint
 */

import { getServerKeys, sendJson, setCorsHeaders, maskSecret } from '../../common';

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

  let databaseEventsCount: number | null = null;
  let databaseConnected = false;

  try {
    const { isPostgresConfigured, executeSql } = await import('../../postgres');
    if (isPostgresConfigured()) {
      const countRes = await executeSql('SELECT count(*)::int as total FROM public.events');
      databaseEventsCount = countRes.rows[0]?.total ?? 0;
      databaseConnected = true;
    }
  } catch {}

  return sendJson(res, 200, {
    status: 'ONLINE',
    environment: process.env.NODE_ENV || 'production',
    serverTime: new Date().toISOString(),
    newsEngine: {
      databaseConnected,
      databaseEventsCount,
      pipeline: 'FatosBR News Engine V1',
      supportedProviders: ['gnews', 'newsapi', 'worldnews', 'nvidia']
    },
    specs
  });
}
