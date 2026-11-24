/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.4.4 — SUÍTE DEFINITIVA DE VALIDAÇÃO (PERMISSÕES POSTGRESQL/RLS, USER_SETTINGS, NOTIFICAÇÕES & CATÁLOGO)
 *
 * Cobre em banco PostgreSQL real isolado (PGlite WASM) + testes unitários dos serviços:
 * 1. Reprodução real do erro `permission denied for table user_settings` (SQLSTATE 42501) pré-migração.
 * 2. Execução idempotente (2x) da migração `20261125000001_v2_4_4_user_settings_grants_and_rls.sql`.
 * 3. Auditoria de privilégios SQL (`authenticated`, `anon`, `service_role`, `PUBLIC`) e policies RLS sem `USING (true)` para usuários.
 * 4. Isolamento multiusuário real em PostgreSQL: Usuário A vs Usuário B vs `anon` vs JWT expirado/nulo.
 * 5. `userService`: nunca mascara 42501 em `user_settings`, valida sessão expirada e inicializa defaults com idempotência.
 * 6. `notificationService`: diferencia estado vazio legítimo de 42501 / sessão expirada.
 * 7. `eventService.getCatalogDetailed()`: propaga `503 CATALOG_UNAVAILABLE`, `200 partial: true` e `200 []` vazio sem falsos erros.
 * 8. Auditoria de wiring nos componentes `ProfileView.tsx`, `NotificationsView.tsx`, `ExploreView.tsx`, `FollowingView.tsx` e `App.tsx`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { userService, setTestUserServiceClient } from '../src/services/userService.js';
import { notificationService } from '../src/services/notificationService.js';
import { eventService } from '../src/services/eventService.js';
import { invalidateRequestCache } from '../src/services/requestCache.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function setupIsolatedPostgresWithPreBugSchema(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
      END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    CREATE TABLE public.user_settings (
      user_id UUID PRIMARY KEY,
      email_morning_briefing BOOLEAN DEFAULT TRUE,
      email_evening_briefing BOOLEAN DEFAULT TRUE,
      email_breaking_alerts BOOLEAN DEFAULT TRUE,
      weekend_edition BOOLEAN DEFAULT FALSE,
      briefing_email TEXT,
      morning_time TEXT DEFAULT '07:00',
      evening_time TEXT DEFAULT '20:00',
      timezone TEXT DEFAULT 'America/Sao_Paulo',
      notification_settings JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE public.user_preferences (
      id UUID PRIMARY KEY,
      email_morning_briefing BOOLEAN DEFAULT TRUE,
      email_evening_briefing BOOLEAN DEFAULT TRUE,
      email_breaking_alerts BOOLEAN DEFAULT TRUE,
      weekend_edition BOOLEAN DEFAULT FALSE,
      briefing_email TEXT,
      morning_time TEXT DEFAULT '07:00',
      evening_time TEXT DEFAULT '20:00',
      timezone TEXT DEFAULT 'America/Sao_Paulo',
      notification_settings JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE public.notifications (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      type TEXT NOT NULL DEFAULT 'NEWS_HIGH_RELEVANCE',
      category TEXT DEFAULT 'acontecimentos',
      title TEXT NOT NULL,
      subtitle TEXT,
      read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at TIMESTAMPTZ,
      event_id UUID,
      entity_id UUID,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE public.briefings (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      scheduled_for TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      local_date DATE
    );
  `);

  // Aplica a migração V2.3.1 exatamente como estava antes da V2.4.4 (RLS sem GRANT para authenticated)
  const v231Path = path.resolve('supabase/migrations/20261121000001_v2_3_1_canonical_preferences_briefings_notifications.sql');
  const v231Sql = fs.readFileSync(v231Path, 'utf8');
  await db.exec(v231Sql);

  return db;
}

async function execAsRole<T>(
  db: PGlite,
  role: 'authenticated' | 'anon' | 'service_role',
  subUuid: string | null,
  fn: (tx: any) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${role}`);
    if (subUuid) {
      await tx.exec(`SELECT set_config('request.jwt.claim.sub', '${subUuid}', true)`);
    } else {
      await tx.exec(`SELECT set_config('request.jwt.claim.sub', '', true)`);
    }
    return fn(tx);
  });
}

async function main() {
  console.log('\n==============================================================');
  console.log('🛡️  FATOSBR V2.4.4 — SUITE POSTGRESQL, RLS, USER_SETTINGS & UI');
  console.log('==============================================================\n');

  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const notifA1 = 'aaaa1111-1111-4111-8111-111111111111';
  const notifB1 = 'bbbb2222-2222-4222-8222-222222222222';

  const db = await setupIsolatedPostgresWithPreBugSchema();

  // Seed prévio para provar preservação não destrutiva de registros existentes
  await db.query(
    `INSERT INTO public.user_settings (user_id, briefing_email, morning_time, notification_settings)
     VALUES ($1, 'usera@fatosbr.com.br', '06:45', '{"urgentEvents": true, "onlyHighRelevance": false}'::jsonb)`,
    [userA]
  );
  await db.query(
    `INSERT INTO public.user_preferences (id, email_morning_briefing, email_evening_briefing, briefing_email)
     VALUES ($1, true, false, 'usera@fatosbr.com.br')`,
    [userA]
  );
  await db.query(
    `INSERT INTO public.notifications (id, user_id, type, category, title, subtitle, read)
     VALUES
       ($1, $2, 'NEWS_HIGH_RELEVANCE', 'acontecimentos', 'Alerta exclusivo A', 'Detalhes A', false),
       ($3, $4, 'BRIEFING_READY', 'atualizacoes', 'Briefing exclusivo B', 'Detalhes B', false)`,
    [notifA1, userA, notifB1, userB]
  );

  // ---------------------------------------------------------------------------
  // 1. REPRODUÇÃO REAL DO ERRO 42501 ANTES DA MIGRAÇÃO V2.4.4
  // ---------------------------------------------------------------------------
  console.log('--- 1. Reprodução do erro permission denied (42501) pré-V2.4.4 ---');
  let preBugCode = '';
  let preBugMsg = '';
  try {
    await execAsRole(db, 'authenticated', userA, async (tx) => {
      return tx.query('SELECT * FROM public.user_settings WHERE user_id = $1', [userA]);
    });
  } catch (err: any) {
    preBugCode = String(err?.code || '');
    preBugMsg = String(err?.message || '');
  }
  assert(
    preBugCode === '42501' && preBugMsg.toLowerCase().includes('permission denied for table user_settings'),
    'Antes da migração V2.4.4, role authenticated falha exatamente com permission denied for table user_settings (42501)',
    `code=${preBugCode} msg=${preBugMsg}`
  );

  // ---------------------------------------------------------------------------
  // 2. APLICAÇÃO IDEMPOTENTE DA MIGRAÇÃO V2.4.4
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Execução idempotente (2x) da migração V2.4.4 ---');
  const v244Path = path.resolve('supabase/migrations/20261125000001_v2_4_4_user_settings_grants_and_rls.sql');
  const v244Sql = fs.readFileSync(v244Path, 'utf8');

  let migration1Ok = false;
  let migration2Ok = false;
  try {
    await db.exec(v244Sql);
    migration1Ok = true;
    await db.exec(v244Sql);
    migration2Ok = true;
  } catch (err: any) {
    console.error('Erro ao executar migração V2.4.4:', err?.message || err);
  }
  assert(migration1Ok && migration2Ok, 'Migração V2.4.4 executa 2x com sucesso e 100% idempotência');

  // ---------------------------------------------------------------------------
  // 3. AUDITORIA DE PRIVILÉGIOS E RLS NO CATÁLOGO DO POSTGRESQL
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Auditoria de privilégios SQL e policies RLS ---');
  const privCheck = await db.query<{
    auth_sel_settings: boolean;
    auth_ins_settings: boolean;
    auth_upd_settings: boolean;
    auth_del_settings: boolean;
    anon_sel_settings: boolean;
    anon_ins_settings: boolean;
    auth_sel_prefs: boolean;
    auth_upd_notifs: boolean;
    auth_ins_notifs: boolean;
    anon_sel_notifs: boolean;
  }>(`
    SELECT
      has_table_privilege('authenticated', 'public.user_settings', 'SELECT') AS auth_sel_settings,
      has_table_privilege('authenticated', 'public.user_settings', 'INSERT') AS auth_ins_settings,
      has_table_privilege('authenticated', 'public.user_settings', 'UPDATE') AS auth_upd_settings,
      has_table_privilege('authenticated', 'public.user_settings', 'DELETE') AS auth_del_settings,
      has_table_privilege('anon', 'public.user_settings', 'SELECT') AS anon_sel_settings,
      has_table_privilege('anon', 'public.user_settings', 'INSERT') AS anon_ins_settings,
      has_table_privilege('authenticated', 'public.user_preferences', 'SELECT') AS auth_sel_prefs,
      has_table_privilege('authenticated', 'public.notifications', 'UPDATE') AS auth_upd_notifs,
      has_table_privilege('authenticated', 'public.notifications', 'INSERT') AS auth_ins_notifs,
      has_table_privilege('anon', 'public.notifications', 'SELECT') AS anon_sel_notifs
  `);
  const p = privCheck.rows[0];
  assert(
    p.auth_sel_settings && p.auth_ins_settings && p.auth_upd_settings && !p.auth_del_settings,
    'Menor privilégio em user_settings: authenticated possui apenas SELECT, INSERT, UPDATE (sem DELETE)'
  );
  assert(
    !p.anon_sel_settings && !p.anon_ins_settings && !p.anon_sel_notifs,
    'Role anon não possui nenhum privilégio em user_settings nem notifications'
  );
  assert(
    p.auth_sel_prefs && p.auth_upd_notifs && !p.auth_ins_notifs,
    'authenticated lê user_preferences e atualiza notifications sem poder forjar INSERT em notifications'
  );

  const rlsStatus = await db.query<{ relname: string; relrowsecurity: boolean }>(`
    SELECT relname, relrowsecurity
      FROM pg_class
     WHERE relnamespace = 'public'::regnamespace
       AND relname IN ('user_settings', 'user_preferences', 'notifications')
  `);
  assert(
    rlsStatus.rows.length === 3 && rlsStatus.rows.every((r) => r.relrowsecurity === true),
    'RLS ativa (relrowsecurity = true) nas 3 tabelas'
  );

  const unsafePolicies = await db.query(`
    SELECT tablename, policyname, roles, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('user_settings', 'user_preferences', 'notifications')
       AND NOT ('service_role' = ANY(roles))
       AND (coalesce(qual, '') = 'true' OR coalesce(with_check, '') = 'true')
  `);
  assert(unsafePolicies.rows.length === 0, 'Nenhuma policy USING (true) ou WITH CHECK (true) para roles de usuário');

  // ---------------------------------------------------------------------------
  // 4. ISOLAMENTO MULTIUSUÁRIO REAL E PERSISTÊNCIA NO POSTGRESQL
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Testes multiusuário reais com SET LOCAL ROLE ---');

  // 4.1 Dados pré-existentes do Usuário A preservados e legíveis como authenticated
  const userARead = await execAsRole(db, 'authenticated', userA, async (tx) => {
    return tx.query('SELECT user_id, briefing_email, morning_time, notification_settings FROM public.user_settings WHERE user_id = $1', [userA]);
  });
  assert(
    userARead.rows.length === 1 && userARead.rows[0].morning_time === '06:45',
    'Usuário A autenticado lê seus próprios dados preservados em user_settings sem erro 42501'
  );

  // 4.2 Usuário A atualiza e relê após nova transação (simula reload)
  await execAsRole(db, 'authenticated', userA, async (tx) => {
    await tx.query(
      `UPDATE public.user_settings
          SET morning_time = '08:15',
              notification_settings = '{"urgentEvents": false, "dailyBriefings": true}'::jsonb
        WHERE user_id = $1`,
      [userA]
    );
  });
  const userAReloaded = await execAsRole(db, 'authenticated', userA, async (tx) => {
    return tx.query('SELECT morning_time, notification_settings FROM public.user_settings WHERE user_id = $1', [userA]);
  });
  assert(
    userAReloaded.rows[0]?.morning_time === '08:15' && userAReloaded.rows[0]?.notification_settings?.urgentEvents === false,
    'Alteração em user_settings persiste integralmente em nova transação/reload'
  );

  // 4.3 Novo Usuário B inicializa suas próprias configurações com segurança
  await execAsRole(db, 'authenticated', userB, async (tx) => {
    await tx.query(
      `INSERT INTO public.user_settings (user_id, briefing_email)
       VALUES ($1, 'userb@fatosbr.com.br')
       ON CONFLICT (user_id) DO NOTHING`,
      [userB]
    );
  });
  const userBReadOwn = await execAsRole(db, 'authenticated', userB, async (tx) => {
    return tx.query('SELECT user_id, briefing_email FROM public.user_settings');
  });
  assert(
    userBReadOwn.rows.length === 1 && userBReadOwn.rows[0].user_id === userB,
    'Usuário B cria e lê apenas seu próprio registro (RLS isola linha do Usuário A)'
  );

  // 4.4 Usuário B tenta sobrescrever Usuário A -> bloqueado pela RLS
  let userBInsertForACode = '';
  try {
    await execAsRole(db, 'authenticated', userB, async (tx) => {
      await tx.query(
        `INSERT INTO public.user_settings (user_id, briefing_email) VALUES ($1, 'hacked@evil.com')`,
        [userA]
      );
    });
  } catch (err: any) {
    userBInsertForACode = String(err?.code || '');
  }
  assert(userBInsertForACode === '42501', 'Usuário B é bloqueado (42501) ao tentar inserir user_settings para Usuário A');

  const userBUpdateForA = await execAsRole(db, 'authenticated', userB, async (tx) => {
    return tx.query(`UPDATE public.user_settings SET morning_time = '00:00' WHERE user_id = $1 RETURNING user_id`, [userA]);
  });
  assert(userBUpdateForA.rows.length === 0, 'Usuário B não consegue alterar user_settings do Usuário A (0 linhas afetadas)');

  // 4.5 Notificações: Usuário A lê/marca apenas a sua; Usuário B não lê nem altera a de A
  const notifARows = await execAsRole(db, 'authenticated', userA, async (tx) => {
    return tx.query('SELECT id, user_id FROM public.notifications');
  });
  assert(
    notifARows.rows.length === 1 && notifARows.rows[0].id === notifA1,
    'Usuário A vê apenas suas notificações (RLS bloqueia notificação do Usuário B)'
  );
  const userBHijackNotif = await execAsRole(db, 'authenticated', userB, async (tx) => {
    return tx.query('UPDATE public.notifications SET read = true WHERE id = $1 RETURNING id', [notifA1]);
  });
  assert(userBHijackNotif.rows.length === 0, 'Usuário B não consegue marcar notificação do Usuário A como lida');

  // 4.6 Role `anon` bloqueada
  let anonBlockedCode = '';
  try {
    await execAsRole(db, 'anon', null, async (tx) => {
      return tx.query('SELECT * FROM public.user_settings');
    });
  } catch (err: any) {
    anonBlockedCode = String(err?.code || '');
  }
  assert(anonBlockedCode === '42501', 'Usuário não autenticado (anon) é rejeitado com 42501 em user_settings');

  // 4.7 Sessão expirada / JWT sem sub sob role `authenticated`
  const nullSubRows = await execAsRole(db, 'authenticated', null, async (tx) => {
    return tx.query('SELECT * FROM public.user_settings');
  });
  let nullSubInsertCode = '';
  try {
    await execAsRole(db, 'authenticated', null, async (tx) => {
      await tx.query(`INSERT INTO public.user_settings (user_id) VALUES ($1)`, [userA]);
    });
  } catch (err: any) {
    nullSubInsertCode = String(err?.code || '');
  }
  assert(
    nullSubRows.rows.length === 0 && nullSubInsertCode === '42501',
    'JWT nulo/expirado sob authenticated não retorna dados nem permite escrita (0 linhas / 42501)'
  );

  // ---------------------------------------------------------------------------
  // 5. USERSERVICE & NOTIFICATIONSERVICE — NÃO MASCARAR 42501 + SESSÃO + INIT
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Services: 42501 não mascarado, sessão expirada e inicialização ---');
  try {
    // 5.1 Caso crítico do bug: user_preferences retorna linha válida, mas user_settings retorna 42501
    setTestUserServiceClient({
      client: {
        from(table: string) {
          const chain: any = {
            select() { return chain; },
            eq() { return chain; },
            maybeSingle() {
              if (table === 'user_settings') {
                return Promise.resolve({
                  data: null,
                  error: { code: '42501', message: 'permission denied for table user_settings' }
                });
              }
              return Promise.resolve({
                data: { id: userA, email_morning_briefing: true },
                error: null
              });
            }
          };
          return chain;
        }
      },
      configured: true
    });

    const partialPermRes = await userService.getUserPreferencesDetailed(userA);
    assert(
      Boolean(partialPermRes.error) && partialPermRes.permissionDenied === true && partialPermRes.data === null,
      'userService.getUserPreferencesDetailed NÃO mascara 42501 em user_settings quando user_preferences responde OK'
    );

    // 5.2 ensureDefaultUserSettings aborta se 42501 em vez de sobrescrever
    const initBlockedRes = await userService.ensureDefaultUserSettings(userA, 'usera@fatosbr.com.br');
    assert(
      initBlockedRes.initialized === false && initBlockedRes.permissionDenied === true && Boolean(initBlockedRes.error),
      'ensureDefaultUserSettings propaga permissionDenied sem fingir sucesso'
    );

    // 5.3 ensureDefaultUserSettings inicializa idempotente quando vazio e preserva quando existente
    const memStore: { prefs: any; settings: any; writes: number } = { prefs: null, settings: null, writes: 0 };
    setTestUserServiceClient({
      client: {
        from(table: string) {
          const chain: any = {
            select() { return chain; },
            eq() { return chain; },
            maybeSingle() {
              return Promise.resolve({
                data: table === 'user_preferences' ? memStore.prefs : memStore.settings,
                error: null
              });
            },
            upsert(payload: any) {
              memStore.writes++;
              if (table === 'user_preferences') memStore.prefs = { ...(memStore.prefs || {}), ...payload };
              if (table === 'user_settings') memStore.settings = { ...(memStore.settings || {}), ...payload };
              return Promise.resolve({ error: null });
            }
          };
          return chain;
        }
      },
      configured: true
    });

    const initNew = await userService.ensureDefaultUserSettings(userB, 'newuser@fatosbr.com.br');
    const writesAfterFirst = memStore.writes;
    const initExisting = await userService.ensureDefaultUserSettings(userB, 'newuser@fatosbr.com.br');
    assert(
      initNew.initialized && initNew.created && initExisting.initialized && !initExisting.created && memStore.writes === writesAfterFirst,
      'ensureDefaultUserSettings cria defaults para usuário novo e é no-op idempotente em chamadas seguintes'
    );

    // 5.4 ensureAuthenticatedSession rejeita sessão expirada quando refreshSession falha
    const expiredSessionCheck = await userService.ensureAuthenticatedSession(
      {
        auth: {
          getSession: async () => ({
            data: { session: { access_token: 'expired', expires_at: Math.floor(Date.now() / 1000) - 60, user: { id: userA } } },
            error: null
          }),
          refreshSession: async () => ({ data: { session: null }, error: { message: 'Invalid Refresh Token' } })
        }
      },
      userA
    );
    assert(
      expiredSessionCheck.ok === false && expiredSessionCheck.sessionExpired === true,
      'ensureAuthenticatedSession bloqueia operação quando JWT expirou e refreshSession falha'
    );

    // 5.5 notificationService propaga 42501 vs empty state legítimo
    notificationService.setTestClient({
      client: {
        from() {
          const chain: any = {
            select() { return chain; },
            eq() { return chain; },
            order() { return chain; },
            range() {
              return Promise.resolve({
                data: null,
                error: { code: '42501', message: 'permission denied for table notifications' }
              });
            }
          };
          return chain;
        }
      },
      configured: true
    });
    const notifPermRes = await notificationService.getUserNotificationsDetailed(userA);
    assert(
      Boolean(notifPermRes.error) && notifPermRes.permissionDenied === true,
      'notificationService.getUserNotificationsDetailed sinaliza permissionDenied (42501)'
    );

    notificationService.setTestClient({
      client: {
        from() {
          const chain: any = {
            select() { return chain; },
            eq() { return chain; },
            order() { return chain; },
            range() {
              return Promise.resolve({ data: [], error: null });
            }
          };
          return chain;
        }
      },
      configured: true
    });
    const notifEmptyRes = await notificationService.getUserNotificationsDetailed(userA);
    assert(
      !notifEmptyRes.error && !notifEmptyRes.permissionDenied && notifEmptyRes.items.length === 0,
      'notificationService diferencia caixa legitimamente vazia de erro de permissão'
    );
  } finally {
    setTestUserServiceClient(null);
    notificationService.setTestClient(null);
  }

  // ---------------------------------------------------------------------------
  // 6. EVENTSERVICE.GETCATALOGDETAILED — 503 vs PARTIAL vs VAZIO LEGÍTIMO
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. eventService.getCatalogDetailed(): 503 / partial / empty ---');
  const origFetch = globalThis.fetch;
  try {
    // 6.1 503 CATALOG_UNAVAILABLE
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ code: 'CATALOG_UNAVAILABLE', error: 'Catálogo indisponível no momento.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )) as any;
    invalidateRequestCache('catalog:');
    const cat503 = await eventService.getCatalogDetailed({ forceRefresh: true });
    assert(
      cat503.unavailable === true && cat503.code === 'CATALOG_UNAVAILABLE' && Boolean(cat503.error),
      'getCatalogDetailed propaga indisponibilidade real (503 CATALOG_UNAVAILABLE) para a UI'
    );

    // 6.2 200 partial: true
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          entities: [{ id: 'e1', name: 'Petrobras', type: 'company', description: '', isFollowed: false }],
          sources: [],
          partial: true,
          degraded: ['sources']
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as any;
    invalidateRequestCache('catalog:');
    const catPartial = await eventService.getCatalogDetailed({ forceRefresh: true });
    assert(
      !catPartial.unavailable &&
        catPartial.partial === true &&
        catPartial.entities.length === 1 &&
        catPartial.degraded?.includes('sources') === true &&
        Boolean(catPartial.warning),
      'getCatalogDetailed preserva entidades recuperadas e expõe warning em degradação parcial'
    );

    // 6.3 200 catálogo legitimamente vazio
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ entities: [], sources: [], partial: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as any;
    invalidateRequestCache('catalog:');
    const catEmpty = await eventService.getCatalogDetailed({ forceRefresh: true });
    assert(
      !catEmpty.unavailable && !catEmpty.partial && !catEmpty.error && catEmpty.entities.length === 0,
      'getCatalogDetailed diferencia base legitimamente vazia de falha 503'
    );
  } finally {
    globalThis.fetch = origFetch;
    invalidateRequestCache('catalog:');
  }

  // ---------------------------------------------------------------------------
  // 7. AUDITORIA DE WIRING NA INTERFACE (STATIC CHECK)
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Auditoria de wiring em componentes UI ---');
  const profileSrc = fs.readFileSync(path.resolve('src/components/ProfileView.tsx'), 'utf8');
  const notifSrc = fs.readFileSync(path.resolve('src/components/NotificationsView.tsx'), 'utf8');
  const exploreSrc = fs.readFileSync(path.resolve('src/components/ExploreView.tsx'), 'utf8');
  const followingSrc = fs.readFileSync(path.resolve('src/components/FollowingView.tsx'), 'utf8');
  const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');

  assert(
    /userService\s*\.\s*getUserPreferencesDetailed\(/.test(profileSrc) &&
      /userService\s*\.\s*updateUserPreferencesDetailed\(/.test(profileSrc) &&
      /userService\s*\.\s*ensureDefaultUserSettings\(/.test(profileSrc) &&
      profileSrc.includes('handleSaveBriefingPreferences'),
    'ProfileView carrega, inicializa e persiste preferências reais de notificações e briefings no Supabase'
  );
  assert(
    notifSrc.includes('Entre para ver suas notificações') &&
      notifSrc.includes('settingsError') &&
      !notifSrc.includes('buildDefaultNotifications'),
    'NotificationsView distingue usuário deslogado, exibe settingsError com retry e não usa mocks'
  );
  assert(
    exploreSrc.includes('catalogStatus') &&
      exploreSrc.includes('onRetryCatalog') &&
      followingSrc.includes('catalogStatus') &&
      followingSrc.includes('onRetryCatalog') &&
      appSrc.includes('eventService.getCatalogDetailed('),
    'App.tsx, ExploreView e FollowingView propagam estado de erro/parcial do catálogo com ação de retry'
  );

  // ---------------------------------------------------------------------------
  // 8. HOMOLOGAÇÃO DE PRODUÇÃO: ORGANIZAÇÃO DE MIGRAÇÕES, BASELINE REAL, ACCOUNT_CONTROLS_GUARD & ROLLBACK
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. Migrações limpas, baseline real, account_controls_guard e rollback ---');
  const migrationsDir = path.resolve('supabase/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  const rollbackFilesInMigrations = migrationFiles.filter((f) => f.toLowerCase().includes('rollback'));
  const versionCounts = new Map<string, number>();
  for (const file of migrationFiles) {
    const version = file.split('_')[0];
    versionCounts.set(version, (versionCounts.get(version) || 0) + 1);
  }
  const duplicateVersions = Array.from(versionCounts.entries()).filter(([, count]) => count > 1);
  assert(
    rollbackFilesInMigrations.length === 0 && duplicateVersions.length === 0,
    'supabase/migrations contém zero scripts de rollback e zero versões duplicadas',
    `rollbacks=${rollbackFilesInMigrations.join(',')} dupes=${JSON.stringify(duplicateVersions)}`
  );

  const rollbacksDir = path.resolve('supabase/rollbacks');
  const expectedRollbacks = [
    '20261104000001_rollback_financial_security.sql',
    '20261104000002_rollback_fix_supabase_billing_and_rbac.sql',
    '20261123000002_rollback_perf_indexes.sql',
    '20261123000003_rollback_perf_cursor_indexes.sql',
    '20261124000001_rollback_payments_v2_pix_dunning_nfse.sql',
    '20261125000001_rollback_user_settings_grants_and_rls.sql'
  ];
  assert(
    expectedRollbacks.every((f) => fs.existsSync(path.join(rollbacksDir, f))),
    'Todos os 6 scripts de rollback (5 legados + V2.4.4) estão organizados em supabase/rollbacks/'
  );

  const v244SqlNoComments = v244Sql.replace(/--.*$/gm, '');
  assert(
    !/ALTER\s+TABLE[\s\S]*ADD\s+COLUMN/i.test(v244SqlNoComments) && !/DROP\s+POLICY/i.test(v244SqlNoComments),
    'Migração V2.4.4 é estritamente mínima: sem ALTER TABLE ADD COLUMN e sem DROP POLICY destrutivo'
  );

  const rollbackPath = path.join(rollbacksDir, '20261125000001_rollback_user_settings_grants_and_rls.sql');
  const rollbackSql = fs.readFileSync(rollbackPath, 'utf8');

  // Reproduz baseline REAL auditado de produção antes da V2.4.4:
  // - user_settings: authenticated tem SELECT (sem INSERT/UPDATE) + policy RESTRICTIVE `account_controls_guard`
  // - user_preferences: authenticated JÁ tem SELECT, INSERT, UPDATE
  // - notifications: authenticated JÁ tem SELECT, UPDATE, DELETE
  const prodSimDb = await setupIsolatedPostgresWithPreBugSchema();
  const guardedUser = '33333333-3333-4333-8333-333333333333';

  await prodSimDb.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT ON TABLE public.user_settings TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.user_preferences TO authenticated;
    GRANT SELECT, UPDATE, DELETE ON TABLE public.notifications TO authenticated;
    CREATE POLICY account_controls_guard ON public.user_settings
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (user_id <> '${guardedUser}'::uuid)
      WITH CHECK (user_id <> '${guardedUser}'::uuid);
  `);
  await prodSimDb.query(
    `INSERT INTO public.user_settings (user_id, briefing_email, morning_time)
     VALUES
       ($1, 'usera@fatosbr.com.br', '07:00'),
       ($2, 'guarded@fatosbr.com.br', '07:00')`,
    [userA, guardedUser]
  );
  await prodSimDb.query(
    `INSERT INTO public.user_preferences (id, briefing_email) VALUES ($1, 'usera@fatosbr.com.br')`,
    [userA]
  );
  await prodSimDb.query(
    `INSERT INTO public.notifications (id, user_id, title, read) VALUES ($1, $2, 'Notif A', false)`,
    [notifA1, userA]
  );

  // Pré-V2.4.4: SELECT funciona para User A, mas UPDATE em user_settings falha com 42501
  const prodPreSelect = await execAsRole(prodSimDb, 'authenticated', userA, async (tx) => {
    return tx.query('SELECT user_id, morning_time FROM public.user_settings WHERE user_id = $1', [userA]);
  });
  let prodPreUpdateCode = '';
  try {
    await execAsRole(prodSimDb, 'authenticated', userA, async (tx) => {
      await tx.query(`UPDATE public.user_settings SET morning_time = '08:00' WHERE user_id = $1`, [userA]);
    });
  } catch (err: any) {
    prodPreUpdateCode = String(err?.code || '');
  }
  assert(
    prodPreSelect.rows.length === 1 && prodPreUpdateCode === '42501',
    'Baseline real reproduzido: SELECT OK em user_settings, UPDATE falha com 42501'
  );

  // Aplica V2.4.4 2x no cenário de produção
  await prodSimDb.exec(v244Sql);
  await prodSimDb.exec(v244Sql);

  const guardCheck = await prodSimDb.query<{
    policyname: string;
    permissive: string;
    qual: string;
    with_check: string;
  }>(`
    SELECT policyname, permissive, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'user_settings'
       AND policyname = 'account_controls_guard'
  `);
  const fallbackNotCreated = await prodSimDb.query<{ cnt: number }>(`
    SELECT COUNT(*)::int AS cnt
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('user_settings', 'user_preferences')
       AND policyname LIKE 'v2_4_4_%'
  `);
  assert(
    guardCheck.rows.length === 1 &&
      guardCheck.rows[0].permissive === 'RESTRICTIVE' &&
      guardCheck.rows[0].qual.includes(guardedUser) &&
      fallbackNotCreated.rows[0].cnt === 0,
    'Policy account_controls_guard e policies preexistentes preservadas sem duplicação'
  );

  // Usuário A (liberado) consegue atualizar após V2.4.4; usuário bloqueado por account_controls_guard segue bloqueado
  await execAsRole(prodSimDb, 'authenticated', userA, async (tx) => {
    await tx.query(`UPDATE public.user_settings SET morning_time = '08:30' WHERE user_id = $1`, [userA]);
  });
  const prodPostReadA = await execAsRole(prodSimDb, 'authenticated', userA, async (tx) => {
    return tx.query('SELECT morning_time FROM public.user_settings WHERE user_id = $1', [userA]);
  });
  const guardedNewUser = '44444444-4444-4444-8444-444444444444';
  await prodSimDb.exec(`
    DROP POLICY account_controls_guard ON public.user_settings;
    CREATE POLICY account_controls_guard ON public.user_settings
      AS RESTRICTIVE
      FOR ALL
      TO authenticated
      USING (user_id NOT IN ('${guardedUser}'::uuid, '${guardedNewUser}'::uuid))
      WITH CHECK (user_id NOT IN ('${guardedUser}'::uuid, '${guardedNewUser}'::uuid));
  `);
  await prodSimDb.exec(v244Sql);

  const guardedRead = await execAsRole(prodSimDb, 'authenticated', guardedUser, async (tx) => {
    return tx.query('SELECT user_id FROM public.user_settings');
  });
  let guardedInsertCode = '';
  try {
    await execAsRole(prodSimDb, 'authenticated', guardedNewUser, async (tx) => {
      await tx.query(`INSERT INTO public.user_settings (user_id, morning_time) VALUES ($1, '09:00')`, [guardedNewUser]);
    });
  } catch (err: any) {
    guardedInsertCode = String(err?.code || '');
  }
  const guardedUpdateRows = await execAsRole(prodSimDb, 'authenticated', guardedUser, async (tx) => {
    return tx.query(`UPDATE public.user_settings SET morning_time = '09:00' WHERE user_id = $1 RETURNING user_id`, [guardedUser]);
  });
  assert(
    prodPostReadA.rows[0]?.morning_time === '08:30' &&
      guardedRead.rows.length === 0 &&
      guardedUpdateRows.rows.length === 0 &&
      guardedInsertCode === '42501',
    'Após V2.4.4, User A persiste normalmente enquanto account_controls_guard continua restringindo SELECT/UPDATE e bloqueando INSERT (42501)'
  );

  // Rollback fora de supabase/migrations/ executa de forma não destrutiva:
  // reverte APENAS INSERT/UPDATE de user_settings, preservando user_preferences, notifications, SELECT, guard e dados!
  await prodSimDb.exec(rollbackSql);
  const postRollbackPriv = await prodSimDb.query<{
    us_sel: boolean;
    us_ins: boolean;
    us_upd: boolean;
    up_sel: boolean;
    up_ins: boolean;
    up_upd: boolean;
    n_sel: boolean;
    n_upd: boolean;
    n_del: boolean;
    guard_count: number;
    row_count: number;
  }>(`
    SELECT
      has_table_privilege('authenticated', 'public.user_settings', 'SELECT') AS us_sel,
      has_table_privilege('authenticated', 'public.user_settings', 'INSERT') AS us_ins,
      has_table_privilege('authenticated', 'public.user_settings', 'UPDATE') AS us_upd,
      has_table_privilege('authenticated', 'public.user_preferences', 'SELECT') AS up_sel,
      has_table_privilege('authenticated', 'public.user_preferences', 'INSERT') AS up_ins,
      has_table_privilege('authenticated', 'public.user_preferences', 'UPDATE') AS up_upd,
      has_table_privilege('authenticated', 'public.notifications', 'SELECT') AS n_sel,
      has_table_privilege('authenticated', 'public.notifications', 'UPDATE') AS n_upd,
      has_table_privilege('authenticated', 'public.notifications', 'DELETE') AS n_del,
      (SELECT COUNT(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_settings' AND policyname = 'account_controls_guard') AS guard_count,
      (SELECT COUNT(*)::int FROM public.user_settings) AS row_count
  `);
  const rb = postRollbackPriv.rows[0];
  assert(
    rb.us_sel === true &&
      rb.us_ins === false &&
      rb.us_upd === false &&
      rb.up_sel === true &&
      rb.up_ins === true &&
      rb.up_upd === true &&
      rb.n_sel === true &&
      rb.n_upd === true &&
      rb.n_del === true &&
      rb.guard_count === 1 &&
      rb.row_count === 2,
    'Rollback V2.4.4 reverte apenas INSERT/UPDATE de user_settings preservando user_preferences, notifications, SELECT, account_controls_guard e dados'
  );

  // Confirma que user_preferences continua gravável após o rollback (sem regressão)
  await execAsRole(prodSimDb, 'authenticated', userA, async (tx) => {
    await tx.query(`UPDATE public.user_preferences SET morning_time = '09:15' WHERE id = $1`, [userA]);
  });
  const upAfterRb = await execAsRole(prodSimDb, 'authenticated', userA, async (tx) => {
    return tx.query(`SELECT morning_time FROM public.user_preferences WHERE id = $1`, [userA]);
  });
  assert(
    upAfterRb.rows[0]?.morning_time === '09:15',
    'Após rollback da V2.4.4, user_preferences segue funcional para authenticated sem regressão'
  );

  await prodSimDb.close();
  await db.close();

  console.log(`\n==============================================================`);
  console.log(`Resultado V2.4.4: ${passed} aprovados | ${failed} falharam`);
  console.log(`==============================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Falha fatal na suíte V2.4.4:', err);
  process.exit(1);
});
