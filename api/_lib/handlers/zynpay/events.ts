/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay SSE Events Endpoint
 */

import { setCorsHeaders } from '../../common';
import { subscribeBillingEvents } from '../../eventsHub';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Initial connection payload
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  // Subscribe to real-time payment confirmation events
  const unsubscribe = subscribeBillingEvents((payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {}
  });

  // Heartbeat to keep connection alive
  const interval = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() })}\n\n`);
    } catch {}
  }, 15000);

  req.on('close', () => {
    unsubscribe();
    clearInterval(interval);
    res.end();
  });
}
