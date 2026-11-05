/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — Cliente Oficial da API ZynPay Gateway
 * 
 * Diretrizes de Segurança:
 * 1. ZERO geração de PIX fictício no servidor. Todo QR Code e Pix Copia e Cola deve vir da ZynPay.
 * 2. Se a ZynPay estiver indisponível, falhar com erro controlado (fail-closed seguro).
 * 3. Consultas server-to-server para confirmação confiável de estado e reconciliação.
 * 4. Validação de formato e tipagem nas respostas da API externa.
 */

import { getServerKeys } from './common';

export interface ZynPayOfficialChargeResponse {
  id: string;
  amount: number; // Centavos
  currency: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  description: string;
  qrCodeText: string;
  qrCodeBase64?: string;
  expirationDate?: string;
  createdAt: string;
}

export interface ZynPayOfficialBalanceResponse {
  available: number;
  pending: number;
  currency: string;
}

// -----------------------------------------------------------------------------
// ADAPTADOR ISOLADO PARA TESTES AUTOMATIZADOS DE UNIDADE
// -----------------------------------------------------------------------------
export interface TestZynPayGatewayAdapter {
  createCharge: (params: any) => Promise<ZynPayOfficialChargeResponse>;
  getCharge: (chargeId: string) => Promise<ZynPayOfficialChargeResponse | null>;
  getBalance: () => Promise<ZynPayOfficialBalanceResponse>;
}

let activeTestGateway: TestZynPayGatewayAdapter | null = null;

export function setTestZynPayGatewayAdapter(adapter: TestZynPayGatewayAdapter | null): void {
  const isTestEnv = process.env.NODE_ENV === 'test' || process.env.FATOSBR_TEST_MODE === 'true';
  if (!isTestEnv && adapter !== null) {
    throw new Error('SECURITY_VIOLATION: Adaptador de teste do gateway ZynPay não pode ser ativado em produção.');
  }
  activeTestGateway = adapter;
}

function getZynPayApiKey(): string {
  const keys = getServerKeys();
  const key = keys.ZYNPAY || process.env.ZYNPAY_API_KEY || '';
  return key.trim();
}

/**
 * Cria uma cobrança Pix real na API oficial da ZynPay conforme a documentação oficial:
 * Endpoint: POST /v1/public/pix/charges
 * Headers: Authorization: Bearer <API_KEY>, Idempotency-Key: <key>
 * Payload: { amountCents: number, description?: string, customer?: { name, email, taxId } }
 * NUNCA gera identificadores fictícios ou payloads EMV locais.
 */
export async function createPixChargeOnGateway(params: {
  amountCents: number;
  description: string;
  customer: {
    name: string;
    email: string;
    taxId?: string;
  };
  idempotencyKey?: string;
}): Promise<ZynPayOfficialChargeResponse> {
  if (activeTestGateway) {
    return activeTestGateway.createCharge(params);
  }

  const apiKey = getZynPayApiKey();
  if (!apiKey) {
    console.error('[ZynPay Gateway] Chave de API ZYNPAY não configurada no servidor.');
    throw new Error('GATEWAY_UNCONFIGURED: Chave de API oficial da ZynPay não está configurada no ambiente do servidor.');
  }

  // Contrato oficial da documentação ZynPay (POST /v1/public/pix/charges)
  const payload: {
    amountCents: number;
    description: string;
    customer: {
      name: string;
      email: string;
      taxId?: string;
    };
  } = {
    amountCents: params.amountCents,
    description: params.description,
    customer: {
      name: params.customer.name,
      email: params.customer.email,
      ...(params.customer.taxId ? { taxId: params.customer.taxId } : {})
    }
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };

  if (params.idempotencyKey) {
    // Header oficial estrito documentado pela ZynPay
    headers['Idempotency-Key'] = params.idempotencyKey;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout estrito

  try {
    const res = await fetch('https://api.zynpay.com.br/v1/public/pix/charges', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errMsg = errJson.message || errJson.error || errJson.details || errMsg;
      } catch {}
      console.error(`[ZynPay Gateway Error] Falha na criação da cobrança: ${errMsg}`);
      throw new Error(`GATEWAY_ERROR: ZynPay retornou status ${res.status} (${errMsg})`);
    }

    const data = await res.json();
    const chargeData = data.data || data;

    const chargeId = String(chargeData.id || '').trim();
    // Extrai o Pix Copia e Cola / BR Code dos campos oficiais documentados
    const qrCodeText = String(
      chargeData.pixCopyPaste ||
      chargeData.pixCode ||
      chargeData.pix?.copyPaste ||
      chargeData.pix?.code ||
      chargeData.qrCodeText ||
      ''
    ).trim();

    // Extrai o QR Code em imagem se fornecido pelo gateway
    const qrCodeBase64 = String(
      chargeData.qrCodeBase64 ||
      chargeData.qrCode ||
      chargeData.pix?.qrCode ||
      chargeData.pix?.qrCodeBase64 ||
      ''
    ).trim();

    const rawStatus = String(chargeData.status || 'PENDING').toUpperCase();
    const status = (rawStatus === 'PAID' || rawStatus === 'CONFIRMED') ? 'PAID' : 'PENDING';
    const amountCents = Number(chargeData.amountCents ?? chargeData.amount ?? params.amountCents);

    // Validação estrita: resposta incompleta deve ser rejeitada imediatamente sem mock
    if (!chargeId || !qrCodeText) {
      console.error('[ZynPay Gateway Error] Resposta do gateway incompleta ou sem dados de Pix válidos:', data);
      throw new Error('GATEWAY_INVALID_RESPONSE: Gateway oficial ZynPay retornou resposta incompleta (ID ou Copia-e-Cola ausentes).');
    }

    return {
      id: chargeId,
      amount: amountCents,
      currency: chargeData.currency || 'BRL',
      status,
      description: chargeData.description || params.description,
      qrCodeText,
      qrCodeBase64: qrCodeBase64 || undefined,
      expirationDate: chargeData.expirationDate || chargeData.expiresAt,
      createdAt: chargeData.createdAt || new Date().toISOString()
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error('[ZynPay Gateway Timeout] A chamada à API oficial da ZynPay expirou.');
      throw new Error('GATEWAY_TIMEOUT: Tempo limite de comunicação com a ZynPay excedido.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Consulta cobrança diretamente na API oficial da ZynPay para confirmação de estado.
 */
export async function fetchChargeFromGateway(chargeId: string): Promise<ZynPayOfficialChargeResponse | null> {
  if (activeTestGateway) {
    return activeTestGateway.getCharge(chargeId);
  }

  const apiKey = getZynPayApiKey();
  if (!apiKey) {
    throw new Error('GATEWAY_UNCONFIGURED: Chave de API da ZynPay ausente.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`https://api.zynpay.com.br/v1/public/pix/charges/${encodeURIComponent(chargeId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new Error(`GATEWAY_ERROR: Consulta na ZynPay retornou status ${res.status}`);
    }

    const data = await res.json();
    const chargeData = data.data || data;

    const rawStatus = String(chargeData.status || '').toUpperCase();
    let status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED' = 'PENDING';
    if (rawStatus === 'PAID' || rawStatus === 'CONFIRMED') status = 'PAID';
    else if (rawStatus === 'CANCELLED' || rawStatus === 'CANCELED') status = 'CANCELLED';
    else if (rawStatus === 'EXPIRED') status = 'EXPIRED';
    else if (rawStatus === 'FAILED') status = 'FAILED';

    const amountCents = Number(chargeData.amountCents ?? chargeData.amount ?? 0);
    const qrCodeText = String(
      chargeData.pixCopyPaste ||
      chargeData.pixCode ||
      chargeData.pix?.copyPaste ||
      chargeData.pix?.code ||
      chargeData.qrCodeText ||
      ''
    ).trim();

    return {
      id: String(chargeData.id || chargeId),
      amount: amountCents,
      currency: chargeData.currency || 'BRL',
      status,
      description: chargeData.description || '',
      qrCodeText,
      qrCodeBase64: chargeData.qrCodeBase64 || chargeData.qrCode || chargeData.pix?.qrCode || '',
      expirationDate: chargeData.expirationDate || chargeData.expiresAt,
      createdAt: chargeData.createdAt || new Date().toISOString()
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('GATEWAY_TIMEOUT: Tempo limite ao consultar cobrança na ZynPay.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Consulta saldo oficial na ZynPay para painel administrativo via GET /v1/public/pix/balance.
 */
export async function fetchBalanceFromGateway(): Promise<ZynPayOfficialBalanceResponse> {
  if (activeTestGateway) {
    return activeTestGateway.getBalance();
  }

  const apiKey = getZynPayApiKey();
  if (!apiKey) {
    throw new Error('GATEWAY_UNCONFIGURED: Chave de API da ZynPay ausente.');
  }

  const res = await fetch('https://api.zynpay.com.br/v1/public/pix/balance', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    throw new Error(`GATEWAY_ERROR: Erro ao consultar saldo na ZynPay (${res.status})`);
  }

  const data = await res.json();
  const bData = data.data || data;

  return {
    available: Number(bData.available ?? bData.availableCents ?? 0),
    pending: Number(bData.pending ?? bData.pendingCents ?? 0),
    currency: bData.currency || 'BRL'
  };
}
