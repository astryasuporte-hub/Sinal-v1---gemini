/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Resend Preview HTML Briefing
 */

import { setCorsHeaders, readJsonBody } from '../../common.js';
import { buildEditorialBriefingHtml } from '../../../../src/server/templateEngine.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  let briefingType: 'morning' | 'evening' = 'morning';
  let previewEvents: any[] = [];
  let customTitle: string | undefined;
  let customSubtitle: string | undefined;

  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (body.type === 'evening' || body.type === 'morning') briefingType = body.type;
      if (Array.isArray(body.events)) previewEvents = body.events;
      if (body.customTitle) customTitle = body.customTitle;
      if (body.customSubtitle) customSubtitle = body.customSubtitle;
    } catch {}
  } else {
    const urlObj = new URL(req.url, 'http://localhost');
    if (urlObj.searchParams.get('type') === 'evening') briefingType = 'evening';
  }

  const html = buildEditorialBriefingHtml({
    type: briefingType,
    events: previewEvents,
    brandName: 'FatosBR',
    senderEmail: 'briefing@fatosbr.com.br',
    appUrl: process.env.APP_URL || 'https://fatosbr.com.br',
    customTitle,
    customSubtitle
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.statusCode = 200;
  res.end(html);
}
