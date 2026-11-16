/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-Side Image Library & Bulk ZIP Import Service
 *
 * Responsabilidades:
 * 1. Matching determinístico de empresas (public.entities, COMPANY), pessoas (public.entities, PERSON)
 *    e fontes (public.news_sources) por slug, nome e domínio.
 * 2. Pré-visualização segura (dry-run) contabilizando encontradas, aprovadas, sem correspondência e pendentes.
 * 3. Bloqueio automático de importação para itens com classificação "requires_brand_review".
 * 4. Confirmação explícita com upload permanente ao bucket "brand-assets" do Supabase Storage.
 * 5. Atualização transacional segura de entities.image_url e news_sources.logo_url APÓS sucesso do upload,
 *    preservando URLs anteriores em caso de falha.
 * 6. Histórico de importações, relatório de erros e reprocessamento de falhas.
 */

import crypto from 'crypto';
import { getServerSupabase, isDatabaseConfigured } from './db.js';
import { executeSql, isPostgresConfigured } from './postgres.js';
import {
  inspectAndExtractImageZip,
  ManifestTargetType,
  ParsedManifestEntry,
  ValidatedZipImageAsset
} from './zipImageValidator.js';

export const BRAND_ASSETS_BUCKET = 'brand-assets';

export interface CatalogEntityRecord {
  id: string;
  name: string;
  slug?: string | null;
  type: string;
  website?: string | null;
  image_url?: string | null;
  logo_url?: string | null;
  avatar_url?: string | null;
}

export interface CatalogSourceRecord {
  id: string;
  name: string;
  slug?: string | null;
  domain: string;
  logo_url?: string | null;
}

export type PreviewItemStatus =
  | 'APPROVED'
  | 'PENDING_REVIEW'
  | 'UNMATCHED'
  | 'INVALID'
  | 'APPLIED'
  | 'FAILED'
  | 'SKIPPED';

export interface ImageImportPreviewItem {
  id: string;
  targetType: ManifestTargetType;
  targetId: string | null;
  targetName: string;
  targetSlug: string | null;
  targetDomain: string | null;
  zipEntryPath: string;
  mimeType: string | null;
  byteSize: number;
  classification: string;
  requiresBrandReview: boolean;
  status: PreviewItemStatus;
  previousImageUrl: string | null;
  publicImageUrl: string | null;
  stagedStoragePath: string | null;
  previewDataUrl?: string | null;
  errorMessage?: string | null;
  retryCount: number;
}

export interface ImageImportBatchSummary {
  batchId: string;
  status: 'PREVIEW' | 'APPLYING' | 'COMPLETED' | 'PARTIAL_FAILURE' | 'FAILED' | 'CANCELLED';
  fileName: string;
  fileSizeBytes: number;
  uploadedByEmail?: string | null;
  counts: {
    totalFound: number;
    approved: number;
    pendingReview: number;
    unmatched: number;
    invalid: number;
    applied: number;
    failed: number;
    skipped: number;
  };
  items: ImageImportPreviewItem[];
  errorReport: Array<{
    itemId: string;
    zipEntryPath: string;
    targetName: string;
    targetType: ManifestTargetType;
    error: string;
  }>;
  createdAt: string;
  confirmedAt?: string | null;
  completedAt?: string | null;
}

export interface AdminActorIdentity {
  userId: string | null;
  email: string | null;
}

export function normalizeMatchKey(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeDomain(value?: string | null): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const withProto = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    const url = new URL(withProto);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split(':')[0]
      .trim()
      .toLowerCase();
  }
}

export function matchCatalogRecord(
  entry: ParsedManifestEntry,
  entities: CatalogEntityRecord[],
  sources: CatalogSourceRecord[]
):
  | { matched: true; targetId: string; targetName: string; targetSlug: string | null; targetDomain: string | null; previousImageUrl: string | null }
  | { matched: false } {
  const entrySlugKey = normalizeMatchKey(entry.slug);
  const entryNameKey = normalizeMatchKey(entry.name);
  const entryDomainKey = normalizeDomain(entry.domain);

  if (entry.targetType === 'SOURCE') {
    // Prioridade 1: Domínio exato em public.news_sources
    if (entryDomainKey) {
      const byDomain = sources.find((s) => normalizeDomain(s.domain) === entryDomainKey);
      if (byDomain) {
        return {
          matched: true,
          targetId: String(byDomain.id),
          targetName: byDomain.name,
          targetSlug: byDomain.slug || null,
          targetDomain: byDomain.domain,
          previousImageUrl: byDomain.logo_url || null
        };
      }
    }

    // Prioridade 2: Slug
    if (entrySlugKey) {
      const bySlug = sources.find(
        (s) =>
          normalizeMatchKey(s.slug) === entrySlugKey ||
          normalizeMatchKey(String(s.id).replace(/^src-/, '')) === entrySlugKey
      );
      if (bySlug) {
        return {
          matched: true,
          targetId: String(bySlug.id),
          targetName: bySlug.name,
          targetSlug: bySlug.slug || null,
          targetDomain: bySlug.domain,
          previousImageUrl: bySlug.logo_url || null
        };
      }
    }

    // Prioridade 3: Nome normalizado
    if (entryNameKey) {
      const byName = sources.find((s) => normalizeMatchKey(s.name) === entryNameKey);
      if (byName) {
        return {
          matched: true,
          targetId: String(byName.id),
          targetName: byName.name,
          targetSlug: byName.slug || null,
          targetDomain: byName.domain,
          previousImageUrl: byName.logo_url || null
        };
      }
    }

    return { matched: false };
  }

  // Entities: COMPANY ou PERSON
  const candidates = entities.filter((e) => {
    const dbType = String(e.type || '').trim().toUpperCase();
    if (entry.targetType === 'PERSON') {
      return dbType === 'PERSON';
    }
    return dbType === 'COMPANY' || dbType === 'ORGANIZATION';
  });

  // Prioridade 1: Slug / ID sem prefixo
  if (entrySlugKey) {
    const bySlug = candidates.find(
      (e) =>
        normalizeMatchKey(e.slug) === entrySlugKey ||
        normalizeMatchKey(String(e.id).replace(/^ent-/, '')) === entrySlugKey ||
        normalizeMatchKey(e.name) === entrySlugKey
    );
    if (bySlug) {
      return {
        matched: true,
        targetId: String(bySlug.id),
        targetName: bySlug.name,
        targetSlug: bySlug.slug || normalizeMatchKey(bySlug.name),
        targetDomain: normalizeDomain(bySlug.website) || null,
        previousImageUrl: bySlug.image_url || bySlug.logo_url || bySlug.avatar_url || null
      };
    }
  }

  // Prioridade 2: Nome normalizado
  if (entryNameKey) {
    const byName = candidates.find((e) => normalizeMatchKey(e.name) === entryNameKey);
    if (byName) {
      return {
        matched: true,
        targetId: String(byName.id),
        targetName: byName.name,
        targetSlug: byName.slug || normalizeMatchKey(byName.name),
        targetDomain: normalizeDomain(byName.website) || null,
        previousImageUrl: byName.image_url || byName.logo_url || byName.avatar_url || null
      };
    }
  }

  // Prioridade 3 (apenas COMPANY): website/domínio
  if (entry.targetType === 'COMPANY' && entryDomainKey) {
    const byDomain = candidates.find((e) => normalizeDomain(e.website) === entryDomainKey);
    if (byDomain) {
      return {
        matched: true,
        targetId: String(byDomain.id),
        targetName: byDomain.name,
        targetSlug: byDomain.slug || normalizeMatchKey(byDomain.name),
        targetDomain: normalizeDomain(byDomain.website) || null,
        previousImageUrl: byDomain.image_url || byDomain.logo_url || byDomain.avatar_url || null
      };
    }
  }

  return { matched: false };
}

/**
 * Resolve colunas existentes de forma resiliente para evitar falhas SQL por diferenças de esquema.
 */
async function getTableColumns(tableName: string): Promise<Set<string>> {
  if (!isPostgresConfigured()) return new Set();
  try {
    const res = await executeSql(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    return new Set((res.rows || []).map((r: any) => String(r.column_name)));
  } catch {
    return new Set();
  }
}

export async function fetchCatalogForMatching(): Promise<{
  entities: CatalogEntityRecord[];
  sources: CatalogSourceRecord[];
}> {
  // 1. PostgreSQL direto (preferencial)
  if (isPostgresConfigured()) {
    try {
      const [entRes, srcRes] = await Promise.all([
        executeSql(`SELECT * FROM public.entities ORDER BY name ASC`),
        executeSql(`SELECT * FROM public.news_sources ORDER BY name ASC`)
      ]);
      return {
        entities: (entRes.rows || []) as CatalogEntityRecord[],
        sources: (srcRes.rows || []) as CatalogSourceRecord[]
      };
    } catch (pgErr: any) {
      console.warn('[ImageLibrary] Erro ao consultar PostgreSQL direto, usando Supabase Client:', pgErr?.message);
    }
  }

  // 2. Fallback via Supabase Client (service_role ou test mock)
  const supabase = getServerSupabase();
  const [entRes, srcRes] = await Promise.all([
    supabase.from('entities').select('*').order('name'),
    supabase.from('news_sources').select('*').order('name')
  ]);

  return {
    entities: ((entRes.data as CatalogEntityRecord[]) || []),
    sources: ((srcRes.data as CatalogSourceRecord[]) || [])
  };
}

/**
 * Garante a existência do bucket brand-assets no Supabase Storage.
 */
export async function ensureBrandAssetsBucket(): Promise<void> {
  const supabase = getServerSupabase();
  try {
    const { data, error } = await supabase.storage.getBucket(BRAND_ASSETS_BUCKET);
    if (error || !data) {
      await supabase.storage.createBucket(BRAND_ASSETS_BUCKET, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
      });
    }
  } catch (err: any) {
    console.warn('[ImageLibrary] Aviso ao verificar bucket brand-assets:', err?.message);
  }
}

function buildTinyPreviewDataUrl(asset?: ValidatedZipImageAsset): string | null {
  if (!asset) return null;
  if (asset.byteSize > 256 * 1024) return null; // Evitar inflar payload JSON de preview
  return `data:${asset.mimeType};base64,${asset.buffer.toString('base64')}`;
}

export async function extractAdminActorFromRequest(req: any): Promise<AdminActorIdentity> {
  const authHeader = String(req?.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return { userId: null, email: null };
  }
  const token = authHeader.slice(7).trim();
  if (!token) return { userId: null, email: null };

  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data?.user) {
      return { userId: data.user.id, email: data.user.email || null };
    }
  } catch {}
  return { userId: null, email: null };
}

/**
 * Persistência de Batch e Itens no banco (PostgreSQL ou Supabase Client).
 */
async function saveBatchAndItems(
  batch: {
    id: string;
    status: string;
    fileName: string;
    fileSizeBytes: number;
    uploadedBy: string | null;
    uploadedByEmail: string | null;
    totalFound: number;
    approvedCount: number;
    pendingReviewCount: number;
    unmatchedCount: number;
    invalidCount: number;
    manifestSummary: any;
    errorReport: any[];
  },
  items: Array<{
    id: string;
    batchId: string;
    targetType: ManifestTargetType;
    targetId: string | null;
    targetName: string;
    targetSlug: string | null;
    targetDomain: string | null;
    zipEntryPath: string;
    mimeType: string | null;
    byteSize: number;
    classification: string;
    requiresBrandReview: boolean;
    status: PreviewItemStatus;
    previousImageUrl: string | null;
    stagedStoragePath: string | null;
    publicImageUrl: string | null;
    errorMessage: string | null;
    rawManifest: any;
    retryCount: number;
  }>
): Promise<void> {
  if (isPostgresConfigured()) {
    await executeSql(
      `INSERT INTO public.image_import_batches (
        id, status, file_name, file_size_bytes, uploaded_by, uploaded_by_email,
        total_found, approved_count, pending_review_count, unmatched_count, invalid_count,
        manifest_summary, error_report
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`,
      [
        batch.id,
        batch.status,
        batch.fileName,
        batch.fileSizeBytes,
        batch.uploadedBy,
        batch.uploadedByEmail,
        batch.totalFound,
        batch.approvedCount,
        batch.pendingReviewCount,
        batch.unmatchedCount,
        batch.invalidCount,
        JSON.stringify(batch.manifestSummary || {}),
        JSON.stringify(batch.errorReport || [])
      ]
    );

    for (const item of items) {
      await executeSql(
        `INSERT INTO public.image_import_items (
          id, batch_id, target_type, target_id, target_name, target_slug, target_domain,
          zip_entry_path, mime_type, byte_size, classification, requires_brand_review,
          status, previous_image_url, staged_storage_path, public_image_url, error_message, raw_manifest, retry_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19)`,
        [
          item.id,
          item.batchId,
          item.targetType,
          item.targetId,
          item.targetName,
          item.targetSlug,
          item.targetDomain,
          item.zipEntryPath,
          item.mimeType,
          item.byteSize,
          item.classification,
          item.requiresBrandReview,
          item.status,
          item.previousImageUrl,
          item.stagedStoragePath,
          item.publicImageUrl,
          item.errorMessage,
          JSON.stringify(item.rawManifest || {}),
          item.retryCount
        ]
      );
    }
    return;
  }

  const supabase = getServerSupabase();
  const { error: batchErr } = await supabase.from('image_import_batches').insert({
    id: batch.id,
    status: batch.status,
    file_name: batch.fileName,
    file_size_bytes: batch.fileSizeBytes,
    uploaded_by: batch.uploadedBy,
    uploaded_by_email: batch.uploadedByEmail,
    total_found: batch.totalFound,
    approved_count: batch.approvedCount,
    pending_review_count: batch.pendingReviewCount,
    unmatched_count: batch.unmatchedCount,
    invalid_count: batch.invalidCount,
    manifest_summary: batch.manifestSummary || {},
    error_report: batch.errorReport || []
  });
  if (batchErr) throw new Error(`DB_BATCH_INSERT_FAILED: ${batchErr.message}`);

  if (items.length > 0) {
    const { error: itemsErr } = await supabase.from('image_import_items').insert(
      items.map((item) => ({
        id: item.id,
        batch_id: item.batchId,
        target_type: item.targetType,
        target_id: item.targetId,
        target_name: item.targetName,
        target_slug: item.targetSlug,
        target_domain: item.targetDomain,
        zip_entry_path: item.zipEntryPath,
        mime_type: item.mimeType,
        byte_size: item.byteSize,
        classification: item.classification,
        requires_brand_review: item.requiresBrandReview,
        status: item.status,
        previous_image_url: item.previousImageUrl,
        staged_storage_path: item.stagedStoragePath,
        public_image_url: item.publicImageUrl,
        error_message: item.errorMessage,
        raw_manifest: item.rawManifest || {},
        retry_count: item.retryCount
      }))
    );
    if (itemsErr) throw new Error(`DB_ITEMS_INSERT_FAILED: ${itemsErr.message}`);
  }
}

async function loadBatchAndItems(batchId: string): Promise<{ batch: any; items: any[] } | null> {
  if (isPostgresConfigured()) {
    const bRes = await executeSql(`SELECT * FROM public.image_import_batches WHERE id = $1 LIMIT 1`, [batchId]);
    if (!bRes.rows.length) return null;
    const iRes = await executeSql(
      `SELECT * FROM public.image_import_items WHERE batch_id = $1 ORDER BY created_at ASC`,
      [batchId]
    );
    return { batch: bRes.rows[0], items: iRes.rows || [] };
  }

  const supabase = getServerSupabase();
  const { data: batch } = await supabase
    .from('image_import_batches')
    .select('*')
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) return null;

  const { data: items } = await supabase
    .from('image_import_items')
    .select('*')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });

  return { batch, items: items || [] };
}

async function updateItemStatusInDb(
  itemId: string,
  updates: {
    status: PreviewItemStatus;
    publicImageUrl?: string | null;
    errorMessage?: string | null;
    retryCount?: number;
  }
): Promise<void> {
  if (isPostgresConfigured()) {
    await executeSql(
      `UPDATE public.image_import_items
       SET status = $2,
           public_image_url = COALESCE($3, public_image_url),
           error_message = $4,
           retry_count = COALESCE($5, retry_count),
           updated_at = NOW()
       WHERE id = $1`,
      [
        itemId,
        updates.status,
        updates.publicImageUrl ?? null,
        updates.errorMessage ?? null,
        updates.retryCount ?? null
      ]
    );
    return;
  }

  const supabase = getServerSupabase();
  await supabase
    .from('image_import_items')
    .update({
      status: updates.status,
      ...(updates.publicImageUrl !== undefined ? { public_image_url: updates.publicImageUrl } : {}),
      error_message: updates.errorMessage ?? null,
      ...(updates.retryCount !== undefined ? { retry_count: updates.retryCount } : {}),
      updated_at: new Date().toISOString()
    })
    .eq('id', itemId);
}

async function updateBatchSummaryInDb(
  batchId: string,
  updates: {
    status: string;
    appliedCount: number;
    failedCount: number;
    skippedCount: number;
    errorReport: any[];
    confirmedAt?: string;
    completedAt?: string;
  }
): Promise<void> {
  if (isPostgresConfigured()) {
    await executeSql(
      `UPDATE public.image_import_batches
       SET status = $2,
           applied_count = $3,
           failed_count = $4,
           skipped_count = $5,
           error_report = $6::jsonb,
           confirmed_at = COALESCE($7::timestamptz, confirmed_at),
           completed_at = COALESCE($8::timestamptz, completed_at),
           updated_at = NOW()
       WHERE id = $1`,
      [
        batchId,
        updates.status,
        updates.appliedCount,
        updates.failedCount,
        updates.skippedCount,
        JSON.stringify(updates.errorReport || []),
        updates.confirmedAt || null,
        updates.completedAt || null
      ]
    );
    return;
  }

  const supabase = getServerSupabase();
  await supabase
    .from('image_import_batches')
    .update({
      status: updates.status,
      applied_count: updates.appliedCount,
      failed_count: updates.failedCount,
      skipped_count: updates.skippedCount,
      error_report: updates.errorReport || [],
      ...(updates.confirmedAt ? { confirmed_at: updates.confirmedAt } : {}),
      ...(updates.completedAt ? { completed_at: updates.completedAt } : {}),
      updated_at: new Date().toISOString()
    })
    .eq('id', batchId);
}

/**
 * Atualiza a URL da imagem no banco (entities.image_url ou news_sources.logo_url)
 * somente após confirmação do upload permanente no Storage.
 */
async function updateTargetRecordImageUrl(
  targetType: ManifestTargetType,
  targetId: string,
  publicUrl: string
): Promise<void> {
  if (isPostgresConfigured()) {
    if (targetType === 'SOURCE') {
      const cols = await getTableColumns('news_sources');
      const setClause = cols.has('updated_at')
        ? `logo_url = $2, updated_at = NOW()`
        : `logo_url = $2`;
      const res = await executeSql(
        `UPDATE public.news_sources SET ${setClause} WHERE id::text = $1 RETURNING id`,
        [targetId, publicUrl]
      );
      if (res.rowCount === 0) {
        throw new Error(`Fonte ${targetId} não encontrada em public.news_sources.`);
      }
      return;
    }

    const cols = await getTableColumns('entities');
    const setters: string[] = ['image_url = $2'];
    if (cols.has('logo_url') && targetType === 'COMPANY') setters.push('logo_url = $2');
    if (cols.has('avatar_url') && targetType === 'PERSON') setters.push('avatar_url = $2');
    if (cols.has('updated_at')) setters.push('updated_at = NOW()');

    const res = await executeSql(
      `UPDATE public.entities SET ${setters.join(', ')} WHERE id::text = $1 RETURNING id`,
      [targetId, publicUrl]
    );
    if (res.rowCount === 0) {
      throw new Error(`Entidade ${targetId} não encontrada em public.entities.`);
    }
    return;
  }

  const supabase = getServerSupabase();
  if (targetType === 'SOURCE') {
    const { error } = await supabase
      .from('news_sources')
      .update({ logo_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', targetId);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from('entities')
    .update({ image_url: publicUrl })
    .eq('id', targetId);
  if (error) throw new Error(error.message);
}

/**
 * Faz upload permanente para o bucket brand-assets e retorna URL pública.
 */
export async function uploadPermanentBrandAsset(params: {
  targetType: ManifestTargetType;
  targetId: string;
  targetSlug?: string | null;
  buffer: Buffer;
  mimeType: string;
  extension: string;
}): Promise<{ storagePath: string; publicUrl: string }> {
  const supabase = getServerSupabase();
  await ensureBrandAssetsBucket();

  const folder =
    params.targetType === 'COMPANY'
      ? 'entities/companies'
      : params.targetType === 'PERSON'
      ? 'entities/people'
      : 'sources';

  const safeId = normalizeMatchKey(params.targetId) || 'asset';
  const hash8 = crypto.createHash('sha256').update(params.buffer).digest('hex').slice(0, 8);
  const storagePath = `${folder}/${safeId}-${hash8}-${Date.now()}.${params.extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BRAND_ASSETS_BUCKET)
    .upload(storagePath, params.buffer, {
      contentType: params.mimeType,
      upsert: true,
      cacheControl: '31536000'
    });

  if (uploadError) {
    throw new Error(`STORAGE_UPLOAD_FAILED: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(BRAND_ASSETS_BUCKET)
    .getPublicUrl(storagePath);

  const publicUrl = publicUrlData?.publicUrl;
  if (!publicUrl) {
    throw new Error('STORAGE_PUBLIC_URL_FAILED: Não foi possível obter URL pública no Supabase Storage.');
  }

  return { storagePath, publicUrl };
}

/**
 * Passo 1: Pré-visualização (Dry-Run) de pacote ZIP sem alterar entities/news_sources.
 */
export async function previewImageLibraryZip(params: {
  zipBuffer: Buffer;
  fileName: string;
  actor: AdminActorIdentity;
}): Promise<{ success: boolean; error?: string; errorCode?: string; batch?: ImageImportBatchSummary }> {
  const inspection = await inspectAndExtractImageZip(params.zipBuffer);
  if (!inspection.valid) {
    return {
      success: false,
      error: inspection.error || 'Pacote ZIP inválido.',
      errorCode: inspection.errorCode
    };
  }

  const { entities, sources } = await fetchCatalogForMatching();
  const batchId = crypto.randomUUID();
  const supabase = getServerSupabase();
  await ensureBrandAssetsBucket();

  const itemsForDb: Array<any> = [];
  const itemsForResponse: ImageImportPreviewItem[] = [];
  const errorReport: ImageImportBatchSummary['errorReport'] = [];

  let approvedCount = 0;
  let pendingReviewCount = 0;
  let unmatchedCount = 0;
  let invalidCount = 0;

  for (const mEntry of inspection.manifestEntries) {
    const itemId = crypto.randomUUID();
    const asset = inspection.assetsByPath.get(mEntry.zipEntryPath);
    const assetError = inspection.invalidAssetErrors.get(mEntry.zipEntryPath);

    const match = matchCatalogRecord(mEntry, entities, sources);

    let status: PreviewItemStatus = 'APPROVED';
    let errorMessage: string | null = null;
    let stagedStoragePath: string | null = null;

    if (assetError || !asset) {
      status = 'INVALID';
      errorMessage = assetError || 'Arquivo de imagem ausente ou inválido.';
      invalidCount++;
    } else if (mEntry.requiresBrandReview) {
      // REGRA 5: Nunca importar automaticamente itens classificados como requires_brand_review
      status = 'PENDING_REVIEW';
      errorMessage = 'Bloqueado para importação automática (requires_brand_review).';
      pendingReviewCount++;
    } else if (!match.matched) {
      status = 'UNMATCHED';
      errorMessage = `Nenhum registro correspondente encontrado em ${
        mEntry.targetType === 'SOURCE' ? 'news_sources (domínio/slug/nome)' : 'entities (nome/slug)'
      }.`;
      unmatchedCount++;
    } else {
      status = 'APPROVED';
      approvedCount++;

      // Faz staging seguro no bucket privado/temporário apenas para itens aprovados
      const stagePath = `staging/${batchId}/${itemId}.${asset.extension}`;
      const { error: stageErr } = await supabase.storage
        .from(BRAND_ASSETS_BUCKET)
        .upload(stagePath, asset.buffer, {
          contentType: asset.mimeType,
          upsert: true
        });

      if (!stageErr) {
        stagedStoragePath = stagePath;
      } else {
        // Ainda permite aplicar caso o front reenvie o ZIP na confirmação, ou marca erro visível
        stagedStoragePath = null;
      }
    }

    if (status === 'INVALID') {
      errorReport.push({
        itemId,
        zipEntryPath: mEntry.zipEntryPath,
        targetName: mEntry.name || mEntry.slug || mEntry.domain || mEntry.zipEntryPath,
        targetType: mEntry.targetType,
        error: errorMessage || 'Erro de validação.'
      });
    }

    const displayTargetName = match.matched
      ? match.targetName
      : mEntry.name || mEntry.slug || mEntry.domain || mEntry.zipEntryPath;

    const dbItem = {
      id: itemId,
      batchId,
      targetType: mEntry.targetType,
      targetId: match.matched ? match.targetId : null,
      targetName: displayTargetName,
      targetSlug: match.matched ? match.targetSlug : mEntry.slug || null,
      targetDomain: match.matched ? match.targetDomain : normalizeDomain(mEntry.domain) || null,
      zipEntryPath: mEntry.zipEntryPath,
      mimeType: asset?.mimeType || null,
      byteSize: asset?.byteSize || 0,
      classification: mEntry.classification,
      requiresBrandReview: mEntry.requiresBrandReview,
      status,
      previousImageUrl: match.matched ? match.previousImageUrl : null,
      stagedStoragePath,
      publicImageUrl: null,
      errorMessage,
      rawManifest: mEntry.rawEntry,
      retryCount: 0
    };

    itemsForDb.push(dbItem);
    itemsForResponse.push({
      ...dbItem,
      previewDataUrl: buildTinyPreviewDataUrl(asset)
    });
  }

  const batchSummary = {
    totalFound: inspection.manifestEntries.length,
    approved: approvedCount,
    pendingReview: pendingReviewCount,
    unmatched: unmatchedCount,
    invalid: invalidCount
  };

  await saveBatchAndItems(
    {
      id: batchId,
      status: 'PREVIEW',
      fileName: params.fileName,
      fileSizeBytes: params.zipBuffer.length,
      uploadedBy: params.actor.userId,
      uploadedByEmail: params.actor.email,
      totalFound: inspection.manifestEntries.length,
      approvedCount,
      pendingReviewCount,
      unmatchedCount,
      invalidCount,
      manifestSummary: batchSummary,
      errorReport
    },
    itemsForDb
  );

  return {
    success: true,
    batch: {
      batchId,
      status: 'PREVIEW',
      fileName: params.fileName,
      fileSizeBytes: params.zipBuffer.length,
      uploadedByEmail: params.actor.email,
      counts: {
        totalFound: inspection.manifestEntries.length,
        approved: approvedCount,
        pendingReview: pendingReviewCount,
        unmatched: unmatchedCount,
        invalid: invalidCount,
        applied: 0,
        failed: 0,
        skipped: 0
      },
      items: itemsForResponse,
      errorReport,
      createdAt: new Date().toISOString()
    }
  };
}

/**
 * Passo 2: Confirmação e Aplicação em Lote (ou Reprocessamento de Falhas).
 * - Nunca importa itens requires_brand_review.
 * - Atualiza DB somente após upload bem-sucedido ao Supabase Storage.
 * - Preserva imagem anterior caso upload ou atualização de DB falhe.
 */
export async function applyOrReprocessImageBatch(params: {
  batchId: string;
  mode: 'apply' | 'reprocess';
  selectedItemIds?: string[];
  fallbackZipBuffer?: Buffer;
}): Promise<{ success: boolean; error?: string; batch?: ImageImportBatchSummary }> {
  const loaded = await loadBatchAndItems(params.batchId);
  if (!loaded) {
    return { success: false, error: 'Lote de importação não encontrado.' };
  }

  const { batch, items } = loaded;
  const supabase = getServerSupabase();

  let fallbackAssetsByPath: Map<string, ValidatedZipImageAsset> | null = null;
  if (params.fallbackZipBuffer) {
    const reInspect = await inspectAndExtractImageZip(params.fallbackZipBuffer);
    if (reInspect.valid) {
      fallbackAssetsByPath = reInspect.assetsByPath;
    }
  }

  const selectedSet = Array.isArray(params.selectedItemIds) && params.selectedItemIds.length > 0
    ? new Set(params.selectedItemIds)
    : null;

  const confirmedAt = batch.confirmed_at || new Date().toISOString();
  const errorReport: ImageImportBatchSummary['errorReport'] = [];

  for (const item of items) {
    const isReviewBlocked = Boolean(
      item.requires_brand_review || String(item.classification || '').toLowerCase() === 'requires_brand_review'
    );

    // Garantia estrita server-side: requires_brand_review nunca entra em importação automática
    if (isReviewBlocked) {
      if (item.status !== 'PENDING_REVIEW') {
        await updateItemStatusInDb(item.id, {
          status: 'PENDING_REVIEW',
          errorMessage: 'Bloqueado para importação automática (requires_brand_review).'
        });
        item.status = 'PENDING_REVIEW';
      }
      continue;
    }

    const shouldProcess =
      params.mode === 'apply'
        ? item.status === 'APPROVED' && (!selectedSet || selectedSet.has(item.id))
        : item.status === 'FAILED';

    if (!shouldProcess) {
      if (params.mode === 'apply' && item.status === 'APPROVED' && selectedSet && !selectedSet.has(item.id)) {
        await updateItemStatusInDb(item.id, { status: 'SKIPPED', errorMessage: 'Desmarcado na confirmação.' });
        item.status = 'SKIPPED';
      }
      if (item.status === 'FAILED' || item.status === 'INVALID') {
        errorReport.push({
          itemId: item.id,
          zipEntryPath: item.zip_entry_path,
          targetName: item.target_name || item.zip_entry_path,
          targetType: item.target_type,
          error: item.error_message || 'Falha anterior preservada.'
        });
      }
      continue;
    }

    if (!item.target_id) {
      const errMsg = 'Registro de destino não vinculado.';
      await updateItemStatusInDb(item.id, {
        status: 'FAILED',
        errorMessage: errMsg,
        retryCount: (item.retry_count || 0) + (params.mode === 'reprocess' ? 1 : 0)
      });
      item.status = 'FAILED';
      item.error_message = errMsg;
      errorReport.push({
        itemId: item.id,
        zipEntryPath: item.zip_entry_path,
        targetName: item.target_name || item.zip_entry_path,
        targetType: item.target_type,
        error: errMsg
      });
      continue;
    }

    let uploadedStoragePath: string | null = null;
    try {
      // 1. Obter binário validado do staging ou fallback ZIP
      let fileBuffer: Buffer | null = null;
      let mimeType = String(item.mime_type || 'image/png');
      let extension = item.zip_entry_path.split('.').pop()?.toLowerCase() || 'png';
      if (extension === 'jpeg') extension = 'jpg';

      if (item.staged_storage_path) {
        const { data: blobData, error: dlErr } = await supabase.storage
          .from(BRAND_ASSETS_BUCKET)
          .download(item.staged_storage_path);
        if (!dlErr && blobData) {
          const ab = await blobData.arrayBuffer();
          fileBuffer = Buffer.from(ab);
        }
      }

      if (!fileBuffer && fallbackAssetsByPath) {
        const fallbackAsset = fallbackAssetsByPath.get(item.zip_entry_path);
        if (fallbackAsset) {
          fileBuffer = fallbackAsset.buffer;
          mimeType = fallbackAsset.mimeType;
          extension = fallbackAsset.extension;
        }
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error('Arquivo em staging indisponível. Reenvie o pacote ZIP ao reprocessar.');
      }

      // 2. Upload permanente no Supabase Storage (antes de tocar no banco!)
      const uploaded = await uploadPermanentBrandAsset({
        targetType: item.target_type,
        targetId: item.target_id,
        targetSlug: item.target_slug,
        buffer: fileBuffer,
        mimeType,
        extension
      });
      uploadedStoragePath = uploaded.storagePath;

      // 3. Atualizar entities.image_url ou news_sources.logo_url APÓS confirmação do Storage
      await updateTargetRecordImageUrl(item.target_type, item.target_id, uploaded.publicUrl);

      // Limpar staging se existir (best-effort)
      if (item.staged_storage_path) {
        try {
          await supabase.storage.from(BRAND_ASSETS_BUCKET).remove([item.staged_storage_path]);
        } catch {}
      }

      const nextRetry = params.mode === 'reprocess' ? (item.retry_count || 0) + 1 : item.retry_count || 0;
      await updateItemStatusInDb(item.id, {
        status: 'APPLIED',
        publicImageUrl: uploaded.publicUrl,
        errorMessage: null,
        retryCount: nextRetry
      });
      item.status = 'APPLIED';
      item.public_image_url = uploaded.publicUrl;
      item.error_message = null;
      item.retry_count = nextRetry;
    } catch (itemErr: any) {
      // REGRA 9: Se upload ou DB update falhar, preserva imagem anterior e limpa objeto órfão
      if (uploadedStoragePath) {
        try {
          await supabase.storage.from(BRAND_ASSETS_BUCKET).remove([uploadedStoragePath]);
        } catch {}
      }

      const errMsg = String(itemErr?.message || 'Erro desconhecido ao aplicar imagem.');
      const nextRetry = params.mode === 'reprocess' ? (item.retry_count || 0) + 1 : item.retry_count || 0;

      await updateItemStatusInDb(item.id, {
        status: 'FAILED',
        errorMessage: errMsg,
        retryCount: nextRetry
      });

      item.status = 'FAILED';
      item.error_message = errMsg;
      item.retry_count = nextRetry;

      errorReport.push({
        itemId: item.id,
        zipEntryPath: item.zip_entry_path,
        targetName: item.target_name || item.zip_entry_path,
        targetType: item.target_type,
        error: errMsg
      });
    }
  }

  const appliedCount = items.filter((i) => i.status === 'APPLIED').length;
  const failedCount = items.filter((i) => i.status === 'FAILED').length;
  const skippedCount = items.filter((i) => i.status === 'SKIPPED').length;
  const completedAt = new Date().toISOString();

  const finalStatus: ImageImportBatchSummary['status'] =
    failedCount > 0 ? (appliedCount > 0 ? 'PARTIAL_FAILURE' : 'FAILED') : 'COMPLETED';

  await updateBatchSummaryInDb(params.batchId, {
    status: finalStatus,
    appliedCount,
    failedCount,
    skippedCount,
    errorReport,
    confirmedAt,
    completedAt
  });

  return {
    success: true,
    batch: mapDbBatchToSummary(
      {
        ...batch,
        status: finalStatus,
        applied_count: appliedCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
        error_report: errorReport,
        confirmed_at: confirmedAt,
        completed_at: completedAt
      },
      items
    )
  };
}

function mapDbBatchToSummary(batch: any, items: any[]): ImageImportBatchSummary {
  return {
    batchId: batch.id,
    status: batch.status,
    fileName: batch.file_name,
    fileSizeBytes: Number(batch.file_size_bytes || 0),
    uploadedByEmail: batch.uploaded_by_email || null,
    counts: {
      totalFound: Number(batch.total_found || 0),
      approved: Number(batch.approved_count || 0),
      pendingReview: Number(batch.pending_review_count || 0),
      unmatched: Number(batch.unmatched_count || 0),
      invalid: Number(batch.invalid_count || 0),
      applied: Number(batch.applied_count || 0),
      failed: Number(batch.failed_count || 0),
      skipped: Number(batch.skipped_count || 0)
    },
    items: items.map((i) => ({
      id: i.id,
      targetType: i.target_type,
      targetId: i.target_id,
      targetName: i.target_name || i.zip_entry_path,
      targetSlug: i.target_slug,
      targetDomain: i.target_domain,
      zipEntryPath: i.zip_entry_path,
      mimeType: i.mime_type,
      byteSize: Number(i.byte_size || 0),
      classification: i.classification,
      requiresBrandReview: Boolean(i.requires_brand_review),
      status: i.status,
      previousImageUrl: i.previous_image_url || null,
      publicImageUrl: i.public_image_url || null,
      stagedStoragePath: i.staged_storage_path || null,
      errorMessage: i.error_message || null,
      retryCount: Number(i.retry_count || 0)
    })),
    errorReport: Array.isArray(batch.error_report) ? batch.error_report : [],
    createdAt: batch.created_at,
    confirmedAt: batch.confirmed_at || null,
    completedAt: batch.completed_at || null
  };
}

export async function listImageImportHistory(limit = 20): Promise<ImageImportBatchSummary[]> {
  if (isPostgresConfigured()) {
    const bRes = await executeSql(
      `SELECT * FROM public.image_import_batches ORDER BY created_at DESC LIMIT $1`,
      [Math.min(50, Math.max(1, limit))]
    );
    const batches = bRes.rows || [];
    if (batches.length === 0) return [];

    const batchIds = batches.map((b: any) => b.id);
    const iRes = await executeSql(
      `SELECT * FROM public.image_import_items WHERE batch_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
      [batchIds]
    );
    const itemsByBatch = new Map<string, any[]>();
    for (const item of iRes.rows || []) {
      const list = itemsByBatch.get(item.batch_id) || [];
      list.push(item);
      itemsByBatch.set(item.batch_id, list);
    }

    return batches.map((b: any) => mapDbBatchToSummary(b, itemsByBatch.get(b.id) || []));
  }

  const supabase = getServerSupabase();
  const { data: batches } = await supabase
    .from('image_import_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(50, Math.max(1, limit)));

  if (!batches || batches.length === 0) return [];

  const batchIds = batches.map((b: any) => b.id);
  const { data: items } = await supabase
    .from('image_import_items')
    .select('*')
    .in('batch_id', batchIds)
    .order('created_at', { ascending: true });

  const itemsByBatch = new Map<string, any[]>();
  for (const item of items || []) {
    const list = itemsByBatch.get(item.batch_id) || [];
    list.push(item);
    itemsByBatch.set(item.batch_id, list);
  }

  return batches.map((b: any) => mapDbBatchToSummary(b, itemsByBatch.get(b.id) || []));
}

/**
 * Atualiza um logotipo/imagem individual via Supabase Storage + Banco de Dados.
 */
export async function updateSingleTargetImage(params: {
  targetType: ManifestTargetType;
  targetId: string;
  buffer: Buffer;
  mimeType: string;
  extension: string;
}): Promise<{ publicUrl: string; storagePath: string }> {
  const uploaded = await uploadPermanentBrandAsset({
    targetType: params.targetType,
    targetId: params.targetId,
    buffer: params.buffer,
    mimeType: params.mimeType,
    extension: params.extension
  });

  await updateTargetRecordImageUrl(params.targetType, params.targetId, uploaded.publicUrl);
  return { publicUrl: uploaded.publicUrl, storagePath: uploaded.storagePath };
}

export async function clearSingleTargetImage(targetType: ManifestTargetType, targetId: string): Promise<void> {
  if (isPostgresConfigured()) {
    if (targetType === 'SOURCE') {
      await executeSql(`UPDATE public.news_sources SET logo_url = NULL WHERE id::text = $1`, [targetId]);
      return;
    }
    const cols = await getTableColumns('entities');
    const setters = ['image_url = NULL'];
    if (cols.has('logo_url')) setters.push('logo_url = NULL');
    await executeSql(`UPDATE public.entities SET ${setters.join(', ')} WHERE id::text = $1`, [targetId]);
    return;
  }

  const supabase = getServerSupabase();
  if (targetType === 'SOURCE') {
    await supabase.from('news_sources').update({ logo_url: null }).eq('id', targetId);
  } else {
    await supabase.from('entities').update({ image_url: null }).eq('id', targetId);
  }
}
