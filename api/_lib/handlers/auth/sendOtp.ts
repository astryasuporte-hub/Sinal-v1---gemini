/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Auth Send OTP (Legacy Endpoint Hardened in Auth V3.0)
 * O envio e a validação oficial de códigos OTP ocorrem exclusivamente pelo Supabase Auth.
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../../common.js';
import { enforceRateLimit } from '../../rateLimiter.js';

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

  return sendJson(res, 410, {
    success: false,
    error: 'LEGACY_OTP_DISABLED',
    message: 'O fluxo legado de OTP em memória foi desativado na Auth V3.0. Utilize exclusivamente o Supabase Auth OTP.'
  });
}
