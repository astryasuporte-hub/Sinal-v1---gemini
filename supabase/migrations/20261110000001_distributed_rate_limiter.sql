-- ==============================================================================
-- FATOSBR — MIGRAÇÃO VERSIONADA 20261110000001
-- RATE LIMITING DISTRIBUÍDO E ATÔMICO COM REFORÇO DE CONCORRÊNCIA E TIPOS (V1.6)
-- ==============================================================================
-- 1. Garante a existência do schema 'internal' e da tabela 'internal.rate_limit_counters'.
-- 2. Implementa a função canônica 'public.check_and_increment_rate_limit' com:
--    - Assinatura estrita: (p_key TEXT, p_max_requests INTEGER, p_window_ms BIGINT)
--    - Overloads compatíveis: (TEXT, INTEGER, INTEGER) e (TEXT, BIGINT, BIGINT) para
--      eliminar o erro "function public.check_and_increment_rate_limit(unknown, unknown, unknown) does not exist".
--    - Operação UPSERT atômica com reset automático ao expirar a janela temporal.
--    - Limpeza periódica de contadores obsoletos.
--    - Suporte a conexões diretas ('postgres', 'postgres.%', 'service_role').
--    - SECURITY DEFINER com search_path imutável 'internal, public, pg_temp'.
--    - Revogação de acesso de 'PUBLIC' e 'anon'.
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

-- 4. Função Canônica Principal: (TEXT, INTEGER, BIGINT)
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
  v_tokens INTEGER;
  v_elapsed_ms BIGINT;
  v_allowed BOOLEAN;
  v_retry_after INTEGER := 0;
  v_user TEXT := current_user;
BEGIN
  -- CONTROLE DE ACESSO: Valida papel autorizado no PostgreSQL
  -- Aceita 'service_role', 'postgres', qualquer usuário do Supavisor pooler ('postgres.project_ref'),
  -- e checa auth.role() caso invocado via PostgREST
  IF v_user NOT IN ('service_role', 'postgres', 'supabase_admin') 
     AND v_user NOT LIKE 'postgres.%' 
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita ao backend autorizado.'
      USING ERRCODE = '42501';
  END IF;

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

  -- Limpeza oportunista probabilística (1% das requisições) de registros expirados há mais de 1 hora
  IF random() < 0.01 THEN
    DELETE FROM internal.rate_limit_counters 
    WHERE window_start < (v_now - INTERVAL '1 hour');
  END IF;

  -- Operação atômica UPSERT com cálculo de expiração da janela (protege contra race condition)
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

-- 5. Overload para compatibilidade com assinaturas INTEGER (TEXT, INTEGER, INTEGER)
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_ms INTEGER
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = internal, public, pg_temp
AS $$
  SELECT public.check_and_increment_rate_limit(p_key, p_max_requests, p_window_ms::BIGINT);
$$;

-- 6. Overload para compatibilidade com assinaturas BIGINT (TEXT, BIGINT, BIGINT)
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key TEXT,
  p_max_requests BIGINT,
  p_window_ms BIGINT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = internal, public, pg_temp
AS $$
  SELECT public.check_and_increment_rate_limit(p_key, p_max_requests::INTEGER, p_window_ms);
$$;

-- 7. Permissões de Menor Privilégio
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, INTEGER) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, BIGINT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, BIGINT, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, BIGINT, BIGINT) TO service_role, postgres;

GRANT USAGE ON SCHEMA internal TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO service_role, postgres;

-- 8. Concessão condicional para papel fatosbr_backend se existente
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fatosbr_backend') THEN
    GRANT USAGE ON SCHEMA internal TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO fatosbr_backend;
    GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO fatosbr_backend;
    GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, INTEGER) TO fatosbr_backend;
    GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, BIGINT, BIGINT) TO fatosbr_backend;
  END IF;
END $$;
