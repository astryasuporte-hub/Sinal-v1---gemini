/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type EntityType = 'company' | 'person' | 'organization';

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  description: string;
  sector?: string;
  role?: string;
  organization?: string;
  website?: string;
  avatarUrl?: string;
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
  domain: string;
  category: string;
  isFollowed: boolean;
  interestCount?: string;
  brandColor?: string;
  recentEventsCount?: number;
}

export interface SourceReference {
  id: string;
  sourceName: string;
  domain: string;
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
  | 'CANCELED';

export interface UserSubscription {
  status: SubscriptionStatus;
  planName: string;
  amount: number;
  trialDaysLeft: number;
  trialEndsAt: string;
  currentPeriodEnd: string;
  gateway: 'FatosBR Gateway' | string;
  paymentMethod: 'PIX';
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
