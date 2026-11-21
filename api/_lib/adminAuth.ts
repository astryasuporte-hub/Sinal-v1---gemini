/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-Side Admin Authentication & RBAC Guard
 *
 * Autorização baseada em sessão Supabase válida e RBAC em internal.user_roles:
 * 1. Valida JWT real via Supabase Auth (supabase.auth.getUser(token)).
 * 2. Verifica claims assinadas em app_metadata e consulta server-side segura a internal.user_roles.
 * 3. ZERO dependência de public.user_roles ou public.is_admin().
 */

import { safeCompare } from './crypto.js';
import { getServerSupabase } from './db.js';
import { executeSql, isPostgresConfigured } from './postgres.js';

export interface VerifiedAdminSession {
  authorized: boolean;
  statusCode: 200 | 401 | 403;
  reason?: 'NO_SESSION' | 'INVALID_SESSION' | 'NOT_ADMIN';
  userId?: string;
  email?: string | null;
  role?: string;
}

const ADMIN_ROLES = ['admin', 'super_admin'];

async function checkInternalUserRole(supabase: any, userId: string): Promise<string | null> {
  // 1. Consulta server-side direta ao PostgreSQL em internal.user_roles
  if (isPostgresConfigured()) {
    const roleRes = await executeSql(
      `SELECT role FROM internal.user_roles
       WHERE user_id = $1
         AND LOWER(role) = ANY($2::text[])
       LIMIT 1`,
      [userId, ADMIN_ROLES]
    );
    if (roleRes.rows.length > 0) {
      return String(roleRes.rows[0].role || 'admin');
    }
    return null;
  }

  // 2. Fallback restrito a internal.user_roles quando schema('internal') estiver disponível (ex: harness de testes)
  if (typeof supabase?.schema === 'function') {
    try {
      const { data: roleRow } = await supabase
        .schema('internal')
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .in('role', ADMIN_ROLES)
        .maybeSingle();

      if (roleRow?.role) {
        return String(roleRow.role);
      }
    } catch {}
  }

  return null;
}

/**
 * Exige sessão Supabase válida e autorização administrativa real (app_metadata ou internal.user_roles).
 * Utilizada exclusivamente por rotas administrativas sensíveis como a Biblioteca de Imagens.
 */
export async function verifySupabaseAdminSession(req: any): Promise<VerifiedAdminSession> {
  const authHeader = String(req?.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return { authorized: false, statusCode: 401, reason: 'NO_SESSION' };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { authorized: false, statusCode: 401, reason: 'NO_SESSION' };
  }

  try {
    const supabase = getServerSupabase();
    const {
      data: { user },
      error
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { authorized: false, statusCode: 401, reason: 'INVALID_SESSION' };
    }

    // 1. Claims protegidas em app_metadata (gerenciadas exclusivamente pelo backend/Auth admin)
    const appMeta = user.app_metadata || {};
    const metaRole = String(appMeta.role || '').trim().toLowerCase();
    if (appMeta.is_admin === true || ADMIN_ROLES.includes(metaRole)) {
      return {
        authorized: true,
        statusCode: 200,
        userId: user.id,
        email: user.email || null,
        role: metaRole || 'admin'
      };
    }

    // 2. Consulta server-side segura à tabela internal.user_roles
    const internalRole = await checkInternalUserRole(supabase, user.id);
    if (internalRole) {
      return {
        authorized: true,
        statusCode: 200,
        userId: user.id,
        email: user.email || null,
        role: internalRole
      };
    }

    // Usuário comum autenticado sem papel administrativo
    return {
      authorized: false,
      statusCode: 403,
      reason: 'NOT_ADMIN',
      userId: user.id,
      email: user.email || null
    };
  } catch (err: any) {
    console.warn('[Admin Session Verification Warning]', err?.message || err);
    return { authorized: false, statusCode: 401, reason: 'INVALID_SESSION' };
  }
}

/**
 * Compatível com rotas internas/cron existentes (ZynPay/Ingest) + internal.user_roles.
 */
export async function verifyAdminRequest(req: any): Promise<boolean> {
  const authHeader = String(req?.headers?.authorization || '');
  const adminSecret = process.env.ADMIN_SECRET || '';

  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7).trim();
  if (!token) return false;

  // 1. Verificação via Bearer Token contra ADMIN_SECRET (rotas de máquina/cron existentes)
  if (adminSecret && safeCompare(token, adminSecret)) {
    return true;
  }

  // 2. Verificação via Sessão Supabase + internal.user_roles
  const sessionResult = await verifySupabaseAdminSession(req);
  return sessionResult.authorized;
}
