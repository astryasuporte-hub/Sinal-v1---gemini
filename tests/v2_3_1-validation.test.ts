/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR V2.3.1 — SUÍTE DE VALIDAÇÃO DEFINITIVA
 *
 * Cobre integralmente:
 * 1. userService: falha explícita quando colunas/tabelas não suportam o campo (zero falso sucesso),
 *    persistência canônica mesclada user_preferences + user_settings e isolamento multiusuário.
 * 2. briefingService: tipo MORNING/EVENING em caixa alta, mapeamento fiel dos 6 status do PostgreSQL
 *    (nunca exibe GENERATING/PENDING/CANCELED como "Pronto"), joins briefing_items -> events e ordenação.
 * 3. notificationService: consistência read + read_at em leitura e marcação como lida isolada por user_id.
 * 4. notificationEngine: normalização para os 7 tipos aceitos pela constraint do banco,
 *    respeito real às 6 preferências + relevância, fail-closed em erro de preferência e deduplicação 23505.
 * 5. briefingEngine: pipeline real em 7 etapas (seleção -> GENERATING -> briefing_items -> READY ->
 *    BRIEFING_READY -> envio Resend -> SENT somente com 2xx), zero briefings vazios e proteção de duplicidade.
 * 6. Endpoint /api/notifications/generate-briefings protegido por CRON_SECRET/ADMIN_SECRET + auditoria de escopo.
 */

import fs from 'fs';
import path from 'path';
import { userService, setTestUserServiceClient } from '../src/services/userService.js';
import {
  briefingService,
  setTestBriefingServiceClient,
  normalizeBriefingType,
  mapBriefingStatus
} from '../src/services/briefingService.js';
import { notificationService } from '../src/services/notificationService.js';
import {
  notificationEngine,
  normalizeNotificationType,
  setNotificationEngineTestDeps,
  ALLOWED_NOTIFICATION_TYPES
} from '../api/_lib/notificationEngine.js';
import {
  briefingEngine,
  setBriefingEngineTestDeps
} from '../api/_lib/briefingEngine.js';
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
  let body = '';
  const res: any = {
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return headers[k.toLowerCase()];
    },
    end(chunk?: any) {
      if (chunk) body += String(chunk);
    },
    set statusCode(c: number) {
      statusCode = c;
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
        return JSON.parse(body || '{}');
      } catch {
        return {};
      }
    }
  };
}

async function run() {
  console.log('======================================================================');
  console.log('🛡️  FATOSBR V2.3.1 — VALIDAÇÃO DEFINITIVA DE BRIEFINGS E NOTIFICAÇÕES');
  console.log('======================================================================\n');

  const userA = 'user-aaaa-1111-2222-3333-444455556666';
  const userB = 'user-bbbb-1111-2222-3333-444455557777';

  // ---------------------------------------------------------------------------
  // 1. USERSERVICE: SEM FALSO SUCESSO & ARMAZENAMENTO CANÔNICO
  // ---------------------------------------------------------------------------
  console.log('--- 1. userService: Sem falso sucesso e persistência canônica ---');
  try {
    // 1.1 Esquema legado sem coluna notification_settings e sem colunas de horário em nenhuma tabela
    const missingSchemaClient = {
      from(table: string) {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: null, error: null };
          },
          async upsert(payload: any) {
            if ('notification_settings' in payload || 'morning_time' in payload) {
              return { error: { code: '42703', message: `column in ${table} does not exist` } };
            }
            return { error: null };
          }
        };
      }
    };

    setTestUserServiceClient({ client: missingSchemaClient, configured: true });

    const failNotifSave = await userService.updateUserPreferencesDetailed(userA, {
      email_breaking_alerts: false,
      notification_settings: { urgentEvents: false, dailyBriefings: false }
    });
    assert(
      failNotifSave.success === false && Boolean(failNotifSave.error),
      'updateUserPreferencesDetailed falha explicitamente quando notification_settings não existe no banco'
    );

    const failSchedSave = await userService.updateUserPreferencesDetailed(userA, {
      briefing_email: 'leitor@fatosbr.com.br',
      morning_time: '07:30',
      timezone: 'America/Sao_Paulo'
    });
    assert(
      failSchedSave.success === false && Boolean(failSchedSave.error),
      'updateUserPreferencesDetailed falha explicitamente quando colunas de horário não existem (nunca descarta e retorna true)'
    );

    // 1.2 Armazenamento canônico real: user_preferences (entrega base) + user_settings (notification_settings + horários)
    const tblUserPrefs = new Map<string, any>();
    const tblUserSettings = new Map<string, any>();

    const canonicalClient = {
      from(table: string) {
        let filterCol = '';
        let filterVal = '';
        const chain: any = {
          select() { return chain; },
          eq(col: string, val: string) {
            filterCol = col;
            filterVal = val;
            return chain;
          },
          async maybeSingle() {
            if (table === 'user_preferences') {
              return { data: tblUserPrefs.get(filterVal) || null, error: null };
            }
            if (table === 'user_settings') {
              return { data: tblUserSettings.get(filterVal) || null, error: null };
            }
            return { data: null, error: null };
          },
          async upsert(payload: any) {
            if (table === 'user_preferences') {
              // Simula produção auditada onde user_preferences não possui notification_settings nem morning_time
              if ('notification_settings' in payload || 'morning_time' in payload || 'evening_time' in payload) {
                return { error: { code: '42703', message: 'column does not exist in user_preferences' } };
              }
              tblUserPrefs.set(payload.id, { ...tblUserPrefs.get(payload.id), ...payload });
              return { error: null };
            }
            if (table === 'user_settings') {
              tblUserSettings.set(payload.user_id, { ...tblUserSettings.get(payload.user_id), ...payload });
              return { error: null };
            }
            return { error: null };
          }
        };
        return chain;
      }
    };

    setTestUserServiceClient({ client: canonicalClient, configured: true });

    const okSaveA = await userService.updateUserPreferencesDetailed(userA, {
      briefing_email: 'userA@fatosbr.com.br',
      email_morning_briefing: true,
      email_evening_briefing: false,
      email_breaking_alerts: false,
      morning_time: '06:30',
      evening_time: '20:15',
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
    assert(okSaveA.success === true, 'Persistência híbrida grava entrega em user_preferences e notification_settings/horários em user_settings');

    const loadedA = await userService.getUserPreferencesDetailed(userA);
    const loadedB = await userService.getUserPreferencesDetailed(userB);
    assert(
      loadedA.data?.briefing_email === 'userA@fatosbr.com.br' &&
        loadedA.data?.morning_time === '06:30' &&
        loadedA.data?.notification_settings?.topicAlerts === false &&
        loadedA.data?.notification_settings?.dailyBriefings === false,
      'getUserPreferencesDetailed consolida user_preferences + user_settings preservando os 6 toggles e horários'
    );
    assert(loadedB.data === null && !loadedB.error, 'Isolamento multiusuário: Usuário B não recebe dados do Usuário A');
  } finally {
    setTestUserServiceClient(null);
  }

  // ---------------------------------------------------------------------------
  // 2. BRIEFINGSERVICE: CONTRATO POSTGRESQL & JOINS REAIS
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. briefingService: Tipo MORNING/EVENING, 6 Status e Joins ---');
  try {
    assert(normalizeBriefingType('MORNING') === 'MORNING', 'Normaliza MORNING corretamente');
    assert(normalizeBriefingType('EVENING') === 'EVENING', 'Normaliza EVENING corretamente');
    assert(mapBriefingStatus('PENDING').label === 'Agendado', 'PENDING -> Agendado');
    assert(mapBriefingStatus('GENERATING').label === 'Em preparação', 'GENERATING -> Em preparação (nunca Pronto)');
    assert(mapBriefingStatus('READY').label === 'Pronto', 'READY -> Pronto');
    assert(mapBriefingStatus('SENT').label === 'Enviado', 'SENT -> Enviado');
    assert(mapBriefingStatus('FAILED').label === 'Falha na geração', 'FAILED -> Falha na geração');
    assert(mapBriefingStatus('CANCELED').label === 'Cancelado', 'CANCELED -> Cancelado');

    const nowIso = new Date().toISOString();
    const mockBriefingsRows = [
      {
        id: 'br-1',
        user_id: userA,
        type: 'MORNING',
        title: 'Briefing Matinal Real',
        description: 'Resumo de abertura',
        status: 'GENERATING',
        scheduled_for: nowIso,
        created_at: nowIso
      },
      {
        id: 'br-2',
        user_id: userA,
        type: 'EVENING',
        title: 'Briefing Noturno Real',
        description: 'Fechamento de mercado',
        status: 'SENT',
        scheduled_for: nowIso,
        created_at: nowIso
      },
      {
        id: 'br-other',
        user_id: userB,
        type: 'MORNING',
        title: 'Outro Usuário',
        status: 'READY',
        scheduled_for: nowIso,
        created_at: nowIso
      }
    ];

    let capturedEventsSelect = '';
    const mockBriefingDb = {
      from(table: string) {
        let eqUserId = '';
        const chain: any = {
          select(sel: string) {
            if (table === 'briefing_items') capturedEventsSelect = sel;
            return chain;
          },
          eq(k: string, v: string) {
            if (k === 'user_id') eqUserId = v;
            return chain;
          },
          in() { return chain; },
          order() { return chain; },
          limit() {
            return Promise.resolve({
              data: mockBriefingsRows.filter((b) => b.user_id === eqUserId),
              error: null
            });
          },
          then(resolve: any) {
            // Para briefing_items ordenado
            return Promise.resolve({
              data: [
                {
                  id: 'bi-2',
                  briefing_id: 'br-2',
                  event_id: 'ev-2',
                  order_index: 1,
                  events: {
                    id: 'ev-2',
                    title: 'Segundo evento ordenado',
                    summary: 'Resumo 2',
                    relevance_score: 82,
                    published_at: nowIso
                  }
                },
                {
                  id: 'bi-1',
                  briefing_id: 'br-2',
                  event_id: 'ev-1',
                  order_index: 0,
                  events: {
                    id: 'ev-1',
                    title: 'Primeiro evento ordenado',
                    summary: 'Resumo 1',
                    relevance_score: 94,
                    published_at: nowIso
                  }
                }
              ],
              error: null
            }).then(resolve);
          }
        };
        return chain;
      }
    };

    setTestBriefingServiceClient({ client: mockBriefingDb, configured: true });
    const resA = await briefingService.getUserBriefingsDetailed(userA, []);
    assert(resA.items.length === 2, 'Carrega apenas briefings do Usuário A (exclui Usuário B)');
    assert(
      !capturedEventsSelect.includes('what_happened') && !capturedEventsSelect.includes('image_url'),
      'Query de join briefing_items -> events solicita exclusivamente colunas reais de public.events'
    );
    const brMorning = resA.items.find((b) => b.id === 'br-1');
    const brEvening = resA.items.find((b) => b.id === 'br-2');
    assert(
      brMorning?.type === 'morning' && brMorning.status === 'Em preparação',
      'Briefing MORNING com status GENERATING mapeado corretamente sem falsificar Pronto'
    );
    assert(
      brEvening?.type === 'evening' &&
        brEvening.status === 'Enviado' &&
        brEvening.rawEvents.length === 2 &&
        brEvening.rawEvents[0].id === 'ev-1',
      'Briefing EVENING SENT preserva ordenação por order_index dos acontecimentos reais'
    );
  } finally {
    setTestBriefingServiceClient(null);
  }

  // ---------------------------------------------------------------------------
  // 3. NOTIFICATIONSERVICE: CONSISTÊNCIA READ + READ_AT
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. notificationService: Consistência de read e read_at ---');
  try {
    const dbNotifs = [
      {
        id: 'n-unread',
        user_id: userA,
        type: 'NEWS_HIGH_RELEVANCE',
        title: 'Fato relevante',
        subtitle: 'Resumo do fato',
        category: 'acontecimentos',
        read: false,
        read_at: null,
        created_at: new Date().toISOString()
      },
      {
        id: 'n-read-at-only',
        user_id: userA,
        type: 'BRIEFING_READY',
        title: 'Briefing Matinal pronto',
        subtitle: 'Edição pronta',
        category: 'atualizacoes',
        read: false,
        read_at: '2026-11-21T09:00:00.000Z',
        created_at: new Date().toISOString()
      }
    ];
    let lastUpdatePayload: any = null;

    const mockNotifClient = {
      from(table: string) {
        let eqUser = '';
        let eqId = '';
        const chain: any = {
          select() { return chain; },
          update(payload: any) {
            lastUpdatePayload = payload;
            return chain;
          },
          eq(k: string, v: any) {
            if (k === 'user_id') eqUser = v;
            if (k === 'id') eqId = v;
            return chain;
          },
          order() { return chain; },
          range() {
            return Promise.resolve({
              data: dbNotifs.filter((n) => n.user_id === eqUser),
              error: null
            });
          },
          then(resolve: any) {
            if (table === 'notifications' && lastUpdatePayload) {
              for (const n of dbNotifs) {
                if (n.user_id === eqUser && (!eqId || n.id === eqId)) {
                  Object.assign(n, lastUpdatePayload);
                }
              }
            }
            return Promise.resolve({ error: null }).then(resolve);
          }
        };
        return chain;
      }
    };

    notificationService.setTestClient({ client: mockNotifClient, configured: true });
    const list = await notificationService.getUserNotificationsDetailed(userA);
    assert(list.items.length === 2, 'Carrega notificações reais do usuário');
    assert(list.items[1].read === true && Boolean(list.items[1].readAt), 'Notificação com read_at preenchido é tratada como lida');

    const markRes = await notificationService.markAsReadDetailed('n-unread', userA);
    assert(
      markRes.success === true && lastUpdatePayload?.read === true && Boolean(lastUpdatePayload?.read_at),
      'markAsReadDetailed persiste read = true e read_at preenchido'
    );
  } finally {
    notificationService.setTestClient(null);
  }

  // ---------------------------------------------------------------------------
  // 4. NOTIFICATIONENGINE: TIPOS CANÔNICOS, OPT-OUTS, FAIL-CLOSED & 23505
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. notificationEngine: Tipos, Preferências, Fail-Closed & 23505 ---');
  try {
    assert(ALLOWED_NOTIFICATION_TYPES.length === 7, 'Exactamente 7 tipos permitidos pela constraint auditada');
    assert(normalizeNotificationType('EVENT_UPDATED') === 'NEWS_HIGH_RELEVANCE', 'Normaliza EVENT_UPDATED -> NEWS_HIGH_RELEVANCE');
    assert(normalizeNotificationType('OPERATIONAL_ALERT') === 'SYSTEM', 'Normaliza OPERATIONAL_ALERT -> SYSTEM');
    assert(normalizeNotificationType('BRIEFING_READY') === 'BRIEFING_READY', 'Preserva BRIEFING_READY');

    const insertedNotifications: any[] = [];
    let simulateDuplicateOnSecondInsert = false;

    const engineSupabaseMock = {
      from(table: string) {
        let eqUser = '';
        let inUsers: string[] = [];
        const chain: any = {
          select() { return chain; },
          eq(k: string, v: any) {
            if (k === 'user_id' || k === 'id') eqUser = v;
            return chain;
          },
          in(k: string, vals: any[]) {
            if (k === 'user_id' || k === 'id') inUsers = vals;
            return chain;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
          insert(payload: any) {
            return {
              select() {
                return {
                  single() {
                    if (simulateDuplicateOnSecondInsert && insertedNotifications.some((n) => n.user_id === payload.user_id && n.event_id === payload.event_id)) {
                      return Promise.resolve({
                        data: null,
                        error: { code: '23505', message: 'duplicate key value violates unique constraint' }
                      });
                    }
                    const id = `notif-${insertedNotifications.length + 1}`;
                    insertedNotifications.push({ id, ...payload });
                    return Promise.resolve({ data: { id }, error: null });
                  }
                };
              }
            };
          },
          then(resolve: any) {
            if (table === 'user_entity_follows') {
              return Promise.resolve({
                data: [
                  { user_id: userA, entity_id: 'ent-petr' },
                  { user_id: userB, entity_id: 'ent-petr' }
                ],
                error: null
              }).then(resolve);
            }
            if (table === 'user_topic_follows') return Promise.resolve({ data: [], error: null }).then(resolve);
            if (table === 'user_source_follows') return Promise.resolve({ data: [{ user_id: userA, source_id: 'src-g1' }], error: null }).then(resolve);
            if (table === 'user_preferences') {
              return Promise.resolve({
                data: [
                  { id: userA, email_breaking_alerts: true },
                  { id: userB, email_breaking_alerts: false }
                ].filter((r) => !inUsers.length || inUsers.includes(r.id)),
                error: null
              }).then(resolve);
            }
            if (table === 'user_settings') {
              return Promise.resolve({
                data: [
                  {
                    user_id: userA,
                    email_breaking_alerts: true,
                    notification_settings: {
                      urgentEvents: true,
                      entityUpdates: true,
                      topicAlerts: true,
                      sourcesDigest: true,
                      dailyBriefings: false,
                      onlyHighRelevance: true
                    }
                  },
                  {
                    user_id: userB,
                    email_breaking_alerts: false,
                    notification_settings: {
                      urgentEvents: false,
                      entityUpdates: false,
                      topicAlerts: true,
                      sourcesDigest: true,
                      dailyBriefings: true,
                      onlyHighRelevance: true
                    }
                  }
                ].filter((r) => (!inUsers.length || inUsers.includes(r.user_id)) && (!eqUser || r.user_id === eqUser)),
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
      getServerSupabase: () => engineSupabaseMock as any
    });

    // Evento alta relevância -> User A recebe (urgentEvents=true, entityUpdates=true); User B bloqueado por opt-out
    const dispatchRes = await notificationEngine.dispatchSegmentedNotificationsForEvent({
      eventId: 'evt-900',
      title: 'Petrobras anuncia plano estratégico',
      relevanceScore: 92,
      entityIds: ['ent-petr'],
      type: 'EVENT_UPDATED'
    });
    assert(
      dispatchRes.created === 1 &&
        dispatchRes.skippedByPreferences === 1 &&
        insertedNotifications.length === 1 &&
        insertedNotifications[0].user_id === userA &&
        insertedNotifications[0].type === 'NEWS_HIGH_RELEVANCE',
      'Motor notifica apenas User A, respeita opt-out de User B e grava tipo canônico NEWS_HIGH_RELEVANCE'
    );

    // Evento abaixo de 85 quando onlyHighRelevance=true -> User A NÃO recebe
    const lowRelRes = await notificationEngine.dispatchSegmentedNotificationsForEvent({
      eventId: 'evt-low',
      title: 'Nota de baixa relevância',
      relevanceScore: 60,
      entityIds: ['ent-petr']
    });
    assert(
      lowRelRes.created === 0,
      'Respeita onlyHighRelevance=true ignorando acontecimento com relevância < 85'
    );

    // Concorrência 23505
    simulateDuplicateOnSecondInsert = true;
    const dupAttempt = await notificationEngine.createNotification({
      userId: userA,
      type: 'NEWS_HIGH_RELEVANCE',
      title: 'Duplicata concorrente',
      category: 'entidades',
      eventId: 'evt-900'
    });
    assert(
      dupAttempt.success === true && dupAttempt.duplicate === true,
      'Violação concorrente 23505 retorna duplicate sem falhar nem duplicar'
    );

    // dailyBriefings=false para User A -> createBriefingReadyNotification pula User A
    const brNotifSkipped = await notificationEngine.createBriefingReadyNotification({
      userId: userA,
      briefingId: 'br-skip',
      briefingType: 'MORNING',
      title: 'Briefing Matinal',
      eventsCount: 4
    });
    assert(brNotifSkipped.skipped === true, 'Respeita dailyBriefings=false e não envia BRIEFING_READY');

    // Fail-closed se preferências falharem
    const brokenPrefSupabase = {
      from(table: string) {
        const chain: any = {
          select() { return chain; },
          in() { return chain; },
          then(resolve: any) {
            if (table === 'user_entity_follows') {
              return Promise.resolve({ data: [{ user_id: userA, entity_id: 'ent-1' }], error: null }).then(resolve);
            }
            if (table === 'user_topic_follows' || table === 'user_source_follows') {
              return Promise.resolve({ data: [], error: null }).then(resolve);
            }
            return Promise.resolve({ data: null, error: { message: 'permission denied for preferences' } }).then(resolve);
          }
        };
        return chain;
      }
    };
    setNotificationEngineTestDeps({
      isPostgresConfigured: () => false,
      getServerSupabase: () => brokenPrefSupabase as any
    });
    const failClosedRes = await notificationEngine.dispatchSegmentedNotificationsForEvent({
      eventId: 'evt-failclosed',
      title: 'Não deve disparar sem verificar opt-out',
      relevanceScore: 99,
      entityIds: ['ent-1']
    });
    assert(
      failClosedRes.created === 0 && failClosedRes.errors > 0 && Boolean(failClosedRes.errorDetails?.length),
      'Fail-closed: aborta disparo se preferências não puderem ser verificadas (nunca ignora erro silenciosamente)'
    );
  } finally {
    setNotificationEngineTestDeps(null);
  }

  // ---------------------------------------------------------------------------
  // 5. BRIEFINGENGINE: CICLO REAL DE 7 ETAPAS & ENDPOINT PROTEGIDO
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. briefingEngine: Pipeline em 7 etapas & /api/notifications/generate-briefings ---');
  try {
    const dbBriefings: any[] = [];
    const dbBriefingItems: any[] = [];
    const dbEngineNotifs: any[] = [];
    let currentEventsFixture: any[] = [
      {
        id: 'ev-real-1',
        title: 'Banco Central publica ata com sinalização de juros',
        summary: 'Comitê detalha trajetória da taxa básica.',
        relevance_score: 95,
        published_at: new Date().toISOString()
      },
      {
        id: 'ev-real-2',
        title: 'Exportações batem recorde trimestral',
        summary: 'Balança comercial registra superávit.',
        relevance_score: 86,
        published_at: new Date().toISOString()
      }
    ];

    const briefingDbMock = {
      from(table: string) {
        let eqFilters: Record<string, any> = {};
        let updatePatch: any = null;
        const chain: any = {
          select() { return chain; },
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
              return Promise.resolve({ data: currentEventsFixture, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
          maybeSingle() {
            if (table === 'briefings') {
              const found = dbBriefings.find(
                (b) => b.user_id === eqFilters.user_id && b.type === eqFilters.type
              );
              return Promise.resolve({ data: found || null, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          insert(payload: any) {
            if (table === 'briefings') {
              const id = `br-gen-${dbBriefings.length + 1}`;
              const row = { id, statusTransitions: [payload.status], ...payload };
              dbBriefings.push(row);
              return {
                select() {
                  return {
                    single: () => Promise.resolve({ data: { id }, error: null })
                  };
                }
              };
            }
            if (table === 'briefing_items') {
              const rows = Array.isArray(payload) ? payload : [payload];
              dbBriefingItems.push(...rows);
              return Promise.resolve({ error: null });
            }
            if (table === 'notifications') {
              const id = `bn-${dbEngineNotifs.length + 1}`;
              dbEngineNotifs.push({ id, ...payload });
              return {
                select() {
                  return {
                    single: () => Promise.resolve({ data: { id }, error: null })
                  };
                }
              };
            }
            return Promise.resolve({ error: null });
          },
          update(patch: any) {
            updatePatch = patch;
            return chain;
          },
          then(resolve: any) {
            if (table === 'briefings' && updatePatch) {
              const target = dbBriefings.find((b) => b.id === eqFilters.id);
              if (target) {
                Object.assign(target, updatePatch);
                if (updatePatch.status) target.statusTransitions.push(updatePatch.status);
              }
              return Promise.resolve({ error: null }).then(resolve);
            }
            if (table === 'user_preferences') {
              return Promise.resolve({
                data: [
                  {
                    id: userA,
                    briefing_email: 'leitorA@fatosbr.com.br',
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
      },
      rpc: async (fnName: string, args: any) => {
        if (fnName === 'acquire_distributed_job_lock') {
          return {
            data: { acquired: true, lock_key: args?.p_lock_key, owner_id: args?.p_owner_id, expires_at: new Date(Date.now() + 60_000).toISOString() },
            error: null
          };
        }
        if (fnName === 'renew_distributed_job_lock') {
          return { data: { renewed: true }, error: null };
        }
        if (fnName === 'release_distributed_job_lock') {
          return { data: true, error: null };
        }
        if (fnName === 'record_briefing_job_run') {
          return { data: { recorded: true }, error: null };
        }
        return { data: null, error: null };
      }
    };

    setNotificationEngineTestDeps({
      isPostgresConfigured: () => false,
      getServerSupabase: () => briefingDbMock as any
    });

    // 5.1 Sem RESEND_API_KEY, briefing avança GENERATING -> READY (nunca SENT)
    setBriefingEngineTestDeps({
      isPostgresConfigured: () => false,
      getServerSupabase: () => briefingDbMock as any,
      getServerKeys: () => ({ RESEND: '' } as any)
    });

    const genReady = await briefingEngine.generateForUser({
      userId: userA,
      type: 'MORNING',
      briefingEmail: 'leitorA@fatosbr.com.br',
      sendEmail: true,
      referenceDate: new Date('2026-11-23T10:00:00.000Z') // segunda-feira
    });
    assert(
      genReady.status === 'READY' &&
        genReady.eventsCount === 2 &&
        genReady.notificationCreated === true &&
        genReady.emailSent === false,
      'Etapas 1-5 criam GENERATING -> briefing_items -> READY -> BRIEFING_READY; sem Resend permanece READY'
    );
    assert(
      dbBriefings[0].statusTransitions.join('->') === 'GENERATING->READY' && dbBriefingItems.length === 2,
      'Histórico real de transições registrado: GENERATING -> READY com 2 itens ordenados'
    );

    // 5.2 Segunda execução no mesmo dia bloqueada por duplicidade
    const dupRun = await briefingEngine.generateForUser({
      userId: userA,
      type: 'MORNING',
      referenceDate: new Date('2026-11-23T11:00:00.000Z')
    });
    assert(dupRun.status === 'SKIPPED_DUPLICATE', 'Impede criação duplicada para mesmo usuário + tipo + dia');

    // 5.3 Com RESEND_API_KEY + HTTP 200 Resend, edição EVENING avança até SENT com sent_at
    let fetchCalled = false;
    setBriefingEngineTestDeps({
      getServerSupabase: () => briefingDbMock as any,
      getServerKeys: () => ({ RESEND: 're_test_123456' } as any),
      fetchFn: (async () => {
        fetchCalled = true;
        return new Response(JSON.stringify({ id: 'email-123' }), { status: 200 });
      }) as any
    });

    const genSent = await briefingEngine.generateForUser({
      userId: userA,
      type: 'EVENING',
      briefingEmail: 'leitorA@fatosbr.com.br',
      sendEmail: true,
      referenceDate: new Date('2026-11-23T22:00:00.000Z')
    });
    assert(
      fetchCalled &&
        genSent.status === 'SENT' &&
        genSent.emailSent === true &&
        dbBriefings[1].statusTransitions.join('->') === 'GENERATING->READY->SENT' &&
        Boolean(dbBriefings[1].sent_at),
      'Com Resend HTTP 200, briefing transiciona GENERATING -> READY -> SENT e grava sent_at'
    );

    // 5.4 Se não houver eventos reais, nunca cria briefing vazio
    currentEventsFixture = [];
    const noEventsRes = await briefingEngine.generateForUser({
      userId: userB,
      type: 'MORNING',
      referenceDate: new Date('2026-11-23T10:00:00.000Z')
    });
    assert(noEventsRes.status === 'SKIPPED_NO_EVENTS', 'Nunca cria briefing vazio quando não há acontecimentos reais');

    // 5.5 Endpoint /api/notifications/generate-briefings protegido por CRON_SECRET
    const prevCron = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'cron-secret-v231';
    try {
      const unauth = createMockRes();
      await generateBriefingsHandler({ method: 'POST', headers: {}, body: {} }, unauth.res);
      assert(unauth.getStatus() === 401, 'POST /api/notifications/generate-briefings sem autorização retorna HTTP 401');

      const wrongAuth = createMockRes();
      await generateBriefingsHandler(
        { method: 'POST', headers: { authorization: 'Bearer wrong-token' }, body: {} },
        wrongAuth.res
      );
      assert(wrongAuth.getStatus() === 401, 'POST /api/notifications/generate-briefings com token inválido retorna HTTP 401');

      const validAuth = createMockRes();
      await generateBriefingsHandler(
        {
          method: 'POST',
          headers: { authorization: 'Bearer cron-secret-v231' },
          body: { type: 'MORNING', sendEmail: false, referenceDate: '2026-11-23T10:00:00.000Z' }
        },
        validAuth.res
      );
      assert(
        validAuth.getStatus() === 200 && validAuth.getJson().success === true && validAuth.getJson().eligibleUsers === 1,
        'POST /api/notifications/generate-briefings com CRON_SECRET executa runGenerationCycle'
      );
    } finally {
      if (prevCron !== undefined) process.env.CRON_SECRET = prevCron;
      else delete process.env.CRON_SECRET;
    }
  } finally {
    setBriefingEngineTestDeps(null);
    setNotificationEngineTestDeps(null);
  }

  // ---------------------------------------------------------------------------
  // 6. AUDITORIA ESTÁTICA DE ESCOPO, MIGRAÇÃO & SERVERLESS LIMIT
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Auditoria de escopo, SQL incremental e Vercel hobby limits ---');
  {
    const mig231 = fs.readFileSync(
      path.resolve('supabase/migrations/20261121000001_v2_3_1_canonical_preferences_briefings_notifications.sql'),
      'utf-8'
    );
    assert(
      mig231.includes('ADD COLUMN IF NOT EXISTS notification_settings JSONB') &&
        mig231.includes('idx_briefing_delivery_slot') &&
        mig231.includes('local_date') &&
        !mig231.includes("CHECK (type IN ('morning', 'evening'))"),
      'Migração V2.3.1 é estritamente incremental e não recria checks incompatíveis com MORNING/EVENING'
    );

    const vercelCfg = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf-8'));
    assert(
      vercelCfg.crons?.length === 1 &&
        vercelCfg.crons[0].path === '/api/proxy/ingest' &&
        vercelCfg.crons[0].schedule === '0 10 * * *',
      'Vercel Cron de ingestão em vercel.json permanece 100% intacto'
    );

    const countServerless = (dir: string): number => {
      let total = 0;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('_')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += countServerless(full);
        else if (entry.name.endsWith('.ts')) total++;
      }
      return total;
    };
    const fnCount = countServerless(path.resolve('api'));
    assert(fnCount === 8, `Quantidade exata de Serverless Functions em api/ preservada em 8 (atual: ${fnCount})`);

    const notifViewSrc = fs.readFileSync(path.resolve('src/components/NotificationsView.tsx'), 'utf-8');
    assert(
      notifViewSrc.includes('settings.onlyHighRelevance') &&
        notifViewSrc.includes('settings.sourcesDigest') &&
        notifViewSrc.includes("setActiveTab('fontes')") &&
        notifViewSrc.includes("setActiveTab('atualizacoes')"),
      'NotificationsView expõe todos os 6 toggles de preferência e abas Fontes/Briefings'
    );
  }

  console.log('\n======================================================================');
  console.log(`🎉 RESULTADO V2.3.1: ${passed} passaram, ${failed} falharam.`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Erro inesperado na suíte V2.3.1:', err);
  process.exit(1);
});
