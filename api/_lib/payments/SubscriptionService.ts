/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SubscriptionService — Fonte Autoritativa de Assinaturas e Trial de 7 Dias (Payments V1)
 *
 * Regras:
 * 1. Plano pago único: FatosBR PRO (R$ 34,90/mês).
 * 2. Administradores (app_metadata ou internal.user_roles) são isentos com acesso pleno.
 * 3. Usuários não pagantes recebem 7 dias de trial gratuito sem cartão a partir de created_at.
 * 4. NUNCA ativa PRO no frontend; o status sempre deriva do servidor e webhooks validados.
 */

import { SAAS_TRIAL_DAYS, resolvePlanPrice } from '../plans.js';
import { getActivePaymentProviderId, getPaymentProvider } from './PaymentProviderRegistry.js';
import { getPaymentsPersistence, PaymentsPersistenceAdapter } from './PaymentsStore.js';
import type {
  BillingHistoryEntry,
  CanonicalSubscriptionStatus,
  UserSubscriptionView,
} from './types.js';

function formatPtBrDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function mapMethodDisplay(method?: string | null): string {
  const m = String(method || '').toLowerCase().trim();
  if (m === 'credit_card') return 'Cartão de Crédito';
  if (m === 'pix_auto') return 'Pix Automático';
  return 'Cartão de Crédito / Pix Automático';
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

    const createdAtIso = params.userCreatedAt || new Date().toISOString();
    const createdAtMs = Date.parse(createdAtIso) || Date.now();
    const trialEndsMs = createdAtMs + SAAS_TRIAL_DAYS * 24 * 60 * 60 * 1000;
    const trialEndsIso = new Date(trialEndsMs).toISOString();
    const nowMs = Date.now();
    const remainingTrialDays = Math.max(0, Math.ceil((trialEndsMs - nowMs) / (24 * 60 * 60 * 1000)));

    if (params.isAdmin) {
      return {
        status: 'ACTIVE',
        planId: 'pro',
        planName: 'FatosBR PRO (Admin Cortesia)',
        amount: 0,
        amountCents: 0,
        currency: 'BRL',
        trialDaysLeft: 0,
        trialTotalDays: SAAS_TRIAL_DAYS,
        trialStartsAt: formatPtBrDate(createdAtIso),
        trialEndsAt: formatPtBrDate(trialEndsIso),
        currentPeriodEnd: 'Acesso Administrativo Permanente',
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
    let row = null;
    try {
      row = await store.findSubscriptionByUserId(params.userId);
    } catch {
      row = null;
    }

    if (row) {
      const dbStatus = String(row.status || '').toLowerCase();
      const periodEndIso = row.current_period_end || trialEndsIso;
      const periodEndMs = Date.parse(periodEndIso) || 0;
      const graceEndMs = row.grace_until ? Date.parse(row.grace_until) : 0;

      let canonicalStatus: CanonicalSubscriptionStatus = remainingTrialDays > 0 ? 'TRIAL_ACTIVE' : 'TRIAL_EXPIRED';
      let hasProAccess = remainingTrialDays > 0;

      if (dbStatus === 'active') {
        if (!row.current_period_end || periodEndMs > nowMs) {
          canonicalStatus = 'ACTIVE';
          hasProAccess = true;
        } else {
          canonicalStatus = 'EXPIRED';
          hasProAccess = false;
        }
      } else if (dbStatus === 'past_due') {
        canonicalStatus = 'PAST_DUE';
        hasProAccess = graceEndMs > nowMs;
      } else if (dbStatus === 'canceled' || dbStatus === 'cancelled') {
        canonicalStatus = 'CANCELED';
        hasProAccess = Boolean(row.current_period_end && periodEndMs > nowMs);
      } else if (dbStatus === 'expired') {
        canonicalStatus = 'EXPIRED';
        hasProAccess = false;
      } else if (dbStatus === 'payment_refused') {
        canonicalStatus = 'PAYMENT_REFUSED';
        hasProAccess = false;
      } else if (dbStatus === 'pending' || dbStatus === 'renewal_pending') {
        canonicalStatus = 'RENEWAL_PENDING';
        hasProAccess = remainingTrialDays > 0;
      } else if (dbStatus === 'trialing' || dbStatus === 'trial_active') {
        canonicalStatus = remainingTrialDays > 0 ? 'TRIAL_ACTIVE' : 'TRIAL_EXPIRED';
        hasProAccess = remainingTrialDays > 0;
      } else if (dbStatus === 'trial_expired') {
        canonicalStatus = 'TRIAL_EXPIRED';
        hasProAccess = false;
      }

      const isPaidTier = canonicalStatus === 'ACTIVE' || canonicalStatus === 'PAST_DUE' || canonicalStatus === 'CANCELED';

      return {
        status: canonicalStatus,
        planId: isPaidTier ? 'pro' : 'trial',
        planName: isPaidTier ? plan.name : `Trial Gratuito (${SAAS_TRIAL_DAYS} dias)`,
        amount: plan.amountCents / 100,
        amountCents: plan.amountCents,
        currency: 'BRL',
        trialDaysLeft: canonicalStatus === 'TRIAL_ACTIVE' ? remainingTrialDays : 0,
        trialTotalDays: SAAS_TRIAL_DAYS,
        trialStartsAt: formatPtBrDate(row.trial_starts_at || createdAtIso),
        trialEndsAt: formatPtBrDate(row.trial_ends_at || trialEndsIso),
        currentPeriodEnd: formatPtBrDate(periodEndIso),
        canceledAt: row.canceled_at || null,
        graceUntil: row.grace_until || null,
        gateway: 'Cakto Assinaturas',
        provider: activeProviderId,
        paymentMethod: mapMethodDisplay(row.payment_method),
        allowedMethods: plan.allowedMethods,
        isAdminExempt: false,
        hasProAccess,
        providerSubscriptionId: row.provider_subscription_id || null,
        commercialReadiness,
      };
    }

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
      trialStartsAt: formatPtBrDate(createdAtIso),
      trialEndsAt: formatPtBrDate(trialEndsIso),
      currentPeriodEnd: formatPtBrDate(trialEndsIso),
      gateway: 'Cakto Assinaturas',
      provider: activeProviderId,
      paymentMethod: mapMethodDisplay(null),
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
    const row = await store.findSubscriptionByUserId(userId);
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
      plan: row.plan || 'pro',
      planId: row.plan_id || 'pro',
      status: 'canceled',
      provider: row.provider || 'cakto',
      amountCents: row.amount_cents || plan.amountCents,
      currency: row.currency || 'BRL',
      canceledAt: nowIso,
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
