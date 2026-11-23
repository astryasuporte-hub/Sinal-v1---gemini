-- ==============================================================================
-- FATOSBR V2.4.1 — MIGRAÇÃO INCREMENTAL: LOCK DISTRIBUÍDO PERSISTENTE & JOB RUNS
-- ==============================================================================
-- Compatível com Supabase Transaction Pooler (PgBouncer porta 6543),
-- Supabase REST/RPC (service_role) e PostgreSQL direto.
-- Padrão estrito de segurança:
-- - Schema isolado internal com RLS habilitada (somente service_role/postgres)
-- - Funções public.* com SECURITY INVOKER + SET search_path = pg_catalog, pg_temp
-- - REVOKE ALL de PUBLIC/anon/authenticated; GRANT EXECUTE restrito a service_role
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS internal;

-- 1. Tabela durável de leases distribuídos (substitui pg_try_advisory_lock de sessão)
CREATE TABLE IF NOT EXISTS internal.distributed_job_locks (
  lock_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_distributed_job_locks_expires_at
  ON internal.distributed_job_locks (expires_at);

ALTER TABLE internal.distributed_job_locks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP POLICY IF EXISTS "distributed_job_locks_service_role" ON internal.distributed_job_locks;
    CREATE POLICY "distributed_job_locks_service_role" ON internal.distributed_job_locks
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 2. Histórico persistente de execuções do motor de briefings (substitui array em memória)
CREATE TABLE IF NOT EXISTS internal.briefing_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('BATCH_CYCLE', 'SINGLE_USER')),
  edition_type TEXT NOT NULL CHECK (edition_type IN ('MORNING', 'EVENING')),
  local_date DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  eligible_users INTEGER NOT NULL DEFAULT 0,
  ready_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  skipped_duplicates INTEGER NOT NULL DEFAULT 0,
  skipped_no_events INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  send_email BOOLEAN NOT NULL DEFAULT FALSE,
  respect_schedule BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefing_job_runs_started_at
  ON internal.briefing_job_runs (started_at DESC);

ALTER TABLE internal.briefing_job_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP POLICY IF EXISTS "briefing_job_runs_service_role" ON internal.briefing_job_runs;
    CREATE POLICY "briefing_job_runs_service_role" ON internal.briefing_job_runs
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 3. RPC Atômica: Adquirir Lease Distribuído (com recuperação automática de lease expirado)
CREATE OR REPLACE FUNCTION public.acquire_distributed_job_lock(
  p_lock_key TEXT,
  p_owner_id TEXT,
  p_ttl_ms BIGINT DEFAULT 300000,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_expires_at TIMESTAMPTZ;
  v_holder TEXT;
  v_holder_expires TIMESTAMPTZ;
BEGIN
  IF p_lock_key IS NULL OR length(btrim(p_lock_key)) < 1 OR length(btrim(p_lock_key)) > 256 THEN
    RAISE EXCEPTION 'LOCK_INVALID_PARAM: p_lock_key deve ter entre 1 e 256 caracteres.'
      USING ERRCODE = '22023';
  END IF;
  IF p_owner_id IS NULL OR length(btrim(p_owner_id)) < 1 OR length(btrim(p_owner_id)) > 256 THEN
    RAISE EXCEPTION 'LOCK_INVALID_PARAM: p_owner_id deve ter entre 1 e 256 caracteres.'
      USING ERRCODE = '22023';
  END IF;
  IF p_ttl_ms IS NULL OR p_ttl_ms < 1000 OR p_ttl_ms > 86400000 THEN
    RAISE EXCEPTION 'LOCK_INVALID_PARAM: p_ttl_ms deve estar entre 1000 e 86400000.'
      USING ERRCODE = '22023';
  END IF;

  v_expires_at := v_now + (p_ttl_ms || ' milliseconds')::interval;

  INSERT INTO internal.distributed_job_locks (
    lock_key, owner_id, acquired_at, expires_at, heartbeat_at, metadata
  )
  VALUES (
    p_lock_key, p_owner_id, v_now, v_expires_at, v_now, COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (lock_key) DO UPDATE
  SET
    owner_id = EXCLUDED.owner_id,
    acquired_at = v_now,
    expires_at = v_expires_at,
    heartbeat_at = v_now,
    metadata = EXCLUDED.metadata
  WHERE internal.distributed_job_locks.expires_at <= v_now
     OR internal.distributed_job_locks.owner_id = EXCLUDED.owner_id
  RETURNING owner_id, expires_at INTO v_holder, v_holder_expires;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'acquired', true,
      'lock_key', p_lock_key,
      'owner_id', v_holder,
      'expires_at', v_holder_expires
    );
  END IF;

  SELECT owner_id, expires_at
    INTO v_holder, v_holder_expires
    FROM internal.distributed_job_locks
   WHERE lock_key = p_lock_key;

  RETURN jsonb_build_object(
    'acquired', false,
    'lock_key', p_lock_key,
    'owner_id', v_holder,
    'expires_at', v_holder_expires
  );
END;
$$;

-- 4. RPC Atômica: Renovar Lease Distribuído (somente pelo dono ativo)
CREATE OR REPLACE FUNCTION public.renew_distributed_job_lock(
  p_lock_key TEXT,
  p_owner_id TEXT,
  p_ttl_ms BIGINT DEFAULT 300000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_expires_at TIMESTAMPTZ;
  v_new_expires TIMESTAMPTZ;
BEGIN
  IF p_lock_key IS NULL OR p_owner_id IS NULL OR p_ttl_ms IS NULL OR p_ttl_ms < 1000 THEN
    RAISE EXCEPTION 'LOCK_INVALID_PARAM' USING ERRCODE = '22023';
  END IF;

  v_expires_at := v_now + (p_ttl_ms || ' milliseconds')::interval;

  UPDATE internal.distributed_job_locks
     SET expires_at = v_expires_at,
         heartbeat_at = v_now
   WHERE lock_key = p_lock_key
     AND owner_id = p_owner_id
     AND expires_at > v_now
  RETURNING expires_at INTO v_new_expires;

  RETURN jsonb_build_object(
    'renewed', FOUND,
    'lock_key', p_lock_key,
    'expires_at', v_new_expires
  );
END;
$$;

-- 5. RPC Atômica: Liberar Lease Distribuído (somente se ainda pertencer ao dono)
CREATE OR REPLACE FUNCTION public.release_distributed_job_lock(
  p_lock_key TEXT,
  p_owner_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_lock_key IS NULL OR p_owner_id IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM internal.distributed_job_locks
   WHERE lock_key = p_lock_key
     AND owner_id = p_owner_id;

  RETURN FOUND;
END;
$$;

-- 6. RPC: Registrar execução do motor no banco
CREATE OR REPLACE FUNCTION public.record_briefing_job_run(
  p_run_id TEXT,
  p_mode TEXT,
  p_edition_type TEXT,
  p_local_date DATE,
  p_started_at TIMESTAMPTZ,
  p_finished_at TIMESTAMPTZ,
  p_duration_ms INTEGER,
  p_eligible_users INTEGER,
  p_ready_count INTEGER,
  p_sent_count INTEGER,
  p_skipped_duplicates INTEGER,
  p_skipped_no_events INTEGER,
  p_failed_count INTEGER,
  p_locked BOOLEAN,
  p_send_email BOOLEAN,
  p_respect_schedule BOOLEAN,
  p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO internal.briefing_job_runs (
    run_id, mode, edition_type, local_date, started_at, finished_at, duration_ms,
    eligible_users, ready_count, sent_count, skipped_duplicates, skipped_no_events,
    failed_count, locked, send_email, respect_schedule, error_message
  )
  VALUES (
    p_run_id, p_mode, p_edition_type, p_local_date, p_started_at, p_finished_at, COALESCE(p_duration_ms, 0),
    COALESCE(p_eligible_users, 0), COALESCE(p_ready_count, 0), COALESCE(p_sent_count, 0),
    COALESCE(p_skipped_duplicates, 0), COALESCE(p_skipped_no_events, 0), COALESCE(p_failed_count, 0),
    COALESCE(p_locked, FALSE), COALESCE(p_send_email, FALSE), COALESCE(p_respect_schedule, FALSE),
    p_error_message
  )
  ON CONFLICT (run_id) DO NOTHING;

  RETURN jsonb_build_object('recorded', true, 'run_id', p_run_id);
END;
$$;

-- 7. RPC: Métricas exatas e sanitizadas para o Admin Center (sem PII e sem truncamento)
CREATE OR REPLACE FUNCTION public.get_briefing_ops_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_briefings_stats JSONB := '{}'::jsonb;
  v_notifications_stats JSONB := '{}'::jsonb;
  v_schedules_stats JSONB := '{}'::jsonb;
  v_resend_stats JSONB := '{}'::jsonb;
  v_outbox_stats JSONB := '{}'::jsonb;
  v_active_locks JSONB := '[]'::jsonb;
  v_recent_runs JSONB := '[]'::jsonb;
BEGIN
  IF pg_catalog.to_regclass('public.briefings') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'total', COUNT(*)::int,
      'pending', COUNT(*) FILTER (WHERE UPPER(status) = 'PENDING')::int,
      'generating', COUNT(*) FILTER (WHERE UPPER(status) = 'GENERATING')::int,
      'ready', COUNT(*) FILTER (WHERE UPPER(status) = 'READY')::int,
      'sent', COUNT(*) FILTER (WHERE UPPER(status) = 'SENT')::int,
      'failed', COUNT(*) FILTER (WHERE UPPER(status) = 'FAILED')::int,
      'canceled', COUNT(*) FILTER (WHERE UPPER(status) = 'CANCELED')::int,
      'morning', COUNT(*) FILTER (WHERE UPPER(type) = 'MORNING')::int,
      'evening', COUNT(*) FILTER (WHERE UPPER(type) = 'EVENING')::int,
      'last24hTotal', COUNT(*) FILTER (WHERE COALESCE(created_at, scheduled_for) >= v_now - INTERVAL '24 hours')::int,
      'last24hFailed', COUNT(*) FILTER (WHERE UPPER(status) = 'FAILED' AND COALESCE(created_at, scheduled_for) >= v_now - INTERVAL '24 hours')::int
    )
    INTO v_briefings_stats
    FROM public.briefings;
  END IF;

  IF pg_catalog.to_regclass('public.notifications') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'totalProcessed', COUNT(*)::int,
      'unreadTotal', COUNT(*) FILTER (WHERE read = FALSE)::int,
      'briefingReadyCount', COUNT(*) FILTER (WHERE type = 'BRIEFING_READY')::int,
      'highRelevanceCount', COUNT(*) FILTER (WHERE type = 'NEWS_HIGH_RELEVANCE')::int
    )
    INTO v_notifications_stats
    FROM public.notifications;
  END IF;

  IF pg_catalog.to_regclass('public.user_preferences') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'eligibleMorningUsers', COUNT(*) FILTER (WHERE email_morning_briefing IS DISTINCT FROM FALSE)::int,
      'eligibleEveningUsers', COUNT(*) FILTER (WHERE email_evening_briefing IS DISTINCT FROM FALSE)::int,
      'weekendSubscribers', COUNT(*) FILTER (WHERE weekend_edition IS TRUE)::int,
      'recipientsWithEmailCount', COUNT(*) FILTER (WHERE briefing_email IS NOT NULL AND position('@' in briefing_email) > 1)::int
    )
    INTO v_schedules_stats
    FROM public.user_preferences;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'lockKey', lock_key,
    'expiresAt', expires_at,
    'heartbeatAt', heartbeat_at
  ) ORDER BY acquired_at DESC), '[]'::jsonb)
  INTO v_active_locks
  FROM internal.distributed_job_locks
  WHERE expires_at > v_now;

  SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
  INTO v_recent_runs
  FROM (
    SELECT
      run_id AS "runId",
      mode,
      edition_type AS "type",
      local_date::text AS "localDate",
      started_at AS "startedAt",
      finished_at AS "finishedAt",
      duration_ms AS "durationMs",
      eligible_users AS "eligibleUsers",
      ready_count AS "ready",
      sent_count AS "sent",
      skipped_duplicates AS "skippedDuplicates",
      skipped_no_events AS "skippedNoEvents",
      failed_count AS "failed",
      locked,
      send_email AS "sendEmail",
      respect_schedule AS "respectScheduleWindow",
      error_message AS "error"
    FROM internal.briefing_job_runs
    ORDER BY started_at DESC
    LIMIT 30
  ) r;

  IF pg_catalog.to_regclass('internal.briefing_email_deliveries') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'totalDeliveries', COUNT(*)::int,
      'accepted', COUNT(*) FILTER (WHERE status = 'ACCEPTED')::int,
      'delivered', COUNT(*) FILTER (WHERE status = 'DELIVERED')::int,
      'failed', COUNT(*) FILTER (WHERE status = 'FAILED')::int,
      'bounced', COUNT(*) FILTER (WHERE status IN ('BOUNCED', 'COMPLAINED'))::int,
      'retrying', COUNT(*) FILTER (WHERE status = 'FAILED' AND next_retry_at IS NOT NULL AND attempt_count < max_attempts)::int
    )
    INTO v_resend_stats
    FROM internal.briefing_email_deliveries;
  END IF;

  IF pg_catalog.to_regclass('internal.notification_outbox') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'pending', COUNT(*) FILTER (WHERE status = 'PENDING')::int,
      'processing', COUNT(*) FILTER (WHERE status = 'PROCESSING')::int,
      'failed', COUNT(*) FILTER (WHERE status = 'FAILED')::int,
      'deadLetter', COUNT(*) FILTER (WHERE status = 'DEAD_LETTER')::int,
      'completed', COUNT(*) FILTER (WHERE status = 'COMPLETED')::int
    )
    INTO v_outbox_stats
    FROM internal.notification_outbox;
  END IF;

  RETURN jsonb_build_object(
    'briefingsSummary', v_briefings_stats,
    'notificationsSummary', v_notifications_stats,
    'schedulesSummary', v_schedules_stats,
    'resendSummary', v_resend_stats,
    'outboxSummary', v_outbox_stats,
    'activeLocks', v_active_locks,
    'recentRunLogs', v_recent_runs
  );
END;
$$;

-- 8. DCL Estrito (Menor Privilégio)
REVOKE ALL ON FUNCTION public.acquire_distributed_job_lock(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_distributed_job_lock(TEXT, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_distributed_job_lock(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_briefing_job_run(TEXT, TEXT, TEXT, DATE, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_briefing_ops_metrics() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.acquire_distributed_job_lock(TEXT, TEXT, BIGINT, JSONB) FROM anon;
    REVOKE ALL ON FUNCTION public.renew_distributed_job_lock(TEXT, TEXT, BIGINT) FROM anon;
    REVOKE ALL ON FUNCTION public.release_distributed_job_lock(TEXT, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION public.record_briefing_job_run(TEXT, TEXT, TEXT, DATE, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION public.get_briefing_ops_metrics() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.acquire_distributed_job_lock(TEXT, TEXT, BIGINT, JSONB) FROM authenticated;
    REVOKE ALL ON FUNCTION public.renew_distributed_job_lock(TEXT, TEXT, BIGINT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.release_distributed_job_lock(TEXT, TEXT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.record_briefing_job_run(TEXT, TEXT, TEXT, DATE, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.get_briefing_ops_metrics() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA internal TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.distributed_job_locks TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.briefing_job_runs TO service_role;
    GRANT EXECUTE ON FUNCTION public.acquire_distributed_job_lock(TEXT, TEXT, BIGINT, JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.renew_distributed_job_lock(TEXT, TEXT, BIGINT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.release_distributed_job_lock(TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.record_briefing_job_run(TEXT, TEXT, TEXT, DATE, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_briefing_ops_metrics() TO service_role;
  END IF;
END $$;
