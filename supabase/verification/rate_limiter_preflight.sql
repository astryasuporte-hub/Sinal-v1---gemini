-- ==============================================================================
-- FATOSBR — SCRIPT DE PRÉ-VALIDAÇÃO (PREFLIGHT) — RATE LIMITER V1.7
-- ==============================================================================
-- Entregável 2: Auditoria exclusivamente de leitura (READ-ONLY) para execução
-- pelo ChatGPT conectado ao Supabase antes de aplicar a migração 20261110000002.
--
-- NÃO ALTERA NENHUM DADO. NÃO EXECUTA DDL.
-- Projeto Supabase: zopbitgtexefmqfvwgzj
-- ==============================================================================

SELECT '==================================================================' AS etapa,
       'INÍCIO DO DIAGNÓSTICO PREFLIGHT: RATE LIMITER' AS descricao;

-- 1. Verificar existência do schema 'internal'
SELECT 
  schema_name,
  schema_owner
FROM information_schema.schemata 
WHERE schema_name = 'internal';

-- 2. Verificar existência e estrutura da tabela 'internal.rate_limit_counters'
SELECT 
  table_schema,
  table_name,
  table_type
FROM information_schema.tables 
WHERE table_schema = 'internal' 
  AND table_name = 'rate_limit_counters';

-- 3. Inspecionar colunas e tipos de 'internal.rate_limit_counters'
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'internal' 
  AND table_name = 'rate_limit_counters'
ORDER BY ordinal_position;

-- 4. Inspecionar índices existentes na tabela 'internal.rate_limit_counters'
SELECT 
  indexname,
  indexdef
FROM pg_indexes 
WHERE schemaname = 'internal' 
  AND tablename = 'rate_limit_counters';

-- 5. Inspecionar se a função 'public.check_and_increment_rate_limit' já existe
SELECT 
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS return_type,
  p.prosecdef AS is_security_definer,
  p.proacl AS access_control_list
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'check_and_increment_rate_limit';

-- 6. Verificar concessões (grants) na tabela 'internal.rate_limit_counters'
SELECT 
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.table_privileges 
WHERE table_schema = 'internal' 
  AND table_name = 'rate_limit_counters'
ORDER BY grantee, privilege_type;

-- 7. Verificar se o papel dedicado 'fatosbr_backend' existe no cluster
SELECT 
  rolname,
  rolsuper,
  rolcreaterole,
  rolcanlogin,
  rolconnlimit
FROM pg_roles 
WHERE rolname IN ('postgres', 'service_role', 'anon', 'authenticated', 'fatosbr_backend');

-- 8. Verificar migrações já registradas no histórico do Supabase (se aplicável)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'supabase_migrations' 
      AND table_name = 'schema_migrations'
  ) THEN
    RAISE NOTICE 'Tabela supabase_migrations.schema_migrations encontrada. Consultando histórico recente...';
  END IF;
END $$;

SELECT * FROM supabase_migrations.schema_migrations 
ORDER BY version DESC 
LIMIT 10;
