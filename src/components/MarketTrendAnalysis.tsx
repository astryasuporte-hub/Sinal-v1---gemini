/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import {
  TrendingUp,
  Activity,
  Layers,
  Sparkles,
  Calendar,
  Building2,
  ChevronRight,
  Info
} from 'lucide-react';
import { Entity, Event } from '../types/sinal';
import { INITIAL_ENTITIES } from '../data/mockData';

interface TrendDataPoint {
  date: string;
  dayFormatted: string;
  relevance: number;
  volume: number;
  headline: string;
  category: string;
}

interface MarketTrendAnalysisProps {
  entities?: Entity[];
  events?: Event[];
  initialEntityId?: string;
  onOpenEntityModal?: (entity: Entity) => void;
  title?: string;
  description?: string;
  isCompact?: boolean;
}

export const MarketTrendAnalysis: React.FC<MarketTrendAnalysisProps> = ({
  entities = INITIAL_ENTITIES,
  events = [],
  initialEntityId,
  onOpenEntityModal,
  title = 'Análise de Tendências de Mercado',
  description = 'Evolução da relevância e volume dos tópicos nos últimos 30 dias para entidades acompanhadas',
  isCompact = false
}) => {
  const [selectedEntityId, setSelectedEntityId] = useState<string>(
    initialEntityId || entities[0]?.id || 'ent-nvidia'
  );
  const [timeRange, setTimeRange] = useState<'7d' | '14d' | '30d'>('30d');

  const selectedEntity = useMemo(() => {
    return entities.find((e) => e.id === selectedEntityId) || entities[0];
  }, [entities, selectedEntityId]);

  // Gerador determinístico de histórico de 30 dias para a entidade selecionada
  const trendData = useMemo(() => {
    const days = timeRange === '7d' ? 7 : timeRange === '14d' ? 14 : 30;
    const result: TrendDataPoint[] = [];
    const now = new Date();

    // Semente baseada no ID da entidade para manter consistência
    const seed = (selectedEntity?.id || 'entity').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const baseRelevance = 70 + (seed % 18); // 70 a 88 base

    const entityName = selectedEntity?.name || 'Mercado';

    const sampleHeadlines = [
      `Avanço estratégico em semicondutores e parcerias globais de ${entityName}`,
      `Novo relatório setorial destaca impacto de mercado e receita de ${entityName}`,
      `Reunião com autoridades e alinhamento sobre regulação e infraestrutura`,
      `Expansão de investimentos produtivos em tecnologia de ponta`,
      `Consolidação de novos contratos corporativos e balanço operacional`,
      `Aceleração de pesquisa e desenvolvimento em modelos de fronteira`
    ];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);

      // Oscilação suave com picos nos dias 4, 12, 19, 26
      const wave = Math.sin((i + (seed % 7)) * 0.45) * 12;
      const noise = (((i * 17 + seed) % 11) - 5);
      const spike = (i % 6 === 0) ? 9 : 0;
      
      const rawScore = Math.round(baseRelevance + wave + noise + spike);
      const relevance = Math.max(45, Math.min(99, rawScore));
      const volume = Math.max(1, Math.round((relevance - 50) / 4) + ((i + seed) % 3));

      const dayFormatted = d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short'
      }).replace('.', '');

      const fullDate = d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      const headlineIndex = (i + seed) % sampleHeadlines.length;

      result.push({
        date: fullDate,
        dayFormatted,
        relevance,
        volume,
        headline: sampleHeadlines[headlineIndex],
        category: selectedEntity?.sector || 'Geral'
      });
    }

    return result;
  }, [selectedEntity, timeRange]);

  // Métricas calculadas
  const metrics = useMemo(() => {
    if (trendData.length === 0) {
      return { peak: 0, average: 0, momentum: '+0.0%', totalMentions: 0 };
    }
    const scores = trendData.map((d) => d.relevance);
    const peak = Math.max(...scores);
    const sum = scores.reduce((a, b) => a + b, 0);
    const average = (sum / scores.length).toFixed(1);

    const half = Math.floor(scores.length / 2);
    const firstHalfAvg = scores.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondHalfAvg = scores.slice(half).reduce((a, b) => a + b, 0) / (scores.length - half);
    const diff = secondHalfAvg - firstHalfAvg;
    const percentChange = ((diff / firstHalfAvg) * 100).toFixed(1);
    const momentum = diff >= 0 ? `+${percentChange}%` : `${percentChange}%`;

    const totalMentions = trendData.reduce((acc, curr) => acc + curr.volume, 0);

    return { peak, average, momentum, totalMentions };
  }, [trendData]);

  // Tooltip customizado monocromático de alto contraste
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: TrendDataPoint = payload[0].payload;
      return (
        <div className="bg-black border border-white/20 rounded-xl p-3 shadow-2xl text-xs space-y-1.5 max-w-xs backdrop-blur-md">
          <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono border-b border-zinc-800 pb-1">
            <span>{data.date}</span>
            <span className="text-white font-semibold">{data.category}</span>
          </div>

          <div className="flex items-baseline justify-between gap-3 pt-0.5">
            <span className="text-zinc-300 font-medium">Relevância:</span>
            <span className="text-base font-extrabold text-white font-mono tabular-nums">
              {data.relevance}
              <span className="text-[10px] text-zinc-400 font-normal"> / 100</span>
            </span>
          </div>

          <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-white h-full rounded-full transition-all duration-300"
              style={{ width: `${data.relevance}%` }}
            />
          </div>

          <p className="text-[11px] text-zinc-300 leading-snug pt-1 italic line-clamp-2">
            "{data.headline}"
          </p>

          <div className="text-[10px] text-zinc-400 font-mono flex items-center justify-between pt-0.5 border-t border-zinc-900">
            <span>Fatos apurados:</span>
            <span className="text-white font-bold">{data.volume} ocorrências</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full rounded-2xl bg-black border border-zinc-800 text-white p-4 sm:p-6 space-y-5">
      {/* 1. Header do Módulo com Identidade Monocromática */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-700 flex items-center justify-center text-white">
              <TrendingUp className="w-4 h-4" />
            </div>
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
              {title}
            </h2>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-300">
              30 Dias
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            {description}
          </p>
        </div>

        {/* Seletor de Intervalo de Tempo */}
        <div className="flex items-center gap-1 self-start sm:self-auto bg-zinc-950 p-1 rounded-xl border border-zinc-800">
          {(['7d', '14d', '30d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer ${
                timeRange === range
                  ? 'bg-white text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {range.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Seletor de Entidades (Chips Horizontais Touch-Friendly >= 44px) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span className="font-semibold uppercase tracking-wider text-[10px] font-mono">
            Selecione a Entidade para Análise
          </span>
          {onOpenEntityModal && selectedEntity && (
            <button
              onClick={() => onOpenEntityModal(selectedEntity)}
              className="text-[11px] text-zinc-300 hover:text-white flex items-center gap-1 transition cursor-pointer"
            >
              <span>Ver detalhes completos</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
          {entities.slice(0, 10).map((ent) => {
            const isSelected = ent.id === selectedEntityId;
            return (
              <button
                key={ent.id}
                onClick={() => setSelectedEntityId(ent.id)}
                className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition cursor-pointer flex items-center gap-2 border shrink-0 ${
                  isSelected
                    ? 'bg-white text-black border-white shadow-md font-bold'
                    : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:text-white active:bg-zinc-900'
                }`}
              >
                <Building2 className={`w-3.5 h-3.5 ${isSelected ? 'text-black' : 'text-zinc-400'}`} />
                <span>{ent.name}</span>
                {ent.sector && (
                  <span className={`text-[10px] font-mono ${isSelected ? 'text-zinc-600' : 'text-zinc-500'}`}>
                    · {ent.sector}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Cards de Resumo Estatístico (Monocromático de Alto Contraste) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono">
            <span>Pico Relevância</span>
            <Sparkles className="w-3.5 h-3.5 text-zinc-300" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white tabular-nums">
            {metrics.peak}
            <span className="text-xs text-zinc-400 font-normal"> / 100</span>
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            Ponto mais alto do período
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono">
            <span>Média do Período</span>
            <Activity className="w-3.5 h-3.5 text-zinc-300" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white tabular-nums">
            {metrics.average}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            Relevância média consolidada
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono">
            <span>Momento</span>
            <TrendingUp className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white tabular-nums">
            {metrics.momentum}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            Variação recente da curva
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
          <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono">
            <span>Fatos Cobertos</span>
            <Layers className="w-3.5 h-3.5 text-zinc-300" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-white tabular-nums">
            {metrics.totalMentions}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            Matérias convergidas
          </div>
        </div>
      </div>

      {/* 4. Gráfico de Área Responsivo com Recharts (P&B Suave) */}
      <div className="p-4 sm:p-5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
        <div className="flex items-center justify-between text-xs pb-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white tracking-tight">
              {selectedEntity?.name || 'Entidade'} — Curva de Relevância
            </span>
            <span className="text-[11px] text-zinc-400 hidden sm:inline">
              (0 = Baixo ruído, 100 = Alta relevância institucional)
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-white"></span>
            <span>Relevância</span>
          </div>
        </div>

        <div className="w-full h-64 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="marketTrendMonochromeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffffff" stopOpacity={0.45} />
                  <stop offset="60%" stopColor="#ffffff" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#ffffff" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                stroke="rgba(255, 255, 255, 0.08)"
                strokeDasharray="3 3"
                vertical={false}
              />

              <XAxis
                dataKey="dayFormatted"
                stroke="#71717a"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                tick={{ fill: '#a1a1aa' }}
                dy={6}
              />

              <YAxis
                domain={[30, 100]}
                stroke="#71717a"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                tick={{ fill: '#a1a1aa' }}
                dx={-4}
              />

              <Tooltip content={<CustomTooltip />} />

              <Area
                type="monotone"
                dataKey="relevance"
                stroke="#ffffff"
                strokeWidth={2.2}
                fillOpacity={1}
                fill="url(#marketTrendMonochromeGrad)"
                activeDot={{ r: 5, fill: '#000000', stroke: '#ffffff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="pt-2 flex items-center justify-between text-[11px] text-zinc-400 font-mono border-t border-zinc-900">
          <span>Fonte: Motor de Ingestão FatosBR</span>
          <span>Atualizado a cada 15m</span>
        </div>
      </div>
    </div>
  );
};
