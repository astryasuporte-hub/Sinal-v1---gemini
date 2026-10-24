/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Command, X, RefreshCw, Compass, Bookmark, Home, FileText, Bell, User, Video } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose
}) => {
  if (!isOpen) return null;

  const shortcuts = [
    {
      category: 'Navegação Primária',
      items: [
        { keys: ['G', 'H'], label: 'Ir para Início (Home)', icon: <Home className="w-4 h-4 text-emerald-400" /> },
        { keys: ['G', 'E'], label: 'Ir para Explorar', icon: <Compass className="w-4 h-4 text-blue-400" /> },
        { keys: ['G', 'F'], label: 'Ir para Seguindo', icon: <Bookmark className="w-4 h-4 text-amber-400" /> },
        { keys: ['G', 'B'], label: 'Ir para Briefings', icon: <FileText className="w-4 h-4 text-purple-400" /> },
        { keys: ['G', 'N'], label: 'Ir para Notificações', icon: <Bell className="w-4 h-4 text-rose-400" /> },
        { keys: ['G', 'P'], label: 'Ir para Perfil', icon: <User className="w-4 h-4 text-cyan-400" /> },
        { keys: ['G', 'S'], label: 'Ir para Acontecimentos Salvos', icon: <Bookmark className="w-4 h-4 text-indigo-400" /> },
        { keys: ['G', 'C'], label: 'Modo Criador (Gravação de Vídeos)', icon: <Video className="w-4 h-4 text-blue-400" /> },
      ]
    },
    {
      category: 'Ações Rápidas & Interface',
      items: [
        { keys: ['R'], label: 'Atualizar Feed (limite diário de 5 resets)', icon: <RefreshCw className="w-4 h-4 text-emerald-400" /> },
        { keys: ['?'], label: 'Exibir este guia de atalhos', icon: <Command className="w-4 h-4 text-zinc-400" /> },
        { keys: ['Esc'], label: 'Fechar modais abertos', icon: <X className="w-4 h-4 text-zinc-400" /> },
      ]
    }
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl p-6 shadow-2xl border bg-[#111216] border-[#22242c] text-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#22242c]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-zinc-800 text-zinc-300">
              <Command className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Atalhos de Teclado</h3>
              <p className="text-xs text-zinc-400">Navegue instantaneamente pela aplicação</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortcuts Sections */}
        <div className="py-4 space-y-6 max-h-[60vh] overflow-y-auto pr-1">
          {shortcuts.map((group, gIdx) => (
            <div key={gIdx} className="space-y-2.5">
              <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-400">
                {group.category}
              </h4>
              <div className="space-y-2">
                {group.items.map((item, iIdx) => (
                  <div
                    key={iIdx}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[#0c0d10] border border-[#1a1c22] text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      {item.icon}
                      <span className="text-zinc-200">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-1 font-mono">
                      {item.keys.map((k, kIdx) => (
                        <React.Fragment key={kIdx}>
                          <kbd className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700 shadow-xs">
                            {k}
                          </kbd>
                          {kIdx < item.keys.length - 1 && (
                            <span className="text-zinc-500 text-[10px]">+</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-[#22242c] flex items-center justify-between text-[11px] text-zinc-400">
          <span>Pressione <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">Esc</kbd> a qualquer momento para sair</span>
          <span className="font-semibold text-zinc-300">FatosBR Beta</span>
        </div>
      </div>
    </div>
  );
};
