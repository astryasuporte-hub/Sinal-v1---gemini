/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Handler Admin: Upload/Remoção Individual de Logotipo PNG
 * Protegido por verifyAdminRequest, persiste permanentemente no bucket
 * brand-assets do Supabase Storage e atualiza public.entities.image_url.
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { validatePngTransparency } from '../../../../src/server/companyLogoService.js';
import {
  clearSingleTargetImage,
  updateSingleTargetImage
} from '../../imageLibraryService.js';
import { ManifestTargetType } from '../../zipImageValidator.js';

export default async function companyLogoHandler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const isAuthorized = await verifyAdminRequest(req);
  if (!isAuthorized) {
    return sendJson(res, 401, {
      success: false,
      error: 'UNAUTHORIZED_ADMIN',
      message: 'Acesso administrativo obrigatório para gerenciar logotipos.'
    });
  }

  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const entityId = String(body.entityId || '').trim();
      const rawBase64 = String(body.base64 || body.dataUrl || '').trim();
      const rawType = String(body.targetType || 'COMPANY').trim().toUpperCase();
      const targetType: ManifestTargetType =
        rawType === 'PERSON' ? 'PERSON' : rawType === 'SOURCE' ? 'SOURCE' : 'COMPANY';

      if (!entityId || !rawBase64) {
        return sendJson(res, 400, {
          success: false,
          error: 'ID do registro (entityId) e dados binários em Base64 são obrigatórios.'
        });
      }

      const commaIndex = rawBase64.indexOf(',');
      const pureBase64 = commaIndex !== -1 ? rawBase64.substring(commaIndex + 1) : rawBase64;
      const rawBuffer = Buffer.from(pureBase64, 'base64');

      const check = validatePngTransparency(rawBuffer);
      if (!check.valid) {
        return sendJson(res, 422, {
          success: false,
          details: check,
          error: check.error
        });
      }

      const persisted = await updateSingleTargetImage({
        targetType,
        targetId: entityId,
        buffer: rawBuffer,
        mimeType: 'image/png',
        extension: 'png'
      });

      return sendJson(res, 200, {
        success: true,
        logoUrl: persisted.publicUrl,
        imageUrl: persisted.publicUrl,
        storagePath: persisted.storagePath,
        details: {
          ...check,
          storageUrl: persisted.publicUrl
        }
      });
    } catch (err: any) {
      return sendJson(res, 500, {
        success: false,
        error: err?.message || 'Falha ao salvar logotipo no Supabase Storage.'
      });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const entityId = String(urlObj.searchParams.get('entityId') || urlObj.searchParams.get('id') || '').trim();
      const rawType = String(urlObj.searchParams.get('targetType') || 'COMPANY').trim().toUpperCase();
      const targetType: ManifestTargetType =
        rawType === 'PERSON' ? 'PERSON' : rawType === 'SOURCE' ? 'SOURCE' : 'COMPANY';

      if (!entityId) {
        return sendJson(res, 400, { success: false, error: 'entityId é obrigatório.' });
      }

      await clearSingleTargetImage(targetType, entityId);
      return sendJson(res, 200, { success: true, message: 'Logotipo desvinculado com sucesso.' });
    } catch (err: any) {
      return sendJson(res, 500, { success: false, error: err?.message || 'Erro ao remover logotipo.' });
    }
  }

  return sendJson(res, 405, { error: 'Método não permitido.' });
}
