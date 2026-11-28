-- ==============================================================================
-- ROLLBACK FATOSBR V2.5.1 — NOTIFICATION OUTBOX WORKER HARDENING
-- ==============================================================================
-- Reverte exclusivamente os objetos introduzidos pela migração V2.5.1
-- (`20261128000001_v2_5_1_outbox_hardening.sql`), preservando integralmente
-- todos os registros existentes em `internal.notification_outbox`.
-- ==============================================================================

DROP FUNCTION IF EXISTS public.get_outbox_ops_metrics(INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.record_outbox_job_run(TEXT, TEXT, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.requeue_notification_outbox_items(UUID[], BOOLEAN, BOOLEAN, INTEGER, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.discard_obsolete_notification_outbox(INTEGER, BOOLEAN, TEXT, UUID[], INTEGER);
DROP FUNCTION IF EXISTS public.discard_notification_outbox_item(UUID, TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.fail_notification_outbox_item(UUID, TEXT, INTEGER, JSONB, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.complete_notification_outbox_item(UUID, INTEGER, JSONB, TEXT);

DROP TABLE IF EXISTS internal.outbox_job_runs;

-- Preserva todos os itens da outbox; converte eventuais status 'DISCARDED' para 'FAILED' antes de restaurar a constraint V2.4.1
DO $$
DECLARE
  v_con RECORD;
BEGIN
  IF to_regclass('internal.notification_outbox') IS NOT NULL THEN
    UPDATE internal.notification_outbox
       SET status = 'FAILED',
           last_error = COALESCE(last_error, discard_reason, 'DISCARDED_ROLLED_BACK')
     WHERE status = 'DISCARDED';

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
      CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER'));

    DROP INDEX IF EXISTS internal.idx_notification_outbox_created_at;
    DROP INDEX IF EXISTS internal.idx_notification_outbox_status_updated;

    ALTER TABLE internal.notification_outbox
      DROP COLUMN IF EXISTS discarded_at,
      DROP COLUMN IF EXISTS discard_reason,
      DROP COLUMN IF EXISTS stale_recovery_count,
      DROP COLUMN IF EXISTS execution_meta,
      DROP COLUMN IF EXISTS last_run_id;
  END IF;
END $$;

-- Restaura assinaturas V2.4.1 exatas de claim / complete / fail / get_briefing_ops_metrics
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
  v_items JSONB := '[]'::jsonb;
BEGIN
  WITH due AS (
    SELECT id
      FROM internal.notification_outbox
     WHERE (
       (status IN ('PENDING', 'FAILED') AND next_retry_at <= v_now)
       OR (status = 'PROCESSING' AND locked_until IS NOT NULL AND locked_until <= v_now)
     )
       AND attempts < max_attempts
     ORDER BY next_retry_at ASC, created_at ASC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
     FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE internal.notification_outbox o
       SET status = 'PROCESSING',
           locked_until = v_now + INTERVAL '5 minutes',
           updated_at = v_now
      FROM due
     WHERE o.id = due.id
    RETURNING o.*
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb)
    INTO v_items
    FROM claimed;

  RETURN v_items;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_notification_outbox_item(
  p_id UUID,
  p_dispatched_count INTEGER DEFAULT 0
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
         updated_at = v_now
   WHERE id = p_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_notification_outbox_item(
  p_id UUID,
  p_error TEXT,
  p_retry_delay_seconds INTEGER DEFAULT 60
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
         status = CASE WHEN attempts + 1 >= max_attempts THEN 'DEAD_LETTER' ELSE 'FAILED' END,
         next_retry_at = CASE
           WHEN attempts + 1 >= max_attempts THEN next_retry_at
           ELSE v_now + (GREATEST(5, COALESCE(p_retry_delay_seconds, 60)) || ' seconds')::interval
         END,
         locked_until = NULL,
         last_error = left(COALESCE(p_error, 'OUTBOX_DISPATCH_FAILED'), 500),
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

REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_briefing_ops_metrics() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(INTEGER) FROM anon;
    REVOKE ALL ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER) FROM anon;
    REVOKE ALL ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER) FROM anon;
    REVOKE ALL ON FUNCTION public.get_briefing_ops_metrics() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(INTEGER) FROM authenticated;
    REVOKE ALL ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER) FROM authenticated;
    REVOKE ALL ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER) FROM authenticated;
    REVOKE ALL ON FUNCTION public.get_briefing_ops_metrics() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.claim_notification_outbox_batch(INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_briefing_ops_metrics() TO service_role;
  END IF;
END $$;
