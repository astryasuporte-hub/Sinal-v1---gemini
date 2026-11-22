/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Handler: POST & GET /api/payments/webhook
 *
 * Segurança:
 * - POST (Cakto -> Servidor): valida HMAC-SHA256 sobre rawBody/timestamp, janela anti-replay,
 *   product_id, offer_id, currency='BRL', amount=3490 e bloqueio explícito de métodos proibidos (pix/boleto/picpay).
 * - GET (Painel Admin): exige autorização administrativa estrita para inspecionar eventos recentes.
 */

import { readRawAndJsonBody, sendJson, setCorsHeaders } from '../../common.js';
import { getActivePaymentProviderId, getPaymentProvider } from '../../payments/PaymentProviderRegistry.js';
import { webhookVerificationService } from '../../payments/WebhookVerificationService.js';
import { billingEventProcessor } from '../../payments/BillingEventProcessor.js';
import { getPaymentsPersistence } from '../../payments/PaymentsStore.js';
import { authenticateFinancialAdmin } from './authHelper.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET') {
    const isAdmin = await authenticateFinancialAdmin(req);
    if (!isAdmin) {
      return sendJson(res, 401, { success: false, error: 'Acesso administrativo exigido.' });
    }
    const store = getPaymentsPersistence();
    const events = await store.listRecentWebhookEvents(20).catch(() => []);
    return sendJson(res, 200, { success: true, events });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Método não permitido. Utilize POST.' });
  }

  const { rawBody, body } = await readRawAndJsonBody(req);
  if (!rawBody || !body || typeof body !== 'object' || Object.keys(body).length === 0) {
    return sendJson(res, 400, {
      received: false,
      errorCode: 'INVALID_PAYLOAD',
      error: 'Payload JSON inválido ou vazio.',
    });
  }

  const provider = getPaymentProvider(getActivePaymentProviderId());
  const validation = webhookVerificationService.validateAndNormalize({
    provider,
    rawBody,
    body,
    headers: req.headers || {},
  });

  if (!validation.accepted || !validation.normalizedEvent) {
    return sendJson(res, validation.httpStatus, {
      received: false,
      accepted: false,
      errorCode: validation.errorCode,
      error: validation.reason,
    });
  }

  const outcome = await billingEventProcessor.processEvent(validation.normalizedEvent, {
    signatureValid: validation.signatureOutcome.valid,
    eventTimestamp: validation.signatureOutcome.timestampIso,
  });

  if (!outcome.success) {
    if (outcome.reconciliationRequired) {
      return sendJson(res, 202, {
        received: true,
        processed: false,
        reconciliationRequired: true,
        eventId: validation.normalizedEvent.providerEventId,
        errorCode: outcome.errorCode || 'RECONCILIATION_REQUIRED',
        error: outcome.error,
      });
    }
    return sendJson(res, 422, {
      received: true,
      processed: false,
      errorCode: outcome.errorCode,
      error: outcome.error,
    });
  }

  return sendJson(res, 200, {
    received: true,
    processed: outcome.processed,
    duplicate: Boolean(outcome.duplicate),
    eventId: validation.normalizedEvent.providerEventId,
    action: validation.normalizedEvent.canonicalAction,
    subscriptionStatus: outcome.resultingSubscriptionStatus,
  });
}
