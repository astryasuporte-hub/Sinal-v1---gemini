/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Mail,
  Send,
  Key,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Eye,
  EyeOff,
  Clock,
  Activity,
  Server,
  Zap,
  Check,
  ShieldCheck,
  Layers,
  FileText
} from 'lucide-react';
import { resendService, ResendStatusResponse, ResendWebhookCounts, ResendWebhookItem } from '../services/resendService';

interface ResendConfigPanelProps {
  onShowToast?: (msg: string) => void;
}

export const ResendConfigPanel: React.FC<ResendConfigPanelProps> = ({ onShowToast }) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [senderInput, setSenderInput] = useState('FatosBR Briefing <onboarding@resend.dev>');
  const [testEmailInput, setTestEmailInput] = useState(() => resendService.getStoredSubscriberEmail());
  const [keyMasked, setKeyMasked] = useState<string>('Carregando...');
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [briefingSending, setBriefingSending] = useState(false);

  // Telemetria do último envio
  const [lastDispatchResult, setLastDispatchResult] = useState<{
    success: boolean;
    timestamp: string;
    message: string;
    id?: string;
    latencyMs?: number;
    recipient?: string;
  } | null>(null);

  // Webhooks
  const [webhookCounts, setWebhookCounts] = useState<ResendWebhookCounts>({
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0
  });
  const [recentWebhookEvents, setRecentWebhookEvents] = useState<ResendWebhookItem[]>([]);
  const [simulatingWebhook, setSimulatingWebhook] = useState(false);

  const showFeedback = (msg: string) => {
    if (onShowToast) onShowToast(msg);
  };

  const loadCurrentConfigAndStatus = async () => {
    setStatusLoading(true);
    try {
      const [configData, statusData] = await Promise.all([
        resendService.getConfig(),
        resendService.getStatus()
      ]);

      if (configData.sender) {
        setSenderInput(configData.sender);
      }
      setKeyMasked(configData.keyMasked || statusData.keyMasked);
      setIsConnected(statusData.connected);

      if (statusData.webhookStats) {
        setWebhookCounts({
          delivered: statusData.webhookStats.delivered,
          opened: statusData.webhookStats.opened,
          clicked: statusData.webhookStats.clicked,
          bounced: statusData.webhookStats.bounced,
          complained: statusData.webhookStats.complained
        });
        setRecentWebhookEvents(statusData.webhookStats.recentEvents || []);
      }
    } catch (e) {
      console.warn('Erro ao carregar status do Resend:', e);
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    loadCurrentConfigAndStatus();
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await resendService.updateConfig(apiKeyInput || undefined, senderInput);
      if (res.success) {
        if (res.keyMasked) setKeyMasked(res.keyMasked);
        if (res.sender) setSenderInput(res.sender);
        setApiKeyInput('');
        showFeedback(res.message);
        await loadCurrentConfigAndStatus();
      } else {
        showFeedback(`Erro ao salvar: ${res.message}`);
      }
    } catch {
      showFeedback('Falha de conexão com o servidor ao salvar credenciais.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailInput || !testEmailInput.includes('@')) {
      showFeedback('Por favor, informe um e-mail válido para o teste.');
      return;
    }
    setTestSending(true);
    resendService.setStoredSubscriberEmail(testEmailInput);

    const startTime = Date.now();
    try {
      const result = await resendService.sendTestEmail(testEmailInput);
      const latency = Date.now() - startTime;

      setLastDispatchResult({
        success: result.success,
        timestamp: new Date().toLocaleTimeString('pt-BR'),
        message: result.success
          ? result.message || 'E-mail de teste despachado com sucesso.'
          : result.error || 'Falha no despacho do e-mail de teste.',
        id: result.id,
        latencyMs: latency,
        recipient: testEmailInput
      });

      if (result.success) {
        showFeedback(`E-mail de teste enviado com sucesso (${latency}ms)! ID: ${result.id || 'ok'}`);
      } else {
        showFeedback(`Erro no envio: ${result.error || 'Falha desconhecida'}`);
      }
      await loadCurrentConfigAndStatus();
    } catch (err: any) {
      setLastDispatchResult({
        success: false,
        timestamp: new Date().toLocaleTimeString('pt-BR'),
        message: err.message || 'Erro de rede ao enviar e-mail de teste',
        recipient: testEmailInput
      });
      showFeedback('Erro de rede ao tentar disparar e-mail.');
    } finally {
      setTestSending(false);
    }
  };

  const handleSendBriefingTest = async () => {
    if (!testEmailInput || !testEmailInput.includes('@')) {
      showFeedback('Informe um e-mail válido.');
      return;
    }
    setBriefingSending(true);
    resendService.setStoredSubscriberEmail(testEmailInput);

    const startTime = Date.now();
    try {
      const result = await resendService.sendMorningBriefingTest(testEmailInput);
      const latency = Date.now() - startTime;

      setLastDispatchResult({
        success: result.success,
        timestamp: new Date().toLocaleTimeString('pt-BR'),
        message: result.success
          ? 'Briefing Matinal com eventos reais despachado com sucesso!'
          : result.error || 'Erro ao enviar Briefing Matinal.',
        id: result.id,
        latencyMs: latency,
        recipient: testEmailInput
      });

      if (result.success) {
        showFeedback(`Briefing Matinal enviado com sucesso (${latency}ms)!`);
      } else {
        showFeedback(`Erro no briefing: ${result.error || 'Falha'}`);
      }
      await loadCurrentConfigAndStatus();
    } catch (err: any) {
      showFeedback(`Erro ao despachar briefing: ${err.message || 'Falha'}`);
    } finally {
      setBriefingSending(false);
    }
  };

  const handleSimulateWebhook = async (type: 'delivered' | 'opened' | 'clicked' | 'bounced') => {
    setSimulatingWebhook(true);
    try {
      const res = await resendService.simulateWebhookEvent(type, {
        recipient: testEmailInput,
        subject: 'FatosBR • Briefing Executivo'
      });
      if (res.success) {
        showFeedback(`Evento simulado: email.${type}`);
        await loadCurrentConfigAndStatus();
      } else {
        showFeedback('Falha ao simular webhook.');
      }
    } catch {
      showFeedback('Erro ao simular webhook.');
    } finally {
      setSimulatingWebhook(false);
    }
  };

  return (
    <div className="space-y-6 text-zinc-100">
      {/* Top Banner Status Bar */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#090b10] border border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-white">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-tight">
                Infraestrutura SMTP & API Resend
              </h3>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase font-bold ${
                  isConnected
                    ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800'
                    : isConnected === false
                    ? 'bg-red-950/40 text-red-300 border-red-800'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                }`}
              >
                {isConnected ? 'Conectado / Operacional' : isConnected === false ? 'Desconectado' : 'Checando...'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Gerencie a chave de API, configure o remetente oficial e realize testes de despacho em tempo real.
            </p>
          </div>
        </div>

        <button
          onClick={loadCurrentConfigAndStatus}
          disabled={statusLoading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-semibold text-zinc-200 transition cursor-pointer disabled:opacity-50 self-start md:self-auto"
        >
          <RotateCw className={`w-3.5 h-3.5 text-zinc-400 ${statusLoading ? 'animate-spin' : ''}`} />
          <span>Verificar Conexão</span>
        </button>
      </div>

      {/* Grid: 2 Colunas (Configuração à Esquerda, Testes em Tempo Real à Direita) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Coluna 1: Formulário de Credenciais */}
        <div className="lg:col-span-6 space-y-5">
          <div className="p-5 rounded-2xl bg-[#0e1117] border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-zinc-300" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Credenciais do Provedor
                </h4>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">
                Chave Ativa: {keyMasked}
              </span>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              {/* Input da Chave */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Chave de API do Resend (resend_api_key)
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="Cole a chave iniciada em re_..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="w-full bg-[#07090e] border border-zinc-700 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-white placeholder:text-zinc-600 font-mono focus:outline-none focus:border-white transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition cursor-pointer p-1"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <span className="text-[11px] text-zinc-500 mt-1 block">
                  Deixe em branco caso deseje manter a chave atual já em execução no servidor.
                </span>
              </div>

              {/* Input do Remetente */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Remetente Autorizado (From Address)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: FatosBR <onboarding@resend.dev> ou redacao@seudominio.com.br"
                  value={senderInput}
                  onChange={(e) => setSenderInput(e.target.value)}
                  className="w-full bg-[#07090e] border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white transition"
                />
                <span className="text-[11px] text-zinc-500 mt-1 block">
                  Utilize <code className="text-zinc-400">onboarding@resend.dev</code> para testes rápidos ou seu domínio verificado no Resend.
                </span>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-5 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {savingConfig ? 'Salvando...' : 'Salvar Configurações'}
                </button>
              </div>
            </form>
          </div>

          {/* Webhooks e Métricas */}
          <div className="p-5 rounded-2xl bg-[#0e1117] border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-zinc-300" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Telemetria de Eventos & Webhooks
                </h4>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono">
                {recentWebhookEvents.length} eventos registrados
              </span>
            </div>

            {/* Contadores */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
              <div className="p-2.5 rounded-xl bg-[#07090e] border border-zinc-800">
                <div className="text-base font-bold text-white font-mono">{webhookCounts.delivered}</div>
                <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Entregues</div>
              </div>
              <div className="p-2.5 rounded-xl bg-[#07090e] border border-zinc-800">
                <div className="text-base font-bold text-white font-mono">{webhookCounts.opened}</div>
                <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Abertos</div>
              </div>
              <div className="p-2.5 rounded-xl bg-[#07090e] border border-zinc-800">
                <div className="text-base font-bold text-white font-mono">{webhookCounts.clicked}</div>
                <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Cliques</div>
              </div>
              <div className="p-2.5 rounded-xl bg-[#07090e] border border-zinc-800">
                <div className="text-base font-bold text-white font-mono">{webhookCounts.bounced}</div>
                <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Bounces</div>
              </div>
              <div className="p-2.5 rounded-xl bg-[#07090e] border border-zinc-800">
                <div className="text-base font-bold text-white font-mono">{webhookCounts.complained}</div>
                <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Spam</div>
              </div>
            </div>

            {/* Simulador rápido de Webhook */}
            <div className="pt-2 space-y-2">
              <span className="text-[11px] text-zinc-400 block">
                Simular evento de entrega no pipeline para validação:
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {(['delivered', 'opened', 'clicked', 'bounced'] as const).map((evt) => (
                  <button
                    key={evt}
                    onClick={() => handleSimulateWebhook(evt)}
                    disabled={simulatingWebhook}
                    className="px-3 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                  >
                    +{evt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Coluna 2: Testes em Tempo Real */}
        <div className="lg:col-span-6 space-y-5">
          <div className="p-5 rounded-2xl bg-[#0e1117] border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-zinc-300" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Disparo de Teste em Tempo Real
                </h4>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">
                API Live
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  E-mail de Destino para Teste
                </label>
                <input
                  type="email"
                  required
                  placeholder="seu-email@gmail.com"
                  value={testEmailInput}
                  onChange={(e) => setTestEmailInput(e.target.value)}
                  className="w-full bg-[#07090e] border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-600 font-mono focus:outline-none focus:border-white transition"
                />
                <span className="text-[11px] text-zinc-500 mt-1 block">
                  Dica: No ambiente gratuito do Resend, envie para o e-mail cadastrado na conta do provedor.
                </span>
              </div>

              {/* Botões de Disparo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleSendTestEmail}
                  disabled={testSending || briefingSending}
                  className="px-4 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 ${testSending ? 'animate-spin' : ''}`} />
                  <span>{testSending ? 'Enviando Teste...' : 'Enviar E-mail de Teste'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSendBriefingTest}
                  disabled={testSending || briefingSending}
                  className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-white text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
                >
                  <FileText className={`w-3.5 h-3.5 ${briefingSending ? 'animate-spin' : ''}`} />
                  <span>{briefingSending ? 'Despachando...' : 'Testar Briefing Matinal'}</span>
                </button>
              </div>

              {/* Card de Resposta em Tempo Real */}
              {lastDispatchResult && (
                <div
                  className={`p-4 rounded-xl border space-y-2 mt-4 text-xs ${
                    lastDispatchResult.success
                      ? 'bg-zinc-950 border-emerald-800/80 text-zinc-200'
                      : 'bg-zinc-950 border-red-800/80 text-zinc-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {lastDispatchResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                      )}
                      <span className="font-bold text-white">
                        {lastDispatchResult.success ? 'Despacho Concluído' : 'Falha no Despacho'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
                      {lastDispatchResult.latencyMs !== undefined && (
                        <span>{lastDispatchResult.latencyMs} ms</span>
                      )}
                      <span>·</span>
                      <span>{lastDispatchResult.timestamp}</span>
                    </div>
                  </div>

                  <p className="text-zinc-300 font-sans leading-relaxed">
                    {lastDispatchResult.message}
                  </p>

                  {lastDispatchResult.id && (
                    <div className="pt-2 border-t border-zinc-800/80 font-mono text-[11px] text-zinc-400 flex items-center justify-between">
                      <span>Message ID:</span>
                      <span className="text-white select-all">{lastDispatchResult.id}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
