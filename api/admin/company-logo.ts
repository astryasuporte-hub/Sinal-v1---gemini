/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Company Logo Upload & Validation
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../_lib/common.js';
import { saveCompanyLogoUpload } from '../../src/server/companyLogoService.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const entityId = String(body.entityId || '').trim();
      const rawBase64 = String(body.base64 || body.dataUrl || '').trim();
      const fileName = String(body.fileName || `${entityId || 'company'}.png`).trim();

      if (!entityId || !rawBase64) {
        return sendJson(res, 400, {
          success: false,
          error: 'ID da empresa (entityId) e dados binários em Base64 são obrigatórios.'
        });
      }

      const result = await saveCompanyLogoUpload(entityId, rawBase64, fileName);

      return sendJson(res, result.valid ? 200 : 422, {
        success: result.valid,
        logoUrl: result.storageUrl || result.cleanDataUrl,
        details: result,
        error: result.error
      });
    } catch (err: any) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    return sendJson(res, 200, { success: true, message: 'Logotipo desvinculado com sucesso.' });
  }

  return sendJson(res, 405, { error: 'Método não permitido.' });
}
