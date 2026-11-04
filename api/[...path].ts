/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Catch-All API Router
 * Ensures any /api/* request is handled by a proper JSON API function and NEVER rewritten to index.html
 */

import { sendJson, setCorsHeaders } from './_lib/common';
import gnewsHandler from './proxy/gnews';
import newsapiHandler from './proxy/newsapi';
import worldnewsHandler from './proxy/worldnews';
import nvidiaChatHandler from './proxy/nvidia/chat';
import statusHandler from './proxy/status';
import resendStatusHandler from './resend/status';
import resendSendHandler from './resend/send';
import resendTicketHandler from './resend/ticket';
import resendWebhookHandler from './resend/webhook';
import zynpayBalanceHandler from './zynpay/balance';
import zynpayChargesHandler from './zynpay/charges';
import zynpayConfigHandler from './zynpay/config';
import zynpayEventsHandler from './zynpay/events';
import zynpayWebhookHandler from './zynpay/webhook';
import notificationsSubscribeHandler from './notifications/subscribe';
import notificationsBroadcastHandler from './notifications/broadcast-push';
import authSendOtpHandler from './auth/send-otp';
import authVerifyOtpHandler from './auth/verify-otp';
import avatarVerifyHandler from './avatar/verify';
import companyLogoHandler from './admin/company-logo';
import instagramHandler from './instagram/[...action]';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  // News Proxy Routes
  if (pathname.startsWith('/api/proxy/gnews')) return gnewsHandler(req, res);
  if (pathname.startsWith('/api/proxy/newsapi')) return newsapiHandler(req, res);
  if (pathname.startsWith('/api/proxy/worldnews')) return worldnewsHandler(req, res);
  if (pathname.startsWith('/api/proxy/nvidia/chat')) return nvidiaChatHandler(req, res);
  if (pathname.startsWith('/api/proxy/status')) return statusHandler(req, res);

  // Resend Routes
  if (pathname.startsWith('/api/resend/status')) return resendStatusHandler(req, res);
  if (pathname.startsWith('/api/resend/send')) return resendSendHandler(req, res);
  if (pathname.startsWith('/api/resend/ticket')) return resendTicketHandler(req, res);
  if (pathname.startsWith('/api/resend/webhook')) return resendWebhookHandler(req, res);

  // ZynPay Routes
  if (pathname.startsWith('/api/zynpay/balance')) return zynpayBalanceHandler(req, res);
  if (pathname.startsWith('/api/zynpay/charges')) return zynpayChargesHandler(req, res);
  if (pathname.startsWith('/api/zynpay/config')) return zynpayConfigHandler(req, res);
  if (pathname.startsWith('/api/zynpay/events')) return zynpayEventsHandler(req, res);
  if (pathname.startsWith('/api/zynpay/webhook')) return zynpayWebhookHandler(req, res);

  // Notification Routes
  if (pathname.startsWith('/api/notifications/subscribe')) return notificationsSubscribeHandler(req, res);
  if (pathname.startsWith('/api/notifications/broadcast-push')) return notificationsBroadcastHandler(req, res);

  // Auth Routes
  if (pathname.startsWith('/api/auth/send-otp')) return authSendOtpHandler(req, res);
  if (pathname.startsWith('/api/auth/verify-otp')) return authVerifyOtpHandler(req, res);

  // Media & Admin Routes
  if (pathname.startsWith('/api/avatar/verify')) return avatarVerifyHandler(req, res);
  if (pathname.startsWith('/api/admin/company-logo')) return companyLogoHandler(req, res);
  if (pathname.startsWith('/api/instagram')) return instagramHandler(req, res);

  return sendJson(res, 404, {
    error: `Endpoint não encontrado: ${pathname}`,
    availableEndpoints: [
      '/api/proxy/gnews',
      '/api/proxy/newsapi',
      '/api/proxy/worldnews',
      '/api/proxy/nvidia/chat',
      '/api/proxy/status',
      '/api/resend/status',
      '/api/resend/send',
      '/api/resend/ticket',
      '/api/zynpay/balance',
      '/api/zynpay/charges',
      '/api/zynpay/config',
      '/api/zynpay/events',
      '/api/zynpay/webhook'
    ]
  });
}
