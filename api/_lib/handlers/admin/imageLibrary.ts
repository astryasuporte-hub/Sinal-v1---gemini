/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Handler Admin: Biblioteca de Imagens & Importação em Lote via ZIP
 *
 * Rotas suportadas (todas protegidas por verifyAdminRequest):
 * - GET  /api/admin/image-library?action=history
 * - POST /api/admin/image-library?action=init-upload  (gera Signed Upload URL para pacotes >2.5MB)
 * - POST /api/admin/image-library?action=preview      (dry-run: valida ZIP + manifest + matching)
 * - POST /api/admin/image-library?action=apply        (confirma lote: upload Storage + update DB)
 * - POST /api/admin/image-library?action=reprocess    (reprocessa apenas itens FAILED do lote)
 */

import crypto from 'crypto';
import { sendJson, setCorsHeaders } from '../../common.js';
import { verifyAdminRequest } from '../../adminAuth.js';
import { getServerSupabase } from '../../db.js';
import {
  applyOrReprocessImageBatch,
  BRAND_ASSETS_BUCKET,
  ensureBrandAssetsBucket,
  extractAdminActorFromRequest,
  listImageImportHistory,
  previewImageLibraryZip
} from '../../imageLibraryService.js';
import { ZIP_SECURITY_LIMITS } from '../../zipImageValidator.js';

const MAX_JSON_BODY_BYTES = 36 * 1024 * 1024; // ~25MB ZIP em Base64

async function readBoundedJsonBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return req.body;
  }

  const buffers: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new Error('PAYLOAD_TOO_LARGE: O corpo da requisição excede o limite máximo permitido.');
    }
    buffers.push(buf);
  }

  const raw = Buffer.concat(buffers).toString('utf-8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function resolveAction(req: any, urlObj: URL): string {
  const qAction = String(urlObj.searchParams.get('action') || '').trim().toLowerCase();
  if (qAction) return qAction;

  const pathname = urlObj.pathname.toLowerCase();
  if (pathname.endsWith('/history')) return 'history';
  if (pathname.endsWith('/init-upload')) return 'init-upload';
  if (pathname.endsWith('/preview')) return 'preview';
  if (pathname.endsWith('/apply')) return 'apply';
  if (pathname.endsWith('/reprocess')) return 'reprocess';

  return req.method === 'GET' ? 'history' : 'preview';
}

function decodeZipBase64(rawBase64: string): Buffer {
  const commaIdx = rawBase64.indexOf(',');
  const clean = commaIdx !== -1 ? rawBase64.slice(commaIdx + 1) : rawBase64;
  return Buffer.from(clean.trim(), 'base64');
}

async function resolveAdminAuth(req: any): Promise<boolean> {
  if (await verifyAdminRequest(req)) return true;

  // Fallback seguro quando DATABASE_URL não está configurado mas SUPABASE_SERVICE_ROLE_KEY sim
  const authHeader = String(req?.headers?.authorization || '');
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return false;
    const appMeta = data.user.app_metadata || {};
    if (appMeta.is_admin === true || appMeta.role === 'admin' || appMeta.role === 'super_admin') {
      return true;
    }
    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', data.user.id)
      .in('role', ['admin', 'super_admin'])
      .maybeSingle();
    return Boolean(roleRow);
  } catch {
    return false;
  }
}

export default async function imageLibraryHandler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const isAuthorized = await resolveAdminAuth(req);
  if (!isAuthorized) {
    return sendJson(res, 401, {
      success: false,
      error: 'UNAUTHORIZED_ADMIN',
      message: 'Acesso negado. Apenas administradores autenticados podem importar bibliotecas de imagens.'
    });
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const action = resolveAction(req, urlObj);

  try {
    if (req.method === 'GET' && action === 'history') {
      const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10) || 20;
      const batches = await listImageImportHistory(limit);
      return sendJson(res, 200, { success: true, batches });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { success: false, error: 'Método não permitido.' });
    }

    const body = await readBoundedJsonBody(req);

    // 1. Signed Upload URL para pacotes grandes (>2.5MB) evitando limite de 4.5MB da Vercel
    if (action === 'init-upload') {
      const fileName = String(body.fileName || 'package.zip').replace(/[^a-zA-Z0-9._-]/g, '_');
      const byteSize = Number(body.fileSizeBytes || 0);
      if (byteSize > ZIP_SECURITY_LIMITS.MAX_ZIP_BYTES) {
        return sendJson(res, 413, {
          success: false,
          error: `Arquivo ZIP excede o limite máximo de ${(ZIP_SECURITY_LIMITS.MAX_ZIP_BYTES / (1024 * 1024)).toFixed(0)} MB.`
        });
      }

      const supabase = getServerSupabase();
      await ensureBrandAssetsBucket();
      const storagePath = `staging-zips/${crypto.randomUUID()}-${fileName}`;
      const { data, error } = await supabase.storage
        .from(BRAND_ASSETS_BUCKET)
        .createSignedUploadUrl(storagePath);

      if (error || !data?.signedUrl) {
        return sendJson(res, 500, {
          success: false,
          error: error?.message || 'Não foi possível gerar URL de upload temporário.'
        });
      }

      return sendJson(res, 200, {
        success: true,
        storagePath,
        signedUrl: data.signedUrl,
        token: data.token
      });
    }

    // 2. Preview / Dry-Run de ZIP
    if (action === 'preview') {
      const fileName = String(body.fileName || 'brand-library.zip').trim();
      const storagePath = body.storagePath ? String(body.storagePath).trim() : '';
      let zipBuffer: Buffer;

      if (storagePath) {
        if (!storagePath.startsWith('staging-zips/') || storagePath.includes('..')) {
          return sendJson(res, 400, { success: false, error: 'Caminho de staging inválido.' });
        }
        const supabase = getServerSupabase();
        const { data: zipBlob, error: dlErr } = await supabase.storage
          .from(BRAND_ASSETS_BUCKET)
          .download(storagePath);

        // Limpa ZIP temporário após download
        try {
          await supabase.storage.from(BRAND_ASSETS_BUCKET).remove([storagePath]);
        } catch {}

        if (dlErr || !zipBlob) {
          return sendJson(res, 400, {
            success: false,
            error: dlErr?.message || 'Falha ao recuperar pacote ZIP temporário.'
          });
        }
        zipBuffer = Buffer.from(await zipBlob.arrayBuffer());
      } else {
        const rawBase64 = String(body.zipBase64 || body.base64 || '').trim();
        if (!rawBase64) {
          return sendJson(res, 400, {
            success: false,
            error: 'Arquivo ZIP (zipBase64 ou storagePath) é obrigatório.'
          });
        }
        zipBuffer = decodeZipBase64(rawBase64);
      }

      const actor = await extractAdminActorFromRequest(req);
      const result = await previewImageLibraryZip({
        zipBuffer,
        fileName,
        actor
      });

      if (!result.success) {
        return sendJson(res, 422, {
          success: false,
          errorCode: result.errorCode,
          error: result.error
        });
      }

      return sendJson(res, 200, {
        success: true,
        batch: result.batch
      });
    }

    // 3. Confirmação explícita & aplicação em lote
    if (action === 'apply') {
      const batchId = String(body.batchId || '').trim();
      const confirmed = body.confirmed === true;
      if (!batchId) {
        return sendJson(res, 400, { success: false, error: 'batchId é obrigatório.' });
      }
      if (!confirmed) {
        return sendJson(res, 400, {
          success: false,
          error: 'Confirmação explícita do administrador (confirmed: true) é obrigatória antes de aplicar o lote.'
        });
      }

      const selectedItemIds = Array.isArray(body.selectedItemIds)
        ? body.selectedItemIds.map(String)
        : undefined;

      const fallbackZipBuffer = body.zipBase64 ? decodeZipBase64(String(body.zipBase64)) : undefined;

      const result = await applyOrReprocessImageBatch({
        batchId,
        mode: 'apply',
        selectedItemIds,
        fallbackZipBuffer
      });

      return sendJson(res, result.success ? 200 : 404, result);
    }

    // 4. Reprocessar apenas falhas de um lote
    if (action === 'reprocess') {
      const batchId = String(body.batchId || '').trim();
      if (!batchId) {
        return sendJson(res, 400, { success: false, error: 'batchId é obrigatório para reprocessamento.' });
      }

      const fallbackZipBuffer = body.zipBase64 ? decodeZipBase64(String(body.zipBase64)) : undefined;
      const result = await applyOrReprocessImageBatch({
        batchId,
        mode: 'reprocess',
        fallbackZipBuffer
      });

      return sendJson(res, result.success ? 200 : 404, result);
    }

    return sendJson(res, 400, { success: false, error: `Ação desconhecida: ${action}` });
  } catch (err: any) {
    const msg = String(err?.message || 'Erro interno ao processar biblioteca de imagens.');
    const status = msg.includes('PAYLOAD_TOO_LARGE') ? 413 : 500;
    return sendJson(res, status, { success: false, error: msg });
  }
}
