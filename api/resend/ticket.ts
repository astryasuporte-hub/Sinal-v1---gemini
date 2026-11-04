/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: Resend Support Ticket Notification
 */

import { getServerKeys, sendJson, setCorsHeaders, readJsonBody, checkRateLimit, getClientIp } from '../_lib/common';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Método não permitido. Utilize POST.' });
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`ticket_send_${clientIp}`, 15, 60000)) {
    return sendJson(res, 429, { error: 'Rate limit excedido para notificações de chamado.' });
  }

  const keys = getServerKeys();
  const apiKey = keys.RESEND;
  const body = await readJsonBody(req);

  const toEmail = body.to || 'astryasuporte@gmail.com';
  const ticketSubject = body.subject || 'Atualização de Chamado - FatosBR Suporte';
  const ticketId = body.ticketId || 'CH-001';
  const userName = body.userName || toEmail.split('@')[0];
  const messageBody = body.body || 'Seu chamado foi atualizado pela equipe de suporte.';

  const html = `
    <div style="font-family: sans-serif; background: #0c0d10; color: #f4f4f5; padding: 24px; border-radius: 12px;">
      <h2 style="color: #ffffff; margin-top: 0;">FatosBR Suporte — Chamado #${ticketId}</h2>
      <p style="color: #a1a1aa; font-size: 14px;">Olá, <strong>${userName}</strong>,</p>
      <div style="background: #18181b; border: 1px solid #27272a; padding: 16px; border-radius: 8px; margin: 16px 0; color: #e4e4e7;">
        ${messageBody.replace(/\n/g, '<br/>')}
      </div>
      <p style="color: #71717a; font-size: 12px; margin-bottom: 0;">Equipe de Suporte FatosBR · https://fatosbr.com.br</p>
    </div>
  `;

  if (!apiKey) {
    return sendJson(res, 200, {
      success: true,
      simulated: true,
      message: `RESEND_API_KEY ausente. Notificação simulada para ${toEmail}`
    });
  }

  try {
    const apiRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: 'FatosBR Suporte <onboarding@resend.dev>',
        to: [toEmail],
        subject: ticketSubject,
        html,
        text: messageBody
      })
    });

    const data = await apiRes.json().catch(() => ({}));
    return sendJson(res, apiRes.status, data);
  } catch (err: any) {
    return sendJson(res, 500, { error: err.message });
  }
}
