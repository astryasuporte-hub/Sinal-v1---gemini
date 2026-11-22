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
  Cell,
} from 'recharts';
import {
  CreditCard,
  TrendingUp,
  ShieldCheck,
  Calendar,
  Sparkles,
  Info,
  CheckCircle2,
  ExternalLink,
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
  userEmail = '',
  onOpenBilling,
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const isSuperAdmin =
    isAdmin || Boolean(subscription.isAdminExempt) || userEmail.toLowerCase() === 'astryasuporte@gmail.com';

  const isTrial =
    !isSuperAdmin &&
    (subscription.status === 'TRIAL_ACTIVE' ||
      subscription.planId === 'trial' ||
      subscription.trialDaysLeft > 0);

  const baseAmount = 34.9;
  const baseLabel = `R$ ${baseAmount.toFixed(2).replace('.', ',')}`;
  const isPaidActive = !isSuperAdmin && !isTrial && subscription.status === 'ACTIVE';

  const monthlyData: MonthlyExpense[] = [
    {
      month: 'Ciclo 1',
      amount: isSuperAdmin || isTrial || !isPaidActive ? 0 : baseAmount,
      label: isSuperAdmin ? 'Isento' : isTrial ? '- Trial 7D' : isPaidActive ? baseLabel : 'R$ 0,00',
      status: isSuperAdmin ? 'exempt' : isTrial ? 'trial' : isPaidActive ? 'paid' : 'projected',
      annotation: isSuperAdmin
        ? 'Super Admin (Isento)'
        : isTrial
        ? 'Período Teste Gratuito (7 dias)'
        : isPaidActive
        ? 'FatosBR PRO (R$ 34,90/mês)'
        : 'Sem cobrança ativa',
    },
  ];

  const totalSpent = monthlyData.reduce((acc, curr) => acc + curr.amount, 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as MonthlyExpense;
      return (
        <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-[#232d42] shadow-xl text-xs font-mono space-y-1">
          <div className="font-bold text-white flex items-center justify-between gap-3">
            <span>{data.month}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-200 border border-zinc-700">
              {data.status === 'exempt' ? 'Admin' : data.status === 'trial' ? '- 7D' : data.status === 'paid' ? 'Faturado' : 'Inativo'}
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-white">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Resumo da Assinatura</span>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
                Cakto · Cartão / Pix Automático
              </span>
            </h3>
            <p className="text-[11px] text-zinc-400">
              Situação cadastral da sua assinatura FatosBR PRO.
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                FatosBR PRO
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-400">
            {isSuperAdmin
              ? 'Conta administrativa isenta de cobrança'
              : isTrial
              ? `Período gratuito de 7 dias (${subscription.trialDaysLeft}d restantes)`
              : isPaidActive
              ? 'Cobrança mensal de R$ 34,90'
              : 'Assinatura inativa / aguardando contratação'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#16181f] border border-zinc-800/80 space-y-1.5">
          <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono uppercase">
            <span>Mensalidade Efetiva</span>
            <CreditCard className="w-3 h-3 text-zinc-300" />
          </div>
          <div className="flex items-baseline gap-2 font-mono">
            {isSuperAdmin ? (
              <span className="text-base sm:text-lg font-bold text-zinc-400">
                - <span className="text-xs font-normal text-zinc-500">(Admin Cortesia)</span>
              </span>
            ) : isTrial ? (
              <span className="text-base sm:text-lg font-bold text-emerald-400">
                - 7D <span className="text-xs font-normal text-zinc-500">(Trial gratuito)</span>
              </span>
            ) : (
              <span className="text-base sm:text-lg font-bold text-white">
                R$ 34,90 <span className="text-xs font-normal text-zinc-400">/ mês</span>
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-400">
            {isSuperAdmin
              ? 'Admin não entra no faturamento'
              : isTrial
              ? 'Sem cobrança automática durante os 7 dias'
              : 'Cartão de Crédito ou Pix Automático (Cakto)'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#16181f] border border-zinc-800/80 space-y-1.5">
          <div className="flex items-center justify-between text-zinc-400 text-[10px] font-mono uppercase">
            <span>Ciclo Vigente</span>
            <Calendar className="w-3 h-3 text-blue-400" />
          </div>
          <div className="text-base sm:text-lg font-bold text-white font-mono">
            R$ {totalSpent.toFixed(2).replace('.', ',')}
          </div>
          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Sincronizado com Payments V1</span>
          </div>
        </div>
      </div>

      <div className="p-3.5 sm:p-4 rounded-xl bg-[#0c0e14] border border-[#1a202c] space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-white flex items-center gap-2">
            <span>Visão Financeira do Ciclo</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400"></span>
            <span className="text-zinc-400">
              {isSuperAdmin ? 'Admin (Isento)' : isTrial ? 'Teste - 7D' : isPaidActive ? 'FatosBR PRO R$ 34,90' : 'Sem cobrança'}
            </span>
          </div>
        </div>

        <div className="w-full h-36 pt-2">
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
              <XAxis dataKey="month" stroke="#52525b" fontSize={10} tickLine={false} axisLine={{ stroke: '#27272a' }} />
              <YAxis
                stroke="#52525b"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: '#27272a' }}
                domain={[0, 40]}
                ticks={[0, 15, 35]}
                tickFormatter={(value) => `R$ ${value}`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {monthlyData.map((entry, index) => {
                  let fillColor = '#10b981';
                  if (entry.status === 'exempt') fillColor = '#f59e0b';
                  if (selectedMonth === entry.month) fillColor = '#60a5fa';
                  return <Cell key={`cell-${index}`} fill={fillColor} opacity={entry.amount === 0 ? 0.35 : 0.9} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="p-2.5 rounded-lg bg-[#141824] border border-[#1e2538] text-[11px] text-zinc-400 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            {isSuperAdmin ? (
              <span>
                <strong className="text-zinc-200">Regra de Isenção:</strong> Contas administrativas são isentas de cobrança.
              </span>
            ) : isTrial ? (
              <span>
                <strong className="text-zinc-200">Período de Teste (7 dias):</strong> Durante a degustação gratuita sem cartão, não há cobrança de R$ 34,90.
              </span>
            ) : (
              <span>
                <strong className="text-zinc-200">FatosBR PRO:</strong> Assinatura mensal de R$ 34,90 via Cartão de Crédito ou Pix Automático na Cakto.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
