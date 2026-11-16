/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-Side ZIP Image Library Security Validator
 *
 * Proteções implementadas:
 * 1. Validação de Magic Bytes de arquivo ZIP (PK\x03\x04 + EOCD PK\x05\x06).
 * 2. Inspeção pré-descompressão do Central Directory contra Zip Bombs
 *    (quantidade de entradas, tamanho individual, tamanho total e taxa de compressão).
 * 3. Proteção rigorosa contra Path Traversal (.., \, /, drive letters, null bytes, symlinks).
 * 4. Verificação real de conteúdo e Magic Bytes de imagens (PNG, JPEG, WebP e SVG sanitizado).
 * 5. Leitura segura de manifest.json sem prototype pollution e extração de flags requires_brand_review.
 */

import JSZip from 'jszip';

export const ZIP_SECURITY_LIMITS = {
  MAX_ZIP_BYTES: 25 * 1024 * 1024, // 25 MB
  MAX_ENTRIES: 500,
  MAX_SINGLE_IMAGE_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_TOTAL_UNCOMPRESSED_BYTES: 60 * 1024 * 1024, // 60 MB
  MAX_COMPRESSION_RATIO: 100
};

export type ManifestTargetType = 'COMPANY' | 'PERSON' | 'SOURCE';

export interface ParsedManifestEntry {
  index: number;
  targetType: ManifestTargetType;
  name?: string;
  slug?: string;
  domain?: string;
  zipEntryPath: string;
  classification: string;
  requiresBrandReview: boolean;
  rawEntry: Record<string, any>;
}

export interface ValidatedZipImageAsset {
  entryPath: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  extension: 'png' | 'jpg' | 'webp' | 'svg';
  buffer: Buffer;
  byteSize: number;
}

export interface ZipPackageInspectionResult {
  valid: boolean;
  error?: string;
  errorCode?:
    | 'EMPTY_ZIP'
    | 'INVALID_ZIP_FORMAT'
    | 'ZIP_TOO_LARGE'
    | 'ZIP_BOMB_DETECTED'
    | 'PATH_TRAVERSAL_DETECTED'
    | 'SYMLINK_NOT_ALLOWED'
    | 'MANIFEST_MISSING'
    | 'MANIFEST_INVALID'
    | 'TOO_MANY_ENTRIES';
  manifestRootPrefix: string;
  manifestEntries: ParsedManifestEntry[];
  assetsByPath: Map<string, ValidatedZipImageAsset>;
  invalidAssetErrors: Map<string, string>;
  totalZipBytes: number;
  totalEntriesInspected: number;
}

/**
 * Normaliza e valida caminhos dentro do ZIP contra Path Traversal e Null Bytes.
 */
export function assertSafeZipEntryPath(rawPath: string): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new Error('PATH_TRAVERSAL_DETECTED: Caminho vazio no pacote ZIP.');
  }
  if (rawPath.includes('\0')) {
    throw new Error(`PATH_TRAVERSAL_DETECTED: Null byte detectado em "${rawPath}".`);
  }
  if (rawPath.includes('\\')) {
    throw new Error(`PATH_TRAVERSAL_DETECTED: Barra invertida não permitida em "${rawPath}".`);
  }
  if (rawPath.startsWith('/') || /^[a-zA-Z]:/.test(rawPath)) {
    throw new Error(`PATH_TRAVERSAL_DETECTED: Caminho absoluto não permitido em "${rawPath}".`);
  }

  const trimmed = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
  const segments = trimmed.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error(`PATH_TRAVERSAL_DETECTED: Segmento relativo proibido ("${seg}") em "${rawPath}".`);
    }
  }

  return segments.filter(Boolean).join('/');
}

/**
 * Inspeciona o Central Directory do arquivo ZIP ANTES da descompressão
 * para barrar Zip Bombs, symlinks e Path Traversal sem alocar memória desnecessária.
 */
export function inspectZipCentralDirectory(zipBuffer: Buffer): {
  totalEntries: number;
  declaredUncompressedTotal: number;
} {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) {
    throw new Error('INVALID_ZIP_FORMAT: Arquivo ZIP vazio ou corrompido.');
  }
  if (zipBuffer.length > ZIP_SECURITY_LIMITS.MAX_ZIP_BYTES) {
    throw new Error(
      `ZIP_TOO_LARGE: O arquivo ZIP excede o limite de ${(ZIP_SECURITY_LIMITS.MAX_ZIP_BYTES / (1024 * 1024)).toFixed(0)} MB.`
    );
  }

  // Verificar Local File Header magic (PK\x03\x04) ou EOCD vazio (PK\x05\x06)
  const magic = zipBuffer.readUInt32LE(0);
  if (magic !== 0x04034b50 && magic !== 0x06054b50) {
    throw new Error('INVALID_ZIP_FORMAT: Assinatura binária ZIP inválida.');
  }

  // Localizar End of Central Directory (PK\x05\x06) nos últimos 65KB
  const minEocdOffset = Math.max(0, zipBuffer.length - 65557);
  let eocdOffset = -1;
  for (let pos = zipBuffer.length - 22; pos >= minEocdOffset; pos--) {
    if (zipBuffer.readUInt32LE(pos) === 0x06054b50) {
      eocdOffset = pos;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('INVALID_ZIP_FORMAT: Estrutura End of Central Directory ausente.');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries === 0) {
    throw new Error('EMPTY_ZIP: O pacote ZIP não contém arquivos.');
  }
  if (totalEntries > ZIP_SECURITY_LIMITS.MAX_ENTRIES) {
    throw new Error(
      `TOO_MANY_ENTRIES: O pacote ZIP possui ${totalEntries} entradas (máximo permitido: ${ZIP_SECURITY_LIMITS.MAX_ENTRIES}).`
    );
  }

  if (cdOffset + cdSize > eocdOffset || cdOffset > zipBuffer.length) {
    throw new Error('INVALID_ZIP_FORMAT: Central Directory fora dos limites do arquivo.');
  }

  let cursor = cdOffset;
  let inspected = 0;
  let declaredUncompressedTotal = 0;

  while (cursor + 46 <= cdOffset + cdSize && inspected < totalEntries) {
    const sig = zipBuffer.readUInt32LE(cursor);
    if (sig !== 0x02014b50) {
      throw new Error('INVALID_ZIP_FORMAT: Registro de Central Directory inválido.');
    }

    const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
    const fileNameLength = zipBuffer.readUInt16LE(cursor + 28);
    const extraLength = zipBuffer.readUInt16LE(cursor + 30);
    const commentLength = zipBuffer.readUInt16LE(cursor + 32);
    const externalAttrs = zipBuffer.readUInt32LE(cursor + 38);

    const recordEnd = cursor + 46 + fileNameLength + extraLength + commentLength;
    if (recordEnd > zipBuffer.length) {
      throw new Error('INVALID_ZIP_FORMAT: Entrada ZIP truncada no Central Directory.');
    }

    const fileName = zipBuffer.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf-8');
    assertSafeZipEntryPath(fileName);

    // Bloqueio de symlinks Unix (S_IFLNK = 0o120000)
    const unixMode = (externalAttrs >>> 16) & 0o170000;
    if (unixMode === 0o120000) {
      throw new Error(`SYMLINK_NOT_ALLOWED: Link simbólico não permitido ("${fileName}").`);
    }

    // Bloqueio ZIP64 oversized ou tamanho individual excessivo
    if (uncompressedSize === 0xffffffff || uncompressedSize > ZIP_SECURITY_LIMITS.MAX_SINGLE_IMAGE_BYTES * 2) {
      throw new Error(
        `ZIP_BOMB_DETECTED: Arquivo "${fileName}" declara tamanho descomprimido excessivo (${uncompressedSize} bytes).`
      );
    }

    declaredUncompressedTotal += uncompressedSize;
    if (declaredUncompressedTotal > ZIP_SECURITY_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error(
        `ZIP_BOMB_DETECTED: Tamanho total descomprimido excede ${(ZIP_SECURITY_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024)).toFixed(0)} MB.`
      );
    }

    if (uncompressedSize > 65536) {
      if (compressedSize === 0 || uncompressedSize / compressedSize > ZIP_SECURITY_LIMITS.MAX_COMPRESSION_RATIO) {
        throw new Error(
          `ZIP_BOMB_DETECTED: Taxa de compressão suspeita em "${fileName}" (${uncompressedSize}/${compressedSize}).`
        );
      }
    }

    cursor = recordEnd;
    inspected++;
  }

  return { totalEntries: inspected, declaredUncompressedTotal };
}

/**
 * Valida o conteúdo binário de uma imagem (Magic Bytes, MIME e sanitização SVG).
 */
export function validateImageBufferAndMime(
  buffer: Buffer,
  fileName: string
): {
  valid: boolean;
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  extension?: 'png' | 'jpg' | 'webp' | 'svg';
  error?: string;
} {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return { valid: false, error: `Arquivo "${fileName}" vazio ou truncado.` };
  }
  if (buffer.length > ZIP_SECURITY_LIMITS.MAX_SINGLE_IMAGE_BYTES) {
    return {
      valid: false,
      error: `Arquivo "${fileName}" excede o limite de 5 MB (${(buffer.length / (1024 * 1024)).toFixed(2)} MB).`
    };
  }

  const lower = fileName.toLowerCase();

  // 1. PNG (89 50 4E 47 0D 0A 1A 0A + IHDR)
  if (
    buffer.length >= 28 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    if (!lower.endsWith('.png')) {
      return { valid: false, error: `Extensão incompatível com conteúdo PNG em "${fileName}".` };
    }
    const chunk = buffer.subarray(12, 16).toString('ascii');
    if (chunk !== 'IHDR') {
      return { valid: false, error: `PNG corrompido (IHDR ausente) em "${fileName}".` };
    }
    const w = buffer.readUInt32BE(16);
    const h = buffer.readUInt32BE(20);
    if (w < 16 || h < 16 || w > 4096 || h > 4096) {
      return { valid: false, error: `Dimensões PNG fora do intervalo permitido (${w}x${h}px) em "${fileName}".` };
    }
    return { valid: true, mimeType: 'image/png', extension: 'png' };
  }

  // 2. JPEG (FF D8 FF)
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    if (!lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) {
      return { valid: false, error: `Extensão incompatível com conteúdo JPEG em "${fileName}".` };
    }
    return { valid: true, mimeType: 'image/jpeg', extension: 'jpg' };
  }

  // 3. WebP (RIFF....WEBP)
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    if (!lower.endsWith('.webp')) {
      return { valid: false, error: `Extensão incompatível com conteúdo WebP em "${fileName}".` };
    }
    return { valid: true, mimeType: 'image/webp', extension: 'webp' };
  }

  // 4. SVG (texto XML seguro sem scripts/XSS/foreignObject/external links)
  if (lower.endsWith('.svg')) {
    const rawText = buffer.toString('utf-8').replace(/^\uFEFF/, '').trim();
    const headLower = rawText.slice(0, 300).toLowerCase();
    if (!headLower.startsWith('<svg') && !headLower.startsWith('<?xml')) {
      return { valid: false, error: `Conteúdo SVG inválido em "${fileName}".` };
    }
    if (!/<svg[\s>]/i.test(rawText)) {
      return { valid: false, error: `Tag <svg> ausente em "${fileName}".` };
    }

    // Bloqueio rigoroso contra XSS em SVG
    const dangerousPatterns: Array<[RegExp, string]> = [
      [/<script[\s>]/i, 'tag <script>'],
      [/\bon[a-z]+\s*=/i, 'handler de evento inline (on*)'],
      [/javascript\s*:/i, 'protocolo javascript:'],
      [/vbscript\s*:/i, 'protocolo vbscript:'],
      [/data\s*:\s*text\/html/i, 'payload data:text/html'],
      [/<foreignObject[\s>]/i, 'tag <foreignObject>'],
      [/<iframe[\s>]/i, 'tag <iframe>'],
      [/<object[\s>]/i, 'tag <object>'],
      [/<embed[\s>]/i, 'tag <embed>'],
      [/(?:xlink:)?href\s*=\s*["']\s*https?:/i, 'referência externa HTTP em SVG']
    ];

    for (const [pattern, label] of dangerousPatterns) {
      if (pattern.test(rawText)) {
        return { valid: false, error: `SVG rejeitado por segurança (${label}) em "${fileName}".` };
      }
    }

    return { valid: true, mimeType: 'image/svg+xml', extension: 'svg' };
  }

  return {
    valid: false,
    error: `Tipo de imagem não suportado ou assinatura binária inválida em "${fileName}". Aceito apenas PNG, JPG, WebP ou SVG seguro.`
  };
}

function normalizeTargetType(rawType: any, sectionFallback?: ManifestTargetType): ManifestTargetType | null {
  const val = String(rawType || '').trim().toLowerCase();
  if (!val) return sectionFallback || null;
  if (['company', 'empresa', 'companies', 'empresas', 'organization', 'org'].includes(val)) {
    return 'COMPANY';
  }
  if (['person', 'pessoa', 'people', 'pessoas'].includes(val)) {
    return 'PERSON';
  }
  if (['source', 'fonte', 'sources', 'fontes', 'news_source', 'news_sources'].includes(val)) {
    return 'SOURCE';
  }
  return sectionFallback || null;
}

function normalizeZipRelativePath(rawFilePath: string, rootPrefix: string): string {
  const cleaned = rawFilePath.replace(/^\.\//, '');
  const safeRelative = assertSafeZipEntryPath(cleaned);
  if (rootPrefix && !safeRelative.startsWith(`${rootPrefix}/`)) {
    return `${rootPrefix}/${safeRelative}`;
  }
  return safeRelative;
}

/**
 * Faz o parse seguro de manifest.json suportando formatos planos ou agrupados.
 */
export function parseImageManifest(
  manifestJsonText: string,
  rootPrefix = ''
): ParsedManifestEntry[] {
  let parsed: any;
  try {
    parsed = JSON.parse(manifestJsonText, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    });
  } catch {
    throw new Error('MANIFEST_INVALID: manifest.json não é um JSON válido.');
  }

  const rawEntries: Array<{ item: any; fallbackType?: ManifestTargetType }> = [];

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      rawEntries.push({ item });
    }
  } else if (parsed && typeof parsed === 'object') {
    const listCandidates = parsed.items || parsed.entries || parsed.assets || parsed.files || parsed.images;
    if (Array.isArray(listCandidates)) {
      for (const item of listCandidates) {
        rawEntries.push({ item });
      }
    }
    if (Array.isArray(parsed.companies)) {
      for (const item of parsed.companies) rawEntries.push({ item, fallbackType: 'COMPANY' });
    }
    if (Array.isArray(parsed.people)) {
      for (const item of parsed.people) rawEntries.push({ item, fallbackType: 'PERSON' });
    }
    if (Array.isArray(parsed.sources)) {
      for (const item of parsed.sources) rawEntries.push({ item, fallbackType: 'SOURCE' });
    }
  }

  if (rawEntries.length === 0) {
    throw new Error('MANIFEST_INVALID: manifest.json não possui itens mapeados.');
  }

  const entries: ParsedManifestEntry[] = [];

  rawEntries.forEach(({ item, fallbackType }, idx) => {
    if (!item || typeof item !== 'object') return;

    const rawFile =
      item.file ??
      item.path ??
      item.filePath ??
      item.filename ??
      item.image ??
      item.asset ??
      item.logo ??
      '';

    const targetType = normalizeTargetType(
      item.type ?? item.entityType ?? item.targetType ?? item.kind ?? item.category,
      fallbackType
    );

    if (!rawFile || !targetType) {
      return;
    }

    const zipEntryPath = normalizeZipRelativePath(String(rawFile).trim(), rootPrefix);

    const rawClassification = String(
      item.classification ?? item.reviewStatus ?? item.status ?? item.approval ?? 'approved'
    )
      .trim()
      .toLowerCase();

    const flagArray = Array.isArray(item.flags) ? item.flags.map((f: any) => String(f).toLowerCase()) : [];

    const requiresBrandReview =
      rawClassification === 'requires_brand_review' ||
      item.requires_brand_review === true ||
      item.requiresBrandReview === true ||
      flagArray.includes('requires_brand_review');

    entries.push({
      index: idx,
      targetType,
      name: item.name ? String(item.name).trim() : item.title ? String(item.title).trim() : undefined,
      slug: item.slug ? String(item.slug).trim() : undefined,
      domain: item.domain
        ? String(item.domain).trim()
        : item.website
        ? String(item.website).trim()
        : undefined,
      zipEntryPath,
      classification: requiresBrandReview ? 'requires_brand_review' : rawClassification || 'approved',
      requiresBrandReview,
      rawEntry: item
    });
  });

  if (entries.length === 0) {
    throw new Error('MANIFEST_INVALID: Nenhuma entrada válida com tipo (COMPANY/PERSON/SOURCE) e arquivo encontrada no manifest.json.');
  }

  return entries;
}

/**
 * Executa inspeção completa, extração segura e validação do pacote ZIP inteiro.
 */
export async function inspectAndExtractImageZip(zipBuffer: Buffer): Promise<ZipPackageInspectionResult> {
  try {
    const cdInfo = inspectZipCentralDirectory(zipBuffer);
    const zip = await JSZip.loadAsync(zipBuffer);

    const allEntries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (allEntries.length === 0) {
      return {
        valid: false,
        errorCode: 'EMPTY_ZIP',
        error: 'O pacote ZIP não contém arquivos.',
        manifestRootPrefix: '',
        manifestEntries: [],
        assetsByPath: new Map(),
        invalidAssetErrors: new Map(),
        totalZipBytes: zipBuffer.length,
        totalEntriesInspected: cdInfo.totalEntries
      };
    }

    // Ignorar metadados de sistema (__MACOSX / .DS_Store) e validar caminhos
    const cleanEntries: Array<{ safePath: string; entry: JSZip.JSZipObject }> = [];
    for (const entry of allEntries) {
      const safePath = assertSafeZipEntryPath(entry.name);
      if (
        safePath.startsWith('__MACOSX/') ||
        safePath.endsWith('/.DS_Store') ||
        safePath === '.DS_Store'
      ) {
        continue;
      }
      cleanEntries.push({ safePath, entry });
    }

    // Localizar manifest.json (raiz ou 1 nível abaixo se compactado via pasta)
    let manifestPair = cleanEntries.find((e) => e.safePath.toLowerCase() === 'manifest.json');
    let manifestRootPrefix = '';

    if (!manifestPair) {
      const nestedManifests = cleanEntries.filter((e) =>
        /^[^/]+\/manifest\.json$/i.test(e.safePath)
      );
      if (nestedManifests.length === 1) {
        manifestPair = nestedManifests[0];
        manifestRootPrefix = manifestPair.safePath.split('/')[0];
      }
    }

    if (!manifestPair) {
      return {
        valid: false,
        errorCode: 'MANIFEST_MISSING',
        error: 'Arquivo manifest.json não encontrado no pacote ZIP.',
        manifestRootPrefix: '',
        manifestEntries: [],
        assetsByPath: new Map(),
        invalidAssetErrors: new Map(),
        totalZipBytes: zipBuffer.length,
        totalEntriesInspected: cdInfo.totalEntries
      };
    }

    const manifestBuf = await manifestPair.entry.async('nodebuffer');
    if (manifestBuf.length > 2 * 1024 * 1024) {
      return {
        valid: false,
        errorCode: 'MANIFEST_INVALID',
        error: 'manifest.json excede o tamanho máximo permitido (2 MB).',
        manifestRootPrefix,
        manifestEntries: [],
        assetsByPath: new Map(),
        invalidAssetErrors: new Map(),
        totalZipBytes: zipBuffer.length,
        totalEntriesInspected: cdInfo.totalEntries
      };
    }

    const manifestEntries = parseImageManifest(manifestBuf.toString('utf-8'), manifestRootPrefix);

    // Extrair apenas arquivos referenciados no manifest (evitando descompressão cega)
    const entryMap = new Map<string, JSZip.JSZipObject>();
    for (const { safePath, entry } of cleanEntries) {
      entryMap.set(safePath, entry);
      entryMap.set(safePath.toLowerCase(), entry);
    }

    const assetsByPath = new Map<string, ValidatedZipImageAsset>();
    const invalidAssetErrors = new Map<string, string>();
    let totalExtractedBytes = manifestBuf.length;

    for (const mEntry of manifestEntries) {
      if (assetsByPath.has(mEntry.zipEntryPath) || invalidAssetErrors.has(mEntry.zipEntryPath)) {
        continue;
      }

      const zipObj =
        entryMap.get(mEntry.zipEntryPath) || entryMap.get(mEntry.zipEntryPath.toLowerCase());

      if (!zipObj) {
        invalidAssetErrors.set(
          mEntry.zipEntryPath,
          `Arquivo "${mEntry.zipEntryPath}" listado no manifest.json não existe no pacote ZIP.`
        );
        continue;
      }

      const fileBuf = await zipObj.async('nodebuffer');
      totalExtractedBytes += fileBuf.length;

      if (totalExtractedBytes > ZIP_SECURITY_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
        return {
          valid: false,
          errorCode: 'ZIP_BOMB_DETECTED',
          error: 'ZIP_BOMB_DETECTED: Volume total extraído excedeu o limite de segurança.',
          manifestRootPrefix,
          manifestEntries: [],
          assetsByPath: new Map(),
          invalidAssetErrors: new Map(),
          totalZipBytes: zipBuffer.length,
          totalEntriesInspected: cdInfo.totalEntries
        };
      }

      const imgCheck = validateImageBufferAndMime(fileBuf, mEntry.zipEntryPath);
      if (!imgCheck.valid || !imgCheck.mimeType || !imgCheck.extension) {
        invalidAssetErrors.set(mEntry.zipEntryPath, imgCheck.error || 'Imagem inválida.');
        continue;
      }

      assetsByPath.set(mEntry.zipEntryPath, {
        entryPath: mEntry.zipEntryPath,
        mimeType: imgCheck.mimeType,
        extension: imgCheck.extension,
        buffer: fileBuf,
        byteSize: fileBuf.length
      });
    }

    return {
      valid: true,
      manifestRootPrefix,
      manifestEntries,
      assetsByPath,
      invalidAssetErrors,
      totalZipBytes: zipBuffer.length,
      totalEntriesInspected: cdInfo.totalEntries
    };
  } catch (err: any) {
    const msg = String(err?.message || 'Falha ao processar pacote ZIP.');
    let errorCode: ZipPackageInspectionResult['errorCode'] = 'INVALID_ZIP_FORMAT';
    if (msg.includes('ZIP_BOMB_DETECTED')) errorCode = 'ZIP_BOMB_DETECTED';
    else if (msg.includes('PATH_TRAVERSAL_DETECTED')) errorCode = 'PATH_TRAVERSAL_DETECTED';
    else if (msg.includes('SYMLINK_NOT_ALLOWED')) errorCode = 'SYMLINK_NOT_ALLOWED';
    else if (msg.includes('ZIP_TOO_LARGE')) errorCode = 'ZIP_TOO_LARGE';
    else if (msg.includes('TOO_MANY_ENTRIES')) errorCode = 'TOO_MANY_ENTRIES';
    else if (msg.includes('EMPTY_ZIP')) errorCode = 'EMPTY_ZIP';
    else if (msg.includes('MANIFEST_INVALID')) errorCode = 'MANIFEST_INVALID';

    return {
      valid: false,
      errorCode,
      error: msg,
      manifestRootPrefix: '',
      manifestEntries: [],
      assetsByPath: new Map(),
      invalidAssetErrors: new Map(),
      totalZipBytes: zipBuffer?.length || 0,
      totalEntriesInspected: 0
    };
  }
}
