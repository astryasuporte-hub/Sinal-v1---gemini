-- ==============================================================================
-- FATOSBR — SCRIPT DE ROLLBACK PARA MIGRAÇÃO 20261104000001
-- ==============================================================================

-- 1. Remover RPCs expostas
DROP FUNCTION IF EXISTS public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT);
DROP FUNCTION IF EXISTS public.is_admin();

-- 2. Remover políticas de RLS adicionadas nesta versão
DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_service_role" ON public.user_roles;
DROP POLICY IF EXISTS "rate_limit_service_role" ON internal.rate_limit_counters;

-- 3. Limpeza de tabelas criadas especificamente por esta migração
DROP TABLE IF EXISTS internal.rate_limit_counters CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;

-- NOTA DE INTEGRIDADE: As tabelas "internal.billing_payments", "internal.billing_events"
-- e "public.subscriptions" são pré-existentes no Supabase do cliente e contêm dados
-- históricos de produção. Elas NÃO sofrem DROP neste script de rollback.
