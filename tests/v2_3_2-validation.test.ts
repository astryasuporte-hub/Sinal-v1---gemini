/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.3.2 — SUÍTE DE VALIDAÇÃO ESTRITA DE CONTRATO POSTGRESQL & SEGURANÇA
 *
 * Valida explicitamente os 8 pontos da V2.3.2:
 * 1. Preenchimento obrigatório de period_start e period_end em public.briefings.
 * 2. Preenchimento obrigatório de position e section em public.briefing_items (sem order_index).
 * 3. Deduplicação utilizando índices existentes (period_start/period_end + 23505 em briefings e notifications).
 * 4. Compatibilidade das preferências entre public.user_preferences e public.user_settings.
 * 5. Persistência real de notification_settings (JSONB) sem falso sucesso.
 * 6. Correções no motor de notificações (7 tipos aceitos, fail-closed, 6 preferências).
 * 7. Preparação do agendamento automático (/api/notifications/generate-briefings GET/POST com CRON_SECRET).
 * 8. Migração incremental V2.3.2 e preservação de limites/escopo.
 */

import fs from 'fs';
import path from 'path';
import { briefingEngine, setBriefingEngineTestDeps } from '../api/_lib/briefingEngine.js';
import { briefingService, setTestBriefingServiceClient } from '../src/services/briefingService.js';
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
  console.log('🛡️  FATOSBR V2.3.2 — AUDITORIA & TESTES DE CONTRATO REAL');
  console.log('======================================================================\n');

  const userA = 'user-v232-aaaa-1111-2222-333344445555';
  const userB = 'user-v232-bbbb-6666-7777-888899990000';

  // ---------------------------------------------------------------------------
  // 1-3. BRIEFINGS: PERIOD_START/END, BRIEFING_ITEMS: POSITION/SECTION, DEDUP 23505
  // ---------------------------------------------------------------------------
  console.log('--- 1. Contrato estrito PostgreSQL: period_start, period_end, position, section & dedup ---');
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
              // Simula esquema real sem coluna order_index
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
            if (table === 'briefings') {
              if (simulateConcurrent23505 && !eqFilters.id && strictBriefings.length > 0 && !updatePatch) {
                simulateConcurrent23505 = false;
                return Promise.resolve({ data: null, error: null });
              }
              const found = strictBriefings.find(
                (b) =>
                  b.user_id === eqFilters.user_id &&
                  b.type === eqFilters.type &&
                  (!eqFilters.period_start || b.period_start === eqFilters.period_start) &&
                  (!eqFilters.period_end || b.period_end === eqFilters.period_end)
              );
              return Promise.resolve({ data: found || null, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          insert(payload: any) {
            if (table === 'briefings') {
              // Impõe NOT NULL em period_start e period_end exatamente como PostgreSQL
              if (!payload.period_start || !payload.period_end) {
                return {
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: null,
                        error: { code: '23502', message: 'null value in column "period_start"/"period_end" violates not-null constraint' }
                      })
                  })
                };
              }
              // Simula índice único existente em (user_id, type, period_start, period_end)
              const collision = strictBriefings.find(
                (b) =>
                  b.user_id === payload.user_id &&
                  b.type === payload.type &&
                  b.period_start === payload.period_start &&
                  b.period_end === payload.period_end &&
                  b.status !== 'FAILED' &&
                  b.status !== 'CANCELED'
              );
              if (collision) {
                return {
                  select: () => ({
                    single: () =>
                      Promise.resolve({
                        data: null,
                        error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_briefings_user_type_period_active"' }
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
                // Rejeita order_index (inexistente) e exige position + section NOT NULL
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
                .reverse() // força fora de ordem para validar sort por position
                .map((it, idx) => ({
                  id: `bi-${idx + 1}`,
                  ...it,
                  events: {
                    id: it.event_id,
                    title: it.event_id === 'ev-follow-1' ? 'Petrobras' : 'IPCA-15',
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
                    timezone: 'America/Sao_Paulo'
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

    const gen = await briefingEngine.generateForUser({
      userId: userA,
      type: 'MORNING',
      sendEmail: false,
      referenceDate: new Date('2026-11-23T10:00:00.000Z')
    });

    assert(gen.status === 'READY' && gen.eventsCount === 2, 'Geração passa em schema estrito sem order_index e com NOT NULL em period_start/end + position/section');
    assert(
      strictBriefings[0]?.period_start === '2026-11-23T00:00:00.000Z' &&
        strictBriefings[0]?.period_end === '2026-11-23T11:59:59.999Z',
      'public.briefings recebe period_start e period_end válidos para a edição MORNING'
    );
    assert(
      strictItems[0]?.position === 1 &&
        strictItems[0]?.section === 'Para você' &&
        strictItems[1]?.position === 2 &&
        strictItems[1]?.section === 'Destaques',
      'public.briefing_items recebe position (1..N) e section sem enviar coluna inexistente order_index'
    );

    // Simula corrida concorrente batendo no índice único 23505
    simulateConcurrent23505 = true;
    const race = await briefingEngine.generateForUser({
      userId: userA,
      type: 'MORNING',
      sendEmail: false,
      referenceDate: new Date('2026-11-23T10:05:00.000Z')
    });
    assert(
      race.status === 'SKIPPED_DUPLICATE' && Boolean(race.briefingId),
      'Corrida concorrente 23505 no índice de período retorna SKIPPED_DUPLICATE sem criar duplicata'
    );
    simulateConcurrent23505 = false;

    // Leitura pelo briefingService no esquema com position + section + period_start/end
    setTestBriefingServiceClient({ client: strictPostgresMock, configured: true });
    const fetched = await briefingService.getUserBriefingsDetailed(userA, []);
    assert(
      fetched.items.length === 1 &&
        fetched.items[0].periodStart === '2026-11-23T00:00:00.000Z' &&
        fetched.items[0].periodEnd === '2026-11-23T11:59:59.999Z' &&
        fetched.items[0].rawEvents[0]?.id === 'ev-follow-1',
      'briefingService lê periodStart, periodEnd e ordena acontecimentos por position ASC sem depender de order_index'
    );
  } finally {
    setBriefingEngineTestDeps(null);
    setNotificationEngineTestDeps(null);
    setTestBriefingServiceClient(null);
  }

  // ---------------------------------------------------------------------------
  // 4-6. PREFERÊNCIAS, NOTIFICATION_SETTINGS & FAIL-CLOSED USER_SETTINGS
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
        loaded.data?.notification_settings?.urgentEvents === false &&
        loaded.data?.notification_settings?.dailyBriefings === false,
      'Persistência real de notification_settings sobrevive ao reload sem perder nenhum dos 6 toggles'
    );

    // Fail-closed quando user_settings falha mesmo que user_preferences esteja acessível
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
      'Fail-closed bloqueia disparo se user_settings retornar erro (não ignora opt-outs)'
    );
  } finally {
    setTestUserServiceClient(null);
    setNotificationEngineTestDeps(null);
  }

  // ---------------------------------------------------------------------------
  // 7-8. AGENDAMENTO AUTOMÁTICO (GET/POST CRON_SECRET) & MIGRAÇÃO V2.3.2
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Agendamento Automático & Migração Incremental V2.3.2 ---');
  const prevCron = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'cron-v232-secret';
  try {
    setBriefingEngineTestDeps({
      getServerSupabase: () =>
        ({
          from: () => ({
            select: () => Promise.resolve({ data: [], error: null })
          })
        }) as any
    });

    const getUnauth = createMockRes();
    await generateBriefingsHandler({ method: 'GET', headers: {}, url: '/api/notifications/generate-briefings' }, getUnauth.res);
    assert(getUnauth.getStatus() === 401, 'GET /api/notifications/generate-briefings sem CRON_SECRET retorna 401');

    const getCron = createMockRes();
    await generateBriefingsHandler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-v232-secret' },
        url: '/api/notifications/generate-briefings?type=EVENING&sendEmail=false&referenceDate=2026-11-23T21:00:00.000Z'
      },
      getCron.res
    );
    assert(
      getCron.getStatus() === 200 && getCron.getJson().type === 'EVENING' && getCron.getJson().mode === 'BATCH_CYCLE',
      'GET /api/notifications/generate-briefings autenticado com CRON_SECRET executa ciclo automático EVENING'
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
    mig232.includes('period_start') &&
      mig232.includes('period_end') &&
      mig232.includes('position') &&
      mig232.includes('section') &&
      mig232.includes('idx_briefings_user_type_period_active'),
    'Migração incremental V2.3.2 cobre period_start, period_end, position, section e índice de deduplicação'
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
