/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InstagramAccount,
  ScheduledPost,
  CommentAutomationRule,
  CommentExecutionLog,
  InstagramAuditLog,
  InstagramInsightsData,
  ChatCommandMessage
} from '../types/instagram';

export const instagramService = {
  async getStatus(): Promise<InstagramAccount> {
    const res = await fetch('/api/instagram/status');
    if (!res.ok) throw new Error('Falha ao obter status do Instagram');
    return res.json();
  },

  async getConfig(): Promise<any> {
    const res = await fetch('/api/instagram/config');
    if (!res.ok) throw new Error('Falha ao obter configuração');
    return res.json();
  },

  async updateConfig(updates: any): Promise<any> {
    const res = await fetch('/api/instagram/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error('Falha ao atualizar configuração');
    return res.json();
  },

  async publishPost(postData: {
    caption: string;
    slides: { imageUrl: string; aspectRatio?: string }[];
    hashtags?: string[];
    callToAction?: string;
  }): Promise<{ success: boolean; id?: string; error?: string; mode: string }> {
    const res = await fetch('/api/instagram/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postData)
    });
    return res.json();
  },

  async schedulePost(postData: any): Promise<ScheduledPost> {
    const res = await fetch('/api/instagram/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postData)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Falha ao agendar post');
    return data.post;
  },

  async listScheduled(): Promise<ScheduledPost[]> {
    const res = await fetch('/api/instagram/schedule');
    if (!res.ok) return [];
    return res.json();
  },

  async cancelScheduled(id: string): Promise<boolean> {
    const res = await fetch(`/api/instagram/schedule?id=${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    return data.success;
  },

  async listRules(): Promise<CommentAutomationRule[]> {
    const res = await fetch('/api/instagram/rules');
    if (!res.ok) return [];
    return res.json();
  },

  async toggleRule(id: string, isActive: boolean): Promise<CommentAutomationRule> {
    const res = await fetch('/api/instagram/rules/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive })
    });
    const data = await res.json();
    return data.rule;
  },

  async createOrUpdateRule(ruleData: any): Promise<CommentAutomationRule> {
    const res = await fetch('/api/instagram/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ruleData)
    });
    const data = await res.json();
    return data.rule;
  },

  async simulateCommentTrigger(commentText: string, username?: string): Promise<any> {
    const res = await fetch('/api/instagram/comments/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentText, username })
    });
    return res.json();
  },

  async getInsights(): Promise<InstagramInsightsData> {
    const res = await fetch('/api/instagram/insights');
    if (!res.ok) throw new Error('Falha ao obter métricas');
    return res.json();
  },

  async generateCaption(params: any): Promise<{ caption: string; hashtags: string[]; callToAction: string }> {
    const res = await fetch('/api/instagram/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return res.json();
  },

  async sendChatMessage(message: string): Promise<ChatCommandMessage> {
    const res = await fetch('/api/instagram/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    return res.json();
  },

  async getAuditLogs(): Promise<{ audits: InstagramAuditLog[]; commentLogs: CommentExecutionLog[] }> {
    const res = await fetch('/api/instagram/audit');
    if (!res.ok) return { audits: [], commentLogs: [] };
    return res.json();
  }
};
