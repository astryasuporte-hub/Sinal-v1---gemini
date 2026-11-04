/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Avatar Security & EXIF Sanitizer
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../_lib/common';
import { verifyAndSanitizeAvatarUpload } from '../../src/server/avatarSecurityService';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Método não permitido. Utilize POST.' });
  }

  try {
    const body = await readJsonBody(req);
    const rawData = String(body.dataUrl || body.base64 || '').trim();
    const dataUrl = rawData.startsWith('data:')
      ? rawData
      : `data:${body.mimeType || 'image/jpeg'};base64,${rawData}`;
    const fileName = String(body.fileName || 'avatar.jpg').trim();

    const result = await verifyAndSanitizeAvatarUpload({
      fileName,
      dataUrl
    });

    return sendJson(res, result.success ? 200 : 422, result);
  } catch (err: any) {
    return sendJson(res, 500, { error: err.message });
  }
}
