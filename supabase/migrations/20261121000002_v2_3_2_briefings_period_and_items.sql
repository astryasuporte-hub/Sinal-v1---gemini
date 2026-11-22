-- ==============================================================================
-- FATOSBR V2.3.2 — MIGRAÇÃO INCREMENTAL: BRIEFINGS PERIOD & BRIEFING_ITEMS SCHEMA
-- ==============================================================================
-- Complementa a V2.3.1 mantendo 100% de compatibilidade com tabelas/índices
-- já existentes em produção:
-- 1. Garante period_start e period_end em public.briefings + backfill seguro.
-- 2. Garante position e section em public.briefing_items + índice de ordenação.
-- 3. Garante índice único de deduplicação utilizando (user_id, type, period_start, period_end)
--    quando aplicável e sem duplicatas preexistentes.
-- ==============================================================================

DO $$
BEGIN
  IF to_regclass('public.briefings') IS NOT NULL THEN
    ALTER TABLE public.briefings
      ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;

    UPDATE public.briefings
       SET period_start = COALESCE(
             period_start,
             CASE
               WHEN type = 'EVENING' THEN date_trunc('day', COALESCE(scheduled_for, created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + INTERVAL '12 hours'
               ELSE date_trunc('day', COALESCE(scheduled_for, created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
             END
           ),
           period_end = COALESCE(
             period_end,
             CASE
               WHEN type = 'EVENING' THEN date_trunc('day', COALESCE(scheduled_for, created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + INTERVAL '23 hours 59 minutes 59.999 seconds'
               ELSE date_trunc('day', COALESCE(scheduled_for, created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + INTERVAL '11 hours 59 minutes 59.999 seconds'
             END
           )
     WHERE period_start IS NULL OR period_end IS NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'briefings'
        AND indexname = 'idx_briefings_user_type_period_active'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.briefings
        WHERE status NOT IN ('FAILED', 'CANCELED')
          AND period_start IS NOT NULL
          AND period_end IS NOT NULL
        GROUP BY user_id, type, period_start, period_end
        HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX idx_briefings_user_type_period_active
          ON public.briefings (user_id, type, period_start, period_end)
          WHERE status NOT IN ('FAILED', 'CANCELED') AND period_start IS NOT NULL AND period_end IS NOT NULL;
      END IF;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.briefing_items') IS NOT NULL THEN
    ALTER TABLE public.briefing_items
      ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'Destaques';

    CREATE INDEX IF NOT EXISTS idx_briefing_items_briefing_position
      ON public.briefing_items (briefing_id, position ASC);
  END IF;
END $$;
