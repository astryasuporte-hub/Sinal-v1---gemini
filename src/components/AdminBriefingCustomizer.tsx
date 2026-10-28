/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Mail,
  Send,
  Eye,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  Layers,
  Filter,
  ExternalLink,
  Activity,
  Check,
  MousePointerClick,
  Inbox
} from 'lucide-react';
import { Event } from '../types/sinal';
import { useI18n } from '../i18n';

interface AdminBriefingCustomizerProps {
  events: Event[];
  onShowToast: (msg: string) => void;
}

interface WebhookItem {
  id: string;
  type: 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'unknown';
  rawType: string;
  emailId: string;
  recipient: string;
  subject: string;
  timestamp: string;
  link?: string;
}

interface WebhookStats {
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
}

export const AdminBriefingCustomizer: React.FC<AdminBriefingCustomizerProps> = ({
  events = [],
  onShowToast
}) => {
  const { t, formatRelativeTime, formatDate } = useI18n();

  // ================= 1. ESTADOS DO CUSTOMIZADOR DE BRIEFINGS =================
  const [briefingType, setBriefingType] = useState<'morning' | 'evening'>('morning');
  const [customTitle, setCustomTitle] = useState(() => {
    return localStorage.getItem('fatosbr_briefing_title_morning') || 'FatosBR • Radar Executivo Matinal';
  });
  const [customSubtitle, setCustomSubtitle] = useState(() => {
    return localStorage.getItem('fatosbr_briefing_subtitle_morning') || 'Os acontecimentos verificados e cruzados que vão pautar as decisões de hoje no mercado.';
  });
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');

  // Alternar entre tipos de briefing
  const handleSwitchType = (type: 'morning' | 'evening') => {
    setBriefingType(type);
    if (type === 'morning') {
      setCustomTitle(localStorage.getItem('fatosbr_briefing_title_morning') || 'FatosBR • Radar Executivo Matinal');
      setCustomSubtitle(localStorage.getItem('fatosbr_briefing_subtitle_morning') || 'Os acontecimentos verificados e cruzados que vão pautar as decisões de hoje no mercado.');
    } else {
      setCustomTitle(localStorage.getItem('fatosbr_briefing_title_evening') || 'FatosBR • Fechamento Executivo Noturno');
      setCustomSubtitle(localStorage.getItem('fatosbr_briefing_subtitle_evening') || 'Balanço dos fatos, impactos regulatórios e o que esperar para a abertura de amanhã.');
    }
  };

  // Gerar Preview em tempo real consumindo /api/resend/preview
  const generateLivePreview = async (type = briefingType, title = customTitle, subtitle = customSubtitle) => {
    setIsLoadingPreview(true);
    try {
      const topEvents = events.slice(0, 5).map((e) => ({
        id: e.id,
        title: e.title,
        summary: e.summary,
        category: e.category,
        relevanceScore: e.relevanceScore,
        sourceCountText: e.sourceCountText || `${e.sources?.length || 2} fontes verificadas`
      }));

      const res = await fetch('/api/resend/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type,
          customTitle: title,
          customSubtitle: subtitle,
          events: topEvents
        })
      });

      if (res.ok) {
        const html = await res.text();
        setPreviewHtml(html);
      } else {
        onShowToast('Falha ao obter preview do briefing do servidor.');
      }
    } catch (err: any) {
      console.warn('Erro ao conectar ao endpoint /api/resend/preview:', err);
      onShowToast('Erro na conexão com /api/resend/preview.');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Salvar títulos personalizados
  const handleSaveTitles = () => {
    try {
      localStorage.setItem(`fatosbr_briefing_title_${briefingType}`, customTitle);
      localStorage.setItem(`fatosbr_briefing_subtitle_${briefingType}`, customSubtitle);
      onShowToast(`Títulos do ${briefingType === 'morning' ? 'Briefing Matinal' : 'Briefing Noturno'} salvos!`);
      generateLivePreview();
    } catch {
      onShowToast('Erro ao salvar títulos.');
    }
  };

  // Carrega preview inicial ao montar o componente
  useEffect(() => {
    generateLivePreview('morning', customTitle, customSubtitle);
  }, []);

  // ================= 2. ESTADOS DOS WEBHOOKS RECENTES DO RESEND =================
  const [webhookEvents, setWebhookEvents] = useState<WebhookItem[]>([]);
  const [webhookStats, setWebhookStats] = useState<WebhookStats>({
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0
  });
  const [isLoadingWebhooks, setIsLoadingWebhooks] = useState(false);
  const [webhookFilter, setWebhookFilter] = useState<'all' | 'delivered' | 'opened' | 'clicked' | 'bounced'>('all');

  // Buscar eventos de webhooks do endpoint /api/resend/webhook
  const fetchWebhooks = async () => {
    setIsLoadingWebhooks(true);
    try {
      const res = await fetch('/api/resend/webhook');
      if (res.ok) {
        const data = await res.json();
        if (data.counts) {
          setWebhookStats(data.counts);
        }
        if (Array.isArray(data.recentEvents)) {
          setWebhookEvents(data.recentEvents);
        }
      }
    } catch (err) {
      console.warn('Erro ao carregar webhooks de /api/resend/webhook:', err);
    } finally {
      setIsLoadingWebhooks(false);
    }
  };

  useEffect(() => {
    fetchWebhooks();
    const interval = setInterval(fetchWebhooks, 15000); // atualiza a cada 15 segundos
    return () => clearInterval(interval);
  }, []);

  // Simular evento de teste de webhook para validação visual
  const handleSimulateWebhook = async (type: 'delivered' | 'opened' | 'clicked') => {
    try {
      const testEmail = 'astryasuporte@gmail.com';
      await fetch('/api/resend/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: `email.${type}`,
          data: {
            email_id: `em_test_${Date.now()}`,
            to: [testEmail],
            subject: customTitle || 'FatosBR • Briefing Executivo',
            click: type === 'clicked' ? { link: 'https://fatosbr.app/news/1' } : undefined
          }
        })
      });
      fetchWebhooks();
      onShowToast(`Simulação de webhook (${type}) registrada com sucesso!`);
    } catch {
      onShowToast('Erro ao simular webhook.');
    }
  };

  const filteredWebhooks = webhookEvents.filter((ev) => {
    if (webhookFilter === 'all') return true;
    return ev.type === webhookFilter;
  });

  return (
    <div className="space-y-8">
      {/* ================= SEÇÃO 1: FORMULÁRIO DE TÍTULOS E PREVIEW EM TEMPO REAL ================= */}
      <div className="p-4 sm:p-6 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#182136]">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
              <span>{t('admin.briefingCustomizer')}</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              {t('admin.briefingCustomizerDesc')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl p-1 bg-[#0a0e17] border border-[#182136]">
              <button
                type="button"
                onClick={() => handleSwitchType('morning')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  briefingType === 'morning'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Matinal (07h00)
              </button>
              <button
                type="button"
                onClick={() => handleSwitchType('evening')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  briefingType === 'evening'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Noturno (20h00)
              </button>
            </div>
          </div>
        </div>

        {/* Formulário de Edição */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-zinc-300 mb-1 font-semibold">
                Título do Briefing ({briefingType === 'morning' ? 'Matinal' : 'Noturno'})
              </label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Ex: FatosBR • Radar Executivo Matinal"
                className="w-full bg-[#0a0e17] border border-[#182136] focus:border-amber-400/50 rounded-xl px-3.5 py-2.5 text-white placeholder:text-zinc-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-zinc-300 mb-1 font-semibold">
                Subtítulo do Briefing ({briefingType === 'morning' ? 'Matinal' : 'Noturno'})
              </label>
              <textarea
                rows={3}
                value={customSubtitle}
                onChange={(e) => setCustomSubtitle(e.target.value)}
                placeholder="Ex: Os 5 acontecimentos confirmados que vão guiar as decisões do dia."
                className="w-full bg-[#0a0e17] border border-[#182136] focus:border-amber-400/50 rounded-xl p-3 text-white placeholder:text-zinc-500 focus:outline-none resize-none leading-relaxed"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                disabled={isLoadingPreview}
                onClick={() => generateLivePreview()}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold flex items-center gap-2 cursor-pointer transition shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPreview ? 'animate-spin' : ''}`} />
                <span>Atualizar Preview</span>
              </button>

              <button
                type="button"
                onClick={handleSaveTitles}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold flex items-center gap-2 cursor-pointer transition shadow-sm"
              >
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>Salvar Títulos Padrão</span>
              </button>
            </div>

            <div className="p-3 rounded-xl bg-[#0a0e17] border border-zinc-800/80 text-[11px] text-zinc-400 space-y-1">
              <div className="font-semibold text-zinc-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Consumo direto de /api/resend/preview</span>
              </div>
              <p>
                O servidor gera o HTML responsivo oficial do e-mail com as 5 matérias mais relevantes do dia, incorporando o título e subtítulo acima.
              </p>
            </div>
          </div>

          {/* Iframe de Visualização em Tempo Real */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs pb-1">
              <span className="font-bold text-white flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-blue-400" />
                <span>Preview em Tempo Real (/api/resend/preview)</span>
              </span>
              <div className="inline-flex rounded-lg p-0.5 bg-[#0a0e17] border border-[#182136] text-[10px]">
                <button
                  type="button"
                  onClick={() => setPreviewDevice('desktop')}
                  className={`px-2 py-0.5 rounded ${previewDevice === 'desktop' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-500'}`}
                >
                  Desktop
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewDevice('mobile')}
                  className={`px-2 py-0.5 rounded ${previewDevice === 'mobile' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-500'}`}
                >
                  Mobile
                </button>
              </div>
            </div>

            <div
              className={`mx-auto rounded-xl border border-zinc-700 bg-white shadow-2xl overflow-hidden transition-all ${
                previewDevice === 'mobile' ? 'max-w-[380px] h-[480px]' : 'w-full h-[480px]'
              }`}
            >
              {isLoadingPreview ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[#0a0e17] text-zinc-400 gap-2 text-xs">
                  <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
                  <span>Gerando preview via Resend...</span>
                </div>
              ) : previewHtml ? (
                <iframe
                  title="Resend Preview"
                  srcDoc={previewHtml}
                  className="w-full h-full border-0"
                  sandbox="allow-same-origin"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-[#0a0e17] text-zinc-500 text-xs">
                  Nenhum preview carregado. Clique em "Atualizar Preview".
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ================= SEÇÃO 2: WEBHOOKS RECENTES DO RESEND (/api/resend/webhook) ================= */}
      <div className="p-4 sm:p-6 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#182136]">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{t('admin.webhooksTitle')}</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              {t('admin.webhooksSubtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleSimulateWebhook('delivered')}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold cursor-pointer transition"
              title="Simula recebimento de evento delivered"
            >
              + Simular Entrega
            </button>
            <button
              type="button"
              onClick={() => handleSimulateWebhook('opened')}
              className="px-2.5 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300 text-xs font-semibold cursor-pointer transition"
              title="Simula recebimento de evento opened"
            >
              + Simular Abertura
            </button>
            <button
              type="button"
              onClick={() => handleSimulateWebhook('clicked')}
              className="px-2.5 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-xs font-semibold cursor-pointer transition"
              title="Simula recebimento de evento clicked"
            >
              + Simular Clique
            </button>
            <button
              type="button"
              onClick={fetchWebhooks}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer transition"
              title="Recarregar webhooks"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingWebhooks ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Métricas Consolidadas de Webhooks */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-emerald-500/20">
            <div className="text-[10px] font-mono uppercase text-emerald-400 flex items-center justify-between">
              <span>{t('admin.delivered')}</span>
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{webhookStats.delivered}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-blue-500/20">
            <div className="text-[10px] font-mono uppercase text-blue-400 flex items-center justify-between">
              <span>{t('admin.opened')}</span>
              <Eye className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{webhookStats.opened}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-purple-500/20">
            <div className="text-[10px] font-mono uppercase text-purple-400 flex items-center justify-between">
              <span>{t('admin.clicked')}</span>
              <MousePointerClick className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{webhookStats.clicked}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-amber-500/20">
            <div className="text-[10px] font-mono uppercase text-amber-400 flex items-center justify-between">
              <span>{t('admin.bounced')}</span>
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{webhookStats.bounced}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-red-500/20">
            <div className="text-[10px] font-mono uppercase text-red-400 flex items-center justify-between">
              <span>{t('admin.complained')}</span>
              <Inbox className="w-3.5 h-3.5" />
            </div>
            <div className="text-xl font-bold text-white mt-1">{webhookStats.complained}</div>
          </div>
        </div>

        {/* Filtros da Tabela de Webhooks */}
        <div className="flex items-center gap-2 pt-1 border-t border-[#182136]">
          <span className="text-[11px] text-zinc-400 mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Filtrar:
          </span>
          {(['all', 'delivered', 'opened', 'clicked', 'bounced'] as const).map((filterKey) => (
            <button
              key={filterKey}
              type="button"
              onClick={() => setWebhookFilter(filterKey)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition ${
                webhookFilter === filterKey
                  ? 'bg-zinc-800 text-white border border-zinc-600'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {filterKey === 'all' ? 'Todos' : filterKey.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Tabela de Eventos Recentes */}
        <div className="overflow-x-auto rounded-xl border border-[#182136] bg-[#0a0e17]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#182136] text-[10px] text-zinc-400 uppercase font-mono bg-[#0c101c]">
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">{t('admin.recipient')}</th>
                <th className="py-2.5 px-3">Assunto</th>
                <th className="py-2.5 px-3">{t('admin.timestamp')}</th>
                <th className="py-2.5 px-3 text-right">Detalhe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141b2c]">
              {filteredWebhooks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500 text-xs font-mono">
                    Nenhum evento de webhook recebido ainda. Utilize os botões acima para simular eventos de teste.
                  </td>
                </tr>
              ) : (
                filteredWebhooks.map((item) => {
                  const typeColors = {
                    delivered: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
                    opened: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
                    clicked: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
                    bounced: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                    complained: 'bg-red-500/15 text-red-400 border-red-500/30',
                    unknown: 'bg-zinc-800 text-zinc-400 border-zinc-700'
                  }[item.type] || 'bg-zinc-800 text-zinc-400 border-zinc-700';

                  return (
                    <tr key={item.id} className="hover:bg-[#121827]/40 transition">
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase font-bold ${typeColors}`}>
                          {item.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-white font-mono text-[11px] whitespace-nowrap">
                        {item.recipient}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-300 max-w-[220px] truncate">
                        {item.subject}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[10px] text-zinc-400 whitespace-nowrap">
                        {item.timestamp ? formatRelativeTime(item.timestamp) : '--'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[10px] text-zinc-500">
                        {item.link ? (
                          <span className="text-purple-400 truncate max-w-[120px] inline-block" title={item.link}>
                            link: {item.link.replace(/^https?:\/\//, '')}
                          </span>
                        ) : (
                          item.emailId.substring(0, 10)
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
