/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BillingDunningService — Régua de Cobrança, Retenção e Comunicações Financeiras (Payments V2)
 *
 * Recursos:
 * 1. Todos os 8 gatilhos canônicos do ciclo financeiro:
 *    - PAYMENT_PENDING (aguardando pagamento / Pix emitido)
 *    - RENEWAL_UPCOMING (renovação próxima / vencimento do ciclo)
 *    - PAYMENT_REFUSED (falha de cobrança / recusa)
 *    - SUBSCRIPTION_PAST_DUE (assinatura em atraso / carência 3 dias)
 *    - DUNNING_RECOVERY (aviso intermediário de recuperação)
 *    - SUBSCRIPTION_REGULARIZED (regularização / reativação PRO)
 *    - SUBSCRIPTION_CANCELED (cancelamento confirmado preservando período pago)
 *    - SUBSCRIPTION_EXPIRED (expiração / suspensão do acesso)
 * 2. Trava explícita de homologação: enquanto PAYMENTS_DUNNING_EMAIL_ENABLED !== 'true',
 *    NENHUM e-mail real é enviado via Resend (registra status SKIPPED_HOMOLOGATION auditável).
 * 3. Deduplicação estrita via dedup_key em internal.billing_dunning_logs,
 *    respeito às preferências do usuário e limite max_attempts = 3 com retries em falhas transitórias.
 */

import { executeSql, isPostgresConfigured } from '../postgres.js';
import { getResendFromEmail, sendResendEmailWithRetry } from '../resendClient.js';

export type DunningTriggerType =
  | 'PAYMENT_PENDING'
  | 'RENEWAL_UPCOMING'
  | 'PAYMENT_REFUSED'
  | 'SUBSCRIPTION_PAST_DUE'
  | 'DUNNING_RECOVERY'
  | 'SUBSCRIPTION_REGULARIZED'
  | 'SUBSCRIPTION_CANCELED'
  | 'SUBSCRIPTION_EXPIRED';

export interface DunningReadinessStatus {
  emailSendingEnabled: boolean;
  homologationLockActive: boolean;
  resendApiKeyConfigured: boolean;
  fromEmail: string;
}

export interface DispatchDunningInput {
  userId: string;
  userEmail?: string | null;
  subscriptionId?: string | null;
  triggerType: DunningTriggerType;
  dedupKey: string;
  periodEndIso?: string | null;
  amountCents?: number;
  metadata?: Record<string, any>;
  fetchFn?: typeof fetch;
}

export interface DispatchDunningOutcome {
  status: 'SENT' | 'SKIPPED_HOMOLOGATION' | 'SKIPPED_PREFERENCES' | 'DUPLICATE' | 'FAILED' | 'QUEUED';
  dedupKey: string;
  triggerType: DunningTriggerType;
  messageId?: string;
  error?: string;
}

function maskEmail(email?: string | null): string | null {
  const raw = String(email || '').trim();
  const atIdx = raw.indexOf('@');
  if (atIdx <= 0) return null;
  const local = raw.slice(0, atIdx);
  const domain = raw.slice(atIdx + 1);
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`;
}

export function getDunningReadiness(): DunningReadinessStatus {
  const emailSendingEnabled =
    String(process.env.PAYMENTS_DUNNING_EMAIL_ENABLED || 'false').trim().toLowerCase() === 'true';
  const resendApiKeyConfigured = Boolean(String(process.env.RESEND_API_KEY || '').trim());
  return {
    emailSendingEnabled,
    homologationLockActive: !emailSendingEnabled,
    resendApiKeyConfigured,
    fromEmail: getResendFromEmail(),
  };
}

function buildDunningTemplate(input: DispatchDunningInput): {
  subject: string;
  html: string;
  text: string;
  inAppType?: 'PAYMENT_FAILED' | 'SUBSCRIPTION_ACTIVE' | 'TRIAL_EXPIRING' | 'SYSTEM';
  inAppTitle?: string;
  inAppBody?: string;
} {
  const amountFormatted = `R$ ${((input.amountCents || 3490) / 100).toFixed(2).replace('.', ',')}`;
  const periodLabel = input.periodEndIso
    ? new Date(input.periodEndIso).toLocaleDateString('pt-BR')
    : 'próximo ciclo';
  const appUrl = 'https://app.fatosbr.com.br';

  switch (input.triggerType) {
    case 'PAYMENT_PENDING':
      return {
        subject: 'FatosBR PRO — Pagamento pendente aguardando confirmação',
        html: `<p>Recebemos a solicitação de assinatura do <strong>FatosBR PRO</strong> (${amountFormatted}). Assim que o pagamento for confirmado, seu acesso será liberado automaticamente.</p><p><a href="${appUrl}">Acessar FatosBR</a></p>`,
        text: `Recebemos sua solicitação do FatosBR PRO (${amountFormatted}). Assim que o pagamento for confirmado, seu acesso será liberado automaticamente em ${appUrl}.`,
        inAppType: 'SYSTEM',
        inAppTitle: 'Pagamento FatosBR PRO em processamento',
        inAppBody: `Sua cobrança de ${amountFormatted} está aguardando confirmação do gateway.`,
      };

    case 'RENEWAL_UPCOMING':
      return {
        subject: 'FatosBR PRO — Lembrete de renovação do seu plano',
        html: `<p>Seu ciclo atual do <strong>FatosBR PRO</strong> encerra em ${periodLabel}. Para manter suas edições diárias e monitoramento sem interrupção, acompanhe o status da sua assinatura.</p><p><a href="${appUrl}">Gerenciar assinatura</a></p>`,
        text: `Seu ciclo do FatosBR PRO encerra em ${periodLabel}. Acompanhe ou renove sua assinatura em ${appUrl}.`,
        inAppType: 'TRIAL_EXPIRING',
        inAppTitle: 'Renovação próxima do FatosBR PRO',
        inAppBody: `Seu ciclo atual vence em ${periodLabel}.`,
      };

    case 'PAYMENT_REFUSED':
      return {
        subject: 'FatosBR PRO — Não foi possível aprovar sua cobrança',
        html: `<p>A tentativa de pagamento do <strong>FatosBR PRO</strong> (${amountFormatted}) não foi aprovada pelo emissor. Acesse a plataforma para atualizar a forma de pagamento.</p><p><a href="${appUrl}">Atualizar pagamento</a></p>`,
        text: `Não foi possível aprovar a cobrança de ${amountFormatted} do FatosBR PRO. Atualize seu pagamento em ${appUrl}.`,
        inAppType: 'PAYMENT_FAILED',
        inAppTitle: 'Pagamento não aprovado',
        inAppBody: 'Não foi possível aprovar sua cobrança PRO. Verifique sua forma de pagamento.',
      };

    case 'SUBSCRIPTION_PAST_DUE':
      return {
        subject: 'FatosBR PRO — Assinatura em atraso (período de carência ativo)',
        html: `<p>Identificamos pendência na renovação do seu <strong>FatosBR PRO</strong>. Seu acesso permanece em período de carência enquanto realizamos nova tentativa.</p><p><a href="${appUrl}">Regularizar agora</a></p>`,
        text: `Sua assinatura FatosBR PRO está em atraso com carência temporária ativa. Regularize em ${appUrl}.`,
        inAppType: 'PAYMENT_FAILED',
        inAppTitle: 'Renovação em atraso',
        inAppBody: 'Sua assinatura PRO entrou em período de carência. Regularize para evitar suspensão.',
      };

    case 'DUNNING_RECOVERY':
      return {
        subject: 'FatosBR PRO — Últimos dias de carência para evitar suspensão',
        html: `<p>Ainda não conseguimos confirmar a renovação do seu <strong>FatosBR PRO</strong> (${amountFormatted}). Regularize em poucos cliques para preservar alertas e briefings personalizados.</p><p><a href="${appUrl}">Regularizar assinatura</a></p>`,
        text: `Ainda não confirmamos a renovação do seu FatosBR PRO. Regularize em ${appUrl} para manter o acesso contínuo.`,
        inAppType: 'PAYMENT_FAILED',
        inAppTitle: 'Ação necessária para manter o FatosBR PRO',
        inAppBody: 'Seu período de carência está perto do fim. Regularize o pagamento para evitar suspensão.',
      };

    case 'SUBSCRIPTION_REGULARIZED':
      return {
        subject: 'FatosBR PRO — Assinatura ativa e confirmada',
        html: `<p>Seu pagamento foi confirmado e o acesso completo ao <strong>FatosBR PRO</strong> está ativo até ${periodLabel}.</p><p><a href="${appUrl}">Abrir FatosBR</a></p>`,
        text: `Pagamento confirmado! Seu FatosBR PRO está ativo até ${periodLabel} em ${appUrl}.`,
        inAppType: 'SUBSCRIPTION_ACTIVE',
        inAppTitle: 'FatosBR PRO ativo',
        inAppBody: `Assinatura confirmada e vigente até ${periodLabel}.`,
      };

    case 'SUBSCRIPTION_CANCELED':
      return {
        subject: 'FatosBR PRO — Cancelamento confirmado',
        html: `<p>O cancelamento da sua assinatura <strong>FatosBR PRO</strong> foi registrado. Caso exista período já pago vigente (${periodLabel}), o acesso permanece ativo até o término.</p><p><a href="${appUrl}">Ver detalhes</a></p>`,
        text: `Cancelamento do FatosBR PRO registrado. Eventual período já pago permanece válido até ${periodLabel}.`,
        inAppType: 'SYSTEM',
        inAppTitle: 'Cancelamento confirmado',
        inAppBody: `Sua assinatura FatosBR PRO foi marcada para encerramento em ${periodLabel}.`,
      };

    case 'SUBSCRIPTION_EXPIRED':
      return {
        subject: 'FatosBR PRO — Assinatura expirada',
        html: `<p>O ciclo da sua assinatura <strong>FatosBR PRO</strong> encerrou. Quando desejar retomar o acesso completo, você pode reativar sua assinatura na plataforma.</p><p><a href="${appUrl}">Reativar FatosBR PRO</a></p>`,
        text: `Sua assinatura FatosBR PRO expirou. Reative quando desejar em ${appUrl}.`,
        inAppType: 'SYSTEM',
        inAppTitle: 'Assinatura FatosBR PRO expirada',
        inAppBody: 'O acesso PRO foi encerrado após o término do período vigente.',
      };
  }
}

export class BillingDunningService {
  private async hasDunningTable(): Promise<boolean> {
    if (!isPostgresConfigured()) return false;
    try {
      const reg = await executeSql(`SELECT to_regclass('internal.billing_dunning_logs') IS NOT NULL AS ok`);
      return Boolean(reg.rows[0]?.ok);
    } catch {
      return false;
    }
  }

  private async resolveRecipientAndPreferences(
    userId: string,
    explicitEmail?: string | null
  ): Promise<{ email: string | null; emailAllowed: boolean }> {
    if (!isPostgresConfigured()) {
      return { email: explicitEmail || null, emailAllowed: true };
    }

    let email = explicitEmail || null;
    if (!email) {
      const userRes = await executeSql(`SELECT email FROM auth.users WHERE id = $1::uuid LIMIT 1`, [userId]).catch(
        () => ({ rows: [] })
      );
      email = userRes.rows[0]?.email ? String(userRes.rows[0].email) : null;
    }

    let emailAllowed = true;
    try {
      const regSettings = await executeSql(
        `SELECT to_regclass('public.user_settings') IS NOT NULL AS has_settings,
                to_regclass('public.user_preferences') IS NOT NULL AS has_prefs`
      );
      if (regSettings.rows[0]?.has_settings) {
        const sRes = await executeSql(
          `SELECT notification_settings FROM public.user_settings WHERE user_id = $1::uuid LIMIT 1`,
          [userId]
        ).catch(() => ({ rows: [] }));
        const ns = sRes.rows[0]?.notification_settings;
        if (ns && typeof ns === 'object') {
          if (ns.billing_emails === false || ns.email_enabled === false || ns.marketing_opt_out === true) {
            emailAllowed = false;
          }
        }
      }
      if (emailAllowed && regSettings.rows[0]?.has_prefs) {
        const pRes = await executeSql(
          `SELECT notification_settings FROM public.user_preferences WHERE id = $1::uuid LIMIT 1`,
          [userId]
        ).catch(() => ({ rows: [] }));
        const pns = pRes.rows[0]?.notification_settings;
        if (pns && typeof pns === 'object') {
          if (pns.billing_emails === false || pns.email_enabled === false) {
            emailAllowed = false;
          }
        }
      }
    } catch {
      // Fail-open apenas em consulta opcional de preferências transacionais de cobrança
    }

    return { email, emailAllowed };
  }

  private async recordInAppNotification(
    input: DispatchDunningInput,
    template: ReturnType<typeof buildDunningTemplate>
  ): Promise<void> {
    if (!isPostgresConfigured() || !template.inAppType || !template.inAppTitle) return;
    try {
      const reg = await executeSql(`SELECT to_regclass('public.notifications') IS NOT NULL AS ok`);
      if (!reg.rows[0]?.ok) return;

      const existing = await executeSql(
        `SELECT id FROM public.notifications
         WHERE user_id = $1::uuid
           AND type = $2
           AND COALESCE(metadata->>'dedup_key', '') = $3
         LIMIT 1`,
        [input.userId, template.inAppType, input.dedupKey]
      );
      if (existing.rows.length > 0) return;

      await executeSql(
        `INSERT INTO public.notifications (
          id, user_id, type, title, message, read, metadata, created_at
        ) VALUES (
          gen_random_uuid(), $1::uuid, $2, $3, $4, false, $5::jsonb, NOW()
        )`,
        [
          input.userId,
          template.inAppType,
          template.inAppTitle,
          template.inAppBody || template.subject,
          JSON.stringify({
            dedup_key: input.dedupKey,
            trigger_type: input.triggerType,
            source: 'payments_v2_dunning',
          }),
        ]
      );
    } catch {
      // Nunca compromete o processamento de pagamentos se o esquema de notificações variar
    }
  }

  async dispatchTrigger(input: DispatchDunningInput): Promise<DispatchDunningOutcome> {
    const readiness = getDunningReadiness();
    const template = buildDunningTemplate(input);
    const hasTable = await this.hasDunningTable();

    if (hasTable) {
      const existing = await executeSql(
        `SELECT id, status, attempt_count, max_attempts, resend_message_id
         FROM internal.billing_dunning_logs
         WHERE dedup_key = $1
         LIMIT 1`,
        [input.dedupKey]
      );
      const prev = existing.rows[0];
      if (prev && (prev.status === 'SENT' || prev.status === 'SKIPPED_PREFERENCES' || Number(prev.attempt_count) >= Number(prev.max_attempts || 3))) {
        return {
          status: 'DUPLICATE',
          dedupKey: input.dedupKey,
          triggerType: input.triggerType,
          messageId: prev.resend_message_id ? String(prev.resend_message_id) : undefined,
        };
      }
      if (prev && prev.status === 'SKIPPED_HOMOLOGATION' && !readiness.emailSendingEnabled) {
        return {
          status: 'DUPLICATE',
          dedupKey: input.dedupKey,
          triggerType: input.triggerType,
        };
      }
    }

    const { email, emailAllowed } = await this.resolveRecipientAndPreferences(input.userId, input.userEmail);
    const recipientMasked = maskEmail(email);

    // Notificação in-app segura no banco local (sem disparo externo)
    await this.recordInAppNotification(input, template);

    // Preferência do usuário respeitada antes de enviar e-mail
    if (!emailAllowed && input.triggerType !== 'SUBSCRIPTION_REGULARIZED') {
      if (hasTable) {
        await executeSql(
          `INSERT INTO internal.billing_dunning_logs (
            id, user_id, subscription_id, trigger_type, channel, dedup_key,
            recipient_masked, subject, status, attempt_count, max_attempts, metadata, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1::uuid, $2::uuid, $3, 'EMAIL', $4,
            $5, $6, 'SKIPPED_PREFERENCES', 0, 3, $7::jsonb, NOW(), NOW()
          )
          ON CONFLICT (dedup_key) DO NOTHING`,
          [
            input.userId,
            input.subscriptionId || null,
            input.triggerType,
            input.dedupKey,
            recipientMasked,
            template.subject,
            JSON.stringify(input.metadata || {}),
          ]
        );
      }
      return {
        status: 'SKIPPED_PREFERENCES',
        dedupKey: input.dedupKey,
        triggerType: input.triggerType,
      };
    }

    // Trava estrita de homologação: ZERO e-mail real enviado sem liberação explícita
    if (!readiness.emailSendingEnabled) {
      if (hasTable) {
        await executeSql(
          `INSERT INTO internal.billing_dunning_logs (
            id, user_id, subscription_id, trigger_type, channel, dedup_key,
            recipient_masked, subject, status, attempt_count, max_attempts, metadata, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1::uuid, $2::uuid, $3, 'EMAIL', $4,
            $5, $6, 'SKIPPED_HOMOLOGATION', 0, 3, $7::jsonb, NOW(), NOW()
          )
          ON CONFLICT (dedup_key) DO NOTHING`,
          [
            input.userId,
            input.subscriptionId || null,
            input.triggerType,
            input.dedupKey,
            recipientMasked,
            template.subject,
            JSON.stringify({ ...(input.metadata || {}), homologation_lock: true }),
          ]
        );
      }
      return {
        status: 'SKIPPED_HOMOLOGATION',
        dedupKey: input.dedupKey,
        triggerType: input.triggerType,
      };
    }

    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    if (!apiKey || !email) {
      const errorMsg = !apiKey ? 'RESEND_API_KEY_NOT_CONFIGURED' : 'RECIPIENT_EMAIL_MISSING';
      if (hasTable) {
        await executeSql(
          `INSERT INTO internal.billing_dunning_logs (
            id, user_id, subscription_id, trigger_type, channel, dedup_key,
            recipient_masked, subject, status, attempt_count, max_attempts, last_error, metadata, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1::uuid, $2::uuid, $3, 'EMAIL', $4,
            $5, $6, 'FAILED', 1, 3, $7, $8::jsonb, NOW(), NOW()
          )
          ON CONFLICT (dedup_key) DO UPDATE SET
            status = 'FAILED',
            attempt_count = internal.billing_dunning_logs.attempt_count + 1,
            last_error = EXCLUDED.last_error,
            updated_at = NOW()`,
          [
            input.userId,
            input.subscriptionId || null,
            input.triggerType,
            input.dedupKey,
            recipientMasked,
            template.subject,
            errorMsg,
            JSON.stringify(input.metadata || {}),
          ]
        );
      }
      return {
        status: 'FAILED',
        dedupKey: input.dedupKey,
        triggerType: input.triggerType,
        error: errorMsg,
      };
    }

    const sendRes = await sendResendEmailWithRetry({
      apiKey,
      to: [email],
      subject: template.subject,
      html: template.html,
      text: template.text,
      idempotencyKey: `fatosbr-dunning:${input.dedupKey}`,
      maxAttempts: 3,
      fetchFn: input.fetchFn,
    });

    if (hasTable) {
      await executeSql(
        `INSERT INTO internal.billing_dunning_logs (
          id, user_id, subscription_id, trigger_type, channel, dedup_key,
          recipient_masked, subject, status, attempt_count, max_attempts,
          resend_message_id, last_error, sent_at, metadata, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1::uuid, $2::uuid, $3, 'EMAIL', $4,
          $5, $6, $7, $8, 3,
          $9, $10, $11::timestamptz, $12::jsonb, NOW(), NOW()
        )
        ON CONFLICT (dedup_key) DO UPDATE SET
          status = EXCLUDED.status,
          attempt_count = internal.billing_dunning_logs.attempt_count + EXCLUDED.attempt_count,
          resend_message_id = COALESCE(EXCLUDED.resend_message_id, internal.billing_dunning_logs.resend_message_id),
          last_error = EXCLUDED.last_error,
          sent_at = COALESCE(EXCLUDED.sent_at, internal.billing_dunning_logs.sent_at),
          updated_at = NOW()`,
        [
          input.userId,
          input.subscriptionId || null,
          input.triggerType,
          input.dedupKey,
          recipientMasked,
          template.subject,
          sendRes.ok ? 'SENT' : 'FAILED',
          sendRes.attemptsMade,
          sendRes.messageId || null,
          sendRes.ok ? null : sendRes.error || 'RESEND_SEND_FAILED',
          sendRes.ok ? new Date().toISOString() : null,
          JSON.stringify(input.metadata || {}),
        ]
      );
    }

    return {
      status: sendRes.ok ? 'SENT' : 'FAILED',
      dedupKey: input.dedupKey,
      triggerType: input.triggerType,
      messageId: sendRes.messageId,
      error: sendRes.error,
    };
  }

  /**
   * Mapeia ações de webhook para o gatilho canônico correspondente na régua de cobrança.
   */
  resolveTriggerForCanonicalAction(canonicalAction: string): DunningTriggerType | null {
    switch (canonicalAction) {
      case 'PENDING_PAYMENT':
        return 'PAYMENT_PENDING';
      case 'REFUSED':
        return 'PAYMENT_REFUSED';
      case 'PAST_DUE':
        return 'SUBSCRIPTION_PAST_DUE';
      case 'ACTIVATE':
      case 'RECOVER':
      case 'RENEW':
        return 'SUBSCRIPTION_REGULARIZED';
      case 'CANCEL':
        return 'SUBSCRIPTION_CANCELED';
      case 'EXPIRE':
      case 'PIX_EXPIRED':
        return 'SUBSCRIPTION_EXPIRED';
      default:
        return null;
    }
  }

  /**
   * Executa avaliação periódica de renovações próximas (D-3), assinaturas PAST_DUE (recuperação)
   * e assinaturas vencidas para disparo/auditoria idempotente.
   */
  async runDunningCycle(options: { fetchFn?: typeof fetch } = {}): Promise<{
    scanned: number;
    processed: DispatchDunningOutcome[];
    readiness: DunningReadinessStatus;
  }> {
    const readiness = getDunningReadiness();
    if (!isPostgresConfigured()) {
      return { scanned: 0, processed: [], readiness };
    }

    const res = await executeSql(`
      SELECT s.id AS subscription_id, s.user_id, u.email AS user_email, s.status,
             s.current_period_end, s.grace_until, s.amount_cents, s.billing_metadata
      FROM public.subscriptions s
      LEFT JOIN auth.users u ON u.id = s.user_id
      WHERE UPPER(s.status) IN ('ACTIVE', 'PAST_DUE', 'CANCELED', 'CANCELLED')
        AND COALESCE((s.billing_metadata->>'admin_courtesy')::boolean, false) = false
      ORDER BY s.updated_at DESC
      LIMIT 100
    `);

    const nowMs = Date.now();
    const outcomes: DispatchDunningOutcome[] = [];
    const dayKey = new Date(nowMs).toISOString().slice(0, 10);

    for (const row of res.rows) {
      const status = String(row.status || '').toUpperCase();
      const periodEndMs = row.current_period_end ? Date.parse(row.current_period_end) : NaN;
      const graceMs = row.grace_until ? Date.parse(row.grace_until) : NaN;

      if (status === 'ACTIVE' && Number.isFinite(periodEndMs)) {
        const diffDays = (periodEndMs - nowMs) / (24 * 60 * 60 * 1000);
        if (diffDays > 0 && diffDays <= 3) {
          outcomes.push(
            await this.dispatchTrigger({
              userId: String(row.user_id),
              userEmail: row.user_email,
              subscriptionId: String(row.subscription_id),
              triggerType: 'RENEWAL_UPCOMING',
              dedupKey: `renewal-upcoming:${row.subscription_id}:${dayKey}`,
              periodEndIso: new Date(periodEndMs).toISOString(),
              amountCents: Number(row.amount_cents || 3490),
              fetchFn: options.fetchFn,
            })
          );
        }
      } else if (status === 'PAST_DUE') {
        const inGrace = Number.isFinite(graceMs) && graceMs > nowMs;
        outcomes.push(
          await this.dispatchTrigger({
            userId: String(row.user_id),
            userEmail: row.user_email,
            subscriptionId: String(row.subscription_id),
            triggerType: inGrace ? 'DUNNING_RECOVERY' : 'SUBSCRIPTION_EXPIRED',
            dedupKey: `${inGrace ? 'dunning-recovery' : 'expired'}:${row.subscription_id}:${dayKey}`,
            periodEndIso: row.current_period_end || null,
            amountCents: Number(row.amount_cents || 3490),
            fetchFn: options.fetchFn,
          })
        );
      }
    }

    return {
      scanned: res.rows.length,
      processed: outcomes,
      readiness,
    };
  }
}

export const billingDunningService = new BillingDunningService();
