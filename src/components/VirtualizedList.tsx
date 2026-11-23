/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lista virtualizada leve sem dependências externas para reduzir nós no DOM em tabelas e logs extensos.
 */

import React, { useState, useMemo, useCallback } from 'react';

export interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight?: number;
  overscan?: number;
  className?: string;
  getKey?: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => React.ReactNode;
}

export function computeVirtualWindow(
  totalItems: number,
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  overscan = 6
): { startIndex: number; endIndex: number; offsetTop: number; totalHeight: number } {
  const safeHeight = Math.max(1, itemHeight);
  const totalHeight = totalItems * safeHeight;
  if (totalItems <= 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 };
  }
  const visibleCount = Math.max(1, Math.ceil(containerHeight / safeHeight));
  const rawStart = Math.floor(Math.max(0, scrollTop) / safeHeight) - overscan;
  const startIndex = Math.max(0, rawStart);
  const endIndex = Math.min(totalItems, startIndex + visibleCount + overscan * 2);
  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * safeHeight,
    totalHeight,
  };
}

export function VirtualizedList<T>({
  items,
  itemHeight,
  containerHeight = 384,
  overscan = 6,
  className = '',
  getKey,
  renderItem,
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const { startIndex, endIndex, offsetTop, totalHeight } = useMemo(
    () => computeVirtualWindow(items.length, scrollTop, containerHeight, itemHeight, overscan),
    [items.length, scrollTop, containerHeight, itemHeight, overscan]
  );

  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex]
  );

  return (
    <div
      onScroll={handleScroll}
      style={{ maxHeight: containerHeight }}
      className={`overflow-y-auto relative ${className}`}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetTop}px)` }}>
          {visibleItems.map((item, idx) => {
            const realIndex = startIndex + idx;
            const key = getKey ? getKey(item, realIndex) : realIndex;
            return <React.Fragment key={key}>{renderItem(item, realIndex)}</React.Fragment>;
          })}
        </div>
      </div>
    </div>
  );
}
