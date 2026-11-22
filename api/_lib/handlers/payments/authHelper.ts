/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Autenticação de Sessão Supabase para endpoints de Pagamentos (/api/payments/*).
 * O userId é extraído exclusivamente do JWT validado no servidor (nunca do body/query).
 */

import { getServerSupabase, isFinancialAdminUser } from '../../db.js';
import { safeCompare } from '../../crypto.js';

export interface AuthenticatedPaymentUser {
  userId: string;
  email: string | null;
  fullName?: string;
  createdAt?: string;
  isAdmin: boolean;
}

export async function authenticatePaymentUser(
  req: any
): Promise<{ ok: true; user: AuthenticatedPaymentUser } | { ok: false; statusCode: 401; error: string }> {
  const authHeader = String(req?.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Autenticação necessária. Envie Authorization: Bearer <token>.',
    };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { ok: false, statusCode: 401, error: 'Token de sessão vazio ou ausente.' };
  }

  try {
    const supabase = getServerSupabase();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { ok: false, statusCode: 401, error: 'Sessão inválida ou expirada.' };
    }

    const isAdmin = await isFinancialAdminUser(user);
    return {
      ok: true,
      user: {
        userId: user.id,
        email: user.email || null,
        fullName: user.user_metadata?.full_name || user.user_metadata?.name || undefined,
        createdAt: user.created_at || undefined,
        isAdmin,
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      statusCode: 401,
      error: err?.message || 'Falha ao validar sessão Supabase.',
    };
  }
}

export async function authenticateFinancialAdmin(req: any): Promise<boolean> {
  const authHeader = String(req?.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  const adminSecret = process.env.ADMIN_SECRET || '';
  if (adminSecret && safeCompare(token, adminSecret)) return true;

  const auth = await authenticatePaymentUser(req);
  return auth.ok && auth.user.isAdmin;
}
