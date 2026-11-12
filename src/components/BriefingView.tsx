/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Event, UserSubscription } from '../types/sinal';
import {
  Sun,
  Moon,
  Clock,
  ChevronRight,
  Search,
  Settings,
  Mail,
  Check,
  Send,
  X,
  FileText,
  Calendar,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { resendService } from '../services/resendService';

interface BriefingItem {
  id: string;
  type: 'morning' | 'evening';
  title: string;
  description: string;
  eventsCount: number;
  readTime: string;
  timeFormatted: string;
  dateLabel: string;
  groupDate: string; // 'Hoje' | 'Ontem' | '3 de outubro de 2026'
  status: 'Pronto' | 'Enviado';
  bgImage: string;
}

interface BriefingViewProps {
  events?: Event[];
  subscription?: UserSubscription;
  onOpenEventDetail?: (event: Event) => void;
  onOpenBilling?: () => void;
  isSuperAdmin?: boolean;
}

// Imagens oficiais enviadas pelo usuário
const MORNING_IMG = '/assets/aistudio/Amanhecer_sobre_a_cidade__1__638f4414.png';
const EVENING_IMG = '/assets/aistudio/Horizonte_urbano_ao_anoitecer__2__4a1dd254.png';

// Tier 1: Cache estático em memória e pré-carregamento imediato no escopo do módulo (0ms de latência)
let preloadedBriefingImages: HTMLImageElement[] = [];
const BRIEFING_CACHE_KEY = 'fatosbr_briefing_editorial_cache_v2';
let memoryBriefingsCache: BriefingItem[] | null = null;

if (typeof window !== 'undefined') {
  try {
    const img1 = new Image();
    img1.src = MORNING_IMG;
    const img2 = new Image();
    img2.src = EVENING_IMG;
    preloadedBriefingImages = [img1, img2];
  } catch {}
}

export const BriefingView: React.FC<BriefingViewProps> = ({
  events = [],
  subscription,
  onOpenEventDetail,
  onOpenBilling
}) => {
  // Estados de filtro e busca
  const [activeFilter, setActiveFilter] = useState<'all' | 'morning' | 'evening' | 'preferences'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBriefing, setSelectedBriefing] = useState<BriefingItem | null>(null);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);

  // Preferências
  const [morningEnabled, setMorningEnabled] = useState(true);
  const [eveningEnabled, setEveningEnabled] = useState(true);
  const [morningTime, setMorningTime] = useState('07:00');
  const [eveningTime, setEveningTime] = useState('20:00');
  const [emailAddress, setEmailAddress] = useState('astryasuporte@gmail.com');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testCooldown, setTestCooldown] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Cooldown timer de 30s para o botão de teste de e-mail
  useEffect(() => {
    if (testCooldown <= 0) return;
    const interval = setInterval(() => {
      setTestCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [testCooldown]);

  // Pré-carregamento agressivo e hidratação imediata de preferências (0ms)
  useEffect(() => {
    if (preloadedBriefingImages.length === 0 && typeof window !== 'undefined') {
      const pre1 = new Image();
      pre1.src = MORNING_IMG;
      const pre2 = new Image();
      pre2.src = EVENING_IMG;
      preloadedBriefingImages = [pre1, pre2];
    }

    // Pré-carrega também imagens dos acontecimentos que compõem os briefings
    if (Array.isArray(events) && events.length > 0) {
      events.slice(0, 8).forEach((ev) => {
        if (ev.imageUrl) {
          const img = new Image();
          img.src = ev.imageUrl;
        }
      });
    }

    try {
      const saved = localStorage.getItem('fatosbr_briefing_prefs');
      if (saved) {
        const p = JSON.parse(saved);
        if (p.emailAddress) setEmailAddress(p.emailAddress);
        if (p.morningTime) setMorningTime(p.morningTime);
        if (p.eveningTime) setEveningTime(p.eveningTime);
        if (typeof p.morningEnabled === 'boolean') setMorningEnabled(p.morningEnabled);
        if (typeof p.eveningEnabled === 'boolean') setEveningEnabled(p.eveningEnabled);
      }
    } catch {}
  }, [events]);

  // Base estruturada de Briefings
  const briefingsData: BriefingItem[] = useMemo(() => [
    {
      id: 'briefing-today-evening',
      type: 'evening',
      title: 'Seu briefing da noite está pronto.',
      description: 'Veja o que realmente importou ao longo do dia e o que mudou.',
      eventsCount: 4,
      readTime: '2 min de leitura',
      timeFormatted: '20:12',
      dateLabel: 'Hoje · 20:12 · Pronto',
      groupDate: 'Hoje',
      status: 'Pronto',
      bgImage: EVENING_IMG
    },
    {
      id: 'briefing-today-morning',
      type: 'morning',
      title: 'Seu briefing da manhã está pronto.',
      description: 'Os principais acontecimentos das últimas horas, organizados e resumidos para você.',
      eventsCount: 6,
      readTime: '3 min de leitura',
      timeFormatted: '07:03',
      dateLabel: 'Hoje · 07:03 · Enviado',
      groupDate: 'Hoje',
      status: 'Enviado',
      bgImage: MORNING_IMG
    },
    {
      id: 'briefing-yesterday-evening',
      type: 'evening',
      title: 'Resumo da noite',
      description: 'O balanço dos mercados, geopolítica e tecnologia do fechamento de ontem.',
      eventsCount: 4,
      readTime: '2 min de leitura',
      timeFormatted: '20:12',
      dateLabel: 'Ontem · 20:12 · Enviado',
      groupDate: 'Ontem',
      status: 'Enviado',
      bgImage: EVENING_IMG
    },
    {
      id: 'briefing-yesterday-morning',
      type: 'morning',
      title: 'Resumo da manhã',
      description: 'As notícias que abriram os mercados globais e o panorama matinal do Brasil.',
      eventsCount: 6,
      readTime: '3 min de leitura',
      timeFormatted: '07:03',
      dateLabel: 'Ontem · 07:03 · Enviado',
      groupDate: 'Ontem',
      status: 'Enviado',
      bgImage: MORNING_IMG
    },
    {
      id: 'briefing-oct3-evening',
      type: 'evening',
      title: 'Resumo da noite',
      description: 'Consolidação de fatos com contexto analítico do final do dia.',
      eventsCount: 4,
      readTime: '2 min de leitura',
      timeFormatted: '20:12',
      dateLabel: '03 de out. de 2026 · 20:12 · Enviado',
      groupDate: '3 de outubro de 2026',
      status: 'Enviado',
      bgImage: EVENING_IMG
    },
    {
      id: 'briefing-oct3-morning',
      type: 'morning',
      title: 'Resumo da manhã',
      description: 'Radar executivo com as decisões mais estratégicas do amanhecer.',
      eventsCount: 6,
      readTime: '3 min de leitura',
      timeFormatted: '07:03',
      dateLabel: '03 de out. de 2026 · 07:03 · Enviado',
      groupDate: '3 de outubro de 2026',
      status: 'Enviado',
      bgImage: MORNING_IMG
    }
  ], [MORNING_IMG, EVENING_IMG]);

  // Filtragem
  const filteredBriefings = useMemo(() => {
    return briefingsData.filter((item) => {
      if (activeFilter === 'morning' && item.type !== 'morning') return false;
      if (activeFilter === 'evening' && item.type !== 'evening') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.groupDate.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [briefingsData, activeFilter, searchQuery]);

  // Agrupamento por Hoje, Ontem e datas anteriores
  const todayItems = filteredBriefings.filter((b) => b.groupDate === 'Hoje');
  const yesterdayItems = filteredBriefings.filter((b) => b.groupDate === 'Ontem');
  const pastDateItems = filteredBriefings.filter((b) => b.groupDate !== 'Hoje' && b.groupDate !== 'Ontem');

  // Envio de teste de e-mail (com cooldown de 30s e validação de e-mail)
  const handleSendTest = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailAddress || !emailRegex.test(emailAddress.trim())) {
      showToast('Por favor, informe um e-mail válido antes de testar.');
      return;
    }

    setIsSendingTest(true);
    try {
      const cleanEmail = emailAddress.trim();
      const res = await resendService.sendBriefing(
        cleanEmail,
        'FatosBR • Demonstração do Briefing Matinal',
        'Os principais acontecimentos das últimas horas, organizados e resumidos para você.'
      );
      if (res.success) {
        setTestCooldown(30);
        showToast(`E-mail de teste enviado para ${cleanEmail}!`);
      } else {
        // Se a API externa não estiver configurada no ambiente atual, informa graciosamente sem crash
        showToast(res.message || res.error || 'Não foi possível disparar o teste no momento.');
      }
    } catch {
      showToast('Serviço de e-mail temporariamente indisponível.');
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div className="w-full max-w-[1240px] mx-auto px-4 sm:px-8 py-6 sm:py-8 text-zinc-100 font-sans">
      {/* Toast Monocromático */}
      {toastMsg && (
        <div className="fixed top-5 right-5 z-50 bg-[#161820] border border-zinc-700 text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs flex items-center gap-2 animate-fade-in font-medium">
          <Check className="w-4 h-4 text-white" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ================= 1. CABEÇALHO (Título e Busca) ================= */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-1.5">
            Briefings
          </h1>
          <p className="text-sm text-zinc-400">
            Resumos do que realmente importa, direto no seu e-mail e aqui na FatosBR.
          </p>
        </div>

        {/* Campo de Busca */}
        <div className="relative w-full sm:w-72 shrink-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar briefings..."
            className="w-full bg-transparent border border-zinc-800 focus:border-zinc-500 rounded-full pl-10 pr-4 py-2 text-sm text-white placeholder-zinc-500 outline-none transition"
          />
        </div>
      </div>

      {/* ================= 2. FILTROS (Pílulas) ================= */}
      <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar pb-1 mb-8">
        <button
          onClick={() => setActiveFilter('all')}
          className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
            activeFilter === 'all'
              ? 'bg-white text-black shadow-sm'
              : 'bg-transparent text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700'
          }`}
        >
          Mais recentes
        </button>

        <button
          onClick={() => setActiveFilter('morning')}
          className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
            activeFilter === 'morning'
              ? 'bg-white text-black shadow-sm'
              : 'bg-transparent text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700'
          }`}
        >
          Manhã
        </button>

        <button
          onClick={() => setActiveFilter('evening')}
          className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
            activeFilter === 'evening'
              ? 'bg-white text-black shadow-sm'
              : 'bg-transparent text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700'
          }`}
        >
          Noite
        </button>

        <button
          onClick={() => setIsPreferencesOpen(true)}
          className="px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer bg-transparent text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 flex items-center gap-1.5"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Preferências</span>
        </button>
      </div>

      {/* ================= 3. GRID PRINCIPAL (Feed + Sidebar) ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 xl:gap-12 items-start">
        
        {/* COLUNA ESQUERDA: Feed de Briefings */}
        <div className="space-y-8 min-w-0">
          
          {/* SEÇÃO HOJE (Cards Hero) */}
          {todayItems.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-white mb-4">Hoje</h2>
              <div className="space-y-5">
                {todayItems.map((briefing) => (
                  <div
                    key={briefing.id}
                    className="relative rounded-2xl overflow-hidden border border-zinc-800/90 min-h-[220px] sm:min-h-[240px] flex flex-col justify-between p-6 sm:p-7 bg-zinc-950 bg-cover bg-center transition-all duration-300 hover:border-zinc-600 group shadow-xl"
                    style={{ backgroundImage: `url('${briefing.bgImage}')` }}
                  >
                    {/* Overlay escuro para legibilidade */}
                    <div className="absolute inset-0 bg-gradient-to-b from-[#09090b]/40 via-[#09090b]/75 to-[#09090b]/95 pointer-events-none" />

                    {/* Top: Tag + Status Badge */}
                    <div className="relative z-10 flex items-center justify-between gap-2 mb-4">
                      <span className="inline-flex items-center gap-2 text-xs font-medium text-zinc-200">
                        {briefing.type === 'evening' ? (
                          <Moon className="w-4 h-4 text-zinc-300" />
                        ) : (
                          <Sun className="w-4 h-4 text-zinc-300" />
                        )}
                        <span>{briefing.type === 'evening' ? 'Resumo da noite' : 'Resumo da manhã'}</span>
                      </span>

                      <span className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[#09090b]/80 border border-zinc-700/80 text-white backdrop-blur-md">
                        {briefing.status}
                      </span>
                    </div>

                    {/* Conteúdo Central */}
                    <div className="relative z-10 space-y-2 mb-6 max-w-xl">
                      <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-tight group-hover:text-zinc-100">
                        {briefing.title}
                      </h3>
                      <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed line-clamp-2">
                        {briefing.description}
                      </p>
                    </div>

                    {/* Bottom: Metadados + Botão Abrir */}
                    <div className="relative z-10 flex items-center justify-between gap-4 mt-auto">
                      <div className="flex items-center gap-3 sm:gap-4 text-xs text-zinc-400 font-medium flex-wrap">
                        <span className="inline-flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-zinc-400" />
                          <span>{briefing.eventsCount} acontecimentos</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-zinc-400" />
                          <span>{briefing.readTime}</span>
                        </span>
                        <span className="font-mono text-zinc-400 text-[11px]">
                          {briefing.timeFormatted}
                        </span>
                      </div>

                      <button
                        onClick={() => setSelectedBriefing(briefing)}
                        className="bg-white hover:bg-zinc-200 text-black px-4 py-2 sm:px-4.5 sm:py-2.5 rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 transition shrink-0 active:scale-95 shadow-md"
                        aria-label="Abrir briefing"
                      >
                        <span className="hidden sm:inline">Abrir briefing</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SEÇÃO ONTEM (Lista compacta com thumbnail) */}
          {yesterdayItems.length > 0 && (
            <div>
              <h2 className="text-base font-bold text-white mb-3">Ontem</h2>
              <div className="space-y-3">
                {yesterdayItems.map((briefing) => (
                  <div
                    key={briefing.id}
                    onClick={() => setSelectedBriefing(briefing)}
                    className="flex items-center bg-[#121215] hover:bg-[#18181b] border border-zinc-800/80 hover:border-zinc-700 rounded-xl p-3.5 sm:p-4 transition cursor-pointer group"
                  >
                    <img
                      src={briefing.bgImage}
                      alt={briefing.title}
                      className="w-14 h-14 rounded-lg object-cover mr-4 shrink-0 border border-zinc-800"
                    />
                    <div className="flex-1 min-w-0 pr-3">
                      <h4 className="text-sm font-semibold text-white mb-1 truncate group-hover:text-zinc-200">
                        {briefing.title}
                      </h4>
                      <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium flex-wrap">
                        <span>{briefing.eventsCount} acontecimentos</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span>{briefing.readTime}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600 hidden sm:inline" />
                        <span className="hidden sm:inline">{briefing.dateLabel}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-white transition shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SEÇÃO DATAS ANTERIORES */}
          {pastDateItems.length > 0 && (
            <div>
              <h2 className="text-base font-bold text-white mb-3">3 de outubro de 2026</h2>
              <div className="space-y-3">
                {pastDateItems.map((briefing) => (
                  <div
                    key={briefing.id}
                    onClick={() => setSelectedBriefing(briefing)}
                    className="flex items-center bg-[#121215] hover:bg-[#18181b] border border-zinc-800/80 hover:border-zinc-700 rounded-xl p-3.5 sm:p-4 transition cursor-pointer group"
                  >
                    <img
                      src={briefing.bgImage}
                      alt={briefing.title}
                      className="w-14 h-14 rounded-lg object-cover mr-4 shrink-0 border border-zinc-800"
                    />
                    <div className="flex-1 min-w-0 pr-3">
                      <h4 className="text-sm font-semibold text-white mb-1 truncate group-hover:text-zinc-200">
                        {briefing.title}
                      </h4>
                      <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium flex-wrap">
                        <span>{briefing.eventsCount} acontecimentos</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span>{briefing.readTime}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600 hidden sm:inline" />
                        <span className="hidden sm:inline">{briefing.dateLabel}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-white transition shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* COLUNA DIREITA: Widgets de Configuração (Desktop) */}
        <aside className="space-y-5">
          {/* Card Seus Briefings */}
          <div className="bg-[#121215] border border-zinc-800/80 rounded-2xl p-6 space-y-5">
            <div>
              <h3 className="text-sm sm:text-base font-semibold text-white mb-1">
                Seus briefings
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Escolha quando receber os resumos do que você acompanha.
              </p>
            </div>

            {/* Toggle Briefing da manhã */}
            <div className="flex items-center justify-between py-3 border-b border-zinc-800/60">
              <div className="flex items-center gap-3">
                <Sun className="w-4 h-4 text-zinc-400" />
                <div>
                  <h4 className="text-xs sm:text-sm font-medium text-white">Briefing da manhã</h4>
                  <p className="text-[11px] text-zinc-500 font-mono">{morningTime}</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={morningEnabled}
                  onChange={(e) => setMorningEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-black after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white peer-checked:after:bg-black" />
              </label>
            </div>

            {/* Toggle Briefing da noite */}
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <Moon className="w-4 h-4 text-zinc-400" />
                <div>
                  <h4 className="text-xs sm:text-sm font-medium text-white">Briefing da noite</h4>
                  <p className="text-[11px] text-zinc-500 font-mono">{eveningTime}</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={eveningEnabled}
                  onChange={(e) => setEveningEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-black after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white peer-checked:after:bg-black" />
              </label>
            </div>

            <div className="text-[11px] text-zinc-500 border-t border-zinc-800/60 pt-4 leading-relaxed font-mono">
              America/Sao Paulo · e-mail e leitura na FatosBR.
            </div>

            <button
              onClick={() => setIsPreferencesOpen(true)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/60 text-xs font-semibold text-white transition cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-zinc-400" />
                <span>Configurar preferências</span>
              </span>
              <ChevronRight className="w-4 h-4 text-zinc-500" />
            </button>
          </div>

          {/* Card Trial / Assinatura */}
          <div
            onClick={onOpenBilling}
            className="flex items-center gap-3 p-4 bg-[#121215] border border-zinc-800/80 rounded-2xl cursor-pointer hover:border-zinc-700 transition"
          >
            <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700/80 text-zinc-300">
              TRIAL
            </span>
            <div>
              <h4 className="text-xs font-semibold text-white">Teste grátis</h4>
              <p className="text-[11px] text-zinc-400">
                {subscription?.trialEndsAt
                  ? `Termina em ${new Date(subscription.trialEndsAt).toLocaleDateString('pt-BR')}`
                  : 'Termina em 11 de out. de 2026'}
              </p>
            </div>
          </div>
        </aside>

      </div>

      {/* ================= MODAL: LEITOR DE BRIEFING SELECIONADO ================= */}
      {selectedBriefing && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#0e0f14] border border-zinc-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Header do Modal com Capa */}
            <div
              className="relative p-6 bg-cover bg-center min-h-[160px] flex flex-col justify-between"
              style={{ backgroundImage: `url('${selectedBriefing.bgImage}')` }}
            >
              <div className="absolute inset-0 bg-black/75 pointer-events-none" />
              <div className="relative z-10 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-black/70 border border-zinc-700 text-white">
                  {selectedBriefing.type === 'evening' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                  <span>{selectedBriefing.type === 'evening' ? 'Resumo da noite' : 'Resumo da manhã'}</span>
                </span>

                <button
                  onClick={() => setSelectedBriefing(null)}
                  className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white cursor-pointer transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="relative z-10">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  {selectedBriefing.title}
                </h2>
                <p className="text-xs text-zinc-300 font-mono mt-1">
                  {selectedBriefing.dateLabel} · {selectedBriefing.readTime}
                </p>
              </div>
            </div>

            {/* Lista de acontecimentos do briefing */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1 divide-y divide-zinc-800/80">
              <div className="text-sm text-zinc-300 pb-2 leading-relaxed">
                {selectedBriefing.description}
              </div>

              {events.slice(0, selectedBriefing.eventsCount).map((ev, i) => (
                <div
                  key={ev.id}
                  onClick={() => {
                    setSelectedBriefing(null);
                    onOpenEventDetail?.(ev);
                  }}
                  className="pt-4 hover:bg-zinc-900/40 p-2.5 rounded-xl transition cursor-pointer group"
                >
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-300" />
                    <span className="uppercase">{ev.category}</span>
                    <span>·</span>
                    <span>{ev.sources?.length || 2} fontes apuradas</span>
                  </div>
                  <h4 className="text-sm font-bold text-white group-hover:text-zinc-200 transition leading-snug">
                    {ev.title}
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                    {ev.summary}
                  </p>
                </div>
              ))}
            </div>

            {/* Rodapé do Modal */}
            <div className="p-4 bg-[#0a0b0e] border-t border-zinc-800 flex items-center justify-between">
              <span className="text-xs text-zinc-400 font-mono">
                FatosBR • Edição oficial
              </span>
              <button
                onClick={() => setSelectedBriefing(null)}
                className="px-4 py-2 bg-white text-black text-xs font-semibold rounded-lg hover:bg-zinc-200 transition cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: CONFIGURAÇÃO DE PREFERÊNCIAS DE BRIEFINGS (V2.2) ================= */}
      {isPreferencesOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsPreferencesOpen(false);
          }}
        >
          <div
            className="bg-[#090a0d] border border-zinc-800/90 rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto no-scrollbar p-5 sm:p-6 shadow-2xl flex flex-col space-y-5 text-zinc-100"
            role="dialog"
            aria-modal="true"
            aria-labelledby="briefing-prefs-title"
          >
            {/* Cabeçalho do Modal */}
            <div className="flex items-start justify-between border-b border-zinc-800/80 pb-4">
              <div>
                <h3 id="briefing-prefs-title" className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Preferências de briefings
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1 leading-relaxed">
                  Escolha quando deseja receber seu resumo de notícias.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPreferencesOpen(false)}
                className="p-2 -mr-1 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Campo E-mail de Recebimento */}
            <div className="space-y-2">
              <label htmlFor="briefing-email" className="block text-xs font-semibold text-zinc-300">
                E-mail de recebimento
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="briefing-email"
                  type="email"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  className="w-full bg-[#121318] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-3.5 py-3 text-sm text-white placeholder-zinc-500 outline-none transition min-h-[44px]"
                  placeholder="seuemail@exemplo.com"
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Configuração dos Horários dos Briefings */}
            <div className="space-y-3 pt-1">
              {/* Briefing da manhã */}
              <div className="p-3.5 rounded-xl bg-[#111317] border border-zinc-800/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Sun className="w-4 h-4 text-zinc-300" />
                    <div>
                      <h4 className="text-xs sm:text-sm font-semibold text-white">Briefing da manhã</h4>
                      <p className="text-[11px] text-zinc-400">Destaques para iniciar o dia</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer min-h-[44px] min-w-[44px] justify-center">
                    <input
                      type="checkbox"
                      checked={morningEnabled}
                      onChange={(e) => setMorningEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-black after:content-[''] after:absolute after:top-[12px] after:left-[4px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-white peer-checked:after:bg-black" />
                  </label>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60">
                  <span className="text-xs text-zinc-400 font-medium">Horário de entrega</span>
                  <input
                    type="time"
                    value={morningTime}
                    disabled={!morningEnabled}
                    onChange={(e) => setMorningTime(e.target.value)}
                    className="bg-[#181a22] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-white outline-none focus:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px]"
                  />
                </div>
              </div>

              {/* Briefing da noite */}
              <div className="p-3.5 rounded-xl bg-[#111317] border border-zinc-800/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Moon className="w-4 h-4 text-zinc-400" />
                    <div>
                      <h4 className="text-xs sm:text-sm font-semibold text-white">Briefing da noite</h4>
                      <p className="text-[11px] text-zinc-400">Consolidação e fechamento dos mercados</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer min-h-[44px] min-w-[44px] justify-center">
                    <input
                      type="checkbox"
                      checked={eveningEnabled}
                      onChange={(e) => setEveningEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-black after:content-[''] after:absolute after:top-[12px] after:left-[4px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-white peer-checked:after:bg-black" />
                  </label>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60">
                  <span className="text-xs text-zinc-400 font-medium">Horário de entrega</span>
                  <input
                    type="time"
                    value={eveningTime}
                    disabled={!eveningEnabled}
                    onChange={(e) => setEveningTime(e.target.value)}
                    className="bg-[#181a22] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-white outline-none focus:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px]"
                  />
                </div>
              </div>
            </div>

            {/* Seção Secundária: Enviar e-mail de teste */}
            <div className="p-4 rounded-xl bg-[#111317] border border-zinc-800/80 space-y-3">
              <div>
                <h4 className="text-xs sm:text-sm font-semibold text-white">
                  Enviar e-mail de teste
                </h4>
                <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                  Receba uma prévia para conferir como seu briefing chegará.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSendTest}
                disabled={isSendingTest || testCooldown > 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-700/80 hover:border-zinc-500 bg-[#161820] hover:bg-[#1c1e27] text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
              >
                {isSendingTest ? (
                  <span>Enviando teste...</span>
                ) : testCooldown > 0 ? (
                  <span>Aguarde {testCooldown}s para reenviar</span>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 text-zinc-300" />
                    <span>Enviar teste</span>
                  </>
                )}
              </button>
            </div>

            {/* Rodapé: Salvar Preferências */}
            <div className="pt-2 flex items-center justify-end gap-3 border-t border-zinc-800/70">
              <button
                type="button"
                onClick={() => setIsPreferencesOpen(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-850 transition cursor-pointer min-h-[44px]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                  if (!emailAddress || !emailRegex.test(emailAddress.trim())) {
                    showToast('Por favor, informe um endereço de e-mail válido.');
                    return;
                  }
                  try {
                    const cleanEmail = emailAddress.trim();
                    const prefs = {
                      emailAddress: cleanEmail,
                      morningEnabled,
                      eveningEnabled,
                      morningTime,
                      eveningTime,
                      updatedAt: new Date().toISOString()
                    };
                    localStorage.setItem('fatosbr_briefing_prefs', JSON.stringify(prefs));
                    resendService.setStoredSubscriberEmail(cleanEmail);
                    window.dispatchEvent(new CustomEvent('fatosbr_briefing_prefs_updated'));
                    setIsPreferencesOpen(false);
                    showToast('Preferências salvas com sucesso!');
                  } catch {
                    showToast('Erro ao salvar preferências localmente.');
                  }
                }}
                className="px-5 py-2.5 bg-white hover:bg-zinc-200 text-black font-bold text-xs rounded-xl transition cursor-pointer min-h-[44px] shadow-sm active:scale-95"
              >
                Salvar preferências
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
