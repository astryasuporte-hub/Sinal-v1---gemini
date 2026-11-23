/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type EntityType = 'company' | 'person' | 'organization';

export interface Entity {
  id: string;
  name: string;
  slug?: string;
  type: EntityType;
  description: string;
  sector?: string;
  role?: string;
  organization?: string;
  website?: string;
  avatarUrl?: string;
  logoUrl?: string;
  imageUrl?: string;
  isFollowed: boolean;
  interestCount?: string;
  brandColor?: string;
  recentEventsCount?: number;
}

export interface Topic {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  isFollowed: boolean;
  interestCount?: string;
  brandColor?: string;
  recentEventsCount?: number;
}

export interface Source {
  id: string;
  name: string;
  slug?: string;
  domain: string;
  category: string;
  logoUrl?: string;
  isFollowed: boolean;
  interestCount?: string;
  brandColor?: string;
  recentEventsCount?: number;
}

export interface SourceReference {
  id: string;
  sourceName: string;
  domain: string;
  logoUrl?: string;
  headline: string;
  url: string;
  publishedAt: string;
}

export interface TimelineItem {
  id: string;
  date: string;
  time: string;
  title: string;
  description: string;
}

export interface Event {
  id: string;
  title: string;
  summary: string;
  whatHappened: string;
  whyItMatters: string;
  marketImpact?: string;
  nextSteps?: string;
  category: string;
  publishedAt: string;
  updatedAt?: string;
  imageUrl?: string;
  entities: Entity[];
  topics: Topic[];
  sources: SourceReference[];
  timeline: TimelineItem[];
  relevanceScore: number;
  relativeTime?: string;
  sourceCountText?: string;
  isSaved?: boolean;
  savedAt?: string;
  isViewed?: boolean;
  viewedAt?: string;
  isHidden?: boolean;
  featuredSourceLogos?: { name: string; color: string; label: string }[];
}

export type SubscriptionStatus =
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

export type RecurrenceMode = 'CARD_RECURRING' | 'PIX_AUTOMATIC' | 'PIX_MANUAL_CYCLE' | 'TRIAL' | 'EXEMPT' | 'NONE';

export interface PendingPixCharge {
  chargeId?: string;
  orderId?: string;
  providerOrderId?: string;
  pixType?: 'PIX_TRADITIONAL' | 'PIX_AUTOMATIC';
  qrCode?: string | null;
  qrCodeImageUrl?: string | null;
  copiaECola?: string | null;
  amountCents?: number;
  expiresAt?: string | null;
  status?: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'REFUSED';
}

export interface UserSubscription {
  status: SubscriptionStatus;
  planId?: 'pro' | 'trial';
  planName: string;
  amount: number;
  amountCents?: number;
  currency?: 'BRL';
  trialDaysLeft: number;
  trialTotalDays?: number;
  trialStartsAt?: string;
  trialEndsAt: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd: string;
  nextBillingAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: string | null;
  graceUntil?: string | null;
  gateway: string;
  provider?: 'cakto' | 'sharpify';
  paymentMethod: string;
  allowedMethods?: ('credit_card' | 'pix_auto' | 'pix')[];
  recurrenceMode?: RecurrenceMode;
  autoRenew?: boolean;
  isPaused?: boolean;
  pendingPixCharge?: PendingPixCharge | null;
  isAdminExempt?: boolean;
  hasProAccess?: boolean;
  reconciliationRequired?: boolean;
  reconciliationReason?: string | null;
  providerSubscriptionId?: string | null;
  commercialReadiness?: {
    ready: boolean;
    blockedReasonCode?: string;
    blockedMessage?: string;
    commercialEnabled: boolean;
    methodsVerified: boolean;
    allowedMethods: string[];
  };
}

export interface Briefing {
  id: string;
  type: 'morning' | 'evening';
  date: string;
  title: string;
  estimatedReadTime: string; // Ex: "4 min"
  summary: string;
  events: Event[];
  status: 'ready' | 'generating' | 'sent';
}

export interface FatosBrNotification {
  id: string;
  type:
    | 'NEW_RELEVANT_EVENT'
    | 'ENTITY_UPDATE'
    | 'BRIEFING_READY'
    | 'TRIAL_ENDING'
    | 'PAYMENT_PENDING';
  title: string;
  description: string;
  createdAt: string;
  read: boolean;
  eventId?: string;
}

export type SinalNotification = FatosBrNotification;
