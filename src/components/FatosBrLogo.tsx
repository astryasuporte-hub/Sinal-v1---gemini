/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface FatosBrLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'full' | 'symbol' | 'text';
  glow?: boolean;
  className?: string;
  onClick?: () => void;
}

export const FatosBrLogo: React.FC<FatosBrLogoProps> = ({
  size = 'md',
  variant = 'full',
  className = '',
  onClick
}) => {
  const sizeMap = {
    sm: { height: 18, iconWidth: 28, fontSize: 'text-base', gap: 'gap-2', stroke: 2.2 },
    md: { height: 22, iconWidth: 34, fontSize: 'text-xl', gap: 'gap-2.5', stroke: 2.4 },
    lg: { height: 28, iconWidth: 44, fontSize: 'text-2xl', gap: 'gap-3', stroke: 2.6 },
    xl: { height: 38, iconWidth: 58, fontSize: 'text-3xl sm:text-4xl', gap: 'gap-3.5', stroke: 2.8 },
  };

  const currentSize = sizeMap[size];

  // Ícone de pulso/batimento contínuo idêntico ao da landing page e da imagem oficial
  const renderSymbol = () => (
    <svg
      viewBox="0 0 40 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={currentSize.stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-white transition-transform duration-200 group-hover:scale-105"
      style={{ height: currentSize.height, width: currentSize.iconWidth }}
      aria-hidden="true"
    >
      <path d="M2 12 L8 12 L11 4 L15 20 L19 8 L22 16 L25 12 L38 12" />
    </svg>
  );

  const renderWordmark = () => (
    <div className="flex items-baseline tracking-tight font-sans select-none leading-none">
      <span className="font-bold text-white tracking-[-0.03em]">
        Fatos
      </span>
      <span className="font-extrabold text-white tracking-[-0.01em]">
        BR
      </span>
    </div>
  );

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center ${currentSize.gap} group ${onClick ? 'cursor-pointer' : ''} ${className}`}
      title="FatosBR • Informação de qualidade para decisões melhores"
    >
      {variant !== 'text' && renderSymbol()}
      {variant !== 'symbol' && (
        <div className={currentSize.fontSize}>
          {renderWordmark()}
        </div>
      )}
    </div>
  );
};
