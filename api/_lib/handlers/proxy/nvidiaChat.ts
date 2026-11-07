/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: NVIDIA NIM Chat Completions Proxy
 */

import { getServerKeys, sendJson, setCorsHeaders, isAllowedDomain, readJsonBody } from '../../common';
import { enforceRateLimit } from '../../rateLimiter';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Método não permitido. Utilize POST.' });
  }

  const rateLimitAllowed = await enforceRateLimit(req, res, 'ai');
  if (!rateLimitAllowed) {
    return;
  }

  const keys = getServerKeys();
  if (!keys.NVIDIA_NIM) {
    return sendJson(res, 503, {
      error: 'NVIDIA_NIM_API_KEY não configurada no ambiente de produção.',
      configured: false
    });
  }

  try {
    const body = await readJsonBody(req);
    const targetUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';

    if (!isAllowedDomain(targetUrl)) {
      return sendJson(res, 400, { error: 'Domínio de destino inválido.' });
    }

    // Sanitize and limit prompt size to avoid prompt injection buffer overflow
    if (body.messages && Array.isArray(body.messages)) {
      body.messages = body.messages.slice(-10); // keep last 10 messages max
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s for LLM inference

    const apiRes = await fetch(targetUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keys.NVIDIA_NIM}`
      },
      body: JSON.stringify(body)
    });
    clearTimeout(timeout);

    const data = await apiRes.json().catch(() => ({}));

    return sendJson(res, apiRes.status, data);
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    return sendJson(res, isTimeout ? 504 : 500, {
      error: isTimeout ? 'Tempo limite esgotado na inferência NVIDIA NIM.' : 'Falha interna na comunicação com NVIDIA NIM.'
    });
  }
}
