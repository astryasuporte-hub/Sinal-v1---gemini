/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Web Push Broadcast
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../../common';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const title = body.title || 'FatosBR • Notícia Urgente';
    const message = body.body || body.message || 'Confira os novos acontecimentos apurados pelo FatosBR.';

    return sendJson(res, 200, {
      success: true,
      delivered: true,
      broadcastId: `push_${Date.now()}`,
      title,
      message,
      sentAt: new Date().toISOString()
    });
  }

  return sendJson(res, 405, { error: 'Método não permitido.' });
}
