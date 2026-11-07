/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Web Push & Notifications Consolidated Domain Router
 * Consolidates Push notifications endpoints into a single Serverless Function to comply with Hobby plan limits.
 */

import { sendJson, setCorsHeaders } from '../_lib/common';
import subscribeHandler from '../_lib/handlers/notifications/subscribe';
import broadcastPushHandler from '../_lib/handlers/notifications/broadcastPush';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  if (pathname.includes('/subscribe')) {
    return subscribeHandler(req, res);
  }
  if (pathname.includes('/broadcast-push')) {
    return broadcastPushHandler(req, res);
  }

  return sendJson(res, 404, {
    error: 'ENDPOINT_NOT_FOUND',
    message: `Endpoint de Notificações não encontrado: ${pathname}`
  });
}
