/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Cryptographic verification helpers for webhook signatures and timing-safe equality
 */

import crypto from 'crypto';

/**
 * Compara duas strings em tempo constante para evitar ataques de timing side-channel
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Valida a assinatura HMAC SHA-256 de um webhook sobre o payload original
 */
export function verifyWebhookSignature(
  rawPayload: string | Buffer,
  providedSignature: string | null | undefined,
  secret: string
): boolean {
  if (!providedSignature || !secret) return false;

  try {
    // Normaliza assinatura (remove possíveis prefixos 'sha256=' ou 'v1=')
    const cleanSignature = providedSignature.replace(/^(sha256=|v1=)/i, '').trim();

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(typeof rawPayload === 'string' ? Buffer.from(rawPayload, 'utf-8') : rawPayload)
      .digest('hex');

    return safeCompare(cleanSignature.toLowerCase(), expectedSignature.toLowerCase());
  } catch {
    return false;
  }
}
