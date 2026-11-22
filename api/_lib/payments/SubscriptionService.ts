/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SubscriptionService — Fonte Autoritativa de Assinaturas e Trial de 7 Dias (Payments V1.1)
 *
 * Regras:
 * 1. Plano pago único: FatosBR PRO (R$ 34,90/mês).
 * 2. Administradores (app_metadata ou internal.user_roles) são isentos com acesso pleno.
 * 3. Trial de 7 dias deriva EXCLUSIVAMENTE de trial_starts_at/trial_ends_at do banco ou auth.users.created_at.
 *    NUNCA inventa um novo trial de 7 dias em caso de falha de banco (fail-closed) nem após histórico pago.
 * 4. NUNCA ativa PRO no frontend; o status sempre deriva do servidor e webhooks validados.
 */

import { SAAS_TRIAL_DAYS, resolvePlanPrice } from '../plans.js';
import { toDbSubscriptionPlan, toDbSubscriptionStatus } from './DbContractMapper.js';
import { getActivePaymentProviderId, getPaymentProvider } from './PaymentProviderRegistry.js';
import { DbSubscriptionRow, formatMethodLabel, getPaymentsPersistence, PaymentsPersistenceAdapter } from './PaymentsStore.js';
import type {
  BillingHistoryEntry,
  CanonicalSubscriptionStatus,
  UserSubscriptionView,
} from './types.js';

export class SubscriptionVerificationUnavailableError extends Error {
  readonly code = 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionVerificationUnavailableError';
  }
}

function formatPtBrDate(iso?: string | null): string {
  if (!iso) return '--';
  try {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return String(iso);
    return new Date(ms).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(iso);
  }
}

export class SubscriptionService {
  constructor(private readonly storeProvider: () => PaymentsPersistenceAdapter = getPaymentsPersistence) {}

  async getUserSubscriptionStatus(params: {
    userId: string;
    userEmail?: string | null;
    userCreatedAt?: string | null;
    isAdmin?: boolean;
  }): Promise<UserSubscriptionView> {
    const plan = resolvePlanPrice('pro');
    const activeProviderId = getActivePaymentProviderId();
    const provider = getPaymentProvider(activeProviderId);
    const commercialReadiness = await provider.getCommercialReadiness();

    if (params.isAdmin) {
      const adminDate = params.userCreatedAt || new Date().toISOString();
      return {
        status: 'ACTIVE',
        planId: 'pro',
        planName: 'FatosBR PRO (Admin Cortesia)',
        amount: 0,
        amountCents: 0,
        currency: 'BRL',
        trialDaysLeft: 0,
        trialTotalDays: SAAS_TRIAL_DAYS,
        trialStartsAt: formatPtBrDate(adminDate),
        trialEndsAt: formatPtBrDate(adminDate),
        currentPeriodEnd: 'Acesso Administrativo Permanente',
        cancelAtPeriodEnd: false,
        gateway: 'Cakto Assinaturas',
        provider: activeProviderId,
        paymentMethod: 'Cortesia Admin',
        allowedMethods: plan.allowedMethods,
        isAdminExempt: true,
        hasProAccess: true,
        commercialReadiness,
      };
    }

    const store = this.storeProvider();
    let row: DbSubscriptionRow | null = null;
    try {
      row = await store.findSubscriptionByUserId(params.userId);
    } catch (err: any) {
      throw new SubscriptionVerificationUnavailableError(
        err?.message || 'Falha ao consultar o banco de dados de assinaturas (fail-closed).'
      );
    }

    // Resolve ancoragem real do trial (DB trial_starts_at/trial_ends_at -> userCreatedAt -> auth.users.created_at)
    let resolvedCreatedAt: string | null = row?.trial_starts_at || params.userCreatedAt || null;
    if (!resolvedCreatedAt && typeof store.findUserCreatedAt === 'function') {
      try {
        resolvedCreatedAt = await store.findUserCreatedAt(params.userId);
      } catch (err: any) {
        throw new SubscriptionVerificationUnavailableError(
          err?.message || 'Falha ao validar origem do trial do usuário (fail-closed).'
        );
      }
    }

    const nowMs = Date.now();
    const trialStartMs = resolvedCreatedAt ? Date.parse(resolvedCreatedAt) : NaN;
    const explicitTrialEndMs = row?.trial_ends_at ? Date.parse(row.trial_ends_at) : NaN;

    const hasValidTrialOrigin = Number.isFinite(explicitTrialEndMs) || Number.isFinite(trialStartMs);
    const trialEndsMs = Number.isFinite(explicitTrialEndMs)
      ? explicitTrialEndMs
      : Number.isFinite(trialStartMs)
      ? trialStartMs + SAAS_TRIAL_DAYS * 24 * 60 * 60 * 1000
      : 0;

    const trialStartsIso = Number.isFinite(trialStartMs)
      ? new Date(trialStartMs).toISOString()
      : null;
    const trialEndsIso = hasValidTrialOrigin ? new Date(trialEndsMs).toISOString() : null;
    const remainingTrialDays = hasValidTrialOrigin
      ? Math.max(0, Math.ceil((trialEndsMs - nowMs) / (24 * 60 * 60 * 1000)))
      : 0;

    if (row) {
      const dbStatus = String(row.status || '').toUpperCase().trim();
      const dbPlan = String(row.plan || '').toUpperCase().trim();
      const meta = row.billing_metadata && typeof row.billing_metadata === 'object' ? row.billing_metadata : {};
      const periodEndIso = row.current_period_end || trialEndsIso || null;
      const periodEndMs = row.current_period_end ? Date.parse(row.current_period_end) : 0;
      const graceEndMs = row.grace_until ? Date.parse(row.grace_until) : 0;
      const hadPaidHistory = Boolean(
        meta.had_paid_cycle === true ||
          meta.refunded === true ||
          meta.chargeback === true ||
          meta.expired === true ||
          dbPlan === 'PRO'
      );

      let canonicalStatus: CanonicalSubscriptionStatus = 'TRIAL_EXPIRED';
      let hasProAccess = false;
      let reconciliationRequired = false;
      let reconciliationReason: string | null = null;

      const isAuthorizedCourtesy = Boolean(
        meta.admin_courtesy === true &&
          (!meta.courtesy_expires_at ||
            (Number.isFinite(Date.parse(String(meta.courtesy_expires_at))) &&
              Date.parse(String(meta.courtesy_expires_at)) > nowMs))
      );

      if (dbStatus === 'ACTIVE') {
        if (isAuthorizedCourtesy) {
          canonicalStatus = 'ACTIVE';
          hasProAccess = true;
        } else if (row.current_period_end && Number.isFinite(periodEndMs)) {
          if (periodEndMs > nowMs) {
            canonicalStatus = 'ACTIVE';
            hasProAccess = true;
          } else {
            canonicalStatus = 'EXPIRED';
            hasProAccess = false;
          }
        } else {
          // PRO sem current_period_end válido NUNCA recebe acesso indefinido; requer reconciliação segura
          canonicalStatus = 'INCOMPLETE';
          hasProAccess = false;
          reconciliationRequired = true;
          reconciliationReason = 'MISSING_CURRENT_PERIOD_END';
        }
      } else if (dbStatus === 'PAST_DUE') {
        canonicalStatus = 'PAST_DUE';
        hasProAccess = Boolean(graceEndMs > nowMs && !meta.refunded && !meta.chargeback);
      } else if (dbStatus === 'CANCELED' || dbStatus === 'CANCELLED') {
        canonicalStatus = 'CANCELED';
        hasProAccess = Boolean(
          !meta.refunded &&
            !meta.chargeback &&
            row.current_period_end &&
            Number.isFinite(periodEndMs) &&
            periodEndMs > nowMs
        );
      } else if (dbStatus === 'SUSPENDED') {
        canonicalStatus = meta.expired ? 'EXPIRED' : 'SUSPENDED';
        hasProAccess = false;
      } else if (dbStatus === 'INCOMPLETE') {
        canonicalStatus = meta.refused ? 'PAYMENT_REFUSED' : 'INCOMPLETE';
        hasProAccess = false;
        if (!meta.refused) {
          reconciliationRequired = true;
          reconciliationReason = 'INCOMPLETE_SUBSCRIPTION';
        }
      } else if (dbStatus === 'EXPIRED') {
        canonicalStatus = 'EXPIRED';
        hasProAccess = false;
      } else if (dbStatus === 'PAYMENT_REFUSED') {
        canonicalStatus = 'PAYMENT_REFUSED';
        hasProAccess = false;
      } else if (dbStatus === 'RENEWAL_PENDING' || dbStatus === 'PENDING') {
        canonicalStatus = 'RENEWAL_PENDING';
        hasProAccess = Boolean(
          (row.current_period_end && Number.isFinite(periodEndMs) && periodEndMs > nowMs && meta.pro_paid !== false) ||
            (!hadPaidHistory && remainingTrialDays > 0)
        );
      } else if (dbStatus === 'TRIAL_ACTIVE' || dbStatus === 'TRIALING') {
        if (!hadPaidHistory && remainingTrialDays > 0) {
          canonicalStatus = 'TRIAL_ACTIVE';
          hasProAccess = true;
        } else {
          canonicalStatus = 'TRIAL_EXPIRED';
          hasProAccess = false;
        }
      } else if (dbStatus === 'TRIAL_EXPIRED') {
        canonicalStatus = 'TRIAL_EXPIRED';
        hasProAccess = false;
      }

      const isPaidTier =
        canonicalStatus === 'ACTIVE' ||
        canonicalStatus === 'PAST_DUE' ||
        canonicalStatus === 'CANCELED' ||
        canonicalStatus === 'SUSPENDED' ||
        canonicalStatus === 'EXPIRED' ||
        canonicalStatus === 'PAYMENT_REFUSED' ||
        canonicalStatus === 'INCOMPLETE' ||
        (canonicalStatus === 'RENEWAL_PENDING' && hadPaidHistory);

      return {
        status: canonicalStatus,
        planId: isPaidTier ? 'pro' : 'trial',
        planName: isPaidTier ? plan.name : `Trial Gratuito (${SAAS_TRIAL_DAYS} dias)`,
        amount: plan.amountCents / 100,
        amountCents: plan.amountCents,
        currency: 'BRL',
        trialDaysLeft: canonicalStatus === 'TRIAL_ACTIVE' ? remainingTrialDays : 0,
        trialTotalDays: SAAS_TRIAL_DAYS,
        trialStartsAt: formatPtBrDate(trialStartsIso),
        trialEndsAt: formatPtBrDate(trialEndsIso),
        currentPeriodStart: row.current_period_start ? formatPtBrDate(row.current_period_start) : null,
        currentPeriodEnd: isAuthorizedCourtesy
          ? row.current_period_end
            ? formatPtBrDate(row.current_period_end)
            : 'Cortesia Autorizada'
          : formatPtBrDate(periodEndIso),
        nextBillingAt: row.next_billing_at ? formatPtBrDate(row.next_billing_at) : null,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        canceledAt: row.canceled_at || null,
        graceUntil: row.grace_until || null,
        gateway: 'Cakto Assinaturas',
        provider: activeProviderId,
        paymentMethod: isAuthorizedCourtesy ? 'Cortesia Administrativa' : formatMethodLabel(row.payment_method),
        allowedMethods: plan.allowedMethods,
        isAdminExempt: false,
        hasProAccess,
        reconciliationRequired,
        reconciliationReason,
        providerSubscriptionId: row.provider_subscription_id || null,
        commercialReadiness,
      };
    }

    // Sem linha em public.subscriptions: usa apenas origem confiável de trial (nunca reinventa 7 dias sem created_at)
    const trialStatus: CanonicalSubscriptionStatus = remainingTrialDays > 0 ? 'TRIAL_ACTIVE' : 'TRIAL_EXPIRED';
    return {
      status: trialStatus,
      planId: 'trial',
      planName: `Trial Gratuito (${SAAS_TRIAL_DAYS} dias)`,
      amount: plan.amountCents / 100,
      amountCents: plan.amountCents,
      currency: 'BRL',
      trialDaysLeft: remainingTrialDays,
      trialTotalDays: SAAS_TRIAL_DAYS,
      trialStartsAt: formatPtBrDate(trialStartsIso),
      trialEndsAt: formatPtBrDate(trialEndsIso),
      currentPeriodEnd: formatPtBrDate(trialEndsIso),
      cancelAtPeriodEnd: false,
      gateway: 'Cakto Assinaturas',
      provider: activeProviderId,
      paymentMethod: formatMethodLabel(null),
      allowedMethods: plan.allowedMethods,
      isAdminExempt: false,
      hasProAccess: remainingTrialDays > 0,
      commercialReadiness,
    };
  }

  async cancelUserSubscription(userId: string): Promise<{
    success: boolean;
    canceledAt: string;
    message: string;
    error?: string;
  }> {
    const store = this.storeProvider();
    let row: DbSubscriptionRow | null = null;
    try {
      row = await store.findSubscriptionByUserId(userId);
    } catch (err: any) {
      throw new SubscriptionVerificationUnavailableError(
        err?.message || 'Banco de assinaturas indisponível durante o cancelamento.'
      );
    }

    if (!row) {
      return {
        success: false,
        canceledAt: new Date().toISOString(),
        message: 'Nenhuma assinatura encontrada para cancelamento.',
        error: 'SUBSCRIPTION_NOT_FOUND',
      };
    }

    const provider = getPaymentProvider(row.provider || getActivePaymentProviderId());
    if (row.provider_subscription_id) {
      const remote = await provider.cancelSubscription(row.provider_subscription_id);
      if (!remote.success) {
        return {
          success: false,
          canceledAt: remote.canceledAt,
          message: remote.error || 'Falha ao cancelar assinatura no provedor.',
          error: remote.error,
        };
      }
    }

    const nowIso = new Date().toISOString();
    const plan = resolvePlanPrice('pro');
    await store.upsertSubscription({
      userId,
      plan: toDbSubscriptionPlan(row.plan || 'PRO'),
      planId: row.plan_id || 'pro',
      status: toDbSubscriptionStatus('CANCELED'),
      provider: row.provider || 'cakto',
      productId: row.product_id || plan.productId,
      offerId: row.offer_id || plan.offerId,
      checkoutId: row.checkout_id || plan.checkoutId,
      paymentMethod: row.payment_method || null,
      amountCents: row.amount_cents || plan.amountCents,
      currency: row.currency || 'BRL',
      providerSubscriptionId: row.provider_subscription_id || null,
      currentPeriodStart: row.current_period_start || null,
      currentPeriodEnd: row.current_period_end || null,
      nextBillingAt: null,
      cancelAtPeriodEnd: true,
      canceledAt: nowIso,
      lastEventAt: nowIso,
      billingMetadata: { canceled_by_user_at: nowIso },
    });

    return {
      success: true,
      canceledAt: nowIso,
      message: 'Assinatura FatosBR PRO cancelada. Seu acesso permanece válido até o término do período já pago.',
    };
  }

  async getUserBillingHistory(userId: string): Promise<BillingHistoryEntry[]> {
    const store = this.storeProvider();
    return store.listUserBillingHistory(userId);
  }
}

export const subscriptionService = new SubscriptionService();
