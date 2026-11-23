/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Resend Configuration
 */

import { getServerKeys, sendJson, setCorsHeaders, readJsonBody, maskSecret } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { getResendFromEmail } from '../../resendClient.js';

let customSenderOverride: string | null = null;

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

  if (req.method === 'POST') {
    const authorized = await verifyAdminRequest(req);
    if (!authorized) {
      return sendJson(res, 401, {
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Acesso administrativo obrigatório para alterar configurações do Resend.',
      });
    }

    const body = await readJsonBody(req);
    if (body.sender && typeof body.sender === 'string' && body.sender.trim()) {
      customSenderOverride = body.sender.trim();
    }
    return sendJson(res, 200, {
      success: true,
      message: 'Configurações do Resend salvas com sucesso.',
      sender: customSenderOverride || getResendFromEmail(),
      webhookConfigured,
      keyMasked: maskSecret(apiKey)
    });
  }

  // GET
  return sendJson(res, 200, {
    success: true,
    sender: customSenderOverride || getResendFromEmail(),
    keyMasked: maskSecret(apiKey),
    hasKey: Boolean(apiKey),
    webhookConfigured
  });
}
