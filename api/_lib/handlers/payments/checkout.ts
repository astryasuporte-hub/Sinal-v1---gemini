/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Handler: POST /api/payments/checkout
 */

import { readJsonBody, sendJson, setCorsHeaders } from '../../common.js';
import { enforceRateLimit } from '../../rateLimiter.js';
import { checkoutService } from '../../payments/CheckoutService.js';
import { authenticatePaymentUser } from './authHelper.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Método não permitido. Utilize POST.' });
  }

  const allowed = await enforceRateLimit(req, res, 'payments');
  if (!allowed) {
    return;
  }

  const auth = await authenticatePaymentUser(req);
  if (!auth.ok) {
    return sendJson(res, auth.statusCode, { success: false, error: auth.error });
  }

  if (auth.user.isAdmin) {
    return sendJson(res, 409, {
      success: false,
      blocked: true,
      errorCode: 'ADMIN_EXEMPT_FROM_BILLING',
      error: 'Contas administrativas são isentas de cobrança.',
    });
  }

  const body = await readJsonBody(req);
  const requestedMethod = body?.paymentMethod || body?.payment_method || body?.method;
  const idempotencyKey = String(req.headers?.['x-idempotency-key'] || body?.idempotencyKey || '').trim() || undefined;
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 128 || !/^[a-zA-Z0-9_.:-]+$/.test(idempotencyKey))) {
    return sendJson(res, 400, {
      success: false,
      blocked: true,
      errorCode: 'INVALID_IDEMPOTENCY_KEY',
      error: 'Chave de idempotência inválida. Utilize entre 8 e 128 caracteres alfanuméricos.',
    });
  }
  const planId = String(body?.planId || 'pro').trim();

  try {
    // Nota de segurança: body.amount / body.amountCents / body.currency são rigorosamente ignorados.
    const { httpStatus, result } = await checkoutService.initiateCheckout({
      userId: auth.user.userId,
      userEmail: auth.user.email || '',
      userName: auth.user.fullName,
      planId,
      requestedMethod: requestedMethod ? String(requestedMethod) : undefined,
      idempotencyKey,
    });

    return sendJson(res, httpStatus, result);
  } catch (err: any) {
    return sendJson(res, 503, {
      success: false,
      blocked: true,
      errorCode: 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE',
      error: err?.message || 'Serviço de verificação financeira indisponível no momento.',
    });
  }
}
