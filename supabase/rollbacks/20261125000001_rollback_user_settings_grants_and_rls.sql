-- ==============================================================================
-- FATOSBR V2.4.4 — ROLLBACK BASEADO NO BASELINE REAL DE PRODUÇÃO
-- ==============================================================================
-- Localização: `supabase/rollbacks/` (fora do diretório executável `supabase/migrations/`).
--
-- Baseline real auditado em produção antes da V2.4.4:
-- - `public.user_settings`: `authenticated` já possuía `SELECT`, porém NÃO possuía
--   `INSERT` nem `UPDATE`; existe a policy `account_controls_guard` e isolamento por usuário.
-- - `public.user_preferences`: `authenticated` JÁ possuía `SELECT, INSERT, UPDATE`
--   e policies ativas antes da V2.4.4 -> NÃO deve sofrer REVOKE no rollback.
-- - `public.notifications`: tabela e policies já existentes antes da V2.4.4 ->
--   NÃO deve sofrer REVOKE de `SELECT, UPDATE, DELETE` no rollback para evitar
--   regressões na caixa de notificações.
--
-- Garantias deste rollback:
-- 1. Reverte exclusivamente `INSERT, UPDATE` concedidos em `public.user_settings`
--    pela V2.4.4, restaurando o `SELECT` preexistente.
-- 2. Remove apenas eventuais policies de fallback `v2_4_4_*` criadas por esta
--    migração, preservando integralmente `account_controls_guard`, todas as
--    policies preexistentes, constraints, colunas e dados dos usuários.
-- ==============================================================================

DO $$
DECLARE
  v_has_authenticated BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF to_regclass('public.user_settings') IS NOT NULL THEN
    IF v_has_authenticated THEN
      EXECUTE 'REVOKE INSERT, UPDATE ON TABLE public.user_settings FROM authenticated';
    END IF;

    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_user_settings_select_own" ON public.user_settings';
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_user_settings_insert_own" ON public.user_settings';
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_user_settings_update_own" ON public.user_settings';
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_user_settings_service_role" ON public.user_settings';
  END IF;

  IF to_regclass('public.user_preferences') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_user_preferences_select_own" ON public.user_preferences';
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_user_preferences_insert_own" ON public.user_preferences';
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_user_preferences_update_own" ON public.user_preferences';
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_user_preferences_service_role" ON public.user_preferences';
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_notifications_select_own" ON public.notifications';
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_notifications_update_own" ON public.notifications';
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_notifications_delete_own" ON public.notifications';
    EXECUTE 'DROP POLICY IF EXISTS "v2_4_4_notifications_service_role" ON public.notifications';
  END IF;
END $$;
