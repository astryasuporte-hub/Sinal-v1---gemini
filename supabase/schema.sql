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
