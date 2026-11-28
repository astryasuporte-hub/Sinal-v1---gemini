-- ==============================================================================
-- FATOSBR V2.5.1 — NOTIFICATION OUTBOX WORKER HARDENING & OBSERVABILITY
-- ==============================================================================
-- Sprint 01 (V2.5.1):
-- 1. Evolui `internal.notification_outbox` de forma 100% aditiva e idempotente:
--    - Colunas de auditoria: `discarded_at`, `discard_reason`,
--      `stale_recovery_count`, `execution_meta`, `last_run_id`.
--    - Novo status `DISCARDED` para descarte seguro de alertas obsoletos
--      sem apagar registros nem perder evidências de processamento.
-- 2. Corrige loop infinito em `claim_notification_outbox_batch`:
--    - Recuperação de locks expirados (`PROCESSING` com `locked_until <= v_now`)
--      agora incrementa `attempts` e `stale_recovery_count` e move itens que
--      esgotam `max_attempts` diretamente para `DEAD_LETTER`.
-- 3. Adiciona descarte seguro (`discard_notification_outbox_item` e
--    `discard_obsolete_notification_outbox` com `p_dry_run`), replay
--    administrativo controlado (`requeue_notification_outbox_items` com
--    `p_dry_run`) e histórico persistente de execuções (`internal.outbox_job_runs`
--    + `record_outbox_job_run` + `get_outbox_ops_metrics`).
-- 4. Atualiza `get_briefing_ops_metrics()` mantendo total retrocompatibilidade
--    e acrescentando `discarded` em `outboxSummary`.
-- 5. Segurança estrita: `SECURITY INVOKER`, `SET search_path = pg_catalog, pg_temp`,
--    RLS habilitada e acesso restrito exclusivamente a `service_role`.
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS internal;

-- 1. Evolução aditiva e não destrutiva de internal.notification_outbox
DO $$
DECLARE
  v_con RECORD;
BEGIN
  IF to_regclass('internal.notification_outbox') IS NOT NULL THEN
    ALTER TABLE internal.notification_outbox
      ADD COLUMN IF NOT EXISTS discarded_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS discard_reason TEXT,
      ADD COLUMN IF NOT EXISTS stale_recovery_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS execution_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS last_run_id TEXT;

    -- Remove apenas CHECK constraints antigas sobre a coluna status e aplica constraint canônica com DISCARDED
    FOR v_con IN
      SELECT conname
        FROM pg_constraint
       WHERE conrelid = 'internal.notification_outbox'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) ~* '\mstatus\M'
    LOOP
      EXECUTE format('ALTER TABLE internal.notification_outbox DROP CONSTRAINT IF EXISTS %I', v_con.conname);
    END LOOP;

    ALTER TABLE internal.notification_outbox
      ADD CONSTRAINT notification_outbox_status_check
      CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'DISCARDED'));

    CREATE INDEX IF NOT EXISTS idx_notification_outbox_created_at
      ON internal.notification_outbox (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_updated
      ON internal.notification_outbox (status, updated_at DESC);
  END IF;
END $$;

-- 2. Histórico persistente de execuções do Outbox Worker (sem PII)
CREATE TABLE IF NOT EXISTS internal.outbox_job_runs (
  run_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'process',
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  limit_per_batch INTEGER NOT NULL DEFAULT 15,
  max_batches INTEGER NOT NULL DEFAULT 1,
  batches_executed INTEGER NOT NULL DEFAULT 0,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  retried_count INTEGER NOT NULL DEFAULT 0,
  dead_lettered_count INTEGER NOT NULL DEFAULT 0,
  discarded_count INTEGER NOT NULL DEFAULT 0,
  notifications_created INTEGER NOT NULL DEFAULT 0,
  duplicates_skipped INTEGER NOT NULL DEFAULT 0,
  preferences_skipped INTEGER NOT NULL DEFAULT 0,
  access_blocked_skipped INTEGER NOT NULL DEFAULT 0,
  flood_capped_skipped INTEGER NOT NULL DEFAULT 0,
  partial_failures_count INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_job_runs_started_at
  ON internal.outbox_job_runs (started_at DESC);

ALTER TABLE internal.outbox_job_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP POLICY IF EXISTS "outbox_job_runs_service_role" ON internal.outbox_job_runs;
    CREATE POLICY "outbox_job_runs_service_role" ON internal.outbox_job_runs
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 3. Claim atômico com recuperação segura de PROCESSING expirado (sem loop infinito)
CREATE OR REPLACE FUNCTION public.claim_notification_outbox_batch(
  p_limit INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_items JSONB := '[]'::jsonb;
BEGIN
  -- 3.1 Move imediatamente para DEAD_LETTER locks PROCESSING expirados que já esgotam max_attempts ao recuperar
  WITH expired_exhausted AS (
    SELECT id
      FROM internal.notification_outbox
     WHERE status = 'PROCESSING'
       AND locked_until IS NOT NULL
       AND locked_until <= v_now
       AND (attempts + 1) >= max_attempts
     FOR UPDATE SKIP LOCKED
  )
  UPDATE internal.notification_outbox o
     SET status = 'DEAD_LETTER',
         attempts = o.attempts + 1,
         stale_recovery_count = COALESCE(o.stale_recovery_count, 0) + 1,
         locked_until = NULL,
         last_error = left(
           COALESCE(NULLIF(btrim(o.last_error), ''), 'STALE_PROCESSING_LOCK_EXPIRED_MAX_ATTEMPTS'),
           500
         ),
         execution_meta = COALESCE(o.execution_meta, '{}'::jsonb) || jsonb_build_object(
           'staleRecoveredAt', v_now,
           'movedToDeadLetterOnStaleRecovery', true
         ),
         updated_at = v_now
    FROM expired_exhausted
   WHERE o.id = expired_exhausted.id;

  -- 3.2 Reivindica itens elegíveis (PENDING/FAILED vencidos ou PROCESSING expirado com saldo de tentativas)
  WITH due AS (
    SELECT id
      FROM internal.notification_outbox
     WHERE (
       (status IN ('PENDING', 'FAILED') AND next_retry_at <= v_now)
       OR (
         status = 'PROCESSING'
         AND locked_until IS NOT NULL
         AND locked_until <= v_now
         AND (attempts + 1) < max_attempts
       )
     )
       AND attempts < max_attempts
     ORDER BY next_retry_at ASC, created_at ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE internal.notification_outbox o
       SET status = 'PROCESSING',
           locked_until = v_now + INTERVAL '5 minutes',
           attempts = CASE
             WHEN o.status = 'PROCESSING' THEN o.attempts + 1
             ELSE o.attempts
           END,
           stale_recovery_count = CASE
             WHEN o.status = 'PROCESSING' THEN COALESCE(o.stale_recovery_count, 0) + 1
             ELSE COALESCE(o.stale_recovery_count, 0)
           END,
           last_error = CASE
             WHEN o.status = 'PROCESSING' AND (o.last_error IS NULL OR btrim(o.last_error) = '')
               THEN 'STALE_PROCESSING_LOCK_RECOVERED'
             ELSE o.last_error
           END,
           updated_at = v_now
      FROM due
     WHERE o.id = due.id
    RETURNING o.*
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(claimed) ORDER BY claimed.next_retry_at ASC, claimed.created_at ASC),
    '[]'::jsonb
  )
    INTO v_items
    FROM claimed;

  RETURN v_items;
END;
$$;

-- 4. Conclusão e falha com metadados parciais e opção force_dead_letter (substitui assinaturas anteriores sem ambiguidade)
DROP FUNCTION IF EXISTS public.complete_notification_outbox_item(UUID, INTEGER);
CREATE OR REPLACE FUNCTION public.complete_notification_outbox_item(
  p_id UUID,
  p_dispatched_count INTEGER DEFAULT 0,
  p_execution_meta JSONB DEFAULT '{}'::jsonb,
  p_run_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  UPDATE internal.notification_outbox
     SET status = 'COMPLETED',
         dispatched_count = COALESCE(p_dispatched_count, 0),
         processed_at = v_now,
         locked_until = NULL,
         last_error = NULL,
         last_run_id = COALESCE(NULLIF(btrim(COALESCE(p_run_id, '')), ''), last_run_id),
         execution_meta = COALESCE(execution_meta, '{}'::jsonb) || COALESCE(p_execution_meta, '{}'::jsonb),
         updated_at = v_now
   WHERE id = p_id;
  RETURN FOUND;
END;
$$;

DROP FUNCTION IF EXISTS public.fail_notification_outbox_item(UUID, TEXT, INTEGER);
CREATE OR REPLACE FUNCTION public.fail_notification_outbox_item(
  p_id UUID,
  p_error TEXT,
  p_retry_delay_seconds INTEGER DEFAULT 60,
  p_execution_meta JSONB DEFAULT '{}'::jsonb,
  p_force_dead_letter BOOLEAN DEFAULT FALSE,
  p_run_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_row internal.notification_outbox%ROWTYPE;
BEGIN
  UPDATE internal.notification_outbox
     SET attempts = attempts + 1,
         status = CASE
           WHEN COALESCE(p_force_dead_letter, FALSE) OR attempts + 1 >= max_attempts THEN 'DEAD_LETTER'
           ELSE 'FAILED'
         END,
         next_retry_at = CASE
           WHEN COALESCE(p_force_dead_letter, FALSE) OR attempts + 1 >= max_attempts THEN next_retry_at
           ELSE v_now + (GREATEST(5, COALESCE(p_retry_delay_seconds, 60)) || ' seconds')::interval
         END,
         locked_until = NULL,
         last_error = left(COALESCE(NULLIF(btrim(p_error), ''), 'OUTBOX_DISPATCH_FAILED'), 500),
         last_run_id = COALESCE(NULLIF(btrim(COALESCE(p_run_id, '')), ''), last_run_id),
         execution_meta = COALESCE(execution_meta, '{}'::jsonb) || COALESCE(p_execution_meta, '{}'::jsonb),
         updated_at = v_now
   WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false);
  END IF;

  RETURN jsonb_build_object(
    'updated', true,
    'status', v_row.status,
    'attempts', v_row.attempts,
    'next_retry_at', v_row.next_retry_at
  );
END;
$$;

-- 5. Descarte seguro de item individual (preserva registro e trilha de auditoria)
CREATE OR REPLACE FUNCTION public.discard_notification_outbox_item(
  p_id UUID,
  p_reason TEXT DEFAULT 'OBSOLETE_ALERT_EXPIRED',
  p_execution_meta JSONB DEFAULT '{}'::jsonb,
  p_run_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_row internal.notification_outbox%ROWTYPE;
BEGIN
  UPDATE internal.notification_outbox
     SET status = 'DISCARDED',
         discarded_at = v_now,
         discard_reason = left(COALESCE(NULLIF(btrim(p_reason), ''), 'OBSOLETE_ALERT_EXPIRED'), 250),
         processed_at = v_now,
         locked_until = NULL,
         last_run_id = COALESCE(NULLIF(btrim(COALESCE(p_run_id, '')), ''), last_run_id),
         execution_meta = COALESCE(execution_meta, '{}'::jsonb) || COALESCE(p_execution_meta, '{}'::jsonb),
         updated_at = v_now
   WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('discarded', false);
  END IF;

  RETURN jsonb_build_object(
    'discarded', true,
    'id', v_row.id,
    'status', v_row.status,
    'discarded_at', v_row.discarded_at,
    'discard_reason', v_row.discard_reason
  );
END;
$$;

-- 6. Arquivamento/descarte em lote de backlog obsoleto com dry-run seguro (nunca DELETE)
CREATE OR REPLACE FUNCTION public.discard_obsolete_notification_outbox(
  p_max_age_hours INTEGER DEFAULT 72,
  p_dry_run BOOLEAN DEFAULT TRUE,
  p_reason TEXT DEFAULT 'OBSOLETE_BACKLOG_EXPIRED',
  p_ids UUID[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_age_hours INTEGER := GREATEST(1, LEAST(COALESCE(p_max_age_hours, 72), 8760));
  v_cutoff TIMESTAMPTZ := v_now - (v_age_hours || ' hours')::interval;
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000));
  v_reason TEXT := left(COALESCE(NULLIF(btrim(p_reason), ''), 'OBSOLETE_BACKLOG_EXPIRED'), 250);
  v_matched_count INTEGER := 0;
  v_sample_ids JSONB := '[]'::jsonb;
  v_oldest TIMESTAMPTZ;
  v_newest TIMESTAMPTZ;
  v_discarded_count INTEGER := 0;
BEGIN
  IF COALESCE(p_dry_run, TRUE) THEN
    WITH candidates AS (
      SELECT id, created_at
        FROM internal.notification_outbox
       WHERE status IN ('PENDING', 'FAILED')
         AND (
           (p_ids IS NOT NULL AND id = ANY(p_ids))
           OR (p_ids IS NULL AND created_at <= v_cutoff)
         )
       ORDER BY created_at ASC
       LIMIT v_limit
    )
    SELECT
      COUNT(*)::int,
      COALESCE(jsonb_agg(id), '[]'::jsonb),
      MIN(created_at),
      MAX(created_at)
      INTO v_matched_count, v_sample_ids, v_oldest, v_newest
      FROM candidates;

    RETURN jsonb_build_object(
      'dry_run', true,
      'max_age_hours', v_age_hours,
      'cutoff_at', v_cutoff,
      'matched_count', v_matched_count,
      'discarded_count', 0,
      'oldest_created_at', v_oldest,
      'newest_created_at', v_newest,
      'sample_ids', v_sample_ids
    );
  END IF;

  WITH candidates AS (
    SELECT id
      FROM internal.notification_outbox
     WHERE status IN ('PENDING', 'FAILED')
       AND (
         (p_ids IS NOT NULL AND id = ANY(p_ids))
         OR (p_ids IS NULL AND created_at <= v_cutoff)
       )
     ORDER BY created_at ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE internal.notification_outbox o
       SET status = 'DISCARDED',
           discarded_at = v_now,
           discard_reason = v_reason,
           processed_at = v_now,
           locked_until = NULL,
           execution_meta = COALESCE(o.execution_meta, '{}'::jsonb) || jsonb_build_object(
             'archivedVia', 'discard_obsolete_notification_outbox',
             'maxAgeHours', v_age_hours,
             'cutoffAt', v_cutoff
           ),
           updated_at = v_now
      FROM candidates
     WHERE o.id = candidates.id
    RETURNING o.id, o.created_at
  )
  SELECT
    COUNT(*)::int,
    COALESCE(jsonb_agg(id), '[]'::jsonb),
    MIN(created_at),
    MAX(created_at)
    INTO v_discarded_count, v_sample_ids, v_oldest, v_newest
    FROM updated;

  RETURN jsonb_build_object(
    'dry_run', false,
    'max_age_hours', v_age_hours,
    'cutoff_at', v_cutoff,
    'matched_count', v_discarded_count,
    'discarded_count', v_discarded_count,
    'oldest_created_at', v_oldest,
    'newest_created_at', v_newest,
    'sample_ids', v_sample_ids
  );
END;
$$;

-- 7. Replay administrativo controlado de FAILED / DEAD_LETTER (com dry-run)
CREATE OR REPLACE FUNCTION public.requeue_notification_outbox_items(
  p_ids UUID[] DEFAULT NULL,
  p_include_dead_letter BOOLEAN DEFAULT FALSE,
  p_include_failed BOOLEAN DEFAULT TRUE,
  p_limit INTEGER DEFAULT 25,
  p_reset_attempts BOOLEAN DEFAULT FALSE,
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_statuses TEXT[] := ARRAY[]::TEXT[];
  v_matched_count INTEGER := 0;
  v_requeued_count INTEGER := 0;
  v_sample_ids JSONB := '[]'::jsonb;
BEGIN
  IF COALESCE(p_include_failed, TRUE) THEN
    v_statuses := array_append(v_statuses, 'FAILED');
  END IF;
  IF COALESCE(p_include_dead_letter, FALSE) THEN
    v_statuses := array_append(v_statuses, 'DEAD_LETTER');
  END IF;

  IF array_length(v_statuses, 1) IS NULL AND p_ids IS NULL THEN
    RETURN jsonb_build_object(
      'dry_run', COALESCE(p_dry_run, TRUE),
      'matched_count', 0,
      'requeued_count', 0,
      'sample_ids', '[]'::jsonb
    );
  END IF;

  IF COALESCE(p_dry_run, TRUE) THEN
    WITH candidates AS (
      SELECT id
        FROM internal.notification_outbox
       WHERE (
         (p_ids IS NOT NULL AND id = ANY(p_ids) AND status IN ('FAILED', 'DEAD_LETTER', 'DISCARDED'))
         OR (p_ids IS NULL AND status = ANY(v_statuses))
       )
       ORDER BY updated_at ASC
       LIMIT v_limit
    )
    SELECT COUNT(*)::int, COALESCE(jsonb_agg(id), '[]'::jsonb)
      INTO v_matched_count, v_sample_ids
      FROM candidates;

    RETURN jsonb_build_object(
      'dry_run', true,
      'matched_count', v_matched_count,
      'requeued_count', 0,
      'sample_ids', v_sample_ids
    );
  END IF;

  WITH candidates AS (
    SELECT id
      FROM internal.notification_outbox
     WHERE (
       (p_ids IS NOT NULL AND id = ANY(p_ids) AND status IN ('FAILED', 'DEAD_LETTER', 'DISCARDED'))
       OR (p_ids IS NULL AND status = ANY(v_statuses))
     )
     ORDER BY updated_at ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE internal.notification_outbox o
       SET status = 'PENDING',
           next_retry_at = v_now,
           locked_until = NULL,
           attempts = CASE
             WHEN COALESCE(p_reset_attempts, FALSE) THEN 0
             WHEN o.attempts >= o.max_attempts THEN GREATEST(0, o.max_attempts - 1)
             ELSE o.attempts
           END,
           discarded_at = NULL,
           discard_reason = NULL,
           execution_meta = COALESCE(o.execution_meta, '{}'::jsonb) || jsonb_build_object(
             'requeuedAt', v_now,
             'resetAttempts', COALESCE(p_reset_attempts, FALSE)
           ),
           updated_at = v_now
      FROM candidates
     WHERE o.id = candidates.id
    RETURNING o.id
  )
  SELECT COUNT(*)::int, COALESCE(jsonb_agg(id), '[]'::jsonb)
    INTO v_requeued_count, v_sample_ids
    FROM updated;

  RETURN jsonb_build_object(
    'dry_run', false,
    'matched_count', v_requeued_count,
    'requeued_count', v_requeued_count,
    'sample_ids', v_sample_ids
  );
END;
$$;

-- 8. Registro persistente de execuções do Outbox Worker (idempotente por run_id)
CREATE OR REPLACE FUNCTION public.record_outbox_job_run(
  p_run_id TEXT,
  p_mode TEXT,
  p_dry_run BOOLEAN,
  p_started_at TIMESTAMPTZ,
  p_finished_at TIMESTAMPTZ,
  p_duration_ms INTEGER,
  p_limit_per_batch INTEGER,
  p_max_batches INTEGER,
  p_batches_executed INTEGER,
  p_claimed_count INTEGER,
  p_completed_count INTEGER,
  p_retried_count INTEGER,
  p_dead_lettered_count INTEGER,
  p_discarded_count INTEGER,
  p_notifications_created INTEGER,
  p_duplicates_skipped INTEGER,
  p_preferences_skipped INTEGER,
  p_access_blocked_skipped INTEGER,
  p_flood_capped_skipped INTEGER,
  p_partial_failures_count INTEGER,
  p_errors_count INTEGER,
  p_error_summary TEXT DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO internal.outbox_job_runs (
    run_id, mode, dry_run, started_at, finished_at, duration_ms,
    limit_per_batch, max_batches, batches_executed,
    claimed_count, completed_count, retried_count, dead_lettered_count, discarded_count,
    notifications_created, duplicates_skipped, preferences_skipped,
    access_blocked_skipped, flood_capped_skipped, partial_failures_count,
    errors_count, error_summary, meta
  )
  VALUES (
    p_run_id, COALESCE(NULLIF(btrim(p_mode), ''), 'process'), COALESCE(p_dry_run, FALSE),
    p_started_at, p_finished_at, COALESCE(p_duration_ms, 0),
    COALESCE(p_limit_per_batch, 15), COALESCE(p_max_batches, 1), COALESCE(p_batches_executed, 0),
    COALESCE(p_claimed_count, 0), COALESCE(p_completed_count, 0), COALESCE(p_retried_count, 0),
    COALESCE(p_dead_lettered_count, 0), COALESCE(p_discarded_count, 0),
    COALESCE(p_notifications_created, 0), COALESCE(p_duplicates_skipped, 0), COALESCE(p_preferences_skipped, 0),
    COALESCE(p_access_blocked_skipped, 0), COALESCE(p_flood_capped_skipped, 0), COALESCE(p_partial_failures_count, 0),
    COALESCE(p_errors_count, 0), left(p_error_summary, 1000), COALESCE(p_meta, '{}'::jsonb)
  )
  ON CONFLICT (run_id) DO NOTHING;

  RETURN jsonb_build_object('recorded', true, 'run_id', p_run_id);
END;
$$;

-- 9. Telemetria dedicada da Outbox (sem PII)
CREATE OR REPLACE FUNCTION public.get_outbox_ops_metrics(
  p_recent_runs_limit INTEGER DEFAULT 20,
  p_sample_limit INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_runs_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_recent_runs_limit, 20), 100));
  v_sample_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_sample_limit, 20), 100));
  v_summary JSONB := '{}'::jsonb;
  v_recent_runs JSONB := '[]'::jsonb;
  v_attention_items JSONB := '[]'::jsonb;
BEGIN
  IF pg_catalog.to_regclass('internal.notification_outbox') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'total', COUNT(*)::int,
      'pending', COUNT(*) FILTER (WHERE status = 'PENDING')::int,
      'processing', COUNT(*) FILTER (WHERE status = 'PROCESSING')::int,
      'failed', COUNT(*) FILTER (WHERE status = 'FAILED')::int,
      'deadLetter', COUNT(*) FILTER (WHERE status = 'DEAD_LETTER')::int,
      'completed', COUNT(*) FILTER (WHERE status = 'COMPLETED')::int,
      'discarded', COUNT(*) FILTER (WHERE status = 'DISCARDED')::int,
      'staleProcessing', COUNT(*) FILTER (WHERE status = 'PROCESSING' AND locked_until IS NOT NULL AND locked_until <= v_now)::int,
      'oldestPendingAgeHours', COALESCE(
        ROUND((EXTRACT(EPOCH FROM (v_now - MIN(created_at) FILTER (WHERE status IN ('PENDING', 'FAILED')))) / 3600.0)::numeric, 2),
        0
      )
    )
    INTO v_summary
    FROM internal.notification_outbox;

    SELECT COALESCE(jsonb_agg(s), '[]'::jsonb)
    INTO v_attention_items
    FROM (
      SELECT
        id,
        event_id AS "eventId",
        event_type AS "eventType",
        status,
        attempts,
        max_attempts AS "maxAttempts",
        stale_recovery_count AS "staleRecoveryCount",
        last_error AS "lastError",
        discard_reason AS "discardReason",
        next_retry_at AS "nextRetryAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM internal.notification_outbox
      WHERE status IN ('DEAD_LETTER', 'FAILED', 'PROCESSING', 'PENDING')
      ORDER BY
        CASE status
          WHEN 'DEAD_LETTER' THEN 1
          WHEN 'FAILED' THEN 2
          WHEN 'PROCESSING' THEN 3
          ELSE 4
        END,
        updated_at DESC
      LIMIT v_sample_limit
    ) s;
  END IF;

  IF pg_catalog.to_regclass('internal.outbox_job_runs') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
    INTO v_recent_runs
    FROM (
      SELECT
        run_id AS "runId",
        mode,
        dry_run AS "dryRun",
        started_at AS "startedAt",
        finished_at AS "finishedAt",
        duration_ms AS "durationMs",
        limit_per_batch AS "limit",
        max_batches AS "maxBatches",
        batches_executed AS "batchesExecuted",
        claimed_count AS "claimed",
        completed_count AS "completed",
        retried_count AS "retried",
        dead_lettered_count AS "deadLettered",
        discarded_count AS "discarded",
        notifications_created AS "notificationsCreated",
        duplicates_skipped AS "duplicatesSkipped",
        preferences_skipped AS "preferencesSkipped",
        access_blocked_skipped AS "accessBlockedSkipped",
        flood_capped_skipped AS "floodCappedSkipped",
        partial_failures_count AS "partialFailuresCount",
        errors_count AS "errorsCount",
        error_summary AS "errorSummary"
      FROM internal.outbox_job_runs
      ORDER BY started_at DESC
      LIMIT v_runs_limit
    ) r;
  END IF;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'recentRuns', v_recent_runs,
    'attentionItems', v_attention_items
  );
END;
$$;

-- 10. Atualiza get_briefing_ops_metrics de forma retrocompatível adicionando discarded em outboxSummary
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
      'completed', COUNT(*) FILTER (WHERE status = 'COMPLETED')::int,
      'discarded', COUNT(*) FILTER (WHERE status = 'DISCARDED')::int
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

-- 11. DCL Estrito (Menor Privilégio — exclusivo para service_role)
REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER, JSONB, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discard_notification_outbox_item(UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discard_obsolete_notification_outbox(INTEGER, BOOLEAN, TEXT, UUID[], INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.requeue_notification_outbox_items(UUID[], BOOLEAN, BOOLEAN, INTEGER, BOOLEAN, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_outbox_job_run(TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_outbox_ops_metrics(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_briefing_ops_metrics() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(INTEGER) FROM anon;
    REVOKE ALL ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER, JSONB, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER, JSONB, BOOLEAN, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION public.discard_notification_outbox_item(UUID, TEXT, JSONB, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION public.discard_obsolete_notification_outbox(INTEGER, BOOLEAN, TEXT, UUID[], INTEGER) FROM anon;
    REVOKE ALL ON FUNCTION public.requeue_notification_outbox_items(UUID[], BOOLEAN, BOOLEAN, INTEGER, BOOLEAN, BOOLEAN) FROM anon;
    REVOKE ALL ON FUNCTION public.record_outbox_job_run(TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB) FROM anon;
    REVOKE ALL ON FUNCTION public.get_outbox_ops_metrics(INTEGER, INTEGER) FROM anon;
    REVOKE ALL ON FUNCTION public.get_briefing_ops_metrics() FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(INTEGER) FROM authenticated;
    REVOKE ALL ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER, JSONB, TEXT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER, JSONB, BOOLEAN, TEXT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.discard_notification_outbox_item(UUID, TEXT, JSONB, TEXT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.discard_obsolete_notification_outbox(INTEGER, BOOLEAN, TEXT, UUID[], INTEGER) FROM authenticated;
    REVOKE ALL ON FUNCTION public.requeue_notification_outbox_items(UUID[], BOOLEAN, BOOLEAN, INTEGER, BOOLEAN, BOOLEAN) FROM authenticated;
    REVOKE ALL ON FUNCTION public.record_outbox_job_run(TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB) FROM authenticated;
    REVOKE ALL ON FUNCTION public.get_outbox_ops_metrics(INTEGER, INTEGER) FROM authenticated;
    REVOKE ALL ON FUNCTION public.get_briefing_ops_metrics() FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA internal TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.outbox_job_runs TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_notification_outbox_batch(INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER, JSONB, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER, JSONB, BOOLEAN, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.discard_notification_outbox_item(UUID, TEXT, JSONB, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.discard_obsolete_notification_outbox(INTEGER, BOOLEAN, TEXT, UUID[], INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.requeue_notification_outbox_items(UUID[], BOOLEAN, BOOLEAN, INTEGER, BOOLEAN, BOOLEAN) TO service_role;
    GRANT EXECUTE ON FUNCTION public.record_outbox_job_run(TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_outbox_ops_metrics(INTEGER, INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_briefing_ops_metrics() TO service_role;
  END IF;
END $$;
