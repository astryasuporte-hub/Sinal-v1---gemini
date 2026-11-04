/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Charges (Pix Generation & Status)
 */

import QRCode from 'qrcode';
import { getServerKeys, sendJson, setCorsHeaders, readJsonBody, getClientIp, checkRateLimit } from '../_lib/common';

const chargesMemory = new Map<string, any>();

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`zyn_charges_${clientIp}`, 30, 60000)) {
    return sendJson(res, 429, { error: 'Rate limit excedido para operações Pix.' });
  }

  const keys = getServerKeys();
  const apiKey = keys.ZYNPAY;

  // POST /api/zynpay/charges (Criação de Cobrança Pix)
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const amount = Number(body.amount || 29.9);
    const description = body.description || 'Assinatura FatosBR Pro';
    const customer = body.customer || { name: 'Leitor FatosBR', email: 'leitor@fatosbr.com.br' };

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

    chargesMemory.set(chargeId, chargeRecord);

    // Se houver chave ativa da ZynPay, tenta registrar upstream
    if (apiKey) {
      try {
        const upRes = await fetch('https://api.zynpay.com.br/v1/public/charges', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            amount: Math.round(amount * 100),
            description,
            customer,
            paymentMethod: 'PIX'
          })
        });

        if (upRes.ok) {
          const upData = await upRes.json();
          chargeRecord.id = upData.id || chargeRecord.id;
          if (upData.qrCode) chargeRecord.qrCode = upData.qrCode;
          if (upData.qrCodeText) chargeRecord.qrCodeText = upData.qrCodeText;
          chargesMemory.set(chargeRecord.id, chargeRecord);
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
      return sendJson(res, 400, { error: 'ID da cobrança obrigatório.' });
    }

    const stored = chargesMemory.get(chargeId);
    if (stored) {
      return sendJson(res, 200, {
        success: true,
        charge: stored
      });
    }

    return sendJson(res, 200, {
      success: true,
      charge: {
        id: chargeId,
        status: 'PENDING',
        amount: 29.9,
        createdAt: new Date().toISOString()
      }
    });
  }

  return sendJson(res, 405, { error: 'Método não permitido.' });
}
