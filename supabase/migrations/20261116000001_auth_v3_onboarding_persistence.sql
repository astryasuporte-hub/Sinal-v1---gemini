-- ==============================================================================
-- FATOSBR AUTH V3.0 — PERSISTÊNCIA CANÔNICA DE ONBOARDING & HARDENING DE PERFIL
-- ==============================================================================
-- Migração estritamente aditiva, idempotente e não destrutiva:
-- 1. Adiciona colunas canônicas de onboarding em public.profiles
-- 2. Atualiza trigger public.handle_new_user() para inicializar NOT_STARTED
-- 3. Reconcilia apenas usuários antigos com evidência real persistida no banco
-- 4. Garante policies RLS seguras em public.profiles sem recursão
-- ==============================================================================

-- 1. Colunas canônicas de estado do onboarding em public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS onboarding_step INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Constraint segura para valores válidos de onboarding_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_onboarding_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_onboarding_status_check
      CHECK (onboarding_status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_status
  ON public.profiles (onboarding_status);

-- 2. Trigger de provisionamento para novos usuários já com onboarding_status = 'NOT_STARTED'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    onboarding_status,
    onboarding_step,
    onboarding_data
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', SPLIT_PART(COALESCE(NEW.email, 'leitor'), '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    'NOT_STARTED',
    1,
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (id, briefing_email)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3. Reconciliação segura de usuários antigos COM evidência real no PostgreSQL
-- IMPORTANTE: Usuários sem evidência real permanecem em 'NOT_STARTED'.
UPDATE public.profiles p
SET
  onboarding_status = 'COMPLETED',
  onboarding_step = 7,
  onboarding_completed_at = COALESCE(p.onboarding_completed_at, p.updated_at, NOW()),
  updated_at = NOW()
WHERE p.onboarding_status = 'NOT_STARTED'
  AND (
    EXISTS (SELECT 1 FROM public.user_followed_topics uft WHERE uft.user_id = p.id)
    OR EXISTS (SELECT 1 FROM public.user_followed_entities ufe WHERE ufe.user_id = p.id)
    OR EXISTS (SELECT 1 FROM public.user_followed_sources ufs WHERE ufs.user_id = p.id)
    OR EXISTS (
      SELECT 1 FROM public.user_preferences up
      WHERE up.id = p.id
        AND up.updated_at IS NOT NULL
        AND up.created_at IS NOT NULL
        AND up.updated_at > (up.created_at + INTERVAL '5 seconds')
    )
  );

-- 4. Garantir políticas RLS seguras em public.profiles (sem recursão)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuário lê o próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Super Admin lê todos os perfis" ON public.profiles;
DROP POLICY IF EXISTS "Usuário ou Super Admin lê perfis" ON public.profiles;
DROP POLICY IF EXISTS "Usuário edita o próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Usuário ou Super Admin edita o próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Usuário insere o próprio perfil" ON public.profiles;

CREATE POLICY "Usuário ou Super Admin lê perfis" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR public.is_admin() = TRUE
  );

CREATE POLICY "Usuário insere o próprio perfil" ON public.profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id
  );

CREATE POLICY "Usuário ou Super Admin edita o próprio perfil" ON public.profiles
  FOR UPDATE USING (
    auth.uid() = id
    OR public.is_admin() = TRUE
  )
  WITH CHECK (
    auth.uid() = id
    OR public.is_admin() = TRUE
  );
