/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Handler: GET /api/payments/status
 */

import { sendJson, setCorsHeaders } from '../../common.js';
import { getProPlanConfig } from '../../plans.js';
import { subscriptionService } from '../../payments/SubscriptionService.js';
import { authenticatePaymentUser } from './authHelper.js';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    return sendJson(res, 405, { success: false, error: 'Método não permitido. Utilize GET.' });
  }

  const auth = await authenticatePaymentUser(req);
  if (!auth.ok) {
    return sendJson(res, auth.statusCode, { success: false, error: auth.error });
  }

  const subscription = await subscriptionService.getUserSubscriptionStatus({
    userId: auth.user.userId,
    userEmail: auth.user.email,
    userCreatedAt: auth.user.createdAt,
    isAdmin: auth.user.isAdmin,
  });

  const plan = getProPlanConfig();

  return sendJson(res, 200, {
    success: true,
    subscription,
    plan: {
      id: plan.id,
      name: plan.name,
      amountCents: plan.amountCents,
      amountFormatted: plan.amountFormatted,
      currency: plan.currency,
      periodDays: plan.periodDays,
      saasTrialDays: plan.saasTrialDays,
      providerTrialDays: plan.providerTrialDays,
      provider: plan.provider,
      productId: plan.productId,
      offerId: plan.offerId,
      checkoutId: plan.checkoutId,
      allowedMethods: plan.allowedMethods,
      prohibitedMethods: plan.prohibitedMethods,
    },
  });
}
