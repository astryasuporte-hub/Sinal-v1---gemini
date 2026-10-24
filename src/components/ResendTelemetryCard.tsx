/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Mail,
  Send,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Zap,
  BarChart2,
  TrendingUp,
  Server,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  CheckCheck,
  Eye,
  MousePointerClick,
  Copy,
  Check,
  Radio,
  Share2
} from 'lucide-react';
import {
  resendService,
  ResendStatusResponse,
  ResendTelemetry,
  ResendWebhookItem
} from '../services/resendService';

interface ResendTelemetryCardProps {
  /** Callback opcional ao disparar teste ou atualizar */
  onTestDispatchSuccess?: (id: string, recipient: string) => void;
  /** Classe CSS customizada */
  className?: string;
  /** Permite compactar para widgets menores */
  compact?: boolean;
}

export const ResendTelemetryCard: React.FC<ResendTelemetryCardProps> = ({
  onTestDispatchSuccess,
  className = '',
  compact = false
}) => {
  const [data, setData] = useState<ResendStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [simulatingType, setSimulatingType] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [testEmailRecipient, setTestEmailRecipient] = useState(() => resendService.getStoredSubscriberEmail());

  const fetchStatus = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const response = await fetch('/api/resend/status');
      if (response.ok) {
        const json: ResendStatusResponse = await response.json();
        setData(json);
        setLastUpdated(new Date());
      } else {
        const fallback = await resendService.getStatus();
        setData(fallback);
        setLastUpdated(new Date());
      }
    } catch (err: any) {
      console.error('[ResendTelemetryCard] Erro ao carregar telemetria:', err);
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, []);

  // Carga inicial
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Auto-refresh a cada 10 segundos se ativado
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchStatus(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStatus]);

  // Telemetria extraída de providerStats.resend ou stats
  const telemetry: ResendTelemetry = data?.providerStats?.resend || data?.stats || {
    requestsToday: 0,
    requestsThisMonth: 0,
    emailsSentToday: 0,
    emailsSentThisMonth: 0,
    deliveredCount: 0,
    openedCount: 0,
    clickedCount: 0,
    bouncedCount: 0,
    complainedCount: 0,
    lastRequestAt: null,
    lastStatusCode: data?.connected ? 200 : 503,
    lastLatencyMs: data?.latencyMs || 0,
    errorCount: 0,
    lastErrorMessage: null,
    quotaLeft: 3000
  };

  const webhookStats = data?.webhookStats || {
    delivered: telemetry.deliveredCount || 0,
    opened: telemetry.openedCount || 0,
    clicked: telemetry.clickedCount || 0,
    bounced: telemetry.bouncedCount || 0,
    complained: telemetry.complainedCount || 0,
    recentEvents: []
  };

  const isConnected = !!data?.connected;
  const latency = data?.latencyMs || telemetry.lastLatencyMs || 0;

  // Classificação de latência
  const getLatencyBadge = (ms: number) => {
    if (ms <= 0) return { label: 'Inativo', color: 'text-zinc-500 bg-zinc-800/40 border-zinc-700/50' };
    if (ms < 350) return { label: 'Ultra-rápido', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
    if (ms < 800) return { label: 'Estável', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' };
    return { label: 'Sob Demanda', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
  };

  const latencyBadge = getLatencyBadge(latency);

  // Cálculos de cota e taxas de engajamento
  const monthlyTotal = 3000;
  const usedCount = telemetry.requestsThisMonth || 0;
  const quotaRemaining = Math.max(0, monthlyTotal - usedCount);
  const usagePercent = Math.min(100, Math.round((usedCount / monthlyTotal) * 100));

  const totalDelivered = webhookStats.delivered;
  const totalOpened = webhookStats.opened;
  const totalClicked = webhookStats.clicked;
  const totalBounced = webhookStats.bounced;

  const totalSent = Math.max(telemetry.emailsSentToday || telemetry.requestsToday || 1, totalDelivered || 1);
  const deliveryRate = totalSent > 0 ? Math.min(100, Math.round((totalDelivered / totalSent) * 100)) : 100;
  const openRate = totalDelivered > 0 ? Math.min(100, Math.round((totalOpened / totalDelivered) * 100)) : 0;
  const clickRate = totalOpened > 0 ? Math.min(100, Math.round((totalClicked / totalOpened) * 100)) : 0;

  const webhookPublicUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/resend/webhook`
    : '/api/resend/webhook';

  const handleCopyWebhookUrl = () => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(webhookPublicUrl);
      setCopiedWebhookUrl(true);
      setTimeout(() => setCopiedWebhookUrl(false), 2500);
      setNotification({
        type: 'info',
        text: 'URL do Webhook copiada para a área de transferência.'
      });
    }
  };

  const [isSendingBriefing, setIsSendingBriefing] = useState(false);

  const handleTriggerTestEmail = async () => {
    setIsSendingTest(true);
    setNotification(null);
    try {
      const recipient = testEmailRecipient || 'astryasuporte@gmail.com';
      const result = await resendService.sendTestEmail(recipient);
      if (result.success) {
        setNotification({
          type: 'success',
          text: `E-mail de teste operacional despachado para ${recipient} (ID: ${result.id || 'ok'})`
        });
        if (onTestDispatchSuccess && result.id) {
          onTestDispatchSuccess(result.id, recipient);
        }
        await fetchStatus(true);
      } else {
        setNotification({
          type: 'error',
          text: `Falha no envio: ${result.error || 'Erro desconhecido'}`
        });
      }
    } catch (err: any) {
      setNotification({
        type: 'error',
        text: `Erro de comunicação: ${err.message}`
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleTriggerBriefingEmail = async () => {
    setIsSendingBriefing(true);
    setNotification(null);
    try {
      const recipient = testEmailRecipient || 'astryasuporte@gmail.com';
      const result = await resendService.sendMorningBriefingTest(recipient);
      if (result.success) {
        setNotification({
          type: 'success',
          text: `Morning Briefing com template magnífico despachado com sucesso para ${recipient}! (ID: ${result.id || 'ok'})`
        });
        if (onTestDispatchSuccess && result.id) {
          onTestDispatchSuccess(result.id, recipient);
        }
        await fetchStatus(true);
      } else {
        setNotification({
          type: 'error',
          text: `Falha no envio do Briefing: ${result.error || 'Erro desconhecido'}`
        });
      }
    } catch (err: any) {
      setNotification({
        type: 'error',
        text: `Erro de comunicação: ${err.message}`
      });
    } finally {
      setIsSendingBriefing(false);
    }
  };

  const handleSimulateWebhook = async (type: 'delivered' | 'opened' | 'clicked' | 'bounced') => {
    setSimulatingType(type);
    setNotification(null);
    try {
      const recipient = testEmailRecipient || 'astryasuporte@gmail.com';
      const result = await resendService.simulateWebhookEvent(type, {
        recipient,
        subject: 'FatosBR • Morning Briefing Executivo'
      });
      if (result.success) {
        setNotification({
          type: 'success',
          text: `Evento de webhook '${type.toUpperCase()}' processado com sucesso!`
        });
        await fetchStatus(true);
      } else {
        setNotification({
          type: 'error',
          text: `Falha ao processar simulação de webhook: ${type}`
        });
      }
    } catch (err: any) {
      setNotification({
        type: 'error',
        text: `Erro na simulação: ${err.message}`
      });
    } finally {
      setSimulatingType(null);
    }
  };

  return (
    <div
      className={`rounded-2xl bg-[#0e1320] border border-[#182136] shadow-xl overflow-hidden transition-all duration-300 ${className}`}
    >
      {/* Top Header com Status e Controles */}
      <div className="p-4 sm:p-5 border-b border-[#182136] bg-[#0b0f19] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-inner shrink-0">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Telemetria do Resend & Webhooks
              </h3>
              {isConnected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  API Operacional
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium text-red-400 bg-red-500/10 border border-red-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  Desconectado
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 font-mono">
              Consumo em tempo real via <code className="text-blue-400/90 font-semibold">/api/resend/status</code> e <code className="text-emerald-400/90 font-semibold">/api/resend/webhook</code>
            </p>
          </div>
        </div>

        {/* Botões de Ação do Header */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-mono transition flex items-center gap-1.5 border cursor-pointer ${
              autoRefresh
                ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                : 'bg-[#121829] text-zinc-400 border-[#1a2337] hover:text-white'
            }`}
            title="Atualiza a cada 10 segundos"
          >
            <Activity className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse text-blue-400' : ''}`} />
            <span>Auto: {autoRefresh ? 'ON' : 'OFF'}</span>
          </button>

          <button
            disabled={isLoading}
            onClick={() => fetchStatus(false)}
            className="px-3 py-1.5 rounded-xl bg-[#141b2c] hover:bg-[#1a243a] text-zinc-200 hover:text-white text-xs font-medium border border-[#202c46] transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Sincronizar telemetria agora"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-6">
        {/* ================= 1. GRID DE MÉTRICAS OPERACIONAIS BÁSICAS ================= */}
        <div>
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-blue-400" />
            <span>Desempenho da Infraestrutura de Envio</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Métrica 1: Envios Hoje */}
            <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#161f33] space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-xs">
                <span>Envios Hoje</span>
                <Send className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
                {telemetry.requestsToday ?? 0}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono">
                {telemetry.emailsSentToday !== undefined
                  ? `${telemetry.emailsSentToday} entregues`
                  : 'Requisições processadas'}
              </div>
            </div>

            {/* Métrica 2: Envios no Mês */}
            <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#161f33] space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-xs">
                <span>Total no Mês</span>
                <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
                {telemetry.requestsThisMonth ?? 0}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono">
                {usedCount} de {monthlyTotal} do plano
              </div>
            </div>

            {/* Métrica 3: Latência Operacional */}
            <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#161f33] space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-xs">
                <span>Latência da API</span>
                <Zap className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-400 tracking-tight flex items-baseline gap-1">
                <span>{latency}</span>
                <span className="text-xs font-normal text-zinc-400">ms</span>
              </div>
              <div className="pt-0.5">
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-mono border ${latencyBadge.color}`}
                >
                  {latencyBadge.label}
                </span>
              </div>
            </div>

            {/* Métrica 4: Taxa de Erros & Status */}
            <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#161f33] space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-xs">
                <span>Taxa de Erros</span>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div
                className={`text-xl sm:text-2xl font-bold font-mono tracking-tight ${
                  telemetry.errorCount > 0 ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {telemetry.errorCount ?? 0}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono">
                Status HTTP: <strong className="text-zinc-300">{telemetry.lastStatusCode || 200}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* ================= 2. SEÇÃO DE WEBHOOKS (DELIVERED, OPENED, CLICKED) ================= */}
        <div className="p-4 sm:p-5 rounded-xl bg-[#090d16] border border-[#182338] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#141d30]">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-white tracking-tight flex items-center gap-2">
                  <span>Rastreamento de Webhooks em Tempo Real</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Ativo
                  </span>
                </h4>
                <p className="text-[11px] text-zinc-400">
                  Captura automática de eventos de entrega, abertura e clique via <code className="text-zinc-300 font-mono">POST /api/resend/webhook</code>
                </p>
              </div>
            </div>

            {/* Botão de Copiar URL do Webhook */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyWebhookUrl}
                className="px-2.5 py-1.5 rounded-lg bg-[#141d30] hover:bg-[#1a2640] border border-[#202e4d] text-zinc-200 text-xs font-mono transition flex items-center gap-1.5 cursor-pointer"
                title="Copiar URL para o Dashboard do Resend"
              >
                {copiedWebhookUrl ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">URL Copiada!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Copiar URL do Webhook</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Cards de Métricas de Engajamento por Webhook */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {/* Delivered */}
            <div className="p-3 rounded-xl bg-[#0d1322] border border-emerald-500/20 space-y-1">
              <div className="flex items-center justify-between text-emerald-400">
                <span className="font-semibold text-[11px] uppercase tracking-wider">Entregues</span>
                <CheckCheck className="w-4 h-4" />
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-white">
                {totalDelivered}
              </div>
              <div className="text-[10px] text-emerald-400/80 font-mono">
                Taxa de Entrega: {deliveryRate}%
              </div>
            </div>

            {/* Opened */}
            <div className="p-3 rounded-xl bg-[#0d1322] border border-blue-500/20 space-y-1">
              <div className="flex items-center justify-between text-blue-400">
                <span className="font-semibold text-[11px] uppercase tracking-wider">Abertos</span>
                <Eye className="w-4 h-4" />
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-white">
                {totalOpened}
              </div>
              <div className="text-[10px] text-blue-400/80 font-mono">
                Taxa de Abertura: {openRate}%
              </div>
            </div>

            {/* Clicked */}
            <div className="p-3 rounded-xl bg-[#0d1322] border border-purple-500/20 space-y-1">
              <div className="flex items-center justify-between text-purple-400">
                <span className="font-semibold text-[11px] uppercase tracking-wider">Cliques</span>
                <MousePointerClick className="w-4 h-4" />
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-white">
                {totalClicked}
              </div>
              <div className="text-[10px] text-purple-400/80 font-mono">
                CTR de Cliques: {clickRate}%
              </div>
            </div>

            {/* Bounced */}
            <div className="p-3 rounded-xl bg-[#0d1322] border border-red-500/20 space-y-1">
              <div className="flex items-center justify-between text-red-400">
                <span className="font-semibold text-[11px] uppercase tracking-wider">Rejeições</span>
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono text-white">
                {totalBounced}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono">
                {totalBounced === 0 ? '0% (Reputação Limpa)' : 'Atenção a bounces'}
              </div>
            </div>
          </div>

          {/* Ferramenta de Simulação e Teste de Webhooks */}
          <div className="p-3.5 rounded-xl bg-[#0c101c] border border-[#162138] space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-300">
                Testar Recepção de Webhook (Dispara evento para validar painel):
              </span>
              <span className="text-[10px] font-mono text-zinc-500">
                POST /api/resend/webhook
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                disabled={simulatingType !== null}
                onClick={() => handleSimulateWebhook('delivered')}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-mono transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <CheckCheck className={`w-3.5 h-3.5 ${simulatingType === 'delivered' ? 'animate-spin' : ''}`} />
                <span>Simular 'Delivered'</span>
              </button>

              <button
                disabled={simulatingType !== null}
                onClick={() => handleSimulateWebhook('opened')}
                className="px-2.5 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs font-mono transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Eye className={`w-3.5 h-3.5 ${simulatingType === 'opened' ? 'animate-spin' : ''}`} />
                <span>Simular 'Opened'</span>
              </button>

              <button
                disabled={simulatingType !== null}
                onClick={() => handleSimulateWebhook('clicked')}
                className="px-2.5 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-mono transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <MousePointerClick className={`w-3.5 h-3.5 ${simulatingType === 'clicked' ? 'animate-spin' : ''}`} />
                <span>Simular 'Clicked'</span>
              </button>

              <button
                disabled={simulatingType !== null}
                onClick={() => handleSimulateWebhook('bounced')}
                className="px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-mono transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <AlertTriangle className={`w-3.5 h-3.5 ${simulatingType === 'bounced' ? 'animate-spin' : ''}`} />
                <span>Simular 'Bounced'</span>
              </button>
            </div>
          </div>

          {/* Feed de Eventos Recentes de Webhook */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-300">Feed de Eventos Recebidos</span>
              <span className="text-[10px] font-mono text-zinc-500">
                {webhookStats.recentEvents?.length || 0} eventos registrados
              </span>
            </div>

            {webhookStats.recentEvents && webhookStats.recentEvents.length > 0 ? (
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 no-scrollbar font-mono text-[11px]">
                {webhookStats.recentEvents.slice(0, 8).map((evt) => {
                  let badgeClass = 'text-zinc-400 bg-zinc-800 border-zinc-700';
                  let icon = <Activity className="w-3 h-3" />;

                  if (evt.type === 'delivered') {
                    badgeClass = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
                    icon = <CheckCheck className="w-3 h-3" />;
                  } else if (evt.type === 'opened') {
                    badgeClass = 'text-blue-400 bg-blue-500/10 border-blue-500/30';
                    icon = <Eye className="w-3 h-3" />;
                  } else if (evt.type === 'clicked') {
                    badgeClass = 'text-purple-400 bg-purple-500/10 border-purple-500/30';
                    icon = <MousePointerClick className="w-3 h-3" />;
                  } else if (evt.type === 'bounced') {
                    badgeClass = 'text-red-400 bg-red-500/10 border-red-500/30';
                    icon = <AlertTriangle className="w-3 h-3" />;
                  }

                  return (
                    <div
                      key={evt.id}
                      className="p-2.5 rounded-lg bg-[#0c101c] border border-[#162138] flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase border shrink-0 ${badgeClass}`}>
                          {icon}
                          <span>{evt.type}</span>
                        </span>
                        <span className="text-zinc-200 truncate">{evt.recipient}</span>
                        {evt.link && (
                          <span className="text-purple-400/80 truncate text-[10px] hidden sm:inline">
                            ↳ {evt.link}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500 shrink-0">
                        <span>{new Date(evt.timestamp).toLocaleTimeString('pt-BR')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-4 text-center rounded-lg bg-[#0c101c] border border-[#162138] text-zinc-500 text-xs">
                Aguardando primeiros eventos de webhook do Resend. Use os botões acima para simular.
              </div>
            )}
          </div>
        </div>

        {/* ================= 3. CONSUMO DE COTA MENSAL ================= */}
        <div className="p-4 rounded-xl bg-[#090d16] border border-[#161f33] space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-blue-400" />
              <span className="font-semibold text-zinc-200">Consumo da Cota Mensal Resend</span>
            </div>
            <span className="font-mono text-zinc-400 text-[11px]">
              <strong className="text-white">{quotaRemaining.toLocaleString()}</strong> de {monthlyTotal.toLocaleString()} disparos restantes ({usagePercent}%)
            </span>
          </div>

          <div className="w-full h-2 rounded-full bg-[#141b2c] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${Math.max(2, usagePercent)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
            <span>0 envios</span>
            <span>Plano Operacional: 3.000 e-mails/mês inclusos</span>
            <span>3.000 max</span>
          </div>
        </div>

        {/* ================= 4. DETALHES TÉCNICOS & METADADOS ================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {/* Card Esquerdo: Credenciais & Endpoint */}
          <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#161f33] space-y-2">
            <div className="text-zinc-400 font-semibold flex items-center gap-1.5 pb-1.5 border-b border-[#141d30]">
              <Server className="w-3.5 h-3.5 text-zinc-400" />
              <span>Configuração da Conexão</span>
            </div>
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Chave Mascarada:</span>
                <span className="text-zinc-200 bg-[#121829] px-2 py-0.5 rounded border border-[#1c253b]">
                  {data?.keyMasked || 're_Zpj8••••keQe'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Remetente Verificado:</span>
                <span className="text-blue-300">
                  {data?.sender || 'onboarding@resend.dev'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Endpoint de Webhook:</span>
                <span className="text-emerald-400">/api/resend/webhook</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Último Despacho:</span>
                <span className="text-zinc-300">
                  {telemetry.lastRequestAt
                    ? new Date(telemetry.lastRequestAt).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        day: '2-digit',
                        month: '2-digit'
                      })
                    : 'Aguardando primeiro envio'}
                </span>
              </div>
            </div>
          </div>

          {/* Card Direito: Templates & Pipeline */}
          <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#161f33] space-y-2">
            <div className="text-zinc-400 font-semibold flex items-center gap-1.5 pb-1.5 border-b border-[#141d30]">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              <span>Templates & Automação</span>
            </div>
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Templates HTML:</span>
                <span className="text-emerald-400">/templates/emails/*.html</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Morning Briefing:</span>
                <span className="text-amber-400">07:00 AM (Ativo)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Evening Briefing:</span>
                <span className="text-blue-400">20:00 PM (Ativo)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notificação de Feedback */}
        {notification && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center justify-between animate-fade-in ${
              notification.type === 'success'
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                : notification.type === 'info'
                ? 'bg-blue-950/30 border-blue-500/30 text-blue-300'
                : 'bg-red-950/30 border-red-500/30 text-red-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {notification.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : notification.type === 'info' ? (
                <Activity className="w-4 h-4 shrink-0 text-blue-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              )}
              <span>{notification.text}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-zinc-400 hover:text-white ml-2 text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* ================= 5. BARRA DE TESTE OPERACIONAL DE DISPARO ================= */}
        <div className="p-4 rounded-xl bg-[#090d16] border border-[#161f33] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-[11px] font-medium text-zinc-300">
                Testar Envio via Resend API (Atualiza Telemetria Instantaneamente)
              </label>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                Sandbox: astryasuporte@gmail.com
              </span>
            </div>
            <input
              type="email"
              value={testEmailRecipient}
              onChange={(e) => {
                setTestEmailRecipient(e.target.value);
                resendService.setStoredSubscriberEmail(e.target.value);
              }}
              placeholder="astryasuporte@gmail.com"
              className="w-full bg-[#121829] border border-[#1c253b] rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:self-end">
            <button
              disabled={isSendingBriefing || !isConnected}
              onClick={handleTriggerBriefingEmail}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-indigo-950/40 cursor-pointer disabled:opacity-50 shrink-0"
              title="Dispara o Briefing Executivo com o novo template magnífico para validação imediata"
            >
              <Send className={`w-3.5 h-3.5 ${isSendingBriefing ? 'animate-spin' : ''}`} />
              <span>{isSendingBriefing ? 'Despachando Briefing...' : '⚡ Testar Morning Briefing (07h00)'}</span>
            </button>

            <button
              disabled={isSendingTest || !isConnected}
              onClick={handleTriggerTestEmail}
              className="px-3 py-2 rounded-xl bg-[#151c2c] hover:bg-[#1b253b] border border-[#23314d] text-zinc-300 hover:text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50 shrink-0"
              title="Dispara teste de infraestrutura simples"
            >
              <Mail className={`w-3.5 h-3.5 ${isSendingTest ? 'animate-spin' : ''}`} />
              <span>{isSendingTest ? 'Enviando...' : 'Teste Simples'}</span>
            </button>
          </div>
        </div>

        {/* Rodapé com Última Sincronização */}
        <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-2 border-t border-[#141b2c] font-mono">
          <span>Provedor: Resend Email Infrastructure</span>
          <span>
            Última sincronização: {lastUpdated ? lastUpdated.toLocaleTimeString('pt-BR') : '--'}
          </span>
        </div>
      </div>
    </div>
  );
};
