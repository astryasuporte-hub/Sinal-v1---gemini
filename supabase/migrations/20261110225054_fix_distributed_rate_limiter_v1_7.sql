-- ==============================================================================
-- FATOSBR — MIGRAÇÃO VERSIONADA OFICIAL CANÔNICA (SUPABASE)
-- 20261110225054_fix_distributed_rate_limiter_v1_7.sql
-- ==============================================================================
-- Este arquivo representa o estado real, seguro e validado aplicado pelo ChatGPT
-- diretamente no projeto Supabase "zopbitgtexefmqfvwgzj".
--
-- Características Arquiteturais de Produção:
-- 1. Schema isolado 'internal' e tabela 'internal.rate_limit_counters'.
-- 2. Row Level Security (RLS) habilitada com bloqueio universal de anon/authenticated.
-- 3. Função 'public.check_and_increment_rate_limit(p_key text, p_max_requests integer, p_window_ms bigint)' com SECURITY INVOKER.
-- 4. search_path = pg_catalog, pg_temp estrito prevenindo search-path hijacking.
-- 5. Validação defensiva rigorosa com SQLSTATE 22023 (1..512 chars, 1..1M reqs, 1..86.4M ms).
-- 6. Sem limpeza probabilística durante chamadas para evitar deadlocks/latência.
-- 7. Modelo de Menor Privilégio via DCL: EXECUTE restrito a service_role e postgres.
-- 8. Atomicidade e idempotência testadas e aprovadas em produção.
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

-- 3. Habilitação de RLS (Segurança em Nível de Linha)
ALTER TABLE internal.rate_limit_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_limit_counters_service_role" ON internal.rate_limit_counters;
CREATE POLICY "rate_limit_counters_service_role" ON internal.rate_limit_counters
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Índices de Performance e Expiração
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window_start 
  ON internal.rate_limit_counters (window_start);

CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_updated_at 
  ON internal.rate_limit_counters (updated_at);

-- 5. Eliminação de Overloads Legados Potencialmente Inseguros ou Ambíguos
DROP FUNCTION IF EXISTS public.check_and_increment_rate_limit(TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.check_and_increment_rate_limit(TEXT, BIGINT, BIGINT);

-- 6. Função Canônica Principal de Rate Limiting (SECURITY INVOKER)
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
  -- 1. Validação defensiva rigorosa de parâmetros (Fail-Closed com SQLSTATE 22023)
  IF p_key IS NULL OR length(trim(p_key)) < 1 OR length(trim(p_key)) > 512 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_PARAM: p_key deve ter entre 1 e 512 caracteres.' 
      USING ERRCODE = '22023';
  END IF;
  IF p_max_requests IS NULL OR p_max_requests < 1 OR p_max_requests > 1000000 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_PARAM: p_max_requests deve estar entre 1 e 1.000.000.' 
      USING ERRCODE = '22023';
  END IF;
  IF p_window_ms IS NULL OR p_window_ms < 1 OR p_window_ms > 86400000 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_PARAM: p_window_ms deve estar entre 1 e 86.400.000 (1 dia).' 
      USING ERRCODE = '22023';
  END IF;

  -- 2. Operação Atômica UPSERT com cálculo de expiração da janela (protege contra race condition)
  -- Nota de Produção: Sem limpeza probabilística durante chamadas de alta taxa para evitar contenção de locks.
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

  -- 3. Cálculo de tempo decorrido e bloqueio
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

  -- 4. Retorno JSONB no contrato esperado pelo SaaS FatosBR
  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'current', v_tokens,
    'limit', p_max_requests,
    'retry_after', v_retry_after,
    'remaining', GREATEST(0, p_max_requests - v_tokens)
  );
END;
$$;

-- 6. Comentário Canônico
COMMENT ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) IS 
  'FatosBR: Rate Limiter atômico distribuído com SECURITY INVOKER e menor privilégio (Migração Canônica Oficial 20261110225054).';

-- 7. Modelo de Menor Privilégio Rigoroso (DCL)
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO service_role, postgres;

GRANT USAGE ON SCHEMA internal TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO service_role, postgres;

-- 8. Concessão condicional para papel fatosbr_backend se existente
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fatosbr_backend') THEN
    GRANT USAGE ON SCHEMA internal TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO fatosbr_backend;
    GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO fatosbr_backend;
  END IF;
END $$;
