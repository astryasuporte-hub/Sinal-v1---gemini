/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR Payments V1.1 — Contratos e Tipos Canônicos de Pagamento e Assinatura
 */

import type { AllowedCaktoPaymentMethod, CanonicalRecurrenceMode } from '../plans.js';

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
  verifiedReadiness?: CheckoutCommercialReadiness;
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
  productMethods?: string[];
  offerMethods?: string[];
  checkoutMethods?: string[];
  missingEvidence?: string[];
  providerPriceCents?: number | null;
  offerStatus?: string;
  productStatus?: string;
  checkoutStatus?: string;
  trialDays?: number;
}

export interface PixChargePayload {
  providerOrderId?: string;
  pixType: 'PIX_TRADITIONAL' | 'PIX_AUTOMATIC';
  qrCode?: string;
  qrCodeImageUrl?: string;
  copiaECola?: string;
  expiresAt?: string;
  status?: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'REFUSED';
}

export interface PendingPixChargeView {
  chargeId: string;
  providerOrderId: string;
  pixType: 'PIX_TRADITIONAL' | 'PIX_AUTOMATIC';
  amountCents: number;
  currency: 'BRL';
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'REFUSED';
  qrCode?: string | null;
  qrCodeImageUrl?: string | null;
  copiaECola?: string | null;
  expiresAt?: string | null;
  createdAt?: string | null;
}

export interface CheckoutSessionResult {
  success: boolean;
  blocked?: boolean;
  errorCode?: string;
  error?: string;
  missingEvidence?: string[];
  attemptId?: string;
  provider: PaymentProviderId;
  checkoutUrl?: string;
  pixCharge?: PixChargePayload;
  recurrenceMode?: CanonicalRecurrenceMode;
  productId: string;
  offerId: string;
  checkoutId: string;
  amountCents: number;
  currency: 'BRL';
  allowedMethods: readonly string[];
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
  | 'PIX_EXPIRED'
  | 'REFUND_REQUESTED'
  | 'REFUND_PROCESSING'
  | 'REFUND_FAILED'
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
  customerName?: string;
  customerDocument?: string;
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
  subscriptionPaused?: boolean;
  refundReason?: string;
  pixData?: PixChargePayload;
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
  pixData?: PixChargePayload;
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
  recurrenceMode?: 'CARD_RECURRING' | 'PIX_AUTOMATIC' | 'PIX_MANUAL_CYCLE' | 'TRIAL' | 'EXEMPT' | 'NONE';
  autoRenew?: boolean;
  isPaused?: boolean;
  pendingPixCharge?: PendingPixChargeView | null;
  allowedMethods: readonly string[];
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
  status: 'PAID' | 'PENDING' | 'REFUSED' | 'CANCELED' | 'EXPIRED' | 'BLOCKED' | 'REFUNDED' | 'REFUND_FAILED';
  paymentMethod: string;
  provider: string;
  referenceId: string;
  description: string;
}

