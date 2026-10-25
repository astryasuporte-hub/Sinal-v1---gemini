/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AvatarValidationResult {
  valid: boolean;
  error?: string;
  originalSizeMb: number;
  dimensions?: { width: number; height: number };
  dataUrl?: string;
}

export const avatarProcessing = {
  MAX_FILE_SIZE_BYTES: 6 * 1024 * 1024, // 6 MB

  /**
   * Validação rápida e higienização local de foto de perfil no navegador (até 6 MB)
   */
  async processAvatarFile(file: File): Promise<AvatarValidationResult> {
    const sizeMb = Number((file.size / (1024 * 1024)).toFixed(2));

    // 1. Verificação de tamanho máximo (até 6 MB)
    if (file.size > this.MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: `O arquivo selecionado (${sizeMb} MB) excede o limite máximo permitido de 6 MB.`,
        originalSizeMb: sizeMb
      };
    }

    // 2. Verificação de tipo de arquivo
    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    const isMimeValid = validMimes.includes(file.type.toLowerCase()) || /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name);
    if (!isMimeValid) {
      return {
        valid: false,
        error: 'Formato de imagem inválido. Por favor, envie uma foto em JPG, PNG, WebP ou AVIF.',
        originalSizeMb: sizeMb
      };
    }

    // 3. Inspeção de Magic Bytes (Assinatura binária do arquivo)
    try {
      const buffer = await file.slice(0, 16).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
      const isRiffWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // RIFF
      const isAvif = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70; // ftyp

      if (!isJpeg && !isPng && !isGif && !isRiffWebp && !isAvif) {
        return {
          valid: false,
          error: 'A assinatura binária do arquivo não corresponde a uma imagem válida.',
          originalSizeMb: sizeMb
        };
      }
    } catch {
      // Fallback gracioso se leitura binária falhar
    }

    // 4. Carregamento em memória e remoção de EXIF/GPS via Canvas
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const rawDataUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          try {
            // Desenha em Canvas 2D: o ato de desenhar no Canvas descarta automaticamente
            // todos os metadados EXIF, localização GPS e metadados de câmera.
            const size = Math.min(img.width, img.height);
            const targetDim = 512; // Resolução padrão ideal para avatares nítidos
            const canvas = document.createElement('canvas');
            canvas.width = targetDim;
            canvas.height = targetDim;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
              resolve({
                valid: true,
                originalSizeMb: sizeMb,
                dimensions: { width: img.width, height: img.height },
                dataUrl: rawDataUrl
              });
              return;
            }

            // Corte central quadrado padrão
            const startX = (img.width - size) / 2;
            const startY = (img.height - size) / 2;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, startX, startY, size, size, 0, 0, targetDim, targetDim);

            // Exporta WebP otimizado (ou JPEG se não suportado)
            const cleanDataUrl = canvas.toDataURL('image/webp', 0.92);

            resolve({
              valid: true,
              originalSizeMb: sizeMb,
              dimensions: { width: img.width, height: img.height },
              dataUrl: cleanDataUrl
            });
          } catch {
            resolve({
              valid: true,
              originalSizeMb: sizeMb,
              dimensions: { width: img.width, height: img.height },
              dataUrl: rawDataUrl
            });
          }
        };

        img.onerror = () => {
          resolve({
            valid: false,
            error: 'Não foi possível decodificar o arquivo de imagem.',
            originalSizeMb: sizeMb
          });
        };

        img.src = rawDataUrl;
      };

      reader.onerror = () => {
        resolve({
          valid: false,
          error: 'Falha ao ler o arquivo no dispositivo.',
          originalSizeMb: sizeMb
        });
      };

      reader.readAsDataURL(file);
    });
  },

  /**
   * Recorta e aplica zoom na imagem baseado em coordenadas interativas
   */
  cropAndZoomImage(
    sourceDataUrl: string,
    zoom: number = 1.0,
    offsetX: number = 0,
    offsetY: number = 0,
    targetSize: number = 512
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(sourceDataUrl);
            return;
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Área da imagem baseada no zoom
          const minDim = Math.min(img.width, img.height);
          const visibleDim = minDim / Math.max(zoom, 1);

          const centerX = img.width / 2 + offsetX * (img.width / 4);
          const centerY = img.height / 2 + offsetY * (img.height / 4);

          const startX = Math.max(0, Math.min(img.width - visibleDim, centerX - visibleDim / 2));
          const startY = Math.max(0, Math.min(img.height - visibleDim, centerY - visibleDim / 2));

          ctx.drawImage(img, startX, startY, visibleDim, visibleDim, 0, 0, targetSize, targetSize);
          resolve(canvas.toDataURL('image/webp', 0.92));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = reject;
      img.src = sourceDataUrl;
    });
  }
};
