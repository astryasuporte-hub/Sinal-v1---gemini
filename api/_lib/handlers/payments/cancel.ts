/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Handler: POST /api/payments/cancel
 */

import { sendJson, setCorsHeaders } from '../../common.js';
import { subscriptionService, SubscriptionVerificationUnavailableError } from '../../payments/SubscriptionService.js';
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

  const auth = await authenticatePaymentUser(req);
  if (!auth.ok) {
    return sendJson(res, auth.statusCode, { success: false, error: auth.error });
  }

  try {
    const result = await subscriptionService.cancelUserSubscription(auth.user.userId);
    if (!result.success) {
      return sendJson(res, result.error === 'SUBSCRIPTION_NOT_FOUND' ? 404 : 502, result);
    }

    const subscription = await subscriptionService.getUserSubscriptionStatus({
      userId: auth.user.userId,
      userEmail: auth.user.email,
      userCreatedAt: auth.user.createdAt,
      isAdmin: auth.user.isAdmin,
    });

    return sendJson(res, 200, {
      ...result,
      subscription,
    });
  } catch (err: any) {
    const isUnavailable =
      err instanceof SubscriptionVerificationUnavailableError ||
      err?.code === 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE' ||
      String(err?.message || '').includes('POSTGRES_UNAVAILABLE');
    return sendJson(res, isUnavailable ? 503 : 500, {
      success: false,
      errorCode: isUnavailable ? 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE' : 'SUBSCRIPTION_CANCEL_ERROR',
      error: err?.message || 'Falha ao cancelar assinatura.',
    });
  }
}
