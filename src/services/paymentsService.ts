/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR Payments V1 — Cliente Frontend para /api/payments/*
 *
 * Princípios:
 * - Nunca define preço no cliente; toda lógica financeira é resolvida no servidor.
 * - Utiliza sessão Supabase válida no cabeçalho Authorization: Bearer <token>.
 * - Zero endpoints de simulação ou bypass de pagamento.
 */

import { supabase } from '../lib/supabase';
import type { UserSubscription } from '../types/sinal';

export type AllowedPaymentMethod = 'credit_card' | 'pix_auto';

export interface BillingHistoryItem {
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

export interface PaymentsStatusResponse {
  success: boolean;
  subscription?: UserSubscription;
  plan?: {
    id: string;
    name: string;
    amountCents: number;
    amountFormatted: string;
    currency: 'BRL';
    periodDays: number;
    saasTrialDays: number;
    providerTrialDays: 0;
    provider: 'cakto';
    productId: string;
    offerId: string;
    checkoutId: string;
    allowedMethods: AllowedPaymentMethod[];
  };
  error?: string;
}

export interface CheckoutResponse {
  success: boolean;
  blocked?: boolean;
  errorCode?: string;
  error?: string;
  attemptId?: string;
  provider?: string;
  checkoutUrl?: string;
  amountCents?: number;
  currency?: string;
  allowedMethods?: AllowedPaymentMethod[];
}

export interface ReconcileResponse {
  success: boolean;
  reconciledCount?: number;
  rejectedProhibitedCount?: number;
  checkedAttempts?: number;
  subscription?: UserSubscription;
  error?: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {}
  }
  return headers;
}

export const paymentsService = {
  formatBrl(amountReais: number): string {
    return (Number(amountReais) || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  },

  formatCents(cents: number): string {
    return ((Number(cents) || 0) / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  },

  async getStatus(): Promise<PaymentsStatusResponse> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        return { success: false, error: 'Sessão não autenticada.' };
      }
      const res = await fetch('/api/payments/status', { method: 'GET', headers });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data?.error || `HTTP ${res.status}` };
      }
      return data;
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao consultar assinatura.' };
    }
  },

  async startCheckout(params: { paymentMethod?: AllowedPaymentMethod; idempotencyKey?: string } = {}): Promise<CheckoutResponse> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        return { success: false, blocked: true, errorCode: 'UNAUTHORIZED', error: 'Faça login para assinar o FatosBR PRO.' };
      }
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          planId: 'pro',
          paymentMethod: params.paymentMethod,
          idempotencyKey: params.idempotencyKey,
        }),
      });
      const data = await res.json();
      return data;
    } catch (err: any) {
      return {
        success: false,
        blocked: true,
        errorCode: 'NETWORK_ERROR',
        error: err?.message || 'Erro ao iniciar checkout.',
      };
    }
  },

  async cancelSubscription(): Promise<{ success: boolean; message?: string; error?: string; subscription?: UserSubscription }> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        return { success: false, error: 'Sessão não autenticada.' };
      }
      const res = await fetch('/api/payments/cancel', { method: 'POST', headers });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro ao cancelar assinatura.' };
    }
  },

  async reconcile(): Promise<ReconcileResponse> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        return { success: false, error: 'Sessão não autenticada.' };
      }
      const res = await fetch('/api/payments/reconcile', {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro ao reconciliar pagamento.' };
    }
  },

  async getHistory(): Promise<{ success: boolean; history: BillingHistoryItem[]; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        return { success: false, history: [], error: 'Sessão não autenticada.' };
      }
      const res = await fetch('/api/payments/history', { method: 'GET', headers });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, history: [], error: data?.error || `HTTP ${res.status}` };
      }
      return { success: true, history: Array.isArray(data?.history) ? data.history : [] };
    } catch (err: any) {
      return { success: false, history: [], error: err?.message || 'Erro ao carregar histórico.' };
    }
  },

  async getAdminWebhookEvents(): Promise<{ success: boolean; events: any[]; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        return { success: false, events: [], error: 'Sessão não autenticada.' };
      }
      const res = await fetch('/api/payments/webhook', { method: 'GET', headers });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, events: [], error: data?.error || `HTTP ${res.status}` };
      }
      return { success: true, events: Array.isArray(data?.events) ? data.events : [] };
    } catch (err: any) {
      return { success: false, events: [], error: err?.message || 'Erro ao consultar webhooks.' };
    }
  },
};
