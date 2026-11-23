/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Protected Server-Side Endpoint: /api/notifications/process-outbox
 *
 * Processa o lote de eventos pendentes/com retry em internal.notification_outbox
 * usando trava distribuída fail-closed contra execução simultânea.
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { safeCompare } from '../../crypto.js';
import { acquireDistributedLeaseLock } from '../../distributedLock.js';
import { processNotificationOutboxBatch } from '../../notificationOutbox.js';

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

  try {
    const urlObj = new URL(req.url || '/api/notifications/process-outbox', 'http://localhost');
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const rawLimit = body?.limit ?? urlObj.searchParams.get('limit') ?? 25;
    const limit = Math.max(1, Math.min(100, Number(rawLimit) || 25));

    const lock = await acquireDistributedLeaseLock({
      lockKey: 'fatosbr:notification-outbox:worker',
      ttlMs: 120_000,
      metadata: { limit },
    });

    if (!lock.acquired) {
      return sendJson(res, 409, {
        success: false,
        error: 'OUTBOX_WORKER_ALREADY_RUNNING',
        message: 'Já existe um worker processando a fila de notificações.',
      });
    }

    try {
      const summary = await processNotificationOutboxBatch({ limit });
      return sendJson(res, 200, {
        success: true,
        ...summary,
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
