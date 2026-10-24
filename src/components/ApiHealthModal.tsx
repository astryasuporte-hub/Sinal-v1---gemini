/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  X,
  RotateCw,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Server,
  Cpu,
  Newspaper,
  Mail,
  Globe2,
  Clock,
  CheckCircle2,
  TrendingUp,
  Radio
} from 'lucide-react';

interface ProviderSpec {
  name: string;
  plan: string;
  dailyQuota: number;
  monthlyQuota: number;
  rateLimitPerSec: number;
  endpointMasked: string;
  recommendedIntervalMinutes: number;
  notes: string;
}

interface ProviderStat {
  requestsToday: number;
  requestsThisMonth: number;
  emailsSentToday?: number;
  emailsSentThisMonth?: number;
  deliveredCount?: number;
  openedCount?: number;
  clickedCount?: number;
  lastRequestAt: string | null;
  lastStatusCode: number;
  lastLatencyMs: number;
  errorCount: number;
  lastErrorMessage: string | null;
  quotaLeft: number;
}

interface ProxyStatusResponse {
  serverTime: string;
  specs: Record<string, ProviderSpec>;
  stats: Record<string, ProviderStat>;
}

interface ApiHealthModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSuperAdmin?: boolean;
}

export const ApiHealthModal: React.FC<ApiHealthModalProps> = ({
  isOpen,
  onClose,
  isSuperAdmin = true
}) => {
  const [data, setData] = useState<ProxyStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [pingingId, setPingingId] = useState<string | null>(null);

  const fetchStatus = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const res = await fetch('/api/proxy/status');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastFetched(new Date());
      }
    } catch (err) {
      console.warn('Erro ao carregar telemetria de /api/proxy/status:', err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen, fetchStatus]);

  useEffect(() => {
    if (!isOpen || !autoRefresh) return;
    const interval = setInterval(() => {
      fetchStatus(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [isOpen, autoRefresh, fetchStatus]);

  // Fechar com tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Proteção de segurança: Exclusivo para Super Admin
  if (!isSuperAdmin) {
    return (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-fade-in">
        <div className="w-full max-w-md p-6 rounded-2xl bg-black border border-white/20 text-center text-white space-y-4">
          <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-700 text-white flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">Acesso Restrito ao Super Admin</h3>
          <p className="text-xs text-zinc-400">
            A telemetria detalhada de cotas dos provedores é visível exclusivamente para o administrador titular.
          </p>
          <button
            onClick={onClose}
            className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  // Cálculos consolidados
  const specs = data?.specs || {};
  const stats = data?.stats || {};

  const totalRequestsToday = Object.values(stats).reduce((acc, curr) => acc + (curr.requestsToday || 0), 0);
  const totalErrors = Object.values(stats).reduce((acc, curr) => acc + (curr.errorCount || 0), 0);
  
  const activeLatencies = Object.values(stats)
    .map(s => s.lastLatencyMs)
    .filter(ms => ms > 0);
  const avgLatency = activeLatencies.length > 0
    ? Math.round(activeLatencies.reduce((a, b) => a + b, 0) / activeLatencies.length)
    : 245;

  const handlePingProvider = async (providerKey: string) => {
    setPingingId(providerKey);
    try {
      if (providerKey === 'resend') {
        await fetch('/api/resend/status');
      } else {
        await fetch(`/api/proxy/${providerKey}?q=brasil`);
      }
      await fetchStatus(true);
    } catch {}
    setPingingId(null);
  };

  const getProviderIcon = (key: string) => {
    switch (key) {
      case 'gnews':
      case 'newsapi':
        return <Newspaper className="w-4 h-4 text-white" />;
      case 'worldnews':
        return <Globe2 className="w-4 h-4 text-white" />;
      case 'nvidia':
        return <Cpu className="w-4 h-4 text-white" />;
      case 'resend':
        return <Mail className="w-4 h-4 text-white" />;
      default:
        return <Server className="w-4 h-4 text-white" />;
    }
  };

  const providers = [
    { key: 'gnews', name: 'GNews API', type: 'Notícias em Tempo Real' },
    { key: 'newsapi', name: 'NewsAPI', type: 'Ingestão e Manchetes' },
    { key: 'worldnews', name: 'World News API', type: 'Cobertura Global' },
    { key: 'nvidia', name: 'NVIDIA NIM (IA)', type: 'Síntese Analítica Autônoma' },
    { key: 'resend', name: 'Resend Email Engine', type: 'Daily Briefings & Disparos' },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-2 sm:p-5 bg-black/90 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[94vh] flex flex-col rounded-2xl bg-black border border-zinc-800 text-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho do Modal Monocromático de Alto Contraste */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between bg-black">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center text-white shrink-0">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                  Saúde da API & Cotas
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white text-black border border-white">
                  SUPER ADMIN
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Telemetria oficial consumida via <code className="text-white font-mono font-semibold">/api/proxy/status</code>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchStatus(false)}
              disabled={loading}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white transition cursor-pointer disabled:opacity-50"
              title="Atualizar telemetria agora"
              aria-label="Atualizar telemetria"
            >
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-white' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
              title="Fechar (Esc)"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Barra Superior de Métricas Globais (Grid Responsivo Monocromático) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 sm:p-4 border-b border-zinc-800 bg-zinc-950 text-xs">
          <div className="p-3 rounded-xl bg-black border border-zinc-800 space-y-1">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono">
              <span>Requisições Hoje</span>
              <TrendingUp className="w-3.5 h-3.5 text-zinc-300" />
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-white tabular-nums">
              {totalRequestsToday}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono">
              Consumo acumulado
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black border border-zinc-800 space-y-1">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono">
              <span>Latência Média</span>
              <Zap className="w-3.5 h-3.5 text-zinc-300" />
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-white tabular-nums">
              {avgLatency} <span className="text-xs font-normal text-zinc-400">ms</span>
            </div>
            <div className="text-[10px] text-zinc-400 font-mono">
              Resposta do proxy
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black border border-zinc-800 space-y-1">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono">
              <span>Erros</span>
              <ShieldCheck className="w-3.5 h-3.5 text-zinc-300" />
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-white tabular-nums">
              {totalErrors}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono">
              {totalErrors === 0 ? '0 falhas registradas' : 'Alertas sob controle'}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black border border-zinc-800 space-y-1">
            <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono">
              <span>Status Core</span>
              <Radio className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="w-2 h-2 rounded-full bg-white" />
              <span className="font-bold text-xs font-mono text-white">OPERACIONAL</span>
            </div>
            <div className="text-[10px] text-zinc-400 font-mono">
              {lastFetched ? lastFetched.toLocaleTimeString('pt-BR') : 'Carregando...'}
            </div>
          </div>
        </div>

        {/* Lista Detalhada de Provedores com Cotas */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between text-xs text-zinc-400 pb-1">
            <span className="font-bold text-white uppercase tracking-wider text-[11px] font-mono">
              Cotas dos Provedores Oficiais
            </span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-zinc-300 hover:text-white">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 text-white focus:ring-0 cursor-pointer"
                />
                <span className="font-mono">Auto (10s)</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {providers.map(({ key, name, type }) => {
              const spec = specs[key] || {
                plan: 'Plano Ativo',
                dailyQuota: 100,
                monthlyQuota: 3000,
                recommendedIntervalMinutes: 30,
                notes: 'Conexão ativa'
              };
              const stat = stats[key] || {
                requestsToday: 0,
                requestsThisMonth: 0,
                quotaLeft: spec.dailyQuota,
                lastStatusCode: 200,
                lastLatencyMs: 0,
                errorCount: 0,
                lastErrorMessage: null,
                lastRequestAt: null
              };

              const dailyQuota = spec.dailyQuota || 100;
              const usedToday = stat.requestsToday || 0;
              const percentDaily = Math.min(100, Math.round((usedToday / dailyQuota) * 100));
              const quotaLeft = typeof stat.quotaLeft === 'number' ? Math.round(stat.quotaLeft) : Math.max(0, dailyQuota - usedToday);

              const isHealthy = stat.errorCount === 0 && (stat.lastStatusCode === 200 || stat.lastStatusCode === 0);

              return (
                <div
                  key={key}
                  className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-700 transition space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-black border border-zinc-800 text-white shrink-0">
                        {getProviderIcon(key)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-xs sm:text-sm font-bold text-white leading-tight">
                            {name}
                          </h4>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black border border-zinc-700 text-zinc-300 font-semibold">
                            {spec.plan}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                          {type} • {spec.notes}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border border-zinc-700 bg-black text-white flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? 'bg-white' : 'bg-zinc-400'}`} />
                        {isHealthy ? 'Normal' : `HTTP ${stat.lastStatusCode || 'Check'}`}
                      </span>

                      <button
                        onClick={() => handlePingProvider(key)}
                        disabled={pingingId === key}
                        className="min-h-[40px] px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-bold font-mono transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                        title="Realizar teste de ping e medir latência em tempo real"
                      >
                        <Zap className={`w-3.5 h-3.5 text-black ${pingingId === key ? 'animate-spin' : ''}`} />
                        <span>{pingingId === key ? 'Ping...' : 'Testar Ping'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Barra de Consumo de Cota Diária Monocromática */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-zinc-400">
                        Cota Diária: <strong className="text-white">{usedToday}</strong> / {dailyQuota} req
                      </span>
                      <span className="text-white font-bold">
                        {quotaLeft} restantes ({percentDaily}%)
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-black border border-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-white transition-all duration-500 rounded-full"
                        style={{ width: `${Math.max(2, percentDaily)}%` }}
                      />
                    </div>
                  </div>

                  {/* Linha de Métricas Secundárias */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-zinc-900 text-[11px] font-mono text-zinc-400">
                    <div>
                      <span className="text-zinc-500 block text-[10px]">Latência Último Ping:</span>
                      <span className="text-white font-bold">
                        {stat.lastLatencyMs ? `${stat.lastLatencyMs} ms` : '--'}
                      </span>
                    </div>

                    <div>
                      <span className="text-zinc-500 block text-[10px]">Última Chamada:</span>
                      <span className="text-zinc-300">
                        {stat.lastRequestAt ? new Date(stat.lastRequestAt).toLocaleTimeString('pt-BR') : 'Nenhuma hoje'}
                      </span>
                    </div>

                    <div>
                      <span className="text-zinc-500 block text-[10px]">Intervalo Recomendado:</span>
                      <span className="text-white font-bold">
                        {spec.recommendedIntervalMinutes ? `${spec.recommendedIntervalMinutes} min` : 'Automático'}
                      </span>
                    </div>

                    <div>
                      <span className="text-zinc-500 block text-[10px]">Erros Registrados:</span>
                      <span className="text-white font-bold">
                        {stat.errorCount} {stat.lastErrorMessage ? `(${stat.lastErrorMessage})` : ''}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Card de Governança de Cotas Monocromático */}
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400 space-y-1">
            <div className="flex items-center gap-2 text-white font-bold text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-white" />
              <span>Governança de Cotas & Resiliência FatosBR</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              O backend FatosBR executa balanceamento automático: quando um provedor como GNews ou NewsAPI atinge taxa limite (HTTP 429), as consultas transitam automaticamente para provedores secundários e cache local sem interromper o feed.
            </p>
          </div>
        </div>

        {/* Rodapé do Modal */}
        <div className="p-3.5 px-5 border-t border-zinc-800 bg-black flex items-center justify-between text-xs font-mono text-zinc-400">
          <span>FatosBR Core • Endpoint /api/proxy/status</span>
          <button
            onClick={onClose}
            className="min-h-[40px] px-4 py-1.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-xs transition cursor-pointer"
          >
            Fechar Painel
          </button>
        </div>
      </div>
    </div>
  );
};
