/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — Logotipo Oficial (UX/UI V2.2)
 * Renderiza com <picture> (AVIF + WebP + fallback PNG) e dimensões intrínsecas explícitas para CLS = 0.
 */

import React from 'react';

interface FatosBrLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'compact' | 'symbol' | 'full' | 'institutional';
  className?: string;
  onClick?: () => void;
  priority?: boolean;
  glow?: boolean;
}

const BRAND_ASSETS = {
  symbol: {
    base: '/assets/brand/fatosbr-symbol',
    alt: 'Símbolo Oficial FatosBR',
    width: 195,
    height: 230,
  },
  institutional: {
    base: '/assets/brand/fatosbr-logo-full',
    alt: 'FatosBR • O essencial do Brasil e do mundo',
    width: 1000,
    height: 260,
  },
  compact: {
    base: '/assets/brand/fatosbr-logo-compact',
    alt: 'FatosBR',
    width: 1000,
    height: 190,
  },
} as const;

export const FatosBrLogo: React.FC<FatosBrLogoProps> = ({
  size = 'md',
  variant = 'compact',
  className = '',
  onClick,
  priority = true
}) => {
  const heightClasses = {
    sm: 'h-6 sm:h-7',
    md: 'h-7 sm:h-8',
    lg: 'h-9 sm:h-10',
    xl: 'h-12 sm:h-14'
  }[size];

  const asset =
    variant === 'symbol'
      ? BRAND_ASSETS.symbol
      : variant === 'institutional' || variant === 'full'
      ? BRAND_ASSETS.institutional
      : BRAND_ASSETS.compact;

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center shrink-0 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      title="FatosBR • O essencial do Brasil e do mundo"
    >
      <picture>
        <source srcSet={`${asset.base}.avif`} type="image/avif" />
        <source srcSet={`${asset.base}.webp`} type="image/webp" />
        <img
          src={`${asset.base}.png`}
          alt={asset.alt}
          width={asset.width}
          height={asset.height}
          className={`${heightClasses} w-auto object-contain select-none`}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
        />
      </picture>
    </div>
  );
};

export default FatosBrLogo;
