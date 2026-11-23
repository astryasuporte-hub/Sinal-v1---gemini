/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CaktoPaymentProvider — Implementação Oficial Cakto para FatosBR Payments V1.1
 *
 * Regras Inegociáveis:
 * 1. Plano pago único: FatosBR PRO — R$ 34,90/mês (3490 centavos BRL).
 * 2. Produto oficial: c8731178-55c9-47f6-8b98-987f31206ed8
 *    Oferta oficial:  vjw92gx
 *    Checkout ID:     1356033 (https://pay.cakto.com.br/vjw92gx)
 * 3. NUNCA cria novos produtos, ofertas ou checkouts na Cakto.
 * 4. NUNCA ativa oferta/produto remotamente e NUNCA libera checkout quando:
 *    - CAKTO_COMMERCIAL_ENABLED !== 'true'
 *    - CAKTO_METHODS_VERIFIED !== 'true'
 *    - oferta/checkout estiver disabled ou produto em waiting_config na Cakto
 *    - ambos credit_card e pix_auto não estiverem habilitados
 *    - método proibido (pix avulso, boleto, picpay etc.) estiver ativo
 *    - trial_days da oferta/checkout for diferente de 0
 * 5. Webhook HMAC-SHA256 com x-cakto-timestamp obrigatório (<= 300s), timingSafeEqual e eventHash.
 */

import crypto from 'crypto';
import {
  ALLOWED_CAKTO_METHODS,
  PROHIBITED_PAYMENT_METHODS,
  getEffectiveAllowedPaymentMethods,
  isAllowedPaymentMethod,
  isDirectPixApiEnabled,
  isProhibitedPaymentMethod,
  isTraditionalPixCommercialEnabled,
  normalizePaymentMethod,
  resolvePlanPrice,
  resolveRecurrenceMode,
} from '../plans.js';
import { safeCompare } from '../crypto.js';
import { CaktoClient, caktoClient } from './CaktoClient.js';
import type { PaymentProvider, WebhookVerificationOutcome } from './PaymentProvider.js';
import type {
  CanonicalWebhookAction,
  CheckoutCommercialReadiness,
  CheckoutSessionInput,
  CheckoutSessionResult,
  NormalizedPaymentWebhookEvent,
  PixChargePayload,
  ProviderCancelResult,
  ProviderReconcileOrder,
} from './types.js';

const WEBHOOK_MAX_AGE_SECONDS = 300;

export function normalizeCaktoAmountToCents(rawAmount: unknown): number | undefined {
  if (rawAmount === null || rawAmount === undefined || rawAmount === '') return undefined;
  const num = Number(rawAmount);
  if (!Number.isFinite(num) || num <= 0) return undefined;

  if (Number.isInteger(num) && num >= 100) {
    return num;
  }
  return Math.round(num * 100);
}

const PROHIBITED_CONFIG_BOOLEAN_KEYS: Array<[string, string]> = [
  ['pix', 'pix'],
  ['accepts_pix', 'pix'],
  ['pix_common', 'pix'],
  ['boleto', 'boleto'],
  ['accepts_boleto', 'boleto'],
  ['picpay', 'picpay'],
  ['accepts_picpay', 'picpay'],
  ['applepay', 'applepay'],
  ['apple_pay', 'applepay'],
  ['googlepay', 'googlepay'],
  ['google_pay', 'googlepay'],
  ['nupay', 'nupay'],
  ['nu_pay', 'nupay'],
];

const ALL_FINANCIAL_BOOLEAN_KEYS: Array<[string, string]> = [
  ...PROHIBITED_CONFIG_BOOLEAN_KEYS,
  ['credit_card', 'credit_card'],
  ['accepts_credit_card', 'credit_card'],
  ['pix_auto', 'pix_auto'],
  ['accepts_pix_auto', 'pix_auto'],
  ['pix_automatico', 'pix_auto'],
];

function normalizeMethodList(rawList: unknown[]): string[] {
  return Array.from(
    new Set(
      rawList
        .map((m) => {
          if (m && typeof m === 'object') {
            const obj = m as Record<string, any>;
            if (obj.enabled === false || obj.active === false) return '';
            return normalizePaymentMethod(String(obj.method || obj.id || obj.name || obj.type || ''));
          }
          return normalizePaymentMethod(String(m));
        })
        .filter((m) => m && m !== 'unknown')
    )
  );
}

/**
 * Extrai EXCLUSIVAMENTE campos financeiros verificáveis no nível do recurso da API
 * (NUNCA interpreta configurações visuais de layout como config.desktop.rows/styles).
 */
function extractVerifiableFinancialMethods(resource: any): string[] {
  if (!resource || typeof resource !== 'object') return [];
  const rawList: unknown[] = [];

  if (Array.isArray(resource.paymentMethods)) rawList.push(...resource.paymentMethods);
  if (Array.isArray(resource.payment_methods)) rawList.push(...resource.payment_methods);
  if (Array.isArray(resource.allowed_methods)) rawList.push(...resource.allowed_methods);
  if (Array.isArray(resource.methods)) rawList.push(...resource.methods);
  if (Array.isArray(resource.enabled_methods)) rawList.push(...resource.enabled_methods);

  for (const [key, canonical] of ALL_FINANCIAL_BOOLEAN_KEYS) {
    if (resource[key] === true) {
      rawList.push(canonical);
    }
  }

  return normalizeMethodList(rawList);
}

/**
 * Varredura defensiva de checkout.config apenas para detectar sinais explícitos de métodos PROIBIDOS.
 * Configurações visuais em config JAMAIS são usadas como prova positiva de permissão ou restrição financeira.
 */
function extractProhibitedSignalsFromCheckoutConfig(checkoutData: any): {
  prohibitedInConfig: string[];
  hasValidConfigObject: boolean;
  configIncompleteReason?: string;
} {
  if (!checkoutData || typeof checkoutData !== 'object') {
    return {
      prohibitedInConfig: [],
      hasValidConfigObject: false,
      configIncompleteReason: 'Resposta do checkout Cakto ausente ou inválida.',
    };
  }

  const config = checkoutData.config;
  const hasValidConfigObject = Boolean(config && typeof config === 'object' && !Array.isArray(config));
  if (!hasValidConfigObject) {
    return {
      prohibitedInConfig: [],
      hasValidConfigObject: false,
      configIncompleteReason: 'Objeto config ausente ou inválido na resposta do checkout Cakto.',
    };
  }

  const prohibited = new Set<string>();
  const visited = new Set<any>();

  const scanProhibited = (node: any, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 6 || visited.has(node)) return;
    visited.add(node);

    if (!Array.isArray(node)) {
      for (const [key, canonical] of PROHIBITED_CONFIG_BOOLEAN_KEYS) {
        if (node[key] === true) prohibited.add(canonical);
      }
      for (const listKey of ['paymentMethods', 'payment_methods', 'allowed_methods', 'methods', 'enabled_methods']) {
        if (Array.isArray(node[listKey])) {
          for (const m of normalizeMethodList(node[listKey])) {
            if (!isAllowedPaymentMethod(m)) prohibited.add(m);
          }
        }
      }
    }

    const values = Array.isArray(node) ? node : Object.values(node);
    for (const val of values) {
      if (val && typeof val === 'object') {
        scanProhibited(val, depth + 1);
      }
    }
  };

  scanProhibited(config, 0);

  return {
    prohibitedInConfig: Array.from(prohibited),
    hasValidConfigObject: true,
  };
}

function parseIsoOrNull(val: unknown): string | undefined {
  if (!val) return undefined;
  const s = String(val).trim();
  if (!s) return undefined;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

export class CaktoPaymentProvider implements PaymentProvider {
  readonly id = 'cakto' as const;
  readonly displayName = 'Cakto Assinaturas (FatosBR PRO)';

  constructor(private readonly client: CaktoClient = caktoClient) {}

  async getCommercialReadiness(): Promise<CheckoutCommercialReadiness> {
    const plan = resolvePlanPrice('pro');
    const commercialEnabled =
      String(process.env.CAKTO_COMMERCIAL_ENABLED || 'false').trim().toLowerCase() === 'true';
    const methodsVerified =
      String(process.env.CAKTO_METHODS_VERIFIED || 'false').trim().toLowerCase() === 'true';

    if (!commercialEnabled) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage:
          'Checkout Cakto bloqueado comercialmente até regularização na Cakto e liberação explícita (CAKTO_COMMERCIAL_ENABLED=false).',
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      };
    }

    if (!methodsVerified) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_PAYMENT_METHODS_NOT_VERIFIED',
        blockedMessage:
          'Métodos de pagamento da oferta Cakto ainda não verificados (exigido exclusivamente Cartão de Crédito + Pix Automático; Pix avulso proibido).',
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      };
    }

    if (!this.client.isConfigured()) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CREDENTIALS_MISSING',
        blockedMessage: 'Credenciais OAuth2 da Cakto (CAKTO_CLIENT_ID / CAKTO_CLIENT_SECRET) ausentes.',
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      };
    }

    const [offerRes, productRes, checkoutRes] = await Promise.all([
      this.client.getOffer(plan.offerId),
      this.client.getProduct(plan.productId),
      this.client.getCheckout(plan.productId, plan.checkoutId),
    ]);

    if (!offerRes.ok || !productRes.ok || !checkoutRes.ok) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Não foi possível validar o produto ${plan.productId}, oferta ${plan.offerId} e checkout ${plan.checkoutId} na Cakto (offer=${offerRes.status}, product=${productRes.status}, checkout=${checkoutRes.status}).`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      };
    }

    const offerData = offerRes.data?.data || offerRes.data || {};
    const productData = productRes.data?.data || productRes.data || {};
    const checkoutData = checkoutRes.data?.data || checkoutRes.data || null;

    if (!checkoutData || typeof checkoutData !== 'object') {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Resposta vazia ou inválida ao consultar o checkout '${plan.checkoutId}' na Cakto.`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
      };
    }

    const offerStatus = String(offerData.status || (offerData.active === false ? 'disabled' : 'active')).toLowerCase();
    const productStatus = String(productData.status || (productData.active === false ? 'disabled' : 'unknown')).toLowerCase();
    const checkoutStatus = String(
      checkoutData.status || (checkoutData.active === false ? 'disabled' : 'active')
    ).toLowerCase();

    const offerTrialDays = Number.isFinite(Number(offerData.trial_days ?? 0)) ? Number(offerData.trial_days ?? 0) : 0;
    const checkoutTrialDays = Number.isFinite(Number(checkoutData?.trial_days ?? 0)) ? Number(checkoutData?.trial_days ?? 0) : 0;
    const trialDays = offerTrialDays !== 0 ? offerTrialDays : checkoutTrialDays;

    const productPriceCents = normalizeCaktoAmountToCents(
      productData.price ?? productData.amount_cents ?? productData.amount
    );
    const offerPriceCents = normalizeCaktoAmountToCents(
      offerData.price ?? offerData.amount_cents ?? offerData.amount
    );
    const providerPriceCents = offerPriceCents ?? productPriceCents ?? null;

    if (
      offerStatus !== 'active' ||
      productStatus === 'waiting_config' ||
      productStatus === 'disabled' ||
      productStatus === 'inactive' ||
      checkoutStatus === 'disabled' ||
      checkoutStatus === 'inactive' ||
      checkoutStatus === 'waiting_config'
    ) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Oferta '${plan.offerId}' (${offerStatus}), produto '${plan.productId}' (${productStatus}) ou checkout '${plan.checkoutId}' (${checkoutStatus}) não está liberado comercialmente.`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
        providerPriceCents,
        offerStatus,
        productStatus,
        checkoutStatus,
        trialDays,
      };
    }

    if (
      (productPriceCents !== undefined && productPriceCents !== plan.amountCents) ||
      (offerPriceCents !== undefined && offerPriceCents !== plan.amountCents)
    ) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Preço divergente na Cakto (${providerPriceCents} centavos) em relação ao plano oficial (${plan.amountCents} centavos BRL).`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
        providerPriceCents,
        offerStatus,
        productStatus,
        checkoutStatus,
        trialDays,
      };
    }

    if (offerTrialDays !== 0 || checkoutTrialDays !== 0) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Oferta/checkout Cakto configurado com trial_days=${trialDays}. O trial de 7 dias sem cartão pertence exclusivamente ao SaaS (exigido trial_days=0 na Cakto).`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
        providerPriceCents,
        offerStatus,
        productStatus,
        checkoutStatus,
        trialDays,
      };
    }

    // Extrai métodos financeiros APENAS de campos oficiais do provedor (jamais do layout visual de config)
    const productMethods = extractVerifiableFinancialMethods(productData);
    const offerMethods = extractVerifiableFinancialMethods(offerData);
    const checkoutMethods = extractVerifiableFinancialMethods(checkoutData);
    const configSafety = extractProhibitedSignalsFromCheckoutConfig(checkoutData);

    const detectedMethods = Array.from(
      new Set([...productMethods, ...offerMethods, ...checkoutMethods, ...configSafety.prohibitedInConfig])
    );

    const unexpectedMethods = detectedMethods.filter((m) => !isAllowedPaymentMethod(m));
    const effectiveAllowed = getEffectiveAllowedPaymentMethods();
    const effectiveProhibited = isTraditionalPixCommercialEnabled()
      ? PROHIBITED_PAYMENT_METHODS.filter((m) => m !== 'pix' && m !== 'pix_avulso')
      : PROHIBITED_PAYMENT_METHODS;
    if (unexpectedMethods.length > 0) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_DISALLOWED_PAYMENT_METHOD_ENABLED',
        blockedMessage: `Provedor Cakto possui método não autorizado habilitado (${unexpectedMethods.join(', ')}). Apenas credit_card e pix_auto são permitidos; regularize ou desabilite na conta Cakto.`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: effectiveProhibited,
        detectedProviderMethods: detectedMethods,
        productMethods,
        offerMethods,
        checkoutMethods,
        providerPriceCents,
        offerStatus,
        productStatus,
        checkoutStatus,
        trialDays,
      };
    }

    const missingEvidence: string[] = [];
    if (!configSafety.hasValidConfigObject) {
      missingEvidence.push(
        configSafety.configIncompleteReason || 'checkout.config (estrutura oficial do checkout ausente)'
      );
    }
    const productHasAllAllowed = ALLOWED_CAKTO_METHODS.every((m) => productMethods.includes(m));
    const offerHasAllAllowed = ALLOWED_CAKTO_METHODS.every((m) => offerMethods.includes(m));
    const checkoutHasAllAllowed = ALLOWED_CAKTO_METHODS.every((m) => checkoutMethods.includes(m));

    if (!productHasAllAllowed) {
      missingEvidence.push(
        `product.paymentMethods (produto ${plan.productId} não comprova ambos credit_card e pix_auto ativos; detectado: ${productMethods.join(', ') || 'nenhum'})`
      );
    }
    if (!offerHasAllAllowed) {
      missingEvidence.push(
        `offer.paymentMethods (oferta ${plan.offerId} não comprova ambos credit_card e pix_auto ativos; detectado: ${offerMethods.join(', ') || 'nenhum'})`
      );
    }
    if (!checkoutHasAllAllowed) {
      missingEvidence.push(
        `checkout.paymentMethods (endpoint de checkout ${plan.checkoutId} retornou principalmente layout visual em config e não comprova métodos financeiros processáveis; detectado: ${checkoutMethods.join(', ') || 'nenhum'})`
      );
    }

    if (missingEvidence.length > 0) {
      return {
        ready: false,
        blockedReasonCode: 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        blockedMessage: `Evidências financeiras insuficientes na API Cakto para liberar checkout com segurança. Informações ausentes: ${missingEvidence.join('; ')}.`,
        commercialEnabled,
        methodsVerified,
        allowedMethods: ALLOWED_CAKTO_METHODS,
        prohibitedMethods: effectiveProhibited,
        detectedProviderMethods: detectedMethods,
        productMethods,
        offerMethods,
        checkoutMethods,
        missingEvidence,
        providerPriceCents,
        offerStatus,
        productStatus,
        checkoutStatus,
        trialDays,
      };
    }

    return {
      ready: true,
      commercialEnabled,
      methodsVerified,
      allowedMethods: ALLOWED_CAKTO_METHODS,
      prohibitedMethods: effectiveProhibited,
      detectedProviderMethods: detectedMethods,
      productMethods,
      offerMethods,
      checkoutMethods,
      missingEvidence: [],
      providerPriceCents,
      offerStatus,
      productStatus,
      checkoutStatus,
      trialDays,
    };
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const plan = resolvePlanPrice(input.planId);
    const normalizedRequested = input.requestedMethod ? normalizePaymentMethod(input.requestedMethod) : undefined;
    const effectiveAllowed = getEffectiveAllowedPaymentMethods();

    if (
      normalizedRequested &&
      (isProhibitedPaymentMethod(normalizedRequested) || !isAllowedPaymentMethod(normalizedRequested))
    ) {
      return {
        success: false,
        blocked: true,
        errorCode: 'PAYMENT_METHOD_NOT_ALLOWED',
        error: `O método '${input.requestedMethod}' não é permitido. Utilize Cartão de Crédito ou Pix Automático.`,
        attemptId: input.attemptId,
        provider: this.id,
        productId: plan.productId,
        offerId: plan.offerId,
        checkoutId: plan.checkoutId,
        amountCents: plan.amountCents,
        currency: 'BRL',
        allowedMethods: effectiveAllowed,
      };
    }

    const readiness = input.verifiedReadiness?.ready
      ? input.verifiedReadiness
      : await this.getCommercialReadiness();
    if (!readiness.ready) {
      return {
        success: false,
        blocked: true,
        errorCode: readiness.blockedReasonCode || 'CAKTO_CHECKOUT_COMMERCIAL_BLOCKED',
        error: readiness.blockedMessage || 'Checkout comercialmente bloqueado até verificação na Cakto.',
        missingEvidence: readiness.missingEvidence,
        attemptId: input.attemptId,
        provider: this.id,
        productId: plan.productId,
        offerId: plan.offerId,
        checkoutId: plan.checkoutId,
        amountCents: plan.amountCents,
        currency: 'BRL',
        allowedMethods: effectiveAllowed,
      };
    }

    const resolvedRecurrence = resolveRecurrenceMode({ paymentMethod: normalizedRequested || 'credit_card' });
    const recurrenceMode =
      resolvedRecurrence === 'PIX_AUTOMATIC' || resolvedRecurrence === 'PIX_MANUAL_CYCLE'
        ? resolvedRecurrence
        : 'CARD_RECURRING';

    // Quando Pix tradicional + API direta estiverem explicitamente habilitados no servidor, gera cobrança Pix real via API Cakto
    let pixCharge: PixChargePayload | undefined;
    if (normalizedRequested === 'pix' && isDirectPixApiEnabled() && input.userEmail) {
      const directRes = await this.client.createDirectPayment({
        offerId: plan.offerId,
        paymentMethod: 'pix',
        customer: {
          name: input.userName || input.userEmail.split('@')[0] || 'Assinante FatosBR',
          email: input.userEmail,
        },
        idempotencyKey: input.idempotencyKey || input.attemptId,
        pixExpiresInSeconds: 1800,
        externalId: input.attemptId,
      });

      const directData = directRes.data?.data || directRes.data;
      const extractedPix = this.extractPixPayload(directData, 'pix');
      if (directRes.ok && extractedPix?.qrCode) {
        pixCharge = {
          ...extractedPix,
          providerOrderId: String(directData?.id || directData?.order_id || '') || undefined,
          status: 'PENDING',
        };
      }
    }

    const url = new URL(plan.checkoutBaseUrl);
    url.searchParams.set('sck', input.attemptId);
    url.searchParams.set('external_id', input.attemptId);
    if (input.userEmail) {
      url.searchParams.set('email', input.userEmail);
    }
    if (input.userName) {
      url.searchParams.set('name', input.userName);
    }
    if (normalizedRequested && isAllowedPaymentMethod(normalizedRequested)) {
      url.searchParams.set('paymentMethod', normalizedRequested);
    }

    return {
      success: true,
      blocked: false,
      attemptId: input.attemptId,
      provider: this.id,
      checkoutUrl: url.toString(),
      pixCharge,
      recurrenceMode,
      productId: plan.productId,
      offerId: plan.offerId,
      checkoutId: plan.checkoutId,
      amountCents: plan.amountCents,
      currency: 'BRL',
      allowedMethods: effectiveAllowed,
      expiresAt: pixCharge?.expiresAt || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    };
  }

  verifyWebhookSignature(params: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
  }): WebhookVerificationOutcome {
    const secret = (process.env.CAKTO_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      return {
        valid: false,
        errorCode: 'WEBHOOK_SECRET_NOT_CONFIGURED',
        reason: 'CAKTO_WEBHOOK_SECRET ausente no servidor (fail-closed).',
      };
    }

    const normalizedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(params.headers || {})) {
      if (v !== undefined) {
        normalizedHeaders[k.toLowerCase()] = Array.isArray(v) ? String(v[0] || '') : String(v);
      }
    }

    const sigHeader = (
      normalizedHeaders['x-cakto-signature'] ||
      normalizedHeaders['x-signature'] ||
      ''
    ).trim();

    if (!sigHeader) {
      return {
        valid: false,
        errorCode: 'MISSING_SIGNATURE',
        reason: 'Cabeçalho x-cakto-signature ausente.',
      };
    }

    const tsHeader = (normalizedHeaders['x-cakto-timestamp'] || '').trim();
    if (!tsHeader) {
      return {
        valid: false,
        errorCode: 'MISSING_TIMESTAMP',
        reason: 'Cabeçalho x-cakto-timestamp obrigatório para proteção anti-replay.',
      };
    }

    const tsNum = Number(tsHeader);
    const tsMs = Number.isFinite(tsNum)
      ? tsNum > 1e12
        ? tsNum
        : tsNum * 1000
      : Date.parse(tsHeader);

    if (!Number.isFinite(tsMs)) {
      return {
        valid: false,
        errorCode: 'INVALID_TIMESTAMP',
        reason: 'Cabeçalho x-cakto-timestamp inválido.',
      };
    }

    const ageSeconds = Math.abs(Date.now() - tsMs) / 1000;
    if (ageSeconds > WEBHOOK_MAX_AGE_SECONDS) {
      return {
        valid: false,
        errorCode: 'WEBHOOK_REPLAY_EXPIRED',
        reason: `Timestamp do webhook excedeu a janela máxima de ${WEBHOOK_MAX_AGE_SECONDS}s (${Math.round(ageSeconds)}s).`,
      };
    }

    const providedHex = sigHeader.startsWith('v1=') ? sigHeader.slice(3).trim() : sigHeader;
    const signedPayload = `${tsHeader}.${params.rawBody}`;
    const expectedHmac = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    if (!safeCompare(providedHex, expectedHmac)) {
      return {
        valid: false,
        errorCode: 'INVALID_SIGNATURE',
        reason: 'Assinatura HMAC Cakto inválida.',
      };
    }

    try {
      const parsedBody = JSON.parse(params.rawBody);
      if (parsedBody && typeof parsedBody === 'object' && parsedBody.secret !== undefined) {
        if (!safeCompare(String(parsedBody.secret), secret)) {
          return {
            valid: false,
            errorCode: 'INVALID_WEBHOOK_SECRET',
            reason: 'Campo secret do payload Cakto diverge do segredo configurado.',
          };
        }
      }
    } catch {
      return {
        valid: false,
        errorCode: 'INVALID_PAYLOAD',
        reason: 'Payload JSON inválido na verificação de assinatura.',
      };
    }

    const eventHash = crypto.createHash('sha256').update(signedPayload).digest('hex');
    return {
      valid: true,
      timestampIso: new Date(tsMs).toISOString(),
      eventHash,
    };
  }

  parseWebhookEvent(rawPayload: Record<string, any>): NormalizedPaymentWebhookEvent {
    const eventType = String(rawPayload?.event || rawPayload?.type || 'unknown')
      .trim()
      .toLowerCase();

    const rawData = rawPayload?.data;
    const data = Array.isArray(rawData)
      ? rawData[0] && typeof rawData[0] === 'object'
        ? rawData[0]
        : rawPayload
      : rawData && typeof rawData === 'object'
      ? rawData
      : rawPayload;

    const providerEventId = String(
      rawPayload?.event_id ||
        rawPayload?.eventId ||
        rawPayload?.id ||
        `${eventType}:${data?.id || data?.order_id || data?.subscription?.id || Date.now()}`
    ).trim();

    const productId = String(data?.product?.id || data?.product_id || data?.productId || '').trim() || undefined;
    const offerId = String(data?.offer?.id || data?.offer_id || data?.offerId || '').trim() || undefined;
    const checkoutId = String(data?.checkout || data?.checkout_id || data?.checkoutId || '').trim() || undefined;

    const rawMethod =
      data?.paymentMethod ||
      data?.payment_method ||
      data?.method ||
      data?.payment?.method ||
      data?.subscription?.paymentMethod ||
      '';
    const paymentMethod = normalizePaymentMethod(String(rawMethod));

    const amountCents = normalizeCaktoAmountToCents(
      data?.amount_cents ?? data?.amountCents ?? data?.amount ?? data?.paidAmount ?? data?.offer?.price
    );
    const currency = String(data?.currency || 'BRL').trim().toUpperCase();

    const attemptId =
      String(
        data?.sck ||
          data?.external_id ||
          data?.externalId ||
          data?.metadata?.attempt_id ||
          data?.metadata?.attemptId ||
          ''
      ).trim() || undefined;

    const userId =
      String(data?.metadata?.user_id || data?.metadata?.userId || '').trim() || undefined;

    const customerEmail =
      String(data?.customer?.email || data?.customerEmail || data?.email || '')
        .trim()
        .toLowerCase() || undefined;

    const providerOrderId = String(data?.id || data?.order_id || data?.orderId || '').trim() || undefined;
    const providerSubscriptionId =
      String(
        data?.subscription?.id || data?.subscription_id || data?.subscriptionId || ''
      ).trim() || undefined;

    const paidAt = parseIsoOrNull(data?.paidAt || data?.paid_at || data?.approved_at || rawPayload?.paidAt);
    const periodStart = parseIsoOrNull(
      data?.subscription?.current_period_start ||
        data?.current_period_start ||
        data?.period_start ||
        paidAt
    );
    const nextBillingAt = parseIsoOrNull(
      data?.subscription?.next_payment_date ||
        data?.next_payment_date ||
        data?.next_billing_at
    );
    const periodEnd = parseIsoOrNull(
      data?.subscription?.current_period_end ||
        data?.current_period_end ||
        data?.period_end ||
        data?.expires_at ||
        nextBillingAt
    );
    const occurredAt =
      parseIsoOrNull(rawPayload?.createdAt || data?.updatedAt || data?.paidAt || data?.createdAt) ||
      new Date().toISOString();

    const subscriptionPaused = eventType === 'subscription_paused';
    const refundReason =
      String(data?.refund_reason || data?.reason || data?.dispute_reason || '').trim() || undefined;
    const pixData = this.extractPixPayload(data, paymentMethod);

    let canonicalAction: CanonicalWebhookAction = 'IGNORE';
    if (eventType === 'purchase_approved' || eventType === 'order_paid') {
      canonicalAction = 'ACTIVATE';
    } else if (eventType === 'subscription_created') {
      // subscription_created NUNCA libera PRO por si só; aguarda confirmação financeira real (purchase_approved/order_paid)
      canonicalAction = 'SUBSCRIPTION_CREATED';
    } else if (eventType === 'subscription_renewed') {
      canonicalAction = 'RENEW';
    } else if (eventType === 'subscription_late_recovered') {
      canonicalAction = 'RECOVER';
    } else if (eventType === 'subscription_resumed') {
      const subStatus = String(data?.status || data?.subscription?.status || '').toLowerCase();
      canonicalAction =
        paidAt || subStatus === 'paid' || subStatus === 'active'
          ? 'RECOVER'
          : 'SUBSCRIPTION_CREATED';
    } else if (eventType === 'subscription_late') {
      canonicalAction = 'PAST_DUE';
    } else if (eventType === 'purchase_refused' || eventType === 'subscription_renewal_refused') {
      canonicalAction = 'REFUSED';
    } else if (eventType === 'subscription_canceled' || eventType === 'subscription_paused') {
      canonicalAction = 'CANCEL';
    } else if (eventType === 'subscription_expired') {
      canonicalAction = 'EXPIRE';
    } else if (eventType === 'pix_expirado' || eventType === 'pix_expired' || eventType === 'order_expired') {
      canonicalAction = 'PIX_EXPIRED';
    } else if (eventType === 'refund_requested') {
      canonicalAction = 'REFUND_REQUESTED';
    } else if (eventType === 'refund_processing') {
      canonicalAction = 'REFUND_PROCESSING';
    } else if (eventType === 'refund_failed') {
      canonicalAction = 'REFUND_FAILED';
    } else if (eventType === 'refund' || eventType === 'refunded') {
      canonicalAction = 'REFUND';
    } else if (eventType === 'chargeback' || eventType === 'chargeback_open' || eventType === 'dispute') {
      canonicalAction = 'CHARGEBACK';
    } else if (
      eventType === 'waiting_payment' ||
      eventType === 'pix_gerado' ||
      eventType === 'boleto_gerado' ||
      eventType === 'picpay_gerado'
    ) {
      canonicalAction = 'PENDING_PAYMENT';
    }

    return {
      provider: this.id,
      providerEventId,
      eventType,
      canonicalAction,
      providerOrderId,
      providerSubscriptionId,
      attemptId,
      userId,
      customerEmail,
      productId,
      offerId,
      checkoutId,
      paymentMethod,
      amountCents,
      currency,
      occurredAt,
      paidAt,
      periodStart,
      periodEnd,
      nextBillingAt,
      subscriptionPaused,
      refundReason,
      pixData,
      rawPayload,
    };
  }

  private extractPixPayload(data: any, normalizedMethod: string): PixChargePayload | undefined {
    if (!data || typeof data !== 'object') return undefined;
    const pixObj = data.pix && typeof data.pix === 'object' ? data.pix : null;
    const qrCode = String(
      pixObj?.qrCode ||
        pixObj?.qr_code ||
        pixObj?.emv ||
        pixObj?.copiaECola ||
        pixObj?.copia_e_cola ||
        data?.pix_qr_code ||
        data?.qr_code ||
        ''
    ).trim();
    const copiaECola = String(
      pixObj?.copiaECola ||
        pixObj?.copia_e_cola ||
        pixObj?.emv ||
        pixObj?.qrCode ||
        pixObj?.qr_code ||
        ''
    ).trim();
    const qrCodeImageUrl = String(
      pixObj?.qrCodeImageUrl ||
        pixObj?.qrCodeBase64 ||
        pixObj?.qr_code_url ||
        pixObj?.qrcode_image ||
        ''
    ).trim();
    const expiresAt = parseIsoOrNull(
      pixObj?.expirationDate ||
        pixObj?.expiresAt ||
        pixObj?.expires_at ||
        data?.pix_expires_at ||
        data?.expirationDate
    );

    if (!qrCode && !copiaECola && !qrCodeImageUrl && normalizedMethod !== 'pix' && normalizedMethod !== 'pix_auto') {
      return undefined;
    }
    if (!qrCode && !copiaECola && !qrCodeImageUrl && !expiresAt) {
      return undefined;
    }

    return {
      providerOrderId: String(data?.id || data?.order_id || data?.orderId || '').trim() || undefined,
      pixType: normalizedMethod === 'pix' ? 'PIX_TRADITIONAL' : 'PIX_AUTOMATIC',
      qrCode: qrCode || undefined,
      qrCodeImageUrl: qrCodeImageUrl || undefined,
      copiaECola: copiaECola || qrCode || undefined,
      expiresAt,
      status: 'PENDING',
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<ProviderCancelResult> {
    const cleanId = String(providerSubscriptionId || '').trim();
    if (!cleanId) {
      return {
        success: true,
        canceledAt: new Date().toISOString(),
        providerStatus: 'local_only_canceled',
      };
    }

    if (!this.client.isConfigured()) {
      return {
        success: false,
        canceledAt: new Date().toISOString(),
        error: 'CAKTO_CREDENTIALS_MISSING: Não foi possível cancelar remotamente na Cakto.',
      };
    }

    const res = await this.client.cancelSubscription(cleanId);
    if (!res.ok) {
      return {
        success: false,
        canceledAt: new Date().toISOString(),
        error: res.error || `HTTP ${res.status}`,
      };
    }

    return {
      success: true,
      canceledAt: new Date().toISOString(),
      providerStatus: String(res.data?.status || 'canceled'),
    };
  }

  async fetchReconcilableOrders(params: {
    attemptId?: string;
    providerOrderId?: string;
    providerSubscriptionId?: string;
    customerEmail?: string;
  }): Promise<ProviderReconcileOrder[]> {
    if (!this.client.isConfigured()) {
      return [];
    }

    const results: ProviderReconcileOrder[] = [];
    let subDetails: { periodStart?: string; periodEnd?: string; nextBillingAt?: string } = {};

    if (params.providerSubscriptionId) {
      const subRes = await this.client.getSubscription(params.providerSubscriptionId).catch(() => null);
      if (subRes?.ok && subRes.data) {
        const s = subRes.data?.data || subRes.data;
        subDetails = {
          periodStart: parseIsoOrNull(s?.current_period_start),
          periodEnd: parseIsoOrNull(s?.current_period_end),
          nextBillingAt: parseIsoOrNull(s?.next_payment_date || s?.current_period_end),
        };
      }
    }

    if (params.providerOrderId) {
      const orderRes = await this.client.getOrder(params.providerOrderId);
      if (orderRes.ok && orderRes.data) {
        const order = orderRes.data?.data || orderRes.data;
        results.push(this.mapCaktoOrder(order, subDetails));
      }
      return results;
    }

    const searchKey = params.attemptId || params.customerEmail;
    if (searchKey) {
      const listRes = await this.client.listOrders({ search: searchKey, limit: 10 });
      if (listRes.ok && listRes.data) {
        const rows = Array.isArray(listRes.data?.results)
          ? listRes.data.results
          : Array.isArray(listRes.data?.data)
          ? listRes.data.data
          : [];
        for (const row of rows) {
          results.push(this.mapCaktoOrder(row, subDetails));
        }
      }
    }

    return results;
  }

  private mapCaktoOrder(
    order: any,
    subDetails: { periodStart?: string; periodEnd?: string; nextBillingAt?: string } = {}
  ): ProviderReconcileOrder {
    const rawStatus = String(order?.status || '').trim().toLowerCase();
    let status: ProviderReconcileOrder['status'] = 'unknown';
    if (rawStatus === 'paid' || rawStatus === 'approved' || rawStatus === 'active') status = 'paid';
    else if (rawStatus === 'waiting_payment' || rawStatus === 'pending') status = 'pending';
    else if (rawStatus === 'refused' || rawStatus === 'failed') status = 'refused';
    else if (rawStatus === 'chargedback' || rawStatus === 'chargeback') status = 'chargeback';
    else if (rawStatus === 'refunded') status = 'refunded';
    else if (rawStatus === 'past_due' || rawStatus === 'late') status = 'past_due';
    else if (rawStatus === 'canceled' || rawStatus === 'cancelled') status = 'canceled';
    else if (rawStatus === 'expired') status = 'expired';

    const paidAt = parseIsoOrNull(order?.paidAt || order?.paid_at || order?.approved_at);

    const normalizedMethod = normalizePaymentMethod(String(order?.paymentMethod || order?.payment_method || ''));

    return {
      providerOrderId: String(order?.id || ''),
      providerSubscriptionId: String(order?.subscription?.id || order?.subscription_id || '') || undefined,
      attemptId: String(order?.sck || order?.external_id || '') || undefined,
      customerEmail: String(order?.customer?.email || '').toLowerCase() || undefined,
      productId: String(order?.product?.id || order?.product_id || '') || undefined,
      offerId: String(order?.offer?.id || order?.offer_id || '') || undefined,
      paymentMethod: normalizedMethod,
      amountCents: normalizeCaktoAmountToCents(order?.amount_cents ?? order?.amount) || 0,
      currency: String(order?.currency || 'BRL').toUpperCase(),
      status,
      paidAt,
      periodStart: parseIsoOrNull(order?.subscription?.current_period_start) || subDetails.periodStart || paidAt,
      periodEnd: parseIsoOrNull(order?.subscription?.current_period_end) || subDetails.periodEnd,
      nextBillingAt: parseIsoOrNull(order?.subscription?.next_payment_date) || subDetails.nextBillingAt,
      pixData: this.extractPixPayload(order, normalizedMethod),
    };
  }
}

export const caktoPaymentProvider = new CaktoPaymentProvider();
