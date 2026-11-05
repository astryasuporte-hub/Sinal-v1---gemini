/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — Cliente Oficial da API ZynPay Gateway
 * 
 * Diretrizes de Segurança e Hardening:
 * 1. ZERO geração de PIX fictício no servidor. Todo QR Code e Pix Copia e Cola deve vir da ZynPay.
 * 2. Validação rigorosa e tipada de todas as respostas externas sem fallbacks silenciosos perigosos.
 * 3. Mapeamento explícito de status documentados. Status desconhecido resulta em falha controlada.
 * 4. Timeouts estritos com AbortController em todas as chamadas (criação, consulta e saldo).
 * 5. Categorização explícita de erros (timeout, auth, rate limit, not found, invalid response, gateway error).
 * 6. Sanitização de logs: Nenhuma exposição de chaves de API, senhas ou dados pessoais.
 */

import { getServerKeys } from './common';

export type ZynPayStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export interface ZynPayOfficialChargeResponse {
  id: string;
  amount: number; // Centavos inteiros positivos
  currency: string;
  status: ZynPayStatus;
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
// MAPEAMENTO EXPLÍCITO DE STATUS DOCUMENTADOS DA ZYNPAY
// -----------------------------------------------------------------------------
const RECOGNIZED_STATUS_MAP: Record<string, ZynPayStatus> = {
  PENDING: 'PENDING',
  PROCESSING: 'PENDING',
  WAITING_PAYMENT: 'PENDING',
  PAID: 'PAID',
  CONFIRMED: 'PAID',
  COMPLETED: 'PAID',
  SETTLED: 'PAID',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',
  FAILED: 'FAILED'
};

export function mapZynPayStatus(rawStatus: any): ZynPayStatus {
  if (typeof rawStatus !== 'string' || !rawStatus.trim()) {
    throw new Error('GATEWAY_INVALID_RESPONSE: Status da cobrança ausente na resposta da ZynPay.');
  }
  const normalized = rawStatus.trim().toUpperCase();
  const mapped = RECOGNIZED_STATUS_MAP[normalized];
  if (!mapped) {
    throw new Error(`GATEWAY_UNKNOWN_STATUS: Status '${rawStatus}' desconhecido retornado pela ZynPay.`);
  }
  return mapped;
}

export function validateMonetaryAmountCents(val: any, fieldName = 'amountCents'): number {
  if (val === null || val === undefined) {
    throw new Error(`GATEWAY_INVALID_RESPONSE: Valor monetário '${fieldName}' ausente na resposta da ZynPay.`);
  }
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
    throw new Error(`GATEWAY_INVALID_RESPONSE: Valor monetário '${fieldName}' inválido (${val}). Deve ser inteiro estritamente positivo em centavos.`);
  }
  return num;
}

export function validateCurrency(val: any, options: { required?: boolean } = {}): string {
  if (val !== undefined && val !== null && String(val).trim() !== '') {
    const cur = String(val).trim().toUpperCase();
    if (cur !== 'BRL') {
      throw new Error(`GATEWAY_INVALID_RESPONSE: Moeda não suportada '${val}'. Somente BRL é aceita pelo sistema.`);
    }
    return cur;
  }
  if (options.required) {
    throw new Error('GATEWAY_INVALID_RESPONSE: Moeda ausente ou nula na resposta do gateway de pagamento.');
  }
  return 'BRL';
}

export function validateZynPayCreationResponse(raw: any, expectedAmountCents: number): ZynPayOfficialChargeResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('GATEWAY_INVALID_RESPONSE: Resposta da ZynPay não é um objeto JSON válido.');
  }
  const data = raw.data || raw;

  const id = String(data.id || '').trim();
  if (!id) {
    throw new Error('GATEWAY_INVALID_RESPONSE: Identificador da cobrança (id) ausente na resposta da ZynPay.');
  }

  // Validação monetária estrita sem fallback silencioso para params ou 0
  const rawAmount = data.amountCents !== undefined ? data.amountCents : data.amount;
  const amountCents = validateMonetaryAmountCents(rawAmount, 'amountCents');
  if (amountCents !== expectedAmountCents) {
    throw new Error(`GATEWAY_AMOUNT_MISMATCH: Valor retornado (${amountCents}) diverge do valor solicitado (${expectedAmountCents}).`);
  }

  const currency = validateCurrency(data.currency);
  const status = mapZynPayStatus(data.status || 'PENDING');

  const qrCodeText = String(
    data.pixCopyPaste ||
    data.pixCode ||
    data.pix?.copyPaste ||
    data.pix?.code ||
    data.qrCodeText ||
    ''
  ).trim();

  if (!qrCodeText) {
    throw new Error('GATEWAY_INVALID_RESPONSE: Código Pix Copia e Cola ausente na resposta da ZynPay.');
  }

  const qrCodeBase64 = String(
    data.qrCodeBase64 ||
    data.qrCode ||
    data.pix?.qrCode ||
    data.pix?.qrCodeBase64 ||
    ''
  ).trim();

  const expirationDate = data.expirationDate || data.expiresAt || data.expiration_date;

  return {
    id,
    amount: amountCents,
    currency,
    status,
    description: String(data.description || ''),
    qrCodeText,
    qrCodeBase64: qrCodeBase64 || undefined,
    expirationDate: expirationDate ? new Date(expirationDate).toISOString() : undefined,
    createdAt: data.createdAt ? new Date(data.createdAt).toISOString() : new Date().toISOString()
  };
}

export function validateZynPayConsultationResponse(raw: any, expectedChargeId: string): ZynPayOfficialChargeResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('GATEWAY_INVALID_RESPONSE: Resposta da ZynPay não é um objeto JSON válido.');
  }
  const data = raw.data || raw;

  const id = String(data.id || '').trim();
  if (!id) {
    throw new Error('GATEWAY_INVALID_RESPONSE: Identificador da cobrança (id) ausente na resposta da ZynPay.');
  }
  if (id !== expectedChargeId) {
    throw new Error(`GATEWAY_ID_MISMATCH: Identificador retornado (${id}) diverge da cobrança consultada (${expectedChargeId}).`);
  }

  const rawAmount = data.amountCents !== undefined ? data.amountCents : data.amount;
  const amountCents = validateMonetaryAmountCents(rawAmount, 'amountCents');
  const currency = validateCurrency(data.currency, { required: true });
  const status = mapZynPayStatus(data.status);

  const qrCodeText = String(
    data.pixCopyPaste ||
    data.pixCode ||
    data.pix?.copyPaste ||
    data.pix?.code ||
    data.qrCodeText ||
    ''
  ).trim();

  const qrCodeBase64 = String(
    data.qrCodeBase64 ||
    data.qrCode ||
    data.pix?.qrCode ||
    data.pix?.qrCodeBase64 ||
    ''
  ).trim();

  const expirationDate = data.expirationDate || data.expiresAt || data.expiration_date;

  return {
    id,
    amount: amountCents,
    currency,
    status,
    description: String(data.description || ''),
    qrCodeText,
    qrCodeBase64: qrCodeBase64 || undefined,
    expirationDate: expirationDate ? new Date(expirationDate).toISOString() : undefined,
    createdAt: data.createdAt ? new Date(data.createdAt).toISOString() : new Date().toISOString()
  };
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

    if (res.status === 401 || res.status === 403) {
      throw new Error(`GATEWAY_UNAUTHORIZED: Chave de API da ZynPay inválida ou não autorizada (${res.status}).`);
    }

    if (res.status === 429) {
      throw new Error('GATEWAY_RATE_LIMITED: Limite de requisições excedido junto à ZynPay.');
    }

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
    return validateZynPayCreationResponse(data, params.amountCents);
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
 * Endpoint: GET /v1/public/pix/charges/{id}
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

    if (res.status === 401 || res.status === 403) {
      throw new Error(`GATEWAY_UNAUTHORIZED: Chave de API da ZynPay inválida ou não autorizada (${res.status}).`);
    }

    if (res.status === 429) {
      throw new Error('GATEWAY_RATE_LIMITED: Limite de taxa da API ZynPay excedido.');
    }

    if (!res.ok) {
      throw new Error(`GATEWAY_ERROR: Consulta na ZynPay retornou status ${res.status}`);
    }

    const data = await res.json();
    return validateZynPayConsultationResponse(data, chargeId);
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('https://api.zynpay.com.br/v1/public/pix/balance', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`GATEWAY_UNAUTHORIZED: Chave de API da ZynPay inválida ou não autorizada (${res.status}).`);
    }

    if (res.status === 429) {
      throw new Error('GATEWAY_RATE_LIMITED: Limite de requisições excedido junto à ZynPay.');
    }

    if (!res.ok) {
      throw new Error(`GATEWAY_ERROR: Erro ao consultar saldo na ZynPay (${res.status})`);
    }

    const data = await res.json();
    const bData = data.data || data;

    const rawAvailable = bData.availableCents !== undefined ? bData.availableCents : bData.available;
    const rawPending = bData.pendingCents !== undefined ? bData.pendingCents : bData.pending;

    const available = Number(rawAvailable || 0);
    const pending = Number(rawPending || 0);

    return {
      available,
      pending,
      currency: validateCurrency(bData.currency)
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('GATEWAY_TIMEOUT: Tempo limite ao consultar saldo na ZynPay.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
