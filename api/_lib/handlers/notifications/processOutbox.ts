/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Protected Server-Side Endpoint: /api/notifications/process-outbox
 *
 * Processa lotes pendentes/com retry em internal.notification_outbox
 * usando trava distribuída fail-closed contra execução simultânea e log estruturado sem PII.
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { safeCompare } from '../../crypto.js';
import { acquireDistributedLeaseLock } from '../../distributedLock.js';
import {
  getNotificationOutboxStats,
  processNotificationOutboxBatch,
} from '../../notificationOutbox.js';

const OUTBOX_WORKER_LOCK_KEY = 'fatosbr:notification-outbox:worker';

async function isAuthorizedTrigger(req: any): Promise<boolean> {
  const authHeader = String(req?.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (cronSecret && safeCompare(token, cronSecret)) {
    return true;
  }

  return verifyAdminRequest(req);
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

  const authorized = await isAuthorizedTrigger(req);
  if (!authorized) {
    return sendJson(res, 401, {
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Autenticação administrativa ou CRON_SECRET obrigatória para processar outbox.',
    });
  }

  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const runId = `outbox_${startedMs.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    const urlObj = new URL(req.url || '/api/notifications/process-outbox', 'http://localhost');
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const rawLimit = body?.limit ?? urlObj.searchParams.get('limit') ?? 25;
    const limit = Math.max(1, Math.min(100, Number(rawLimit) || 25));

    const rawMaxBatches = body?.maxBatches ?? urlObj.searchParams.get('maxBatches') ?? 1;
    const maxBatches = Math.max(1, Math.min(4, Number(rawMaxBatches) || 1));

    const lock = await acquireDistributedLeaseLock({
      lockKey: OUTBOX_WORKER_LOCK_KEY,
      ttlMs: 120_000,
      metadata: { limit, maxBatches, runId },
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
      let claimed = 0;
      let completed = 0;
      let retried = 0;
      let deadLettered = 0;
      let notificationsCreated = 0;
      let batchesExecuted = 0;
      const errors: string[] = [];

      for (let batchIdx = 0; batchIdx < maxBatches; batchIdx++) {
        const batch = await processNotificationOutboxBatch({ limit });
        batchesExecuted++;
        claimed += batch.claimed;
        completed += batch.completed;
        retried += batch.retried;
        deadLettered += batch.deadLettered;
        notificationsCreated += batch.notificationsCreated;
        if (batch.errors.length > 0) {
          errors.push(...batch.errors);
        }
        if (batch.claimed < limit) {
          break;
        }
      }

      const statsAfter = await getNotificationOutboxStats();
      const finishedAt = new Date().toISOString();
      const runLog = {
        runId,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
        lockKey: OUTBOX_WORKER_LOCK_KEY,
        limit,
        maxBatches,
        batchesExecuted,
        claimed,
        completed,
        retried,
        deadLettered,
        notificationsCreated,
        errorsCount: errors.length,
        queueStatsAfter: statsAfter,
      };

      console.info('[NotificationOutboxWorker]', JSON.stringify(runLog));

      return sendJson(res, 200, {
        success: true,
        claimed,
        completed,
        retried,
        deadLettered,
        notificationsCreated,
        errors,
        batchesExecuted,
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
