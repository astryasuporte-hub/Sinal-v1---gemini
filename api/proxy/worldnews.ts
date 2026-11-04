/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: World News API Proxy
 */

import { getServerKeys, sendJson, setCorsHeaders, getClientIp, checkRateLimit, isAllowedDomain } from '../_lib/common';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`worldnews_${clientIp}`, 20, 60000)) {
    return sendJson(res, 429, { error: 'Rate limit excedido. Aguarde um momento antes de nova requisição.' });
  }

  const keys = getServerKeys();
  if (!keys.WORLD_NEWS) {
    return sendJson(res, 503, {
      error: 'WORLD_NEWS_API_KEY não configurada no ambiente de produção.',
      configured: false
    });
  }

  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const text = urlObj.searchParams.get('text') || 'brasil';
    const language = urlObj.searchParams.get('language') || 'pt';
    const number = Math.min(10, Math.max(1, parseInt(urlObj.searchParams.get('number') || '5', 10)));

    const targetUrl = `https://api.worldnewsapi.com/search-news?text=${encodeURIComponent(text)}&language=${language}&number=${number}&api-key=${keys.WORLD_NEWS}`;

    if (!isAllowedDomain(targetUrl)) {
      return sendJson(res, 400, { error: 'Domínio de destino inválido.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const apiRes = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeout);

    const quotaLeft = apiRes.headers.get('x-api-quota-left');
    const data = await apiRes.json().catch(() => ({}));

    if (quotaLeft) {
      res.setHeader('X-Api-Quota-Left', quotaLeft);
    }

    return sendJson(res, apiRes.status, data);
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    return sendJson(res, isTimeout ? 504 : 500, {
      error: isTimeout ? 'Tempo limite esgotado ao consultar World News API.' : 'Falha interna ao processar requisição World News API.'
    });
  }
}
