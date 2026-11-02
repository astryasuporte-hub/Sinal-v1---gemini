/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Componente: CompanyLogoBadge (Estritamente Monocromático)
 * Exibe logos de empresas, entidades e tópicos em preto, cinza e branco.
 */

import React from 'react';

export interface CompanyLogoBadgeProps {
  name: string;
  brandColor?: string;
  logoUrl?: string;
  type?: 'company' | 'person' | 'organization' | 'topic' | 'source' | string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const CompanyLogoBadge: React.FC<CompanyLogoBadgeProps> = ({
  name = '',
  logoUrl,
  size = 'md',
  className = ''
}) => {
  const [imageError, setImageError] = React.useState(false);

  const sizeClasses = {
    xs: 'w-4 h-4 text-[9px] rounded',
    sm: 'w-6 h-6 text-[10px] rounded-md',
    md: 'w-8 h-8 text-xs rounded-lg',
    lg: 'w-10 h-10 text-sm rounded-xl',
    xl: 'w-16 h-16 sm:w-20 sm:h-20 text-xl sm:text-2xl rounded-2xl'
  }[size];

  // Se houver um logotipo customizado (PNG com transparência) carregado, exibe prioritariamente
  if (logoUrl && !imageError) {
    return (
      <div
        className={`${sizeClasses} flex items-center justify-center shrink-0 border border-zinc-700 bg-zinc-900 overflow-hidden p-0.5 select-none ${className}`}
        title={name}
      >
        <img
          src={logoUrl}
          alt={name}
          className="w-full h-full object-contain filter grayscale"
          onError={() => setImageError(true)}
        />
      </div>
    );
  }

  // Monograma Monocromático Elegante
  const monogram = name ? name.trim().substring(0, 2).toUpperCase() : 'FB';

  return (
    <div
      className={`${sizeClasses} flex items-center justify-center font-bold font-mono shadow-sm shrink-0 border border-zinc-700 bg-zinc-800 text-white select-none overflow-hidden ${className}`}
      title={name}
    >
      <span className="leading-none tracking-tight">{monogram}</span>
    </div>
  );
};
