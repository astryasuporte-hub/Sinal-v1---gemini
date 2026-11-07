/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Proxy APIs Consolidated Domain Router
 * Consolidates all News & AI Proxy endpoints into a single Serverless Function to comply with Hobby plan limits.
 */

import { sendJson, setCorsHeaders } from '../_lib/common';
import gnewsHandler from '../_lib/handlers/proxy/gnews';
import newsapiHandler from '../_lib/handlers/proxy/newsapi';
import worldnewsHandler from '../_lib/handlers/proxy/worldnews';
import statusHandler from '../_lib/handlers/proxy/status';
import nvidiaChatHandler from '../_lib/handlers/proxy/nvidiaChat';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  if (pathname.includes('/gnews')) {
    return gnewsHandler(req, res);
  }
  if (pathname.includes('/newsapi')) {
    return newsapiHandler(req, res);
  }
  if (pathname.includes('/worldnews')) {
    return worldnewsHandler(req, res);
  }
  if (pathname.includes('/status')) {
    return statusHandler(req, res);
  }
  if (pathname.includes('/nvidia') || pathname.includes('/chat')) {
    return nvidiaChatHandler(req, res);
  }

  return sendJson(res, 404, {
    error: 'ENDPOINT_NOT_FOUND',
    message: `Endpoint de Proxy não encontrado: ${pathname}`
  });
}
