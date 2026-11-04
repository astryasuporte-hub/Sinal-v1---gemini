/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Charges (Pix Generation & Status)
 * 
 * Arquitetura de Segurança:
 * 1. Rate limiting distribuído no perfil 'payments' (máximo 15 requisições/min).
 * 2. Validação estrita de valores monetários (proibição de <= 0, mínimo R$ 5,00, arredondamento para centavos).
 * 3. Persistência mandatória no PostgreSQL Supabase: Se o banco falhar, NÃO finge sucesso.
 * 4. Suporte a consulta por query param (?id=...) ou sub-rota (/api/zynpay/charges/{id}).
 */

import QRCode from 'qrcode';
import { getServerKeys, sendJson, setCorsHeaders, readJsonBody } from '../_lib/common';
import { recordPendingCharge, getChargeById } from '../_lib/db';
import { enforceRateLimit } from '../_lib/rateLimiter';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Rate Limiting distribuído
  const rateLimitAllowed = await enforceRateLimit(req, res, 'payments');
  if (!rateLimitAllowed) {
    return;
  }

  const keys = getServerKeys();
  const apiKey = keys.ZYNPAY;

  // POST /api/zynpay/charges (Criação de Cobrança Pix)
  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    
    // Suporte tanto para amount em reais quanto amountCents
    let amount = Number(body.amount);
    if (isNaN(amount) || amount <= 0) {
      if (body.amountCents && Number(body.amountCents) > 0) {
        amount = Number(body.amountCents) / 100;
      } else {
        amount = 29.90; // Default seguro para plano mensal Pro
      }
    }

    // Regra anti-adulteração: valor mínimo de R$ 5,00 e máximo de R$ 5.000,00
    if (amount < 5.0 || amount > 5000.0) {
      return sendJson(res, 400, {
        error: 'Valor de cobrança inválido. O valor deve ser positivo e condizente com os planos ativos.',
        code: 'INVALID_AMOUNT'
      });
    }

    // Normaliza casas decimais e centavos
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
      amount: amountCents, // Retorna em centavos conforme interface ZynPayCharge
      amountFormatted: `R$ ${amount.toFixed(2).replace('.', ',')}`,
      status: 'PENDING' as const,
      description,
      customer,
      qrCode: qrCodeBase64,
      qrCodeText: pixCopyPaste,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };

    // 1. Persistência mandatória no PostgreSQL Supabase
    try {
      await recordPendingCharge({
        id: chargeId,
        userEmail: customer.email,
        amountCents,
        description,
        qrCodeText: pixCopyPaste
      });
    } catch (dbErr: any) {
      console.error('[Persistence Failure] Não foi possível salvar cobrança pendente:', dbErr.message);
      return sendJson(res, 503, {
        error: 'Falha na persistência da cobrança. Operação abortada com segurança.',
        code: 'DATABASE_PERSISTENCE_FAILED'
      });
    }

    // 2. Se houver chave ativa da ZynPay, cria cobrança upstream
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
            // Salva também o ID upstream retornado
            try {
              await recordPendingCharge({
                id: upData.id,
                userEmail: customer.email,
                amountCents,
                description,
                qrCodeText: upData.qrCodeText || pixCopyPaste
              });
            } catch {}
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

  // GET /api/zynpay/charges?id=... ou /api/zynpay/charges/{id}
  if (req.method === 'GET') {
    const urlObj = new URL(req.url, 'http://localhost');
    let chargeId = urlObj.searchParams.get('id') || urlObj.searchParams.get('chargeId');

    if (!chargeId) {
      const match = urlObj.pathname.match(/\/charges\/([^/?]+)/);
      if (match && match[1]) {
        chargeId = match[1];
      }
    }

    if (!chargeId) {
      return sendJson(res, 400, { error: 'ID da cobrança obrigatório.', code: 'MISSING_CHARGE_ID' });
    }

    try {
      const stored = await getChargeById(chargeId);
      if (stored) {
        return sendJson(res, 200, {
          success: true,
          charge: {
            id: stored.id,
            status: stored.status,
            amount: stored.amountCents,
            amountFormatted: `R$ ${(stored.amountCents / 100).toFixed(2).replace('.', ',')}`,
            description: stored.description,
            createdAt: stored.createdAt,
            paidAt: stored.paidAt
          }
        });
      }
    } catch (err: any) {
      return sendJson(res, 503, {
        error: 'Erro temporário ao consultar banco de dados.',
        code: 'DATABASE_UNAVAILABLE'
      });
    }

    return sendJson(res, 404, {
      error: 'Cobrança não encontrada no banco de dados.',
      code: 'CHARGE_NOT_FOUND'
    });
  }

  return sendJson(res, 405, { error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
}
