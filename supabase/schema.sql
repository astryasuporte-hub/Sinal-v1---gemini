-- ==============================================================================
-- SINAL v1 — SCHEMA COMPLETO DE MIGRAÇÃO SUPABASE (POSTGRESQL)
-- ==============================================================================
-- Este script provisiona toda a arquitetura de dados da Sinal:
-- 1. Perfis e Preferências integradas ao Supabase Auth (auth.users)
-- 2. Acontecimentos (Events), Fontes (Sources), Tópicos (Topics), Entidades (Entities)
-- 3. Relações e Linhas do Tempo (Timeline, M2M)
-- 4. Itens Salvos, Histórico de Leitura e Itens Seguidos
-- 5. Row Level Security (RLS) e Políticas de Acesso
-- 6. Trigger automático para provisionamento de novo usuário
-- 7. Carga inicial de tópicos e fontes essenciais
-- ==============================================================================

-- 1. Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. TABELAS DE USUÁRIO E PERFIL (Integradas com auth.users)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  plan_name TEXT DEFAULT 'TRIAL_7D',
  subscription_status TEXT DEFAULT 'TRIAL_ACTIVE', -- 'TRIAL_ACTIVE', 'ACTIVE', 'PAST_DUE', 'CANCELED'
  trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_morning_briefing BOOLEAN DEFAULT TRUE,
  email_evening_briefing BOOLEAN DEFAULT TRUE,
  email_breaking_alerts BOOLEAN DEFAULT TRUE,
  weekend_edition BOOLEAN DEFAULT FALSE,
  briefing_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 3. TABELAS DO MODELO DE CONHECIMENTO E INFORMAÇÃO
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Geral',
  brand_color TEXT DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('company', 'person', 'organization')),
  description TEXT,
  sector TEXT,
  role TEXT,
  organization TEXT,
  website TEXT,
  avatar_url TEXT,
  brand_color TEXT DEFAULT '#10b981',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL DEFAULT 'Geral',
  brand_color TEXT DEFAULT '#64748b',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  what_happened TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Tecnologia',
  relevance_score INTEGER DEFAULT 85,
  image_url TEXT,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relação Evento <-> Fontes Citadas com URL primária
CREATE TABLE IF NOT EXISTS public.event_sources (
  event_id TEXT REFERENCES public.events(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES public.sources(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  headline TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, source_id, url)
);

-- Relação Evento <-> Tópicos
CREATE TABLE IF NOT EXISTS public.event_topics (
  event_id TEXT REFERENCES public.events(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES public.topics(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, topic_id)
);

-- Relação Evento <-> Entidades Envolvidas
CREATE TABLE IF NOT EXISTS public.event_entities (
  event_id TEXT REFERENCES public.events(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES public.entities(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, entity_id)
);

-- Linha do Tempo dos Fatos de um Acontecimento
CREATE TABLE IF NOT EXISTS public.event_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT REFERENCES public.events(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,
  event_time TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 4. TABELAS DE PERSONALIZAÇÃO E INTERAÇÃO DO USUÁRIO
-- ==============================================================================

-- Acontecimentos Salvos / Marcados
CREATE TABLE IF NOT EXISTS public.user_saved_events (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES public.events(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, event_id)
);

-- Tópicos Seguidos
CREATE TABLE IF NOT EXISTS public.user_followed_topics (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES public.topics(id) ON DELETE CASCADE,
  followed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, topic_id)
);

-- Entidades Seguidas
CREATE TABLE IF NOT EXISTS public.user_followed_entities (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES public.entities(id) ON DELETE CASCADE,
  followed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, entity_id)
);

-- Fontes Seguidas
CREATE TABLE IF NOT EXISTS public.user_followed_sources (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES public.sources(id) ON DELETE CASCADE,
  followed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, source_id)
);

-- Histórico de Leitura
CREATE TABLE IF NOT EXISTS public.user_reading_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES public.events(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 5. ÍNDICES DE PERFORMANCE
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_events_published_at ON public.events (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_category ON public.events (category);
CREATE INDEX IF NOT EXISTS idx_events_relevance ON public.events (relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_event_sources_event ON public.event_sources (event_id);
CREATE INDEX IF NOT EXISTS idx_event_topics_event ON public.event_topics (event_id);
CREATE INDEX IF NOT EXISTS idx_event_entities_event ON public.event_entities (event_id);
CREATE INDEX IF NOT EXISTS idx_event_timeline_event ON public.event_timeline (event_id, order_index ASC);
CREATE INDEX IF NOT EXISTS idx_user_saved_user ON public.user_saved_events (user_id);
CREATE INDEX IF NOT EXISTS idx_user_history_user ON public.user_reading_history (user_id, viewed_at DESC);

-- ==============================================================================
-- 6. TRIGGER AUTOMÁTICO: NOVO USUÁRIO -> PERFIL + PREFERÊNCIAS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (id, briefing_email)
  VALUES (
    NEW.id,
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_saved_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_followed_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_followed_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_followed_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reading_history ENABLE ROW LEVEL SECURITY;

-- Políticas de Leitura Pública para Conteúdo
CREATE POLICY "Leitura pública de tópicos" ON public.topics FOR SELECT USING (true);
CREATE POLICY "Leitura pública de entidades" ON public.entities FOR SELECT USING (true);
CREATE POLICY "Leitura pública de fontes" ON public.sources FOR SELECT USING (true);
CREATE POLICY "Leitura pública de acontecimentos" ON public.events FOR SELECT USING (true);
CREATE POLICY "Leitura pública de fontes do acontecimento" ON public.event_sources FOR SELECT USING (true);
CREATE POLICY "Leitura pública de tópicos do acontecimento" ON public.event_topics FOR SELECT USING (true);
CREATE POLICY "Leitura pública de entidades do acontecimento" ON public.event_entities FOR SELECT USING (true);
CREATE POLICY "Leitura pública de timeline do acontecimento" ON public.event_timeline FOR SELECT USING (true);

-- Políticas de Perfis (Usuário lê e edita o seu perfil; Super Admin lê e gerencia todos os perfis)
DROP POLICY IF EXISTS "Usuário lê o próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Super Admin lê todos os perfis" ON public.profiles;
DROP POLICY IF EXISTS "Usuário ou Super Admin lê perfis" ON public.profiles;
DROP POLICY IF EXISTS "Usuário edita o próprio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Usuário insere o próprio perfil" ON public.profiles;

CREATE POLICY "Usuário ou Super Admin lê perfis" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id 
    OR (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

CREATE POLICY "Usuário insere o próprio perfil" ON public.profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id 
    OR (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
  );

CREATE POLICY "Usuário ou Super Admin edita o próprio perfil" ON public.profiles
  FOR UPDATE USING (
    auth.uid() = id 
    OR (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
  );

-- Políticas de Preferências
CREATE POLICY "Usuário gerencia suas preferências" ON public.user_preferences
  FOR ALL USING (auth.uid() = id);

-- Políticas de Itens Salvos
CREATE POLICY "Usuário visualiza seus salvos" ON public.user_saved_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Usuário adiciona itens aos salvos" ON public.user_saved_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário remove itens dos salvos" ON public.user_saved_events
  FOR DELETE USING (auth.uid() = user_id);

-- Políticas de Tópicos Seguidos
CREATE POLICY "Usuário visualiza tópicos que segue" ON public.user_followed_topics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Usuário segue tópico" ON public.user_followed_topics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário desseguir tópico" ON public.user_followed_topics
  FOR DELETE USING (auth.uid() = user_id);

-- Políticas de Entidades Seguidas
CREATE POLICY "Usuário visualiza entidades que segue" ON public.user_followed_entities
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Usuário segue entidade" ON public.user_followed_entities
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário desseguir entidade" ON public.user_followed_entities
  FOR DELETE USING (auth.uid() = user_id);

-- Políticas de Fontes Seguidas
CREATE POLICY "Usuário visualiza fontes que segue" ON public.user_followed_sources
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Usuário segue fonte" ON public.user_followed_sources
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuário desseguir fonte" ON public.user_followed_sources
  FOR DELETE USING (auth.uid() = user_id);

-- Políticas de Histórico
CREATE POLICY "Usuário gerencia seu histórico" ON public.user_reading_history
  FOR ALL USING (auth.uid() = user_id);

-- ==============================================================================
-- 8. CARGA INICIAL (SEEDS ESSENCIAIS DE TÓPICOS E FONTES)
-- ==============================================================================

INSERT INTO public.topics (id, name, slug, description, category, brand_color) VALUES
  ('top-ai', 'Inteligência Artificial', 'ia', 'Modelos de linguagem, visão computacional, agentes autônomos e chips.', 'Tecnologia', '#38bdf8'),
  ('top-macro', 'Macroeconomia', 'macroeconomia', 'Inflação, taxas de juros, bancos centrais e fluxo cambial.', 'Economia', '#34d399'),
  ('top-semis', 'Semicondutores & Hardware', 'semicondutores', 'Cadeia de suprimentos de chips, litografia e fundições.', 'Tecnologia', '#f59e0b'),
  ('top-energy', 'Transição Energética', 'energia', 'Petróleo, energia solar, baterias e matriz elétrica global.', 'Geopolítica', '#a855f7'),
  ('top-geopol', 'Geopolítica & Defesa', 'geopolitica', 'Tensões comerciais, acordos bilaterais e segurança nacional.', 'Geopolítica', '#f43f5e')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sources (id, name, domain, category, brand_color) VALUES
  ('src-reuters', 'Reuters', 'reuters.com', 'Agência Internacional', '#ff8000'),
  ('src-bloomberg', 'Bloomberg', 'bloomberg.com', 'Finanças & Mercados', '#2b7fff'),
  ('src-ft', 'Financial Times', 'ft.com', 'Economia Global', '#ffb3ba'),
  ('src-wsj', 'The Wall Street Journal', 'wsj.com', 'Negócios & Política', '#334155'),
  ('src-techcrunch', 'TechCrunch', 'techcrunch.com', 'Startups & Tecnologia', '#00d084'),
  ('src-valor', 'Valor Econômico', 'valor.globo.com', 'Economia Nacional', '#15803d')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.entities (id, name, type, description, sector, brand_color) VALUES
  ('ent-nvidia', 'NVIDIA Corporation', 'company', 'Líder global em GPUs, aceleradores de computação acelerada e plataformas de IA.', 'Semicondutores', '#76b900'),
  ('ent-openai', 'OpenAI', 'company', 'Laboratório de pesquisa e desenvolvimento de inteligência artificial generativa.', 'Inteligência Artificial', '#10a37f'),
  ('ent-fed', 'Federal Reserve (Fed)', 'organization', 'Banco central dos Estados Unidos responsável pela política monetária e taxas de juros.', 'Setor Público & Finanças', '#1e40af'),
  ('ent-tsmc', 'TSMC', 'company', 'Maior fabricante terceirizada de semicondutores do mundo.', 'Semicondutores', '#dc2626')
ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- 9. TABELAS DE SEGURANÇA FINANCEIRA, ASSINATURAS E RATE LIMITING DISTRIBUÍDO
-- ==============================================================================
-- As tabelas financeiras canônicas residem no schema internal:
--   - internal.billing_payments (id UUID, provider_payment_id TEXT, amount INTEGER)
--   - internal.billing_events (id UUID, provider_event_id TEXT, payload JSONB, processed BOOLEAN)
-- Assinaturas ativas residem na tabela canônica:
--   - public.subscriptions (id UUID, user_id UUID, plan TEXT, status TEXT)
-- Rate limiting distribuído:
--   - internal.rate_limit_counters (key TEXT, tokens INTEGER, window_start TIMESTAMPTZ)
-- RBAC administrativo:
--   - public.user_roles (id UUID, user_id UUID, role TEXT)
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS internal;

CREATE TABLE IF NOT EXISTS internal.rate_limit_counters (
  key TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'editor', 'support', 'viewer', 'subscriber')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window ON internal.rate_limit_counters (window_start);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN TRUE;
  END IF;

  IF (auth.jwt() -> 'app_metadata' ->> 'is_admin')::BOOLEAN IS TRUE 
     OR (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'super_admin') THEN
    RETURN TRUE;
  END IF;

  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
      AND role IN ('admin', 'super_admin')
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

ALTER TABLE internal.rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
CREATE POLICY "user_roles_select_own" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin() = TRUE);

DROP POLICY IF EXISTS "user_roles_service_role" ON public.user_roles;
CREATE POLICY "user_roles_service_role" ON public.user_roles
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "rate_limit_service_role" ON internal.rate_limit_counters;
CREATE POLICY "rate_limit_service_role" ON internal.rate_limit_counters
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_ms BIGINT
)
RETURNS JSONB AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_elapsed_ms BIGINT;
  v_allowed BOOLEAN;
  v_retry_after INTEGER := 0;
BEGIN
  -- Validação de privilégio de banco
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita ao papel autorizado (service_role).'
      USING ERRCODE = '42501';
  END IF;

  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'Parâmetro p_key não pode ser vazio.' USING ERRCODE = '22023';
  END IF;
  IF p_max_requests <= 0 THEN
    RAISE EXCEPTION 'Parâmetro p_max_requests deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF p_window_ms <= 0 THEN
    RAISE EXCEPTION 'Parâmetro p_window_ms deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO internal.rate_limit_counters (key, tokens, window_start, updated_at)
  VALUES (p_key, 1, v_now, v_now)
  ON CONFLICT (key) DO UPDATE
  SET 
    tokens = CASE 
      WHEN EXTRACT(EPOCH FROM (v_now - rate_limit_counters.window_start)) * 1000 >= p_window_ms THEN 1
      ELSE rate_limit_counters.tokens + 1
    END,
    window_start = CASE 
      WHEN EXTRACT(EPOCH FROM (v_now - rate_limit_counters.window_start)) * 1000 >= p_window_ms THEN v_now
      ELSE rate_limit_counters.window_start
    END,
    updated_at = v_now
  RETURNING tokens, window_start INTO v_count, v_window_start;

  v_elapsed_ms := ROUND(EXTRACT(EPOCH FROM (v_now - v_window_start)) * 1000);

  IF v_count > p_max_requests THEN
    v_allowed := FALSE;
    v_retry_after := CEIL((p_window_ms - v_elapsed_ms)::NUMERIC / 1000);
    IF v_retry_after < 1 THEN
      v_retry_after := 1;
    END IF;
  ELSE
    v_allowed := TRUE;
    v_retry_after := 0;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'current', v_count,
    'limit', p_max_requests,
    'retry_after', v_retry_after,
    'remaining', GREATEST(0, p_max_requests - v_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_payment_and_activate_subscription_atomic(
  p_provider_payment_id TEXT,
  p_event_id TEXT,
  p_expected_amount INTEGER,
  p_expected_currency TEXT DEFAULT 'BRL',
  p_provider TEXT DEFAULT 'zynpay',
  p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = internal, public, pg_temp
AS $$
DECLARE
  v_charge RECORD;
  v_user_id UUID;
  v_sub_updated_rows INTEGER := 0;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado: operação restrita ao backend service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_provider_payment_id IS NULL OR length(trim(p_provider_payment_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PARAM', 'error', 'Identificador de pagamento obrigatório.');
  END IF;
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PARAM', 'error', 'Identificador de evento obrigatório.');
  END IF;
  IF p_expected_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_PARAM', 'error', 'Valor esperado deve ser maior que zero.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM internal.billing_events 
    WHERE provider = p_provider 
      AND provider_event_id = p_event_id 
      AND processed = TRUE
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'message', 'Evento já processado anteriormente (idempotência)'
    );
  END IF;

  SELECT * INTO v_charge
  FROM internal.billing_payments
  WHERE provider_payment_id = p_provider_payment_id
     OR (p_provider_payment_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND id = p_provider_payment_id::UUID)
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CHARGE_NOT_FOUND',
      'error', 'Cobrança não encontrada em internal.billing_payments.'
    );
  END IF;

  v_user_id := v_charge.user_id;
  IF v_user_id IS NULL AND v_charge.checkout_data ? 'user_email' THEN
    SELECT u.id INTO v_user_id
    FROM auth.users u
    WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(v_charge.checkout_data ->> 'user_email'))
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'USER_NOT_FOUND',
      'error', 'Cobrança não está vinculada a um usuário válido do sistema.'
    );
  END IF;

  IF COALESCE(v_charge.provider, 'zynpay') <> COALESCE(p_provider, 'zynpay') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'PROVIDER_MISMATCH',
      'error', 'Provedor divergente da cobrança registrada.'
    );
  END IF;

  IF v_charge.status = 'PAID' THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'message', 'Cobrança já estava confirmada anteriormente.'
    );
  END IF;

  IF v_charge.status NOT IN ('PENDING', 'PROCESSING') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_PREVIOUS_STATUS',
      'error', 'Cobrança em status inválido para liquidação: ' || v_charge.status
    );
  END IF;

  IF v_charge.amount <> p_expected_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'AMOUNT_MISMATCH',
      'error', format('Valor divergente: esperado %s centavos, recebido %s centavos.', v_charge.amount, p_expected_amount)
    );
  END IF;

  IF COALESCE(v_charge.currency, 'BRL') <> COALESCE(p_expected_currency, 'BRL') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'CURRENCY_MISMATCH',
      'error', 'Moeda divergente da cobrança registrada.'
    );
  END IF;

  INSERT INTO internal.billing_events (
    id,
    provider,
    provider_event_id,
    event_type,
    payload,
    processed,
    processed_at,
    context,
    context_id,
    created_at
  ) VALUES (
    gen_random_uuid(),
    p_provider,
    p_event_id,
    'charge.paid',
    p_raw_payload,
    TRUE,
    v_now,
    'payment',
    v_charge.id::TEXT,
    v_now
  );

  UPDATE internal.billing_payments
  SET 
    status = 'PAID',
    approved_at = v_now,
    last_synced_at = v_now,
    updated_at = v_now
  WHERE id = v_charge.id;

  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = v_user_id) THEN
    UPDATE public.subscriptions
    SET 
      plan = 'pro',
      status = 'active',
      current_period_start = v_now,
      current_period_end = v_now + INTERVAL '30 days',
      cancel_at_period_end = FALSE,
      provider = p_provider,
      provider_subscription_id = COALESCE(v_charge.provider_payment_id, p_provider_payment_id),
      billing_updated_at = v_now,
      updated_at = v_now
    WHERE user_id = v_user_id;

    GET DIAGNOSTICS v_sub_updated_rows = ROW_COUNT;
  ELSE
    INSERT INTO public.subscriptions (
      id,
      user_id,
      plan,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end,
      provider,
      provider_subscription_id,
      billing_updated_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      'pro',
      'active',
      v_now,
      v_now + INTERVAL '30 days',
      FALSE,
      p_provider,
      COALESCE(v_charge.provider_payment_id, p_provider_payment_id),
      v_now,
      v_now,
      v_now
    );

    GET DIAGNOSTICS v_sub_updated_rows = ROW_COUNT;
  END IF;

  IF v_sub_updated_rows = 0 THEN
    RAISE EXCEPTION 'FALHA_ATOMICIDADE: Não foi possível atualizar a assinatura do usuário em public.subscriptions.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'charge_id', v_charge.id,
    'provider_payment_id', COALESCE(v_charge.provider_payment_id, p_provider_payment_id),
    'user_id', v_user_id,
    'amount', v_charge.amount,
    'approved_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_and_activate_subscription_atomic(TEXT, TEXT, INTEGER, TEXT, TEXT, JSONB) TO service_role;

