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
GRANT EXECUTE ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role, postgres;

-- 3. Concessão de menor privilégio para o schema internal e tabelas para acesso PostgreSQL direto
GRANT USAGE ON SCHEMA internal TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE ON TABLE internal.billing_payments TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE ON TABLE internal.billing_events TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE ON TABLE public.subscriptions TO service_role, postgres;
GRANT SELECT ON TABLE public.user_roles TO service_role, postgres;

-- 4. Concessão condicional segura para papel dedicado (caso provisionado pelo DBA)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fatosbr_backend') THEN
    GRANT USAGE ON SCHEMA internal TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE ON TABLE internal.billing_payments TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE ON TABLE internal.billing_events TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE internal.rate_limit_counters TO fatosbr_backend;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.subscriptions TO fatosbr_backend;
    GRANT SELECT ON TABLE public.user_roles TO fatosbr_backend;
    GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO fatosbr_backend;
    GRANT EXECUTE ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) TO fatosbr_backend;
  END IF;
END $$;
