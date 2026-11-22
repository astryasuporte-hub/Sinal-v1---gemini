-- ============================================================================
-- FATOSBR PAYMENTS V1.3 — CAKTO ASSINATURAS, IDEMPOTÊNCIA & RECONCILIAÇÃO
-- Migração incremental, idempotente e não destrutiva (PostgreSQL 15+ e PGlite)
--
-- Garantias de integridade com o esquema real de produção:
-- 1. NÃO usa DEFAULT 'pro', DEFAULT 'cakto' ou DEFAULT 3490 em public.subscriptions.
-- 2. Preserva 100% os registros existentes (incluindo os 9+ trials ativos, datas
--    de início/fim de trial, histórico Sharpify e assinaturas existentes).
-- 3. Garante correspondência canônica:
--      plan = 'TRIAL' -> plan_id = 'trial'
--      plan = 'PRO'   -> plan_id = 'pro'
-- 4. Idempotência contextualizada em internal.billing_attempts por
--    (user_id, provider, idempotency_key) WHERE idempotency_key IS NOT NULL.
-- 5. Reconcilia billing_events_provider_event_id_key com ON CONFLICT (provider, provider_event_id)
--    substituindo com segurança (verificando dependências e colisões) por
--    índice único composto em (provider, provider_event_id), sem perda de dados.
-- 6. Preserva todas as CHECK constraints existentes em public.subscriptions e
--    internal.billing_payments, ampliando exclusivamente provider para ('sharpify', 'cakto').
-- 7. Reforça RLS e menor privilégio: anon/authenticated NUNCA acessam internal.*
--    e NUNCA escrevem diretamente em public.subscriptions.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS internal;

-- ============================================================================
-- 1. EVOLUIR public.subscriptions PRESERVANDO TRIALS E DADOS SHARPIFY
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD COLUMN IF NOT EXISTS plan_id TEXT,
      ADD COLUMN IF NOT EXISTS provider TEXT,
      ADD COLUMN IF NOT EXISTS product_id TEXT,
      ADD COLUMN IF NOT EXISTS offer_id TEXT,
      ADD COLUMN IF NOT EXISTS checkout_id TEXT,
      ADD COLUMN IF NOT EXISTS payment_method TEXT,
      ADD COLUMN IF NOT EXISTS amount_cents INTEGER,
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

    -- Remove defaults perigosos caso uma versão anterior da coluna tenha aplicado 'pro'/'cakto'/3490
    ALTER TABLE public.subscriptions
      ALTER COLUMN plan_id DROP DEFAULT,
      ALTER COLUMN provider DROP DEFAULT,
      ALTER COLUMN amount_cents DROP DEFAULT;

    -- Backfill explícito e idempotente de plan_id conforme a coluna canônica plan
    UPDATE public.subscriptions
       SET plan_id = 'trial'
     WHERE UPPER(TRIM(COALESCE(plan, 'TRIAL'))) = 'TRIAL'
       AND plan_id IS DISTINCT FROM 'trial';

    UPDATE public.subscriptions
       SET plan_id = 'pro'
     WHERE UPPER(TRIM(plan)) = 'PRO'
       AND plan_id IS NULL;

    -- Se algum trial puro recebeu amount_cents=3490 sem vínculo pago, limpa para NULL
    UPDATE public.subscriptions
       SET amount_cents = NULL
     WHERE UPPER(TRIM(COALESCE(plan, 'TRIAL'))) = 'TRIAL'
       AND amount_cents = 3490
       AND provider_subscription_id IS NULL;

    -- Se algum registro TRIAL puro recebeu provider='cakto' sem assinatura/pagamento vinculado, limpa para NULL
    IF to_regclass('internal.billing_payments') IS NOT NULL THEN
      UPDATE public.subscriptions s
         SET provider = NULL
       WHERE UPPER(TRIM(COALESCE(s.plan, 'TRIAL'))) = 'TRIAL'
         AND s.provider IS NOT NULL
         AND s.provider_subscription_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM internal.billing_payments bp
           WHERE bp.user_id = s.user_id AND bp.provider = s.provider
         );

      -- Backfill seguro de provider APENAS para PRO sem provider quando houver pagamento comprovado em billing_payments
      UPDATE public.subscriptions s
         SET provider = src.provider
        FROM (
          SELECT DISTINCT ON (bp.user_id) bp.user_id, bp.provider
          FROM internal.billing_payments bp
          WHERE bp.user_id IS NOT NULL
            AND bp.provider IN ('sharpify', 'cakto')
          ORDER BY bp.user_id, bp.created_at DESC
        ) src
       WHERE s.user_id = src.user_id
         AND UPPER(TRIM(s.plan)) = 'PRO'
         AND s.provider IS NULL;
    END IF;

    -- Garante coerência permanente entre plan e plan_id (impossibilita TRIAL com plan_id='pro')
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'public'
        AND t.relname = 'subscriptions'
        AND c.conname = 'subscriptions_plan_id_consistency_check'
    ) THEN
      ALTER TABLE public.subscriptions
        ADD CONSTRAINT subscriptions_plan_id_consistency_check
        CHECK (
          (UPPER(TRIM(plan)) = 'TRIAL' AND (plan_id IS NULL OR plan_id = 'trial'))
          OR (UPPER(TRIM(plan)) = 'PRO' AND (plan_id IS NULL OR plan_id = 'pro'))
        );
    END IF;

    -- Garante índice único por user_id se ainda não houver unicidade equivalente e não houver duplicatas
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index ix
      JOIN pg_class tbl ON tbl.oid = ix.indrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      WHERE ns.nspname = 'public'
        AND tbl.relname = 'subscriptions'
        AND ix.indisunique = TRUE
        AND (
          SELECT array_agg(att.attname::text ORDER BY k.pos)
          FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, pos)
          JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = k.attnum
        ) = ARRAY['user_id']::text[]
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.subscriptions GROUP BY user_id HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_uidx
          ON public.subscriptions (user_id);
      END IF;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_sub_id
  ON public.subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON public.subscriptions (user_id, status);

-- ============================================================================
-- 2. TABELA internal.billing_attempts COM IDEMPOTÊNCIA POR (user_id, provider, idempotency_key)
-- ============================================================================
CREATE TABLE IF NOT EXISTS internal.billing_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'cakto' CHECK (provider IN ('sharpify', 'cakto')),
  plan_id TEXT NOT NULL DEFAULT 'pro' CHECK (plan_id IN ('pro')),
  product_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  checkout_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  allowed_payment_methods TEXT[] NOT NULL DEFAULT ARRAY['credit_card', 'pix_auto']::TEXT[]
    CHECK (allowed_payment_methods <@ ARRAY['credit_card', 'pix_auto']::TEXT[] AND cardinality(allowed_payment_methods) > 0),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (
    status IN ('CREATED', 'REDIRECTED', 'PAID', 'REFUSED', 'EXPIRED', 'BLOCKED', 'CANCELED')
  ),
  checkout_url TEXT,
  idempotency_key TEXT,
  provider_order_id TEXT,
  provider_subscription_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Caso a tabela já exista de versão anterior com UNIQUE global em idempotency_key,
-- remove apenas a unicidade global solta de 1 coluna e aplica a unicidade contextualizada.
DO $$
DECLARE
  v_conname TEXT;
  v_idxname TEXT;
BEGIN
  FOR v_conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname = 'internal'
      AND tbl.relname = 'billing_attempts'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY k.pos)
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, pos)
        JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = k.attnum
      ) = ARRAY['idempotency_key']::text[]
  LOOP
    EXECUTE format('ALTER TABLE internal.billing_attempts DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  FOR v_idxname IN
    SELECT idx.relname
    FROM pg_index ix
    JOIN pg_class tbl ON tbl.oid = ix.indrelid
    JOIN pg_class idx ON idx.oid = ix.indexrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname = 'internal'
      AND tbl.relname = 'billing_attempts'
      AND ix.indisunique = TRUE
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = ix.indexrelid)
      AND (
        SELECT array_agg(att.attname::text ORDER BY k.pos)
        FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, pos)
        JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = k.attnum
      ) = ARRAY['idempotency_key']::text[]
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS internal.%I', v_idxname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_attempts_user_provider_idemp_uidx
  ON internal.billing_attempts (user_id, provider, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_attempts_user_created
  ON internal.billing_attempts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_attempts_provider_order
  ON internal.billing_attempts (provider_order_id)
  WHERE provider_order_id IS NOT NULL;

ALTER TABLE internal.billing_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON internal.billing_attempts FROM PUBLIC;

-- ============================================================================
-- 3. EVOLUIR internal.billing_payments MANTENDO HISTÓRICO SHARPIFY E CONSTRAINTS
-- ============================================================================
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

DO $$
BEGIN
  IF to_regclass('internal.billing_payments') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_billing_payments_attempt_id
      ON internal.billing_payments (attempt_id)
      WHERE attempt_id IS NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 4. EVOLUIR internal.billing_events E RECONCILIAR UNICIDADE POR (provider, provider_event_id)
-- ============================================================================
DO $$
DECLARE
  v_dup_count INTEGER := 0;
  v_con RECORD;
  v_idx RECORD;
  v_dep_count INTEGER := 0;
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

    -- Garante default seguro se coluna legada context existir
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'internal' AND table_name = 'billing_events' AND column_name = 'context'
    ) THEN
      ALTER TABLE internal.billing_events ALTER COLUMN context SET DEFAULT 'webhook';
    END IF;

    -- Backfill seguro de provider nulo apenas em eventos históricos pré-Cakto (default Sharpify)
    UPDATE internal.billing_events
       SET provider = 'sharpify'
     WHERE provider IS NULL;

    -- Garante ausência de duplicatas antes de criar o índice único composto
    SELECT COUNT(*) INTO v_dup_count
    FROM (
      SELECT provider, provider_event_id
      FROM internal.billing_events
      GROUP BY provider, provider_event_id
      HAVING COUNT(*) > 1
    ) d;

    IF v_dup_count > 0 THEN
      RAISE EXCEPTION 'MIGRATION_ABORTED: Encontradas % combinações duplicadas de (provider, provider_event_id) em internal.billing_events.', v_dup_count;
    END IF;

    -- Cria índice único composto (provider, provider_event_id) ANTES de remover a unicidade unitária legada,
    -- garantindo proteção contínua e compatibilidade exata com ON CONFLICT (provider, provider_event_id).
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index ix
      JOIN pg_class tbl ON tbl.oid = ix.indrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      WHERE ns.nspname = 'internal'
        AND tbl.relname = 'billing_events'
        AND ix.indisunique = TRUE
        AND ix.indpred IS NULL
        AND (
          SELECT array_agg(att.attname::text ORDER BY k.pos)
          FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, pos)
          JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = k.attnum
        ) = ARRAY['provider', 'provider_event_id']::text[]
    ) THEN
      CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_provider_event_uidx
        ON internal.billing_events (provider, provider_event_id);
    END IF;

    -- Inspeciona e remove com segurança a constraint única legada somente em (provider_event_id)
    -- (ex.: billing_events_provider_event_id_key), validando antes ausência de FKs dependentes.
    FOR v_con IN
      SELECT c.oid, c.conname
      FROM pg_constraint c
      JOIN pg_class tbl ON tbl.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      WHERE ns.nspname = 'internal'
        AND tbl.relname = 'billing_events'
        AND c.contype = 'u'
        AND (
          SELECT array_agg(att.attname::text ORDER BY k.pos)
          FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, pos)
          JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = k.attnum
        ) = ARRAY['provider_event_id']::text[]
    LOOP
      SELECT COUNT(*) INTO v_dep_count
      FROM pg_depend d
      JOIN pg_constraint fk ON fk.oid = d.objid
      WHERE d.refobjid = v_con.oid
        AND fk.contype = 'f';

      IF v_dep_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION_ABORTED: Constraint % possui % chaves estrangeiras dependentes.', v_con.conname, v_dep_count;
      END IF;

      EXECUTE format('ALTER TABLE internal.billing_events DROP CONSTRAINT IF EXISTS %I', v_con.conname);
    END LOOP;

    -- Remove também eventuais índices únicos órfãos de 1 coluna em (provider_event_id)
    FOR v_idx IN
      SELECT idx.relname
      FROM pg_index ix
      JOIN pg_class tbl ON tbl.oid = ix.indrelid
      JOIN pg_class idx ON idx.oid = ix.indexrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      WHERE ns.nspname = 'internal'
        AND tbl.relname = 'billing_events'
        AND ix.indisunique = TRUE
        AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = ix.indexrelid)
        AND (
          SELECT array_agg(att.attname::text ORDER BY k.pos)
          FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, pos)
          JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = k.attnum
        ) = ARRAY['provider_event_id']::text[]
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS internal.%I', v_idx.relname);
    END LOOP;

    -- Remove índice não-único redundante em (provider, provider_event_id) se o único composto já o substitui
    IF EXISTS (
      SELECT 1
      FROM pg_index ix
      JOIN pg_class tbl ON tbl.oid = ix.indrelid
      JOIN pg_class idx ON idx.oid = ix.indexrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      WHERE ns.nspname = 'internal'
        AND tbl.relname = 'billing_events'
        AND idx.relname = 'idx_billing_events_provider_event'
        AND ix.indisunique = FALSE
    ) THEN
      DROP INDEX IF EXISTS internal.idx_billing_events_provider_event;
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_provider_hash_uidx
  ON internal.billing_events (provider, event_hash)
  WHERE event_hash IS NOT NULL;

-- ============================================================================
-- 5. HARDENING RLS E PRIVILÉGIOS DE MENOR ESCOPO (internal.* E public.subscriptions)
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('internal.billing_attempts') IS NOT NULL THEN
    ALTER TABLE internal.billing_attempts ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON internal.billing_attempts FROM PUBLIC;
  END IF;
  IF to_regclass('internal.billing_payments') IS NOT NULL THEN
    ALTER TABLE internal.billing_payments ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON internal.billing_payments FROM PUBLIC;
  END IF;
  IF to_regclass('internal.billing_events') IS NOT NULL THEN
    ALTER TABLE internal.billing_events ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON internal.billing_events FROM PUBLIC;
  END IF;
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.subscriptions FROM PUBLIC;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA internal FROM anon;
    REVOKE ALL ON internal.billing_attempts FROM anon;
    IF to_regclass('internal.billing_payments') IS NOT NULL THEN
      REVOKE ALL ON internal.billing_payments FROM anon;
    END IF;
    IF to_regclass('internal.billing_events') IS NOT NULL THEN
      REVOKE ALL ON internal.billing_events FROM anon;
    END IF;
    IF to_regclass('public.subscriptions') IS NOT NULL THEN
      REVOKE ALL ON public.subscriptions FROM anon;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA internal FROM authenticated;
    REVOKE ALL ON internal.billing_attempts FROM authenticated;
    IF to_regclass('internal.billing_payments') IS NOT NULL THEN
      REVOKE ALL ON internal.billing_payments FROM authenticated;
    END IF;
    IF to_regclass('internal.billing_events') IS NOT NULL THEN
      REVOKE ALL ON internal.billing_events FROM authenticated;
    END IF;
    IF to_regclass('public.subscriptions') IS NOT NULL THEN
      -- Usuários autenticados podem apenas ler sua própria assinatura via RLS, jamais alterar plano/status
      REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated;
      GRANT SELECT ON public.subscriptions TO authenticated;
      DROP POLICY IF EXISTS "authenticated_select_own_subscription" ON public.subscriptions;
      CREATE POLICY "authenticated_select_own_subscription"
        ON public.subscriptions
        FOR SELECT
        TO authenticated
        USING (auth.uid() = user_id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA internal TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON internal.billing_attempts TO service_role;

    DROP POLICY IF EXISTS "service_role_full_billing_attempts" ON internal.billing_attempts;
    CREATE POLICY "service_role_full_billing_attempts"
      ON internal.billing_attempts
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);

    IF to_regclass('internal.billing_payments') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON internal.billing_payments TO service_role;
      DROP POLICY IF EXISTS "service_role_full_billing_payments" ON internal.billing_payments;
      CREATE POLICY "service_role_full_billing_payments"
        ON internal.billing_payments
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;

    IF to_regclass('internal.billing_events') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON internal.billing_events TO service_role;
      DROP POLICY IF EXISTS "service_role_full_billing_events" ON internal.billing_events;
      CREATE POLICY "service_role_full_billing_events"
        ON internal.billing_events
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;

    IF to_regclass('public.subscriptions') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO service_role;
      DROP POLICY IF EXISTS "service_role_full_subscriptions" ON public.subscriptions;
      CREATE POLICY "service_role_full_subscriptions"
        ON public.subscriptions
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
  END IF;
END $$;

COMMENT ON TABLE internal.billing_attempts IS 'FatosBR Payments V1.3: Intenções de checkout com idempotência por (user_id, provider, idempotency_key) e correlação por attempt_id opaco.';

