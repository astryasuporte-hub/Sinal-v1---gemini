/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vercel Serverless Function: Resend Send Email (Hardened V2.3)
 *
 * Regras de segurança:
 * 1. Exige sessão Supabase válida (Bearer JWT) ou ADMIN_SECRET server-side.
 * 2. Nunca retorna sucesso simulado quando RESEND_API_KEY está ausente (HTTP 503).
 * 3. Nunca utiliza e-mail de destinatário fixo como fallback.
 * 4. Para usuários não administradores, restringe o destinatário ao e-mail da conta
 *    autenticada ou ao briefing_email persistido nas preferências do próprio usuário.
 * 5. Aplica rate limiting distribuído no servidor por usuário/IP.
 */

import { getServerKeys, sendJson, setCorsHeaders, readJsonBody } from '../../common.js';
import { enforceRateLimit } from '../../rateLimiter.js';
import { getServerSupabase } from '../../db.js';
import { safeCompare } from '../../crypto.js';
import { verifySupabaseAdminSession } from '../../adminAuth.js';
import { executeSql, isPostgresConfigured } from '../../postgres.js';
import { getResendFromEmail, sendResendEmailWithRetry } from '../../resendClient.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function resolveAuthenticatedCaller(req: any): Promise<{
  authenticated: boolean;
  isAdmin: boolean;
  userId?: string;
  userEmail?: string;
}> {
  const authHeader = String(req?.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return { authenticated: false, isAdmin: false };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { authenticated: false, isAdmin: false };
  }

  const keys = getServerKeys();
  if (keys.ADMIN_SECRET && safeCompare(token, keys.ADMIN_SECRET)) {
    return { authenticated: true, isAdmin: true, userId: 'system-admin' };
  }

  // Verifica se é sessão administrativa Supabase
  const adminCheck = await verifySupabaseAdminSession(req);
  if (adminCheck.authorized) {
    return {
      authenticated: true,
      isAdmin: true,
      userId: adminCheck.userId,
      userEmail: adminCheck.email || undefined
    };
  }

  // Caso seja sessão de usuário comum autenticada (statusCode 403 em verifySupabaseAdminSession)
  if (adminCheck.statusCode === 403 && adminCheck.userId) {
    return {
      authenticated: true,
      isAdmin: false,
      userId: adminCheck.userId,
      userEmail: adminCheck.email || undefined
    };
  }

  return { authenticated: false, isAdmin: false };
}

async function getAuthorizedBriefingEmail(userId: string): Promise<string | null> {
  if (isPostgresConfigured()) {
    try {
      const prefRes = await executeSql(
        `SELECT briefing_email FROM public.user_preferences WHERE id = $1 LIMIT 1`,
        [userId]
      );
      if (prefRes.rows[0]?.briefing_email) {
        return String(prefRes.rows[0].briefing_email).trim().toLowerCase();
      }
    } catch {}

    try {
      const settingsRes = await executeSql(
        `SELECT briefing_email FROM public.user_settings WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      if (settingsRes.rows[0]?.briefing_email) {
        return String(settingsRes.rows[0].briefing_email).trim().toLowerCase();
      }
    } catch {}
  }

  try {
    const supabase = getServerSupabase();
    const { data: prefRow } = await (supabase as any)
      .from('user_preferences')
      .select('briefing_email')
      .eq('id', userId)
      .maybeSingle();
    if (prefRow?.briefing_email) {
      return String(prefRow.briefing_email).trim().toLowerCase();
    }

    const { data: settingsRow } = await (supabase as any)
      .from('user_settings')
      .select('briefing_email')
      .eq('user_id', userId)
      .maybeSingle();
    if (settingsRow?.briefing_email) {
      return String(settingsRow.briefing_email).trim().toLowerCase();
    }
  } catch {}

  return null;
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Método não permitido. Utilize POST.' });
  }

  // 1. Autenticação obrigatória antes de consumir provedor de e-mail
  const caller = await resolveAuthenticatedCaller(req);
  if (!caller.authenticated) {
    return sendJson(res, 401, {
      success: false,
      error: 'UNAUTHORIZED_SESSION',
      message: 'Autenticação obrigatória para disparar e-mails.'
    });
  }

  // 2. Rate limiting distribuído no servidor (escopo por usuário + IP)
  const rateLimitAllowed = await enforceRateLimit(req, res, 'auth', caller.userId || 'anon');
  if (!rateLimitAllowed) {
    return;
  }

  // 3. Verificação real da chave do Resend (sem simulação falsa)
  const keys = getServerKeys();
  const apiKey = keys.RESEND;
  if (!apiKey) {
    return sendJson(res, 503, {
      success: false,
      error: 'RESEND_UNCONFIGURED',
      message: 'Serviço de envio de e-mail indisponível no servidor (RESEND_API_KEY não configurada).'
    });
  }

  const body = await readJsonBody(req);
  const rawTo = Array.isArray(body.to) ? body.to[0] : body.to;
  const toEmail = typeof rawTo === 'string' ? rawTo.trim() : '';

  if (!toEmail || !EMAIL_REGEX.test(toEmail)) {
    return sendJson(res, 400, {
      success: false,
      error: 'INVALID_RECIPIENT',
      message: 'Informe um endereço de e-mail destinatário válido.'
    });
  }

  // 4. Autorização do destinatário (impede abuso para disparo a terceiros)
  if (!caller.isAdmin) {
    const normalizedTarget = toEmail.toLowerCase();
    const accountEmail = caller.userEmail ? caller.userEmail.toLowerCase() : null;
    const savedBriefingEmail = caller.userId ? await getAuthorizedBriefingEmail(caller.userId) : null;

    if (normalizedTarget !== accountEmail && normalizedTarget !== savedBriefingEmail) {
      return sendJson(res, 403, {
        success: false,
        error: 'FORBIDDEN_RECIPIENT',
        message: 'Envio autorizado apenas para o e-mail da sua conta ou e-mail de briefing salvo.'
      });
    }
  }

  const verifiedDefaultSender = getResendFromEmail();
  const from = caller.isAdmin && typeof body.from === 'string' && body.from.trim()
    ? body.from.trim()
    : verifiedDefaultSender;
  const subject = typeof body.subject === 'string' && body.subject.trim()
    ? body.subject.trim().slice(0, 200)
    : 'FatosBR • Resumo de Notícias';
  const text = typeof body.text === 'string' && body.text.trim()
    ? body.text
    : 'Notificação do FatosBR';
  const html = typeof body.html === 'string' && body.html.trim()
    ? body.html
    : `<div style="font-family:sans-serif;background:#0a0b0e;color:#f4f4f5;padding:24px;border-radius:12px;">
         <h2 style="margin:0 0 12px 0;color:#ffffff;">${subject.replace(/[<>&]/g, '')}</h2>
         <p style="margin:0;color:#d4d4d8;line-height:1.6;">${String(body.summary || text).replace(/[<>&]/g, '')}</p>
       </div>`;

  const idempotencyKey =
    typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 128)
      : undefined;

  const sendResult = await sendResendEmailWithRetry({
    apiKey,
    from,
    to: [toEmail],
    subject,
    html,
    text,
    idempotencyKey,
  });

  if (!sendResult.accepted) {
    console.warn('[Resend Send] Falha na entrega via Resend API:', {
      status: sendResult.statusCode,
      userId: caller.userId,
      error: sendResult.error || 'RESEND_API_ERROR'
    });
    return sendJson(res, sendResult.statusCode || 502, {
      success: false,
      error: sendResult.error || `Falha no envio pelo provedor (HTTP ${sendResult.statusCode})`
    });
  }

  console.info('[Resend Send] E-mail aceito pelo Resend:', {
    id: sendResult.messageId,
    userId: caller.userId
  });

  return sendJson(res, 200, {
    success: true,
    id: sendResult.messageId,
    recipient: toEmail,
    from,
    provider: 'Resend',
    deliveryStatus: 'ACCEPTED',
    message: `E-mail aceito para entrega para ${toEmail}.`
  });
}
