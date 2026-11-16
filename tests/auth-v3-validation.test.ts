/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Suíte Automatizada de Validação — FatosBR Auth V3.0 & Onboarding Canônico
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.FATOSBR_TEST_MODE = 'true';
process.env.NODE_ENV = 'test';

import { translateAuthError, validatePasswordRequirements, authService } from '../src/services/authService.js';
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
    }
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
    }
  };
  return {
    res,
    result: () => ({
      statusCode,
      json: body ? JSON.parse(body) : null
    })
  };
}

async function main() {
  console.log('\n======================================================');
  console.log('🔐 FATOSBR AUTH V3.0 — SUÍTE DE VALIDAÇÃO');
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
    assert.equal(validatePasswordRequirements('abc123').isValid, false); // < 8
    assert.equal(validatePasswordRequirements('abcdefgh').isValid, false); // sem número
    assert.equal(validatePasswordRequirements('12345678').isValid, false); // sem letra
    assert.equal(validatePasswordRequirements('Fatos2026').isValid, true);
  });

  // 3. Regras estruturais do authService (zero Magic Link / zero local OTP)
  await test('3.1 authService não expõe signInWithMagicLink nem verifyBackendOtp nem sendLoginOtp', () => {
    assert.equal((authService as any).signInWithMagicLink, undefined);
    assert.equal((authService as any).verifyBackendOtp, undefined);
    assert.equal((authService as any).sendLoginOtp, undefined);
  });

  await test('3.2 authService rejeita OTP com formato diferente de 6 dígitos', async () => {
    // Mesmo sem configurar Supabase ou com verificação prévia de formato, nunca aceita código parcial
    const partialRes = await authService.verifyOtp('teste@fatosbr.com.br', '123', 'email');
    assert.equal(partialRes.success, false);
  });

  // 4. Templates HTML oficiais do Supabase
  await test('4.1 Os 3 templates de e-mail existem, usam {{ .Token }} e não contêm Magic Link ou scripts', () => {
    const templatesDir = path.resolve(process.cwd(), 'supabase/email-templates');
    const files = ['magic_link_otp.html', 'confirm_signup.html', 'reset_password.html'];

    for (const file of files) {
      const fullPath = path.join(templatesDir, file);
      assert.ok(fs.existsSync(fullPath), `${file} deve existir`);
      const html = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(html.includes('{{ .Token }}'), `${file} deve conter {{ .Token }}`);
      assert.ok(html.includes('{{ .Email }}'), `${file} deve conter {{ .Email }}`);
      assert.ok(!html.includes('ConfirmationURL'), `${file} não pode conter Magic Link ConfirmationURL`);
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
      remaining: Math.max(0, maxRequests - 1)
    })
  });

  await test('5.1 /api/auth/send-otp continua retornando 400 para payload vazio e bloqueia disparo paralelo com 410', async () => {
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
      body: { email: 'user@fatosbr.com.br', code: '123456' }
    });
    const mock = createMockRes();
    await authRouter(req, mock.res);
    assert.equal(mock.result().statusCode, 410);
    assert.equal(mock.result().json.verified, false);
    assert.equal(mock.result().json.token, undefined);
  });

  // 6. Migração SQL canônica do onboarding
  await test('6.1 Migração SQL de onboarding é aditiva, segura e reconcilia apenas com evidência real', () => {
    const migPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261116000001_auth_v3_onboarding_persistence.sql'
    );
    assert.ok(fs.existsSync(migPath), 'Migração SQL Auth V3 deve existir');
    const sql = fs.readFileSync(migPath, 'utf-8');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'NOT_STARTED'/);
    assert.match(sql, /CHECK \(onboarding_status IN \('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'\)\)/);
    assert.match(sql, /EXISTS \(SELECT 1 FROM public\.user_followed_topics/);
    assert.match(sql, /EXISTS \(SELECT 1 FROM public\.user_followed_entities/);
    assert.match(sql, /EXISTS \(SELECT 1 FROM public\.user_followed_sources/);
    assert.ok(!/DROP TABLE|TRUNCATE|DELETE FROM public\.profiles/i.test(sql), 'Não pode conter comandos destrutivos');
  });

  console.log('\n------------------------------------------------------');
  console.log(`📊 TOTAL: ${passed} passaram, ${failed} falharam.`);
  console.log('------------------------------------------------------\n');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
