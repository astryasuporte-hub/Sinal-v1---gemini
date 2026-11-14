-- ==============================================================================
-- FATOSBR V2.3 — MIGRAÇÃO ASSISTIDA: BRIEFINGS, NOTIFICAÇÕES E PREFERÊNCIAS
-- ==============================================================================
-- Esta migração é 100% incremental, idempotente e segura:
-- 1. Estende public.user_preferences com horários e fuso horário
-- 2. Provisiona public.notifications com isolamento estrito por usuário e RLS
-- 3. Provisiona public.briefings e public.briefing_items com RLS
-- 4. Preserva integralmente todas as tabelas, índices e dados existentes
-- ==============================================================================

-- 1. Estender public.user_preferences com campos de horários de briefing e fuso
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS morning_time TEXT DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS evening_time TEXT DEFAULT '20:00',
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Sao_Paulo';

-- 2. Provisionar tabela de notificações por usuário
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT,
  category TEXT NOT NULL DEFAULT 'acontecimentos',
  read BOOLEAN NOT NULL DEFAULT FALSE,
  event_id TEXT REFERENCES public.events(id) ON DELETE SET NULL,
  entity_id TEXT REFERENCES public.entities(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de performance para notificações
CREATE INDEX IF NOT EXISTS idx_notifications_user_date 
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
  ON public.notifications (user_id, read) 
  WHERE read = FALSE;

-- 3. Provisionar tabela de briefings por usuário
CREATE TABLE IF NOT EXISTS public.briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('morning', 'evening')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'SENT', 'FAILED')) DEFAULT 'READY',
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefings_user_scheduled 
  ON public.briefings (user_id, scheduled_for DESC);

-- 4. Itens dos briefings (M2M com events)
CREATE TABLE IF NOT EXISTS public.briefing_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID NOT NULL REFERENCES public.briefings(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES public.events(id) ON DELETE CASCADE,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefing_items_briefing 
  ON public.briefing_items (briefing_id, order_index ASC);

-- ==============================================================================
-- 5. ROW LEVEL SECURITY (RLS) & POLICIES
-- ==============================================================================

-- 5.1 Notificações
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuário lê suas próprias notificações" ON public.notifications;
CREATE POLICY "Usuário lê suas próprias notificações" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuário atualiza suas próprias notificações" ON public.notifications;
CREATE POLICY "Usuário atualiza suas próprias notificações" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuário exclui suas próprias notificações" ON public.notifications;
CREATE POLICY "Usuário exclui suas próprias notificações" ON public.notifications
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role gerencia todas as notificações" ON public.notifications;
CREATE POLICY "Service role gerencia todas as notificações" ON public.notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5.2 Briefings
ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuário lê seus próprios briefings" ON public.briefings;
CREATE POLICY "Usuário lê seus próprios briefings" ON public.briefings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role gerencia briefings" ON public.briefings;
CREATE POLICY "Service role gerencia briefings" ON public.briefings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5.3 Itens dos Briefings
ALTER TABLE public.briefing_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuário lê itens de seus briefings" ON public.briefing_items;
CREATE POLICY "Usuário lê itens de seus briefings" ON public.briefing_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.briefings b 
      WHERE b.id = briefing_items.briefing_id 
        AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role gerencia itens de briefings" ON public.briefing_items;
CREATE POLICY "Service role gerencia itens de briefings" ON public.briefing_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
