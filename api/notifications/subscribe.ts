/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Web Push Subscriptions
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../_lib/common';

const subscriptions = new Map<string, any>();

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const subId = body.endpoint ? Buffer.from(body.endpoint).toString('base64').slice(0, 16) : `sub_${Date.now()}`;
    subscriptions.set(subId, { ...body, registeredAt: new Date().toISOString() });

    return sendJson(res, 200, {
      success: true,
      message: 'Inscrição de notificações Web Push registrada com sucesso.',
      subscriptionId: subId
    });
  }

  return sendJson(res, 200, {
    count: subscriptions.size,
    status: 'ACTIVE'
  });
}
