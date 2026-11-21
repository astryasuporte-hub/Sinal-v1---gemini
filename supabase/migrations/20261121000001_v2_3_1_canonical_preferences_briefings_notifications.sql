-- ==============================================================================
-- FATOSBR V2.3.1 — MIGRAÇÃO INCREMENTAL AUDITADA E COMPATÍVEL COM PRODUÇÃO
-- ==============================================================================
-- Revisão definitiva alinhada ao contrato real do PostgreSQL / Supabase em produção:
-- 1. 100% incremental, segura e idempotente (verifica existência de tabelas/índices/dados).
-- 2. Preserva integralmente UUIDs, linhas, constraints existentes em public.briefings
--    (type IN ('MORNING', 'EVENING'), status IN ('PENDING','GENERATING','READY','SENT','FAILED','CANCELED'))
--    e check constraints existentes em public.notifications.
-- 3. Garante armazenamento canônico de notification_settings (JSONB) e horários em
--    public.user_settings e public.user_preferences, sem conflitar caso apenas uma exista.
-- 4. Garante coluna read_at TIMESTAMPTZ em public.notifications e índices únicos
--    parciais de deduplicação somente quando não há duplicatas preexistentes.
-- 5. NÃO recria tabelas legadas com checks incompatíveis (ex.: type lowercase).
-- ==============================================================================

-- 1. Armazenamento canônico de preferências de alerta e agendamento em public.user_settings
DO $$
BEGIN
  IF to_regclass('public.user_settings') IS NOT NULL THEN
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

-- 2. Complemento seguro e opcional em public.user_preferences (sem alterar PK id = auth.users.id)
DO $$
BEGIN
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

-- 3. Consistência de leitura e deduplicação concorrente em public.notifications
-- Mantém rigorosamente a check constraint existente em production para public.notifications.type:
-- ('NEWS_HIGH_RELEVANCE', 'BRIEFING_READY', 'TRIAL_EXPIRING', 'TRIAL_EXPIRED', 'SUBSCRIPTION_ACTIVE', 'PAYMENT_FAILED', 'SYSTEM')
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications
      ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

    -- Backfill seguro de read_at caso read = TRUE preexistente sem timestamp
    UPDATE public.notifications
       SET read_at = COALESCE(read_at, created_at, NOW())
     WHERE read = TRUE AND read_at IS NULL;

    -- Índice único concorrente por (user_id, event_id, category) quando aplicável
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'event_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'category'
    ) THEN
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
  END IF;
END $$;

-- 4. Índices de consulta e proteção de duplicidade diária em public.briefings (sem alterar check constraints canônicas)
DO $$
BEGIN
  IF to_regclass('public.briefings') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'briefings'
        AND indexname = 'idx_briefings_user_type_day_active'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.briefings
        WHERE status NOT IN ('FAILED', 'CANCELED')
          AND scheduled_for IS NOT NULL
        GROUP BY user_id, type, ((scheduled_for AT TIME ZONE 'UTC')::date)
        HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX idx_briefings_user_type_day_active
          ON public.briefings (user_id, type, ((scheduled_for AT TIME ZONE 'UTC')::date))
          WHERE status NOT IN ('FAILED', 'CANCELED') AND scheduled_for IS NOT NULL;
      END IF;
    END IF;
  END IF;
END $$;
