/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Proxy APIs Consolidated Domain Router V1.1
 * Consolidates all News & AI Proxy endpoints into a single Serverless Function to comply with Hobby plan limits.
 * Implements lazy dynamic imports per route to prevent module-level bootstrap crashes from affecting other services.
 */

import { sendJson, setCorsHeaders } from '../_lib/common';

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

    // Rota 1: Eventos, Feed e Ingestão (Core do Motor de Notícias)
    if (pathname.includes('/events') || pathname.includes('/feed') || pathname.includes('/ingest')) {
      const eventsModule = await import('../_lib/handlers/proxy/events');
      return await eventsModule.default(req, res);
    }

    // Rota 2: Diagnóstico e Status da Plataforma
    if (pathname.includes('/status')) {
      const statusModule = await import('../_lib/handlers/proxy/status');
      return await statusModule.default(req, res);
    }

    // Rota 3: GNews Proxy
    if (pathname.includes('/gnews')) {
      const gnewsModule = await import('../_lib/handlers/proxy/gnews');
      return await gnewsModule.default(req, res);
    }

    // Rota 4: NewsAPI Proxy
    if (pathname.includes('/newsapi')) {
      const newsapiModule = await import('../_lib/handlers/proxy/newsapi');
      return await newsapiModule.default(req, res);
    }

    // Rota 5: World News API Proxy
    if (pathname.includes('/worldnews')) {
      const worldnewsModule = await import('../_lib/handlers/proxy/worldnews');
      return await worldnewsModule.default(req, res);
    }

    // Rota 6: NVIDIA NIM Chat & Síntese
    if (pathname.includes('/nvidia') || pathname.includes('/chat')) {
      const nvidiaModule = await import('../_lib/handlers/proxy/nvidiaChat');
      return await nvidiaModule.default(req, res);
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
