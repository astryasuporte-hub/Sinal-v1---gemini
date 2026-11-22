/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SubscriptionEligibility — Fonte Canônica e Compartilhada de Elegibilidade PRO (Payments V1.2)
 *
 * Utilizada tanto por SubscriptionService quanto por CheckoutService para garantir:
 * 1. Assinatura ACTIVE sem current_period_end válido NUNCA concede acesso indefinido nem é tratada como ativa.
 * 2. Cortesias administrativas expressamente autorizadas e vigentes são preservadas.
 * 3. Assinaturas em reconciliação (INCOMPLETE / RENEWAL_PENDING / PAST_DUE / sem período comprovado)
 *    bloqueiam novo checkout para impedir cobranças duplicadas.
 * 4. Trial de 7 dias deriva exclusivamente de trial_starts_at/trial_ends_at ou auth.users.created_at.
 */

import { SAAS_TRIAL_DAYS } from '../plans.js';
import type { DbSubscriptionRow } from './PaymentsStore.js';
import type { CanonicalSubscriptionStatus } from './types.js';

export interface SubscriptionEligibilityEvaluation {
  canonicalStatus: CanonicalSubscriptionStatus;
  isPaidTier: boolean;
  hasProAccess: boolean;
  isAuthorizedCourtesy: boolean;
  hasValidProvenPeriod: boolean;
  reconciliationRequired: boolean;
  reconciliationReason: string | null;
  blocksNewCheckout: boolean;
  checkoutBlockCode?: 'SUBSCRIPTION_ALREADY_ACTIVE' | 'RECONCILIATION_REQUIRED';
  checkoutBlockMessage?: string;
  trialStartsIso: string | null;
  trialEndsIso: string | null;
  remainingTrialDays: number;
  periodEndIso: string | null;
  hadPaidHistory: boolean;
}

export function evaluateSubscriptionEligibility(params: {
  row: DbSubscriptionRow | null;
  userCreatedAt?: string | null;
  nowMs?: number;
}): SubscriptionEligibilityEvaluation {
  const { row } = params;
  const nowMs = params.nowMs ?? Date.now();

  const resolvedCreatedAt: string | null = row?.trial_starts_at || params.userCreatedAt || null;
  const trialStartMs = resolvedCreatedAt ? Date.parse(resolvedCreatedAt) : NaN;
  const explicitTrialEndMs = row?.trial_ends_at ? Date.parse(row.trial_ends_at) : NaN;

  const hasValidTrialOrigin = Number.isFinite(explicitTrialEndMs) || Number.isFinite(trialStartMs);
  const trialEndsMs = Number.isFinite(explicitTrialEndMs)
    ? explicitTrialEndMs
    : Number.isFinite(trialStartMs)
    ? trialStartMs + SAAS_TRIAL_DAYS * 24 * 60 * 60 * 1000
    : 0;

  const trialStartsIso = Number.isFinite(trialStartMs) ? new Date(trialStartMs).toISOString() : null;
  const trialEndsIso = hasValidTrialOrigin ? new Date(trialEndsMs).toISOString() : null;
  const remainingTrialDays = hasValidTrialOrigin
    ? Math.max(0, Math.ceil((trialEndsMs - nowMs) / (24 * 60 * 60 * 1000)))
    : 0;

  if (!row) {
    const trialStatus: CanonicalSubscriptionStatus = remainingTrialDays > 0 ? 'TRIAL_ACTIVE' : 'TRIAL_EXPIRED';
    return {
      canonicalStatus: trialStatus,
      isPaidTier: false,
      hasProAccess: remainingTrialDays > 0,
      isAuthorizedCourtesy: false,
      hasValidProvenPeriod: false,
      reconciliationRequired: false,
      reconciliationReason: null,
      blocksNewCheckout: false,
      trialStartsIso,
      trialEndsIso,
      remainingTrialDays,
      periodEndIso: trialEndsIso,
      hadPaidHistory: false,
    };
  }

  const dbStatus = String(row.status || '').toUpperCase().trim();
  const dbPlan = String(row.plan || '').toUpperCase().trim();
  const meta = row.billing_metadata && typeof row.billing_metadata === 'object' ? row.billing_metadata : {};
  const periodEndIso = row.current_period_end || trialEndsIso || null;
  const periodEndMs = row.current_period_end ? Date.parse(row.current_period_end) : NaN;
  const hasFuturePeriodEnd = Boolean(row.current_period_end && Number.isFinite(periodEndMs) && periodEndMs > nowMs);
  const graceEndMs = row.grace_until ? Date.parse(row.grace_until) : NaN;

  const hadPaidHistory = Boolean(
    meta.had_paid_cycle === true ||
      meta.refunded === true ||
      meta.chargeback === true ||
      meta.expired === true ||
      dbPlan === 'PRO'
  );

  const isAuthorizedCourtesy = Boolean(
    meta.admin_courtesy === true &&
      (!meta.courtesy_expires_at ||
        (Number.isFinite(Date.parse(String(meta.courtesy_expires_at))) &&
          Date.parse(String(meta.courtesy_expires_at)) > nowMs))
  );

  let canonicalStatus: CanonicalSubscriptionStatus = 'TRIAL_EXPIRED';
  let hasProAccess = false;
  let hasValidProvenPeriod = false;
  let reconciliationRequired = false;
  let reconciliationReason: string | null = null;
  let blocksNewCheckout = false;
  let checkoutBlockCode: SubscriptionEligibilityEvaluation['checkoutBlockCode'];
  let checkoutBlockMessage: string | undefined;

  if (dbStatus === 'ACTIVE') {
    if (isAuthorizedCourtesy) {
      canonicalStatus = 'ACTIVE';
      hasProAccess = true;
      hasValidProvenPeriod = true;
      blocksNewCheckout = true;
      checkoutBlockCode = 'SUBSCRIPTION_ALREADY_ACTIVE';
      checkoutBlockMessage = 'Sua assinatura FatosBR PRO (cortesia autorizada) já está ativa.';
    } else if (row.current_period_end && Number.isFinite(periodEndMs)) {
      if (periodEndMs > nowMs) {
        canonicalStatus = 'ACTIVE';
        hasProAccess = true;
        hasValidProvenPeriod = true;
        blocksNewCheckout = true;
        checkoutBlockCode = 'SUBSCRIPTION_ALREADY_ACTIVE';
        checkoutBlockMessage = 'Sua assinatura FatosBR PRO já está ativa.';
      } else {
        canonicalStatus = 'EXPIRED';
        hasProAccess = false;
        hasValidProvenPeriod = false;
      }
    } else {
      // PRO sem current_period_end válido NUNCA concede acesso indefinido e bloqueia cobrança duplicada
      canonicalStatus = 'INCOMPLETE';
      hasProAccess = false;
      hasValidProvenPeriod = false;
      reconciliationRequired = true;
      reconciliationReason = 'MISSING_CURRENT_PERIOD_END';
      blocksNewCheckout = true;
      checkoutBlockCode = 'RECONCILIATION_REQUIRED';
      checkoutBlockMessage =
        'Sua assinatura possui período de vigência pendente de comprovação. Sincronize o pagamento antes de iniciar uma nova cobrança.';
    }
  } else if (dbStatus === 'PAST_DUE') {
    canonicalStatus = 'PAST_DUE';
    hasProAccess = Boolean(Number.isFinite(graceEndMs) && graceEndMs > nowMs && !meta.refunded && !meta.chargeback);
    hasValidProvenPeriod = hasFuturePeriodEnd;
    blocksNewCheckout = true;
    checkoutBlockCode = 'RECONCILIATION_REQUIRED';
    checkoutBlockMessage =
      'Sua assinatura possui cobrança em análise/tentativa de renovação. Sincronize o status antes de abrir novo checkout.';
  } else if (dbStatus === 'CANCELED' || dbStatus === 'CANCELLED') {
    canonicalStatus = 'CANCELED';
    hasProAccess = Boolean(!meta.refunded && !meta.chargeback && hasFuturePeriodEnd);
    hasValidProvenPeriod = hasProAccess;
    if (hasProAccess) {
      blocksNewCheckout = true;
      checkoutBlockCode = 'SUBSCRIPTION_ALREADY_ACTIVE';
      checkoutBlockMessage = 'Sua assinatura FatosBR PRO ainda está ativa até o término do período já pago.';
    }
  } else if (dbStatus === 'SUSPENDED') {
    canonicalStatus = meta.expired ? 'EXPIRED' : 'SUSPENDED';
    hasProAccess = false;
  } else if (dbStatus === 'INCOMPLETE') {
    canonicalStatus = meta.refused ? 'PAYMENT_REFUSED' : 'INCOMPLETE';
    hasProAccess = false;
    if (!meta.refused) {
      reconciliationRequired = true;
      reconciliationReason = 'INCOMPLETE_SUBSCRIPTION';
      blocksNewCheckout = true;
      checkoutBlockCode = 'RECONCILIATION_REQUIRED';
      checkoutBlockMessage =
        'Há uma reconciliação financeira pendente na sua assinatura. Clique em Sincronizar status para evitar cobrança duplicada.';
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
      (hasFuturePeriodEnd && meta.pro_paid !== false) || (!hadPaidHistory && remainingTrialDays > 0)
    );
    hasValidProvenPeriod = hasFuturePeriodEnd && meta.pro_paid !== false;
    if (hadPaidHistory || row.provider_subscription_id) {
      reconciliationRequired = true;
      reconciliationReason = 'RENEWAL_OR_ACTIVATION_PENDING';
      blocksNewCheckout = true;
      checkoutBlockCode = 'RECONCILIATION_REQUIRED';
      checkoutBlockMessage =
        'Existe uma ativação ou renovação financeira em processamento para sua conta. Sincronize o status antes de abrir novo checkout.';
    }
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
    canonicalStatus,
    isPaidTier,
    hasProAccess,
    isAuthorizedCourtesy,
    hasValidProvenPeriod,
    reconciliationRequired,
    reconciliationReason,
    blocksNewCheckout,
    checkoutBlockCode,
    checkoutBlockMessage,
    trialStartsIso,
    trialEndsIso,
    remainingTrialDays,
    periodEndIso,
    hadPaidHistory,
  };
}
