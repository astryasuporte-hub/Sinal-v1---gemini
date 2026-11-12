/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — Logotipo Oficial (UX/UI V2.2)
 * Renderiza a identidade visual oficial fielmente extraída do ativo mestre da marca:
 * - Símbolo estilizado oficial em "F"
 * - Wordmark "FatosBR"
 * - Versão horizontal compacta oficial para headers mobile/desktop
 * - Fundo transparente com contraste preservado sobre fundo escuro (#050505)
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

export const FatosBrLogo: React.FC<FatosBrLogoProps> = ({
  size = 'md',
  variant = 'compact',
  className = '',
  onClick,
  priority = true
}) => {
  // Alturas calibradas para garantir proporções e nitidez em telas de alta densidade
  const heightClasses = {
    sm: 'h-6 sm:h-7',
    md: 'h-7 sm:h-8',
    lg: 'h-9 sm:h-10',
    xl: 'h-12 sm:h-14'
  }[size];

  // Variante: apenas o símbolo estilizado em "F"
  if (variant === 'symbol') {
    return (
      <div
        onClick={onClick}
        className={`inline-flex items-center shrink-0 ${onClick ? 'cursor-pointer' : ''} ${className}`}
        title="FatosBR • O essencial do Brasil e do mundo"
      >
        <img
          src="/assets/brand/fatosbr-symbol.png"
          alt="Símbolo Oficial FatosBR"
          className={`${heightClasses} w-auto object-contain select-none`}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
        />
      </div>
    );
  }

  // Variante: Institucional completa (com assinatura "O ESSENCIAL DO BRASIL E DO MUNDO")
  if (variant === 'institutional') {
    return (
      <div
        onClick={onClick}
        className={`inline-flex items-center shrink-0 ${onClick ? 'cursor-pointer' : ''} ${className}`}
        title="FatosBR • O essencial do Brasil e do mundo"
      >
        <img
          src="/assets/brand/fatosbr-logo-full.png"
          alt="FatosBR • O essencial do Brasil e do mundo"
          className={`${heightClasses} w-auto object-contain select-none`}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
        />
      </div>
    );
  }

  // Variante padrão: Compacta (Símbolo + Linha Divisória + FatosBR) perfeita para cabeçalhos mobile e desktop
  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center shrink-0 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      title="FatosBR • O essencial do Brasil e do mundo"
    >
      <img
        src="/assets/brand/fatosbr-logo-compact.png"
        alt="FatosBR"
        className={`${heightClasses} w-auto object-contain select-none`}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
      />
    </div>
  );
};

export default FatosBrLogo;
