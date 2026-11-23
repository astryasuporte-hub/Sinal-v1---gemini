/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.3.2 — SUÍTE DE VALIDAÇÃO ESTRITA DE CONTRATO POSTGRESQL, FUSO HORÁRIO & SEGURANÇA
 *
 * Valida explicitamente os requisitos finais da V2.3.2:
 * 1. public.briefing_items.section aceita exclusivamente TOP_STORIES | UPDATES | DEVELOPING | WATCH_NEXT.
 * 2. Nomes amigáveis em português são mapeados exclusivamente na interface (briefingService/BriefingView).
 * 3. Preenchimento obrigatório de position, local_date, period_start e period_end em America/Sao_Paulo e fusos customizados.
 * 4. Horários configuráveis (morning_time / evening_time) + respeito à janela de agendamento por usuário.
 * 5. Deduplicação por (user_id, type, local_date) alinhada a idx_briefing_delivery_slot + tratamento 23505.
 * 6. Preferências, notification_settings (JSONB), fail-closed e endpoint /api/notifications/generate-briefings.
 * 7. Migração SQL V2.3.2 com DEFAULT 'TOP_STORIES' e sem criação redundante frente a idx_briefing_delivery_slot.
 */

import fs from 'fs';
import path from 'path';
import {
  ALLOWED_BRIEFING_SECTIONS,
  briefingEngine,
  getBriefingPeriodWindow,
  setBriefingEngineTestDeps
} from '../api/_lib/briefingEngine.js';
import {
  briefingService,
  mapBriefingSectionLabel,
  setTestBriefingServiceClient
} from '../src/services/briefingService.js';
import { notificationEngine, setNotificationEngineTestDeps } from '../api/_lib/notificationEngine.js';
import { userService, setTestUserServiceClient } from '../src/services/userService.js';
import generateBriefingsHandler from '../api/_lib/handlers/notifications/generateBriefings.js';

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

function createMockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let raw = '';
  const res: any = {
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    end(chunk?: any) {
      if (chunk) raw += String(chunk);
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    get statusCode() {
      return statusCode;
    }
  };
  return {
    res,
    getStatus: () => statusCode,
    getJson: () => {
      try {
        return JSON.parse(raw || '{}');
      } catch {
        return {};
      }
    }
  };
}

async function run() {
  console.log('======================================================================');
  console.log('🛡️  FATOSBR V2.3.2 — AUDITORIA & TESTES DE CONTRATO FINAL');
  console.log('======================================================================\n');

  const userA = 'user-v232-aaaa-1111-2222-333344445555';
  const userB = 'user-v232-bbbb-6666-7777-888899990000';

  // ---------------------------------------------------------------------------
  // 1. CONTRATO ESTRITO POSTGRESQL: SECTION ENUM, TIMEZONE, LOCAL_DATE, PERIOD & DEDUP
  // ---------------------------------------------------------------------------
  console.log('--- 1. Contrato estrito PostgreSQL: section enum, local_date, timezone, horarios & dedup ---');
  try {
    const strictBriefings: any[] = [];
    const strictItems: any[] = [];
    const strictNotifications: any[] = [];
    let simulateConcurrent23505 = false;

    const strictPostgresMock = {
      from(table: string) {
        let eqFilters: Record<string, any> = {};
        let updatePatch: any = null;
        const chain: any = {
          select(sel?: string) {
            if (table === 'briefing_items' && sel && sel.includes('order_index')) {
              chain._missingOrderIndex = true;
            }
            return chain;
          },
          eq(k: string, v: any) {
            eqFilters[k] = v;
            return chain;
          },
          in() { return chain; },
          contains() { return chain; },
          gte() { return chain; },
          lte() { return chain; },
          order() { return chain; },
          limit() {
            if (table === 'events') {
              return Promise.resolve({
                data: [
                  {
                    id: 'ev-follow-1',
                    title: 'Petrobras anuncia plano de investimentos',
                    summary: 'Aporte em refino e transição energética.',
                    relevance_score: 91,
                    published_at: '2026-11-23T08:00:00.000Z'
                  },
                  {
                    id: 'ev-macro-2',
                    title: 'IBGE divulga IPCA-15 abaixo do consenso',
                    summary: 'Alívio em serviços desacelera índice.',
                    relevance_score: 88,
                    published_at: '2026-11-23T09:00:00.000Z'
                  },
                  {
                    id: 'ev-dev-3',
                    title: 'Copom sinaliza manutenção de juros em comunicado',
                    summary: 'Autoridade monetária monitora câmbio e atividade.',
                    relevance_score: 86,
                    published_at: '2026-11-23T09:15:00.000Z'
                  },
                  {
                    id: 'ev-watch-4',
                    title: 'Agenda econômica da semana inclui dados fiscais',
                    summary: 'Tesouro divulga relatório bimestral na sexta-feira.',
                    relevance_score: 79,
                    published_at: '2026-11-23T09:30:00.000Z'
                  }
                ],
                error: null
              });
            }
            if (table === 'briefings') {
              return Promise.resolve({
                data: strictBriefings.filter((b) => b.user_id === eqFilters.user_id),
                error: null
              });
            }
            return Promise.resolve({ data: [], error: null });
          },
          maybeSingle() {
            if (table === 'user_preferences') {
              if (eqFilters.id === userA) {
                return Promise.resolve({
                  data: {
                    id: userA,
                    timezone: 'America/Sao_Paulo',
                    morning_time: '07:30',
                    evening_time: '20:30'
                  },
                  error: null
                });
              }
              return Promise.resolve({ data: null, error: null });
            }
            if (table === 'user_settings') {
              if (eqFilters.user_id === userA) {
                return Promise.resolve({
                  data: {
                    user_id: userA,
                    timezone: 'America/Sao_Paulo',
                    morning_time: '07:30',
                    evening_time: '20:30'
                  },
                  error: null
                });
              }
              return Promise.resolve({ data: null, error: null });
            }
            if (table === 'briefings') {
              if (simulateConcurrent23505 && !eqFilters.id && strictBriefings.length > 0 && !updatePatch) {
                simulateConcurrent23505 = false;
                return Promise.resolve({ data: null, error: null });
              }
              const found = strictBriefings.find(
                (b) =>
                  b.user_id === eqFilters.user_id &&
                  b.type === eqFilters.type &&
                  (!eqFilters.local_date || b.local_date === eqFilters.local_date) &&
                  (!eqFilters.period_start || b.period_start === eqFilters.period_start) &&
                  (!eqFilters.period_end || b.period_end === eqFilters.period_end)
              );
              return Promise.resolve({ data: found || null, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          insert(payload: any) {
            if (table === 'briefings') {
              if (!payload.period_start || !payload.period_end || !payload.local_date) {
                return {
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: null,
                        error: { code: '23502', message: 'null value in column "period_start"/"period_end"/"local_date" violates not-null constraint' }
                      })
                  })
                };
              }
              const collision = strictBriefings.find(
                (b) =>
                  b.user_id === payload.user_id &&
                  b.type === payload.type &&
                  b.local_date === payload.local_date &&
                  b.status !== 'FAILED' &&
                  b.status !== 'CANCELED'
              );
              if (collision) {
                return {
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: null,
                        error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_briefing_delivery_slot"' }
                      })
                  })
                };
              }
              const id = `br-strict-${strictBriefings.length + 1}`;
              strictBriefings.push({ id, ...payload });
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: { id }, error: null })
                })
              };
            }
            if (table === 'briefing_items') {
              const rows = Array.isArray(payload) ? payload : [payload];
              for (const r of rows) {
                if ('order_index' in r) {
                  return Promise.resolve({
                    error: { code: '42703', message: 'column "order_index" of relation "briefing_items" does not exist' }
                  });
                }
                if (typeof r.position !== 'number' || !r.section) {
                  return Promise.resolve({
                    error: { code: '23502', message: 'null value in column "position" or "section" violates not-null constraint' }
                  });
                }
                if (!(ALLOWED_BRIEFING_SECTIONS as readonly string[]).includes(r.section)) {
                  return Promise.resolve({
                    error: {
                      code: '23514',
                      message: `new row for relation "briefing_items" violates check constraint "briefing_items_section_check" (got: ${r.section})`
                    }
                  });
                }
              }
              strictItems.push(...rows);
              return Promise.resolve({ error: null });
            }
            if (table === 'notifications') {
              const dup = strictNotifications.find(
                (n) => n.user_id === payload.user_id && n.type === payload.type && n.metadata?.briefingId === payload.metadata?.briefingId
              );
              if (dup) {
                return {
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: null,
                        error: { code: '23505', message: 'duplicate key value violates unique constraint' }
                      })
                  })
                };
              }
              const id = `notif-strict-${strictNotifications.length + 1}`;
              strictNotifications.push({ id, ...payload });
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: { id }, error: null })
                })
              };
            }
            return Promise.resolve({ error: null });
          },
          update(patch: any) {
            updatePatch = patch;
            return chain;
          },
          then(resolve: any) {
            if (chain._missingOrderIndex) {
              return Promise.resolve({ data: null, error: { code: '42703', message: 'column order_index does not exist' } }).then(resolve);
            }
            if (table === 'briefings' && updatePatch) {
              const target = strictBriefings.find((b) => b.id === eqFilters.id);
              if (target) Object.assign(target, updatePatch);
              return Promise.resolve({ error: null }).then(resolve);
            }
            if (table === 'briefing_items') {
              const mapped = strictItems
                .slice()
                .reverse()
                .map((it, idx) => ({
                  id: `bi-${idx + 1}`,
                  ...it,
                  events: {
                    id: it.event_id,
                    title: `Evento ${it.event_id}`,
                    summary: 'Resumo real',
                    relevance_score: 90,
                    published_at: '2026-11-23T09:00:00.000Z'
                  }
                }));
              return Promise.resolve({ data: mapped, error: null }).then(resolve);
            }
            if (table === 'user_entity_follows') {
              return Promise.resolve({ data: [{ entity_id: 'ent-petr' }], error: null }).then(resolve);
            }
            if (table === 'event_entities') {
              return Promise.resolve({ data: [{ event_id: 'ev-follow-1', entity_id: 'ent-petr' }], error: null }).then(resolve);
            }
            if (table === 'user_topic_follows' || table === 'event_topics') {
              return Promise.resolve({ data: [], error: null }).then(resolve);
            }
            if (table === 'user_preferences') {
              return Promise.resolve({
                data: [
                  {
                    id: userA,
                    briefing_email: 'userA@fatosbr.com.br',
                    email_morning_briefing: true,
                    email_evening_briefing: true,
                    weekend_edition: true,
                    timezone: 'America/Sao_Paulo',
                    morning_time: '07:30',
                    evening_time: '20:30'
                  }
                ],
                error: null
              }).then(resolve);
            }
            if (table === 'user_settings') {
              return Promise.resolve({
                data: [
                  {
                    user_id: userA,
                    email_breaking_alerts: true,
                    notification_settings: { dailyBriefings: true }
                  }
                ],
                error: null
              }).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }
        };
        return chain;
      }
    };

    setNotificationEngineTestDeps({
      isPostgresConfigured: () => false,
      getServerSupabase: () => strictPostgresMock as any
    });
    setBriefingEngineTestDeps({
      getServerSupabase: () => strictPostgresMock as any,
      getServerKeys: () => ({ RESEND: '' } as any)
    });

    // 2026-11-23T10:30:00Z = 07:30 America/Sao_Paulo
    const gen = await briefingEngine.generateForUser({
      userId: userA,
      type: 'MORNING',
      sendEmail: false,
      referenceDate: new Date('2026-11-23T10:30:00.000Z')
    });

    assert(
      gen.status === 'READY' && gen.eventsCount === 4,
      'Geração passa na check constraint real de section, sem order_index e com period_start/end + local_date'
    );
    assert(
      strictBriefings[0]?.local_date === '2026-11-23' &&
        strictBriefings[0]?.period_start === '2026-11-22T23:30:00.000Z' &&
        strictBriefings[0]?.period_end === '2026-11-23T10:30:59.999Z' &&
        strictBriefings[0]?.scheduled_for === '2026-11-23T10:30:00.000Z',
      'Janela editorial MORNING calculada no fuso America/Sao_Paulo e horario customizado 07:30 (20:30 ant -> 07:30 dia)'
    );
    assert(
      strictItems.every((r) => (ALLOWED_BRIEFING_SECTIONS as readonly string[]).includes(r.section)) &&
        strictItems[0]?.section === 'TOP_STORIES' &&
        strictItems[2]?.section === 'DEVELOPING' &&
        strictItems[3]?.section === 'WATCH_NEXT',
      'public.briefing_items persiste exclusivamente enum canônico (TOP_STORIES / DEVELOPING / WATCH_NEXT / UPDATES)'
    );

    // Simula corrida concorrente batendo no índice único idx_briefing_delivery_slot (23505)
    simulateConcurrent23505 = true;
    const race = await briefingEngine.generateForUser({
      userId: userA,
      type: 'MORNING',
      sendEmail: false,
      referenceDate: new Date('2026-11-23T11:00:00.000Z')
    });
    assert(
      race.status === 'SKIPPED_DUPLICATE' && Boolean(race.briefingId),
      'Corrida concorrente 23505 em idx_briefing_delivery_slot retorna SKIPPED_DUPLICATE sem duplicar'
    );
    simulateConcurrent23505 = false;

    // Teste de virada de dia UTC vs America/Sao_Paulo:
    // 2026-11-24T01:30:00Z == 2026-11-23 22:30:00 em America/Sao_Paulo -> local_date = '2026-11-23'!
    const eveningLate = await briefingEngine.generateForUser({
      userId: userA,
      type: 'EVENING',
      sendEmail: false,
      referenceDate: new Date('2026-11-24T01:30:00.000Z')
    });
    assert(
      eveningLate.status === 'READY' &&
        eveningLate.localDate === '2026-11-23' &&
        strictBriefings[1]?.local_date === '2026-11-23' &&
        strictBriefings[1]?.period_start === '2026-11-23T10:30:00.000Z' &&
        strictBriefings[1]?.period_end === '2026-11-23T23:30:59.999Z',
      'Virada de dia UTC (2026-11-24T01:30Z) preserva local_date=2026-11-23 e period_start/end em America/Sao_Paulo'
    );

    // Leitura pelo briefingService + mapeamento amigável exclusivo de UI
    setTestBriefingServiceClient({ client: strictPostgresMock, configured: true });
    const fetched = await briefingService.getUserBriefingsDetailed(userA, []);
    assert(
      fetched.items.length === 2 &&
        fetched.items[0]?.itemSections?.['ev-follow-1']?.code === 'TOP_STORIES' &&
        fetched.items[0]?.itemSections?.['ev-follow-1']?.label === 'Principais fatos' &&
        mapBriefingSectionLabel('UPDATES').label === 'Atualizações' &&
        mapBriefingSectionLabel('DEVELOPING').label === 'Em andamento' &&
        mapBriefingSectionLabel('WATCH_NEXT').label === 'Para acompanhar',
      'briefingService ordena por position e traduz enum de section para rótulos amigáveis somente no frontend'
    );

    // Valida respeto à janela de agendamento por horário do usuário (respectScheduleWindow: true)
    const beforeWindowUsers = await briefingEngine.listEligibleUsers(
      'MORNING',
      new Date('2026-11-24T10:00:00.000Z'), // 07:00 BRT (userA configurou 07:30)
      { respectScheduleWindow: true }
    );
    const insideWindowUsers = await briefingEngine.listEligibleUsers(
      'MORNING',
      new Date('2026-11-24T10:35:00.000Z'), // 07:35 BRT (>= 07:30)
      { respectScheduleWindow: true }
    );
    assert(
      beforeWindowUsers.length === 0 && insideWindowUsers.length === 1,
      'Agendamento respeita morning_time=07:30 em America/Sao_Paulo (aguarda 07:30 e libera às 07:35)'
    );

    // Valida fuso diferente (ex: Europe/London)
    const londonWindow = getBriefingPeriodWindow(
      'EVENING',
      new Date('2026-11-23T19:15:00.000Z'),
      { timezone: 'Europe/London', morningTime: '08:00', eveningTime: '19:00' }
    );
    assert(
      londonWindow.localDate === '2026-11-23' &&
        londonWindow.scheduledFor === '2026-11-23T19:00:00.000Z',
      'Suporte multi-fuso horário calcula local_date e scheduledFor corretamente fora do BRT'
    );
  } finally {
    setBriefingEngineTestDeps(null);
    setNotificationEngineTestDeps(null);
    setTestBriefingServiceClient(null);
  }

  // ---------------------------------------------------------------------------
  // 2. PREFERÊNCIAS, NOTIFICATION_SETTINGS & FAIL-CLOSED USER_SETTINGS
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Preferências Supabase, notification_settings e fail-closed em user_settings ---');
  try {
    const dbPrefs = new Map<string, any>();
    const dbSettings = new Map<string, any>();
    const client = {
      from(table: string) {
        let filterVal = '';
        const chain: any = {
          select() { return chain; },
          eq(_k: string, v: string) { filterVal = v; return chain; },
          async maybeSingle() {
            if (table === 'user_preferences') return { data: dbPrefs.get(filterVal) || null, error: null };
            if (table === 'user_settings') return { data: dbSettings.get(filterVal) || null, error: null };
            return { data: null, error: null };
          },
          async upsert(payload: any) {
            if (table === 'user_preferences') {
              dbPrefs.set(payload.id, { ...dbPrefs.get(payload.id), ...payload });
              return { error: null };
            }
            if (table === 'user_settings') {
              dbSettings.set(payload.user_id, { ...dbSettings.get(payload.user_id), ...payload });
              return { error: null };
            }
            return { error: null };
          }
        };
        return chain;
      }
    };

    setTestUserServiceClient({ client, configured: true });
    const saved = await userService.updateUserPreferencesDetailed(userB, {
      email_breaking_alerts: false,
      morning_time: '06:45',
      evening_time: '21:15',
      timezone: 'America/Sao_Paulo',
      notification_settings: {
        urgentEvents: false,
        entityUpdates: true,
        topicAlerts: false,
        sourcesDigest: true,
        dailyBriefings: false,
        onlyHighRelevance: true
      }
    });
    const loaded = await userService.getUserPreferencesDetailed(userB);
    assert(
      saved.success &&
        loaded.data?.morning_time === '06:45' &&
        loaded.data?.evening_time === '21:15' &&
        loaded.data?.notification_settings?.urgentEvents === false &&
        loaded.data?.notification_settings?.dailyBriefings === false,
      'Persistência real de notification_settings + morning_time + evening_time sobrevive ao reload'
    );

    const partialBrokenMock = {
      from(table: string) {
        const chain: any = {
          select() { return chain; },
          in() { return chain; },
          then(resolve: any) {
            if (table === 'user_entity_follows') {
              return Promise.resolve({ data: [{ user_id: userB, entity_id: 'ent-1' }], error: null }).then(resolve);
            }
            if (table === 'user_topic_follows' || table === 'user_source_follows') {
              return Promise.resolve({ data: [], error: null }).then(resolve);
            }
            if (table === 'user_preferences') {
              return Promise.resolve({
                data: [{ id: userB, email_breaking_alerts: true }],
                error: null
              }).then(resolve);
            }
            if (table === 'user_settings') {
              return Promise.resolve({
                data: null,
                error: { code: '42501', message: 'permission denied for user_settings' }
              }).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }
        };
        return chain;
      }
    };
    setNotificationEngineTestDeps({
      isPostgresConfigured: () => false,
      getServerSupabase: () => partialBrokenMock as any
    });
    const partialFail = await notificationEngine.dispatchSegmentedNotificationsForEvent({
      eventId: 'evt-partial-fail',
      title: 'Não deve ignorar erro em user_settings',
      relevanceScore: 95,
      entityIds: ['ent-1']
    });
    assert(
      partialFail.created === 0 && partialFail.errors > 0,
      'Fail-closed bloqueia disparo se user_settings retornar erro'
    );
  } finally {
    setTestUserServiceClient(null);
    setNotificationEngineTestDeps(null);
  }

  // ---------------------------------------------------------------------------
  // 3. AGENDAMENTO AUTOMÁTICO & AUDITORIA DAS MIGRAÇÕES SQL
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Agendamento Automático (BRT) & Migração SQL V2.3.2 ---');
  const prevCron = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'cron-v232-secret';
  try {
    setBriefingEngineTestDeps({
      isPostgresConfigured: () => false,
      getServerSupabase: () =>
        ({
          from: () => ({
            select: () => Promise.resolve({ data: [], error: null })
          }),
          rpc: async (fnName: string, args: any) => {
            if (fnName === 'acquire_distributed_job_lock') {
              return {
                data: { acquired: true, lock_key: args?.p_lock_key, owner_id: args?.p_owner_id, expires_at: new Date(Date.now() + 60_000).toISOString() },
                error: null
              };
            }
            if (fnName === 'renew_distributed_job_lock') return { data: { renewed: true }, error: null };
            if (fnName === 'release_distributed_job_lock') return { data: true, error: null };
            if (fnName === 'record_briefing_job_run') return { data: { recorded: true }, error: null };
            return { data: null, error: null };
          }
        }) as any
    });

    const getUnauth = createMockRes();
    await generateBriefingsHandler({ method: 'GET', headers: {}, url: '/api/notifications/generate-briefings' }, getUnauth.res);
    assert(getUnauth.getStatus() === 401, 'GET /api/notifications/generate-briefings sem CRON_SECRET retorna 401');

    // 2026-11-24T01:30:00.000Z = 22:30 America/Sao_Paulo -> sem type explícito deve detectar EVENING no BRT!
    const getCronAutoType = createMockRes();
    await generateBriefingsHandler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-v232-secret' },
        url: '/api/notifications/generate-briefings?respectSchedule=true&sendEmail=false&referenceDate=2026-11-24T01:30:00.000Z'
      },
      getCronAutoType.res
    );
    assert(
      getCronAutoType.getStatus() === 200 &&
        getCronAutoType.getJson().type === 'EVENING' &&
        getCronAutoType.getJson().respectScheduleWindow === true,
      'Handler infere edição EVENING em America/Sao_Paulo mesmo após 00:00 UTC e propaga respectScheduleWindow'
    );
  } finally {
    setBriefingEngineTestDeps(null);
    if (prevCron !== undefined) process.env.CRON_SECRET = prevCron;
    else delete process.env.CRON_SECRET;
  }

  const mig232 = fs.readFileSync(
    path.resolve('supabase/migrations/20261121000002_v2_3_2_briefings_period_and_items.sql'),
    'utf-8'
  );
  assert(
    mig232.includes("DEFAULT 'TOP_STORIES'") &&
      !mig232.includes("DEFAULT 'Destaques'") &&
      mig232.includes('local_date') &&
      mig232.includes('idx_briefing_delivery_slot') &&
      !mig232.includes('DROP TABLE') &&
      !mig232.includes('DROP CONSTRAINT'),
    'Migração V2.3.2 usa DEFAULT TOP_STORIES, respeita idx_briefing_delivery_slot e não destrói constraints'
  );

  console.log('\n======================================================================');
  console.log(`🎉 RESULTADO V2.3.2: ${passed} passaram, ${failed} falharam.`);
  console.log('======================================================================\n');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Erro inesperado V2.3.2:', err);
  process.exit(1);
});
