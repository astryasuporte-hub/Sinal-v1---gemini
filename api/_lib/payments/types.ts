/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR Payments V1.1 — Contratos e Tipos Canônicos de Pagamento e Assinatura
 */

import type { AllowedCaktoPaymentMethod } from '../plans.js';

export type CanonicalSubscriptionStatus =
  | 'TRIAL_ACTIVE'
  | 'TRIAL_EXPIRED'
  | 'ACTIVE'
  | 'RENEWAL_PENDING'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'PAYMENT_REFUSED';

export type PaymentProviderId = 'cakto' | 'sharpify';

export interface CheckoutSessionInput {
  attemptId: string;
  userId: string;
  userEmail: string;
  userName?: string;
  planId: 'pro';
  requestedMethod?: string;
  idempotencyKey?: string;
}

export interface CheckoutCommercialReadiness {
  ready: boolean;
  blockedReasonCode?:
    | 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED'
    | 'CAKTO_PAYMENT_METHODS_NOT_VERIFIED'
    | 'CAKTO_DISALLOWED_PAYMENT_METHOD_ENABLED'
    | 'CAKTO_CREDENTIALS_MISSING'
    | 'PROVIDER_NOT_IMPLEMENTED';
  blockedMessage?: string;
  commercialEnabled: boolean;
  methodsVerified: boolean;
  allowedMethods: readonly AllowedCaktoPaymentMethod[];
  prohibitedMethods: readonly string[];
  detectedProviderMethods?: string[];
  offerStatus?: string;
  productStatus?: string;
  checkoutStatus?: string;
  trialDays?: number;
}

export interface CheckoutSessionResult {
  success: boolean;
  blocked?: boolean;
  errorCode?: string;
  error?: string;
  attemptId?: string;
  provider: PaymentProviderId;
  checkoutUrl?: string;
  productId: string;
  offerId: string;
  checkoutId: string;
  amountCents: number;
  currency: 'BRL';
  allowedMethods: readonly AllowedCaktoPaymentMethod[];
  expiresAt?: string;
}

export type CanonicalWebhookAction =
  | 'ACTIVATE'
  | 'RENEW'
  | 'RECOVER'
  | 'SUBSCRIPTION_CREATED'
  | 'PAST_DUE'
  | 'REFUSED'
  | 'CANCEL'
  | 'EXPIRE'
  | 'REFUND_REQUESTED'
  | 'REFUND'
  | 'CHARGEBACK'
  | 'PENDING_PAYMENT'
  | 'IGNORE';

export interface NormalizedPaymentWebhookEvent {
  provider: PaymentProviderId;
  providerEventId: string;
  eventType: string;
  canonicalAction: CanonicalWebhookAction;
  providerOrderId?: string;
  providerSubscriptionId?: string;
  attemptId?: string;
  userId?: string;
  customerEmail?: string;
  productId?: string;
  offerId?: string;
  checkoutId?: string;
  paymentMethod: string;
  amountCents?: number;
  currency: string;
  occurredAt: string;
  paidAt?: string;
  periodStart?: string;
  periodEnd?: string;
  nextBillingAt?: string;
  eventHash?: string;
  rawPayload: Record<string, any>;
}

export interface ProviderCancelResult {
  success: boolean;
  canceledAt: string;
  providerStatus?: string;
  error?: string;
}

export interface ProviderReconcileOrder {
  providerOrderId: string;
  providerSubscriptionId?: string;
  attemptId?: string;
  customerEmail?: string;
  productId?: string;
  offerId?: string;
  paymentMethod: string;
  amountCents: number;
  currency: string;
  status: 'paid' | 'pending' | 'refused' | 'refunded' | 'chargeback' | 'canceled' | 'expired' | 'past_due' | 'unknown';
  paidAt?: string;
  periodStart?: string;
  periodEnd?: string;
  nextBillingAt?: string;
}

export interface UserSubscriptionView {
  status: CanonicalSubscriptionStatus;
  planId: 'pro' | 'trial';
  planName: string;
  amount: number;
  amountCents: number;
  currency: 'BRL';
  trialDaysLeft: number;
  trialTotalDays: number;
  trialStartsAt: string;
  trialEndsAt: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd: string;
  nextBillingAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: string | null;
  graceUntil?: string | null;
  gateway: string;
  provider: PaymentProviderId;
  paymentMethod: string;
  allowedMethods: readonly AllowedCaktoPaymentMethod[];
  isAdminExempt?: boolean;
  hasProAccess: boolean;
  reconciliationRequired?: boolean;
  reconciliationReason?: string | null;
  providerSubscriptionId?: string | null;
  commercialReadiness: CheckoutCommercialReadiness;
}

export interface BillingHistoryEntry {
  id: string;
  date: string;
  amountCents: number;
  amount: number;
  currency: 'BRL';
  status: 'PAID' | 'PENDING' | 'REFUSED' | 'CANCELED' | 'EXPIRED' | 'BLOCKED' | 'REFUNDED';
  paymentMethod: string;
  provider: string;
  referenceId: string;
  description: string;
}
