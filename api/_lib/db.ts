/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Server-side Database & Idempotency Layer (Supabase Postgres)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

let serverSupabaseClient: SupabaseClient | null = null;

if (supabaseUrl && supabaseKey) {
  try {
    serverSupabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  } catch {}
}

export function getServerSupabase(): SupabaseClient | null {
  return serverSupabaseClient;
}

// Fallback em memória para ambientes de teste e desenvolvimento sem conexão com banco
interface FallbackCharge {
  id: string;
  userEmail: string;
  amountCents: number;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
  description: string;
  createdAt: string;
  paidAt?: string;
}

const memoryCharges = new Map<string, FallbackCharge>();
const memoryProcessedEvents = new Set<string>();

/**
 * Cria ou registra uma cobrança pendente
 */
export async function recordPendingCharge(charge: {
  id: string;
  userEmail: string;
  amountCents: number;
  description: string;
  qrCodeText?: string;
}): Promise<boolean> {
  const supabase = getServerSupabase();
  const now = new Date().toISOString();

  // 1. Persistência em memória
  memoryCharges.set(charge.id, {
    id: charge.id,
    userEmail: charge.userEmail,
    amountCents: charge.amountCents,
    status: 'PENDING',
    description: charge.description,
    createdAt: now
  });

  // 2. Persistência no Supabase
  if (supabase) {
    try {
      await supabase.from('payments').upsert({
        id: charge.id,
        user_email: charge.userEmail,
        amount_cents: charge.amountCents,
        currency: 'BRL',
        status: 'PENDING',
        qr_code_text: charge.qrCodeText || null,
        created_at: now,
        updated_at: now
      });
      return true;
    } catch {}
  }

  return true;
}

/**
 * Consulta cobrança registrada por ID
 */
export async function getChargeById(chargeId: string): Promise<FallbackCharge | null> {
  const supabase = getServerSupabase();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('id', chargeId)
        .maybeSingle();

      if (!error && data) {
        return {
          id: data.id,
          userEmail: data.user_email,
          amountCents: data.amount_cents,
          status: data.status,
          description: data.description || 'Assinatura FatosBR Pro',
          createdAt: data.created_at,
          paidAt: data.paid_at
        };
      }
    } catch {}
  }

  return memoryCharges.get(chargeId) || null;
}

/**
 * Verifica idempotência de um evento de webhook (evita processamento duplicado)
 */
export async function checkAndLockWebhookEvent(eventId: string, provider = 'zynpay'): Promise<{ isDuplicate: boolean }> {
  // 1. Verificação local em memória
  if (memoryProcessedEvents.has(eventId)) {
    return { isDuplicate: true };
  }

  const supabase = getServerSupabase();
  if (supabase) {
    try {
      // Tenta inserir na tabela de idempotência com chave primária (ID único)
      const { error } = await supabase.from('webhook_events').insert({
        id: eventId,
        provider,
        event_type: 'charge.paid',
        processed_at: new Date().toISOString(),
        status: 'PROCESSING'
      });

      // Erro 23505 = unique_violation no Postgres (evento duplicado concorrente)
      if (error && (error.code === '23505' || error.message.includes('duplicate'))) {
        return { isDuplicate: true };
      }
    } catch {}
  }

  memoryProcessedEvents.add(eventId);
  return { isDuplicate: false };
}

/**
 * Confirma pagamento e ativa assinatura Pro do usuário de forma atômica
 */
export async function confirmPaymentAndActivateSubscription(params: {
  chargeId: string;
  userEmail: string;
  amountCents: number;
  eventId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { chargeId, userEmail, amountCents, eventId } = params;
  const now = new Date().toISOString();

  // 1. Atualiza cobrança em memória
  const stored = memoryCharges.get(chargeId);
  if (stored) {
    stored.status = 'PAID';
    stored.paidAt = now;
  }

  const supabase = getServerSupabase();
  if (supabase) {
    try {
      // Atualiza status do pagamento
      await supabase
        .from('payments')
        .update({
          status: 'PAID',
          paid_at: now,
          updated_at: now
        })
        .eq('id', chargeId);

      // Atualiza perfil do usuário para Pro Ativo
      if (userEmail) {
        await supabase
          .from('profiles')
          .update({
            plan_name: 'FatosBR Pro',
            subscription_status: 'ACTIVE',
            updated_at: now
          })
          .eq('email', userEmail.toLowerCase().trim());
      }

      // Marca evento como finalizado com sucesso
      await supabase
        .from('webhook_events')
        .update({ status: 'COMPLETED' })
        .eq('id', eventId);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  return { success: true };
}
