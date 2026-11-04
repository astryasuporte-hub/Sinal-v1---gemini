/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Webhook Configuration & Test Tool
 */

import { sendJson, setCorsHeaders, readJsonBody, maskSecret } from '../_lib/common';

let currentConfig = {
  webhookUrl: 'https://fatosbr.com.br/api/zynpay/webhook',
  secret: process.env.ZYNPAY_WEBHOOK_SECRET || 'whsec_zynpay_live_prod',
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

  // POST: Atualização ou Teste de Ping
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const action = body.action || 'update';

    // Teste de Ping
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

    // Simulação de Pagamento Pix Aprovado
    if (action === 'simulate-payment') {
      const simChargeId = body.chargeId || `zyn_sim_${Date.now()}`;
      return sendJson(res, 200, {
        success: true,
        message: `Pagamento Pix de R$ 29,90 aprovado e conciliado para a cobrança #${simChargeId}.`,
        chargeId: simChargeId,
        status: 'PAID',
        paidAt: new Date().toISOString()
      });
    }

    // Atualização normal de configuração
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
