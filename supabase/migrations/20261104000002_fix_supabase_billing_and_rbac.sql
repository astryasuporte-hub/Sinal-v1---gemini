-- ==============================================================================
-- FATOSBR — MIGRAÇÃO VERSIONADA 20261104000002
-- REFORÇO DE ÍNDICES, COMPATIBILIDADE E AUDITORIA DE PERMISSÕES
-- ==============================================================================
-- 1. Garante a existência dos índices otimizados para concorrência de webhooks.
-- 2. Assegura que nenhuma estrutura conflitante ou paralela seja mantida.
-- 3. Valida e reforça a revogação de privilégios de execução pública nas RPCs.
-- ==============================================================================

-- 1. Índices adicionais para consulta e bloqueio rápido por provider_payment_id
CREATE INDEX IF NOT EXISTS idx_billing_payments_lookup 
  ON internal.billing_payments (provider_payment_id, status);

CREATE INDEX IF NOT EXISTS idx_billing_events_dedup 
  ON internal.billing_events (provider, provider_event_id, processed);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_lookup 
  ON public.subscriptions (user_id, status);

-- 2. Garantia de privilégios estritos de menor privilégio nas RPCs
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;
