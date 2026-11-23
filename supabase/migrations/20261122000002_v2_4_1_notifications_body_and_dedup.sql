-- ==============================================================================
-- FATOSBR V2.4.1 — MIGRAÇÃO INCREMENTAL: NOTIFICATIONS BODY & BRIEFING_READY DEDUP
-- ==============================================================================
-- 100% incremental, idempotente e segura para execução em produção e homologação:
-- 1. Garante existência e backfill seguro de body, subtitle e read_at em public.notifications.
-- 2. Cria índice único parcial idx_notifications_dedup_user_briefing_ready para
--    prevenir notificações duplicadas de BRIEFING_READY sob concorrência.
-- 3. NÃO remove constraints nem colunas existentes.
-- ==============================================================================

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications
      ADD COLUMN IF NOT EXISTS body TEXT,
      ADD COLUMN IF NOT EXISTS subtitle TEXT,
      ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

    -- Backfill seguro de body caso existam registros legados sem body preenchido
    UPDATE public.notifications
       SET body = COALESCE(
             NULLIF(btrim(body), ''),
             NULLIF(btrim(subtitle), ''),
             title
           )
     WHERE body IS NULL OR btrim(body) = '';

    -- Backfill seguro de subtitle quando apenas body estava preenchido
    UPDATE public.notifications
       SET subtitle = COALESCE(NULLIF(btrim(subtitle), ''), body)
     WHERE (subtitle IS NULL OR btrim(subtitle) = '')
       AND body IS NOT NULL
       AND btrim(body) <> '';

    -- Índice único concorrente para BRIEFING_READY por (user_id, metadata->>'briefingId')
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'type'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'metadata'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'notifications'
          AND indexname = 'idx_notifications_dedup_user_briefing_ready'
      ) THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.notifications
          WHERE type = 'BRIEFING_READY'
            AND metadata IS NOT NULL
            AND (metadata->>'briefingId') IS NOT NULL
          GROUP BY user_id, (metadata->>'briefingId')
          HAVING COUNT(*) > 1
        ) THEN
          CREATE UNIQUE INDEX idx_notifications_dedup_user_briefing_ready
            ON public.notifications (user_id, (metadata->>'briefingId'))
            WHERE type = 'BRIEFING_READY'
              AND metadata IS NOT NULL
              AND (metadata->>'briefingId') IS NOT NULL;
        END IF;
      END IF;
    END IF;
  END IF;
END $$;
