-- ==============================================================================
-- FATOSBR — SCRIPT DE PROVISIONAMENTO DO PAPEL DEDICADO DO BACKEND (DBA)
-- ==============================================================================
-- Este script é destinado à revisão e execução pelo DBA no Supabase (zopbitgtexefmqfvwgzj).
-- Cria o papel de menor privilégio 'fatosbr_backend' para conexão direta da Vercel.
-- 
-- Princípio do Menor Privilégio:
-- - Sem privilégios de superusuário ou DDL destrutivo (sem DROP TABLE, etc.).
-- - Concede apenas SELECT, INSERT, UPDATE nas tabelas estritamente necessárias.
-- - Bloqueia acesso a tabelas que não fazem parte do escopo financeiro/auth.
-- ==============================================================================

-- 1. Criação condicional do papel com LOGIN e sem herança excessiva
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fatosbr_backend') THEN
    CREATE ROLE fatosbr_backend WITH 
      LOGIN 
      NOSUPERUSER 
      NOCREATEDB 
      NOCREATEROLE 
      NOINHERIT 
      CONNECTION LIMIT 25;
    
    COMMENT ON ROLE fatosbr_backend IS 'Papel dedicado de menor privilégio para as Vercel Functions da FatosBR';
    
    -- Definir senha segura conforme gerada pelo DBA / Vault de credenciais:
    -- ALTER ROLE fatosbr_backend WITH PASSWORD 'DEFINIR_SENHA_FORTE_NO_VAULT';
  END IF;
END $$;

-- 2. Permissão de resolução de schema (USO)
GRANT USAGE ON SCHEMA internal TO fatosbr_backend;
GRANT USAGE ON SCHEMA public TO fatosbr_backend;

-- 3. Permissões estritas de DML nas tabelas do schema internal
-- Registro e consulta de cobranças e eventos, manipulação de contadores de rate limit
GRANT SELECT, INSERT, UPDATE ON TABLE internal.billing_payments TO fatosbr_backend;
GRANT SELECT, INSERT, UPDATE ON TABLE internal.billing_events TO fatosbr_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO fatosbr_backend;

-- 4. Permissões estritas no schema public
-- Consulta e atualização atômica de assinaturas e verificação RBAC
GRANT SELECT, INSERT, UPDATE ON TABLE public.subscriptions TO fatosbr_backend;
GRANT SELECT ON TABLE public.user_roles TO fatosbr_backend;

-- 5. Permissão de execução exclusiva nas RPCs autorizadas
GRANT EXECUTE ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) TO fatosbr_backend;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO fatosbr_backend;
GRANT EXECUTE ON FUNCTION public.is_admin() TO fatosbr_backend;

-- 6. Garantir busca segura de schemas por padrão
ALTER ROLE fatosbr_backend SET search_path = internal, public, pg_temp;
