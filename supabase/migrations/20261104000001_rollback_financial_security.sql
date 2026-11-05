-- ==============================================================================
-- FATOSBR — SCRIPT DE ROLLBACK PARA MIGRAÇÃO 20261104000001
-- ==============================================================================

-- 1. Remover RPCs e Views expostas
DROP FUNCTION IF EXISTS public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT);
DROP VIEW IF EXISTS public.user_subscriptions CASCADE;
DROP FUNCTION IF EXISTS public.is_admin();

-- 2. Remover políticas de RLS das tabelas
DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_service_role" ON public.user_roles;
DROP POLICY IF EXISTS "billing_payments_select_own" ON internal.billing_payments;
DROP POLICY IF EXISTS "billing_payments_service_role" ON internal.billing_payments;
DROP POLICY IF EXISTS "billing_subscriptions_select_own" ON internal.billing_subscriptions;
DROP POLICY IF EXISTS "billing_subscriptions_service_role" ON internal.billing_subscriptions;
DROP POLICY IF EXISTS "billing_events_service_role" ON internal.billing_events;
DROP POLICY IF EXISTS "rate_limit_service_role" ON internal.rate_limit_counters;

-- 3. Limpeza de estruturas criadas especificamente nesta versão (não destrutivo para billing_payments/events)
DROP TABLE IF EXISTS internal.rate_limit_counters CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
-- NOTA: internal.billing_payments, internal.billing_events e internal.billing_subscriptions
-- contêm registros financeiros e histórico de assinaturas; NÃO são removidas automaticamente
-- por segurança contra perda de dados.
