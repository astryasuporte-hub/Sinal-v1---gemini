/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Clock,
  Sparkles,
  Plus,
  Trash2,
  Volume2,
  AlertTriangle,
  Zap,
  Coffee,
  ShieldCheck,
  Video,
  Layers,
  CheckCircle2,
  Sliders,
  Send,
  HelpCircle
} from 'lucide-react';
import {
  creatorNotificationService,
  CreatorNotification,
  CreatorUrgency,
  PREMADE_CREATOR_NOTIFICATIONS,
  CreatorCountdownState
} from '../services/creatorNotificationService';
import { soundAlertService } from '../services/soundAlertService';

interface CreatorNotificationStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
}

export const CreatorNotificationStudioModal: React.FC<CreatorNotificationStudioModalProps> = ({
  isOpen,
  onClose,
  userEmail
}) => {
  const [activeTab, setActiveTab] = useState<'premade' | 'custom' | 'saved' | 'settings'>('premade');
  const [countdownState, setCountdownState] = useState<CreatorCountdownState>(() =>
    creatorNotificationService.getCountdownState()
  );
  const [customList, setCustomList] = useState<CreatorNotification[]>(() =>
    creatorNotificationService.getCustomNotifications()
  );

  // Form para nova notificação customizada
  const [customTitle, setCustomTitle] = useState('');
  const [customCategory, setCustomCategory] = useState('TECNOLOGIA & IA');
  const [customSummary, setCustomSummary] = useState('');
  const [customUrgency, setCustomUrgency] = useState<CreatorUrgency>('breaking');
  const [customBadge, setCustomBadge] = useState('🚨 PLANTÃO SINAL');
  const [customTimestamp, setCustomTimestamp] = useState('Agora há pouco');
  const [customSound, setCustomSound] = useState(true);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Delay padrão preferido
  const [defaultDelay, setDefaultDelay] = useState<number>(5);

  useEffect(() => {
    return creatorNotificationService.subscribeCountdown((state) => {
      setCountdownState(state);
      if (state.isActive && state.secondsRemaining > 0) {
        soundAlertService.playSubtleTick();
      }
    });
  }, []);

  if (!isOpen) return null;

  const handleTrigger = (notif: CreatorNotification, delaySeconds: number) => {
    creatorNotificationService.dispatchWithCountdown(notif, delaySeconds);
    onClose();
  };

  const handleSaveAndTriggerCustom = (delaySeconds: number) => {
    if (!customTitle.trim()) {
      setFeedbackMsg('Por favor, informe ao menos o título do alerta.');
      setTimeout(() => setFeedbackMsg(null), 3000);
      return;
    }

    const saved = creatorNotificationService.saveCustomNotification({
      title: customTitle.trim(),
      category: customCategory.trim() || 'NOTÍCIAS',
      summary: customSummary.trim() || 'Acompanhamento analítico e apuração em tempo real pelo FatosBR.',
      urgency: customUrgency,
      sourceBadge: customBadge.trim() || undefined,
      timestampText: customTimestamp.trim() || 'Agora há pouco',
      sound: customSound
    });

    setCustomList(creatorNotificationService.getCustomNotifications());
    setFeedbackMsg('Alerta salvo com sucesso!');

    handleTrigger(saved, delaySeconds);
  };

  const handleDeleteCustom = (id: string) => {
    creatorNotificationService.deleteCustomNotification(id);
    setCustomList(creatorNotificationService.getCustomNotifications());
  };

  const getUrgencyIcon = (urgency: CreatorUrgency) => {
    switch (urgency) {
      case 'breaking':
        return <AlertTriangle className="w-3.5 h-3.5 text-red-400" />;
      case 'flash':
        return <Zap className="w-3.5 h-3.5 text-cyan-400" />;
      case 'editorial':
        return <Coffee className="w-3.5 h-3.5 text-amber-400" />;
      case 'high':
      default:
        return <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0c101d] border border-[#202942] text-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header do Estúdio */}
        <div className="p-4 sm:p-5 border-b border-[#1c243b] flex items-center justify-between bg-gradient-to-r from-[#0d1424] to-[#0c101d]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                  Estúdio de Gravação de Notificações
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/20 border border-blue-500/40 text-blue-300">
                  MODO CRIADOR
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Dispare alertas cinematográficos ao vivo para gravação de vídeos de lançamento.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#141b2c] hover:bg-[#1a243a] text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas de Navegação */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-[#1c243b] bg-[#0a0e19] overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('premade')}
            className={`px-3.5 py-2 rounded-t-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'premade'
                ? 'bg-[#0c101d] text-white border-t-2 border-blue-500'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Notificações Prontas ({PREMADE_CREATOR_NOTIFICATIONS.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('custom')}
            className={`px-3.5 py-2 rounded-t-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'custom'
                ? 'bg-[#0c101d] text-white border-t-2 border-blue-500'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Plus className="w-3.5 h-3.5 text-blue-400" />
            <span>Criar Alerta Personalizado</span>
          </button>

          <button
            onClick={() => setActiveTab('saved')}
            className={`px-3.5 py-2 rounded-t-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'saved'
                ? 'bg-[#0c101d] text-white border-t-2 border-blue-500'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span>Salvos ({customList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3.5 py-2 rounded-t-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'settings'
                ? 'bg-[#0c101d] text-white border-t-2 border-blue-500'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            <span>Dicas & Ajustes</span>
          </button>
        </div>

        {/* Conteúdo das Abas */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* ================= ABA 1: NOTIFICAÇÕES PRONTAS ================= */}
          {activeTab === 'premade' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-blue-950/20 border border-blue-500/30 text-xs text-blue-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400 shrink-0" />
                  <span>
                    Dica: Ao clicar em <strong>Gravar em 5s</strong>, o modal fechará e você terá 5 segundos para ligar sua câmera ou gravação de tela antes do banner surgir.
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {PREMADE_CREATOR_NOTIFICATIONS.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl bg-[#0f1424] border border-[#1e273f] hover:border-[#2d3b5e] transition space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {getUrgencyIcon(item.urgency)}
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-300">
                          {item.sourceBadge}
                        </span>
                        <span className="text-[11px] font-semibold text-zinc-400">
                          {item.category}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400">
                        {item.timestampText}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-white leading-snug">
                        {item.title}
                      </h4>
                      <p className="text-[11px] text-zinc-300 leading-relaxed mt-1">
                        {item.summary}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2 flex-wrap">
                      <button
                        onClick={() => creatorNotificationService.playAlertChime()}
                        className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 transition"
                        title="Ouvir som de alerta"
                      >
                        <Volume2 className="w-3.5 h-3.5 text-blue-400" />
                        <span>Testar Áudio</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleTrigger(item, 0)}
                          className="px-2.5 py-1.5 rounded-lg bg-[#172036] hover:bg-[#1e2a47] text-zinc-300 hover:text-white font-medium text-xs transition cursor-pointer"
                        >
                          Agora
                        </button>

                        <button
                          onClick={() => handleTrigger(item, 3)}
                          className="px-2.5 py-1.5 rounded-lg bg-[#172036] hover:bg-[#1e2a47] text-zinc-300 hover:text-white font-medium text-xs transition cursor-pointer"
                        >
                          Em 3s
                        </button>

                        <button
                          onClick={() => handleTrigger(item, 5)}
                          className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-blue-900/30"
                        >
                          <Play className="w-3 h-3 fill-white" />
                          <span>⚡ Gravar em 5s</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ================= ABA 2: CRIAR ALERTA CUSTOMIZADO ================= */}
          {activeTab === 'custom' && (
            <div className="space-y-4">
              {feedbackMsg && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{feedbackMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Título da Notícia / Fato Principal *
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Ex: FatosBR atinge 100 mil briefings despachados na semana"
                    className="w-full bg-[#121829] border border-[#202b45] rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Categoria Temática
                  </label>
                  <input
                    type="text"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="Ex: TECNOLOGIA & IA, MERCADOS, GEOPOLÍTICA"
                    className="w-full bg-[#121829] border border-[#202b45] rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 uppercase"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-zinc-300">
                  Síntese Analítica / Resumo do Impacto
                </label>
                <textarea
                  rows={2}
                  value={customSummary}
                  onChange={(e) => setCustomSummary(e.target.value)}
                  placeholder="Ex: Modelo de inteligência sintetizada apura acontecimentos com fontes verificadas e entrega aos assinantes em tempo recorde."
                  className="w-full bg-[#121829] border border-[#202b45] rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Estilo Visual / Urgência
                  </label>
                  <select
                    value={customUrgency}
                    onChange={(e) => setCustomUrgency(e.target.value as CreatorUrgency)}
                    className="w-full bg-[#121829] border border-[#202b45] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="breaking">🚨 Plantão Urgente (Neon Vermelho)</option>
                    <option value="flash">⚡ FatosBR Flash (Ciano Elétrico)</option>
                    <option value="editorial">☕ Briefing 07h00 (Âmbar / Editorial)</option>
                    <option value="high">🛡️ Alerta Analítico (Roxo / Consenso)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Badge de Origem
                  </label>
                  <input
                    type="text"
                    value={customBadge}
                    onChange={(e) => setCustomBadge(e.target.value)}
                    placeholder="Ex: 🚨 PLANTÃO SINAL"
                    className="w-full bg-[#121829] border border-[#202b45] rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Horário Simulado
                  </label>
                  <input
                    type="text"
                    value={customTimestamp}
                    onChange={(e) => setCustomTimestamp(e.target.value)}
                    placeholder="Ex: Agora há pouco, 07:00 AM"
                    className="w-full bg-[#121829] border border-[#202b45] rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Pré-visualização do Banner Customizado */}
              <div className="p-3.5 rounded-xl bg-[#090d18] border border-[#1e273f] space-y-2">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                  Pré-visualização do Banner
                </span>
                <div className="p-3 rounded-xl bg-[#0b0f19] border border-blue-500/30 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-blue-400">{customBadge}</span>
                    <span className="text-zinc-400">{customTimestamp}</span>
                  </div>
                  <div className="text-xs font-bold text-white">
                    {customTitle || 'Título de Exemplo para Gravação de Vídeo'}
                  </div>
                  <div className="text-[11px] text-zinc-300">
                    {customSummary || 'Resumo explicativo do acontecimento visualizado pelo criador.'}
                  </div>
                </div>
              </div>

              {/* Ações do Formulário Custom */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleSaveAndTriggerCustom(0)}
                  className="px-3.5 py-2 rounded-xl bg-[#172036] hover:bg-[#1e2a47] text-zinc-200 text-xs font-semibold transition cursor-pointer"
                >
                  Salvar e Disparar Imediato
                </button>

                <button
                  type="button"
                  onClick={() => handleSaveAndTriggerCustom(5)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-blue-900/30"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Salvar e Gravar em 5s</span>
                </button>
              </div>
            </div>
          )}

          {/* ================= ABA 3: SALVOS ================= */}
          {activeTab === 'saved' && (
            <div className="space-y-3">
              {customList.length === 0 ? (
                <div className="py-12 text-center text-zinc-400 space-y-2">
                  <Layers className="w-8 h-8 text-zinc-600 mx-auto" />
                  <div className="text-xs font-medium">Nenhum alerta personalizado salvo ainda.</div>
                  <p className="text-[11px] text-zinc-500 max-w-sm mx-auto">
                    Use a aba "Criar Alerta Personalizado" para montar roteiros e acontecimentos específicos para os seus vídeos.
                  </p>
                </div>
              ) : (
                customList.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl bg-[#0f1424] border border-[#1e273f] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {getUrgencyIcon(item.urgency)}
                        <span className="text-[10px] font-mono text-zinc-400">{item.category}</span>
                      </div>
                      <h4 className="text-xs font-bold text-white">{item.title}</h4>
                      <p className="text-[11px] text-zinc-300 line-clamp-2">{item.summary}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleDeleteCustom(item.id)}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                        title="Excluir alerta salvo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => handleTrigger(item, 5)}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-white" />
                        <span>Gravar em 5s</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ================= ABA 4: DICAS & AJUSTES ================= */}
          {activeTab === 'settings' && (
            <div className="space-y-4 text-xs text-zinc-300">
              <div className="p-4 rounded-xl bg-[#0f1424] border border-[#1e273f] space-y-3">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Video className="w-4 h-4 text-blue-400" />
                  <span>Dicas para Gravar Vídeos de Lançamento do FatosBR</span>
                </div>
                <ul className="space-y-2 text-[12px] list-disc list-inside text-zinc-300">
                  <li>
                    <strong>Contagem Regressiva de 5s:</strong> Use para iniciar seu software de gravação de tela (OBS, Loom, QuickTime ou celular) antes do alerta subir na tela.
                  </li>
                  <li>
                    <strong>Regravar Take:</strong> No próprio banner que aparece na tela, existe o botão <em>"Regravar Take (5s)"</em> para você refazer o vídeo sem precisar reabrir este modal.
                  </li>
                  <li>
                    <strong>Áudio Cristalino:</strong> O alerta sonoro é gerado em tempo real pelo navegador, capturado pelo seu microfone ou áudio do sistema com volume calibrado.
                  </li>
                  <li>
                    <strong>Contas Autorizadas:</strong> Este estúdio é exibido e acessível exclusivamente para <code>yleaopvpy01@gmail.com</code> e <code>astryasuporte@gmail.com</code>.
                  </li>
                </ul>
              </div>

              <div className="p-4 rounded-xl bg-[#0f1424] border border-[#1e273f] flex items-center justify-between">
                <div>
                  <div className="font-bold text-white">Chime Sonoro de Broadcast</div>
                  <div className="text-[11px] text-zinc-400">Harmônico de dois tons suave para dar impacto no vídeo.</div>
                </div>
                <button
                  onClick={() => creatorNotificationService.playAlertChime()}
                  className="px-3 py-1.5 rounded-xl bg-[#172036] hover:bg-[#1e2a47] text-white font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Testar Agora</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Overlay de Contagem Regressiva para gravação de vídeos
 */
export const CreatorCountdownOverlay: React.FC = () => {
  const [countdownState, setCountdownState] = useState<CreatorCountdownState>(() =>
    creatorNotificationService.getCountdownState()
  );

  useEffect(() => {
    return creatorNotificationService.subscribeCountdown((state) => {
      setCountdownState(state);
    });
  }, []);

  if (!countdownState.isActive) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10001] w-[90%] max-w-md animate-bounce-gentle">
      <div className="p-3.5 rounded-2xl bg-[#090e1a]/95 backdrop-blur-xl border border-blue-500/60 shadow-[0_10px_35px_rgba(59,130,246,0.35)] flex items-center justify-between gap-3 text-white">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-400/50 flex items-center justify-center font-mono font-bold text-sm text-blue-300 animate-pulse">
            {countdownState.secondsRemaining}
          </div>
          <div>
            <div className="text-xs font-bold flex items-center gap-1.5 text-white">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              <span>Preparando Take de Gravação...</span>
            </div>
            <div className="text-[10px] text-zinc-300 truncate max-w-[200px]">
              Alerta: {countdownState.targetNotification?.title || 'Notificação'}
            </div>
          </div>
        </div>

        <button
          onClick={() => creatorNotificationService.cancelCountdown()}
          className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-zinc-300 hover:text-white transition cursor-pointer"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
};
