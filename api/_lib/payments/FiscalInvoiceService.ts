/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FiscalInvoiceService — Camada Desacoplada de Documentos Fiscais / NFS-e (Payments V2)
 *
 * Arquitetura fail-closed:
 * 1. NUNCA inventa CNPJ, Inscrição Municipal, CNAE, Código de Serviço ou número de NFS-e.
 * 2. NUNCA emite NFS-e real durante testes ou enquanto NFSE / PAYMENTS_NFSE_AUTO_EMIT não estiver completo.
 * 3. Mantém fila auditável em internal.billing_fiscal_documents com status PENDING_CONFIG, QUEUED,
 *    AUTHORIZED, REJECTED, CANCELLED ou CORRECTION_REQUESTED + histórico de erros.
 * 4. Suporta provedor nativo Cakto (NFSE_PROVIDER=cakto_native) ou adaptador NFS-e externo
 *    (NFSE_PROVIDER=external_nfse) quando credenciais reais forem configuradas.
 */

import { executeSql, isPostgresConfigured } from '../postgres.js';

export type FiscalProviderType = 'cakto_native' | 'external_nfse';

export interface FiscalReadinessStatus {
  autoEmitEnabled: boolean;
  provider: FiscalProviderType;
  ready: boolean;
  missingConfig: string[];
  summary: string;
}

export interface PrepareFiscalDocumentInput {
  userId: string;
  paymentId?: string | null;
  providerPaymentId: string;
  amountCents: number;
  customerName?: string | null;
  customerDocument?: string | null;
}

export interface PrepareFiscalDocumentOutcome {
  id?: string;
  status: 'PENDING_CONFIG' | 'QUEUED' | 'AUTHORIZED' | 'REJECTED';
  provider: FiscalProviderType;
  readyToEmit: boolean;
  missingConfig: string[];
  message: string;
}

function isValidCnpj(raw?: string): boolean {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  return true;
}

function maskTaxDocument(raw?: string | null): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11) {
    return `***.${digits.slice(3, 6)}.***-${digits.slice(9, 11)}`;
  }
  if (digits.length === 14) {
    return `**.${digits.slice(2, 5)}.***/****-${digits.slice(12, 14)}`;
  }
  return '***';
}

export function getFiscalReadiness(): FiscalReadinessStatus {
  const rawProvider = String(process.env.NFSE_PROVIDER || 'cakto_native').trim().toLowerCase();
  const provider: FiscalProviderType = rawProvider === 'external_nfse' ? 'external_nfse' : 'cakto_native';
  const autoEmitEnabled =
    String(process.env.PAYMENTS_NFSE_AUTO_EMIT || 'false').trim().toLowerCase() === 'true';

  const missingConfig: string[] = [];

  if (!autoEmitEnabled) {
    missingConfig.push('PAYMENTS_NFSE_AUTO_EMIT=true');
  }
  if (!isValidCnpj(process.env.NFSE_ISSUER_CNPJ)) {
    missingConfig.push('NFSE_ISSUER_CNPJ (CNPJ válido do prestador)');
  }
  if (!String(process.env.NFSE_MUNICIPAL_INSCRIPTION || '').trim()) {
    missingConfig.push('NFSE_MUNICIPAL_INSCRIPTION (Inscrição Municipal)');
  }
  if (!String(process.env.NFSE_CNAE || '').trim()) {
    missingConfig.push('NFSE_CNAE');
  }
  if (!String(process.env.NFSE_SERVICE_CODE || '').trim()) {
    missingConfig.push('NFSE_SERVICE_CODE (código de serviço municipal / LC 116)');
  }
  if (!String(process.env.NFSE_MUNICIPAL_CODE || '').trim()) {
    missingConfig.push('NFSE_MUNICIPAL_CODE (código IBGE do município)');
  }

  if (provider === 'cakto_native') {
    if (String(process.env.NFSE_CERT_A1_CONFIGURED || 'false').trim().toLowerCase() !== 'true') {
      missingConfig.push('Certificado Digital A1 (.pfx/.p12) configurado no painel fiscal da Cakto (NFSE_CERT_A1_CONFIGURED=true)');
    }
  } else {
    if (!String(process.env.NFSE_API_TOKEN || '').trim()) {
      missingConfig.push('NFSE_API_TOKEN (token do provedor fiscal externo)');
    }
    if (!String(process.env.NFSE_API_BASE_URL || '').trim()) {
      missingConfig.push('NFSE_API_BASE_URL (endpoint REST do emissor NFS-e)');
    }
  }

  const ready = missingConfig.length === 0;
  const summary = ready
    ? `Emissão automática NFS-e pronta via ${provider}.`
    : `Emissão NFS-e bloqueada (fail-closed): ${missingConfig.length} requisito(s) fiscal(is) pendente(s).`;

  return {
    autoEmitEnabled,
    provider,
    ready,
    missingConfig,
    summary,
  };
}

export class FiscalInvoiceService {
  private async hasFiscalTable(): Promise<boolean> {
    if (!isPostgresConfigured()) return false;
    try {
      const reg = await executeSql(`SELECT to_regclass('internal.billing_fiscal_documents') IS NOT NULL AS ok`);
      return Boolean(reg.rows[0]?.ok);
    } catch {
      return false;
    }
  }

  async prepareOrQueueForPayment(input: PrepareFiscalDocumentInput): Promise<PrepareFiscalDocumentOutcome> {
    const readiness = getFiscalReadiness();
    const hasTable = await this.hasFiscalTable();
    const maskedDoc = maskTaxDocument(input.customerDocument);
    const amountCents = Math.max(100, Number(input.amountCents || 3490));

    if (!readiness.ready) {
      let rowId: string | undefined;
      if (hasTable) {
        const res = await executeSql(
          `INSERT INTO internal.billing_fiscal_documents (
            id, user_id, payment_id, provider_payment_id, fiscal_provider, status,
            customer_name, customer_document_masked, service_amount_cents, currency,
            service_code, municipal_code, error_history, metadata, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, 'PENDING_CONFIG',
            $5, $6, $7, 'BRL',
            NULLIF($8, ''), NULLIF($9, ''), $10::jsonb, $11::jsonb, NOW(), NOW()
          )
          ON CONFLICT (provider_payment_id) WHERE provider_payment_id IS NOT NULL DO UPDATE SET
            status = CASE
              WHEN internal.billing_fiscal_documents.status = 'AUTHORIZED' THEN internal.billing_fiscal_documents.status
              ELSE 'PENDING_CONFIG'
            END,
            error_history = internal.billing_fiscal_documents.error_history || $10::jsonb,
            updated_at = NOW()
          RETURNING id`,
          [
            input.userId,
            input.paymentId || null,
            input.providerPaymentId,
            readiness.provider,
            input.customerName || null,
            maskedDoc,
            amountCents,
            String(process.env.NFSE_SERVICE_CODE || '').trim(),
            String(process.env.NFSE_MUNICIPAL_CODE || '').trim(),
            JSON.stringify([
              {
                at: new Date().toISOString(),
                code: 'FISCAL_CONFIG_INCOMPLETE',
                missingConfig: readiness.missingConfig,
              },
            ]),
            JSON.stringify({ fail_closed: true }),
          ]
        );
        rowId = res.rows[0]?.id ? String(res.rows[0].id) : undefined;
      }

      return {
        id: rowId,
        status: 'PENDING_CONFIG',
        provider: readiness.provider,
        readyToEmit: false,
        missingConfig: readiness.missingConfig,
        message: readiness.summary,
      };
    }

    // Quando totalmente configurado, enfileira com segurança para despacho via adaptador fiscal externo/nativo
    let rowId: string | undefined;
    if (hasTable) {
      const res = await executeSql(
        `INSERT INTO internal.billing_fiscal_documents (
          id, user_id, payment_id, provider_payment_id, fiscal_provider, status,
          customer_name, customer_document_masked, service_amount_cents, currency,
          service_code, municipal_code, metadata, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, 'QUEUED',
          $5, $6, $7, 'BRL',
          $8, $9, $10::jsonb, NOW(), NOW()
        )
        ON CONFLICT (provider_payment_id) WHERE provider_payment_id IS NOT NULL DO UPDATE SET
          status = CASE
            WHEN internal.billing_fiscal_documents.status = 'AUTHORIZED' THEN internal.billing_fiscal_documents.status
            ELSE 'QUEUED'
          END,
          updated_at = NOW()
        RETURNING id, status`,
        [
          input.userId,
          input.paymentId || null,
          input.providerPaymentId,
          readiness.provider,
          input.customerName || null,
          maskedDoc,
          amountCents,
          String(process.env.NFSE_SERVICE_CODE || '').trim(),
          String(process.env.NFSE_MUNICIPAL_CODE || '').trim(),
          JSON.stringify({ queued_at: new Date().toISOString() }),
        ]
      );
      rowId = res.rows[0]?.id ? String(res.rows[0].id) : undefined;
    }

    return {
      id: rowId,
      status: 'QUEUED',
      provider: readiness.provider,
      readyToEmit: true,
      missingConfig: [],
      message: `Documento fiscal enfileirado para emissão via ${readiness.provider}.`,
    };
  }

  async listUserFiscalDocuments(userId: string): Promise<any[]> {
    if (!(await this.hasFiscalTable())) return [];
    const res = await executeSql(
      `SELECT id, provider_payment_id, fiscal_provider, status, service_amount_cents, currency,
              nfse_number, verification_code, xml_url, pdf_url, issued_at, created_at
       FROM internal.billing_fiscal_documents
       WHERE user_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    );
    return res.rows;
  }
}

export const fiscalInvoiceService = new FiscalInvoiceService();
