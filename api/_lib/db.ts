/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Server-Side Database & Financial Persistence Layer (FatosBR)
 * 
 * Arquitetura de Segurança:
 * 1. Conexão PostgreSQL direta e segura via módulo server-side centralizado (api/_lib/postgres.ts).
 * 2. ZERO exposição do schema 'internal' na Supabase Data API do PostgREST.
 * 3. Operações com SQL parametrizado ($1, $2...) e liberação estrita de conexões no pool.
 * 4. Atomicidade transacional no Postgres: Confirmação de pagamento e ativação Pro via RPC server-side autorizada.
 * 5. Tabelas canônicas:
 *    - internal.billing_payments (id UUID, provider_payment_id TEXT, amount INTEGER)
 *    - internal.billing_events (id UUID, provider_event_id TEXT, payload JSONB, processed BOOLEAN)
 *    - public.subscriptions (id UUID, user_id UUID, plan TEXT, status TEXT) — FONTE CANÔNICA PRO
 */

import { executeSql, isPostgresConfigured } from './postgres';
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
    console.error('[Supabase Client Error]', err.message);
  }
}

export function isDatabaseConfigured(): boolean {
  return isPostgresConfigured() || Boolean(serverSupabaseClient && supabaseUrl && serviceRoleKey);
}

export function getServerSupabase(): SupabaseClient {
  if (!serverSupabaseClient) {
    throw new Error('SUPABASE_UNAVAILABLE: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente.');
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
  confirmPaymentAndActivateSubscription: (params: any) => Promise<{
    success: boolean;
    duplicate?: boolean;
    error?: string;
    error_code?: string;
    chargeId?: string;
  }>;
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
// CONTRATOS DE DADOS
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

// -----------------------------------------------------------------------------
// OPERAÇÕES FINANCEIRAS PERSISTENTES VIA POSTGRESQL SERVER-SIDE
// -----------------------------------------------------------------------------

/**
 * Cria ou registra uma cobrança Pix pendente na tabela real internal.billing_payments.
 * Utiliza conexão PostgreSQL direta parametrizada sem expor o schema internal via Data API.
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

  const providerPaymentId = charge.providerPaymentId || charge.id || `zyn_${Date.now()}`;
  const amount = Math.round(charge.amount ?? charge.amountCents ?? 2990);
  const currency = charge.currency || 'BRL';
  const checkoutData = JSON.stringify({
    user_email: (charge.userEmail || '').toLowerCase().trim(),
    description: charge.description,
    qr_code_text: charge.qrCodeText || null
  });

  // 1. Conexão direta PostgreSQL (Recomendada em Produção Vercel)
  if (isPostgresConfigured()) {
    try {
      const queryText = `
        INSERT INTO internal.billing_payments (
          user_id,
          provider,
          provider_payment_id,
          amount,
          currency,
          status,
          type,
          checkout_data,
          created_at,
          updated_at
        ) VALUES ($1, 'zynpay', $2, $3, $4, 'PENDING', 'PIX', $5::jsonb, NOW(), NOW())
      `;
      await executeSql(queryText, [
        charge.userId || null,
        providerPaymentId,
        amount,
        currency,
        checkoutData
      ]);
      return true;
    } catch (pgErr: any) {
      console.error(`[Postgres Error] Falha ao registrar cobrança ${providerPaymentId}:`, pgErr.message);
      throw new Error(`DATABASE_PERSISTENCE_FAILED: Falha na gravação do pagamento via PostgreSQL (${pgErr.message})`);
    }
  }

  // 2. Fallback via cliente Supabase se disponível em ambiente de desenvolvimento
  if (serverSupabaseClient) {
    const payload: any = {
      user_id: charge.userId || null,
      provider: 'zynpay',
      provider_payment_id: providerPaymentId,
      amount,
      currency,
      status: 'PENDING',
      type: 'PIX',
      checkout_data: JSON.parse(checkoutData),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const { error } = await serverSupabaseClient.schema('internal').from('billing_payments').insert(payload);
    if (error) {
      console.error(`[DB Error] Falha ao persistir cobrança ${providerPaymentId}:`, error.message);
      throw new Error(`DATABASE_PERSISTENCE_FAILED: ${error.message}`);
    }
    return true;
  }

  throw new Error('DATABASE_PERSISTENCE_FAILED: Nenhuma conexão PostgreSQL ou Supabase configurada no backend.');
}

/**
 * Consulta cobrança no banco de dados por ID (UUID interno ou provider_payment_id).
 */
export async function getChargeById(chargeId: string): Promise<StoredCharge | null> {
  if (activeTestAdapter) {
    return activeTestAdapter.getChargeById(chargeId);
  }

  // 1. Consulta direta via PostgreSQL
  if (isPostgresConfigured()) {
    try {
      const queryText = `
        SELECT 
          id,
          provider_payment_id,
          user_id,
          amount,
          currency,
          status,
          checkout_data,
          approved_at,
          created_at,
          updated_at
        FROM internal.billing_payments
        WHERE provider_payment_id = $1
           OR (CASE WHEN $1 ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN id = $1::uuid ELSE false END)
        LIMIT 1
      `;
      const res = await executeSql(queryText, [chargeId]);
      if (res.rows.length === 0) {
        return null;
      }
      const data = res.rows[0];
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
    } catch (err: any) {
      console.error(`[Postgres Error] Falha ao consultar cobrança ${chargeId}:`, err.message);
      throw new Error(`DATABASE_QUERY_FAILED: ${err.message}`);
    }
  }

  // 2. Fallback via cliente Supabase
  if (serverSupabaseClient) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chargeId);
    let query = serverSupabaseClient.schema('internal').from('billing_payments').select('*');
    if (isUuid) {
      query = query.or(`id.eq.${chargeId},provider_payment_id.eq.${chargeId}`);
    } else {
      query = query.eq('provider_payment_id', chargeId);
    }
    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`DATABASE_QUERY_FAILED: ${error.message}`);
    }
    if (!data) return null;
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

  throw new Error('DATABASE_QUERY_FAILED: Banco de dados indisponível.');
}

/**
 * Valida idempotência de evento de webhook inserindo registro inicial na tabela real internal.billing_events.
 */
export async function checkAndLockWebhookEvent(eventId: string, provider = 'zynpay'): Promise<{ isDuplicate: boolean }> {
  if (activeTestAdapter) {
    return activeTestAdapter.checkAndLockWebhookEvent(eventId, provider);
  }

  if (isPostgresConfigured()) {
    try {
      // 1. Verifica se já existe e foi processado
      const checkRes = await executeSql(
        `SELECT processed FROM internal.billing_events WHERE provider = $1 AND provider_event_id = $2 LIMIT 1`,
        [provider, eventId]
      );
      if (checkRes.rows.length > 0 && checkRes.rows[0].processed) {
        return { isDuplicate: true };
      }

      // 2. Insere registro de trava de evento
      await executeSql(
        `INSERT INTO internal.billing_events (
           provider, provider_event_id, event_type, payload, processed, created_at
         ) VALUES ($1, $2, 'charge.paid', '{"registered":true}'::jsonb, false, NOW())
         ON CONFLICT (provider, provider_event_id) DO NOTHING`,
        [provider, eventId]
      );
      return { isDuplicate: false };
    } catch (err: any) {
      if (err.code === '23505' || err.message?.toLowerCase().includes('duplicate') || err.message?.toLowerCase().includes('unique')) {
        return { isDuplicate: true };
      }
      console.error(`[Postgres Error] Falha de idempotência no evento ${eventId}:`, err.message);
      throw new Error(`DATABASE_LOCK_FAILED: ${err.message}`);
    }
  }

  // Fallback via Supabase
  if (serverSupabaseClient) {
    const { data: existing } = await serverSupabaseClient
      .schema('internal')
      .from('billing_events')
      .select('id, processed')
      .eq('provider', provider)
      .eq('provider_event_id', eventId)
      .maybeSingle();

    if (existing && existing.processed) {
      return { isDuplicate: true };
    }

    const { error } = await serverSupabaseClient
      .schema('internal')
      .from('billing_events')
      .insert({
        provider,
        provider_event_id: eventId,
        event_type: 'charge.paid',
        payload: { registered_at: new Date().toISOString() },
        processed: false,
        created_at: new Date().toISOString()
      });

    if (error) {
      if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate') || error.message?.toLowerCase().includes('unique')) {
        return { isDuplicate: true };
      }
      throw new Error(`DATABASE_LOCK_FAILED: ${error.message}`);
    }
    return { isDuplicate: false };
  }

  throw new Error('DATABASE_LOCK_FAILED: Banco de dados indisponível.');
}

/**
 * Confirma pagamento e ativa assinatura Pro de forma ATÔMICA via RPC PostgreSQL no schema real.
 * Invoca public.confirm_payment_and_activate_subscription_atomic por conexão server-side autorizada.
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

  const paymentId = params.providerPaymentId || params.chargeId;
  const amount = Math.round(params.expectedAmount ?? params.expectedAmountCents ?? 2990);
  const currency = params.expectedCurrency || 'BRL';
  const provider = params.provider || 'zynpay';
  const rawPayload = JSON.stringify(params.rawPayload || {});

  // 1. Execução via conexão direta PostgreSQL (Recomendada server-side)
  if (isPostgresConfigured()) {
    try {
      const queryText = `
        SELECT public.confirm_payment_and_activate_subscription_atomic(
          $1, $2, $3, $4, $5, $6::jsonb
        ) AS outcome
      `;
      const res = await executeSql(queryText, [paymentId, params.eventId, amount, currency, provider, rawPayload]);
      const data = res.rows[0]?.outcome;

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
    } catch (err: any) {
      console.error('[Postgres Error] Falha na execução da transação atômica RPC:', err.message);
      throw new Error(`ATOMIC_TRANSACTION_FAILED: ${err.message}`);
    }
  }

  // 2. Fallback via RPC Supabase
  if (serverSupabaseClient) {
    const { data, error } = await serverSupabaseClient.rpc('confirm_payment_and_activate_subscription_atomic', {
      p_provider_payment_id: paymentId,
      p_event_id: params.eventId,
      p_expected_amount: amount,
      p_expected_currency: currency,
      p_provider: provider,
      p_raw_payload: params.rawPayload || {}
    });

    if (error) {
      console.error('[Supabase RPC Error] Falha na transação atômica:', error.message);
      throw new Error(`ATOMIC_TRANSACTION_FAILED: ${error.message}`);
    }

    if (!data || typeof data !== 'object') {
      throw new Error('ATOMIC_TRANSACTION_INVALID_RESPONSE: Resposta da RPC vazia.');
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

  throw new Error('ATOMIC_TRANSACTION_FAILED: Nenhuma conexão com banco de dados disponível.');
}
