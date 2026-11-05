/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from '../lib/supabase';

export interface ZynPayCustomer {
  name?: string;
  email?: string;
  taxId?: string; // CPF ou CNPJ
}

export interface ZynPayCharge {
  id: string;
  amount: number; // Inteiro em centavos (ex: 2990 = R$ 29,90)
  amountFormatted: string; // Ex: "R$ 29,90"
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  description: string;
  qrCode?: string; // Data URL ou imagem
  qrCodeText: string; // Pix Copia e Cola (BR Code)
  customer?: ZynPayCustomer;
  createdAt: string;
  expiresAt: string;
  paidAt?: string;
  isSandbox?: boolean;
}

export interface ZynPayBalance {
  available: number; // em centavos
  pending: number; // em centavos
  currency: string;
  accountStatus: 'VERIFIED' | 'PENDING_VERIFICATION' | 'BLOCKED';
  updatedAt: string;
}

export interface ZynPayWebhookItem {
  id: string;
  type: string;
  chargeId: string;
  amountCents: number;
  status: string;
  timestamp: string;
  customerEmail?: string;
}

class ZynPayService {
  private eventSource: EventSource | null = null;
  private paymentListeners: Set<(payload: any) => void> = new Set();

  constructor() {
    this.initRealtimeEventListener();
  }

  /**
   * Conecta ao canal SSE /api/zynpay/events para receber confirmações instantâneas de webhooks
   * e atualiza o localStorage do front-end automaticamente.
   */
  private initRealtimeEventListener() {
    if (typeof window === 'undefined' || !('EventSource' in window)) return;

    try {
      this.eventSource = new EventSource('/api/zynpay/events');

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'PAYMENT_CONFIRMED') {
            // Atualiza automaticamente o status da assinatura do usuário no localStorage do front-end
            this.handlePaymentConfirmedLocalStorageUpdate(data);

            // Notifica listeners registrados na aplicação
            this.paymentListeners.forEach((listener) => {
              try { listener(data); } catch {}
            });
          }
        } catch (e) {
          console.error('[ZynPayService] Erro ao processar mensagem SSE:', e);
        }
      };

      this.eventSource.onerror = () => {
        // EventSource reconecta automaticamente
      };
    } catch (err) {
      console.warn('[ZynPayService] EventSource não pôde ser iniciado:', err);
    }
  }

  /**
   * Grava no localStorage e emite eventos de atualização para todos os componentes
   */
  public handlePaymentConfirmedLocalStorageUpdate(data: any) {
    try {
      localStorage.setItem('fatosbr_pro_active', 'true');
      localStorage.setItem('fatosbr_session_active', 'true');

      const currentSub = localStorage.getItem('sinal_subscription');
      let updatedSub = {
        status: 'ACTIVE',
        planName: 'FatosBR Pro (Ativo)',
        amount: (data.amountCents || 2990) / 100,
        billingCycle: 'MONTHLY',
        nextBillingAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR')
      };

      if (currentSub) {
        try {
          const parsed = JSON.parse(currentSub);
          updatedSub = { ...parsed, ...updatedSub };
        } catch {}
      }

      localStorage.setItem('sinal_subscription', JSON.stringify(updatedSub));

      // Dispara eventos locais e globais
      window.dispatchEvent(new CustomEvent('fatosbr_subscription_updated', {
        detail: { ...data, subscription: updatedSub }
      }));
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'fatosbr_pro_active',
        newValue: 'true'
      }));
    } catch (err) {
      console.error('[ZynPayService] Erro ao sincronizar localStorage:', err);
    }
  }

  /**
   * Permite que componentes escutem confirmações de pagamento em tempo real
   */
  public onPaymentConfirmed(callback: (payload: any) => void): () => void {
    this.paymentListeners.add(callback);
    return () => {
      this.paymentListeners.delete(callback);
    };
  }

  /**
   * Converte valor monetário em reais para centavos inteiros da ZynPay
   */
  public toCents(reais: number): number {
    return Math.round(reais * 100);
  }

  /**
   * Formata centavos em string monetária brasileira R$
   */
  public formatCurrency(cents: number): string {
    const reais = (cents || 0) / 100;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(reais);
  }

  /**
   * Cria uma nova cobrança Pix oficial na ZynPay via proxy backend autenticado
   */
  public async createPixCharge(params: {
    amountCents?: number;
    planId?: string;
    description: string;
    customer?: ZynPayCustomer;
  }): Promise<{ success: boolean; charge?: ZynPayCharge; error?: string; isSandbox?: boolean; reused?: boolean }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch('/api/zynpay/charges', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          planId: params.planId || 'pro',
          description: params.description,
          customer: params.customer
        })
      });

      const data = await response.json();
      if (!response.ok && !data.charge) {
        return {
          success: false,
          error: data.error || `Erro ao gerar cobrança Pix (${response.status})`
        };
      }

      return {
        success: true,
        charge: data.charge,
        isSandbox: data.isSandbox
      };
    } catch (err: any) {
      console.error('[ZynPayService] Erro ao criar cobrança:', err);
      return {
        success: false,
        error: err.message || 'Falha de comunicação com o servidor ZynPay.'
      };
    }
  }

  /**
   * Consulta o status em tempo real de uma cobrança específica
   */
  public async getChargeStatus(chargeId: string): Promise<{ success: boolean; charge?: ZynPayCharge; error?: string }> {
    try {
      const response = await fetch(`/api/zynpay/charges/${encodeURIComponent(chargeId)}`);
      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || 'Cobrança não encontrada.' };
      }

      return { success: true, charge: data.charge };
    } catch (err: any) {
      return { success: false, error: err.message || 'Falha ao consultar cobrança.' };
    }
  }

  /**
   * Consulta saldo da conta ZynPay
   */
  public async getBalance(): Promise<{ success: boolean; balance?: ZynPayBalance; error?: string }> {
    try {
      const response = await fetch('/api/zynpay/balance');
      const data = await response.json();

      if (!response.ok && !data.balance) {
        return { success: false, error: data.error || 'Falha ao obter saldo.' };
      }

      return {
        success: true,
        balance: data.balance || {
          available: 0,
          pending: 0,
          currency: 'BRL',
          accountStatus: data.accountStatus || 'PENDING_VERIFICATION',
          updatedAt: new Date().toISOString()
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro de conexão com saldo ZynPay.' };
    }
  }

  /**
   * Lista histórico de cobranças Pix geradas
   */
  public async listCharges(): Promise<{ success: boolean; charges: ZynPayCharge[]; error?: string }> {
    try {
      const response = await fetch('/api/zynpay/charges');
      const data = await response.json();
      return {
        success: true,
        charges: Array.isArray(data.charges) ? data.charges : []
      };
    } catch (err: any) {
      return { success: false, charges: [], error: err.message };
    }
  }

  /**
   * Lista eventos de webhooks recebidos
   */
  public async getWebhookLogs(): Promise<{ success: boolean; events: ZynPayWebhookItem[]; counts: any }> {
    try {
      const response = await fetch('/api/zynpay/webhook');
      const data = await response.json();
      return {
        success: true,
        events: Array.isArray(data.events) ? data.events : [],
        counts: data.counts || {}
      };
    } catch (err: any) {
      return { success: false, events: [], counts: {} };
    }
  }

  /**
   * Notifica a aplicação e dispara webhook de teste para homologação
   */
  public async simulateWebhookPayment(chargeId: string): Promise<boolean> {
    try {
      const response = await fetch('/api/zynpay/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'charge.paid',
          type: 'pix.payment.confirmed',
          data: {
            id: chargeId,
            status: 'PAID',
            amount: 2990,
            paidAt: new Date().toISOString()
          }
        })
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Obtém as configurações atuais de callback webhook da ZynPay
   */
  public async getWebhookConfig(): Promise<{ success: boolean; config?: ZynPayWebhookConfig; error?: string }> {
    try {
      const response = await fetch('/api/zynpay/config');
      const data = await response.json();
      return { success: response.ok, config: data.config, error: data.error };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Salva as configurações de endpoint de callback webhook da ZynPay no servidor
   */
  public async saveWebhookConfig(config: Partial<ZynPayWebhookConfig>): Promise<{ success: boolean; config?: ZynPayWebhookConfig; error?: string }> {
    try {
      const response = await fetch('/api/zynpay/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await response.json();
      return { success: response.ok, config: data.config, error: data.error };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

export interface ZynPayWebhookConfig {
  webhookUrl: string;
  secret: string;
  autoSyncEnabled: boolean;
  updatedAt: string;
}

export const zynpayService = new ZynPayService();

