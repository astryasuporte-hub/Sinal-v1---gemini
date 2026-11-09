/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Resend Consolidated Domain Router
 * Consolidates all Resend endpoints into a single Serverless Function to comply with Hobby plan limits.
 */

import { sendJson, setCorsHeaders } from '../_lib/common.js';
import sendHandler from '../_lib/handlers/resend/send.js';
import statusHandler from '../_lib/handlers/resend/status.js';
import ticketHandler from '../_lib/handlers/resend/ticket.js';
import webhookHandler from '../_lib/handlers/resend/webhook.js';
import configHandler from '../_lib/handlers/resend/config.js';
import previewHandler from '../_lib/handlers/resend/preview.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  if (pathname.includes('/send')) {
    return sendHandler(req, res);
  }
  if (pathname.includes('/status')) {
    return statusHandler(req, res);
  }
  if (pathname.includes('/ticket')) {
    return ticketHandler(req, res);
  }
  if (pathname.includes('/webhook')) {
    return webhookHandler(req, res);
  }
  if (pathname.includes('/config')) {
    return configHandler(req, res);
  }
  if (pathname.includes('/preview')) {
    return previewHandler(req, res);
  }

  return sendJson(res, 404, {
    error: 'ENDPOINT_NOT_FOUND',
    message: `Endpoint Resend não encontrado: ${pathname}`
  });
}
