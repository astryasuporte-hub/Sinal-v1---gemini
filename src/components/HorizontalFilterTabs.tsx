/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — HorizontalFilterTabs (UX/UI V2.2)
 * Componente padronizado e acessível para abas e filtros horizontais em dispositivos móveis e desktop.
 * - Elimina scrollbars visuais defeituosas em qualquer navegador ou viewport.
 * - Preserva rolagem horizontal suave com touch momentum no iOS/Android.
 * - Impede cortes das pills e assegura touch target acessível (>= 40px).
 * - Destaque visual claro do filtro ativo sem conflito de layout.
 * - Suporte completo a navegação por teclado (Setas, Enter, Espaço).
 */

import React, { useRef, useEffect } from 'react';

export interface FilterTabItem {
  id: string;
  label: string;
  count?: number | string;
  icon?: React.ReactNode;
}

export interface HorizontalFilterTabsProps {
  tabs: FilterTabItem[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  className?: string;
  containerClassName?: string;
  ariaLabel?: string;
}

export const HorizontalFilterTabs: React.FC<HorizontalFilterTabsProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  className = '',
  containerClassName = '',
  ariaLabel = 'Filtros'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeBtnRef = useRef<HTMLButtonElement>(null);

  // Garante que a pill ativa seja visível ao carregar ou mudar
  useEffect(() => {
    if (activeBtnRef.current && containerRef.current) {
      const container = containerRef.current;
      const btn = activeBtnRef.current;
      const btnLeft = btn.offsetLeft;
      const btnRight = btnLeft + btn.offsetWidth;
      const scrollLeft = container.scrollLeft;
      const containerWidth = container.offsetWidth;

      if (btnLeft < scrollLeft) {
        container.scrollTo({ left: Math.max(0, btnLeft - 16), behavior: 'smooth' });
      } else if (btnRight > scrollLeft + containerWidth) {
        container.scrollTo({ left: btnRight - containerWidth + 16, behavior: 'smooth' });
      }
    }
  }, [activeTabId]);

  // Navegação por teclado
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (index + 1) % tabs.length;
      onSelectTab(tabs[nextIndex].id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (index - 1 + tabs.length) % tabs.length;
      onSelectTab(tabs[prevIndex].id);
    }
  };

  return (
    <div className={`relative w-full overflow-hidden ${containerClassName}`}>
      <div
        ref={containerRef}
        role="tablist"
        aria-label={ariaLabel}
        className={`flex items-center space-x-2 overflow-x-auto overflow-y-hidden py-1 px-0.5 no-scrollbar select-none touch-pan-x ${className}`}
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch'
        }}
      >
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              ref={isActive ? activeBtnRef : null}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-150 cursor-pointer shrink-0 min-h-[40px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 active:scale-[0.98] ${
                isActive
                  ? 'bg-white text-black shadow-sm font-bold'
                  : 'bg-[#111215] text-zinc-400 hover:text-white border border-[#1e2026] hover:border-zinc-700'
              }`}
            >
              {tab.icon && <span className="shrink-0">{tab.icon}</span>}
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count !== null && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ml-0.5 ${
                    isActive
                      ? 'bg-zinc-200 text-zinc-900 font-bold'
                      : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default HorizontalFilterTabs;
