/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Auth Verify OTP (Legacy Endpoint Hardened in Auth V3.0)
 * A verificação oficial de códigos OTP ocorre exclusivamente pelo Supabase Auth (verifyOtp).
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
  const code = String(body.code || '').trim();

  if (!email || !code) {
    return sendJson(res, 400, { error: 'E-mail e código são obrigatórios.' });
  }

  return sendJson(res, 410, {
    success: false,
    verified: false,
    error: 'LEGACY_OTP_DISABLED',
    message: 'Validação paralela de OTP desativada na Auth V3.0. Utilize exclusivamente supabase.auth.verifyOtp.'
  });
}
