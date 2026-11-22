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

export function getPaymentProvider(providerId?: PaymentProviderId | string): PaymentProvider {
  const normalized = String(providerId || getActivePaymentProviderId()).trim().toLowerCase();
  if (normalized === 'sharpify') return providers.sharpify;
  if (normalized === 'cakto') return providers.cakto;
  throw new Error(`UNSUPPORTED_PAYMENT_PROVIDER: Provedor '${providerId}' não suportado.`);
}

export { CaktoPaymentProvider, SharpifyPaymentProvider };
