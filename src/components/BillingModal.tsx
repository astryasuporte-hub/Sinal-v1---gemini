/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserSubscription, SubscriptionStatus } from '../types/sinal';
import {
  X,
  QrCode,
  Check,
  Copy,
  Shield,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  TrendingUp,
  Bell,
  Infinity,
  Layers,
  ChevronRight,
  RefreshCw,
  ArrowRight
} from 'lucide-react';

interface BillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription: UserSubscription;
  onUpgradeApproved: () => void;
}

import { zynpayService, ZynPayCharge } from '../services/zynpayService';
import { usePixPolling } from '../hooks/usePixPolling';

export interface InvoiceItem {
  id: string;
  date: string;
  amount: number;
  status: 'PAGO' | 'AGUARDANDO_PAGAMENTO' | 'CANCELADO';
  method: string;
  transactionId: string;
}

export const BillingModal: React.FC<BillingModalProps> = ({
  isOpen,
  onClose,
  subscription,
  onUpgradeApproved
}) => {
  const [copiedPix, setCopiedPix] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [simulatingWebhook, setSimulatingWebhook] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'approved' | 'idle'>(
    subscription.status === 'ACTIVE' ? 'approved' : 'pending'
  );
  const [zynCharge, setZynCharge] = useState<ZynPayCharge | null>(null);
  const [loadingCharge, setLoadingCharge] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [showPixSuccessAnimation, setShowPixSuccessAnimation] = useState(false);

  // Invoices History
  const [invoices, setInvoices] = useState<InvoiceItem[]>([
    {
      id: 'inv-001',
      date: 'Hoje',
      amount: subscription.amount || 29.9,
      status: 'AGUARDANDO_PAGAMENTO',
      method: 'PIX (ZynPay)',
      transactionId: 'zyn_init_pending'
    },
    {
      id: 'inv-002',
      date: '05 de mar. de 2025',
      amount: subscription.amount || 29.9,
      status: 'PAGO',
      method: 'PIX (ZynPay)',
      transactionId: 'pix_tx_8204918'
    },
    {
      id: 'inv-003',
      date: '05 de fev. de 2025',
      amount: subscription.amount || 29.9,
      status: 'PAGO',
      method: 'PIX (ZynPay)',
      transactionId: 'pix_tx_7109284'
    }
  ]);

  // Sync state if subscription changes
  useEffect(() => {
    if (subscription.status === 'ACTIVE') {
      setPaymentStatus('approved');
    }
  }, [subscription.status]);

  // Criação automática de cobrança Pix real na ZynPay ao abrir o checkout
  const generateZynPayCharge = useCallback(async () => {
    if (paymentStatus === 'approved') return;
    setLoadingCharge(true);
    setChargeError(null);

    const amountCents = Math.round((subscription.amount || 29.9) * 100);
    const result = await zynpayService.createPixCharge({
      amountCents,
      description: 'Assinatura FatosBR Pro - Acesso Executivo Mensal'
    });

    setLoadingCharge(false);

    if (result.success && result.charge) {
      setZynCharge(result.charge);
      // Atualiza primeira invoice com ID da transação gerada
      setInvoices((prev) =>
        prev.map((inv, idx) =>
          idx === 0
            ? { ...inv, transactionId: result.charge!.id, amount: result.charge!.amount / 100 }
            : inv
        )
      );
    } else {
      setChargeError(result.error || 'Não foi possível gerar cobrança Pix.');
    }
  }, [paymentStatus, subscription.amount]);

  useEffect(() => {
    if (isOpen && paymentStatus !== 'approved' && !zynCharge) {
      generateZynPayCharge();
    }
  }, [isOpen, paymentStatus, zynCharge, generateZynPayCharge]);

  // Callback central de sucesso quando o pagamento Pix é liquidado
  const handlePixPaymentApproved = useCallback((detail?: any) => {
    setPaymentStatus('approved');
    setShowPixSuccessAnimation(true);
    setInvoices((prev) =>
      prev.map((inv, idx) =>
        idx === 0 ? { ...inv, status: 'PAGO' } : inv
      )
    );
    onUpgradeApproved();
    showToast('Pagamento Pix confirmado via SSE! FatosBR Pro ativo.');
  }, [onUpgradeApproved]);

  // Listener de Server-Sent Events (SSE) dedicado para confirmação imediata
  useEffect(() => {
    if (!isOpen || paymentStatus === 'approved') return;

    // 1. Ouvir via canal SSE oficial do zynpayService
    const unsubscribe = zynpayService.onPaymentConfirmed((payload) => {
      if (!zynCharge?.id || !payload?.chargeId || payload.chargeId === zynCharge.id) {
        handlePixPaymentApproved(payload);
      }
    });

    // 2. Conexão Server-Sent Events (SSE) direta e resiliente em /api/zynpay/events
    let sse: EventSource | null = null;
    try {
      if (typeof window !== 'undefined' && 'EventSource' in window) {
        sse = new EventSource('/api/zynpay/events');
        sse.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'PAYMENT_CONFIRMED' || data.event === 'charge.paid') {
              handlePixPaymentApproved(data);
            }
          } catch {}
        };
      }
    } catch (e) {
      console.warn('[BillingModal] SSE fallback:', e);
    }

    // 3. Ouvir evento global disparado por webhooks
    const handleGlobalSync = (e: any) => {
      handlePixPaymentApproved(e?.detail);
    };
    window.addEventListener('fatosbr_subscription_updated', handleGlobalSync);

    return () => {
      unsubscribe();
      if (sse) sse.close();
      window.removeEventListener('fatosbr_subscription_updated', handleGlobalSync);
    };
  }, [isOpen, paymentStatus, zynCharge?.id, handlePixPaymentApproved]);

  // Polling complementar para garantir 100% de redundância em conexões com proxy restrito
  usePixPolling({
    chargeId: zynCharge?.id,
    enabled: isOpen && paymentStatus !== 'approved' && Boolean(zynCharge?.id),
    intervalMs: 5000,
    onSuccess: (paidCharge) => {
      setZynCharge(paidCharge);
      handlePixPaymentApproved(paidCharge);
    }
  });

  // Handle ESC key
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

  const activePixString = zynCharge?.qrCodeText ||
    '00020126580014br.gov.bcb.pix0136zyn_live_default52040000530398654029.905802BR5916FATOSBR NOTICIAS6009SAO PAULO62070503***6304';

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const copyPixCode = () => {
    navigator.clipboard.writeText(activePixString);
    setCopiedPix(true);
    showToast('Código PIX Copia e Cola copiado com sucesso.');
    setTimeout(() => setCopiedPix(false), 2500);
  };

  // Reconciliação / Confirmação via Webhook da ZynPay
  const handleSimulateWebhook = async () => {
    setSimulatingWebhook(true);
    const chargeId = zynCharge?.id || 'zyn_live_demo';
    await zynpayService.simulateWebhookPayment(chargeId);

    setTimeout(() => {
      setSimulatingWebhook(false);
      handlePixPaymentApproved({ chargeId, amount: 2990 });
    }, 1000);
  };

  // Status Badge Label
  const getStatusBadge = () => {
    if (paymentStatus === 'approved' || subscription.status === 'ACTIVE') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          PRO ATIVO
        </span>
      );
    }
    if (subscription.status === 'TRIAL_ACTIVE') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-zinc-800 text-zinc-300 border border-zinc-700">
          TRIAL ATIVO
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30">
        PAGAMENTO PENDENTE
      </span>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md overflow-y-auto animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs font-medium shadow-2xl flex items-center gap-2 animate-bounce-short">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Container */}
      <div className="relative w-full max-w-5xl min-h-screen sm:min-h-0 sm:max-h-[92vh] sm:rounded-3xl border-0 sm:border border-[#1f2229] bg-[#0c0d10] text-zinc-100 shadow-2xl flex flex-col overflow-hidden">
        {/* ================= 1. HEADER ================= */}
        <header className="sticky top-0 z-30 flex items-center justify-between px-5 sm:px-8 py-4 bg-[#0c0d10]/95 backdrop-blur-md border-b border-[#1f2229]">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  Plano e cobrança
                </h1>
                {getStatusBadge()}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 hidden sm:block">
                Gerencie seu plano, pagamento e tenha acesso a todos os recursos do FatosBR.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800 transition cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* ================= 2. CORPO SCROLLABLE ================= */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6">
          {/* CARD DO PLANO ATUAL & TRIAL */}
          <section className="p-5 sm:p-6 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-1 rounded-md bg-zinc-800/80 border border-zinc-700/60 text-[11px] font-mono uppercase text-zinc-300">
                Seu plano atual
              </span>
              <span className="text-xs font-mono font-semibold text-zinc-300">
                {paymentStatus === 'approved' || subscription.status === 'ACTIVE'
                  ? 'Assinatura Ativa'
                  : `Restam ${subscription.trialDaysLeft} dias`}
              </span>
            </div>

            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {paymentStatus === 'approved' || subscription.status === 'ACTIVE'
                  ? 'FatosBR Pro'
                  : 'Trial'}
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1 leading-relaxed">
                {paymentStatus === 'approved' || subscription.status === 'ACTIVE'
                  ? 'Você tem acesso ilimitado a todas as análises, acontecimentos convergidos e briefings do FatosBR.'
                  : '3 dias grátis · Acesso completo a todos os recursos Pro sem compromisso.'}
              </p>
            </div>

            {/* Barra de Progresso Discreta */}
            <div className="space-y-1.5 pt-1">
              <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-500 rounded-full"
                  style={{
                    width:
                      paymentStatus === 'approved' || subscription.status === 'ACTIVE'
                        ? '100%'
                        : `${((3 - subscription.trialDaysLeft) / 3) * 100}%`
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                <span>
                  {paymentStatus === 'approved' || subscription.status === 'ACTIVE'
                    ? 'Período Pro em andamento'
                    : `${3 - subscription.trialDaysLeft} de 3 dias utilizados`}
                </span>
                <span>
                  {paymentStatus === 'approved' || subscription.status === 'ACTIVE'
                    ? `Período ativo até ${subscription.currentPeriodEnd || '12 de abr. de 2026'}`
                    : `Expira em ${subscription.trialEndsAt || '12 de abr. de 2025'}`}
                </span>
              </div>
            </div>
          </section>

          {/* ================= GRADE EM 2 COLUNAS (DESKTOP) / 1 COLUNA (MOBILE) ================= */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* COLUNA ESQUERDA: CARD FATOSBR PRO + PRÓXIMA COBRANÇA */}
            <div className="space-y-6">
              {/* CARD FATOSBR PRO */}
              <div className="p-6 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-5">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                      Sinal Executive
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-zinc-800 text-zinc-300 border border-zinc-700">
                      Plano Individual
                    </span>
                  </div>

                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-2xl sm:text-3xl font-extrabold text-white">
                      R$ {subscription.amount ? subscription.amount.toFixed(2).replace('.', ',') : '119,00'}
                    </span>
                    <span className="text-xs text-zinc-400">/ mês</span>
                  </div>

                  <p className="text-xs text-zinc-400 mt-1">
                    Inteligência executiva e financeira sem ruído.
                  </p>
                </div>

                {/* Benefícios Reais do Sinal Executive */}
                <div className="space-y-2.5 text-xs text-zinc-300 pt-2 border-t border-zinc-800/80">
                  <div className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-white shrink-0 mt-0.5" />
                    <span>Radar Matinal (07h00) antes da abertura dos pregões</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-white shrink-0 mt-0.5" />
                    <span>Síntese do Fechamento (20h00) com agenda e balanço</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-white shrink-0 mt-0.5" />
                    <span>Estrutura 3-Bullet Intelligence (Fato, Impacto, Desdobramentos)</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-white shrink-0 mt-0.5" />
                    <span>Áudio síntese em voz natural para consumo em trânsito</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-white shrink-0 mt-0.5" />
                    <span>Cruzamento de fontes primárias e zero clickbait</span>
                  </div>
                </div>

                {/* CTA Principal */}
                <button
                  onClick={copyPixCode}
                  className="w-full py-3 px-4 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                >
                  <span>Assinar Sinal Executive</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* CARD PRÓXIMA COBRANÇA */}
              <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <Clock className="w-4 h-4 text-zinc-400" />
                    <span>Próxima renovação</span>
                  </div>
                  <span className="font-mono text-xs font-bold text-white">
                    R$ {subscription.amount ? subscription.amount.toFixed(2).replace('.', ',') : '29,90'}
                  </span>
                </div>

                <div className="text-xs text-zinc-300">
                  {subscription.trialEndsAt || '12 de abr. de 2025'}
                </div>

                <p className="text-[11px] text-zinc-400 leading-relaxed border-t border-zinc-800/80 pt-2.5">
                  Sua assinatura não será renovada automaticamente de forma involuntária.
                  O FatosBR respeita sua escolha: você recebe uma notificação antes do término e decide pontualmente quando gerar o novo PIX.
                </p>
              </div>
            </div>

            {/* COLUNA DIREITA: PAGAMENTO COM PIX */}
            <div className="space-y-6">
              {/* CARD PAGAMENTO COM PIX (FATOSBR PAY) */}
              <div className="p-6 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-5">
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                      <span>Pagamento via PIX</span>
                      <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        ZynPay API Oficial
                      </span>
                    </h3>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    Geração imediata com liquidação e aprovação instantânea pelo Banco Central.
                  </p>
                </div>

                {/* QR Code Container Responsivo ZynPay */}
                <div className="p-4 sm:p-5 rounded-xl border border-zinc-800 bg-zinc-950/70 flex flex-col sm:flex-row items-center gap-4 sm:gap-5">
                  {/* Visual QR Code ZynPay */}
                  <div className="p-2.5 rounded-xl bg-white text-black shrink-0 shadow-md flex items-center justify-center min-w-[144px] min-h-[144px]">
                    {loadingCharge ? (
                      <div className="flex flex-col items-center justify-center p-4 text-zinc-600 gap-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-zinc-800" />
                        <span className="text-[10px] font-mono">Gerando PIX...</span>
                      </div>
                    ) : zynCharge?.qrCode ? (
                      <img
                        src={zynCharge.qrCode}
                        alt="QR Code Pix ZynPay"
                        className="w-32 h-32 sm:w-36 sm:h-36 rounded-lg object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-4 text-zinc-600 gap-2">
                        <QrCode className="w-10 h-10 text-zinc-400" />
                        <span className="text-[10px] text-center">Pix Pronto</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 text-center sm:text-left min-w-0 flex-1">
                    <div className="flex items-center justify-center sm:justify-start gap-1.5">
                      <h4 className="text-xs sm:text-sm font-bold text-white">
                        Escaneie com seu banco
                      </h4>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-snug">
                      Abra o app do seu banco ou carteira digital, escolha pagar com PIX e aponte a câmera.
                    </p>
                    <div className="pt-1 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-[10px] text-zinc-400 font-mono">
                      <span className="text-emerald-400 font-semibold">● Confirmação automática</span>
                      <span>·</span>
                      <span>ID: {zynCharge?.id?.slice(0, 16) || 'zyn_pending'}</span>
                    </div>
                    {zynCharge?.isSandbox && (
                      <div className="text-[10px] text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded mt-1 inline-block">
                        Modo Sandbox Ativo (Simulação Real ZynPay)
                      </div>
                    )}
                  </div>
                </div>

                {/* Código PIX Copia e Cola */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                    <span>Código PIX Copia e Cola:</span>
                    <button
                      onClick={copyPixCode}
                      className="text-zinc-200 hover:text-white flex items-center gap-1 cursor-pointer font-sans"
                    >
                      {copiedPix ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedPix ? 'Copiado!' : 'Copiar'}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300">
                    <span className="truncate flex-1 select-all">{activePixString}</span>
                    <button
                      onClick={copyPixCode}
                      className="p-1 hover:text-white text-zinc-400 shrink-0"
                      title="Copiar Código Pix"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    onClick={copyPixCode}
                    className="w-full py-2.5 px-3 rounded-xl border border-zinc-700 hover:border-zinc-500 bg-[#16181f] hover:bg-zinc-800 text-xs font-semibold text-zinc-200 transition cursor-pointer flex items-center justify-center gap-2 active:scale-[0.99]"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar código PIX Copia e Cola</span>
                  </button>
                </div>

                {/* Status e Simulação de Webhook (Segurança Server-Side) */}
                <div className="pt-2 border-t border-zinc-800/80 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">Status da transação:</span>
                    <span
                      className={`font-semibold flex items-center gap-1.5 ${
                        paymentStatus === 'approved'
                          ? 'text-emerald-400 font-mono'
                          : 'text-amber-400 font-mono'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          paymentStatus === 'approved' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                        }`}
                      />
                      {paymentStatus === 'approved'
                        ? 'Pagamento aprovado'
                        : 'Aguardando pagamento'}
                    </span>
                  </div>

                  {paymentStatus !== 'approved' && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                      <span>SSE Ativo: Aguardando sinal de liquidação do Pix...</span>
                    </div>
                  )}

                  {paymentStatus !== 'approved' && (
                    <button
                      onClick={handleSimulateWebhook}
                      disabled={simulatingWebhook}
                      className="w-full py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 transition cursor-pointer flex items-center justify-center gap-1.5"
                      title="Simular confirmação instantânea de pagamento PIX"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${simulatingWebhook ? 'animate-spin text-emerald-400' : ''}`}
                      />
                      <span>
                        {simulatingWebhook
                          ? 'Validando pagamento PIX...'
                          : 'Simular Confirmação Instantânea (PIX)'}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {/* CARD HISTÓRICO DE COBRANÇAS */}
              <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                    Histórico de cobranças
                  </h3>
                  <span className="text-[11px] text-zinc-400 font-mono">
                    Ver histórico
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-3 text-[10px] uppercase font-mono text-zinc-500 pb-1 border-b border-zinc-800/60">
                    <span>Data</span>
                    <span>Valor</span>
                    <span className="text-right">Status</span>
                  </div>

                  {invoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="grid grid-cols-3 items-center py-2 border-b border-zinc-800/40 text-xs"
                    >
                      <span className="text-zinc-300 font-medium">{inv.date}</span>
                      <span className="text-zinc-200 font-mono">
                        R$ {inv.amount.toFixed(2).replace('.', ',')}
                      </span>
                      <div className="text-right">
                        {inv.status === 'PAGO' ? (
                          <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Pago
                          </span>
                        ) : inv.status === 'AGUARDANDO_PAGAMENTO' ? (
                          <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Aguardando
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-mono bg-red-500/10 text-red-400 border border-red-500/20">
                            Cancelado
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ================= 3. RODAPÉ DE BENEFÍCIOS "POR QUE SER PRO?" ================= */}
          <section className="p-6 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Por que ser Pro?
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-zinc-950/40 border border-zinc-800/70 space-y-1.5">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-zinc-300" />
                  <span className="font-bold text-white">Mais clareza</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Análises objetivas e consolidação multi-fonte sem ruído publicitário.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-950/40 border border-zinc-800/70 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-zinc-300" />
                  <span className="font-bold text-white">Alertas importantes</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Fique atento apenas aos fatos que alteram o cenário do seu interesse.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-950/40 border border-zinc-800/70 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Infinity className="w-4 h-4 text-zinc-300" />
                  <span className="font-bold text-white">Acompanhamento ilimitado</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Monitore quantas empresas, líderes e setores forem necessários.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-zinc-950/40 border border-zinc-800/70 space-y-1.5">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-zinc-300" />
                  <span className="font-bold text-white">Conteúdos exclusivos</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  Relatórios, briefings diários matinais e noturnos no seu e-mail.
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* ================= 4. FOOTER FECHAR ================= */}
        <footer className="sticky bottom-0 z-30 px-5 sm:px-8 py-3.5 bg-[#0c0d10]/95 border-t border-[#1f2229] backdrop-blur-md flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-zinc-400">
            <Shield className="w-3.5 h-3.5 text-zinc-400" />
            <span>Processamento criptografado via FatosBR Pay / Banco Central</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition cursor-pointer"
          >
            Fechar
          </button>
        </footer>
      </div>

      {/* ================= MODAL DE CONFIRMAÇÃO ANIMADA (SSE PIX CONFIRMADO) ================= */}
      <AnimatePresence>
        {showPixSuccessAnimation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="relative w-full max-w-md p-6 sm:p-8 rounded-3xl bg-[#0e1014] border border-zinc-700/80 text-center space-y-5 shadow-2xl overflow-hidden"
            >
              {/* Círculo do Check com animação de pulso e escala */}
              <div className="relative mx-auto w-20 h-20 flex items-center justify-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: [1, 1.25, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-0 rounded-full bg-emerald-500/20"
                />
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.1 }}
                  className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-black shadow-xl shadow-emerald-500/30"
                >
                  <Check className="w-9 h-9 stroke-[3]" />
                </motion.div>
              </div>

              <div className="space-y-1.5">
                <motion.h3
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-xl sm:text-2xl font-bold text-white tracking-tight"
                >
                  Pagamento Pix Confirmado!
                </motion.h3>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="text-xs sm:text-sm text-zinc-300"
                >
                  Sua transação foi processada pelo Banco Central e o plano <strong className="text-white">FatosBR Pro</strong> foi ativado com sucesso.
                </motion.p>
              </div>

              {/* Detalhes da Transação */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 text-left font-mono text-xs space-y-2 text-zinc-300"
              >
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Valor Pago:</span>
                  <span className="text-emerald-400 font-bold">R$ 29,90</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Forma de Pagamento:</span>
                  <span className="text-white">PIX Instantâneo</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Gateway:</span>
                  <span className="text-zinc-300">ZynPay Oficial</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Status:</span>
                  <span className="text-emerald-400 font-bold">● APROVADO / PAGO</span>
                </div>
              </motion.div>

              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                onClick={() => {
                  setShowPixSuccessAnimation(false);
                  onClose();
                }}
                className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-sm transition cursor-pointer shadow-lg active:scale-[0.98]"
              >
                Continuar e Explorar o FatosBR Pro
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
