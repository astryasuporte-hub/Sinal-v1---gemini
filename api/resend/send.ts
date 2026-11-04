/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Resend Send Email
 */

import { getServerKeys, sendJson, setCorsHeaders, readJsonBody, checkRateLimit, getClientIp } from '../_lib/common';

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

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`resend_send_${clientIp}`, 15, 60000)) {
    return sendJson(res, 429, { error: 'Rate limit excedido para envio de e-mails. Aguarde um momento.' });
  }

  const keys = getServerKeys();
  const apiKey = keys.RESEND;
  const body = await readJsonBody(req);

  const toEmail = body.to || 'astryasuporte@gmail.com';
  const subject = body.subject || 'FatosBR • Notificação';
  const from = body.from || 'FatosBR <onboarding@resend.dev>';
  const html = body.html || `<p>${body.text || 'Notificação do FatosBR'}</p>`;
  const text = body.text || 'Notificação do FatosBR';

  if (!apiKey) {
    return sendJson(res, 200, {
      success: true,
      simulated: true,
      message: `RESEND_API_KEY ausente. E-mail simulado com sucesso para ${toEmail}`
    });
  }

  try {
    const apiRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(toEmail) ? toEmail : [toEmail],
        subject,
        html,
        text
      })
    });

    const data = await apiRes.json().catch(() => ({}));

    return sendJson(res, apiRes.status, data);
  } catch (err: any) {
    return sendJson(res, 500, { error: err.message });
  }
}
