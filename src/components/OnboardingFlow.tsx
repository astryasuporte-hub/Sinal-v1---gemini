/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  ChevronLeft,
  Search,
  Check,
  Plus,
  Bell,
  Mail,
  Calendar,
  MessageSquare,
  MapPin,
  Globe,
  Sliders,
  Sparkles,
  Layers,
  ArrowRight,
  TrendingUp,
  Cpu,
  Building2,
  Landmark,
  Scale,
  Atom,
  HeartPulse,
  Trophy,
  Palette,
  Film,
  Leaf,
  GraduationCap,
  X,
  Download,
  Smartphone,
  Users
} from 'lucide-react';
import { Entity, Topic, Source } from '../types/sinal';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { searchBrazilLocations, BrazilLocation } from '../data/brazilLocations';

interface OnboardingFlowProps {
  onComplete: (themes?: string[]) => void;
  onOpenLogin?: () => void;
  entities?: Entity[];
  topics?: Topic[];
  sources?: Source[];
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  onComplete,
  onOpenLogin,
  entities = [],
  topics = [],
  sources = []
}) => {
  const [step, setStep] = useState<number>(1);
  const pwa = usePWAInstall();
  const [showIosGuide, setShowIosGuide] = useState<boolean>(false);

  // Autocomplete de Municípios e Estados do Brasil
  const [locationSuggestions, setLocationSuggestions] = useState<BrazilLocation[]>([]);
  const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false);

  // Tela 2: Temas selecionados
  const ALL_THEMES = useMemo(
    () => [
      { id: 'tech', label: 'Tecnologia', icon: Cpu },
      { id: 'business', label: 'Negócios', icon: Building2 },
      { id: 'politics', label: 'Política', icon: Landmark },
      { id: 'economy', label: 'Economia', icon: TrendingUp },
      { id: 'world', label: 'Mundo', icon: Globe },
      { id: 'science', label: 'Ciência', icon: Atom },
      { id: 'health', label: 'Saúde', icon: HeartPulse },
      { id: 'sports', label: 'Esportes', icon: Trophy },
      { id: 'culture', label: 'Cultura', icon: Palette },
      { id: 'entertainment', label: 'Entretenimento', icon: Film },
      { id: 'environment', label: 'Meio Ambiente', icon: Leaf },
      { id: 'education', label: 'Educação', icon: GraduationCap }
    ],
    []
  );

  const [selectedThemes, setSelectedThemes] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('fatosbr_user_interests');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return new Set(parsed);
        }
      }
    } catch {}
    return new Set(['tech', 'business', 'politics', 'economy', 'science']);
  });
  const [themeSearch, setThemeSearch] = useState('');

  const toggleTheme = (id: string) => {
    setSelectedThemes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        const arr = Array.from(next);
        localStorage.setItem('fatosbr_user_interests', JSON.stringify(arr));
        window.dispatchEvent(new CustomEvent('fatosbr_interests_updated', { detail: { interests: arr } }));
      } catch {}
      return next;
    });
  };

  // Tela 3: Seguir Pessoas, Empresas e Organizações
  const [activeFollowTab, setActiveFollowTab] = useState<'people' | 'companies' | 'organizations'>('people');
  const [entitySearch, setEntitySearch] = useState('');

  const PEOPLE_LIST = useMemo(
    () => [
      { id: 'p1', name: 'Elon Musk', handle: '@elonmusk', role: 'CEO Tesla / X', emoji: '👨‍💼', color: '#1e293b' },
      { id: 'p2', name: 'Sam Altman', handle: '@sama', role: 'CEO OpenAI', emoji: '🚀', color: '#0f172a' },
      { id: 'p3', name: 'Sundar Pichai', handle: '@sundarpichai', role: 'CEO Google', emoji: '🌐', color: '#172554' },
      { id: 'p4', name: 'Satya Nadella', handle: '@satyanadella', role: 'CEO Microsoft', emoji: '💻', color: '#1e1b4b' },
      { id: 'p5', name: 'Jair Bolsonaro', handle: '@jairbolsonaro', role: 'Político', emoji: '🇧🇷', color: '#14532d' },
      { id: 'p6', name: 'Fernando Haddad', handle: '@fernandohaddad', role: 'Ministro da Fazenda', emoji: '📊', color: '#7f1d1d' }
    ],
    []
  );

  const COMPANIES_LIST = useMemo(
    () => [
      { id: 'c1', name: 'NVIDIA', handle: '@nvidia', role: 'Semicondutores & IA', badge: 'NVDA', color: '#76b900' },
      { id: 'c2', name: 'X (Twitter)', handle: '@X', role: 'Plataforma Global', badge: 'X', color: '#000000' },
      { id: 'c3', name: 'Apple', handle: '@apple', role: 'Tecnologia & Hardware', badge: 'AAPL', color: '#27272a' },
      { id: 'c4', name: 'Microsoft', handle: '@microsoft', role: 'Cloud & Software', badge: 'MSFT', color: '#0284c7' },
      { id: 'c5', name: 'Google', handle: '@google', role: 'Search & IA', badge: 'GOOG', color: '#ea4335' },
      { id: 'c6', name: 'Petrobras', handle: '@petrobras', role: 'Energia & Petróleo', badge: 'PETR4', color: '#16a34a' }
    ],
    []
  );

  const ORGANIZATIONS_LIST = useMemo(
    () => [
      { id: 'o1', name: 'BBC News Brasil', handle: '@bbcbrasil', role: 'Veículo Internacional', badge: 'BBC', color: '#b91c1c' },
      { id: 'o2', name: 'Banco Central do Brasil', handle: '@bancocentralbr', role: 'Autoridade Monetária', badge: 'BACEN', color: '#1e3a8a' },
      { id: 'o3', name: 'The Verge', handle: '@verge', role: 'Tecnologia & Inovação', badge: 'VERGE', color: '#9333ea' },
      { id: 'o4', name: 'Reuters', handle: '@reuters', role: 'Agência de Notícias', badge: 'RT', color: '#ea580c' },
      { id: 'o5', name: 'Supremo Tribunal Federal', handle: '@stf_oficial', role: 'Poder Judiciário', badge: 'STF', color: '#334155' }
    ],
    []
  );

  const [followedEntities, setFollowedEntities] = useState<Set<string>>(
    new Set(['p1', 'c1', 'o1'])
  );

  const toggleFollow = (id: string) => {
    setFollowedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Tela 4: Notificações
  const [notificationsPreferences, setNotificationsPreferences] = useState<Set<string>>(
    new Set(['app_realtime', 'daily_email'])
  );

  const toggleNotification = (id: string) => {
    setNotificationsPreferences((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Tela 5: Personalize seu Feed
  const [feedPreferences, setFeedPreferences] = useState<Set<string>>(
    new Set(['realtime_news', 'analyses_context', 'trusted_sources'])
  );

  const toggleFeedPref = (id: string) => {
    setFeedPreferences((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Tela 6: Localização
  const [userLocation, setUserLocation] = useState('São Paulo, SP');
  const [userLanguage, setUserLanguage] = useState('Português (Brasil)');

  // Progresso global
  const progressPercent = Math.round((step / 7) * 100);

  const nextStep = () => {
    if (step < 7) {
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      try {
        localStorage.setItem('fatosbr_session_active', 'true');
        localStorage.setItem('fatosbr_user_region', userLocation);
      } catch {}
      onComplete();
    }
  };

  const prevStep = () => {
    if (step > 1) {
      setStep(step - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#000000] text-zinc-100 flex flex-col items-center justify-between font-sans selection:bg-white selection:text-black relative overflow-x-hidden">
      {/* Background glow sutil para desktop */}
      <div
        className="fixed inset-0 pointer-events-none opacity-30 z-0"
        style={{
          background: 'radial-gradient(circle at 50% 10%, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.98) 75%)'
        }}
      />

      {/* Top Bar Fixa com Indicador e Botão Voltar (Visível nas etapas 2 a 6) */}
      {step > 1 && step < 7 && (
        <div className="relative z-20 w-full max-w-lg lg:max-w-xl mx-auto px-5 pt-4 pb-2 flex items-center justify-between">
          <button
            onClick={prevStep}
            className="p-2 -ml-2 text-zinc-400 hover:text-white rounded-xl transition cursor-pointer flex items-center gap-1.5 text-xs font-medium"
            aria-label="Voltar etapa"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="hidden sm:inline">Voltar</span>
          </button>

          {/* Logo Central Minimalista */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <svg
                className="w-3.5 h-3.5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="2 12 6 12 9 3 13 21 16 12 22 12" />
              </svg>
            </div>
            <span className="font-bold text-xs tracking-tight text-white">FatosBR</span>
          </div>

          {/* Indicador de Etapa Numérica */}
          <div className="font-mono text-xs text-zinc-400 font-semibold px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800">
            {step}/7
          </div>
        </div>
      )}

      {/* Container Principal Centralizado (Otimizado para Mobile e PC) */}
      <main className="relative z-10 w-full max-w-lg lg:max-w-xl mx-auto flex-1 flex flex-col justify-between px-4 sm:px-6 py-2 sm:py-3">
        {/* Notificação Deslizante (Toast Premium) de Instalação do PWA FatosBR */}
        {!pwa.isInstalled && !pwa.isDismissed && (
          <div className="w-full mb-3 p-3 sm:p-3.5 rounded-2xl bg-gradient-to-r from-[#12141c]/95 via-[#181a24]/95 to-[#12141c]/95 border border-zinc-700/80 backdrop-blur-md flex items-center justify-between gap-3 shadow-2xl animate-fadeIn transition-all">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-black flex items-center justify-center shrink-0 border border-zinc-700 overflow-hidden shadow-sm">
                <img
                  src="/pwa-icon-192.png"
                  alt="FatosBR"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold text-white truncate flex items-center gap-1.5">
                  <span>Instalar FatosBR</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/10 text-zinc-300 font-mono font-medium">App</span>
                </div>
                <div className="text-[11px] text-zinc-400 truncate">Instale direto pelo navegador sem ocupar espaço</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  if (pwa.isIOS) {
                    setShowIosGuide(true);
                    return;
                  }
                  if (pwa.isInstallable) {
                    const res = await pwa.install();
                    if (res) return;
                  }
                  setShowIosGuide(true);
                }}
                className="px-3.5 py-1.5 bg-white text-black text-xs font-bold rounded-xl hover:bg-zinc-200 transition cursor-pointer active:scale-95 shadow-sm"
              >
                Instalar Agora
              </button>
              <button
                type="button"
                onClick={pwa.dismiss}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg transition cursor-pointer"
                title="Agora não"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* ETAPA 1: HERO BOAS-VINDAS (FIGMA MOCKUP SCREEN 1) */}
        {/* ========================================================================= */}
        {step === 1 && (
          <div className="flex-1 flex flex-col justify-between animate-fadeIn py-2 min-h-[calc(100vh-60px)] sm:min-h-[720px] max-w-sm sm:max-w-md mx-auto w-full">
            {/* Top Logo FatosBR Centralizado */}
            <div className="pt-3 pb-2 flex items-center justify-center gap-2">
              <svg
                className="w-7 h-7 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="2 12 6 12 9 3 13 21 16 12 22 12" />
              </svg>
              <span className="font-bold text-2xl tracking-tight text-white">FatosBR</span>
            </div>

            {/* Imagem do Globo com Halo Radial Centralizado */}
            <div className="relative w-full aspect-[4/3] max-h-[300px] my-auto flex items-center justify-center overflow-hidden">
              <div
                className="absolute inset-0 pointer-events-none opacity-40"
                style={{
                  background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0) 70%)'
                }}
              />
              <img
                src="/assets/aistudio/file_00000000d9dc820eb1300938edc857d3_8a6e1430.png"
                alt="FatosBR - Observatório Global"
                className="w-full h-full object-contain object-center scale-[1.08] relative z-10"
              />
            </div>

            {/* Headline e Subtítulo Centralizados Conforme Figma */}
            <div className="text-center px-2 space-y-3 pb-4">
              <h1 className="text-[30px] sm:text-[34px] font-bold text-white tracking-tight leading-[1.2]">
                O que importa para você, sempre à frente.
              </h1>
              <p className="text-[14px] sm:text-[15px] text-[#a1a1aa] leading-relaxed max-w-xs mx-auto">
                A FatosBR observa o mundo por você, reunindo os acontecimentos mais relevantes em um só lugar.
              </p>
            </div>

            {/* Ações Inferiores: Botão Começar + Link de Login + Progresso 1/7 */}
            <div className="pt-2 pb-3 space-y-3 w-full">
              <button
                type="button"
                onClick={nextStep}
                className="w-full py-4 px-6 bg-white text-black hover:bg-zinc-100 font-semibold text-base rounded-full transition cursor-pointer active:scale-[0.99] shadow-lg shadow-white/10"
              >
                Começar
              </button>

              {onOpenLogin && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={onOpenLogin}
                    className="text-sm text-[#8e8e93] hover:text-white transition cursor-pointer"
                  >
                    Já tem uma conta? <span className="text-zinc-200 underline font-medium">Entrar</span>
                  </button>
                </div>
              )}

              {/* Indicador 1/7 e Barra de Progresso no Rodapé */}
              <div className="pt-3 space-y-2">
                <div className="text-center font-mono text-[12px] text-[#8e8e93]">
                  1/7
                </div>
                <div className="w-full h-1 bg-[#2c2c2e] rounded-full overflow-hidden">
                  <div className="h-full bg-white rounded-full w-[14.28%]" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* ETAPA 2: INTERESSES (TEMAS) */}
        {/* ========================================================================= */}
        {step === 2 && (
          <div className="flex-1 flex flex-col animate-fadeIn py-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                O que te interessa?
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1.5 mb-5">
                Escolha os temas de seu interesse. O seu feed &quot;Para você&quot; exibirá exatamente as notícias dessas categorias.
              </p>

              {/* Barra de Busca de Temas */}
              <div className="relative mb-5">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  value={themeSearch}
                  onChange={(e) => setThemeSearch(e.target.value)}
                  placeholder="Buscar temas..."
                  className="w-full bg-[#12141a] border border-zinc-800 focus:border-zinc-600 rounded-xl pl-10 pr-4 py-2.5 text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none transition"
                />
              </div>

              {/* Grid de Cards de Temas */}
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 max-h-[50vh] overflow-y-auto pr-1">
                {ALL_THEMES.filter((t) => t.label.toLowerCase().includes(themeSearch.toLowerCase())).map((theme) => {
                  const Icon = theme.icon;
                  const isSelected = selectedThemes.has(theme.id);
                  return (
                    <div
                      key={theme.id}
                      onClick={() => toggleTheme(theme.id)}
                      className={`relative p-3.5 sm:p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 active:scale-[0.98] ${
                        isSelected
                          ? 'bg-[#181a20] border-white shadow-md'
                          : 'bg-[#0f1116] border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <Icon className={`w-5 h-5 ${isSelected ? 'text-white' : 'text-zinc-400'}`} />
                        <div
                          className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                            isSelected ? 'bg-white border-white' : 'border-zinc-700 bg-transparent'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 text-black stroke-[3]" />}
                        </div>
                      </div>
                      <span className="text-xs sm:text-sm font-semibold text-zinc-100">{theme.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Ações Inferiores Etapa 2 */}
            <div className="pt-6 pb-4">
              <button
                onClick={nextStep}
                disabled={selectedThemes.size === 0}
                className="w-full py-4 px-6 bg-white text-black hover:bg-zinc-200 font-bold text-sm sm:text-base rounded-full transition cursor-pointer active:scale-[0.99] disabled:opacity-50"
              >
                Continuar ({selectedThemes.size} selecionados)
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* ETAPA 3: QUEM VOCÊ QUER SEGUIR */}
        {/* ========================================================================= */}
        {step === 3 && (
          <div className="flex-1 flex flex-col animate-fadeIn py-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Quem você quer seguir?
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1.5 mb-4">
                Escolha pessoas, empresas e organizações para acompanhar.
              </p>

              {/* Barra de Busca de Entidades */}
              <div className="relative mb-4">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  value={entitySearch}
                  onChange={(e) => setEntitySearch(e.target.value)}
                  placeholder="Buscar pessoas, empresas..."
                  className="w-full bg-[#12141a] border border-zinc-800 focus:border-zinc-600 rounded-xl pl-10 pr-4 py-2.5 text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none transition"
                />
              </div>

              {/* Tabs de Seleção */}
              <div className="flex p-1 bg-[#12141a] border border-zinc-800 rounded-full mb-4">
                {(['people', 'companies', 'organizations'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveFollowTab(tab)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-full transition cursor-pointer ${
                      activeFollowTab === tab ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {tab === 'people' ? 'Pessoas' : tab === 'companies' ? 'Empresas' : 'Organizações'}
                  </button>
                ))}
              </div>

              {/* Lista com Follow Toggles */}
              <div className="space-y-2 max-h-[48vh] overflow-y-auto pr-1">
                {(activeFollowTab === 'people'
                  ? PEOPLE_LIST
                  : activeFollowTab === 'companies'
                  ? COMPANIES_LIST
                  : ORGANIZATIONS_LIST
                )
                  .filter((item) => item.name.toLowerCase().includes(entitySearch.toLowerCase()))
                  .map((item) => {
                    const isFollowed = followedEntities.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3 rounded-2xl bg-[#0f1116] border border-zinc-800 hover:border-zinc-700 transition"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 border border-zinc-700/60"
                            style={{ backgroundColor: item.color, color: '#fff' }}
                          >
                            <span>{'badge' in item ? item.badge : item.emoji}</span>
                          </div>
                          <div>
                            <div className="text-xs sm:text-sm font-semibold text-white">{item.name}</div>
                            <div className="text-[11px] text-zinc-400">
                              {item.handle} · <span className="text-zinc-500">{item.role}</span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => toggleFollow(item.id)}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer shrink-0 border ${
                            isFollowed
                              ? 'bg-white text-black border-white'
                              : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:text-white'
                          }`}
                        >
                          {isFollowed ? <Check className="w-4 h-4 stroke-[3]" /> : <Plus className="w-4 h-4" />}
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Ações Inferiores Etapa 3 */}
            <div className="pt-6 pb-4">
              <button
                onClick={nextStep}
                className="w-full py-4 px-6 bg-white text-black hover:bg-zinc-200 font-bold text-sm sm:text-base rounded-full transition cursor-pointer active:scale-[0.99]"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* ETAPA 4: NOTIFICAÇÕES */}
        {/* ========================================================================= */}
        {step === 4 && (
          <div className="flex-1 flex flex-col animate-fadeIn py-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Como você quer receber as atualizações?
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1.5 mb-5">
                Escolha como prefere acompanhar os principais acontecimentos.
              </p>

              <div className="space-y-3">
                {[
                  {
                    id: 'app_realtime',
                    title: 'Notificações no app',
                    desc: 'Em tempo real, direto no seu celular.',
                    icon: Bell
                  },
                  {
                    id: 'daily_email',
                    title: 'E-mail diário',
                    desc: 'Resumo dos principais eventos matinais.',
                    icon: Mail
                  },
                  {
                    id: 'weekly_email',
                    title: 'E-mail semanal',
                    desc: 'Uma visão geral analítica da semana.',
                    icon: Calendar
                  },
                  {
                    id: 'whatsapp_digest',
                    title: 'Resumo por WhatsApp',
                    desc: 'Em breve para assinantes FatosBR Pro.',
                    icon: MessageSquare,
                    badge: 'Em breve'
                  }
                ].map((item) => {
                  const Icon = item.icon;
                  const isSelected = notificationsPreferences.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleNotification(item.id)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                        isSelected
                          ? 'bg-[#181a20] border-white'
                          : 'bg-[#0f1116] border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-start gap-3.5">
                        <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${isSelected ? 'text-white' : 'text-zinc-400'}`} />
                        <div>
                          <div className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
                            <span>{item.title}</span>
                            {item.badge && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{item.desc}</p>
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                          isSelected ? 'bg-white border-white' : 'border-zinc-700 bg-transparent'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-black stroke-[3]" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Ações Inferiores Etapa 4 */}
            <div className="pt-6 pb-4">
              <button
                onClick={nextStep}
                className="w-full py-4 px-6 bg-white text-black hover:bg-zinc-200 font-bold text-sm sm:text-base rounded-full transition cursor-pointer active:scale-[0.99]"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* ETAPA 5: PERSONALIZE SEU FEED */}
        {/* ========================================================================= */}
        {step === 5 && (
          <div className="flex-1 flex flex-col animate-fadeIn py-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Personalize seu feed
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1.5 mb-5">
                Escolha o que mais te interessa para que a FatosBR priorize os eventos certos.
              </p>

              <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
                {[
                  {
                    id: 'realtime_news',
                    title: 'Notícias em tempo real',
                    desc: 'Acontecimentos do momento com consolidação contínua.'
                  },
                  {
                    id: 'analyses_context',
                    title: 'Análises e contextos',
                    desc: 'Entenda o porquê de tudo e impactos estratégicos.'
                  },
                  {
                    id: 'trusted_sources',
                    title: 'Fontes confiáveis',
                    desc: 'Veículos consagrados e jornalismo investigativo verificado.'
                  },
                  {
                    id: 'events_trends',
                    title: 'Eventos e tendências',
                    desc: 'O que está ganhando tração e discussões em alta.'
                  },
                  {
                    id: 'markets_investments',
                    title: 'Mercado e investimentos',
                    desc: 'Bolsas, balanços, câmbio e movimentos financeiros.'
                  },
                  {
                    id: 'innovation_ai',
                    title: 'Inovação e tecnologia',
                    desc: 'Inteligência Artificial, ciência aplicada e futuro digital.'
                  }
                ].map((item) => {
                  const isSelected = feedPreferences.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleFeedPref(item.id)}
                      className={`p-3.5 sm:p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-[#181a20] border-white'
                          : 'bg-[#0f1116] border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div>
                        <div className="text-xs sm:text-sm font-semibold text-white">{item.title}</div>
                        <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5">{item.desc}</p>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                          isSelected ? 'bg-white border-white' : 'border-zinc-700 bg-transparent'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-black stroke-[3]" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Ações Inferiores Etapa 5 */}
            <div className="pt-6 pb-4">
              <button
                onClick={nextStep}
                className="w-full py-4 px-6 bg-white text-black hover:bg-zinc-200 font-bold text-sm sm:text-base rounded-full transition cursor-pointer active:scale-[0.99]"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* ETAPA 6: ONDE VOCÊ ESTÁ */}
        {/* ========================================================================= */}
        {step === 6 && (
          <div className="flex-1 flex flex-col animate-fadeIn py-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Onde você está?
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1.5 mb-6">
                Isso ajuda a mostrar notícias e acontecimentos mais relevantes para a sua região.
              </p>

              <div className="space-y-5">
                <div className="relative">
                  <label className="block text-xs font-semibold text-zinc-300 mb-2">
                    Sua cidade ou estado no Brasil
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      value={userLocation}
                      onFocus={() => {
                        const results = searchBrazilLocations(userLocation || 'g', 10);
                        setLocationSuggestions(results);
                        setIsLocationDropdownOpen(true);
                      }}
                      onChange={(e) => {
                        const val = e.target.value;
                        setUserLocation(val);
                        if (val.trim().length > 0) {
                          const results = searchBrazilLocations(val, 12);
                          setLocationSuggestions(results);
                          setIsLocationDropdownOpen(true);
                        } else {
                          const results = searchBrazilLocations('g', 10);
                          setLocationSuggestions(results);
                          setIsLocationDropdownOpen(true);
                        }
                      }}
                      placeholder="Comece a digitar (ex: Goiânia, Goiás, Guarulhos...)"
                      className="w-full bg-[#12141a] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-10 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition shadow-sm"
                    />
                    {userLocation && (
                      <button
                        type="button"
                        onClick={() => {
                          setUserLocation('');
                          setLocationSuggestions(searchBrazilLocations('g', 8));
                          setIsLocationDropdownOpen(true);
                        }}
                        className="absolute right-3.5 top-3.5 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Dropdown de sugestões dinâmicas de estados e municípios */}
                  {isLocationDropdownOpen && locationSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 z-30 max-h-56 overflow-y-auto rounded-xl bg-[#0e1015] border border-zinc-700/80 shadow-2xl p-1.5 space-y-1">
                      <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500 flex items-center justify-between">
                        <span>Resultados Encontrados</span>
                        <span>{locationSuggestions.length} locais</span>
                      </div>
                      {locationSuggestions.map((loc, idx) => (
                        <div
                          key={`${loc.name}-${loc.uf}-${idx}`}
                          onClick={() => {
                            setUserLocation(loc.displayName);
                            setIsLocationDropdownOpen(false);
                          }}
                          className="px-3 py-2 rounded-lg hover:bg-zinc-800/80 cursor-pointer flex items-center justify-between text-xs text-zinc-200 hover:text-white transition group"
                        >
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white shrink-0" />
                            <span className="font-medium">{loc.displayName}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 group-hover:text-zinc-200">
                              {loc.uf}
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded uppercase font-semibold bg-white/10 text-zinc-300">
                              {loc.type}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Sugestões rápidas de capitais brasileiras */}
                  <div className="pt-2">
                    <span className="text-[11px] text-zinc-500 mr-2">Sugestões rápidas:</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {['São Paulo, SP', 'Rio de Janeiro, RJ', 'Goiânia, GO', 'Brasília, DF', 'Belo Horizonte, MG', 'Curitiba, PR'].map((cap) => (
                        <button
                          key={cap}
                          type="button"
                          onClick={() => {
                            setUserLocation(cap);
                            setIsLocationDropdownOpen(false);
                          }}
                          className={`text-[11px] px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                            userLocation === cap
                              ? 'bg-white text-black border-white font-semibold'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
                          }`}
                        >
                          {cap}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-2">
                    Idioma principal
                  </label>
                  <div className="relative">
                    <Globe className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      readOnly
                      value={userLanguage}
                      className="w-full bg-[#12141a] border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm text-zinc-300 cursor-not-allowed select-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Ações Inferiores Etapa 6 */}
            <div className="pt-6 pb-4">
              <button
                onClick={nextStep}
                className="w-full py-4 px-6 bg-white text-black hover:bg-zinc-200 font-bold text-sm sm:text-base rounded-full transition cursor-pointer active:scale-[0.99]"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* ETAPA 7: TUDO PRONTO (FIGMA MOCKUP SCREEN 7) */}
        {/* ========================================================================= */}
        {step === 7 && (
          <div className="flex-1 flex flex-col justify-between animate-fadeIn py-2 min-h-[calc(100vh-60px)] sm:min-h-[720px] max-w-sm sm:max-w-md mx-auto w-full">
            <div>
              {/* Botão Voltar no Canto Superior Esquerdo Conforme Figma */}
              <div className="pt-1 pb-3 flex items-center justify-start">
                <button
                  type="button"
                  onClick={prevStep}
                  className="p-2 -ml-2 text-white hover:text-zinc-300 rounded-lg transition cursor-pointer"
                  aria-label="Voltar etapa anterior"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              </div>

              {/* Título e Subtítulo Conforme Figma */}
              <div className="text-left space-y-2 pb-4">
                <h1 className="text-[28px] font-bold text-white tracking-tight leading-tight">
                  Tudo pronto!
                </h1>
                <p className="text-[15px] text-[#8e8e93] leading-relaxed">
                  Agora é só explorar. Seu feed já está personalizado com base nas suas escolhas.
                </p>
              </div>

              {/* Glowing Check Circle Conforme Figma (.check-placeholder) */}
              <div className="relative my-6 flex items-center justify-center">
                <div className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-full border-2 border-white/80 flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.4),inset_0_0_20px_rgba(255,255,255,0.2)]">
                  {/* Feixes de luz horizontais / diagonais */}
                  <div className="absolute w-[160%] h-[1px] bg-gradient-to-r from-transparent via-white/70 to-transparent -rotate-[10deg] pointer-events-none" />
                  <div className="absolute w-[160%] h-[1px] bg-gradient-to-r from-transparent via-white/70 to-transparent rotate-[10deg] pointer-events-none" />
                  
                  {/* Ícone de Check Glow */}
                  <svg
                    className="w-16 h-16 sm:w-20 sm:h-20 text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.85)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>

              {/* Summary Box Conforme Figma (.summary-box) */}
              <div className="w-full rounded-[24px] bg-[#121212] border border-[#2c2c2e] p-5 space-y-4 text-left shadow-xl">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2.5 text-[#8e8e93]">
                    <Sliders className="w-4 h-4 text-[#8e8e93]" />
                    <span>Temas selecionados</span>
                  </div>
                  <span className="font-medium text-[#a1a1aa] font-mono">
                    +{selectedThemes.size || 5}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2.5 text-[#8e8e93]">
                    <Users className="w-4 h-4 text-[#8e8e93]" />
                    <span>Pessoas e empresas</span>
                  </div>
                  <span className="font-medium text-[#a1a1aa] font-mono">
                    +{followedEntities.size || 3}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2.5 text-[#8e8e93]">
                    <Bell className="w-4 h-4 text-[#8e8e93]" />
                    <span>Notificações ativas</span>
                  </div>
                  <span className="font-medium text-[#a1a1aa] font-mono">
                    +{notificationsPreferences.size || 2}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2.5 text-[#8e8e93]">
                    <MapPin className="w-4 h-4 text-[#8e8e93]" />
                    <span>Localização definida</span>
                  </div>
                  <span className="font-medium text-white">
                    {userLocation || 'São Paulo, SP'}
                  </span>
                </div>
              </div>
            </div>

            {/* Ações Inferiores Etapa 7: Botão + Indicador 7/7 + Barra 100% */}
            <div className="pt-4 pb-2 space-y-3 w-full">
              <button
                type="button"
                onClick={() => {
                  const arr = Array.from(selectedThemes);
                  try {
                    localStorage.setItem('fatosbr_user_interests', JSON.stringify(arr));
                    window.dispatchEvent(new CustomEvent('fatosbr_interests_updated', { detail: { interests: arr } }));
                  } catch {}
                  onComplete(arr);
                }}
                className="w-full py-4 px-6 bg-white text-black hover:bg-zinc-100 font-semibold text-base rounded-full transition cursor-pointer active:scale-[0.99] shadow-lg shadow-white/10"
              >
                Acessar a FatosBR
              </button>

              <div className="pt-2 space-y-2">
                <div className="text-center font-mono text-[12px] text-[#8e8e93]">
                  7/7
                </div>
                <div className="w-full h-1 bg-[#2c2c2e] rounded-full overflow-hidden">
                  <div className="h-full bg-white rounded-full w-full" />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Barra de Progresso Global no Rodapé (Exclusivo para Etapas Intermediárias 2 a 6) */}
      {step > 1 && step < 7 && (
        <footer className="relative z-20 w-full max-w-lg lg:max-w-xl mx-auto px-5 pb-5 pt-1">
          <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800/50">
            <div
              className="h-full bg-white transition-all duration-300 ease-out rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </footer>
      )}

      {/* Modal Guia de Instalação para iOS Safari */}
      {showIosGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0e1015] p-6 text-zinc-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-white" />
                <h3 className="text-sm font-bold text-white">Instalar no iPhone / iPad</h3>
              </div>
              <button
                onClick={() => setShowIosGuide(false)}
                className="p-1 text-zinc-400 hover:text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              O Safari do iOS não exibe botão de instalação automática. Siga os 2 passos rápidos:
            </p>

            <div className="space-y-3 text-xs">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="w-5 h-5 rounded-full bg-white text-black font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                  1
                </span>
                <span className="text-zinc-300">
                  Toque no botão <strong className="text-white">Compartilhar</strong> (ícone de quadrado com seta para cima na barra inferior do Safari).
                </span>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                <span className="w-5 h-5 rounded-full bg-white text-black font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                  2
                </span>
                <span className="text-zinc-300">
                  Role para baixo e selecione <strong className="text-white">"Adicionar à Tela de Início"</strong>.
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowIosGuide(false)}
              className="w-full py-2.5 bg-white text-black text-xs font-bold rounded-xl hover:bg-zinc-200 transition cursor-pointer"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
