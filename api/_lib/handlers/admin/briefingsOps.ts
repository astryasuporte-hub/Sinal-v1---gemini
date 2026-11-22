/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Protected Server-Side Endpoint: /api/admin/briefings-ops
 *
 * Fornece painel operacional consolidado de Briefings, Agendamento, Notificações e Resend
 * para o Admin Center, sem exposição de e-mails ou PII.
 */

import { sendJson, setCorsHeaders, getServerKeys } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { getServerSupabase } from '../../db.js';
import { briefingEngine, BriefingRunLogEntry } from '../../briefingEngine.js';

export interface BriefingOpsSnapshot {
  generatedAt: string;
  environment: {
    resendConfigured: boolean;
    cronSecretConfigured: boolean;
    cronBriefingsEnabledInVercel: boolean;
    activeLocks: string[];
  };
  briefingsSummary: {
    total: number;
    byStatus: Record<'PENDING' | 'GENERATING' | 'READY' | 'SENT' | 'FAILED' | 'CANCELED', number>;
    byType: Record<'MORNING' | 'EVENING', number>;
    last24hTotal: number;
    last24hFailed: number;
  };
  notificationsSummary: {
    totalProcessed: number;
    unreadTotal: number;
    briefingReadyCount: number;
    highRelevanceCount: number;
  };
  schedulesSummary: {
    eligibleMorningUsers: number;
    eligibleEveningUsers: number;
    weekendSubscribers: number;
    recipientsWithEmailCount: number;
  };
  recentBriefings: Array<{
    id: string;
    userMask: string;
    type: 'MORNING' | 'EVENING';
    status: string;
    localDate: string | null;
    scheduledFor: string | null;
    sentAt: string | null;
    updatedAt: string | null;
  }>;
  recentRunLogs: BriefingRunLogEntry[];
}

function maskUserId(rawId: unknown): string {
  const s = String(rawId || '').trim();
  if (!s) return 'usr_anon';
  if (s.length <= 8) return `usr_${s.slice(0, 2)}…`;
  return `usr_${s.slice(0, 4)}…${s.slice(-4)}`;
}

let testOpsDeps: {
  verifyAdminRequest?: typeof verifyAdminRequest;
  getServerSupabase?: typeof getServerSupabase;
} | null = null;

export function setBriefingsOpsTestDeps(
  deps: { verifyAdminRequest?: typeof verifyAdminRequest; getServerSupabase?: typeof getServerSupabase } | null
): void {
  testOpsDeps = deps;
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, {
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Método não permitido. Utilize GET.',
    });
  }

  const verifyFn = testOpsDeps?.verifyAdminRequest || verifyAdminRequest;
  const authorized = await verifyFn(req);
  if (!authorized) {
    return sendJson(res, 401, {
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Acesso restrito a administradores autenticados.',
    });
  }

  try {
    const getSb = testOpsDeps?.getServerSupabase || getServerSupabase;
    const supabase = getSb() as any;
    const keys = getServerKeys();

    const byStatus: BriefingOpsSnapshot['briefingsSummary']['byStatus'] = {
      PENDING: 0,
      GENERATING: 0,
      READY: 0,
      SENT: 0,
      FAILED: 0,
      CANCELED: 0,
    };
    const byType: BriefingOpsSnapshot['briefingsSummary']['byType'] = {
      MORNING: 0,
      EVENING: 0,
    };

    let briefingsRows: any[] = [];
    try {
      const { data, error } = await supabase
        .from('briefings')
        .select('id, user_id, type, status, local_date, scheduled_for, sent_at, updated_at, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (!error && Array.isArray(data)) {
        briefingsRows = data;
      }
    } catch {}

    const cutoff24hMs = Date.now() - 24 * 3600 * 1000;
    let last24hTotal = 0;
    let last24hFailed = 0;

    for (const row of briefingsRows) {
      const status = String(row.status || 'PENDING').toUpperCase() as keyof typeof byStatus;
      if (status in byStatus) byStatus[status]++;
      const bType = String(row.type || 'MORNING').toUpperCase() === 'EVENING' ? 'EVENING' : 'MORNING';
      byType[bType]++;
      const ts = new Date(row.created_at || row.scheduled_for || 0).getTime();
      if (ts >= cutoff24hMs) {
        last24hTotal++;
        if (status === 'FAILED') last24hFailed++;
      }
    }

    let notificationsRows: any[] = [];
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, read')
        .order('created_at', { ascending: false })
        .limit(250);
      if (!error && Array.isArray(data)) {
        notificationsRows = data;
      }
    } catch {}

    let unreadTotal = 0;
    let briefingReadyCount = 0;
    let highRelevanceCount = 0;
    for (const n of notificationsRows) {
      if (!n.read) unreadTotal++;
      if (n.type === 'BRIEFING_READY') briefingReadyCount++;
      if (n.type === 'NEWS_HIGH_RELEVANCE') highRelevanceCount++;
    }

    let eligibleMorningUsers = 0;
    let eligibleEveningUsers = 0;
    let weekendSubscribers = 0;
    let recipientsWithEmailCount = 0;

    try {
      const { data: prefRows } = await supabase
        .from('user_preferences')
        .select('id, email_morning_briefing, email_evening_briefing, weekend_edition, briefing_email');
      for (const p of prefRows || []) {
        if (p.email_morning_briefing !== false) eligibleMorningUsers++;
        if (p.email_evening_briefing !== false) eligibleEveningUsers++;
        if (p.weekend_edition === true) weekendSubscribers++;
        if (p.briefing_email && String(p.briefing_email).includes('@')) recipientsWithEmailCount++;
      }
    } catch {}

    const snapshot: BriefingOpsSnapshot = {
      generatedAt: new Date().toISOString(),
      environment: {
        resendConfigured: Boolean(keys.RESEND),
        cronSecretConfigured: Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.trim()),
        cronBriefingsEnabledInVercel: false,
        activeLocks: briefingEngine.getActiveLocks(),
      },
      briefingsSummary: {
        total: briefingsRows.length,
        byStatus,
        byType,
        last24hTotal,
        last24hFailed,
      },
      notificationsSummary: {
        totalProcessed: notificationsRows.length,
        unreadTotal,
        briefingReadyCount,
        highRelevanceCount,
      },
      schedulesSummary: {
        eligibleMorningUsers,
        eligibleEveningUsers,
        weekendSubscribers,
        recipientsWithEmailCount,
      },
      recentBriefings: briefingsRows.slice(0, 20).map((b) => ({
        id: String(b.id),
        userMask: maskUserId(b.user_id),
        type: String(b.type || 'MORNING').toUpperCase() === 'EVENING' ? 'EVENING' : 'MORNING',
        status: String(b.status || 'PENDING').toUpperCase(),
        localDate: b.local_date ? String(b.local_date) : null,
        scheduledFor: b.scheduled_for ? String(b.scheduled_for) : null,
        sentAt: b.sent_at ? String(b.sent_at) : null,
        updatedAt: b.updated_at ? String(b.updated_at) : null,
      })),
      recentRunLogs: briefingEngine.getRecentRunLogs(),
    };

    return sendJson(res, 200, {
      success: true,
      snapshot,
    });
  } catch (err: any) {
    return sendJson(res, 500, {
      success: false,
      error: 'BRIEFINGS_OPS_FAILED',
      message: err?.message || 'Falha ao consolidar telemetria operacional de briefings.',
    });
  }
}
