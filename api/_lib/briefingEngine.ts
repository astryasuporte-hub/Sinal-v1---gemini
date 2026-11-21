/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR — Motor Server-side de Geração e Entrega de Briefings (V2.3.1)
 *
 * Separa rigorosamente as 7 etapas operacionais:
 * 1. Seleção de acontecimentos reais persistidos (priorizando interesses seguidos)
 * 2. Criação do registro de Briefing (type: 'MORNING' | 'EVENING', status: 'GENERATING')
 * 3. Persistência ordenada em public.briefing_items
 * 4. Atualização de status para 'READY' (ou 'FAILED' se não houver eventos reais)
 * 5. Criação idempotente de notificação BRIEFING_READY
 * 6. Disparo de e-mail via Resend apenas quando habilitado e operacional
 * 7. Registro de 'SENT' e sent_at somente após confirmação real do provedor
 */

import { getServerSupabase } from './db.js';
import { getServerKeys } from './common.js';
import { notificationEngine } from './notificationEngine.js';

export type BriefingEditionType = 'MORNING' | 'EVENING';

export interface BriefingEventCandidate {
  id: string;
  title: string;
  summary: string;
  why_it_matters?: string;
  relevance_score: number;
  published_at: string;
}

export interface EligibleBriefingUser {
  userId: string;
  email: string | null;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  weekendEdition: boolean;
  timezone: string;
}

export interface GenerateBriefingResult {
  userId: string;
  type: BriefingEditionType;
  status: 'READY' | 'SENT' | 'FAILED' | 'SKIPPED_DUPLICATE' | 'SKIPPED_NO_EVENTS' | 'SKIPPED_DISABLED';
  briefingId?: string;
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

function isWeekendInTimezone(date: Date, timezone = 'America/Sao_Paulo'): boolean {
  try {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone }).format(date);
    return weekday === 'Sat' || weekday === 'Sun';
  } catch {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
  }
}

function getEditionDateRangeIso(referenceDate: Date): { dayStart: string; dayEnd: string; dateLabelPt: string } {
  const y = referenceDate.getUTCFullYear();
  const m = String(referenceDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(referenceDate.getUTCDate()).padStart(2, '0');
  const dayStart = `${y}-${m}-${d}T00:00:00.000Z`;
  const dayEnd = `${y}-${m}-${d}T23:59:59.999Z`;
  const dateLabelPt = `${d}/${m}/${y}`;
  return { dayStart, dayEnd, dateLabelPt };
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

export const briefingEngine = {
  /**
   * Lista usuários elegíveis a partir de public.user_preferences / public.user_settings.
   */
  async listEligibleUsers(type: BriefingEditionType, referenceDate = new Date()): Promise<EligibleBriefingUser[]> {
    const { getServerSupabase: getSb } = getDeps();
    const supabase = getSb();

    const [prefsRes, settingsRes] = await Promise.all([
      (supabase as any)
        .from('user_preferences')
        .select('id, briefing_email, email_morning_briefing, email_evening_briefing, weekend_edition, timezone'),
      (supabase as any)
        .from('user_settings')
        .select('user_id, briefing_email, email_morning_briefing, email_evening_briefing, weekend_edition, timezone, notification_settings')
    ]);

    const prefsMissing = prefsRes?.error && (prefsRes.error.code === '42P01' || prefsRes.error.code === 'PGRST205');
    const settingsMissing = settingsRes?.error && (settingsRes.error.code === '42P01' || settingsRes.error.code === 'PGRST205');

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
        timezone: sRow.timezone ?? existing.timezone,
        notification_settings: sRow.notification_settings ?? existing.notification_settings
      });
    }

    const users: EligibleBriefingUser[] = [];
    for (const [uid, row] of mergedByUser.entries()) {
      const morningEnabled = row.email_morning_briefing !== false;
      const eveningEnabled = row.email_evening_briefing !== false;
      const weekendEdition = Boolean(row.weekend_edition);
      const timezone = String(row.timezone || 'America/Sao_Paulo');

      if (type === 'MORNING' && !morningEnabled) continue;
      if (type === 'EVENING' && !eveningEnabled) continue;
      if (!weekendEdition && isWeekendInTimezone(referenceDate, timezone)) continue;

      users.push({
        userId: uid,
        email: row.briefing_email ? String(row.briefing_email).trim() : null,
        morningEnabled,
        eveningEnabled,
        weekendEdition,
        timezone,
      });
    }

    return users;
  },

  /**
   * Etapa 1: Seleção de acontecimentos reais persistidos para o usuário (nunca inventa notícias).
   */
  async selectEventsForUser(
    userId: string,
    options?: { windowHours?: number; limit?: number }
  ): Promise<BriefingEventCandidate[]> {
    const { getServerSupabase: getSb } = getDeps();
    const supabase = getSb();
    const limit = Math.max(1, Math.min(10, options?.limit ?? 6));
    const windowHours = Math.max(6, options?.windowHours ?? 36);
    const cutoffIso = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

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

    const ranked = [...candidates].sort((a, b) => {
      const aBoost = boostedEventIds.has(a.id) ? 25 : 0;
      const bBoost = boostedEventIds.has(b.id) ? 25 : 0;
      const scoreDiff = b.relevance_score + bBoost - (a.relevance_score + aBoost);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
    });

    return ranked.slice(0, limit);
  },

  /**
   * Executa as etapas 1..7 para um usuário específico com prevenção de duplicidade.
   */
  async generateForUser(params: {
    userId: string;
    type: BriefingEditionType;
    briefingEmail?: string | null;
    sendEmail?: boolean;
    referenceDate?: Date;
  }): Promise<GenerateBriefingResult> {
    const { getServerSupabase: getSb, getServerKeys: getKeys, fetchFn } = getDeps();
    const supabase = getSb();
    const refDate = params.referenceDate || new Date();
    const { dayStart, dayEnd, dateLabelPt } = getEditionDateRangeIso(refDate);

    // Verifica duplicidade para o mesmo usuário + tipo + dia
    const { data: existing, error: dupErr } = await (supabase as any)
      .from('briefings')
      .select('id, status')
      .eq('user_id', params.userId)
      .eq('type', params.type)
      .gte('scheduled_for', dayStart)
      .lte('scheduled_for', dayEnd)
      .maybeSingle();

    if (dupErr) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'FAILED',
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
        eventsCount: 0,
      };
    }

    // Etapa 1: Selecionar acontecimentos reais (não cria briefing vazio como completo!)
    const selectedEvents = await this.selectEventsForUser(params.userId);
    if (selectedEvents.length === 0) {
      return {
        userId: params.userId,
        type: params.type,
        status: 'SKIPPED_NO_EVENTS',
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

    // Etapa 2: Criação do registro com status GENERATING e type canônico
    const { data: createdRow, error: createErr } = await (supabase as any)
      .from('briefings')
      .insert({
        user_id: params.userId,
        type: params.type,
        title,
        description,
        status: 'GENERATING',
        scheduled_for: refDate.toISOString(),
      })
      .select('id')
      .single();

    if (createErr || !createdRow?.id) {
      if (createErr?.code === '23505') {
        return {
          userId: params.userId,
          type: params.type,
          status: 'SKIPPED_DUPLICATE',
          eventsCount: 0,
        };
      }
      return {
        userId: params.userId,
        type: params.type,
        status: 'FAILED',
        eventsCount: 0,
        error: createErr?.message || 'Falha ao inserir registro inicial de briefing.',
      };
    }

    const briefingId = String(createdRow.id);

    // Etapa 3: Persistir itens ordenados em public.briefing_items
    const itemsPayload = selectedEvents.map((ev, index) => ({
      briefing_id: briefingId,
      event_id: ev.id,
      order_index: index,
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
        eventsCount: selectedEvents.length,
        notificationCreated: Boolean(notifRes.success && !notifRes.skipped),
        emailSent: false,
        emailError: sendErr?.message || 'Erro de rede ao enviar briefing por e-mail.',
      };
    }
  },

  /**
   * Executa um ciclo completo de geração para todos os usuários elegíveis.
   */
  async runGenerationCycle(options: {
    type: BriefingEditionType;
    sendEmail?: boolean;
    referenceDate?: Date;
  }): Promise<{
    eligibleUsers: number;
    ready: number;
    sent: number;
    skippedDuplicates: number;
    skippedNoEvents: number;
    failed: number;
    results: GenerateBriefingResult[];
  }> {
    const eligible = await this.listEligibleUsers(options.type, options.referenceDate);
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
