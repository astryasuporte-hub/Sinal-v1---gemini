-- ==============================================================================
-- FATOSBR V2.4.4 — ROLLBACK NÃO DESTRUTIVO (FORA DE supabase/migrations/)
-- ==============================================================================
-- Localização intencional: `supabase/rollbacks/` para evitar duplicidade de
-- versão `20261125000001` no diretório executável `supabase/migrations/`.
--
-- ATENÇÃO:
-- - Este script é 100% não destrutivo: NÃO apaga tabelas, colunas, dados de
--   usuários nem policies existentes (incluindo `account_controls_guard`).
-- - Em `public.user_settings`, reverte apenas `INSERT, UPDATE` adicionados pela
--   V2.4.4, retornando ao baseline auditado em produção (`SELECT` preservado).
-- - Em produção, NÃO execute este rollback se o app depender desses GRANTs para
--   persistir preferências sem erro 42501 (`permission denied for table user_settings`).
-- ==============================================================================

DO $$
DECLARE
  v_has_authenticated BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF v_has_authenticated THEN
    IF to_regclass('public.user_settings') IS NOT NULL THEN
      EXECUTE 'REVOKE INSERT, UPDATE ON TABLE public.user_settings FROM authenticated';
    END IF;
    IF to_regclass('public.user_preferences') IS NOT NULL THEN
      EXECUTE 'REVOKE INSERT, UPDATE ON TABLE public.user_preferences FROM authenticated';
    END IF;
    IF to_regclass('public.notifications') IS NOT NULL THEN
      EXECUTE 'REVOKE UPDATE, DELETE ON TABLE public.notifications FROM authenticated';
    END IF;
  END IF;
END $$;
