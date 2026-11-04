/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Server-Side Admin Authentication Guard
 */

import { safeCompare } from './crypto';
import { getServerSupabase } from './db';

const ADMIN_EMAILS = [
  'yleaopvpy01@gmail.com',
  'admin@fatosbr.com.br'
];

export async function verifyAdminRequest(req: any): Promise<boolean> {
  const authHeader = req.headers?.authorization || '';
  const adminSecret = process.env.ADMIN_SECRET || process.env.ZYNPAY_WEBHOOK_SECRET || '';

  // 1. Verificação via Bearer Token contra ADMIN_SECRET
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (adminSecret && safeCompare(token, adminSecret)) {
      return true;
    }

    // 2. Verificação via sessão do Supabase Auth
    const supabase = getServerSupabase();
    if (supabase) {
      try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user && user.email) {
          if (ADMIN_EMAILS.includes(user.email.toLowerCase())) {
            return true;
          }
          // Checa se tem role de admin no perfil
          const { data: profile } = await supabase
            .from('profiles')
            .select('is_admin, role')
            .eq('id', user.id)
            .maybeSingle();

          if (profile && (profile.is_admin === true || profile.role === 'admin')) {
            return true;
          }
        }
      } catch {}
    }
  }

  // Se não houver token ou se a validação falhar:
  return false;
}
