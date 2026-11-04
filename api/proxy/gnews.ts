/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: GNews API Proxy
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
  if (!checkRateLimit(`gnews_${clientIp}`, 30, 60000)) {
    return sendJson(res, 429, { error: 'Rate limit excedido. Aguarde um momento antes de nova requisição.' });
  }

  const keys = getServerKeys();
  if (!keys.GNEWS) {
    return sendJson(res, 503, {
      error: 'GNEWS_API_KEY não configurada no ambiente de produção.',
      configured: false
    });
  }

  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const q = urlObj.searchParams.get('q') || 'brasil';
    const lang = urlObj.searchParams.get('lang') || 'pt';
    const country = urlObj.searchParams.get('country') || 'br';
    const max = Math.min(10, Math.max(1, parseInt(urlObj.searchParams.get('max') || '5', 10)));

    const targetUrl = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${lang}&country=${country}&max=${max}&apikey=${keys.GNEWS}`;

    if (!isAllowedDomain(targetUrl)) {
      return sendJson(res, 400, { error: 'Domínio de destino inválido.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const apiRes = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeout);

    const data = await apiRes.json().catch(() => ({}));

    return sendJson(res, apiRes.status, data);
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    return sendJson(res, isTimeout ? 504 : 500, {
      error: isTimeout ? 'Tempo limite esgotado ao consultar GNews.' : 'Falha interna ao processar requisição GNews.'
    });
  }
}
