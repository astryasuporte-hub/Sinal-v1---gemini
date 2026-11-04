/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Instagram Control & Automation
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../_lib/common';
import { instagramEngine } from '../../src/server/instagramEngine';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  if (pathname.includes('/status')) {
    const status = await instagramEngine.getStatus();
    return sendJson(res, 200, status);
  }

  if (pathname.includes('/config')) {
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const updated = instagramEngine.updateConfig(body);
      return sendJson(res, 200, { success: true, config: updated });
    }
    const config = instagramEngine.getConfig();
    return sendJson(res, 200, config);
  }

  if (pathname.includes('/publish')) {
    const body = await readJsonBody(req);
    const result = await instagramEngine.publishPost(body);
    return sendJson(res, result.success ? 200 : 400, result);
  }

  if (pathname.includes('/schedule')) {
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const post = instagramEngine.schedulePost(body);
      return sendJson(res, 200, { success: true, post });
    }
    const posts = instagramEngine.listScheduledPosts();
    return sendJson(res, 200, posts);
  }

  if (pathname.includes('/insights')) {
    const insights = instagramEngine.getInsights();
    return sendJson(res, 200, insights);
  }

  // Fallback status
  return sendJson(res, 200, {
    service: 'Instagram Automation',
    status: 'ACTIVE'
  });
}
