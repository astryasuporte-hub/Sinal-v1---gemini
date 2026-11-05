-- ==============================================================================
-- FATOSBR — MIGRAÇÃO VERSIONADA 20261104000001 (COMPATIBILIDADE SCHEMA REAL)
-- INTEGRAÇÃO FINANCEIRA: internal.billing_payments, internal.billing_events E public.subscriptions
-- ==============================================================================
-- 1. Assegura a compatibilidade estrita com o banco PostgreSQL real do Supabase:
--    - internal.billing_payments: id UUID, provider_payment_id TEXT, amount INTEGER
--    - internal.billing_events: id UUID, provider_event_id TEXT, payload JSONB, processed BOOLEAN
--    - public.subscriptions: id UUID, user_id UUID, plan TEXT, status TEXT (FONTE CANÔNICA PRO)
-- 2. NÃO cria internal.billing_subscriptions (evita fonte paralela de assinaturas).
-- 3. NÃO insere colunas artificiais (user_email, amount_cents) em billing_payments.
-- 4. NÃO altera public.profiles.
-- 5. Rate limiting distribuído em internal.rate_limit_counters.
-- 6. RBAC administrativo em public.user_roles e função public.is_admin().
-- 7. RPCs privilegiadas com SECURITY DEFINER, search_path seguro e acesso exclusivo service_role.
-- ==============================================================================

-- 1. Garantir existência do schema internal
CREATE SCHEMA IF NOT EXISTS internal;

-- 2. Tabela de Contadores de Rate Limiting Distribuído
CREATE TABLE IF NOT EXISTS internal.rate_limit_counters (
  key TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabela de RBAC Administrativo (Preserva os papéis do SaaS)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'editor', 'support', 'viewer', 'subscriber')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, role)
);

-- 4. Índices de Performance e Concorrência
CREATE INDEX IF NOT EXISTS idx_billing_payments_provider_payment_id 
  ON internal.billing_payments (provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_user_id 
  ON internal.billing_payments (user_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_status 
  ON internal.billing_payments (status);
CREATE INDEX IF NOT EXISTS idx_billing_events_provider_event 
  ON internal.billing_events (provider, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status 
  ON public.subscriptions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window 
  ON internal.rate_limit_counters (window_start);
CREATE INDEX IF NOT EXISTS idx_user_roles_user 
  ON public.user_roles (user_id);

-- 5. Função de Autorização RBAC (public.is_admin)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Acesso do backend service_role
  IF auth.role() = 'service_role' THEN
    RETURN TRUE;
  END IF;

  -- 2. JWT claims assinadas no app_metadata do Supabase Auth
  IF (auth.jwt() -> 'app_metadata' ->> 'is_admin')::BOOLEAN IS TRUE 
     OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'super_admin') THEN
    RETURN TRUE;
  END IF;

  -- 3. Consulta de privilégios na tabela public.user_roles
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

-- 6. Habilitar RLS nas tabelas gerenciadas
ALTER TABLE internal.rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Políticas para public.user_roles
DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
CREATE POLICY "user_roles_select_own" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin() = TRUE);

DROP POLICY IF EXISTS "user_roles_service_role" ON public.user_roles;
CREATE POLICY "user_roles_service_role" ON public.user_roles
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Políticas para internal.rate_limit_counters
DROP POLICY IF EXISTS "rate_limit_service_role" ON internal.rate_limit_counters;
CREATE POLICY "rate_limit_service_role" ON internal.rate_limit_counters
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 7. RPC: Rate Limiting Distribuído com Menor Privilégio
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

-- Permissões estritas da RPC de rate limiting
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO service_role, postgres;

-- 8. RPC: Confirmação Financeira Atômica & Ativação de Assinatura (Schema Real)
-- Integra: internal.billing_payments, internal.billing_events e public.subscriptions
CREATE OR REPLACE FUNCTION public.confirm_payment_and_activate_subscription_atomic(
  p_provider_payment_id TEXT,
  p_event_id TEXT,
  p_expected_amount INTEGER,
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
  v_user_id UUID;
  v_sub_updated_rows INTEGER := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- ETAPA 1: CONTROLE DE ACESSO MANDATÓRIO — Bloqueio estrito de execução direta pelo cliente
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin', 'fatosbr_backend') AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita ao backend financeiro autorizado'
      USING ERRCODE = '42501';
  END IF;

  -- ETAPA 2: Validação rigorosa dos parâmetros
  IF p_provider_payment_id IS NULL OR length(trim(p_provider_payment_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PARAM', 'error', 'Identificador de pagamento obrigatório.');
  END IF;
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PARAM', 'error', 'Identificador de evento obrigatório.');
  END IF;
  IF p_expected_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PARAM', 'error', 'Valor esperado deve ser maior que zero.');
  END IF;

  -- ETAPA 3: Idempotência do evento em internal.billing_events
  IF EXISTS (
    SELECT 1 FROM internal.billing_events 
    WHERE provider = p_provider 
      AND provider_event_id = p_event_id 
      AND processed = TRUE
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'message', 'Evento já processado anteriormente (idempotência)'
    );
  END IF;

  -- ETAPA 4: Bloqueia o registro do pagamento (SELECT ... FOR UPDATE)
  -- Suporta busca por provider_payment_id ou por id UUID interno
  SELECT * INTO v_charge
  FROM internal.billing_payments
  WHERE provider_payment_id = p_provider_payment_id
     OR (p_provider_payment_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND id = p_provider_payment_id::UUID)
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CHARGE_NOT_FOUND',
      'error', 'Cobrança não encontrada em internal.billing_payments.'
    );
  END IF;

  -- ETAPA 5: Resolver usuário vinculado à cobrança
  v_user_id := v_charge.user_id;
  IF v_user_id IS NULL AND v_charge.checkout_data ? 'user_email' THEN
    SELECT u.id INTO v_user_id
    FROM auth.users u
    WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(v_charge.checkout_data ->> 'user_email'))
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'USER_NOT_FOUND',
      'error', 'Cobrança não está vinculada a um usuário válido do sistema.'
    );
  END IF;

  -- ETAPA 6: Validação de provedor
  IF COALESCE(v_charge.provider, 'zynpay') <> COALESCE(p_provider, 'zynpay') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'PROVIDER_MISMATCH',
      'error', 'Provedor divergente da cobrança registrada.'
    );
  END IF;

  -- ETAPA 7: Validação do status anterior
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

  -- ETAPA 8: Validação estrita de valor (Anti-Tampering)
  IF v_charge.amount <> p_expected_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'AMOUNT_MISMATCH',
      'error', format('Valor divergente: esperado %s centavos, recebido %s centavos.', v_charge.amount, p_expected_amount)
    );
  END IF;

  -- ETAPA 9: Validação estrita de moeda
  IF COALESCE(v_charge.currency, 'BRL') <> COALESCE(p_expected_currency, 'BRL') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CURRENCY_MISMATCH',
      'error', 'Moeda divergente da cobrança registrada.'
    );
  END IF;

  -- ETAPA 10: Registrar evento financeiro em internal.billing_events
  INSERT INTO internal.billing_events (
    id,
    provider,
    provider_event_id,
    event_type,
    payload,
    processed,
    processed_at,
    context,
    context_id,
    created_at
  ) VALUES (
    gen_random_uuid(),
    p_provider,
    p_event_id,
    'charge.paid',
    p_raw_payload,
    TRUE,
    v_now,
    'payment',
    v_charge.id::TEXT,
    v_now
  );

  -- ETAPA 11: Atualizar pagamento para status PAID em internal.billing_payments
  UPDATE internal.billing_payments
  SET 
    status = 'PAID',
    approved_at = v_now,
    last_synced_at = v_now,
    updated_at = v_now
  WHERE id = v_charge.id;

  -- ETAPA 12: Atualizar ou Inserir Assinatura na Tabela Canônica (public.subscriptions)
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = v_user_id) THEN
    UPDATE public.subscriptions
    SET 
      plan = 'pro',
      status = 'active',
      current_period_start = v_now,
      current_period_end = v_now + INTERVAL '30 days',
      cancel_at_period_end = FALSE,
      provider = p_provider,
      provider_subscription_id = COALESCE(v_charge.provider_payment_id, p_provider_payment_id),
      billing_updated_at = v_now,
      updated_at = v_now
    WHERE user_id = v_user_id;

    GET DIAGNOSTICS v_sub_updated_rows = ROW_COUNT;
  ELSE
    INSERT INTO public.subscriptions (
      id,
      user_id,
      plan,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      provider,
      provider_subscription_id,
      billing_updated_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      'pro',
      'active',
      v_now,
      v_now + INTERVAL '30 days',
      FALSE,
      p_provider,
      COALESCE(v_charge.provider_payment_id, p_provider_payment_id),
      v_now,
      v_now,
      v_now
    );

    GET DIAGNOSTICS v_sub_updated_rows = ROW_COUNT;
  END IF;

  -- ETAPA 13: Validação de atomicidade — Rollback se a assinatura não foi ativada
  IF v_sub_updated_rows = 0 THEN
    RAISE EXCEPTION 'FALHA_ATOMICIDADE: Não foi possível atualizar a assinatura do usuário em public.subscriptions.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'charge_id', v_charge.id,
    'provider_payment_id', COALESCE(v_charge.provider_payment_id, p_provider_payment_id),
    'user_id', v_user_id,
    'amount', v_charge.amount,
    'approved_at', v_now
  );
END;
$$;

-- Permissões estritas da RPC de confirmação financeira
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role, postgres;

-- 8. Concessão de menor privilégio para conexões PostgreSQL server-side
GRANT USAGE ON SCHEMA internal TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE ON TABLE internal.billing_payments TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE ON TABLE internal.billing_events TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE ON TABLE public.subscriptions TO service_role, postgres;
GRANT SELECT ON TABLE public.user_roles TO service_role, postgres;

-- 9. Concessão condicional segura para papel dedicado (caso provisionado pelo DBA)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fatosbr_backend') THEN
    GRANT USAGE ON SCHEMA internal TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE ON TABLE internal.billing_payments TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE ON TABLE internal.billing_events TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.subscriptions TO fatosbr_backend;
    GRANT SELECT ON TABLE public.user_roles TO fatosbr_backend;
    GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO fatosbr_backend;
    GRANT EXECUTE ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) TO fatosbr_backend;
  END IF;
END $$;
