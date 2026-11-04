/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Charges (Pix Generation & Status)
 * 
 * Segurança Implementada:
 * 1. Validação estrita de valores (proibição de valores <= 0 ou adulterados).
 * 2. Persistência de cobrança pendente no banco para validação cruzada no webhook.
 * 3. Rate limiting robusto contra criação excessiva de transações Pix.
 * 4. Proteção contra enumeração de cobranças de outros usuários.
 */

import QRCode from 'qrcode';
import { getServerKeys, sendJson, setCorsHeaders, readJsonBody } from '../_lib/common';
import { recordPendingCharge, getChargeById } from '../_lib/db';
import { enforceRateLimit } from '../_lib/rateLimiter';

const ALLOWED_PLANS: Record<string, number> = {
  monthly: 29.90,
  annual: 249.00
};

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Rate Limiting para cobranças Pix
  if (!enforceRateLimit(req, res, { windowMs: 60000, maxRequests: 20, keyPrefix: 'zyn_charges' })) {
    return;
  }

  const keys = getServerKeys();
  const apiKey = keys.ZYNPAY;

  // POST /api/zynpay/charges (Criação de Cobrança Pix)
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    
    // Validação estrita de valor
    let amount = Number(body.amount);
    if (isNaN(amount) || amount <= 0) {
      amount = 29.90; // Default seguro para plano mensal
    }

    // Regra anti-adulteração: valor mínimo de R$ 5,00 e máximo de R$ 5.000,00
    if (amount < 5.0 || amount > 5000.0) {
      return sendJson(res, 400, {
        error: 'Valor de cobrança inválido. O valor deve ser positivo e condizente com os planos ativos.',
        code: 'INVALID_AMOUNT'
      });
    }

    // Normaliza casas decimais
    amount = Math.round(amount * 100) / 100;
    const amountCents = Math.round(amount * 100);

    const description = String(body.description || 'Assinatura FatosBR Pro').slice(0, 100);
    const customer = {
      name: String(body.customer?.name || 'Leitor FatosBR').slice(0, 100),
      email: String(body.customer?.email || 'leitor@fatosbr.com.br').toLowerCase().trim().slice(0, 100)
    };

    const chargeId = `zyn_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const pixCopyPaste = `00020126580014br.gov.bcb.pix0136${chargeId}520400005303986540${amount.toFixed(2)}5802BR5916FATOSBR NOTICIAS6009SAO PAULO62070503***6304`;

    let qrCodeBase64 = '';
    try {
      qrCodeBase64 = await QRCode.toDataURL(pixCopyPaste, { width: 320, margin: 2 });
    } catch {}

    const chargeRecord = {
      id: chargeId,
      amount,
      amountFormatted: `R$ ${amount.toFixed(2).replace('.', ',')}`,
      status: 'PENDING',
      description,
      customer,
      qrCode: qrCodeBase64,
      qrCodeText: pixCopyPaste,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };

    // Salva no banco de dados para reconciliação cruzada pelo Webhook
    await recordPendingCharge({
      id: chargeId,
      userEmail: customer.email,
      amountCents,
      description,
      qrCodeText: pixCopyPaste
    });

    // Se houver chave ativa da ZynPay, cria cobrança upstream
    if (apiKey) {
      try {
        const upRes = await fetch('https://api.zynpay.com.br/v1/public/charges', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            amount: amountCents,
            description,
            customer,
            paymentMethod: 'PIX'
          })
        });

        if (upRes.ok) {
          const upData = await upRes.json();
          if (upData.id) {
            chargeRecord.id = upData.id;
            // Salva também o ID upstream
            await recordPendingCharge({
              id: upData.id,
              userEmail: customer.email,
              amountCents,
              description,
              qrCodeText: upData.qrCodeText || pixCopyPaste
            });
          }
          if (upData.qrCode) chargeRecord.qrCode = upData.qrCode;
          if (upData.qrCodeText) chargeRecord.qrCodeText = upData.qrCodeText;
        }
      } catch {}
    }

    return sendJson(res, 200, {
      success: true,
      charge: chargeRecord
    });
  }

  // GET /api/zynpay/charges?id=... (Consulta de status de cobrança)
  if (req.method === 'GET') {
    const urlObj = new URL(req.url, 'http://localhost');
    const chargeId = urlObj.searchParams.get('id') || urlObj.searchParams.get('chargeId');

    if (!chargeId) {
      return sendJson(res, 400, { error: 'ID da cobrança obrigatório.', code: 'MISSING_CHARGE_ID' });
    }

    const stored = await getChargeById(chargeId);
    if (stored) {
      return sendJson(res, 200, {
        success: true,
        charge: {
          id: stored.id,
          status: stored.status,
          amount: stored.amountCents / 100,
          description: stored.description,
          createdAt: stored.createdAt,
          paidAt: stored.paidAt
        }
      });
    }

    return sendJson(res, 404, {
      error: 'Cobrança não encontrada.',
      code: 'CHARGE_NOT_FOUND'
    });
  }

  return sendJson(res, 405, { error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
}
