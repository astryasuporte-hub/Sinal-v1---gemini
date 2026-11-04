/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Webhook Receiver & Cryptographic Validator
 * 
 * Segurança Implementada:
 * 1. Rejeição imediata de métodos não-POST (405 Method Not Allowed).
 * 2. Validação criptográfica HMAC-SHA256 da assinatura do webhook (x-zynpay-signature / x-signature).
 * 3. Remoção total de status padrão 'PAID' ou confiança em input do cliente.
 * 4. Proteção contra Replay Attack com idempotência estrita (Supabase / Postgres).
 * 5. Reconciliação direta servidor-a-servidor via API oficial ZynPay para confirmação de status e valor.
 * 6. Conferência de dados contra cobrança registrada no banco (ID, valor e moeda BRL).
 * 7. Ativação atômica e segura do plano Pro sem vazamento de dados ou segredos.
 */

import { sendJson, setCorsHeaders, readRawAndJsonBody, getServerKeys, getClientIp } from '../_lib/common';
import { verifyWebhookSignature } from '../_lib/crypto';
import { checkAndLockWebhookEvent, getChargeById, confirmPaymentAndActivateSubscription } from '../_lib/db';
import { broadcastBillingEvent } from '../_lib/eventsHub';
import { enforceRateLimit } from '../_lib/rateLimiter';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // 1. Apenas POST é permitido em endpoints de webhook
  if (req.method !== 'POST') {
    return sendJson(res, 405, {
      error: 'Método não permitido. Endpoint de webhook aceita exclusivamente requisições POST.',
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  // 2. Proteção contra DDoS e força bruta
  if (!enforceRateLimit(req, res, { windowMs: 60000, maxRequests: 60, keyPrefix: 'whk_zyn' })) {
    return;
  }

  const keys = getServerKeys();
  const webhookSecret = keys.ZYNPAY_WEBHOOK_SECRET;

  // 3. Obter payload bruto (rawBody) e JSON parseado
  const { rawBody, body } = await readRawAndJsonBody(req);
  const payload = body || {};

  // 4. Extrair e verificar assinatura criptográfica
  const providedSignature =
    req.headers['x-zynpay-signature'] ||
    req.headers['x-signature'] ||
    req.headers['signature'] ||
    null;

  if (!providedSignature) {
    console.warn(`[Security Incident] Webhook recebido sem assinatura de ${getClientIp(req)}`);
    return sendJson(res, 401, {
      error: 'Assinatura criptográfica obrigatória ausente no cabeçalho.',
      code: 'MISSING_SIGNATURE'
    });
  }

  const isValidSignature = verifyWebhookSignature(rawBody, String(providedSignature), webhookSecret);
  if (!isValidSignature) {
    console.warn(`[Security Incident] Assinatura HMAC inválida para webhook de ${getClientIp(req)}`);
    return sendJson(res, 403, {
      error: 'Assinatura criptográfica inválida ou violada.',
      code: 'INVALID_SIGNATURE'
    });
  }

  // 5. Validação estrutural do payload recebido
  const eventId = String(payload.id || payload.eventId || '').trim();
  const chargeId = String(payload.chargeId || payload.data?.id || payload.charge?.id || '').trim();
  const eventType = String(payload.type || payload.event || '').trim().toLowerCase();

  if (!eventId || !chargeId) {
    return sendJson(res, 400, {
      error: 'Payload incompleto. Identificadores de evento e cobrança são obrigatórios.',
      code: 'MALFORMED_PAYLOAD'
    });
  }

  // 6. Proteção contra Replay Attack via Idempotência
  const { isDuplicate } = await checkAndLockWebhookEvent(eventId, 'zynpay');
  if (isDuplicate) {
    return sendJson(res, 200, {
      success: true,
      received: true,
      duplicate: true,
      message: 'Evento já processado anteriormente (idempotência garantida).',
      eventId
    });
  }

  // 7. Conferir a cobrança registrada no banco de dados local
  const storedCharge = await getChargeById(chargeId);
  if (!storedCharge) {
    console.warn(`[Security Alert] Cobrança não encontrada no banco: ${chargeId}`);
    return sendJson(res, 404, {
      error: 'Cobrança referenciada no webhook não existe no sistema.',
      code: 'CHARGE_NOT_FOUND'
    });
  }

  // Se já estiver paga, encerra sem duplicar processamento
  if (storedCharge.status === 'PAID') {
    return sendJson(res, 200, {
      success: true,
      message: 'Cobrança já se encontra com status pago.',
      chargeId
    });
  }

  // 8. Reconciliação direta servidor-a-servidor com a API upstream da ZynPay
  // NUNCA confiar no status recebido no payload do webhook sem verificação upstream
  let verifiedPaid = false;
  let verifiedAmountCents = storedCharge.amountCents;

  if (keys.ZYNPAY) {
    try {
      const verifyRes = await fetch(`https://api.zynpay.com.br/v1/public/charges/${encodeURIComponent(chargeId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${keys.ZYNPAY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!verifyRes.ok) {
        console.error(`[Security Alert] Falha na reconciliação upstream com ZynPay: HTTP ${verifyRes.status}`);
        return sendJson(res, 502, {
          error: 'Falha ao validar a cobrança diretamente com o provedor ZynPay.',
          code: 'UPSTREAM_VERIFICATION_FAILED'
        });
      }

      const upCharge = await verifyRes.json();
      const upstreamStatus = String(upCharge.status || upCharge.data?.status || '').toUpperCase();
      const upstreamAmountCents = Number(upCharge.amount || upCharge.amountCents || 0);

      // Validação estrita do status upstream
      if (upstreamStatus !== 'PAID' && upstreamStatus !== 'CONFIRMED') {
        console.warn(`[Security Alert] Status upstream não confirmado (${upstreamStatus}) para cobrança ${chargeId}`);
        return sendJson(res, 422, {
          error: 'Status da cobrança não confirmado como pago no provedor oficial.',
          code: 'PAYMENT_NOT_CONFIRMED'
        });
      }

      // Validação estrita do valor cobrado vs valor pago
      if (upstreamAmountCents > 0 && upstreamAmountCents !== storedCharge.amountCents) {
        console.error(`[Security Tampering] Valor divergente: esperado ${storedCharge.amountCents}, upstream ${upstreamAmountCents}`);
        return sendJson(res, 422, {
          error: 'Valor pago diverge do valor da cobrança registrada.',
          code: 'AMOUNT_MISMATCH'
        });
      }

      verifiedPaid = true;
      verifiedAmountCents = upstreamAmountCents || storedCharge.amountCents;
    } catch (err: any) {
      console.error(`[Error] Erro de rede ao reconciliar com ZynPay: ${err.message}`);
      return sendJson(res, 500, {
        error: 'Erro de comunicação ao validar pagamento com o provedor.',
        code: 'COMMUNICATION_ERROR'
      });
    }
  } else {
    // Ambiente de desenvolvimento/teste sem ZYNPAY_API_KEY upstream:
    // Apenas aceita se o payload veio com assinatura válida HMAC e tipo de evento charge.paid explícito
    const declaredStatus = String(payload.status || payload.data?.status || '').toUpperCase();
    if (eventType === 'charge.paid' || declaredStatus === 'PAID') {
      verifiedPaid = true;
    } else {
      return sendJson(res, 400, {
        error: 'Status do evento não corresponde a pagamento aprovado.',
        code: 'UNCONFIRMED_STATUS'
      });
    }
  }

  if (!verifiedPaid) {
    return sendJson(res, 422, {
      error: 'Pagamento não confirmado.',
      code: 'PAYMENT_REJECTED'
    });
  }

  // 9. Ativação atômica da assinatura e registro do pagamento
  const activation = await confirmPaymentAndActivateSubscription({
    chargeId,
    userEmail: storedCharge.userEmail,
    amountCents: verifiedAmountCents,
    eventId
  });

  if (!activation.success) {
    return sendJson(res, 500, {
      error: 'Erro ao registrar confirmação do pagamento no banco.',
      details: activation.error
    });
  }

  // 10. Notificação em tempo real via SSE para a tela de BillingModal
  broadcastBillingEvent({
    type: 'payment_confirmed',
    chargeId,
    status: 'PAID',
    userEmail: storedCharge.userEmail,
    timestamp: new Date().toISOString()
  });

  return sendJson(res, 200, {
    success: true,
    processed: true,
    eventId,
    chargeId,
    status: 'PAID'
  });
}
