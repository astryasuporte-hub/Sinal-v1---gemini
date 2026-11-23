/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR — Motor Server-side de Geração e Entrega de Briefings (V2.3.2)
 *
 * Separa rigorosamente as 7 etapas operacionais:
 * 1. Seleção de acontecimentos reais persistidos (priorizando interesses seguidos)
 * 2. Criação do registro de Briefing (type: 'MORNING' | 'EVENING', local_date, period_start, period_end, status: 'GENERATING')
 * 3. Persistência ordenada em public.briefing_items (position + section restrito ao enum canônico do PostgreSQL)
 * 4. Atualização de status para 'READY' (ou 'FAILED' se não houver eventos reais)
 * 5. Criação idempotente de notificação BRIEFING_READY
 * 6. Disparo de e-mail via Resend apenas quando habilitado e operacional
 * 7. Registro de 'SENT' e sent_at somente após confirmação real do provedor
 */

import { getServerSupabase } from './db.js';
import { getServerKeys } from './common.js';
import { notificationEngine } from './notificationEngine.js';
import { executeSql, getPostgresPool, isPostgresConfigured } from './postgres.js';
import {
  acquireDistributedLeaseLock,
  DistributedLockDeps,
  listActiveDistributedLocks,
} from './distributedLock.js';
import {
  buildBriefingEmailIdempotencyKey,
  getResendFromEmail,
  sendResendEmailWithRetry,
} from './resendClient.js';

export type BriefingEditionType = 'MORNING' | 'EVENING';

export const ALLOWED_BRIEFING_SECTIONS = [
  'TOP_STORIES',
  'UPDATES',
  'DEVELOPING',
  'WATCH_NEXT',
] as const;

export type BriefingItemSection = (typeof ALLOWED_BRIEFING_SECTIONS)[number];

export const DEFAULT_BRIEFING_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_MORNING_TIME = '07:00';
export const DEFAULT_EVENING_TIME = '20:00';

export interface BriefingEventCandidate {
  id: string;
  title: string;
  summary: string;
  why_it_matters?: string;
  relevance_score: number;
  published_at: string;
  isFollowedMatch?: boolean;
}

export interface PrefetchedBriefingEventPool {
  cutoffIso: string;
  candidates: BriefingEventCandidate[];
  eeRows: Array<{ event_id: string; entity_id: string }>;
  etRows: Array<{ event_id: string; topic_id: string }>;
  eaRows: Array<{ event_id: string; article_id: string }>;
  articleSourceById: Map<string, string>;
  esRows: Array<{ event_id: string; source_id: string }>;
}

export interface EligibleBriefingUser {
  userId: string;
  email: string | null;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  weekendEdition: boolean;
  timezone: string;
  morningTime: string;
  eveningTime: string;
}

export interface GenerateBriefingResult {
  userId: string;
  type: BriefingEditionType;
  status:
    | 'READY'
    | 'SENT'
    | 'FAILED'
    | 'SKIPPED_DUPLICATE'
    | 'SKIPPED_NO_EVENTS'
    | 'SKIPPED_DISABLED';
  briefingId?: string;
  localDate?: string;
  periodStart?: string;
  periodEnd?: string;
  eventsCount: number;
  notificationCreated?: boolean;
  emailSent?: boolean;
  emailSkippedReason?: 'DISABLED_OR_NO_EMAIL' | 'OPTED_OUT' | 'ALREADY_SENT' | 'RESEND_UNCONFIGURED';
  emailError?: string;
  providerMessageId?: string;
  deliveryStatus?: string;
  reconciledFromDelivery?: boolean;
  recoveredFromStatus?: string;
  error?: string;
}

export interface BriefingRunLogEntry {
  runId: string;
  mode: 'BATCH_CYCLE' | 'SINGLE_USER';
  type: BriefingEditionType;
  localDate: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  eligibleUsers: number;
  ready: number;
  sent: number;
  skippedDuplicates: number;
  skippedNoEvents: number;
  failed: number;
  locked: boolean;
  sendEmail: boolean;
  respectScheduleWindow: boolean;
  error?: string;
}

interface BriefingEngineDeps {
  getServerSupabase: typeof getServerSupabase;
  getServerKeys: typeof getServerKeys;
  fetchFn: typeof fetch;
  isPostgresConfigured: typeof isPostgresConfigured;
  getPostgresPool: typeof getPostgresPool;
  executeSql: typeof executeSql;
}

let testDeps: BriefingEngineDeps | null = null;

export function setBriefingEngineTestDeps(deps: Partial<BriefingEngineDeps> | null): void {
  if (!deps) {
    testDeps = null;
    return;
  }
  testDeps = {
    getServerSupabase: deps.getServerSupabase || getServerSupabase,
    getServerKeys: deps.getServerKeys || getServerKeys,
    fetchFn: deps.fetchFn || fetch,
    isPostgresConfigured: deps.isPostgresConfigured || isPostgresConfigured,
    getPostgresPool: deps.getPostgresPool || getPostgresPool,
    executeSql: deps.executeSql || executeSql,
  };
}

function getDeps(): BriefingEngineDeps {
  return (
    testDeps || {
      getServerSupabase,
      getServerKeys,
      fetchFn: fetch,
      isPostgresConfigured,
      getPostgresPool,
      executeSql,
    }
  );
}

const recentRunLogs: BriefingRunLogEntry[] = [];
const MAX_RUN_LOGS = 50;
const STALE_GENERATING_MS = 15 * 60 * 1000;
const BRIEFING_LOCK_TTL_MS = 5 * 60 * 1000;

function sanitizeRunErrorMessage(raw: unknown): string {
  const msg = String(raw || '').trim();
  if (!msg) return '';
  return msg
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email-redacted]')
    .replace(/(Bearer\s+|re_[A-Za-z0-9_]+|whsec_[A-Za-z0-9+/=]+)/gi, '[secret-redacted]')
    .slice(0, 240);
}

function getLockDepsFromEngine(): Partial<DistributedLockDeps> {
  const d = getDeps();
  return {
    executeSql: d.executeSql,
    isPostgresConfigured: d.isPostgresConfigured,
    getServerSupabase: d.getServerSupabase,
  };
}

async function getDeliveryRecord(
  briefingId: string
): Promise<{
  status?: string;
  provider_message_id?: string | null;
  attempt_count?: number;
  accepted_at?: string | null;
  next_retry_at?: string | null;
} | null> {
  const d = getDeps();
  if (d.isPostgresConfigured()) {
    try {
      const res = await d.executeSql(`SELECT public.get_briefing_email_delivery($1) AS row`, [
        briefingId,
      ]);
      return res?.rows?.[0]?.row || null;
    } catch {
      return null;
    }
  }
  try {
    const sb = d.getServerSupabase() as any;
    if (sb && typeof sb.rpc === 'function') {
      const res = await sb.rpc('get_briefing_email_delivery', { p_briefing_id: briefingId });
      if (!res?.error && res?.data) return res.data;
    }
  } catch {}
  return null;
}

async function persistDeliveryRecord(params: {
  briefingId: string;
  userId: string;
  editionType: BriefingEditionType;
  idempotencyKey: string;
  fromEmail: string;
  status: 'PENDING' | 'SENDING' | 'ACCEPTED' | 'DELIVERED' | 'FAILED' | 'BOUNCED' | 'COMPLAINED' | 'DELAYED';
  providerMessageId?: string | null;
  lastHttpStatus?: number | null;
  lastError?: string | null;
  incrementAttempt?: boolean;
  nextRetryAt?: string | null;
}): Promise<void> {
  const d = getDeps();
  const safeError = params.lastError ? sanitizeRunErrorMessage(params.lastError) : null;

  if (d.isPostgresConfigured()) {
    try {
      await d.executeSql(
        `SELECT public.upsert_briefing_email_delivery($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          params.briefingId,
          params.userId,
          params.editionType,
          params.idempotencyKey,
          params.fromEmail,
          params.status,
          params.providerMessageId || null,
          params.lastHttpStatus ?? null,
          safeError,
          Boolean(params.incrementAttempt),
          params.nextRetryAt || null,
        ]
      );
      return;
    } catch {}
  }

  try {
    const sb = d.getServerSupabase() as any;
    if (sb && typeof sb.rpc === 'function') {
      await sb.rpc('upsert_briefing_email_delivery', {
        p_briefing_id: params.briefingId,
        p_user_id: params.userId,
        p_edition_type: params.editionType,
        p_idempotency_key: params.idempotencyKey,
        p_from_email: params.fromEmail,
        p_status: params.status,
        p_provider_message_id: params.providerMessageId || null,
        p_last_http_status: params.lastHttpStatus ?? null,
        p_last_error: safeError,
        p_increment_attempt: Boolean(params.incrementAttempt),
        p_next_retry_at: params.nextRetryAt || null,
      });
    }
  } catch {}
}

async function persistJobRunToStore(entry: BriefingRunLogEntry): Promise<void> {
  const d = getDeps();
  if (d.isPostgresConfigured()) {
    try {
      await d.executeSql(
        `SELECT public.record_briefing_job_run($1,$2,$3,$4::date,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          entry.runId,
          entry.mode,
          entry.type,
          entry.localDate,
          entry.startedAt,
          entry.finishedAt,
          entry.durationMs,
          entry.eligibleUsers,
          entry.ready,
          entry.sent,
          entry.skippedDuplicates,
          entry.skippedNoEvents,
          entry.failed,
          entry.locked,
          entry.sendEmail,
          entry.respectScheduleWindow,
          entry.error || null,
        ]
      );
      return;
    } catch {}
  }

  try {
    const sb = d.getServerSupabase() as any;
    if (sb && typeof sb.rpc === 'function') {
      await sb.rpc('record_briefing_job_run', {
        p_run_id: entry.runId,
        p_mode: entry.mode,
        p_edition_type: entry.type,
        p_local_date: entry.localDate,
        p_started_at: entry.startedAt,
        p_finished_at: entry.finishedAt,
        p_duration_ms: entry.durationMs,
        p_eligible_users: entry.eligibleUsers,
        p_ready_count: entry.ready,
        p_sent_count: entry.sent,
        p_skipped_duplicates: entry.skippedDuplicates,
        p_skipped_no_events: entry.skippedNoEvents,
        p_failed_count: entry.failed,
        p_locked: entry.locked,
        p_send_email: entry.sendEmail,
        p_respect_schedule: entry.respectScheduleWindow,
        p_error_message: entry.error || null,
      });
    }
  } catch {}
}

function isMissingColumnError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    msg.includes('schema cache')
  );
}

function isMissingRelationError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (msg.includes('relation') && msg.includes('does not exist')) ||
    msg.includes('could not find the table')
  );
}

export function resolveTimezone(rawTimezone?: string | null): string {
  const candidate = String(rawTimezone || '').trim() || DEFAULT_BRIEFING_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_BRIEFING_TIMEZONE;
  }
}

export function normalizeScheduleTime(raw: unknown, fallback: string): string {
  const str = String(raw || '').trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(str);
  if (!match) return fallback;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return fallback;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseTimeToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  return Number(hStr || 0) * 60 + Number(mStr || 0);
}

export function getZonedDateParts(
  date: Date,
  timezone = DEFAULT_BRIEFING_TIMEZONE
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  localDate: string;
  dateLabelPt: string;
  weekdayShort: string;
} {
  const tz = resolveTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });

  const partsMap: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      partsMap[part.type] = part.value;
    }
  }

  const year = Number(partsMap.year);
  const month = Number(partsMap.month);
  const day = Number(partsMap.day);
  const rawHour = Number(partsMap.hour);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(partsMap.minute);
  const second = Number(partsMap.second);

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    localDate: `${year}-${mm}-${dd}`,
    dateLabelPt: `${dd}/${mm}/${year}`,
    weekdayShort: partsMap.weekday || '',
  };
}

export function shiftLocalDate(localDate: string, deltaDays: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function zonedWallTimeToUtcDate(
  localDate: string,
  hhmm: string,
  timezone = DEFAULT_BRIEFING_TIMEZONE,
  second = 0,
  ms = 0
): Date {
  const tz = resolveTimezone(timezone);
  const [y, m, d] = localDate.split('-').map(Number);
  const normalizedTime = normalizeScheduleTime(hhmm, '00:00');
  const [hh, mm] = normalizedTime.split(':').map(Number);

  const targetAsUtc = Date.UTC(y, m - 1, d, hh, mm, second, ms);

  const firstParts = getZonedDateParts(new Date(targetAsUtc), tz);
  const firstViewedAsUtc = Date.UTC(
    firstParts.year,
    firstParts.month - 1,
    firstParts.day,
    firstParts.hour,
    firstParts.minute,
    firstParts.second,
    ms
  );
  const refined = targetAsUtc + (targetAsUtc - firstViewedAsUtc);

  const secondParts = getZonedDateParts(new Date(refined), tz);
  const secondViewedAsUtc = Date.UTC(
    secondParts.year,
    secondParts.month - 1,
    secondParts.day,
    secondParts.hour,
    secondParts.minute,
    secondParts.second,
    ms
  );

  return new Date(refined + (targetAsUtc - secondViewedAsUtc));
}

function isWeekendInTimezone(date: Date, timezone = DEFAULT_BRIEFING_TIMEZONE): boolean {
  const tz = resolveTimezone(timezone);
  const parts = getZonedDateParts(date, tz);
  return parts.weekdayShort === 'Sat' || parts.weekdayShort === 'Sun';
}

export function getBriefingPeriodWindow(
  type: BriefingEditionType,
  referenceDate: Date,
  options?: {
    timezone?: string | null;
    morningTime?: string | null;
    eveningTime?: string | null;
  }
): {
  timezone: string;
  morningTime: string;
  eveningTime: string;
  localDate: string;
  dayStart: string;
  dayEnd: string;
  periodStart: string;
  periodEnd: string;
  scheduledFor: string;
  dateLabelPt: string;
} {
  const timezone = resolveTimezone(options?.timezone);
  const morningTime = normalizeScheduleTime(options?.morningTime, DEFAULT_MORNING_TIME);
  const eveningTime = normalizeScheduleTime(options?.eveningTime, DEFAULT_EVENING_TIME);

  const zonedNow = getZonedDateParts(referenceDate, timezone);
  const localDate = zonedNow.localDate;
  const prevLocalDate = shiftLocalDate(localDate, -1);

  const dayStart = zonedWallTimeToUtcDate(localDate, '00:00', timezone, 0, 0).toISOString();
  const dayEnd = zonedWallTimeToUtcDate(localDate, '23:59', timezone, 59, 999).toISOString();

  if (type === 'EVENING') {
    const startDate =
      parseTimeToMinutes(eveningTime) > parseTimeToMinutes(morningTime)
        ? zonedWallTimeToUtcDate(localDate, morningTime, timezone, 0, 0)
        : zonedWallTimeToUtcDate(localDate, '00:00', timezone, 0, 0);
    const endDate = zonedWallTimeToUtcDate(localDate, eveningTime, timezone, 59, 999);

    return {
      timezone,
      morningTime,
      eveningTime,
      localDate,
      dayStart,
      dayEnd,
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
      scheduledFor: zonedWallTimeToUtcDate(localDate, eveningTime, timezone, 0, 0).toISOString(),
      dateLabelPt: zonedNow.dateLabelPt,
    };
  }

  const morningStartDate = zonedWallTimeToUtcDate(prevLocalDate, eveningTime, timezone, 0, 0);
  const morningEndDate = zonedWallTimeToUtcDate(localDate, morningTime, timezone, 59, 999);

  return {
    timezone,
    morningTime,
    eveningTime,
    localDate,
    dayStart,
    dayEnd,
    periodStart: morningStartDate.toISOString(),
    periodEnd: morningEndDate.toISOString(),
    scheduledFor: zonedWallTimeToUtcDate(localDate, morningTime, timezone, 0, 0).toISOString(),
    dateLabelPt: zonedNow.dateLabelPt,
  };
}

export function isUserWithinScheduleWindow(
  user: Pick<EligibleBriefingUser, 'timezone' | 'morningTime' | 'eveningTime'>,
  type: BriefingEditionType,
  referenceDate: Date
): boolean {
  const parts = getZonedDateParts(referenceDate, user.timezone);
  const currentLocalMinutes = parts.hour * 60 + parts.minute;
  const targetMinutes = parseTimeToMinutes(
    type === 'EVENING' ? user.eveningTime : user.morningTime
  );
  // Catch-up seguro: após o horário programado do dia local do usuário,
  // o ciclo garante entrega uma única vez para (user_id, type, local_date).
  return currentLocalMinutes >= targetMinutes;
}

export function computeNextUserBriefingAt(
  user: Pick<EligibleBriefingUser, 'timezone' | 'morningTime' | 'eveningTime' | 'weekendEdition'>,
  type: BriefingEditionType,
  referenceDate = new Date()
): string {
  const tz = resolveTimezone(user.timezone);
  const targetTime = type === 'EVENING' ? user.eveningTime : user.morningTime;
  const zonedNow = getZonedDateParts(referenceDate, tz);

  for (let offset = 0; offset <= 7; offset++) {
    const candidateDate = shiftLocalDate(zonedNow.localDate, offset);
    const candidateInstant = zonedWallTimeToUtcDate(candidateDate, targetTime, tz, 0, 0);
    if (candidateInstant.getTime() <= referenceDate.getTime()) continue;
    if (!user.weekendEdition && isWeekendInTimezone(candidateInstant, tz)) continue;
    return candidateInstant.toISOString();
  }
  return zonedWallTimeToUtcDate(shiftLocalDate(zonedNow.localDate, 1), targetTime, tz, 0, 0).toISOString();
}

/**
 * Classificação editorial estritamente compatível com a constraint real de public.briefing_items.section:
 * 'TOP_STORIES' | 'UPDATES' | 'DEVELOPING' | 'WATCH_NEXT'.
 */
export function classifyBriefingItemSection(
  ev: BriefingEventCandidate,
  index: number,
  total: number
): BriefingItemSection {
  if (ev.isFollowedMatch || index < 2) {
    return 'TOP_STORIES';
  }
  if (ev.relevance_score >= 85 && index < 4) {
    return 'DEVELOPING';
  }
  if (index === total - 1 && total >= 4) {
    return 'WATCH_NEXT';
  }
  return 'UPDATES';
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderBriefingEmailHtml(params: {
  title: string;
  description: string;
  type: BriefingEditionType;
  events: BriefingEventCandidate[];
}): string {
  const badge = params.type === 'EVENING' ? 'EDIÇÃO NOTURNA' : 'EDIÇÃO MATINAL';
  const appBaseUrl = String(process.env.APP_URL || 'https://app.fatosbr.com.br').replace(/\/+$/, '');
  const itemsHtml = params.events
    .map(
      (ev, idx) => `
      <tr>
        <td style="padding:16px 0;border-bottom:1px solid #22242a;">
          <div style="font-size:11px;color:#9ca3af;font-family:monospace;margin-bottom:4px;">#${idx + 1} · RELEVÂNCIA ${Number(ev.relevance_score || 0)}${ev.isFollowedMatch ? ' · DO SEU INTERESSE' : ''}</div>
          <div style="font-size:16px;font-weight:700;color:#ffffff;margin-bottom:6px;">
            <a href="${escapeHtml(`${appBaseUrl}/?event=${encodeURIComponent(ev.id)}`)}" style="color:#ffffff;text-decoration:none;">${escapeHtml(ev.title)}</a>
          </div>
          <div style="font-size:13px;line-height:1.5;color:#d4d4d8;">${escapeHtml(ev.summary || '')}</div>
          ${ev.why_it_matters ? `<div style="font-size:12px;line-height:1.45;color:#a1a1aa;margin-top:6px;"><strong>Por que importa:</strong> ${escapeHtml(ev.why_it_matters)}</div>` : ''}
        </td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;background:#050505;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" style="max-width:600px;margin:0 auto;width:100%;background:#111216;border:1px solid #22242a;border-radius:16px;padding:24px;">
    <tr>
      <td>
        <div style="font-size:11px;letter-spacing:0.12em;color:#a1a1aa;font-weight:700;margin-bottom:8px;">FATOSBR · ${badge}</div>
        <h1 style="margin:0 0 8px 0;font-size:22px;color:#ffffff;">${escapeHtml(params.title)}</h1>
        <p style="margin:0 0 20px 0;font-size:14px;color:#a1a1aa;line-height:1.5;">${escapeHtml(params.description)}</p>
      </td>
    </tr>
    ${itemsHtml}
    <tr>
      <td style="padding-top:20px;font-size:11px;color:#71717a;text-align:center;">
        FatosBR · <a href="${escapeHtml(`${appBaseUrl}/?tab=briefings`)}" style="color:#a1a1aa;text-decoration:underline;">Ler na plataforma</a> · <a href="${escapeHtml(`${appBaseUrl}/?tab=profile`)}" style="color:#a1a1aa;text-decoration:underline;">Gerenciar preferências</a>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function fetchUserSchedulePreferences(
  supabase: any,
  userId: string
): Promise<{
  timezone: string;
  morningTime: string;
  eveningTime: string;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  briefingEmail: string | null;
}> {
  let prefRow: any = null;
  let settingsRow: any = null;

  try {
    let { data, error } = await supabase
      .from('user_preferences')
      .select('timezone, morning_time, evening_time, email_morning_briefing, email_evening_briefing, briefing_email')
      .eq('id', userId)
      .maybeSingle();

    if (error && isMissingColumnError(error)) {
      const retry = await supabase
        .from('user_preferences')
        .select('timezone, email_morning_briefing, email_evening_briefing, briefing_email')
        .eq('id', userId)
        .maybeSingle();
      data = retry.data;
    }
    prefRow = data || null;
  } catch {}

  try {
    let { data, error } = await supabase
      .from('user_settings')
      .select('timezone, morning_time, evening_time, email_morning_briefing, email_evening_briefing, briefing_email')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && isMissingColumnError(error)) {
      const retry = await supabase
        .from('user_settings')
        .select('timezone, briefing_email')
        .eq('user_id', userId)
        .maybeSingle();
      data = retry.data;
    }
    settingsRow = data || null;
  } catch {}

  const rawMorningEnabled = settingsRow?.email_morning_briefing ?? prefRow?.email_morning_briefing;
  const rawEveningEnabled = settingsRow?.email_evening_briefing ?? prefRow?.email_evening_briefing;
  const rawEmail = settingsRow?.briefing_email || prefRow?.briefing_email || null;

  return {
    timezone: resolveTimezone(prefRow?.timezone || settingsRow?.timezone),
    morningTime: normalizeScheduleTime(
      prefRow?.morning_time || settingsRow?.morning_time,
      DEFAULT_MORNING_TIME
    ),
    eveningTime: normalizeScheduleTime(
      prefRow?.evening_time || settingsRow?.evening_time,
      DEFAULT_EVENING_TIME
    ),
    morningEnabled: rawMorningEnabled !== false,
    eveningEnabled: rawEveningEnabled !== false,
    briefingEmail: rawEmail ? String(rawEmail).trim() : null,
  };
}

export const briefingEngine = {
  /**
   * Lista usuários elegíveis a partir de public.user_preferences / public.user_settings,
   * respeitando preferências de horário (morning_time / evening_time) e fuso horário individual.
   */
  async listEligibleUsers(
    type: BriefingEditionType,
    referenceDate = new Date(),
    options?: { respectScheduleWindow?: boolean }
  ): Promise<EligibleBriefingUser[]> {
    const { getServerSupabase: getSb } = getDeps();
    const supabase = getSb();

    const fetchPrefs = async () => {
      const full = await (supabase as any)
        .from('user_preferences')
        .select(
          'id, briefing_email, email_morning_briefing, email_evening_briefing, weekend_edition, timezone, morning_time, evening_time'
        );
      if (full?.error && isMissingColumnError(full.error)) {
        return (supabase as any)
          .from('user_preferences')
          .select(
            'id, briefing_email, email_morning_briefing, email_evening_briefing, weekend_edition, timezone'
          );
      }
      return full;
    };

    const fetchSettings = async () => {
      const full = await (supabase as any)
        .from('user_settings')
        .select(
          'user_id, briefing_email, email_morning_briefing, email_evening_briefing, weekend_edition, timezone, morning_time, evening_time, notification_settings'
        );
      if (full?.error && isMissingColumnError(full.error)) {
        return (supabase as any)
          .from('user_settings')
          .select(
            'user_id, briefing_email, email_morning_briefing, email_evening_briefing, weekend_edition, timezone, notification_settings'
          );
      }
      return full;
    };

    const [prefsRes, settingsRes] = await Promise.all([fetchPrefs(), fetchSettings()]);

    const prefsMissing = Boolean(prefsRes?.error && isMissingRelationError(prefsRes.error));
    const settingsMissing = Boolean(settingsRes?.error && isMissingRelationError(settingsRes.error));

    if (prefsRes?.error && !prefsMissing) {
      throw new Error(`Falha ao consultar user_preferences: ${prefsRes.error.message}`);
    }
    if (settingsRes?.error && !settingsMissing && prefsMissing) {
      throw new Error(`Falha ao consultar user_settings: ${settingsRes.error.message}`);
    }

    const mergedByUser = new Map<string, any>();

    for (const row of prefsRes?.data || []) {
      const uid = row?.id ? String(row.id) : '';
      if (uid) mergedByUser.set(uid, { ...row });
    }

    for (const sRow of settingsRes?.data || []) {
      const uid = sRow?.user_id ? String(sRow.user_id) : '';
      if (!uid) continue;
      const existing = mergedByUser.get(uid) || {};
      mergedByUser.set(uid, {
        ...existing,
        briefing_email: sRow.briefing_email ?? existing.briefing_email,
        email_morning_briefing: sRow.email_morning_briefing ?? existing.email_morning_briefing,
        email_evening_briefing: sRow.email_evening_briefing ?? existing.email_evening_briefing,
        weekend_edition: sRow.weekend_edition ?? existing.weekend_edition,
        timezone: existing.timezone ?? sRow.timezone,
        morning_time: existing.morning_time ?? sRow.morning_time,
        evening_time: existing.evening_time ?? sRow.evening_time,
        notification_settings: sRow.notification_settings ?? existing.notification_settings,
      });
    }

    const users: EligibleBriefingUser[] = [];
    for (const [uid, row] of mergedByUser.entries()) {
      const morningEnabled = row.email_morning_briefing !== false;
      const eveningEnabled = row.email_evening_briefing !== false;
      const weekendEdition = Boolean(row.weekend_edition);
      const timezone = resolveTimezone(row.timezone);
      const morningTime = normalizeScheduleTime(row.morning_time, DEFAULT_MORNING_TIME);
      const eveningTime = normalizeScheduleTime(row.evening_time, DEFAULT_EVENING_TIME);

      if (type === 'MORNING' && !morningEnabled) continue;
      if (type === 'EVENING' && !eveningEnabled) continue;
      if (!weekendEdition && isWeekendInTimezone(referenceDate, timezone)) continue;

      const userCandidate: EligibleBriefingUser = {
        userId: uid,
        email: row.briefing_email ? String(row.briefing_email).trim() : null,
        morningEnabled,
        eveningEnabled,
        weekendEdition,
        timezone,
        morningTime,
        eveningTime,
      };

      if (
        options?.respectScheduleWindow &&
        !isUserWithinScheduleWindow(userCandidate, type, referenceDate)
      ) {
        continue;
      }

      users.push(userCandidate);
    }

    return users;
  },

  async prefetchEventPool(
    options?: { windowHours?: number; referenceDate?: Date }
  ): Promise<PrefetchedBriefingEventPool> {
    const { getServerSupabase: getSb } = getDeps();
    const supabase = getSb();
    const windowHours = Math.max(6, options?.windowHours ?? 36);
    const anchorMs = (options?.referenceDate || new Date()).getTime();
    const cutoffIso = new Date(anchorMs - windowHours * 3600 * 1000).toISOString();

    const safeSelect = async (fn: () => Promise<any>) => {
      try {
        const res = await fn();
        if (res?.error && (isMissingRelationError(res.error) || isMissingColumnError(res.error))) {
          return { data: [], error: null };
        }
        return res;
      } catch {
        return { data: [], error: null };
      }
    };

    const recentEventsRes = await (supabase as any)
      .from('events')
      .select('id, title, summary, why_it_matters, relevance_score, published_at')
      .gte('published_at', cutoffIso)
      .order('relevance_score', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(40);

    if (recentEventsRes.error) {
      throw new Error(`Falha ao consultar acontecimentos reais: ${recentEventsRes.error.message}`);
    }

    const candidates: BriefingEventCandidate[] = (recentEventsRes.data || [])
      .filter((e: any) => e?.id && e?.title)
      .map((e: any) => ({
        id: String(e.id),
        title: String(e.title),
        summary: String(e.summary || ''),
        why_it_matters: e.why_it_matters ? String(e.why_it_matters) : undefined,
        relevance_score: Number(e.relevance_score ?? 75),
        published_at: String(e.published_at || new Date().toISOString()),
      }));

    if (candidates.length === 0) {
      return {
        cutoffIso,
        candidates: [],
        eeRows: [],
        etRows: [],
        eaRows: [],
        articleSourceById: new Map(),
        esRows: [],
      };
    }

    const candidateIds = candidates.map((c) => c.id);
    const [eeRes, etRes, eaRes, esRes] = await Promise.all([
      safeSelect(() => (supabase as any).from('event_entities').select('event_id, entity_id').in('event_id', candidateIds)),
      safeSelect(() => (supabase as any).from('event_topics').select('event_id, topic_id').in('event_id', candidateIds)),
      safeSelect(() => (supabase as any).from('event_articles').select('event_id, article_id').in('event_id', candidateIds)),
      safeSelect(() => (supabase as any).from('event_sources').select('event_id, source_id').in('event_id', candidateIds)),
    ]);

    const eaRows = (eaRes.data || [])
      .filter((r: any) => r?.event_id && r?.article_id)
      .map((r: any) => ({ event_id: String(r.event_id), article_id: String(r.article_id) }));
    const articleIds = Array.from(new Set(eaRows.map((r: any) => r.article_id)));
    const articleSourceById = new Map<string, string>();

    if (articleIds.length > 0) {
      const { data: artRows } = await safeSelect(() =>
        (supabase as any).from('articles').select('id, source_id').in('id', articleIds)
      );
      for (const a of artRows || []) {
        if (a?.id && a?.source_id) {
          articleSourceById.set(String(a.id), String(a.source_id));
        }
      }
    }

    return {
      cutoffIso,
      candidates,
      eeRows: (eeRes.data || []).map((r: any) => ({
        event_id: String(r.event_id),
        entity_id: String(r.entity_id),
      })),
      etRows: (etRes.data || []).map((r: any) => ({
        event_id: String(r.event_id),
        topic_id: String(r.topic_id),
      })),
      eaRows,
      articleSourceById,
      esRows: (esRes.data || [])
        .filter((r: any) => r?.event_id && r?.source_id)
        .map((r: any) => ({
          event_id: String(r.event_id),
          source_id: String(r.source_id),
        })),
    };
  },

  /**
   * Etapa 1: Seleção de acontecimentos reais persistidos para o usuário (nunca inventa notícias).
   */
  async selectEventsForUser(
    userId: string,
    options?: {
      windowHours?: number;
      limit?: number;
      referenceDate?: Date;
      prefetchedPool?: PrefetchedBriefingEventPool;
    }
  ): Promise<BriefingEventCandidate[]> {
    const { getServerSupabase: getSb } = getDeps();
    const supabase = getSb();
    const limit = Math.max(1, Math.min(10, options?.limit ?? 6));
    const windowHours = Math.max(6, options?.windowHours ?? 36);
    const anchorMs = (options?.referenceDate || new Date()).getTime();
    const cutoffIso = new Date(anchorMs - windowHours * 3600 * 1000).toISOString();
    const pool = options?.prefetchedPool;

    const safeSelect = async (fn: () => Promise<any>) => {
      try {
        const res = await fn();
        if (res?.error && (isMissingRelationError(res.error) || isMissingColumnError(res.error))) {
          return { data: [], error: null };
        }
        return res;
      } catch {
        return { data: [], error: null };
      }
    };

    const [entFollowRes, topicFollowRes, sourceFollowRes, recentEventsRes] = await Promise.all([
      safeSelect(() => (supabase as any).from('user_entity_follows').select('entity_id').eq('user_id', userId)),
      safeSelect(() => (supabase as any).from('user_topic_follows').select('topic_id').eq('user_id', userId)),
      safeSelect(() => (supabase as any).from('user_source_follows').select('source_id').eq('user_id', userId)),
      pool
        ? Promise.resolve({ data: pool.candidates, error: null })
        : (supabase as any)
            .from('events')
            .select('id, title, summary, why_it_matters, relevance_score, published_at')
            .gte('published_at', cutoffIso)
            .order('relevance_score', { ascending: false })
            .order('published_at', { ascending: false })
            .limit(40),
    ]);

    if (recentEventsRes.error) {
      throw new Error(`Falha ao consultar acontecimentos reais: ${recentEventsRes.error.message}`);
    }

    const candidates: BriefingEventCandidate[] = pool
      ? pool.candidates
      : (recentEventsRes.data || [])
          .filter((e: any) => e?.id && e?.title)
          .map((e: any) => ({
            id: String(e.id),
            title: String(e.title),
            summary: String(e.summary || ''),
            why_it_matters: e.why_it_matters ? String(e.why_it_matters) : undefined,
            relevance_score: Number(e.relevance_score ?? 75),
            published_at: String(e.published_at || new Date().toISOString()),
          }));

    if (candidates.length === 0) {
      return [];
    }

    const followedEntityIds = new Set(
      (entFollowRes.data || []).map((r: any) => String(r.entity_id)).filter(Boolean)
    );
    const followedTopicIds = new Set(
      (topicFollowRes.data || []).map((r: any) => String(r.topic_id)).filter(Boolean)
    );
    const followedSourceIds = new Set(
      (sourceFollowRes.data || []).map((r: any) => String(r.source_id)).filter(Boolean)
    );

    const boostedEventSignals = new Map<string, number>();
    const addBoost = (eventId: string) => {
      boostedEventSignals.set(eventId, (boostedEventSignals.get(eventId) || 0) + 1);
    };
    const candidateIds = candidates.map((c) => c.id);

    if (followedEntityIds.size > 0 && candidateIds.length > 0) {
      const eeRows = pool
        ? pool.eeRows
        : (
            await safeSelect(() =>
              (supabase as any).from('event_entities').select('event_id, entity_id').in('event_id', candidateIds)
            )
          ).data || [];
      for (const r of eeRows) {
        if (followedEntityIds.has(String(r.entity_id))) {
          addBoost(String(r.event_id));
        }
      }
    }

    if (followedTopicIds.size > 0 && candidateIds.length > 0) {
      const etRows = pool
        ? pool.etRows
        : (
            await safeSelect(() =>
              (supabase as any).from('event_topics').select('event_id, topic_id').in('event_id', candidateIds)
            )
          ).data || [];
      for (const r of etRows) {
        if (followedTopicIds.has(String(r.topic_id))) {
          addBoost(String(r.event_id));
        }
      }
    }

    if (followedSourceIds.size > 0 && candidateIds.length > 0) {
      const matchedEventsBySource = new Set<string>();
      const eaRows = pool
        ? pool.eaRows
        : (
            await safeSelect(() =>
              (supabase as any).from('event_articles').select('event_id, article_id').in('event_id', candidateIds)
            )
          ).data || [];

      if (pool) {
        for (const r of eaRows) {
          const sid = pool.articleSourceById.get(String(r.article_id));
          if (sid && followedSourceIds.has(sid) && r?.event_id) {
            matchedEventsBySource.add(String(r.event_id));
          }
        }
      } else {
        const articleIds = Array.from(
          new Set((eaRows || []).map((r: any) => (r?.article_id ? String(r.article_id) : '')).filter(Boolean))
        );
        if (articleIds.length > 0) {
          const { data: artRows } = await safeSelect(() =>
            (supabase as any).from('articles').select('id, source_id').in('id', articleIds)
          );
          const matchedArticleIds = new Set(
            (artRows || [])
              .filter((a: any) => a?.source_id && followedSourceIds.has(String(a.source_id)))
              .map((a: any) => String(a.id))
          );
          for (const r of eaRows || []) {
            if (r?.article_id && matchedArticleIds.has(String(r.article_id)) && r?.event_id) {
              matchedEventsBySource.add(String(r.event_id));
            }
          }
        }
      }

      // Compatibilidade com eventual tabela event_sources
      const esRows = pool
        ? pool.esRows
        : (
            await safeSelect(() =>
              (supabase as any).from('event_sources').select('event_id, source_id').in('event_id', candidateIds)
            )
          ).data || [];
      for (const r of esRows) {
        if (r?.source_id && followedSourceIds.has(String(r.source_id)) && r?.event_id) {
          matchedEventsBySource.add(String(r.event_id));
        }
      }

      for (const eid of matchedEventsBySource) {
        addBoost(eid);
      }
    }

    const ranked = [...candidates]
      .map((c) => {
        const matchCount = boostedEventSignals.get(c.id) || 0;
        return {
          ...c,
          isFollowedMatch: matchCount > 0,
          _boostPoints: matchCount > 0 ? 25 + Math.min(matchCount - 1, 3) * 10 : 0,
        };
      })
      .sort((a, b) => {
        const scoreDiff = b.relevance_score + b._boostPoints - (a.relevance_score + a._boostPoints);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
      })
      .map(({ _boostPoints, ...rest }) => rest);

    return ranked.slice(0, limit);
  },

  /**
   * Executa as etapas 1..7 para um usuário específico com prevenção de duplicidade por (user_id, type, local_date).
   */
  async generateForUser(params: {
    userId: string;
    type: BriefingEditionType;
    briefingEmail?: string | null;
    sendEmail?: boolean;
    referenceDate?: Date;
    timezone?: string | null;
    morningTime?: string | null;
    eveningTime?: string | null;
    retryDelayBaseMs?: number;
    prefetchedEventPool?: PrefetchedBriefingEventPool;
  }): Promise<GenerateBriefingResult> {
    const { getServerSupabase: getSb, getServerKeys: getKeys, fetchFn } = getDeps();
    const supabase = getSb();
    const refDate = params.referenceDate || new Date();

    const userSchedule = await fetchUserSchedulePreferences(supabase, params.userId);

    const effectiveTimezone = params.timezone ? resolveTimezone(params.timezone) : userSchedule.timezone;
    const effectiveMorningTime = params.morningTime
      ? normalizeScheduleTime(params.morningTime, DEFAULT_MORNING_TIME)
      : userSchedule.morningTime;
    const effectiveEveningTime = params.eveningTime
      ? normalizeScheduleTime(params.eveningTime, DEFAULT_EVENING_TIME)
      : userSchedule.eveningTime;
    const resolvedEmail =
      (params.briefingEmail ? String(params.briefingEmail).trim() : '') ||
      userSchedule.briefingEmail ||
      '';
    const userEditionOptIn =
      params.type === 'EVENING' ? userSchedule.eveningEnabled : userSchedule.morningEnabled;

    const { localDate, dayStart, dayEnd, periodStart, periodEnd, scheduledFor, dateLabelPt } =
      getBriefingPeriodWindow(params.type, refDate, {
        timezone: effectiveTimezone,
        morningTime: effectiveMorningTime,
        eveningTime: effectiveEveningTime,
      });

    // Verifica duplicidade utilizando preferencialmente (user_id, type, local_date),
    // alinhado a idx_briefing_delivery_slot, com fallback para (period_start, period_end) ou dia local.
    let existing: { id?: string; status?: string; updated_at?: string; sent_at?: string | null } | null = null;
    let dupErr: any = null;

    const selectSlotCols = async (buildQuery: (cols: string) => Promise<any>) => {
      const full = await buildQuery('id, status, updated_at, sent_at');
      if (full?.error && isMissingColumnError(full.error)) {
        return buildQuery('id, status');
      }
      return full;
    };

    const localDateCheck = await selectSlotCols((cols) =>
      (supabase as any)
        .from('briefings')
        .select(cols)
        .eq('user_id', params.userId)
        .eq('type', params.type)
        .eq('local_date', localDate)
        .maybeSingle()
    );

    if (!localDateCheck.error) {
      existing = localDateCheck.data;
    } else if (isMissingColumnError(localDateCheck.error)) {
      const periodCheck = await selectSlotCols((cols) =>
        (supabase as any)
          .from('briefings')
          .select(cols)
          .eq('user_id', params.userId)
          .eq('type', params.type)
          .eq('period_start', periodStart)
          .eq('period_end', periodEnd)
          .maybeSingle()
      );

      if (!periodCheck.error) {
        existing = periodCheck.data;
      } else if (isMissingColumnError(periodCheck.error)) {
        const dayCheck = await selectSlotCols((cols) =>
          (supabase as any)
            .from('briefings')
            .select(cols)
            .eq('user_id', params.userId)
            .eq('type', params.type)
            .gte('scheduled_for', dayStart)
            .lte('scheduled_for', dayEnd)
            .maybeSingle()
        );
        existing = dayCheck.data;
        dupErr = dayCheck.error;
      } else {
        dupErr = periodCheck.error;
      }
    } else {
      dupErr = localDateCheck.error;
    }

    if (dupErr) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'FAILED',
        localDate,
        periodStart,
        periodEnd,
        eventsCount: 0,
        error: sanitizeRunErrorMessage(`Falha ao verificar duplicidade de briefing: ${dupErr.message}`),
      };
    }

    const existingUpdatedMs = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
    const isStaleGenerating =
      existing?.status === 'GENERATING' &&
      existingUpdatedMs > 0 &&
      refDate.getTime() - existingUpdatedMs > STALE_GENERATING_MS;

    const isRecoverableExisting = Boolean(
      existing?.id &&
        (existing.status === 'FAILED' || existing.status === 'CANCELED' || isStaleGenerating)
    );

    let prefetchedDelivery: Awaited<ReturnType<typeof getDeliveryRecord>> = null;
    let isReconcilingReadyEmail = false;

    if (existing?.id && existing.status === 'READY' && params.sendEmail === true) {
      prefetchedDelivery = await getDeliveryRecord(String(existing.id));
      if (!prefetchedDelivery || prefetchedDelivery.status === 'PENDING') {
        // Briefing estava READY sem envio prévio por e-mail
        isReconcilingReadyEmail = true;
      } else if (
        prefetchedDelivery.status === 'ACCEPTED' ||
        prefetchedDelivery.status === 'DELIVERED'
      ) {
        // Resend aceitou (2xx), porém atualização de public.briefings para SENT falhou anteriormente
        isReconcilingReadyEmail = true;
      } else if (prefetchedDelivery.status === 'FAILED') {
        // Só retenta envio automático se a janela de backoff (next_retry_at) já tiver expirado
        const nextRetryMs = prefetchedDelivery.next_retry_at
          ? new Date(prefetchedDelivery.next_retry_at).getTime()
          : Number.POSITIVE_INFINITY;
        isReconcilingReadyEmail = Number.isFinite(nextRetryMs) && nextRetryMs <= Date.now();
      } else {
        // SENDING / BOUNCED / COMPLAINED / DELAYED: evita reenvio imediato duplicado
        isReconcilingReadyEmail = false;
      }
    }

    if (existing?.id && !isRecoverableExisting && !isReconcilingReadyEmail) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'SKIPPED_DUPLICATE',
        briefingId: String(existing.id),
        localDate,
        periodStart,
        periodEnd,
        eventsCount: 0,
      };
    }

    // Etapa 1: Selecionar acontecimentos reais (não cria/sobrescreve briefing vazio como completo)
    const selectedEvents = await this.selectEventsForUser(params.userId, {
      referenceDate: refDate,
      prefetchedPool: params.prefetchedEventPool,
    });
    if (selectedEvents.length === 0 && !isReconcilingReadyEmail) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'SKIPPED_NO_EVENTS',
        localDate,
        periodStart,
        periodEnd,
        eventsCount: 0,
      };
    }

    const title =
      params.type === 'EVENING'
        ? `Briefing Noturno • ${dateLabelPt}`
        : `Briefing Matinal • ${dateLabelPt}`;
    const description =
      params.type === 'EVENING'
        ? 'O fechamento dos principais acontecimentos apurados ao longo do dia.'
        : 'Os principais acontecimentos consolidados para iniciar o dia.';

    // Etapa 2: Criação do registro (ou recuperação / reconciliação de envio)
    let briefingId = '';
    const recoveredFromStatus = isRecoverableExisting ? String(existing?.status || '') : undefined;

    if (isReconcilingReadyEmail && existing?.id) {
      briefingId = String(existing.id);
    } else if (isRecoverableExisting && existing?.id) {
      briefingId = String(existing.id);

      // Limpa itens órfãos anteriores desse mesmo briefing antes de reescrever
      try {
        await (supabase as any).from('briefing_items').delete().eq('briefing_id', briefingId);
      } catch {}

      const nowIso = new Date().toISOString();
      const recoverPayload: Record<string, any> = {
        title,
        description,
        status: 'GENERATING',
        period_start: periodStart,
        period_end: periodEnd,
        scheduled_for: scheduledFor,
        local_date: localDate,
        sent_at: null,
        updated_at: nowIso,
      };

      let { error: recErr } = await (supabase as any)
        .from('briefings')
        .update(recoverPayload)
        .eq('id', briefingId);

      if (recErr && isMissingColumnError(recErr)) {
        const msg = String(recErr.message || '').toLowerCase();
        const fallbackUpdate = { ...recoverPayload };
        if (msg.includes('local_date')) delete fallbackUpdate.local_date;
        if (msg.includes('sent_at')) delete fallbackUpdate.sent_at;
        const retry = await (supabase as any)
          .from('briefings')
          .update(fallbackUpdate)
          .eq('id', briefingId);
        recErr = retry.error;
      }

      if (recErr) {
        return {
          userId: params.userId,
          type: params.type,
          status: 'FAILED',
          briefingId,
          localDate,
          periodStart,
          periodEnd,
          eventsCount: 0,
          recoveredFromStatus,
          error: sanitizeRunErrorMessage(`Falha ao reprocessar slot ${briefingId}: ${recErr.message}`),
        };
      }
    } else {
      const baseInsertPayload = {
        user_id: params.userId,
        type: params.type,
        local_date: localDate,
        title,
        description,
        status: 'GENERATING',
        period_start: periodStart,
        period_end: periodEnd,
        scheduled_for: scheduledFor,
      };

      let { data: createdRow, error: createErr } = await (supabase as any)
        .from('briefings')
        .insert(baseInsertPayload)
        .select('id')
        .single();

      if (
        createErr &&
        isMissingColumnError(createErr) &&
        String(createErr.message || '').toLowerCase().includes('local_date')
      ) {
        const { local_date: _omitted, ...fallbackPayload } = baseInsertPayload;
        const retry = await (supabase as any)
          .from('briefings')
          .insert(fallbackPayload)
          .select('id')
          .single();
        createdRow = retry.data;
        createErr = retry.error;
      }

      if (createErr || !createdRow?.id) {
        if (createErr?.code === '23505') {
          let conflictId: string | undefined;
          const byLocalDate = await (supabase as any)
            .from('briefings')
            .select('id')
            .eq('user_id', params.userId)
            .eq('type', params.type)
            .eq('local_date', localDate)
            .maybeSingle();

          if (!byLocalDate.error && byLocalDate.data?.id) {
            conflictId = String(byLocalDate.data.id);
          } else {
            const byPeriod = await (supabase as any)
              .from('briefings')
              .select('id')
              .eq('user_id', params.userId)
              .eq('type', params.type)
              .eq('period_start', periodStart)
              .maybeSingle();
            if (byPeriod?.data?.id) {
              conflictId = String(byPeriod.data.id);
            }
          }

          return {
            userId: params.userId,
            type: params.type,
            status: 'SKIPPED_DUPLICATE',
            briefingId: conflictId,
            localDate,
            periodStart,
            periodEnd,
            eventsCount: 0,
          };
        }
        return {
          userId: params.userId,
          type: params.type,
          status: 'FAILED',
          localDate,
          periodStart,
          periodEnd,
          eventsCount: 0,
          error: sanitizeRunErrorMessage(
            createErr?.message || 'Falha ao inserir registro inicial de briefing.'
          ),
        };
      }

      briefingId = String(createdRow.id);
    }

    let notifCreated = false;
    if (!isReconcilingReadyEmail) {
      // Etapa 3: Persistir itens ordenados em public.briefing_items
      // Popula position (e order_index quando a coluna existe no esquema) com section canônico
      const itemsWithDualOrder = selectedEvents.map((ev, index) => ({
        briefing_id: briefingId,
        event_id: ev.id,
        position: index + 1,
        order_index: index + 1,
        section: classifyBriefingItemSection(ev, index, selectedEvents.length),
      }));

      let { error: itemsErr } = await (supabase as any).from('briefing_items').insert(itemsWithDualOrder);

      if (itemsErr && isMissingColumnError(itemsErr)) {
        const errMsg = String(itemsErr.message || '').toLowerCase();
        if (errMsg.includes('position') && !errMsg.includes('order_index')) {
          const onlyOrderIndex = itemsWithDualOrder.map(({ position: _p, ...rest }) => rest);
          const retry = await (supabase as any).from('briefing_items').insert(onlyOrderIndex);
          itemsErr = retry.error;
        } else {
          const onlyPosition = itemsWithDualOrder.map(({ order_index: _o, ...rest }) => rest);
          const retry = await (supabase as any).from('briefing_items').insert(onlyPosition);
          itemsErr = retry.error;
        }
      }

      if (itemsErr) {
        await (supabase as any)
          .from('briefings')
          .update({ status: 'FAILED', updated_at: new Date().toISOString() })
          .eq('id', briefingId);
        return {
          userId: params.userId,
          type: params.type,
          status: 'FAILED',
          briefingId,
          localDate,
          periodStart,
          periodEnd,
          eventsCount: 0,
          recoveredFromStatus,
          error: sanitizeRunErrorMessage(`Falha ao persistir itens do briefing: ${itemsErr.message}`),
        };
      }

      // Etapa 4: Atualizar para READY
      const { error: readyErr } = await (supabase as any)
        .from('briefings')
        .update({ status: 'READY', updated_at: new Date().toISOString() })
        .eq('id', briefingId);

      if (readyErr) {
        return {
          userId: params.userId,
          type: params.type,
          status: 'FAILED',
          briefingId,
          localDate,
          periodStart,
          periodEnd,
          eventsCount: selectedEvents.length,
          recoveredFromStatus,
          error: sanitizeRunErrorMessage(`Itens salvos, mas falhou atualização para READY: ${readyErr.message}`),
        };
      }

      // Etapa 5: Criar notificação BRIEFING_READY (respeitando preferência dailyBriefings)
      const notifRes = await notificationEngine.createBriefingReadyNotification({
        userId: params.userId,
        briefingId,
        briefingType: params.type,
        title,
        eventsCount: selectedEvents.length,
      });
      notifCreated = Boolean(notifRes.success && !notifRes.skipped);
    }

    // Etapas 6 & 7: Envio por e-mail somente se solicitado, opt-in ativo, não enviado antes e Resend operacional
    if (!params.sendEmail || !resolvedEmail) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'READY',
        briefingId,
        localDate,
        periodStart,
        periodEnd,
        eventsCount: selectedEvents.length,
        notificationCreated: notifCreated,
        emailSent: false,
        emailSkippedReason: 'DISABLED_OR_NO_EMAIL',
        recoveredFromStatus,
      };
    }

    if (!userEditionOptIn) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'READY',
        briefingId,
        localDate,
        periodStart,
        periodEnd,
        eventsCount: selectedEvents.length,
        notificationCreated: notifCreated,
        emailSent: false,
        emailSkippedReason: 'OPTED_OUT',
        recoveredFromStatus,
      };
    }

    // Proteção extra anti-reenvio + reconciliação de entrega já aceita em internal.briefing_email_deliveries
    try {
      const { data: sendCheck } = await (supabase as any)
        .from('briefings')
        .select('status, sent_at')
        .eq('id', briefingId)
        .maybeSingle();
      if (sendCheck && (sendCheck.status === 'SENT' || sendCheck.sent_at)) {
        return {
          userId: params.userId,
          type: params.type,
          status: 'SENT',
          briefingId,
          localDate,
          periodStart,
          periodEnd,
          eventsCount: selectedEvents.length,
          notificationCreated: notifCreated,
          emailSent: false,
          emailSkippedReason: 'ALREADY_SENT',
          recoveredFromStatus,
        };
      }
    } catch {}

    const priorDelivery = prefetchedDelivery || (await getDeliveryRecord(briefingId));
    if (priorDelivery && (priorDelivery.status === 'ACCEPTED' || priorDelivery.status === 'DELIVERED')) {
      const reconciledAt = priorDelivery.accepted_at || new Date().toISOString();
      await (supabase as any)
        .from('briefings')
        .update({ status: 'SENT', sent_at: reconciledAt, updated_at: new Date().toISOString() })
        .eq('id', briefingId);

      return {
        userId: params.userId,
        type: params.type,
        status: 'SENT',
        briefingId,
        localDate,
        periodStart,
        periodEnd,
        eventsCount: selectedEvents.length,
        notificationCreated: notifCreated,
        emailSent: false,
        emailSkippedReason: 'ALREADY_SENT',
        providerMessageId: priorDelivery.provider_message_id || undefined,
        deliveryStatus: priorDelivery.status,
        reconciledFromDelivery: true,
        recoveredFromStatus,
      };
    }

    const apiKey = getKeys().RESEND;
    if (!apiKey) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'READY',
        briefingId,
        localDate,
        periodStart,
        periodEnd,
        eventsCount: selectedEvents.length,
        notificationCreated: notifCreated,
        emailSent: false,
        emailSkippedReason: 'RESEND_UNCONFIGURED',
        emailError: 'RESEND_API_KEY não configurada no servidor.',
        recoveredFromStatus,
      };
    }

    const from = getResendFromEmail();
    const idempotencyKey = buildBriefingEmailIdempotencyKey(briefingId, params.type, localDate);

    await persistDeliveryRecord({
      briefingId,
      userId: params.userId,
      editionType: params.type,
      idempotencyKey,
      fromEmail: from,
      status: 'SENDING',
      incrementAttempt: true,
    });

    const html = renderBriefingEmailHtml({
      title,
      description,
      type: params.type,
      events: selectedEvents,
    });

    const sendRes = await sendResendEmailWithRetry({
      apiKey,
      from,
      to: [resolvedEmail],
      subject: `FatosBR • ${title}`,
      html,
      text: `${title} — ${description}`,
      idempotencyKey,
      fetchFn,
      retryDelayBaseMs: params.retryDelayBaseMs ?? 150,
    });

    if (!sendRes.accepted) {
      const nextRetryAt = sendRes.retryable
        ? new Date(Date.now() + 60_000).toISOString()
        : null;
      await persistDeliveryRecord({
        briefingId,
        userId: params.userId,
        editionType: params.type,
        idempotencyKey,
        fromEmail: from,
        status: 'FAILED',
        lastHttpStatus: sendRes.statusCode,
        lastError: sendRes.error || 'RESEND_SEND_FAILED',
        nextRetryAt,
      });

      return {
        userId: params.userId,
        type: params.type,
        status: 'READY',
        briefingId,
        localDate,
        periodStart,
        periodEnd,
        eventsCount: selectedEvents.length,
        notificationCreated: notifCreated,
        emailSent: false,
        deliveryStatus: 'FAILED',
        emailError: sanitizeRunErrorMessage(sendRes.error || `Resend HTTP ${sendRes.statusCode}`),
        recoveredFromStatus,
      };
    }

    // Resend aceitou (HTTP 2xx): registra imediatamente ACCEPTED em internal.briefing_email_deliveries
    await persistDeliveryRecord({
      briefingId,
      userId: params.userId,
      editionType: params.type,
      idempotencyKey,
      fromEmail: from,
      status: 'ACCEPTED',
      providerMessageId: sendRes.messageId || null,
      lastHttpStatus: sendRes.statusCode,
    });

    // Atualiza public.briefings para SENT apenas após 2xx; se o UPDATE no banco falhar agora,
    // a tentativa permanece ACCEPTED em briefing_email_deliveries evitando reenvio duplicado.
    const nowIso = new Date().toISOString();
    const { error: sentUpdateErr } = await (supabase as any)
      .from('briefings')
      .update({ status: 'SENT', sent_at: nowIso, updated_at: nowIso })
      .eq('id', briefingId);

    if (sentUpdateErr) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'READY',
        briefingId,
        localDate,
        periodStart,
        periodEnd,
        eventsCount: selectedEvents.length,
        notificationCreated: notifCreated,
        emailSent: true,
        providerMessageId: sendRes.messageId,
        deliveryStatus: 'ACCEPTED',
        emailError: sanitizeRunErrorMessage(
          `E-mail aceito pelo Resend, mas falhou persistência de SENT em public.briefings: ${sentUpdateErr.message}`
        ),
        recoveredFromStatus,
      };
    }

    return {
      userId: params.userId,
      type: params.type,
      status: 'SENT',
      briefingId,
      localDate,
      periodStart,
      periodEnd,
      eventsCount: selectedEvents.length,
      notificationCreated: notifCreated,
      emailSent: true,
      providerMessageId: sendRes.messageId,
      deliveryStatus: 'ACCEPTED',
      recoveredFromStatus,
    };
  },

  recordRunLog(
    entry: Omit<BriefingRunLogEntry, 'runId'>,
    options?: { skipDbPersist?: boolean }
  ): BriefingRunLogEntry {
    const fullEntry: BriefingRunLogEntry = {
      ...entry,
      runId: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      error: entry.error ? sanitizeRunErrorMessage(entry.error) : undefined,
    };
    recentRunLogs.unshift(fullEntry);
    if (recentRunLogs.length > MAX_RUN_LOGS) {
      recentRunLogs.length = MAX_RUN_LOGS;
    }
    if (!options?.skipDbPersist) {
      void persistJobRunToStore(fullEntry);
    }
    return fullEntry;
  },

  getRecentRunLogs(): BriefingRunLogEntry[] {
    return recentRunLogs.map((l) => ({ ...l }));
  },

  async listActiveLocks(): Promise<Array<{ lockKey: string; expiresAt: string; heartbeatAt: string }>> {
    return listActiveDistributedLocks(getLockDepsFromEngine());
  },

  getActiveLocks(): string[] {
    return [];
  },

  /**
   * Executa um ciclo completo de geração para todos os usuários elegíveis,
   * protegido por trava distribuída persistente fail-closed (internal.distributed_job_locks).
   */
  async runGenerationCycle(options: {
    type: BriefingEditionType;
    sendEmail?: boolean;
    referenceDate?: Date;
    respectScheduleWindow?: boolean;
  }): Promise<{
    locked?: boolean;
    lockKey?: string;
    eligibleUsers: number;
    ready: number;
    sent: number;
    skippedDuplicates: number;
    skippedNoEvents: number;
    failed: number;
    results: GenerateBriefingResult[];
  }> {
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const refDate = options.referenceDate || new Date();
    const brParts = getZonedDateParts(refDate, DEFAULT_BRIEFING_TIMEZONE);
    const lockKey = `fatosbr:briefing:${options.type}:${brParts.localDate}`;

    // Fail-closed: lança DistributedLockUnavailableError (HTTP 503) se o armazenamento de lock estiver indisponível
    const lock = await acquireDistributedLeaseLock({
      lockKey,
      ttlMs: BRIEFING_LOCK_TTL_MS,
      metadata: { type: options.type, localDate: brParts.localDate },
      deps: getLockDepsFromEngine(),
    });

    if (!lock.acquired) {
      const lockedEntry = this.recordRunLog(
        {
          mode: 'BATCH_CYCLE',
          type: options.type,
          localDate: brParts.localDate,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          eligibleUsers: 0,
          ready: 0,
          sent: 0,
          skippedDuplicates: 0,
          skippedNoEvents: 0,
          failed: 0,
          locked: true,
          sendEmail: Boolean(options.sendEmail),
          respectScheduleWindow: Boolean(options.respectScheduleWindow),
          error: `Ciclo concorrente bloqueado (${lock.lockKey}).`,
        },
        { skipDbPersist: true }
      );
      await persistJobRunToStore(lockedEntry);
      return {
        locked: true,
        lockKey: lock.lockKey,
        eligibleUsers: 0,
        ready: 0,
        sent: 0,
        skippedDuplicates: 0,
        skippedNoEvents: 0,
        failed: 0,
        results: [],
      };
    }

    try {
      const eligible = await this.listEligibleUsers(options.type, refDate, {
        respectScheduleWindow: Boolean(options.respectScheduleWindow),
      });
      const prefetchedEventPool =
        eligible.length > 0
          ? await this.prefetchEventPool({ referenceDate: refDate }).catch(() => undefined)
          : undefined;
      const results: GenerateBriefingResult[] = [];

      let ready = 0;
      let sent = 0;
      let skippedDuplicates = 0;
      let skippedNoEvents = 0;
      let failed = 0;

      for (const u of eligible) {
        const res = await this.generateForUser({
          userId: u.userId,
          type: options.type,
          briefingEmail: u.email,
          sendEmail: Boolean(options.sendEmail),
          referenceDate: refDate,
          timezone: u.timezone,
          morningTime: u.morningTime,
          eveningTime: u.eveningTime,
          prefetchedEventPool,
        });
        results.push(res);

        if (res.status === 'READY') ready++;
        else if (res.status === 'SENT') sent++;
        else if (res.status === 'SKIPPED_DUPLICATE') skippedDuplicates++;
        else if (res.status === 'SKIPPED_NO_EVENTS') skippedNoEvents++;
        else if (res.status === 'FAILED') failed++;
      }

      const successEntry = this.recordRunLog(
        {
          mode: 'BATCH_CYCLE',
          type: options.type,
          localDate: brParts.localDate,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          eligibleUsers: eligible.length,
          ready,
          sent,
          skippedDuplicates,
          skippedNoEvents,
          failed,
          locked: false,
          sendEmail: Boolean(options.sendEmail),
          respectScheduleWindow: Boolean(options.respectScheduleWindow),
        },
        { skipDbPersist: true }
      );
      await persistJobRunToStore(successEntry);

      return {
        locked: false,
        lockKey: lock.lockKey,
        eligibleUsers: eligible.length,
        ready,
        sent,
        skippedDuplicates,
        skippedNoEvents,
        failed,
        results,
      };
    } catch (err: any) {
      const failedEntry = this.recordRunLog(
        {
          mode: 'BATCH_CYCLE',
          type: options.type,
          localDate: brParts.localDate,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          eligibleUsers: 0,
          ready: 0,
          sent: 0,
          skippedDuplicates: 0,
          skippedNoEvents: 0,
          failed: 1,
          locked: false,
          sendEmail: Boolean(options.sendEmail),
          respectScheduleWindow: Boolean(options.respectScheduleWindow),
          error: err?.message || 'Erro no ciclo de geração.',
        },
        { skipDbPersist: true }
      );
      await persistJobRunToStore(failedEntry);
      throw err;
    } finally {
      await lock.release();
    }
  },
};
