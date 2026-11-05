/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Server-Side Database & Financial Persistence Layer (Supabase PostgreSQL)
 * 
 * Diretrizes de Segurança:
 * 1. ZERO fallback em memória em produção: Todas as transações financeiras devem ser persistidas.
 * 2. Suporte nativo ao schema "internal" existente no Supabase:
 *    - internal.billing_payments
 *    - internal.billing_events
 *    - internal.billing_subscriptions
 *    Com fallback transparente para public.payments/public.webhook_events caso aplicável.
 * 3. Uso estrito de SUPABASE_SERVICE_ROLE_KEY no backend para contornar RLS de forma autenticada.
 *    NUNCA utilizar a chave pública anon como substituta silenciosa de operações privilegiadas.
 * 4. Atomicidade obrigatória: Confirmação de pagamento e ativação de plano ocorrem via RPC transacional no Postgres.
 * 5. Isolamento estrito de testes: Mocks só podem ser injetados se FATOSBR_TEST_MODE='true' ou NODE_ENV='test'.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
// Exclusivamente chave de serviço com privilégios de backend
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
  confirmPaymentAndActivateSubscription: (params: any) => Promise<{ success: boolean; duplicate?: boolean; error?: string; error_code?: string }>;
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
  id: string;
  userEmail: string;
  userId?: string | null;
  amountCents: number;
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  description: string;
  qrCodeText?: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string | null;
}

/**
 * Cria ou registra uma cobrança Pix pendente no Supabase PostgreSQL.
 * Insere primariamente em internal.billing_payments (ou public.payments como fallback).
 * Falhas no banco de dados lançam exceção e impedem retorno de falso-positivo.
 */
export async function recordPendingCharge(charge: {
  id: string;
  userEmail: string;
  userId?: string | null;
  amountCents: number;
  description: string;
  qrCodeText?: string;
}): Promise<boolean> {
  if (activeTestAdapter) {
    return activeTestAdapter.recordPendingCharge(charge);
  }

  const supabase = getServerSupabase();
  const now = new Date().toISOString();
  const payload = {
    id: charge.id,
    user_id: charge.userId || null,
    user_email: charge.userEmail.toLowerCase().trim(),
    amount_cents: charge.amountCents,
    currency: 'BRL',
    status: 'PENDING',
    provider: 'zynpay',
    description: charge.description,
    qr_code_text: charge.qrCodeText || null,
    created_at: now,
    updated_at: now
  };

  // 1. Tenta inserir em internal.billing_payments
  try {
    const { error: internalErr } = await supabase.schema('internal').from('billing_payments').insert(payload);
    if (!internalErr) {
      return true;
    }
  } catch {}

  // 2. Fallback para public.payments
  const { error } = await supabase.from('payments').insert(payload);

  if (error) {
    console.error(`[DB Error] Falha crítica ao persistir cobrança ${charge.id}:`, error.message);
    throw new Error(`DATABASE_PERSISTENCE_FAILED: Não foi possível registrar a cobrança no banco de dados (${error.message})`);
  }

  return true;
}

/**
 * Consulta cobrança no banco de dados por ID.
 */
export async function getChargeById(chargeId: string): Promise<StoredCharge | null> {
  if (activeTestAdapter) {
    return activeTestAdapter.getChargeById(chargeId);
  }

  const supabase = getServerSupabase();

  // 1. Tenta consultar internal.billing_payments
  try {
    const { data: internalData, error: internalErr } = await supabase
      .schema('internal')
      .from('billing_payments')
      .select('*')
      .eq('id', chargeId)
      .maybeSingle();

    if (!internalErr && internalData) {
      return {
        id: internalData.id,
        userId: internalData.user_id,
        userEmail: internalData.user_email,
        amountCents: internalData.amount_cents,
        currency: internalData.currency || 'BRL',
        status: internalData.status,
        description: internalData.description || 'Assinatura FatosBR Pro',
        qrCodeText: internalData.qr_code_text,
        createdAt: internalData.created_at,
        updatedAt: internalData.updated_at,
        paidAt: internalData.paid_at
      };
    }
  } catch {}

  // 2. Fallback para public.payments
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('id', chargeId)
    .maybeSingle();

  if (error) {
    console.error(`[DB Error] Erro ao consultar cobrança ${chargeId}:`, error.message);
    throw new Error(`DATABASE_QUERY_FAILED: Falha ao consultar cobrança (${error.message})`);
  }

  if (!data) return null;

  return {
    id: data.id,
    userId: data.user_id,
    userEmail: data.user_email,
    amountCents: data.amount_cents,
    currency: data.currency || 'BRL',
    status: data.status,
    description: data.description || 'Assinatura FatosBR Pro',
    qrCodeText: data.qr_code_text,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    paidAt: data.paid_at
  };
}

/**
 * Valida idempotência de evento de webhook inserindo registro inicial na tabela webhook_events / billing_events.
 */
export async function checkAndLockWebhookEvent(eventId: string, provider = 'zynpay'): Promise<{ isDuplicate: boolean }> {
  if (activeTestAdapter) {
    return activeTestAdapter.checkAndLockWebhookEvent(eventId, provider);
  }

  const supabase = getServerSupabase();
  const now = new Date().toISOString();
  const eventPayload = {
    id: eventId,
    provider,
    event_type: 'charge.paid',
    status: 'PROCESSING',
    created_at: now,
    processed_at: now
  };

  // 1. Tenta inserir em internal.billing_events
  try {
    const { error: internalErr } = await supabase.schema('internal').from('billing_events').insert(eventPayload);
    if (!internalErr) {
      return { isDuplicate: false };
    }
    if (internalErr.code === '23505' || internalErr.message?.toLowerCase().includes('duplicate')) {
      return { isDuplicate: true };
    }
  } catch {}

  // 2. Fallback para public.webhook_events
  const { error } = await supabase.from('webhook_events').insert(eventPayload);

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
 * Confirma pagamento e ativa assinatura Pro de forma ATÔMICA via RPC PostgreSQL
 * Executa as 12 validações de negócio em uma única transação garantida pelo banco.
 */
export async function confirmPaymentAndActivateSubscriptionAtomic(params: {
  chargeId: string;
  eventId: string;
  expectedAmountCents: number;
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

  const { data, error } = await supabase.rpc('confirm_payment_and_activate_subscription_atomic', {
    p_charge_id: params.chargeId,
    p_event_id: params.eventId,
    p_expected_amount_cents: params.expectedAmountCents,
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
    chargeId: data.charge_id || params.chargeId,
    userEmail: data.user_email
  };
}
