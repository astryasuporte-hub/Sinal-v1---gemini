/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CheckoutService — Orquestração Segura de Intenção de Checkout (Payments V1.2)
 *
 * Sequência obrigatória:
 * 1. Validar autenticação e método solicitado.
 * 2. Verificar as flags comerciais (CAKTO_COMMERCIAL_ENABLED / CAKTO_METHODS_VERIFIED).
 * 3. Verificar a disponibilidade e configuração real do provedor (sem criar tentativa se bloqueado).
 * 4. Verificar o estado real da assinatura do usuário via regra canônica compartilhada (fail-closed em erro de banco).
 * 5. Somente depois criar a tentativa financeira em internal.billing_attempts.
 * 6. Preparar o redirecionamento no provedor.
 * 7. Persistir o resultado de forma idempotente.
 */

import crypto from 'crypto';
import { isAllowedPaymentMethod, isProhibitedPaymentMethod, resolvePlanPrice } from '../plans.js';
import { getActivePaymentProviderId, getPaymentProvider } from './PaymentProviderRegistry.js';
import { getPaymentsPersistence, PaymentsPersistenceAdapter } from './PaymentsStore.js';
import { evaluateSubscriptionEligibility } from './SubscriptionEligibility.js';
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

    const buildBlockedResult = (overrides: Partial<CheckoutSessionResult>): CheckoutSessionResult => ({
      success: false,
      blocked: true,
      provider: activeProviderId,
      productId: plan.productId,
      offerId: plan.offerId,
      checkoutId: plan.checkoutId,
      amountCents: plan.amountCents,
      currency: 'BRL',
      allowedMethods: plan.allowedMethods,
      ...overrides,
    });

    // 1. Validar autenticação e método solicitado
    if (!params.userId || !String(params.userId).trim()) {
      return {
        httpStatus: 401,
        result: buildBlockedResult({
          errorCode: 'UNAUTHORIZED_SESSION',
          error: 'Sessão autenticada obrigatória para iniciar checkout.',
        }),
      };
    }

    if (
      params.requestedMethod &&
      (isProhibitedPaymentMethod(params.requestedMethod) || !isAllowedPaymentMethod(params.requestedMethod))
    ) {
      return {
        httpStatus: 400,
        result: buildBlockedResult({
          errorCode: 'PAYMENT_METHOD_NOT_ALLOWED',
          error: `O método '${params.requestedMethod}' não é suportado. Utilize Cartão de Crédito ou Pix Automático.`,
        }),
      };
    }

    // 2. Verificar as flags comerciais antes de qualquer escrita no banco
    const commercialEnabled =
      String(process.env.CAKTO_COMMERCIAL_ENABLED || 'false').trim().toLowerCase() === 'true';
    if (!commercialEnabled) {
      return {
        httpStatus: 423,
        result: buildBlockedResult({
          errorCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
          error:
            'Checkout Cakto bloqueado comercialmente até regularização na Cakto e liberação explícita (CAKTO_COMMERCIAL_ENABLED=false).',
        }),
      };
    }

    const methodsVerified =
      String(process.env.CAKTO_METHODS_VERIFIED || 'false').trim().toLowerCase() === 'true';
    if (!methodsVerified) {
      return {
        httpStatus: 423,
        result: buildBlockedResult({
          errorCode: 'CAKTO_PAYMENT_METHODS_NOT_VERIFIED',
          error:
            'Métodos de pagamento da oferta Cakto ainda não verificados (exigido exclusivamente Cartão de Crédito + Pix Automático; Pix avulso proibido).',
        }),
      };
    }

    // 3. Verificar a disponibilidade e configuração real do provedor (sem gravar tentativa se bloqueado)
    const readiness = await provider.getCommercialReadiness();
    if (!readiness.ready) {
      return {
        httpStatus: 423,
        result: buildBlockedResult({
          errorCode: readiness.blockedReasonCode || 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
          error:
            readiness.blockedMessage ||
            'Checkout bloqueado comercialmente: provedor não comprovou configuração autorizada.',
          missingEvidence: readiness.missingEvidence,
        }),
      };
    }

    // 4. Verificar o estado real da assinatura do usuário (NUNCA converter erro de banco em ausência de assinatura)
    const store = this.storeProvider();
    let currentSub;
    let userAttempts;
    let existingAttempt = null;
    try {
      currentSub = await store.findSubscriptionByUserId(params.userId);
      userAttempts = store.listUserAttemptsForReconciliation
        ? await store.listUserAttemptsForReconciliation(params.userId)
        : await store.listOpenAttemptsForUser(params.userId);
      if (params.idempotencyKey) {
        existingAttempt = await store.findBillingAttemptByIdempotencyKey(params.userId, params.idempotencyKey);
      }
    } catch (err: any) {
      return {
        httpStatus: 503,
        result: buildBlockedResult({
          errorCode: 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE',
          error:
            err?.message ||
            'Falha ao consultar o banco de assinaturas/tentativas. Checkout bloqueado por segurança (fail-closed).',
        }),
      };
    }

    const eligibility = evaluateSubscriptionEligibility({
      row: currentSub,
      nowMs: Date.now(),
    });

    if (eligibility.blocksNewCheckout) {
      return {
        httpStatus: 409,
        result: buildBlockedResult({
          errorCode: eligibility.checkoutBlockCode || 'SUBSCRIPTION_ALREADY_ACTIVE',
          error:
            eligibility.checkoutBlockMessage ||
            'Não é possível iniciar novo checkout para o estado atual da assinatura.',
        }),
      };
    }

    // Impede cobranças duplicadas caso já exista tentativa paga aguardando liquidação/reconciliação
    const hasPaidAttemptPending = (userAttempts || []).some((a) => a.status === 'PAID');
    if (hasPaidAttemptPending) {
      return {
        httpStatus: 409,
        result: buildBlockedResult({
          errorCode: 'RECONCILIATION_REQUIRED',
          error:
            'Já existe um pagamento confirmado em reconciliação para sua conta. Clique em Sincronizar status antes de tentar novamente.',
        }),
      };
    }

    // Idempotência: reusa tentativa válida já redirecionada antes de criar nova linha
    if (existingAttempt) {
      if (existingAttempt.status === 'PAID') {
        return {
          httpStatus: 409,
          result: buildBlockedResult({
            errorCode: 'RECONCILIATION_REQUIRED',
            error: 'Esta tentativa de checkout já foi paga e aguarda conclusão da reconciliação.',
          }),
        };
      }
      if (
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

    // 5. Somente após todas as verificações, criar a tentativa financeira em internal.billing_attempts
    let attemptId: string = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    try {
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
    } catch (err: any) {
      if (params.idempotencyKey && String(err?.code || err?.message || '').includes('23505')) {
        const racedAttempt = await store
          .findBillingAttemptByIdempotencyKey(params.userId, params.idempotencyKey)
          .catch(() => null);
        if (
          racedAttempt &&
          racedAttempt.status === 'REDIRECTED' &&
          racedAttempt.checkout_url &&
          Date.parse(racedAttempt.expires_at) > Date.now()
        ) {
          return {
            httpStatus: 200,
            result: {
              success: true,
              blocked: false,
              attemptId: racedAttempt.id,
              provider: activeProviderId,
              checkoutUrl: racedAttempt.checkout_url,
              productId: plan.productId,
              offerId: plan.offerId,
              checkoutId: plan.checkoutId,
              amountCents: plan.amountCents,
              currency: 'BRL',
              allowedMethods: plan.allowedMethods,
              expiresAt: racedAttempt.expires_at,
            },
          };
        }
        if (racedAttempt?.id) {
          attemptId = racedAttempt.id;
        }
      } else {
        return {
          httpStatus: 503,
          result: buildBlockedResult({
            errorCode: 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE',
            error: err?.message || 'Falha ao registrar tentativa financeira no banco de dados.',
          }),
        };
      }
    }

    // 6. Preparar o redirecionamento no provedor
    const session = await provider.createCheckoutSession({
      attemptId,
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName,
      planId: 'pro',
      requestedMethod: params.requestedMethod,
      idempotencyKey: params.idempotencyKey,
      verifiedReadiness: readiness,
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

    // 7. Persistir o resultado de forma idempotente
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
