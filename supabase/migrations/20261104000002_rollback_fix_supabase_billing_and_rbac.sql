-- ==============================================================================
-- FATOSBR — SCRIPT DE ROLLBACK PARA MIGRAÇÃO 20261104000002
-- ==============================================================================

DROP INDEX IF EXISTS internal.idx_billing_payments_lookup;
DROP INDEX IF EXISTS internal.idx_billing_events_dedup;
DROP INDEX IF EXISTS public.idx_subscriptions_user_lookup;
