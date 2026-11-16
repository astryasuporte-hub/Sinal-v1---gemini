-- ==============================================================================
-- FATOSBR ADMIN — BIBLIOTECA DE IMAGENS & IMPORTAÇÃO EM LOTE (ZIP)
-- ==============================================================================
-- Migração 100% aditiva, idempotente e não destrutiva:
-- 1. Garante colunas image_url / slug em public.entities e logo_url em public.news_sources
-- 2. Provisiona bucket público "brand-assets" no Supabase Storage com RLS estrito
-- 3. Cria tabelas public.image_import_batches e public.image_import_items para
--    pré-visualização, auditoria, histórico, relatório de erros e reprocessamento
-- ==============================================================================

-- 1. Garantir colunas canônicas sem alterar constraints nem dados existentes
ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- Backfill seguro de slug apenas onde estiver nulo
UPDATE public.entities
SET slug = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
WHERE slug IS NULL AND name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entities_slug ON public.entities (slug);

ALTER TABLE public.news_sources
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

CREATE INDEX IF NOT EXISTS idx_news_sources_domain ON public.news_sources (domain);
CREATE INDEX IF NOT EXISTS idx_news_sources_slug ON public.news_sources (slug);

-- 2. Provisionamento do Bucket Permanente no Supabase Storage (brand-assets)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-assets',
  'brand-assets',
  TRUE,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET
  public = TRUE,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

-- Policies de Storage: leitura pública de ativos e escrita restrita a admins / service_role
DROP POLICY IF EXISTS "Leitura pública de brand-assets" ON storage.objects;
CREATE POLICY "Leitura pública de brand-assets" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "Admins gerenciam brand-assets" ON storage.objects;
CREATE POLICY "Admins gerenciam brand-assets" ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'brand-assets' AND public.is_admin() = TRUE)
  WITH CHECK (bucket_id = 'brand-assets' AND public.is_admin() = TRUE);

DROP POLICY IF EXISTS "Service role gerencia brand-assets" ON storage.objects;
CREATE POLICY "Service role gerencia brand-assets" ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'brand-assets')
  WITH CHECK (bucket_id = 'brand-assets');

-- 3. Tabela de Lotes de Importação (Histórico & Auditoria)
CREATE TABLE IF NOT EXISTS public.image_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'PREVIEW'
    CHECK (status IN ('PREVIEW', 'APPLYING', 'COMPLETED', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED')),
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_email TEXT,
  total_found INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  pending_review_count INTEGER NOT NULL DEFAULT 0,
  unmatched_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  applied_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  manifest_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_report JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_import_batches_created_at
  ON public.image_import_batches (created_at DESC);

-- 4. Tabela de Itens Individuais do Lote (Rastreamento, Rollback Seguro e Reprocessamento)
CREATE TABLE IF NOT EXISTS public.image_import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.image_import_batches(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('COMPANY', 'PERSON', 'SOURCE')),
  target_id TEXT,
  target_name TEXT,
  target_slug TEXT,
  target_domain TEXT,
  zip_entry_path TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER NOT NULL DEFAULT 0,
  classification TEXT NOT NULL DEFAULT 'approved',
  requires_brand_review BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'APPROVED'
    CHECK (status IN ('APPROVED', 'PENDING_REVIEW', 'UNMATCHED', 'INVALID', 'APPLIED', 'FAILED', 'SKIPPED')),
  previous_image_url TEXT,
  staged_storage_path TEXT,
  public_image_url TEXT,
  error_message TEXT,
  raw_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_import_items_batch_status
  ON public.image_import_items (batch_id, status);

-- 5. RLS Estrito: somente administradores autorizados e service_role
ALTER TABLE public.image_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_import_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins gerenciam image_import_batches" ON public.image_import_batches;
CREATE POLICY "Admins gerenciam image_import_batches" ON public.image_import_batches
  FOR ALL
  TO authenticated
  USING (public.is_admin() = TRUE)
  WITH CHECK (public.is_admin() = TRUE);

DROP POLICY IF EXISTS "Service role gerencia image_import_batches" ON public.image_import_batches;
CREATE POLICY "Service role gerencia image_import_batches" ON public.image_import_batches
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins gerenciam image_import_items" ON public.image_import_items;
CREATE POLICY "Admins gerenciam image_import_items" ON public.image_import_items
  FOR ALL
  TO authenticated
  USING (public.is_admin() = TRUE)
  WITH CHECK (public.is_admin() = TRUE);

DROP POLICY IF EXISTS "Service role gerencia image_import_items" ON public.image_import_items;
CREATE POLICY "Service role gerencia image_import_items" ON public.image_import_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
