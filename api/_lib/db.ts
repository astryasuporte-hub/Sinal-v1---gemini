/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Server-Side Database & Financial Persistence Layer (FatosBR)
 * 
 * Arquitetura de Segurança e Conformidade:
 * 1. Conexão PostgreSQL direta e segura via módulo server-side centralizado (api/_lib/postgres.ts).
 * 2. ZERO fallback para a Supabase Data API (PostgREST) em operações financeiras e no schema 'internal'.
 * 3. Se a conexão PostgreSQL não estiver configurada, rejeita operações financeiras com erro controlado (fail-closed).
 * 4. Respeito estrito às constraints do schema real:
 *    - Chave primária UUID (gen_random_uuid())
 *    - Unicidade de provider_payment_id
 *    - Índice parcial billing_one_pending em internal.billing_payments:
 *      (reutilização de cobranças pendentes válidas e expiração controlada das anteriores)
 * 5. Atomicidade transacional e anti-tampering via RPC em public.confirm_payment_and_activate_subscription_atomic.
 * 6. Fonte canônica única de planos: public.subscriptions (sem billing_subscriptions).
 */

import { executeSql, isPostgresConfigured } from './postgres';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ZynPayOfficialChargeResponse } from './zynpayClient';

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

/**
 * Verifica se a conexão com banco de dados está disponível.
 * Para operações financeiras, isPostgresConfigured() é mandatório.
 */
export function isDatabaseConfigured(): boolean {
  return isPostgresConfigured();
}

let activeTestSupabaseClient: any = null;

export function setTestSupabaseClient(client: any): void {
  const isTestEnv = process.env.NODE_ENV === 'test' || process.env.FATOSBR_TEST_MODE === 'true';
  if (!isTestEnv && client !== null) {
    throw new Error('SECURITY_VIOLATION: Mock do cliente Supabase não pode ser ativado em produção.');
  }
  activeTestSupabaseClient = client;
}

/**
 * Retorna o cliente Supabase para uso exclusivo em Auth ou consultas públicas legítimas.
 * NUNCA utilizado como fallback para o schema privado internal.
 */
export function getServerSupabase(): SupabaseClient {
  if (activeTestSupabaseClient) {
    return activeTestSupabaseClient;
  }
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
  getActivePendingCharge?: (userId: string | null, email?: string) => Promise<any | null>;
  checkActiveSubscription?: (userId: string | null, email?: string) => Promise<boolean>;
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
  expirationDate?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  paidAt?: string | null; // Alias de compatibilidade
}

// -----------------------------------------------------------------------------
// REGRAS DE CONSTRAINTS & FLUXO PIX IDEMPOTENTE
// -----------------------------------------------------------------------------

/**
 * Verifica se o usuário já possui assinatura Pro ativa em public.subscriptions.
 */
export async function checkUserActiveSubscription(userId: string | null, userEmail?: string): Promise<boolean> {
  if (activeTestAdapter?.checkActiveSubscription) {
    return activeTestAdapter.checkActiveSubscription(userId, userEmail);
  }

  if (!isPostgresConfigured()) {
    throw new Error('POSTGRES_UNAVAILABLE: Verificação de assinatura exige conexão PostgreSQL configurada.');
  }

  try {
    if (userId) {
      const res = await executeSql(
        `SELECT id FROM public.subscriptions 
         WHERE user_id = $1 
           AND status = 'active'
           AND (current_period_end IS NULL OR current_period_end > NOW())
         LIMIT 1`,
        [userId]
      );
      if (res.rows.length > 0) return true;
    }

    if (userEmail) {
      const resEmail = await executeSql(
        `SELECT s.id FROM public.subscriptions s
         JOIN auth.users u ON u.id = s.user_id
         WHERE LOWER(TRIM(u.email)) = LOWER(TRIM($1)) 
           AND s.status = 'active'
           AND (s.current_period_end IS NULL OR s.current_period_end > NOW())
         LIMIT 1`,
        [userEmail]
      );
      if (resEmail.rows.length > 0) return true;
    }

    return false;
  } catch (err: any) {
    console.error('[Postgres Error] Falha ao checar assinatura ativa:', err.message);
    throw new Error(`DATABASE_QUERY_FAILED: ${err.message}`);
  }
}

/**
 * Consulta cobrança pendente existente do usuário para respeitar o índice parcial billing_one_pending.
 */
export async function getActivePendingChargeForUser(userId: string | null, userEmail?: string): Promise<StoredCharge | null> {
  if (activeTestAdapter?.getActivePendingCharge) {
    return activeTestAdapter.getActivePendingCharge(userId, userEmail);
  }

  if (!isPostgresConfigured()) {
    throw new Error('POSTGRES_UNAVAILABLE: Operações financeiras exigem conexão PostgreSQL configurada.');
  }

  try {
    let queryText = `
      SELECT 
        id,
        provider_payment_id,
        user_id,
        amount,
        currency,
        status,
        checkout_data,
        expiration_date,
        created_at,
        updated_at
      FROM internal.billing_payments
      WHERE status IN ('PENDING', 'PROCESSING')
        AND request_state <> 'FAILED'
    `;
    const params: any[] = [];

    if (userId) {
      params.push(userId);
      queryText += ` AND user_id = $${params.length}`;
    } else if (userEmail) {
      params.push(userEmail.toLowerCase().trim());
      queryText += ` AND LOWER(checkout_data->>'user_email') = $${params.length}`;
    } else {
      return null;
    }

    queryText += ` ORDER BY created_at DESC LIMIT 1`;

    const res = await executeSql(queryText, params);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    const amount = Number(row.amount || 0);

    return {
      id: row.id,
      providerPaymentId: row.provider_payment_id || row.id,
      userId: row.user_id,
      userEmail: row.checkout_data?.user_email || '',
      amount,
      amountCents: amount,
      currency: row.currency || 'BRL',
      status: row.status,
      description: row.checkout_data?.description || 'Assinatura FatosBR Pro',
      qrCodeText: row.checkout_data?.qr_code_text,
      expirationDate: row.expiration_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (err: any) {
    console.error('[Postgres Error] Falha ao consultar cobrança pendente do usuário:', err.message);
    throw new Error(`DATABASE_QUERY_FAILED: ${err.message}`);
  }
}

/**
 * Expira ou cancela uma cobrança pendente existente, liberando a constraint billing_one_pending.
 */
export async function cancelOrExpirePendingCharge(chargeId: string, reason = 'EXPIRED'): Promise<boolean> {
  if (!isPostgresConfigured()) {
    throw new Error('POSTGRES_UNAVAILABLE: Operação financeira exige conexão PostgreSQL configurada.');
  }

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chargeId);
    let queryText = `
      UPDATE internal.billing_payments
      SET status = $1,
          request_state = 'FAILED',
          cancelled_at = NOW(),
          updated_at = NOW()
      WHERE 
    `;
    if (isUuid) {
      queryText += ` (id = $2::uuid OR provider_payment_id = $2)`;
    } else {
      queryText += ` provider_payment_id = $2`;
    }
    queryText += ` AND status IN ('PENDING', 'PROCESSING')`;

    await executeSql(queryText, [reason, chargeId]);
    return true;
  } catch (err: any) {
    console.error(`[Postgres Error] Falha ao expirar cobrança ${chargeId}:`, err.message);
    return false;
  }
}

/**
 * Grava a cobrança oficial gerada pelo gateway ZynPay na tabela canônica internal.billing_payments.
 * Utiliza o provider_payment_id retornado pelo gateway oficial da ZynPay.
 */
export async function recordOfficialZynPayCharge(params: {
  userId: string;
  gatewayCharge: ZynPayOfficialChargeResponse;
  planId: string;
  userEmail: string;
  description: string;
}): Promise<StoredCharge> {
  if (activeTestAdapter) {
    await activeTestAdapter.recordPendingCharge({
      providerPaymentId: params.gatewayCharge.id,
      userId: params.userId,
      userEmail: params.userEmail,
      amountCents: params.gatewayCharge.amount,
      description: params.description,
      qrCodeText: params.gatewayCharge.qrCodeText
    });
    return {
      id: `uuid_${Date.now()}`,
      providerPaymentId: params.gatewayCharge.id,
      userId: params.userId,
      userEmail: params.userEmail,
      amount: params.gatewayCharge.amount,
      amountCents: params.gatewayCharge.amount,
      currency: params.gatewayCharge.currency || 'BRL',
      status: params.gatewayCharge.status || 'PENDING',
      description: params.description,
      qrCodeText: params.gatewayCharge.qrCodeText,
      expirationDate: params.gatewayCharge.expirationDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  if (!isPostgresConfigured()) {
    throw new Error('POSTGRES_UNAVAILABLE: Gravação da cobrança exige conexão PostgreSQL server-side configurada.');
  }

  const checkoutData = JSON.stringify({
    plan_id: params.planId,
    user_email: params.userEmail,
    description: params.description,
    qr_code_text: params.gatewayCharge.qrCodeText
  });

  try {
    const insertSql = `
      INSERT INTO internal.billing_payments (
        id,
        user_id,
        provider,
        provider_payment_id,
        amount,
        currency,
        status,
        type,
        request_state,
        expiration_date,
        checkout_data,
        last_synced_at,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        'zynpay',
        $2,
        $3,
        $4,
        $5,
        'PIX',
        'PENDING',
        $6,
        $7::jsonb,
        NOW(),
        NOW(),
        NOW()
      )
      RETURNING id, provider_payment_id, user_id, amount, currency, status, checkout_data, expiration_date, created_at, updated_at
    `;

    const res = await executeSql(insertSql, [
      params.userId,
      params.gatewayCharge.id,
      params.gatewayCharge.amount,
      params.gatewayCharge.currency || 'BRL',
      params.gatewayCharge.status || 'PENDING',
      params.gatewayCharge.expirationDate || null,
      checkoutData
    ]);

    const row = res.rows[0];
    return {
      id: row.id,
      providerPaymentId: row.provider_payment_id,
      userId: row.user_id,
      userEmail: row.checkout_data?.user_email || params.userEmail,
      amount: Number(row.amount || 0),
      amountCents: Number(row.amount || 0),
      currency: row.currency || 'BRL',
      status: row.status,
      description: row.checkout_data?.description || params.description,
      qrCodeText: row.checkout_data?.qr_code_text || params.gatewayCharge.qrCodeText,
      expirationDate: row.expiration_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (err: any) {
    if (err.code === '23505' || err.message?.includes('billing_one_pending') || err.message?.includes('provider_payment_id')) {
      console.warn('[Concurrency Handled] Conflito concorrente detectado, recuperando cobrança pendente existente.');
      const concurrent = await getActivePendingChargeForUser(params.userId, params.userEmail);
      if (concurrent) {
        return concurrent;
      }
    }
    console.error(`[Postgres Error] Falha ao gravar cobrança oficial ${params.gatewayCharge.id}:`, err.message);
    throw new Error(`DATABASE_PERSISTENCE_FAILED: Falha na gravação do pagamento via PostgreSQL (${err.message})`);
  }
}

/**
 * Cria ou Reutiliza uma Cobrança Pix com respeito integral ao índice parcial billing_one_pending
 * (Compatibilidade para rotinas internas e testes).
 */
export async function createOrReusePixCharge(params: {
  providerPaymentId?: string;
  userId?: string | null;
  userEmail?: string;
  amountCents: number;
  description: string;
  qrCodeText?: string;
}): Promise<{
  charge: StoredCharge;
  reused: boolean;
  alreadySubscribed?: boolean;
}> {
  if (activeTestAdapter) {
    if (activeTestAdapter.checkActiveSubscription) {
      const isSub = await activeTestAdapter.checkActiveSubscription(params.userId || null, params.userEmail);
      if (isSub) {
        return {
          charge: null as any,
          reused: false,
          alreadySubscribed: true
        };
      }
    }
    if (activeTestAdapter.getActivePendingCharge) {
      const existing = await activeTestAdapter.getActivePendingCharge(params.userId || null, params.userEmail);
      if (existing) {
        return {
          charge: existing,
          reused: true
        };
      }
    }
    try {
      await activeTestAdapter.recordPendingCharge(params);
    } catch (mockErr: any) {
      if (
        mockErr.code === '23505' ||
        mockErr.message?.includes('billing_one_pending') ||
        mockErr.message?.includes('provider_payment_id')
      ) {
        if (activeTestAdapter.getActivePendingCharge) {
          const concurrent = await activeTestAdapter.getActivePendingCharge(params.userId || null, params.userEmail);
          if (concurrent) {
            return { charge: concurrent, reused: true };
          }
        }
      }
      throw mockErr;
    }

    if (activeTestAdapter.getActivePendingCharge) {
      const saved = await activeTestAdapter.getActivePendingCharge(params.userId || null, params.userEmail);
      if (saved) {
        return { charge: saved, reused: false };
      }
    }

    const mockCharge: StoredCharge = {
      id: `uuid_${Date.now()}`,
      providerPaymentId: params.providerPaymentId || `zyn_${Date.now()}`,
      userId: params.userId || null,
      userEmail: params.userEmail || '',
      amount: params.amountCents,
      amountCents: params.amountCents,
      currency: 'BRL',
      status: 'PENDING',
      description: params.description,
      qrCodeText: params.qrCodeText,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return { charge: mockCharge, reused: false };
  }

  if (!isPostgresConfigured()) {
    throw new Error('POSTGRES_UNAVAILABLE: Operações financeiras exigem conexão PostgreSQL server-side configurada.');
  }

  const userId = params.userId || null;
  const userEmail = (params.userEmail || '').toLowerCase().trim();
  const amount = Math.round(params.amountCents);

  // 1. Checa se o usuário já é assinante ativo Pro
  if (userId || userEmail) {
    const isAlreadySubscribed = await checkUserActiveSubscription(userId, userEmail);
    if (isAlreadySubscribed) {
      return {
        charge: null as any,
        reused: false,
        alreadySubscribed: true
      };
    }
  }

  // 2. Checa cobrança pendente existente (respeito a billing_one_pending)
  const existingPending = await getActivePendingChargeForUser(userId, userEmail);
  if (existingPending) {
    const ageMs = Date.now() - new Date(existingPending.createdAt).getTime();
    const fifteenMinutesMs = 15 * 60 * 1000;

    // Se ainda está dentro do período de validade do Pix (15 min) e tem o mesmo valor, reutiliza
    if (ageMs < fifteenMinutesMs && existingPending.amountCents === amount) {
      return {
        charge: existingPending,
        reused: true
      };
    }

    // Se expirou ou o valor é diferente, cancela a cobrança anterior no banco para liberar o índice
    await cancelOrExpirePendingCharge(existingPending.id, 'EXPIRED');
  }

  // 3. Criação de nova cobrança
  const providerPaymentId = params.providerPaymentId || `zyn_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const checkoutData = JSON.stringify({
    user_email: userEmail,
    description: params.description,
    qr_code_text: params.qrCodeText || null
  });

  try {
    const insertQuery = `
      INSERT INTO internal.billing_payments (
        id,
        user_id,
        provider,
        provider_payment_id,
        amount,
        currency,
        status,
        type,
        request_state,
        checkout_data,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        'zynpay',
        $2,
        $3,
        'BRL',
        'PENDING',
        'PIX',
        'PENDING',
        $4::jsonb,
        NOW(),
        NOW()
      )
      RETURNING id, provider_payment_id, user_id, amount, currency, status, checkout_data, created_at, updated_at
    `;

    const res = await executeSql(insertQuery, [
      userId,
      providerPaymentId,
      amount,
      checkoutData
    ]);

    const row = res.rows[0];
    const newCharge: StoredCharge = {
      id: row.id,
      providerPaymentId: row.provider_payment_id,
      userId: row.user_id,
      userEmail: row.checkout_data?.user_email || userEmail,
      amount: Number(row.amount || 0),
      amountCents: Number(row.amount || 0),
      currency: row.currency || 'BRL',
      status: row.status,
      description: row.checkout_data?.description || params.description,
      qrCodeText: row.checkout_data?.qr_code_text || params.qrCodeText,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    return { charge: newCharge, reused: false };
  } catch (err: any) {
    if (
      err.code === '23505' ||
      err.message?.includes('billing_one_pending') ||
      err.message?.includes('provider_payment_id')
    ) {
      console.warn('[Concurrency Handled] Conflito concorrente detectado, recuperando cobrança pendente existente.');
      const concurrentCharge = await getActivePendingChargeForUser(userId, userEmail);
      if (concurrentCharge) {
        return { charge: concurrentCharge, reused: true };
      }
    }

    console.error(`[Postgres Error] Falha ao registrar cobrança ${providerPaymentId}:`, err.message);
    throw new Error(`DATABASE_PERSISTENCE_FAILED: Falha na gravação do pagamento via PostgreSQL (${err.message})`);
  }
}

/**
 * Função de conveniência retrocompatível para registrar cobrança pendente.
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

  const amountCents = Math.round(charge.amountCents ?? (charge.amount ? charge.amount * 100 : 2990));
  await createOrReusePixCharge({
    providerPaymentId: charge.providerPaymentId || charge.id,
    userId: charge.userId,
    userEmail: charge.userEmail,
    amountCents,
    description: charge.description,
    qrCodeText: charge.qrCodeText
  });
  return true;
}

/**
 * Consulta cobrança no banco de dados por ID (UUID interno ou provider_payment_id).
 * Exclusivamente via PostgreSQL server-side sem fallback silencioso para schema privado.
 */
export async function getChargeById(chargeId: string): Promise<StoredCharge | null> {
  if (activeTestAdapter) {
    return activeTestAdapter.getChargeById(chargeId);
  }

  if (!isPostgresConfigured()) {
    throw new Error('POSTGRES_UNAVAILABLE: Operações financeiras exigem conexão PostgreSQL configurada.');
  }

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
        expiration_date,
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
      expirationDate: data.expiration_date,
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

/**
 * Valida idempotência de evento de webhook inserindo registro inicial na tabela real internal.billing_events.
 * Exclusivamente via PostgreSQL server-side.
 */
export async function checkAndLockWebhookEvent(eventId: string, provider = 'zynpay'): Promise<{ isDuplicate: boolean }> {
  if (activeTestAdapter) {
    return activeTestAdapter.checkAndLockWebhookEvent(eventId, provider);
  }

  if (!isPostgresConfigured()) {
    throw new Error('POSTGRES_UNAVAILABLE: Operações financeiras exigem conexão PostgreSQL configurada.');
  }

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
         id, provider, provider_event_id, event_type, payload, processed, created_at
       ) VALUES (gen_random_uuid(), $1, $2, 'charge.paid', '{"registered":true}'::jsonb, false, NOW())
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

/**
 * Confirma pagamento e ativa assinatura Pro de forma ATÔMICA via RPC PostgreSQL no schema real.
 * Invoca public.confirm_payment_and_activate_subscription_atomic por conexão server-side autorizada.
 * ZERO fallback para Data API.
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

  if (!isPostgresConfigured()) {
    throw new Error('POSTGRES_UNAVAILABLE: Confirmação financeira exige conexão PostgreSQL server-side configurada.');
  }

  const paymentId = params.providerPaymentId || params.chargeId;
  const amount = Math.round(params.expectedAmount ?? params.expectedAmountCents ?? 2990);
  const currency = params.expectedCurrency || 'BRL';
  const provider = params.provider || 'zynpay';
  const rawPayload = JSON.stringify(params.rawPayload || {});

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
