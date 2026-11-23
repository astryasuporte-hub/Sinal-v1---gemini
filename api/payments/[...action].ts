/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vercel Catch-All Consolidated Serverless Function: /api/payments/[...action]
 * Roteador consolidado de assinaturas e pagamentos FatosBR Payments V1 (Cakto),
 * preservando o limite de 8 funções serverless no plano Vercel Hobby.
 *
 * Rotas suportadas:
 * - GET  /api/payments/status
 * - POST /api/payments/checkout
 * - POST /api/payments/webhook (e GET admin-only para diagnóstico)
 * - POST /api/payments/cancel
 * - POST /api/payments/reconcile
 * - GET  /api/payments/history
 */

import statusHandler from '../_lib/handlers/payments/status.js';
import checkoutHandler from '../_lib/handlers/payments/checkout.js';
import webhookHandler from '../_lib/handlers/payments/webhook.js';
import cancelHandler from '../_lib/handlers/payments/cancel.js';
import reconcileHandler from '../_lib/handlers/payments/reconcile.js';
import historyHandler from '../_lib/handlers/payments/history.js';
import nfseHandler from '../_lib/handlers/payments/nfse.js';
import { sendJson, setCorsHeaders } from '../_lib/common.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const pathname = urlObj.pathname;

  if (pathname === '/api/payments/status' || pathname === '/api/payments') {
    return statusHandler(req, res);
  }
  if (pathname === '/api/payments/checkout') {
    return checkoutHandler(req, res);
  }
  if (pathname === '/api/payments/webhook' || pathname === '/api/payments/webhooks') {
    return webhookHandler(req, res);
  }
  if (pathname === '/api/payments/cancel') {
    return cancelHandler(req, res);
  }
  if (pathname === '/api/payments/reconcile') {
    return reconcileHandler(req, res);
  }
  if (pathname === '/api/payments/history') {
    return historyHandler(req, res);
  }
  if (pathname === '/api/payments/nfse') {
    return nfseHandler(req, res);
  }

  return sendJson(res, 404, {
    error: 'Endpoint de pagamentos não encontrado.',
    errorCode: 'ENDPOINT_NOT_FOUND',
  });
}
