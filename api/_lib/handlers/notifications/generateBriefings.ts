/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Protected Server-Side Endpoint: /api/notifications/generate-briefings
 *
 * Executa o ciclo real de geração de briefings (MORNING / EVENING) no servidor.
 * Protegido estritamente por CRON_SECRET, ADMIN_SECRET ou sessão administrativa Supabase (internal.user_roles).
 */

import { sendJson, setCorsHeaders, readJsonBody } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { safeCompare } from '../../crypto.js';
import {
  briefingEngine,
  BriefingEditionType,
  DEFAULT_BRIEFING_TIMEZONE,
  getZonedDateParts,
} from '../../briefingEngine.js';

function normalizeEditionType(raw: any): BriefingEditionType | null {
  const upper = String(raw || '').trim().toUpperCase();
  if (upper === 'MORNING' || upper === 'MANHA') return 'MORNING';
  if (upper === 'EVENING' || upper === 'NOITE') return 'EVENING';
  return null;
}

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
      message: 'Autenticação administrativa ou CRON_SECRET obrigatória para gerar briefings.',
    });
  }

  try {
    const urlObj = new URL(req.url || '/api/notifications/generate-briefings', 'http://localhost');
    const body = req.method === 'POST' ? await readJsonBody(req) : {};

    let referenceDate = new Date();
    const rawRefDate = body?.referenceDate ?? urlObj.searchParams.get('referenceDate');
    if (rawRefDate) {
      const parsed = new Date(String(rawRefDate));
      if (Number.isNaN(parsed.getTime())) {
        return sendJson(res, 400, {
          success: false,
          error: 'INVALID_REFERENCE_DATE',
          message: 'referenceDate inválido. Informe uma data ISO-8601 válida.',
        });
      }
      referenceDate = parsed;
    }

    const defaultBrParts = getZonedDateParts(referenceDate, DEFAULT_BRIEFING_TIMEZONE);
    const requestedType =
      normalizeEditionType(body?.type ?? urlObj.searchParams.get('type')) ||
      (defaultBrParts.hour >= 17 ? 'EVENING' : 'MORNING');

    const sendEmail = Boolean(
      body?.sendEmail === true || urlObj.searchParams.get('sendEmail') === 'true'
    );
    const respectScheduleWindow = Boolean(
      body?.respectSchedule === true || urlObj.searchParams.get('respectSchedule') === 'true'
    );
    const targetUserId = body?.userId ? String(body.userId).trim() : '';
    const briefingEmail = body?.briefingEmail ? String(body.briefingEmail).trim() : undefined;

    if (targetUserId) {
      const result = await briefingEngine.generateForUser({
        userId: targetUserId,
        type: requestedType,
        briefingEmail,
        sendEmail,
        referenceDate,
      });

      const statusCode = result.status === 'FAILED' ? 500 : 200;
      return sendJson(res, statusCode, {
        success: result.status !== 'FAILED',
        mode: 'SINGLE_USER',
        type: requestedType,
        result,
      });
    }

    const cycleSummary = await briefingEngine.runGenerationCycle({
      type: requestedType,
      sendEmail,
      referenceDate,
      respectScheduleWindow,
    });

    return sendJson(res, 200, {
      success: true,
      mode: 'BATCH_CYCLE',
      type: requestedType,
      sendEmail,
      respectScheduleWindow,
      ...cycleSummary,
    });
  } catch (err: any) {
    return sendJson(res, 500, {
      success: false,
      error: 'BRIEFING_GENERATION_FAILED',
      message: err?.message || 'Erro interno ao executar geração de briefings.',
    });
  }
}
