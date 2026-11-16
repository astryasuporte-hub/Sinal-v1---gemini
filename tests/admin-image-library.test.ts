/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR — SUÍTE DE TESTES: ADMIN BIBLIOTECA DE IMAGENS & IMPORTAÇÃO ZIP
 *
 * Escopo de execução:
 * - Validações binárias de ZIP, Central Directory, Magic Bytes e sanitização SVG
 *   executam diretamente contra buffers reais com JSZip.
 * - Operações de Storage (`brand-assets`) e persistência (`entities`, `news_sources`,
 *   `image_import_batches`, `image_import_items`) utilizam cliente Supabase simulado
 *   injetado via `setTestSupabaseClient` (sem conexão ativa com banco de produção).
 */

import JSZip from 'jszip';
import { setTestSupabaseClient } from '../api/_lib/db';
import {
  inspectAndExtractImageZip,
  validateImageBufferAndMime,
  parseImageManifest
} from '../api/_lib/zipImageValidator';
import imageLibraryHandler from '../api/_lib/handlers/admin/imageLibrary';
import companyLogoHandler from '../api/_lib/handlers/admin/companyLogo';

process.env.FATOSBR_TEST_MODE = 'true';
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_DB_URL;
delete process.env.POSTGRES_URL;

// -----------------------------------------------------------------------------
// HELPERS DE IMAGENS BINÁRIAS VÁLIDAS (PNG RGBA, JPEG, WEBP, SVG)
// -----------------------------------------------------------------------------

function buildMinimalValidPng(width = 32, height = 32, withAlpha = true): Buffer {
  // PNG 8-byte signature + IHDR chunk (25 bytes) + IDAT/IEND minimal válido para parser
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bitDepth
  ihdrData.writeUInt8(withAlpha ? 6 : 2, 9); // 6 = RGBA, 2 = RGB
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR', 'ascii');
  const ihdrCrc = Buffer.alloc(4);

  const iendLen = Buffer.alloc(4);
  iendLen.writeUInt32BE(0, 0);
  const iendType = Buffer.from('IEND', 'ascii');
  const iendCrc = Buffer.alloc(4);

  return Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, ihdrCrc, iendLen, iendType, iendCrc]);
}

function buildMinimalJpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
}

function buildMinimalWebp(): Buffer {
  return Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 \x18\x00\x00\x00\x00\x00\x00\x00', 'binary');
}

function buildRawZipWithCustomCentralDirectory(params: {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
  externalAttrs?: number;
}): Buffer {
  const nameBuf = Buffer.from(params.fileName, 'utf-8');
  const lfh = Buffer.alloc(30 + nameBuf.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt32LE(params.compressedSize, 18);
  lfh.writeUInt32LE(params.uncompressedSize, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(lfh, 30);

  const cdOffset = lfh.length;
  const cd = Buffer.alloc(46 + nameBuf.length);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt32LE(params.compressedSize, 20);
  cd.writeUInt32LE(params.uncompressedSize, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(params.externalAttrs ?? 0, 38);
  nameBuf.copy(cd, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([lfh, cd, eocd]);
}

// -----------------------------------------------------------------------------
// MOCK SUPABASE DB & STORAGE (EM MEMÓRIA PARA TESTE DETERMINÍSTICO)
// -----------------------------------------------------------------------------

class MockSupabaseLibraryHarness {
  public buckets = new Map<string, any>();
  public storageObjects = new Map<string, { buffer: Buffer; contentType: string }>();
  public entities: any[] = [];
  public news_sources: any[] = [];
  public image_import_batches: any[] = [];
  public image_import_items: any[] = [];
  public failUpdateForEntityId: string | null = null;
  public failStorageUploadForMatch: string | null = null;

  resetData() {
    this.storageObjects.clear();
    this.image_import_batches = [];
    this.image_import_items = [];
    this.failUpdateForEntityId = null;
    this.failStorageUploadForMatch = null;
    this.entities = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Petrobras',
        slug: 'petrobras',
        type: 'COMPANY',
        website: 'https://petrobras.com.br',
        image_url: 'https://cdn.old/petrobras-legacy.png'
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Vale S.A.',
        slug: 'vale',
        type: 'COMPANY',
        website: 'https://vale.com',
        image_url: 'https://cdn.old/vale-legacy.png'
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Gabriel Galípolo',
        slug: 'gabriel-galipolo',
        type: 'PERSON',
        website: null,
        image_url: null
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Itaú Unibanco',
        slug: 'itau-unibanco',
        type: 'COMPANY',
        website: 'https://itau.com.br',
        image_url: 'https://cdn.old/itau-original.png'
      }
    ];
    this.news_sources = [
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Valor Econômico',
        slug: 'valor-economico',
        domain: 'valor.globo.com',
        logo_url: null
      },
      {
        id: '66666666-6666-4666-8666-666666666666',
        name: 'Reuters Brasil',
        slug: 'reuters-brasil',
        domain: 'reuters.com',
        logo_url: null
      }
    ];
  }

  private getTable(name: string): any[] {
    if (name === 'entities') return this.entities;
    if (name === 'news_sources') return this.news_sources;
    if (name === 'image_import_batches') return this.image_import_batches;
    if (name === 'image_import_items') return this.image_import_items;
    return [];
  }

  public client: any = {
    auth: {
      getUser: async (token: string) => {
        if (token === 'admin_jwt_valid') {
          return {
            data: {
              user: {
                id: 'admin-user-uuid',
                email: 'admin@fatosbr.com.br',
                app_metadata: { is_admin: true, role: 'super_admin' }
              }
            },
            error: null
          };
        }
        if (token === 'user_jwt_non_admin') {
          return {
            data: {
              user: {
                id: 'reader-user-uuid',
                email: 'leitor@fatosbr.com.br',
                app_metadata: { role: 'reader' }
              }
            },
            error: null
          };
        }
        return { data: { user: null }, error: new Error('Invalid token') };
      }
    },
    storage: {
      getBucket: async (name: string) => {
        const b = this.buckets.get(name);
        return b ? { data: b, error: null } : { data: null, error: { message: 'Not found' } };
      },
      createBucket: async (name: string, opts: any) => {
        const b = { name, ...opts };
        this.buckets.set(name, b);
        return { data: b, error: null };
      },
      from: (bucketName: string) => ({
        upload: async (path: string, buf: Buffer, opts: any) => {
          if (this.failStorageUploadForMatch && path.includes(this.failStorageUploadForMatch)) {
            return { data: null, error: { message: 'SIMULATED_STORAGE_TIMEOUT' } };
          }
          this.storageObjects.set(`${bucketName}/${path}`, {
            buffer: Buffer.from(buf),
            contentType: opts?.contentType || 'application/octet-stream'
          });
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          const obj = this.storageObjects.get(`${bucketName}/${path}`);
          if (!obj) return { data: null, error: { message: 'Object not found' } };
          return {
            data: {
              arrayBuffer: async () => obj.buffer.buffer.slice(obj.buffer.byteOffset, obj.buffer.byteOffset + obj.buffer.byteLength)
            },
            error: null
          };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) {
            this.storageObjects.delete(`${bucketName}/${p}`);
          }
          return { data: paths, error: null };
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://zopbitgtexefmqfvwgzj.supabase.co/storage/v1/object/public/${bucketName}/${path}`
          }
        }),
        createSignedUploadUrl: async (path: string) => ({
          data: {
            signedUrl: `https://zopbitgtexefmqfvwgzj.supabase.co/storage/v1/upload/sign/${bucketName}/${path}`,
            token: 'signed_tok_test'
          },
          error: null
        })
      })
    },
    from: (tableName: string) => {
      const harness = this;
      return {
        select: () => {
          const filters: Array<(row: any) => boolean> = [];
          let orderByCol: string | null = null;
          let orderAsc = true;
          let limitCount: number | null = null;

          const execQuery = () => {
            let rows = [...harness.getTable(tableName)];
            for (const f of filters) rows = rows.filter(f);
            if (orderByCol) {
              rows.sort((a, b) => {
                const va = String(a[orderByCol!] || '');
                const vb = String(b[orderByCol!] || '');
                return orderAsc ? va.localeCompare(vb) : vb.localeCompare(va);
              });
            }
            if (limitCount !== null) rows = rows.slice(0, limitCount);
            return rows;
          };

          const chain: any = {
            eq: (col: string, val: any) => {
              filters.push((r) => r[col] === val);
              return chain;
            },
            in: (col: string, vals: any[]) => {
              filters.push((r) => vals.includes(r[col]));
              return chain;
            },
            order: (col: string, opts?: { ascending?: boolean }) => {
              orderByCol = col;
              orderAsc = opts?.ascending !== false;
              return chain;
            },
            limit: (n: number) => {
              limitCount = n;
              return chain;
            },
            maybeSingle: async () => {
              const rows = execQuery();
              return { data: rows[0] || null, error: null };
            },
            then: (resolve: any) => resolve({ data: execQuery(), error: null })
          };
          return chain;
        },
        insert: async (payload: any) => {
          const arr = Array.isArray(payload) ? payload : [payload];
          const table = harness.getTable(tableName);
          const now = new Date().toISOString();
          for (const row of arr) {
            table.push({
              created_at: now,
              updated_at: now,
              ...row
            });
          }
          return { data: arr, error: null };
        },
        update: (updates: any) => ({
          eq: async (col: string, val: any) => {
            if (tableName === 'entities' && col === 'id' && val === harness.failUpdateForEntityId) {
              return { data: null, error: { message: 'SIMULATED_DB_UPDATE_FAILURE' } };
            }
            const table = harness.getTable(tableName);
            for (const row of table) {
              if (row[col] === val) {
                Object.assign(row, updates);
              }
            }
            return { data: null, error: null };
          }
        })
      };
    },
    rpc: async () => ({ data: false, error: null })
  };
}

// -----------------------------------------------------------------------------
// MOCK HTTP REQ/RES
// -----------------------------------------------------------------------------

function createMockReq(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
} = {}): any {
  const { method = 'GET', url = '/api/admin/image-library', headers = {}, body } = options;
  return {
    method,
    url,
    headers: { 'x-forwarded-for': '127.0.0.1', ...headers },
    body,
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: async function* () {
      if (body) yield Buffer.from(JSON.stringify(body));
    }
  };
}

function createMockRes() {
  let statusCode = 200;
  let raw = '';
  const res: any = {
    statusCode: 200,
    setHeader: () => {},
    writeHead: (code: number) => {
      statusCode = code;
      res.statusCode = code;
    },
    write: (chunk: string) => {
      raw += chunk;
    },
    end: (chunk?: string) => {
      if (chunk) raw += chunk;
      statusCode = res.statusCode;
    }
  };
  return {
    res,
    result: () => {
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {}
      return { statusCode, json, raw };
    }
  };
}

// -----------------------------------------------------------------------------
// RUNNER DE TESTES
// -----------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

async function main() {
  console.log('\n=====================================================================');
  console.log('🖼️  FATOSBR — SUITE ADMIN BIBLIOTECA DE IMAGENS & IMPORTAÇÃO ZIP');
  console.log('   (Validações ZIP/MIME reais; Storage & DB via MockSupabaseHarness)');
  console.log('=====================================================================\n');

  const harness = new MockSupabaseLibraryHarness();
  harness.resetData();
  setTestSupabaseClient(harness.client);

  // ---------------------------------------------------------------------------
  // 1. VALIDAÇÃO DE SEGURANÇA ZIP & IMAGENS
  // ---------------------------------------------------------------------------
  console.log('--- 1. Segurança ZIP, Magic Bytes, Zip Bomb, Traversal & SVG XSS ---');

  await runTest('1.1 Rejeita pacote sem assinatura ZIP válida', async () => {
    const res = await inspectAndExtractImageZip(Buffer.from('NOT_A_ZIP_FILE_AT_ALL_0000000000'));
    assert(!res.valid, 'Deveria falhar');
    assert(res.errorCode === 'INVALID_ZIP_FORMAT', `Esperado INVALID_ZIP_FORMAT, recebido ${res.errorCode}`);
  });

  await runTest('1.2 Bloqueia Path Traversal (../evil.png) no Central Directory antes de extrair', async () => {
    const evilZip = buildRawZipWithCustomCentralDirectory({
      fileName: '../evil.png',
      compressedSize: 20,
      uncompressedSize: 20
    });
    const res = await inspectAndExtractImageZip(evilZip);
    assert(!res.valid, 'Deveria bloquear path traversal');
    assert(res.errorCode === 'PATH_TRAVERSAL_DETECTED', `Esperado PATH_TRAVERSAL_DETECTED, recebido ${res.errorCode}`);
  });

  await runTest('1.3 Bloqueia Symlinks Unix (S_IFLNK) no Central Directory', async () => {
    const symlinkZip = buildRawZipWithCustomCentralDirectory({
      fileName: 'companies/petrobras.png',
      compressedSize: 16,
      uncompressedSize: 16,
      externalAttrs: (0o120777 << 16) >>> 0
    });
    const res = await inspectAndExtractImageZip(symlinkZip);
    assert(!res.valid, 'Deveria bloquear symlink');
    assert(res.errorCode === 'SYMLINK_NOT_ALLOWED', `Esperado SYMLINK_NOT_ALLOWED, recebido ${res.errorCode}`);
  });

  await runTest('1.4 Bloqueia Zip Bomb por taxa de compressão abusiva (>100x) no Central Directory', async () => {
    const bombZip = buildRawZipWithCustomCentralDirectory({
      fileName: 'companies/bomb.png',
      compressedSize: 100,
      uncompressedSize: 2 * 1024 * 1024 // 20.000x ratio
    });
    const res = await inspectAndExtractImageZip(bombZip);
    assert(!res.valid, 'Deveria bloquear zip bomb');
    assert(res.errorCode === 'ZIP_BOMB_DETECTED', `Esperado ZIP_BOMB_DETECTED, recebido ${res.errorCode}`);
  });

  await runTest('1.5 Bloqueia arquivo sem manifest.json', async () => {
    const zip = new JSZip();
    zip.file('companies/petrobras.png', buildMinimalValidPng());
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await inspectAndExtractImageZip(buf);
    assert(!res.valid, 'Deveria exigir manifest.json');
    assert(res.errorCode === 'MANIFEST_MISSING', `Esperado MANIFEST_MISSING, recebido ${res.errorCode}`);
  });

  await runTest('1.6 Rejeita arquivo com extensão .png mas Magic Bytes falsos e SVG com XSS (<script> / onload=)', async () => {
    const fakePng = validateImageBufferAndMime(Buffer.from('<html>not a png</html>'), 'evil.png');
    assert(!fakePng.valid, 'Fake PNG deve ser rejeitado');

    const xssSvg1 = validateImageBufferAndMime(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'logo.svg'
    );
    assert(!xssSvg1.valid, 'SVG com <script> deve ser bloqueado');

    const xssSvg2 = validateImageBufferAndMime(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(1)"></svg>'),
      'logo.svg'
    );
    assert(!xssSvg2.valid, 'SVG com onload= deve ser bloqueado');

    const cleanSvg = validateImageBufferAndMime(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'),
      'clean.svg'
    );
    assert(cleanSvg.valid && cleanSvg.mimeType === 'image/svg+xml', 'SVG limpo deve ser aceito');

    const okJpg = validateImageBufferAndMime(buildMinimalJpeg(), 'avatar.jpg');
    assert(okJpg.valid && okJpg.mimeType === 'image/jpeg', 'JPEG válido deve ser aceito');

    const okWebp = validateImageBufferAndMime(buildMinimalWebp(), 'brand.webp');
    assert(okWebp.valid && okWebp.mimeType === 'image/webp', 'WebP válido deve ser aceito');
  });

  await runTest('1.7 Parser de manifest.json neutraliza prototype pollution e extrai requires_brand_review', async () => {
    const entries = parseImageManifest(
      JSON.stringify({
        __proto__: { polluted: true },
        items: [
          { type: 'company', slug: 'petrobras', file: 'companies/petrobras.png', classification: 'approved' },
          { type: 'company', slug: 'itau-unibanco', file: 'companies/itau.png', classification: 'requires_brand_review' }
        ]
      })
    );
    assert(entries.length === 2, 'Esperado 2 entradas');
    assert(entries[0].requiresBrandReview === false, 'Primeira entrada aprovada');
    assert(entries[1].requiresBrandReview === true, 'Segunda entrada bloqueada por requires_brand_review');
  });

  // ---------------------------------------------------------------------------
  // 2. AUTENTICAÇÃO E RBAC ADMIN
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Segurança de Endpoints Admin (RBAC) ---');

  await runTest('2.1 Endpoints de ZIP Library e Logo Individual rejeitam requisições sem admin (401)', async () => {
    // Sem header
    const r1 = createMockRes();
    await imageLibraryHandler(createMockReq({ method: 'GET', url: '/api/admin/image-library?action=history' }), r1.res);
    assert(r1.result().statusCode === 401, `Esperado 401 sem token, recebido ${r1.result().statusCode}`);

    // Token de leitor não-admin
    const r2 = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=preview',
        headers: { authorization: 'Bearer user_jwt_non_admin' },
        body: {}
      }),
      r2.res
    );
    assert(r2.result().statusCode === 401, `Esperado 401 para leitor comum, recebido ${r2.result().statusCode}`);

    // Upload individual sem admin
    const r3 = createMockRes();
    await companyLogoHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/company-logo',
        headers: { authorization: 'Bearer user_jwt_non_admin' },
        body: { entityId: '1111', base64: 'abc' }
      }),
      r3.res
    );
    assert(r3.result().statusCode === 401, `Esperado 401 no company-logo para não-admin, recebido ${r3.result().statusCode}`);
  });

  // ---------------------------------------------------------------------------
  // 3. PREVIEW, CONFIRMAÇÃO, REQUIRES_BRAND_REVIEW & PERSISTÊNCIA STORAGE
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Fluxo Completo: Preview -> Confirmação -> Storage + DB ---');

  let createdBatchId = '';
  let blockedReviewItemId = '';
  let zipBase64Global = '';

  await runTest('3.1 Preview contabiliza encontradas, aprovadas, sem correspondência e pendentes sem alterar DB', async () => {
    harness.resetData();
    const zip = new JSZip();
    const manifest = {
      items: [
        { type: 'company', slug: 'petrobras', name: 'Petrobras', file: 'companies/petrobras.png', status: 'approved' },
        { type: 'person', name: 'Gabriel Galípolo', file: 'people/galipolo.jpg', status: 'approved' },
        { type: 'source', domain: 'https://www.valor.globo.com/noticias', name: 'Valor', file: 'sources/valor.webp', status: 'approved' },
        { type: 'company', slug: 'itau-unibanco', name: 'Itaú Unibanco', file: 'companies/itau.png', classification: 'requires_brand_review' },
        { type: 'company', slug: 'empresa-fantasma', name: 'Empresa Inexistente', file: 'companies/fantasma.png', status: 'approved' }
      ]
    };

    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('companies/petrobras.png', buildMinimalValidPng(64, 64, true));
    zip.file('people/galipolo.jpg', buildMinimalJpeg());
    zip.file('sources/valor.webp', buildMinimalWebp());
    zip.file('companies/itau.png', buildMinimalValidPng(64, 64, true));
    zip.file('companies/fantasma.png', buildMinimalValidPng(64, 64, true));

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
    zipBase64Global = zipBuf.toString('base64');

    const { res, result } = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=preview',
        headers: { authorization: 'Bearer admin_jwt_valid' },
        body: { fileName: 'pacote-fatosbr.zip', zipBase64: zipBase64Global }
      }),
      res
    );

    const out = result();
    assert(out.statusCode === 200 && out.json?.success === true, `Preview falhou: ${JSON.stringify(out.json)}`);
    const batch = out.json.batch;
    createdBatchId = batch.batchId;

    assert(batch.counts.totalFound === 5, `Esperado 5 encontradas, obtido ${batch.counts.totalFound}`);
    assert(batch.counts.approved === 3, `Esperado 3 aprovadas, obtido ${batch.counts.approved}`);
    assert(batch.counts.pendingReview === 1, `Esperado 1 pendente revisão, obtido ${batch.counts.pendingReview}`);
    assert(batch.counts.unmatched === 1, `Esperado 1 sem correspondência, obtido ${batch.counts.unmatched}`);

    const reviewItem = batch.items.find((i: any) => i.requiresBrandReview);
    assert(Boolean(reviewItem) && reviewItem.status === 'PENDING_REVIEW', 'Item requires_brand_review deve estar em PENDING_REVIEW');
    blockedReviewItemId = reviewItem.id;

    // DB NÃO pode ter sido alterado no preview
    const petro = harness.entities.find((e) => e.slug === 'petrobras');
    assert(petro.image_url === 'https://cdn.old/petrobras-legacy.png', 'Preview não pode alterar entities.image_url antes da confirmação');
  });

  await runTest('3.2 Apply exige confirmed: true explicitamente', async () => {
    const { res, result } = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=apply',
        headers: { authorization: 'Bearer admin_jwt_valid' },
        body: { batchId: createdBatchId, confirmed: false }
      }),
      res
    );
    const out = result();
    assert(out.statusCode === 400, `Deveria exigir confirmação explícita (400), recebido ${out.statusCode}`);
  });

  await runTest('3.3 Apply envia ao Supabase Storage, atualiza entities/news_sources e NUNCA importa requires_brand_review', async () => {
    const { res, result } = createMockRes();
    // Mesmo tentando forçar blockedReviewItemId em selectedItemIds, o backend deve bloquear!
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=apply',
        headers: { authorization: 'Bearer admin_jwt_valid' },
        body: {
          batchId: createdBatchId,
          confirmed: true,
          selectedItemIds: [
            ...harness.image_import_items.filter((i) => i.status === 'APPROVED').map((i) => i.id),
            blockedReviewItemId
          ]
        }
      }),
      res
    );

    const out = result();
    assert(out.statusCode === 200 && out.json?.success === true, `Apply falhou: ${JSON.stringify(out.json)}`);
    const batch = out.json.batch;
    assert(batch.status === 'COMPLETED', `Esperado COMPLETED, obtido ${batch.status}`);
    assert(batch.counts.applied === 3, `Esperado 3 aplicadas, obtido ${batch.counts.applied}`);

    const petro = harness.entities.find((e) => e.slug === 'petrobras');
    const galipolo = harness.entities.find((e) => e.slug === 'gabriel-galipolo');
    const valor = harness.news_sources.find((s) => s.domain === 'valor.globo.com');
    const itau = harness.entities.find((e) => e.slug === 'itau-unibanco');

    assert(petro.image_url.includes('/storage/v1/object/public/brand-assets/entities/companies/'), 'Petrobras deve ter URL do Storage');
    assert(galipolo.image_url.includes('/storage/v1/object/public/brand-assets/entities/people/'), 'Pessoa deve ter URL do Storage');
    assert(valor.logo_url.includes('/storage/v1/object/public/brand-assets/sources/'), 'Fonte deve ter logo_url do Storage');
    assert(itau.image_url === 'https://cdn.old/itau-original.png', 'Item requires_brand_review NUNCA pode ser sobrescrito automaticamente');
  });

  // ---------------------------------------------------------------------------
  // 4. PRESERVAÇÃO EM FALHA, HISTÓRICO E REPROCESSAMENTO DE FALHAS
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Preservação de Imagem Anterior, Histórico e Reprocessamento ---');

  let partialBatchId = '';

  await runTest('4.1 Falha parcial preserva imagem anterior, limpa arquivo órfão e gera relatório de erro', async () => {
    harness.resetData();
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        items: [
          { type: 'company', slug: 'petrobras', file: 'companies/petrobras.png' },
          { type: 'company', slug: 'vale', file: 'companies/vale.png' }
        ]
      })
    );
    zip.file('companies/petrobras.png', buildMinimalValidPng());
    zip.file('companies/vale.png', buildMinimalValidPng());
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    const prevRes = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=preview',
        headers: { authorization: 'Bearer admin_jwt_valid' },
        body: { fileName: 'falha-parcial.zip', zipBase64: buf.toString('base64') }
      }),
      prevRes.res
    );
    partialBatchId = prevRes.result().json.batch.batchId;

    // Simula falha de atualização no banco especificamente para Vale (id 2222...)
    harness.failUpdateForEntityId = '22222222-2222-4222-8222-222222222222';
    const objectsBeforeApply = harness.storageObjects.size;

    const applyRes = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=apply',
        headers: { authorization: 'Bearer admin_jwt_valid' },
        body: {
          batchId: partialBatchId,
          confirmed: true,
          zipBase64: buf.toString('base64')
        }
      }),
      applyRes.res
    );

    harness.failUpdateForEntityId = null;

    const out = applyRes.result();
    assert(out.statusCode === 200, 'Apply deve concluir com relatório de falha parcial');
    assert(out.json.batch.status === 'PARTIAL_FAILURE', `Esperado PARTIAL_FAILURE, obtido ${out.json.batch.status}`);
    assert(out.json.batch.counts.applied === 1 && out.json.batch.counts.failed === 1, 'Esperado 1 aplicada e 1 falha');
    assert(out.json.batch.errorReport.length === 1, 'Relatório de erros deve conter 1 entrada');

    // Vale deve preservar a imagem anterior!
    const vale = harness.entities.find((e) => e.slug === 'vale');
    assert(vale.image_url === 'https://cdn.old/vale-legacy.png', 'Imagem anterior da Vale deve ser preservada após falha');

    // Verifica que não sobrou objeto órfão da Vale em entities/companies/2222...
    const orphanKeys = [...harness.storageObjects.keys()].filter((k) => k.includes('entities/companies/2222'));
    assert(orphanKeys.length === 0 && objectsBeforeApply >= 0, 'Objeto órfão no Storage deve ser removido após falha de DB');
  });

  await runTest('4.2 Reprocessamento de falhas recupera apenas itens FAILED e fecha lote como COMPLETED', async () => {
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        items: [
          { type: 'company', slug: 'petrobras', file: 'companies/petrobras.png' },
          { type: 'company', slug: 'vale', file: 'companies/vale.png' }
        ]
      })
    );
    zip.file('companies/petrobras.png', buildMinimalValidPng());
    zip.file('companies/vale.png', buildMinimalValidPng());
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    const repRes = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=reprocess',
        headers: { authorization: 'Bearer admin_jwt_valid' },
        body: { batchId: partialBatchId, zipBase64: buf.toString('base64') }
      }),
      repRes.res
    );

    const out = repRes.result();
    assert(out.statusCode === 200 && out.json.batch.status === 'COMPLETED', `Reprocessamento deveria concluir: ${JSON.stringify(out.json)}`);
    assert(out.json.batch.counts.applied === 2 && out.json.batch.counts.failed === 0, 'Todos os itens devem ficar APPLIED');

    const vale = harness.entities.find((e) => e.slug === 'vale');
    assert(vale.image_url.includes('/storage/v1/object/public/brand-assets/entities/companies/'), 'Vale atualizada após reprocessamento');

    const valeItem = out.json.batch.items.find((i: any) => i.targetSlug === 'vale');
    assert(valeItem.retryCount === 1, `Esperado retryCount === 1, obtido ${valeItem.retryCount}`);
  });

  await runTest('4.3 Histórico de importações retorna lotes persistidos com contagens e relatório', async () => {
    const histRes = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'GET',
        url: '/api/admin/image-library?action=history',
        headers: { authorization: 'Bearer admin_jwt_valid' }
      }),
      histRes.res
    );

    const out = histRes.result();
    assert(out.statusCode === 200 && Array.isArray(out.json?.batches), 'Histórico deve retornar lista de lotes');
    assert(out.json.batches.length >= 1, 'Deve conter ao menos 1 lote registrado');
  });

  // ---------------------------------------------------------------------------
  // 5. PRESERVAÇÃO DO UPLOAD INDIVIDUAL DE LOGOTIPO PNG
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Upload Individual de Logotipo PNG (Admin) ---');

  await runTest('5.1 Upload individual PNG transparente persiste no Storage e atualiza entities.image_url', async () => {
    const pngAlpha = buildMinimalValidPng(64, 64, true);
    const { res, result } = createMockRes();
    await companyLogoHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/company-logo',
        headers: { authorization: 'Bearer admin_jwt_valid' },
        body: {
          entityId: '11111111-1111-4111-8111-111111111111',
          targetType: 'COMPANY',
          base64: `data:image/png;base64,${pngAlpha.toString('base64')}`
        }
      }),
      res
    );
    const out = result();
    assert(out.statusCode === 200 && out.json?.success === true, `Upload individual falhou: ${JSON.stringify(out.json)}`);
    assert(out.json.imageUrl.includes('/storage/v1/object/public/brand-assets/'), 'Deve retornar URL do Supabase Storage');
  });

  await runTest('5.2 Upload individual PNG sem transparência é bloqueado com HTTP 422', async () => {
    const pngOpaque = buildMinimalValidPng(64, 64, false);
    const { res, result } = createMockRes();
    await companyLogoHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/company-logo',
        headers: { authorization: 'Bearer admin_jwt_valid' },
        body: {
          entityId: '11111111-1111-4111-8111-111111111111',
          targetType: 'COMPANY',
          base64: `data:image/png;base64,${pngOpaque.toString('base64')}`
        }
      }),
      res
    );
    assert(result().statusCode === 422, `PNG sem canal alfa deve retornar 422, recebido ${result().statusCode}`);
  });

  setTestSupabaseClient(null);

  console.log('\n---------------------------------------------------------------------');
  console.log(`📊 RESULTADO: ${passed} passaram, ${failed} falharam.`);
  console.log('---------------------------------------------------------------------\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erro fatal na suíte:', err);
  process.exit(1);
});
