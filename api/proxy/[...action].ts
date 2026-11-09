/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Proxy APIs Consolidated Domain Router V1.1
 * Consolidates all News & AI Proxy endpoints into a single Serverless Function to comply with Hobby plan limits.
 * Implements lazy dynamic imports per route to prevent module-level bootstrap crashes from affecting other services.
 */

import { sendJson, setCorsHeaders } from '../_lib/common.js';
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

    // Rota 1: Eventos, Feed e Ingestão (Core do Motor de Notícias)
    if (pathname.includes('/events') || pathname.includes('/feed') || pathname.includes('/ingest')) {
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
