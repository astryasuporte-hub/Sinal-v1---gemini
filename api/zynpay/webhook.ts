/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Webhook Receiver & Cryptographic Validator
 * 
 * Arquitetura de Segurança:
 * 1. Restrição estrita de método HTTP (exclusivamente POST, 405 para outros).
 * 2. Rate limiting distribuído e atômico no PostgreSQL com perfil 'webhooks'.
 * 3. Validação criptográfica HMAC-SHA256 sobre payload bruto (x-zynpay-signature / x-signature).
 * 4. Proteção contra Replay Attack com trava de idempotência atômica no banco.
 * 5. Reconciliação direta servidor-a-servidor com API oficial ZynPay.
 * 6. Falha segura: Se a validação upstream ou assinatura não puderem ser confirmadas, a confirmação automática permanece desabilitada.
 * 7. Execução de confirmação e ativação Pro via RPC atômico PostgreSQL (SELECT ... FOR UPDATE).
 */

import { sendJson, setCorsHeaders, readRawAndJsonBody, getServerKeys, getClientIp } from '../_lib/common';
import { verifyWebhookSignature } from '../_lib/crypto';
import { checkAndLockWebhookEvent, getChargeById, confirmPaymentAndActivateSubscriptionAtomic } from '../_lib/db';
import { fetchChargeFromGateway } from '../_lib/zynpayClient';
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
      error: 'Método não permitido. O endpoint de webhook aceita exclusivamente requisições POST.',
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  // 2. Rate Limiting atômico distribuído
  const rateLimitAllowed = await enforceRateLimit(req, res, 'webhooks');
  if (!rateLimitAllowed) {
    return;
  }

  const keys = getServerKeys();
  const webhookSecret = keys.ZYNPAY_WEBHOOK_SECRET;

  // 3. Obter payload bruto (rawBody) e JSON parseado
  const { rawBody, body } = await readRawAndJsonBody(req);
  const payload = body || {};

  // 4. Extração e validação da assinatura criptográfica HMAC oficial da ZynPay
  // Documentação oficial: header 'x-zinpay-signature' (ou 'x-zynpay-signature')
  const providedSignature =
    req.headers['x-zinpay-signature'] ||
    req.headers['x-zynpay-signature'] ||
    null;

  if (!providedSignature) {
    console.warn(`[Security Incident] Webhook recebido sem assinatura criptográfica de ${getClientIp(req)}`);
    return sendJson(res, 401, {
      error: 'Assinatura criptográfica obrigatória ausente no cabeçalho do webhook (x-zinpay-signature).',
      code: 'MISSING_SIGNATURE'
    });
  }

  if (!webhookSecret) {
    console.error('[Security Configuration] ZYNPAY_WEBHOOK_SECRET não configurado no ambiente.');
    return sendJson(res, 503, {
      error: 'Serviço de webhooks em manutenção de segurança. Segredo de validação não configurado.',
      code: 'WEBHOOK_SECRET_UNCONFIGURED'
    });
  }

  const isValidSignature = verifyWebhookSignature(rawBody, String(providedSignature), webhookSecret);
  if (!isValidSignature) {
    console.warn(`[Security Incident] Assinatura HMAC inválida para webhook de ${getClientIp(req)}`);
    return sendJson(res, 403, {
      error: 'Assinatura criptográfica inválida ou payload adulterado.',
      code: 'INVALID_SIGNATURE'
    });
  }

  // 5. Validação estrutural do payload conforme contrato oficial da ZynPay
  const eventType = String(payload.event || payload.type || '').trim().toLowerCase();
  const eventId = String(payload.id || payload.eventId || payload.data?.event_id || payload.data?.id || '').trim();
  const chargeId = String(payload.data?.charge_id || payload.data?.id || payload.chargeId || payload.id || '').trim();

  if (!eventId || !chargeId) {
    return sendJson(res, 400, {
      error: 'Payload incompleto. Identificadores de evento e cobrança são obrigatórios.',
      code: 'MALFORMED_PAYLOAD'
    });
  }

  // Filtra eventos que não representam liquidação de Pix
  if (eventType && eventType !== 'pix.charge.paid' && eventType !== 'charge.paid') {
    return sendJson(res, 200, {
      success: true,
      received: true,
      ignored: true,
      message: `Evento '${eventType}' recebido e ignorado (não representa liquidação Pix).`
    });
  }

  // 6. Trava de Idempotência Atômica no PostgreSQL
  try {
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
  } catch (err: any) {
    return sendJson(res, 503, {
      error: 'Falha temporária ao registrar idempotência no banco de dados.',
      code: 'DATABASE_LOCK_FAILED'
    });
  }

  // 7. Validação da cobrança registrada no banco
  let storedCharge = null;
  try {
    storedCharge = await getChargeById(chargeId);
  } catch (err: any) {
    return sendJson(res, 503, {
      error: 'Falha ao consultar cobrança no banco de dados.',
      code: 'DATABASE_QUERY_FAILED'
    });
  }

  if (!storedCharge) {
    console.warn(`[Security Alert] Cobrança não encontrada no banco: ${chargeId}`);
    return sendJson(res, 404, {
      error: 'Cobrança referenciada no webhook não existe no sistema.',
      code: 'CHARGE_NOT_FOUND'
    });
  }

  if (storedCharge.status === 'PAID') {
    return sendJson(res, 200, {
      success: true,
      message: 'Cobrança já confirmada anteriormente.',
      chargeId
    });
  }

  // 8. Reconciliação direta servidor-a-servidor com a API da ZynPay
  // Regra de segurança: Se a validação não puder ser concluída, manter confirmação automática desabilitada
  let verifiedAmountCents = storedCharge.amountCents;

  try {
    const upCharge = await fetchChargeFromGateway(chargeId);
    if (!upCharge) {
      console.warn(`[Security Alert] Cobrança não encontrada na ZynPay oficial: ${chargeId}`);
      return sendJson(res, 404, {
        error: 'Cobrança não localizada no provedor oficial ZynPay.',
        code: 'UPSTREAM_CHARGE_NOT_FOUND'
      });
    }

    if (upCharge.status !== 'PAID') {
      console.warn(`[Security Alert] Status upstream não confirmado (${upCharge.status}) para cobrança ${chargeId}`);
      return sendJson(res, 422, {
        error: 'Status da cobrança não confirmado como pago no provedor oficial.',
        code: 'PAYMENT_NOT_CONFIRMED'
      });
    }

    if (upCharge.amount > 0 && upCharge.amount !== storedCharge.amountCents) {
      console.error(`[Security Tampering] Valor divergente: esperado ${storedCharge.amountCents}, upstream ${upCharge.amount}`);
      return sendJson(res, 422, {
        error: 'Valor pago diverge do valor registrado na cobrança.',
        code: 'AMOUNT_MISMATCH'
      });
    }

    verifiedAmountCents = upCharge.amount || storedCharge.amountCents;
  } catch (err: any) {
    if (err.message?.includes('GATEWAY_UNCONFIGURED')) {
      console.warn('[Security Notice] ZYNPAY_API_KEY ausente. Confirmação automática mantida desabilitada.');
      return sendJson(res, 422, {
        error: 'Validação upstream desabilitada. Cobrança registrada para conciliação manual.',
        code: 'AUTOMATIC_CONFIRMATION_DISABLED'
      });
    }
    console.error(`[Network Error] Falha de comunicação com API ZynPay: ${err.message}`);
    return sendJson(res, 503, {
      error: 'Erro de comunicação ao validar pagamento com o provedor.',
      code: 'COMMUNICATION_ERROR'
    });
  }

  // 9. Confirmação Atômica e Ativação Pro via RPC PostgreSQL
  try {
    const result = await confirmPaymentAndActivateSubscriptionAtomic({
      chargeId,
      eventId,
      expectedAmountCents: verifiedAmountCents,
      expectedCurrency: 'BRL',
      provider: 'zynpay',
      rawPayload: payload
    });

    if (!result.success) {
      return sendJson(res, 422, {
        error: result.error || 'Falha ao confirmar transação no banco.',
        code: result.errorCode || 'TRANSACTION_REJECTED'
      });
    }

    // 10. Notificação instantânea via SSE para clientes conectados
    broadcastBillingEvent({
      type: 'PAYMENT_CONFIRMED',
      chargeId,
      status: 'PAID',
      userEmail: storedCharge.userEmail,
      amountCents: verifiedAmountCents,
      timestamp: new Date().toISOString()
    });

    return sendJson(res, 200, {
      success: true,
      processed: true,
      eventId,
      chargeId,
      status: 'PAID'
    });
  } catch (err: any) {
    console.error('[Transaction Error] Erro crítico na transação atômica:', err.message);
    return sendJson(res, 500, {
      error: 'Erro transacional ao confirmar pagamento e ativar assinatura.',
      code: 'TRANSACTION_ROLLBACK',
      details: err.message
    });
  }
}
