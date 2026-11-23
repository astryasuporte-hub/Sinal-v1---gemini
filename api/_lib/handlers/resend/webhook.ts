/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vercel Serverless Function: Resend Webhooks Handler (Hardened V2.4.2)
 *
 * - POST: Valida assinatura criptográfica Svix/HMAC (RESEND_WEBHOOK_SECRET),
 *   controla idempotência durável em internal.resend_webhook_events
 *   (PROCESSING -> PROCESSED / FAILED) e aplica o estado em
 *   internal.briefing_email_deliveries (DELIVERED | BOUNCED | COMPLAINED | FAILED | DELAYED).
 *   * Nunca retorna 200 duplicate sem evidência durável de status='PROCESSED'.
 *   * Se outra instância estiver em voo (IN_FLIGHT) ou houver falha de persistência,
 *     retorna HTTP 503 retryable para que a Svix reenvie com o mesmo svix-id.
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

const INBOX_STALE_PROCESSING_MS = 60_000;

const recentWebhookEvents: Array<{
  id: string;
  svixId: string;
  type: string;
  providerMessageId: string | null;
  deliveryUpdated: boolean;
  deliveryStatus: string | null;
  timestamp: string;
}> = [];

export function clearResendWebhookReplayCache(): void {
  recentWebhookEvents.length = 0;
}

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

function isMissingWebhookInboxSchemaError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return (
    code === '42883' ||
    code === '42P01' ||
    (/claim_resend_webhook_event|complete_resend_webhook_event|fail_resend_webhook_event|resend_webhook_events/i.test(
      msg
    ) &&
      /does not exist|n[aã]o existe|undefined_function|could not find the function/i.test(msg))
  );
}

type ClaimOutcome =
  | {
      kind: 'ACQUIRED' | 'LEGACY_NO_INBOX';
    }
  | {
      kind: 'ALREADY_PROCESSED';
      deliveryUpdated: boolean;
      deliveryStatus: string | null;
      reason: string | null;
    }
  | {
      kind: 'IN_FLIGHT';
    };

async function claimDurableWebhookEvent(
  deps: WebhookDeps,
  params: {
    svixId: string;
    eventType: string;
    providerMessageId: string;
    payloadMeta: Record<string, any>;
  }
): Promise<ClaimOutcome> {
  if (deps.isPostgresConfigured()) {
    try {
      const res = await deps.executeSql(
        `SELECT public.claim_resend_webhook_event($1, $2, $3, $4::jsonb, $5) AS result`,
        [
          params.svixId,
          params.eventType,
          params.providerMessageId || null,
          JSON.stringify(params.payloadMeta),
          INBOX_STALE_PROCESSING_MS,
        ]
      );
      const result = res?.rows?.[0]?.result;
      if (!result || typeof result !== 'object') {
        throw new Error('INVALID_WEBHOOK_CLAIM_RESPONSE');
      }
      if (result.action === 'ALREADY_PROCESSED') {
        return {
          kind: 'ALREADY_PROCESSED',
          deliveryUpdated: Boolean(result.delivery_updated),
          deliveryStatus: result.delivery_status ? String(result.delivery_status) : null,
          reason: result.reason ? String(result.reason) : null,
        };
      }
      if (result.action === 'IN_FLIGHT') {
        return { kind: 'IN_FLIGHT' };
      }
      if (result.action === 'ACQUIRED') {
        return { kind: 'ACQUIRED' };
      }
      throw new Error(`UNKNOWN_WEBHOOK_CLAIM_ACTION: ${String(result.action)}`);
    } catch (err: any) {
      if (isMissingWebhookInboxSchemaError(err)) {
        console.warn('[Resend Webhook] Tabela/RPC V2.4.2 de idempotência ausente; executando sem caixa de entrada durável.');
        return { kind: 'LEGACY_NO_INBOX' };
      }
      throw err;
    }
  }

  const sb = deps.getServerSupabase() as any;
  if (!sb || typeof sb.rpc !== 'function') {
    throw new Error('WEBHOOK_STORE_UNAVAILABLE');
  }

  const rpcRes = await sb.rpc('claim_resend_webhook_event', {
    p_svix_id: params.svixId,
    p_event_type: params.eventType,
    p_provider_message_id: params.providerMessageId || null,
    p_payload_meta: params.payloadMeta,
    p_stale_ms: INBOX_STALE_PROCESSING_MS,
  });

  if (rpcRes?.error) {
    if (isMissingWebhookInboxSchemaError(rpcRes.error)) {
      console.warn('[Resend Webhook] RPC V2.4.2 de idempotência ausente no Supabase; prosseguindo com apply direto.');
      return { kind: 'LEGACY_NO_INBOX' };
    }
    throw new Error(rpcRes.error.message || 'WEBHOOK_CLAIM_RPC_ERROR');
  }

  const result = rpcRes?.data;
  if (!result || typeof result !== 'object') {
    throw new Error('INVALID_WEBHOOK_CLAIM_RESPONSE');
  }
  if (result.action === 'ALREADY_PROCESSED') {
    return {
      kind: 'ALREADY_PROCESSED',
      deliveryUpdated: Boolean(result.delivery_updated),
      deliveryStatus: result.delivery_status ? String(result.delivery_status) : null,
      reason: result.reason ? String(result.reason) : null,
    };
  }
  if (result.action === 'IN_FLIGHT') {
    return { kind: 'IN_FLIGHT' };
  }
  if (result.action === 'ACQUIRED') {
    return { kind: 'ACQUIRED' };
  }
  throw new Error(`UNKNOWN_WEBHOOK_CLAIM_ACTION: ${String(result.action)}`);
}

async function markDurableWebhookCompleted(
  deps: WebhookDeps,
  params: {
    svixId: string;
    deliveryUpdated: boolean;
    deliveryStatus: string | null;
    reason: string | null;
  }
): Promise<void> {
  if (deps.isPostgresConfigured()) {
    const res = await deps.executeSql(
      `SELECT public.complete_resend_webhook_event($1, $2, $3, $4) AS result`,
      [params.svixId, params.deliveryUpdated, params.deliveryStatus, params.reason]
    );
    const completed = res?.rows?.[0]?.result?.completed;
    if (!completed) {
      throw new Error('WEBHOOK_COMPLETE_NOT_FOUND');
    }
    return;
  }

  const sb = deps.getServerSupabase() as any;
  const rpcRes = await sb.rpc('complete_resend_webhook_event', {
    p_svix_id: params.svixId,
    p_delivery_updated: params.deliveryUpdated,
    p_delivery_status: params.deliveryStatus,
    p_reason: params.reason,
  });
  if (rpcRes?.error || !rpcRes?.data?.completed) {
    throw new Error(rpcRes?.error?.message || 'WEBHOOK_COMPLETE_RPC_FAILED');
  }
}

async function markDurableWebhookFailed(
  deps: WebhookDeps,
  svixId: string,
  errorMessage: string
): Promise<void> {
  try {
    if (deps.isPostgresConfigured()) {
      await deps.executeSql(`SELECT public.fail_resend_webhook_event($1, $2)`, [
        svixId,
        errorMessage.slice(0, 500),
      ]);
      return;
    }
    const sb = deps.getServerSupabase() as any;
    if (sb && typeof sb.rpc === 'function') {
      await sb.rpc('fail_resend_webhook_event', {
        p_svix_id: svixId,
        p_error: errorMessage.slice(0, 500),
      });
    }
  } catch (err: any) {
    console.warn('[Resend Webhook] Falha ao registrar status FAILED do webhook:', err?.message);
  }
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
    const webhookMeta = {
      type: eventType,
      svix_id: svixId,
      created_at: payload?.created_at || null,
    };

    let claim: ClaimOutcome;
    try {
      claim = await claimDurableWebhookEvent(deps, {
        svixId,
        eventType,
        providerMessageId,
        payloadMeta: webhookMeta,
      });
    } catch (claimErr: any) {
      console.error('[Resend Webhook] Erro ao reivindicar evento durável:', claimErr?.message);
      return sendJson(res, 503, {
        success: false,
        retryable: true,
        error: 'WEBHOOK_PERSISTENCE_RETRYABLE',
        message: 'Camada de persistência indisponível temporariamente; tente novamente.',
      });
    }

    if (claim.kind === 'ALREADY_PROCESSED') {
      return sendJson(res, 200, {
        success: true,
        received: true,
        duplicate: true,
        replayProtected: true,
        svixId,
        eventId,
        deliveryUpdated: claim.deliveryUpdated,
        deliveryStatus: claim.deliveryStatus,
        reason: claim.reason,
      });
    }

    if (claim.kind === 'IN_FLIGHT') {
      return sendJson(res, 503, {
        success: false,
        retryable: true,
        duplicate: false,
        error: 'WEBHOOK_IN_FLIGHT_RETRYABLE',
        svixId,
        eventId,
        message: 'Evento webhook em processamento concorrente; reenvio solicitado até confirmação durável.',
      });
    }

    const hasDurableInbox = claim.kind === 'ACQUIRED';

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
            if (hasDurableInbox) {
              await markDurableWebhookFailed(deps, svixId, 'INVALID_APPLY_RESULT');
            }
            return sendJson(res, 503, {
              success: false,
              retryable: true,
              error: 'WEBHOOK_PERSISTENCE_RETRYABLE',
              message: 'Resposta inválida ao persistir evento do webhook Resend.',
            });
          }
        } catch (err: any) {
          console.error('[Resend Webhook] Erro ao persistir evento via PG:', err?.message);
          if (hasDurableInbox) {
            await markDurableWebhookFailed(deps, svixId, err?.message || 'PG_APPLY_ERROR');
          }
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
            if (hasDurableInbox) {
              await markDurableWebhookFailed(deps, svixId, 'SUPABASE_CLIENT_UNAVAILABLE');
            }
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
            if (hasDurableInbox) {
              await markDurableWebhookFailed(
                deps,
                svixId,
                rpcRes?.error?.message || 'RPC_APPLY_ERROR'
              );
            }
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
          if (hasDurableInbox) {
            await markDurableWebhookFailed(deps, svixId, err?.message || 'RPC_APPLY_EXCEPTION');
          }
          return sendJson(res, 503, {
            success: false,
            retryable: true,
            error: 'WEBHOOK_PERSISTENCE_RETRYABLE',
            message: 'Falha temporária ao persistir status de entrega; reenvio solicitado.',
          });
        }
      }
    }

    const deliveryUpdated = Boolean(deliveryResult?.updated);
    const deliveryStatus = deliveryResult?.status ? String(deliveryResult.status) : null;
    const reason = deliveryResult?.reason ? String(deliveryResult.reason) : null;

    if (hasDurableInbox) {
      try {
        await markDurableWebhookCompleted(deps, {
          svixId,
          deliveryUpdated,
          deliveryStatus,
          reason,
        });
      } catch (completeErr: any) {
        console.error('[Resend Webhook] Erro ao concluir estado PROCESSED:', completeErr?.message);
        await markDurableWebhookFailed(
          deps,
          svixId,
          completeErr?.message || 'WEBHOOK_COMPLETE_ERROR'
        );
        return sendJson(res, 503, {
          success: false,
          retryable: true,
          error: 'WEBHOOK_PERSISTENCE_RETRYABLE',
          message: 'Falha ao confirmar idempotência durável do webhook; reenvio solicitado.',
        });
      }
    }

    const webhookItem = {
      id: eventId,
      svixId,
      type: eventType,
      providerMessageId: providerMessageId || null,
      deliveryUpdated,
      deliveryStatus,
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
      deliveryUpdated,
      deliveryStatus,
      reason,
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
