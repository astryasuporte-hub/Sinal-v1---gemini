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
import { evaluateSubscriptionEligibility } from './SubscriptionEligibility.js';
import type {
  BillingHistoryEntry,
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

    const evaluation = evaluateSubscriptionEligibility({
      row,
      userCreatedAt: resolvedCreatedAt,
      nowMs: Date.now(),
    });

    if (row) {
      return {
        status: evaluation.canonicalStatus,
        planId: evaluation.isPaidTier ? 'pro' : 'trial',
        planName: evaluation.isPaidTier ? plan.name : `Trial Gratuito (${SAAS_TRIAL_DAYS} dias)`,
        amount: plan.amountCents / 100,
        amountCents: plan.amountCents,
        currency: 'BRL',
        trialDaysLeft: evaluation.canonicalStatus === 'TRIAL_ACTIVE' ? evaluation.remainingTrialDays : 0,
        trialTotalDays: SAAS_TRIAL_DAYS,
        trialStartsAt: formatPtBrDate(evaluation.trialStartsIso),
        trialEndsAt: formatPtBrDate(evaluation.trialEndsIso),
        currentPeriodStart: row.current_period_start ? formatPtBrDate(row.current_period_start) : null,
        currentPeriodEnd: evaluation.isAuthorizedCourtesy
          ? row.current_period_end
            ? formatPtBrDate(row.current_period_end)
            : 'Cortesia Autorizada'
          : formatPtBrDate(evaluation.periodEndIso),
        nextBillingAt: row.next_billing_at ? formatPtBrDate(row.next_billing_at) : null,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        canceledAt: row.canceled_at || null,
        graceUntil: row.grace_until || null,
        gateway: 'Cakto Assinaturas',
        provider: activeProviderId,
        paymentMethod: evaluation.isAuthorizedCourtesy
          ? 'Cortesia Administrativa'
          : formatMethodLabel(row.payment_method),
        allowedMethods: plan.allowedMethods,
        isAdminExempt: false,
        hasProAccess: evaluation.hasProAccess,
        reconciliationRequired: evaluation.reconciliationRequired,
        reconciliationReason: evaluation.reconciliationReason,
        providerSubscriptionId: row.provider_subscription_id || null,
        commercialReadiness,
      };
    }

    // Sem linha em public.subscriptions: usa apenas origem confiável de trial (nunca reinventa 7 dias sem created_at)
    return {
      status: evaluation.canonicalStatus,
      planId: 'trial',
      planName: `Trial Gratuito (${SAAS_TRIAL_DAYS} dias)`,
      amount: plan.amountCents / 100,
      amountCents: plan.amountCents,
      currency: 'BRL',
      trialDaysLeft: evaluation.remainingTrialDays,
      trialTotalDays: SAAS_TRIAL_DAYS,
      trialStartsAt: formatPtBrDate(evaluation.trialStartsIso),
      trialEndsAt: formatPtBrDate(evaluation.trialEndsIso),
      currentPeriodEnd: formatPtBrDate(evaluation.trialEndsIso),
      cancelAtPeriodEnd: false,
      gateway: 'Cakto Assinaturas',
      provider: activeProviderId,
      paymentMethod: formatMethodLabel(null),
      allowedMethods: plan.allowedMethods,
      isAdminExempt: false,
      hasProAccess: evaluation.hasProAccess,
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
