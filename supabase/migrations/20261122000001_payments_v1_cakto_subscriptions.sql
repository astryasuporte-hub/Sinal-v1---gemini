-- ============================================================================
-- FATOSBR PAYMENTS V1.1 — CAKTO ASSINATURAS & RECONCILIAÇÃO FINANCEIRA
-- Migração incremental, idempotente e não destrutiva (PostgreSQL 15+ e PGlite)
--
-- Garantias de integridade com o schema real de produção:
-- 1. NÃO remove nem enfraquece CHECK constraints de plan/status em public.subscriptions.
-- 2. NÃO remove nem enfraquece CHECK constraints de status/type/request_state em
--    internal.billing_payments.
-- 3. Atualiza exclusivamente a CHECK constraint de provider em internal.billing_payments
--    para aceitar ('sharpify', 'cakto'), preservando linhas Sharpify existentes.
-- 4. Verifica pg_index antes de criar índice único em internal.billing_events.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS internal;

-- 1. Evoluir public.subscriptions preservando dados e constraints existentes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD COLUMN IF NOT EXISTS plan_id TEXT DEFAULT 'pro',
      ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'cakto',
      ADD COLUMN IF NOT EXISTS product_id TEXT,
      ADD COLUMN IF NOT EXISTS offer_id TEXT,
      ADD COLUMN IF NOT EXISTS checkout_id TEXT,
      ADD COLUMN IF NOT EXISTS payment_method TEXT,
      ADD COLUMN IF NOT EXISTS amount_cents INTEGER DEFAULT 3490,
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BRL',
      ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS trial_starts_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS next_billing_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_event_id TEXT,
      ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS billing_metadata JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS billing_updated_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_sub_id
  ON public.subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON public.subscriptions (user_id, status);

-- 2. Tabela internal.billing_attempts para rastreamento seguro de intenções de checkout
--    O attempt_id (UUID) é usado como identificador opaco de correlação (nunca e-mail/preço/segredo)
CREATE TABLE IF NOT EXISTS internal.billing_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'cakto',
  plan_id TEXT NOT NULL DEFAULT 'pro',
  product_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  checkout_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL',
  allowed_payment_methods TEXT[] NOT NULL DEFAULT ARRAY['credit_card', 'pix_auto']::TEXT[],
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (
    status IN ('CREATED', 'REDIRECTED', 'PAID', 'REFUSED', 'EXPIRED', 'BLOCKED', 'CANCELED')
  ),
  checkout_url TEXT,
  idempotency_key TEXT UNIQUE,
  provider_order_id TEXT,
  provider_subscription_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_attempts_user_created
  ON internal.billing_attempts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_attempts_provider_order
  ON internal.billing_attempts (provider_order_id)
  WHERE provider_order_id IS NOT NULL;

ALTER TABLE internal.billing_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.billing_attempts FROM PUBLIC;

-- 3. Evoluir internal.billing_payments preservando históricos e constraints estritas
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'internal' AND table_name = 'billing_payments'
  ) THEN
    ALTER TABLE internal.billing_payments
      ADD COLUMN IF NOT EXISTS attempt_id UUID,
      ADD COLUMN IF NOT EXISTS product_id TEXT,
      ADD COLUMN IF NOT EXISTS offer_id TEXT,
      ADD COLUMN IF NOT EXISTS checkout_id TEXT,
      ADD COLUMN IF NOT EXISTS payment_method TEXT,
      ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BRL',
      ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'INITIAL',
      ADD COLUMN IF NOT EXISTS request_state TEXT DEFAULT 'READY',
      ADD COLUMN IF NOT EXISTS checkout_data JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

    -- Atualiza EXCLUSIVAMENTE a constraint CHECK de provider para incluir 'cakto' ao lado de 'sharpify'
    FOR v_constraint_name IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'internal'
        AND t.relname = 'billing_payments'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ~* '\yprovider\y'
        AND pg_get_constraintdef(c.oid) !~* '\ystatus\y'
        AND pg_get_constraintdef(c.oid) !~* '\ytype\y'
        AND pg_get_constraintdef(c.oid) !~* '\yrequest_state\y'
    LOOP
      EXECUTE format('ALTER TABLE internal.billing_payments DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
    END LOOP;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'internal'
        AND t.relname = 'billing_payments'
        AND c.conname = 'billing_payments_provider_check'
    ) THEN
      ALTER TABLE internal.billing_payments
        ADD CONSTRAINT billing_payments_provider_check
        CHECK (provider IN ('sharpify', 'cakto'));
    END IF;
  END IF;
END $$;

-- 4. Evoluir internal.billing_events preservando históricos e validando índice único real
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'internal' AND table_name = 'billing_events'
  ) THEN
    ALTER TABLE internal.billing_events
      ADD COLUMN IF NOT EXISTS event_type TEXT,
      ADD COLUMN IF NOT EXISTS signature_valid BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS event_timestamp TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS event_hash TEXT,
      ADD COLUMN IF NOT EXISTS attempt_id UUID,
      ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS processing_error TEXT,
      ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

    -- Cria índice único em (provider, provider_event_id) somente se não existir índice único equivalente
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index ix
      JOIN pg_class tbl ON tbl.oid = ix.indrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      WHERE ns.nspname = 'internal'
        AND tbl.relname = 'billing_events'
        AND ix.indisunique = TRUE
        AND (
          SELECT array_agg(att.attname::text ORDER BY k.pos)
          FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, pos)
          JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = k.attnum
        ) = ARRAY['provider', 'provider_event_id']::text[]
    ) THEN
      CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_provider_event_uidx
        ON internal.billing_events (provider, provider_event_id);
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_provider_hash_uidx
  ON internal.billing_events (provider, event_hash)
  WHERE event_hash IS NOT NULL;

-- 5. Privilégios exclusivos de service_role e política explícita RLS em internal.billing_attempts
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON internal.billing_attempts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON internal.billing_attempts FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA internal TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON internal.billing_attempts TO service_role;
    IF to_regclass('internal.billing_payments') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON internal.billing_payments TO service_role;
    END IF;
    IF to_regclass('internal.billing_events') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON internal.billing_events TO service_role;
    END IF;

    DROP POLICY IF EXISTS "service_role_full_billing_attempts" ON internal.billing_attempts;
    CREATE POLICY "service_role_full_billing_attempts"
      ON internal.billing_attempts
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE internal.billing_attempts IS 'FatosBR Payments V1.1: Intenções de checkout Cakto com correlação por attempt_id opaco e validação server-side.';
