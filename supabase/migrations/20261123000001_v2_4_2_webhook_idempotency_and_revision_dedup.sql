-- ==============================================================================
-- FATOSBR V2.4.2 — MIGRAÇÃO ESTRITAMENTE INCREMENTAL:
-- 1. Idempotência Durável de Webhooks Resend (internal.resend_webhook_events)
-- 2. Proteção Out-of-Order em public.apply_resend_webhook_event
-- 3. Deduplicação por Revisão Significativa em public.notifications (event_revision)
-- ==============================================================================
-- ATENÇÃO:
-- - NÃO reaplica nenhuma migração anterior V2.3.x / V2.4.1.
-- - 100% idempotente, incremental e restrita a service_role no schema internal.
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS internal;

-- 1. Tabela Durável de Inbox/Idempotência de Webhooks Resend (chave natural: svix_id)
CREATE TABLE IF NOT EXISTS internal.resend_webhook_events (
  svix_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (
    status IN ('PROCESSING', 'PROCESSED', 'FAILED')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  delivery_updated BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_status TEXT,
  reason TEXT,
  payload_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resend_webhook_events_status
  ON internal.resend_webhook_events (status, processing_started_at);

CREATE INDEX IF NOT EXISTS idx_resend_webhook_events_msg
  ON internal.resend_webhook_events (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE internal.resend_webhook_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP POLICY IF EXISTS "resend_webhook_events_service_role" ON internal.resend_webhook_events;
    CREATE POLICY "resend_webhook_events_service_role" ON internal.resend_webhook_events
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 2. RPC Atômica para Reivindicação/Idempotência de Webhook Resend (SECURITY INVOKER)
-- Diferencia explicitamente:
-- - ACQUIRED: esta requisição deve processar e persistir o evento;
-- - ALREADY_PROCESSED: existe evidência durável status='PROCESSED' (200 duplicate:true seguro);
-- - IN_FLIGHT: outra instância ainda está tentando persistir (caller retorna 503 retryable).
CREATE OR REPLACE FUNCTION public.claim_resend_webhook_event(
  p_svix_id TEXT,
  p_event_type TEXT,
  p_provider_message_id TEXT DEFAULT NULL,
  p_payload_meta JSONB DEFAULT '{}'::jsonb,
  p_stale_ms BIGINT DEFAULT 60000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_stale_interval INTERVAL := (GREATEST(1000, COALESCE(p_stale_ms, 60000)) || ' milliseconds')::interval;
  v_row internal.resend_webhook_events%ROWTYPE;
BEGIN
  IF p_svix_id IS NULL OR btrim(p_svix_id) = '' THEN
    RAISE EXCEPTION 'WEBHOOK_INVALID_SVIX_ID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO internal.resend_webhook_events (
    svix_id, event_type, provider_message_id, status, attempt_count,
    first_seen_at, processing_started_at, payload_meta, created_at, updated_at
  )
  VALUES (
    p_svix_id,
    COALESCE(NULLIF(btrim(p_event_type), ''), 'unknown'),
    NULLIF(btrim(COALESCE(p_provider_message_id, '')), ''),
    'PROCESSING',
    1,
    v_now,
    v_now,
    COALESCE(p_payload_meta, '{}'::jsonb),
    v_now,
    v_now
  )
  ON CONFLICT (svix_id) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'action', 'ACQUIRED',
      'status', v_row.status,
      'attempt_count', v_row.attempt_count
    );
  END IF;

  SELECT * INTO v_row
    FROM internal.resend_webhook_events
   WHERE svix_id = p_svix_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WEBHOOK_CLAIM_STATE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status = 'PROCESSED' THEN
    RETURN jsonb_build_object(
      'action', 'ALREADY_PROCESSED',
      'status', v_row.status,
      'attempt_count', v_row.attempt_count,
      'processed_at', v_row.processed_at,
      'delivery_updated', v_row.delivery_updated,
      'delivery_status', v_row.delivery_status,
      'reason', v_row.reason
    );
  END IF;

  IF v_row.status = 'FAILED'
     OR (v_row.status = 'PROCESSING' AND v_row.processing_started_at <= (v_now - v_stale_interval)) THEN
    UPDATE internal.resend_webhook_events
       SET status = 'PROCESSING',
           event_type = COALESCE(NULLIF(btrim(p_event_type), ''), event_type),
           provider_message_id = COALESCE(NULLIF(btrim(COALESCE(p_provider_message_id, '')), ''), provider_message_id),
           processing_started_at = v_now,
           attempt_count = attempt_count + 1,
           last_error = NULL,
           payload_meta = COALESCE(p_payload_meta, payload_meta),
           updated_at = v_now
     WHERE svix_id = p_svix_id
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
      'action', 'ACQUIRED',
      'status', v_row.status,
      'attempt_count', v_row.attempt_count
    );
  END IF;

  RETURN jsonb_build_object(
    'action', 'IN_FLIGHT',
    'status', v_row.status,
    'attempt_count', v_row.attempt_count,
    'processing_started_at', v_row.processing_started_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_resend_webhook_event(
  p_svix_id TEXT,
  p_delivery_updated BOOLEAN DEFAULT FALSE,
  p_delivery_status TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_row internal.resend_webhook_events%ROWTYPE;
BEGIN
  UPDATE internal.resend_webhook_events
     SET status = 'PROCESSED',
         processed_at = COALESCE(processed_at, v_now),
         last_error = NULL,
         delivery_updated = COALESCE(p_delivery_updated, FALSE),
         delivery_status = COALESCE(p_delivery_status, delivery_status),
         reason = COALESCE(p_reason, reason),
         updated_at = v_now
   WHERE svix_id = p_svix_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('completed', false);
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'status', v_row.status,
    'processed_at', v_row.processed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_resend_webhook_event(
  p_svix_id TEXT,
  p_error TEXT DEFAULT 'WEBHOOK_PERSISTENCE_FAILED'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_row internal.resend_webhook_events%ROWTYPE;
BEGIN
  UPDATE internal.resend_webhook_events
     SET status = 'FAILED',
         last_error = left(COALESCE(NULLIF(btrim(p_error), ''), 'WEBHOOK_PERSISTENCE_FAILED'), 500),
         updated_at = v_now
   WHERE svix_id = p_svix_id
     AND status <> 'PROCESSED'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('failed_marked', false);
  END IF;

  RETURN jsonb_build_object(
    'failed_marked', true,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count
  );
END;
$$;

-- 3. Endurecimento Out-of-Order em public.apply_resend_webhook_event
CREATE OR REPLACE FUNCTION public.apply_resend_webhook_event(
  p_provider_message_id TEXT,
  p_event_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_norm_type TEXT := lower(COALESCE(p_event_type, ''));
  v_next_status TEXT := NULL;
  v_row internal.briefing_email_deliveries%ROWTYPE;
  v_is_out_of_order BOOLEAN := FALSE;
BEGIN
  IF p_provider_message_id IS NULL OR btrim(p_provider_message_id) = '' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'MISSING_MESSAGE_ID');
  END IF;

  IF v_norm_type IN ('email.delivered', 'delivered') THEN
    v_next_status := 'DELIVERED';
  ELSIF v_norm_type IN ('email.bounced', 'bounced') THEN
    v_next_status := 'BOUNCED';
  ELSIF v_norm_type IN ('email.complained', 'complained') THEN
    v_next_status := 'COMPLAINED';
  ELSIF v_norm_type IN ('email.failed', 'failed') THEN
    v_next_status := 'FAILED';
  ELSIF v_norm_type IN ('email.delivery_delayed', 'delayed') THEN
    v_next_status := 'DELAYED';
  END IF;

  SELECT * INTO v_row
    FROM internal.briefing_email_deliveries
   WHERE provider_message_id = p_provider_message_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'MESSAGE_NOT_FOUND');
  END IF;

  IF v_next_status IS NOT NULL THEN
    IF v_row.status = 'COMPLAINED' AND v_next_status <> 'COMPLAINED' THEN
      v_is_out_of_order := TRUE;
    ELSIF v_row.status = 'DELIVERED' AND v_next_status IN ('DELAYED', 'FAILED', 'ACCEPTED', 'SENDING', 'PENDING', 'BOUNCED') THEN
      v_is_out_of_order := TRUE;
    ELSIF v_row.status = 'BOUNCED' AND v_next_status IN ('DELAYED', 'FAILED', 'ACCEPTED', 'SENDING', 'PENDING') THEN
      v_is_out_of_order := TRUE;
    END IF;
  END IF;

  IF v_is_out_of_order THEN
    RETURN jsonb_build_object(
      'updated', false,
      'briefing_id', v_row.briefing_id,
      'status', v_row.status,
      'reason', 'OUT_OF_ORDER_IGNORED'
    );
  END IF;

  UPDATE internal.briefing_email_deliveries
     SET
       status = COALESCE(v_next_status, status),
       delivered_at = CASE WHEN v_next_status = 'DELIVERED' THEN COALESCE(delivered_at, v_now) ELSE delivered_at END,
       failed_at = CASE WHEN v_next_status IN ('FAILED', 'BOUNCED', 'COMPLAINED') THEN COALESCE(failed_at, v_now) ELSE failed_at END,
       webhook_event_type = p_event_type,
       webhook_received_at = v_now,
       webhook_payload = COALESCE(p_payload, '{}'::jsonb),
       updated_at = v_now
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'updated', true,
    'briefing_id', v_row.briefing_id,
    'status', v_row.status
  );
END;
$$;

-- 4. Deduplicação por Revisão Significativa em public.notifications (event_revision)
-- Evolui com segurança idx_notifications_dedup_user_event_cat para (user_id, event_id, category, event_revision)
-- preservando integralmente proteção contra duplicatas na mesma revisão.
DO $$
DECLARE
  v_indexdef TEXT;
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications
      ADD COLUMN IF NOT EXISTS event_revision INTEGER NOT NULL DEFAULT 1;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'event_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'category'
    ) THEN
      SELECT indexdef INTO v_indexdef
        FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'notifications'
         AND indexname = 'idx_notifications_dedup_user_event_cat'
       LIMIT 1;

      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE event_id IS NOT NULL
        GROUP BY user_id, event_id, category, event_revision
        HAVING COUNT(*) > 1
      ) THEN
        IF v_indexdef IS NULL THEN
          CREATE UNIQUE INDEX idx_notifications_dedup_user_event_cat
            ON public.notifications (user_id, event_id, category, event_revision)
            WHERE event_id IS NOT NULL;
        ELSIF v_indexdef NOT ILIKE '%event_revision%' THEN
          DROP INDEX public.idx_notifications_dedup_user_event_cat;
          CREATE UNIQUE INDEX idx_notifications_dedup_user_event_cat
            ON public.notifications (user_id, event_id, category, event_revision)
            WHERE event_id IS NOT NULL;
        END IF;
      END IF;
    END IF;
  END IF;
END $$;

-- 5. DCL Estrito (Menor Privilégio)
REVOKE ALL ON FUNCTION public.claim_resend_webhook_event(TEXT, TEXT, TEXT, JSONB, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_resend_webhook_event(TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_resend_webhook_event(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_resend_webhook_event(TEXT, TEXT, JSONB) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.claim_resend_webhook_event(TEXT, TEXT, TEXT, JSONB, BIGINT) FROM anon;
    REVOKE ALL ON FUNCTION public.complete_resend_webhook_event(TEXT, BOOLEAN, TEXT, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION public.fail_resend_webhook_event(TEXT, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION public.apply_resend_webhook_event(TEXT, TEXT, JSONB) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.claim_resend_webhook_event(TEXT, TEXT, TEXT, JSONB, BIGINT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.complete_resend_webhook_event(TEXT, BOOLEAN, TEXT, TEXT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.fail_resend_webhook_event(TEXT, TEXT) FROM authenticated;
    REVOKE ALL ON FUNCTION public.apply_resend_webhook_event(TEXT, TEXT, JSONB) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA internal TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.resend_webhook_events TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_resend_webhook_event(TEXT, TEXT, TEXT, JSONB, BIGINT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.complete_resend_webhook_event(TEXT, BOOLEAN, TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.fail_resend_webhook_event(TEXT, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.apply_resend_webhook_event(TEXT, TEXT, JSONB) TO service_role;
  END IF;
END $$;
