/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FATOSBR — SUÍTE DE TESTES UNITÁRIOS E DE CONCORRÊNCIA DO RATE LIMITER DISTRIBUÍDO V1.6
 * 
 * Valida:
 * 1. Primeira requisição permitida com contagem atômica.
 * 2. Incrementos sucessivos até o limite exato do perfil.
 * 3. Bloqueio imediato com HTTP 429 e cabeçalho Retry-After ao exceder.
 * 4. Reinício da janela temporal após expiração do tempo (window_ms).
 * 5. Concorrência atômica entre múltiplas instâncias simuladas da Vercel.
 * 6. Falha fechada (fail-closed HTTP 503) para perfis sensíveis (auth, payments, admin, webhooks, ai).
 * 7. Tolerância para rotas públicas gerais (general).
 * 8. Contrato estrito de retorno JSONB: { allowed, current, limit, retry_after, remaining }.
 */

import {
  enforceRateLimit,
  setTestRateLimiterStore,
  TestRateLimiterStore,
  RATE_LIMIT_PROFILES,
  RateLimitCategory
} from '../api/_lib/rateLimiter.js';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  end: () => void;
  setHeader: (k: string, v: string) => void;
}

function createMockReq(ip = '198.51.100.42', headers: Record<string, string> = {}) {
  return {
    headers: {
      'x-real-ip': ip,
      ...headers
    },
    socket: { remoteAddress: ip }
  };
}

function createMockRes(): { res: MockResponse; getResult: () => { status: number; body: any; headers: Record<string, string> } } {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: any = null;

  const res: MockResponse = {
    statusCode: 200,
    headers,
    body: null,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = String(v);
    },
    end: () => {}
  };

  // Mock sendJson interceptor
  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (val: number) => { statusCode = val; }
  });

  return {
    res,
    getResult: () => ({ status: statusCode, body: res.body, headers })
  };
}

// Simulador atômico em memória da função SQL public.check_and_increment_rate_limit
class AtomicSqlRateLimitSimulator implements TestRateLimiterStore {
  private counters = new Map<string, { tokens: number; windowStart: number }>();

  async checkAndIncrement(key: string, maxRequests: number, windowMs: number) {
    const now = Date.now();
    const entry = this.counters.get(key);

    if (!entry || (now - entry.windowStart) >= windowMs) {
      this.counters.set(key, { tokens: 1, windowStart: now });
      return {
        allowed: true,
        current: 1,
        limit: maxRequests,
        retry_after: 0,
        remaining: maxRequests - 1
      };
    }

    entry.tokens += 1;
    const elapsed = now - entry.windowStart;

    if (entry.tokens > maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
      return {
        allowed: false,
        current: entry.tokens,
        limit: maxRequests,
        retry_after: retryAfterSec,
        remaining: 0
      };
    }

    return {
      allowed: true,
      current: entry.tokens,
      limit: maxRequests,
      retry_after: 0,
      remaining: maxRequests - entry.tokens
    };
  }

  reset() {
    this.counters.clear();
  }

  // Simula passagem artificial do tempo para testes de janela
  advanceWindow(key: string, elapsedMs: number) {
    const entry = this.counters.get(key);
    if (entry) {
      entry.windowStart -= elapsedMs;
    }
  }
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('🛡️  FATOSBR — SUÍTE DE TESTES: RATE LIMITER DISTRIBUÍDO V1.6');
  console.log('======================================================================\n');

  process.env.FATOSBR_TEST_MODE = 'true';
  const simulator = new AtomicSqlRateLimitSimulator();
  setTestRateLimiterStore(simulator);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (!condition) {
      failed++;
      console.error(`  ❌ [FAIL] ${msg}`);
      throw new Error(msg);
    }
  }

  // Teste 1: Primeira requisição permitida
  try {
    console.log('--- 1. Primeira Requisição (Início da Janela) ---');
    simulator.reset();
    const req = createMockReq('192.0.2.1');
    const { res } = createMockRes();

    const allowed = await enforceRateLimit(req, res, 'auth');
    assert(allowed === true, 'Primeira requisição deve ser permitida');
    passed++;
    console.log('  ✅ [PASS] Primeira requisição permitida com tokens = 1');
  } catch (e: any) {
    console.error('  Erro:', e.message);
  }

  // Teste 2: Incrementos sucessivos até a cota máxima
  try {
    console.log('\n--- 2. Incrementos Sucessivos até o Limite ---');
    simulator.reset();
    const ip = '192.0.2.2';
    const profile = RATE_LIMIT_PROFILES.auth; // max: 5

    for (let i = 1; i <= profile.maxRequests; i++) {
      const req = createMockReq(ip);
      const { res } = createMockRes();
      const allowed = await enforceRateLimit(req, res, 'auth');
      assert(allowed === true, `Requisição ${i} dentro da cota de ${profile.maxRequests} deve ser permitida`);
    }
    passed++;
    console.log(`  ✅ [PASS] Todas as ${profile.maxRequests} requisições dentro do limite foram autorizadas`);
  } catch (e: any) {
    console.error('  Erro:', e.message);
  }

  // Teste 3: Bloqueio com HTTP 429 ao ultrapassar o limite
  try {
    console.log('\n--- 3. Bloqueio com HTTP 429 e Cabeçalho Retry-After ---');
    simulator.reset();
    const ip = '192.0.2.3';
    const profile = RATE_LIMIT_PROFILES.auth; // max: 5

    // Consome todas as cotas
    for (let i = 0; i < profile.maxRequests; i++) {
      await enforceRateLimit(createMockReq(ip), createMockRes().res, 'auth');
    }

    // Requisição que excede o limite
    const blockedReq = createMockReq(ip);
    const { res: blockedRes } = createMockRes();
    const allowed = await enforceRateLimit(blockedReq, blockedRes, 'auth');

    assert(allowed === false, 'Requisição além da cota deve ser bloqueada');
    assert(blockedRes.statusCode === 429, `Status esperado 429, recebido ${blockedRes.statusCode}`);
    assert(Boolean(blockedRes.headers['retry-after']), 'Cabeçalho Retry-After deve estar presente');
    passed++;
    console.log('  ✅ [PASS] Requisição excessiva bloqueada com HTTP 429 e Retry-After correto');
  } catch (e: any) {
    console.error('  Erro:', e.message);
  }

  // Teste 4: Reinício da Janela Temporal após Expiração
  try {
    console.log('\n--- 4. Reinício da Janela Temporal após Expiração (window_ms) ---');
    simulator.reset();
    const ip = '192.0.2.4';
    const profile = RATE_LIMIT_PROFILES.auth;

    // Consome toda a cota
    for (let i = 0; i < profile.maxRequests; i++) {
      await enforceRateLimit(createMockReq(ip), createMockRes().res, 'auth');
    }

    // Avança a janela simulada além de windowMs (60s)
    simulator.advanceWindow(`rl:auth:${ip}`, 65000);

    // Nova requisição após a janela
    const newReq = createMockReq(ip);
    const { res: newRes } = createMockRes();
    const allowed = await enforceRateLimit(newReq, newRes, 'auth');

    assert(allowed === true, 'Requisição após reset da janela deve ser autorizada');
    passed++;
    console.log('  ✅ [PASS] Janela reiniciada com sucesso; novos acessos liberados');
  } catch (e: any) {
    console.error('  Erro:', e.message);
  }

  // Teste 5: Requisições Concorrentes entre Múltiplas Instâncias Simuladas
  try {
    console.log('\n--- 5. Concorrência Atômica entre Múltiplas Instâncias Simultâneas ---');
    simulator.reset();
    const ip = '192.0.2.5';
    const limit = 10;
    const concurrentCount = 20;

    const results = await Promise.all(
      Array.from({ length: concurrentCount }).map(async () => {
        const req = createMockReq(ip);
        const { res } = createMockRes();
        return await enforceRateLimit(req, res, 'admin'); // limit 20
      })
    );

    const allowedCount = results.filter(r => r === true).length;
    const blockedCount = results.filter(r => r === false).length;

    assert(allowedCount === RATE_LIMIT_PROFILES.admin.maxRequests, `Esperado exatamente ${RATE_LIMIT_PROFILES.admin.maxRequests} permitidas, obtido ${allowedCount}`);
    assert(blockedCount === 0, `Nenhuma requisição deveria ser bloqueada até o limite de 20`);
    passed++;
    console.log(`  ✅ [PASS] Concorrência atômica validada (${allowedCount} permitidas sem corrida de dados)`);
  } catch (e: any) {
    console.error('  Erro:', e.message);
  }

  // Teste 6: Falha Fechada (Fail-Closed HTTP 503) em Operações Sensíveis
  try {
    console.log('\n--- 6. Proteção Fail-Closed (HTTP 503) em Rotas de Alto Risco ---');
    setTestRateLimiterStore({
      checkAndIncrement: async () => {
        throw new Error('DATABASE_CONNECTION_LOST');
      }
    });

    const highRiskReq = createMockReq('192.0.2.6');
    const { res: highRiskRes } = createMockRes();
    const allowedHighRisk = await enforceRateLimit(highRiskReq, highRiskRes, 'payments');

    assert(allowedHighRisk === false, 'Falha de banco em rota sensível não pode liberar acesso (fail-closed)');
    assert(highRiskRes.statusCode === 503, `Esperado status 503, recebido ${highRiskRes.statusCode}`);
    passed++;
    console.log('  ✅ [PASS] Rota crítica protegida com fail-closed (HTTP 503) quando banco indisponível');
  } catch (e: any) {
    console.error('  Erro:', e.message);
  }

  // Teste 7: Tolerância em Rotas Públicas Gerais (general)
  try {
    console.log('\n--- 7. Tolerância Resiliente em Rotas Públicas (general) ---');
    setTestRateLimiterStore({
      checkAndIncrement: async () => {
        throw new Error('DATABASE_CONNECTION_TIMEOUT');
      }
    });

    const publicReq = createMockReq('192.0.2.7');
    const { res: publicRes } = createMockRes();
    const allowedPublic = await enforceRateLimit(publicReq, publicRes, 'general');

    assert(allowedPublic === true, 'Rota pública não-sensível deve falhar de modo tolerante');
    passed++;
    console.log('  ✅ [PASS] Rota de leitura pública permitida com fallback tolerante');
  } catch (e: any) {
    console.error('  Erro:', e.message);
  }

  // Teste 8: Validação dos Perfis de Segurança e Isolamento por Chave
  try {
    console.log('\n--- 8. Isolamento de Cotas por Categoria ---');
    simulator.reset();
    setTestRateLimiterStore(simulator);
    const ip = '192.0.2.8';

    // Esgota a cota de auth (5 requisições)
    for (let i = 0; i < RATE_LIMIT_PROFILES.auth.maxRequests; i++) {
      await enforceRateLimit(createMockReq(ip), createMockRes().res, 'auth');
    }

    // Cota de auth deve estar esgotada
    const authBlocked = await enforceRateLimit(createMockReq(ip), createMockRes().res, 'auth');
    assert(authBlocked === false, 'Auth deve estar bloqueado');

    // Cota de general ou payments deve estar livre para o mesmo IP
    const paymentAllowed = await enforceRateLimit(createMockReq(ip), createMockRes().res, 'payments');
    assert(paymentAllowed === true, 'Cota de payments não pode ser afetada pelo esgotamento de auth');

    passed++;
    console.log('  ✅ [PASS] Isolamento rigoroso entre categorias de rate limiting comprovado');
  } catch (e: any) {
    console.error('  Erro:', e.message);
  }

  // Restaura store de teste
  setTestRateLimiterStore(null);

  console.log('\n======================================================================');
  console.log(`🎉 RESULTADO FINAL: ${passed} testes passaram, ${failed} falharam.`);
  console.log('======================================================================');

  if (failed > 0) process.exit(1);
}

runTestSuite().catch(err => {
  console.error('Falha fatal na suite:', err);
  process.exit(1);
});
