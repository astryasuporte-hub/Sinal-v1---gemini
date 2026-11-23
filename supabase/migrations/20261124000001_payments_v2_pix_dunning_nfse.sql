-- ============================================================================
-- FATOSBR PAYMENTS V2 — PIX, RECORRÊNCIA, REEMBOLSOS, DUNNING E NFS-E
-- Migração incremental, idempotente e não destrutiva (PostgreSQL 15+ e PGlite)
--
-- Garantias de preservação (V1.3 -> V2):
-- 1. NÃO reaplica nem altera os 9+ trials existentes em public.subscriptions.
-- 2. NÃO adiciona DEFAULT perigoso em public.subscriptions.
-- 3. NÃO remove nem destrói registros de internal.billing_payments ou billing_events.
-- 4. Cria infraestrutura aditiva em internal.* com RLS estrita (service_role only).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS internal;

-- ============================================================================
-- 1. EVOLUIR internal.billing_attempts PARA SUPORTAR RECORRÊNCIA E PIX V2
-- ============================================================================
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  IF to_regclass('internal.billing_attempts') IS NOT NULL THEN
    ALTER TABLE internal.billing_attempts
      ADD COLUMN IF NOT EXISTS recurrence_mode TEXT NOT NULL DEFAULT 'CARD_RECURRING',
      ADD COLUMN IF NOT EXISTS requested_method TEXT;

    -- Atualiza constraint de recurrence_mode se ainda não existir
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'internal'
        AND t.relname = 'billing_attempts'
        AND c.conname = 'billing_attempts_recurrence_mode_check'
    ) THEN
      ALTER TABLE internal.billing_attempts
        ADD CONSTRAINT billing_attempts_recurrence_mode_check
        CHECK (recurrence_mode IN ('CARD_RECURRING', 'PIX_AUTOMATIC', 'PIX_MANUAL_CYCLE'));
    END IF;

    -- Permite 'pix' na lista allowed_payment_methods caso PAYMENTS_ALLOW_PIX_TRADITIONAL seja habilitado futuramente,
    -- mantendo bloqueio de qualquer outro método desconhecido/proibido (boleto, picpay etc.).
    FOR v_conname IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'internal'
        AND t.relname = 'billing_attempts'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ~* 'allowed_payment_methods'
    LOOP
      EXECUTE format('ALTER TABLE internal.billing_attempts DROP CONSTRAINT IF EXISTS %I', v_conname);
    END LOOP;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'internal'
        AND t.relname = 'billing_attempts'
        AND c.conname = 'billing_attempts_allowed_methods_v2_check'
    ) THEN
      ALTER TABLE internal.billing_attempts
        ADD CONSTRAINT billing_attempts_allowed_methods_v2_check
        CHECK (
          allowed_payment_methods <@ ARRAY['credit_card', 'pix_auto', 'pix']::TEXT[]
          AND cardinality(allowed_payment_methods) > 0
        );
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 2. COBRANÇAS PIX DINÂMICAS DO GATEWAY (internal.billing_pix_charges)
-- ============================================================================
CREATE TABLE IF NOT EXISTS internal.billing_pix_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  attempt_id UUID REFERENCES internal.billing_attempts(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'cakto' CHECK (provider IN ('cakto', 'sharpify')),
  provider_order_id TEXT NOT NULL,
  provider_subscription_id TEXT,
  pix_type TEXT NOT NULL DEFAULT 'PIX_AUTOMATIC' CHECK (pix_type IN ('PIX_TRADITIONAL', 'PIX_AUTOMATIC')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUSED')),
  qr_code TEXT,
  qr_code_image_url TEXT,
  copia_e_cola TEXT,
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_pix_charges_provider_order_uidx
  ON internal.billing_pix_charges (provider, provider_order_id);

CREATE INDEX IF NOT EXISTS idx_billing_pix_charges_user_status
  ON internal.billing_pix_charges (user_id, status, created_at DESC);

-- ============================================================================
-- 3. HISTÓRICO DE REEMBOLSOS E CONTESTAÇÕES (internal.billing_refunds)
-- ============================================================================
CREATE TABLE IF NOT EXISTS internal.billing_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  payment_id UUID REFERENCES internal.billing_payments(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'cakto' CHECK (provider IN ('cakto', 'sharpify')),
  provider_payment_id TEXT NOT NULL,
  provider_subscription_id TEXT,
  provider_event_id TEXT NOT NULL,
  dispute_type TEXT NOT NULL DEFAULT 'REFUND' CHECK (dispute_type IN ('REFUND', 'CHARGEBACK')),
  status TEXT NOT NULL CHECK (
    status IN ('REQUESTED', 'PROCESSING', 'CONFIRMED', 'FAILED', 'CHARGEBACK_OPEN', 'CHARGEBACK_WON', 'CHARGEBACK_LOST')
  ),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  reason TEXT,
  access_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  remaining_valid_cycle_until TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_refunds_provider_event_uidx
  ON internal.billing_refunds (provider, provider_event_id);

CREATE INDEX IF NOT EXISTS idx_billing_refunds_user_created
  ON internal.billing_refunds (user_id, created_at DESC);

-- ============================================================================
-- 4. RÉGUA DE COBRANÇA E LOGS DE COMUNICAÇÃO (internal.billing_dunning_logs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS internal.billing_dunning_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  subscription_id UUID,
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN (
      'PAYMENT_PENDING',
      'RENEWAL_UPCOMING',
      'PAYMENT_REFUSED',
      'SUBSCRIPTION_PAST_DUE',
      'DUNNING_RECOVERY',
      'SUBSCRIPTION_REGULARIZED',
      'SUBSCRIPTION_CANCELED',
      'SUBSCRIPTION_EXPIRED'
    )
  ),
  channel TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL', 'IN_APP')),
  dedup_key TEXT NOT NULL UNIQUE,
  recipient_masked TEXT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED_PREFERENCES', 'SKIPPED_HOMOLOGATION', 'RETRYING')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  resend_message_id TEXT,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_dunning_logs_user_created
  ON internal.billing_dunning_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_dunning_logs_status
  ON internal.billing_dunning_logs (status, created_at DESC);

-- ============================================================================
-- 5. DOCUMENTOS FISCAIS DESACOPLADOS NFS-e (internal.billing_fiscal_documents)
-- ============================================================================
CREATE TABLE IF NOT EXISTS internal.billing_fiscal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  payment_id UUID REFERENCES internal.billing_payments(id) ON DELETE SET NULL,
  provider_payment_id TEXT,
  fiscal_provider TEXT NOT NULL DEFAULT 'cakto_native',
  status TEXT NOT NULL DEFAULT 'PENDING_CONFIG' CHECK (
    status IN ('PENDING_CONFIG', 'QUEUED', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'CORRECTION_REQUESTED')
  ),
  customer_name TEXT,
  customer_document_masked TEXT,
  service_amount_cents INTEGER NOT NULL CHECK (service_amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  service_code TEXT,
  municipal_code TEXT,
  nfse_number TEXT,
  verification_code TEXT,
  rps_number TEXT,
  xml_url TEXT,
  pdf_url TEXT,
  error_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  issued_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_fiscal_docs_provider_payment_uidx
  ON internal.billing_fiscal_documents (provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_fiscal_docs_user_created
  ON internal.billing_fiscal_documents (user_id, created_at DESC);

-- ============================================================================
-- 6. HARDENING RLS & PRIVILÉGIOS DE MENOR ESCOPO (V2 TABLES)
-- ============================================================================
DO $$
DECLARE
  v_tbl TEXT;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'internal.billing_pix_charges',
    'internal.billing_refunds',
    'internal.billing_dunning_logs',
    'internal.billing_fiscal_documents'
  ] LOOP
    IF to_regclass(v_tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('REVOKE ALL ON %s FROM PUBLIC', v_tbl);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON %s FROM anon', v_tbl);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON %s FROM authenticated', v_tbl);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO service_role', v_tbl);
        EXECUTE format('DROP POLICY IF EXISTS "service_role_full_%s" ON %s', replace(v_tbl, '.', '_'), v_tbl);
        EXECUTE format(
          'CREATE POLICY "service_role_full_%s" ON %s FOR ALL TO service_role USING (true) WITH CHECK (true)',
          replace(v_tbl, '.', '_'),
          v_tbl
        );
      END IF;
    END IF;
  END LOOP;
END $$;
