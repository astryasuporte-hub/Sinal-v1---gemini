/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Handler: GET /api/payments/history
 */

import { sendJson, setCorsHeaders } from '../../common.js';
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

  const history = await subscriptionService.getUserBillingHistory(auth.user.userId).catch(() => []);
  return sendJson(res, 200, {
    success: true,
    history,
  });
}
