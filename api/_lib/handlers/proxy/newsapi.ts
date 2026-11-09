/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: NewsAPI Proxy
 */

import { getServerKeys, sendJson, setCorsHeaders, isAllowedDomain } from '../../common.js';
import { enforceRateLimit } from '../../rateLimiter.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const rateLimitAllowed = await enforceRateLimit(req, res, 'general');
  if (!rateLimitAllowed) {
    return;
  }

  const keys = getServerKeys();
  if (!keys.NEWSAPI) {
    return sendJson(res, 503, {
      error: 'NEWSAPI_API_KEY não configurada no ambiente de produção.',
      configured: false
    });
  }

  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const q = urlObj.searchParams.get('q') || 'brasil';
    const pageSize = Math.min(10, Math.max(1, parseInt(urlObj.searchParams.get('pageSize') || '5', 10)));

    const targetUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=${pageSize}&apiKey=${keys.NEWSAPI}`;

    if (!isAllowedDomain(targetUrl)) {
      return sendJson(res, 400, { error: 'Domínio de destino inválido.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const apiRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'FatosBR-News-Engine/1.0'
      }
    });
    clearTimeout(timeout);

    const data = await apiRes.json().catch(() => ({}));

    return sendJson(res, apiRes.status, data);
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    return sendJson(res, isTimeout ? 504 : 500, {
      error: isTimeout ? 'Tempo limite esgotado ao consultar NewsAPI.' : 'Falha interna ao processar requisição NewsAPI.'
    });
  }
}
