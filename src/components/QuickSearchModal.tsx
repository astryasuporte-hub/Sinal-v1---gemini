/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, ChevronRight, Hash, Building2, User, Globe2, FileText } from 'lucide-react';
import { Event, Entity } from '../types/sinal';
import { EntityAvatar } from './EntityAvatar';

interface QuickSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  events?: Event[];
  entities?: Entity[];
  onSelectEvent?: (event: Event) => void;
  onSelectEntity?: (entity: Entity) => void;
  onSelectCategory?: (category: string) => void;
}

export const QuickSearchModal: React.FC<QuickSearchModalProps> = ({
  isOpen,
  onClose,
  events = [],
  entities = [],
  onSelectEvent,
  onSelectEntity,
  onSelectCategory
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus no input ao abrir
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  // Tecla Escape para fechar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Resultados filtrados
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return {
        matchedEvents: events.slice(0, 4),
        matchedEntities: entities.slice(0, 4),
        matchedCategories: ['Economia', 'Tecnologia', 'Mercados', 'Política']
      };
    }

    const matchedEvents = events.filter((ev) =>
      ev.title.toLowerCase().includes(q) ||
      ev.summary?.toLowerCase().includes(q) ||
      ev.category?.toLowerCase().includes(q)
    ).slice(0, 6);

    const matchedEntities = entities.filter((ent) =>
      ent.name.toLowerCase().includes(q) ||
      ent.sector?.toLowerCase().includes(q) ||
      ent.role?.toLowerCase().includes(q) ||
      ent.description?.toLowerCase().includes(q)
    ).slice(0, 5);

    const allCategories = ['Economia', 'Tecnologia', 'Mercados', 'Política', 'Geopolítica', 'Agronegócio', 'Energia'];
    const matchedCategories = allCategories.filter((cat) => cat.toLowerCase().includes(q));

    return {
      matchedEvents,
      matchedEntities,
      matchedCategories
    };
  }, [query, events, entities]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-start justify-center p-3 sm:p-6 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xl bg-[#090a0d] border border-zinc-800/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] mt-4 sm:mt-12"
        role="dialog"
        aria-modal="true"
        aria-label="Busca rápida"
      >
        {/* Barra de Entrada da Busca */}
        <div className="flex items-center px-4 py-3.5 border-b border-zinc-800/90 gap-3 bg-[#0d0e13]">
          <Search className="w-5 h-5 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar acontecimentos, empresas, pessoas ou temas..."
            className="w-full bg-transparent text-sm sm:text-base text-white placeholder-zinc-500 outline-none"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition cursor-pointer"
              aria-label="Limpar busca"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-2 py-1 text-xs text-zinc-400 hover:text-white transition cursor-pointer"
            >
              Esc
            </button>
          )}
        </div>

        {/* Lista de Resultados */}
        <div className="overflow-y-auto no-scrollbar p-3 sm:p-4 space-y-5 text-zinc-100 flex-1">
          {/* Seção de Entidades Encontradas */}
          {results.matchedEntities.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase px-2 mb-2">
                {query ? 'Entidades' : 'Entidades em Destaque'}
              </div>
              <div className="space-y-1">
                {results.matchedEntities.map((ent) => (
                  <button
                    key={ent.id}
                    onClick={() => {
                      onSelectEntity?.(ent);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-850/70 border border-transparent hover:border-zinc-800 transition text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <EntityAvatar
                        name={ent.name}
                        type={ent.type as any}
                        logoUrl={ent.logoUrl}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-semibold text-white truncate group-hover:text-zinc-100">
                          {ent.name}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate">
                          {ent.sector || ent.role || (ent.type === 'company' ? 'Empresa' : ent.type === 'person' ? 'Pessoa' : 'Organização')}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 shrink-0 transition" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Seção de Acontecimentos Encontrados */}
          {results.matchedEvents.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase px-2 mb-2">
                {query ? 'Acontecimentos' : 'Mais Recentes'}
              </div>
              <div className="space-y-1.5">
                {results.matchedEvents.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => {
                      onSelectEvent?.(ev);
                      onClose();
                    }}
                    className="w-full flex items-start gap-3 p-2.5 rounded-xl hover:bg-zinc-850/70 border border-transparent hover:border-zinc-800 transition text-left cursor-pointer group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 mt-0.5 text-zinc-400">
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-[10px] text-zinc-400 mb-0.5 font-mono">
                        <span className="uppercase text-zinc-300">{ev.category}</span>
                        <span>·</span>
                        <span>{ev.relativeTime || 'recente'}</span>
                      </div>
                      <div className="text-xs sm:text-sm font-semibold text-white line-clamp-1 group-hover:text-zinc-200">
                        {ev.title}
                      </div>
                      <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">
                        {ev.summary}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 shrink-0 mt-2 transition" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Categorias / Temas */}
          {results.matchedCategories.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase px-2 mb-2">
                Temas
              </div>
              <div className="flex flex-wrap gap-2 px-1">
                {results.matchedCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      onSelectCategory?.(cat);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 hover:text-white transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Hash className="w-3 h-3 text-zinc-400" />
                    <span>{cat}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sem resultados */}
          {results.matchedEvents.length === 0 && results.matchedEntities.length === 0 && results.matchedCategories.length === 0 && (
            <div className="py-10 text-center">
              <p className="text-sm text-zinc-400">Nenhum resultado encontrado para "{query}".</p>
              <p className="text-xs text-zinc-500 mt-1">Tente buscar por termos como Petrobras, Nubank, Taxa Selic ou Inflação.</p>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-4 py-2.5 bg-[#0a0b0f] border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
          <span>FatosBR • Busca Unificada</span>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
