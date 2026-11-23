/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Resend Status & Connectivity
 */

import { getServerKeys, sendJson, setCorsHeaders, maskSecret } from '../../common.js';
import { getResendFromEmail } from '../../resendClient.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const keys = getServerKeys();
  const apiKey = keys.RESEND;
  const webhookConfigured = Boolean(String(process.env.RESEND_WEBHOOK_SECRET || '').trim());
  const sender = getResendFromEmail();

  if (!apiKey) {
    return sendJson(res, 200, {
      ok: false,
      connected: false,
      provider: 'Resend',
      sender,
      webhookConfigured,
      keyMasked: 'Não configurado',
      message: 'RESEND_API_KEY não definida no ambiente de produção.'
    });
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), 8000);
  try {
    const checkRes = await fetch('https://api.resend.com/api-keys', {
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });
    clearTimeout(timeoutTimer);
    const latencyMs = Date.now() - start;

    return sendJson(res, 200, {
      ok: checkRes.ok,
      connected: checkRes.ok,
      provider: 'Resend',
      latencyMs,
      sender,
      webhookConfigured,
      keyMasked: maskSecret(apiKey),
      statusCode: checkRes.status
    });
  } catch (err: any) {
    clearTimeout(timeoutTimer);
    return sendJson(res, 200, {
      ok: false,
      connected: false,
      provider: 'Resend',
      sender,
      webhookConfigured,
      error: err.message,
      keyMasked: maskSecret(apiKey)
    });
  }
}
