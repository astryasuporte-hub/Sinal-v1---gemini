/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — Resolvedor Central de Planos e Preços Controlado pelo Servidor
 * 
 * Princípios de Segurança Financeira:
 * 1. O cliente NUNCA determina o valor de uma assinatura (anti-tampering de preços).
 * 2. Valores, períodos e moedas são definidos exclusivamente no servidor.
 * 3. Qualquer valor enviado pelo navegador (body.amount, body.amountCents) é ignorado.
 */

export interface SubscriptionPlanConfig {
  id: string;
  name: string;
  amountCents: number; // Inteiro em centavos
  amountFormatted: string;
  currency: string;
  periodDays: number;
  isActive: boolean;
  description: string;
}

export const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlanConfig> = {
  pro: {
    id: 'pro',
    name: 'FatosBR Pro',
    amountCents: 2990, // R$ 29,90
    amountFormatted: 'R$ 29,90',
    currency: 'BRL',
    periodDays: 30,
    isActive: true,
    description: 'Assinatura FatosBR Pro - Acesso Executivo Mensal'
  },
  pro_annual: {
    id: 'pro_annual',
    name: 'FatosBR Pro Anual',
    amountCents: 29900, // R$ 299,00
    amountFormatted: 'R$ 299,00',
    currency: 'BRL',
    periodDays: 365,
    isActive: true,
    description: 'Assinatura FatosBR Pro - Acesso Executivo Anual'
  }
};

/**
 * Resolve a configuração canônica do plano a partir do identificador solicitado.
 * Lança exceção caso o plano não exista ou esteja inativo.
 */
export function resolvePlanPrice(planId = 'pro'): SubscriptionPlanConfig {
  const normalizedId = (planId || 'pro').toLowerCase().trim();
  const plan = SUBSCRIPTION_PLANS[normalizedId];

  if (!plan || !plan.isActive) {
    throw new Error(`PLAN_NOT_AVAILABLE: O plano '${planId}' não existe ou não está disponível para contratação.`);
  }

  return plan;
}
