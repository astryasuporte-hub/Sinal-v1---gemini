-- ==============================================================================
-- FATOSBR V2.4.4 — DEFINITIVE FIX FOR USER_SETTINGS / PREFERENCES / NOTIFICATIONS
-- GRANTS (SQLSTATE 42501), LEAST-PRIVILEGE PERMISSIONS & STRICT RLS POLICIES
-- ==============================================================================
-- Diagnóstico confirmado em produção (24/11/2026):
-- - `authenticated` possui `SELECT` em `public.user_settings`, porém NÃO possui
--   `INSERT` nem `UPDATE` (falhando com `permission denied for table user_settings`
--   ao inicializar ou salvar preferências do usuário).
-- - Existe em produção a policy `account_controls_guard`, que DEVE ser
--   preservada integralmente junto com o isolamento estrito por `auth.uid()`.
-- - No PostgreSQL, privilégios de tabela (GRANT) são avaliados ANTES da RLS.
--   Sem GRANT explícito, qualquer acesso autenticado via Supabase client falha
--   imediatamente com SQLSTATE 42501.
--
-- Garantias desta migração:
-- 1. 100% idempotente e não destrutiva (preserva todas as tabelas, dados e UUIDs).
-- 2. Verifica existência das tabelas e detecta dinamicamente a coluna de dono
--    (`user_id` vs `id`) via information_schema.columns.
-- 3. Remove privilégios amplos de `PUBLIC` e `anon` (REVOKE ALL).
-- 4. Concede privilégios mínimos necessários para `authenticated` e completos para `service_role`.
-- 5. Garante RLS ativa com policies estritas vinculadas a `auth.uid()` (sem
--    `USING (true)` para `authenticated`/`anon` e sem `SECURITY DEFINER`),
--    removendo apenas as policies nominais da V2.3/V2.3.1 e PRESERVANDO
--    integralmente policies adicionais de produção como `account_controls_guard`.
-- 6. Rollback documentado fora de `supabase/migrations/` em:
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
  -- Garantir uso do schema public para as roles operacionais
  IF v_has_authenticated THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO authenticated';
  END IF;
  IF v_has_service_role THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO service_role';
  END IF;

  -- ==========================================================================
  -- 1. public.user_settings
  -- ==========================================================================
  IF to_regclass('public.user_settings') IS NOT NULL THEN
    -- Garantir colunas canônicas de preferências caso algum ambiente legado esteja atrasado
    ALTER TABLE public.user_settings
      ADD COLUMN IF NOT EXISTS notification_settings JSONB NOT NULL DEFAULT '{
        "urgentEvents": true,
        "entityUpdates": true,
        "topicAlerts": true,
        "sourcesDigest": true,
        "dailyBriefings": true,
        "onlyHighRelevance": true
      }'::jsonb,
      ADD COLUMN IF NOT EXISTS email_morning_briefing BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS email_evening_briefing BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS email_breaking_alerts BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS weekend_edition BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS briefing_email TEXT,
      ADD COLUMN IF NOT EXISTS morning_time TEXT NOT NULL DEFAULT '07:00',
      ADD COLUMN IF NOT EXISTS evening_time TEXT NOT NULL DEFAULT '20:00',
      ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    -- Detectar coluna de vínculo com auth.users() (padrão: user_id; fallback: id)
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

    -- Privilégios SQL explícitos (avaliados antes da RLS)
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

    -- Privilégio em eventual sequência associada (serial/identity)
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

    -- RLS obrigatória e estrita
    -- IMPORTANTE: remove somente as policies nominais da V2.3/V2.3.1; policies
    -- de guarda em produção (como `account_controls_guard`) permanecem intactas.
    EXECUTE 'ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "Usuário lê suas próprias configurações" ON public.user_settings';
    EXECUTE 'DROP POLICY IF EXISTS "Usuário insere suas próprias configurações" ON public.user_settings';
    EXECUTE 'DROP POLICY IF EXISTS "Usuário atualiza suas próprias configurações" ON public.user_settings';
    EXECUTE 'DROP POLICY IF EXISTS "Service role gerencia user_settings" ON public.user_settings';

    IF v_has_authenticated THEN
      EXECUTE format(
        'CREATE POLICY "Usuário lê suas próprias configurações" ON public.user_settings FOR SELECT TO authenticated USING (auth.uid() = %I)',
        v_owner_col
      );
      EXECUTE format(
        'CREATE POLICY "Usuário insere suas próprias configurações" ON public.user_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = %I)',
        v_owner_col
      );
      EXECUTE format(
        'CREATE POLICY "Usuário atualiza suas próprias configurações" ON public.user_settings FOR UPDATE TO authenticated USING (auth.uid() = %I) WITH CHECK (auth.uid() = %I)',
        v_owner_col,
        v_owner_col
      );
    END IF;

    IF v_has_service_role THEN
      EXECUTE 'CREATE POLICY "Service role gerencia user_settings" ON public.user_settings FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;

  -- ==========================================================================
  -- 2. public.user_preferences
  -- ==========================================================================
  IF to_regclass('public.user_preferences') IS NOT NULL THEN
    ALTER TABLE public.user_preferences
      ADD COLUMN IF NOT EXISTS notification_settings JSONB NOT NULL DEFAULT '{
        "urgentEvents": true,
        "entityUpdates": true,
        "topicAlerts": true,
        "sourcesDigest": true,
        "dailyBriefings": true,
        "onlyHighRelevance": true
      }'::jsonb,
      ADD COLUMN IF NOT EXISTS morning_time TEXT NOT NULL DEFAULT '07:00',
      ADD COLUMN IF NOT EXISTS evening_time TEXT NOT NULL DEFAULT '20:00',
      ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    -- Em public.user_preferences, PK histórica é id (= auth.users.id); fallback user_id
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

    SELECT pg_get_serial_sequence('public.user_preferences', c.column_name)
      INTO v_seq_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'user_preferences'
       AND pg_get_serial_sequence('public.user_preferences', c.column_name) IS NOT NULL
     LIMIT 1;

    IF v_seq_name IS NOT NULL THEN
      IF v_has_authenticated THEN
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', v_seq_name);
      END IF;
      IF v_has_service_role THEN
        EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %s TO service_role', v_seq_name);
      END IF;
    END IF;

    EXECUTE 'ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "Usuário lê suas próprias preferências" ON public.user_preferences';
    EXECUTE 'DROP POLICY IF EXISTS "Usuário insere suas próprias preferências" ON public.user_preferences';
    EXECUTE 'DROP POLICY IF EXISTS "Usuário atualiza suas próprias preferências" ON public.user_preferences';
    EXECUTE 'DROP POLICY IF EXISTS "Service role gerencia user_preferences" ON public.user_preferences';

    IF v_has_authenticated THEN
      EXECUTE format(
        'CREATE POLICY "Usuário lê suas próprias preferências" ON public.user_preferences FOR SELECT TO authenticated USING (auth.uid() = %I)',
        v_owner_col
      );
      EXECUTE format(
        'CREATE POLICY "Usuário insere suas próprias preferências" ON public.user_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = %I)',
        v_owner_col
      );
      EXECUTE format(
        'CREATE POLICY "Usuário atualiza suas próprias preferências" ON public.user_preferences FOR UPDATE TO authenticated USING (auth.uid() = %I) WITH CHECK (auth.uid() = %I)',
        v_owner_col,
        v_owner_col
      );
    END IF;

    IF v_has_service_role THEN
      EXECUTE 'CREATE POLICY "Service role gerencia user_preferences" ON public.user_preferences FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;

  -- ==========================================================================
  -- 3. public.notifications
  -- ==========================================================================
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications
      ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

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
      -- Usuários autenticados lêem, marcam como lidas e podem excluir apenas suas notificações
      EXECUTE 'GRANT SELECT, UPDATE, DELETE ON TABLE public.notifications TO authenticated';
    END IF;
    IF v_has_service_role THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notifications TO service_role';
    END IF;

    SELECT pg_get_serial_sequence('public.notifications', c.column_name)
      INTO v_seq_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'notifications'
       AND pg_get_serial_sequence('public.notifications', c.column_name) IS NOT NULL
     LIMIT 1;

    IF v_seq_name IS NOT NULL THEN
      IF v_has_authenticated THEN
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', v_seq_name);
      END IF;
      IF v_has_service_role THEN
        EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %s TO service_role', v_seq_name);
      END IF;
    END IF;

    EXECUTE 'ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "Usuário lê suas próprias notificações" ON public.notifications';
    EXECUTE 'DROP POLICY IF EXISTS "Usuário atualiza suas próprias notificações" ON public.notifications';
    EXECUTE 'DROP POLICY IF EXISTS "Usuário remove suas próprias notificações" ON public.notifications';
    EXECUTE 'DROP POLICY IF EXISTS "Service role gerencia notifications" ON public.notifications';

    IF v_has_authenticated THEN
      EXECUTE format(
        'CREATE POLICY "Usuário lê suas próprias notificações" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = %I)',
        v_owner_col
      );
      EXECUTE format(
        'CREATE POLICY "Usuário atualiza suas próprias notificações" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = %I) WITH CHECK (auth.uid() = %I)',
        v_owner_col,
        v_owner_col
      );
      EXECUTE format(
        'CREATE POLICY "Usuário remove suas próprias notificações" ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = %I)',
        v_owner_col
      );
    END IF;

    IF v_has_service_role THEN
      EXECUTE 'CREATE POLICY "Service role gerencia notifications" ON public.notifications FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;
