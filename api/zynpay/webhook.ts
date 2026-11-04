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

  // 4. Extração e validação da assinatura criptográfica HMAC
  const providedSignature =
    req.headers['x-zynpay-signature'] ||
    req.headers['x-signature'] ||
    req.headers['x-hub-signature'] ||
    req.headers['signature'] ||
    null;

  if (!providedSignature) {
    console.warn(`[Security Incident] Webhook recebido sem assinatura criptográfica de ${getClientIp(req)}`);
    return sendJson(res, 401, {
      error: 'Assinatura criptográfica obrigatória ausente no cabeçalho do webhook.',
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

  // 5. Validação estrutural do payload
  const eventId = String(payload.id || payload.eventId || '').trim();
  const chargeId = String(payload.chargeId || payload.data?.id || payload.charge?.id || '').trim();
  const eventType = String(payload.type || payload.event || '').trim().toLowerCase();

  if (!eventId || !chargeId) {
    return sendJson(res, 400, {
      error: 'Payload incompleto. Identificadores de evento (id) e cobrança (chargeId) são obrigatórios.',
      code: 'MALFORMED_PAYLOAD'
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
        console.error(`[Security Alert] Reconciliação upstream com ZynPay retornou status HTTP ${verifyRes.status}`);
        return sendJson(res, 502, {
          error: 'Falha ao validar a cobrança diretamente com o provedor ZynPay.',
          code: 'UPSTREAM_VERIFICATION_FAILED'
        });
      }

      const upCharge = await verifyRes.json();
      const upstreamStatus = String(upCharge.status || upCharge.data?.status || '').toUpperCase();
      const upstreamAmountCents = Number(upCharge.amount || upCharge.amountCents || 0);

      if (upstreamStatus !== 'PAID' && upstreamStatus !== 'CONFIRMED') {
        console.warn(`[Security Alert] Status upstream não confirmado (${upstreamStatus}) para cobrança ${chargeId}`);
        return sendJson(res, 422, {
          error: 'Status da cobrança não confirmado como pago no provedor oficial.',
          code: 'PAYMENT_NOT_CONFIRMED'
        });
      }

      if (upstreamAmountCents > 0 && upstreamAmountCents !== storedCharge.amountCents) {
        console.error(`[Security Tampering] Valor divergente: esperado ${storedCharge.amountCents}, upstream ${upstreamAmountCents}`);
        return sendJson(res, 422, {
          error: 'Valor pago diverge do valor registrado na cobrança.',
          code: 'AMOUNT_MISMATCH'
        });
      }

      verifiedAmountCents = upstreamAmountCents || storedCharge.amountCents;
    } catch (err: any) {
      console.error(`[Network Error] Falha de comunicação com API ZynPay: ${err.message}`);
      return sendJson(res, 503, {
        error: 'Erro de comunicação ao validar pagamento com o provedor.',
        code: 'COMMUNICATION_ERROR'
      });
    }
  } else {
    // Caso ZYNPAY_API_KEY não esteja configurada no ambiente:
    // Conforme especificação: "Se a validação não puder ser concluída, manter a confirmação automática desabilitada."
    console.warn('[Security Notice] ZYNPAY_API_KEY ausente. Confirmação automática mantida desabilitada.');
    return sendJson(res, 422, {
      error: 'Validação upstream desabilitada. Cobrança registrada para conciliação manual.',
      code: 'AUTOMATIC_CONFIRMATION_DISABLED'
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
