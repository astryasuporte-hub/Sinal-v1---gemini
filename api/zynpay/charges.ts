/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Vercel Serverless Function: ZynPay Official Charges & Pix Generation
 * 
 * Arquitetura de Segurança e Conformidade:
 * 1. Autenticação obrigatória do pagador via Supabase Auth (Bearer Token).
 * 2. Preço controlado exclusivamente pelo servidor (api/_lib/plans.ts) — anti-tampering.
 * 3. ZERO geração de PIX fictício no servidor. Todo QR Code e código Copia-e-Cola provêm da ZynPay.
 * 4. Verificação de assinatura ativa prévia (prevenção de cobrança duplicada Pro).
 * 5. Respeito ao índice parcial 'billing_one_pending' com reutilização transparente de cobrança pendente.
 * 6. Persistência atômica e exclusiva via PostgreSQL server-side no schema real internal.billing_payments.
 * 7. Rate limiting distribuído no perfil 'payments'.
 */

import QRCode from 'qrcode';
import { sendJson, setCorsHeaders, readJsonBody } from '../_lib/common';
import {
  getServerSupabase,
  checkUserActiveSubscription,
  getActivePendingChargeForUser,
  cancelOrExpirePendingCharge,
  recordOfficialZynPayCharge,
  getChargeById
} from '../_lib/db';
import { resolvePlanPrice } from '../_lib/plans';
import { createPixChargeOnGateway, fetchChargeFromGateway } from '../_lib/zynpayClient';
import { enforceRateLimit } from '../_lib/rateLimiter';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // 1. Rate Limiting distribuído
  const rateLimitAllowed = await enforceRateLimit(req, res, 'payments');
  if (!rateLimitAllowed) {
    return;
  }

  // ===========================================================================
  // POST /api/zynpay/charges (Criação de Cobrança Pix Oficial)
  // ===========================================================================
  if (req.method === 'POST') {
    // 2. Autenticação obrigatória do pagador via Supabase Auth
    const authHeader = req.headers?.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return sendJson(res, 401, {
        error: 'Autenticação obrigatória para acessar o checkout de assinaturas.',
        code: 'UNAUTHORIZED_CHECKOUT'
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return sendJson(res, 401, {
        error: 'Token de autenticação ausente.',
        code: 'MISSING_AUTH_TOKEN'
      });
    }

    let authenticatedUser: any = null;
    try {
      const supabase = getServerSupabase();
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return sendJson(res, 403, {
          error: 'Sessão inválida ou expirada. Faça login novamente para prosseguir com o pagamento.',
          code: 'INVALID_SESSION'
        });
      }
      authenticatedUser = user;
    } catch (authException: any) {
      console.error('[Auth Error] Falha ao validar token do pagador:', authException.message);
      return sendJson(res, 403, {
        error: 'Não foi possível validar a identidade do pagador. Tente novamente após autenticar-se.',
        code: 'AUTH_VALIDATION_FAILED'
      });
    }

    const userId = authenticatedUser.id;
    const userEmail = (authenticatedUser.email || '').toLowerCase().trim();
    const customerName = authenticatedUser.user_metadata?.full_name ||
                         authenticatedUser.user_metadata?.name ||
                         'Leitor FatosBR';

    const body = await readJsonBody(req);

    // 3. Resolução segura de preço no servidor (ignora body.amount / body.amountCents)
    let planConfig;
    try {
      planConfig = resolvePlanPrice(body.planId || 'pro');
    } catch (planErr: any) {
      return sendJson(res, 400, {
        error: planErr.message || 'Plano solicitado inválido ou inativo.',
        code: 'INVALID_PLAN'
      });
    }

    const planAmountCents = planConfig.amountCents;
    const planDescription = planConfig.description;

    // 4. Verificação de assinatura Pro ativa (Anti-duplicação de assinaturas)
    try {
      const isAlreadySubscribed = await checkUserActiveSubscription(userId, userEmail);
      if (isAlreadySubscribed) {
        return sendJson(res, 409, {
          error: 'Você já possui uma assinatura FatosBR Pro ativa vinculada a esta conta.',
          code: 'USER_ALREADY_SUBSCRIBED'
        });
      }
    } catch (subErr: any) {
      console.error('[Subscription Check Error]', subErr.message);
      if (subErr.message?.includes('POSTGRES_UNAVAILABLE')) {
        return sendJson(res, 503, {
          error: 'Serviço financeiro temporariamente indisponível. Conexão segura com banco de dados não configurada.',
          code: 'POSTGRES_UNAVAILABLE'
        });
      }
    }

    // 5. Respeito ao índice parcial 'billing_one_pending'
    try {
      const existingPending = await getActivePendingChargeForUser(userId, userEmail);
      if (existingPending) {
        const ageMs = Date.now() - new Date(existingPending.createdAt).getTime();
        const fifteenMinutesMs = 15 * 60 * 1000;

        // Se ainda está dentro do período de validade do Pix (15 min) e tem o mesmo valor, reutiliza
        if (ageMs < fifteenMinutesMs && existingPending.amountCents === planAmountCents) {
          let qrCodeBase64 = '';
          if (existingPending.qrCodeText) {
            try {
              qrCodeBase64 = await QRCode.toDataURL(existingPending.qrCodeText, { width: 320, margin: 2 });
            } catch {}
          }

          return sendJson(res, 200, {
            success: true,
            reused: true,
            charge: {
              id: existingPending.providerPaymentId,
              amount: existingPending.amountCents,
              amountFormatted: planConfig.amountFormatted,
              status: existingPending.status,
              description: existingPending.description,
              customer: { name: customerName, email: userEmail },
              qrCode: qrCodeBase64,
              qrCodeText: existingPending.qrCodeText,
              createdAt: existingPending.createdAt,
              expiresAt: new Date(new Date(existingPending.createdAt).getTime() + fifteenMinutesMs).toISOString()
            }
          });
        }

        // Se expirou ou o valor diverge, cancela a cobrança anterior no banco para liberar o índice
        await cancelOrExpirePendingCharge(existingPending.id, 'EXPIRED');
      }
    } catch (pendingErr: any) {
      console.error('[Pending Charge Check Error]', pendingErr.message);
    }

    // 6. Criação de cobrança oficial pela API oficial da ZynPay (ZERO PIX FICTÍCIO)
    let gatewayResponse;
    try {
      gatewayResponse = await createPixChargeOnGateway({
        amountCents: planAmountCents,
        description: planDescription,
        customer: {
          name: customerName,
          email: userEmail
        },
        idempotencyKey: `fatosbr_checkout_${userId}_${Date.now()}`
      });
    } catch (gatewayErr: any) {
      console.error('[ZynPay Gateway Failure] Não foi possível criar cobrança oficial:', gatewayErr.message);
      return sendJson(res, 503, {
        error: 'Serviço de pagamento temporariamente indisponível. A emissão de cobranças oficiais Pix foi suspensa. Tente novamente em instantes.',
        code: 'GATEWAY_UNAVAILABLE',
        details: gatewayErr.message
      });
    }

    // 7. Persistência mandatória no PostgreSQL Supabase
    let storedCharge;
    try {
      storedCharge = await recordOfficialZynPayCharge({
        userId,
        gatewayCharge: gatewayResponse,
        planId: planConfig.id,
        userEmail,
        description: planDescription
      });
    } catch (dbErr: any) {
      console.error('[Persistence Failure] Erro ao persistir cobrança oficial no PostgreSQL:', dbErr.message);
      // Tratamento de concorrência com o índice parcial billing_one_pending:
      if (dbErr.code === '23505' || dbErr.message?.includes('billing_one_pending')) {
        try {
          const concurrentPending = await getActivePendingChargeForUser(userId, userEmail);
          if (concurrentPending) {
            let qrCodeBase64 = '';
            if (concurrentPending.qrCodeText) {
              try {
                qrCodeBase64 = await QRCode.toDataURL(concurrentPending.qrCodeText, { width: 320, margin: 2 });
              } catch {}
            }
            return sendJson(res, 200, {
              success: true,
              reused: true,
              charge: {
                id: concurrentPending.providerPaymentId,
                amount: concurrentPending.amountCents,
                amountFormatted: planConfig.amountFormatted,
                status: concurrentPending.status,
                description: concurrentPending.description,
                customer: { name: customerName, email: userEmail },
                qrCode: qrCodeBase64,
                qrCodeText: concurrentPending.qrCodeText,
                createdAt: concurrentPending.createdAt,
                expiresAt: new Date(new Date(concurrentPending.createdAt).getTime() + 15 * 60 * 1000).toISOString()
              }
            });
          }
        } catch {}
      }
      return sendJson(res, 503, {
        error: 'Falha na persistência da cobrança no banco de dados. Operação abortada para segurança do usuário.',
        code: 'DATABASE_PERSISTENCE_FAILED'
      });
    }

    let qrCodeBase64 = gatewayResponse.qrCodeBase64 || '';
    if (!qrCodeBase64 && gatewayResponse.qrCodeText) {
      try {
        qrCodeBase64 = await QRCode.toDataURL(gatewayResponse.qrCodeText, { width: 320, margin: 2 });
      } catch {}
    }

    return sendJson(res, 200, {
      success: true,
      reused: false,
      charge: {
        id: storedCharge.providerPaymentId,
        amount: storedCharge.amountCents,
        amountFormatted: planConfig.amountFormatted,
        status: storedCharge.status,
        description: storedCharge.description,
        customer: { name: customerName, email: userEmail },
        qrCode: qrCodeBase64,
        qrCodeText: storedCharge.qrCodeText,
        createdAt: storedCharge.createdAt,
        expiresAt: storedCharge.expirationDate || new Date(Date.now() + 15 * 60 * 1000).toISOString()
      }
    });
  }

  // ===========================================================================
  // GET /api/zynpay/charges?id=... ou /api/zynpay/charges/{id} (Consulta e Reconciliação)
  // ===========================================================================
  if (req.method === 'GET') {
    const urlObj = new URL(req.url, 'http://localhost');
    let chargeId = urlObj.searchParams.get('id') || urlObj.searchParams.get('chargeId');

    if (!chargeId) {
      const match = urlObj.pathname.match(/\/charges\/([^/?]+)/);
      if (match && match[1]) {
        chargeId = match[1];
      }
    }

    if (!chargeId) {
      return sendJson(res, 400, { error: 'ID da cobrança obrigatório.', code: 'MISSING_CHARGE_ID' });
    }

    try {
      const stored = await getChargeById(chargeId);
      if (stored) {
        // Se a cobrança local ainda estiver PENDING, tenta reconciliar ativamente com a ZynPay
        if (stored.status === 'PENDING') {
          try {
            const upCharge = await fetchChargeFromGateway(stored.providerPaymentId);
            if (upCharge && upCharge.status !== 'PENDING') {
              stored.status = upCharge.status;
            }
          } catch {}
        }

        let qrCodeBase64 = '';
        if (stored.qrCodeText) {
          try {
            qrCodeBase64 = await QRCode.toDataURL(stored.qrCodeText, { width: 320, margin: 2 });
          } catch {}
        }

        return sendJson(res, 200, {
          success: true,
          charge: {
            id: stored.providerPaymentId,
            status: stored.status,
            amount: stored.amountCents,
            amountFormatted: `R$ ${(stored.amountCents / 100).toFixed(2).replace('.', ',')}`,
            description: stored.description,
            qrCode: qrCodeBase64,
            qrCodeText: stored.qrCodeText,
            createdAt: stored.createdAt,
            paidAt: stored.paidAt,
            expiresAt: stored.expirationDate || new Date(new Date(stored.createdAt).getTime() + 15 * 60 * 1000).toISOString()
          }
        });
      }
    } catch (err: any) {
      return sendJson(res, 503, {
        error: 'Erro temporário ao consultar banco de dados.',
        code: 'DATABASE_UNAVAILABLE'
      });
    }

    return sendJson(res, 404, {
      error: 'Cobrança não encontrada no banco de dados.',
      code: 'CHARGE_NOT_FOUND'
    });
  }

  return sendJson(res, 405, { error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
}
