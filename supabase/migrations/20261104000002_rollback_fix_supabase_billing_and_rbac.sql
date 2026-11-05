-- ==============================================================================
-- FATOSBR — SCRIPT DE ROLLBACK PARA MIGRAÇÃO 20261104000002
-- ==============================================================================

-- 1. Remover RPCs e Views
DROP FUNCTION IF EXISTS public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT);
DROP VIEW IF EXISTS public.user_subscriptions;
DROP FUNCTION IF EXISTS public.is_admin();

-- 2. Limpeza segura de tabelas adicionadas (sem DROP TABLE CASCADE em tabelas pré-existentes do projeto)
DROP TABLE IF EXISTS public.user_roles;
DROP TABLE IF EXISTS internal.rate_limit_counters;
-- Não executamos DROP em internal.billing_payments ou internal.billing_events para não apagar dados pré-existentes do projeto.
