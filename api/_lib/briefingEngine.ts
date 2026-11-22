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
  emailError?: string;
  error?: string;
}

interface BriefingEngineDeps {
  getServerSupabase: typeof getServerSupabase;
  getServerKeys: typeof getServerKeys;
  fetchFn: typeof fetch;
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
  };
}

function getDeps(): BriefingEngineDeps {
  return (
    testDeps || {
      getServerSupabase,
      getServerKeys,
      fetchFn: fetch,
    }
  );
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
  return currentLocalMinutes >= targetMinutes;
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
  const itemsHtml = params.events
    .map(
      (ev, idx) => `
      <tr>
        <td style="padding:16px 0;border-bottom:1px solid #22242a;">
          <div style="font-size:11px;color:#9ca3af;font-family:monospace;margin-bottom:4px;">#${idx + 1} · RELEVÂNCIA ${ev.relevance_score}</div>
          <div style="font-size:16px;font-weight:700;color:#ffffff;margin-bottom:6px;">${escapeHtml(ev.title)}</div>
          <div style="font-size:13px;line-height:1.5;color:#d4d4d8;">${escapeHtml(ev.summary || '')}</div>
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
}> {
  let prefRow: any = null;
  let settingsRow: any = null;

  try {
    let { data, error } = await supabase
      .from('user_preferences')
      .select('timezone, morning_time, evening_time')
      .eq('id', userId)
      .maybeSingle();

    if (error && isMissingColumnError(error)) {
      const retry = await supabase
        .from('user_preferences')
        .select('timezone')
        .eq('id', userId)
        .maybeSingle();
      data = retry.data;
    }
    prefRow = data || null;
  } catch {}

  try {
    let { data, error } = await supabase
      .from('user_settings')
      .select('timezone, morning_time, evening_time')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && isMissingColumnError(error)) {
      const retry = await supabase
        .from('user_settings')
        .select('timezone')
        .eq('user_id', userId)
        .maybeSingle();
      data = retry.data;
    }
    settingsRow = data || null;
  } catch {}

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

  /**
   * Etapa 1: Seleção de acontecimentos reais persistidos para o usuário (nunca inventa notícias).
   */
  async selectEventsForUser(
    userId: string,
    options?: { windowHours?: number; limit?: number; referenceDate?: Date }
  ): Promise<BriefingEventCandidate[]> {
    const { getServerSupabase: getSb } = getDeps();
    const supabase = getSb();
    const limit = Math.max(1, Math.min(10, options?.limit ?? 6));
    const windowHours = Math.max(6, options?.windowHours ?? 36);
    const anchorMs = (options?.referenceDate || new Date()).getTime();
    const cutoffIso = new Date(anchorMs - windowHours * 3600 * 1000).toISOString();

    const [entFollowRes, topicFollowRes, recentEventsRes] = await Promise.all([
      (supabase as any).from('user_entity_follows').select('entity_id').eq('user_id', userId),
      (supabase as any).from('user_topic_follows').select('topic_id').eq('user_id', userId),
      (supabase as any)
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
      return [];
    }

    const followedEntityIds = new Set(
      (entFollowRes.data || []).map((r: any) => String(r.entity_id)).filter(Boolean)
    );
    const followedTopicIds = new Set(
      (topicFollowRes.data || []).map((r: any) => String(r.topic_id)).filter(Boolean)
    );

    const boostedEventIds = new Set<string>();
    const candidateIds = candidates.map((c) => c.id);

    if (followedEntityIds.size > 0 && candidateIds.length > 0) {
      const { data: eeRows } = await (supabase as any)
        .from('event_entities')
        .select('event_id, entity_id')
        .in('event_id', candidateIds);
      for (const r of eeRows || []) {
        if (followedEntityIds.has(String(r.entity_id))) {
          boostedEventIds.add(String(r.event_id));
        }
      }
    }

    if (followedTopicIds.size > 0 && candidateIds.length > 0) {
      const { data: etRows } = await (supabase as any)
        .from('event_topics')
        .select('event_id, topic_id')
        .in('event_id', candidateIds);
      for (const r of etRows || []) {
        if (followedTopicIds.has(String(r.topic_id))) {
          boostedEventIds.add(String(r.event_id));
        }
      }
    }

    const ranked = [...candidates]
      .map((c) => ({
        ...c,
        isFollowedMatch: boostedEventIds.has(c.id),
      }))
      .sort((a, b) => {
        const aBoost = a.isFollowedMatch ? 25 : 0;
        const bBoost = b.isFollowedMatch ? 25 : 0;
        const scoreDiff = b.relevance_score + bBoost - (a.relevance_score + aBoost);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
      });

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
  }): Promise<GenerateBriefingResult> {
    const { getServerSupabase: getSb, getServerKeys: getKeys, fetchFn } = getDeps();
    const supabase = getSb();
    const refDate = params.referenceDate || new Date();

    const userSchedule =
      params.timezone && params.morningTime && params.eveningTime
        ? {
            timezone: resolveTimezone(params.timezone),
            morningTime: normalizeScheduleTime(params.morningTime, DEFAULT_MORNING_TIME),
            eveningTime: normalizeScheduleTime(params.eveningTime, DEFAULT_EVENING_TIME),
          }
        : await fetchUserSchedulePreferences(supabase, params.userId);

    const effectiveTimezone = params.timezone ? resolveTimezone(params.timezone) : userSchedule.timezone;
    const effectiveMorningTime = params.morningTime
      ? normalizeScheduleTime(params.morningTime, DEFAULT_MORNING_TIME)
      : userSchedule.morningTime;
    const effectiveEveningTime = params.eveningTime
      ? normalizeScheduleTime(params.eveningTime, DEFAULT_EVENING_TIME)
      : userSchedule.eveningTime;

    const { localDate, dayStart, dayEnd, periodStart, periodEnd, scheduledFor, dateLabelPt } =
      getBriefingPeriodWindow(params.type, refDate, {
        timezone: effectiveTimezone,
        morningTime: effectiveMorningTime,
        eveningTime: effectiveEveningTime,
      });

    // Verifica duplicidade utilizando preferencialmente (user_id, type, local_date),
    // alinhado a idx_briefing_delivery_slot, com fallback para (period_start, period_end) ou dia local.
    let existing: { id?: string; status?: string } | null = null;
    let dupErr: any = null;

    const localDateCheck = await (supabase as any)
      .from('briefings')
      .select('id, status')
      .eq('user_id', params.userId)
      .eq('type', params.type)
      .eq('local_date', localDate)
      .maybeSingle();

    if (!localDateCheck.error) {
      existing = localDateCheck.data;
    } else if (isMissingColumnError(localDateCheck.error)) {
      const periodCheck = await (supabase as any)
        .from('briefings')
        .select('id, status')
        .eq('user_id', params.userId)
        .eq('type', params.type)
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .maybeSingle();

      if (!periodCheck.error) {
        existing = periodCheck.data;
      } else if (isMissingColumnError(periodCheck.error)) {
        const dayCheck = await (supabase as any)
          .from('briefings')
          .select('id, status')
          .eq('user_id', params.userId)
          .eq('type', params.type)
          .gte('scheduled_for', dayStart)
          .lte('scheduled_for', dayEnd)
          .maybeSingle();
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
        error: `Falha ao verificar duplicidade de briefing: ${dupErr.message}`,
      };
    }

    if (existing?.id && existing.status !== 'FAILED' && existing.status !== 'CANCELED') {
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

    // Etapa 1: Selecionar acontecimentos reais (não cria briefing vazio como completo!)
    const selectedEvents = await this.selectEventsForUser(params.userId, {
      referenceDate: refDate,
    });
    if (selectedEvents.length === 0) {
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

    // Etapa 2: Criação do registro com local_date, period_start, period_end, status GENERATING e type canônico
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
        error: createErr?.message || 'Falha ao inserir registro inicial de briefing.',
      };
    }

    const briefingId = String(createdRow.id);

    // Etapa 3: Persistir itens ordenados em public.briefing_items (position + section canônicos do PostgreSQL)
    const itemsPayload = selectedEvents.map((ev, index) => ({
      briefing_id: briefingId,
      event_id: ev.id,
      position: index + 1,
      section: classifyBriefingItemSection(ev, index, selectedEvents.length),
    }));

    const { error: itemsErr } = await (supabase as any).from('briefing_items').insert(itemsPayload);
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
        error: `Falha ao persistir itens do briefing: ${itemsErr.message}`,
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
        error: `Itens salvos, mas falhou atualização para READY: ${readyErr.message}`,
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

    // Etapas 6 & 7: Envio por e-mail somente se solicitado e com Resend operacional
    if (!params.sendEmail || !params.briefingEmail) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'READY',
        briefingId,
        localDate,
        periodStart,
        periodEnd,
        eventsCount: selectedEvents.length,
        notificationCreated: Boolean(notifRes.success && !notifRes.skipped),
        emailSent: false,
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
        notificationCreated: Boolean(notifRes.success && !notifRes.skipped),
        emailSent: false,
        emailError: 'RESEND_API_KEY não configurada no servidor.',
      };
    }

    try {
      const from = process.env.RESEND_FROM_EMAIL || 'FatosBR Briefing <onboarding@resend.dev>';
      const html = renderBriefingEmailHtml({
        title,
        description,
        type: params.type,
        events: selectedEvents,
      });

      const resendRes = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from,
          to: [params.briefingEmail],
          subject: `FatosBR • ${title}`,
          html,
          text: `${title} — ${description}`,
        }),
      });

      if (!resendRes.ok) {
        const errPayload = await resendRes.json().catch(() => ({}));
        return {
          userId: params.userId,
          type: params.type,
          status: 'READY',
          briefingId,
          localDate,
          periodStart,
          periodEnd,
          eventsCount: selectedEvents.length,
          notificationCreated: Boolean(notifRes.success && !notifRes.skipped),
          emailSent: false,
          emailError: errPayload?.message || `Resend HTTP ${resendRes.status}`,
        };
      }

      // Somente marca SENT após confirmação 2xx do Resend
      const nowIso = new Date().toISOString();
      await (supabase as any)
        .from('briefings')
        .update({ status: 'SENT', sent_at: nowIso, updated_at: nowIso })
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
        notificationCreated: Boolean(notifRes.success && !notifRes.skipped),
        emailSent: true,
      };
    } catch (sendErr: any) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'READY',
        briefingId,
        localDate,
        periodStart,
        periodEnd,
        eventsCount: selectedEvents.length,
        notificationCreated: Boolean(notifRes.success && !notifRes.skipped),
        emailSent: false,
        emailError: sendErr?.message || 'Erro de rede ao enviar briefing por e-mail.',
      };
    }
  },

  /**
   * Executa um ciclo completo de geração para todos os usuários elegíveis.
   * Quando `respectScheduleWindow: true`, gera apenas para usuários cuja janela horária
   * configurada (`morning_time` / `evening_time` em `timezone`) já foi atingida no dia local.
   */
  async runGenerationCycle(options: {
    type: BriefingEditionType;
    sendEmail?: boolean;
    referenceDate?: Date;
    respectScheduleWindow?: boolean;
  }): Promise<{
    eligibleUsers: number;
    ready: number;
    sent: number;
    skippedDuplicates: number;
    skippedNoEvents: number;
    failed: number;
    results: GenerateBriefingResult[];
  }> {
    const eligible = await this.listEligibleUsers(options.type, options.referenceDate, {
      respectScheduleWindow: Boolean(options.respectScheduleWindow),
    });
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
        referenceDate: options.referenceDate,
        timezone: u.timezone,
        morningTime: u.morningTime,
        eveningTime: u.eveningTime,
      });
      results.push(res);

      if (res.status === 'READY') ready++;
      else if (res.status === 'SENT') sent++;
      else if (res.status === 'SKIPPED_DUPLICATE') skippedDuplicates++;
      else if (res.status === 'SKIPPED_NO_EVENTS') skippedNoEvents++;
      else if (res.status === 'FAILED') failed++;
    }

    return {
      eligibleUsers: eligible.length,
      ready,
      sent,
      skippedDuplicates,
      skippedNoEvents,
      failed,
      results,
    };
  },
};
