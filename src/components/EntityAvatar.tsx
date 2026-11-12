/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — EntityAvatar (UX/UI V2.2)
 * Componente unificado e resiliente para renderização de logotipos e avatares oficiais.
 * Suporta:
 * 1. Logotipos verificados oficiais de empresas (NVIDIA, OpenAI, Apple, Microsoft, Google, Petrobras, Vale, Nubank, Itaú, Embraer, Mercado Livre, etc.)
 * 2. Avatares de pessoas (monogramas elegantes ou fotos, sem misturar logos de empresas)
 * 3. Logotipos de fontes e organizações
 * 4. Tratamento resiliente de erro com fallback instantâneo e sem layout shift
 */

import React, { useState } from 'react';

export type EntityType = 'company' | 'person' | 'organization' | 'topic' | 'source' | string;

export interface EntityAvatarProps {
  name: string;
  type?: EntityType;
  logoUrl?: string;
  website?: string;
  domain?: string;
  brandColor?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showBorder?: boolean;
}

// Mapeamento normalizado de empresas prioritárias e seus ativos locais verificados
const KNOWN_COMPANY_LOGOS: Record<string, string> = {
  nvidia: '/logos/nvidia.svg',
  openai: '/logos/openai.svg',
  apple: '/logos/apple.svg',
  microsoft: '/logos/microsoft.svg',
  google: '/logos/google.svg',
  petrobras: '/logos/petrobras.svg',
  vale: '/logos/vale.svg',
  nubank: '/logos/nubank.svg',
  itau: '/logos/itau.svg',
  'itau unibanco': '/logos/itau.svg',
  embraer: '/logos/embraer.svg',
  'mercado livre': '/logos/mercadolivre.svg',
  mercadolivre: '/logos/mercadolivre.svg',
  tesla: '/logos/tesla.svg',
  meta: '/logos/meta.svg',
  amazon: '/logos/amazon.svg',
  netflix: '/logos/netflix.svg'
};

function normalizeEntityKey(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

export function getVerifiedCompanyLogo(name: string, website?: string, domain?: string): string | null {
  const normName = normalizeEntityKey(name);
  if (KNOWN_COMPANY_LOGOS[normName]) {
    return KNOWN_COMPANY_LOGOS[normName];
  }

  // Tenta por substrings
  for (const [key, logoPath] of Object.entries(KNOWN_COMPANY_LOGOS)) {
    const normKey = normalizeEntityKey(key);
    if (normName.includes(normKey) || normKey.includes(normName)) {
      return logoPath;
    }
  }

  // Tenta por website ou domínio
  const host = (domain || website || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase();

  if (host) {
    for (const [key, logoPath] of Object.entries(KNOWN_COMPANY_LOGOS)) {
      if (host.includes(key)) {
        return logoPath;
      }
    }
  }

  return null;
}

export const EntityAvatar: React.FC<EntityAvatarProps> = ({
  name = '',
  type = 'company',
  logoUrl,
  website,
  domain,
  brandColor,
  size = 'md',
  className = '',
  showBorder = true
}) => {
  const [imageFailed, setImageFailed] = useState(false);

  const sizeClasses = {
    xs: 'w-5 h-5 text-[9px] rounded-md',
    sm: 'w-7 h-7 text-[10px] rounded-lg',
    md: 'w-9 h-9 text-xs rounded-xl',
    lg: 'w-11 h-11 text-sm rounded-xl',
    xl: 'w-16 h-16 sm:w-20 sm:h-20 text-xl sm:text-2xl rounded-2xl'
  }[size];

  const iconPadding = {
    xs: 'p-0.5',
    sm: 'p-1',
    md: 'p-1.5',
    lg: 'p-2',
    xl: 'p-3'
  }[size];

  // Regra de Integridade: Não usar logos de empresas para pessoas
  const isPerson = type === 'person';

  // Resolução da URL da imagem
  let resolvedUrl: string | null = null;
  if (!isPerson) {
    if (logoUrl) {
      resolvedUrl = logoUrl;
    } else {
      resolvedUrl = getVerifiedCompanyLogo(name, website, domain);
    }
  } else if (logoUrl && (logoUrl.startsWith('data:') || logoUrl.startsWith('http') || logoUrl.startsWith('/'))) {
    // Foto pessoal verificada
    resolvedUrl = logoUrl;
  }

  const borderClass = showBorder ? 'border border-[#262832]' : '';

  // 1. Renderização de Imagem Verificada Oficial
  if (resolvedUrl && !imageFailed) {
    return (
      <div
        className={`${sizeClasses} ${iconPadding} ${borderClass} flex items-center justify-center shrink-0 bg-[#0d0e12] overflow-hidden select-none transition-colors ${className}`}
        title={name}
      >
        <img
          src={resolvedUrl}
          alt={name}
          loading="lazy"
          className="w-full h-full object-contain"
          onError={() => setImageFailed(true)}
        />
      </div>
    );
  }

  // 2. Fallback de Monograma Elegante e Tipográfico
  const cleanName = (name || '').trim();
  let monogram = 'FB';
  if (cleanName) {
    const parts = cleanName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      monogram = (parts[0][0] + parts[1][0]).toUpperCase();
    } else {
      monogram = cleanName.substring(0, 2).toUpperCase();
    }
  }

  return (
    <div
      className={`${sizeClasses} ${borderClass} flex items-center justify-center font-bold font-mono shrink-0 bg-[#14161d] text-zinc-200 select-none overflow-hidden shadow-sm transition-colors ${className}`}
      style={brandColor ? { borderBottomColor: brandColor, borderBottomWidth: 2 } : undefined}
      title={name}
    >
      <span className="leading-none tracking-tight">{monogram}</span>
    </div>
  );
};

export default EntityAvatar;
