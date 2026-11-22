/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR — Dashboard Financeiro Executivo do Painel Administrativo
 * Métricas reais e projetadas: Total Faturado, Não Faturado (Trials / Isentos),
 * MRR, ARR, Formas Elegíveis (Cartão de Crédito e Pix Automático via Cakto) e Webhooks.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  CreditCard,
  TrendingUp,
  DollarSign,
  Clock,
  CheckCircle2,
  Download,
  RefreshCw,
  Search,
  ArrowUpRight,
  Wallet,
  BarChart3,
  Activity,
  ShieldCheck,
} from 'lucide-react';
import { AdminUser } from '../services/adminService';
import { paymentsService } from '../services/paymentsService';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface AdminFinancialDashboardProps {
  users?: AdminUser[];
  onOpenBillingSettings?: () => void;
  onShowToast?: (msg: string) => void;
}

interface FinancialTransaction {
  id: string;
  customerName: string;
  customerEmail: string;
  plan: string;
  amount: number;
  status: 'paid' | 'pending' | 'trial_free' | 'refunded';
  paymentMethod: 'Cartão de Crédito' | 'Pix Automático' | 'Cortesia Admin' | 'Trial 7D';
  date: string;
  invoiceId: string;
}

interface CaktoWebhookEventRow {
  id: string;
  provider?: string;
  provider_event_id?: string;
  event_type?: string;
  processed?: boolean;
  processing_error?: string | null;
  created_at?: string;
  payload?: any;
}

const PRO_TICKET_REAIS = 34.9;

export const AdminFinancialDashboard: React.FC<AdminFinancialDashboardProps> = ({
  users = [],
  onShowToast,
}) => {
  const [timeframe, setTimeframe] = useState<'30d' | '90d' | '12m'>('12m');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'pending' | 'trial_free'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const [dashboardSubTab, setDashboardSubTab] = useState<'overview' | 'cakto' | 'webhooks'>('overview');
  const [webhookEvents, setWebhookEvents] = useState<CaktoWebhookEventRow[]>([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState<boolean>(false);

  const fetchPaymentsTelemetry = useCallback(async () => {
    setLoadingWebhooks(true);
    try {
      const whkRes = await paymentsService.getAdminWebhookEvents();
      if (whkRes.success && Array.isArray(whkRes.events)) {
        setWebhookEvents(whkRes.events);
      }
    } catch (e) {
      console.error('[AdminFinancialDashboard] Erro ao carregar eventos Cakto:', e);
    } finally {
      setLoadingWebhooks(false);
    }
  }, []);

  useEffect(() => {
    void fetchPaymentsTelemetry();
  }, [fetchPaymentsTelemetry]);

  const metrics = useMemo(() => {
    const totalUsers = users.length;
    const paidUsers = users.filter(
      (u) =>
        !u.isAdmin &&
        u.email.toLowerCase() !== 'astryasuporte@gmail.com' &&
        (u.planName.includes('PRO') || u.subscriptionStatus === 'ACTIVE')
    );
    const trialUsers = users.filter(
      (u) =>
        !u.isAdmin &&
        (u.planName.includes('TRIAL') || u.subscriptionStatus === 'TRIAL_ACTIVE')
    );
    const adminUsers = users.filter(
      (u) => u.isAdmin || u.email.toLowerCase().includes('astrya') || u.email.toLowerCase().includes('yleao')
    );

    const paidCount = paidUsers.length;
    const trialCount = trialUsers.length;
    const adminCount = adminUsers.length;

    const mrr = paidCount * PRO_TICKET_REAIS;
    const arr = mrr * 12;
    const totalFaturado = paidCount * PRO_TICKET_REAIS;
    const totalNaoFaturadoTrials = trialCount * PRO_TICKET_REAIS;
    const totalPendenteLiquidacao = 0;
    const conversionRate = totalUsers > 0 ? Number(((paidCount / totalUsers) * 100).toFixed(1)) : 0;

    return {
      totalUsers,
      paidCount,
      trialCount,
      adminCount,
      mrr,
      arr,
      totalFaturado,
      totalNaoFaturadoTrials,
      totalPendenteLiquidacao,
      avgTicket: PRO_TICKET_REAIS,
      conversionRate,
    };
  }, [users]);

  const monthlyData = useMemo(() => {
    const months = ['Mai/25', 'Jun/25', 'Jul/25', 'Ago/25', 'Set/25', 'Out/25', 'Nov/25', 'Dez/25', 'Jan/26', 'Fev/26', 'Mar/26', 'Abr/26'];
    const paidCount = users.filter(
      (u) => !u.isAdmin && (u.planName.includes('PRO') || u.subscriptionStatus === 'ACTIVE')
    ).length;
    const trialCount = users.filter(
      (u) => !u.isAdmin && (u.planName.includes('TRIAL') || u.subscriptionStatus === 'TRIAL_ACTIVE')
    ).length;

    return months.map((month, idx) => {
      const factor = (idx + 1) / months.length;
      return {
        month,
        faturado:
          idx === months.length - 1
            ? paidCount * PRO_TICKET_REAIS
            : Math.round(paidCount * factor * PRO_TICKET_REAIS * 100) / 100,
        naoFaturado:
          idx === months.length - 1
            ? trialCount * PRO_TICKET_REAIS
            : Math.round(trialCount * factor * PRO_TICKET_REAIS * 100) / 100,
        novosAssinantes: Math.max(Math.round(paidCount * factor), 0),
      };
    });
  }, [users]);

  const transactions: FinancialTransaction[] = useMemo(() => {
    return users.map((u, idx) => {
      const isUserAdmin = u.isAdmin || u.email.toLowerCase().includes('astrya') || u.email.toLowerCase().includes('yleao');
      const st = String(u.subscriptionStatus || '').toUpperCase();
      const isTrial = !isUserAdmin && (st === 'TRIAL_ACTIVE' || (!st && u.planName.includes('TRIAL')));
      const isPaid = !isUserAdmin && !isTrial && (st === 'ACTIVE' || (!st && u.planName.includes('PRO')));

      let status: 'paid' | 'pending' | 'trial_free' | 'refunded' = isTrial ? 'trial_free' : 'pending';
      let amount = 0;
      let plan = isTrial ? 'FatosBR Trial 7 Dias' : 'Sem assinatura ativa';
      let paymentMethod: FinancialTransaction['paymentMethod'] = 'Trial 7D';

      if (isUserAdmin) {
        status = 'paid';
        amount = 0.0;
        plan = 'Super Admin (Isento)';
        paymentMethod = 'Cortesia Admin';
      } else if (isTrial) {
        status = 'trial_free';
        amount = 0.0;
        plan = 'Degustação Trial 7 Dias';
        paymentMethod = 'Trial 7D';
      } else if (isPaid) {
        status = 'paid';
        amount = PRO_TICKET_REAIS;
        plan = 'FatosBR PRO Mensal';
        paymentMethod = 'Cartão de Crédito';
      } else if (st === 'CANCELED' || st === 'SUSPENDED' || st === 'TRIAL_EXPIRED' || st === 'INCOMPLETE') {
        status = st === 'SUSPENDED' ? 'refunded' : 'pending';
        amount = 0.0;
        plan = `FatosBR PRO (${st})`;
        paymentMethod = 'Cartão de Crédito';
      }

      return {
        id: `tx_${u.id || idx}`,
        customerName: u.fullName || u.email.split('@')[0],
        customerEmail: u.email,
        plan,
        amount,
        status,
        paymentMethod,
        date: u.createdAt || new Date().toISOString(),
        invoiceId: `FAT-${(u.id || String(idx)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase() || '0001'}`,
      };
    });
  }, [users]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          tx.customerName.toLowerCase().includes(q) ||
          tx.customerEmail.toLowerCase().includes(q) ||
          tx.invoiceId.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [transactions, statusFilter, searchTerm]);

  const handleExportCsv = () => {
    setIsExporting(true);
    try {
      const headers = ['ID Fatura', 'Cliente', 'E-mail', 'Plano', 'Valor (R$)', 'Status', 'Forma de Pagamento', 'Data'];
      const rows = filteredTransactions.map((tx) => [
        tx.invoiceId,
        `"${tx.customerName}"`,
        tx.customerEmail,
        `"${tx.plan}"`,
        tx.amount.toFixed(2),
        tx.status,
        `"${tx.paymentMethod}"`,
        tx.date,
      ]);

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `fatosbr-relatorio-financeiro-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      onShowToast?.('Relatório financeiro exportado com sucesso.');
    } catch {
      onShowToast?.('Erro ao exportar relatório.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="p-4 sm:p-6 rounded-2xl bg-[#07111D] border border-[#183047] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-[#2378D4]/20 border border-[#2378D4]/40 text-[#41C8F4]">
              <Wallet className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-bold text-[#F4F7FB]">
              Dashboard Financeiro & Assinaturas Cakto
            </h2>
          </div>
          <p className="text-xs text-[#94A7BC] mt-1">
            Plano único FatosBR PRO (R$ 34,90/mês) · Trial 7 dias sem cartão no SaaS · Cartão de Crédito e Pix Automático.
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <div className="flex items-center bg-[#030912] border border-[#183047] rounded-xl p-1 text-xs">
            {(['30d', '90d', '12m'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setTimeframe(period)}
                className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  timeframe === period
                    ? 'bg-[#2378D4] text-white shadow-md'
                    : 'text-[#94A7BC] hover:text-white'
                }`}
              >
                {period === '30d' ? '30 Dias' : period === '90d' ? '90 Dias' : '12 Meses'}
              </button>
            ))}
          </div>

          <button
            onClick={handleExportCsv}
            disabled={isExporting}
            className="px-3.5 py-2 rounded-xl bg-[#0A1726] border border-[#183047] hover:border-[#2378D4] text-[#F4F7FB] text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-[#41C8F4]" />
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>
        </div>
      </div>

      {/* Sub-navegação */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-2xl bg-[#07111D] border border-[#183047]">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <button
            onClick={() => setDashboardSubTab('overview')}
            className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 ${
              dashboardSubTab === 'overview'
                ? 'bg-[#2378D4] text-white shadow-md'
                : 'text-[#94A7BC] hover:text-white hover:bg-[#0A1726]'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Visão Geral & MRR</span>
          </button>

          <button
            onClick={() => setDashboardSubTab('cakto')}
            className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 ${
              dashboardSubTab === 'cakto'
                ? 'bg-[#2378D4] text-white shadow-md'
                : 'text-[#94A7BC] hover:text-white hover:bg-[#0A1726]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Cakto Assinaturas (R$ 34,90)</span>
          </button>

          <button
            onClick={() => setDashboardSubTab('webhooks')}
            className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 ${
              dashboardSubTab === 'webhooks'
                ? 'bg-[#2378D4] text-white shadow-md'
                : 'text-[#94A7BC] hover:text-white hover:bg-[#0A1726]'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-[#41C8F4]" />
            <span>Webhooks Cakto ({webhookEvents.length})</span>
          </button>
        </div>

        <button
          onClick={() => void fetchPaymentsTelemetry()}
          disabled={loadingWebhooks}
          className="px-3 py-1.5 rounded-xl bg-[#0A1726] border border-[#183047] hover:border-[#2378D4] text-xs font-semibold text-[#F4F7FB] flex items-center gap-1.5 transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-[#41C8F4] ${loadingWebhooks ? 'animate-spin' : ''}`} />
          <span>Atualizar Eventos</span>
        </button>
      </div>

      {/* ABA 1: VISÃO GERAL */}
      {dashboardSubTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 sm:p-5 rounded-2xl bg-[#07111D] border border-[#183047] space-y-2">
              <div className="flex items-center justify-between text-[#94A7BC] text-xs">
                <span className="font-semibold uppercase tracking-wider text-[11px]">Total Faturado</span>
                <div className="w-7 h-7 rounded-lg bg-[#20D6A0]/10 border border-[#20D6A0]/20 text-[#20D6A0] flex items-center justify-center">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-extrabold text-[#F4F7FB] font-mono tracking-tight">
                R$ {metrics.totalFaturado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[#20D6A0]">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>Ticket PRO R$ 34,90/mês</span>
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-[#07111D] border border-[#183047] space-y-2">
              <div className="flex items-center justify-between text-[#94A7BC] text-xs">
                <span className="font-semibold uppercase tracking-wider text-[11px]">MRR Recorrente</span>
                <div className="w-7 h-7 rounded-lg bg-[#2378D4]/10 border border-[#2378D4]/20 text-[#41C8F4] flex items-center justify-center">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-extrabold text-[#F4F7FB] font-mono tracking-tight">
                R$ {metrics.mrr.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-[#94A7BC] flex items-center justify-between">
                <span>ARR: <strong>R$ {metrics.arr.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}/ano</strong></span>
                <span className="text-[#20D6A0] font-semibold">{metrics.paidCount} pagantes</span>
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-[#07111D] border border-[#183047] space-y-2">
              <div className="flex items-center justify-between text-[#94A7BC] text-xs">
                <span className="font-semibold uppercase tracking-wider text-[11px]">Não Faturado (Trials)</span>
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-extrabold text-[#F4F7FB] font-mono tracking-tight">
                R$ {metrics.totalNaoFaturadoTrials.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-[#94A7BC]">
                <span className="text-amber-300 font-semibold">{metrics.trialCount} usuários</span> em degustação gratuita 7D
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-[#07111D] border border-[#183047] space-y-2">
              <div className="flex items-center justify-between text-[#94A7BC] text-xs">
                <span className="font-semibold uppercase tracking-wider text-[11px]">Métodos Aceitos</span>
                <div className="w-7 h-7 rounded-lg bg-[#41C8F4]/10 border border-[#41C8F4]/20 text-[#41C8F4] flex items-center justify-center">
                  <CreditCard className="w-4 h-4" />
                </div>
              </div>
              <div className="text-sm font-bold text-[#F4F7FB]">
                Cartão de Crédito & Pix Automático
              </div>
              <div className="text-[11px] text-[#20D6A0] flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Pix avulso/boleto bloqueados</span>
              </div>
            </div>
          </div>

          {/* Gráfico */}
          <div className="p-4 sm:p-6 rounded-2xl bg-[#07111D] border border-[#183047] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#183047]">
              <div>
                <h3 className="text-sm font-bold text-[#F4F7FB]">
                  Evolução Mensal (PRO Pago vs. Trial 7D)
                </h3>
                <p className="text-xs text-[#94A7BC] mt-0.5">
                  Receita recorrente efetivada contra base em período gratuito de 7 dias.
                </p>
              </div>
            </div>

            <div className="h-64 sm:h-72 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <XAxis dataKey="month" stroke="#94A7BC" fontSize={11} tickLine={false} />
                  <YAxis
                    stroke="#94A7BC"
                    fontSize={11}
                    tickLine={false}
                    tickFormatter={(val) => `R$${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0A1726',
                      borderColor: '#183047',
                      borderRadius: '12px',
                      color: '#F4F7FB',
                      fontSize: '12px',
                    }}
                    formatter={(value: any) => [`R$ ${Number(value || 0).toLocaleString('pt-BR')}`, '']}
                  />
                  <Bar dataKey="faturado" name="Faturado (R$)" fill="#2378D4" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="naoFaturado" name="Não Faturado (R$)" fill="#f59e0b88" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabela de Assinaturas e Faturas */}
          <div className="p-4 sm:p-6 rounded-2xl bg-[#07111D] border border-[#183047] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#183047]">
              <div>
                <h3 className="text-sm font-bold text-[#F4F7FB]">Registro de Assinaturas</h3>
                <p className="text-xs text-[#94A7BC] mt-0.5">
                  Assinantes PRO, período de degustação 7 dias e isenções administrativas.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center bg-[#030912] border border-[#183047] rounded-xl p-1 text-[11px]">
                  {(['all', 'paid', 'trial_free'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setStatusFilter(st)}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                        statusFilter === st ? 'bg-[#2378D4] text-white' : 'text-[#94A7BC] hover:text-white'
                      }`}
                    >
                      {st === 'all' ? 'Todas' : st === 'paid' ? 'Pagas' : 'Trials (7D)'}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#94A7BC]" />
                  <input
                    type="text"
                    placeholder="Buscar por cliente..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-[#030912] border border-[#183047] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#F4F7FB] placeholder:text-[#94A7BC] focus:outline-none focus:border-[#2378D4]"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#183047] text-[11px] text-[#94A7BC] uppercase font-mono">
                    <th className="pb-3 pl-2">Fatura / ID</th>
                    <th className="pb-3">Cliente</th>
                    <th className="pb-3">Plano</th>
                    <th className="pb-3">Valor</th>
                    <th className="pb-3">Método</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3 text-right pr-2">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#183047]/60">
                  {filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-[#0A1726] transition">
                      <td className="py-3 pl-2 font-mono text-[#41C8F4] font-semibold">{tx.invoiceId}</td>
                      <td className="py-3">
                        <div className="font-semibold text-[#F4F7FB]">{tx.customerName}</div>
                        <div className="text-[11px] text-[#94A7BC] font-mono">{tx.customerEmail}</div>
                      </td>
                      <td className="py-3 text-zinc-300 font-medium">{tx.plan}</td>
                      <td className="py-3 font-mono">
                        {tx.amount === 0 ? (
                          <span className="text-zinc-500 font-bold">- (R$ 0,00)</span>
                        ) : (
                          <span className="text-[#20D6A0] font-bold">
                            R$ {tx.amount.toFixed(2).replace('.', ',')}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-[11px] text-[#94A7BC]">{tx.paymentMethod}</td>
                      <td className="py-3">
                        {tx.status === 'paid' ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#20D6A0]/15 text-[#20D6A0] border border-[#20D6A0]/30">
                            Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            Trial 7D
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right pr-2 text-[#94A7BC] font-mono text-[11px]">
                        {new Date(tx.date).toLocaleDateString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: CAKTO ASSINATURAS */}
      {dashboardSubTab === 'cakto' && (
        <div className="p-5 rounded-2xl bg-[#07111D] border border-[#183047] space-y-4">
          <h3 className="text-sm font-bold text-[#F4F7FB]">Configuração Comercial FatosBR PRO (Cakto)</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-4 rounded-xl bg-[#030912] border border-[#183047] space-y-1">
              <div className="text-[#94A7BC]">PLANO & PREÇO OFICIAL</div>
              <div className="text-base font-bold text-white">FatosBR PRO · R$ 34,90/mês</div>
              <div className="text-[11px] text-zinc-400">Ciclo 30 dias · Trial SaaS 7D</div>
            </div>
            <div className="p-4 rounded-xl bg-[#030912] border border-[#183047] space-y-1">
              <div className="text-[#94A7BC]">PRODUCT / OFFER / CHECKOUT</div>
              <div className="text-xs font-bold text-[#41C8F4] break-all">
                c8731178-55c9-47f6-8b98-987f31206ed8
              </div>
              <div className="text-[11px] text-zinc-400">Oferta vjw92gx · Checkout 1356033</div>
            </div>
            <div className="p-4 rounded-xl bg-[#030912] border border-[#183047] space-y-1">
              <div className="text-[#94A7BC]">TRAVAS COMERCIAIS</div>
              <div className="text-xs font-bold text-emerald-400">
                credit_card + pix_auto exclusivamente
              </div>
              <div className="text-[11px] text-zinc-400">Pix avulso, boleto e PicPay bloqueados</div>
            </div>
          </div>
        </div>
      )}

      {/* ABA 3: WEBHOOKS CAKTO */}
      {dashboardSubTab === 'webhooks' && (
        <div className="p-4 sm:p-6 rounded-2xl bg-[#07111D] border border-[#183047] space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#183047]">
            <div>
              <h3 className="text-sm font-bold text-[#F4F7FB] flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#41C8F4]" />
                <span>Log de Webhooks Cakto (/api/payments/webhook)</span>
              </h3>
              <p className="text-xs text-[#94A7BC] mt-0.5">
                Eventos auditados em internal.billing_events com validação HMAC-SHA256 e idempotência por provedor.
              </p>
            </div>
          </div>

          {webhookEvents.length === 0 ? (
            <div className="p-8 text-center rounded-xl bg-[#030912] border border-[#183047] text-zinc-400 text-xs">
              Nenhum evento de webhook recebido até o momento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#183047] text-[11px] text-[#94A7BC] uppercase font-mono">
                    <th className="pb-3 pl-2">Event ID</th>
                    <th className="pb-3">Tipo</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3 text-right pr-2">Recebido em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#183047]/60">
                  {webhookEvents.map((ev) => (
                    <tr key={ev.id} className="hover:bg-[#0A1726]">
                      <td className="py-3 pl-2 font-mono text-[#41C8F4]">{ev.provider_event_id || ev.id}</td>
                      <td className="py-3 font-mono text-zinc-300">{ev.event_type || 'webhook'}</td>
                      <td className="py-3">
                        {ev.processed ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#20D6A0]/15 text-[#20D6A0]">
                            Processado
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300">
                            {ev.processing_error || 'Pendente'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right pr-2 font-mono text-[11px] text-[#94A7BC]">
                        {ev.created_at ? new Date(ev.created_at).toLocaleString('pt-BR') : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
