/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Protected Server-Side Endpoint: /api/admin/briefings-ops
 *
 * Fornece painel operacional consolidado e EXATO (sem amostragem truncada por .limit(100))
 * de Briefings, Agendamento Multi-Fuso, Outbox de Notificações, Resend Deliveries e Locks
 * para o Admin Center, sem exposição de e-mails ou PII.
 */

import { sendJson, setCorsHeaders, getServerKeys } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { getServerSupabase } from '../../db.js';
import { executeSql, isPostgresConfigured } from '../../postgres.js';
import {
  briefingEngine,
  BriefingRunLogEntry,
  computeNextUserBriefingAt,
  DEFAULT_BRIEFING_TIMEZONE,
  DEFAULT_EVENING_TIME,
  DEFAULT_MORNING_TIME,
  normalizeScheduleTime,
  resolveTimezone,
} from '../../briefingEngine.js';
import { getResendFromEmail } from '../../resendClient.js';
import { listActiveDistributedLocks } from '../../distributedLock.js';

export interface BriefingOpsSnapshot {
  generatedAt: string;
  environment: {
    resendConfigured: boolean;
    resendFromEmail: string;
    resendWebhookSecretConfigured: boolean;
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
    nextMorningRunUtc?: string;
    nextEveningRunUtc?: string;
  };
  resendSummary: {
    totalDeliveries: number;
    accepted: number;
    delivered: number;
    failed: number;
    bounced: number;
    retrying: number;
  };
  outboxSummary: {
    pending: number;
    processing: number;
    failed: number;
    deadLetter: number;
    completed: number;
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
  isPostgresConfigured?: typeof isPostgresConfigured;
  executeSql?: typeof executeSql;
} | null = null;

export function setBriefingsOpsTestDeps(
  deps: {
    verifyAdminRequest?: typeof verifyAdminRequest;
    getServerSupabase?: typeof getServerSupabase;
    isPostgresConfigured?: typeof isPostgresConfigured;
    executeSql?: typeof executeSql;
  } | null
): void {
  testOpsDeps = deps;
}

async function fetchExactCount(
  queryFn: (q: any) => any,
  supabase: any,
  table: string,
  fallbackRows: any[],
  predicate: (r: any) => boolean
): Promise<number> {
  try {
    const q = queryFn(supabase.from(table).select('id', { count: 'exact', head: true }));
    const res = await q;
    if (!res?.error && typeof res?.count === 'number') {
      return res.count;
    }
  } catch {}
  return fallbackRows.filter(predicate).length;
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
    const pgCheck = testOpsDeps?.isPostgresConfigured || isPostgresConfigured;
    const sqlExec = testOpsDeps?.executeSql || executeSql;
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

    let dbMetrics: any = null;
    if (pgCheck()) {
      try {
        const pgRes = await sqlExec(`SELECT public.get_briefing_ops_metrics() AS metrics`);
        if (pgRes?.rows?.[0]?.metrics) {
          dbMetrics = pgRes.rows[0].metrics;
        }
      } catch {}
    }
    if (!dbMetrics && supabase && typeof supabase.rpc === 'function') {
      try {
        const rpcRes = await supabase.rpc('get_briefing_ops_metrics');
        if (!rpcRes?.error && rpcRes?.data) {
          dbMetrics = rpcRes.data;
        }
      } catch {}
    }

    // Recentes (somente para listagem visual limitada a 20 linhas mascaradas — nunca usada para totais)
    let recentBriefingRows: any[] = [];
    let allBriefingsFallback: any[] = [];
    try {
      const { data, error } = await supabase
        .from('briefings')
        .select('id, user_id, type, status, local_date, scheduled_for, sent_at, updated_at, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (!error && Array.isArray(data)) {
        recentBriefingRows = data;
      }
    } catch {}

    let totalBriefings = 0;
    let last24hTotal = 0;
    let last24hFailed = 0;

    if (dbMetrics?.briefingsSummary && typeof dbMetrics.briefingsSummary.total === 'number') {
      const bm = dbMetrics.briefingsSummary;
      totalBriefings = Number(bm.total || 0);
      byStatus.PENDING = Number(bm.pending || 0);
      byStatus.GENERATING = Number(bm.generating || 0);
      byStatus.READY = Number(bm.ready || 0);
      byStatus.SENT = Number(bm.sent || 0);
      byStatus.FAILED = Number(bm.failed || 0);
      byStatus.CANCELED = Number(bm.canceled || 0);
      byType.MORNING = Number(bm.morning || 0);
      byType.EVENING = Number(bm.evening || 0);
      last24hTotal = Number(bm.last24hTotal || 0);
      last24hFailed = Number(bm.last24hFailed || 0);
    } else {
      // Fallback paginado / count exact sem truncamento em 100 linhas
      try {
        const { data } = await supabase
          .from('briefings')
          .select('id, user_id, type, status, local_date, scheduled_for, sent_at, updated_at, created_at')
          .order('created_at', { ascending: false })
          .limit(5000);
        if (Array.isArray(data)) allBriefingsFallback = data;
      } catch {}

      const cutoffIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const cutoffMs = Date.now() - 24 * 3600 * 1000;

      const [
        cntTotal,
        cntPending,
        cntGen,
        cntReady,
        cntSent,
        cntFailed,
        cntCanceled,
        cntMorning,
        cntEvening,
        cnt24h,
        cnt24hFailed,
      ] = await Promise.all([
        fetchExactCount((q) => q, supabase, 'briefings', allBriefingsFallback, () => true),
        fetchExactCount((q) => q.eq('status', 'PENDING'), supabase, 'briefings', allBriefingsFallback, (r) => String(r.status).toUpperCase() === 'PENDING'),
        fetchExactCount((q) => q.eq('status', 'GENERATING'), supabase, 'briefings', allBriefingsFallback, (r) => String(r.status).toUpperCase() === 'GENERATING'),
        fetchExactCount((q) => q.eq('status', 'READY'), supabase, 'briefings', allBriefingsFallback, (r) => String(r.status).toUpperCase() === 'READY'),
        fetchExactCount((q) => q.eq('status', 'SENT'), supabase, 'briefings', allBriefingsFallback, (r) => String(r.status).toUpperCase() === 'SENT'),
        fetchExactCount((q) => q.eq('status', 'FAILED'), supabase, 'briefings', allBriefingsFallback, (r) => String(r.status).toUpperCase() === 'FAILED'),
        fetchExactCount((q) => q.eq('status', 'CANCELED'), supabase, 'briefings', allBriefingsFallback, (r) => String(r.status).toUpperCase() === 'CANCELED'),
        fetchExactCount((q) => q.eq('type', 'MORNING'), supabase, 'briefings', allBriefingsFallback, (r) => String(r.type).toUpperCase() !== 'EVENING'),
        fetchExactCount((q) => q.eq('type', 'EVENING'), supabase, 'briefings', allBriefingsFallback, (r) => String(r.type).toUpperCase() === 'EVENING'),
        fetchExactCount((q) => q.gte('created_at', cutoffIso), supabase, 'briefings', allBriefingsFallback, (r) => new Date(r.created_at || r.scheduled_for || 0).getTime() >= cutoffMs),
        fetchExactCount((q) => q.eq('status', 'FAILED').gte('created_at', cutoffIso), supabase, 'briefings', allBriefingsFallback, (r) => String(r.status).toUpperCase() === 'FAILED' && new Date(r.created_at || r.scheduled_for || 0).getTime() >= cutoffMs),
      ]);

      totalBriefings = cntTotal;
      byStatus.PENDING = cntPending;
      byStatus.GENERATING = cntGen;
      byStatus.READY = cntReady;
      byStatus.SENT = cntSent;
      byStatus.FAILED = cntFailed;
      byStatus.CANCELED = cntCanceled;
      byType.MORNING = cntMorning;
      byType.EVENING = cntEvening;
      last24hTotal = cnt24h;
      last24hFailed = cnt24hFailed;
    }

    // Notificações exactas (sem .limit(250))
    let totalProcessed = 0;
    let unreadTotal = 0;
    let briefingReadyCount = 0;
    let highRelevanceCount = 0;

    if (dbMetrics?.notificationsSummary && typeof dbMetrics.notificationsSummary.totalProcessed === 'number') {
      totalProcessed = Number(dbMetrics.notificationsSummary.totalProcessed || 0);
      unreadTotal = Number(dbMetrics.notificationsSummary.unreadTotal || 0);
      briefingReadyCount = Number(dbMetrics.notificationsSummary.briefingReadyCount || 0);
      highRelevanceCount = Number(dbMetrics.notificationsSummary.highRelevanceCount || 0);
    } else {
      let allNotifFallback: any[] = [];
      try {
        const { data } = await supabase.from('notifications').select('id, type, read').limit(5000);
        if (Array.isArray(data)) allNotifFallback = data;
      } catch {}

      [totalProcessed, unreadTotal, briefingReadyCount, highRelevanceCount] = await Promise.all([
        fetchExactCount((q) => q, supabase, 'notifications', allNotifFallback, () => true),
        fetchExactCount((q) => q.eq('read', false), supabase, 'notifications', allNotifFallback, (n) => !n.read),
        fetchExactCount((q) => q.eq('type', 'BRIEFING_READY'), supabase, 'notifications', allNotifFallback, (n) => n.type === 'BRIEFING_READY'),
        fetchExactCount((q) => q.eq('type', 'NEWS_HIGH_RELEVANCE'), supabase, 'notifications', allNotifFallback, (n) => n.type === 'NEWS_HIGH_RELEVANCE'),
      ]);
    }

    let eligibleMorningUsers = 0;
    let eligibleEveningUsers = 0;
    let weekendSubscribers = 0;
    let recipientsWithEmailCount = 0;
    let nextMorningRunUtc: string | undefined;
    let nextEveningRunUtc: string | undefined;
    const now = new Date();

    try {
      const { data: prefRows } = await supabase
        .from('user_preferences')
        .select('id, email_morning_briefing, email_evening_briefing, weekend_edition, briefing_email, timezone, morning_time, evening_time');

      for (const p of prefRows || []) {
        const tz = resolveTimezone(p.timezone || DEFAULT_BRIEFING_TIMEZONE);
        const morningTime = normalizeScheduleTime(p.morning_time, DEFAULT_MORNING_TIME);
        const eveningTime = normalizeScheduleTime(p.evening_time, DEFAULT_EVENING_TIME);
        const weekendEdition = Boolean(p.weekend_edition);

        if (p.email_morning_briefing !== false) {
          eligibleMorningUsers++;
          const candidateM = computeNextUserBriefingAt(
            { timezone: tz, morningTime, eveningTime, weekendEdition },
            'MORNING',
            now
          );
          if (!nextMorningRunUtc || candidateM < nextMorningRunUtc) nextMorningRunUtc = candidateM;
        }
        if (p.email_evening_briefing !== false) {
          eligibleEveningUsers++;
          const candidateE = computeNextUserBriefingAt(
            { timezone: tz, morningTime, eveningTime, weekendEdition },
            'EVENING',
            now
          );
          if (!nextEveningRunUtc || candidateE < nextEveningRunUtc) nextEveningRunUtc = candidateE;
        }
        if (weekendEdition) weekendSubscribers++;
        if (p.briefing_email && String(p.briefing_email).includes('@')) recipientsWithEmailCount++;
      }
    } catch {}

    if (dbMetrics?.schedulesSummary && eligibleMorningUsers === 0 && eligibleEveningUsers === 0) {
      eligibleMorningUsers = Number(dbMetrics.schedulesSummary.eligibleMorningUsers || 0);
      eligibleEveningUsers = Number(dbMetrics.schedulesSummary.eligibleEveningUsers || 0);
      weekendSubscribers = Number(dbMetrics.schedulesSummary.weekendSubscribers || 0);
      recipientsWithEmailCount = Number(dbMetrics.schedulesSummary.recipientsWithEmailCount || 0);
    }

    if (!nextMorningRunUtc) {
      nextMorningRunUtc = computeNextUserBriefingAt(
        {
          timezone: DEFAULT_BRIEFING_TIMEZONE,
          morningTime: DEFAULT_MORNING_TIME,
          eveningTime: DEFAULT_EVENING_TIME,
          weekendEdition: true,
        },
        'MORNING',
        now
      );
    }
    if (!nextEveningRunUtc) {
      nextEveningRunUtc = computeNextUserBriefingAt(
        {
          timezone: DEFAULT_BRIEFING_TIMEZONE,
          morningTime: DEFAULT_MORNING_TIME,
          eveningTime: DEFAULT_EVENING_TIME,
          weekendEdition: true,
        },
        'EVENING',
        now
      );
    }

    const dbActiveLocks: string[] = Array.isArray(dbMetrics?.activeLocks)
      ? dbMetrics.activeLocks.map((l: any) => String(l.lockKey || l))
      : (
          await listActiveDistributedLocks({
            executeSql: sqlExec,
            isPostgresConfigured: pgCheck,
            getServerSupabase: getSb,
          })
        ).map((l) => l.lockKey);

    const dbRunLogs: BriefingRunLogEntry[] = Array.isArray(dbMetrics?.recentRunLogs)
      ? dbMetrics.recentRunLogs
      : [];
    const memRunLogs = briefingEngine.getRecentRunLogs();
    const seenRunIds = new Set<string>();
    const mergedRunLogs: BriefingRunLogEntry[] = [];
    for (const log of [...dbRunLogs, ...memRunLogs]) {
      if (!log?.runId || seenRunIds.has(log.runId)) continue;
      seenRunIds.add(log.runId);
      mergedRunLogs.push(log);
    }
    mergedRunLogs.sort(
      (a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime()
    );

    const rs = dbMetrics?.resendSummary || {};
    const os = dbMetrics?.outboxSummary || {};

    const snapshot: BriefingOpsSnapshot = {
      generatedAt: now.toISOString(),
      environment: {
        resendConfigured: Boolean(keys.RESEND),
        resendFromEmail: getResendFromEmail(),
        resendWebhookSecretConfigured: Boolean(
          process.env.RESEND_WEBHOOK_SECRET && process.env.RESEND_WEBHOOK_SECRET.trim()
        ),
        cronSecretConfigured: Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.trim()),
        cronBriefingsEnabledInVercel: false,
        activeLocks: dbActiveLocks,
      },
      briefingsSummary: {
        total: totalBriefings,
        byStatus,
        byType,
        last24hTotal,
        last24hFailed,
      },
      notificationsSummary: {
        totalProcessed,
        unreadTotal,
        briefingReadyCount,
        highRelevanceCount,
      },
      schedulesSummary: {
        eligibleMorningUsers,
        eligibleEveningUsers,
        weekendSubscribers,
        recipientsWithEmailCount,
        nextMorningRunUtc,
        nextEveningRunUtc,
      },
      resendSummary: {
        totalDeliveries: Number(rs.totalDeliveries || 0),
        accepted: Number(rs.accepted || 0),
        delivered: Number(rs.delivered || 0),
        failed: Number(rs.failed || 0),
        bounced: Number(rs.bounced || 0),
        retrying: Number(rs.retrying || 0),
      },
      outboxSummary: {
        pending: Number(os.pending || 0),
        processing: Number(os.processing || 0),
        failed: Number(os.failed || 0),
        deadLetter: Number(os.deadLetter || 0),
        completed: Number(os.completed || 0),
      },
      recentBriefings: recentBriefingRows.slice(0, 20).map((b) => ({
        id: String(b.id),
        userMask: maskUserId(b.user_id),
        type: String(b.type || 'MORNING').toUpperCase() === 'EVENING' ? 'EVENING' : 'MORNING',
        status: String(b.status || 'PENDING').toUpperCase(),
        localDate: b.local_date ? String(b.local_date) : null,
        scheduledFor: b.scheduled_for ? String(b.scheduled_for) : null,
        sentAt: b.sent_at ? String(b.sent_at) : null,
        updatedAt: b.updated_at ? String(b.updated_at) : null,
      })),
      recentRunLogs: mergedRunLogs.slice(0, 30),
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
