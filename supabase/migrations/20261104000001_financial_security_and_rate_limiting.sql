-- ==============================================================================
-- FATOSBR — MIGRAÇÃO VERSIONADA 20261104000001
-- SEGURANÇA FINANCEIRA, TRANSAÇÕES ATÔMICAS E RATE LIMITING DISTRIBUÍDO
-- ==============================================================================

-- 1. Tabela de Cobranças Pix (Payments) com constraints de integridade
CREATE TABLE IF NOT EXISTS public.payments (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED')),
  provider TEXT NOT NULL DEFAULT 'zynpay',
  description TEXT,
  qr_code_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- 2. Tabela de Idempotência e Auditoria de Webhooks (Webhook Events)
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'zynpay',
  event_type TEXT NOT NULL,
  charge_id TEXT REFERENCES public.payments(id) ON DELETE SET NULL,
  amount_cents INTEGER,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED')),
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabela de Contadores de Rate Limiting Distribuído
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Índices para Otimização e Concorrência
CREATE INDEX IF NOT EXISTS idx_payments_user_email ON public.payments (user_email);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_charge_id ON public.webhook_events (charge_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON public.webhook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON public.rate_limit_counters (window_start);

-- 5. Row Level Security (RLS)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- Políticas para Payments:
-- Usuário autenticado pode ler apenas suas próprias cobranças
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
CREATE POLICY "payments_select_own" ON public.payments
  FOR SELECT USING (
    auth.uid() = user_id 
    OR LOWER(TRIM(user_email)) = LOWER(TRIM(auth.jwt() ->> 'email'))
    OR (auth.jwt() ->> 'email') = 'yleaopvpy01@gmail.com'
    OR (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
  );

-- Escrita restrita a service_role (backend)
DROP POLICY IF EXISTS "payments_backend_all" ON public.payments;
CREATE POLICY "payments_backend_all" ON public.payments
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Políticas para Webhook Events e Rate Limiter (Exclusivas do Backend/Service Role)
DROP POLICY IF EXISTS "webhook_events_service_role" ON public.webhook_events;
CREATE POLICY "webhook_events_service_role" ON public.webhook_events
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "rate_limit_counters_service_role" ON public.rate_limit_counters;
CREATE POLICY "rate_limit_counters_service_role" ON public.rate_limit_counters
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 6. RPC: Incremento Atômico de Rate Limiting com Bloqueio de Linha
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_ms BIGINT
)
RETURNS JSONB AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_elapsed_ms BIGINT;
  v_allowed BOOLEAN;
  v_retry_after INTEGER := 0;
BEGIN
  -- Operação atômica UPSERT com cálculo de expiração da janela
  INSERT INTO public.rate_limit_counters (key, tokens, window_start, updated_at)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RPC: Confirmação Atômica de Pagamento & Ativação de Assinatura
-- Executa todas as 7 etapas dentro de uma única transação garantida pelo PostgreSQL
CREATE OR REPLACE FUNCTION public.confirm_payment_and_activate_subscription_atomic(
  p_charge_id TEXT,
  p_event_id TEXT,
  p_expected_amount_cents INTEGER,
  p_expected_currency TEXT DEFAULT 'BRL',
  p_provider TEXT DEFAULT 'zynpay',
  p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_charge RECORD;
  v_user_email TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- 1. Idempotência estrita: se o evento já existe como concluído, retorna duplicado
  IF EXISTS (SELECT 1 FROM public.webhook_events WHERE id = p_event_id AND status = 'COMPLETED') THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'message', 'Evento já processado anteriormente (idempotência)'
    );
  END IF;

  -- 2. Localiza e trava a linha de cobrança para prevenir concorrência
  SELECT * INTO v_charge
  FROM public.payments
  WHERE id = p_charge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CHARGE_NOT_FOUND',
      'error', 'Cobrança não encontrada no banco de dados'
    );
  END IF;

  -- 3. Validação do status anterior
  IF v_charge.status = 'PAID' THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'message', 'Cobrança já estava confirmada anteriormente'
    );
  END IF;

  IF v_charge.status NOT IN ('PENDING', 'PROCESSING') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_PREVIOUS_STATUS',
      'error', 'Cobrança em status inválido para confirmação: ' || v_charge.status
    );
  END IF;

  -- 4. Validação estrita de valor e moeda
  IF v_charge.amount_cents <> p_expected_amount_cents THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'AMOUNT_MISMATCH',
      'error', format('Valor divergente: esperado %s centavos, recebido %s centavos', v_charge.amount_cents, p_expected_amount_cents)
    );
  END IF;

  IF COALESCE(v_charge.currency, 'BRL') <> COALESCE(p_expected_currency, 'BRL') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CURRENCY_MISMATCH',
      'error', 'Moeda divergente da cobrança'
    );
  END IF;

  -- 5. Registrar evento de webhook idempotente
  INSERT INTO public.webhook_events (
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

  -- 6. Atualizar a cobrança para PAID
  UPDATE public.payments
  SET 
    status = 'PAID',
    paid_at = v_now,
    updated_at = v_now
  WHERE id = p_charge_id;

  -- 7. Ativar a assinatura Pro do usuário associado
  v_user_email := LOWER(TRIM(v_charge.user_email));

  IF v_charge.user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET 
      plan_name = 'FatosBR Pro',
      subscription_status = 'ACTIVE',
      updated_at = v_now
    WHERE id = v_charge.user_id;
  ELSIF v_user_email IS NOT NULL AND v_user_email <> '' THEN
    UPDATE public.profiles
    SET 
      plan_name = 'FatosBR Pro',
      subscription_status = 'ACTIVE',
      updated_at = v_now
    WHERE LOWER(TRIM(email)) = v_user_email;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'charge_id', p_charge_id,
    'user_email', v_user_email,
    'amount_cents', p_expected_amount_cents,
    'paid_at', v_now
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
