/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR Payments V2 — Cliente Frontend para /api/payments/* e /api/admin/financial-ops
 *
 * Princípios:
 * - Nunca define preço no cliente; toda lógica financeira é resolvida no servidor.
 * - Utiliza sessão Supabase válida no cabeçalho Authorization: Bearer <token>.
 * - Zero endpoints de simulação ou bypass de pagamento.
 */

import { supabase } from '../lib/supabase';
import type { PendingPixCharge, RecurrenceMode, UserSubscription } from '../types/sinal';

export type AllowedPaymentMethod = 'credit_card' | 'pix_auto' | 'pix';

export interface BillingHistoryItem {
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
  errorCode?: string;
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
  recurrenceMode?: RecurrenceMode;
  pixCharge?: PendingPixCharge | null;
}

export interface ReconcileResponse {
  success: boolean;
  reconciledCount?: number;
  rejectedProhibitedCount?: number;
  checkedAttempts?: number;
  subscription?: UserSubscription;
  error?: string;
}

export interface AdminFinancialSnapshot {
  success: boolean;
  generatedAt?: string;
  provider?: string;
  allowedMethods?: string[];
  traditionalPixEnabled?: boolean;
  readiness?: {
    commercial: any;
    dunning: {
      emailSendingEnabled: boolean;
      homologationLockActive: boolean;
      resendApiKeyConfigured: boolean;
      fromEmail: string;
    };
    fiscal: {
      autoEmitEnabled: boolean;
      provider: string;
      ready: boolean;
      missingConfig: string[];
      summary: string;
    };
  };
  metrics?: {
    receivedAmountCents: number;
    approvedCount: number;
    pendingAmountCents: number;
    pendingCount: number;
    refundedAmountCents: number;
    refundedCount: number;
    activeProCount: number;
    activeTrialCount: number;
    pastDueCount: number;
    canceledCount: number;
    expiredOrSuspendedCount: number;
    courtesyCount: number;
    adminExemptCount: number;
    webhookErrorsCount: number;
    pendingPixCount: number;
  };
  subscriptions?: any[];
  payments?: any[];
  attempts?: any[];
  webhookEvents?: any[];
  processingErrors?: any[];
  pixCharges?: any[];
  refunds?: any[];
  dunningLogs?: any[];
  fiscalDocuments?: any[];
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
        return {
          success: false,
          errorCode: data?.errorCode || `HTTP_${res.status}`,
          error: data?.error || `HTTP ${res.status}`,
        };
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

  async getUserFiscalDocuments(): Promise<{ success: boolean; documents: any[]; readiness?: any; error?: string }> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        return { success: false, documents: [], error: 'Sessão não autenticada.' };
      }
      const res = await fetch('/api/payments/nfse', { method: 'GET', headers });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, documents: [], error: data?.error || `HTTP ${res.status}` };
      }
      return {
        success: true,
        documents: Array.isArray(data?.documents) ? data.documents : [],
        readiness: data?.readiness,
      };
    } catch (err: any) {
      return { success: false, documents: [], error: err?.message || 'Erro ao consultar documentos fiscais.' };
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

  async getAdminFinancialOps(): Promise<AdminFinancialSnapshot> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        return { success: false, error: 'Sessão não autenticada.' };
      }
      const res = await fetch('/api/admin/financial-ops', { method: 'GET', headers });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data?.error || `HTTP ${res.status}` };
      }
      return data;
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro ao carregar centro financeiro.' };
    }
  },

  async triggerAdminFinancialAction(payload: {
    action: 'reconcile_user' | 'run_dunning_cycle' | 'prepare_nfse';
    userId?: string;
    userEmail?: string;
    providerPaymentId?: string;
    amountCents?: number;
  }): Promise<any> {
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) {
        return { success: false, error: 'Sessão não autenticada.' };
      }
      const res = await fetch('/api/admin/financial-ops', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro ao executar ação financeira.' };
    }
  },
};
