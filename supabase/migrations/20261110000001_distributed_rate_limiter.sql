-- ==============================================================================
-- FATOSBR — MIGRAÇÃO VERSIONADA HISTÓRICA 20261110000001
-- (SUBSTITUÍDA FORMALMENTE PELA CANÔNICA REAL APLICADA 20261110225054_fix_distributed_rate_limiter_v1_7)
-- ==============================================================================
-- NOTA DE SINCRONIZAÇÃO V1.9:
-- A versão canônica oficial e ativa em produção no Supabase é a '20261110225054_fix_distributed_rate_limiter_v1_7'.
-- Esta migração histórica inicial foi formalmente substituída e preservada apenas para rastreabilidade de histórico.
-- ==============================================================================

-- 1. Schema internal
CREATE SCHEMA IF NOT EXISTS internal;

-- 2. Tabela de Contadores Persistentes
CREATE TABLE IF NOT EXISTS internal.rate_limit_counters (
  key TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 3. Índices de Performance e Expiração
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window_start 
  ON internal.rate_limit_counters (window_start);

CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_updated_at 
  ON internal.rate_limit_counters (updated_at);

-- 4. Função Inicial de Rate Limiting (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_ms BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_window_start TIMESTAMPTZ;
  v_tokens INTEGER;
  v_elapsed_ms BIGINT;
  v_allowed BOOLEAN;
  v_retry_after INTEGER := 0;
BEGIN
  -- Validação defensiva de parâmetros
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_PARAM: p_key não pode ser vazio.' 
      USING ERRCODE = '22023';
  END IF;
  IF p_max_requests <= 0 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_PARAM: p_max_requests deve ser positivo (> 0).' 
      USING ERRCODE = '22023';
  END IF;
  IF p_window_ms <= 0 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_PARAM: p_window_ms deve ser positivo (> 0).' 
      USING ERRCODE = '22023';
  END IF;

  -- Operação atômica UPSERT com cálculo de expiração da janela (protege contra race condition)
  INSERT INTO internal.rate_limit_counters (key, tokens, window_start, updated_at)
  VALUES (p_key, 1, v_now, v_now)
  ON CONFLICT (key) DO UPDATE
  SET 
    tokens = CASE 
      WHEN EXTRACT(EPOCH FROM (v_now - internal.rate_limit_counters.window_start)) * 1000 >= p_window_ms THEN 1
      ELSE internal.rate_limit_counters.tokens + 1
    END,
    window_start = CASE 
      WHEN EXTRACT(EPOCH FROM (v_now - internal.rate_limit_counters.window_start)) * 1000 >= p_window_ms THEN v_now
      ELSE internal.rate_limit_counters.window_start
    END,
    updated_at = v_now
  RETURNING tokens, window_start INTO v_tokens, v_window_start;

  -- Tempo decorrido em milissegundos
  v_elapsed_ms := ROUND(EXTRACT(EPOCH FROM (v_now - v_window_start)) * 1000);

  IF v_tokens > p_max_requests THEN
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
    'current', v_tokens,
    'limit', p_max_requests,
    'retry_after', v_retry_after,
    'remaining', GREATEST(0, p_max_requests - v_tokens)
  );
END;
$$;

-- 5. Permissões de Menor Privilégio Rigoroso (DCL)
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO service_role, postgres;

GRANT USAGE ON SCHEMA internal TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO service_role, postgres;

-- 6. Concessão condicional para papel fatosbr_backend se existente
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fatosbr_backend') THEN
    GRANT USAGE ON SCHEMA internal TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO fatosbr_backend;
    GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO fatosbr_backend;
  END IF;
END $$;
