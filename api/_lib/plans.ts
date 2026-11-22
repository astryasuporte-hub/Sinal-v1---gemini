/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR — Resolvedor Central de Planos e Preços Controlado pelo Servidor (Payments V1)
 *
 * Princípios de Segurança Financeira:
 * 1. Plano pago único canônico: FatosBR PRO — R$ 34,90/mês (3490 centavos BRL).
 * 2. O cliente NUNCA determina o valor, moeda, produto, oferta ou métodos de pagamento.
 * 3. Trial gratuito de 7 dias é 100% controlado pelo SaaS FatosBR (sem exigir cartão na Cakto: trial_days = 0).
 * 4. Métodos permitidos no checkout recorrente Cakto: EXCLUSIVAMENTE credit_card e pix_auto.
 *    Métodos proibidos (pix avulso, boleto, picpay, etc.) são bloqueados em checkout e webhook.
 */

export type AllowedCaktoPaymentMethod = 'credit_card' | 'pix_auto';
export type ProhibitedPaymentMethod = 'pix' | 'boleto' | 'picpay' | 'bank_slip' | 'cash' | 'unknown';

export const CAKTO_OFFICIAL_IDS = {
  get productId() {
    return (process.env.CAKTO_PRODUCT_ID || 'c8731178-55c9-47f6-8b98-987f31206ed8').trim();
  },
  get offerId() {
    return (process.env.CAKTO_OFFER_ID || 'vjw92gx').trim();
  },
  get checkoutId() {
    return (process.env.CAKTO_CHECKOUT_ID || '1356033').trim();
  },
  get checkoutBaseUrl() {
    return `https://pay.cakto.com.br/${this.offerId}`;
  },
} as const;

export const ALLOWED_CAKTO_METHODS: readonly AllowedCaktoPaymentMethod[] = ['credit_card', 'pix_auto'];
export const PROHIBITED_PAYMENT_METHODS: readonly string[] = [
  'pix',
  'pix_avulso',
  'boleto',
  'bank_slip',
  'picpay',
  'wallet_picpay',
  'ted',
  'doc',
];

export const SAAS_TRIAL_DAYS = 7;

export interface SubscriptionPlanConfig {
  id: 'pro';
  name: string;
  amountCents: number;
  amountFormatted: string;
  currency: 'BRL';
  periodDays: number;
  saasTrialDays: number;
  providerTrialDays: 0;
  isActive: boolean;
  description: string;
  provider: 'cakto';
  productId: string;
  offerId: string;
  checkoutId: string;
  checkoutBaseUrl: string;
  allowedMethods: readonly AllowedCaktoPaymentMethod[];
  prohibitedMethods: readonly string[];
  recurrence: {
    intervalType: 'month';
    interval: 1;
    recurrencePeriod: 30;
    quantityRecurrences: -1;
    maxRetries: 3;
    retryInterval: 1;
  };
}

export function getProPlanConfig(): SubscriptionPlanConfig {
  return {
    id: 'pro',
    name: 'FatosBR PRO',
    amountCents: 3490,
    amountFormatted: 'R$ 34,90',
    currency: 'BRL',
    periodDays: 30,
    saasTrialDays: SAAS_TRIAL_DAYS,
    providerTrialDays: 0,
    isActive: true,
    description: 'Assinatura FatosBR PRO — Inteligência Jornalística Executiva (Mensal)',
    provider: 'cakto',
    productId: CAKTO_OFFICIAL_IDS.productId,
    offerId: CAKTO_OFFICIAL_IDS.offerId,
    checkoutId: CAKTO_OFFICIAL_IDS.checkoutId,
    checkoutBaseUrl: CAKTO_OFFICIAL_IDS.checkoutBaseUrl,
    allowedMethods: ALLOWED_CAKTO_METHODS,
    prohibitedMethods: PROHIBITED_PAYMENT_METHODS,
    recurrence: {
      intervalType: 'month',
      interval: 1,
      recurrencePeriod: 30,
      quantityRecurrences: -1,
      maxRetries: 3,
      retryInterval: 1,
    },
  };
}

export const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlanConfig> = {
  pro: getProPlanConfig(),
};

/**
 * Resolve a configuração canônica do plano pago único FatosBR PRO.
 * Lança exceção caso seja solicitado qualquer plano inexistente ou adulterado.
 */
export function resolvePlanPrice(planId = 'pro'): SubscriptionPlanConfig {
  const normalizedId = (planId || 'pro').toLowerCase().trim();
  if (normalizedId !== 'pro' && normalizedId !== 'fatosbr_pro') {
    throw new Error(`PLAN_NOT_AVAILABLE: O plano '${planId}' não existe ou não está disponível para contratação.`);
  }
  return getProPlanConfig();
}

/**
 * Normaliza identificador de método de pagamento recebido da Cakto/webhooks.
 */
export function normalizePaymentMethod(rawMethod?: string | null): string {
  const normalized = String(rawMethod || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (normalized === 'cartao' || normalized === 'cartao_credito' || normalized === 'creditcard') {
    return 'credit_card';
  }
  if (normalized === 'pix_automatico' || normalized === 'pixautomatico' || normalized === 'automatic_pix' || normalized === 'pix_recurring') {
    return 'pix_auto';
  }
  return normalized || 'unknown';
}

export function isAllowedPaymentMethod(rawMethod?: string | null): boolean {
  const normalized = normalizePaymentMethod(rawMethod);
  return (ALLOWED_CAKTO_METHODS as readonly string[]).includes(normalized);
}

export function isProhibitedPaymentMethod(rawMethod?: string | null): boolean {
  const normalized = normalizePaymentMethod(rawMethod);
  if (isAllowedPaymentMethod(normalized)) return false;
  return normalized !== 'unknown' && (
    PROHIBITED_PAYMENT_METHODS.includes(normalized) ||
    !isAllowedPaymentMethod(normalized)
  );
}
