/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail,
  CheckCircle2,
  Eye,
  MousePointerClick,
  AlertTriangle,
  RotateCw,
  Copy,
  Check,
  Radio,
  ExternalLink,
  Zap,
  Activity,
  Filter,
  Trash2,
  Clock
} from 'lucide-react';
import { ResendWebhookItem } from '../services/resendService';

interface WebhookDataResponse {
  ok: boolean;
  provider: string;
  counts: {
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
  };
  recentEvents: ResendWebhookItem[];
  stats?: {
    requestsToday?: number;
    emailsSentToday?: number;
    lastLatencyMs?: number;
    lastRequestAt?: string;
  };
}

interface ResendWebhookLiveMonitorProps {
  onShowToast?: (msg: string) => void;
  className?: string;
}

export const ResendWebhookLiveMonitor: React.FC<ResendWebhookLiveMonitorProps> = ({
  onShowToast,
  className = ''
}) => {
  const [data, setData] = useState<WebhookDataResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'delivered' | 'opened' | 'clicked' | 'bounced'>('all');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isSimulating, setIsSimulating] = useState<string | null>(null);

  const webhookEndpoint = typeof window !== 'undefined'
    ? `${window.location.origin}/api/resend/webhook`
    : '/api/resend/webhook';

  const fetchWebhookData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const res = await fetch('/api/resend/webhook');
      if (res.ok) {
        const json: WebhookDataResponse = await res.json();
        setData(json);
        setLastRefreshedAt(new Date());
      }
    } catch (err) {
      console.warn('[ResendWebhookLiveMonitor] Erro ao consultar /api/resend/webhook:', err);
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWebhookData();
  }, [fetchWebhookData]);

  // Polling automático a cada 4 segundos
  useEffect(() => {
    if (!isAutoRefresh) return;
    const interval = setInterval(() => {
      fetchWebhookData(true);
    }, 4000);
    return () => clearInterval(interval);
  }, [isAutoRefresh, fetchWebhookData]);

  // Copiar URL do Webhook
  const handleCopyUrl = () => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(webhookEndpoint);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
      if (onShowToast) onShowToast('URL do Webhook Resend copiada para a área de transferência.');
    }
  };

  // Simular evento de webhook diretamente no endpoint backend
  const handleSimulateWebhook = async (type: 'delivered' | 'opened' | 'clicked' | 'bounced') => {
    setIsSimulating(type);
    try {
      const testEmail = 'astryasuporte@gmail.com';
      const payload = {
        type: `email.${type}`,
        created_at: new Date().toISOString(),
        data: {
          email_id: `em_sim_${Date.now().toString(36)}`,
          to: [testEmail],
          subject: 'FatosBR • Morning Briefing Executivo',
          click: type === 'clicked' ? { link: 'https://fatosbr.app/noticia/selic-economia' } : undefined
        }
      };

      const res = await fetch('/api/resend/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        if (onShowToast) onShowToast(`Webhook '${type.toUpperCase()}' processado com sucesso!`);
        await fetchWebhookData(true);
      } else {
        if (onShowToast) onShowToast(`Falha ao registrar webhook: HTTP ${res.status}`);
      }
    } catch (err: any) {
      if (onShowToast) onShowToast(`Erro ao disparar webhook: ${err.message}`);
    } finally {
      setIsSimulating(null);
    }
  };

  const counts = data?.counts || {
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0
  };

  const recentEvents = data?.recentEvents || [];

  const filteredEvents = recentEvents.filter((ev) => {
    if (filterType === 'all') return true;
    return ev.type === filterType;
  });

  const totalDelivered = counts.delivered;
  const totalOpened = counts.opened;
  const totalClicked = counts.clicked;
  const totalBounced = counts.bounced;

  const openRate = totalDelivered > 0 ? Math.min(100, Math.round((totalOpened / totalDelivered) * 100)) : 0;
  const clickRate = totalOpened > 0 ? Math.min(100, Math.round((totalClicked / totalOpened) * 100)) : 0;

  return (
    <div className={`p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4 shadow-xl text-zinc-100 ${className}`}>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-emerald-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <Activity className="w-5 h-5 text-[#20D6A0]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Métricas & Webhook em Tempo Real (Resend)
              </h3>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#20D6A0]/15 text-[#20D6A0] border border-[#20D6A0]/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[#20D6A0] animate-pulse" />
                <span>AO VIVO</span>
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Escuta contínua de entrega, abertura e cliques via <code className="text-[#41C8F4] font-mono font-semibold">/api/resend/webhook</code>
            </p>
          </div>
        </div>

        {/* Controles do Header */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            onClick={() => setIsAutoRefresh(!isAutoRefresh)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              isAutoRefresh
                ? 'bg-[#20D6A0]/15 text-[#20D6A0] border-[#20D6A0]/30'
                : 'bg-zinc-800/80 text-zinc-400 border-zinc-700/60 hover:text-white'
            }`}
            title={isAutoRefresh ? 'Pausar polling ao vivo' : 'Ativar polling a cada 4s'}
          >
            <Radio className={`w-3.5 h-3.5 ${isAutoRefresh ? 'animate-pulse text-[#20D6A0]' : ''}`} />
            <span>{isAutoRefresh ? 'Sincronia 4s' : 'Pausado'}</span>
          </button>

          <button
            onClick={() => fetchWebhookData(false)}
            disabled={isLoading}
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 transition cursor-pointer disabled:opacity-50"
            title="Atualizar agora"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#41C8F4]' : ''}`} />
          </button>
        </div>
      </div>

      {/* 4 Cards de Métricas Principais (Entrega, Abertura, Cliques, Rejeições) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Entregues */}
        <div className="p-3.5 rounded-xl bg-[#0a0f1a] border border-[#18263e] space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#20D6A0]" />
              <span>Entregues</span>
            </span>
            <span className="text-[10px] font-mono text-[#20D6A0]">100% SLA</span>
          </div>
          <div className="text-2xl font-bold font-mono text-white tracking-tight">
            {totalDelivered}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            E-mails confirmados pelo MTA
          </div>
        </div>

        {/* Abertos */}
        <div className="p-3.5 rounded-xl bg-[#0a0f1a] border border-[#18263e] space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="flex items-center gap-1.5 font-medium">
              <Eye className="w-3.5 h-3.5 text-[#41C8F4]" />
              <span>Aberturas</span>
            </span>
            <span className="text-[10px] font-mono text-[#41C8F4]">{openRate}% taxa</span>
          </div>
          <div className="text-2xl font-bold font-mono text-white tracking-tight">
            {totalOpened}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            {openRate}% dos e-mails entregues
          </div>
        </div>

        {/* Cliques */}
        <div className="p-3.5 rounded-xl bg-[#0a0f1a] border border-[#18263e] space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="flex items-center gap-1.5 font-medium">
              <MousePointerClick className="w-3.5 h-3.5 text-purple-400" />
              <span>Cliques</span>
            </span>
            <span className="text-[10px] font-mono text-purple-400">{clickRate}% CTR</span>
          </div>
          <div className="text-2xl font-bold font-mono text-white tracking-tight">
            {totalClicked}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            Interações com links das notícias
          </div>
        </div>

        {/* Bounces & Erros */}
        <div className="p-3.5 rounded-xl bg-[#0a0f1a] border border-[#18263e] space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Bounces</span>
            </span>
            <span className="text-[10px] font-mono text-amber-400">
              {totalBounced === 0 ? '0% Baixo' : `${totalBounced} falhas`}
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-white tracking-tight">
            {totalBounced}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            Caixas de entrada inexistentes
          </div>
        </div>
      </div>

      {/* Caixa de Configuração e URL do Webhook */}
      <div className="p-3.5 rounded-xl bg-[#070b14] border border-[#18263e] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
        <div className="min-w-0">
          <span className="text-[10px] text-zinc-400 font-mono uppercase tracking-wider block">
            Endpoint Oficial de Escuta de Webhook:
          </span>
          <div className="font-mono text-[11px] text-[#41C8F4] truncate mt-0.5 select-all">
            {webhookEndpoint}
          </div>
        </div>
        <button
          onClick={handleCopyUrl}
          className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0 border border-zinc-700"
        >
          {copiedUrl ? <Check className="w-3.5 h-3.5 text-[#20D6A0]" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copiedUrl ? 'Copiado!' : 'Copiar URL'}</span>
        </button>
      </div>

      {/* Barra de Simulação / Teste Rápido de Webhook */}
      <div className="p-3 rounded-xl bg-[#0a0f1a] border border-[#18263e] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-300">
            Simular Disparo de Evento:
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <button
            onClick={() => handleSimulateWebhook('delivered')}
            disabled={isSimulating !== null}
            className="flex-1 sm:flex-none px-2.5 py-1 rounded-lg bg-[#20D6A0]/15 hover:bg-[#20D6A0]/25 text-[#20D6A0] border border-[#20D6A0]/30 text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
          >
            {isSimulating === 'delivered' ? 'Enviando...' : '+ Entrega'}
          </button>
          <button
            onClick={() => handleSimulateWebhook('opened')}
            disabled={isSimulating !== null}
            className="flex-1 sm:flex-none px-2.5 py-1 rounded-lg bg-[#41C8F4]/15 hover:bg-[#41C8F4]/25 text-[#41C8F4] border border-[#41C8F4]/30 text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
          >
            {isSimulating === 'opened' ? 'Enviando...' : '+ Abertura'}
          </button>
          <button
            onClick={() => handleSimulateWebhook('clicked')}
            disabled={isSimulating !== null}
            className="flex-1 sm:flex-none px-2.5 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 border border-purple-500/30 text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
          >
            {isSimulating === 'clicked' ? 'Enviando...' : '+ Clique'}
          </button>
          <button
            onClick={() => handleSimulateWebhook('bounced')}
            disabled={isSimulating !== null}
            className="flex-1 sm:flex-none px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
          >
            {isSimulating === 'bounced' ? 'Enviando...' : '+ Bounce'}
          </button>
        </div>
      </div>

      {/* Tabela de Log de Eventos Recebidos em Tempo Real */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
              Log de Eventos Recebidos ({filteredEvents.length})
            </h4>
          </div>

          {/* Filtros por Tipo de Evento */}
          <div className="flex items-center gap-1 bg-[#070b14] border border-[#18263e] p-1 rounded-lg text-[10px] font-mono">
            {(['all', 'delivered', 'opened', 'clicked', 'bounced'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  filterType === t
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {t === 'all' ? 'Todos' : t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 font-mono text-xs bg-[#070b14] rounded-xl border border-[#18263e]">
            Nenhum evento registrado no webhook ainda. Dispare um e-mail ou use os botões de simulação acima para observar a telemetria ao vivo.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#18263e] bg-[#070b14]">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-[#18263e] text-[10px] text-zinc-400 uppercase bg-[#090f1c]/80">
                  <th className="py-2.5 pl-3">Tipo</th>
                  <th className="py-2.5">Destinatário</th>
                  <th className="py-2.5">Assunto</th>
                  <th className="py-2.5">Horário</th>
                  <th className="py-2.5 pr-3 text-right">Detalhe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141e30]">
                {filteredEvents.map((ev, i) => {
                  const isDelivered = ev.type === 'delivered';
                  const isOpened = ev.type === 'opened';
                  const isClicked = ev.type === 'clicked';
                  const isBounced = ev.type === 'bounced';

                  return (
                    <tr key={ev.id || i} className="hover:bg-[#0d1627]/50 transition">
                      <td className="py-2 pl-3">
                        {isDelivered && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#20D6A0]/15 text-[#20D6A0] border border-[#20D6A0]/30 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            DELIVERED
                          </span>
                        )}
                        {isOpened && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#41C8F4]/15 text-[#41C8F4] border border-[#41C8F4]/30 inline-flex items-center gap-1">
                            <Eye className="w-3 h-3" />
                            OPENED
                          </span>
                        )}
                        {isClicked && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30 inline-flex items-center gap-1">
                            <MousePointerClick className="w-3 h-3" />
                            CLICKED
                          </span>
                        )}
                        {isBounced && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            BOUNCED
                          </span>
                        )}
                        {!isDelivered && !isOpened && !isClicked && !isBounced && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
                            {ev.rawType || ev.type}
                          </span>
                        )}
                      </td>

                      <td className="py-2 text-zinc-200 truncate max-w-[180px]">
                        {ev.recipient}
                      </td>

                      <td className="py-2 text-zinc-400 truncate max-w-[220px]">
                        {ev.subject}
                      </td>

                      <td className="py-2 text-zinc-500 text-[10px]">
                        {new Date(ev.timestamp).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </td>

                      <td className="py-2 pr-3 text-right text-zinc-400 text-[10px]">
                        {ev.link ? (
                          <a
                            href={ev.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#41C8F4] hover:underline flex items-center justify-end gap-1"
                          >
                            <span>Link</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          <span className="text-zinc-600">ID: {ev.emailId?.substring(0, 10)}...</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {lastRefreshedAt && (
        <div className="text-[10px] text-zinc-500 font-mono text-right pt-1">
          Última atualização do webhook: {lastRefreshedAt.toLocaleTimeString('pt-BR')}
        </div>
      )}
    </div>
  );
};
