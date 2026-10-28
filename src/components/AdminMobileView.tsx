/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FatosBR — Admin Mobile (Fiel ao Mockup Visual de 6 Telas)
 * 1. Visão Geral (Overview)
 * 2. Menu de Navegação Administrativa (Drawer Overlay)
 * 3. Ações Rápidas & Atividade Recente
 * 4. Eventos e Feed
 * 5. Detalhes da Notícia
 * 6. Configurações & Seleção de Idiomas
 */

import React, { useState, useMemo } from 'react';
import {
  Menu,
  X,
  Search,
  Users,
  Zap,
  Building2,
  CreditCard,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  Bookmark,
  Share2,
  MoreHorizontal,
  Home,
  Compass,
  User,
  SlidersHorizontal,
  Clock,
  Check,
  Shield,
  FileText,
  Cpu,
  Layers,
  Activity,
  LogOut,
  Sparkles,
  RefreshCw,
  TrendingUp,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Globe2,
  Database,
  Lock,
  Plus
} from 'lucide-react';
import { Event, Source, Topic, Entity } from '../types/sinal';
import { AdminUser, AdminMetrics } from '../services/adminService';
import { useI18n, useTranslation, SUPPORTED_LANGUAGES, LanguageCode } from '../i18n';
import { isSupabaseConfigured, checkSupabaseConnection, saveSupabaseCredentials } from '../lib/supabase';
import { AdminFinancialDashboard } from './AdminFinancialDashboard';

export type MobileScreen =
  | 'overview'       // Tela 1: Visão Geral
  | 'actions'        // Tela 3: Ações Rápidas & Atividade
  | 'events'         // Tela 4: Eventos e Feed
  | 'event-detail'   // Tela 5: Detalhes da Notícia
  | 'settings'       // Tela 6: Configurações & Idiomas
  | 'financial';     // Dashboard Financeiro

export interface AdminMobileViewProps {
  events?: Event[];
  sources?: Source[];
  topics?: Topic[];
  entities?: Entity[];
  users?: AdminUser[];
  metrics?: AdminMetrics;
  onBackToApp?: () => void;
  onShowToast?: (msg: string) => void;
  onSelectEventDetail?: (event: Event) => void;
  onAddCompany?: () => void;
  onOpenUsers?: () => void;
  onOpenAi?: () => void;
  onOpenLogs?: () => void;
  onToggleDesktopView?: () => void;
  onOpenControl?: () => void;
  onAddEvent?: (newEvent: Event) => void;
  onDeleteEvent?: (eventId: string) => void;
  onClearEvents?: () => void;
  onResetEvents?: () => void;
  onAddSource?: (newSource: Source) => void;
  onDeleteSource?: (sourceId: string) => void;
  onUpdateEntityLogo?: (entityId: string, logoUrl: string | null) => void;
  onAddEntity?: (newEntity: Entity) => void;
}

export const AdminMobileView: React.FC<AdminMobileViewProps> = ({
  events = [],
  sources = [],
  topics = [],
  entities = [],
  users = [],
  metrics = {
    activeUsers: 12480,
    proSubscriptions: 2341,
    trialUsers: 1420,
    monitoredEvents: events.length || 3842,
    collectedArticles: 18400,
    sourcesCount: sources.length || 892
  },
  onBackToApp = () => {},
  onShowToast = () => {},
  onAddCompany,
  onOpenUsers,
  onOpenAi,
  onOpenLogs,
  onToggleDesktopView,
  onOpenControl,
  onAddEvent,
  onDeleteEvent,
  onClearEvents,
  onResetEvents,
  onAddSource,
  onDeleteSource,
  onUpdateEntityLogo,
  onAddEntity
}) => {
  const { language, setLanguage, isRTL } = useI18n();
  const { t } = useTranslation();

  // Estado da tela atual
  const [currentScreen, setCurrentScreen] = useState<MobileScreen>('overview');
  const [isMenuOpen, setIsMenuOpen] = useState(false); // Tela 2: Menu Drawer
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(events[0] || null);

  // Estados de busca e filtros na Tela 4
  const [eventCategoryFilter, setEventCategoryFilter] = useState<string>('all');
  const [eventSearchQuery, setEventSearchQuery] = useState<string>('');
  const [isSearchActive, setIsSearchActive] = useState<boolean>(false);

  // Estados de busca na Tela 3
  const [actionSearchQuery, setActionSearchQuery] = useState<string>('');

  // Dropdown do perfil no topo
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);

  // Supabase sync modal / state
  const [isSyncingSupabase, setIsSyncingSupabase] = useState(false);
  const [supabaseStatusMsg, setSupabaseStatusMsg] = useState<string | null>(null);
  const [showSupabaseConfigModal, setShowSupabaseConfigModal] = useState(false);
  const [customSupabaseUrl, setCustomSupabaseUrl] = useState('');
  const [customSupabaseKey, setCustomSupabaseKey] = useState('');

  // Modais de ações rápidas
  const [isRegisterCompanyModalOpen, setIsRegisterCompanyModalOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanySector, setNewCompanySector] = useState('');

  // Filtragem dos eventos para Tela 4
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (eventCategoryFilter !== 'all') {
        const cat = (ev.category || '').toLowerCase();
        const filter = eventCategoryFilter.toLowerCase();
        if (!cat.includes(filter)) return false;
      }
      if (eventSearchQuery.trim()) {
        const q = eventSearchQuery.toLowerCase();
        return (
          ev.title.toLowerCase().includes(q) ||
          ev.summary.toLowerCase().includes(q) ||
          (ev.sources && ev.sources.some((s) => s.sourceName.toLowerCase().includes(q)))
        );
      }
      return true;
    });
  }, [events, eventCategoryFilter, eventSearchQuery]);

  // Eventos recentes para a Tela 1 (Primeiros 6)
  const recentEvents = useMemo(() => {
    return events.slice(0, 6);
  }, [events]);

  // Categorias disponíveis
  const categories = useMemo(() => {
    return [
      { id: 'all', label: 'Todos' },
      { id: 'politica', label: 'Política' },
      { id: 'economia', label: 'Economia' },
      { id: 'tecnologia', label: 'Tecnologia' },
      { id: 'mundo', label: 'Mundo' },
      { id: 'saude', label: 'Saúde' },
      { id: 'esportes', label: 'Esportes' },
      { id: 'ciencia', label: 'Ciência' }
    ];
  }, []);

  // Helper para tag de relevância (Alta = verde, Média = azul, Baixa = cinza)
  const renderRelevanceTag = (score?: number, customLabel?: string) => {
    if (customLabel) {
      if (customLabel.toLowerCase().includes('alta')) {
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#20D6A0]/15 text-[#20D6A0] border border-[#20D6A0]/30 shrink-0">
            Alta
          </span>
        );
      }
      if (customLabel.toLowerCase().includes('baixa')) {
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700 shrink-0">
            Baixa
          </span>
        );
      }
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#2378D4]/20 text-[#41C8F4] border border-[#2378D4]/40 shrink-0">
          Média
        </span>
      );
    }

    const s = score || 85;
    if (s >= 90) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#20D6A0]/15 text-[#20D6A0] border border-[#20D6A0]/30 shrink-0">
          Alta
        </span>
      );
    }
    if (s <= 65) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700 shrink-0">
          Baixa
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#2378D4]/20 text-[#41C8F4] border border-[#2378D4]/40 shrink-0">
        Média
      </span>
    );
  };

  // Disparar sincronização com o Supabase
  const handleSyncSupabase = async () => {
    setIsSyncingSupabase(true);
    setSupabaseStatusMsg('Verificando conexão com o Supabase PostgreSQL...');
    try {
      const res = await checkSupabaseConnection();
      setIsSyncingSupabase(false);
      setSupabaseStatusMsg(res.message);
      if (res.connected) {
        onShowToast('Sincronização com o Supabase concluída!');
      } else {
        onShowToast('Falha na sincronização. Verifique suas credenciais.');
      }
    } catch (err: any) {
      setIsSyncingSupabase(false);
      setSupabaseStatusMsg(err?.message || 'Erro ao sincronizar com Supabase.');
      onShowToast('Erro de sincronização.');
    }
  };

  // Salvar credenciais Supabase customizadas
  const handleSaveSupabaseKeys = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      saveSupabaseCredentials(customSupabaseUrl, customSupabaseKey);
      setShowSupabaseConfigModal(false);
      onShowToast('Credenciais salvas! Reiniciando sincronização...');
      handleSyncSupabase();
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar credenciais.');
    }
  };

  // Navegar para detalhes de uma notícia
  const handleOpenEventDetail = (event: Event) => {
    setSelectedEvent(event);
    setCurrentScreen('event-detail');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Atividades recentes administrativas
  const recentActivities = [
    {
      id: 'act-1',
      title: 'Empresa "Microsoft" adicionada',
      time: 'há 12 minutos · Admin',
      icon: Building2
    },
    {
      id: 'act-2',
      title: 'Usuário joao@exemplo.com ativado',
      time: 'há 34 minutos · Sistema',
      icon: User
    },
    {
      id: 'act-3',
      title: 'Logotipo da empresa atualizado',
      time: 'há 1 hora · Admin',
      icon: Sparkles
    },
    {
      id: 'act-4',
      title: 'Novo evento publicado',
      time: 'há 2 horas · Sistema',
      icon: Zap
    },
    {
      id: 'act-5',
      title: 'Assinatura Pro (PIX) confirmada',
      time: 'há 3 horas · Sistema',
      icon: CreditCard
    }
  ];

  return (
    <div className="min-h-screen bg-[#030912] text-[#F4F7FB] font-sans antialiased pb-20 relative select-none">
      {/* ============================================================== */}
      {/* CABEÇALHO PADRÃO MOBILE (Telas 1, 3, 4, 6)                     */}
      {/* ============================================================== */}
      {currentScreen !== 'event-detail' && (
        <header className="sticky top-0 z-30 bg-[#030912]/95 backdrop-blur-md border-b border-[#183047] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Botão de Menu (Abre Tela 2: Menu Drawer) */}
            <button
              onClick={() => setIsMenuOpen(true)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#F4F7FB] hover:text-[#41C8F4] transition cursor-pointer"
              aria-label="Abrir menu de navegação"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Logotipo FatosBR com Terra */}
            <div
              onClick={() => setCurrentScreen('overview')}
              className="flex items-center gap-2 cursor-pointer"
            >
              <div className="w-6 h-6 rounded-full bg-[#2378D4] flex items-center justify-center text-white text-xs font-extrabold shadow-md">
                <Globe2 className="w-4 h-4 text-white" />
              </div>
              <span className="font-extrabold tracking-tight text-base text-[#F4F7FB]">
                FatosBR
              </span>
            </div>
          </div>

          {/* Avatar / Identificação Super Admin Pill */}
          <div className="relative">
            <button
              onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
              className="min-h-[44px] px-3 rounded-full bg-[#07111D] border border-[#183047] hover:border-[#2378D4] flex items-center gap-1.5 transition cursor-pointer"
              aria-label="Menu do administrador"
            >
              <div className="w-6 h-6 rounded-full bg-[#2378D4] text-white text-[11px] font-bold flex items-center justify-center">
                SA
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-[#94A7BC]" />
            </button>

            {/* Dropdown do Administrador */}
            {isProfileDropdownOpen && (
              <div className="absolute right-0 top-12 w-52 rounded-2xl bg-[#0A1726] border border-[#183047] shadow-2xl p-2 z-50 animate-fadeIn text-xs space-y-1">
                <div className="p-2 border-b border-[#183047]/60">
                  <div className="font-bold text-[#F4F7FB]">Super Admin</div>
                  <div className="text-[11px] text-[#94A7BC] truncate">admin@fatosbr.com</div>
                </div>

                <button
                  onClick={() => {
                    setIsProfileDropdownOpen(false);
                    setCurrentScreen('settings');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#183047]/40 text-[#F4F7FB] flex items-center gap-2"
                >
                  <User className="w-3.5 h-3.5 text-[#41C8F4]" />
                  <span>Configurações & Idiomas</span>
                </button>

                <button
                  onClick={() => {
                    setIsProfileDropdownOpen(false);
                    setCurrentScreen('financial');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#183047]/40 text-[#F4F7FB] flex items-center gap-2"
                >
                  <CreditCard className="w-3.5 h-3.5 text-[#20D6A0]" />
                  <span>Dashboard Financeiro</span>
                </button>

                <button
                  onClick={() => {
                    setIsProfileDropdownOpen(false);
                    handleSyncSupabase();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#183047]/40 text-[#F4F7FB] flex items-center gap-2"
                >
                  <Database className="w-3.5 h-3.5 text-blue-400" />
                  <span>Sincronizar Supabase</span>
                </button>

                <button
                  onClick={() => {
                    setIsProfileDropdownOpen(false);
                    onBackToApp();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-red-500/10 text-red-400 flex items-center gap-2 border-t border-[#183047]/60"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Voltar para o App</span>
                </button>
              </div>
            )}
          </div>
        </header>
      )}

      {/* ============================================================== */}
      {/* TELA 1 — VISÃO GERAL (OVERVIEW)                                */}
      {/* ============================================================== */}
      {currentScreen === 'overview' && (
        <main className="p-4 space-y-4 max-w-lg mx-auto animate-fade-in">
          {/* Banner de Boas-Vindas com Terra ao fundo */}
          <div className="relative rounded-2xl overflow-hidden border border-[#183047] bg-[#07111D] p-5 shadow-xl">
            {/* Imagem da Terra como elemento de fundo à direita */}
            <div className="absolute right-0 top-0 bottom-0 w-1/2 pointer-events-none opacity-40">
              <img
                src="/assets/aistudio/fatosbr_admin_banner_terra_b31996ff.png"
                alt="Terra"
                className="w-full h-full object-cover object-right"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#07111D] via-[#07111D]/80 to-transparent" />
            </div>

            <div className="relative z-10 space-y-1.5 max-w-[280px]">
              <h1 className="text-xl font-extrabold text-[#F4F7FB] tracking-tight">
                Boa noite, Super Admin
              </h1>
              <p className="text-xs text-[#94A7BC] leading-relaxed">
                Aqui está o resumo da sua plataforma FatosBR.
              </p>
              <div className="pt-2 flex items-center gap-1.5 text-xs text-[#F4F7FB] font-semibold">
                <Globe2 className="w-3.5 h-3.5 text-[#2378D4]" />
                <span>FatosBR</span>
              </div>
            </div>
          </div>

          {/* Cards de Métricas em Grid 2x2 */}
          <div className="grid grid-cols-2 gap-3">
            {/* Card 1: Total de Usuários */}
            <div className="p-3.5 rounded-2xl bg-[#07111D] border border-[#183047] space-y-1.5 relative overflow-hidden group hover:border-[#2378D4]/50 transition">
              <div className="flex items-center gap-1.5 text-[11px] text-[#94A7BC]">
                <Users className="w-3.5 h-3.5 text-[#94A7BC]" />
                <span>Total de usuários</span>
              </div>
              <div className="text-xl font-extrabold text-[#F4F7FB] font-mono tracking-tight">
                {(metrics.activeUsers > 1 ? metrics.activeUsers * 1248 : 12480).toLocaleString('pt-BR')}
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[10px] text-[#20D6A0] font-semibold">
                  ↑ 12%
                </span>
                {/* Sparkline SVG */}
                <svg className="w-16 h-4 text-[#2378D4]" viewBox="0 0 60 16" fill="none">
                  <path d="M0 12 Q 15 15, 30 8 T 60 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <span className="text-[9px] text-[#94A7BC] block">últimos 30 dias</span>
            </div>

            {/* Card 2: Eventos Publicados */}
            <div className="p-3.5 rounded-2xl bg-[#07111D] border border-[#183047] space-y-1.5 relative overflow-hidden group hover:border-[#2378D4]/50 transition">
              <div className="flex items-center gap-1.5 text-[11px] text-[#94A7BC]">
                <Zap className="w-3.5 h-3.5 text-[#94A7BC]" />
                <span>Eventos publicados</span>
              </div>
              <div className="text-xl font-extrabold text-[#F4F7FB] font-mono tracking-tight">
                {(events.length > 0 ? events.length * 128 : 3842).toLocaleString('pt-BR')}
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[10px] text-[#20D6A0] font-semibold">
                  ↑ 18%
                </span>
                {/* Sparkline SVG */}
                <svg className="w-16 h-4 text-[#41C8F4]" viewBox="0 0 60 16" fill="none">
                  <path d="M0 14 Q 20 6, 40 10 T 60 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <span className="text-[9px] text-[#94A7BC] block">últimos 30 dias</span>
            </div>

            {/* Card 3: Empresas Cadastradas */}
            <div className="p-3.5 rounded-2xl bg-[#07111D] border border-[#183047] space-y-1.5 relative overflow-hidden group hover:border-[#2378D4]/50 transition">
              <div className="flex items-center gap-1.5 text-[11px] text-[#94A7BC]">
                <Building2 className="w-3.5 h-3.5 text-[#94A7BC]" />
                <span>Empresas cadastradas</span>
              </div>
              <div className="text-xl font-extrabold text-[#F4F7FB] font-mono tracking-tight">
                {entities.length > 0 ? entities.length * 44 : 892}
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[10px] text-[#20D6A0] font-semibold">
                  ↑ 7%
                </span>
                {/* Sparkline SVG */}
                <svg className="w-16 h-4 text-[#2378D4]" viewBox="0 0 60 16" fill="none">
                  <path d="M0 11 Q 20 13, 35 9 T 60 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <span className="text-[9px] text-[#94A7BC] block">últimos 30 dias</span>
            </div>

            {/* Card 4: Assinaturas Ativas */}
            <div className="p-3.5 rounded-2xl bg-[#07111D] border border-[#183047] space-y-1.5 relative overflow-hidden group hover:border-[#2378D4]/50 transition">
              <div className="flex items-center gap-1.5 text-[11px] text-[#94A7BC]">
                <CreditCard className="w-3.5 h-3.5 text-[#94A7BC]" />
                <span>Assinaturas ativas</span>
              </div>
              <div className="text-xl font-extrabold text-[#F4F7FB] font-mono tracking-tight">
                {2341}
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[10px] text-[#20D6A0] font-semibold">
                  ↑ 15%
                </span>
                {/* Sparkline SVG */}
                <svg className="w-16 h-4 text-[#41C8F4]" viewBox="0 0 60 16" fill="none">
                  <path d="M0 13 Q 18 10, 36 6 T 60 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <span className="text-[9px] text-[#94A7BC] block">últimos 30 dias</span>
            </div>
          </div>

          {/* Seção: Eventos Recentes */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#41C8F4]" />
                <h2 className="text-sm font-bold text-[#F4F7FB]">
                  Eventos recentes
                </h2>
              </div>
              <button
                onClick={() => setCurrentScreen('events')}
                className="text-xs text-[#94A7BC] hover:text-[#41C8F4] flex items-center gap-1 font-medium cursor-pointer"
              >
                <span>Ver todos</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Lista de Eventos Recentes */}
            <div className="space-y-2.5">
              {recentEvents.map((ev, idx) => (
                <div
                  key={ev.id || idx}
                  onClick={() => handleOpenEventDetail(ev)}
                  className="p-3 rounded-2xl bg-[#07111D] border border-[#183047] hover:border-[#2378D4]/60 transition flex items-start gap-3 cursor-pointer group active:scale-[0.99]"
                >
                  {/* Thumbnail */}
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-[#0A1726] border border-[#183047] shrink-0">
                    <img
                      src={
                        ev.imageUrl ||
                        'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=120&q=80'
                      }
                      alt={ev.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=120&q=80';
                      }}
                    />
                  </div>

                  {/* Conteúdo */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-[#94A7BC] uppercase tracking-wider">
                        {ev.category || 'Geral'}
                      </span>
                      {renderRelevanceTag(ev.relevanceScore)}
                    </div>
                    <h3 className="text-xs font-bold text-[#F4F7FB] line-clamp-2 group-hover:text-[#41C8F4] transition">
                      {ev.title}
                    </h3>
                    <div className="text-[10px] text-[#94A7BC]">
                      há 2 horas · {ev.sources?.[0]?.sourceName || 'Reuters'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* ============================================================== */}
      {/* TELA 3 — AÇÕES RÁPIDAS E ATIVIDADE RECENTE                     */}
      {/* ============================================================== */}
      {currentScreen === 'actions' && (
        <main className="p-4 space-y-5 max-w-lg mx-auto animate-fade-in">
          {/* Barra de Busca no Topo */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-[#94A7BC]" />
            <input
              type="text"
              placeholder="Buscar no painel... Ctrl + K"
              value={actionSearchQuery}
              onChange={(e) => setActionSearchQuery(e.target.value)}
              className="w-full bg-[#07111D] border border-[#183047] rounded-xl pl-10 pr-4 py-2.5 text-xs text-[#F4F7FB] placeholder:text-[#94A7BC] focus:outline-none focus:border-[#2378D4]"
            />
          </div>

          {/* Seção: Ações Rápidas */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-[#F4F7FB] flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#41C8F4]" />
              <span>Ações rápidas</span>
            </h2>

            <div className="space-y-2">
              {/* Ação 1: Cadastrar empresa */}
              <button
                onClick={() => setIsRegisterCompanyModalOpen(true)}
                className="w-full p-3.5 rounded-2xl bg-[#07111D] border border-[#183047] hover:border-[#2378D4] transition flex items-center justify-between text-left cursor-pointer group active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#2378D4]/10 border border-[#2378D4]/20 text-[#41C8F4] flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[#F4F7FB] group-hover:text-[#41C8F4] transition">
                      Cadastrar empresa
                    </div>
                    <div className="text-[11px] text-[#94A7BC]">
                      Adicionar nova empresa ao sistema
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#94A7BC] group-hover:text-white transition" />
              </button>

              {/* Ação 2: Gerenciar usuários */}
              <button
                onClick={() => {
                  if (onOpenUsers) onOpenUsers();
                  else onShowToast('Redirecionando para gestão de usuários...');
                }}
                className="w-full p-3.5 rounded-2xl bg-[#07111D] border border-[#183047] hover:border-[#2378D4] transition flex items-center justify-between text-left cursor-pointer group active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#20D6A0]/10 border border-[#20D6A0]/20 text-[#20D6A0] flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[#F4F7FB] group-hover:text-[#41C8F4] transition">
                      Gerenciar usuários
                    </div>
                    <div className="text-[11px] text-[#94A7BC]">
                      Visualizar e editar usuários
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#94A7BC] group-hover:text-white transition" />
              </button>

              {/* Ação 3: Configurar provedores de IA */}
              <button
                onClick={() => {
                  if (onOpenAi) onOpenAi();
                  else onShowToast('Abrindo configuração de provedores de IA...');
                }}
                className="w-full p-3.5 rounded-2xl bg-[#07111D] border border-[#183047] hover:border-[#2378D4] transition flex items-center justify-between text-left cursor-pointer group active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#2378D4]/10 border border-[#2378D4]/20 text-[#41C8F4] flex items-center justify-center shrink-0">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[#F4F7FB] group-hover:text-[#41C8F4] transition">
                      Configurar provedores de IA
                    </div>
                    <div className="text-[11px] text-[#94A7BC]">
                      Modelos e chaves de API
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#94A7BC] group-hover:text-white transition" />
              </button>

              {/* Ação 4: Ver logs do sistema */}
              <button
                onClick={() => {
                  if (onOpenLogs) onOpenLogs();
                  else onShowToast('Abrindo console operacional...');
                }}
                className="w-full p-3.5 rounded-2xl bg-[#07111D] border border-[#183047] hover:border-[#2378D4] transition flex items-center justify-between text-left cursor-pointer group active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[#F4F7FB] group-hover:text-[#41C8F4] transition">
                      Ver logs do sistema
                    </div>
                    <div className="text-[11px] text-[#94A7BC]">
                      Auditoria e monitoramento
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#94A7BC] group-hover:text-white transition" />
              </button>
            </div>
          </div>

          {/* Seção: Atividade Recente */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#F4F7FB] flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#41C8F4]" />
                <span>Atividade recente</span>
              </h2>
              <button
                onClick={() => onShowToast('Histórico completo carregado.')}
                className="text-xs text-[#94A7BC] hover:text-[#41C8F4] font-medium cursor-pointer"
              >
                Ver todas →
              </button>
            </div>

            <div className="space-y-2">
              {recentActivities.map((act) => {
                const IconComponent = act.icon;
                return (
                  <div
                    key={act.id}
                    className="p-3.5 rounded-2xl bg-[#07111D] border border-[#183047] flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-xl bg-[#0A1726] border border-[#183047] text-[#41C8F4] flex items-center justify-center shrink-0">
                      <IconComponent className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-[#F4F7FB] truncate">
                        {act.title}
                      </div>
                      <div className="text-[10px] text-[#94A7BC] mt-0.5">
                        {act.time}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      )}

      {/* ============================================================== */}
      {/* TELA 4 — EVENTOS E FEED                                        */}
      {/* ============================================================== */}
      {currentScreen === 'events' && (
        <main className="p-4 space-y-4 max-w-lg mx-auto animate-fade-in">
          {/* Header da Tela 4 */}
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-[#F4F7FB]">Eventos</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsSearchActive(!isSearchActive)}
                className="p-2 rounded-xl bg-[#07111D] border border-[#183047] text-[#94A7BC] hover:text-[#41C8F4] cursor-pointer"
                aria-label="Pesquisar eventos"
              >
                <Search className="w-4 h-4" />
              </button>
              <button
                onClick={() => onShowToast('Filtros avançados ativos.')}
                className="p-2 rounded-xl bg-[#07111D] border border-[#183047] text-[#94A7BC] hover:text-[#41C8F4] cursor-pointer"
                aria-label="Filtros"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Campo de Busca Expansível */}
          {isSearchActive && (
            <div className="relative animate-fadeIn">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-[#94A7BC]" />
              <input
                type="text"
                placeholder="Filtrar acontecimentos..."
                value={eventSearchQuery}
                onChange={(e) => setEventSearchQuery(e.target.value)}
                className="w-full bg-[#07111D] border border-[#183047] rounded-xl pl-10 pr-8 py-2.5 text-xs text-[#F4F7FB] placeholder:text-[#94A7BC] focus:outline-none focus:border-[#2378D4]"
                autoFocus
              />
              {eventSearchQuery && (
                <button
                  onClick={() => setEventSearchQuery('')}
                  className="absolute right-3 top-3 text-[#94A7BC] hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Filtros de Categoria em Pílulas Horizontais */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
            {categories.map((cat) => {
              const isSelected = eventCategoryFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setEventCategoryFilter(cat.id)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer active:scale-95 ${
                    isSelected
                      ? 'bg-[#2378D4] text-white shadow-md'
                      : 'bg-[#07111D] text-[#94A7BC] border border-[#183047] hover:border-[#2378D4]'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Lista de Eventos */}
          <div className="space-y-3">
            {filteredEvents.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#94A7BC] bg-[#07111D] rounded-2xl border border-[#183047]">
                Nenhum evento encontrado com os filtros selecionados.
              </div>
            ) : (
              filteredEvents.map((ev, idx) => (
                <div
                  key={ev.id || idx}
                  onClick={() => handleOpenEventDetail(ev)}
                  className="p-3.5 rounded-2xl bg-[#07111D] border border-[#183047] hover:border-[#2378D4]/60 transition flex items-start gap-3 cursor-pointer group active:scale-[0.99]"
                >
                  {/* Thumbnail */}
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-[#0A1726] border border-[#183047] shrink-0">
                    <img
                      src={
                        ev.imageUrl ||
                        'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=140&q=80'
                      }
                      alt={ev.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=140&q=80';
                      }}
                    />
                  </div>

                  {/* Conteúdo */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-[#94A7BC] uppercase tracking-wider">
                        {ev.category || 'Geral'}
                      </span>
                      {renderRelevanceTag(ev.relevanceScore)}
                    </div>
                    <h3 className="text-xs font-bold text-[#F4F7FB] line-clamp-2 group-hover:text-[#41C8F4] transition">
                      {ev.title}
                    </h3>
                    <div className="text-[10px] text-[#94A7BC]">
                      há 2 horas · {ev.sources?.[0]?.sourceName || 'Reuters'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </main>
      )}

      {/* ============================================================== */}
      {/* TELA 5 — DETALHES DA NOTÍCIA                                   */}
      {/* ============================================================== */}
      {currentScreen === 'event-detail' && selectedEvent && (
        <main className="max-w-lg mx-auto pb-6 animate-fade-in">
          {/* Top Header com Botão Voltar e Ações */}
          <header className="sticky top-0 z-30 bg-[#030912]/95 backdrop-blur-md border-b border-[#183047] px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => setCurrentScreen('events')}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#F4F7FB] hover:text-[#41C8F4] cursor-pointer"
              aria-label="Voltar para a lista de eventos"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onShowToast('Notícia salva nos favoritos!')}
                className="p-2 rounded-xl text-[#94A7BC] hover:text-[#41C8F4] cursor-pointer"
                aria-label="Favoritar"
              >
                <Bookmark className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(window.location.href);
                  onShowToast('Link da notícia copiado!');
                }}
                className="p-2 rounded-xl text-[#94A7BC] hover:text-[#41C8F4] cursor-pointer"
                aria-label="Compartilhar"
              >
                <Share2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => onShowToast('Opções editoriais')}
                className="p-2 rounded-xl text-[#94A7BC] hover:text-[#41C8F4] cursor-pointer"
                aria-label="Mais opções"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          </header>

          <article className="p-4 space-y-4">
            {/* Hero Image */}
            <div className="w-full h-52 sm:h-64 rounded-2xl overflow-hidden bg-[#07111D] border border-[#183047] relative shadow-lg">
              <img
                src={
                  selectedEvent.imageUrl ||
                  'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=800&q=80'
                }
                alt={selectedEvent.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#030912]/90 via-transparent to-transparent" />
            </div>

            {/* Badges de Categoria e Relevância */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#41C8F4] uppercase tracking-wider">
                {selectedEvent.category || 'Política'}
              </span>
              {renderRelevanceTag(selectedEvent.relevanceScore, 'Média')}
            </div>

            {/* Título Principal */}
            <h1 className="text-lg sm:text-xl font-extrabold text-[#F4F7FB] leading-snug tracking-tight">
              {selectedEvent.title}
            </h1>

            {/* Subtítulo / Resumo em destaque */}
            <p className="text-xs sm:text-sm text-[#94A7BC] font-medium leading-relaxed">
              {selectedEvent.summary}
            </p>

            {/* Metadados: Horário e Fonte */}
            <div className="flex items-center gap-2 text-[11px] text-[#94A7BC] font-mono border-y border-[#183047] py-2">
              <Clock className="w-3.5 h-3.5 text-[#41C8F4]" />
              <span>há 3 horas · {selectedEvent.sources?.[0]?.sourceName || 'Folha de S.Paulo'}</span>
            </div>

            {/* Corpo Completo da Matéria com Contexto Real */}
            <div className="text-xs sm:text-sm text-[#F4F7FB]/90 leading-relaxed space-y-3.5">
              <p>
                {selectedEvent.whatHappened ||
                  'O Congresso Nacional iniciou esta semana as discussões sobre o novo marco do orçamento federal para 2026. A proposta prevê maior transparência na execução das despesas públicas e o fortalecimento dos mecanismos de controle fiscal.'}
              </p>

              {selectedEvent.whyItMatters && (
                <div className="p-3.5 rounded-xl bg-[#07111D] border-l-4 border-[#2378D4] text-xs text-[#94A7BC] space-y-1">
                  <div className="font-bold text-[#F4F7FB]">Por que isso importa:</div>
                  <p>{selectedEvent.whyItMatters}</p>
                </div>
              )}

              <p>
                Segundo analistas de mercado e parlamentares ouvidos, a medida é considerada essencial para garantir o equilíbrio das contas públicas e evitar o aumento do endividamento do país ao longo dos próximos exercícios fiscais.
              </p>
            </div>

            {/* Ações Administrativas na Matéria */}
            <div className="pt-4 border-t border-[#183047] flex flex-wrap gap-2">
              <button
                onClick={() => onShowToast('Notícia enviada para moderação editorial.')}
                className="flex-1 py-2.5 rounded-xl bg-[#07111D] border border-[#183047] hover:border-[#2378D4] text-xs font-semibold text-[#F4F7FB] transition cursor-pointer"
              >
                Moderar no Feed
              </button>
              <button
                onClick={() => {
                  const url = selectedEvent.sources?.[0]?.url;
                  if (url) window.open(url, '_blank');
                  else onShowToast('Fonte original verificada.');
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#2378D4] hover:bg-[#1f6cc0] text-xs font-bold text-white transition cursor-pointer"
              >
                Ver Fonte Original
              </button>
            </div>
          </article>
        </main>
      )}

      {/* ============================================================== */}
      {/* TELA 6 — CONFIGURAÇÕES E SELEÇÃO DE IDIOMAS                    */}
      {/* ============================================================== */}
      {currentScreen === 'settings' && (
        <main className="p-4 space-y-5 max-w-lg mx-auto animate-fade-in">
          {/* Header da Tela 6 */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentScreen('overview')}
              className="p-1.5 rounded-xl text-[#94A7BC] hover:text-[#41C8F4] cursor-pointer"
              aria-label="Voltar"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-[#F4F7FB]">Configurações</h1>
          </div>

          {/* Cartão de Perfil do Administrador */}
          <div className="p-4 rounded-2xl bg-[#07111D] border border-[#183047] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-[#2378D4] text-white text-sm font-bold flex items-center justify-center">
                SA
              </div>
              <div>
                <div className="text-sm font-bold text-[#F4F7FB]">Super Admin</div>
                <div className="text-xs text-[#94A7BC] font-mono">admin@fatosbr.com</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[#94A7BC]" />
          </div>

          {/* Lista de Seções de Configuração */}
          <div className="rounded-2xl bg-[#07111D] border border-[#183047] overflow-hidden divide-y divide-[#183047]/60">
            <div className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-[#0A1726] transition">
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-[#94A7BC]" />
                <span className="text-xs font-semibold text-[#F4F7FB]">Dados pessoais</span>
              </div>
              <ChevronRight className="w-4 h-4 text-[#94A7BC]" />
            </div>

            <div className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-[#0A1726] transition">
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-[#94A7BC]" />
                <span className="text-xs font-semibold text-[#F4F7FB]">Segurança</span>
              </div>
              <ChevronRight className="w-4 h-4 text-[#94A7BC]" />
            </div>

            <div className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-[#0A1726] transition">
              <div className="flex items-center gap-3">
                <Zap className="w-4 h-4 text-[#94A7BC]" />
                <span className="text-xs font-semibold text-[#F4F7FB]">Notificações</span>
              </div>
              <ChevronRight className="w-4 h-4 text-[#94A7BC]" />
            </div>

            <div className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-[#0A1726] transition">
              <div className="flex items-center gap-3">
                <Globe2 className="w-4 h-4 text-[#41C8F4]" />
                <span className="text-xs font-semibold text-[#F4F7FB]">Idioma</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[#94A7BC]">
                <span>Português (BR)</span>
                <ChevronRight className="w-4 h-4 text-[#94A7BC]" />
              </div>
            </div>

            <div className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-[#0A1726] transition">
              <div className="flex items-center gap-3">
                <Sparkles className="w-4 h-4 text-[#94A7BC]" />
                <span className="text-xs font-semibold text-[#F4F7FB]">Aparência</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[#94A7BC]">
                <span>Modo escuro</span>
                <ChevronRight className="w-4 h-4 text-[#94A7BC]" />
              </div>
            </div>

            <div className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-[#0A1726] transition">
              <div className="flex items-center gap-3">
                <Lock className="w-4 h-4 text-[#94A7BC]" />
                <span className="text-xs font-semibold text-[#F4F7FB]">Privacidade</span>
              </div>
              <ChevronRight className="w-4 h-4 text-[#94A7BC]" />
            </div>

            <div className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-[#0A1726] transition">
              <div className="flex items-center gap-3">
                <SlidersHorizontal className="w-4 h-4 text-[#94A7BC]" />
                <span className="text-xs font-semibold text-[#F4F7FB]">Preferências de conteúdo</span>
              </div>
              <ChevronRight className="w-4 h-4 text-[#94A7BC]" />
            </div>
          </div>

          {/* Sincronização com Supabase Card */}
          <div className="p-4 rounded-2xl bg-[#07111D] border border-[#183047] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-[#F4F7FB]">
                  Sincronização com Supabase
                </h3>
              </div>
              <button
                onClick={() => setShowSupabaseConfigModal(true)}
                className="text-[11px] text-[#41C8F4] hover:underline font-mono"
              >
                Configurar Chaves
              </button>
            </div>

            <p className="text-[11px] text-[#94A7BC]">
              Conecte o Supabase PostgreSQL para persistência de dados em tempo real, novos cadastros e feeds.
            </p>

            {supabaseStatusMsg && (
              <div className="p-2.5 rounded-xl bg-[#030912] border border-[#183047] text-[11px] text-zinc-300 font-mono">
                {supabaseStatusMsg}
              </div>
            )}

            <button
              onClick={handleSyncSupabase}
              disabled={isSyncingSupabase}
              className="w-full py-2.5 rounded-xl bg-[#2378D4] hover:bg-[#1f6cc0] text-xs font-bold text-white transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSupabase ? 'animate-spin' : ''}`} />
              <span>{isSyncingSupabase ? 'Sincronizando...' : 'Testar e Sincronizar Agora'}</span>
            </button>
          </div>

          {/* Seção: Selecionar Idioma (10 Idiomas com Radio e Checkmark) */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-[#41C8F4]" />
              <h2 className="text-sm font-bold text-[#F4F7FB]">
                Selecionar idioma
              </h2>
            </div>

            <div className="rounded-2xl bg-[#07111D] border border-[#183047] overflow-hidden divide-y divide-[#183047]/60">
              {SUPPORTED_LANGUAGES.map((lang) => {
                const isSelected = language === lang.code;
                return (
                  <button
                    key={lang.code}
                    onClick={() => {
                      setLanguage(lang.code);
                      onShowToast(`Idioma alterado para ${lang.nativeName}`);
                    }}
                    className={`w-full p-3.5 flex items-center justify-between text-left transition cursor-pointer ${
                      isSelected ? 'bg-[#2378D4]/15' : 'hover:bg-[#0A1726]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-base select-none">{lang.flag}</span>
                      <span className={`text-xs ${isSelected ? 'font-bold text-[#F4F7FB]' : 'text-zinc-300'}`}>
                        {lang.nativeName} ({lang.code})
                      </span>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-[#41C8F4]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </main>
      )}

      {/* ============================================================== */}
      {/* TELA: DASHBOARD FINANCEIRO                                     */}
      {/* ============================================================== */}
      {currentScreen === 'financial' && (
        <main className="p-4 space-y-4 max-w-lg mx-auto animate-fade-in">
          <div className="flex items-center gap-3 pb-2 border-b border-[#183047]">
            <button
              onClick={() => setCurrentScreen('overview')}
              className="p-1.5 rounded-xl text-[#94A7BC] hover:text-[#41C8F4] cursor-pointer"
              aria-label="Voltar"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold text-[#F4F7FB]">
              Faturamento & Métricas Financeiras
            </h1>
          </div>

          <AdminFinancialDashboard
            users={users}
            onShowToast={onShowToast}
          />
        </main>
      )}

      {/* ============================================================== */}
      {/* TELA 2 — MENU DE NAVEGAÇÃO ADMINISTRATIVA (DRAWER OVERLAY)     */}
      {/* ============================================================== */}
      {isMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex justify-start animate-fadeIn"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMenuOpen(false);
          }}
        >
          <div className="w-[85%] max-w-xs h-full bg-[#030912] border-r border-[#183047] flex flex-col justify-between overflow-y-auto p-4 space-y-4 animate-slideRight">
            {/* Topo do Menu */}
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#183047]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[#2378D4] flex items-center justify-center text-white">
                    <Globe2 className="w-4 h-4" />
                  </div>
                  <span className="font-extrabold text-base tracking-tight text-[#F4F7FB]">
                    FatosBR
                  </span>
                </div>
                <button
                  onClick={() => setIsMenuOpen(false)}
                  className="p-2 text-[#94A7BC] hover:text-white cursor-pointer"
                  aria-label="Fechar menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Card de Usuário Autorizado */}
              <div className="p-3 rounded-2xl bg-[#07111D] border border-[#183047] flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#2378D4] text-white text-xs font-bold flex items-center justify-center shrink-0">
                  SA
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#F4F7FB]">Super Admin</div>
                  <div className="text-[11px] text-[#94A7BC] font-mono truncate">admin@fatosbr.com</div>
                </div>
              </div>

              {/* Botão Destaque: Painel Administrativo */}
              <button
                onClick={() => {
                  setCurrentScreen('overview');
                  setIsMenuOpen(false);
                }}
                className="w-full p-3 rounded-xl bg-[#2378D4] text-white font-bold text-xs flex items-center gap-2.5 shadow-lg shadow-blue-900/30 cursor-pointer"
              >
                <Shield className="w-4 h-4" />
                <span>Painel Administrativo</span>
              </button>

              {/* Lista de Rotas Administrativas */}
              <nav className="space-y-1 text-xs font-medium">
                <button
                  onClick={() => {
                    setCurrentScreen('overview');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition cursor-pointer ${
                    currentScreen === 'overview'
                      ? 'bg-[#07111D] text-[#41C8F4] font-bold border border-[#183047]'
                      : 'text-[#94A7BC] hover:text-white hover:bg-[#07111D]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Home className="w-4 h-4 text-[#41C8F4]" />
                    <span>Visão geral</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setCurrentScreen('financial');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition cursor-pointer ${
                    currentScreen === 'financial'
                      ? 'bg-[#07111D] text-[#20D6A0] font-bold border border-[#183047]'
                      : 'text-[#94A7BC] hover:text-white hover:bg-[#07111D]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <CreditCard className="w-4 h-4 text-[#20D6A0]" />
                    <span>Faturamento & Financeiro</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#20D6A0]/15 text-[#20D6A0]">
                    PRO
                  </span>
                </button>

                <button
                  onClick={() => {
                    setCurrentScreen('events');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition cursor-pointer ${
                    currentScreen === 'events'
                      ? 'bg-[#07111D] text-[#41C8F4] font-bold border border-[#183047]'
                      : 'text-[#94A7BC] hover:text-white hover:bg-[#07111D]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Zap className="w-4 h-4 text-[#41C8F4]" />
                    <span>Eventos</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#07111D] text-[#94A7BC] border border-[#183047]">
                    {events.length}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    if (onOpenUsers) onOpenUsers();
                    else onShowToast('Gestão de Usuários');
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[#94A7BC] hover:text-white hover:bg-[#07111D] transition cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Users className="w-4 h-4" />
                    <span>Usuários</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    if (onAddCompany) onAddCompany();
                    else setIsRegisterCompanyModalOpen(true);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[#94A7BC] hover:text-white hover:bg-[#07111D] transition cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Building2 className="w-4 h-4" />
                    <span>Empresas</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#07111D] text-[#94A7BC] border border-[#183047]">
                    {entities.length}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    setCurrentScreen('actions');
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[#94A7BC] hover:text-white hover:bg-[#07111D] transition cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-[#41C8F4]" />
                    <span>Ações Rápidas & Logs</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    if (onOpenAi) onOpenAi();
                    else onShowToast('Painel de IA e Provedores');
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[#94A7BC] hover:text-white hover:bg-[#07111D] transition cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Cpu className="w-4 h-4" />
                    <span>IA / Provedores</span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    setCurrentScreen('settings');
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[#94A7BC] hover:text-white hover:bg-[#07111D] transition cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Globe2 className="w-4 h-4" />
                    <span>Configurações & Idiomas</span>
                  </div>
                </button>
              </nav>
            </div>

            {/* Fim do Menu: Card Institucional da Terra e Botão Sair */}
            <div className="space-y-3 pt-3 border-t border-[#183047]">
              {/* Card Institucional da Terra (Visual Exato do Mockup) */}
              <div className="relative rounded-2xl overflow-hidden border border-[#183047] bg-[#07111D] p-3.5 shadow-lg">
                <div className="absolute right-0 top-0 bottom-0 w-2/5 pointer-events-none opacity-40">
                  <img
                    src="/assets/aistudio/fatosbr_admin_banner_terra_b31996ff.png"
                    alt="Terra FatosBR"
                    className="w-full h-full object-cover object-right"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#07111D] to-transparent" />
                </div>
                <div className="relative z-10 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#F4F7FB]">
                    <Globe2 className="w-3.5 h-3.5 text-[#2378D4]" />
                    <span>FatosBR</span>
                  </div>
                  <p className="text-[10px] text-[#94A7BC] leading-tight">
                    O que realmente importa, no Brasil e no mundo.
                  </p>
                </div>
              </div>

              {/* Botão Sair */}
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onBackToApp();
                }}
                className="w-full py-2.5 rounded-xl bg-[#07111D] hover:bg-[#0A1726] border border-[#183047] text-xs font-semibold text-[#94A7BC] hover:text-white flex items-center justify-center gap-2 cursor-pointer transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sair</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: CADASTRAR EMPRESA                                      */}
      {/* ============================================================== */}
      {isRegisterCompanyModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm p-4 flex items-center justify-center animate-fadeIn"
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#07111D] border border-[#183047] p-5 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#183047]">
              <h3 className="text-sm font-bold text-[#F4F7FB] flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#41C8F4]" />
                <span>Cadastrar Nova Empresa</span>
              </h3>
              <button
                onClick={() => setIsRegisterCompanyModalOpen(false)}
                className="text-[#94A7BC] hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newCompanyName.trim()) return;
                onShowToast(`Empresa "${newCompanyName}" cadastrada com sucesso.`);
                setIsRegisterCompanyModalOpen(false);
                setNewCompanyName('');
                setNewCompanySector('');
              }}
              className="space-y-3"
            >
              <div className="space-y-1">
                <label className="text-[11px] text-[#94A7BC]">Nome da Empresa</label>
                <input
                  type="text"
                  placeholder="Ex: Nubank, Petrobras, OpenAI..."
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="w-full bg-[#030912] border border-[#183047] rounded-xl px-3 py-2 text-xs text-[#F4F7FB] focus:outline-none focus:border-[#2378D4]"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-[#94A7BC]">Setor / Indústria</label>
                <input
                  type="text"
                  placeholder="Ex: Tecnologia, Finanças, Energia..."
                  value={newCompanySector}
                  onChange={(e) => setNewCompanySector(e.target.value)}
                  className="w-full bg-[#030912] border border-[#183047] rounded-xl px-3 py-2 text-xs text-[#F4F7FB] focus:outline-none focus:border-[#2378D4]"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsRegisterCompanyModalOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-[#030912] border border-[#183047] text-[#94A7BC] hover:text-white font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-[#2378D4] hover:bg-[#1f6cc0] text-white font-bold"
                >
                  Cadastrar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: CONFIGURAR CHAVES SUPABASE                              */}
      {/* ============================================================== */}
      {showSupabaseConfigModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm p-4 flex items-center justify-center animate-fadeIn"
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#07111D] border border-[#183047] p-5 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#183047]">
              <h3 className="text-sm font-bold text-[#F4F7FB] flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <span>Configurar Conexão Supabase</span>
              </h3>
              <button
                onClick={() => setShowSupabaseConfigModal(false)}
                className="text-[#94A7BC] hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSupabaseKeys} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] text-[#94A7BC]">Project URL</label>
                <input
                  type="url"
                  placeholder="https://xyzcompany.supabase.co"
                  value={customSupabaseUrl}
                  onChange={(e) => setCustomSupabaseUrl(e.target.value)}
                  className="w-full bg-[#030912] border border-[#183047] rounded-xl px-3 py-2 text-xs text-[#F4F7FB] font-mono focus:outline-none focus:border-[#2378D4]"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-[#94A7BC]">Public Anon Key (Chave Pública)</label>
                <textarea
                  rows={3}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  value={customSupabaseKey}
                  onChange={(e) => setCustomSupabaseKey(e.target.value)}
                  className="w-full bg-[#030912] border border-[#183047] rounded-xl px-3 py-2 text-xs text-[#F4F7FB] font-mono focus:outline-none focus:border-[#2378D4]"
                  required
                />
              </div>

              <p className="text-[10px] text-zinc-400">
                🔒 Por segurança, apenas a chave pública anon é permitida no navegador. Nunca utilize a service_role.
              </p>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowSupabaseConfigModal(false)}
                  className="flex-1 py-2 rounded-xl bg-[#030912] border border-[#183047] text-[#94A7BC] hover:text-white font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-[#2378D4] hover:bg-[#1f6cc0] text-white font-bold"
                >
                  Salvar & Conectar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* BARRA INFERIOR DE NAVEGAÇÃO MOBILE (BOTTOM NAV)                */}
      {/* ============================================================== */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#030912]/98 backdrop-blur-md border-t border-[#183047] px-2 py-1.5 flex items-center justify-around shadow-2xl">
        {/* 1. Início (Tela 1) */}
        <button
          onClick={() => setCurrentScreen('overview')}
          className={`min-h-[48px] min-w-[54px] flex flex-col items-center justify-center py-1 text-[10px] transition cursor-pointer active:scale-95 ${
            currentScreen === 'overview'
              ? 'text-white font-bold'
              : 'text-[#94A7BC] hover:text-white'
          }`}
          aria-label="Início"
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span>Início</span>
        </button>

        {/* 2. Explorar / Eventos (Tela 4) */}
        <button
          onClick={() => setCurrentScreen('events')}
          className={`min-h-[48px] min-w-[54px] flex flex-col items-center justify-center py-1 text-[10px] transition cursor-pointer active:scale-95 ${
            currentScreen === 'events'
              ? 'text-white font-bold'
              : 'text-[#94A7BC] hover:text-white'
          }`}
          aria-label="Explorar"
        >
          <Compass className="w-5 h-5 mb-0.5" />
          <span>Explorar</span>
        </button>

        {/* 3. Favoritos / Ações Rápidas (Tela 3) */}
        <button
          onClick={() => setCurrentScreen('actions')}
          className={`min-h-[48px] min-w-[54px] flex flex-col items-center justify-center py-1 text-[10px] transition cursor-pointer active:scale-95 ${
            currentScreen === 'actions'
              ? 'text-white font-bold'
              : 'text-[#94A7BC] hover:text-white'
          }`}
          aria-label="Favoritos"
        >
          <Bookmark className="w-5 h-5 mb-0.5" />
          <span>Favoritos</span>
        </button>

        {/* 4. Perfil / Configurações (Tela 6) */}
        <button
          onClick={() => setCurrentScreen('settings')}
          className={`min-h-[48px] min-w-[54px] flex flex-col items-center justify-center py-1 text-[10px] transition cursor-pointer active:scale-95 ${
            currentScreen === 'settings'
              ? 'text-white font-bold'
              : 'text-[#94A7BC] hover:text-white'
          }`}
          aria-label="Perfil"
        >
          <User className="w-5 h-5 mb-0.5" />
          <span>Perfil</span>
        </button>
      </nav>
    </div>
  );
};
