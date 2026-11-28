/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Protected Server-Side Endpoint: /api/notifications/process-outbox
 * (Também acessível via /api/admin/outbox-ops para operação administrativa)
 *
 * Modos suportados:
 * - `process` (padrão; suporta `dryRun=true` para simulação sem efeitos colaterais)
 * - `preview` (sempre dry-run com audiência elegível, bloqueios de acesso, anti-flood e obsolescência)
 * - `ops` (métricas exatas, execuções recentes e fila de atenção sem PII)
 * - `discard_obsolete` (arquivamento seguro de backlog obsoleto para `DISCARDED`, `dryRun=true` por padrão)
 * - `replay` (reenfileiramento administrativo de `FAILED`/`DEAD_LETTER`/`DISCARDED`, exige admin real)
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { safeCompare } from '../../crypto.js';
import { acquireDistributedLeaseLock } from '../../distributedLock.js';
import {
  discardObsoleteOutboxItems,
  getNotificationOutboxStats,
  getOutboxOpsSnapshot,
  previewNotificationOutboxBatch,
  processNotificationOutboxBatch,
  recordOutboxJobRun,
  requeueOutboxItems,
} from '../../notificationOutbox.js';

const OUTBOX_WORKER_LOCK_KEY = 'fatosbr:notification-outbox:worker';

type OutboxWorkerMode = 'process' | 'preview' | 'ops' | 'discard_obsolete' | 'replay';

interface TriggerAuthResult {
  authorized: boolean;
  isCron: boolean;
  isAdmin: boolean;
}

interface OutboxHandlerDeps {
  verifyAdminRequest: typeof verifyAdminRequest;
  acquireDistributedLeaseLock: typeof acquireDistributedLeaseLock;
}

let testHandlerDeps: Partial<OutboxHandlerDeps> | null = null;

export function setProcessOutboxTestDeps(deps: Partial<OutboxHandlerDeps> | null): void {
  testHandlerDeps = deps;
}

function parseBoolFlag(raw: unknown, defaultValue: boolean): boolean {
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return defaultValue;
}

function parseOptionalNumber(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function resolveMode(rawMode: unknown, dryRun: boolean): OutboxWorkerMode {
  const s = String(rawMode || '')
    .trim()
    .toLowerCase();
  if (s === 'preview' || s === 'dry_run' || s === 'dry-run') return 'preview';
  if (s === 'ops' || s === 'stats' || s === 'status') return 'ops';
  if (s === 'discard_obsolete' || s === 'discard-obsolete' || s === 'discard') {
    return 'discard_obsolete';
  }
  if (s === 'replay' || s === 'requeue') return 'replay';
  return dryRun ? 'preview' : 'process';
}

async function authorizeTrigger(req: any): Promise<TriggerAuthResult> {
  const authHeader = String(req?.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return { authorized: false, isCron: false, isAdmin: false };
  }
  const token = authHeader.slice(7).trim();
  if (!token) return { authorized: false, isCron: false, isAdmin: false };

  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const isCron = Boolean(cronSecret && safeCompare(token, cronSecret));

  const verifyFn = testHandlerDeps?.verifyAdminRequest || verifyAdminRequest;
  const isAdmin = await verifyFn(req);

  return {
    authorized: isCron || isAdmin,
    isCron,
    isAdmin,
  };
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(res, 405, {
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Método não permitido. Utilize POST ou GET autenticado.',
    });
  }

  const auth = await authorizeTrigger(req);
  if (!auth.authorized) {
    return sendJson(res, 401, {
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Autenticação administrativa ou CRON_SECRET obrigatória para operar a outbox.',
    });
  }

  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const runId = `outbox_${startedMs.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    const urlObj = new URL(req.url || '/api/notifications/process-outbox', 'http://localhost');
    const body = req.method === 'POST' ? await readJsonBody(req) : {};

    const rawDryRun = body?.dryRun ?? urlObj.searchParams.get('dryRun');
    const requestedDryRun = parseBoolFlag(rawDryRun, false);
    const rawMode = body?.mode ?? urlObj.searchParams.get('mode');
    const mode = resolveMode(rawMode, requestedDryRun);

    // Operações administrativas explícitas de replay ou descarte mutante exigem privilégio admin real
    const requiresAdmin =
      mode === 'replay' || (mode === 'discard_obsolete' && !parseBoolFlag(rawDryRun, true));
    if (requiresAdmin && !auth.isAdmin) {
      return sendJson(res, 403, {
        success: false,
        error: 'ADMIN_REQUIRED_FOR_MODE',
        mode,
        message: 'Este modo operacional da outbox exige sessão ou credencial administrativa.',
      });
    }

    const rawLimit = body?.limit ?? urlObj.searchParams.get('limit') ?? 15;
    const limit = Math.max(1, Math.min(100, Number(rawLimit) || 15));

    const rawMaxBatches = body?.maxBatches ?? urlObj.searchParams.get('maxBatches') ?? 1;
    const maxBatches = Math.max(1, Math.min(4, Number(rawMaxBatches) || 1));

    const rawMaxAgeHours = body?.maxAgeHours ?? urlObj.searchParams.get('maxAgeHours');
    const maxAgeHours = parseOptionalNumber(rawMaxAgeHours);
    const discardObsolete = parseBoolFlag(
      body?.discardObsolete ?? urlObj.searchParams.get('discardObsolete'),
      true
    );
    const maxPerUserPerWindow = parseOptionalNumber(
      body?.maxPerUserPerWindow ?? urlObj.searchParams.get('maxPerUserPerWindow')
    );
    const floodWindowMinutes = parseOptionalNumber(
      body?.floodWindowMinutes ?? urlObj.searchParams.get('floodWindowMinutes')
    );
    const enforceAccessPolicy = parseBoolFlag(
      body?.enforceAccessPolicy ?? urlObj.searchParams.get('enforceAccessPolicy'),
      true
    );
    const timeBudgetMs = Math.max(
      2000,
      Math.min(
        45000,
        Number(body?.timeBudgetMs ?? urlObj.searchParams.get('timeBudgetMs') ?? 25000) || 25000
      )
    );

    // Modo 1: Telemetria operacional somente leitura
    if (mode === 'ops') {
      const snapshot = await getOutboxOpsSnapshot({
        recentRunsLimit: Math.max(1, Math.min(50, Number(urlObj.searchParams.get('runsLimit') || 20))),
        sampleLimit: Math.max(1, Math.min(50, Number(urlObj.searchParams.get('sampleLimit') || 20))),
      });
      return sendJson(res, 200, {
        success: true,
        mode: 'ops',
        dryRun: true,
        snapshot,
      });
    }

    // Modo 2: Preview / Dry-Run (sem trava mutante e zero escrita em outbox/notifications)
    if (mode === 'preview') {
      const preview = await previewNotificationOutboxBatch({
        limit,
        maxAgeHours,
        discardObsolete,
        maxPerUserPerWindow,
        floodWindowMinutes,
        enforceAccessPolicy,
        runId,
      });
      const statsAfter = await getNotificationOutboxStats();
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedMs;

      const runLog = {
        runId,
        mode: 'preview',
        dryRun: true,
        startedAt,
        finishedAt,
        durationMs,
        lockKey: OUTBOX_WORKER_LOCK_KEY,
        limit,
        maxBatches: 1,
        batchesExecuted: 1,
        claimed: preview.claimed,
        completed: preview.completed,
        retried: preview.retried,
        deadLettered: preview.deadLettered,
        discarded: preview.discarded,
        notificationsCreated: preview.notificationsCreated,
        duplicatesSkipped: preview.duplicatesSkipped,
        preferencesSkipped: preview.preferencesSkipped,
        accessBlockedSkipped: preview.accessBlockedSkipped,
        floodCappedSkipped: preview.floodCappedSkipped,
        partialFailuresCount: preview.partialFailuresCount,
        errorsCount: preview.errors.length,
        queueStatsAfter: statsAfter,
      };

      await recordOutboxJobRun({
        ...runLog,
        errorsCount: preview.errors.length,
        errorSummary: preview.errors.length > 0 ? preview.errors.slice(0, 5).join(' | ') : null,
      });

      console.info('[NotificationOutboxWorker]', JSON.stringify(runLog));

      return sendJson(res, 200, {
        ...preview,
        success: true,
        mode: 'preview',
        batchesExecuted: 1,
        statsAfter,
        runLog,
      });
    }

    // Modos mutantes ou administrativos: adquirem lock distribuído fail-closed
    const lockFn = testHandlerDeps?.acquireDistributedLeaseLock || acquireDistributedLeaseLock;
    const lock = await lockFn({
      lockKey: OUTBOX_WORKER_LOCK_KEY,
      ttlMs: 120_000,
      metadata: { mode, limit, maxBatches, runId },
    });

    if (!lock.acquired) {
      return sendJson(res, 409, {
        success: false,
        error: 'OUTBOX_WORKER_ALREADY_RUNNING',
        lockKey: OUTBOX_WORKER_LOCK_KEY,
        message: 'Já existe um worker processando a fila de notificações.',
      });
    }

    try {
      // Modo 3: Arquivamento seguro de backlog obsoleto
      if (mode === 'discard_obsolete') {
        const effectiveDryRun = parseBoolFlag(rawDryRun, true);
        const ids = Array.isArray(body?.ids) ? body.ids.map(String) : undefined;
        const reason = body?.reason
          ? String(body.reason)
          : urlObj.searchParams.get('reason') || 'OBSOLETE_BACKLOG_EXPIRED';
        const discardResult = await discardObsoleteOutboxItems({
          maxAgeHours: maxAgeHours ?? 72,
          dryRun: effectiveDryRun,
          reason,
          ids,
          limit: Math.max(1, Math.min(2000, Number(body?.limit ?? urlObj.searchParams.get('limit') ?? 500))),
        });
        const statsAfter = await getNotificationOutboxStats();
        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - startedMs;

        const runLog = {
          runId,
          mode: 'discard_obsolete',
          dryRun: discardResult.dryRun,
          startedAt,
          finishedAt,
          durationMs,
          lockKey: OUTBOX_WORKER_LOCK_KEY,
          limit: discardResult.matchedCount,
          maxBatches: 1,
          batchesExecuted: 1,
          claimed: discardResult.matchedCount,
          completed: 0,
          retried: 0,
          deadLettered: 0,
          discarded: discardResult.discardedCount,
          notificationsCreated: 0,
          duplicatesSkipped: 0,
          preferencesSkipped: 0,
          accessBlockedSkipped: 0,
          floodCappedSkipped: 0,
          partialFailuresCount: 0,
          errorsCount: 0,
          queueStatsAfter: statsAfter,
        };

        await recordOutboxJobRun({
          ...runLog,
          meta: { maxAgeHours: discardResult.maxAgeHours, reason },
        });
        console.info('[NotificationOutboxWorker]', JSON.stringify(runLog));

        return sendJson(res, 200, {
          success: true,
          mode: 'discard_obsolete',
          dryRun: discardResult.dryRun,
          discardResult,
          statsAfter,
          runLog,
        });
      }

      // Modo 4: Replay administrativo controlado de FAILED / DEAD_LETTER / DISCARDED
      if (mode === 'replay') {
        const effectiveDryRun = parseBoolFlag(rawDryRun, true);
        const ids = Array.isArray(body?.ids) ? body.ids.map(String) : undefined;
        const includeDeadLetter = parseBoolFlag(
          body?.includeDeadLetter ?? urlObj.searchParams.get('includeDeadLetter'),
          false
        );
        const includeFailed = parseBoolFlag(
          body?.includeFailed ?? urlObj.searchParams.get('includeFailed'),
          true
        );
        const resetAttempts = parseBoolFlag(
          body?.resetAttempts ?? urlObj.searchParams.get('resetAttempts'),
          false
        );

        const replayResult = await requeueOutboxItems({
          ids,
          includeDeadLetter,
          includeFailed,
          limit,
          resetAttempts,
          dryRun: effectiveDryRun,
        });
        const statsAfter = await getNotificationOutboxStats();
        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - startedMs;

        const runLog = {
          runId,
          mode: 'replay',
          dryRun: replayResult.dryRun,
          startedAt,
          finishedAt,
          durationMs,
          lockKey: OUTBOX_WORKER_LOCK_KEY,
          limit,
          maxBatches: 1,
          batchesExecuted: 1,
          claimed: replayResult.matchedCount,
          completed: 0,
          retried: replayResult.requeuedCount,
          deadLettered: 0,
          discarded: 0,
          notificationsCreated: 0,
          duplicatesSkipped: 0,
          preferencesSkipped: 0,
          accessBlockedSkipped: 0,
          floodCappedSkipped: 0,
          partialFailuresCount: 0,
          errorsCount: 0,
          queueStatsAfter: statsAfter,
        };

        await recordOutboxJobRun({
          ...runLog,
          meta: { includeDeadLetter, includeFailed, resetAttempts },
        });
        console.info('[NotificationOutboxWorker]', JSON.stringify(runLog));

        return sendJson(res, 200, {
          success: true,
          mode: 'replay',
          dryRun: replayResult.dryRun,
          replayResult,
          statsAfter,
          runLog,
        });
      }

      // Modo 5: Processamento controlado em pequenos lotes com guarda de tempo e anti-flood
      let claimed = 0;
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
      let batchesExecuted = 0;
      let stoppedByTimeBudget = false;
      const errors: string[] = [];
      const perUserRunCount = new Map<string, number>();

      for (let batchIdx = 0; batchIdx < maxBatches; batchIdx++) {
        if (batchIdx > 0 && Date.now() - startedMs >= timeBudgetMs - 1500) {
          stoppedByTimeBudget = true;
          break;
        }

        const batch = await processNotificationOutboxBatch({
          limit,
          dryRun: false,
          maxAgeHours,
          discardObsolete,
          maxPerUserPerWindow,
          floodWindowMinutes,
          enforceAccessPolicy,
          runId,
          perUserRunCount,
        });
        batchesExecuted++;
        claimed += batch.claimed;
        completed += batch.completed;
        retried += batch.retried;
        deadLettered += batch.deadLettered;
        discarded += batch.discarded;
        notificationsCreated += batch.notificationsCreated;
        duplicatesSkipped += batch.duplicatesSkipped;
        preferencesSkipped += batch.preferencesSkipped;
        accessBlockedSkipped += batch.accessBlockedSkipped;
        floodCappedSkipped += batch.floodCappedSkipped;
        partialFailuresCount += batch.partialFailuresCount;
        if (batch.errors.length > 0) {
          errors.push(...batch.errors);
        }
        if (batch.claimed < limit) {
          break;
        }
      }

      const statsAfter = await getNotificationOutboxStats();
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedMs;
      const runLog = {
        runId,
        mode: 'process',
        dryRun: false,
        startedAt,
        finishedAt,
        durationMs,
        lockKey: OUTBOX_WORKER_LOCK_KEY,
        limit,
        maxBatches,
        batchesExecuted,
        stoppedByTimeBudget,
        claimed,
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
        errorsCount: errors.length,
        queueStatsAfter: statsAfter,
      };

      await recordOutboxJobRun({
        ...runLog,
        errorSummary: errors.length > 0 ? errors.slice(0, 5).join(' | ') : null,
        meta: {
          maxAgeHours: maxAgeHours ?? 72,
          discardObsolete,
          enforceAccessPolicy,
          stoppedByTimeBudget,
        },
      });

      console.info('[NotificationOutboxWorker]', JSON.stringify(runLog));

      return sendJson(res, 200, {
        success: true,
        mode: 'process',
        dryRun: false,
        claimed,
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
        batchesExecuted,
        stoppedByTimeBudget,
        statsAfter,
        runLog,
      });
    } finally {
      await lock.release();
    }
  } catch (err: any) {
    if (err?.code === 'LOCK_STORE_UNAVAILABLE' || err?.statusCode === 503) {
      return sendJson(res, 503, {
        success: false,
        error: 'OUTBOX_LOCK_STORE_UNAVAILABLE',
        message: 'Armazenamento de trava distribuída indisponível no momento (fail-closed).',
      });
    }
    return sendJson(res, 500, {
      success: false,
      error: 'OUTBOX_PROCESS_FAILED',
      message: err?.message || 'Falha ao processar fila de notificações.',
    });
  }
}
