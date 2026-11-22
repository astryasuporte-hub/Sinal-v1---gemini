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
        existingAttempt = await store.findBillingAttemptByIdempotencyKey(
          params.userId,
          params.idempotencyKey,
          activeProviderId
        );
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

    const resolveExistingAttemptOutcome = async (
      attempt: NonNullable<typeof existingAttempt>
    ): Promise<{ httpStatus: number; result: CheckoutSessionResult } | null> => {
      if (attempt.status === 'PAID') {
        return {
          httpStatus: 409,
          result: buildBlockedResult({
            attemptId: attempt.id,
            errorCode: 'RECONCILIATION_REQUIRED',
            error: 'Esta tentativa de checkout já foi paga e aguarda conclusão da reconciliação.',
          }),
        };
      }

      if (attempt.status === 'BLOCKED') {
        return {
          httpStatus: 423,
          result: buildBlockedResult({
            attemptId: attempt.id,
            errorCode: attempt.metadata?.blocked_reason || 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
            error:
              attempt.metadata?.blocked_message ||
              'Tentativa de checkout bloqueada comercialmente para esta chave de idempotência.',
          }),
        };
      }

      const expiresAtMs = Date.parse(attempt.expires_at);
      const isExpired = attempt.status === 'EXPIRED' || (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now());
      if (isExpired) {
        if (attempt.status === 'CREATED' || attempt.status === 'REDIRECTED') {
          await store.updateBillingAttempt(attempt.id, {
            status: 'EXPIRED',
            metadata: { expired_detected_at: new Date().toISOString() },
          }).catch(() => {});
        }
        return {
          httpStatus: 409,
          result: buildBlockedResult({
            attemptId: attempt.id,
            errorCode: 'ATTEMPT_EXPIRED',
            error: 'Esta tentativa de checkout expirou. Utilize uma nova chave para iniciar outro checkout.',
          }),
        };
      }

      if (attempt.status === 'REDIRECTED' && attempt.checkout_url) {
        return {
          httpStatus: 200,
          result: {
            success: true,
            blocked: false,
            attemptId: attempt.id,
            provider: activeProviderId,
            checkoutUrl: attempt.checkout_url,
            productId: plan.productId,
            offerId: plan.offerId,
            checkoutId: plan.checkoutId,
            amountCents: plan.amountCents,
            currency: 'BRL',
            allowedMethods: plan.allowedMethods,
            expiresAt: attempt.expires_at,
          },
        };
      }

      if (attempt.status === 'REFUSED' || attempt.status === 'CANCELED') {
        return {
          httpStatus: 409,
          result: buildBlockedResult({
            attemptId: attempt.id,
            errorCode: `ATTEMPT_${attempt.status}`,
            error: `Tentativa anterior encontra-se no estado ${attempt.status}. Gere uma nova chave de idempotência.`,
          }),
        };
      }

      // Status 'CREATED' ainda válido (ex.: timeout/falha após gravação inicial) deve retomar usando o mesmo attemptId
      return null;
    };

    // Idempotência: avalia tentativa pré-existente antes de tentar INSERT
    let attemptId: string | null = null;
    if (existingAttempt) {
      const resolved = await resolveExistingAttemptOutcome(existingAttempt);
      if (resolved) return resolved;
      if (existingAttempt.status === 'CREATED') {
        attemptId = existingAttempt.id;
      }
    }

    // 5. Somente após todas as verificações (e se não houver CREATED retomável), criar tentativa em internal.billing_attempts
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    if (!attemptId) {
      attemptId = crypto.randomUUID();
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
        const errText = `${String(err?.code || '')} ${String(err?.message || '')}`.toLowerCase();
        const isUniqueViolation =
          Boolean(params.idempotencyKey) && (errText.includes('23505') || errText.includes('duplicate') || errText.includes('unique'));

        if (isUniqueViolation && params.idempotencyKey) {
          // Aguarda brevemente caso a requisição vencedora esteja finalizando a preparação do redirecionamento
          let racedAttempt: typeof existingAttempt = null;
          for (let i = 0; i < 8; i++) {
            racedAttempt = await store
              .findBillingAttemptByIdempotencyKey(params.userId, params.idempotencyKey, activeProviderId)
              .catch(() => null);
            if (!racedAttempt) break;
            const racedResolved = await resolveExistingAttemptOutcome(racedAttempt);
            if (racedResolved) return racedResolved;
            await new Promise((r) => setTimeout(r, 15));
          }
          if (racedAttempt?.id) {
            attemptId = racedAttempt.id;
          } else {
            return {
              httpStatus: 503,
              result: buildBlockedResult({
                errorCode: 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE',
                error: err?.message || 'Conflito transitório ao registrar tentativa financeira no banco.',
              }),
            };
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
    }

    // 6. Preparar o redirecionamento no provedor (com recuperação segura em falha transitória/timeout)
    let session: CheckoutSessionResult;
    try {
      session = await provider.createCheckoutSession({
        attemptId,
        userId: params.userId,
        userEmail: params.userEmail,
        userName: params.userName,
        planId: 'pro',
        requestedMethod: params.requestedMethod,
        idempotencyKey: params.idempotencyKey,
        verifiedReadiness: readiness,
      });
    } catch (providerErr: any) {
      await store
        .updateBillingAttempt(attemptId, {
          metadata: {
            last_checkout_error: providerErr?.message || 'PROVIDER_SESSION_ERROR',
            last_checkout_error_at: new Date().toISOString(),
          },
        })
        .catch(() => {});

      return {
        httpStatus: 503,
        result: buildBlockedResult({
          attemptId,
          errorCode: 'CHECKOUT_PROVIDER_UNAVAILABLE',
          error:
            providerErr?.message ||
            'Falha transitória ou timeout ao preparar o checkout no provedor. Reenvie com a mesma chave para retomar.',
        }),
      };
    }

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
        result: {
          ...session,
          attemptId,
        },
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
