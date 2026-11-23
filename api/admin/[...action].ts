/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vercel Serverless Function: Admin Consolidated Domain Router
 * Consolida endpoints administrativos (/api/admin/company-logo e /api/admin/image-library)
 * dentro do limite de Serverless Functions do plano Hobby da Vercel.
 */

import { sendJson, setCorsHeaders } from '../_lib/common.js';
import companyLogoHandler from '../_lib/handlers/admin/companyLogo.js';
import imageLibraryHandler from '../_lib/handlers/admin/imageLibrary.js';
import briefingsOpsHandler from '../_lib/handlers/admin/briefingsOps.js';
import financialOpsHandler from '../_lib/handlers/admin/financialOps.js';

export default async function handler(req: any, res: any) {
  try {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const pathname = urlObj.pathname.toLowerCase();

    if (pathname.includes('/financial-ops')) {
      return await financialOpsHandler(req, res);
    }

    if (pathname.includes('/briefings-ops')) {
      return await briefingsOpsHandler(req, res);
    }

    if (pathname.includes('/image-library')) {
      return await imageLibraryHandler(req, res);
    }

    if (pathname.includes('/company-logo')) {
      return await companyLogoHandler(req, res);
    }

    return sendJson(res, 404, {
      success: false,
      error: 'ADMIN_ENDPOINT_NOT_FOUND',
      message: 'Endpoint administrativo não encontrado.'
    });
  } catch (err: any) {
    console.error('[Admin Router Global Error]', err?.message || err);
    return sendJson(res, 500, {
      success: false,
      error: 'ADMIN_SERVICE_UNAVAILABLE',
      message: err?.message || 'Erro interno no roteador administrativo.'
    });
  }
}
