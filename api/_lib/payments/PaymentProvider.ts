/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interface agnóstica de provedor de pagamentos do FatosBR (Payments V1.1).
 */

import type {
  CheckoutCommercialReadiness,
  CheckoutSessionInput,
  CheckoutSessionResult,
  NormalizedPaymentWebhookEvent,
  PaymentProviderId,
  ProviderCancelResult,
  ProviderReconcileOrder,
} from './types.js';

export interface WebhookVerificationOutcome {
  valid: boolean;
  reason?: string;
  errorCode?: string;
  timestampIso?: string;
  eventHash?: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly displayName: string;

  /**
   * Valida se o provedor está comercialmente liberado e com métodos verificados
   * (Cartão de Crédito + Pix Automático exclusivamente, nunca Pix avulso).
   */
  getCommercialReadiness(): Promise<CheckoutCommercialReadiness>;

  /**
   * Cria sessão/intenção de checkout ou retorna bloqueio comercial explícito.
   */
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;

  /**
   * Verifica assinatura criptográfica e proteção contra replay do webhook recebido.
   */
  verifyWebhookSignature(params: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
  }): WebhookVerificationOutcome;

  /**
   * Normaliza o payload específico do provedor para o contrato canônico do FatosBR.
   */
  parseWebhookEvent(rawPayload: Record<string, any>): NormalizedPaymentWebhookEvent;

  /**
   * Cancela assinatura recorrente no provedor externo.
   */
  cancelSubscription(providerSubscriptionId: string): Promise<ProviderCancelResult>;

  /**
   * Consulta pedidos/ciclos recentes para reconciliação financeira.
   */
  fetchReconcilableOrders(params: {
    attemptId?: string;
    providerOrderId?: string;
    providerSubscriptionId?: string;
    customerEmail?: string;
  }): Promise<ProviderReconcileOrder[]>;
}
