/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Resend Webhooks Handler
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../_lib/common';

const globalEvents: any[] = [];

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'POST') {
    const payload = await readJsonBody(req);
    const eventType = String(payload.type || payload.event || 'email.delivered').toLowerCase();

    const webhookItem = {
      id: payload.id || `evt_${Date.now()}`,
      type: eventType,
      recipient: payload.data?.to?.[0] || payload.to || 'destinatario@fatosbr.com.br',
      timestamp: payload.created_at || new Date().toISOString()
    };

    globalEvents.unshift(webhookItem);
    if (globalEvents.length > 50) globalEvents.pop();

    return sendJson(res, 200, {
      success: true,
      received: true,
      eventId: webhookItem.id
    });
  }

  // GET: Returns list of recent events
  return sendJson(res, 200, {
    ok: true,
    provider: 'Resend Webhooks',
    recentEvents: globalEvents
  });
}
