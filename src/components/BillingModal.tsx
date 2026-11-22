/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BillingModal — Gestão de Assinatura FatosBR PRO (Payments V1 + Cakto)
 *
 * Regras:
 * - Plano único pago: FatosBR PRO — R$ 34,90/mês.
 * - Trial gratuito: 7 dias controlados pelo SaaS FatosBR (sem exigir cartão).
 * - Métodos permitidos no checkout recorrente: Cartão de Crédito e Pix Automático.
 * - Nunca exibe cobrança falsa, nunca simula confirmação e nunca redireciona se bloqueado comercialmente.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { UserSubscription } from '../types/sinal';
import {
  X,
  Check,
  Shield,
  Clock,
  CreditCard,
  Repeat,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Lock,
  TrendingUp,
  Bell,
  Infinity as InfinityIcon,
  FileText,
  XCircle,
} from 'lucide-react';
import { paymentsService, BillingHistoryItem, AllowedPaymentMethod } from '../services/paymentsService';

interface BillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription: UserSubscription;
  onUpgradeApproved: (updated?: UserSubscription) => void;
}

export const BillingModal: React.FC<BillingModalProps> = ({
  isOpen,
  onClose,
  subscription,
  onUpgradeApproved,
}) => {
  const [liveSubscription, setLiveSubscription] = useState<UserSubscription>(subscription);
  const [selectedMethod, setSelectedMethod] = useState<AllowedPaymentMethod>('credit_card');
  const [history, setHistory] = useState<BillingHistoryItem[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [loadingReconcile, setLoadingReconcile] = useState(false);
  const [loadingCancel, setLoadingCancel] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'info' | 'success'; message: string } | null>(null);

  useEffect(() => {
    setLiveSubscription(subscription);
  }, [subscription]);

  const refreshAll = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [statusRes, historyRes] = await Promise.all([
        paymentsService.getStatus(),
        paymentsService.getHistory(),
      ]);
      if (statusRes.success && statusRes.subscription) {
        setLiveSubscription(statusRes.subscription);
        onUpgradeApproved(statusRes.subscription);
      } else if (!statusRes.success && statusRes.error) {
        setFeedback({
          type: 'error',
          message:
            statusRes.errorCode === 'SUBSCRIPTION_VERIFICATION_UNAVAILABLE'
              ? 'Não foi possível verificar sua assinatura no servidor no momento. Tente novamente em instantes.'
              : statusRes.error,
        });
      }
      if (historyRes.success) {
        setHistory(historyRes.history);
      }
    } finally {
      setLoadingStatus(false);
    }
  }, [onUpgradeApproved]);

  useEffect(() => {
    if (isOpen) {
      setFeedback(null);
      setConfirmCancelOpen(false);
      void refreshAll();
    }
  }, [isOpen, refreshAll]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isAdmin = Boolean(liveSubscription.isAdminExempt);
  const isProActive = liveSubscription.status === 'ACTIVE' && !isAdmin;
  const isTrialActive = liveSubscription.status === 'TRIAL_ACTIVE';
  const isPastDue = liveSubscription.status === 'PAST_DUE';
  const isCanceled = liveSubscription.status === 'CANCELED';
  const isCanceledWithAccess = isCanceled && Boolean(liveSubscription.hasProAccess);
  const isRefused = liveSubscription.status === 'PAYMENT_REFUSED' || liveSubscription.status === 'INCOMPLETE';
  const isSuspendedOrExpired =
    liveSubscription.status === 'SUSPENDED' || liveSubscription.status === 'EXPIRED';

  const readiness = liveSubscription.commercialReadiness;
  const isCheckoutBlocked = readiness ? !readiness.ready : false;

  const totalTrialDays = liveSubscription.trialTotalDays || 7;
  const trialDaysLeft = Math.max(0, Math.min(totalTrialDays, liveSubscription.trialDaysLeft ?? 0));
  const usedTrialDays = Math.max(0, totalTrialDays - trialDaysLeft);

  const handleCheckout = async () => {
    setLoadingCheckout(true);
    setFeedback(null);
    try {
      const idempotencyKey = `fatosbr_pro_${selectedMethod}_${new Date().toISOString().slice(0, 13)}`;
      const res = await paymentsService.startCheckout({
        paymentMethod: selectedMethod,
        idempotencyKey,
      });

      if (!res.success || res.blocked || !res.checkoutUrl) {
        setFeedback({
          type: 'error',
          message:
            res.error ||
            'Checkout Cakto bloqueado comercialmente até liberação dos métodos Cartão de Crédito e Pix Automático.',
        });
        return;
      }

      window.location.assign(res.checkoutUrl);
    } finally {
      setLoadingCheckout(false);
    }
  };

  const handleReconcile = async () => {
    setLoadingReconcile(true);
    setFeedback(null);
    try {
      const res = await paymentsService.reconcile();
      if (res.subscription) {
        setLiveSubscription(res.subscription);
        onUpgradeApproved(res.subscription);
      }
      await refreshAll();
      setFeedback({
        type: 'info',
        message:
          res.reconciledCount && res.reconciledCount > 0
            ? `Status sincronizado: ${res.reconciledCount} evento(s) atualizado(s).`
            : 'Consulta concluída. Nenhuma nova compensação identificada na Cakto.',
      });
    } finally {
      setLoadingReconcile(false);
    }
  };

  const handleCancelSubscription = async () => {
    setLoadingCancel(true);
    setFeedback(null);
    try {
      const res = await paymentsService.cancelSubscription();
      if (!res.success) {
        setFeedback({
          type: 'error',
          message: res.error || res.message || 'Não foi possível cancelar a assinatura.',
        });
        return;
      }
      if (res.subscription) {
        setLiveSubscription(res.subscription);
        onUpgradeApproved(res.subscription);
      }
      setConfirmCancelOpen(false);
      setFeedback({
        type: 'success',
        message: res.message || 'Assinatura cancelada com sucesso.',
      });
    } finally {
      setLoadingCancel(false);
    }
  };

  const renderStatusBadge = () => {
    if (isAdmin) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
          ADMIN ISENTO
        </span>
      );
    }
    if (isProActive) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          PRO ATIVO
        </span>
      );
    }
    if (isTrialActive) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-zinc-800 text-zinc-200 border border-zinc-700">
          TRIAL 7 DIAS
        </span>
      );
    }
    if (isPastDue || isRefused) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30">
          {isPastDue ? 'PAGAMENTO EM ATRASO' : 'PAGAMENTO RECUSADO'}
        </span>
      );
    }
    if (isCanceled) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-zinc-800 text-zinc-300 border border-zinc-700">
          {isCanceledWithAccess ? 'CANCELADA (ACESSO ATIVO)' : 'CANCELADA'}
        </span>
      );
    }
    if (isSuspendedOrExpired) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30">
          {liveSubscription.status === 'SUSPENDED' ? 'SUSPENSA' : 'EXPIRADA'}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
        {liveSubscription.status === 'TRIAL_EXPIRED' ? 'TRIAL EXPIRADO' : 'PENDENTE'}
      </span>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 w-full h-full bg-[#050505] flex flex-col overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full h-full bg-[#050505] text-zinc-100 flex flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex items-center justify-between px-5 sm:px-8 py-4 bg-[#050505]/95 backdrop-blur-md border-b border-[#1f2229]">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                Plano e Assinatura
              </h1>
              {renderStatusBadge()}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 hidden sm:block">
              FatosBR PRO · Gerenciamento oficial de assinatura e histórico financeiro.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void refreshAll()}
              disabled={loadingStatus}
              className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-900 transition cursor-pointer"
              title="Atualizar status da assinatura"
            >
              <RefreshCw className={`w-4 h-4 ${loadingStatus ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-900 transition cursor-pointer"
              title="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6 max-w-6xl w-full mx-auto">
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                feedback.type === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-200'
                  : feedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-200'
              }`}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{feedback.message}</span>
            </div>
          )}

          {/* CARD DO PLANO ATUAL */}
          <section className="p-5 sm:p-6 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] font-mono uppercase text-zinc-300">
                Status Atual
              </span>
              <span className="text-xs font-mono font-semibold text-zinc-300">
                {isAdmin
                  ? 'Isenção Administrativa'
                  : isProActive
                  ? `Renovação: ${liveSubscription.nextBillingAt || liveSubscription.currentPeriodEnd}`
                  : isCanceledWithAccess
                  ? `Cancelada · Acesso até ${liveSubscription.currentPeriodEnd}`
                  : isTrialActive
                  ? `Restam ${trialDaysLeft} de ${totalTrialDays} dias`
                  : liveSubscription.planName}
              </span>
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {liveSubscription.planName}
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1 leading-relaxed">
                {isAdmin
                  ? 'Conta administrativa com acesso integral e sem faturamento mensal.'
                  : isProActive
                  ? 'Sua assinatura FatosBR PRO (R$ 34,90/mês) está ativa com acesso irrestrito.'
                  : isCanceledWithAccess
                  ? `Renovação cancelada. Seu acesso FatosBR PRO permanece ativo até ${liveSubscription.currentPeriodEnd}.`
                  : isTrialActive
                  ? '7 dias grátis sem exigir cartão de crédito · Acesso completo ao monitoramento executivo e briefings.'
                  : 'Assine o FatosBR PRO (R$ 34,90/mês) para manter acesso contínuo às análises e briefings diários.'}
              </p>
            </div>

            {!isAdmin && (
              <div className="space-y-1.5 pt-1">
                <div className="w-full h-2 rounded-full bg-zinc-900 overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-500 rounded-full"
                    style={{
                      width:
                        isProActive || isCanceledWithAccess
                          ? '100%'
                          : `${Math.min(100, Math.max(8, (usedTrialDays / totalTrialDays) * 100))}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                  <span>
                    {isProActive || isCanceledWithAccess
                      ? isCanceledWithAccess
                        ? 'Ciclo pago em encerramento'
                        : 'Ciclo mensal de 30 dias em andamento'
                      : `${usedTrialDays} de ${totalTrialDays} dias de teste utilizados`}
                  </span>
                  <span>
                    {isProActive || isCanceledWithAccess
                      ? `Válido até ${liveSubscription.currentPeriodEnd}`
                      : `Término do trial: ${liveSubscription.trialEndsAt}`}
                  </span>
                </div>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* COLUNA ESQUERDA: OFERTA OFICIAL FATOSBR PRO */}
            <div className="space-y-6">
              <div className="p-6 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-5">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                      FatosBR PRO
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-zinc-900 text-zinc-300 border border-zinc-700">
                      Plano Único Mensal
                    </span>
                  </div>

                  <div className="flex items-baseline gap-1.5 mt-2">
                    <span className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
                      R$ 34,90
                    </span>
                    <span className="text-xs text-zinc-400">/ mês</span>
                  </div>

                  <p className="text-xs text-zinc-400 mt-1">
                    Inteligência jornalística convergente, briefings diários e alertas em tempo real.
                  </p>
                </div>

                <div className="space-y-2.5 text-xs text-zinc-300 pt-3 border-t border-zinc-800/80">
                  <div className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-white shrink-0 mt-0.5" />
                    <span>Briefings Matinal (07h00) e Noturno (20h00) personalizados no app e por e-mail</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-white shrink-0 mt-0.5" />
                    <span>Síntese estruturada com múltiplas fontes primárias verificadas</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-white shrink-0 mt-0.5" />
                    <span>Monitoramento ilimitado de empresas, lideranças e setores estratégicos</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-white shrink-0 mt-0.5" />
                    <span>7 dias iniciais gratuitos no FatosBR antes de contratar, com cancelamento simples</span>
                  </div>
                </div>

                {/* Ações PRO / Cancelamento */}
                {isProActive && !isAdmin ? (
                  <div className="pt-3 border-t border-zinc-800/80 space-y-3">
                    {!confirmCancelOpen ? (
                      <button
                        onClick={() => setConfirmCancelOpen(true)}
                        className="w-full py-2.5 px-4 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Cancelar assinatura recorrente</span>
                      </button>
                    ) : (
                      <div className="p-3.5 rounded-xl bg-zinc-950 border border-red-500/40 space-y-2.5 text-xs">
                        <p className="text-zinc-300">
                          Confirmar cancelamento da renovação na Cakto? Você mantém acesso até{' '}
                          <strong className="text-white">{liveSubscription.currentPeriodEnd}</strong>.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfirmCancelOpen(false)}
                            className="flex-1 py-2 rounded-lg bg-zinc-800 text-zinc-200 font-semibold cursor-pointer"
                          >
                            Manter plano
                          </button>
                          <button
                            onClick={() => void handleCancelSubscription()}
                            disabled={loadingCancel}
                            className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold cursor-pointer disabled:opacity-50"
                          >
                            {loadingCancel ? 'Cancelando...' : 'Confirmar cancelamento'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <Clock className="w-4 h-4 text-zinc-400" />
                    <span>Ciclo de faturamento</span>
                  </div>
                  <span className="font-mono font-bold text-white">R$ 34,90 / 30 dias</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Processamento oficial via Cakto em ambiente hospedado e criptografado. Nenhuma cobrança ocorre automaticamente durante os 7 dias gratuitos no FatosBR.
                </p>
              </div>
            </div>

            {/* COLUNA DIREITA: CHECKOUT CAKTO (CARTÃO / PIX AUTOMÁTICO) & HISTÓRICO */}
            <div className="space-y-6">
              <div className="p-6 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-white">
                      Pagamento Recorrente Cakto
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Escolha a forma recorrente permitida para contratar o FatosBR PRO.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono bg-zinc-900 text-zinc-300 border border-zinc-700 px-2 py-0.5 rounded-full">
                    BRL · Cakto
                  </span>
                </div>

                {/* Seletor exclusivo dos dois métodos permitidos */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedMethod('credit_card')}
                    className={`p-3.5 rounded-xl border text-left transition cursor-pointer flex items-start gap-3 ${
                      selectedMethod === 'credit_card'
                        ? 'bg-white text-black border-white'
                        : 'bg-zinc-950/70 text-zinc-200 border-zinc-800 hover:border-zinc-600'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold">Cartão de Crédito</div>
                      <div className={`text-[10px] mt-0.5 ${selectedMethod === 'credit_card' ? 'text-zinc-700' : 'text-zinc-400'}`}>
                        Renovação mensal automática
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedMethod('pix_auto')}
                    className={`p-3.5 rounded-xl border text-left transition cursor-pointer flex items-start gap-3 ${
                      selectedMethod === 'pix_auto'
                        ? 'bg-white text-black border-white'
                        : 'bg-zinc-950/70 text-zinc-200 border-zinc-800 hover:border-zinc-600'
                    }`}
                  >
                    <Repeat className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold">Pix Automático</div>
                      <div className={`text-[10px] mt-0.5 ${selectedMethod === 'pix_auto' ? 'text-zinc-700' : 'text-zinc-400'}`}>
                        Débito recorrente autorizado
                      </div>
                    </div>
                  </button>
                </div>

                {/* Aviso transparente quando a oferta ainda está comercialmente bloqueada */}
                {isCheckoutBlocked && (
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                      <span>Checkout comercial em validação operacional</span>
                    </div>
                    <p className="text-[11px] text-amber-200/85 leading-relaxed">
                      {readiness?.blockedMessage ||
                        'A oferta FatosBR PRO aguarda confirmação final dos métodos Cartão de Crédito e Pix Automático na Cakto antes da liberação pública.'}
                    </p>
                  </div>
                )}

                {!isAdmin && !isProActive && (
                  <button
                    type="button"
                    onClick={() => void handleCheckout()}
                    disabled={loadingCheckout || isCheckoutBlocked}
                    className="w-full py-3 px-4 rounded-xl bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 text-black text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <span>
                      {loadingCheckout
                        ? 'Preparando checkout seguro...'
                        : isCheckoutBlocked
                        ? 'Checkout bloqueado até liberação Cakto'
                        : 'Assinar FatosBR PRO — R$ 34,90/mês'}
                    </span>
                    {!isCheckoutBlocked && <ArrowRight className="w-4 h-4" />}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleReconcile()}
                  disabled={loadingReconcile}
                  className="w-full py-2.5 px-3 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-[11px] font-medium text-zinc-300 transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingReconcile ? 'animate-spin' : ''}`} />
                  <span>
                    {loadingReconcile
                      ? 'Consultando pedidos na Cakto...'
                      : 'Sincronizar status com a Cakto'}
                  </span>
                </button>
              </div>

              {/* HISTÓRICO REAL DE COBRANÇAS */}
              <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Histórico financeiro
                  </h3>
                  <span className="text-[11px] text-zinc-400 font-mono">
                    {history.length} registro(s)
                  </span>
                </div>

                {history.length === 0 ? (
                  <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs text-zinc-400 text-center">
                    Nenhuma cobrança registrada até o momento.
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    {history.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-zinc-950/60 border border-zinc-800/60"
                      >
                        <div>
                          <div className="text-zinc-200 font-medium">{item.description}</div>
                          <div className="text-[10px] text-zinc-400 font-mono">
                            {new Date(item.date).toLocaleDateString('pt-BR')} · {item.paymentMethod}
                          </div>
                        </div>
                        <div className="text-right font-mono">
                          <div className="text-white font-bold">
                            {paymentsService.formatBrl(item.amount)}
                          </div>
                          <div
                            className={`text-[10px] ${
                              item.status === 'PAID'
                                ? 'text-emerald-400'
                                : item.status === 'PENDING'
                                ? 'text-amber-400'
                                : 'text-red-400'
                            }`}
                          >
                            {item.status}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <section className="p-6 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Por que assinar o FatosBR PRO?
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-zinc-950/40 border border-zinc-800/70 space-y-1.5">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-zinc-300" />
                  <span className="font-bold text-white">Mais clareza</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Consolidação multi-fonte sem ruído editorial ou clickbait.
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-zinc-950/40 border border-zinc-800/70 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-zinc-300" />
                  <span className="font-bold text-white">Alertas de fato relevante</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Notificações configuráveis somente para fatos com impacto real.
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-zinc-950/40 border border-zinc-800/70 space-y-1.5">
                <div className="flex items-center gap-2">
                  <InfinityIcon className="w-4 h-4 text-zinc-300" />
                  <span className="font-bold text-white">Monitoramento contínuo</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Acompanhe empresas, lideranças e temas estratégicos sem limite.
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-zinc-950/40 border border-zinc-800/70 space-y-1.5">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-zinc-300" />
                  <span className="font-bold text-white">Briefings diários</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Edições matinal (07h00) e noturna (20h00) entregues no app e e-mail.
                </p>
              </div>
            </div>
          </section>
        </div>

        <footer className="sticky bottom-0 z-30 px-5 sm:px-8 py-3.5 bg-[#050505]/95 border-t border-[#1f2229] backdrop-blur-md flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-zinc-400">
            <Shield className="w-3.5 h-3.5 text-zinc-400" />
            <span>Assinaturas processadas via Cakto · FatosBR PRO R$ 34,90/mês</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white font-medium transition cursor-pointer"
          >
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
};
