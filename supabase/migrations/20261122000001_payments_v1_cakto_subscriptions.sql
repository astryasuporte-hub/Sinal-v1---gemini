-- ============================================================================
-- FATOSBR PAYMENTS V1 — CAKTO ASSINATURAS & RECONCILIAÇÃO FINANCEIRA
-- Migração incremental, idempotente e segura (compatível com PostgreSQL 15+ e PGlite)
-- NÃO remove tabelas nem dados históricos existentes em public.subscriptions,
-- internal.billing_payments ou internal.billing_events.
-- ============================================================================

-- 1. Garantir schema internal (caso ainda não exista em ambientes isolados)
CREATE SCHEMA IF NOT EXISTS internal;

-- 2. Evoluir public.subscriptions preservando todas as linhas e dados legítimos
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
      ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_event_id TEXT,
      ADD COLUMN IF NOT EXISTS billing_metadata JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Índice único parcial para correlacionar rapidamente assinaturas externas da Cakto/provedores
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_sub_id
  ON public.subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON public.subscriptions (user_id, status);

-- Normalizar constraint de status em public.subscriptions (sem apagar ou reescrever dados legítimos)
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
  ) THEN
    FOR v_constraint_name IN
      SELECT conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'public'
        AND t.relname = 'subscriptions'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%status%'
    LOOP
      EXECUTE format('ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
    END LOOP;

    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_status_payments_v1_check
      CHECK (status IN (
        'trialing',
        'TRIAL_ACTIVE',
        'TRIAL_EXPIRED',
        'active',
        'ACTIVE',
        'past_due',
        'PAST_DUE',
        'canceled',
        'CANCELED',
        'cancelled',
        'paused',
        'expired',
        'pending',
        'RENEWAL_PENDING',
        'payment_refused'
      ));
  END IF;
END $$;

-- 3. Tabela internal.billing_attempts para rastreamento seguro de intenções de checkout
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

-- 4. Evoluir internal.billing_payments e internal.billing_events preservando históricos
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'internal' AND table_name = 'billing_payments'
  ) THEN
    ALTER TABLE internal.billing_payments
      ADD COLUMN IF NOT EXISTS attempt_id UUID,
      ADD COLUMN IF NOT EXISTS product_id TEXT,
      ADD COLUMN IF NOT EXISTS offer_id TEXT,
      ADD COLUMN IF NOT EXISTS payment_method TEXT,
      ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BRL',
      ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'SUBSCRIPTION',
      ADD COLUMN IF NOT EXISTS request_state TEXT DEFAULT 'COMPLETED',
      ADD COLUMN IF NOT EXISTS checkout_data JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'internal' AND table_name = 'billing_events'
  ) THEN
    ALTER TABLE internal.billing_events
      ADD COLUMN IF NOT EXISTS event_type TEXT,
      ADD COLUMN IF NOT EXISTS signature_valid BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS event_timestamp TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS attempt_id UUID,
      ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS processing_error TEXT,
      ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Índice único de idempotência para inbox de webhooks por provedor + event_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_provider_event_uidx
  ON internal.billing_events (provider, provider_event_id);

-- 5. Garantir privilégios exclusivos de service_role (quando a role existir no PostgreSQL/Supabase)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON internal.billing_attempts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON internal.billing_attempts FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON SCHEMA internal TO service_role;
    GRANT ALL ON internal.billing_attempts TO service_role;
  END IF;
END $$;

-- 6. Registrar auditoria de schema sem expor segredos
COMMENT ON TABLE internal.billing_attempts IS 'FatosBR Payments V1: Intenções de checkout Cakto com correlação por attempt_id opaco e validação server-side.';
