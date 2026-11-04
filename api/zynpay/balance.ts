/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Balance Endpoint (Admin Protected)
 */

import { getServerKeys, sendJson, setCorsHeaders } from '../_lib/common';
import { verifyAdminRequest } from '../_lib/adminAuth';
import { enforceRateLimit } from '../_lib/rateLimiter';

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

  const keys = getServerKeys();
  const apiKey = keys.ZYNPAY;

  if (!apiKey) {
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

  try {
    const upRes = await fetch('https://api.zynpay.com.br/v1/public/balance', {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (upRes.ok) {
      const upData = await upRes.json();
      return sendJson(res, 200, {
        success: true,
        balance: {
          available: Number(upData.available ?? upData.balance ?? 0),
          pending: Number(upData.pending ?? 0),
          currency: 'BRL',
          accountStatus: 'VERIFIED',
          updatedAt: new Date().toISOString()
        }
      });
    }

    const errText = await upRes.text();
    const isVerificationPending = upRes.status === 403 || errText.includes('ACCOUNT_NOT_VERIFIED');

    return sendJson(res, 200, {
      success: true,
      balance: {
        available: 0,
        pending: 0,
        currency: 'BRL',
        accountStatus: isVerificationPending ? 'PENDING_VERIFICATION' : 'UNVERIFIED',
        updatedAt: new Date().toISOString()
      },
      warning: isVerificationPending
        ? 'Conta ZynPay em análise cadastral. Modo seguro ativo.'
        : `ZynPay upstream status: ${upRes.status}`
    });
  } catch (err: any) {
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
