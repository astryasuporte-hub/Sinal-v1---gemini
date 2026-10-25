/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Utilitário de validação de imagem no front-end (tamanho máximo de 6 MB e tipos permitidos)
 * antes do envio ao endpoint /api/avatar/verify.
 */

export const MAX_AVATAR_SIZE_BYTES = 6 * 1024 * 1024; // 6 MB
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
];
export const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  sizeMb: number;
}

/**
 * Valida o tamanho e formato do arquivo de imagem antes de qualquer requisição.
 */
export function validateImageFile(file: File): ImageValidationResult {
  const sizeMb = Number((file.size / (1024 * 1024)).toFixed(2));

  // 1. Verificação de existência
  if (!file) {
    return {
      valid: false,
      error: 'Nenhum arquivo de imagem foi selecionado.',
      sizeMb: 0
    };
  }

  // 2. Validação de tamanho máximo (6 MB)
  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    return {
      valid: false,
      error: `A imagem selecionada possui ${sizeMb} MB, excedendo o limite máximo permitido de 6 MB. Por favor, escolha um arquivo menor.`,
      sizeMb
    };
  }

  // 3. Validação do tipo MIME e extensão
  const fileType = file.type?.toLowerCase() || '';
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  const isMimeValid = ALLOWED_IMAGE_TYPES.includes(fileType);
  const isExtValid = ALLOWED_IMAGE_EXTENSIONS.includes(extension);

  if (!isMimeValid && !isExtValid) {
    return {
      valid: false,
      error: 'Formato de imagem inválido. São permitidos apenas arquivos nos formatos JPG, PNG, WebP, GIF ou AVIF.',
      sizeMb
    };
  }

  return {
    valid: true,
    sizeMb
  };
}
