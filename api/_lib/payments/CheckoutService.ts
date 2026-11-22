/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CheckoutService — Orquestração Segura de Intenção de Checkout (Payments V1)
 *
 * Princípios:
 * 1. Plano pago único FatosBR PRO (R$ 34,90 / 3490 centavos BRL) resolvido apenas no servidor.
 * 2. Bloqueia qualquer pedido para métodos proibidos (pix avulso, boleto, picpay).
 * 3. Respeita rigorosamente a trava comercial da Cakto (CAKTO_COMMERCIAL_ENABLED / CAKTO_METHODS_VERIFIED).
 * 4. Gera attemptId UUID opaco em internal.billing_attempts para correlação segura no webhook.
 */

import crypto from 'crypto';
import { isProhibitedPaymentMethod, resolvePlanPrice } from '../plans.js';
import { getActivePaymentProviderId, getPaymentProvider } from './PaymentProviderRegistry.js';
import { getPaymentsPersistence, PaymentsPersistenceAdapter } from './PaymentsStore.js';
import type { CheckoutSessionResult } from './types.js';

export class CheckoutService {
  constructor(private readonly storeProvider: () => PaymentsPersistenceAdapter = getPaymentsPersistence) {}

  async initiateCheckout(params: {
    userId: string;
    userEmail: string;
    userName?: string;
    planId?: string;
    requestedMethod?: string;
    idempotencyKey?: string;
  }): Promise<{ httpStatus: number; result: CheckoutSessionResult }> {
    const plan = resolvePlanPrice(params.planId || 'pro');
    const activeProviderId = getActivePaymentProviderId();
    const provider = getPaymentProvider(activeProviderId);
    const store = this.storeProvider();

    // 1. Rejeita imediatamente se o cliente solicitar método proibido
    if (params.requestedMethod && isProhibitedPaymentMethod(params.requestedMethod)) {
      return {
        httpStatus: 400,
        result: {
          success: false,
          blocked: true,
          errorCode: 'PAYMENT_METHOD_NOT_ALLOWED',
          error: `O método '${params.requestedMethod}' não é suportado. Utilize Cartão de Crédito ou Pix Automático.`,
          provider: activeProviderId,
          productId: plan.productId,
          offerId: plan.offerId,
          checkoutId: plan.checkoutId,
          amountCents: plan.amountCents,
          currency: 'BRL',
          allowedMethods: plan.allowedMethods,
        },
      };
    }

    // 2. Evita nova assinatura se o usuário já estiver com FatosBR PRO ativo e válido
    const currentSub = await store.findSubscriptionByUserId(params.userId).catch(() => null);
    if (
      currentSub &&
      String(currentSub.status || '').toUpperCase() === 'ACTIVE' &&
      (!currentSub.current_period_end || Date.parse(currentSub.current_period_end) > Date.now())
    ) {
      return {
        httpStatus: 409,
        result: {
          success: false,
          blocked: true,
          errorCode: 'SUBSCRIPTION_ALREADY_ACTIVE',
          error: 'Sua assinatura FatosBR PRO já está ativa.',
          provider: activeProviderId,
          productId: plan.productId,
          offerId: plan.offerId,
          checkoutId: plan.checkoutId,
          amountCents: plan.amountCents,
          currency: 'BRL',
          allowedMethods: plan.allowedMethods,
        },
      };
    }

    // 3. Reuso por idempotência caso uma tentativa aberta válida exista
    if (params.idempotencyKey) {
      const existingAttempt = await store
        .findBillingAttemptByIdempotencyKey(params.userId, params.idempotencyKey)
        .catch(() => null);
      if (
        existingAttempt &&
        existingAttempt.status === 'REDIRECTED' &&
        existingAttempt.checkout_url &&
        Date.parse(existingAttempt.expires_at) > Date.now()
      ) {
        return {
          httpStatus: 200,
          result: {
            success: true,
            blocked: false,
            attemptId: existingAttempt.id,
            provider: activeProviderId,
            checkoutUrl: existingAttempt.checkout_url,
            productId: plan.productId,
            offerId: plan.offerId,
            checkoutId: plan.checkoutId,
            amountCents: plan.amountCents,
            currency: 'BRL',
            allowedMethods: plan.allowedMethods,
            expiresAt: existingAttempt.expires_at,
          },
        };
      }
    }

    const attemptId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    await store.createBillingAttempt({
      id: attemptId,
      userId: params.userId,
      provider: activeProviderId,
      planId: plan.id,
      productId: plan.productId,
      offerId: plan.offerId,
      checkoutId: plan.checkoutId,
      amountCents: plan.amountCents,
      currency: plan.currency,
      status: 'CREATED',
      idempotencyKey: params.idempotencyKey || null,
      metadata: {
        requested_method: params.requestedMethod || null,
      },
      expiresAt,
    });

    const session = await provider.createCheckoutSession({
      attemptId,
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName,
      planId: 'pro',
      requestedMethod: params.requestedMethod,
      idempotencyKey: params.idempotencyKey,
    });

    if (!session.success || session.blocked || !session.checkoutUrl) {
      await store.updateBillingAttempt(attemptId, {
        status: 'BLOCKED',
        metadata: {
          blocked_reason: session.errorCode || 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
          blocked_message: session.error,
        },
      });

      return {
        httpStatus: 423,
        result: session,
      };
    }

    await store.updateBillingAttempt(attemptId, {
      status: 'REDIRECTED',
      checkoutUrl: session.checkoutUrl,
    });

    return {
      httpStatus: 200,
      result: session,
    };
  }
}

export const checkoutService = new CheckoutService();
