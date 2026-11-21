-- ==============================================================================
-- FATOSBR V2.3 — MIGRAÇÃO INCREMENTAL DE HARDENING: USER_SETTINGS, BRIEFINGS E RLS
-- ==============================================================================
-- Compatível com esquemas que utilizam public.user_settings e/ou public.user_preferences.
-- Regras estritas:
-- 1. 100% incremental e idempotente; preserva todos os UUIDs e registros existentes.
-- 2. Reutiliza public.user_settings caso já exista, evitando tabelas duplicadas.
-- 3. Garante RLS estrita baseada em auth.uid() para isolamento multiusuário.
-- 4. Adiciona suporte idempotente de deduplicação em public.notifications.
-- ==============================================================================

-- 1. Estender public.user_settings (quando existente) com campos de briefing e preferências
DO $$
BEGIN
  IF to_regclass('public.user_settings') IS NOT NULL THEN
    ALTER TABLE public.user_settings
      ADD COLUMN IF NOT EXISTS email_morning_briefing BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS email_evening_briefing BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS email_breaking_alerts BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS weekend_edition BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS briefing_email TEXT,
      ADD COLUMN IF NOT EXISTS morning_time TEXT DEFAULT '07:00',
      ADD COLUMN IF NOT EXISTS evening_time TEXT DEFAULT '20:00',
      ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Sao_Paulo',
      ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

    ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Usuário lê suas próprias configurações" ON public.user_settings;
    CREATE POLICY "Usuário lê suas próprias configurações" ON public.user_settings
      FOR SELECT USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Usuário insere suas próprias configurações" ON public.user_settings;
    CREATE POLICY "Usuário insere suas próprias configurações" ON public.user_settings
      FOR INSERT WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Usuário atualiza suas próprias configurações" ON public.user_settings;
    CREATE POLICY "Usuário atualiza suas próprias configurações" ON public.user_settings
      FOR UPDATE USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "Service role gerencia user_settings" ON public.user_settings;
    CREATE POLICY "Service role gerencia user_settings" ON public.user_settings
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 2. Estender public.user_preferences (quando existente) com notification_settings e RLS estrita
DO $$
BEGIN
  IF to_regclass('public.user_preferences') IS NOT NULL THEN
    ALTER TABLE public.user_preferences
      ADD COLUMN IF NOT EXISTS morning_time TEXT DEFAULT '07:00',
      ADD COLUMN IF NOT EXISTS evening_time TEXT DEFAULT '20:00',
      ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Sao_Paulo',
      ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

    ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Usuário lê suas próprias preferências" ON public.user_preferences;
    CREATE POLICY "Usuário lê suas próprias preferências" ON public.user_preferences
      FOR SELECT USING (auth.uid() = id);

    DROP POLICY IF EXISTS "Usuário insere suas próprias preferências" ON public.user_preferences;
    CREATE POLICY "Usuário insere suas próprias preferências" ON public.user_preferences
      FOR INSERT WITH CHECK (auth.uid() = id);

    DROP POLICY IF EXISTS "Usuário atualiza suas próprias preferências" ON public.user_preferences;
    CREATE POLICY "Usuário atualiza suas próprias preferências" ON public.user_preferences
      FOR UPDATE USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);

    DROP POLICY IF EXISTS "Service role gerencia user_preferences" ON public.user_preferences;
    CREATE POLICY "Service role gerencia user_preferences" ON public.user_preferences
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3. Hardening de deduplicação e tipo em public.notifications
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications
      ADD COLUMN IF NOT EXISTS notification_type TEXT DEFAULT 'NEWS_HIGH_RELEVANCE',
      ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

    -- Índice único parcial para impedir notificações duplicadas por (user_id, event_id, category)
    -- Só cria se não houver duplicatas preexistentes que impeçam a criação
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'notifications'
        AND indexname = 'idx_notifications_dedup_user_event_cat'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE event_id IS NOT NULL
        GROUP BY user_id, event_id, category
        HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX idx_notifications_dedup_user_event_cat
          ON public.notifications (user_id, event_id, category)
          WHERE event_id IS NOT NULL;
      END IF;
    END IF;
  END IF;
END $$;
