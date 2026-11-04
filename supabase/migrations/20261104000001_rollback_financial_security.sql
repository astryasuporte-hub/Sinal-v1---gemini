-- ==============================================================================
-- FATOSBR — SCRIPT DE ROLLBACK PARA MIGRAÇÃO 20261104000001
-- ==============================================================================

DROP FUNCTION IF EXISTS public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT);

DROP TABLE IF EXISTS public.rate_limit_counters CASCADE;
DROP TABLE IF EXISTS public.webhook_events CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
