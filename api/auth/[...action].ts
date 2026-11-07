/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Authentication Consolidated Domain Router
 * Consolidates OTP send and verify endpoints into a single Serverless Function to comply with Hobby plan limits.
 */

import { sendJson, setCorsHeaders } from '../_lib/common';
import sendOtpHandler from '../_lib/handlers/auth/sendOtp';
import verifyOtpHandler from '../_lib/handlers/auth/verifyOtp';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  if (pathname.includes('/send-otp')) {
    return sendOtpHandler(req, res);
  }
  if (pathname.includes('/verify-otp')) {
    return verifyOtpHandler(req, res);
  }

  return sendJson(res, 404, {
    error: 'ENDPOINT_NOT_FOUND',
    message: `Endpoint de Autenticação não encontrado: ${pathname}`
  });
}
