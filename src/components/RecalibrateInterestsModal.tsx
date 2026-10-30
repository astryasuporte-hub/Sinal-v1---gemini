/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  X,
  Check,
  Cpu,
  Building2,
  Landmark,
  TrendingUp,
  Globe,
  Atom,
  HeartPulse,
  Trophy,
  Palette,
  Film,
  Leaf,
  GraduationCap,
  Sparkles,
  RotateCcw
} from 'lucide-react';

export const ALL_ONBOARDING_THEMES = [
  { id: 'tech', label: 'Tecnologia & IA', icon: Cpu },
  { id: 'business', label: 'Negócios', icon: Building2 },
  { id: 'politics', label: 'Política', icon: Landmark },
  { id: 'economy', label: 'Economia & Finanças', icon: TrendingUp },
  { id: 'world', label: 'Mundo', icon: Globe },
  { id: 'science', label: 'Ciência', icon: Atom },
  { id: 'health', label: 'Saúde', icon: HeartPulse },
  { id: 'sports', label: 'Esportes', icon: Trophy },
  { id: 'culture', label: 'Cultura', icon: Palette },
  { id: 'entertainment', label: 'Entretenimento', icon: Film },
  { id: 'environment', label: 'Meio Ambiente', icon: Leaf },
  { id: 'education', label: 'Educação', icon: GraduationCap }
];

interface RecalibrateInterestsModalProps {
  isOpen: boolean;
  currentInterests: string[];
  onClose: () => void;
  onSave: (newInterests: string[]) => void;
  onFullOnboarding?: () => void;
}

export const RecalibrateInterestsModal: React.FC<RecalibrateInterestsModalProps> = ({
  isOpen,
  currentInterests,
  onClose,
  onSave,
  onFullOnboarding
}) => {
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set(currentInterests));

  if (!isOpen) return null;

  const toggleTheme = (id: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) {
          next.delete(id);
        }
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedSet(new Set(ALL_ONBOARDING_THEMES.map((t) => t.id)));
  };

  const handleSave = () => {
    const arr = Array.from(selectedSet);
    try {
      localStorage.setItem('fatosbr_user_interests', JSON.stringify(arr));
      window.dispatchEvent(new CustomEvent('fatosbr_interests_updated', { detail: { interests: arr } }));
    } catch {}
    onSave(arr);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg rounded-3xl border border-zinc-800 bg-[#0c0e12] text-zinc-100 shadow-2xl p-5 sm:p-6 space-y-5 overflow-hidden">
        {/* Cabeçalho do Modal */}
        <div className="flex items-start justify-between border-b border-zinc-800/80 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Calibrar categorias de interesse
              </h2>
            </div>
            <p className="text-xs text-zinc-400">
              O seu feed <strong className="text-zinc-200">&quot;Para você&quot;</strong> exibe estritamente as notícias dos temas marcados abaixo.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition cursor-pointer -mr-1"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Barra Rápida: Ações de seleção */}
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono text-zinc-400">
            {selectedSet.size} de {ALL_ONBOARDING_THEMES.length} categorias selecionadas
          </span>
          <button
            onClick={handleSelectAll}
            className="text-[11px] font-semibold text-zinc-300 hover:text-white underline cursor-pointer"
          >
            Selecionar todas
          </button>
        </div>

        {/* Grid de Temas */}
        <div className="grid grid-cols-2 gap-2.5 max-h-[50vh] overflow-y-auto pr-1">
          {ALL_ONBOARDING_THEMES.map((theme) => {
            const Icon = theme.icon;
            const isChecked = selectedSet.has(theme.id);
            return (
              <div
                key={theme.id}
                onClick={() => toggleTheme(theme.id)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-2.5 active:scale-[0.98] ${
                  isChecked
                    ? 'bg-[#151821] border-white shadow-sm'
                    : 'bg-[#0f1116] border-zinc-800 hover:border-zinc-700 opacity-60 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${isChecked ? 'text-white' : 'text-zinc-400'}`} />
                  <span className="text-xs font-semibold text-white truncate">{theme.label}</span>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                    isChecked ? 'bg-white border-white' : 'border-zinc-700 bg-transparent'
                  }`}
                >
                  {isChecked && <Check className="w-2.5 h-2.5 text-black stroke-[3]" />}
                </div>
              </div>
            );
          })}
        </div>

        {/* Rodapé: Salvar e Atalho para Onboarding Completo */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-zinc-800/80">
          {onFullOnboarding && (
            <button
              onClick={() => {
                onClose();
                onFullOnboarding();
              }}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Refazer onboarding de 7 etapas</span>
            </button>
          )}

          <div className="flex items-center gap-2 w-full sm:w-auto ml-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-zinc-800 hover:bg-zinc-800 text-xs text-zinc-300 font-semibold transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition shadow-lg cursor-pointer"
            >
              Salvar preferências
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
