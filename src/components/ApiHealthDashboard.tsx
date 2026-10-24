/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  Zap,
  TrendingUp,
  AlertCircle,
  Clock,
  RotateCw,
  Radio,
  CheckCircle2,
  Server,
  Layers,
  BarChart3,
  Flame,
  ArrowUpRight,
  ShieldCheck,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  Legend
} from 'recharts';
import { newsIngestionService, ProviderTelemetry, ProviderStat } from '../services/newsIngestionService';
import { StatusColor } from './AdminPanel';

interface ApiHealthDashboardProps {
  onBackToOverview?: () => void;
  renderStatusBadge: (status: StatusColor, customText?: string) => React.ReactNode;
}

interface HistoricalDataPoint {
  time: string;
  gnewsLatency: number;
  newsapiLatency: number;
  worldnewsLatency: number;
  nvidiaLatency: number;
}

export const ApiHealthDashboard: React.FC<ApiHealthDashboardProps> = ({
  renderStatusBadge
}) => {
  const [telemetry, setTelemetry] = useState<ProviderTelemetry | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState(5);
  const [countdown, setCountdown] = useState(5);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>(new Date().toLocaleTimeString('pt-BR'));
  const [latencyHistory, setLatencyHistory] = useState<HistoricalDataPoint[]>([]);

  // Carrega status em tempo real do proxy backend (/api/proxy/status)
  const fetchHealthData = async () => {
    setIsLoading(true);
    const data = await newsIngestionService.fetchTelemetry();
    if (data) {
      setTelemetry(data);
      setLastRefreshedAt(new Date().toLocaleTimeString('pt-BR'));

      // Adiciona ponto histórico para o gráfico de linha de latência temporal
      const nowStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLatencyHistory((prev) => {
        const newPoint: HistoricalDataPoint = {
          time: nowStr,
          gnewsLatency: data.stats.gnews?.lastLatencyMs || 0,
          newsapiLatency: data.stats.newsapi?.lastLatencyMs || 0,
          worldnewsLatency: data.stats.worldnews?.lastLatencyMs || 0,
          nvidiaLatency: data.stats.nvidia?.lastLatencyMs || 0
        };
        const updated = [...prev, newPoint];
        // Mantém os últimos 10 pontos para clareza visual
        return updated.slice(-10);
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchHealthData();
  }, []);

  // Intervalo 24/7 com countdown
  useEffect(() => {
    if (!autoRefresh) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchHealthData();
          return refreshIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoRefresh, refreshIntervalSec]);

  // Provedores monitorados
  const providersList = useMemo(() => {
    const pKeys: Array<'gnews' | 'newsapi' | 'worldnews' | 'nvidia'> = ['gnews', 'newsapi', 'worldnews', 'nvidia'];
    return pKeys.map((key) => {
      const spec = telemetry?.specs[key];
      const stat: ProviderStat = telemetry?.stats[key] || {
        requestsToday: 0,
        requestsThisMonth: 0,
        lastRequestAt: null,
        lastStatusCode: 200,
        lastLatencyMs: 0,
        errorCount: 0,
        lastErrorMessage: null,
        quotaLeft: spec?.dailyQuota || 0
      };

      const totalReq = Math.max(stat.requestsToday, 1);
      const errorRatePercent = stat.requestsToday > 0 
        ? ((stat.errorCount / stat.requestsToday) * 100) 
        : 0;

      let statusColor: StatusColor = 'connected';
      if (stat.lastStatusCode >= 400 || stat.errorCount > 0) {
        statusColor = 'error';
      }

      return {
        id: key,
        name: spec?.name || key.toUpperCase(),
        endpoint: spec?.endpointMasked || `/api/proxy/${key}`,
        dailyQuota: spec?.dailyQuota || 100,
        quotaLeft: stat.quotaLeft,
        requestsToday: stat.requestsToday,
        requestsMonth: stat.requestsThisMonth,
        errorCount: stat.errorCount,
        errorRatePercent,
        latencyMs: stat.lastLatencyMs || 0,
        statusCode: stat.lastStatusCode || 200,
        lastRequest: stat.lastRequestAt,
        status: statusColor,
        statusLabel: statusColor === 'connected' ? 'Operacional' : 'Instável / Erro'
      };
    });
  }, [telemetry]);

  // Dados para o Gráfico de Barras: Latência por Provedor
  const latencyChartData = useMemo(() => {
    return providersList.map((p) => ({
      name: p.id === 'worldnews' ? 'World News' : p.id === 'newsapi' ? 'NewsAPI' : p.id === 'gnews' ? 'GNews' : 'NVIDIA NIM',
      latency: p.latencyMs,
      statusCode: p.statusCode,
      fill: p.id === 'nvidia' ? '#8b5cf6' : p.id === 'gnews' ? '#10b981' : p.id === 'newsapi' ? '#3b82f6' : '#ec4899'
    }));
  }, [providersList]);

  // Dados para o Gráfico de Barras: Volume de Requisições
  const volumeChartData = useMemo(() => {
    return providersList.map((p) => ({
      name: p.id === 'worldnews' ? 'World News' : p.id === 'newsapi' ? 'NewsAPI' : p.id === 'gnews' ? 'GNews' : 'NVIDIA NIM',
      hoje: p.requestsToday,
      restante: p.quotaLeft,
      mes: p.requestsMonth
    }));
  }, [providersList]);

  // Dados para o Gráfico de Taxa de Erro (%)
  const errorRateChartData = useMemo(() => {
    return providersList.map((p) => ({
      name: p.id === 'worldnews' ? 'World News' : p.id === 'newsapi' ? 'NewsAPI' : p.id === 'gnews' ? 'GNews' : 'NVIDIA NIM',
      errorRate: Number(p.errorRatePercent.toFixed(1)),
      errorCount: p.errorCount,
      successCount: Math.max(0, p.requestsToday - p.errorCount)
    }));
  }, [providersList]);

  // Cálculos agregados globais
  const globalMetrics = useMemo(() => {
    const totalRequestsToday = providersList.reduce((acc, curr) => acc + curr.requestsToday, 0);
    const totalErrors = providersList.reduce((acc, curr) => acc + curr.errorCount, 0);
    const avgLatency = Math.round(
      providersList.reduce((acc, curr) => acc + curr.latencyMs, 0) / (providersList.length || 1)
    );
    const overallSuccessRate = totalRequestsToday > 0 
      ? (((totalRequestsToday - totalErrors) / totalRequestsToday) * 100).toFixed(1)
      : '100.0';

    return {
      totalRequestsToday,
      totalErrors,
      avgLatency,
      overallSuccessRate
    };
  }, [providersList]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 1. CABEÇALHO DO PAINEL DE SAÚDE DA API */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Activity className="w-4 h-4" />
              </div>
              <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Painel de Saúde da API (API Health Dashboard)
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Tempo Real • providerStats</span>
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Visualização analítica de latência, volume de requisições e taxa de erro em tempo real para cada provedor de notícias e IA.
            </p>
          </div>

          {/* Controles de Atualização em Tempo Real */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                autoRefresh
                  ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                  : 'bg-[#141b2c] border-[#1e2840] text-zinc-400 hover:text-white'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse text-emerald-400' : ''}`} />
              <span>{autoRefresh ? `Auto-Refresh (${countdown}s)` : 'Pausado'}</span>
            </button>

            <button
              onClick={fetchHealthData}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-xl bg-[#141b2c] hover:bg-[#1a253d] border border-[#1e2840] text-zinc-300 hover:text-white text-xs font-medium transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
              <span>Atualizar Agora</span>
            </button>
          </div>
        </div>

        {/* 4 CARDS DE MÉTRICAS GLOBAIS DE SAÚDE */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5 font-mono">
          {/* Card 1: Taxa de Sucesso Global */}
          <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#182136] space-y-1">
            <div className="flex items-center justify-between text-zinc-500 text-[10px]">
              <span>TAXA DE SUCESSO</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-lg sm:text-xl font-bold text-emerald-400">
              {globalMetrics.overallSuccessRate}%
            </div>
            <div className="text-[10px] text-zinc-400 truncate">
              {globalMetrics.totalErrors === 0 ? 'Zero falhas registradas' : `${globalMetrics.totalErrors} erros de requisição`}
            </div>
          </div>

          {/* Card 2: Latência Média de Resposta */}
          <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#182136] space-y-1">
            <div className="flex items-center justify-between text-zinc-500 text-[10px]">
              <span>LATÊNCIA MÉDIA</span>
              <Clock className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="text-lg sm:text-xl font-bold text-white">
              {globalMetrics.avgLatency} ms
            </div>
            <div className="text-[10px] text-zinc-400 truncate">
              Tempo de resposta médio
            </div>
          </div>

          {/* Card 3: Volume Diário de Chamadas */}
          <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#182136] space-y-1">
            <div className="flex items-center justify-between text-zinc-500 text-[10px]">
              <span>VOLUME HOJE</span>
              <BarChart3 className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <div className="text-lg sm:text-xl font-bold text-purple-300">
              {globalMetrics.totalRequestsToday} req
            </div>
            <div className="text-[10px] text-zinc-400 truncate">
              Somatório multi-provedor
            </div>
          </div>

          {/* Card 4: Status do Monitor */}
          <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#182136] space-y-1">
            <div className="flex items-center justify-between text-zinc-500 text-[10px]">
              <span>ÚLTIMA SINCRONIA</span>
              <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-base sm:text-lg font-bold text-zinc-200">
              {lastRefreshedAt}
            </div>
            <div className="text-[10px] text-zinc-500 truncate">
              Proxy backend ativo
            </div>
          </div>
        </div>
      </div>

      {/* 2. GRÁFICOS VISUAIS DE TELEMETRIA (RECHARTS) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        
        {/* GRÁFICO 1: LATÊNCIA POR PROVEDOR (BAR CHART) */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-3">
          <div className="flex items-center justify-between border-b border-[#182136] pb-2.5">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400" />
                <span>Latência por Provedor (ms)</span>
              </h3>
              <p className="text-[10px] text-zinc-400">Tempo de ida e volta da requisição</p>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">Menor é melhor</span>
          </div>

          <div className="w-full h-52 sm:h-60 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latencyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#52525b" fontSize={11} tickLine={false} axisLine={{ stroke: '#27272a' }} />
                <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={{ stroke: '#27272a' }} tickFormatter={(val) => `${val}ms`} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-[#232d42] shadow-xl text-xs font-mono space-y-1">
                          <div className="font-bold text-white">{data.name}</div>
                          <div className="text-emerald-400 text-sm font-extrabold">{data.latency} ms</div>
                          <div className="text-[10px] text-zinc-400">Código HTTP: {data.statusCode} OK</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="latency" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {latencyChartData.map((entry, index) => (
                    <Cell key={`latency-cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* GRÁFICO 2: VOLUME DE REQUISIÇÕES (HOJE vs COTA DISPONÍVEL) */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-3">
          <div className="flex items-center justify-between border-b border-[#182136] pb-2.5">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-400" />
                <span>Volume de Solicitações (Requisições Hoje)</span>
              </h3>
              <p className="text-[10px] text-zinc-400">Consumo em relação à cota permitida</p>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">Diário</span>
          </div>

          <div className="w-full h-52 sm:h-60 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#52525b" fontSize={11} tickLine={false} axisLine={{ stroke: '#27272a' }} />
                <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={{ stroke: '#27272a' }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-[#232d42] shadow-xl text-xs font-mono space-y-1">
                          <div className="font-bold text-white">{data.name}</div>
                          <div className="text-purple-300">Efetuadas hoje: <strong className="text-white">{data.hoje} req</strong></div>
                          <div className="text-zinc-400 text-[10px]">Cota restante: {data.restante} req</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="hoje" fill="#a855f7" radius={[6, 6, 0, 0]} maxBarSize={44} name="Requisições Hoje" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* GRÁFICO 3: HISTÓRICO DE LATÊNCIA NO TEMPO (LINE CHART) */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-3">
          <div className="flex items-center justify-between border-b border-[#182136] pb-2.5">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-400" />
                <span>Histórico Temporal de Latência (Últimas Leituras)</span>
              </h3>
              <p className="text-[10px] text-zinc-400">Estabilidade temporal do tempo de resposta</p>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">Live Stream</span>
          </div>

          <div className="w-full h-52 sm:h-60 pt-2 flex items-center justify-center">
            {latencyHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={latencyHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
                  <XAxis dataKey="time" stroke="#52525b" fontSize={9} tickLine={false} />
                  <YAxis stroke="#52525b" fontSize={9} tickLine={false} tickFormatter={(val) => `${val}ms`} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-[#232d42] shadow-xl text-xs font-mono space-y-1">
                            <div className="font-bold text-white mb-1">{payload[0]?.payload.time}</div>
                            <div className="text-emerald-400 text-[11px]">GNews: {payload[0]?.payload.gnewsLatency}ms</div>
                            <div className="text-blue-400 text-[11px]">NewsAPI: {payload[0]?.payload.newsapiLatency}ms</div>
                            <div className="text-pink-400 text-[11px]">World News: {payload[0]?.payload.worldnewsLatency}ms</div>
                            <div className="text-purple-400 text-[11px]">NVIDIA: {payload[0]?.payload.nvidiaLatency}ms</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Line type="monotone" dataKey="gnewsLatency" stroke="#10b981" strokeWidth={2} dot={false} name="GNews" />
                  <Line type="monotone" dataKey="newsapiLatency" stroke="#3b82f6" strokeWidth={2} dot={false} name="NewsAPI" />
                  <Line type="monotone" dataKey="worldnewsLatency" stroke="#ec4899" strokeWidth={2} dot={false} name="World News" />
                  <Line type="monotone" dataKey="nvidiaLatency" stroke="#8b5cf6" strokeWidth={2} dot={false} name="NVIDIA" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center p-6 text-zinc-500 font-mono text-xs space-y-1.5">
                <Activity className="w-5 h-5 text-zinc-600 mx-auto animate-pulse" />
                <div>Aguardando telemetria em tempo real...</div>
                <div className="text-[10px] text-zinc-600">As métricas de latência serão plotadas conforme os provedores forem consultados.</div>
              </div>
            )}
          </div>
        </div>

        {/* GRÁFICO 4: TAXA DE ERRO (%) POR PROVEDOR */}
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-3">
          <div className="flex items-center justify-between border-b border-[#182136] pb-2.5">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span>Taxa de Erro por Provedor (%)</span>
              </h3>
              <p className="text-[10px] text-zinc-400">Porcentagem de requisições que falharam</p>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">Target: 0.0%</span>
          </div>

          <div className="w-full h-52 sm:h-60 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={errorRateChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#52525b" fontSize={11} tickLine={false} axisLine={{ stroke: '#27272a' }} />
                <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={{ stroke: '#27272a' }} domain={[0, 100]} tickFormatter={(val) => `${val}%`} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-[#232d42] shadow-xl text-xs font-mono space-y-1">
                          <div className="font-bold text-white">{data.name}</div>
                          <div className="text-red-400 font-bold text-sm">{data.errorRate}% taxa de erro</div>
                          <div className="text-zinc-400 text-[10px]">Falhas: {data.errorCount} | Sucessos: {data.successCount}</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="errorRate" fill="#ef4444" radius={[6, 6, 0, 0]} maxBarSize={44} name="Taxa de Erro (%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* 3. TABELA DETALHADA DE AUDITORIA POR PROVEDOR (TELEMETRIA AO VIVO) */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[#182136]">
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-white">
              Tabela de Diagnóstico em Tempo Real
            </h3>
            <p className="text-[10px] sm:text-[11px] text-zinc-400">
              Métricas extraídas diretamente do estado de memória do servidor (`providerStats`).
            </p>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            HTTP 200 OK
          </span>
        </div>

        {/* Tabela Responsiva */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#182136] text-[10px] sm:text-[11px] text-zinc-400 uppercase font-mono tracking-wider">
                <th className="pb-3 pl-2">Provedor</th>
                <th className="pb-3">Endpoint Protegido</th>
                <th className="pb-3">Latência</th>
                <th className="pb-3">Volume Diário</th>
                <th className="pb-3">Cota Restante</th>
                <th className="pb-3">Taxa de Erro</th>
                <th className="pb-3 text-right pr-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#151d2e] font-mono">
              {providersList.map((prov) => (
                <tr key={prov.id} className="hover:bg-[#12192b]/40 transition text-[11px]">
                  <td className="py-3 pl-2 font-sans font-bold text-white">
                    {prov.name}
                  </td>
                  <td className="py-3 text-zinc-400">
                    <span className="bg-[#090c12] px-2 py-0.5 rounded border border-[#1a2337] text-zinc-300 text-[10px]">
                      {prov.endpoint}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className="text-emerald-400 font-bold">{prov.latencyMs} ms</span>
                  </td>
                  <td className="py-3 text-zinc-200">
                    {prov.requestsToday} req
                  </td>
                  <td className="py-3 text-zinc-400">
                    {prov.quotaLeft} req
                  </td>
                  <td className="py-3">
                    <span className={prov.errorCount > 0 ? 'text-red-400 font-bold' : 'text-zinc-500'}>
                      {prov.errorRatePercent.toFixed(1)}% ({prov.errorCount})
                    </span>
                  </td>
                  <td className="py-3 text-right pr-2">
                    {renderStatusBadge(prov.status, prov.statusLabel)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
