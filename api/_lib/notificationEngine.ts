/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR — Motor Server-side Seguro de Notificações (V2.3.1)
 *
 * Diretrizes V2.3.1:
 * 1. Execução exclusivamente server-side com PostgreSQL nativo ou Supabase service_role.
 * 2. Tipos canônicos 100% compatíveis com a constraint auditada de public.notifications:
 *    NEWS_HIGH_RELEVANCE | BRIEFING_READY | TRIAL_EXPIRING | TRIAL_EXPIRED |
 *    SUBSCRIPTION_ACTIVE | PAYMENT_FAILED | SYSTEM.
 * 3. Consulta canônica de preferências em public.user_settings e public.user_preferences
 *    sem falhas silenciosas e com fail-closed se preferências não puderem ser verificadas.
 * 4. Idempotência concorrente via constraint/índice único + tratamento de violação 23505.
 */

import { executeSql, isPostgresConfigured } from './postgres.js';
import { getServerSupabase } from './db.js';
import { evaluateSubscriptionEligibility } from './payments/SubscriptionEligibility.js';

export const ALLOWED_NOTIFICATION_TYPES = [
  'NEWS_HIGH_RELEVANCE',
  'BRIEFING_READY',
  'TRIAL_EXPIRING',
  'TRIAL_EXPIRED',
  'SUBSCRIPTION_ACTIVE',
  'PAYMENT_FAILED',
  'SYSTEM',
] as const;

export type NotificationType = (typeof ALLOWED_NOTIFICATION_TYPES)[number];

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType | 'EVENT_UPDATED' | 'OPERATIONAL_ALERT';
  title: string;
  subtitle?: string;
  body?: string;
  category?: 'acontecimentos' | 'entidades' | 'temas' | 'fontes' | 'atualizacoes';
  eventId?: string;
  entityId?: string;
  eventRevision?: number;
  metadata?: Record<string, any>;
}

export interface SegmentedEventDispatchInput {
  eventId: string;
  title: string;
  summary?: string;
  relevanceScore?: number;
  topicIds?: string[];
  entityIds?: string[];
  sourceIds?: string[];
  type?: 'NEWS_HIGH_RELEVANCE' | 'EVENT_UPDATED';
  eventRevision?: number;
  significantChangeReason?: string;
  publishedAt?: string;
}

export interface SegmentedDispatchOptions {
  dryRun?: boolean;
  enforceAccessPolicy?: boolean;
  maxPerUserPerWindow?: number;
  floodWindowMinutes?: number;
  perUserRunCount?: Map<string, number>;
}

export interface SegmentedDispatchResult {
  targetedUsers: number;
  created: number;
  duplicates: number;
  skippedByPreferences: number;
  blockedByAccess: number;
  floodCapped: number;
  errors: number;
  partialFailure?: boolean;
  failedUserMasks?: string[];
  errorDetails?: string[];
  dryRun?: boolean;
}

export interface UserAlertPreferencesRecord {
  userId: string;
  emailBreakingAlerts: boolean;
  urgentEvents: boolean;
  entityUpdates: boolean;
  topicAlerts: boolean;
  sourcesDigest: boolean;
  dailyBriefings: boolean;
  onlyHighRelevance: boolean;
  rawSettings?: any;
}

export interface UserNotificationAccessDecision {
  allowed: boolean;
  reason?: string;
  isAdmin?: boolean;
}

interface NotificationEngineDeps {
  executeSql: typeof executeSql;
  isPostgresConfigured: typeof isPostgresConfigured;
  getServerSupabase: typeof getServerSupabase;
}

let customDeps: NotificationEngineDeps | null = null;

export function setNotificationEngineTestDeps(deps: Partial<NotificationEngineDeps> | null): void {
  if (!deps) {
    customDeps = null;
    return;
  }
  customDeps = {
    executeSql: deps.executeSql || executeSql,
    isPostgresConfigured: deps.isPostgresConfigured || isPostgresConfigured,
    getServerSupabase: deps.getServerSupabase || getServerSupabase,
  };
}

function getDeps(): NotificationEngineDeps {
  return (
    customDeps || {
      executeSql,
      isPostgresConfigured,
      getServerSupabase,
    }
  );
}

/**
 * Normaliza o tipo para valores estritamente aceitos pela constraint de public.notifications.
 * Valores legados fora da constraint (ex: EVENT_UPDATED, OPERATIONAL_ALERT) são mapeados
 * sem violar o contrato do PostgreSQL.
 */
export function normalizeNotificationType(raw: unknown): NotificationType {
  const upper = String(raw || 'NEWS_HIGH_RELEVANCE').trim().toUpperCase();
  if ((ALLOWED_NOTIFICATION_TYPES as readonly string[]).includes(upper)) {
    return upper as NotificationType;
  }
  if (upper === 'EVENT_UPDATED') return 'NEWS_HIGH_RELEVANCE';
  if (upper === 'OPERATIONAL_ALERT') return 'SYSTEM';
  return 'SYSTEM';
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

function isUniqueViolationError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return code === '23505' || msg.includes('duplicate key value') || msg.includes('unique constraint');
}

function mapPreferenceRow(userId: string, prefRow: any, settingsRow: any): UserAlertPreferencesRecord {
  const ns =
    (settingsRow?.notification_settings && typeof settingsRow.notification_settings === 'object'
      ? settingsRow.notification_settings
      : null) ??
    (prefRow?.notification_settings && typeof prefRow.notification_settings === 'object'
      ? prefRow.notification_settings
      : null);

  const baseBreaking =
    typeof prefRow?.email_breaking_alerts === 'boolean'
      ? prefRow.email_breaking_alerts
      : typeof settingsRow?.email_breaking_alerts === 'boolean'
        ? settingsRow.email_breaking_alerts
        : true;

  return {
    userId,
    emailBreakingAlerts: baseBreaking,
    urgentEvents: typeof ns?.urgentEvents === 'boolean' ? ns.urgentEvents : true,
    entityUpdates: typeof ns?.entityUpdates === 'boolean' ? ns.entityUpdates : true,
    topicAlerts: typeof ns?.topicAlerts === 'boolean' ? ns.topicAlerts : true,
    sourcesDigest: typeof ns?.sourcesDigest === 'boolean' ? ns.sourcesDigest : true,
    dailyBriefings: typeof ns?.dailyBriefings === 'boolean' ? ns.dailyBriefings : true,
    onlyHighRelevance: typeof ns?.onlyHighRelevance === 'boolean' ? ns.onlyHighRelevance : true,
    rawSettings: settingsRow || undefined,
  };
}

const BLOCKED_ACCOUNT_STATUSES = new Set([
  'SUSPENDED',
  'BLOCKED',
  'BANNED',
  'DISABLED',
  'DELETED',
  'REVOKED',
  'INACTIVE',
]);

function maskUserIdForLog(userId: string): string {
  const clean = String(userId || '').trim();
  if (!clean) return 'usr_anon';
  if (clean.length <= 8) return `usr_${clean.slice(0, 2)}…`;
  return `usr_${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

function checkAccountControlMarkers(row: any, nowMs: number): string | null {
  if (!row || typeof row !== 'object') return null;

  if (row.deleted_at) return 'ACCOUNT_DELETED';
  if (row.is_active === false) return 'ACCOUNT_INACTIVE';
  if (row.is_suspended === true || row.suspended === true) return 'ACCOUNT_SUSPENDED';
  if (row.is_blocked === true || row.access_blocked === true || row.blocked === true) {
    return 'ACCOUNT_BLOCKED';
  }

  const rawStatus = String(row.account_status || row.status || '').trim().toUpperCase();
  if (rawStatus && BLOCKED_ACCOUNT_STATUSES.has(rawStatus)) {
    return `ACCOUNT_${rawStatus}`;
  }

  if (row.notifications_paused_until) {
    const pausedUntilMs = Date.parse(String(row.notifications_paused_until));
    if (Number.isFinite(pausedUntilMs) && pausedUntilMs > nowMs) {
      return 'NOTIFICATIONS_PAUSED';
    }
  }

  const controls =
    row.account_controls && typeof row.account_controls === 'object' ? row.account_controls : null;
  if (controls) {
    if (controls.deleted === true || controls.deletedAt) return 'ACCOUNT_DELETED';
    if (controls.suspended === true || controls.isSuspended === true) return 'ACCOUNT_SUSPENDED';
    if (
      controls.blocked === true ||
      controls.isBlocked === true ||
      controls.accessBlocked === true ||
      controls.notificationsBlocked === true
    ) {
      return 'ACCOUNT_CONTROLS_BLOCKED';
    }
    const ctrlStatus = String(controls.status || '').trim().toUpperCase();
    if (ctrlStatus && BLOCKED_ACCOUNT_STATUSES.has(ctrlStatus)) {
      return `ACCOUNT_CONTROLS_${ctrlStatus}`;
    }
  }

  const ns =
    row.notification_settings && typeof row.notification_settings === 'object'
      ? row.notification_settings
      : null;
  if (ns && (ns.accountBlocked === true || ns.suspended === true)) {
    return 'ACCOUNT_SETTINGS_BLOCKED';
  }

  return null;
}

async function fetchUserAlertPreferences(
  userIds: string[]
): Promise<{ map: Map<string, UserAlertPreferencesRecord>; error?: string }> {
  const { getServerSupabase: getSb } = getDeps();
  const map = new Map<string, UserAlertPreferencesRecord>();
  if (userIds.length === 0) return { map };

  const supabase = getSb();
  const prefByUser = new Map<string, any>();
  const settingsByUser = new Map<string, any>();

  // 1. Consulta public.user_preferences (tenta com notification_settings; se ausente, lê colunas base sem falhar)
  let prefErrorMsg: string | null = null;
  let prefAvailable = false;
  try {
    let { data: prefRows, error: prefErr } = await (supabase as any)
      .from('user_preferences')
      .select('id, email_breaking_alerts, email_morning_briefing, email_evening_briefing, notification_settings')
      .in('id', userIds);

    if (prefErr && isMissingColumnError(prefErr)) {
      const retry = await (supabase as any)
        .from('user_preferences')
        .select('id, email_breaking_alerts, email_morning_briefing, email_evening_briefing')
        .in('id', userIds);
      prefRows = retry.data;
      prefErr = retry.error;
    }

    if (prefErr) {
      if (!isMissingRelationError(prefErr)) {
        prefErrorMsg = prefErr.message || 'Erro ao consultar user_preferences';
      }
    } else {
      prefAvailable = true;
      for (const row of prefRows || []) {
        if (row?.id) prefByUser.set(String(row.id), row);
      }
    }
  } catch (err: any) {
    prefErrorMsg = err?.message || 'Exceção ao consultar user_preferences';
  }

  // 2. Consulta armazenamento canônico em public.user_settings (inclui account_controls quando presente)
  let settingsErrorMsg: string | null = null;
  let settingsAvailable = false;
  try {
    let { data: settingsRows, error: settingsErr } = await (supabase as any)
      .from('user_settings')
      .select('*')
      .in('user_id', userIds);

    if (settingsErr && isMissingColumnError(settingsErr)) {
      const retry = await (supabase as any)
        .from('user_settings')
        .select('user_id, email_breaking_alerts, notification_settings')
        .in('user_id', userIds);
      settingsRows = retry.data;
      settingsErr = retry.error;
    }

    if (settingsErr) {
      if (!isMissingRelationError(settingsErr)) {
        settingsErrorMsg = settingsErr.message || 'Erro ao consultar user_settings';
      }
    } else {
      settingsAvailable = true;
      for (const row of settingsRows || []) {
        if (row?.user_id) settingsByUser.set(String(row.user_id), row);
      }
    }
  } catch (err: any) {
    settingsErrorMsg = err?.message || 'Exceção ao consultar user_settings';
  }

  if ((!prefAvailable && !settingsAvailable) || Boolean(settingsErrorMsg)) {
    const errText = settingsErrorMsg || prefErrorMsg || 'Nenhuma fonte de preferências de usuário disponível.';
    console.error('[NotificationEngine] Falha ao carregar preferências (fail-closed):', errText);
    return { map, error: errText };
  }

  if (prefErrorMsg) {
    console.warn('[NotificationEngine] Aviso ao consultar user_preferences:', prefErrorMsg);
  }

  for (const uid of userIds) {
    map.set(uid, mapPreferenceRow(uid, prefByUser.get(uid), settingsByUser.get(uid)));
  }

  return { map };
}

/**
 * Avalia políticas reais de acesso da conta por usuário:
 * 1. Controles em `public.user_settings` (`account_controls`, suspensão/bloqueio/pausa).
 * 2. Estado em `public.profiles` (quando a tabela existir: `deleted_at`, `is_active`, suspensão).
 * 3. Elegibilidade em `public.subscriptions` + trial (`SubscriptionEligibility`), isentando admins de `internal.user_roles`.
 */
async function evaluateUsersNotificationAccess(
  userIds: string[],
  prefsMap: Map<string, UserAlertPreferencesRecord>,
  nowMs = Date.now()
): Promise<{ decisions: Map<string, UserNotificationAccessDecision>; error?: string }> {
  const decisions = new Map<string, UserNotificationAccessDecision>();
  if (userIds.length === 0) return { decisions };

  const { executeSql: runSql, isPostgresConfigured: pgConfigured, getServerSupabase: getSb } = getDeps();
  const supabase = getSb() as any;

  // 1. Verifica admins em internal.user_roles (best-effort fail-safe: apenas isenta se confirmado)
  const adminUsers = new Set<string>();
  if (pgConfigured()) {
    try {
      const roleRes = await runSql(
        `SELECT user_id::text AS user_id
           FROM internal.user_roles
          WHERE user_id::text = ANY($1::text[])
            AND LOWER(role) IN ('admin', 'super_admin')`,
        [userIds]
      );
      for (const r of roleRes.rows || []) {
        if (r?.user_id) adminUsers.add(String(r.user_id));
      }
    } catch (err: any) {
      if (!isMissingRelationError(err) && !isMissingColumnError(err)) {
        console.warn('[NotificationEngine] Aviso ao consultar internal.user_roles:', err?.message);
      }
    }
  } else if (typeof supabase?.schema === 'function') {
    try {
      const { data: roleRows } = await supabase
        .schema('internal')
        .from('user_roles')
        .select('user_id, role')
        .in('user_id', userIds)
        .in('role', ['admin', 'super_admin']);
      for (const r of roleRows || []) {
        if (r?.user_id) adminUsers.add(String(r.user_id));
      }
    } catch {}
  }

  // 2. Consulta public.profiles (quando existir)
  const profileByUser = new Map<string, any>();
  let profilesError: string | null = null;
  if (pgConfigured()) {
    try {
      const profRes = await runSql(
        `SELECT * FROM public.profiles WHERE user_id::text = ANY($1::text[]) OR id::text = ANY($1::text[])`,
        [userIds]
      );
      for (const r of profRes.rows || []) {
        const uid = String(r.user_id || r.id || '');
        if (uid) profileByUser.set(uid, r);
      }
    } catch (err: any) {
      if (isMissingColumnError(err)) {
        try {
          const profByIdRes = await runSql(
            `SELECT * FROM public.profiles WHERE id::text = ANY($1::text[])`,
            [userIds]
          );
          for (const r of profByIdRes.rows || []) {
            if (r?.id) profileByUser.set(String(r.id), r);
          }
        } catch (err2: any) {
          if (!isMissingRelationError(err2)) {
            profilesError = err2?.message || 'Erro ao consultar public.profiles';
          }
        }
      } else if (!isMissingRelationError(err)) {
        profilesError = err?.message || 'Erro ao consultar public.profiles';
      }
    }
  } else {
    try {
      let { data: profRows, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', userIds);

      if (profErr && isMissingColumnError(profErr)) {
        const retry = await supabase.from('profiles').select('*').in('id', userIds);
        profRows = retry.data;
        profErr = retry.error;
      }

      if (profErr) {
        if (!isMissingRelationError(profErr)) {
          profilesError = profErr.message || 'Erro ao consultar public.profiles';
        }
      } else {
        for (const r of profRows || []) {
          const uid = String(r?.user_id || r?.id || '');
          if (uid) profileByUser.set(uid, r);
        }
      }
    } catch (err: any) {
      profilesError = err?.message || 'Exceção ao consultar public.profiles';
    }
  }

  if (profilesError) {
    return { decisions, error: profilesError };
  }

  // 3. Consulta public.subscriptions (quando a tabela existir) + auth.users.created_at para âncora de trial
  let subscriptionsTableAvailable = false;
  const subByUser = new Map<string, any>();
  let subError: string | null = null;

  if (pgConfigured()) {
    try {
      const regRes = await runSql(`SELECT to_regclass('public.subscriptions') IS NOT NULL AS exists_flag`);
      subscriptionsTableAvailable = Boolean(regRes.rows?.[0]?.exists_flag);
      if (subscriptionsTableAvailable) {
        const subRes = await runSql(
          `SELECT * FROM public.subscriptions
            WHERE user_id::text = ANY($1::text[])
            ORDER BY updated_at DESC NULLS LAST, created_at DESC`,
          [userIds]
        );
        for (const row of subRes.rows || []) {
          const uid = row?.user_id ? String(row.user_id) : '';
          if (uid && !subByUser.has(uid)) {
            subByUser.set(uid, row);
          }
        }
      }
    } catch (err: any) {
      if (!isMissingRelationError(err)) {
        subError = err?.message || 'Erro ao consultar public.subscriptions';
      }
    }
  } else {
    try {
      let subQuery = supabase.from('subscriptions').select('*').in('user_id', userIds);
      if (typeof subQuery?.order === 'function') {
        subQuery = subQuery.order('updated_at', { ascending: false });
      }
      const { data: subRows, error: sErr } = await subQuery;
      if (sErr) {
        if (!isMissingRelationError(sErr)) {
          subError = sErr.message || 'Erro ao consultar public.subscriptions';
        }
      } else {
        // Se mock mínimo retornar array vazio e não houver nenhuma assinatura nem perfil, tratamos como opcional
        subscriptionsTableAvailable = Array.isArray(subRows) && subRows.length > 0;
        const sorted = [...(subRows || [])].sort(
          (a: any, b: any) =>
            Date.parse(b?.updated_at || b?.created_at || 0) -
            Date.parse(a?.updated_at || a?.created_at || 0)
        );
        for (const row of sorted) {
          const uid = row?.user_id ? String(row.user_id) : '';
          if (uid && !subByUser.has(uid)) {
            subByUser.set(uid, row);
          }
        }
      }
    } catch (err: any) {
      subError = err?.message || 'Exceção ao consultar public.subscriptions';
    }
  }

  if (subError) {
    return { decisions, error: subError };
  }

  // Âncora opcional em auth.users.created_at para usuários sem linha explícita em subscriptions
  const authCreatedAtByUser = new Map<string, string>();
  if (subscriptionsTableAvailable && pgConfigured()) {
    const usersWithoutSub = userIds.filter((uid) => !subByUser.has(uid));
    if (usersWithoutSub.length > 0) {
      try {
        const authRes = await runSql(
          `SELECT id::text AS id, created_at FROM auth.users WHERE id::text = ANY($1::text[])`,
          [usersWithoutSub]
        );
        for (const r of authRes.rows || []) {
          if (r?.id && r?.created_at) {
            authCreatedAtByUser.set(String(r.id), new Date(r.created_at).toISOString());
          }
        }
      } catch {}
    }
  }

  for (const uid of userIds) {
    const settingsRow = prefsMap.get(uid)?.rawSettings;
    const settingsDeny = checkAccountControlMarkers(settingsRow, nowMs);
    if (settingsDeny) {
      decisions.set(uid, { allowed: false, reason: settingsDeny });
      continue;
    }

    const profileRow = profileByUser.get(uid);
    const profileDeny = checkAccountControlMarkers(profileRow, nowMs);
    if (profileDeny) {
      decisions.set(uid, { allowed: false, reason: profileDeny });
      continue;
    }

    if (adminUsers.has(uid)) {
      decisions.set(uid, { allowed: true, isAdmin: true });
      continue;
    }

    if (subscriptionsTableAvailable) {
      const subRow = subByUser.get(uid) || null;
      const createdAtAnchor =
        authCreatedAtByUser.get(uid) ||
        (profileRow?.created_at ? new Date(profileRow.created_at).toISOString() : null);

      if (subRow) {
        const evaluation = evaluateSubscriptionEligibility({
          row: subRow,
          userCreatedAt: createdAtAnchor,
          nowMs,
        });
        if (!evaluation.hasProAccess) {
          decisions.set(uid, {
            allowed: false,
            reason: `SUBSCRIPTION_${evaluation.canonicalStatus}`,
          });
          continue;
        }
      } else if (createdAtAnchor) {
        const evaluation = evaluateSubscriptionEligibility({
          row: null,
          userCreatedAt: createdAtAnchor,
          nowMs,
        });
        if (!evaluation.hasProAccess) {
          decisions.set(uid, {
            allowed: false,
            reason: `SUBSCRIPTION_${evaluation.canonicalStatus}`,
          });
          continue;
        }
      }
    }

    decisions.set(uid, { allowed: true });
  }

  return { decisions };
}

/**
 * Consulta quantidade recente de notificações por usuário na janela configurada (anti-flood).
 */
async function fetchRecentNotificationCountsByUser(
  userIds: string[],
  windowMinutes: number
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (userIds.length === 0 || windowMinutes <= 0) return counts;

  const { executeSql: runSql, isPostgresConfigured: pgConfigured, getServerSupabase: getSb } = getDeps();
  const cutoffIso = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  if (pgConfigured()) {
    try {
      const res = await runSql(
        `SELECT user_id::text AS user_id, COUNT(*)::int AS cnt
           FROM public.notifications
          WHERE user_id::text = ANY($1::text[])
            AND created_at >= $2::timestamptz
          GROUP BY user_id`,
        [userIds, cutoffIso]
      );
      for (const r of res.rows || []) {
        if (r?.user_id) counts.set(String(r.user_id), Number(r.cnt || 0));
      }
      return counts;
    } catch (err: any) {
      if (!isMissingRelationError(err)) {
        console.warn('[NotificationEngine] Aviso ao verificar anti-flood via PG:', err?.message);
      }
    }
  }

  try {
    const supabase = getSb() as any;
    let query = supabase
      .from('notifications')
      .select('user_id, created_at')
      .in('user_id', userIds);
    if (typeof query?.gte === 'function') {
      query = query.gte('created_at', cutoffIso);
    }
    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      const cutoffMs = Date.parse(cutoffIso);
      for (const row of data) {
        const uid = row?.user_id ? String(row.user_id) : '';
        if (!uid) continue;
        if (row?.created_at) {
          const ts = Date.parse(String(row.created_at));
          if (Number.isFinite(ts) && ts < cutoffMs) continue;
        }
        counts.set(uid, (counts.get(uid) || 0) + 1);
      }
    }
  } catch {}

  return counts;
}

/**
 * Verifica quais usuários já possuem notificação persistida para o mesmo (event_id, category, event_revision).
 * Usada no modo dry-run para prever deduplicações sem inserir registros.
 */
async function checkExistingEventNotificationsForUsers(
  userIds: string[],
  eventId: string,
  eventRevision: number
): Promise<Set<string>> {
  const existingKeys = new Set<string>();
  if (userIds.length === 0 || !eventId) return existingKeys;

  const { executeSql: runSql, isPostgresConfigured: pgConfigured, getServerSupabase: getSb } = getDeps();

  if (pgConfigured()) {
    try {
      const res = await runSql(
        `SELECT user_id::text AS user_id, category
           FROM public.notifications
          WHERE user_id::text = ANY($1::text[])
            AND event_id = $2
            AND event_revision = $3`,
        [userIds, eventId, eventRevision]
      );
      for (const r of res.rows || []) {
        if (r?.user_id && r?.category) {
          existingKeys.add(`${r.user_id}:${r.category}`);
        }
      }
      return existingKeys;
    } catch (colErr: any) {
      if (isMissingColumnError(colErr)) {
        try {
          const legacyRes = await runSql(
            `SELECT user_id::text AS user_id, category
               FROM public.notifications
              WHERE user_id::text = ANY($1::text[])
                AND event_id = $2`,
            [userIds, eventId]
          );
          for (const r of legacyRes.rows || []) {
            if (r?.user_id && r?.category) {
              existingKeys.add(`${r.user_id}:${r.category}`);
            }
          }
          return existingKeys;
        } catch {}
      }
    }
  }

  try {
    const supabase = getSb() as any;
    let { data, error } = await supabase
      .from('notifications')
      .select('user_id, category')
      .in('user_id', userIds)
      .eq('event_id', eventId)
      .eq('event_revision', eventRevision);

    if (error && isMissingColumnError(error)) {
      const retry = await supabase
        .from('notifications')
        .select('user_id, category')
        .in('user_id', userIds)
        .eq('event_id', eventId);
      data = retry.data;
      error = retry.error;
    }

    if (!error && Array.isArray(data)) {
      for (const r of data) {
        if (r?.user_id && r?.category) {
          existingKeys.add(`${r.user_id}:${r.category}`);
        }
      }
    }
  } catch {}

  return existingKeys;
}

export const notificationEngine = {
  fetchUserAlertPreferences,
  evaluateUsersNotificationAccess,

  /**
   * Cria uma notificação no Supabase de forma segura, compatível com a constraint de tipos
   * e idempotente mesmo sob requisições concorrentes.
   */
  async createNotification(
    params: CreateNotificationParams
  ): Promise<{ success: boolean; id?: string; duplicate?: boolean; error?: string }> {
    const {
      userId,
      type,
      title,
      subtitle,
      body,
      category = 'acontecimentos',
      eventId,
      entityId,
      eventRevision: rawEventRevision,
      metadata = {},
    } = params;

    if (!userId || !title) {
      return { success: false, error: 'INVALID_PARAMS' };
    }

    const canonicalType = normalizeNotificationType(type);
    const eventRevision = Math.max(
      1,
      Math.floor(Number(rawEventRevision ?? metadata?.eventRevision ?? 1) || 1)
    );
    const resolvedBody = String(body || subtitle || title).trim();
    const resolvedSubtitle = String(subtitle || resolvedBody).trim();
    const enrichedMetadata: Record<string, any> = {
      ...metadata,
      notification_type: canonicalType,
      ...(eventId ? { eventRevision } : {}),
    };
    const { executeSql: runSql, isPostgresConfigured: pgConfigured, getServerSupabase: getSb } = getDeps();

    // 1. Tentar persistência direta via PostgreSQL nativo se configurado
    if (pgConfigured()) {
      const findExistingPg = async (): Promise<string | undefined> => {
        if (eventId) {
          try {
            const existingRes = await runSql(
              `SELECT id FROM public.notifications
               WHERE user_id = $1 AND event_id = $2 AND category = $3 AND event_revision = $4
               LIMIT 1`,
              [userId, eventId, category, eventRevision]
            );
            if (existingRes.rows[0]?.id) return String(existingRes.rows[0].id);
          } catch (colErr: any) {
            if (!isMissingColumnError(colErr)) throw colErr;
            const legacyExisting = await runSql(
              `SELECT id FROM public.notifications
               WHERE user_id = $1 AND event_id = $2 AND category = $3
               LIMIT 1`,
              [userId, eventId, category]
            );
            if (legacyExisting.rows[0]?.id) return String(legacyExisting.rows[0].id);
          }
        }
        if (enrichedMetadata?.briefingId) {
          const existingBriefing = await runSql(
            `SELECT id FROM public.notifications
             WHERE user_id = $1 AND metadata->>'briefingId' = $2 AND type = $3
             LIMIT 1`,
            [userId, String(enrichedMetadata.briefingId), canonicalType]
          );
          if (existingBriefing.rows[0]?.id) return String(existingBriefing.rows[0].id);
        }
        return undefined;
      };

      const runPgInsert = async (
        includeBody: boolean,
        includeSubtitle: boolean,
        includeEventRevision: boolean
      ) => {
        const cols = ['user_id', 'type', 'title'];
        const vals: any[] = [userId, canonicalType, title];
        if (includeBody) {
          cols.push('body');
          vals.push(resolvedBody);
        }
        if (includeSubtitle) {
          cols.push('subtitle');
          vals.push(resolvedSubtitle);
        }
        if (includeEventRevision) {
          cols.push('event_revision');
          vals.push(eventRevision);
        }
        cols.push('category', 'read', 'event_id', 'entity_id', 'metadata', 'created_at');
        vals.push(
          category,
          false,
          eventId || null,
          entityId || null,
          JSON.stringify(enrichedMetadata)
        );
        const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(', ');
        return runSql(
          `INSERT INTO public.notifications (${cols.join(', ')})
           VALUES (${placeholders}, NOW())
           ON CONFLICT DO NOTHING
           RETURNING id`,
          vals
        );
      };

      try {
        let insertRes;
        try {
          insertRes = await runPgInsert(true, true, true);
        } catch (colErr: any) {
          if (!isMissingColumnError(colErr)) throw colErr;
          const msg = String(colErr.message || '').toLowerCase();
          insertRes = await runPgInsert(
            !msg.includes('body'),
            !msg.includes('subtitle'),
            !msg.includes('event_revision')
          );
        }

        if (insertRes.rows[0]?.id) {
          return { success: true, id: insertRes.rows[0].id };
        }

        const existingId = await findExistingPg();
        return { success: true, id: existingId, duplicate: true };
      } catch (err: any) {
        if (isUniqueViolationError(err)) {
          const existingId = await findExistingPg().catch(() => undefined);
          return { success: true, id: existingId, duplicate: true };
        }
        console.warn('[NotificationEngine] Falha ao gravar via PostgreSQL direto:', err?.code || err?.message);
      }
    }

    // 2. Persistência via Supabase Client server-side (service_role)
    try {
      const supabase = getSb();

      if (eventId) {
        let { data: existing, error: checkErr } = await (supabase as any)
          .from('notifications')
          .select('id')
          .eq('user_id', userId)
          .eq('event_id', eventId)
          .eq('category', category)
          .eq('event_revision', eventRevision)
          .maybeSingle();

        if (checkErr && isMissingColumnError(checkErr)) {
          const legacyCheck = await (supabase as any)
            .from('notifications')
            .select('id')
            .eq('user_id', userId)
            .eq('event_id', eventId)
            .eq('category', category)
            .maybeSingle();
          existing = legacyCheck.data;
          checkErr = legacyCheck.error;
        }

        if (!checkErr && existing?.id) {
          return { success: true, id: existing.id, duplicate: true };
        }
      }

      if (canonicalType === 'BRIEFING_READY' && enrichedMetadata?.briefingId) {
        const { data: existingBr, error: brCheckErr } = await (supabase as any)
          .from('notifications')
          .select('id')
          .eq('user_id', userId)
          .eq('type', 'BRIEFING_READY')
          .contains('metadata', { briefingId: String(enrichedMetadata.briefingId) })
          .maybeSingle();

        if (!brCheckErr && existingBr?.id) {
          return { success: true, id: existingBr.id, duplicate: true };
        }
      }

      const rowPayload: Record<string, any> = {
        user_id: userId,
        type: canonicalType,
        title,
        body: resolvedBody,
        subtitle: resolvedSubtitle,
        category,
        read: false,
        read_at: null,
        event_id: eventId || null,
        entity_id: entityId || null,
        event_revision: eventRevision,
        metadata: enrichedMetadata,
      };

      let { data, error } = await (supabase as any)
        .from('notifications')
        .insert(rowPayload)
        .select('id')
        .single();

      // Tolerância estrita apenas para colunas ausentes em esquemas antigos (read_at / subtitle / body / event_revision)
      if (error && isMissingColumnError(error)) {
        const fallbackPayload = { ...rowPayload };
        const msg = String(error.message || '').toLowerCase();
        if (msg.includes('read_at')) delete fallbackPayload.read_at;
        if (msg.includes('subtitle')) delete fallbackPayload.subtitle;
        if (msg.includes('body')) delete fallbackPayload.body;
        if (msg.includes('event_revision')) delete fallbackPayload.event_revision;
        const retry = await (supabase as any)
          .from('notifications')
          .insert(fallbackPayload)
          .select('id')
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        if (isUniqueViolationError(error)) {
          if (eventId) {
            let { data: existing, error: revErr } = await (supabase as any)
              .from('notifications')
              .select('id')
              .eq('user_id', userId)
              .eq('event_id', eventId)
              .eq('category', category)
              .eq('event_revision', eventRevision)
              .maybeSingle();
            if (revErr && isMissingColumnError(revErr)) {
              const legacyExisting = await (supabase as any)
                .from('notifications')
                .select('id')
                .eq('user_id', userId)
                .eq('event_id', eventId)
                .eq('category', category)
                .maybeSingle();
              existing = legacyExisting.data;
            }
            return { success: true, id: existing?.id, duplicate: true };
          }
          if (enrichedMetadata?.briefingId) {
            const { data: existingBr } = await (supabase as any)
              .from('notifications')
              .select('id')
              .eq('user_id', userId)
              .eq('type', canonicalType)
              .contains('metadata', { briefingId: enrichedMetadata.briefingId })
              .maybeSingle();
            return { success: true, id: existingBr?.id, duplicate: true };
          }
          return { success: true, duplicate: true };
        }

        console.error('[NotificationEngine] Erro ao inserir notificação no Supabase:', {
          code: error.code,
          type: canonicalType,
          message: error.message,
        });
        return { success: false, error: error.message };
      }

      return { success: true, id: data?.id };
    } catch (err: any) {
      console.error('[NotificationEngine] Erro geral ao criar notificação:', err?.message);
      return { success: false, error: err?.message };
    }
  },

  /**
   * Cria notificação de Briefing pronto vinculada ao usuário e ao ID real do briefing persistido,
   * respeitando a preferência dailyBriefings do usuário e garantindo deduplicação por briefingId.
   */
  async createBriefingReadyNotification(params: {
    userId: string;
    briefingId: string;
    briefingType: 'morning' | 'evening' | 'MORNING' | 'EVENING';
    title: string;
    eventsCount: number;
  }): Promise<{ success: boolean; id?: string; duplicate?: boolean; skipped?: boolean; error?: string }> {
    const { getServerSupabase: getSb } = getDeps();
    const supabase = getSb();

    const prefCheck = await fetchUserAlertPreferences([params.userId]);
    if (prefCheck.error) {
      return { success: false, error: prefCheck.error };
    }
    const userPrefs = prefCheck.map.get(params.userId);
    if (userPrefs && !userPrefs.dailyBriefings) {
      return { success: true, skipped: true };
    }

    try {
      const { data: existing, error: dupErr } = await (supabase as any)
        .from('notifications')
        .select('id')
        .eq('user_id', params.userId)
        .eq('type', 'BRIEFING_READY')
        .contains('metadata', { briefingId: params.briefingId })
        .maybeSingle();

      if (!dupErr && existing?.id) {
        return { success: true, id: existing.id, duplicate: true };
      }
    } catch (err: any) {
      console.warn('[NotificationEngine] Aviso ao checar duplicidade de briefingId:', err?.message);
    }

    const isEvening = String(params.briefingType).toUpperCase() === 'EVENING';
    const summaryText = `${params.eventsCount} acontecimentos consolidados no seu ${
      isEvening ? 'resumo da noite' : 'resumo da manhã'
    }.`;

    return this.createNotification({
      userId: params.userId,
      type: 'BRIEFING_READY',
      category: 'atualizacoes',
      title: params.title,
      body: summaryText,
      subtitle: summaryText,
      metadata: {
        briefingId: params.briefingId,
        briefingType: isEvening ? 'EVENING' : 'MORNING',
      },
    });
  },

  /**
   * Serviço isolado de segmentação para acontecimentos reais persistidos.
   * Respeita interesses seguidos (entidades, temas, fontes), relevância, preferências reais,
   * políticas de acesso da conta, proteção anti-flood por usuário e suporte a dry-run.
   */
  async dispatchSegmentedNotificationsForEvent(
    input: SegmentedEventDispatchInput,
    options?: SegmentedDispatchOptions
  ): Promise<SegmentedDispatchResult> {
    const isDryRun = Boolean(options?.dryRun);
    const enforceAccessPolicy = options?.enforceAccessPolicy !== false;
    const defaultMaxPerUser = Math.max(
      1,
      Number(process.env.OUTBOX_USER_FLOOD_MAX_PER_WINDOW || 10) || 10
    );
    const maxPerUserPerWindow =
      options?.maxPerUserPerWindow !== undefined
        ? Math.max(0, Number(options.maxPerUserPerWindow))
        : defaultMaxPerUser;
    const floodWindowMinutes =
      options?.floodWindowMinutes !== undefined
        ? Math.max(1, Number(options.floodWindowMinutes))
        : Math.max(1, Number(process.env.OUTBOX_USER_FLOOD_WINDOW_MINUTES || 60) || 60);

    const stats: SegmentedDispatchResult = {
      targetedUsers: 0,
      created: 0,
      duplicates: 0,
      skippedByPreferences: 0,
      blockedByAccess: 0,
      floodCapped: 0,
      errors: 0,
      ...(isDryRun ? { dryRun: true } : {}),
    };

    if (!input?.eventId || !input?.title) return stats;

    const relevanceScore = typeof input.relevanceScore === 'number' ? input.relevanceScore : 75;
    if (relevanceScore < 70) {
      return stats;
    }

    const { getServerSupabase: getSb } = getDeps();
    const supabase = getSb();
    const errorDetails: string[] = [];
    const failedUserMasks: string[] = [];

    const userSignals = new Map<
      string,
      { entityId?: string; hasEntity: boolean; hasTopic: boolean; hasSource: boolean }
    >();

    const ensureSignal = (uid: string) => {
      let cur = userSignals.get(uid);
      if (!cur) {
        cur = { hasEntity: false, hasTopic: false, hasSource: false };
        userSignals.set(uid, cur);
      }
      return cur;
    };

    try {
      // 1. Seguidores de entidades relacionadas
      if (input.entityIds && input.entityIds.length > 0) {
        const { data: entFollows, error: entErr } = await (supabase as any)
          .from('user_entity_follows')
          .select('user_id, entity_id')
          .in('entity_id', input.entityIds);

        if (entErr) {
          errorDetails.push(`user_entity_follows: ${entErr.message}`);
          stats.errors++;
        } else {
          for (const row of entFollows || []) {
            if (row?.user_id) {
              const s = ensureSignal(String(row.user_id));
              s.hasEntity = true;
              if (!s.entityId && row.entity_id) s.entityId = String(row.entity_id);
            }
          }
        }
      }

      // 2. Seguidores de tópicos relacionados
      if (input.topicIds && input.topicIds.length > 0) {
        const { data: topicFollows, error: topicErr } = await (supabase as any)
          .from('user_topic_follows')
          .select('user_id')
          .in('topic_id', input.topicIds);

        if (topicErr) {
          errorDetails.push(`user_topic_follows: ${topicErr.message}`);
          stats.errors++;
        } else {
          for (const row of topicFollows || []) {
            if (row?.user_id) {
              ensureSignal(String(row.user_id)).hasTopic = true;
            }
          }
        }
      }

      // 3. Seguidores de fontes relacionadas
      if (input.sourceIds && input.sourceIds.length > 0) {
        const { data: srcFollows, error: srcErr } = await (supabase as any)
          .from('user_source_follows')
          .select('user_id')
          .in('source_id', input.sourceIds);

        if (srcErr) {
          errorDetails.push(`user_source_follows: ${srcErr.message}`);
          stats.errors++;
        } else {
          for (const row of srcFollows || []) {
            if (row?.user_id) {
              ensureSignal(String(row.user_id)).hasSource = true;
            }
          }
        }
      }

      stats.targetedUsers = userSignals.size;
      if (stats.targetedUsers === 0) {
        if (errorDetails.length > 0) stats.errorDetails = errorDetails;
        return stats;
      }

      // 4. Carrega preferências canônicas com fail-closed se falhar
      const userIds = Array.from(userSignals.keys());
      const prefsResult = await fetchUserAlertPreferences(userIds);
      if (prefsResult.error) {
        stats.errors += userIds.length;
        stats.errorDetails = [...errorDetails, prefsResult.error];
        return stats;
      }

      // 5. Avalia políticas de acesso da conta (account_controls, profiles, subscriptions/trial)
      let accessDecisions = new Map<string, UserNotificationAccessDecision>();
      if (enforceAccessPolicy) {
        const accessRes = await evaluateUsersNotificationAccess(userIds, prefsResult.map);
        if (accessRes.error) {
          stats.errors += userIds.length;
          stats.errorDetails = [...errorDetails, accessRes.error];
          return stats;
        }
        accessDecisions = accessRes.decisions;
      }

      // 6. Pré-carrega contadores anti-flood recentes e deduplicação prévia (quando dryRun)
      const recentCounts =
        maxPerUserPerWindow > 0
          ? await fetchRecentNotificationCountsByUser(userIds, floodWindowMinutes)
          : new Map<string, number>();

      const eventRevision = Math.max(1, Math.floor(Number(input.eventRevision ?? 1) || 1));
      const existingDryRunKeys = isDryRun
        ? await checkExistingEventNotificationsForUsers(userIds, input.eventId, eventRevision)
        : new Set<string>();

      const canonicalType = normalizeNotificationType(input.type || 'NEWS_HIGH_RELEVANCE');

      for (const [userId, signals] of userSignals.entries()) {
        const prefs = prefsResult.map.get(userId);
        if (!prefs) {
          stats.errors++;
          failedUserMasks.push(maskUserIdForLog(userId));
          continue;
        }

        if (enforceAccessPolicy) {
          const access = accessDecisions.get(userId);
          if (access && !access.allowed) {
            stats.blockedByAccess++;
            continue;
          }
        }

        // Bloqueio in-app depende exclusivamente da preferência in-app (urgentEvents),
        // sem acoplamento indevido com o canal de e-mail (emailBreakingAlerts).
        if (!prefs.urgentEvents) {
          stats.skippedByPreferences++;
          continue;
        }

        // Filtro estrito de alta relevância quando ativado pelo usuário
        if (prefs.onlyHighRelevance && relevanceScore < 85) {
          stats.skippedByPreferences++;
          continue;
        }

        // Seleciona a categoria mais prioritária habilitada nas preferências do usuário
        let chosenCategory: 'entidades' | 'temas' | 'fontes' | null = null;
        let chosenEntityId: string | undefined;

        if (signals.hasEntity && prefs.entityUpdates) {
          chosenCategory = 'entidades';
          chosenEntityId = signals.entityId;
        } else if (signals.hasTopic && prefs.topicAlerts) {
          chosenCategory = 'temas';
        } else if (signals.hasSource && prefs.sourcesDigest) {
          chosenCategory = 'fontes';
        }

        if (!chosenCategory) {
          stats.skippedByPreferences++;
          continue;
        }

        // Proteção anti-flood por usuário:
        // Em dry-run somamos o acumulado simulado ao persistido; em execução real o banco já reflete os inserts anteriores.
        if (maxPerUserPerWindow > 0) {
          const persistedCount = recentCounts.get(userId) || 0;
          const runCount = options?.perUserRunCount?.get(userId) || 0;
          const effectiveCount = isDryRun
            ? persistedCount + runCount
            : Math.max(persistedCount, runCount);
          if (effectiveCount >= maxPerUserPerWindow) {
            stats.floodCapped++;
            continue;
          }
        }

        if (isDryRun) {
          if (existingDryRunKeys.has(`${userId}:${chosenCategory}`)) {
            stats.duplicates++;
          } else {
            stats.created++;
            if (options?.perUserRunCount) {
              options.perUserRunCount.set(userId, (options.perUserRunCount.get(userId) || 0) + 1);
            }
          }
          continue;
        }

        const baseDescription = (input.summary || input.title).trim();
        const descriptionText =
          eventRevision > 1 && input.significantChangeReason
            ? `Atualização relevante (rev. ${eventRevision}): ${baseDescription}`
            : baseDescription;
        const res = await this.createNotification({
          userId,
          type: canonicalType,
          category: chosenCategory,
          title: input.title,
          body: descriptionText,
          subtitle: descriptionText,
          eventId: input.eventId,
          entityId: chosenEntityId,
          eventRevision,
          metadata: {
            relevanceScore,
            eventRevision,
            ...(input.significantChangeReason
              ? { significantChangeReason: input.significantChangeReason }
              : {}),
          },
        });

        if (res.duplicate) {
          stats.duplicates++;
        } else if (res.success) {
          stats.created++;
          if (options?.perUserRunCount) {
            options.perUserRunCount.set(userId, (options.perUserRunCount.get(userId) || 0) + 1);
          }
        } else {
          stats.errors++;
          failedUserMasks.push(maskUserIdForLog(userId));
          if (res.error) errorDetails.push(res.error);
        }
      }
    } catch (err: any) {
      console.error('[NotificationEngine] Erro crítico na segmentação de notificações:', err?.message);
      stats.errors++;
      errorDetails.push(err?.message || 'Erro inesperado na segmentação.');
    }

    if (stats.errors > 0 && (stats.created > 0 || stats.duplicates > 0)) {
      stats.partialFailure = true;
    }
    if (failedUserMasks.length > 0) {
      stats.failedUserMasks = failedUserMasks.slice(0, 20);
    }
    if (errorDetails.length > 0) {
      stats.errorDetails = errorDetails;
    }
    return stats;
  },
};
