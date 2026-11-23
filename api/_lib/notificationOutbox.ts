/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR V2.4.1 — Durable Notification Outbox Service
 *
 * Desacopla a segmentação/criação de alertas da transação síncrona de ingestão,
 * com deduplicação por event_id, retries limitados e backoff exponencial.
 */

import { executeSql, isPostgresConfigured } from './postgres.js';
import { getServerSupabase } from './db.js';
import { notificationEngine, SegmentedEventDispatchInput } from './notificationEngine.js';

export interface NotificationOutboxItem {
  id: string;
  dedup_key: string;
  event_id: string;
  event_type: string;
  payload: SegmentedEventDispatchInput;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER';
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  last_error?: string | null;
}

export interface OutboxStats {
  pending: number;
  processing: number;
  failed: number;
  deadLetter: number;
  completed: number;
}

interface OutboxDeps {
  executeSql: typeof executeSql;
  isPostgresConfigured: typeof isPostgresConfigured;
  getServerSupabase: typeof getServerSupabase;
  dispatchFn: typeof notificationEngine.dispatchSegmentedNotificationsForEvent;
}

let testOutboxDeps: OutboxDeps | null = null;

export function setNotificationOutboxTestDeps(deps: Partial<OutboxDeps> | null): void {
  if (!deps) {
    testOutboxDeps = null;
    return;
  }
  testOutboxDeps = {
    executeSql: deps.executeSql || executeSql,
    isPostgresConfigured: deps.isPostgresConfigured || isPostgresConfigured,
    getServerSupabase: deps.getServerSupabase || getServerSupabase,
    dispatchFn:
      deps.dispatchFn ||
      notificationEngine.dispatchSegmentedNotificationsForEvent.bind(notificationEngine),
  };
}

function getDeps(): OutboxDeps {
  return (
    testOutboxDeps || {
      executeSql,
      isPostgresConfigured,
      getServerSupabase,
      dispatchFn: notificationEngine.dispatchSegmentedNotificationsForEvent.bind(notificationEngine),
    }
  );
}

export async function enqueueNotificationOutbox(
  input: SegmentedEventDispatchInput,
  options?: { maxAttempts?: number }
): Promise<{ enqueued: boolean; id?: string; dedupKey?: string; error?: string }> {
  if (!input?.eventId || !input?.title) {
    return { enqueued: false, error: 'INVALID_OUTBOX_PAYLOAD' };
  }

  const dedupKey = `event:${input.eventId}`;
  const eventType = input.type || 'NEWS_HIGH_RELEVANCE';
  const maxAttempts = Math.max(1, Math.min(10, Number(options?.maxAttempts ?? 5)));
  const deps = getDeps();

  if (deps.isPostgresConfigured()) {
    try {
      const res = await deps.executeSql(
        `SELECT public.enqueue_notification_outbox($1, $2, $3, $4::jsonb, $5) AS row`,
        [dedupKey, input.eventId, eventType, JSON.stringify(input), maxAttempts]
      );
      const row = res?.rows?.[0]?.row;
      return {
        enqueued: true,
        id: row?.id ? String(row.id) : undefined,
        dedupKey,
      };
    } catch (err: any) {
      return { enqueued: false, dedupKey, error: err?.message || 'Erro SQL ao enfileirar outbox' };
    }
  }

  try {
    const supabase = deps.getServerSupabase() as any;
    if (supabase && typeof supabase.rpc === 'function') {
      const rpcRes = await supabase.rpc('enqueue_notification_outbox', {
        p_dedup_key: dedupKey,
        p_event_id: input.eventId,
        p_event_type: eventType,
        p_payload: input,
        p_max_attempts: maxAttempts,
      });
      if (rpcRes?.error) {
        return { enqueued: false, dedupKey, error: rpcRes.error.message };
      }
      return {
        enqueued: true,
        id: rpcRes?.data?.id ? String(rpcRes.data.id) : undefined,
        dedupKey,
      };
    }
  } catch (err: any) {
    return { enqueued: false, dedupKey, error: err?.message || 'Erro RPC ao enfileirar outbox' };
  }

  return { enqueued: false, dedupKey, error: 'OUTBOX_STORE_UNAVAILABLE' };
}

export async function processNotificationOutboxBatch(options?: {
  limit?: number;
}): Promise<{
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  notificationsCreated: number;
  errors: string[];
}> {
  const limit = Math.max(1, Math.min(100, Number(options?.limit ?? 25)));
  const deps = getDeps();
  let items: NotificationOutboxItem[] = [];

  if (deps.isPostgresConfigured()) {
    const claimRes = await deps.executeSql(`SELECT public.claim_notification_outbox_batch($1) AS items`, [
      limit,
    ]);
    const raw = claimRes?.rows?.[0]?.items;
    items = Array.isArray(raw) ? raw : [];
  } else {
    const supabase = deps.getServerSupabase() as any;
    if (!supabase || typeof supabase.rpc !== 'function') {
      throw new Error('OUTBOX_STORE_UNAVAILABLE');
    }
    const rpcRes = await supabase.rpc('claim_notification_outbox_batch', { p_limit: limit });
    if (rpcRes?.error) {
      throw new Error(rpcRes.error.message || 'Falha ao reivindicar lote da notification_outbox');
    }
    items = Array.isArray(rpcRes?.data) ? rpcRes.data : [];
  }

  let completed = 0;
  let retried = 0;
  let deadLettered = 0;
  let notificationsCreated = 0;
  const errors: string[] = [];

  for (const item of items) {
    let dispatchError: string | null = null;
    let createdCount = 0;

    try {
      const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
      const dispatchRes = await deps.dispatchFn(payload);
      createdCount = Number(dispatchRes.created || 0);
      if (dispatchRes.errors > 0) {
        dispatchError =
          dispatchRes.errorDetails?.join('; ') || `Outbox dispatch errors=${dispatchRes.errors}`;
      }
    } catch (err: any) {
      dispatchError = err?.message || 'Exceção no dispatch do outbox';
    }

    if (!dispatchError) {
      completed++;
      notificationsCreated += createdCount;
      if (deps.isPostgresConfigured()) {
        await deps.executeSql(`SELECT public.complete_notification_outbox_item($1, $2)`, [
          item.id,
          createdCount,
        ]);
      } else {
        const supabase = deps.getServerSupabase() as any;
        await supabase.rpc('complete_notification_outbox_item', {
          p_id: item.id,
          p_dispatched_count: createdCount,
        });
      }
    } else {
      errors.push(`${item.event_id}: ${dispatchError}`);
      const retryDelaySec = Math.min(3600, 30 * Math.pow(2, Number(item.attempts || 0)));
      let failStatus = 'FAILED';

      if (deps.isPostgresConfigured()) {
        const failRes = await deps.executeSql(
          `SELECT public.fail_notification_outbox_item($1, $2, $3) AS result`,
          [item.id, dispatchError, retryDelaySec]
        );
        failStatus = String(failRes?.rows?.[0]?.result?.status || 'FAILED');
      } else {
        const supabase = deps.getServerSupabase() as any;
        const failRes = await supabase.rpc('fail_notification_outbox_item', {
          p_id: item.id,
          p_error: dispatchError,
          p_retry_delay_seconds: retryDelaySec,
        });
        failStatus = String(failRes?.data?.status || 'FAILED');
      }

      if (failStatus === 'DEAD_LETTER') deadLettered++;
      else retried++;
    }
  }

  return {
    claimed: items.length,
    completed,
    retried,
    deadLettered,
    notificationsCreated,
    errors,
  };
}

export async function getNotificationOutboxStats(): Promise<OutboxStats> {
  const deps = getDeps();
  if (deps.isPostgresConfigured()) {
    try {
      const res = await deps.executeSql(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
           COUNT(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
           COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
           COUNT(*) FILTER (WHERE status = 'DEAD_LETTER')::int AS dead_letter,
           COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed
         FROM internal.notification_outbox`
      );
      const r = res.rows?.[0] || {};
      return {
        pending: Number(r.pending || 0),
        processing: Number(r.processing || 0),
        failed: Number(r.failed || 0),
        deadLetter: Number(r.dead_letter || 0),
        completed: Number(r.completed || 0),
      };
    } catch {
      return { pending: 0, processing: 0, failed: 0, deadLetter: 0, completed: 0 };
    }
  }
  return { pending: 0, processing: 0, failed: 0, deadLetter: 0, completed: 0 };
}
