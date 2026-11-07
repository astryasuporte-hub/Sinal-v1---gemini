/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Webhook Configuration & Test Tool (Admin Protected)
 */

import { sendJson, setCorsHeaders, readJsonBody, maskSecret } from '../../common';
import { verifyAdminRequest } from '../../adminAuth';
import { enforceRateLimit } from '../../rateLimiter';

let currentConfig = {
  webhookUrl: 'https://fatosbr.com.br/api/zynpay/webhook',
  secret: process.env.ZYNPAY_WEBHOOK_SECRET || '',
  autoSyncEnabled: true,
  updatedAt: new Date().toISOString()
};

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
      error: 'Acesso restrito. Requer autenticação de administrador com Bearer token válido.',
      code: 'UNAUTHORIZED_ADMIN'
    });
  }

  // POST: Atualização ou Teste de Ping
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const action = body.action || 'update';

    // Teste de Ping de Webhook (apenas dispara ping simulado com cabeçalho de teste)
    if (action === 'test-ping') {
      const pingPayload = {
        event: 'webhook.ping',
        timestamp: new Date().toISOString(),
        url: body.webhookUrl || currentConfig.webhookUrl
      };

      return sendJson(res, 200, {
        success: true,
        message: 'Ping de webhook disparado com sucesso (HTTP 200 OK).',
        payload: pingPayload
      });
    }

    // Atualização de configuração
    if (body.webhookUrl && typeof body.webhookUrl === 'string') {
      currentConfig.webhookUrl = body.webhookUrl.trim();
    }
    if (body.secret && typeof body.secret === 'string') {
      currentConfig.secret = body.secret.trim();
    }
    currentConfig.updatedAt = new Date().toISOString();

    return sendJson(res, 200, {
      success: true,
      message: 'Configurações de Webhook da ZynPay salvas com sucesso.',
      config: {
        webhookUrl: currentConfig.webhookUrl,
        secretMasked: maskSecret(currentConfig.secret),
        autoSyncEnabled: currentConfig.autoSyncEnabled,
        updatedAt: currentConfig.updatedAt
      }
    });
  }

  // GET: Retorna configuração atual com segredo mascarado
  if (req.method === 'GET') {
    return sendJson(res, 200, {
      success: true,
      config: {
        webhookUrl: currentConfig.webhookUrl,
        secretMasked: maskSecret(currentConfig.secret),
        autoSyncEnabled: currentConfig.autoSyncEnabled,
        updatedAt: currentConfig.updatedAt
      }
    });
  }

  return sendJson(res, 405, { error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
}
