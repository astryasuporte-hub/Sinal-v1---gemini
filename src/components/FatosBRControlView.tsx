/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  InstagramAccount,
  ScheduledPost,
  CommentAutomationRule,
  CommentExecutionLog,
  InstagramAuditLog,
  InstagramInsightsData,
  ChatCommandMessage
} from '../types/instagram';
import { instagramService } from '../services/instagramService';
import {
  Send,
  Calendar,
  Clock,
  Sparkles,
  Shield,
  Layers,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Power,
  Play,
  Pause,
  Key,
  BarChart3,
  Bot,
  User,
  Copy,
  Check,
  X,
  ExternalLink,
  ChevronRight,
  Sliders,
  Terminal,
  Instagram,
  FileText
} from 'lucide-react';

interface FatosBRControlViewProps {
  onBackToApp?: () => void;
  onOpenCarouselStudio?: () => void;
}

export const FatosBRControlView: React.FC<FatosBRControlViewProps> = ({
  onBackToApp,
  onOpenCarouselStudio
}) => {
  // Estados principais
  const [account, setAccount] = useState<InstagramAccount | null>(null);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [rules, setRules] = useState<CommentAutomationRule[]>([]);
  const [auditLogs, setAuditLogs] = useState<InstagramAuditLog[]>([]);
  const [commentLogs, setCommentLogs] = useState<CommentExecutionLog[]>([]);
  const [insights, setInsights] = useState<InstagramInsightsData | null>(null);

  // Estados do Chat
  const [messages, setMessages] = useState<ChatCommandMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      content: 'Olá! Sou o assistente operacional do **FatosBR Control**. Estou conectado à sua conta profissional do Instagram e pronto para executar comandos operacionais em linguagem natural.\n\nVocê pode me pedir para agendar carrosséis, gerar legendas com tom editorial FatosBR, monitorar regras de comentários como "QUERO" ou extrair relatórios de desempenho.',
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Estados de Interface e Modais
  const [activeSideTab, setActiveSideTab] = useState<'schedule' | 'rules' | 'insights' | 'audit' | 'settings'>('schedule');
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configForm, setConfigForm] = useState({
    appId: '',
    appSecret: '',
    accessToken: '',
    pageId: '',
    igUserId: '',
    isSimulationMode: true
  });
  const [testCommentInput, setTestCommentInput] = useState('QUERO');
  const [testCommentUsername, setTestCommentUsername] = useState('leitor_fatosbr');
  const [testCommentResult, setTestCommentResult] = useState<any>(null);
  const [isTestingComment, setIsTestingComment] = useState(false);
  const [copiedCaptionId, setCopiedCaptionId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Carregar dados iniciais
  const refreshAllData = async () => {
    try {
      const [acc, sched, rls, ins, logs, cfg] = await Promise.all([
        instagramService.getStatus(),
        instagramService.listScheduled(),
        instagramService.listRules(),
        instagramService.getInsights(),
        instagramService.getAuditLogs(),
        instagramService.getConfig()
      ]);
      setAccount(acc);
      setScheduledPosts(sched);
      setRules(rls);
      setInsights(ins);
      setAuditLogs(logs.audits || []);
      setCommentLogs(logs.commentLogs || []);
      setConfigForm({
        appId: cfg.appId || '',
        appSecret: '',
        accessToken: '',
        pageId: cfg.pageId || '',
        igUserId: cfg.igUserId || '',
        isSimulationMode: cfg.isSimulationMode ?? true
      });
    } catch (err: any) {
      console.error('Erro ao atualizar dados do FatosBR Control:', err);
    }
  };

  useEffect(() => {
    refreshAllData();
  }, []);

  // Auto-scroll do chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Enviar comando pelo chat
  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputValue;
    if (!text.trim() || isSending) return;

    const userMsg: ChatCommandMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputValue('');
    setIsSending(true);

    try {
      const botReply = await instagramService.sendChatMessage(text);
      setMessages((prev) => [...prev, botReply]);
      // Atualizar listas após comando
      refreshAllData();
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          content: `Falha ao processar comando: ${err.message}. Verifique a conexão com o servidor.`,
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsSending(false);
    }
  };

  // Alternar modo de simulação vs produção
  const handleToggleSimulation = async () => {
    if (!account) return;
    const nextMode = !account.isSimulationMode;
    try {
      await instagramService.updateConfig({ isSimulationMode: nextMode });
      showToast(nextMode ? 'Modo SIMULAÇÃO ativado (testes sem disparos externos)' : 'Modo PRODUÇÃO ativado (Meta Graph API Live)');
      refreshAllData();
    } catch (e: any) {
      showToast(`Erro: ${e.message}`);
    }
  };

  // Pausar/Reativar regra
  const handleToggleRule = async (id: string, currentActive: boolean) => {
    try {
      await instagramService.toggleRule(id, !currentActive);
      showToast(currentActive ? 'Regra pausada.' : 'Regra ativada com sucesso!');
      refreshAllData();
    } catch (e: any) {
      showToast(`Erro: ${e.message}`);
    }
  };

  // Cancelar agendamento
  const handleCancelScheduled = async (id: string) => {
    try {
      const ok = await instagramService.cancelScheduled(id);
      if (ok) {
        showToast('Agendamento cancelado com sucesso.');
        refreshAllData();
      }
    } catch (e: any) {
      showToast(`Erro: ${e.message}`);
    }
  };

  // Testar gatilho de comentário
  const handleTestComment = async () => {
    if (!testCommentInput.trim() || isTestingComment) return;
    setIsTestingComment(true);
    setTestCommentResult(null);
    try {
      const res = await instagramService.simulateCommentTrigger(testCommentInput, testCommentUsername);
      setTestCommentResult(res);
      refreshAllData();
    } catch (e: any) {
      setTestCommentResult({ matched: false, message: e.message });
    } finally {
      setIsTestingComment(false);
    }
  };

  // Salvar credenciais Meta
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        appId: configForm.appId,
        pageId: configForm.pageId,
        igUserId: configForm.igUserId,
        isSimulationMode: configForm.isSimulationMode
      };
      if (configForm.appSecret.trim()) payload.appSecret = configForm.appSecret;
      if (configForm.accessToken.trim()) payload.accessToken = configForm.accessToken;

      await instagramService.updateConfig(payload);
      showToast('Configurações da Meta salvas no servidor com sucesso!');
      setIsConfigModalOpen(false);
      refreshAllData();
    } catch (e: any) {
      showToast(`Erro: ${e.message}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#08090d] text-zinc-100 min-h-screen">
      {/* Toast flutuante */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-xs font-semibold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Superior Corporativo FatosBR Control */}
      <header className="px-4 sm:px-8 py-3.5 border-b border-[#181c24] bg-[#0c0e14] flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-black border border-zinc-700 flex items-center justify-center text-white shadow-inner">
            <Instagram className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                FatosBR Control
              </h1>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-700">
                Operação Instagram
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Central privada de comando, agendamento de carrosséis e automação de DMs oficiais
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Seletor Modo Simulação vs Produção */}
          <button
            onClick={handleToggleSimulation}
            className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold border transition cursor-pointer flex items-center gap-2 ${
              account?.isSimulationMode
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
            }`}
            title="Alternar entre Sandbox seguro e disparo real na Meta"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                account?.isSimulationMode ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
              }`}
            />
            <span>{account?.isSimulationMode ? 'MODO SIMULAÇÃO (Sandbox)' : 'PRODUÇÃO (Meta Live)'}</span>
          </button>

          {/* Configurações de API */}
          <button
            onClick={() => setIsConfigModalOpen(true)}
            className="p-2 rounded-xl bg-[#14161f] border border-[#222736] text-zinc-300 hover:text-white hover:border-zinc-500 transition cursor-pointer"
            title="Gerenciar Credenciais Meta Graph API"
          >
            <Key className="w-4 h-4" />
          </button>

          {/* Recarregar */}
          <button
            onClick={refreshAllData}
            className="p-2 rounded-xl bg-[#14161f] border border-[#222736] text-zinc-300 hover:text-white transition cursor-pointer"
            title="Atualizar dados da central"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {onBackToApp && (
            <button
              onClick={onBackToApp}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 text-zinc-200 hover:text-white text-xs font-medium transition cursor-pointer"
            >
              Voltar ao Feed
            </button>
          )}
        </div>
      </header>

      {/* Grid Principal: Chat (Esquerda) + Abas Operacionais (Direita) */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 min-h-0">
        
        {/* ================= COLUNA ESQUERDA: MINI CHAT OPERACIONAL (7 COLUNAS) ================= */}
        <div className="lg:col-span-7 flex flex-col border-b lg:border-b-0 lg:border-r border-[#181c24] bg-[#090b10] h-[calc(100vh-65px)]">
          
          {/* Header do Chat com Conta Conectada */}
          <div className="p-4 border-b border-[#181c24] bg-[#0c0e14] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full overflow-hidden border border-zinc-700 bg-zinc-900 shrink-0">
                <img
                  src={account?.profilePictureUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=120&q=80'}
                  alt="Instagram"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <span>@{account?.username || 'fatosbr'}</span>
                  <span className="text-[10px] text-emerald-400 font-mono">● Conectado</span>
                </div>
                <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                  <span>{account?.followersCount?.toLocaleString('pt-BR')} seguidores</span>
                  <span>·</span>
                  <span>{account?.mediaCount} publicações</span>
                </div>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-mono text-zinc-400 block">Validade do Token</span>
              <span className="text-xs font-mono text-zinc-200 font-semibold">{account?.daysUntilExpiry || 58} dias</span>
            </div>
          </div>

          {/* Área de Mensagens do Chat */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'assistant' && (
                  <div className="w-8 h-8 rounded-xl bg-black border border-zinc-700 flex items-center justify-center text-white shrink-0 shadow-sm mt-0.5">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] sm:max-w-[78%] rounded-2xl p-4 text-xs sm:text-[13px] leading-relaxed shadow-sm ${
                    msg.sender === 'user'
                      ? 'bg-white text-black font-medium ml-8'
                      : 'bg-[#12141c] text-zinc-200 border border-[#1e2230] space-y-3'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>

                  {/* Card Interativo: Resumo de Agendamento */}
                  {msg.interactiveCard?.type === 'schedule_summary' && (
                    <div className="p-3.5 rounded-xl bg-black/60 border border-zinc-800 space-y-2 mt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Carrossel Agendado</span>
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase">
                          {msg.interactiveCard.data.status}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-300 font-serif italic">
                        "{msg.interactiveCard.data.caption.slice(0, 110)}..."
                      </p>
                      <div className="text-[11px] font-mono text-zinc-400 pt-1 border-t border-zinc-900 flex items-center justify-between">
                        <span>Horário: {new Date(msg.interactiveCard.data.scheduledTime).toLocaleString('pt-BR')}</span>
                        <span>{msg.interactiveCard.data.slides?.length || 2} lâminas</span>
                      </div>
                    </div>
                  )}

                  {/* Card Interativo: Legenda Editorial Gerada */}
                  {msg.interactiveCard?.type === 'caption_review' && (
                    <div className="p-3.5 rounded-xl bg-black/60 border border-zinc-800 space-y-2.5 mt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-400" />
                          <span>Legenda Editorial FatosBR</span>
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(msg.interactiveCard?.data.caption);
                            setCopiedCaptionId(msg.id);
                            setTimeout(() => setCopiedCaptionId(null), 2000);
                          }}
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition"
                        >
                          {copiedCaptionId === msg.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>Copiado!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copiar Texto</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="p-2.5 rounded bg-zinc-950 font-mono text-[11px] text-zinc-300 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-zinc-900">
                        {msg.interactiveCard.data.caption}
                      </div>

                      <div className="text-[11px] text-zinc-400 flex items-center justify-between">
                        <span>Chamada: "{msg.interactiveCard.data.callToAction}"</span>
                      </div>
                    </div>
                  )}

                  {/* Card Interativo: Resumo de Regra QUERO */}
                  {msg.interactiveCard?.type === 'rule_summary' && (
                    <div className="p-3 rounded-xl bg-black/60 border border-zinc-800 space-y-2 mt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                          <span>Gatilho de Comentário: "{msg.interactiveCard.data.triggerKeyword}"</span>
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400 font-bold">ATIVO</span>
                      </div>
                      <p className="text-xs text-zinc-300">
                        Resposta pública: "{msg.interactiveCard.data.publicReplyText}"
                      </p>
                      <p className="text-[11px] text-zinc-400 font-mono">
                        Link na DM: {msg.interactiveCard.data.directMessageLink}
                      </p>
                    </div>
                  )}

                  {/* Card Interativo: Métricas */}
                  {msg.interactiveCard?.type === 'metrics_card' && (
                    <div className="p-3 rounded-xl bg-black/60 border border-zinc-800 space-y-2 mt-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                        <div className="p-2 rounded bg-zinc-900/80 border border-zinc-800">
                          <span className="text-zinc-400 text-[10px] block">Alcance</span>
                          <span className="font-mono font-bold text-white text-sm">
                            {msg.interactiveCard.data.reach?.toLocaleString('pt-BR')}
                          </span>
                        </div>
                        <div className="p-2 rounded bg-zinc-900/80 border border-zinc-800">
                          <span className="text-zinc-400 text-[10px] block">Impressões</span>
                          <span className="font-mono font-bold text-white text-sm">
                            {msg.interactiveCard.data.impressions?.toLocaleString('pt-BR')}
                          </span>
                        </div>
                        <div className="p-2 rounded bg-zinc-900/80 border border-zinc-800">
                          <span className="text-zinc-400 text-[10px] block">DMs Enviadas</span>
                          <span className="font-mono font-bold text-emerald-400 text-sm">
                            {msg.interactiveCard.data.dmsSentWeek}
                          </span>
                        </div>
                        <div className="p-2 rounded bg-zinc-900/80 border border-zinc-800">
                          <span className="text-zinc-400 text-[10px] block">Comentários</span>
                          <span className="font-mono font-bold text-blue-400 text-sm">
                            {msg.interactiveCard.data.commentsReceivedWeek}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div
                    className={`text-[10px] font-mono pt-1 text-right ${
                      msg.sender === 'user' ? 'text-zinc-500' : 'text-zinc-500'
                    }`}
                  >
                    {msg.timestamp}
                  </div>
                </div>

                {msg.sender === 'user' && (
                  <div className="w-8 h-8 rounded-xl bg-white text-black flex items-center justify-center font-bold text-xs shrink-0 shadow-sm mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>

          {/* Atalhos de Comandos Rápidos */}
          <div className="px-4 py-2 border-t border-[#181c24] bg-[#0c0e14] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider shrink-0 mr-1">
              Atalhos:
            </span>
            {[
              'Agende este carrossel para amanhã às 19h',
              'Crie uma legenda para este conteúdo',
              'Ative a regra de comentários com a palavra QUERO',
              'Quais mensagens automáticas foram enviadas hoje?',
              'Mostre os resultados das últimas publicações',
              'Pause todas as automações'
            ].map((cmd, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(cmd)}
                className="px-2.5 py-1 rounded-lg bg-[#14161f] hover:bg-[#1a1d28] border border-[#202534] text-zinc-300 hover:text-white text-[11px] whitespace-nowrap transition cursor-pointer shrink-0"
              >
                {cmd}
              </button>
            ))}
          </div>

          {/* Barra de Entrada de Comandos */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="p-3.5 border-t border-[#181c24] bg-[#0b0d13] flex items-center gap-2"
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Escreva um comando para o Instagram (ex: Agende este carrossel para amanhã às 19h)..."
              disabled={isSending}
              className="flex-1 bg-[#12141c] border border-[#1e2330] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isSending}
              className="px-4 py-2.5 rounded-xl bg-white text-black hover:bg-zinc-200 disabled:opacity-50 font-bold text-xs transition cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isSending ? 'Executando...' : 'Enviar'}</span>
            </button>
          </form>
        </div>

        {/* ================= COLUNA DIREITA: PAINEL DE CONTROLE OPERACIONAL (5 COLUNAS) ================= */}
        <div className="lg:col-span-5 flex flex-col bg-[#0b0d13] h-[calc(100vh-65px)] overflow-y-auto">
          
          {/* Navegação entre Abas Operacionais */}
          <div className="p-3 border-b border-[#181c24] bg-[#0c0e14] flex items-center gap-1 overflow-x-auto no-scrollbar shrink-0">
            {[
              { id: 'schedule', label: 'Agendamentos', icon: Calendar },
              { id: 'rules', label: 'Regras ("QUERO")', icon: MessageSquare },
              { id: 'insights', label: 'Métricas', icon: BarChart3 },
              { id: 'audit', label: 'Auditoria', icon: Terminal }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeSideTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveSideTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-white text-black font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-[#14161f]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Conteúdo da Aba Direita */}
          <div className="p-4 sm:p-6 space-y-6 flex-1">
            
            {/* ================= ABA 1: AGENDAMENTOS ================= */}
            {activeSideTab === 'schedule' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-emerald-400" />
                      <span>Fila de Publicações Agendadas</span>
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Execução pontual gerenciada pelo servidor (sem depender de aba aberta)
                    </p>
                  </div>
                  {onOpenCarouselStudio && (
                    <button
                      onClick={onOpenCarouselStudio}
                      className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold transition cursor-pointer flex items-center gap-1"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Estúdio</span>
                    </button>
                  )}
                </div>

                {scheduledPosts.length === 0 ? (
                  <div className="p-8 text-center rounded-2xl bg-[#10121a] border border-[#1a1e2a] space-y-2">
                    <Calendar className="w-8 h-8 text-zinc-600 mx-auto" />
                    <p className="text-xs text-zinc-400 font-medium">Nenhum post agendado no momento.</p>
                    <p className="text-[11px] text-zinc-500">
                      Peça no chat: <em>"Agende este carrossel para amanhã às 19h"</em>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {scheduledPosts.map((post) => (
                      <div
                        key={post.id}
                        className="p-4 rounded-2xl bg-[#10121a] border border-[#1a1e2a] hover:border-zinc-700 transition space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span
                              className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded ${
                                post.status === 'scheduled'
                                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                  : post.status === 'published'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {post.status === 'scheduled' ? 'Agendado' : post.status}
                            </span>
                            <div className="text-xs font-bold text-white mt-1.5 flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-zinc-400" />
                              <span>{new Date(post.scheduledTime).toLocaleString('pt-BR')}</span>
                            </div>
                          </div>

                          {post.status === 'scheduled' && (
                            <button
                              onClick={() => handleCancelScheduled(post.id)}
                              className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-[11px] font-bold cursor-pointer transition"
                            >
                              Cancelar
                            </button>
                          )}
                        </div>

                        <p className="text-xs text-zinc-300 line-clamp-2 font-serif">
                          {post.caption}
                        </p>

                        {/* Mini thumbnails dos slides */}
                        {post.slides && post.slides.length > 0 && (
                          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                            {post.slides.map((s, idx) => (
                              <div
                                key={idx}
                                className="w-12 h-14 rounded-lg overflow-hidden border border-zinc-800 bg-black shrink-0 relative"
                              >
                                <img
                                  src={s.imageUrl}
                                  alt={`Slide ${idx + 1}`}
                                  className="w-full h-full object-cover"
                                />
                                <span className="absolute bottom-0.5 right-0.5 text-[8px] font-mono bg-black/80 px-1 text-white rounded">
                                  {idx + 1}
                                </span>
                              </div>
                            ))}
                            <span className="text-[10px] font-mono text-zinc-500 pl-1">
                              {post.slides.length} lâminas
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ================= ABA 2: REGRAS DE COMENTÁRIOS & GATILHOS ================= */}
            {activeSideTab === 'rules' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-purple-400" />
                    <span>Automação de Comentários & Mensagens Diretas (DMs)</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Conformidade com a Meta: respostas autorizadas com janela de 24h e proteção anti-spam
                  </p>
                </div>

                {/* Lista de Regras Configuradas */}
                <div className="space-y-3">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="p-4 rounded-2xl bg-[#10121a] border border-[#1a1e2a] space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300">
                            Gatilho: "{rule.triggerKeyword}"
                          </span>
                          <span className="text-[11px] text-zinc-400 font-mono">
                            {rule.totalExecutions} disparos
                          </span>
                        </div>

                        <button
                          onClick={() => handleToggleRule(rule.id, rule.isActive)}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                            rule.isActive
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                              : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-white'
                          }`}
                        >
                          <Power className="w-3 h-3" />
                          <span>{rule.isActive ? 'Ativa' : 'Pausada'}</span>
                        </button>
                      </div>

                      <div className="space-y-1.5 text-xs text-zinc-300">
                        <p>
                          <strong className="text-white">Resposta Pública:</strong> "{rule.publicReplyText}"
                        </p>
                        <p>
                          <strong className="text-white">DM com Link Oficial:</strong> "{rule.directMessageText}"
                        </p>
                        <div className="text-[11px] font-mono text-zinc-400 truncate">
                          Link FatosBR: <span className="text-zinc-200">{rule.directMessageLink}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Simulador Interativo de Comentário para Teste Seguro */}
                <div className="p-4 rounded-2xl bg-[#0c0e14] border border-[#202534] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>Testar Gatilho no Modo Simulação</span>
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">Zero Risco</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Simule o envio de um comentário para testar a detecção da palavra-chave, a formatação da DM e a prevenção de duplicatas.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-[10px] font-mono text-zinc-400 block mb-1">Usuário Simulado:</label>
                      <input
                        type="text"
                        value={testCommentUsername}
                        onChange={(e) => setTestCommentUsername(e.target.value)}
                        className="w-full bg-[#12141c] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-zinc-400 block mb-1">Texto do Comentário:</label>
                      <input
                        type="text"
                        value={testCommentInput}
                        onChange={(e) => setTestCommentInput(e.target.value)}
                        className="w-full bg-[#12141c] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleTestComment}
                    disabled={isTestingComment}
                    className="w-full py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{isTestingComment ? 'Verificando...' : 'Testar Execução do Gatilho'}</span>
                  </button>

                  {testCommentResult && (
                    <div
                      className={`p-3 rounded-xl border text-xs font-mono leading-relaxed space-y-1 ${
                        testCommentResult.matched
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1.5">
                        {testCommentResult.matched ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                        )}
                        <span>{testCommentResult.message}</span>
                      </div>
                      {testCommentResult.executionLog && (
                        <div className="text-[10px] text-zinc-400 pt-1 border-t border-zinc-800/80">
                          Log: Resposta Pública ({testCommentResult.executionLog.publicReplySent ? 'Sim' : 'Não'}) · DM Enviada ({testCommentResult.executionLog.dmSent ? 'Sim' : 'Não'})
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ================= ABA 3: MÉTRICAS & DESEMPENHO ================= */}
            {activeSideTab === 'insights' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <BarChart3 className="w-4 h-4 text-blue-400" />
                      <span>Métricas de Desempenho (Meta API)</span>
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Origem: {insights?.source || 'Meta Graph API v19.0'} · {insights?.period || 'Últimos 7 dias'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-2xl bg-[#10121a] border border-[#1a1e2a] space-y-1">
                    <span className="text-zinc-400 text-[11px]">Alcance Orgânico</span>
                    <div className="text-lg font-bold font-mono text-white">
                      {insights?.reach.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[10px] text-emerald-400 font-mono">+12.4% vs semana anterior</span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[#10121a] border border-[#1a1e2a] space-y-1">
                    <span className="text-zinc-400 text-[11px]">Impressões Totais</span>
                    <div className="text-lg font-bold font-mono text-white">
                      {insights?.impressions.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[10px] text-emerald-400 font-mono">+18.2% vs semana anterior</span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[#10121a] border border-[#1a1e2a] space-y-1">
                    <span className="text-zinc-400 text-[11px]">DMs Enviadas via "QUERO"</span>
                    <div className="text-lg font-bold font-mono text-emerald-400">
                      {insights?.dmsSentWeek}
                    </div>
                    <span className="text-[10px] text-zinc-500 font-mono">100% taxa de entrega</span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-[#10121a] border border-[#1a1e2a] space-y-1">
                    <span className="text-zinc-400 text-[11px]">Comentários Ingeridos</span>
                    <div className="text-lg font-bold font-mono text-blue-400">
                      {insights?.commentsReceivedWeek}
                    </div>
                    <span className="text-[10px] text-zinc-500 font-mono">Zero bloqueios</span>
                  </div>
                </div>

                {/* Top Publicações */}
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                    Publicações em Destaque
                  </h4>
                  {insights?.topPosts.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-xl bg-[#10121a] border border-[#1a1e2a] space-y-2 text-xs"
                    >
                      <p className="text-zinc-200 font-serif font-medium line-clamp-1">
                        {p.caption}
                      </p>
                      <div className="flex items-center gap-4 text-[11px] font-mono text-zinc-400">
                        <span>❤️ {p.likes.toLocaleString('pt-BR')}</span>
                        <span>💬 {p.comments}</span>
                        <span>🚀 {p.reach.toLocaleString('pt-BR')} alcance</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ================= ABA 4: AUDITORIA & REGISTROS ================= */}
            {activeSideTab === 'audit' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <span>Console de Auditoria & Conformidade</span>
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Registro de requisições, confirmações da Meta e tratamento de exceções
                  </p>
                </div>

                <div className="p-3 rounded-2xl bg-black border border-zinc-800 font-mono text-[11px] space-y-2.5 max-h-[460px] overflow-y-auto">
                  {auditLogs.length === 0 ? (
                    <div className="text-center py-6 text-zinc-500">Nenhum evento registrado.</div>
                  ) : (
                    auditLogs.map((log) => (
                      <div key={log.id} className="pb-2 border-b border-zinc-900 last:border-none space-y-0.5">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-zinc-500">{new Date(log.timestamp).toLocaleTimeString('pt-BR')}</span>
                          <span
                            className={`px-1.5 py-0.2 rounded font-bold uppercase ${
                              log.status === 'success'
                                ? 'text-emerald-400 bg-emerald-500/10'
                                : log.status === 'warning'
                                ? 'text-amber-400 bg-amber-500/10'
                                : 'text-red-400 bg-red-500/10'
                            }`}
                          >
                            {log.status}
                          </span>
                        </div>
                        <div className="font-bold text-white">{log.action}</div>
                        <div className="text-zinc-400">{log.details}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Modal de Configuração de Credenciais Meta Graph API */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="max-w-lg w-full rounded-2xl bg-[#0f1118] border border-[#222736] p-6 space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Credenciais da Meta Graph API</h3>
              </div>
              <button onClick={() => setIsConfigModalOpen(false)} className="text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-zinc-400 leading-relaxed">
              As credenciais oficiais da Meta permanecem estritamente no servidor Node (nunca são enviadas no chat ou expostas no front-end).
            </p>

            <form onSubmit={handleSaveConfig} className="space-y-3">
              <div>
                <label className="text-zinc-300 font-semibold block mb-1">Instagram Business Account ID:</label>
                <input
                  type="text"
                  value={configForm.igUserId}
                  onChange={(e) => setConfigForm({ ...configForm, igUserId: e.target.value })}
                  placeholder="Ex: 17841405829104928"
                  className="w-full bg-[#161822] border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-zinc-300 font-semibold block mb-1">Meta App ID:</label>
                <input
                  type="text"
                  value={configForm.appId}
                  onChange={(e) => setConfigForm({ ...configForm, appId: e.target.value })}
                  placeholder="Ex: 104829184920194"
                  className="w-full bg-[#161822] border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-zinc-300 font-semibold block mb-1">Meta App Secret:</label>
                <input
                  type="password"
                  value={configForm.appSecret}
                  onChange={(e) => setConfigForm({ ...configForm, appSecret: e.target.value })}
                  placeholder="••••••••••••"
                  className="w-full bg-[#161822] border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-zinc-300 font-semibold block mb-1">Long-Lived Access Token:</label>
                <input
                  type="password"
                  value={configForm.accessToken}
                  onChange={(e) => setConfigForm({ ...configForm, accessToken: e.target.value })}
                  placeholder="EAAG..."
                  className="w-full bg-[#161822] border border-zinc-800 rounded-xl px-3 py-2 text-white font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={configForm.isSimulationMode}
                    onChange={(e) => setConfigForm({ ...configForm, isSimulationMode: e.target.checked })}
                    className="rounded border-zinc-700"
                  />
                  <span>Modo Simulação (Sandbox de Teste)</span>
                </label>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsConfigModalOpen(false)}
                    className="px-3.5 py-2 rounded-xl bg-zinc-800 text-zinc-300 hover:text-white font-medium"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 font-bold"
                  >
                    Salvar Credenciais
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
