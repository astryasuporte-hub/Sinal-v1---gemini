/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type InstagramConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'expired' | 'error';

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface InstagramAccount {
  id: string;
  username: string;
  name: string;
  profilePictureUrl?: string;
  accountType: 'BUSINESS' | 'CREATOR';
  followersCount: number;
  mediaCount: number;
  tokenExpiresAt: string;
  daysUntilExpiry: number;
  grantedPermissions: string[];
  missingPermissions: string[];
  isSimulationMode: boolean;
  connectedAt: string;
}

export interface CarouselSlideItem {
  id: string;
  order: number;
  imageUrl: string;
  title?: string;
  subtitle?: string;
  aspectRatio: '1:1' | '4:5';
}

export interface ScheduledPost {
  id: string;
  caption: string;
  hashtags: string[];
  callToAction: string;
  slides: CarouselSlideItem[];
  scheduledTime: string; // ISO 8601
  timezone: string;
  status: PostStatus;
  createdAt: string;
  updatedAt: string;
  instagramMediaId?: string;
  errorMessage?: string;
  autoDirectMessageText?: string;
  associatedRuleId?: string;
}

export interface CommentAutomationRule {
  id: string;
  triggerKeyword: string; // e.g. "QUERO"
  scope: 'all_posts' | 'specific_post';
  specificPostId?: string;
  publicReplyText: string;
  sendDirectMessage: boolean;
  directMessageText?: string;
  directMessageLink?: string;
  isActive: boolean;
  totalExecutions: number;
  lastExecutionAt?: string;
  createdAt: string;
}

export interface CommentExecutionLog {
  id: string;
  ruleId: string;
  commentId: string;
  commenterUsername: string;
  commentText: string;
  publicReplySent: boolean;
  dmSent: boolean;
  dmError?: string;
  status: 'success' | 'partial' | 'failed' | 'skipped_duplicate';
  timestamp: string;
  mode: 'live' | 'simulation';
}

export interface InstagramAuditLog {
  id: string;
  action: string;
  details: string;
  timestamp: string;
  status: 'success' | 'warning' | 'error' | 'pending';
  metaApiRequestId?: string;
  metaError?: string;
  mode: 'live' | 'simulation';
}

export interface InstagramInsightsData {
  impressions: number;
  reach: number;
  profileViews: number;
  totalFollowers: number;
  followerGrowthWeek: number;
  commentsReceivedWeek: number;
  dmsSentWeek: number;
  topPosts: {
    id: string;
    caption: string;
    likes: number;
    comments: number;
    shares: number;
    reach: number;
    publishedAt: string;
  }[];
  period: string;
  source: 'Meta Graph API v19.0' | 'Simulation Sandbox';
}

export interface ChatCommandMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  actionRequired?: 'confirm_publish' | 'confirm_schedule' | 'confirm_rule_pause' | 'confirm_delete';
  actionPayload?: any;
  actionStatus?: 'pending' | 'confirmed' | 'cancelled';
  interactiveCard?: {
    type: 'carousel_preview' | 'schedule_summary' | 'caption_review' | 'rule_summary' | 'metrics_card';
    data: any;
  };
}
