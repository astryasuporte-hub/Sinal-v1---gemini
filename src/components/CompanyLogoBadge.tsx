/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Sparkles, Building2, User, Landmark, Globe, Layers, Scale } from 'lucide-react';

export interface CompanyLogoBadgeProps {
  name: string;
  brandColor?: string;
  type?: 'company' | 'person' | 'organization' | 'topic' | 'source' | string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const CompanyLogoBadge: React.FC<CompanyLogoBadgeProps> = ({
  name = '',
  brandColor,
  type = 'company',
  size = 'md',
  className = ''
}) => {
  const norm = (name || '').trim().toLowerCase();

  const sizeClasses = {
    xs: 'w-4 h-4 text-[9px] rounded',
    sm: 'w-6 h-6 text-[10px] rounded-md',
    md: 'w-8 h-8 text-xs rounded-lg',
    lg: 'w-10 h-10 text-sm rounded-xl',
    xl: 'w-16 h-16 sm:w-20 sm:h-20 text-xl sm:text-2xl rounded-2xl'
  }[size];

  // 1. Brasil / Governo Federal
  if (norm === 'brasil' || norm.includes('governo federal') || norm.includes('planalto')) {
    return (
      <div
        className={`${sizeClasses} bg-[#009b3a] flex items-center justify-center font-bold shadow-sm shrink-0 border border-black/40 overflow-hidden ${className}`}
        title="Brasil"
      >
        <div className="w-3/5 h-2/5 bg-[#fedf00] flex items-center justify-center transform rotate-45">
          <div className="w-1/2 h-1/2 rounded-full bg-[#002776] transform -rotate-45" />
        </div>
      </div>
    );
  }

  // 2. Petrobras
  if (norm.includes('petrobras') || norm.includes('petr4') || norm.includes('petr3')) {
    return (
      <div
        className={`${sizeClasses} bg-[#008542] text-white flex items-center justify-center font-black tracking-tighter shrink-0 border border-emerald-900 shadow-sm overflow-hidden select-none ${className}`}
        title="Petrobras"
      >
        <span className="font-extrabold text-[#fedf00] leading-none">BR</span>
      </div>
    );
  }

  // 3. Nubank
  if (norm.includes('nubank') || norm === 'nu') {
    return (
      <div
        className={`${sizeClasses} bg-[#820ad1] text-white flex items-center justify-center font-black shrink-0 border border-purple-900 shadow-sm select-none ${className}`}
        title="Nubank"
      >
        <span className="font-black tracking-tight text-white leading-none">Nu</span>
      </div>
    );
  }

  // 4. Vale
  if (norm === 'vale' || norm.includes('vale ') || norm.includes('vale s.a')) {
    return (
      <div
        className={`${sizeClasses} bg-[#007e7a] text-white flex items-center justify-center font-bold shrink-0 border border-teal-900 shadow-sm select-none ${className}`}
        title="Vale"
      >
        <span className="font-black text-[#fedf00] leading-none">V</span>
      </div>
    );
  }

  // 5. Itaú
  if (norm.includes('itaú') || norm.includes('itau')) {
    return (
      <div
        className={`${sizeClasses} bg-[#ec7000] text-white flex items-center justify-center font-black shrink-0 border border-orange-800 shadow-sm select-none ${className}`}
        title="Itaú"
      >
        <span className="font-black text-white leading-none">i</span>
      </div>
    );
  }

  // 6. Embraer
  if (norm.includes('embraer')) {
    return (
      <div
        className={`${sizeClasses} bg-[#002b49] text-white flex items-center justify-center font-black shrink-0 border border-cyan-900 shadow-sm select-none ${className}`}
        title="Embraer"
      >
        <span className="font-extrabold text-cyan-300 leading-none">EMB</span>
      </div>
    );
  }

  // 7. Mercado Livre
  if (norm.includes('mercado livre') || norm.includes('mercadolibre')) {
    return (
      <div
        className={`${sizeClasses} bg-[#ffe600] text-[#2d3277] flex items-center justify-center font-black shrink-0 border border-amber-400 shadow-sm select-none ${className}`}
        title="Mercado Livre"
      >
        <span className="font-black tracking-tighter text-[#2d3277] leading-none">ML</span>
      </div>
    );
  }

  // 8. Banco do Brasil
  if (norm.includes('banco do brasil') || norm === 'bb') {
    return (
      <div
        className={`${sizeClasses} bg-[#fedf00] text-[#002776] flex items-center justify-center font-black shrink-0 border border-yellow-500 shadow-sm select-none ${className}`}
        title="Banco do Brasil"
      >
        <span className="font-black text-[#002776] leading-none">BB</span>
      </div>
    );
  }

  // 9. B3
  if (norm === 'b3' || norm.includes('b3 ')) {
    return (
      <div
        className={`${sizeClasses} bg-[#121921] text-cyan-400 flex items-center justify-center font-black shrink-0 border border-cyan-800 shadow-sm select-none ${className}`}
        title="B3"
      >
        <span className="font-black tracking-tighter text-cyan-400 leading-none">[B]³</span>
      </div>
    );
  }

  // 10. Apple
  if (norm === 'apple' || norm.includes('apple inc')) {
    return (
      <div
        className={`${sizeClasses} bg-[#18181b] text-white flex items-center justify-center shrink-0 border border-zinc-700 shadow-sm ${className}`}
        title="Apple"
      >
        <svg className="w-1/2 h-1/2 fill-white" viewBox="0 0 170 170" xmlns="http://www.w3.org/2000/svg">
          <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.08-7.71-7.96-12.02-14.64-5.87-9.04-10.4-19.14-13.6-30.3-3.2-11.16-4.8-21.75-4.8-31.78 0-14.8 3.82-27.18 11.45-37.13 7.63-9.96 17.15-15.06 28.56-15.3 4.8.12 10.23 1.34 16.29 3.66 6.06 2.32 10.28 3.54 12.66 3.66 2.05-.12 6.53-1.37 13.43-3.76 6.9-2.39 12.44-3.52 16.63-3.39 12.73.6 22.8 5.12 30.2 13.56-11.08 6.72-16.51 15.93-16.29 27.63.22 9.27 3.8 17.18 10.74 23.73 6.94 6.55 15.24 10.26 24.9 11.13-2.15 6.3-4.69 12.35-7.63 18.15zM119.22 33.15c0-7.39 2.65-14.35 7.95-20.88 5.3-6.53 11.96-10.87 19.98-13.02.12 1.3.18 2.39.18 3.26 0 7.39-2.73 14.35-8.19 20.88-5.46 6.53-12.18 10.79-20.16 12.78-.12-1.07-.18-2.07-.18-3.02z" />
        </svg>
      </div>
    );
  }

  // 11. NVIDIA
  if (norm.includes('nvidia')) {
    return (
      <div
        className={`${sizeClasses} bg-[#76b900] text-black flex items-center justify-center font-black shrink-0 border border-lime-700 shadow-sm select-none ${className}`}
        title="NVIDIA"
      >
        <span className="font-black text-black leading-none">NV</span>
      </div>
    );
  }

  // 12. OpenAI
  if (norm.includes('openai')) {
    return (
      <div
        className={`${sizeClasses} bg-[#10a37f] text-white flex items-center justify-center font-black shrink-0 border border-emerald-700 shadow-sm ${className}`}
        title="OpenAI"
      >
        <Sparkles className="w-1/2 h-1/2 text-white" />
      </div>
    );
  }

  // 13. Microsoft
  if (norm.includes('microsoft')) {
    return (
      <div
        className={`${sizeClasses} bg-[#181a20] flex items-center justify-center shrink-0 border border-zinc-700 shadow-sm p-1.5 ${className}`}
        title="Microsoft"
      >
        <div className="grid grid-cols-2 gap-0.5 w-3.5 h-3.5">
          <div className="bg-[#f25022] rounded-[1px]" />
          <div className="bg-[#7fba00] rounded-[1px]" />
          <div className="bg-[#00a4ef] rounded-[1px]" />
          <div className="bg-[#ffb900] rounded-[1px]" />
        </div>
      </div>
    );
  }

  // 14. Google / Alphabet
  if (norm === 'google' || norm.includes('alphabet')) {
    return (
      <div
        className={`${sizeClasses} bg-white text-zinc-900 flex items-center justify-center font-black shrink-0 border border-zinc-300 shadow-sm select-none ${className}`}
        title="Google"
      >
        <span className="font-black text-[#4285f4] leading-none">G</span>
      </div>
    );
  }

  // 15. Meta
  if (norm === 'meta' || norm.includes('meta platforms')) {
    return (
      <div
        className={`${sizeClasses} bg-[#0668e1] text-white flex items-center justify-center font-black shrink-0 border border-blue-700 shadow-sm select-none ${className}`}
        title="Meta"
      >
        <span className="font-black text-white leading-none">∞</span >
      </div>
    );
  }

  // 16. Tesla
  if (norm.includes('tesla')) {
    return (
      <div
        className={`${sizeClasses} bg-[#e82127] text-white flex items-center justify-center font-black shrink-0 border border-red-800 shadow-sm select-none ${className}`}
        title="Tesla"
      >
        <span className="font-black text-white leading-none">T</span>
      </div>
    );
  }

  // 17. Amazon
  if (norm.includes('amazon')) {
    return (
      <div
        className={`${sizeClasses} bg-[#131921] text-[#ff9900] flex items-center justify-center font-black shrink-0 border border-amber-900 shadow-sm select-none ${className}`}
        title="Amazon"
      >
        <span className="font-black text-[#ff9900] leading-none">a</span>
      </div>
    );
  }

  // 18. Netflix
  if (norm.includes('netflix')) {
    return (
      <div
        className={`${sizeClasses} bg-[#141414] text-[#e50914] flex items-center justify-center font-black shrink-0 border border-red-950 shadow-sm select-none ${className}`}
        title="Netflix"
      >
        <span className="font-black text-[#e50914] leading-none">N</span>
      </div>
    );
  }

  // 19. Banco Central / BCB / Copom
  if (norm.includes('banco central') || norm.includes('bcb') || norm.includes('copom')) {
    return (
      <div
        className={`${sizeClasses} bg-[#1e3a8a] text-white flex items-center justify-center font-black shrink-0 border border-blue-900 shadow-sm select-none ${className}`}
        title="Banco Central"
      >
        <span className="font-black text-cyan-300 leading-none">BCB</span>
      </div>
    );
  }

  // 20. STF / STJ / Judiciário
  if (norm.includes('stf') || norm.includes('stj') || norm.includes('supremo')) {
    return (
      <div
        className={`${sizeClasses} bg-[#312e81] text-white flex items-center justify-center font-black shrink-0 border border-indigo-900 shadow-sm ${className}`}
        title="Supremo Tribunal Federal"
      >
        <Scale className="w-1/2 h-1/2 text-amber-300" />
      </div>
    );
  }

  // 21. Bitcoin / Cripto
  if (norm.includes('bitcoin') || norm.includes('crypto') || norm.includes('cripto') || norm.includes('btc')) {
    return (
      <div
        className={`${sizeClasses} bg-[#f7931a] text-white flex items-center justify-center font-black shrink-0 border border-amber-600 shadow-sm select-none ${className}`}
        title="Bitcoin"
      >
        <span className="leading-none">₿</span>
      </div>
    );
  }

  // 22. Tema Tecnologia / IA
  if (norm.includes('inteligência artificial') || norm === 'ia' || norm.includes('tecnologia')) {
    return (
      <div
        className={`${sizeClasses} bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center font-bold shadow-sm shrink-0 border border-indigo-400/40 ${className}`}
      >
        <Sparkles className="w-1/2 h-1/2 text-white" />
      </div>
    );
  }

  // Fallback por tipo de entidade
  const bg = brandColor || '#27272a';
  const isWhiteBg = bg.toLowerCase() === '#ffffff' || bg.toLowerCase() === '#ffe600';
  const monogram = name ? name.trim().substring(0, 2).toUpperCase() : 'SN';

  return (
    <div
      className={`${sizeClasses} flex items-center justify-center font-bold shadow-sm shrink-0 border border-white/10 select-none overflow-hidden ${
        isWhiteBg ? 'text-black' : 'text-white'
      } ${className}`}
      style={{ backgroundColor: bg }}
    >
      <span className="leading-none tracking-tight">{monogram}</span>
    </div>
  );
};
