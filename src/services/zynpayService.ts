/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
   * Cria uma nova cobrança Pix na ZynPay via proxy backend
   */
  public async createPixCharge(params: {
    amountCents: number;
    description: string;
    customer?: ZynPayCustomer;
  }): Promise<{ success: boolean; charge?: ZynPayCharge; error?: string; isSandbox?: boolean }> {
    try {
      const response = await fetch('/api/zynpay/charges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: params.amountCents,
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
            paidAt: new Date().toISOString()
          }
        })
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const zynpayService = new ZynPayService();
