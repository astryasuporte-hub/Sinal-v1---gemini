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

import crypto from 'crypto';
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
      return sendJson(res, 503, {
        error: 'Serviço financeiro temporariamente indisponível. Falha crítica ao verificar status da assinatura.',
        code: subErr.message?.includes('POSTGRES_UNAVAILABLE') ? 'POSTGRES_UNAVAILABLE' : 'SUBSCRIPTION_CHECK_FAILED',
        details: subErr.message
      });
    }

    // 5. Respeito ao índice parcial 'billing_one_pending' com verificação de estado no gateway
    let existingPending = null;
    try {
      existingPending = await getActivePendingChargeForUser(userId, userEmail);
    } catch (pendingErr: any) {
      console.error('[Pending Charge Check Error]', pendingErr.message);
      return sendJson(res, 503, {
        error: 'Falha crítica ao consultar cobranças pendentes no banco de dados.',
        code: pendingErr.message?.includes('POSTGRES_UNAVAILABLE') ? 'POSTGRES_UNAVAILABLE' : 'PENDING_CHECK_FAILED',
        details: pendingErr.message
      });
    }

    if (existingPending) {
      // 5.1 Consulta estado real no gateway oficial ZynPay antes de qualquer alteração de status
      let upstreamCharge = null;
      let gatewayCheckFailed = false;
      try {
        upstreamCharge = await fetchChargeFromGateway(existingPending.providerPaymentId);
      } catch (gwErr: any) {
        gatewayCheckFailed = true;
        console.warn(`[Gateway Check Notice] Não foi possível consultar cobrança ${existingPending.providerPaymentId} na ZynPay: ${gwErr.message}`);
      }

      // Regra 6.2: Se a ZynPay estiver indisponível, não marcar como expirada, não marcar como paga,
      // não criar substituta e não liberar índice sem confirmação.
      if (gatewayCheckFailed && !upstreamCharge) {
        if (existingPending.amountCents === planAmountCents) {
          const qrCodeText = existingPending.qrCodeText || '';
          let qrCodeBase64 = '';
          if (qrCodeText) {
            try { qrCodeBase64 = await QRCode.toDataURL(qrCodeText, { width: 320, margin: 2 }); } catch {}
          }
          return sendJson(res, 200, {
            success: true,
            reused: true,
            gatewayStatusUnconfirmed: true,
            charge: {
              id: existingPending.providerPaymentId,
              amount: existingPending.amountCents,
              amountFormatted: planConfig.amountFormatted,
              status: existingPending.status,
              description: existingPending.description,
              customer: { name: customerName, email: userEmail },
              qrCode: qrCodeBase64,
              qrCodeText,
              createdAt: existingPending.createdAt,
              expiresAt: existingPending.expirationDate || new Date(new Date(existingPending.createdAt).getTime() + 15 * 60 * 1000).toISOString()
            }
          });
        } else {
          return sendJson(res, 503, {
            error: 'Serviço de consulta ao gateway temporariamente indisponível. Cobrança pendente anterior mantida.',
            code: 'GATEWAY_UNAVAILABLE_PENDING_CHECK'
          });
        }
      }

      const upstreamStatus = upstreamCharge?.status || null;

      // Se no gateway já foi confirmada como paga, impede criação duplicada
      if (upstreamStatus === 'PAID') {
        return sendJson(res, 409, {
          error: 'Esta cobrança já foi confirmada como paga no provedor oficial. Sua assinatura Pro está sendo ativada.',
          code: 'CHARGE_ALREADY_PAID'
        });
      }

      // Se no gateway foi cancelada ou expirada oficialmente, sincroniza o banco local
      if (upstreamStatus === 'CANCELLED' || upstreamStatus === 'EXPIRED') {
        await cancelOrExpirePendingCharge(existingPending.id, upstreamStatus);
      } else if (upstreamStatus === 'PENDING') {
        // Cobrança confirmada como pendente no gateway:
        // Verifica a expiração oficial registrada no provedor (Regra 6.3)
        const expiresAtTime = upstreamCharge?.expirationDate ? new Date(upstreamCharge.expirationDate).getTime() : 0;
        const isOfficialExpired = expiresAtTime > 0 && Date.now() > expiresAtTime;

        if (isOfficialExpired) {
          await cancelOrExpirePendingCharge(existingPending.id, 'EXPIRED');
        } else if (existingPending.amountCents === planAmountCents) {
          // Reutiliza a cobrança pendente existente para o mesmo plano
          const qrCodeText = upstreamCharge?.qrCodeText || existingPending.qrCodeText || '';
          let qrCodeBase64 = upstreamCharge?.qrCodeBase64 || '';
          if (!qrCodeBase64 && qrCodeText) {
            try {
              qrCodeBase64 = await QRCode.toDataURL(qrCodeText, { width: 320, margin: 2 });
            } catch {}
          }

          return sendJson(res, 200, {
            success: true,
            reused: true,
            charge: {
              id: existingPending.providerPaymentId,
              amount: existingPending.amountCents,
              amountFormatted: planConfig.amountFormatted,
              status: 'PENDING',
              description: existingPending.description,
              customer: { name: customerName, email: userEmail },
              qrCode: qrCodeBase64,
              qrCodeText,
              createdAt: existingPending.createdAt,
              expiresAt: upstreamCharge?.expirationDate || existingPending.expirationDate || new Date(new Date(existingPending.createdAt).getTime() + 15 * 60 * 1000).toISOString()
            }
          });
        } else {
          // Regra 6.4: Cobrança pendente de outro plano não pode ter valor reutilizado nem ser cancelada sem regra segura
          return sendJson(res, 409, {
            error: 'Você já possui uma cobrança Pix ativa em aberto para outro plano. Conclua o pagamento anterior ou aguarde sua expiração oficial antes de trocar de plano.',
            code: 'ACTIVE_PENDING_CHARGE_DIFFERENT_PLAN',
            existingChargeId: existingPending.providerPaymentId
          });
        }
      }
    }

    // 6. Chave de Idempotência Estável vinculada ao usuário, plano e tentativa lógica
    let idempotencyKey: string;
    const rawClientKey = body.idempotencyKey;
    if (typeof rawClientKey === 'string' && rawClientKey.trim()) {
      const cleanKey = rawClientKey.trim();
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(cleanKey)) {
        return sendJson(res, 400, {
          error: 'Chave de idempotência em formato inválido. Deve ter entre 8 e 64 caracteres alfanuméricos com hífens ou underscores.',
          code: 'INVALID_IDEMPOTENCY_KEY'
        });
      }
      // Vincula criptograficamente ao usuário e plano para impedir reutilização maliciosa
      const contextHash = crypto.createHash('sha256')
        .update(`${userId}:${planConfig.id}:${planAmountCents}:${cleanKey}`)
        .digest('hex')
        .slice(0, 24);
      idempotencyKey = `fatosbr_chk_${userId}_${contextHash}`;
    } else {
      // Identificador de tentativa persistente derivado pelo servidor
      const attemptHash = crypto.createHash('sha256')
        .update(`${userId}:${planConfig.id}:${planAmountCents}`)
        .digest('hex')
        .slice(0, 20);
      idempotencyKey = `fatosbr_chk_${userId}_${attemptHash}`;
    }

    // 7. Criação de cobrança oficial pela API oficial da ZynPay (ZERO PIX FICTÍCIO)
    let gatewayResponse;
    try {
      gatewayResponse = await createPixChargeOnGateway({
        amountCents: planAmountCents,
        description: planDescription,
        customer: {
          name: customerName,
          email: userEmail
        },
        idempotencyKey
      });
    } catch (gatewayErr: any) {
      console.error('[ZynPay Gateway Failure] Não foi possível criar cobrança oficial:', gatewayErr.message);
      return sendJson(res, 503, {
        error: 'Serviço de pagamento temporariamente indisponível. A emissão de cobranças oficiais Pix foi suspensa. Tente novamente em instantes.',
        code: 'GATEWAY_UNAVAILABLE',
        details: gatewayErr.message
      });
    }

    // 8. Persistência mandatória no PostgreSQL Supabase
    let storedCharge;
    try {
      storedCharge = await recordOfficialZynPayCharge({
        userId,
        gatewayCharge: gatewayResponse,
        planId: planConfig.id,
        userEmail,
        description: planDescription,
        idempotencyKey
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
