/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Balance Endpoint (Admin Protected)
 */

import { sendJson, setCorsHeaders } from '../../common';
import { verifyAdminRequest } from '../../adminAuth';
import { fetchBalanceFromGateway } from '../../zynpayClient';
import { enforceRateLimit } from '../../rateLimiter';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Rate Limiting distribuído
  const rateLimitAllowed = await enforceRateLimit(req, res, 'admin');
  if (!rateLimitAllowed) {
    return;
  }

  // Verificação de privilégios de Administrador
  const isAdmin = await verifyAdminRequest(req);
  if (!isAdmin) {
    return sendJson(res, 401, {
      error: 'Acesso restrito. Consulta de saldo financeiro requer autenticação de administrador.',
      code: 'UNAUTHORIZED_ADMIN'
    });
  }

  try {
    const balance = await fetchBalanceFromGateway();
    return sendJson(res, 200, {
      success: true,
      balance: {
        available: balance.available,
        pending: balance.pending,
        currency: balance.currency,
        accountStatus: 'VERIFIED',
        updatedAt: new Date().toISOString()
      }
    });
  } catch (err: any) {
    if (err.message?.includes('GATEWAY_UNCONFIGURED')) {
      return sendJson(res, 200, {
        success: true,
        balance: {
          available: 0,
          pending: 0,
          currency: 'BRL',
          accountStatus: 'PENDING_CONFIG',
          updatedAt: new Date().toISOString()
        },
        warning: 'ZYNPAY_API_KEY não configurada no ambiente.'
      });
    }

    return sendJson(res, 200, {
      success: true,
      balance: {
        available: 0,
        pending: 0,
        currency: 'BRL',
        accountStatus: 'OFFLINE',
        updatedAt: new Date().toISOString()
      },
      error: err.message
    });
  }
}
