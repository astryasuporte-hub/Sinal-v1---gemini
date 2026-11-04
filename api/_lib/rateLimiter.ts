/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Distributed & Atomic Rate Limiter Layer (Supabase PostgreSQL)
 * 
 * Substitui o armazenamento efêmero em memória por contadores atômicos persistentes no banco de dados.
 * Garante bloqueio consistente entre múltiplas instâncias serverless da Vercel.
 */

import { getClientIp, sendJson } from './common';
import { getServerSupabase, isDatabaseConfigured } from './db';

export type RateLimitCategory = 'auth' | 'payments' | 'admin' | 'webhooks' | 'ai' | 'general';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  isHighRisk: boolean; // Se true, falha no banco de dados resulta em bloqueio (fail-closed)
}

export const RATE_LIMIT_PROFILES: Record<RateLimitCategory, RateLimitConfig> = {
  auth: { maxRequests: 5, windowMs: 60000, isHighRisk: true },
  payments: { maxRequests: 15, windowMs: 60000, isHighRisk: true },
  admin: { maxRequests: 20, windowMs: 60000, isHighRisk: true },
  webhooks: { maxRequests: 60, windowMs: 60000, isHighRisk: true },
  ai: { maxRequests: 20, windowMs: 60000, isHighRisk: true },
  general: { maxRequests: 60, windowMs: 60000, isHighRisk: false }
};

// Interface para mocks e testes unitários isolados
export interface TestRateLimiterStore {
  checkAndIncrement: (key: string, maxRequests: number, windowMs: number) => Promise<{
    allowed: boolean;
    current: number;
    limit: number;
    retry_after: number;
    remaining: number;
  }>;
}

let activeTestStore: TestRateLimiterStore | null = null;

export function setTestRateLimiterStore(store: TestRateLimiterStore | null): void {
  const isTestEnv = process.env.NODE_ENV === 'test' || process.env.FATOSBR_TEST_MODE === 'true';
  if (!isTestEnv && store !== null) {
    throw new Error('SECURITY_VIOLATION: Store de teste de rate limit não pode ser ativado em produção.');
  }
  activeTestStore = store;
}

/**
 * Executa a checagem e incremento atômico de taxa no PostgreSQL.
 * Retorna true se a requisição for permitida; se bloqueada, escreve a resposta HTTP 429 e retorna false.
 */
export async function enforceRateLimit(
  req: any,
  res: any,
  category: RateLimitCategory = 'general',
  customKeySuffix?: string
): Promise<boolean> {
  const ip = getClientIp(req);
  const profile = RATE_LIMIT_PROFILES[category] || RATE_LIMIT_PROFILES.general;
  const key = `rl:${category}:${customKeySuffix ? `${customKeySuffix}:` : ''}${ip}`;

  let result = {
    allowed: true,
    current: 1,
    limit: profile.maxRequests,
    retry_after: 0,
    remaining: profile.maxRequests - 1
  };

  try {
    // 1. Caso haja mock de teste ativo explicitamente configurado
    if (activeTestStore) {
      result = await activeTestStore.checkAndIncrement(key, profile.maxRequests, profile.windowMs);
    } else {
      // 2. Ambiente de Produção / Staging: Execução da RPC atômica no Supabase PostgreSQL
      if (!isDatabaseConfigured()) {
        if (profile.isHighRisk) {
          // Fail-closed para endpoints sensíveis (pagamentos, auth, admin, webhook)
          console.error(`[Rate Limit Security] Bloqueio fail-closed ativo para ${key}: Banco de dados indisponível.`);
          sendJson(res, 503, {
            error: 'Serviço temporariamente indisponível. Medida de segurança ativa para operações sensíveis.',
            code: 'RATE_LIMIT_STORE_UNAVAILABLE'
          });
          return false;
        }
        // Fail-safe para rotas gerais de leitura pública
        return true;
      }

      const supabase = getServerSupabase();
      const { data, error } = await supabase.rpc('check_and_increment_rate_limit', {
        p_key: key,
        p_max_requests: profile.maxRequests,
        p_window_ms: profile.windowMs
      });

      if (error) {
        throw error;
      }

      if (data) {
        result = {
          allowed: Boolean(data.allowed),
          current: Number(data.current || 1),
          limit: Number(data.limit || profile.maxRequests),
          retry_after: Number(data.retry_after || 0),
          remaining: Number(data.remaining ?? 0)
        };
      }
    }
  } catch (err: any) {
    console.error(`[Rate Limit Store Failure] Falha ao verificar taxa para ${key}:`, err.message);

    // Endpoints de alto risco nunca podem ter acesso liberado quando o limitador falhar
    if (profile.isHighRisk) {
      sendJson(res, 503, {
        error: 'Falha temporária ao validar cota de requisições. Tente novamente em instantes.',
        code: 'RATE_LIMIT_CHECK_FAILED'
      });
      return false;
    }

    return true;
  }

  // Se excedeu a cota, responde com 429 Too Many Requests e cabeçalho Retry-After
  if (!result.allowed) {
    const retryAfterSec = Math.max(1, result.retry_after);
    sendJson(
      res,
      429,
      {
        error: 'Limite de requisições excedido. Aguarde antes de tentar novamente.',
        code: 'RATE_LIMIT_EXCEEDED',
        category,
        retryAfter: retryAfterSec
      },
      {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil((Date.now() + retryAfterSec * 1000) / 1000))
      }
    );
    return false;
  }

  return true;
}
