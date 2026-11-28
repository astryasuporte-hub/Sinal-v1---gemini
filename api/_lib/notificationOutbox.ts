/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR V2.5.1 — Durable Notification Outbox Service
 *
 * Desacopla a segmentação/criação de alertas da transação síncrona de ingestão,
 * com deduplicação por event_id/revisão, dry-run com preview de audiência,
 * validação de conteúdo/obsolescência, descarte seguro (`DISCARDED`),
 * proteção anti-flood, políticas de acesso da conta, tratamento de falhas
 * parciais, retries limitados com backoff exponencial, replay administrativo
 * controlado e histórico persistente de execuções (`internal.outbox_job_runs`).
 */

import { executeSql, isPostgresConfigured } from './postgres.js';
import { getServerSupabase } from './db.js';
import {
  notificationEngine,
  SegmentedDispatchOptions,
  SegmentedDispatchResult,
  SegmentedEventDispatchInput,
} from './notificationEngine.js';

export type OutboxStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'DEAD_LETTER'
  | 'DISCARDED';

export interface NotificationOutboxItem {
  id: string;
  dedup_key: string;
  event_id: string;
  event_type: string;
  payload: SegmentedEventDispatchInput | string;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  locked_until?: string | null;
  last_error?: string | null;
  stale_recovery_count?: number;
  discarded_at?: string | null;
  discard_reason?: string | null;
  execution_meta?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface OutboxStats {
  pending: number;
  processing: number;
  failed: number;
  deadLetter: number;
  completed: number;
  discarded: number;
  staleProcessing?: number;
  oldestPendingAgeHours?: number;
}

export interface ProcessOutboxBatchOptions {
  limit?: number;
  dryRun?: boolean;
  maxAgeHours?: number;
  discardObsolete?: boolean;
  maxPerUserPerWindow?: number;
  floodWindowMinutes?: number;
  enforceAccessPolicy?: boolean;
  runId?: string;
  perUserRunCount?: Map<string, number>;
  nowMs?: number;
}

export interface ProcessOutboxBatchResult {
  dryRun: boolean;
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  discarded: number;
  notificationsCreated: number;
  duplicatesSkipped: number;
  preferencesSkipped: number;
  accessBlockedSkipped: number;
  floodCappedSkipped: number;
  partialFailuresCount: number;
  errors: string[];
  previewItems?: OutboxPreviewItem[];
}

export interface OutboxPreviewItem {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  ageHours: number;
  predictedOutcome: 'PROCESS' | 'DISCARD_OBSOLETE' | 'DEAD_LETTER_INVALID';
  reason?: string;
  targetedUsers: number;
  estimatedDeliveries: number;
  estimatedDuplicates: number;
  estimatedSkippedByPreferences: number;
  estimatedBlockedByAccess: number;
  estimatedFloodCapped: number;
}

export interface OutboxJobRunRecord {
  runId: string;
  mode: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  limit: number;
  maxBatches: number;
  batchesExecuted: number;
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  discarded: number;
  notificationsCreated: number;
  duplicatesSkipped: number;
  preferencesSkipped: number;
  accessBlockedSkipped: number;
  floodCappedSkipped: number;
  partialFailuresCount: number;
  errorsCount: number;
  errorSummary?: string | null;
  meta?: Record<string, any>;
}

export interface OutboxOpsSnapshot {
  summary: OutboxStats;
  recentRuns: Array<{
    runId: string;
    mode: string;
    dryRun: boolean;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    claimed: number;
    completed: number;
    retried: number;
    deadLettered: number;
    discarded: number;
    notificationsCreated: number;
    errorsCount: number;
    errorSummary?: string | null;
  }>;
  attentionItems: Array<{
    id: string;
    eventId: string;
    eventType: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    staleRecoveryCount: number;
    lastError?: string | null;
    discardReason?: string | null;
    nextRetryAt?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  }>;
}

interface OutboxDeps {
  executeSql: typeof executeSql;
  isPostgresConfigured: typeof isPostgresConfigured;
  getServerSupabase: typeof getServerSupabase;
  dispatchFn: (
    input: SegmentedEventDispatchInput,
    options?: SegmentedDispatchOptions
  ) => Promise<SegmentedDispatchResult>;
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

export type SqlQueryExecutor = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;

function isMissingFunctionOrColumnError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    code === '42883' ||
    code === '42703' ||
    code === '42P01' ||
    code === 'PGRST202' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the function') ||
    msg.includes('schema cache')
  );
}

export function validateOutboxItemPayloadAndFreshness(
  item: NotificationOutboxItem,
  options?: { maxAgeHours?: number; nowMs?: number }
): {
  valid: boolean;
  obsolete: boolean;
  ageHours: number;
  reason?: string;
  payload?: SegmentedEventDispatchInput;
} {
  let parsed: any = item.payload;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {
        valid: false,
        obsolete: false,
        ageHours: 0,
        reason: 'INVALID_OUTBOX_PAYLOAD_JSON',
      };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      obsolete: false,
      ageHours: 0,
      reason: 'INVALID_OUTBOX_PAYLOAD_OBJECT',
    };
  }

  const eventId = String(parsed.eventId || item.event_id || '').trim();
  const title = String(parsed.title || '').trim();
  if (!eventId || !title) {
    return {
      valid: false,
      obsolete: false,
      ageHours: 0,
      reason: !eventId ? 'MISSING_EVENT_ID' : 'MISSING_EVENT_TITLE',
    };
  }

  const normalizedPayload: SegmentedEventDispatchInput = {
    ...parsed,
    eventId,
    title,
  };

  const nowMs = options?.nowMs ?? Date.now();
  const referenceTimestamp = parsed.publishedAt || item.created_at || null;
  const refMs = referenceTimestamp ? Date.parse(String(referenceTimestamp)) : NaN;
  const ageHours = Number.isFinite(refMs)
    ? Math.max(0, Math.round(((nowMs - refMs) / 3600_000) * 100) / 100)
    : 0;

  const maxAgeHours = options?.maxAgeHours ?? 72;
  if (maxAgeHours > 0 && Number.isFinite(refMs) && ageHours > maxAgeHours) {
    return {
      valid: true,
      obsolete: true,
      ageHours,
      reason: `STALE_ALERT_AGE_EXCEEDED (${ageHours}h > ${maxAgeHours}h)`,
      payload: normalizedPayload,
    };
  }

  return {
    valid: true,
    obsolete: false,
    ageHours,
    payload: normalizedPayload,
  };
}

export async function enqueueNotificationOutbox(
  input: SegmentedEventDispatchInput,
  options?: { maxAttempts?: number; queryFn?: SqlQueryExecutor }
): Promise<{ enqueued: boolean; id?: string; dedupKey?: string; error?: string; errorCode?: string }> {
  if (!input?.eventId || !input?.title) {
    return { enqueued: false, error: 'INVALID_OUTBOX_PAYLOAD' };
  }

  const eventRevision = Math.max(1, Math.floor(Number(input.eventRevision ?? 1) || 1));
  const dedupKey =
    eventRevision > 1 ? `event:${input.eventId}:rev:${eventRevision}` : `event:${input.eventId}`;
  const eventType = input.type || 'NEWS_HIGH_RELEVANCE';
  const maxAttempts = Math.max(1, Math.min(10, Number(options?.maxAttempts ?? 5)));
  const deps = getDeps();

  if (options?.queryFn) {
    try {
      const res = await options.queryFn(
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
      return {
        enqueued: false,
        dedupKey,
        error: err?.message || 'Erro SQL ao enfileirar outbox na transação',
        errorCode: err?.code ? String(err.code) : undefined,
      };
    }
  }

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
      return {
        enqueued: false,
        dedupKey,
        error: err?.message || 'Erro SQL ao enfileirar outbox',
        errorCode: err?.code ? String(err.code) : undefined,
      };
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
        return {
          enqueued: false,
          dedupKey,
          error: rpcRes.error.message,
          errorCode: rpcRes.error.code ? String(rpcRes.error.code) : undefined,
        };
      }
      return {
        enqueued: true,
        id: rpcRes?.data?.id ? String(rpcRes.data.id) : undefined,
        dedupKey,
      };
    }
  } catch (err: any) {
    return {
      enqueued: false,
      dedupKey,
      error: err?.message || 'Erro RPC ao enfileirar outbox',
      errorCode: err?.code ? String(err.code) : undefined,
    };
  }

  return { enqueued: false, dedupKey, error: 'OUTBOX_STORE_UNAVAILABLE' };
}

export async function recoverMissingNotificationOutbox(options?: {
  sinceHours?: number;
  limit?: number;
  queryFn?: SqlQueryExecutor;
}): Promise<{
  scanned: number;
  recovered: number;
  errors: string[];
}> {
  const deps = getDeps();
  const queryFn: SqlQueryExecutor | null =
    options?.queryFn ||
    (deps.isPostgresConfigured() ? (sql, params) => deps.executeSql(sql, params) : null);

  if (!queryFn) {
    return { scanned: 0, recovered: 0, errors: [] };
  }

  const sinceHours = Math.max(1, Math.min(168, Number(options?.sinceHours ?? 48)));
  const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 50)));
  const cutoffIso = new Date(Date.now() - sinceHours * 3600_000).toISOString();

  const missingRes = await queryFn(
    `SELECT e.id, e.title, e.summary, e.relevance_score, e.status, COALESCE(e.revision, 1) AS revision
       FROM public.events e
      WHERE COALESCE(e.published_at, e.created_at) >= $1::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM internal.notification_outbox o
           WHERE o.event_id = e.id::text
        )
      ORDER BY COALESCE(e.published_at, e.created_at) DESC
      LIMIT $2`,
    [cutoffIso, limit]
  );

  const missingEvents = missingRes.rows || [];
  if (missingEvents.length === 0) {
    return { scanned: 0, recovered: 0, errors: [] };
  }

  const eventIds = missingEvents.map((e: any) => String(e.id));
  const topicsByEvent = new Map<string, string[]>();
  const entitiesByEvent = new Map<string, string[]>();
  const sourcesByEvent = new Map<string, string[]>();

  try {
    const tRes = await queryFn(
      `SELECT event_id::text AS event_id, topic_id::text AS topic_id
         FROM public.event_topics
        WHERE event_id::text = ANY($1::text[])`,
      [eventIds]
    );
    for (const r of tRes.rows || []) {
      const list = topicsByEvent.get(r.event_id) || [];
      if (r.topic_id) list.push(String(r.topic_id));
      topicsByEvent.set(r.event_id, list);
    }
  } catch {}

  try {
    const eRes = await queryFn(
      `SELECT event_id::text AS event_id, entity_id::text AS entity_id
         FROM public.event_entities
        WHERE event_id::text = ANY($1::text[])`,
      [eventIds]
    );
    for (const r of eRes.rows || []) {
      const list = entitiesByEvent.get(r.event_id) || [];
      if (r.entity_id) list.push(String(r.entity_id));
      entitiesByEvent.set(r.event_id, list);
    }
  } catch {}

  try {
    const sRes = await queryFn(
      `SELECT ea.event_id::text AS event_id, a.source_id::text AS source_id
         FROM public.event_articles ea
         JOIN public.articles a ON a.id = ea.article_id
        WHERE ea.event_id::text = ANY($1::text[])
          AND a.source_id IS NOT NULL`,
      [eventIds]
    );
    for (const r of sRes.rows || []) {
      const list = sourcesByEvent.get(r.event_id) || [];
      if (r.source_id && !list.includes(String(r.source_id))) {
        list.push(String(r.source_id));
      }
      sourcesByEvent.set(r.event_id, list);
    }
  } catch {}

  let recovered = 0;
  const errors: string[] = [];

  for (const ev of missingEvents) {
    const eventId = String(ev.id);
    const eventType =
      String(ev.status || '').toUpperCase() === 'UPDATED' ? 'EVENT_UPDATED' : 'NEWS_HIGH_RELEVANCE';
    const eventRevision = Math.max(1, Number(ev.revision || 1));
    const res = await enqueueNotificationOutbox(
      {
        eventId,
        title: String(ev.title || ''),
        summary: ev.summary ? String(ev.summary) : undefined,
        relevanceScore: ev.relevance_score !== undefined ? Number(ev.relevance_score) : undefined,
        entityIds: entitiesByEvent.get(eventId) || [],
        topicIds: topicsByEvent.get(eventId) || [],
        sourceIds: sourcesByEvent.get(eventId) || [],
        type: eventType,
        eventRevision,
      },
      options?.queryFn ? { queryFn: options.queryFn } : undefined
    );
    if (res.enqueued) {
      recovered++;
    } else if (res.error) {
      errors.push(`${eventId}: ${res.error}`);
    }
  }

  return { scanned: missingEvents.length, recovered, errors };
}

async function completeOutboxItemCompat(
  itemId: string,
  dispatchedCount: number,
  executionMeta: Record<string, any>,
  runId?: string
): Promise<void> {
  const deps = getDeps();
  if (deps.isPostgresConfigured()) {
    try {
      await deps.executeSql(`SELECT public.complete_notification_outbox_item($1, $2, $3::jsonb, $4)`, [
        itemId,
        dispatchedCount,
        JSON.stringify(executionMeta),
        runId || null,
      ]);
      return;
    } catch (err: any) {
      if (!isMissingFunctionOrColumnError(err)) throw err;
      await deps.executeSql(`SELECT public.complete_notification_outbox_item($1, $2)`, [
        itemId,
        dispatchedCount,
      ]);
      return;
    }
  }

  const supabase = deps.getServerSupabase() as any;
  const res = await supabase.rpc('complete_notification_outbox_item', {
    p_id: itemId,
    p_dispatched_count: dispatchedCount,
    p_execution_meta: executionMeta,
    p_run_id: runId || null,
  });
  if (res?.error && isMissingFunctionOrColumnError(res.error)) {
    await supabase.rpc('complete_notification_outbox_item', {
      p_id: itemId,
      p_dispatched_count: dispatchedCount,
    });
  }
}

async function failOutboxItemCompat(
  itemId: string,
  errorMsg: string,
  retryDelaySec: number,
  executionMeta: Record<string, any>,
  forceDeadLetter: boolean,
  runId?: string
): Promise<'FAILED' | 'DEAD_LETTER'> {
  const deps = getDeps();
  if (deps.isPostgresConfigured()) {
    try {
      const failRes = await deps.executeSql(
        `SELECT public.fail_notification_outbox_item($1, $2, $3, $4::jsonb, $5, $6) AS result`,
        [itemId, errorMsg, retryDelaySec, JSON.stringify(executionMeta), forceDeadLetter, runId || null]
      );
      const st = String(failRes?.rows?.[0]?.result?.status || 'FAILED').toUpperCase();
      return st === 'DEAD_LETTER' ? 'DEAD_LETTER' : 'FAILED';
    } catch (err: any) {
      if (!isMissingFunctionOrColumnError(err)) throw err;
      const failRes = await deps.executeSql(
        `SELECT public.fail_notification_outbox_item($1, $2, $3) AS result`,
        [itemId, errorMsg, retryDelaySec]
      );
      const st = String(failRes?.rows?.[0]?.result?.status || 'FAILED').toUpperCase();
      return st === 'DEAD_LETTER' ? 'DEAD_LETTER' : 'FAILED';
    }
  }

  const supabase = deps.getServerSupabase() as any;
  let failRes = await supabase.rpc('fail_notification_outbox_item', {
    p_id: itemId,
    p_error: errorMsg,
    p_retry_delay_seconds: retryDelaySec,
    p_execution_meta: executionMeta,
    p_force_dead_letter: forceDeadLetter,
    p_run_id: runId || null,
  });
  if (failRes?.error && isMissingFunctionOrColumnError(failRes.error)) {
    failRes = await supabase.rpc('fail_notification_outbox_item', {
      p_id: itemId,
      p_error: errorMsg,
      p_retry_delay_seconds: retryDelaySec,
    });
  }
  const st = String(failRes?.data?.status || 'FAILED').toUpperCase();
  return st === 'DEAD_LETTER' ? 'DEAD_LETTER' : 'FAILED';
}

async function discardOutboxItemCompat(
  itemId: string,
  reason: string,
  executionMeta: Record<string, any>,
  runId?: string
): Promise<boolean> {
  const deps = getDeps();
  if (deps.isPostgresConfigured()) {
    try {
      const res = await deps.executeSql(
        `SELECT public.discard_notification_outbox_item($1, $2, $3::jsonb, $4) AS result`,
        [itemId, reason, JSON.stringify(executionMeta), runId || null]
      );
      return Boolean(res?.rows?.[0]?.result?.discarded);
    } catch (err: any) {
      if (!isMissingFunctionOrColumnError(err)) throw err;
      // Fallback pré-migração V2.5.1: conclui com dispatched_count=0 preservando o registro sem retry
      await completeOutboxItemCompat(itemId, 0, { ...executionMeta, legacyDiscardedReason: reason }, runId);
      return true;
    }
  }

  const supabase = deps.getServerSupabase() as any;
  const res = await supabase.rpc('discard_notification_outbox_item', {
    p_id: itemId,
    p_reason: reason,
    p_execution_meta: executionMeta,
    p_run_id: runId || null,
  });
  if (res?.error && isMissingFunctionOrColumnError(res.error)) {
    await completeOutboxItemCompat(itemId, 0, { ...executionMeta, legacyDiscardedReason: reason }, runId);
    return true;
  }
  return Boolean(res?.data?.discarded);
}

/**
 * Preview sem efeitos colaterais (dry-run): inspeciona próximos itens elegíveis da outbox,
 * valida payload/obsolescência e simula audiência, preferências, acesso e anti-flood.
 */
export async function previewNotificationOutboxBatch(
  options?: ProcessOutboxBatchOptions
): Promise<ProcessOutboxBatchResult> {
  const limit = Math.max(1, Math.min(100, Number(options?.limit ?? 15)));
  const maxAgeHours = options?.maxAgeHours !== undefined ? Math.max(0, Number(options.maxAgeHours)) : 72;
  const discardObsolete = options?.discardObsolete !== false;
  const nowMs = options?.nowMs ?? Date.now();
  const deps = getDeps();
  const perUserRunCount = options?.perUserRunCount || new Map<string, number>();

  let items: NotificationOutboxItem[] = [];
  if (deps.isPostgresConfigured()) {
    const dueRes = await deps.executeSql(
      `SELECT *
         FROM internal.notification_outbox
        WHERE (
          (status IN ('PENDING', 'FAILED') AND next_retry_at <= NOW())
          OR (status = 'PROCESSING' AND locked_until IS NOT NULL AND locked_until <= NOW() AND attempts + 1 < max_attempts)
        )
          AND attempts < max_attempts
        ORDER BY next_retry_at ASC, created_at ASC
        LIMIT $1`,
      [limit]
    );
    items = (dueRes.rows || []) as NotificationOutboxItem[];
  } else {
    const supabase = deps.getServerSupabase() as any;
    if (supabase && typeof supabase.rpc === 'function') {
      const opsRes = await supabase.rpc('get_outbox_ops_metrics', {
        p_recent_runs_limit: 5,
        p_sample_limit: limit,
      });
      if (!opsRes?.error && Array.isArray(opsRes?.data?.attentionItems)) {
        items = (opsRes.data.attentionItems as any[]).filter(
          (it) => it.status === 'PENDING' || it.status === 'FAILED'
        );
      }
    }
  }

  let completed = 0;
  let deadLettered = 0;
  let discarded = 0;
  let notificationsCreated = 0;
  let duplicatesSkipped = 0;
  let preferencesSkipped = 0;
  let accessBlockedSkipped = 0;
  let floodCappedSkipped = 0;
  let partialFailuresCount = 0;
  const errors: string[] = [];
  const previewItems: OutboxPreviewItem[] = [];

  for (const item of items) {
    const validation = validateOutboxItemPayloadAndFreshness(item, {
      maxAgeHours: discardObsolete ? maxAgeHours : 0,
      nowMs,
    });

    if (!validation.valid || !validation.payload) {
      deadLettered++;
      errors.push(`${item.event_id}: ${validation.reason}`);
      previewItems.push({
        id: item.id,
        eventId: item.event_id,
        eventType: item.event_type,
        status: item.status,
        attempts: item.attempts,
        maxAttempts: item.max_attempts,
        ageHours: validation.ageHours,
        predictedOutcome: 'DEAD_LETTER_INVALID',
        reason: validation.reason,
        targetedUsers: 0,
        estimatedDeliveries: 0,
        estimatedDuplicates: 0,
        estimatedSkippedByPreferences: 0,
        estimatedBlockedByAccess: 0,
        estimatedFloodCapped: 0,
      });
      continue;
    }

    if (validation.obsolete && discardObsolete) {
      discarded++;
      previewItems.push({
        id: item.id,
        eventId: item.event_id,
        eventType: item.event_type,
        status: item.status,
        attempts: item.attempts,
        maxAttempts: item.max_attempts,
        ageHours: validation.ageHours,
        predictedOutcome: 'DISCARD_OBSOLETE',
        reason: validation.reason,
        targetedUsers: 0,
        estimatedDeliveries: 0,
        estimatedDuplicates: 0,
        estimatedSkippedByPreferences: 0,
        estimatedBlockedByAccess: 0,
        estimatedFloodCapped: 0,
      });
      continue;
    }

    try {
      const simRes = await deps.dispatchFn(validation.payload, {
        dryRun: true,
        enforceAccessPolicy: options?.enforceAccessPolicy,
        maxPerUserPerWindow: options?.maxPerUserPerWindow,
        floodWindowMinutes: options?.floodWindowMinutes,
        perUserRunCount,
      });

      const created = Number(simRes.created || 0);
      const duplicates = Number(simRes.duplicates || 0);
      const skippedPref = Number(simRes.skippedByPreferences || 0);
      const blockedAccess = Number(simRes.blockedByAccess || 0);
      const floodCapped = Number(simRes.floodCapped || 0);

      completed++;
      notificationsCreated += created;
      duplicatesSkipped += duplicates;
      preferencesSkipped += skippedPref;
      accessBlockedSkipped += blockedAccess;
      floodCappedSkipped += floodCapped;
      if (simRes.partialFailure) partialFailuresCount++;
      if (simRes.errors > 0) {
        errors.push(`${item.event_id}: ${(simRes.errorDetails || []).join('; ') || 'PREVIEW_DISPATCH_ERRORS'}`);
      }

      previewItems.push({
        id: item.id,
        eventId: item.event_id,
        eventType: item.event_type,
        status: item.status,
        attempts: item.attempts,
        maxAttempts: item.max_attempts,
        ageHours: validation.ageHours,
        predictedOutcome: 'PROCESS',
        targetedUsers: Number(simRes.targetedUsers || 0),
        estimatedDeliveries: created,
        estimatedDuplicates: duplicates,
        estimatedSkippedByPreferences: skippedPref,
        estimatedBlockedByAccess: blockedAccess,
        estimatedFloodCapped: floodCapped,
      });
    } catch (err: any) {
      errors.push(`${item.event_id}: ${err?.message || 'Erro na simulação dry-run'}`);
    }
  }

  return {
    dryRun: true,
    claimed: items.length,
    completed,
    retried: 0,
    deadLettered,
    discarded,
    notificationsCreated,
    duplicatesSkipped,
    preferencesSkipped,
    accessBlockedSkipped,
    floodCappedSkipped,
    partialFailuresCount,
    errors,
    previewItems,
  };
}

export async function processNotificationOutboxBatch(
  options?: ProcessOutboxBatchOptions
): Promise<ProcessOutboxBatchResult> {
  if (options?.dryRun) {
    return previewNotificationOutboxBatch(options);
  }

  const limit = Math.max(1, Math.min(100, Number(options?.limit ?? 15)));
  const maxAgeHours = options?.maxAgeHours !== undefined ? Math.max(0, Number(options.maxAgeHours)) : 72;
  const discardObsolete = options?.discardObsolete !== false;
  const nowMs = options?.nowMs ?? Date.now();
  const perUserRunCount = options?.perUserRunCount || new Map<string, number>();
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
  let discarded = 0;
  let notificationsCreated = 0;
  let duplicatesSkipped = 0;
  let preferencesSkipped = 0;
  let accessBlockedSkipped = 0;
  let floodCappedSkipped = 0;
  let partialFailuresCount = 0;
  const errors: string[] = [];

  for (const item of items) {
    const validation = validateOutboxItemPayloadAndFreshness(item, {
      maxAgeHours: discardObsolete ? maxAgeHours : 0,
      nowMs,
    });

    if (!validation.valid || !validation.payload) {
      const reason = validation.reason || 'INVALID_OUTBOX_PAYLOAD';
      errors.push(`${item.event_id}: ${reason}`);
      const failStatus = await failOutboxItemCompat(
        item.id,
        reason,
        60,
        { permanentInvalidPayload: true, reason },
        true,
        options?.runId
      );
      if (failStatus === 'DEAD_LETTER') deadLettered++;
      else retried++;
      continue;
    }

    if (validation.obsolete && discardObsolete) {
      const reason = validation.reason || 'STALE_ALERT_AGE_EXCEEDED';
      await discardOutboxItemCompat(
        item.id,
        reason,
        { ageHours: validation.ageHours, maxAgeHours },
        options?.runId
      );
      discarded++;
      continue;
    }

    let dispatchError: string | null = null;
    let dispatchRes: SegmentedDispatchResult | null = null;

    try {
      dispatchRes = await deps.dispatchFn(validation.payload, {
        dryRun: false,
        enforceAccessPolicy: options?.enforceAccessPolicy,
        maxPerUserPerWindow: options?.maxPerUserPerWindow,
        floodWindowMinutes: options?.floodWindowMinutes,
        perUserRunCount,
      });

      const created = Number(dispatchRes.created || 0);
      const duplicates = Number(dispatchRes.duplicates || 0);
      const skippedPref = Number(dispatchRes.skippedByPreferences || 0);
      const blockedAccess = Number(dispatchRes.blockedByAccess || 0);
      const floodCapped = Number(dispatchRes.floodCapped || 0);

      notificationsCreated += created;
      duplicatesSkipped += duplicates;
      preferencesSkipped += skippedPref;
      accessBlockedSkipped += blockedAccess;
      floodCappedSkipped += floodCapped;

      if (dispatchRes.partialFailure) {
        partialFailuresCount++;
      }

      if (dispatchRes.errors > 0) {
        dispatchError =
          dispatchRes.errorDetails?.join('; ') || `Outbox dispatch errors=${dispatchRes.errors}`;
      }
    } catch (err: any) {
      dispatchError = err?.message || 'Exceção no dispatch do outbox';
    }

    const execMeta: Record<string, any> = dispatchRes
      ? {
          targetedUsers: dispatchRes.targetedUsers,
          created: dispatchRes.created,
          duplicates: dispatchRes.duplicates,
          skippedByPreferences: dispatchRes.skippedByPreferences,
          blockedByAccess: dispatchRes.blockedByAccess ?? 0,
          floodCapped: dispatchRes.floodCapped ?? 0,
          errors: dispatchRes.errors,
          partialFailure: Boolean(dispatchRes.partialFailure),
          ...(dispatchRes.failedUserMasks?.length
            ? { failedUserMasks: dispatchRes.failedUserMasks }
            : {}),
        }
      : { dispatchException: true };

    if (!dispatchError) {
      completed++;
      await completeOutboxItemCompat(
        item.id,
        Number(dispatchRes?.created || 0),
        execMeta,
        options?.runId
      );
    } else {
      errors.push(`${item.event_id}: ${dispatchError}`);
      const retryDelaySec = Math.min(3600, 30 * Math.pow(2, Number(item.attempts || 0)));
      const failStatus = await failOutboxItemCompat(
        item.id,
        dispatchError,
        retryDelaySec,
        execMeta,
        false,
        options?.runId
      );

      if (failStatus === 'DEAD_LETTER') deadLettered++;
      else retried++;
    }
  }

  return {
    dryRun: false,
    claimed: items.length,
    completed,
    retried,
    deadLettered,
    discarded,
    notificationsCreated,
    duplicatesSkipped,
    preferencesSkipped,
    accessBlockedSkipped,
    floodCappedSkipped,
    partialFailuresCount,
    errors,
  };
}

/**
 * Arquiva/descarta itens obsoletos de backlog (`PENDING`/`FAILED`) como `DISCARDED` sem deletar evidências.
 */
export async function discardObsoleteOutboxItems(options?: {
  maxAgeHours?: number;
  dryRun?: boolean;
  reason?: string;
  ids?: string[];
  limit?: number;
}): Promise<{
  dryRun: boolean;
  maxAgeHours: number;
  matchedCount: number;
  discardedCount: number;
  sampleIds: string[];
}> {
  const maxAgeHours = Math.max(1, Math.min(8760, Number(options?.maxAgeHours ?? 72)));
  const dryRun = options?.dryRun !== false;
  const reason = options?.reason || 'OBSOLETE_BACKLOG_EXPIRED';
  const ids = Array.isArray(options?.ids) && options.ids.length > 0 ? options.ids : null;
  const limit = Math.max(1, Math.min(2000, Number(options?.limit ?? 500)));
  const deps = getDeps();

  if (deps.isPostgresConfigured()) {
    const res = await deps.executeSql(
      `SELECT public.discard_obsolete_notification_outbox($1, $2, $3, $4::uuid[], $5) AS result`,
      [maxAgeHours, dryRun, reason, ids, limit]
    );
    const data = res?.rows?.[0]?.result || {};
    return {
      dryRun: Boolean(data.dry_run ?? dryRun),
      maxAgeHours: Number(data.max_age_hours ?? maxAgeHours),
      matchedCount: Number(data.matched_count ?? 0),
      discardedCount: Number(data.discarded_count ?? 0),
      sampleIds: Array.isArray(data.sample_ids) ? data.sample_ids.map(String) : [],
    };
  }

  const supabase = deps.getServerSupabase() as any;
  if (!supabase || typeof supabase.rpc !== 'function') {
    throw new Error('OUTBOX_STORE_UNAVAILABLE');
  }
  const rpcRes = await supabase.rpc('discard_obsolete_notification_outbox', {
    p_max_age_hours: maxAgeHours,
    p_dry_run: dryRun,
    p_reason: reason,
    p_ids: ids,
    p_limit: limit,
  });
  if (rpcRes?.error) {
    throw new Error(rpcRes.error.message || 'Falha ao descartar alertas obsoletos na outbox');
  }
  const data = rpcRes?.data || {};
  return {
    dryRun: Boolean(data.dry_run ?? dryRun),
    maxAgeHours: Number(data.max_age_hours ?? maxAgeHours),
    matchedCount: Number(data.matched_count ?? 0),
    discardedCount: Number(data.discarded_count ?? 0),
    sampleIds: Array.isArray(data.sample_ids) ? data.sample_ids.map(String) : [],
  };
}

/**
 * Reprocessamento administrativo controlado de itens FAILED / DEAD_LETTER / DISCARDED.
 */
export async function requeueOutboxItems(options?: {
  ids?: string[];
  includeDeadLetter?: boolean;
  includeFailed?: boolean;
  limit?: number;
  resetAttempts?: boolean;
  dryRun?: boolean;
}): Promise<{
  dryRun: boolean;
  matchedCount: number;
  requeuedCount: number;
  sampleIds: string[];
}> {
  const ids = Array.isArray(options?.ids) && options.ids.length > 0 ? options.ids : null;
  const includeDeadLetter = Boolean(options?.includeDeadLetter);
  const includeFailed = options?.includeFailed !== false;
  const limit = Math.max(1, Math.min(100, Number(options?.limit ?? 25)));
  const resetAttempts = Boolean(options?.resetAttempts);
  const dryRun = options?.dryRun !== false;
  const deps = getDeps();

  if (deps.isPostgresConfigured()) {
    const res = await deps.executeSql(
      `SELECT public.requeue_notification_outbox_items($1::uuid[], $2, $3, $4, $5, $6) AS result`,
      [ids, includeDeadLetter, includeFailed, limit, resetAttempts, dryRun]
    );
    const data = res?.rows?.[0]?.result || {};
    return {
      dryRun: Boolean(data.dry_run ?? dryRun),
      matchedCount: Number(data.matched_count ?? 0),
      requeuedCount: Number(data.requeued_count ?? 0),
      sampleIds: Array.isArray(data.sample_ids) ? data.sample_ids.map(String) : [],
    };
  }

  const supabase = deps.getServerSupabase() as any;
  if (!supabase || typeof supabase.rpc !== 'function') {
    throw new Error('OUTBOX_STORE_UNAVAILABLE');
  }
  const rpcRes = await supabase.rpc('requeue_notification_outbox_items', {
    p_ids: ids,
    p_include_dead_letter: includeDeadLetter,
    p_include_failed: includeFailed,
    p_limit: limit,
    p_reset_attempts: resetAttempts,
    p_dry_run: dryRun,
  });
  if (rpcRes?.error) {
    throw new Error(rpcRes.error.message || 'Falha ao reenfileirar itens da outbox');
  }
  const data = rpcRes?.data || {};
  return {
    dryRun: Boolean(data.dry_run ?? dryRun),
    matchedCount: Number(data.matched_count ?? 0),
    requeuedCount: Number(data.requeued_count ?? 0),
    sampleIds: Array.isArray(data.sample_ids) ? data.sample_ids.map(String) : [],
  };
}

export async function recordOutboxJobRun(record: OutboxJobRunRecord): Promise<boolean> {
  const deps = getDeps();
  try {
    if (deps.isPostgresConfigured()) {
      await deps.executeSql(
        `SELECT public.record_outbox_job_run(
          $1, $2, $3, $4::timestamptz, $5::timestamptz, $6,
          $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb
        )`,
        [
          record.runId,
          record.mode,
          record.dryRun,
          record.startedAt,
          record.finishedAt,
          record.durationMs,
          record.limit,
          record.maxBatches,
          record.batchesExecuted,
          record.claimed,
          record.completed,
          record.retried,
          record.deadLettered,
          record.discarded,
          record.notificationsCreated,
          record.duplicatesSkipped,
          record.preferencesSkipped,
          record.accessBlockedSkipped,
          record.floodCappedSkipped,
          record.partialFailuresCount,
          record.errorsCount,
          record.errorSummary || null,
          JSON.stringify(record.meta || {}),
        ]
      );
      return true;
    }

    const supabase = deps.getServerSupabase() as any;
    if (supabase && typeof supabase.rpc === 'function') {
      const rpcRes = await supabase.rpc('record_outbox_job_run', {
        p_run_id: record.runId,
        p_mode: record.mode,
        p_dry_run: record.dryRun,
        p_started_at: record.startedAt,
        p_finished_at: record.finishedAt,
        p_duration_ms: record.durationMs,
        p_limit_per_batch: record.limit,
        p_max_batches: record.maxBatches,
        p_batches_executed: record.batchesExecuted,
        p_claimed_count: record.claimed,
        p_completed_count: record.completed,
        p_retried_count: record.retried,
        p_dead_lettered_count: record.deadLettered,
        p_discarded_count: record.discarded,
        p_notifications_created: record.notificationsCreated,
        p_duplicates_skipped: record.duplicatesSkipped,
        p_preferences_skipped: record.preferencesSkipped,
        p_access_blocked_skipped: record.accessBlockedSkipped,
        p_flood_capped_skipped: record.floodCappedSkipped,
        p_partial_failures_count: record.partialFailuresCount,
        p_errors_count: record.errorsCount,
        p_error_summary: record.errorSummary || null,
        p_meta: record.meta || {},
      });
      return !rpcRes?.error;
    }
  } catch (err: any) {
    if (!isMissingFunctionOrColumnError(err)) {
      console.warn('[NotificationOutbox] Aviso ao persistir outbox_job_runs:', err?.message);
    }
  }
  return false;
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
           COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'DISCARDED')::int AS discarded,
           COUNT(*) FILTER (WHERE status = 'PROCESSING' AND locked_until IS NOT NULL AND locked_until <= NOW())::int AS stale_processing,
           COALESCE(ROUND((EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status IN ('PENDING', 'FAILED')))) / 3600.0)::numeric, 2), 0) AS oldest_pending_age_hours
         FROM internal.notification_outbox`
      );
      const r = res.rows?.[0] || {};
      return {
        pending: Number(r.pending || 0),
        processing: Number(r.processing || 0),
        failed: Number(r.failed || 0),
        deadLetter: Number(r.dead_letter || 0),
        completed: Number(r.completed || 0),
        discarded: Number(r.discarded || 0),
        staleProcessing: Number(r.stale_processing || 0),
        oldestPendingAgeHours: Number(r.oldest_pending_age_hours || 0),
      };
    } catch {
      return {
        pending: 0,
        processing: 0,
        failed: 0,
        deadLetter: 0,
        completed: 0,
        discarded: 0,
      };
    }
  }

  try {
    const supabase = deps.getServerSupabase() as any;
    if (supabase && typeof supabase.rpc === 'function') {
      const outboxOpsRes = await supabase.rpc('get_outbox_ops_metrics', {
        p_recent_runs_limit: 1,
        p_sample_limit: 1,
      });
      if (!outboxOpsRes?.error && outboxOpsRes?.data?.summary) {
        const s = outboxOpsRes.data.summary;
        return {
          pending: Number(s.pending || 0),
          processing: Number(s.processing || 0),
          failed: Number(s.failed || 0),
          deadLetter: Number(s.deadLetter || 0),
          completed: Number(s.completed || 0),
          discarded: Number(s.discarded || 0),
          staleProcessing: Number(s.staleProcessing || 0),
          oldestPendingAgeHours: Number(s.oldestPendingAgeHours || 0),
        };
      }

      const briefingOpsRes = await supabase.rpc('get_briefing_ops_metrics');
      if (!briefingOpsRes?.error && briefingOpsRes?.data?.outboxSummary) {
        const s = briefingOpsRes.data.outboxSummary;
        return {
          pending: Number(s.pending || 0),
          processing: Number(s.processing || 0),
          failed: Number(s.failed || 0),
          deadLetter: Number(s.deadLetter || 0),
          completed: Number(s.completed || 0),
          discarded: Number(s.discarded || 0),
        };
      }
    }
  } catch {}

  return {
    pending: 0,
    processing: 0,
    failed: 0,
    deadLetter: 0,
    completed: 0,
    discarded: 0,
  };
}

export async function getOutboxOpsSnapshot(options?: {
  recentRunsLimit?: number;
  sampleLimit?: number;
}): Promise<OutboxOpsSnapshot> {
  const recentRunsLimit = Math.max(1, Math.min(100, Number(options?.recentRunsLimit ?? 20)));
  const sampleLimit = Math.max(1, Math.min(100, Number(options?.sampleLimit ?? 20)));
  const deps = getDeps();

  if (deps.isPostgresConfigured()) {
    try {
      const res = await deps.executeSql(`SELECT public.get_outbox_ops_metrics($1, $2) AS metrics`, [
        recentRunsLimit,
        sampleLimit,
      ]);
      const data = res?.rows?.[0]?.metrics;
      if (data && data.summary) {
        return {
          summary: {
            pending: Number(data.summary.pending || 0),
            processing: Number(data.summary.processing || 0),
            failed: Number(data.summary.failed || 0),
            deadLetter: Number(data.summary.deadLetter || 0),
            completed: Number(data.summary.completed || 0),
            discarded: Number(data.summary.discarded || 0),
            staleProcessing: Number(data.summary.staleProcessing || 0),
            oldestPendingAgeHours: Number(data.summary.oldestPendingAgeHours || 0),
          },
          recentRuns: Array.isArray(data.recentRuns) ? data.recentRuns : [],
          attentionItems: Array.isArray(data.attentionItems) ? data.attentionItems : [],
        };
      }
    } catch (err: any) {
      if (!isMissingFunctionOrColumnError(err)) throw err;
    }
  }

  try {
    const supabase = deps.getServerSupabase() as any;
    if (supabase && typeof supabase.rpc === 'function') {
      const rpcRes = await supabase.rpc('get_outbox_ops_metrics', {
        p_recent_runs_limit: recentRunsLimit,
        p_sample_limit: sampleLimit,
      });
      if (!rpcRes?.error && rpcRes?.data?.summary) {
        const data = rpcRes.data;
        return {
          summary: {
            pending: Number(data.summary.pending || 0),
            processing: Number(data.summary.processing || 0),
            failed: Number(data.summary.failed || 0),
            deadLetter: Number(data.summary.deadLetter || 0),
            completed: Number(data.summary.completed || 0),
            discarded: Number(data.summary.discarded || 0),
            staleProcessing: Number(data.summary.staleProcessing || 0),
            oldestPendingAgeHours: Number(data.summary.oldestPendingAgeHours || 0),
          },
          recentRuns: Array.isArray(data.recentRuns) ? data.recentRuns : [],
          attentionItems: Array.isArray(data.attentionItems) ? data.attentionItems : [],
        };
      }
    }
  } catch {}

  const summary = await getNotificationOutboxStats();
  return {
    summary,
    recentRuns: [],
    attentionItems: [],
  };
}
