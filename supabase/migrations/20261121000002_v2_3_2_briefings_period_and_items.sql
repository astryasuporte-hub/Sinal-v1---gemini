-- ==============================================================================
-- FATOSBR V2.3.2 — MIGRAÇÃO INCREMENTAL: BRIEFINGS PERIOD, LOCAL_DATE & ITEMS
-- ==============================================================================
-- Totalmente compatível com o contrato e constraints reais em produção:
-- 1. NÃO recria tabelas nem remove constraints existentes.
-- 2. Garante period_start, period_end e local_date em public.briefings com backfill
--    seguro no fuso padrão America/Sao_Paulo.
-- 3. Garante position e section em public.briefing_items utilizando DEFAULT 'TOP_STORIES',
--    100% compatível com a check constraint ('TOP_STORIES','UPDATES','DEVELOPING','WATCH_NEXT').
-- 4. Evita criação de índices redundantes quando o banco já possuir
--    idx_briefing_delivery_slot ou índice equivalente em (briefing_id, position).
-- ==============================================================================

DO $$
BEGIN
  IF to_regclass('public.briefings') IS NOT NULL THEN
    ALTER TABLE public.briefings
      ADD COLUMN IF NOT EXISTS local_date DATE,
      ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;

    UPDATE public.briefings
       SET local_date = COALESCE(
             local_date,
             (COALESCE(scheduled_for, created_at) AT TIME ZONE 'America/Sao_Paulo')::date
           )
     WHERE local_date IS NULL;

    UPDATE public.briefings
       SET period_start = COALESCE(
             period_start,
             CASE
               WHEN type = 'EVENING'
                 THEN (local_date::timestamp AT TIME ZONE 'America/Sao_Paulo') + INTERVAL '7 hours'
               ELSE ((local_date - 1)::timestamp AT TIME ZONE 'America/Sao_Paulo') + INTERVAL '20 hours'
             END
           ),
           period_end = COALESCE(
             period_end,
             CASE
               WHEN type = 'EVENING'
                 THEN (local_date::timestamp AT TIME ZONE 'America/Sao_Paulo') + INTERVAL '20 hours'
               ELSE (local_date::timestamp AT TIME ZONE 'America/Sao_Paulo') + INTERVAL '7 hours'
             END
           )
     WHERE local_date IS NOT NULL
       AND (period_start IS NULL OR period_end IS NULL);

    -- Evita índice redundante caso o banco já possua idx_briefing_delivery_slot
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'briefings'
        AND indexname IN (
          'idx_briefing_delivery_slot',
          'idx_briefings_user_type_local_date_active'
        )
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.briefings
        WHERE status NOT IN ('FAILED', 'CANCELED')
          AND local_date IS NOT NULL
        GROUP BY user_id, type, local_date
        HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX idx_briefings_user_type_local_date_active
          ON public.briefings (user_id, type, local_date)
          WHERE status NOT IN ('FAILED', 'CANCELED') AND local_date IS NOT NULL;
      END IF;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.briefing_items') IS NOT NULL THEN
    ALTER TABLE public.briefing_items
      ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'TOP_STORIES';

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'briefing_items'
        AND indexdef ILIKE '%(briefing_id, position%'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_briefing_items_briefing_position
        ON public.briefing_items (briefing_id, position ASC);
    END IF;
  END IF;
END $$;
