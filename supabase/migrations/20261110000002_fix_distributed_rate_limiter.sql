-- ==============================================================================
-- FATOSBR — MIGRAÇÃO VERSIONADA 20261110000002
-- CORREÇÃO DEFINITIVA DO RATE LIMITER DISTRIBUÍDO E MODELO DE SEGURANÇA (V1.7)
-- ==============================================================================
-- Entregável 1: Migração SQL para aplicação assistida pelo DBA / ChatGPT no Supabase
-- Projeto Supabase: zopbitgtexefmqfvwgzj
--
-- Objetivos da Migração:
-- 1. Assegurar a existência do schema 'internal' e da tabela 'internal.rate_limit_counters'.
-- 2. Provisionar índices otimizados para concorrência de alta taxa.
-- 3. Criar a função canônica 'public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT)'.
-- 4. Estabelecer o Modelo de Menor Privilégio rigoroso via DCL (REVOKE de PUBLIC/anon/authenticated).
-- 5. Eliminar checagens frágeis de 'current_user' em função SECURITY DEFINER.
-- 6. Garantir retorno compatível com o contrato JSONB do SaaS FatosBR.
-- ==============================================================================

-- ETAPA 1: Garantir Schema de Armazenamento Isolado
CREATE SCHEMA IF NOT EXISTS internal;

-- ETAPA 2: Tabela de Contadores Persistentes (Não-destrutiva)
CREATE TABLE IF NOT EXISTS internal.rate_limit_counters (
  key TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- ETAPA 3: Índices de Performance e Expiração
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window_start 
  ON internal.rate_limit_counters (window_start);

CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_updated_at 
  ON internal.rate_limit_counters (updated_at);

-- ETAPA 4: Função Canônica Principal de Rate Limiting
-- Assinatura única canônica requerida pelo backend: (TEXT, INTEGER, BIGINT)
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
BEGIN
  -- 1. Validação defensiva de parâmetros de entrada
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_PARAM: p_key não pode ser vazio ou nulo.' 
      USING ERRCODE = '22023';
  END IF;
  IF p_max_requests <= 0 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_PARAM: p_max_requests deve ser estritamente positivo (> 0).' 
      USING ERRCODE = '22023';
  END IF;
  IF p_window_ms <= 0 THEN
    RAISE EXCEPTION 'RATE_LIMIT_INVALID_PARAM: p_window_ms deve ser estritamente positivo (> 0).' 
      USING ERRCODE = '22023';
  END IF;

  -- 2. Limpeza oportunista probabilística (1% das requisições) de contadores expirados há mais de 1 hora
  -- Mantém a tabela leve sem necessidade de cron dedicado de limpeza
  IF random() < 0.01 THEN
    DELETE FROM internal.rate_limit_counters 
    WHERE window_start < (v_now - INTERVAL '1 hour');
  END IF;

  -- 3. Operação Atômica UPSERT com cálculo de expiração da janela temporal
  -- Proteção intrínseca contra condições de corrida entre instâncias serverless Vercel
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

  -- 4. Cálculo de tempo decorrido e bloqueio
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

  -- 5. Retorno JSONB no contrato formal esperado pelo SaaS
  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'current', v_tokens,
    'limit', p_max_requests,
    'retry_after', v_retry_after,
    'remaining', GREATEST(0, p_max_requests - v_tokens)
  );
END;
$$;

-- ETAPA 5: Comentário de Metadados
COMMENT ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) IS 
  'FatosBR V1.7: Rate Limiter atômico distribuído com menor privilégio e isolamento.';

-- ETAPA 6: Modelo de Menor Privilégio Rigoroso (DCL)
-- Revogação universal de acesso público ou não autenticado
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM authenticated;

-- Concessão explícita exclusiva para papéis do backend
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO service_role, postgres;

-- Concessão de uso do schema e DML na tabela de contadores
GRANT USAGE ON SCHEMA internal TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO service_role, postgres;

-- ETAPA 7: Concessão Condicional para Papel Dedicado (se provisionado)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fatosbr_backend') THEN
    GRANT USAGE ON SCHEMA internal TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO fatosbr_backend;
    GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO fatosbr_backend;
  END IF;
END $$;
