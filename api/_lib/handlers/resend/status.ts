/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Resend Status & Connectivity
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
  const apiKey = keys.RESEND;

  if (!apiKey) {
    return sendJson(res, 200, {
      ok: false,
      connected: false,
      provider: 'Resend',
      keyMasked: 'Não configurado',
      message: 'RESEND_API_KEY não definida no ambiente de produção.'
    });
  }

  const start = Date.now();
  try {
    const checkRes = await fetch('https://api.resend.com/api-keys', {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const latencyMs = Date.now() - start;

    return sendJson(res, 200, {
      ok: checkRes.ok,
      connected: checkRes.ok,
      provider: 'Resend',
      latencyMs,
      sender: 'onboarding@resend.dev',
      keyMasked: maskSecret(apiKey),
      statusCode: checkRes.status
    });
  } catch (err: any) {
    return sendJson(res, 200, {
      ok: false,
      connected: false,
      provider: 'Resend',
      error: err.message,
      keyMasked: maskSecret(apiKey)
    });
  }
}
