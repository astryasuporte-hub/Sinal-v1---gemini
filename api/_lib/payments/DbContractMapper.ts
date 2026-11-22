/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DbContractMapper — Contrato Canônico de Persistência PostgreSQL (Payments V1.1)
 *
 * Garante compatibilidade estrita com as CHECK constraints reais do Supabase:
 * - public.subscriptions.plan IN ('TRIAL', 'PRO')
 * - public.subscriptions.status IN (
 *     'TRIAL_ACTIVE', 'TRIAL_EXPIRED', 'ACTIVE', 'RENEWAL_PENDING',
 *     'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'SUSPENDED'
 *   )
 * - internal.billing_payments.provider IN ('sharpify', 'cakto')
 * - internal.billing_payments.status IN ('PENDING', 'APPROVED', 'CANCELLED', 'REFUNDED', 'REFUND_FAILED')
 * - internal.billing_payments.type IN ('INITIAL', 'RENEWAL')
 * - internal.billing_payments.request_state IN ('CREATING', 'READY', 'UNKNOWN', 'FAILED')
 */

export const DB_SUBSCRIPTION_PLANS = ['TRIAL', 'PRO'] as const;
export type DbSubscriptionPlan = (typeof DB_SUBSCRIPTION_PLANS)[number];

export const DB_SUBSCRIPTION_STATUSES = [
  'TRIAL_ACTIVE',
  'TRIAL_EXPIRED',
  'ACTIVE',
  'RENEWAL_PENDING',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
  'SUSPENDED',
] as const;
export type DbSubscriptionStatus = (typeof DB_SUBSCRIPTION_STATUSES)[number];

export const DB_PAYMENT_PROVIDERS = ['sharpify', 'cakto'] as const;
export type DbPaymentProvider = (typeof DB_PAYMENT_PROVIDERS)[number];

export const DB_PAYMENT_STATUSES = [
  'PENDING',
  'APPROVED',
  'CANCELLED',
  'REFUNDED',
  'REFUND_FAILED',
] as const;
export type DbPaymentStatus = (typeof DB_PAYMENT_STATUSES)[number];

export const DB_PAYMENT_TYPES = ['INITIAL', 'RENEWAL'] as const;
export type DbPaymentType = (typeof DB_PAYMENT_TYPES)[number];

export const DB_PAYMENT_REQUEST_STATES = ['CREATING', 'READY', 'UNKNOWN', 'FAILED'] as const;
export type DbPaymentRequestState = (typeof DB_PAYMENT_REQUEST_STATES)[number];

export function toDbSubscriptionPlan(rawPlan?: string | null): DbSubscriptionPlan {
  const s = String(rawPlan || '').trim().toUpperCase();
  if (s === 'TRIAL') return 'TRIAL';
  if (s === 'PRO' || s === 'FATOSBR_PRO' || s === 'FATOSBR PRO') return 'PRO';
  throw new Error(`DB_CONTRACT_VIOLATION: Plano inválido para public.subscriptions.plan: '${rawPlan}'`);
}

export function toDbSubscriptionStatus(rawStatus: string): DbSubscriptionStatus {
  const s = String(rawStatus || '').trim().toUpperCase();
  switch (s) {
    case 'TRIAL_ACTIVE':
    case 'TRIALING':
      return 'TRIAL_ACTIVE';
    case 'TRIAL_EXPIRED':
      return 'TRIAL_EXPIRED';
    case 'ACTIVE':
      return 'ACTIVE';
    case 'RENEWAL_PENDING':
    case 'PENDING':
      return 'RENEWAL_PENDING';
    case 'PAST_DUE':
      return 'PAST_DUE';
    case 'CANCELED':
    case 'CANCELLED':
    case 'PAUSED':
      return 'CANCELED';
    case 'INCOMPLETE':
    case 'PAYMENT_REFUSED':
    case 'REFUSED':
      return 'INCOMPLETE';
    case 'SUSPENDED':
    case 'EXPIRED':
    case 'CHARGEBACK':
      return 'SUSPENDED';
    default:
      throw new Error(`DB_CONTRACT_VIOLATION: Status inválido para public.subscriptions.status: '${rawStatus}'`);
  }
}

export function toDbPaymentProvider(rawProvider?: string | null): DbPaymentProvider {
  const p = String(rawProvider || '').trim().toLowerCase();
  if (p === 'cakto' || p === 'sharpify') return p;
  throw new Error(`DB_CONTRACT_VIOLATION: Provedor inválido para internal.billing_payments.provider: '${rawProvider}'`);
}

export function toDbPaymentStatus(rawStatus: string): DbPaymentStatus {
  const s = String(rawStatus || '').trim().toUpperCase();
  switch (s) {
    case 'PENDING':
    case 'PROCESSING':
      return 'PENDING';
    case 'APPROVED':
    case 'PAID':
    case 'COMPLETED':
      return 'APPROVED';
    case 'CANCELLED':
    case 'CANCELED':
    case 'FAILED':
    case 'REFUSED':
    case 'EXPIRED':
    case 'BLOCKED':
      return 'CANCELLED';
    case 'REFUNDED':
    case 'CHARGEBACK':
      return 'REFUNDED';
    case 'REFUND_FAILED':
      return 'REFUND_FAILED';
    default:
      throw new Error(`DB_CONTRACT_VIOLATION: Status inválido para internal.billing_payments.status: '${rawStatus}'`);
  }
}

export function toDbPaymentType(rawType?: string | null): DbPaymentType {
  const t = String(rawType || '').trim().toUpperCase();
  if (t === 'RENEWAL') return 'RENEWAL';
  if (!t || t === 'INITIAL' || t === 'SUBSCRIPTION' || t === 'PAYMENT') return 'INITIAL';
  throw new Error(`DB_CONTRACT_VIOLATION: Tipo inválido para internal.billing_payments.type: '${rawType}'`);
}

export function toDbPaymentRequestState(rawState?: string | null): DbPaymentRequestState {
  const st = String(rawState || '').trim().toUpperCase();
  switch (st) {
    case 'CREATING':
      return 'CREATING';
    case 'READY':
    case 'COMPLETED':
    case '':
      return 'READY';
    case 'UNKNOWN':
    case 'PENDING':
      return 'UNKNOWN';
    case 'FAILED':
      return 'FAILED';
    default:
      throw new Error(`DB_CONTRACT_VIOLATION: request_state inválido para internal.billing_payments: '${rawState}'`);
  }
}

export function toBillingHistoryStatus(
  dbStatus: string,
  checkoutData?: Record<string, any> | null
): 'PAID' | 'PENDING' | 'REFUSED' | 'CANCELED' | 'EXPIRED' | 'BLOCKED' | 'REFUNDED' {
  const s = String(dbStatus || '').trim().toUpperCase();
  if (s === 'APPROVED' || s === 'PAID' || s === 'COMPLETED') return 'PAID';
  if (s === 'REFUNDED' || s === 'REFUND_FAILED' || s === 'CHARGEBACK') return 'REFUNDED';
  if (s === 'PENDING' || s === 'PROCESSING') return 'PENDING';

  const action = String(checkoutData?.canonical_action || checkoutData?.raw_status || '')
    .trim()
    .toUpperCase();
  if (action === 'REFUSED' || action === 'FAILED' || action === 'PAYMENT_REFUSED') return 'REFUSED';
  if (action === 'EXPIRE' || action === 'EXPIRED') return 'EXPIRED';
  if (action === 'BLOCKED') return 'BLOCKED';
  if (s === 'REFUSED' || s === 'FAILED') return 'REFUSED';
  if (s === 'EXPIRED') return 'EXPIRED';
  if (s === 'BLOCKED') return 'BLOCKED';
  return 'CANCELED';
}
