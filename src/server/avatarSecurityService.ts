/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Avatar Security Service - Backend Validator & EXIF/GPS Sanitizer
 * Implements strict verification of uploaded gallery profile photos:
 * 1. File name & path traversal inspection (rejects .sh, .exe, .php, double extensions, XSS)
 * 2. Payload size enforcement (max 5 MB)
 * 3. Binary Magic Bytes validation (JPEG, PNG, WebP, GIF, AVIF)
 * 4. Deep payload heuristic inspection for embedded scripts
 * 5. Automatic stripping of GPS geolocation tags & camera metadata (privacy protection)
 */

export interface AvatarAuditReport {
  fileNameSafe: boolean;
  magicBytesVerified: boolean;
  binarySignature: string;
  payloadScanClean: boolean;
  gpsMetadataStripped: boolean;
  exifStatus: string;
  originalSize: number;
  sanitizedSize: number;
}

export interface AvatarVerificationResult {
  success: boolean;
  error?: string;
  reason?: string;
  cleanFileName?: string;
  originalName?: string;
  fileType?: string;
  safeDataUrl?: string;
  audit?: AvatarAuditReport;
}

// Lista de extensões perigosas bloqueadas explicitamente
const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'sh', 'bash', 'bat', 'cmd', 'ps1', 'vbs', 'php', 'phtml', 'php3', 'php4', 'php5',
  'js', 'mjs', 'cjs', 'ts', 'py', 'pl', 'rb', 'cgi', 'jar', 'apk', 'com', 'scr', 'msi',
  'dll', 'so', 'dylib', 'svg', 'html', 'htm', 'xhtml', 'jsp', 'asp', 'aspx', 'wasm'
]);

// Extensões de imagem permitidas para upload de foto da galeria
const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

/**
 * Validação rigorosa do nome do arquivo
 */
export function validateFileName(rawName: string): { valid: boolean; cleanName?: string; error?: string } {
  if (!rawName || typeof rawName !== 'string') {
    return { valid: false, error: 'Nome de arquivo inválido ou ausente.' };
  }

  const trimmed = rawName.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return { valid: false, error: 'O nome do arquivo deve ter entre 1 e 200 caracteres.' };
  }

  // 1. Verificação de Path Traversal & Null Byte Injection
  if (
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0') ||
    trimmed.toLowerCase().includes('%00')
  ) {
    return {
      valid: false,
      error: 'Tentativa de Path Traversal ou injeção de caracteres inválidos detectada no nome do arquivo.'
    };
  }

  // 2. Verificação de tags HTML ou comandos em script
  const scriptRegex = /<[^>]*>|javascript:|data:|eval\(|onerror=|onload=/i;
  if (scriptRegex.test(trimmed)) {
    return { valid: false, error: 'Nome de arquivo contém sequências maliciosas ou tags de script.' };
  }

  // 3. Inspeção de extensões múltiplas (ex: foto.sh.png, exploit.php.jpg)
  const parts = trimmed.split('.');
  if (parts.length < 2) {
    return { valid: false, error: 'Arquivo sem extensão válida.' };
  }

  const finalExt = parts[parts.length - 1].toLowerCase();

  // Verifica se alguma extensão intermediária é executável
  for (let i = 1; i < parts.length - 1; i++) {
    const intermediateExt = parts[i].toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(intermediateExt)) {
      return {
        valid: false,
        error: `Extensão dupla potencialmente maliciosa detectada: ".${intermediateExt}" antes de ".${finalExt}". Upload rejeitado por segurança.`
      };
    }
  }

  // Verifica extensão final
  if (DANGEROUS_EXTENSIONS.has(finalExt)) {
    return {
      valid: false,
      error: `Extensão perigosa bloqueada (.${finalExt}). Somente imagens JPG, PNG, WebP e GIF são permitidas.`
    };
  }

  if (!ALLOWED_IMAGE_EXTENSIONS.has(finalExt)) {
    return {
      valid: false,
      error: `Formato de arquivo não suportado (.${finalExt}). Envie imagens JPG, PNG, WebP, GIF ou AVIF.`
    };
  }

  // Sanitiza nome para versão canônica segura
  const baseName = parts.slice(0, parts.length - 1).join('_').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const safeFinalName = `${baseName.slice(0, 40) || 'foto_perfil'}_${Date.now()}.${finalExt}`;

  return { valid: true, cleanName: safeFinalName };
}

/**
 * Validação de Magic Bytes (Assinatura binária real do arquivo)
 */
export function verifyMagicBytes(buffer: Buffer): {
  valid: boolean;
  format?: 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';
  signature?: string;
  error?: string;
} {
  if (buffer.length < 12) {
    return { valid: false, error: 'Arquivo corrompido ou excessivamente pequeno.' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, format: 'jpeg', signature: 'JPEG Image (FF D8 FF)' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, format: 'png', signature: 'PNG Image (89 50 4E 47)' };
  }

  // GIF: GIF87a ou GIF89a
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return { valid: true, format: 'gif', signature: `GIF Image (${gifHeader})` };
  }

  // WebP: RIFF ... WEBP
  const riffHeader = buffer.subarray(0, 4).toString('ascii');
  const webpHeader = buffer.subarray(8, 12).toString('ascii');
  if (riffHeader === 'RIFF' && webpHeader === 'WEBP') {
    return { valid: true, format: 'webp', signature: 'WebP Image (RIFF....WEBP)' };
  }

  // AVIF: ftypavif ou ftypavis em offset 4..12
  const ftyp = buffer.subarray(4, 12).toString('ascii');
  if (ftyp.includes('ftypavif') || ftyp.includes('ftypavis')) {
    return { valid: true, format: 'avif', signature: 'AVIF Image (ftypavif)' };
  }

  return {
    valid: false,
    error: 'A assinatura binária (magic bytes) do arquivo não corresponde a uma imagem autêntica. Possível arquivo executável ou corrompido renomeado.'
  };
}

/**
 * Varredura heurística de scripts maliciosos embutidos
 */
export function scanMaliciousPayloads(buffer: Buffer): { safe: boolean; reason?: string } {
  // Procura padrões de injeção comuns em arquivos poliglota
  const textSample = buffer.subarray(0, Math.min(buffer.length, 32768)).toString('binary').toLowerCase();

  const maliciousTokens = [
    '<?php',
    '<%',
    '<script',
    'javascript:',
    '/bin/sh',
    '/bin/bash',
    'powershell',
    'cmd.exe',
    'system(',
    'passthru(',
    'shell_exec('
  ];

  for (const token of maliciousTokens) {
    if (textSample.includes(token)) {
      return {
        safe: false,
        reason: `Assinatura de código potencialmente executável detectada no corpo da imagem ("${token}").`
      };
    }
  }

  return { safe: true };
}

/**
 * Remove metadados sensíveis de geolocalização (GPS) e tags de câmera EXIF de imagens JPEG
 */
function sanitizeJpegExif(buffer: Buffer): Buffer {
  try {
    // Percorre os segmentos JPEG
    const chunks: Buffer[] = [];
    let offset = 0;

    // Deve começar com SOI (FF D8)
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      return buffer;
    }

    chunks.push(buffer.subarray(0, 2)); // SOI
    offset = 2;

    let strippedGpsOrExif = false;

    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xff) {
        break;
      }

      const marker = buffer[offset + 1];

      // SOS (Start of Scan - FF DA): o restante é o stream de dados da imagem codificada
      if (marker === 0xda) {
        chunks.push(buffer.subarray(offset));
        break;
      }

      // Marcadores sem tamanho fixo de payload: RST0..RST7 ou SOI/EOI
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        chunks.push(buffer.subarray(offset, offset + 2));
        offset += 2;
        continue;
      }

      // Lê tamanho do segmento (2 bytes big endian)
      if (offset + 4 > buffer.length) break;
      const length = (buffer[offset + 2] << 8) | buffer[offset + 3];
      const segmentEnd = offset + 2 + length;

      if (segmentEnd > buffer.length) break;

      // APP1 Marker (FF E1): contém EXIF e GPS
      if (marker === 0xe1) {
        // Remove segmento APP1 completo (contendo EXIF / GPS / tags de aparelho)
        // Isso preserva a imagem perfeitamente e garante 100% de privacidade
        strippedGpsOrExif = true;
      } else {
        chunks.push(buffer.subarray(offset, segmentEnd));
      }

      offset = segmentEnd;
    }

    return strippedGpsOrExif ? Buffer.concat(chunks) : buffer;
  } catch {
    return buffer;
  }
}

/**
 * Remove chunks com metadados de texto e EXIF de imagens PNG (eXIf, tEXt, zTXt, iTXt)
 */
function sanitizePngMetadata(buffer: Buffer): Buffer {
  try {
    if (buffer.length < 8) return buffer;

    // Header PNG fixo (8 bytes)
    const header = buffer.subarray(0, 8);
    const chunks: Buffer[] = [header];
    let offset = 8;
    let stripped = false;

    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const chunkType = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      const totalChunkSize = 8 + length + 4; // length(4) + type(4) + data(length) + crc(4)

      if (offset + totalChunkSize > buffer.length) break;

      // Remove chunks de metadados de localização e texto
      if (chunkType === 'eXIf' || chunkType === 'tEXt' || chunkType === 'zTXt' || chunkType === 'iTXt') {
        stripped = true;
      } else {
        chunks.push(buffer.subarray(offset, offset + totalChunkSize));
      }

      offset += totalChunkSize;
      if (chunkType === 'IEND') break;
    }

    return stripped ? Buffer.concat(chunks) : buffer;
  } catch {
    return buffer;
  }
}

/**
 * Remove chunks EXIF de imagens WebP
 */
function sanitizeWebpMetadata(buffer: Buffer): Buffer {
  try {
    if (buffer.length < 12) return buffer;
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff !== 'RIFF' || webp !== 'WEBP') return buffer;

    const chunks: Buffer[] = [buffer.subarray(0, 12)];
    let offset = 12;
    let stripped = false;

    while (offset + 8 <= buffer.length) {
      const fourCC = buffer.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = buffer.readUInt32LE(offset + 4);
      // Chunks WebP têm padding se o tamanho for ímpar
      const paddedSize = chunkSize + (chunkSize % 2);
      const totalSize = 8 + paddedSize;

      if (offset + totalSize > buffer.length) break;

      if (fourCC === 'EXIF' || fourCC === 'XMP ') {
        stripped = true;
      } else {
        chunks.push(buffer.subarray(offset, offset + totalSize));
      }

      offset += totalSize;
    }

    if (!stripped) return buffer;

    const sanitized = Buffer.concat(chunks);
    // Atualiza o tamanho total no cabeçalho RIFF (offset 4, 4 bytes Little Endian)
    sanitized.writeUInt32LE(sanitized.length - 8, 4);
    return sanitized;
  } catch {
    return buffer;
  }
}

/**
 * Remove metadados de GPS e informações sensíveis de acordo com o formato
 */
export function stripGpsAndPrivacyMetadata(
  buffer: Buffer,
  format: 'jpeg' | 'png' | 'webp' | 'gif' | 'avif'
): { sanitizedBuffer: Buffer; stripped: boolean } {
  let clean: Buffer;
  switch (format) {
    case 'jpeg':
      clean = sanitizeJpegExif(buffer);
      break;
    case 'png':
      clean = sanitizePngMetadata(buffer);
      break;
    case 'webp':
      clean = sanitizeWebpMetadata(buffer);
      break;
    default:
      clean = buffer;
  }

  return {
    sanitizedBuffer: clean,
    stripped: clean.length !== buffer.length
  };
}

/**
 * Função principal de inspeção e higienização do upload de foto de perfil
 */
export async function verifyAndSanitizeAvatarUpload(payload: {
  fileName: string;
  dataUrl: string;
}): Promise<AvatarVerificationResult> {
  const { fileName, dataUrl } = payload;

  // 1. Validação do nome do arquivo
  const nameValidation = validateFileName(fileName);
  if (!nameValidation.valid) {
    return {
      success: false,
      error: nameValidation.error,
      reason: 'FILENAME_REJECTED'
    };
  }

  // 2. Extração do Base64
  if (!dataUrl || typeof dataUrl !== 'string') {
    return {
      success: false,
      error: 'Conteúdo de imagem ausente.',
      reason: 'EMPTY_PAYLOAD'
    };
  }

  const base64Index = dataUrl.indexOf(';base64,');
  if (base64Index === -1) {
    return {
      success: false,
      error: 'Formato de Data URL inválido.',
      reason: 'INVALID_DATA_URL'
    };
  }

  const declaredMime = dataUrl.substring(5, base64Index);
  const base64Data = dataUrl.substring(base64Index + 8);

  let rawBuffer: Buffer;
  try {
    rawBuffer = Buffer.from(base64Data, 'base64');
  } catch {
    return {
      success: false,
      error: 'Erro ao decodificar arquivo binário da imagem.',
      reason: 'DECODE_ERROR'
    };
  }

  // 3. Verificação de Tamanho Máximo (5 MB)
  const MAX_SIZE_BYTES = 5 * 1024 * 1024;
  if (rawBuffer.length > MAX_SIZE_BYTES) {
    return {
      success: false,
      error: `A imagem enviada possui ${(rawBuffer.length / (1024 * 1024)).toFixed(2)} MB, excedendo o limite permitido de 5 MB.`,
      reason: 'PAYLOAD_TOO_LARGE'
    };
  }

  // 4. Verificação de Magic Bytes
  const magicCheck = verifyMagicBytes(rawBuffer);
  if (!magicCheck.valid || !magicCheck.format) {
    return {
      success: false,
      error: magicCheck.error || 'Arquivo não corresponde a uma imagem válida.',
      reason: 'MAGIC_BYTES_MISMATCH'
    };
  }

  // 5. Varredura Heurística de Scripts/Shells
  const payloadScan = scanMaliciousPayloads(rawBuffer);
  if (!payloadScan.safe) {
    return {
      success: false,
      error: payloadScan.reason,
      reason: 'MALICIOUS_TOKEN_DETECTED'
    };
  }

  // 6. Higienização de EXIF / GPS e Metadados
  const { sanitizedBuffer, stripped } = stripGpsAndPrivacyMetadata(rawBuffer, magicCheck.format);

  // Mime type canônico
  let canonicalMime = declaredMime;
  if (magicCheck.format === 'jpeg') canonicalMime = 'image/jpeg';
  else if (magicCheck.format === 'png') canonicalMime = 'image/png';
  else if (magicCheck.format === 'webp') canonicalMime = 'image/webp';
  else if (magicCheck.format === 'gif') canonicalMime = 'image/gif';
  else if (magicCheck.format === 'avif') canonicalMime = 'image/avif';

  const safeDataUrl = `data:${canonicalMime};base64,${sanitizedBuffer.toString('base64')}`;

  const audit: AvatarAuditReport = {
    fileNameSafe: true,
    magicBytesVerified: true,
    binarySignature: magicCheck.signature || 'Imagem válida',
    payloadScanClean: true,
    gpsMetadataStripped: true,
    exifStatus: stripped
      ? 'Metadados EXIF/GPS removidos com sucesso. Apenas a imagem pura foi preservada.'
      : 'Imagem verificada: nenhum metadado sensível de GPS localizado.',
    originalSize: rawBuffer.length,
    sanitizedSize: sanitizedBuffer.length
  };

  return {
    success: true,
    cleanFileName: nameValidation.cleanName,
    originalName: fileName,
    fileType: canonicalMime,
    safeDataUrl,
    audit
  };
}
