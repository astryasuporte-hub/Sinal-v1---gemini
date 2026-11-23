/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Handler: GET /api/payments/nfse
 * Retorna documentos fiscais (NFS-e) do usuário autenticado e status de prontidão fiscal.
 */

import { sendJson, setCorsHeaders } from '../../common.js';
import { fiscalInvoiceService, getFiscalReadiness } from '../../payments/FiscalInvoiceService.js';
import { authenticatePaymentUser } from './authHelper.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    return sendJson(res, 405, { success: false, error: 'Método não permitido. Utilize GET.' });
  }

  const auth = await authenticatePaymentUser(req);
  if (!auth.ok) {
    return sendJson(res, auth.statusCode, { success: false, error: auth.error });
  }

  try {
    const documents = await fiscalInvoiceService.listUserFiscalDocuments(auth.user.userId);
    const readiness = getFiscalReadiness();
    return sendJson(res, 200, {
      success: true,
      readiness: {
        ready: readiness.ready,
        provider: readiness.provider,
        autoEmitEnabled: readiness.autoEmitEnabled,
      },
      documents,
    });
  } catch (err: any) {
    return sendJson(res, 503, {
      success: false,
      errorCode: 'FISCAL_SERVICE_UNAVAILABLE',
      error: err?.message || 'Falha ao consultar documentos fiscais.',
    });
  }
}
