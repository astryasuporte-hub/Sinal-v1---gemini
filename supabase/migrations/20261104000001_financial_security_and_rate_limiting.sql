-- ==============================================================================
-- FATOSBR — MIGRAÇÃO VERSIONADA 20261104000001 (VERSÃO CORRIGIDA)
-- SEGURANÇA FINANCEIRA, TRANSAÇÕES ATÔMICAS, RATE LIMITING E RBAC
-- ==============================================================================
-- DEPENDÊNCIAS: PostgreSQL 14+, Supabase Auth (auth.users, auth.role, auth.uid).
-- PRÉ-CONDIÇÕES: Schema auth ativo. Extensão pgcrypto ou gen_random_uuid() disponível.
-- TABELA REAL DE ASSINATURAS: internal.billing_subscriptions (NÃO altera public.profiles).
-- AUTORIZAÇÃO: RBAC via public.user_roles e public.is_admin(). Sem e-mails hardcoded.
-- PERMISSÕES RPC: REVOKE de PUBLIC, anon e authenticated. GRANT exclusivo para service_role.
-- SCHEMA EXPOSURE: RPCs em public com search_path = internal, public, pg_temp.
--   Tabelas financeiras isoladas em internal (não expostas pela Data API do PostgREST).
-- ==============================================================================

-- 1. Garantir existência do schema internal para dados financeiros sensíveis
CREATE SCHEMA IF NOT EXISTS internal;

-- 2. Tabela Canônica de Cobranças Pix (internal.billing_payments)
CREATE TABLE IF NOT EXISTS internal.billing_payments (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED')),
  provider TEXT NOT NULL DEFAULT 'zynpay',
  description TEXT,
  qr_code_text TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- 3. Tabela de Idempotência e Auditoria de Webhooks (internal.billing_events)
CREATE TABLE IF NOT EXISTS internal.billing_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'zynpay',
  event_type TEXT NOT NULL,
  charge_id TEXT REFERENCES internal.billing_payments(id) ON DELETE SET NULL,
  amount_cents INTEGER,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED')),
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabela Real de Assinaturas (internal.billing_subscriptions)
-- Fonte de verdade canônica do status Pro da FatosBR
CREATE TABLE IF NOT EXISTS internal.billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  plan_name TEXT NOT NULL DEFAULT 'FatosBR Pro',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIAL_ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
  amount_cents INTEGER NOT NULL DEFAULT 2990,
  currency TEXT NOT NULL DEFAULT 'BRL',
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  payment_method TEXT DEFAULT 'PIX',
  gateway TEXT DEFAULT 'zynpay',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 5. Tabela de Contadores de Rate Limiting Distribuído (internal.rate_limit_counters)
CREATE TABLE IF NOT EXISTS internal.rate_limit_counters (
  key TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Tabela de RBAC Real (public.user_roles) — Elimina e-mails hardcoded
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'editor', 'subscriber')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, role)
);

-- 7. Índices de Otimização e Concorrência
CREATE INDEX IF NOT EXISTS idx_billing_payments_user_id ON internal.billing_payments (user_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_user_email ON internal.billing_payments (user_email);
CREATE INDEX IF NOT EXISTS idx_billing_payments_status ON internal.billing_payments (status);
CREATE INDEX IF NOT EXISTS idx_billing_payments_created_at ON internal.billing_payments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_charge_id ON internal.billing_events (charge_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_created_at ON internal.billing_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user ON internal.billing_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status ON internal.billing_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window ON internal.rate_limit_counters (window_start);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);

-- 8. Função de Autorização RBAC (public.is_admin)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Chamadas vindas do backend com a service_role key
  IF auth.role() = 'service_role' THEN
    RETURN TRUE;
  END IF;

  -- 2. JWT claims assinadas no app_metadata do Supabase Auth
  IF (auth.jwt() -> 'app_metadata' ->> 'is_admin')::BOOLEAN IS TRUE 
     OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'super_admin') THEN
    RETURN TRUE;
  END IF;

  -- 3. Consulta estruturada na tabela public.user_roles
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
      AND role IN ('admin', 'super_admin')
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- 9. View Segura para Consulta de Assinaturas pelo Frontend
-- Permite ao usuário autenticado ler apenas a sua própria assinatura ativa
CREATE OR REPLACE VIEW public.user_subscriptions
WITH (security_invoker = true) AS
SELECT 
  id,
  user_id,
  user_email,
  plan_name,
  status,
  amount_cents,
  currency,
  current_period_start,
  current_period_end,
  gateway,
  created_at,
  updated_at
FROM internal.billing_subscriptions;

-- 10. Habilitar Row Level Security (RLS)
ALTER TABLE internal.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal.rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 11. Políticas de RLS Sem E-mails Hardcoded
DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
CREATE POLICY "user_roles_select_own" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin() = TRUE);

DROP POLICY IF EXISTS "user_roles_service_role" ON public.user_roles;
CREATE POLICY "user_roles_service_role" ON public.user_roles
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "billing_payments_select_own" ON internal.billing_payments;
CREATE POLICY "billing_payments_select_own" ON internal.billing_payments
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin() = TRUE);

DROP POLICY IF EXISTS "billing_payments_service_role" ON internal.billing_payments;
CREATE POLICY "billing_payments_service_role" ON internal.billing_payments
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "billing_subscriptions_select_own" ON internal.billing_subscriptions;
CREATE POLICY "billing_subscriptions_select_own" ON internal.billing_subscriptions
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin() = TRUE);

DROP POLICY IF EXISTS "billing_subscriptions_service_role" ON internal.billing_subscriptions;
CREATE POLICY "billing_subscriptions_service_role" ON internal.billing_subscriptions
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "billing_events_service_role" ON internal.billing_events;
CREATE POLICY "billing_events_service_role" ON internal.billing_events
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "rate_limit_service_role" ON internal.rate_limit_counters;
CREATE POLICY "rate_limit_service_role" ON internal.rate_limit_counters
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 12. RPC: Incremento Atômico de Rate Limiting com Menor Privilégio
-- Reside em public para compatibilidade com PostgREST Data API, com execução restrita a service_role
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_ms BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = internal, public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_elapsed_ms BIGINT;
  v_allowed BOOLEAN;
  v_retry_after INTEGER := 0;
BEGIN
  -- CONTROLE DE ACESSO: Valida privilégio de banco e role de serviço
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita ao papel autorizado (service_role).'
      USING ERRCODE = '42501';
  END IF;

  -- Validação estrita dos parâmetros de entrada
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'Parâmetro p_key não pode ser vazio.' USING ERRCODE = '22023';
  END IF;
  IF p_max_requests <= 0 THEN
    RAISE EXCEPTION 'Parâmetro p_max_requests deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF p_window_ms <= 0 THEN
    RAISE EXCEPTION 'Parâmetro p_window_ms deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  -- Operação atômica UPSERT com cálculo de expiração da janela
  INSERT INTO internal.rate_limit_counters (key, tokens, window_start, updated_at)
  VALUES (p_key, 1, v_now, v_now)
  ON CONFLICT (key) DO UPDATE
  SET 
    tokens = CASE 
      WHEN EXTRACT(EPOCH FROM (v_now - rate_limit_counters.window_start)) * 1000 >= p_window_ms THEN 1
      ELSE rate_limit_counters.tokens + 1
    END,
    window_start = CASE 
      WHEN EXTRACT(EPOCH FROM (v_now - rate_limit_counters.window_start)) * 1000 >= p_window_ms THEN v_now
      ELSE rate_limit_counters.window_start
    END,
    updated_at = v_now
  RETURNING tokens, window_start INTO v_count, v_window_start;

  v_elapsed_ms := ROUND(EXTRACT(EPOCH FROM (v_now - v_window_start)) * 1000);

  IF v_count > p_max_requests THEN
    v_allowed := FALSE;
    v_retry_after := CEIL((p_window_ms - v_elapsed_ms)::NUMERIC / 1000);
    IF v_retry_after < 1 THEN
      v_retry_after := 1;
    END IF;
  ELSE
    v_allowed := TRUE;
    v_retry_after := 0;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'current', v_count,
    'limit', p_max_requests,
    'retry_after', v_retry_after,
    'remaining', GREATEST(0, p_max_requests - v_count)
  );
END;
$$;

-- Revogação e concessão explícita de permissões (Problema B resolvido)
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO service_role;

-- 13. RPC: Confirmação Atômica de Pagamento & Ativação de Assinatura
-- Executa as 12 etapas de validação transacional e ativação em internal.billing_subscriptions
CREATE OR REPLACE FUNCTION public.confirm_payment_and_activate_subscription_atomic(
  p_charge_id TEXT,
  p_event_id TEXT,
  p_expected_amount_cents INTEGER,
  p_expected_currency TEXT DEFAULT 'BRL',
  p_provider TEXT DEFAULT 'zynpay',
  p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = internal, public, pg_temp
AS $$
DECLARE
  v_charge RECORD;
  v_sub_updated_rows INTEGER := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- ETAPA 1: CONTROLE DE ACESSO MANDATÓRIO — Bloqueio de execução direta pelo frontend
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado: execução permitida exclusivamente pelo backend autorizado (service_role).'
      USING ERRCODE = '42501';
  END IF;

  -- ETAPA 2: Validação rigorosa dos parâmetros de entrada
  IF p_charge_id IS NULL OR length(trim(p_charge_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PARAM', 'error', 'ID da cobrança obrigatório.');
  END IF;
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PARAM', 'error', 'ID do evento obrigatório.');
  END IF;
  IF p_expected_amount_cents <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PARAM', 'error', 'Valor esperado deve ser maior que zero.');
  END IF;

  -- ETAPA 3: Idempotência estrita — Se o evento já foi concluído, retorna duplicado
  IF EXISTS (SELECT 1 FROM internal.billing_events WHERE id = p_event_id AND status = 'COMPLETED') THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'message', 'Evento já processado anteriormente (idempotência)'
    );
  END IF;

  -- ETAPA 4: Localiza e bloqueia a linha de cobrança para prevenir race conditions (SELECT ... FOR UPDATE)
  SELECT * INTO v_charge
  FROM internal.billing_payments
  WHERE id = p_charge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CHARGE_NOT_FOUND',
      'error', 'Cobrança não encontrada em internal.billing_payments.'
    );
  END IF;

  -- ETAPA 5: Validação de provedor
  IF COALESCE(v_charge.provider, 'zynpay') <> COALESCE(p_provider, 'zynpay') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'PROVIDER_MISMATCH',
      'error', 'Provedor divergente da cobrança registrada.'
    );
  END IF;

  -- ETAPA 6: Validação do status anterior
  IF v_charge.status = 'PAID' THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'message', 'Cobrança já estava confirmada anteriormente.'
    );
  END IF;

  IF v_charge.status NOT IN ('PENDING', 'PROCESSING') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_PREVIOUS_STATUS',
      'error', 'Cobrança em status inválido para liquidação: ' || v_charge.status
    );
  END IF;

  -- ETAPA 7: Validação estrita de valor (Anti-Tampering)
  IF v_charge.amount_cents <> p_expected_amount_cents THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'AMOUNT_MISMATCH',
      'error', format('Valor divergente: esperado %s centavos, recebido %s centavos.', v_charge.amount_cents, p_expected_amount_cents)
    );
  END IF;

  -- ETAPA 8: Validação estrita de moeda
  IF COALESCE(v_charge.currency, 'BRL') <> COALESCE(p_expected_currency, 'BRL') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CURRENCY_MISMATCH',
      'error', 'Moeda divergente da cobrança registrada.'
    );
  END IF;

  -- ETAPA 9: Registro do evento de webhook idempotente
  INSERT INTO internal.billing_events (
    id,
    provider,
    event_type,
    charge_id,
    amount_cents,
    raw_payload,
    status,
    created_at
  ) VALUES (
    p_event_id,
    p_provider,
    'charge.paid',
    p_charge_id,
    p_expected_amount_cents,
    p_raw_payload,
    'COMPLETED',
    v_now
  )
  ON CONFLICT (id) DO UPDATE
  SET 
    status = 'COMPLETED',
    processed_at = v_now,
    charge_id = p_charge_id,
    amount_cents = p_expected_amount_cents;

  -- ETAPA 10: Atualização do status da cobrança para PAID
  UPDATE internal.billing_payments
  SET 
    status = 'PAID',
    paid_at = v_now,
    updated_at = v_now
  WHERE id = p_charge_id;

  -- ETAPA 11: Ativação da assinatura Pro em internal.billing_subscriptions (NÃO altera public.profiles)
  IF v_charge.user_id IS NOT NULL THEN
    INSERT INTO internal.billing_subscriptions (
      user_id,
      user_email,
      plan_name,
      status,
      amount_cents,
      currency,
      current_period_start,
      current_period_end,
      gateway,
      updated_at
    ) VALUES (
      v_charge.user_id,
      v_charge.user_email,
      'FatosBR Pro',
      'ACTIVE',
      v_charge.amount_cents,
      v_charge.currency,
      v_now,
      v_now + INTERVAL '30 days',
      p_provider,
      v_now
    )
    ON CONFLICT (user_id) DO UPDATE
    SET 
      status = 'ACTIVE',
      plan_name = 'FatosBR Pro',
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      current_period_start = v_now,
      current_period_end = v_now + INTERVAL '30 days',
      gateway = EXCLUDED.gateway,
      updated_at = v_now;

    GET DIAGNOSTICS v_sub_updated_rows = ROW_COUNT;
  ELSE
    -- Se não houver user_id explícito na cobrança, resolve por email via auth.users
    INSERT INTO internal.billing_subscriptions (
      user_id,
      user_email,
      plan_name,
      status,
      amount_cents,
      currency,
      current_period_start,
      current_period_end,
      gateway,
      updated_at
    )
    SELECT 
      u.id,
      v_charge.user_email,
      'FatosBR Pro',
      'ACTIVE',
      v_charge.amount_cents,
      v_charge.currency,
      v_now,
      v_now + INTERVAL '30 days',
      p_provider,
      v_now
    FROM auth.users u
    WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(v_charge.user_email))
    LIMIT 1
    ON CONFLICT (user_id) DO UPDATE
    SET 
      status = 'ACTIVE',
      plan_name = 'FatosBR Pro',
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      current_period_start = v_now,
      current_period_end = v_now + INTERVAL '30 days',
      gateway = EXCLUDED.gateway,
      updated_at = v_now;

    GET DIAGNOSTICS v_sub_updated_rows = ROW_COUNT;
  END IF;

  -- ETAPA 12: Validação de atomicidade — Se a assinatura não pôde ser ativada, reverte toda a transação
  IF v_sub_updated_rows = 0 AND v_charge.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA_ATOMICIDADE: Não foi possível atualizar a assinatura em internal.billing_subscriptions.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'charge_id', p_charge_id,
    'user_email', v_charge.user_email,
    'amount_cents', p_expected_amount_cents,
    'paid_at', v_now
  );
END;
$$;

-- Revogação e concessão explícita de permissões (Problema B resolvido)
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;
