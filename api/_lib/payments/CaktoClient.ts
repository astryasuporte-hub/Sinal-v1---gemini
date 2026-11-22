/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CaktoClient — Cliente HTTP Server-Side Oficial para API Cakto
 *
 * Segurança:
 * - Autenticação OAuth2 client_credentials em https://api.cakto.com.br/public_api/token/
 * - Timeout estrito via AbortController (8s)
 * - Allowlist SSRF estrita (api.cakto.com.br)
 * - ZERO exposição ou log de client_id / client_secret / access_token
 */

import { isAllowedDomain } from '../common.js';

const CAKTO_API_BASE = 'https://api.cakto.com.br/public_api';
const REQUEST_TIMEOUT_MS = 8000;

export interface CaktoTokenCacheEntry {
  accessToken: string;
  expiresAtMs: number;
}

let cachedToken: CaktoTokenCacheEntry | null = null;

export function clearCaktoTokenCache(): void {
  cachedToken = null;
}

export interface CaktoApiResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export class CaktoClient {
  private getCredentials(): { clientId: string; clientSecret: string } {
    return {
      clientId: (process.env.CAKTO_CLIENT_ID || '').trim(),
      clientSecret: (process.env.CAKTO_CLIENT_SECRET || '').trim(),
    };
  }

  isConfigured(): boolean {
    const { clientId, clientSecret } = this.getCredentials();
    return Boolean(clientId && clientSecret);
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    if (!isAllowedDomain(url)) {
      throw new Error(`SSRF_BLOCKED: Domínio não permitido para chamada Cakto (${url}).`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAtMs - 30_000) {
      return cachedToken.accessToken;
    }

    const { clientId, clientSecret } = this.getCredentials();
    if (!clientId || !clientSecret) {
      throw new Error('CAKTO_CREDENTIALS_MISSING: CAKTO_CLIENT_ID ou CAKTO_CLIENT_SECRET ausente.');
    }

    const tokenUrl = `${CAKTO_API_BASE}/token/`;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
    });

    const res = await this.fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`CAKTO_AUTH_FAILED: HTTP ${res.status} ao obter token OAuth2 da Cakto.`);
    }

    const json: any = await res.json();
    const accessToken = String(json?.access_token || '').trim();
    const expiresInSec = Math.max(60, Number(json?.expires_in || 36000));

    if (!accessToken) {
      throw new Error('CAKTO_AUTH_INVALID: access_token ausente na resposta da Cakto.');
    }

    cachedToken = {
      accessToken,
      expiresAtMs: Date.now() + expiresInSec * 1000,
    };

    return accessToken;
  }

  async request<T = any>(path: string, init: RequestInit = {}): Promise<CaktoApiResponse<T>> {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${CAKTO_API_BASE}${cleanPath}`;

    try {
      let token = await this.getAccessToken(false);
      let res = await this.fetchWithTimeout(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401) {
        token = await this.getAccessToken(true);
        res = await this.fetchWithTimeout(url, {
          ...init,
          headers: {
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers || {}),
            Authorization: `Bearer ${token}`,
          },
        });
      }

      const text = await res.text();
      let parsed: any = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          data: parsed,
          error: parsed?.detail || parsed?.message || `HTTP ${res.status}`,
        };
      }

      return {
        ok: true,
        status: res.status,
        data: parsed,
      };
    } catch (err: any) {
      return {
        ok: false,
        status: 502,
        error: err?.name === 'AbortError' ? 'CAKTO_TIMEOUT' : err?.message || 'CAKTO_REQUEST_FAILED',
      };
    }
  }

  async getProduct(productId: string): Promise<CaktoApiResponse> {
    return this.request(`/products/${encodeURIComponent(productId)}/`, { method: 'GET' });
  }

  async getOffer(offerId: string): Promise<CaktoApiResponse> {
    return this.request(`/offers/${encodeURIComponent(offerId)}/`, { method: 'GET' });
  }

  async getCheckout(checkoutId: string): Promise<CaktoApiResponse> {
    return this.request(`/checkouts/${encodeURIComponent(checkoutId)}/`, { method: 'GET' });
  }

  async getOrder(orderId: string): Promise<CaktoApiResponse> {
    return this.request(`/orders/${encodeURIComponent(orderId)}/`, { method: 'GET' });
  }

  async listOrders(params: { search?: string; status?: string; limit?: number } = {}): Promise<CaktoApiResponse> {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    if (params.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request(`/orders/${suffix}`, { method: 'GET' });
  }

  async getSubscription(subscriptionId: string): Promise<CaktoApiResponse> {
    return this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}/`, { method: 'GET' });
  }

  async cancelSubscription(subscriptionId: string): Promise<CaktoApiResponse> {
    return this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel/`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getBillingCycles(subscriptionId: string): Promise<CaktoApiResponse> {
    return this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}/billing-cycles/`, {
      method: 'GET',
    });
  }
}

export const caktoClient = new CaktoClient();
