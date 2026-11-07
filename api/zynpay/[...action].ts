/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Consolidated Domain Router
 * Consolidates all ZynPay endpoints into a single Serverless Function to comply with Hobby plan limits.
 */

import { sendJson, setCorsHeaders } from '../_lib/common';
import chargesHandler from '../_lib/handlers/zynpay/charges';
import webhookHandler from '../_lib/handlers/zynpay/webhook';
import balanceHandler from '../_lib/handlers/zynpay/balance';
import configHandler from '../_lib/handlers/zynpay/config';
import eventsHandler from '../_lib/handlers/zynpay/events';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  if (pathname.includes('/charges')) {
    return chargesHandler(req, res);
  }
  if (pathname.includes('/webhook')) {
    return webhookHandler(req, res);
  }
  if (pathname.includes('/balance')) {
    return balanceHandler(req, res);
  }
  if (pathname.includes('/config')) {
    return configHandler(req, res);
  }
  if (pathname.includes('/events')) {
    return eventsHandler(req, res);
  }

  return sendJson(res, 404, {
    error: 'ENDPOINT_NOT_FOUND',
    message: `Endpoint ZynPay não encontrado: ${pathname}`
  });
}
