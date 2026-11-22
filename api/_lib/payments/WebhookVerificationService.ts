/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebhookVerificationService — Validação Criptográfica e Integridade Financeira (Payments V1.1)
 *
 * Valida:
 * 1. Assinatura HMAC-SHA256 e janela anti-replay obrigatória (<= 300s) via PaymentProvider.
 * 2. Bloqueio explícito de métodos proibidos e exigência estrita de credit_card/pix_auto em liquidações.
 * 3. Produto e Oferta oficiais da Cakto.
 * 4. Moeda estrita BRL e valor canônico (3490 centavos) contra adulteração.
 */

import { isAllowedPaymentMethod, isProhibitedPaymentMethod, resolvePlanPrice } from '../plans.js';
import type { PaymentProvider, WebhookVerificationOutcome } from './PaymentProvider.js';
import type { NormalizedPaymentWebhookEvent } from './types.js';

export interface FullWebhookValidationResult {
  accepted: boolean;
  httpStatus: number;
  errorCode?: string;
  reason?: string;
  signatureOutcome: WebhookVerificationOutcome;
  normalizedEvent?: NormalizedPaymentWebhookEvent;
}

const FINANCIAL_SETTLE_ACTIONS = new Set(['ACTIVATE', 'RENEW', 'RECOVER']);

export class WebhookVerificationService {
  validateAndNormalize(params: {
    provider: PaymentProvider;
    rawBody: string;
    body: Record<string, any>;
    headers: Record<string, string | string[] | undefined>;
  }): FullWebhookValidationResult {
    const signatureOutcome = params.provider.verifyWebhookSignature({
      rawBody: params.rawBody,
      headers: params.headers,
    });

    if (!signatureOutcome.valid) {
      const status = signatureOutcome.errorCode === 'WEBHOOK_SECRET_NOT_CONFIGURED' ? 503 : 401;
      return {
        accepted: false,
        httpStatus: status,
        errorCode: signatureOutcome.errorCode || 'INVALID_SIGNATURE',
        reason: signatureOutcome.reason || 'Assinatura do webhook rejeitada.',
        signatureOutcome,
      };
    }

    const event = params.provider.parseWebhookEvent(params.body);
    if (signatureOutcome.eventHash) {
      event.eventHash = signatureOutcome.eventHash;
    }
    const plan = resolvePlanPrice('pro');

    // 1. Bloquear métodos proibidos sempre
    if (isProhibitedPaymentMethod(event.paymentMethod)) {
      return {
        accepted: false,
        httpStatus: 422,
        errorCode: 'PROHIBITED_PAYMENT_METHOD',
        reason: `Método '${event.paymentMethod}' proibido no Payments V1. Apenas credit_card e pix_auto são aceitos.`,
        signatureOutcome,
        normalizedEvent: event,
      };
    }

    // 2. Em liquidações financeiras (ACTIVATE/RENEW/RECOVER), exigir método explicitamente permitido
    if (FINANCIAL_SETTLE_ACTIONS.has(event.canonicalAction) && !isAllowedPaymentMethod(event.paymentMethod)) {
      return {
        accepted: false,
        httpStatus: 422,
        errorCode: 'PAYMENT_METHOD_NOT_ALLOWED',
        reason: `Método '${event.paymentMethod}' não é um método autorizado para ativação PRO (exigido credit_card ou pix_auto).`,
        signatureOutcome,
        normalizedEvent: event,
      };
    }

    // 3. Validar moeda BRL
    if (event.currency && event.currency !== plan.currency) {
      return {
        accepted: false,
        httpStatus: 422,
        errorCode: 'CURRENCY_MISMATCH',
        reason: `Moeda '${event.currency}' divergente de '${plan.currency}'.`,
        signatureOutcome,
        normalizedEvent: event,
      };
    }

    // 4. Validar product_id e offer_id oficiais
    if (event.productId && event.productId !== plan.productId) {
      return {
        accepted: false,
        httpStatus: 422,
        errorCode: 'PRODUCT_MISMATCH',
        reason: `Produto '${event.productId}' não corresponde ao produto oficial '${plan.productId}'.`,
        signatureOutcome,
        normalizedEvent: event,
      };
    }

    if (event.offerId && event.offerId !== plan.offerId) {
      return {
        accepted: false,
        httpStatus: 422,
        errorCode: 'OFFER_MISMATCH',
        reason: `Oferta '${event.offerId}' não corresponde à oferta oficial '${plan.offerId}'.`,
        signatureOutcome,
        normalizedEvent: event,
      };
    }

    // 5. Anti-tampering de preço para liquidações/ativações/renovações financeiras
    if (FINANCIAL_SETTLE_ACTIONS.has(event.canonicalAction)) {
      if (event.amountCents === undefined || event.amountCents !== plan.amountCents) {
        return {
          accepted: false,
          httpStatus: 422,
          errorCode: 'AMOUNT_MISMATCH',
          reason: `Valor '${event.amountCents}' diverge do valor oficial do FatosBR PRO (${plan.amountCents} centavos).`,
          signatureOutcome,
          normalizedEvent: event,
        };
      }
    }

    return {
      accepted: true,
      httpStatus: 200,
      signatureOutcome,
      normalizedEvent: event,
    };
  }
}

export const webhookVerificationService = new WebhookVerificationService();
