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

import crypto from 'node:crypto';
import { sendJson, setCorsHeaders } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { executeSql, isPostgresConfigured } from '../../postgres.js';
import { getServerSupabase } from '../../db.js';
import { acquireDistributedLeaseLock, DistributedLockHandle } from '../../distributedLock.js';
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

const REPLAY_TTL_MS = 310_000;
const MAX_REPLAY_CACHE_SIZE = 2000;
const processedSvixEvents = new Map<string, number>();

export function clearResendWebhookReplayCache(): void {
  processedSvixEvents.clear();
}

function pruneReplayCache(nowMs: number): void {
  for (const [key, expiresAt] of processedSvixEvents.entries()) {
    if (expiresAt <= nowMs) {
      processedSvixEvents.delete(key);
    }
  }
  while (processedSvixEvents.size > MAX_REPLAY_CACHE_SIZE) {
    const oldestKey = processedSvixEvents.keys().next().value;
    if (!oldestKey) break;
    processedSvixEvents.delete(oldestKey);
  }
}

function isSvixIdInMemoryCache(svixId: string, nowMs = Date.now()): boolean {
  const expiresAt = processedSvixEvents.get(svixId);
  if (!expiresAt) return false;
  if (expiresAt <= nowMs) {
    processedSvixEvents.delete(svixId);
    return false;
  }
  return true;
}

function markSvixIdInMemoryCache(svixId: string, nowMs = Date.now()): void {
  pruneReplayCache(nowMs);
  processedSvixEvents.set(svixId, nowMs + REPLAY_TTL_MS);
}

function buildSvixReplayLockKey(svixId: string): string {
  const direct = `resend:svix:${svixId}`;
  if (direct.length <= 200) return direct;
  const hash = crypto.createHash('sha256').update(svixId).digest('hex');
  return `resend:svix:sha256:${hash}`;
}

const recentWebhookEvents: Array<{
  id: string;
  svixId: string;
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

function isKnownEmailDeliveryEvent(eventType: string): boolean {
  return (
    eventType.startsWith('email.') ||
    ['delivered', 'bounced', 'complained', 'failed', 'delayed'].includes(eventType)
  );
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
        retryable: true,
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

    if (!sigCheck.valid || !sigCheck.svixId) {
      return sendJson(res, 401, {
        success: false,
        error: 'INVALID_WEBHOOK_SIGNATURE',
        message: sigCheck.reason || 'Assinatura Svix do webhook inválida.',
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

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return sendJson(res, 400, {
        success: false,
        error: 'INVALID_WEBHOOK_PAYLOAD',
        message: 'Corpo JSON do webhook deve ser um objeto válido.',
      });
    }

    const svixId = sigCheck.svixId;
    const eventType = String(payload.type || payload.event || '').trim().toLowerCase();
    const providerMessageId = String(
      payload?.data?.email_id || payload?.email_id || payload?.data?.id || ''
    ).trim();

    if (!eventType) {
      return sendJson(res, 400, {
        success: false,
        error: 'INVALID_WEBHOOK_PAYLOAD',
        message: 'Campo obrigatório "type" ausente no evento Resend.',
      });
    }

    if (isKnownEmailDeliveryEvent(eventType) && !providerMessageId) {
      return sendJson(res, 400, {
        success: false,
        error: 'INVALID_WEBHOOK_PAYLOAD',
        message: 'Campo obrigatório "data.email_id" ausente para evento de entrega de e-mail.',
      });
    }

    const eventId = String(payload?.id || payload?.data?.email_id || svixId);

    // Anti-replay rápido em memória (populado somente após confirmação de persistência)
    if (isSvixIdInMemoryCache(svixId)) {
      return sendJson(res, 200, {
        success: true,
        received: true,
        duplicate: true,
        replayProtected: true,
        svixId,
        eventId,
      });
    }

    // Anti-replay distribuído persistente via lock lease (liberado se persistência falhar)
    let replayLease: DistributedLockHandle | null = null;
    try {
      replayLease = await acquireDistributedLeaseLock({
        lockKey: buildSvixReplayLockKey(svixId),
        ttlMs: REPLAY_TTL_MS,
        heartbeatIntervalMs: REPLAY_TTL_MS + 60_000, // sem timer em background
        metadata: { eventType, providerMessageId },
        deps: {
          executeSql: deps.executeSql,
          isPostgresConfigured: deps.isPostgresConfigured,
          getServerSupabase: deps.getServerSupabase,
        },
      });

      if (!replayLease.acquired) {
        markSvixIdInMemoryCache(svixId);
        return sendJson(res, 200, {
          success: true,
          received: true,
          duplicate: true,
          replayProtected: true,
          svixId,
          eventId,
        });
      }
    } catch (lockErr: any) {
      const lockErrMsg = String(lockErr?.message || '');
      const isMissingLockSchema =
        lockErr?.code === '42883' ||
        lockErr?.code === '42P01' ||
        (/acquire_distributed_job_lock|distributed_job_locks/i.test(lockErrMsg) &&
          /does not exist|n[aã]o existe|undefined_function/i.test(lockErrMsg));

      if (!isMissingLockSchema) {
        console.error('[Resend Webhook] Falha ao verificar anti-replay distribuído:', lockErrMsg);
        return sendJson(res, 503, {
          success: false,
          retryable: true,
          error: 'WEBHOOK_PERSISTENCE_RETRYABLE',
          message: 'Camada de persistência indisponível temporariamente; tente novamente.',
        });
      }
    }

    const releaseReplayLeaseOnFailure = async () => {
      if (replayLease?.acquired) {
        try {
          await replayLease.release();
        } catch {}
      }
    };

    const webhookMeta = {
      type: eventType,
      svix_id: svixId,
      created_at: payload?.created_at || null,
    };

    let deliveryResult: any = { updated: false };
    if (providerMessageId) {
      if (deps.isPostgresConfigured()) {
        try {
          const pgRes = await deps.executeSql(
            `SELECT public.apply_resend_webhook_event($1, $2, $3::jsonb) AS result`,
            [providerMessageId, eventType, JSON.stringify(webhookMeta)]
          );
          deliveryResult = pgRes?.rows?.[0]?.result ?? null;
          if (!deliveryResult || typeof deliveryResult !== 'object') {
            await releaseReplayLeaseOnFailure();
            return sendJson(res, 503, {
              success: false,
              retryable: true,
              error: 'WEBHOOK_PERSISTENCE_RETRYABLE',
              message: 'Resposta inválida ao persistir evento do webhook Resend.',
            });
          }
        } catch (err: any) {
          console.error('[Resend Webhook] Erro ao persistir evento via PG:', err?.message);
          await releaseReplayLeaseOnFailure();
          return sendJson(res, 503, {
            success: false,
            retryable: true,
            error: 'WEBHOOK_PERSISTENCE_RETRYABLE',
            message: 'Falha temporária ao persistir status de entrega; reenvio solicitado.',
          });
        }
      } else {
        try {
          const sb = deps.getServerSupabase() as any;
          if (!sb || typeof sb.rpc !== 'function') {
            await releaseReplayLeaseOnFailure();
            return sendJson(res, 503, {
              success: false,
              retryable: true,
              error: 'WEBHOOK_PERSISTENCE_RETRYABLE',
              message: 'Armazenamento durável indisponível para registrar webhook.',
            });
          }
          const rpcRes = await sb.rpc('apply_resend_webhook_event', {
            p_provider_message_id: providerMessageId,
            p_event_type: eventType,
            p_payload: webhookMeta,
          });
          if (rpcRes?.error || !rpcRes?.data) {
            console.error('[Resend Webhook] Erro ao persistir evento via RPC:', rpcRes?.error?.message);
            await releaseReplayLeaseOnFailure();
            return sendJson(res, 503, {
              success: false,
              retryable: true,
              error: 'WEBHOOK_PERSISTENCE_RETRYABLE',
              message: 'Falha temporária ao persistir status de entrega via RPC; reenvio solicitado.',
            });
          }
          deliveryResult = rpcRes.data;
        } catch (err: any) {
          console.error('[Resend Webhook] Exceção ao persistir evento via RPC:', err?.message);
          await releaseReplayLeaseOnFailure();
          return sendJson(res, 503, {
            success: false,
            retryable: true,
            error: 'WEBHOOK_PERSISTENCE_RETRYABLE',
            message: 'Falha temporária ao persistir status de entrega; reenvio solicitado.',
          });
        }
      }
    }

    // Marca svix-id como processado SOMENTE após persistência confirmada (permite retry após 5xx)
    markSvixIdInMemoryCache(svixId);

    const webhookItem = {
      id: eventId,
      svixId,
      type: eventType,
      providerMessageId: providerMessageId || null,
      deliveryUpdated: Boolean(deliveryResult?.updated),
      timestamp: String(payload?.created_at || new Date().toISOString()),
    };

    recentWebhookEvents.unshift(webhookItem);
    if (recentWebhookEvents.length > 50) recentWebhookEvents.pop();

    return sendJson(res, 200, {
      success: true,
      received: true,
      duplicate: false,
      svixId,
      eventId: webhookItem.id,
      deliveryUpdated: webhookItem.deliveryUpdated,
      deliveryStatus: deliveryResult?.status || null,
      reason: deliveryResult?.reason || null,
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
    webhookConfigured: Boolean(String(process.env.RESEND_WEBHOOK_SECRET || '').trim()),
    recentEvents: recentWebhookEvents,
  });
}
