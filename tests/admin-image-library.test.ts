/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FATOSBR — SUÍTE DE TESTES: ADMIN BIBLIOTECA DE IMAGENS & IMPORTAÇÃO ZIP (V1.1)
 *
 * Escopo de execução:
 * - Validações binárias de ZIP, Central Directory, Magic Bytes e sanitização SVG
 *   executam diretamente contra buffers reais com JSZip.
 * - Operações de Storage (`brand-assets-staging` privado e `brand-assets` público)
 *   e persistência (`internal.user_roles`, `entities`, `news_sources`,
 *   `image_import_batches`, `image_import_items`) utilizam cliente Supabase simulado
 *   injetado via `setTestSupabaseClient`.
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
process.env.ADMIN_SECRET = 'test_static_admin_secret';
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_DB_URL;
delete process.env.POSTGRES_URL;

// -----------------------------------------------------------------------------
// HELPERS DE IMAGENS BINÁRIAS VÁLIDAS (PNG RGBA, JPEG, WEBP, SVG)
// -----------------------------------------------------------------------------

function buildMinimalValidPng(width = 32, height = 32, withAlpha = true): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(withAlpha ? 6 : 2, 9);
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
// MOCK SUPABASE DB, INTERNAL.USER_ROLES & BUCKETS SEPARADOS
// -----------------------------------------------------------------------------

class MockSupabaseLibraryHarness {
  public storageObjects = new Map<string, { buffer: Buffer; contentType: string }>();
  public entities: any[] = [];
  public news_sources: any[] = [];
  public image_import_batches: any[] = [];
  public image_import_items: any[] = [];
  public internal_user_roles: Array<{ user_id: string; role: string }> = [];
  public failUpdateForEntityId: string | null = null;
  public failStorageUploadForMatch: string | null = null;
  public forbiddenCalls: string[] = [];

  resetData() {
    this.storageObjects.clear();
    this.image_import_batches = [];
    this.image_import_items = [];
    this.failUpdateForEntityId = null;
    this.failStorageUploadForMatch = null;
    this.forbiddenCalls = [];
    this.internal_user_roles = [
      { user_id: 'admin-internal-role-uuid', role: 'super_admin' }
    ];
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

  public getKeysInBucket(bucket: string): string[] {
    const prefix = `${bucket}/`;
    return [...this.storageObjects.keys()].filter((k) => k.startsWith(prefix));
  }

  private getTable(schemaName: string, name: string): any[] {
    if (schemaName === 'internal' && name === 'user_roles') {
      return this.internal_user_roles;
    }
    if (schemaName === 'public' && name === 'user_roles') {
      this.forbiddenCalls.push('public.user_roles');
      throw new Error('FORBIDDEN_LEGACY_REFERENCE: public.user_roles não deve ser consultada');
    }
    if (name === 'entities') return this.entities;
    if (name === 'news_sources') return this.news_sources;
    if (name === 'image_import_batches') return this.image_import_batches;
    if (name === 'image_import_items') return this.image_import_items;
    return [];
  }

  private buildTableQuery(schemaName: string, tableName: string) {
    const harness = this;
    return {
      select: () => {
        const filters: Array<(row: any) => boolean> = [];
        let orderByCol: string | null = null;
        let orderAsc = true;
        let limitCount: number | null = null;

        const execQuery = () => {
          let rows = [...harness.getTable(schemaName, tableName)];
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
        const table = harness.getTable(schemaName, tableName);
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
          const table = harness.getTable(schemaName, tableName);
          for (const row of table) {
            if (row[col] === val) {
              Object.assign(row, updates);
            }
          }
          return { data: null, error: null };
        }
      })
    };
  }

  public client: any = {
    auth: {
      getUser: async (token: string) => {
        if (token === 'admin_jwt_metadata') {
          return {
            data: {
              user: {
                id: 'admin-meta-uuid',
                email: 'admin-meta@fatosbr.com.br',
                app_metadata: { is_admin: true, role: 'super_admin' }
              }
            },
            error: null
          };
        }
        if (token === 'admin_jwt_internal_role') {
          return {
            data: {
              user: {
                id: 'admin-internal-role-uuid',
                email: 'admin-role@fatosbr.com.br',
                app_metadata: {} // Sem flag em app_metadata: autorizado EXCLUSIVAMENTE por internal.user_roles
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
        this.forbiddenCalls.push(`getBucket:${name}`);
        throw new Error('FORBIDDEN_BUCKET_CHECK: Não deve consultar/recriar buckets');
      },
      createBucket: async (name: string) => {
        this.forbiddenCalls.push(`createBucket:${name}`);
        throw new Error('FORBIDDEN_BUCKET_CREATE: Não deve criar/recriar buckets');
      },
      from: (bucketName: string) => {
        if (bucketName !== 'brand-assets' && bucketName !== 'brand-assets-staging') {
          this.forbiddenCalls.push(`unknownBucket:${bucketName}`);
          throw new Error(`Bucket inesperado: ${bucketName}`);
        }
        return {
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
                arrayBuffer: async () =>
                  obj.buffer.buffer.slice(obj.buffer.byteOffset, obj.buffer.byteOffset + obj.buffer.byteLength)
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
        };
      }
    },
    schema: (schemaName: string) => ({
      from: (tableName: string) => this.buildTableQuery(schemaName, tableName)
    }),
    from: (tableName: string) => this.buildTableQuery('public', tableName),
    rpc: async (fnName: string) => {
      this.forbiddenCalls.push(`rpc:${fnName}`);
      throw new Error(`FORBIDDEN_RPC_CALL: ${fnName} não existe e não deve ser chamada`);
    }
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
  console.log('🖼️  FATOSBR — SUITE ADMIN IMAGE LIBRARY V1.1 (CORRETIVA)');
  console.log('   (ZIP/MIME reais; internal.user_roles + buckets separados via Mock)');
  console.log('=====================================================================\n');

  const harness = new MockSupabaseLibraryHarness();
  harness.resetData();
  setTestSupabaseClient(harness.client);

  // ---------------------------------------------------------------------------
  // 1. VALIDAÇÃO DE SEGURANÇA ZIP, IMAGENS & COMPATIBILIDADE MANIFEST FATOSBR
  // ---------------------------------------------------------------------------
  console.log('--- 1. Segurança ZIP, Magic Bytes, Zip Bomb, Traversal & Manifest FatosBR ---');

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
      uncompressedSize: 2 * 1024 * 1024
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

  await runTest('1.6 Rejeita MIME falso e SVG XSS (<script> / onload=), aceitando SVG limpo, JPEG e WebP', async () => {
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

  await runTest('1.7 Compatibilidade FatosBR manifest.json (subpasta, seções PT/EN, inferência de tipo e review_status)', async () => {
    const entries = parseImageManifest(
      JSON.stringify({
        __proto__: { polluted: true },
        empresas: [
          { slug: 'petrobras', file_path: 'empresas/petrobras.png', status: 'approved' },
          { slug: 'itau-unibanco', logo_path: 'empresas/itau.png', review_status: 'requires_brand_review' }
        ],
        pessoas: [{ name: 'Gabriel Galípolo', image_path: 'pessoas/galipolo.jpg' }],
        fontes: [{ source_domain: 'valor.globo.com', path: 'fontes/valor.webp' }]
      }),
      'fatosbr-assets'
    );
    assert(entries.length === 4, `Esperado 4 entradas, obtido ${entries.length}`);
    assert(entries[0].targetType === 'COMPANY' && entries[0].zipEntryPath === 'fatosbr-assets/empresas/petrobras.png', 'Prefixed path falhou');
    assert(entries[1].requiresBrandReview === true, 'review_status requires_brand_review deve bloquear');
    assert(entries[2].targetType === 'PERSON' && entries[2].name === 'Gabriel Galípolo', 'Pessoa falhou');
    assert(entries[3].targetType === 'SOURCE' && entries[3].domain === 'valor.globo.com', 'Fonte falhou');
  });

  // ---------------------------------------------------------------------------
  // 2. AUTORIZAÇÃO ESTRITA: SESSÃO SUPABASE + INTERNAL.USER_ROLES (SEM PUBLIC.IS_ADMIN)
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Sessão Supabase Obrigatória, internal.user_roles e Bloqueio de Usuários Comuns ---');

  await runTest('2.1 Rejeita requisição sem sessão (401) e rejeita ADMIN_SECRET estático sem sessão Supabase (401)', async () => {
    const r1 = createMockRes();
    await imageLibraryHandler(createMockReq({ method: 'GET', url: '/api/admin/image-library?action=history' }), r1.res);
    assert(r1.result().statusCode === 401, `Esperado 401 sem header, recebido ${r1.result().statusCode}`);

    const rSecret = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=preview',
        headers: { authorization: `Bearer ${process.env.ADMIN_SECRET}` },
        body: {}
      }),
      rSecret.res
    );
    assert(rSecret.result().statusCode === 401, `Sessão Supabase obrigatória: ADMIN_SECRET isolado deve dar 401, recebido ${rSecret.result().statusCode}`);
  });

  await runTest('2.2 Usuário comum autenticado recebe HTTP 403 FORBIDDEN_ADMIN em todas as rotas administrativas', async () => {
    const routes = [
      { method: 'GET', url: '/api/admin/image-library?action=history' },
      { method: 'POST', url: '/api/admin/image-library?action=init-upload', body: { fileName: 'x.zip', fileSizeBytes: 100 } },
      { method: 'POST', url: '/api/admin/image-library?action=preview', body: {} },
      { method: 'POST', url: '/api/admin/image-library?action=apply', body: { batchId: 'b1', confirmed: true } },
      { method: 'POST', url: '/api/admin/image-library?action=reprocess', body: { batchId: 'b1' } }
    ];

    for (const rt of routes) {
      const r = createMockRes();
      await imageLibraryHandler(
        createMockReq({
          method: rt.method,
          url: rt.url,
          headers: { authorization: 'Bearer user_jwt_non_admin' },
          body: rt.body
        }),
        r.res
      );
      assert(r.result().statusCode === 403, `Usuário comum deve receber 403 em ${rt.url}, recebido ${r.result().statusCode}`);
      assert(r.result().json?.error === 'FORBIDDEN_ADMIN', 'Código deve ser FORBIDDEN_ADMIN');
    }

    const rLogo = createMockRes();
    await companyLogoHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/company-logo',
        headers: { authorization: 'Bearer user_jwt_non_admin' },
        body: { entityId: '1111', base64: 'abc' }
      }),
      rLogo.res
    );
    assert(rLogo.result().statusCode === 403, `Upload individual para usuário comum deve dar 403, recebido ${rLogo.result().statusCode}`);
  });

  await runTest('2.3 Admin autorizado via internal.user_roles (sem app_metadata) acessa normalmente sem consultar public.user_roles ou public.is_admin()', async () => {
    const r = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'GET',
        url: '/api/admin/image-library?action=history',
        headers: { authorization: 'Bearer admin_jwt_internal_role' }
      }),
      r.res
    );
    assert(r.result().statusCode === 200, `Admin via internal.user_roles deveria receber 200, recebido ${r.result().statusCode}`);
    assert(harness.forbiddenCalls.length === 0, `Chamadas legadas proibidas detectadas: ${harness.forbiddenCalls.join(', ')}`);
  });

  // ---------------------------------------------------------------------------
  // 3. SEPARAÇÃO DE BUCKETS (BRAND-ASSETS-STAGING VS BRAND-ASSETS), PREVIEW & APPLY
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Staging Privado (brand-assets-staging) -> Público (brand-assets) -> DB ---');

  let createdBatchId = '';
  let blockedReviewItemId = '';

  await runTest('3.1 init-upload gera Signed URL exclusivamente em brand-assets-staging (privado)', async () => {
    harness.resetData();
    const { res, result } = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=init-upload',
        headers: { authorization: 'Bearer admin_jwt_internal_role' },
        body: { fileName: 'fatosbr-pack.zip', fileSizeBytes: 5 * 1024 * 1024 }
      }),
      res
    );
    const out = result();
    assert(out.statusCode === 200 && out.json?.success, 'init-upload falhou');
    assert(out.json.signedUrl.includes('/brand-assets-staging/'), `Signed URL deve usar brand-assets-staging: ${out.json.signedUrl}`);
    assert(harness.forbiddenCalls.length === 0, 'Não pode criar/verificar buckets');
  });

  await runTest('3.2 Preview salva staging apenas em brand-assets-staging, nunca toca brand-assets nem DB', async () => {
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

    zip.file('fatosbr-zip/manifest.json', JSON.stringify(manifest));
    zip.file('fatosbr-zip/companies/petrobras.png', buildMinimalValidPng(64, 64, true));
    zip.file('fatosbr-zip/people/galipolo.jpg', buildMinimalJpeg());
    zip.file('fatosbr-zip/sources/valor.webp', buildMinimalWebp());
    zip.file('fatosbr-zip/companies/itau.png', buildMinimalValidPng(64, 64, true));
    zip.file('fatosbr-zip/companies/fantasma.png', buildMinimalValidPng(64, 64, true));

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

    const { res, result } = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=preview',
        headers: { authorization: 'Bearer admin_jwt_internal_role' },
        body: { fileName: 'fatosbr-zip.zip', zipBase64: zipBuf.toString('base64') }
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

    // Verificar isolamento rigoroso dos buckets no preview:
    assert(harness.getKeysInBucket('brand-assets').length === 0, 'Bucket público brand-assets deve permanecer vazio durante preview');
    assert(harness.getKeysInBucket('brand-assets-staging').length === 3, 'Apenas as 3 aprovadas devem ir para brand-assets-staging');

    const reviewItem = batch.items.find((i: any) => i.requiresBrandReview);
    assert(Boolean(reviewItem) && reviewItem.status === 'PENDING_REVIEW', 'Item requires_brand_review deve estar em PENDING_REVIEW');
    blockedReviewItemId = reviewItem.id;

    // DB NÃO pode ter sido alterado no preview
    const petro = harness.entities.find((e) => e.slug === 'petrobras');
    assert(petro.image_url === 'https://cdn.old/petrobras-legacy.png', 'Preview não pode alterar entities.image_url antes da confirmação');
    assert(harness.forbiddenCalls.length === 0, 'Não pode criar buckets nem consultar public.user_roles/is_admin');
  });

  await runTest('3.3 Apply exige confirmação explícita (confirmed: true)', async () => {
    const { res, result } = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=apply',
        headers: { authorization: 'Bearer admin_jwt_internal_role' },
        body: { batchId: createdBatchId, confirmed: false }
      }),
      res
    );
    assert(result().statusCode === 400, `Deveria exigir confirmed: true (400), recebido ${result().statusCode}`);
  });

  await runTest('3.4 Apply move aprovadas para brand-assets, limpa staging, atualiza DB e bloqueia requires_brand_review', async () => {
    const { res, result } = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=apply',
        headers: { authorization: 'Bearer admin_jwt_internal_role' },
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
    assert(out.json.batch.status === 'COMPLETED' && out.json.batch.counts.applied === 3, 'Esperado 3 aplicadas');

    assert(harness.getKeysInBucket('brand-assets').length === 3, 'As 3 imagens aprovadas devem estar em brand-assets');
    assert(harness.getKeysInBucket('brand-assets-staging').length === 0, 'Temporários devem ser removidos de brand-assets-staging');

    const petro = harness.entities.find((e) => e.slug === 'petrobras');
    const galipolo = harness.entities.find((e) => e.slug === 'gabriel-galipolo');
    const valor = harness.news_sources.find((s) => s.domain === 'valor.globo.com');
    const itau = harness.entities.find((e) => e.slug === 'itau-unibanco');

    assert(petro.image_url.includes('/storage/v1/object/public/brand-assets/entities/companies/'), 'Petrobras deve ter URL de brand-assets');
    assert(galipolo.image_url.includes('/storage/v1/object/public/brand-assets/entities/people/'), 'Pessoa deve ter URL de brand-assets');
    assert(valor.logo_url.includes('/storage/v1/object/public/brand-assets/sources/'), 'Fonte deve ter logo_url de brand-assets');
    assert(itau.image_url === 'https://cdn.old/itau-original.png', 'Item requires_brand_review NUNCA pode ser sobrescrito');
  });

  // ---------------------------------------------------------------------------
  // 4. PRESERVAÇÃO EM FALHA, HISTÓRICO E REPROCESSAMENTO USANDO STAGING
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Preservação de Imagem Anterior, Histórico e Reprocessamento ---');

  let partialBatchId = '';

  await runTest('4.1 Falha de DB após upload remove órfão de brand-assets, preserva URL anterior e mantém staging', async () => {
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
        headers: { authorization: 'Bearer admin_jwt_internal_role' },
        body: { fileName: 'falha-parcial.zip', zipBase64: buf.toString('base64') }
      }),
      prevRes.res
    );
    partialBatchId = prevRes.result().json.batch.batchId;

    // Simula falha de atualização no DB especificamente para Vale (id 2222...)
    harness.failUpdateForEntityId = '22222222-2222-4222-8222-222222222222';

    const applyRes = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=apply',
        headers: { authorization: 'Bearer admin_jwt_internal_role' },
        body: { batchId: partialBatchId, confirmed: true }
      }),
      applyRes.res
    );

    harness.failUpdateForEntityId = null;

    const out = applyRes.result();
    assert(out.statusCode === 200 && out.json.batch.status === 'PARTIAL_FAILURE', 'Esperado PARTIAL_FAILURE');
    assert(out.json.batch.counts.applied === 1 && out.json.batch.counts.failed === 1, 'Esperado 1 aplicada e 1 falha');

    const vale = harness.entities.find((e) => e.slug === 'vale');
    assert(vale.image_url === 'https://cdn.old/vale-legacy.png', 'Imagem anterior da Vale deve ser preservada');

    const orphanKeys = harness.getKeysInBucket('brand-assets').filter((k) => k.includes('2222'));
    assert(orphanKeys.length === 0, 'Órfão da Vale em brand-assets deve ser removido após falha de DB');
    assert(harness.getKeysInBucket('brand-assets-staging').length === 1, 'Staging da Vale deve permanecer em brand-assets-staging para reprocessamento');
  });

  await runTest('4.2 Reprocessamento recupera item FAILED usando brand-assets-staging sem reenviar ZIP', async () => {
    const repRes = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/image-library?action=reprocess',
        headers: { authorization: 'Bearer admin_jwt_internal_role' },
        body: { batchId: partialBatchId }
      }),
      repRes.res
    );

    const out = repRes.result();
    assert(out.statusCode === 200 && out.json.batch.status === 'COMPLETED', `Reprocessamento deveria concluir: ${JSON.stringify(out.json)}`);
    assert(out.json.batch.counts.applied === 2 && out.json.batch.counts.failed === 0, 'Todos os itens devem ficar APPLIED');
    assert(harness.getKeysInBucket('brand-assets-staging').length === 0, 'Staging deve estar limpo após reprocessamento');

    const vale = harness.entities.find((e) => e.slug === 'vale');
    assert(vale.image_url.includes('/storage/v1/object/public/brand-assets/entities/companies/'), 'Vale atualizada em brand-assets');
  });

  await runTest('4.3 Histórico de importações retorna lotes persistidos com contagens e relatório', async () => {
    const histRes = createMockRes();
    await imageLibraryHandler(
      createMockReq({
        method: 'GET',
        url: '/api/admin/image-library?action=history',
        headers: { authorization: 'Bearer admin_jwt_metadata' }
      }),
      histRes.res
    );

    const out = histRes.result();
    assert(out.statusCode === 200 && Array.isArray(out.json?.batches) && out.json.batches.length >= 1, 'Histórico deve listar lotes');
  });

  // ---------------------------------------------------------------------------
  // 5. UPLOAD INDIVIDUAL DE LOGOTIPO PNG
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Upload Individual de Logotipo PNG (Admin) ---');

  await runTest('5.1 Upload individual PNG transparente persiste em brand-assets e atualiza entities.image_url', async () => {
    const pngAlpha = buildMinimalValidPng(64, 64, true);
    const { res, result } = createMockRes();
    await companyLogoHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/company-logo',
        headers: { authorization: 'Bearer admin_jwt_internal_role' },
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
    assert(out.json.imageUrl.includes('/storage/v1/object/public/brand-assets/'), 'Deve salvar em brand-assets');
    assert(harness.forbiddenCalls.length === 0, 'Nenhuma chamada legada proibida permitida');
  });

  await runTest('5.2 Upload individual com falha no DB preserva imagem anterior e remove órfão de brand-assets', async () => {
    harness.failUpdateForEntityId = '44444444-4444-4444-8444-444444444444';
    const pngAlpha = buildMinimalValidPng(64, 64, true);
    const beforeCount = harness.getKeysInBucket('brand-assets').length;

    const { res, result } = createMockRes();
    await companyLogoHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/company-logo',
        headers: { authorization: 'Bearer admin_jwt_internal_role' },
        body: {
          entityId: '44444444-4444-4444-8444-444444444444',
          targetType: 'COMPANY',
          base64: `data:image/png;base64,${pngAlpha.toString('base64')}`
        }
      }),
      res
    );

    harness.failUpdateForEntityId = null;

    assert(result().statusCode === 500, 'Falha no DB deve retornar 500');
    const itau = harness.entities.find((e) => e.id === '44444444-4444-4444-8444-444444444444');
    assert(itau.image_url === 'https://cdn.old/itau-original.png', 'Imagem anterior preservada em falha de upload individual');
    assert(harness.getKeysInBucket('brand-assets').length === beforeCount, 'Órfão removido de brand-assets');
  });

  await runTest('5.3 Upload individual PNG sem transparência é bloqueado com HTTP 422', async () => {
    const pngOpaque = buildMinimalValidPng(64, 64, false);
    const { res, result } = createMockRes();
    await companyLogoHandler(
      createMockReq({
        method: 'POST',
        url: '/api/admin/company-logo',
        headers: { authorization: 'Bearer admin_jwt_internal_role' },
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
