/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Server-Side Database & Financial Persistence Layer (Supabase PostgreSQL)
 * 
 * Diretrizes de Compatibilidade com o Schema Real:
 * 1. ZERO fallback em memória em produção: Todas as transações financeiras são persistidas.
 * 2. Suporte estrito ao schema existente no Supabase:
 *    - internal.billing_payments (id UUID, provider_payment_id TEXT, amount INTEGER)
 *    - internal.billing_events (id UUID, provider_event_id TEXT, payload JSONB, processed BOOLEAN)
 *    - public.subscriptions (id UUID, user_id UUID, plan TEXT, status TEXT) — FONTE CANÔNICA PRO
 * 3. Uso estrito de SUPABASE_SERVICE_ROLE_KEY no backend para contornar RLS de forma autenticada.
 * 4. Atomicidade obrigatória: Confirmação de pagamento e ativação de plano ocorrem via RPC transacional no Postgres.
 * 5. Isolamento estrito de testes: Mocks só podem ser injetados se FATOSBR_TEST_MODE='true' ou NODE_ENV='test'.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let serverSupabaseClient: SupabaseClient | null = null;

if (supabaseUrl && serviceRoleKey) {
  try {
    serverSupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  } catch (err: any) {
    console.error('[Database Initialization Error]', err.message);
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(serverSupabaseClient && supabaseUrl && serviceRoleKey);
}

export function getServerSupabase(): SupabaseClient {
  if (!serverSupabaseClient) {
    throw new Error('DATABASE_UNAVAILABLE: O banco de dados Supabase não está configurado ou SUPABASE_SERVICE_ROLE_KEY está ausente no ambiente.');
  }
  return serverSupabaseClient;
}

// -----------------------------------------------------------------------------
// ADAPTADOR ISOLADO DE TESTE (Permitido EXCLUSIVAMENTE em ambiente de teste/harness)
// -----------------------------------------------------------------------------
export interface TestDatabaseAdapter {
  recordPendingCharge: (charge: any) => Promise<boolean>;
  getChargeById: (chargeId: string) => Promise<any | null>;
  checkAndLockWebhookEvent: (eventId: string, provider: string) => Promise<{ isDuplicate: boolean }>;
  confirmPaymentAndActivateSubscription: (params: any) => Promise<{ success: boolean; duplicate?: boolean; error?: string; error_code?: string; chargeId?: string }>;
}

let activeTestAdapter: TestDatabaseAdapter | null = null;

export function setTestDatabaseAdapter(adapter: TestDatabaseAdapter | null): void {
  const isTestEnv = process.env.NODE_ENV === 'test' || process.env.FATOSBR_TEST_MODE === 'true';
  if (!isTestEnv && adapter !== null) {
    throw new Error('SECURITY_VIOLATION: Adaptador de teste não pode ser ativado em ambiente de produção.');
  }
  activeTestAdapter = adapter;
}

// -----------------------------------------------------------------------------
// OPERAÇÕES FINANCEIRAS PERSISTENTES
// -----------------------------------------------------------------------------

export interface StoredCharge {
  id: string; // UUID em internal.billing_payments
  providerPaymentId: string; // ID externo do provedor (ex: zyn_...)
  userEmail?: string;
  userId?: string | null;
  amount: number; // Inteiro em centavos na coluna amount
  amountCents: number; // Alias de compatibilidade
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  description: string;
  qrCodeText?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  paidAt?: string | null; // Alias de compatibilidade
}

/**
 * Cria ou registra uma cobrança Pix pendente na tabela real internal.billing_payments.
 * Mapeia identificador externo para provider_payment_id e valor em centavos para a coluna amount.
 */
export async function recordPendingCharge(charge: {
  id?: string;
  providerPaymentId?: string;
  userEmail?: string;
  userId?: string | null;
  amount?: number;
  amountCents?: number;
  currency?: string;
  description: string;
  qrCodeText?: string;
}): Promise<boolean> {
  if (activeTestAdapter) {
    return activeTestAdapter.recordPendingCharge(charge);
  }

  const supabase = getServerSupabase();
  const now = new Date().toISOString();
  const providerPaymentId = charge.providerPaymentId || charge.id || `zyn_${Date.now()}`;
  const amount = charge.amount ?? charge.amountCents ?? 2990;

  const payload: any = {
    provider: 'zynpay',
    provider_payment_id: providerPaymentId,
    amount: Math.round(amount),
    currency: charge.currency || 'BRL',
    status: 'PENDING',
    type: 'PIX',
    checkout_data: {
      user_email: (charge.userEmail || '').toLowerCase().trim(),
      description: charge.description,
      qr_code_text: charge.qrCodeText || null
    },
    created_at: now,
    updated_at: now
  };

  if (charge.userId) {
    payload.user_id = charge.userId;
  }

  const { error } = await supabase
    .schema('internal')
    .from('billing_payments')
    .insert(payload);

  if (error) {
    console.error(`[DB Error] Falha crítica ao persistir cobrança ${providerPaymentId}:`, error.message);
    throw new Error(`DATABASE_PERSISTENCE_FAILED: Não foi possível registrar a cobrança no banco de dados (${error.message})`);
  }

  return true;
}

/**
 * Consulta cobrança no banco de dados por ID (UUID interno ou provider_payment_id).
 */
export async function getChargeById(chargeId: string): Promise<StoredCharge | null> {
  if (activeTestAdapter) {
    return activeTestAdapter.getChargeById(chargeId);
  }

  const supabase = getServerSupabase();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chargeId);

  let query = supabase.schema('internal').from('billing_payments').select('*');
  if (isUuid) {
    query = query.or(`id.eq.${chargeId},provider_payment_id.eq.${chargeId}`);
  } else {
    query = query.eq('provider_payment_id', chargeId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error(`[DB Error] Falha ao consultar cobrança ${chargeId}:`, error.message);
    throw new Error(`DATABASE_QUERY_FAILED: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const amount = Number(data.amount || 0);

  return {
    id: data.id,
    providerPaymentId: data.provider_payment_id || data.id,
    userId: data.user_id,
    userEmail: data.checkout_data?.user_email || '',
    amount,
    amountCents: amount,
    currency: data.currency || 'BRL',
    status: data.status,
    description: data.checkout_data?.description || 'Assinatura FatosBR Pro',
    qrCodeText: data.checkout_data?.qr_code_text,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    approvedAt: data.approved_at,
    paidAt: data.approved_at
  };
}

/**
 * Valida idempotência de evento de webhook inserindo registro inicial na tabela real internal.billing_events.
 */
export async function checkAndLockWebhookEvent(eventId: string, provider = 'zynpay'): Promise<{ isDuplicate: boolean }> {
  if (activeTestAdapter) {
    return activeTestAdapter.checkAndLockWebhookEvent(eventId, provider);
  }

  const supabase = getServerSupabase();
  const now = new Date().toISOString();

  // 1. Verifica se já existe evento marcado como processado
  const { data: existing, error: checkError } = await supabase
    .schema('internal')
    .from('billing_events')
    .select('id, processed')
    .eq('provider', provider)
    .eq('provider_event_id', eventId)
    .maybeSingle();

  if (!checkError && existing && existing.processed) {
    return { isDuplicate: true };
  }

  // 2. Insere registro de trava de evento em internal.billing_events
  const eventPayload = {
    provider,
    provider_event_id: eventId,
    event_type: 'charge.paid',
    payload: { registered_at: now },
    processed: false,
    created_at: now
  };

  const { error } = await supabase
    .schema('internal')
    .from('billing_events')
    .insert(eventPayload);

  if (error) {
    // 23505 = unique_violation no PostgreSQL
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate') || error.message?.toLowerCase().includes('unique')) {
      return { isDuplicate: true };
    }
    console.error(`[DB Error] Falha de idempotência no evento ${eventId}:`, error.message);
    throw new Error(`DATABASE_LOCK_FAILED: Falha na trava de idempotência (${error.message})`);
  }

  return { isDuplicate: false };
}

/**
 * Confirma pagamento e ativa assinatura Pro de forma ATÔMICA via RPC PostgreSQL no schema real.
 * Integra: internal.billing_payments, internal.billing_events e public.subscriptions.
 */
export async function confirmPaymentAndActivateSubscriptionAtomic(params: {
  chargeId: string;
  providerPaymentId?: string;
  eventId: string;
  expectedAmount?: number;
  expectedAmountCents?: number;
  expectedCurrency?: string;
  provider?: string;
  rawPayload?: any;
}): Promise<{
  success: boolean;
  duplicate?: boolean;
  error?: string;
  errorCode?: string;
  chargeId?: string;
  userEmail?: string;
}> {
  if (activeTestAdapter) {
    const res = await activeTestAdapter.confirmPaymentAndActivateSubscription(params);
    return {
      success: res.success,
      duplicate: res.duplicate,
      error: res.error,
      errorCode: res.error_code,
      chargeId: params.chargeId
    };
  }

  const supabase = getServerSupabase();
  const paymentId = params.providerPaymentId || params.chargeId;
  const amount = params.expectedAmount ?? params.expectedAmountCents ?? 2990;

  const { data, error } = await supabase.rpc('confirm_payment_and_activate_subscription_atomic', {
    p_provider_payment_id: paymentId,
    p_event_id: params.eventId,
    p_expected_amount: Math.round(amount),
    p_expected_currency: params.expectedCurrency || 'BRL',
    p_provider: params.provider || 'zynpay',
    p_raw_payload: params.rawPayload || {}
  });

  if (error) {
    console.error(`[DB Error] Falha na execução da transação atômica RPC:`, error.message);
    throw new Error(`ATOMIC_TRANSACTION_FAILED: ${error.message}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('ATOMIC_TRANSACTION_INVALID_RESPONSE: Resposta da RPC vazia ou malformada.');
  }

  return {
    success: Boolean(data.success),
    duplicate: Boolean(data.duplicate),
    error: data.error,
    errorCode: data.error_code,
    chargeId: data.charge_id || paymentId,
    userEmail: data.user_email
  };
}
