/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Auth Send OTP
 */

import { sendJson, setCorsHeaders, readJsonBody, getServerKeys } from '../_lib/common';
import { enforceRateLimit } from '../_lib/rateLimiter';

// In-memory OTP storage
const otpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();

export { otpStore };

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

  const rateLimitAllowed = await enforceRateLimit(req, res, 'auth');
  if (!rateLimitAllowed) {
    return;
  }

  const body = await readJsonBody(req);
  const email = String(body.email || '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return sendJson(res, 400, { error: 'E-mail inválido para envio do código de verificação.' });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(email, {
    code,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    attempts: 0
  });

  const keys = getServerKeys();
  let dispatched = false;

  if (keys.RESEND) {
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${keys.RESEND}`
        },
        body: JSON.stringify({
          from: 'FatosBR Acesso <onboarding@resend.dev>',
          to: [email],
          subject: `Seu código de acesso FatosBR: ${code}`,
          html: `<p>Seu código de verificação para acesso ao FatosBR é: <strong>${code}</strong></p><p>Este código expira em 10 minutos.</p>`
        })
      });
      dispatched = emailRes.ok;
    } catch {}
  }

  return sendJson(res, 200, {
    success: true,
    message: `Código de verificação enviado para ${email}.`,
    dispatched,
    expiresIn: '10 minutos'
  });
}
