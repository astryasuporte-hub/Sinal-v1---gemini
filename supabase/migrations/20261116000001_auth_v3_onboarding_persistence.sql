-- ==============================================================================
-- FATOSBR AUTH V3.1 — MIGRAÇÃO CORRIGIDA E INCREMENTAL DE ONBOARDING
-- ==============================================================================
-- Compatível com o esquema real de produção:
--   public.profiles (id, user_id, name, username, avatar_url, timezone, locale,
--                    onboarding_status, created_at, updated_at)
--   public.user_topic_follows, public.user_entity_follows, public.user_source_follows
--
-- Regras estritas desta migração:
-- 1. NÃO recria public.profiles nem altera PKs (id) ou auth.users.
-- 2. NÃO sobrescreve public.handle_new_user() nem on_auth_user_created
--    (preserva o provisionamento real de profiles, user_settings e subscriptions).
-- 3. NÃO apaga nem substitui policies RLS existentes de public.profiles.
-- 4. NÃO altera schema nem dados de public.subscriptions ou tabelas financeiras.
-- 5. Adiciona apenas colunas faltantes de onboarding de forma idempotente.
-- 6. Reconcilia usuários legados apenas quando houver evidência real em
--    user_topic_follows, user_entity_follows ou user_source_follows.
-- ==============================================================================

-- 1. Adicionar apenas colunas de onboarding faltantes em public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Garantir default 'NOT_STARTED' caso onboarding_status já existisse sem default
DO $$
DECLARE
  v_data_type TEXT;
  v_col_default TEXT;
BEGIN
  SELECT data_type, column_default
  INTO v_data_type, v_col_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name = 'onboarding_status';

  IF v_data_type IN ('text', 'character varying') AND v_col_default IS NULL THEN
    ALTER TABLE public.profiles
      ALTER COLUMN onboarding_status SET DEFAULT 'NOT_STARTED';
  END IF;
END $$;

-- Adicionar constraint de onboarding_status somente se ainda não houver nenhuma
-- constraint relacionada e se todos os registros existentes forem compatíveis.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND (
        conname = 'profiles_onboarding_status_check'
        OR pg_get_constraintdef(oid) ILIKE '%onboarding_status%'
      )
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE onboarding_status IS NOT NULL
        AND onboarding_status NOT IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')
    ) THEN
      ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_onboarding_status_check
        CHECK (onboarding_status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'));
    END IF;
  END IF;
END $$;

-- 2. Índices seguros para lookup por user_id e estado do onboarding
CREATE INDEX IF NOT EXISTS idx_profiles_user_id
  ON public.profiles (user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_status
  ON public.profiles (onboarding_status);

-- 3. Reconciliação segura de usuários legados APENAS com evidência real nas
-- tabelas canônicas de seguidos (user_topic_follows, user_entity_follows, user_source_follows).
-- IMPORTANTE:
-- - Usa p.user_id (nunca p.id).
-- - NÃO marca usuário como COMPLETED apenas por possuir registro padrão em user_settings/preferências.
DO $$
DECLARE
  v_has_topics BOOLEAN := to_regclass('public.user_topic_follows') IS NOT NULL;
  v_has_entities BOOLEAN := to_regclass('public.user_entity_follows') IS NOT NULL;
  v_has_sources BOOLEAN := to_regclass('public.user_source_follows') IS NOT NULL;
BEGIN
  IF v_has_topics OR v_has_entities OR v_has_sources THEN
    UPDATE public.profiles p
    SET
      onboarding_status = 'COMPLETED',
      onboarding_step = 7,
      onboarding_completed_at = COALESCE(p.onboarding_completed_at, p.updated_at, NOW()),
      updated_at = NOW()
    WHERE UPPER(COALESCE(p.onboarding_status, 'NOT_STARTED')) = 'NOT_STARTED'
      AND (
        (v_has_topics AND EXISTS (
          SELECT 1 FROM public.user_topic_follows utf WHERE utf.user_id = p.user_id
        ))
        OR (v_has_entities AND EXISTS (
          SELECT 1 FROM public.user_entity_follows uef WHERE uef.user_id = p.user_id
        ))
        OR (v_has_sources AND EXISTS (
          SELECT 1 FROM public.user_source_follows usf WHERE usf.user_id = p.user_id
        ))
      );
  END IF;
END $$;
