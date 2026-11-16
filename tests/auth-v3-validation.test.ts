/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Suíte Automatizada de Validação — FatosBR Auth V3.0 & Auth V3.1
 *
 * ATENÇÃO (Transparência de Testes):
 * - Testes de banco/Supabase em `userService` utilizam cliente Supabase MOCKADO em memória
 *   para validar consultas `.eq('user_id', ...)`, tabelas canônicas `user_*_follows`,
 *   máquina de estados de onboarding e comportamento em falhas de rede/DB.
 * - Testes de templates, SQL e endpoints `/api/auth/*` validam arquivos reais e handlers
 *   com store de rate limiter mockado em memória.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.FATOSBR_TEST_MODE = 'true';
process.env.NODE_ENV = 'test';

import { translateAuthError, validatePasswordRequirements, authService } from '../src/services/authService.js';
import { userService, setTestUserServiceClient } from '../src/services/userService.js';
import { setTestRateLimiterStore } from '../api/_lib/rateLimiter.js';
import authRouter from '../api/auth/[...action].js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`❌ [FAIL] ${name}: ${err?.message || err}`);
    failed++;
  }
}

function createMockReq(options: { method: string; url: string; body?: any }) {
  const rawBody = options.body ? JSON.stringify(options.body) : '';
  return {
    method: options.method,
    url: options.url,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: async function* () {
      if (rawBody) yield Buffer.from(rawBody);
    },
  };
}

function createMockRes() {
  let statusCode = 200;
  let body = '';
  const headers: Record<string, any> = {};
  const res = {
    setHeader: (k: string, v: any) => {
      headers[k.toLowerCase()] = v;
    },
    getHeader: (k: string) => headers[k.toLowerCase()],
    set statusCode(code: number) {
      statusCode = code;
    },
    get statusCode() {
      return statusCode;
    },
    end: (chunk?: any) => {
      if (chunk) body += String(chunk);
    },
  };
  return {
    res,
    result: () => ({
      statusCode,
      json: body ? JSON.parse(body) : null,
    }),
  };
}

interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  filters: Array<{ col: string; val: any }>;
  payload?: any;
  options?: any;
}

function createMockSupabase(config: {
  profilesRow?: Record<string, any> | null;
  profilesError?: { code?: string; message: string } | null;
  follows?: {
    user_topic_follows?: Array<{ user_id: string; topic_id: string }>;
    user_entity_follows?: Array<{ user_id: string; entity_id: string }>;
    user_source_follows?: Array<{ user_id: string; source_id: string }>;
  };
  followsError?: { code?: string; message: string } | null;
  updateRows?: any[];
  updateError?: { code?: string; message: string } | null;
  insertError?: { code?: string; message: string } | null;
  throwOnProfiles?: boolean;
}) {
  const calls: RecordedCall[] = [];
  const state = {
    profile: config.profilesRow ? { ...config.profilesRow } : null,
  };

  const from = (table: string) => {
    const call: RecordedCall = { table, op: 'select', filters: [] };

    const builder: any = {
      select: (_cols?: string) => builder,
      eq: (col: string, val: any) => {
        call.filters.push({ col, val });
        return builder;
      },
      insert: (payload: any) => {
        call.op = 'insert';
        call.payload = payload;
        calls.push(call);
        if (config.insertError) {
          return Promise.resolve({ data: null, error: config.insertError });
        }
        if (table === 'profiles') {
          state.profile = { id: 'row-uuid-generated', ...payload };
        }
        return Promise.resolve({ data: [state.profile], error: null });
      },
      update: (payload: any) => {
        call.op = 'update';
        call.payload = payload;
        const updateBuilder: any = {
          eq: (col: string, val: any) => {
            call.filters.push({ col, val });
            return updateBuilder;
          },
          select: () => {
            calls.push(call);
            if (config.updateError) {
              return Promise.resolve({ data: null, error: config.updateError });
            }
            if (table === 'profiles' && state.profile && call.filters.some((f) => f.col === 'user_id' && f.val === state.profile?.user_id)) {
              state.profile = { ...state.profile, ...payload };
              return Promise.resolve({ data: config.updateRows ?? [state.profile], error: null });
            }
            return Promise.resolve({ data: config.updateRows ?? [], error: null });
          },
          then: (resolve: any) => {
            calls.push(call);
            if (config.updateError) {
              return resolve({ data: null, error: config.updateError });
            }
            if (table === 'profiles' && state.profile && call.filters.some((f) => f.col === 'user_id' && f.val === state.profile?.user_id)) {
              state.profile = { ...state.profile, ...payload };
            }
            return resolve({ data: state.profile ? [state.profile] : [], error: null });
          },
        };
        return updateBuilder;
      },
      upsert: (payload: any, options?: any) => {
        call.op = 'upsert';
        call.payload = payload;
        call.options = options;
        calls.push(call);
        return Promise.resolve({ data: payload, error: null });
      },
      delete: () => {
        call.op = 'delete';
        const deleteBuilder: any = {
          eq: (col: string, val: any) => {
            call.filters.push({ col, val });
            return deleteBuilder;
          },
          then: (resolve: any) => {
            calls.push(call);
            return resolve({ data: null, error: null });
          },
        };
        return deleteBuilder;
      },
      maybeSingle: async () => {
        calls.push(call);
        if (table === 'profiles') {
          if (config.throwOnProfiles) {
            throw new Error('Network timeout');
          }
          if (config.profilesError) {
            return { data: null, error: config.profilesError };
          }
          const userIdFilter = call.filters.find((f) => f.col === 'user_id')?.val;
          if (state.profile && state.profile.user_id === userIdFilter) {
            return { data: state.profile, error: null };
          }
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: any) => {
        calls.push(call);
        if (table === 'user_topic_follows' || table === 'user_entity_follows' || table === 'user_source_follows') {
          if (config.followsError) {
            return resolve({ data: null, error: config.followsError });
          }
          const rows = (config.follows?.[table] || []).filter((r) =>
            call.filters.every((f) => (r as any)[f.col] === f.val)
          );
          return resolve({ data: rows, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };

    return builder;
  };

  return { client: { from }, calls, state };
}

async function main() {
  console.log('\n======================================================');
  console.log('🔐 FATOSBR AUTH V3.0 + V3.1 — SUÍTE DE VALIDAÇÃO');
  console.log('======================================================\n');

  // 1. Tradução de erros para PT-BR
  await test('1.1 Traduz credenciais inválidas para PT-BR claro', () => {
    const res = translateAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'signin');
    assert.equal(res.code, 'INVALID_CREDENTIALS');
    assert.match(res.message, /E-mail ou senha incorretos/i);
  });

  await test('1.2 Traduz OTP inválido/expirado/reutilizado para PT-BR', () => {
    const res = translateAuthError({ code: 'otp_expired', message: 'Token has expired or is invalid' }, 'otp');
    assert.equal(res.code, 'OTP_INVALID_OR_EXPIRED');
    assert.match(res.message, /Código inválido, expirado ou já utilizado/i);
  });

  await test('1.3 Traduz rate limit preservando segundos restantes', () => {
    const res = translateAuthError(
      { code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' },
      'otp'
    );
    assert.equal(res.code, 'RATE_LIMITED');
    assert.match(res.message, /42 segundos/);
  });

  await test('1.4 Traduz usuário inexistente no OTP login (shouldCreateUser: false)', () => {
    const res = translateAuthError({ code: 'otp_disabled', message: 'Signups not allowed for otp' }, 'signin');
    assert.equal(res.code, 'USER_NOT_FOUND');
    assert.match(res.message, /Não encontramos uma conta/i);
  });

  await test('1.5 Traduz conta já cadastrada, senha fraca, sessão expirada e falha de rede', () => {
    assert.equal(translateAuthError({ message: 'User already registered' }, 'signup').code, 'USER_ALREADY_REGISTERED');
    assert.equal(translateAuthError({ message: 'Password should be at least 6 characters' }, 'signup').code, 'WEAK_PASSWORD');
    assert.equal(translateAuthError({ message: 'Auth session missing!' }, 'password_update').code, 'SESSION_EXPIRED');
    assert.equal(translateAuthError(new Error('Failed to fetch'), 'signin').code, 'NETWORK_ERROR');
  });

  // 2. Requisitos de senha
  await test('2.1 Valida requisitos mínimos de senha corretamente', () => {
    assert.equal(validatePasswordRequirements('abc123').isValid, false);
    assert.equal(validatePasswordRequirements('abcdefgh').isValid, false);
    assert.equal(validatePasswordRequirements('12345678').isValid, false);
    assert.equal(validatePasswordRequirements('Fatos2026').isValid, true);
  });

  // 3. Regras estruturais do authService (zero Magic Link / zero local OTP)
  await test('3.1 authService não expõe signInWithMagicLink nem verifyBackendOtp nem sendLoginOtp', () => {
    assert.equal((authService as any).signInWithMagicLink, undefined);
    assert.equal((authService as any).verifyBackendOtp, undefined);
    assert.equal((authService as any).sendLoginOtp, undefined);
  });

  await test('3.2 authService rejeita OTP com formato diferente de 6 dígitos', async () => {
    const partialRes = await authService.verifyOtp('teste@fatosbr.com.br', '123', 'email');
    assert.equal(partialRes.success, false);
  });

  // 4. Templates HTML oficiais do Supabase
  await test('4.1 Templates de e-mail usam {{ .Token }}, sem Magic Link e sem referência a Sinal', () => {
    const templatesDir = path.resolve(process.cwd(), 'supabase/email-templates');
    const files = ['magic_link_otp.html', 'confirm_signup.html', 'reset_password.html'];

    for (const file of files) {
      const fullPath = path.join(templatesDir, file);
      assert.ok(fs.existsSync(fullPath), `${file} deve existir`);
      const html = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(html.includes('{{ .Token }}'), `${file} deve conter {{ .Token }}`);
      assert.ok(html.includes('{{ .Email }}'), `${file} deve conter {{ .Email }}`);
      assert.ok(!html.includes('ConfirmationURL'), `${file} não pode conter Magic Link ConfirmationURL`);
      assert.ok(!/\bsinal\b/i.test(html), `${file} não pode conter referência antiga à marca Sinal`);
      assert.ok(!html.includes('<script'), `${file} não pode conter scripts`);
      assert.ok(!/<img\s/i.test(html), `${file} não deve depender de imagens externas bloqueáveis`);
      assert.ok(html.includes('#050505') && html.includes('#111216'), `${file} deve seguir paleta escura FatosBR`);
    }
  });

  // 5. Hardening dos handlers legados de /api/auth/*
  setTestRateLimiterStore({
    checkAndIncrement: async (_key, maxRequests) => ({
      allowed: true,
      current: 1,
      limit: maxRequests,
      retry_after: 0,
      remaining: Math.max(0, maxRequests - 1),
    }),
  });

  await test('5.1 /api/auth/send-otp bloqueia disparo paralelo com 410 LEGACY_OTP_DISABLED', async () => {
    const emptyReq = createMockReq({ method: 'POST', url: '/api/auth/send-otp', body: {} });
    const emptyMock = createMockRes();
    await authRouter(emptyReq, emptyMock.res);
    assert.equal(emptyMock.result().statusCode, 400);

    const validReq = createMockReq({ method: 'POST', url: '/api/auth/send-otp', body: { email: 'user@fatosbr.com.br' } });
    const validMock = createMockRes();
    await authRouter(validReq, validMock.res);
    assert.equal(validMock.result().statusCode, 410);
    assert.equal(validMock.result().json.error, 'LEGACY_OTP_DISABLED');
  });

  await test('5.2 /api/auth/verify-otp rejeita backdoor 123456 e não emite token falso', async () => {
    const req = createMockReq({
      method: 'POST',
      url: '/api/auth/verify-otp',
      body: { email: 'user@fatosbr.com.br', code: '123456' },
    });
    const mock = createMockRes();
    await authRouter(req, mock.res);
    assert.equal(mock.result().statusCode, 410);
    assert.equal(mock.result().json.verified, false);
    assert.equal(mock.result().json.token, undefined);
  });

  // 6. V3.1 — Migração SQL compatível com o esquema real de produção
  await test('6.1 Migração SQL V3.1 preserva profiles/handle_new_user/subscriptions/RLS e usa user_id + user_*_follows', () => {
    const migPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261116000001_auth_v3_onboarding_persistence.sql'
    );
    assert.ok(fs.existsSync(migPath), 'Migração SQL Auth V3.1 deve existir');
    const sql = fs.readFileSync(migPath, 'utf-8');

    // Deve adicionar apenas colunas faltantes de forma idempotente
    assert.match(sql, /ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 1/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS onboarding_data JSONB NOT NULL DEFAULT '\{\}'::jsonb/);

    // Deve usar tabelas canônicas reais e chave p.user_id
    assert.match(sql, /public\.user_topic_follows/);
    assert.match(sql, /public\.user_entity_follows/);
    assert.match(sql, /public\.user_source_follows/);
    assert.match(sql, /WHERE\s+.*user_id\s*=\s*p\.user_id/i);

    // NÃO pode sobrescrever handle_new_user(), apagar policies ou usar tabelas erradas
    assert.ok(!/CREATE OR REPLACE FUNCTION public\.handle_new_user/i.test(sql), 'Não pode sobrescrever handle_new_user()');
    assert.ok(!/DROP POLICY/i.test(sql), 'Não pode apagar policies RLS existentes');
    assert.ok(!/user_followed_topics|user_followed_entities|user_followed_sources/i.test(sql), 'Não pode usar nomes antigos de follows');
    assert.ok(!/DROP TABLE|TRUNCATE|DELETE FROM public\.profiles|ALTER TABLE auth\.users/i.test(sql), 'Não pode conter comandos destrutivos');
  });

  // 7. V3.1 — Auditoria estática de compatibilidade com schema real no código-fonte
  await test('7.1 userService e authService não consultam profiles por id nem escrevem email/full_name/user_followed_*', () => {
    const userSvcSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/userService.ts'), 'utf-8');
    const authSvcSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/authService.ts'), 'utf-8');

    assert.ok(!/user_followed_topics|user_followed_entities|user_followed_sources/.test(userSvcSrc));
    assert.ok(!/\.from\('profiles'\)[\s\S]{0,200}\.eq\('id',/.test(userSvcSrc), 'userService não deve filtrar profiles por id');
    assert.ok(!/\.from\('profiles'\)[\s\S]{0,200}\.eq\('id',/.test(authSvcSrc), 'authService não deve filtrar profiles por id');
    assert.ok(!/onConflict:\s*'id'[\s\S]{0,50}profiles/.test(userSvcSrc));
  });

  // 8. V3.1 — Testes com cliente Supabase MOCKADO (estados reais de onboarding, user_id e erro recuperável)
  await test('8.1 [MOCKED DB] Novo usuário com onboarding_status=NOT_STARTED e sem follows entra em NOT_STARTED via user_id', async () => {
    const authUserId = 'auth-user-uuid-111';
    const profileRowId = 'profile-row-uuid-999'; // Propositalmente diferente de authUserId!
    const mockDb = createMockSupabase({
      profilesRow: {
        id: profileRowId,
        user_id: authUserId,
        name: 'Novo Usuário',
        onboarding_status: 'NOT_STARTED',
        onboarding_step: 1,
        onboarding_data: {},
      },
    });
    setTestUserServiceClient({ client: mockDb.client, configured: true });

    const state = await userService.getOnboardingState(authUserId);
    assert.equal(state.status, 'NOT_STARTED');
    assert.equal(state.step, 1);

    const profileSelect = mockDb.calls.find((c) => c.table === 'profiles' && c.op === 'select');
    assert.ok(profileSelect, 'Deve consultar profiles');
    assert.equal(profileSelect.filters[0]?.col, 'user_id');
    assert.equal(profileSelect.filters[0]?.val, authUserId);
  });

  await test('8.2 [MOCKED DB] Usuário com progresso salvo (IN_PROGRESS) retoma na etapa exata', async () => {
    const authUserId = 'auth-user-uuid-222';
    const mockDb = createMockSupabase({
      profilesRow: {
        id: 'prof-row-222',
        user_id: authUserId,
        onboarding_status: 'IN_PROGRESS',
        onboarding_step: 4,
        onboarding_data: { themes: ['tech', 'economy'], userLocation: 'Curitiba, PR' },
      },
    });
    setTestUserServiceClient({ client: mockDb.client, configured: true });

    const state = await userService.getOnboardingState(authUserId);
    assert.equal(state.status, 'IN_PROGRESS');
    assert.equal(state.step, 4);
    assert.deepEqual(state.data.themes, ['tech', 'economy']);
    assert.equal(state.data.userLocation, 'Curitiba, PR');
  });

  await test('8.3 [MOCKED DB] Usuário COMPLETED não repete onboarding em novo login/dispositivo e saveOnboardingProgress não regride estado', async () => {
    const authUserId = 'auth-user-uuid-333';
    const mockDb = createMockSupabase({
      profilesRow: {
        id: 'prof-row-333',
        user_id: authUserId,
        onboarding_status: 'COMPLETED',
        onboarding_step: 7,
        onboarding_completed_at: '2026-11-16T01:00:00.000Z',
        onboarding_data: { themes: ['politics', 'business'] },
      },
    });
    setTestUserServiceClient({ client: mockDb.client, configured: true });

    const state = await userService.getOnboardingState(authUserId);
    assert.equal(state.status, 'COMPLETED');

    await userService.saveOnboardingProgress(authUserId, 2, { themes: ['tech'] });
    const updateCall = mockDb.calls.find((c) => c.table === 'profiles' && c.op === 'update');
    assert.ok(updateCall);
    assert.equal(updateCall.payload.onboarding_status, 'COMPLETED', 'Nunca deve regredir COMPLETED para IN_PROGRESS');
    assert.equal(updateCall.filters[0]?.col, 'user_id');
  });

  await test('8.4 [MOCKED DB] Falha de consulta no banco retorna status ERROR (nunca NOT_STARTED)', async () => {
    const authUserId = 'auth-user-uuid-444';
    const mockDb = createMockSupabase({
      profilesError: { code: '500', message: 'Connection terminated unexpectedly' },
    });
    setTestUserServiceClient({ client: mockDb.client, configured: true });

    const state = await userService.getOnboardingState(authUserId);
    assert.equal(state.status, 'ERROR');
    assert.ok(state.error && state.error.length > 0);
  });

  await test('8.5 [MOCKED DB] Exceção de rede na consulta de profiles retorna status ERROR recuperável', async () => {
    const mockDb = createMockSupabase({ throwOnProfiles: true });
    setTestUserServiceClient({ client: mockDb.client, configured: true });

    const state = await userService.getOnboardingState('auth-user-uuid-555');
    assert.equal(state.status, 'ERROR');
    assert.match(state.error || '', /Network timeout/i);
  });

  await test('8.6 [MOCKED DB] completeOnboarding persiste via user_id, usa user_*_follows e nunca envia email/id para profiles', async () => {
    const authUserId = 'auth-user-uuid-666';
    const mockDb = createMockSupabase({
      profilesRow: {
        id: 'prof-row-666',
        user_id: authUserId,
        name: 'Leitor Teste',
        onboarding_status: 'IN_PROGRESS',
      },
    });
    setTestUserServiceClient({ client: mockDb.client, configured: true });

    const res = await userService.completeOnboarding(
      authUserId,
      {
        themes: ['tech', 'economy'],
        followedEntityIds: ['ent-openai'],
        followedSourceIds: ['src-g1'],
        followedTopicIds: ['top-ai'],
      },
      'leitor@fatosbr.com.br'
    );

    assert.equal(res.success, true);
    assert.equal(res.persistedInDb, true);

    const profUpdate = mockDb.calls.find((c) => c.table === 'profiles' && c.op === 'update');
    assert.ok(profUpdate, 'Deve atualizar profiles');
    assert.equal(profUpdate.filters[0]?.col, 'user_id');
    assert.equal(profUpdate.filters[0]?.val, authUserId);
    assert.equal(profUpdate.payload.onboarding_status, 'COMPLETED');
    assert.equal(profUpdate.payload.email, undefined, 'Nunca deve enviar email inexistente para profiles');
    assert.equal(profUpdate.payload.full_name, undefined, 'Nunca deve enviar full_name inexistente para profiles');

    assert.ok(mockDb.calls.some((c) => c.table === 'user_entity_follows' && c.op === 'upsert'));
    assert.ok(mockDb.calls.some((c) => c.table === 'user_source_follows' && c.op === 'upsert'));
    assert.ok(mockDb.calls.some((c) => c.table === 'user_topic_follows' && c.op === 'upsert'));
  });

  await test('8.7 [MOCKED DB] Reconciliação legada só marca COMPLETED com evidência real em user_*_follows', async () => {
    const authUserId = 'auth-user-uuid-777';
    const mockDb = createMockSupabase({
      profilesRow: {
        id: 'prof-row-777',
        user_id: authUserId,
        onboarding_status: 'NOT_STARTED',
      },
      follows: {
        user_topic_follows: [{ user_id: authUserId, topic_id: 'top-macro' }],
      },
    });
    setTestUserServiceClient({ client: mockDb.client, configured: true });

    const state = await userService.getOnboardingState(authUserId);
    assert.equal(state.status, 'COMPLETED');
    assert.equal(state.reconciledFromLegacy, true);
    assert.deepEqual(state.data.followedTopicIds, ['top-macro']);
  });

  await test('8.8 [MOCKED DB] syncUserProfile atualiza apenas name/avatar_url/updated_at por user_id sem tocar onboarding_status', async () => {
    const authUserId = 'auth-user-uuid-888';
    const mockDb = createMockSupabase({
      profilesRow: {
        id: 'prof-row-888',
        user_id: authUserId,
        name: null,
        avatar_url: null,
        onboarding_status: 'COMPLETED',
      },
    });
    setTestUserServiceClient({ client: mockDb.client, configured: true });

    await userService.syncUserProfile({
      id: authUserId,
      email: 'carlos@fatosbr.com.br',
      user_metadata: { full_name: 'Carlos Silva', avatar_url: 'https://cdn.example/a.png' },
    });

    const profUpdate = mockDb.calls.find((c) => c.table === 'profiles' && c.op === 'update');
    assert.ok(profUpdate);
    assert.equal(profUpdate.filters[0]?.col, 'user_id');
    assert.equal(profUpdate.payload.name, 'Carlos Silva');
    assert.equal(profUpdate.payload.onboarding_status, undefined);
    assert.equal(profUpdate.payload.email, undefined);
    assert.equal(profUpdate.payload.plan_name, undefined);
  });

  setTestUserServiceClient(null);

  console.log('\n------------------------------------------------------');
  console.log(`📊 TOTAL: ${passed} passaram, ${failed} falharam.`);
  console.log('------------------------------------------------------\n');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
