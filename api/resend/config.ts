/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Resend Configuration
 */

import { getServerKeys, sendJson, setCorsHeaders, readJsonBody, maskSecret } from '../_lib/common';

let customSender = 'FatosBR Briefing <onboarding@resend.dev>';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const keys = getServerKeys();
  const apiKey = keys.RESEND;

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    if (body.sender && typeof body.sender === 'string' && body.sender.trim()) {
      customSender = body.sender.trim();
    }
    return sendJson(res, 200, {
      success: true,
      message: 'Configurações do Resend salvas com sucesso.',
      sender: customSender,
      keyMasked: maskSecret(apiKey)
    });
  }

  // GET
  return sendJson(res, 200, {
    success: true,
    sender: customSender,
    keyMasked: maskSecret(apiKey),
    hasKey: Boolean(apiKey)
  });
}
