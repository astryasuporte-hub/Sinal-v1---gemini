-- ==============================================================================
-- FATOSBR — MIGRAÇÃO INCREMENTAL DE ÍNDICES DE PERFORMANCE (HOT PATHS)
-- ==============================================================================
-- 1. 100% idempotente e segura (verifica existência de tabela/colunas antes).
-- 2. Não altera RLS, triggers, constraints, pagamentos ou schema funcional.
-- 3. Índices compostos e parciais para eliminar sequential scans em:
--    - public.events (feed cronológico e relevância)
--    - public.event_articles (resolução de imagem/artigo primário por evento)
--    - public.event_topics (categoria por evento)
--    - public.user_saved_events, user_entity_follows, user_topic_follows, user_source_follows
--    - public.briefings (histórico por usuário)
--    - public.notifications (contagem parcial de não lidas e lista recente)
-- ==============================================================================

DO $$
BEGIN
  IF to_regclass('public.events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_events_published_at_desc
      ON public.events (published_at DESC);

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'relevance_score'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_events_relevance_published_desc
        ON public.events (relevance_score DESC, published_at DESC);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.event_articles') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'event_articles' AND column_name = 'is_primary'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_event_articles_event_primary
        ON public.event_articles (event_id, is_primary DESC);
    ELSE
      CREATE INDEX IF NOT EXISTS idx_event_articles_event_id
        ON public.event_articles (event_id);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.event_topics') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_event_topics_event_id
      ON public.event_topics (event_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.user_saved_events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_user_saved_events_user_event
      ON public.user_saved_events (user_id, event_id);
  END IF;
  IF to_regclass('public.user_entity_follows') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_user_entity_follows_entity_user
      ON public.user_entity_follows (entity_id, user_id);
  END IF;
  IF to_regclass('public.user_topic_follows') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_user_topic_follows_topic_user
      ON public.user_topic_follows (topic_id, user_id);
  END IF;
  IF to_regclass('public.user_source_follows') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_user_source_follows_source_user
      ON public.user_source_follows (source_id, user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.briefings') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_briefings_user_scheduled_desc
      ON public.briefings (user_id, scheduled_for DESC);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created_desc
      ON public.notifications (user_id, created_at DESC)
      WHERE read = false;
  END IF;
END $$;
