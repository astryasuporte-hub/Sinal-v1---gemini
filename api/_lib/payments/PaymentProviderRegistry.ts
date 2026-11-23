/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PaymentProviderRegistry — Seleção de provedor ativo controlada por configuração de servidor.
 */

import { CaktoPaymentProvider, caktoPaymentProvider } from './CaktoPaymentProvider.js';
import { SharpifyPaymentProvider } from './SharpifyPaymentProvider.js';
import type { PaymentProvider } from './PaymentProvider.js';
import type { PaymentProviderId } from './types.js';

const sharpifyProvider = new SharpifyPaymentProvider();

const providers: Record<PaymentProviderId, PaymentProvider> = {
  cakto: caktoPaymentProvider,
  sharpify: sharpifyProvider,
};

export function getActivePaymentProviderId(): PaymentProviderId {
  const configured = String(process.env.PAYMENTS_ACTIVE_PROVIDER || 'cakto').trim().toLowerCase();
  if (configured === 'sharpify') return 'sharpify';
  return 'cakto';
}

let testProviderOverride: PaymentProvider | null = null;

export function setPaymentProviderForTest(provider: PaymentProvider | null): void {
  const isTestEnv = process.env.NODE_ENV === 'test' || process.env.FATOSBR_TEST_MODE === 'true';
  if (!isTestEnv && provider !== null) {
    throw new Error('SECURITY_VIOLATION: Override de provedor permitido apenas em ambiente de teste.');
  }
  testProviderOverride = provider;
}

export function getPaymentProvider(providerId?: PaymentProviderId | string): PaymentProvider {
  if (testProviderOverride) return testProviderOverride;
  const normalized = String(providerId || getActivePaymentProviderId()).trim().toLowerCase();
  if (normalized === 'sharpify') return providers.sharpify;
  if (normalized === 'cakto') return providers.cakto;
  throw new Error(`UNSUPPORTED_PAYMENT_PROVIDER: Provedor '${providerId}' não suportado.`);
}

export { CaktoPaymentProvider, SharpifyPaymentProvider };
