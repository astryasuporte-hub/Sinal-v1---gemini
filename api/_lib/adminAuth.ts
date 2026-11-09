/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Server-Side Admin Authentication Guard
 * 
 * Autorização baseada em RBAC real:
 * 1. Bearer Token verificado contra ADMIN_SECRET do servidor em tempo constante.
 * 2. Sessão do Supabase Auth com verificação de claims de app_metadata (gerenciadas pelo servidor).
 * 3. Consulta de privilégios na tabela public.user_roles no Supabase.
 * ZERO dependência de listas de e-mails hardcoded ou flags editáveis pelo cliente.
 */

import { safeCompare } from './crypto.js';
import { getServerSupabase, isDatabaseConfigured } from './db.js';
import { executeSql, isPostgresConfigured } from './postgres.js';

export async function verifyAdminRequest(req: any): Promise<boolean> {
  const authHeader = req.headers?.authorization || '';
  const adminSecret = process.env.ADMIN_SECRET || '';

  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7).trim();
  if (!token) return false;

  // 1. Verificação via Bearer Token contra ADMIN_SECRET
  if (adminSecret && safeCompare(token, adminSecret)) {
    return true;
  }

  // 2. Verificação via Supabase Auth & RBAC
  if (isDatabaseConfigured()) {
    try {
      const supabase = getServerSupabase();
      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (!error && user) {
        // 2.1 Verifica app_metadata (protegido pelo servidor auth.users, imutável pelo cliente)
        const appMeta = user.app_metadata || {};
        if (appMeta.is_admin === true || appMeta.role === 'admin' || appMeta.role === 'super_admin') {
          return true;
        }

        // 2.2 Consulta tabela de papéis de usuário (public.user_roles)
        if (isPostgresConfigured()) {
          const roleRes = await executeSql(
            `SELECT role FROM public.user_roles WHERE user_id = $1 AND role IN ('admin', 'super_admin') LIMIT 1`,
            [user.id]
          );
          if (roleRes.rows.length > 0) {
            return true;
          }
        } else {
          const { data: roleRow } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id)
            .in('role', ['admin', 'super_admin'])
            .maybeSingle();

          if (roleRow) {
            return true;
          }
        }

        // 2.3 RPC is_admin() no banco
        try {
          const { data: rpcIsAdmin } = await supabase.rpc('is_admin');
          if (rpcIsAdmin === true) {
            return true;
          }
        } catch {}
      }
    } catch (err: any) {
      console.warn('[Admin Auth Verification Warning]', err.message);
    }
  }

  return false;
}
