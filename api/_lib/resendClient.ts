/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR V2.4.1 — Hardened Resend Client & Webhook Signature Verifier
 *
 * Recursos:
 * - Remetente verificado padrão: 'FatosBR Briefings <briefings@fatosbr.com.br>' via RESEND_FROM_EMAIL
 * - Idempotency-Key obrigatório para briefings
 * - AbortController timeout por tentativa
 * - Retries limitados apenas em 429 / 5xx / timeout / erro de rede
 * - Verificação HMAC-SHA256 de webhooks Resend (Svix v1 + header direto)
 */

import crypto from 'node:crypto';
import { safeCompare } from './crypto.js';

export const DEFAULT_VERIFIED_RESEND_FROM = 'FatosBR Briefings <briefings@fatosbr.com.br>';

export function getResendFromEmail(): string {
  const configured = String(process.env.RESEND_FROM_EMAIL || '').trim();
  return configured || DEFAULT_VERIFIED_RESEND_FROM;
}

export function buildBriefingEmailIdempotencyKey(
  briefingId: string,
  editionType: string,
  localDate?: string | null
): string {
  const datePart = localDate || 'slot';
  return `fatosbr-briefing:${String(editionType || 'MORNING').toUpperCase()}:${datePart}:${briefingId}`;
}

export interface SendResendEmailParams {
  apiKey: string;
  from?: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayBaseMs?: number;
  fetchFn?: typeof fetch;
}

export interface SendResendEmailResult {
  ok: boolean;
  accepted: boolean;
  messageId?: string;
  statusCode: number;
  retryable: boolean;
  attemptsMade: number;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

export async function sendResendEmailWithRetry(
  params: SendResendEmailParams
): Promise<SendResendEmailResult> {
  const fetchFn = params.fetchFn || fetch;
  const from = (params.from || '').trim() || getResendFromEmail();
  const timeoutMs = Math.max(1000, Number(params.timeoutMs ?? 10_000));
  const maxAttempts = Math.max(1, Math.min(5, Number(params.maxAttempts ?? 3)));
  const retryDelayBaseMs = Math.max(0, Number(params.retryDelayBaseMs ?? 350));

  let lastStatus = 0;
  let lastError = '';
  let lastRetryable = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      };
      if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
      }

      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          from,
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: params.text,
        }),
      });

      clearTimeout(timer);
      lastStatus = res.status;
      const bodyJson = await res.json().catch(() => ({} as any));

      if (res.ok) {
        return {
          ok: true,
          accepted: true,
          messageId: bodyJson?.id ? String(bodyJson.id) : undefined,
          statusCode: res.status,
          retryable: false,
          attemptsMade: attempt,
        };
      }

      lastError = String(bodyJson?.message || bodyJson?.error || `Resend HTTP ${res.status}`);
      lastRetryable = isRetryableStatus(res.status);

      if (!lastRetryable || attempt >= maxAttempts) {
        return {
          ok: false,
          accepted: false,
          statusCode: res.status,
          retryable: lastRetryable,
          attemptsMade: attempt,
          error: lastError,
        };
      }

      const retryAfterSec = Number(res.headers?.get?.('retry-after') || 0);
      const backoffMs =
        retryAfterSec > 0 && retryAfterSec <= 5
          ? retryAfterSec * 1000
          : retryDelayBaseMs * Math.pow(2, attempt - 1);
      await sleep(backoffMs);
    } catch (err: any) {
      clearTimeout(timer);
      lastStatus = err?.name === 'AbortError' ? 504 : 0;
      lastRetryable = true;
      lastError =
        err?.name === 'AbortError'
          ? `Resend request timeout after ${timeoutMs}ms`
          : String(err?.message || 'Erro de rede ao contatar Resend');

      if (attempt >= maxAttempts) {
        return {
          ok: false,
          accepted: false,
          statusCode: lastStatus,
          retryable: true,
          attemptsMade: attempt,
          error: lastError,
        };
      }

      await sleep(retryDelayBaseMs * Math.pow(2, attempt - 1));
    }
  }

  return {
    ok: false,
    accepted: false,
    statusCode: lastStatus,
    retryable: lastRetryable,
    attemptsMade: maxAttempts,
    error: lastError || 'Falha desconhecida no Resend',
  };
}

function getHeaderCaseInsensitive(headers: Record<string, any> | undefined, name: string): string {
  if (!headers) return '';
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && v !== undefined && v !== null) {
      return Array.isArray(v) ? String(v[0] || '') : String(v);
    }
  }
  return '';
}

function decodeWebhookSecretKey(secret: string): Buffer {
  const trimmed = secret.trim();
  if (trimmed.startsWith('whsec_')) {
    return Buffer.from(trimmed.slice(6), 'base64');
  }
  return Buffer.from(trimmed, 'utf8');
}

export function verifyResendWebhookSignature(params: {
  rawBody: string;
  headers: Record<string, any>;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): { valid: boolean; reason?: string; svixId?: string; timestampSec?: number } {
  const secret = String(params.secret || '').trim();
  if (!secret) {
    return { valid: false, reason: 'RESEND_WEBHOOK_SECRET não configurado' };
  }

  const svixId = getHeaderCaseInsensitive(params.headers, 'svix-id').trim();
  const svixTs = getHeaderCaseInsensitive(params.headers, 'svix-timestamp').trim();
  const svixSig = getHeaderCaseInsensitive(params.headers, 'svix-signature').trim();

  if (!svixId || !svixTs || !svixSig) {
    return {
      valid: false,
      reason: 'Cabeçalhos oficiais Svix (svix-id, svix-timestamp, svix-signature) ausentes',
    };
  }

  if (svixId.length > 256 || /\s/.test(svixId)) {
    return { valid: false, reason: 'Cabeçalho svix-id inválido' };
  }

  if (!/^\d{1,12}$/.test(svixTs)) {
    return { valid: false, reason: 'Timestamp Svix inválido (esperado inteiro Unix em segundos)' };
  }

  const tsNum = Number.parseInt(svixTs, 10);
  if (!Number.isSafeInteger(tsNum) || tsNum <= 0) {
    return { valid: false, reason: 'Timestamp Svix inválido' };
  }

  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  const tolerance = Math.max(1, Number(params.toleranceSeconds ?? 300));
  if (Math.abs(nowSec - tsNum) > tolerance) {
    return { valid: false, reason: 'Timestamp Svix fora da janela permitida' };
  }

  const key = decodeWebhookSecretKey(secret);
  if (key.length === 0) {
    return { valid: false, reason: 'RESEND_WEBHOOK_SECRET inválido (chave decodificada vazia)' };
  }

  const signedContent = `${svixId}.${svixTs}.${params.rawBody}`;
  const expectedSig = crypto.createHmac('sha256', key).update(signedContent).digest('base64');

  const candidates = svixSig
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const [version, sigVal] = candidate.split(',', 2);
    if (version === 'v1' && sigVal && safeCompare(sigVal, expectedSig)) {
      return { valid: true, svixId, timestampSec: tsNum };
    }
  }

  return { valid: false, reason: 'Assinatura Svix inválida' };
}
