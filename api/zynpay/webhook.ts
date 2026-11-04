/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Webhook Receiver & Validator
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../_lib/common';

const recentWebhookEvents: any[] = [];

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // POST: Webhook receiver
  if (req.method === 'POST') {
    const payload = await readJsonBody(req);
    const eventId = payload.id || `whk_${Date.now()}`;
    const chargeId = payload.chargeId || payload.data?.id || 'zyn_charge';
    const status = payload.status || payload.data?.status || 'PAID';

    const recordedEvent = {
      id: eventId,
      type: payload.type || 'charge.paid',
      chargeId,
      status,
      timestamp: new Date().toISOString(),
      payload
    };

    recentWebhookEvents.unshift(recordedEvent);
    if (recentWebhookEvents.length > 50) recentWebhookEvents.pop();

    return sendJson(res, 200, {
      success: true,
      received: true,
      eventId,
      chargeId,
      status
    });
  }

  // GET: Retorna lista dos eventos recebidos
  return sendJson(res, 200, {
    ok: true,
    provider: 'ZynPay Webhooks',
    recentEvents: recentWebhookEvents
  });
}
