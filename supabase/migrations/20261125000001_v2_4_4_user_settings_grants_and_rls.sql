-- ==============================================================================
-- FATOSBR V2.4.4 — MINIMAL GRANTS FIX (SQLSTATE 42501) & NON-DESTRUCTIVE RLS
-- ==============================================================================
-- Diagnóstico confirmado no Supabase de produção (24/11/2026):
-- - `authenticated` já possui `SELECT` em `public.user_settings`, porém NÃO
--   possui `INSERT` nem `UPDATE` (causando `permission denied for table user_settings`).
-- - `public.user_preferences` já possui `SELECT, INSERT, UPDATE` e policies ativas.
-- - Existe em produção a policy `account_controls_guard` em `public.user_settings`
--   que DEVE ser preservada integralmente junto com o isolamento por `auth.uid()`.
-- - Todas as colunas canônicas já foram aplicadas nas migrações V2.3 / V2.3.1 / V2.4.1;
--   portanto esta migração NÃO executa `ALTER TABLE ... ADD COLUMN` desnecessário.
--
-- Garantias desta migração:
-- 1. Alteração mínima de privilégios focada em corrigir SQLSTATE 42501 sem locks DDL.
-- 2. 100% idempotente e não destrutiva: NÃO remove policies existentes
--    (preserva `account_controls_guard`, constraints e registros existentes).
-- 3. Remove privilégios amplos de `PUBLIC` e `anon` (`REVOKE ALL`).
-- 4. Concede apenas o menor privilégio necessário para `authenticated`:
--    - `public.user_settings`: `SELECT, INSERT, UPDATE` (sem `DELETE`)
--    - `public.user_preferences`: `SELECT, INSERT, UPDATE` (sem `DELETE`)
--    - `public.notifications`: `SELECT, UPDATE, DELETE` (sem `INSERT`)
-- 5. Só cria policies de fallback (`v2_4_4_*`) se não houver nenhuma policy
--    permissiva equivalente vinculada a `auth.uid()` para o comando.
-- 6. Rollback compatível com o baseline real de produção documentado em:
--    `supabase/rollbacks/20261125000001_rollback_user_settings_grants_and_rls.sql`
-- ==============================================================================

DO $$
DECLARE
  v_has_authenticated BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  v_has_anon          BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  v_has_service_role  BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
  v_owner_col         TEXT;
  v_seq_name          TEXT;
BEGIN
  IF v_has_authenticated THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO authenticated';
  END IF;
  IF v_has_service_role THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO service_role';
  END IF;

  -- ==========================================================================
  -- 1. public.user_settings (alvo principal do erro 42501 em produção)
  -- ==========================================================================
  IF to_regclass('public.user_settings') IS NOT NULL THEN
    SELECT c.column_name
      INTO v_owner_col
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'user_settings'
       AND c.column_name IN ('user_id', 'id')
     ORDER BY CASE c.column_name WHEN 'user_id' THEN 1 ELSE 2 END
     LIMIT 1;

    IF v_owner_col IS NULL THEN
      RAISE EXCEPTION 'Tabela public.user_settings não possui coluna identificadora user_id ou id';
    END IF;

    EXECUTE 'REVOKE ALL ON TABLE public.user_settings FROM PUBLIC';
    IF v_has_anon THEN
      EXECUTE 'REVOKE ALL ON TABLE public.user_settings FROM anon';
    END IF;
    IF v_has_authenticated THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.user_settings TO authenticated';
    END IF;
    IF v_has_service_role THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_settings TO service_role';
    END IF;

    SELECT pg_get_serial_sequence('public.user_settings', c.column_name)
      INTO v_seq_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'user_settings'
       AND pg_get_serial_sequence('public.user_settings', c.column_name) IS NOT NULL
     LIMIT 1;

    IF v_seq_name IS NOT NULL THEN
      IF v_has_authenticated THEN
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', v_seq_name);
      END IF;
      IF v_has_service_role THEN
        EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %s TO service_role', v_seq_name);
      END IF;
    END IF;

    -- Mantém RLS ativa sem remover `account_controls_guard` nem policies preexistentes
    EXECUTE 'ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY';

    IF v_has_authenticated THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'user_settings'
           AND permissive = 'PERMISSIVE'
           AND cmd IN ('SELECT', 'ALL')
           AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
           AND coalesce(qual, '') ~* 'auth\.uid\(\)'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "v2_4_4_user_settings_select_own" ON public.user_settings FOR SELECT TO authenticated USING (auth.uid() = %I)',
          v_owner_col
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'user_settings'
           AND permissive = 'PERMISSIVE'
           AND cmd IN ('INSERT', 'ALL')
           AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
           AND coalesce(with_check, '') ~* 'auth\.uid\(\)'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "v2_4_4_user_settings_insert_own" ON public.user_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = %I)',
          v_owner_col
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'user_settings'
           AND permissive = 'PERMISSIVE'
           AND cmd IN ('UPDATE', 'ALL')
           AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
           AND coalesce(qual, '') ~* 'auth\.uid\(\)'
           AND coalesce(with_check, qual, '') ~* 'auth\.uid\(\)'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "v2_4_4_user_settings_update_own" ON public.user_settings FOR UPDATE TO authenticated USING (auth.uid() = %I) WITH CHECK (auth.uid() = %I)',
          v_owner_col,
          v_owner_col
        );
      END IF;
    END IF;

    IF v_has_service_role AND NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'user_settings'
         AND permissive = 'PERMISSIVE'
         AND cmd = 'ALL'
         AND 'service_role' = ANY(roles)
    ) THEN
      EXECUTE 'CREATE POLICY "v2_4_4_user_settings_service_role" ON public.user_settings FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;

  -- ==========================================================================
  -- 2. public.user_preferences (alinhamento defensivo de menor privilégio)
  -- ==========================================================================
  IF to_regclass('public.user_preferences') IS NOT NULL THEN
    SELECT c.column_name
      INTO v_owner_col
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'user_preferences'
       AND c.column_name IN ('id', 'user_id')
     ORDER BY CASE c.column_name WHEN 'id' THEN 1 ELSE 2 END
     LIMIT 1;

    IF v_owner_col IS NULL THEN
      RAISE EXCEPTION 'Tabela public.user_preferences não possui coluna identificadora id ou user_id';
    END IF;

    EXECUTE 'REVOKE ALL ON TABLE public.user_preferences FROM PUBLIC';
    IF v_has_anon THEN
      EXECUTE 'REVOKE ALL ON TABLE public.user_preferences FROM anon';
    END IF;
    IF v_has_authenticated THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.user_preferences TO authenticated';
    END IF;
    IF v_has_service_role THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_preferences TO service_role';
    END IF;

    EXECUTE 'ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY';

    IF v_has_authenticated THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'user_preferences'
           AND permissive = 'PERMISSIVE'
           AND cmd IN ('SELECT', 'ALL')
           AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
           AND coalesce(qual, '') ~* 'auth\.uid\(\)'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "v2_4_4_user_preferences_select_own" ON public.user_preferences FOR SELECT TO authenticated USING (auth.uid() = %I)',
          v_owner_col
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'user_preferences'
           AND permissive = 'PERMISSIVE'
           AND cmd IN ('INSERT', 'ALL')
           AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
           AND coalesce(with_check, '') ~* 'auth\.uid\(\)'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "v2_4_4_user_preferences_insert_own" ON public.user_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = %I)',
          v_owner_col
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'user_preferences'
           AND permissive = 'PERMISSIVE'
           AND cmd IN ('UPDATE', 'ALL')
           AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
           AND coalesce(qual, '') ~* 'auth\.uid\(\)'
           AND coalesce(with_check, qual, '') ~* 'auth\.uid\(\)'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "v2_4_4_user_preferences_update_own" ON public.user_preferences FOR UPDATE TO authenticated USING (auth.uid() = %I) WITH CHECK (auth.uid() = %I)',
          v_owner_col,
          v_owner_col
        );
      END IF;
    END IF;

    IF v_has_service_role AND NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'user_preferences'
         AND permissive = 'PERMISSIVE'
         AND cmd = 'ALL'
         AND 'service_role' = ANY(roles)
    ) THEN
      EXECUTE 'CREATE POLICY "v2_4_4_user_preferences_service_role" ON public.user_preferences FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;

  -- ==========================================================================
  -- 3. public.notifications (alinhamento defensivo de menor privilégio)
  -- ==========================================================================
  IF to_regclass('public.notifications') IS NOT NULL THEN
    SELECT c.column_name
      INTO v_owner_col
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'notifications'
       AND c.column_name IN ('user_id', 'id')
     ORDER BY CASE c.column_name WHEN 'user_id' THEN 1 ELSE 2 END
     LIMIT 1;

    IF v_owner_col IS NULL THEN
      RAISE EXCEPTION 'Tabela public.notifications não possui coluna identificadora user_id ou id';
    END IF;

    EXECUTE 'REVOKE ALL ON TABLE public.notifications FROM PUBLIC';
    IF v_has_anon THEN
      EXECUTE 'REVOKE ALL ON TABLE public.notifications FROM anon';
    END IF;
    IF v_has_authenticated THEN
      -- Usuários autenticados lêem, marcam como lidas e excluem apenas suas notificações (sem INSERT)
      EXECUTE 'GRANT SELECT, UPDATE, DELETE ON TABLE public.notifications TO authenticated';
    END IF;
    IF v_has_service_role THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notifications TO service_role';
    END IF;

    EXECUTE 'ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY';

    IF v_has_authenticated THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'notifications'
           AND permissive = 'PERMISSIVE'
           AND cmd IN ('SELECT', 'ALL')
           AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
           AND coalesce(qual, '') ~* 'auth\.uid\(\)'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "v2_4_4_notifications_select_own" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = %I)',
          v_owner_col
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'notifications'
           AND permissive = 'PERMISSIVE'
           AND cmd IN ('UPDATE', 'ALL')
           AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
           AND coalesce(qual, '') ~* 'auth\.uid\(\)'
           AND coalesce(with_check, qual, '') ~* 'auth\.uid\(\)'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "v2_4_4_notifications_update_own" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = %I) WITH CHECK (auth.uid() = %I)',
          v_owner_col,
          v_owner_col
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'notifications'
           AND permissive = 'PERMISSIVE'
           AND cmd IN ('DELETE', 'ALL')
           AND ('authenticated' = ANY(roles) OR 'public' = ANY(roles))
           AND coalesce(qual, '') ~* 'auth\.uid\(\)'
      ) THEN
        EXECUTE format(
          'CREATE POLICY "v2_4_4_notifications_delete_own" ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = %I)',
          v_owner_col
        );
      END IF;
    END IF;

    IF v_has_service_role AND NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'notifications'
         AND permissive = 'PERMISSIVE'
         AND cmd = 'ALL'
         AND 'service_role' = ANY(roles)
    ) THEN
      EXECUTE 'CREATE POLICY "v2_4_4_notifications_service_role" ON public.notifications FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;
