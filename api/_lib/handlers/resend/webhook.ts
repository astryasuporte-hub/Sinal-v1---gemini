/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vercel Serverless Function: Resend Webhooks Handler (Hardened V2.4.1)
 *
 * - POST: Valida assinatura criptográfica Svix/HMAC (RESEND_WEBHOOK_SECRET) e
 *   atualiza o estado durável em internal.briefing_email_deliveries
 *   (DELIVERED | BOUNCED | COMPLAINED | FAILED | DELAYED).
 * - GET: Restrito a administradores autenticados (sem exposição de e-mails PII).
 */

import { sendJson, setCorsHeaders } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { executeSql, isPostgresConfigured } from '../../postgres.js';
import { getServerSupabase } from '../../db.js';
import { verifyResendWebhookSignature } from '../../resendClient.js';

interface WebhookDeps {
  verifyAdminRequest: typeof verifyAdminRequest;
  isPostgresConfigured: typeof isPostgresConfigured;
  executeSql: typeof executeSql;
  getServerSupabase: typeof getServerSupabase;
}

let customWebhookDeps: WebhookDeps | null = null;

export function setResendWebhookTestDeps(deps: Partial<WebhookDeps> | null): void {
  if (!deps) {
    customWebhookDeps = null;
    return;
  }
  customWebhookDeps = {
    verifyAdminRequest: deps.verifyAdminRequest || verifyAdminRequest,
    isPostgresConfigured: deps.isPostgresConfigured || isPostgresConfigured,
    executeSql: deps.executeSql || executeSql,
    getServerSupabase: deps.getServerSupabase || getServerSupabase,
  };
}

function getDeps(): WebhookDeps {
  return (
    customWebhookDeps || {
      verifyAdminRequest,
      isPostgresConfigured,
      executeSql,
      getServerSupabase,
    }
  );
}

const recentWebhookEvents: Array<{
  id: string;
  type: string;
  providerMessageId: string | null;
  deliveryUpdated: boolean;
  timestamp: string;
}> = [];

async function readRawRequestBody(req: any): Promise<string> {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const deps = getDeps();

  if (req.method === 'POST') {
    const secret = String(process.env.RESEND_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      return sendJson(res, 503, {
        success: false,
        error: 'RESEND_WEBHOOK_SECRET_UNCONFIGURED',
        message: 'Segredo de validação do webhook Resend não configurado no servidor.',
      });
    }

    const rawBody = await readRawRequestBody(req);
    const sigCheck = verifyResendWebhookSignature({
      rawBody,
      headers: req.headers || {},
      secret,
    });

    if (!sigCheck.valid) {
      return sendJson(res, 401, {
        success: false,
        error: 'INVALID_WEBHOOK_SIGNATURE',
        message: sigCheck.reason || 'Assinatura de webhook inválida.',
      });
    }

    let payload: any = {};
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return sendJson(res, 400, {
        success: false,
        error: 'INVALID_JSON_PAYLOAD',
        message: 'Payload JSON inválido.',
      });
    }

    const eventType = String(payload.type || payload.event || '').trim().toLowerCase();
    const providerMessageId = String(
      payload?.data?.email_id || payload?.email_id || payload?.data?.id || ''
    ).trim();

    let deliveryResult: any = { updated: false };
    if (providerMessageId && eventType) {
      if (deps.isPostgresConfigured()) {
        try {
          const pgRes = await deps.executeSql(
            `SELECT public.apply_resend_webhook_event($1, $2, $3::jsonb) AS result`,
            [providerMessageId, eventType, JSON.stringify({ type: eventType, created_at: payload?.created_at || null })]
          );
          deliveryResult = pgRes?.rows?.[0]?.result || deliveryResult;
        } catch (err: any) {
          console.warn('[Resend Webhook] Erro ao persistir evento via PG:', err?.message);
        }
      } else {
        try {
          const sb = deps.getServerSupabase() as any;
          if (sb && typeof sb.rpc === 'function') {
            const rpcRes = await sb.rpc('apply_resend_webhook_event', {
              p_provider_message_id: providerMessageId,
              p_event_type: eventType,
              p_payload: { type: eventType, created_at: payload?.created_at || null },
            });
            if (!rpcRes?.error && rpcRes?.data) {
              deliveryResult = rpcRes.data;
            }
          }
        } catch (err: any) {
          console.warn('[Resend Webhook] Erro ao persistir evento via RPC:', err?.message);
        }
      }
    }

    const webhookItem = {
      id: String(payload?.id || payload?.data?.email_id || `evt_${Date.now()}`),
      type: eventType || 'unknown',
      providerMessageId: providerMessageId || null,
      deliveryUpdated: Boolean(deliveryResult?.updated),
      timestamp: String(payload?.created_at || new Date().toISOString()),
    };

    recentWebhookEvents.unshift(webhookItem);
    if (recentWebhookEvents.length > 50) recentWebhookEvents.pop();

    return sendJson(res, 200, {
      success: true,
      received: true,
      eventId: webhookItem.id,
      deliveryUpdated: webhookItem.deliveryUpdated,
      deliveryStatus: deliveryResult?.status || null,
    });
  }

  // GET: Restrito a administradores autenticados (sem exposição de e-mails ou PII)
  const authorized = await deps.verifyAdminRequest(req);
  if (!authorized) {
    return sendJson(res, 401, {
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Acesso restrito a administradores autenticados.',
    });
  }

  return sendJson(res, 200, {
    ok: true,
    provider: 'Resend Webhooks',
    recentEvents: recentWebhookEvents,
  });
}
