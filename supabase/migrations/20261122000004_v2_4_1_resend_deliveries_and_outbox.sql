-- ==============================================================================
-- FATOSBR V2.4.1 — MIGRAÇÃO INCREMENTAL: RESEND DELIVERIES & NOTIFICATION OUTBOX
-- ==============================================================================
-- 1. Tabela durável internal.briefing_email_deliveries para rastreamento real
--    do estado de entrega no Resend (ACCEPTED vs DELIVERED/BOUNCED/FAILED),
--    Idempotency-Key e prevenção de reenvio duplicado após falhas parciais.
-- 2. Tabela durável internal.notification_outbox para desacoplar segmentação
--    de alertas da transação de ingestão com retry e backoff.
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS internal;

-- 1. Rastreamento Durável de Envios Resend
CREATE TABLE IF NOT EXISTS internal.briefing_email_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID NOT NULL REFERENCES public.briefings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  edition_type TEXT NOT NULL CHECK (edition_type IN ('MORNING', 'EVENING')),
  provider TEXT NOT NULL DEFAULT 'resend',
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  from_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'SENDING', 'ACCEPTED', 'DELIVERED', 'FAILED', 'BOUNCED', 'COMPLAINED', 'DELAYED')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_http_status INTEGER,
  last_error TEXT,
  webhook_event_type TEXT,
  webhook_received_at TIMESTAMPTZ,
  webhook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (briefing_id)
);

CREATE INDEX IF NOT EXISTS idx_briefing_email_deliveries_provider_msg
  ON internal.briefing_email_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_briefing_email_deliveries_retry
  ON internal.briefing_email_deliveries (status, next_retry_at)
  WHERE status = 'FAILED' AND next_retry_at IS NOT NULL;

ALTER TABLE internal.briefing_email_deliveries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP POLICY IF EXISTS "briefing_email_deliveries_service_role" ON internal.briefing_email_deliveries;
    CREATE POLICY "briefing_email_deliveries_service_role" ON internal.briefing_email_deliveries
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 2. Notification Outbox Durável
CREATE TABLE IF NOT EXISTS internal.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'NEWS_HIGH_RELEVANCE',
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  dispatched_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
  ON internal.notification_outbox (status, next_retry_at)
  WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX IF NOT EXISTS idx_notification_outbox_event_id
  ON internal.notification_outbox (event_id);

ALTER TABLE internal.notification_outbox ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP POLICY IF EXISTS "notification_outbox_service_role" ON internal.notification_outbox;
    CREATE POLICY "notification_outbox_service_role" ON internal.notification_outbox
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 3. RPCs de Serviço para Resend Deliveries (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.get_briefing_email_delivery(
  p_briefing_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_row internal.briefing_email_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM internal.briefing_email_deliveries
   WHERE briefing_id = p_briefing_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_briefing_email_delivery(
  p_briefing_id UUID,
  p_user_id UUID,
  p_edition_type TEXT,
  p_idempotency_key TEXT,
  p_from_email TEXT,
  p_status TEXT,
  p_provider_message_id TEXT DEFAULT NULL,
  p_last_http_status INTEGER DEFAULT NULL,
  p_last_error TEXT DEFAULT NULL,
  p_increment_attempt BOOLEAN DEFAULT FALSE,
  p_next_retry_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_row internal.briefing_email_deliveries%ROWTYPE;
BEGIN
  INSERT INTO internal.briefing_email_deliveries (
    briefing_id, user_id, edition_type, idempotency_key, from_email, status,
    provider_message_id, attempt_count, next_retry_at, accepted_at, delivered_at, failed_at,
    last_http_status, last_error, created_at, updated_at
  )
  VALUES (
    p_briefing_id,
    p_user_id,
    p_edition_type,
    p_idempotency_key,
    p_from_email,
    p_status,
    p_provider_message_id,
    CASE WHEN p_increment_attempt THEN 1 ELSE 0 END,
    p_next_retry_at,
    CASE WHEN p_status = 'ACCEPTED' THEN v_now ELSE NULL END,
    CASE WHEN p_status = 'DELIVERED' THEN v_now ELSE NULL END,
    CASE WHEN p_status IN ('FAILED', 'BOUNCED', 'COMPLAINED') THEN v_now ELSE NULL END,
    p_last_http_status,
    p_last_error,
    v_now,
    v_now
  )
  ON CONFLICT (briefing_id) DO UPDATE
  SET
    from_email = EXCLUDED.from_email,
    status = CASE
      WHEN internal.briefing_email_deliveries.status IN ('DELIVERED', 'BOUNCED', 'COMPLAINED')
        AND EXCLUDED.status IN ('PENDING', 'SENDING', 'ACCEPTED', 'FAILED')
        THEN internal.briefing_email_deliveries.status
      ELSE EXCLUDED.status
    END,
    provider_message_id = COALESCE(EXCLUDED.provider_message_id, internal.briefing_email_deliveries.provider_message_id),
    attempt_count = CASE
      WHEN p_increment_attempt THEN internal.briefing_email_deliveries.attempt_count + 1
      ELSE internal.briefing_email_deliveries.attempt_count
    END,
    next_retry_at = EXCLUDED.next_retry_at,
    accepted_at = COALESCE(internal.briefing_email_deliveries.accepted_at, EXCLUDED.accepted_at),
    delivered_at = COALESCE(internal.briefing_email_deliveries.delivered_at, EXCLUDED.delivered_at),
    failed_at = CASE
      WHEN EXCLUDED.status IN ('FAILED', 'BOUNCED', 'COMPLAINED') THEN v_now
      WHEN EXCLUDED.status IN ('ACCEPTED', 'DELIVERED') THEN NULL
      ELSE internal.briefing_email_deliveries.failed_at
    END,
    last_http_status = COALESCE(EXCLUDED.last_http_status, internal.briefing_email_deliveries.last_http_status),
    last_error = CASE
      WHEN EXCLUDED.status IN ('ACCEPTED', 'DELIVERED') THEN NULL
      ELSE COALESCE(EXCLUDED.last_error, internal.briefing_email_deliveries.last_error)
    END,
    updated_at = v_now
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

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

  UPDATE internal.briefing_email_deliveries
     SET
       status = CASE
         WHEN v_next_status IS NULL THEN status
         WHEN status = 'DELIVERED' AND v_next_status = 'DELAYED' THEN status
         ELSE v_next_status
       END,
       delivered_at = CASE WHEN v_next_status = 'DELIVERED' THEN COALESCE(delivered_at, v_now) ELSE delivered_at END,
       failed_at = CASE WHEN v_next_status IN ('FAILED', 'BOUNCED', 'COMPLAINED') THEN COALESCE(failed_at, v_now) ELSE failed_at END,
       webhook_event_type = p_event_type,
       webhook_received_at = v_now,
       webhook_payload = COALESCE(p_payload, '{}'::jsonb),
       updated_at = v_now
   WHERE provider_message_id = p_provider_message_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'MESSAGE_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object(
    'updated', true,
    'briefing_id', v_row.briefing_id,
    'status', v_row.status
  );
END;
$$;

-- 4. RPCs de Serviço para Notification Outbox (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.enqueue_notification_outbox(
  p_dedup_key TEXT,
  p_event_id TEXT,
  p_event_type TEXT,
  p_payload JSONB,
  p_max_attempts INTEGER DEFAULT 5
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
  IF p_dedup_key IS NULL OR btrim(p_dedup_key) = '' OR p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'OUTBOX_INVALID_PARAM' USING ERRCODE = '22023';
  END IF;

  INSERT INTO internal.notification_outbox (
    dedup_key, event_id, event_type, payload, status, max_attempts, next_retry_at, created_at, updated_at
  )
  VALUES (
    p_dedup_key, p_event_id, COALESCE(p_event_type, 'NEWS_HIGH_RELEVANCE'), p_payload, 'PENDING',
    GREATEST(1, COALESCE(p_max_attempts, 5)), v_now, v_now, v_now
  )
  ON CONFLICT (dedup_key) DO UPDATE
  SET
    payload = CASE
      WHEN internal.notification_outbox.status IN ('PENDING', 'FAILED') THEN EXCLUDED.payload
      ELSE internal.notification_outbox.payload
    END,
    updated_at = v_now
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

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

-- 5. DCL Estrito (Menor Privilégio)
REVOKE ALL ON FUNCTION public.get_briefing_email_delivery(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_briefing_email_delivery(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_resend_webhook_event(TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_notification_outbox(TEXT, TEXT, TEXT, JSONB, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.get_briefing_email_delivery(UUID) FROM anon;
    REVOKE ALL ON FUNCTION public.upsert_briefing_email_delivery(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TIMESTAMPTZ) FROM anon;
    REVOKE ALL ON FUNCTION public.apply_resend_webhook_event(TEXT, TEXT, JSONB) FROM anon;
    REVOKE ALL ON FUNCTION public.enqueue_notification_outbox(TEXT, TEXT, TEXT, JSONB, INTEGER) FROM anon;
    REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(INTEGER) FROM anon;
    REVOKE ALL ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER) FROM anon;
    REVOKE ALL ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.get_briefing_email_delivery(UUID) FROM authenticated;
    REVOKE ALL ON FUNCTION public.upsert_briefing_email_delivery(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TIMESTAMPTZ) FROM authenticated;
    REVOKE ALL ON FUNCTION public.apply_resend_webhook_event(TEXT, TEXT, JSONB) FROM authenticated;
    REVOKE ALL ON FUNCTION public.enqueue_notification_outbox(TEXT, TEXT, TEXT, JSONB, INTEGER) FROM authenticated;
    REVOKE ALL ON FUNCTION public.claim_notification_outbox_batch(INTEGER) FROM authenticated;
    REVOKE ALL ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER) FROM authenticated;
    REVOKE ALL ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA internal TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.briefing_email_deliveries TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.notification_outbox TO service_role;
    GRANT EXECUTE ON FUNCTION public.get_briefing_email_delivery(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION public.upsert_briefing_email_delivery(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.apply_resend_webhook_event(TEXT, TEXT, JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.enqueue_notification_outbox(TEXT, TEXT, TEXT, JSONB, INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_notification_outbox_batch(INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.complete_notification_outbox_item(UUID, INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.fail_notification_outbox_item(UUID, TEXT, INTEGER) TO service_role;
  END IF;
END $$;
