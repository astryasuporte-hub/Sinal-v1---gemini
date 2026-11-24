-- ==============================================================================
-- FATOSBR V2.4.4 — ROLLBACK NÃO DESTRUTIVO (GRANTS / POLICIES V2.4.4)
-- ==============================================================================
-- ATENÇÃO: Este script apenas reverte políticas explícitas para o formato
-- anterior (V2.3.1) sem apagar tabelas, colunas ou dados de usuários.
-- Não revogue SELECT/INSERT/UPDATE de `authenticated` em produção se o erro
-- `permission denied for table user_settings` (42501) depender desses GRANTs.
-- ==============================================================================

DO $$
DECLARE
  v_has_authenticated BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF v_has_authenticated THEN
    IF to_regclass('public.user_settings') IS NOT NULL THEN
      EXECUTE 'REVOKE SELECT, INSERT, UPDATE ON TABLE public.user_settings FROM authenticated';
    END IF;
    IF to_regclass('public.user_preferences') IS NOT NULL THEN
      EXECUTE 'REVOKE SELECT, INSERT, UPDATE ON TABLE public.user_preferences FROM authenticated';
    END IF;
    IF to_regclass('public.notifications') IS NOT NULL THEN
      EXECUTE 'REVOKE SELECT, UPDATE, DELETE ON TABLE public.notifications FROM authenticated';
    END IF;
  END IF;
END $$;
