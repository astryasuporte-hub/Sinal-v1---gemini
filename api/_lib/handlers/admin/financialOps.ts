/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Handler: GET & POST /api/admin/financial-ops
 *
 * Centro Financeiro Administrativo Consolidado (Payments V2):
 * - Exige sessão administrativa validada via verifyAdminRequest (HTTP 401/403 para comuns/anônimos).
 * - Nunca expõe chaves privadas, tokens OAuth, secrets de webhook ou credenciais fiscais.
 * - Entrega todas as métricas e tabelas operacionais:
 *   1. Receita recebida, pendentes, assinaturas PRO vs Trials vs Isentos/Cortesias, em atraso, canceladas, reembolsos/chargebacks
 *   2. Tentativas de checkout, pagamentos, webhooks recentes, erros de processamento, cobranças Pix
 *   3. Prontidão da Cakto, trava de régua Resend (Dunning) e prontidão/itens ausentes de NFS-e
 *   4. Ações administrativas: reconciliação manual por usuário, ciclo controlado de dunning e preparação de NFS-e
 */

import { verifyAdminRequest, verifySupabaseAdminSession } from '../../adminAuth.js';
import { readJsonBody, sendJson, setCorsHeaders } from '../../common.js';
import { billingDunningService, getDunningReadiness } from '../../payments/BillingDunningService.js';
import { billingReconciliationService } from '../../payments/BillingReconciliationService.js';
import { fiscalInvoiceService, getFiscalReadiness } from '../../payments/FiscalInvoiceService.js';
import { getActivePaymentProviderId, getPaymentProvider } from '../../payments/PaymentProviderRegistry.js';
import { getPaymentsPersistence, isUuid } from '../../payments/PaymentsStore.js';
import { getEffectiveAllowedPaymentMethods, isTraditionalPixCommercialEnabled } from '../../plans.js';

async function authorizeAdmin(req: any): Promise<{ ok: boolean; statusCode: number; error?: string }> {
  const authorized = await verifyAdminRequest(req);
  if (authorized) {
    return { ok: true, statusCode: 200 };
  }
  const session = await verifySupabaseAdminSession(req);
  if (session.statusCode === 403) {
    return { ok: false, statusCode: 403, error: 'Acesso restrito a administradores financeiros.' };
  }
  return { ok: false, statusCode: 401, error: 'Sessão administrativa exigida.' };
}

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const auth = await authorizeAdmin(req);
  if (!auth.ok) {
    return sendJson(res, auth.statusCode, { success: false, error: auth.error });
  }

  const store = getPaymentsPersistence();
  const providerId = getActivePaymentProviderId();
  const provider = getPaymentProvider(providerId);

  if (req.method === 'GET') {
    try {
      const [commercialReadiness, snapshot] = await Promise.all([
        provider.getCommercialReadiness(),
        typeof store.getAdminFinancialSnapshot === 'function'
          ? store.getAdminFinancialSnapshot(50)
          : Promise.resolve({
              metrics: {
                receivedAmountCents: 0,
                approvedCount: 0,
                pendingAmountCents: 0,
                pendingCount: 0,
                refundedAmountCents: 0,
                refundedCount: 0,
                activeProCount: 0,
                activeTrialCount: 0,
                pastDueCount: 0,
                canceledCount: 0,
                expiredOrSuspendedCount: 0,
                courtesyCount: 0,
                adminExemptCount: 0,
                webhookErrorsCount: 0,
                pendingPixCount: 0,
              },
              subscriptions: [],
              payments: [],
              attempts: [],
              webhookEvents: [],
              processingErrors: [],
              pixCharges: [],
              refunds: [],
              dunningLogs: [],
              fiscalDocuments: [],
            }),
      ]);

      return sendJson(res, 200, {
        success: true,
        generatedAt: new Date().toISOString(),
        provider: providerId,
        allowedMethods: getEffectiveAllowedPaymentMethods(),
        traditionalPixEnabled: isTraditionalPixCommercialEnabled(),
        readiness: {
          commercial: commercialReadiness,
          dunning: getDunningReadiness(),
          fiscal: getFiscalReadiness(),
        },
        ...snapshot,
      });
    } catch (err: any) {
      return sendJson(res, 503, {
        success: false,
        errorCode: 'FINANCIAL_CENTER_UNAVAILABLE',
        error: err?.message || 'Falha ao consultar centro financeiro administrativo.',
      });
    }
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const action = String(body?.action || '').trim();

    if (action === 'reconcile_user') {
      const targetUserId = String(body?.userId || '').trim();
      const targetEmail = String(body?.userEmail || '').trim();
      if (!isUuid(targetUserId)) {
        return sendJson(res, 400, {
          success: false,
          errorCode: 'INVALID_USER_ID',
          error: 'Informe um userId UUID válido para reconciliação.',
        });
      }
      const outcome = await billingReconciliationService.reconcileUser({
        userId: targetUserId,
        userEmail: targetEmail,
      });
      return sendJson(res, outcome.success ? 200 : 502, {
        success: outcome.success,
        action,
        outcome,
      });
    }

    if (action === 'run_dunning_cycle') {
      const cycleResult = await billingDunningService.runDunningCycle();
      return sendJson(res, 200, {
        success: true,
        action,
        ...cycleResult,
      });
    }

    if (action === 'prepare_nfse') {
      const targetUserId = String(body?.userId || '').trim();
      const providerPaymentId = String(body?.providerPaymentId || '').trim();
      if (!isUuid(targetUserId) || !providerPaymentId) {
        return sendJson(res, 400, {
          success: false,
          errorCode: 'INVALID_NFSE_REQUEST',
          error: 'Informe userId válido e providerPaymentId para preparação fiscal.',
        });
      }
      const outcome = await fiscalInvoiceService.prepareOrQueueForPayment({
        userId: targetUserId,
        providerPaymentId,
        amountCents: Number(body?.amountCents || 3490),
        customerName: body?.customerName ? String(body.customerName) : null,
      });
      return sendJson(res, 200, {
        success: true,
        action,
        outcome,
      });
    }

    return sendJson(res, 400, {
      success: false,
      errorCode: 'UNSUPPORTED_FINANCIAL_ACTION',
      error: `Ação administrativa financeira '${action || 'vazia'}' não é suportada.`,
    });
  }

  return sendJson(res, 405, { success: false, error: 'Método não permitido.' });
}
