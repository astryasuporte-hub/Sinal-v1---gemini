/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import {
  CreditCard,
  TrendingUp,
  ShieldCheck,
  Calendar,
  Sparkles,
  Info,
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import { UserSubscription } from '../types/sinal';

interface FinancialDashboardProps {
  subscription: UserSubscription;
  isAdmin?: boolean;
  userEmail?: string;
  onOpenBilling?: () => void;
}

interface MonthlyExpense {
  month: string;
  amount: number;
  label: string;
  status: 'paid' | 'trial' | 'exempt' | 'projected';
  annotation: string;
}

export const FinancialDashboard: React.FC<FinancialDashboardProps> = ({
  subscription,
  isAdmin = false,
  userEmail = 'astryasuporte@gmail.com',
  onOpenBilling
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  // Regras de negócio estritas:
  // 1. Se for admin (astryasuporte@gmail.com ou isAdmin=true) -> Não conta assinatura, valor R$ 0,00 (Isento Cortesia)
  // 2. Se a pessoa tiver assinatura em trial -> Não cobra no mês, exibe "- Trial" e R$ 0,00
  // 3. Usuário pagante padrão -> R$ 119,00 / mês (Sinal Executive)
  const isSuperAdmin =
    isAdmin || userEmail.toLowerCase() === 'astryasuporte@gmail.com';

  const isTrial =
    !isSuperAdmin &&
    (subscription.planName === 'TRIAL_7D' ||
      subscription.planName === 'TRIAL' ||
      subscription.status === 'TRIAL_ACTIVE' ||
      subscription.trialDaysLeft > 0);

  const baseAmount = subscription.amount || 119.0;
  const baseLabel = `R$ ${baseAmount.toFixed(2).replace('.', ',')}`;

  // Histórico dos últimos 6 meses com base nas regras de negócio
  const monthlyData: MonthlyExpense[] = [
    {
      month: 'Nov/25',
      amount: isSuperAdmin || isTrial ? 0 : baseAmount,
      label: isSuperAdmin ? 'Isento' : isTrial ? '- Trial' : baseLabel,
      status: isSuperAdmin ? 'exempt' : isTrial ? 'trial' : 'paid',
      annotation: isSuperAdmin
        ? 'Super Admin (Sem cobrança)'
        : isTrial
        ? 'Período Teste Gratuito'
        : 'Mensalidade Sinal Executive'
    },
    {
      month: 'Dez/25',
      amount: isSuperAdmin || isTrial ? 0 : baseAmount,
      label: isSuperAdmin ? 'Isento' : isTrial ? '- Trial' : baseLabel,
      status: isSuperAdmin ? 'exempt' : isTrial ? 'trial' : 'paid',
      annotation: isSuperAdmin
        ? 'Super Admin (Sem cobrança)'
        : isTrial
        ? 'Período Teste Gratuito'
        : 'Mensalidade Sinal Executive'
    },
    {
      month: 'Jan/26',
      amount: isSuperAdmin || isTrial ? 0 : baseAmount,
      label: isSuperAdmin ? 'Isento' : isTrial ? '- Trial' : baseLabel,
      status: isSuperAdmin ? 'exempt' : isTrial ? 'trial' : 'paid',
      annotation: isSuperAdmin
        ? 'Super Admin (Sem cobrança)'
        : isTrial
        ? 'Período Teste Gratuito'
        : 'Mensalidade Sinal Executive'
    },
    {
      month: 'Fev/26',
      amount: isSuperAdmin || isTrial ? 0 : baseAmount,
      label: isSuperAdmin ? 'Isento' : isTrial ? '- Trial' : baseLabel,
      status: isSuperAdmin ? 'exempt' : isTrial ? 'trial' : 'paid',
      annotation: isSuperAdmin
        ? 'Super Admin (Sem cobrança)'
        : isTrial
        ? 'Período Teste Gratuito'
        : 'Mensalidade Sinal Executive'
    },
    {
      month: 'Mar/26',
      amount: isSuperAdmin || isTrial ? 0 : baseAmount,
      label: isSuperAdmin ? 'Isento' : isTrial ? '- Trial' : baseLabel,
      status: isSuperAdmin ? 'exempt' : isTrial ? 'trial' : 'paid',
      annotation: isSuperAdmin
        ? 'Super Admin (Sem cobrança)'
        : isTrial
        ? 'Período Teste Gratuito'
        : 'Mensalidade Sinal Executive'
    },
    {
      month: 'Abr/26 (Atual)',
      amount: isSuperAdmin || isTrial ? 0 : baseAmount,
      label: isSuperAdmin ? 'Isento' : isTrial ? '- Trial' : baseLabel,
      status: isSuperAdmin ? 'exempt' : isTrial ? 'trial' : 'paid',
      annotation: isSuperAdmin
        ? 'Super Admin (Sem cobrança)'
        : isTrial
        ? 'Período Teste Gratuito'
        : 'Mensalidade Sinal Executive'
    }
  ];

  // Cálculo total de gastos acumulados
  const totalSpent = monthlyData.reduce((acc, curr) => acc + curr.amount, 0);

  // Custom tooltip para o Recharts
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as MonthlyExpense;
      return (
        <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-[#232d42] shadow-xl text-xs font-mono space-y-1">
          <div className="font-bold text-white flex items-center justify-between gap-3">
            <span>{data.month}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] ${
                data.status === 'exempt'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : data.status === 'trial'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              }`}
            >
              {data.status === 'exempt'
                ? 'Admin'
                : data.status === 'trial'
                ? '- 7D'
                : 'Faturado'}
            </span>
          </div>
          <div className="text-zinc-300 text-sm font-extrabold">{data.label}</div>
          <div className="text-[10px] text-zinc-400">{data.annotation}</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-4 sm:p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
      {/* Cabeçalho do Dashboard */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Dashboard Financeiro</span>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
                PIX Instantâneo
              </span>
            </h3>
            <p className="text-[11px] text-zinc-400">
              Histórico de gastos mensais e status da sua assinatura FatosBR.
            </p>
          </div>
        </div>

        {onOpenBilling && (
          <button
            onClick={onOpenBilling}
            className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-white font-medium transition cursor-pointer flex items-center gap-1.5"
          >
            <span>Gerenciar Plano</span>
            <ExternalLink className="w-3 h-3 text-zinc-400" />
          </button>
        )}
      </div>

      {/* Grid de Métricas Financeiras */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Card 1: Assinatura Atual */}
        <div className="p-3.5 rounded-xl bg-[#16181f] border border-zinc-800/80 space-y-1.5">
          <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono uppercase">
            <span>Assinatura Atual</span>
            <Sparkles className="w-3 h-3 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2">
            {isSuperAdmin ? (
              <span className="text-base sm:text-lg font-bold text-amber-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Super Admin</span>
              </span>
            ) : isTrial ? (
              <span className="text-base sm:text-lg font-extrabold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                - 7D
              </span>
            ) : (
              <span className="text-base sm:text-lg font-bold text-white font-mono">
                Plano Pro
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-400">
            {isSuperAdmin
              ? 'Conta administrativa isenta de cobrança'
              : isTrial
              ? 'Período gratuito de 7 dias ativo'
              : 'Cobrança mensal de R$ 29,90'}
          </div>
        </div>

        {/* Card 2: Valor Mensal Faturável */}
        <div className="p-3.5 rounded-xl bg-[#16181f] border border-zinc-800/80 space-y-1.5">
          <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono uppercase">
            <span>Mensalidade Efetiva</span>
            <CreditCard className="w-3 h-3 text-purple-400" />
          </div>
          <div className="flex items-baseline gap-2 font-mono">
            {isSuperAdmin ? (
              <span className="text-base sm:text-lg font-bold text-zinc-400">
                - <span className="text-xs font-normal text-zinc-500">(Admin Cortesia)</span>
              </span>
            ) : isTrial ? (
              <span className="text-base sm:text-lg font-bold text-emerald-400">
                - 7D <span className="text-xs font-normal text-zinc-500">(Sem os 29,90)</span>
              </span>
            ) : (
              <span className="text-base sm:text-lg font-bold text-white">
                R$ 29,90 <span className="text-xs font-normal text-zinc-400">/ mês</span>
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-400">
            {isSuperAdmin
              ? 'Admin não entra no faturamento'
              : isTrial
              ? 'Não conta os 29,90 do mês durante o teste'
              : 'Renovação automática via PIX'}
          </div>
        </div>

        {/* Card 3: Total Acumulado */}
        <div className="p-3.5 rounded-xl bg-[#16181f] border border-zinc-800/80 space-y-1.5">
          <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono uppercase">
            <span>Gasto Acumulado (6 Meses)</span>
            <Calendar className="w-3 h-3 text-blue-400" />
          </div>
          <div className="text-base sm:text-lg font-bold text-white font-mono">
            R$ {totalSpent.toFixed(2).replace('.', ',')}
          </div>
          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>FatosBR Pay (PIX) sincronizado</span>
          </div>
        </div>
      </div>

      {/* Gráfico de Barras com Recharts */}
      <div className="p-3.5 sm:p-4 rounded-xl bg-[#0c0e14] border border-[#1a202c] space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-white flex items-center gap-2">
            <span>Evolução Mensal de Custos</span>
            <span className="text-[10px] text-zinc-500 font-mono font-normal">
              (Novembro/25 - Abril/26)
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400"></span>
              <span className="text-zinc-400">
                {isSuperAdmin ? 'Admin (Isento)' : isTrial ? 'Teste - 7D' : 'Pago R$ 29,90'}
              </span>
            </div>
          </div>
        </div>

        {/* Contêiner Responsivo do Gráfico */}
        <div className="w-full h-48 sm:h-56 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={monthlyData}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              onClick={(e: any) => {
                if (e && e.activePayload && e.activePayload.length) {
                  setSelectedMonth(e.activePayload[0].payload.month);
                }
              }}
            >
              <XAxis
                dataKey="month"
                stroke="#52525b"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: '#27272a' }}
              />
              <YAxis
                stroke="#52525b"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: '#27272a' }}
                domain={[0, 35]}
                ticks={[0, 10, 20, 30]}
                tickFormatter={(value) => `R$ ${value}`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="amount"
                radius={[6, 6, 0, 0]}
                maxBarSize={44}
              >
                {monthlyData.map((entry, index) => {
                  let fillColor = '#10b981'; // emerald-500
                  if (entry.status === 'exempt') fillColor = '#f59e0b'; // amber-500
                  if (entry.status === 'trial') fillColor = '#10b981'; // emerald-500
                  if (selectedMonth === entry.month) fillColor = '#60a5fa'; // highlight
                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={fillColor}
                      opacity={entry.amount === 0 ? 0.35 : 0.9}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Nota explicativa de regra de negócio */}
        <div className="p-2.5 rounded-lg bg-[#141824] border border-[#1e2538] text-[11px] text-zinc-400 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            {isSuperAdmin ? (
              <span>
                <strong className="text-zinc-200">Regra de Isenção:</strong> A conta de Super Administrador não é tarifada e não computa cobranças mensais. O valor faturável é mantido como isento.
              </span>
            ) : isTrial ? (
              <span>
                <strong className="text-zinc-200">Regra de Período de Teste:</strong> Enquanto sua assinatura de 7 dias estiver ativa, o valor de R$ 29,90 não é cobrado nem contabilizado no faturamento mensal, exibindo <strong className="text-emerald-400">- 7D</strong>.
              </span>
            ) : (
              <span>
                <strong className="text-zinc-200">Cobrança Pro Ativa:</strong> Assinatura mensal de R$ 29,90 faturada pontualmente via PIX dinâmico com compensação instantânea.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
