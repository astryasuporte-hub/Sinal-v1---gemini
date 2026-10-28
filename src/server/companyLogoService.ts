/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Company Logo Service — Validador Server-Side de Logotipos PNG Transparentes
 * 1. Validação de Magic Bytes (PNG: 89 50 4E 47 0D 0A 1A 0A)
 * 2. Inspeção de chunks (IHDR): largura, altura, profundidade de bits e tipo de cor
 * 3. Validação estrita de canal alfa / transparência (ColorType 4/6 ou chunk tRNS)
 * 4. Limite de tamanho de arquivo (máx 4 MB) e limites dimensionais (24px a 2048px)
 * 5. Armazenamento seguro e persistência
 */

import fs from 'fs';
import path from 'path';

export interface CompanyLogoValidationResult {
  valid: boolean;
  error?: string;
  width?: number;
  height?: number;
  colorType?: number;
  hasAlpha?: boolean;
  fileSizeBytes?: number;
  cleanDataUrl?: string;
  storageUrl?: string;
}

// Magic Bytes oficiais da especificação W3C / ISO para PNG
const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Inspeciona rigorosamente um arquivo PNG em busca de assinatura válida,
 * dimensões e presença de transparência (canal alfa).
 */
export function validatePngTransparency(rawBuffer: Buffer): CompanyLogoValidationResult {
  // 1. Verificação de Tamanho Mínimo e Máximo (4 MB)
  const MAX_SIZE = 4 * 1024 * 1024;
  if (!rawBuffer || rawBuffer.length < 32) {
    return {
      valid: false,
      error: 'Arquivo vazio ou truncado.'
    };
  }

  if (rawBuffer.length > MAX_SIZE) {
    const sizeMb = (rawBuffer.length / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `O logotipo enviado possui ${sizeMb} MB, excedendo o limite máximo de 4 MB.`
    };
  }

  // 2. Validação estrita de Magic Bytes
  if (!rawBuffer.subarray(0, 8).equals(PNG_MAGIC_BYTES)) {
    return {
      valid: false,
      error: 'Arquivo inválido. O logotipo da empresa deve ser obrigatoriamente uma imagem PNG (.png).'
    };
  }

  // 3. Inspeção do chunk IHDR (sempre o primeiro chunk do PNG, nos bytes 12..28)
  const chunkType = rawBuffer.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') {
    return {
      valid: false,
      error: 'Estrutura PNG corrompida: chunk IHDR ausente.'
    };
  }

  const width = rawBuffer.readUInt32BE(16);
  const height = rawBuffer.readUInt32BE(20);
  const bitDepth = rawBuffer.readUInt8(24);
  const colorType = rawBuffer.readUInt8(25);

  // 4. Validação de Dimensões
  if (width < 24 || height < 24) {
    return {
      valid: false,
      width,
      height,
      error: `Dimensões muito reduzidas (${width}x${height}px). O logotipo deve ter no mínimo 24x24px.`
    };
  }

  if (width > 2048 || height > 2048) {
    return {
      valid: false,
      width,
      height,
      error: `Dimensões muito elevadas (${width}x${height}px). O logotipo deve ter no máximo 2048x2048px.`
    };
  }

  // 5. Verificação de Transparência (Canal Alfa ou chunk tRNS)
  // Color Types PNG:
  // 0: Grayscale
  // 2: Truecolor (RGB)
  // 3: Indexed-color (paleta)
  // 4: Grayscale with alpha (canal alfa explícito)
  // 6: Truecolor with alpha (RGBA - canal alfa explícito)
  let hasAlpha = colorType === 4 || colorType === 6;

  // Se for paleta ou RGB/Grayscale, busca por chunk tRNS (transparência de cor/índice)
  if (!hasAlpha) {
    let offset = 8;
    while (offset < rawBuffer.length - 8) {
      const length = rawBuffer.readUInt32BE(offset);
      const type = rawBuffer.subarray(offset + 4, offset + 8).toString('ascii');
      if (type === 'tRNS') {
        hasAlpha = true;
        break;
      }
      if (type === 'IEND') break;
      offset += 12 + length;
    }
  }

  if (!hasAlpha) {
    return {
      valid: false,
      width,
      height,
      colorType,
      hasAlpha: false,
      error: 'O logotipo enviado não possui fundo transparente (canal alfa). Para manter a integridade visual da FatosBR, envie um arquivo PNG com transparência.'
    };
  }

  return {
    valid: true,
    width,
    height,
    colorType,
    hasAlpha: true,
    fileSizeBytes: rawBuffer.length
  };
}

/**
 * Salva e sanitiza o logotipo de uma empresa
 */
export async function saveCompanyLogoUpload(
  entityId: string,
  base64OrDataUrl: string,
  fileName = 'logo.png'
): Promise<CompanyLogoValidationResult> {
  const cleanEntityId = entityId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!cleanEntityId) {
    return {
      valid: false,
      error: 'Identificador de empresa inválido.'
    };
  }

  // Extrair buffer binário da string Base64
  let rawBuffer: Buffer;
  try {
    const commaIndex = base64OrDataUrl.indexOf(',');
    const pureBase64 = commaIndex !== -1 ? base64OrDataUrl.substring(commaIndex + 1) : base64OrDataUrl;
    rawBuffer = Buffer.from(pureBase64, 'base64');
  } catch {
    return {
      valid: false,
      error: 'Falha ao decodificar arquivo binário da imagem.'
    };
  }

  // Validação rigorosa
  const check = validatePngTransparency(rawBuffer);
  if (!check.valid) {
    return check;
  }

  const cleanDataUrl = `data:image/png;base64,${rawBuffer.toString('base64')}`;

  // Salvar cópia em diretório de assets para acesso estático persistente
  try {
    const logosDir = path.resolve(process.cwd(), 'public', 'logos');
    if (!fs.existsSync(logosDir)) {
      fs.mkdirSync(logosDir, { recursive: true });
    }
    const filePath = path.join(logosDir, `${cleanEntityId}.png`);
    fs.writeFileSync(filePath, rawBuffer);
    const storageUrl = `/logos/${cleanEntityId}.png`;

    return {
      valid: true,
      width: check.width,
      height: check.height,
      colorType: check.colorType,
      hasAlpha: true,
      fileSizeBytes: rawBuffer.length,
      cleanDataUrl,
      storageUrl
    };
  } catch (fsErr) {
    console.warn('Armazenamento em disco local falhou, mantendo Data URL seguro:', fsErr);
    return {
      valid: true,
      width: check.width,
      height: check.height,
      colorType: check.colorType,
      hasAlpha: true,
      fileSizeBytes: rawBuffer.length,
      cleanDataUrl,
      storageUrl: cleanDataUrl
    };
  }
}
