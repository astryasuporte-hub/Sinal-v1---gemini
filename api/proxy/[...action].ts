/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Proxy APIs Consolidated Domain Router V1.1
 * Consolidates all News & AI Proxy endpoints into a single Serverless Function to comply with Hobby plan limits.
 * Implements lazy dynamic imports per route to prevent module-level bootstrap crashes from affecting other services.
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../_lib/common.js';
import eventsHandler from '../_lib/handlers/proxy/events.js';
import statusHandler from '../_lib/handlers/proxy/status.js';
import gnewsHandler from '../_lib/handlers/proxy/gnews.js';
import newsapiHandler from '../_lib/handlers/proxy/newsapi.js';
import worldnewsHandler from '../_lib/handlers/proxy/worldnews.js';
import nvidiaHandler from '../_lib/handlers/proxy/nvidiaChat.js';

export default async function handler(req: any, res: any) {
  try {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const pathname = urlObj.pathname;

    // Rota 1: Eventos, Feed, Catálogo e Ingestão (Core do Motor de Notícias)
    if (
      pathname.includes('/events') ||
      pathname.includes('/feed') ||
      pathname.includes('/ingest') ||
      pathname.includes('/catalog')
    ) {
      return await eventsHandler(req, res);
    }

    // Rota 2: Diagnóstico e Status da Plataforma
    if (pathname.includes('/status')) {
      return await statusHandler(req, res);
    }

    // Rota 3: GNews Proxy
    if (pathname.includes('/gnews')) {
      return await gnewsHandler(req, res);
    }

    // Rota 4: NewsAPI Proxy
    if (pathname.includes('/newsapi')) {
      return await newsapiHandler(req, res);
    }

    // Rota 5: World News API Proxy
    if (pathname.includes('/worldnews')) {
      return await worldnewsHandler(req, res);
    }

    // Rota 6: NVIDIA NIM Chat & Síntese
    if (pathname.includes('/nvidia') || pathname.includes('/chat')) {
      return await nvidiaHandler(req, res);
    }

    // Rota 7: Telemetria anônima RUM (Web Vitals) sem PII e sem nova função serverless
    if (pathname.includes('/perf')) {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      }
      const raw = await readJsonBody(req).catch(() => ({}));
      const clampMetric = (v: unknown, max: number) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null;
      };
      const allowedDeviceTiers = new Set(['low', 'mid', 'high', 'unknown']);
      const allowedNetTypes = new Set(['slow-2g', '2g', '3g', '4g', 'unknown']);
      const deviceTier = allowedDeviceTiers.has(String(raw?.deviceTier)) ? String(raw.deviceTier) : 'unknown';
      const effectiveType = allowedNetTypes.has(String(raw?.effectiveType)) ? String(raw.effectiveType) : 'unknown';

      const sanitizedMetrics = {
        lcpMs: clampMetric(raw?.lcpMs, 120000),
        inpMs: clampMetric(raw?.inpMs, 60000),
        cls: clampMetric(raw?.cls, 100),
        ttfbMs: clampMetric(raw?.ttfbMs, 120000),
        feedLoadMs: clampMetric(raw?.feedLoadMs, 120000),
        jsErrors: clampMetric(raw?.jsErrors, 1000) ?? 0,
        apiCount: clampMetric(raw?.apiCount, 1000) ?? 0,
        deviceTier,
        effectiveType,
        path: typeof raw?.path === 'string' ? raw.path.split('?')[0].split('#')[0].slice(0, 64) : '/',
      };
      if (
        (sanitizedMetrics.lcpMs !== null && sanitizedMetrics.lcpMs > 2500) ||
        (sanitizedMetrics.inpMs !== null && sanitizedMetrics.inpMs > 200) ||
        (sanitizedMetrics.cls !== null && sanitizedMetrics.cls > 0.1)
      ) {
        console.info('[FatosBR RUM Threshold]', JSON.stringify(sanitizedMetrics));
      }
      return sendJson(res, 202, { accepted: true });
    }

    return sendJson(res, 404, {
      error: 'ENDPOINT_NOT_FOUND',
      message: 'Endpoint de proxy não encontrado.'
    });
  } catch (criticalErr: any) {
    console.error('[Proxy Router Global Exception]', criticalErr?.message || criticalErr);
    return sendJson(res, 500, {
      error: 'PROXY_SERVICE_UNAVAILABLE',
      message: 'Serviço de proxy temporariamente indisponível. Tente novamente em instantes.'
    });
  }
}
