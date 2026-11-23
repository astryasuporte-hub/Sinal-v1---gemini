/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Helper leve para entrega otimizada de imagens externas (WebP/AVIF dinâmico onde suportado).
 */

export function optimizeExternalImageUrl(
  rawUrl?: string | null,
  options?: { width?: number; quality?: number }
): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();

    // Unsplash suporta negociação nativa WebP + resize via query string
    if (host === 'images.unsplash.com' || host.endsWith('.unsplash.com')) {
      if (!url.searchParams.has('auto')) url.searchParams.set('auto', 'format');
      if (!url.searchParams.has('fm')) url.searchParams.set('fm', 'webp');
      if (options?.width && !url.searchParams.has('w')) {
        url.searchParams.set('w', String(Math.round(options.width)));
      }
      if (!url.searchParams.has('q')) {
        url.searchParams.set('q', String(options?.quality ?? 80));
      }
      return url.toString();
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}
