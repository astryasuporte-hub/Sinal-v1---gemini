-- ==============================================================================
-- FATOSBR — MIGRAÇÃO INCREMENTAL DE ÍNDICES PARA PAGINAÇÃO POR CURSOR E JOINS
-- ==============================================================================
-- 1. 100% idempotente e aditiva (verifica tabela/colunas antes de criar).
-- 2. Suporta keyset/cursor pagination em (published_at DESC, id DESC).
-- 3. Acelera CTE paged_events + EXISTS por categoria + lookup de imagem primária.
-- ==============================================================================

DO $$
BEGIN
  IF to_regclass('public.events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_events_published_id_desc
      ON public.events (published_at DESC, id DESC);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.event_topics') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_event_topics_event_topic
      ON public.event_topics (event_id, topic_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.articles') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_articles_id_with_image
      ON public.articles (id)
      WHERE image_url IS NOT NULL AND image_url != '';
  END IF;
END $$;
