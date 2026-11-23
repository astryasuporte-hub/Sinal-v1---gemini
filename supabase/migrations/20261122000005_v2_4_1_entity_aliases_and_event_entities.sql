-- ==============================================================================
-- FATOSBR V2.4.1 — MIGRAÇÃO INCREMENTAL: ENTITY ALIASES & EVENT_ENTITIES INDEXING
-- ==============================================================================
-- 1. Tabela public.entity_aliases para correspondência determinística segura de
--    entidades já cadastradas em public.entities (siglas, razões sociais, nomes curtos).
-- 2. Índice auxiliar em public.event_entities(entity_id, event_id) para seleção
--    rápida de briefings e segmentação de alertas por entidades seguidas.
-- 3. 100% incremental, preserva public.entities e public.event_entities existentes.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.entity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_normalized
  ON public.entity_aliases (normalized_alias);

ALTER TABLE public.entity_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura pública de entity_aliases" ON public.entity_aliases;
CREATE POLICY "Leitura pública de entity_aliases" ON public.entity_aliases
  FOR SELECT USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP POLICY IF EXISTS "Service role gerencia entity_aliases" ON public.entity_aliases;
    CREATE POLICY "Service role gerencia entity_aliases" ON public.entity_aliases
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.event_entities') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_event_entities_entity_event
      ON public.event_entities (entity_id, event_id);
  END IF;
END $$;
