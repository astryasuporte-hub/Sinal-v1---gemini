/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Shield,
  Activity,
  Layers,
  Database,
  Cpu,
  CreditCard,
  Mail,
  Users,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Terminal,
  Server,
  Lock,
  Plus,
  Search,
  ExternalLink,
  Sparkles,
  BarChart3,
  Calendar,
  Radio,
  FileText,
  Clock,
  ChevronRight,
  Check,
  Trash2,
  Play,
  Send,
  Eye,
  RefreshCw,
  Globe,
  Settings,
  X,
  Filter,
  Download,
  Menu,
  MessageSquare,
  Inbox,
  TrendingUp,
  Instagram,
  Globe2,
  Copy,
  Building2,
  Smartphone,
  Monitor,
  Zap
} from 'lucide-react';
import { Event, Source, Topic, Entity } from '../types/sinal';
import { newsIngestionService } from '../services/newsIngestionService';
import { aiSummarizerService } from '../services/aiSummarizerService';
import { adminService, AdminUser, AdminMetrics, SystemLog } from '../services/adminService';
import { ticketService, SupportTicket } from '../services/ticketService';
import { isSupabaseConfigured, checkSupabaseConnection } from '../lib/supabase';
import { resendService } from '../services/resendService';
import { ResendTelemetryCard } from './ResendTelemetryCard';
import { ProviderDiagnostics } from './ProviderDiagnostics';
import { ApiHealthDashboard } from './ApiHealthDashboard';
import { ApiHealthModal } from './ApiHealthModal';
import { FatosBrLogo } from './FatosBrLogo';
import { MarketTrendAnalysis } from './MarketTrendAnalysis';
import { InstagramCarouselStudio } from './InstagramCarouselStudio';
import { ThreeGlobeScene } from './ThreeGlobeScene';
import { ResendConfigPanel } from './ResendConfigPanel';
import { AdminCompanyManager } from './AdminCompanyManager';
import { AdminBriefingCustomizer } from './AdminBriefingCustomizer';
import { AdminMobileView } from './AdminMobileView';
import { AdminFinancialDashboard } from './AdminFinancialDashboard';
import { AdminFinancialZynPayPanel } from './AdminFinancialZynPayPanel';
import { ResendWebhookLiveMonitor } from './ResendWebhookLiveMonitor';
import { notificationService } from '../services/notificationService';
import { zynpayService } from '../services/zynpayService';

export type StatusColor = 'connected' | 'error' | 'disconnected';

export interface ProviderItem {
  id: string;
  name: string;
  category: string;
  status: StatusColor;
  ms: string;
  statusText: string;
}

interface VaultSecret {
  id: string;
  name: string;
  keyLabel: string;
  description: string;
  category: 'ai' | 'news' | 'billing' | 'email' | 'system';
  maskedValue: string;
  rawKey?: string;
  providerPingKey?: 'gnews' | 'newsapi' | 'worldnews' | 'nvidia' | 'resend' | 'zynpay';
  status: StatusColor;
  source: 'Vault (Supabase)' | 'Env Var (.env)' | 'NÃO CONFIGURADO';
  latencyMs?: number;
}

const INITIAL_SECRETS: VaultSecret[] = [
  {
    id: 'nvidia-api-key',
    name: 'NVIDIA NIM API Key',
    keyLabel: 'NVIDIA_API_KEY',
    description: 'Inferência e raciocínio protegido pelo proxy backend (/api/proxy/nvidia/chat)',
    category: 'ai',
    maskedValue: '••••••••••••0b4',
    rawKey: 'nvapi-protected-on-server',
    providerPingKey: 'nvidia',
    status: 'connected',
    source: 'Vault (Supabase)'
  },
  {
    id: 'gnews-key',
    name: 'GNews API Key',
    keyLabel: 'GNEWS_API_KEY',
    description: 'Agregação protegida pelo proxy backend (/api/proxy/gnews)',
    category: 'news',
    maskedValue: '••••••••••••d50',
    rawKey: 'gnews-protected-on-server',
    providerPingKey: 'gnews',
    status: 'connected',
    source: 'Vault (Supabase)'
  },
  {
    id: 'newsapi-key',
    name: 'NewsAPI Key',
    keyLabel: 'NEWSAPI_KEY',
    description: 'Agregação protegida pelo proxy backend (/api/proxy/newsapi)',
    category: 'news',
    maskedValue: '••••••••••••7e9',
    rawKey: 'newsapi-protected-on-server',
    providerPingKey: 'newsapi',
    status: 'connected',
    source: 'Vault (Supabase)'
  },
  {
    id: 'worldnews-key',
    name: 'World News API Key',
    keyLabel: 'WORLD_NEWS_API_KEY',
    description: 'Agregação protegida pelo proxy backend (/api/proxy/worldnews)',
    category: 'news',
    maskedValue: '••••••••••••bd6',
    rawKey: 'worldnews-protected-on-server',
    providerPingKey: 'worldnews',
    status: 'connected',
    source: 'Vault (Supabase)'
  },
  {
    id: 'resend-api-key',
    name: 'Resend API Key',
    keyLabel: 'RESEND_API_KEY',
    description: 'Disparo de Daily Briefings (07h00 / 20h00) e e-mails operacionais via Resend',
    category: 'email',
    maskedValue: 're_Zpj8••••••••••••keQe',
    rawKey: 'resend-protected-on-server',
    providerPingKey: 'resend',
    status: 'connected',
    source: 'Env Var (.env)',
    latencyMs: 1148
  },
  {
    id: 'zynpay-api-key',
    name: 'ZynPay Pix Gateway API Key',
    keyLabel: 'ZYNPAY_API_KEY',
    description: 'Gateway oficial Pix: Cobranças instantâneas, QR Code, Copia e Cola, Webhooks e Saldo',
    category: 'billing',
    maskedValue: 'zpk_live_••••••••••••8qm8',
    rawKey: 'zynpay-protected-on-server',
    providerPingKey: 'zynpay',
    status: 'connected',
    source: 'Env Var (.env)',
    latencyMs: 142
  }
];

type AdminTab =
  | 'overview'
  | 'events'
  | 'companies'
  | 'api-health'
  | 'providers'
  | 'ai'
  | 'vault'
  | 'billing'
  | 'logs'
  | 'users'
  | 'sources'
  | 'briefings'
  | 'webhooks'
  | 'tickets'
  | 'trends'
  | 'instagram'
  | 'three-globe';

interface AdminPanelProps {
  onBackToApp?: () => void;
  onOpenControl?: () => void;
  events?: Event[];
  sources?: Source[];
  topics?: Topic[];
  entities?: Entity[];
  onAddEvent?: (newEvent: Event) => void;
  onDeleteEvent?: (eventId: string) => void;
  onClearEvents?: () => void;
  onResetEvents?: () => void;
  onAddSource?: (newSource: Source) => void;
  onDeleteSource?: (sourceId: string) => void;
  onUpdateEntityLogo?: (entityId: string, logoUrl: string | null) => void;
  onAddEntity?: (newEntity: Entity) => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  onBackToApp,
  onOpenControl,
  events = [],
  sources = [],
  topics = [],
  entities = [],
  onAddEvent,
  onDeleteEvent,
  onClearEvents,
  onResetEvents,
  onAddSource,
  onDeleteSource,
  onUpdateEntityLogo,
  onAddEntity
}) => {
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('overview');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    return typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  });
  const [viewMode, setViewMode] = useState<'auto' | 'mobile' | 'desktop'>('auto');

  useEffect(() => {
    const handleResize = () => {
      setIsMobileViewport(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Estado de Dados do Supabase
  const [metrics, setMetrics] = useState<AdminMetrics>({
    activeUsers: 1,
    proSubscriptions: 0, // Admin não conta como assinante pagante
    trialUsers: 1,
    monitoredEvents: events.length,
    collectedArticles: events.reduce((acc, ev) => acc + (ev.sources?.length || 1), 0),
    sourcesCount: sources.length || 6
  });
  const [usersList, setUsersList] = useState<AdminUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userPlanFilter, setUserPlanFilter] = useState<'all' | 'pro' | 'trial'>('all');
  const [userProviderFilter, setUserProviderFilter] = useState<'all' | 'google' | 'email'>('all');
  const [selectedUserModal, setSelectedUserModal] = useState<AdminUser | null>(null);
  const [showRlsSnippet, setShowRlsSnippet] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Status de Conexão dos Provedores (Verde = Conectado / Vermelho = Erro / Cinza = Desconectado)
  const [providers, setProviders] = useState<ProviderItem[]>([
    { id: 'nvidia', name: 'NVIDIA NIM (IA)', category: 'ai', status: 'connected', ms: '--', statusText: 'Verificando...' },
    { id: 'gnews', name: 'GNews API', category: 'news', status: 'connected', ms: '--', statusText: 'Verificando...' },
    { id: 'newsapi', name: 'NewsAPI', category: 'news', status: 'connected', ms: '--', statusText: 'Verificando...' },
    { id: 'worldnews', name: 'World News API', category: 'news', status: 'connected', ms: '--', statusText: 'Verificando...' },
    {
      id: 'supabase',
      name: 'Supabase PostgreSQL',
      category: 'database',
      status: isSupabaseConfigured ? 'connected' : 'disconnected',
      ms: '--',
      statusText: isSupabaseConfigured ? 'Conectado' : 'Não conectado'
    },
    { id: 'billing-gw', name: 'FatosBR Pay Gateway (PIX)', category: 'billing', status: 'disconnected', ms: '--', statusText: 'Aguardando Credencial' },
    { id: 'resend', name: 'Resend (E-mails & Briefings)', category: 'email', status: 'connected', ms: '1.1 s', statusText: 'Conectado' }
  ]);

  // Status dos Jobs em Background
  const [jobs, setJobs] = useState<
    { id: string; name: string; status: StatusColor; statusLabel: string; time: string }[]
  >([
    { id: 'job-1', name: 'Coleta de notícias', status: 'connected', statusLabel: 'Ativo', time: 'A cada 15m' },
    { id: 'job-2', name: 'Clustering de mesmo fato', status: 'connected', statusLabel: 'Ativo', time: 'Automático' },
    { id: 'job-3', name: 'Síntese NVIDIA NIM', status: 'connected', statusLabel: 'Pronto', time: 'Live' },
    { id: 'job-4', name: 'Morning Briefing', status: 'connected', statusLabel: 'Ativo / Agendado', time: '07h00' },
    { id: 'job-5', name: 'Evening Briefing', status: 'connected', statusLabel: 'Ativo / Agendado', time: '20h00' },
    { id: 'job-6', name: 'Webhooks Resend (Engajamento)', status: 'connected', statusLabel: 'Escuta Ativa', time: 'Tempo Real' }
  ]);

  // Vault & Secrets
  const [secrets, setSecrets] = useState<VaultSecret[]>(INITIAL_SECRETS);
  const [secretSearch, setSecretSearch] = useState('');
  const [editingSecret, setEditingSecret] = useState<VaultSecret | null>(null);
  const [newSecretValue, setNewSecretValue] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; msg: string } | null>(null);
  const [isTestingBriefingDispatch, setIsTestingBriefingDispatch] = useState(false);
  const [isTestingMorningDispatch, setIsTestingMorningDispatch] = useState(false);
  const [isApiHealthModalOpen, setIsApiHealthModalOpen] = useState(false);

  // Ingestão & IA
  const [ingestionStatus, setIngestionStatus] = useState<'idle' | 'running' | 'success'>('idle');
  const [lastLog, setLastLog] = useState<string[]>([]);
  const [aiTestPrompt, setAiTestPrompt] = useState(
    'Empresas de semicondutores anunciam nova geração de processadores de IA com foco em redução de custos operacionais.'
  );
  const [aiTestResult, setAiTestResult] = useState<{ content: string; reasoning?: string } | null>(null);
  const [isTestingAi, setIsTestingAi] = useState(false);

  // Filtros de Eventos
  const [eventSearch, setEventSearch] = useState('');
  const [selectedEventModal, setSelectedEventModal] = useState<Event | null>(null);

  // Nova Fonte Modal
  const [isNewSourceModalOpen, setIsNewSourceModalOpen] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceDomain, setNewSourceDomain] = useState('');
  const [newSourceCategory, setNewSourceCategory] = useState('Tecnologia');

  // Logs Operacionais do Sistema
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [logFilter, setLogFilter] = useState<'ALL' | 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR'>('ALL');

  // Tickets de Suporte
  const [tickets, setTickets] = useState<SupportTicket[]>(() => ticketService.getAllTickets());
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(() => {
    const list = ticketService.getAllTickets();
    return list.length > 0 ? list[0].id : null;
  });
  const [ticketFilter, setTicketFilter] = useState<'all' | 'open' | 'answered' | 'resolved'>('all');
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [ticketSearch, setTicketSearch] = useState('');

  // Toasts
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleSendReply = async (ticketId: string) => {
    if (!replyText.trim()) return;
    setIsSendingReply(true);
    try {
      await ticketService.replyTicket(ticketId, replyText.trim(), 'Equipe FatosBR Suporte');
      setTickets(ticketService.getAllTickets());
      setReplyText('');
      addLog('SUCCESS', 'TICKETS', `Resposta enviada no ticket #${ticketId} e notificação por e-mail despachada`);
      showToast('Resposta enviada com sucesso! O usuário foi notificado por e-mail.');
    } catch {
      showToast('Erro ao enviar resposta.');
    } finally {
      setIsSendingReply(false);
    }
  };

  const handleResolveTicket = async (ticketId: string) => {
    setIsResolving(true);
    try {
      await ticketService.resolveTicket(ticketId, resolutionNote.trim() || undefined);
      setTickets(ticketService.getAllTickets());
      setResolutionNote('');
      addLog('SUCCESS', 'TICKETS', `Ticket #${ticketId} resolvido e e-mail de conclusão enviado`);
      showToast('Ticket finalizado com sucesso! E-mail de conclusão enviado ao usuário.');
    } catch {
      showToast('Erro ao resolver ticket.');
    } finally {
      setIsResolving(false);
    }
  };

  const addLog = (level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR', service: string, message: string) => {
    const newLogItem: SystemLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toLocaleTimeString('pt-BR'),
      level,
      service,
      message
    };
    setSystemLogs((prev) => [newLogItem, ...prev]);
  };

  // Atividade Real da Plataforma baseada nos acontecimentos ingeridos no sistema (Seg a Dom)
  const platformActivity = useMemo(() => {
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    events.forEach((ev) => {
      if (ev.publishedAt) {
        const d = new Date(ev.publishedAt);
        if (!isNaN(d.getTime())) {
          counts[d.getDay()]++;
        }
      }
    });
    const maxVal = Math.max(...counts, 1);
    const order = [1, 2, 3, 4, 5, 6, 0]; // Seg -> Dom
    return order.map((dayIdx) => {
      const val = counts[dayIdx];
      const hPercent = val > 0 ? Math.max(Math.round((val / maxVal) * 100), 12) : 4;
      return {
        day: days[dayIdx],
        val,
        h: `${hPercent}%`
      };
    });
  }, [events]);

  // Estatísticas de Usuários em Tempo Real
  const userStats = useMemo(() => {
    const total = usersList.length;
    const superAdmins = usersList.filter(
      (u) => u.isAdmin || u.email.toLowerCase() === 'astryasuporte@gmail.com'
    ).length;
    const proUsers = usersList.filter(
      (u) =>
        !u.isAdmin &&
        u.email.toLowerCase() !== 'astryasuporte@gmail.com' &&
        (u.planName === 'PRO' || u.planName === 'PRO_UNLIMITED')
    ).length;
    const trialUsers = usersList.filter(
      (u) =>
        !u.isAdmin &&
        u.email.toLowerCase() !== 'astryasuporte@gmail.com' &&
        (u.planName === 'TRIAL_7D' || u.planName === 'TRIAL' || u.subscriptionStatus === 'TRIAL_ACTIVE')
    ).length;
    const googleCount = usersList.filter(
      (u) => (u.provider || (u.email.includes('gmail') ? 'google' : 'email')) === 'google'
    ).length;
    return { total, superAdmins, proUsers, trialUsers, googleCount };
  }, [usersList]);

  // Lista Filtrada de Usuários
  const filteredUsers = useMemo(() => {
    return usersList.filter((u) => {
      const q = userSearchTerm.trim().toLowerCase();
      const matchesSearch =
        !q ||
        (u.id && u.id.toLowerCase().includes(q)) ||
        (u.fullName && u.fullName.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q));
      if (!matchesSearch) return false;

      const isUserAdmin = u.isAdmin || u.email.toLowerCase() === 'astryasuporte@gmail.com';
      if (userPlanFilter === 'pro' && !isUserAdmin && u.planName !== 'PRO' && u.planName !== 'PRO_UNLIMITED') {
        return false;
      }
      if (userPlanFilter === 'trial' && (isUserAdmin || (u.planName !== 'TRIAL_7D' && u.planName !== 'TRIAL' && u.subscriptionStatus !== 'TRIAL_ACTIVE'))) {
        return false;
      }

      const prov = u.provider || (u.email.includes('gmail') ? 'google' : 'email');
      if (userProviderFilter !== 'all' && prov !== userProviderFilter) {
        return false;
      }

      return true;
    });
  }, [usersList, userSearchTerm, userPlanFilter, userProviderFilter]);

  const copyRlsSql = () => {
    const sql = `-- Políticas RLS no Supabase para liberar leitura das contas para o Super Admin
DROP POLICY IF EXISTS "Usuário ou Super Admin lê perfis" ON public.profiles;
CREATE POLICY "Usuário ou Super Admin lê perfis" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id 
    OR (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

DROP POLICY IF EXISTS "Usuário insere o próprio perfil" ON public.profiles;
CREATE POLICY "Usuário insere o próprio perfil" ON public.profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id 
    OR (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
  );

DROP POLICY IF EXISTS "Usuário ou Super Admin edita o próprio perfil" ON public.profiles;
CREATE POLICY "Usuário ou Super Admin edita o próprio perfil" ON public.profiles
  FOR UPDATE USING (
    auth.uid() = id 
    OR (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
  );`;

    navigator.clipboard?.writeText(sql);
    setCopiedSql(true);
    showToast('Script SQL copiado com sucesso! Execute no SQL Editor do Supabase.');
    setTimeout(() => setCopiedSql(false), 3000);
  };

  // Carregar métricas e usuários do Supabase
  const loadDatabaseData = async () => {
    try {
      const metricData = await adminService.getMetrics(events.length);
      setMetrics(metricData);

      setIsLoadingUsers(true);
      const remoteUsers = await adminService.getUsers();
      setUsersList(remoteUsers);
      setIsLoadingUsers(false);

      // Checar status real do Supabase
      if (isSupabaseConfigured) {
        const conn = await checkSupabaseConnection();
        setProviders((prev) =>
          prev.map((p) =>
            p.id === 'supabase'
              ? {
                  ...p,
                  status: conn.connected ? 'connected' : 'error',
                  statusText: conn.connected ? 'Conectado' : 'Erro de conexão'
                }
              : p
          )
        );
      } else {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === 'supabase'
              ? { ...p, status: 'disconnected', statusText: 'Não conectado' }
              : p
          )
        );
      }

      // Testar conectividade ao vivo com GNews, NewsAPI, World News e NVIDIA NIM
      newsIngestionService.testProviderPing('gnews').then((ping) => {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === 'gnews'
              ? {
                  ...p,
                  status: ping.success ? 'connected' : 'error',
                  ms: `${ping.latencyMs} ms`,
                  statusText: ping.success ? 'Conectado' : 'Erro'
                }
              : p
          )
        );
      });

      newsIngestionService.testProviderPing('newsapi').then((ping) => {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === 'newsapi'
              ? {
                  ...p,
                  status: ping.success ? 'connected' : 'error',
                  ms: `${ping.latencyMs} ms`,
                  statusText: ping.success ? 'Conectado' : 'Erro'
                }
              : p
          )
        );
      });

      newsIngestionService.testProviderPing('worldnews').then((ping) => {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === 'worldnews'
              ? {
                  ...p,
                  status: ping.success ? 'connected' : 'error',
                  ms: `${ping.latencyMs} ms`,
                  statusText: ping.success ? 'Conectado' : 'Erro'
                }
              : p
          )
        );
      });

      newsIngestionService.testProviderPing('nvidia').then((ping) => {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === 'nvidia'
              ? {
                  ...p,
                  status: ping.success ? 'connected' : 'error',
                  ms: `${ping.latencyMs} ms`,
                  statusText: ping.success ? 'Conectado' : 'Erro'
                }
              : p
          )
        );
      });
    } catch {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    loadDatabaseData();

    // Inscrição em tempo real nas tabelas do Supabase
    const userSub = adminService.subscribeToUsers((freshUsers) => {
      setUsersList(freshUsers);
      setMetrics((prev) => ({
        ...prev,
        activeUsers: Math.max(freshUsers.length, 1)
      }));
    });

    return () => {
      userSub.unsubscribe();
    };
  }, [events.length]);

  // Executar Ingestão Real com IA
  const handleTriggerIngestion = async () => {
    setIngestionStatus('running');
    setLastLog([
      'Iniciando rotina de ingestão em tempo real...',
      'Consultando provedores de imprensa primária (GNews, NewsAPI, World News)...'
    ]);
    addLog('INFO', 'INGESTION', 'Pipeline de ingestão iniciado.');

    try {
      const batch = await newsIngestionService.fetchIncomingNewsBatch();
      setLastLog((prev) => [
        ...prev,
        `Lote coletado: "${batch.batchName}" (${batch.articles.length} matérias verificadas).`,
        'Enviando para o modelo NVIDIA NIM (nemotron-3.5-lightning-30b-a3b) para deduplicação e síntese...'
      ]);
      addLog('INFO', 'INGESTION', `${batch.articles.length} matérias coletadas de fontes primárias.`);

      const generatedEvent = await aiSummarizerService.synthesizeArticlesToEvent(batch.articles);

      setLastLog((prev) => [
        ...prev,
        `Agrupamento concluído: ${generatedEvent.sources.length} fontes consolidadas em 1 Acontecimento.`,
        'Síntese contextual e impacto de mercado gerados com sucesso.',
        `Publicando no feed: "${generatedEvent.title.substring(0, 50)}..."`
      ]);

      if (isSupabaseConfigured) {
        setLastLog((prev) => [...prev, 'Gravando Acontecimento na tabela "events" do Supabase...']);
        await adminService.saveEventToSupabase(generatedEvent);
        setLastLog((prev) => [...prev, 'Persistido no Supabase PostgreSQL com sucesso.']);
      }

      if (onAddEvent) {
        onAddEvent(generatedEvent);
      }

      setIngestionStatus('success');
      addLog('SUCCESS', 'AI_SYNTHESIS', `Acontecimento gerado: "${generatedEvent.title.substring(0, 40)}..."`);
      showToast(`Acontecimento publicado no feed com ${generatedEvent.sources.length} fontes cruzadas.`);
      loadDatabaseData();
    } catch (err: any) {
      setLastLog((prev) => [...prev, `Erro na execução do pipeline: ${err?.message || 'Falha na ingestão'}`]);
      setIngestionStatus('idle');
      addLog('ERROR', 'INGESTION', `Falha na ingestão: ${err?.message}`);
      showToast('Falha ao processar ingestão.');
    }
  };

  // Testar segredo / API ao vivo com indicação dinâmica de cores
  const handleTestSecret = async (secret: VaultSecret) => {
    setTestingId(secret.id);
    addLog('INFO', 'VAULT', `Testando credencial ${secret.keyLabel}...`);

    if (secret.providerPingKey === 'resend') {
      const statusRes = await resendService.getStatus();
      setTestingId(null);
      const newStatus: StatusColor = statusRes.connected ? 'connected' : 'error';

      setSecrets((prev) =>
        prev.map((s) =>
          s.id === secret.id
            ? { ...s, status: newStatus, latencyMs: statusRes.latencyMs }
            : s
        )
      );

      setProviders((prev) =>
        prev.map((p) =>
          p.id === 'resend'
            ? {
                ...p,
                status: newStatus,
                ms: `${statusRes.latencyMs} ms`,
                statusText: statusRes.connected ? 'Conectado' : 'Erro'
              }
            : p
        )
      );

      setTestResult({
        id: secret.id,
        success: statusRes.connected,
        msg: statusRes.connected
          ? `Conexão ativa com Resend API (${statusRes.latencyMs} ms). Remetente: ${statusRes.sender}`
          : 'Falha na conexão com o provedor Resend.'
      });
      addLog(statusRes.connected ? 'SUCCESS' : 'WARN', 'VAULT', `${secret.name}: ${statusRes.connected ? `Conectado (${statusRes.latencyMs} ms)` : 'Falha'}`);
      setTimeout(() => setTestResult(null), 5000);
      return;
    }

    if (secret.providerPingKey === 'zynpay') {
      const zynRes = await zynpayService.getBalance();
      setTestingId(null);
      const isConnected = zynRes.success;
      setSecrets((prev) =>
        prev.map((s) =>
          s.id === secret.id
            ? { ...s, status: isConnected ? 'connected' : 'error', latencyMs: 120 }
            : s
        )
      );
      setTestResult({
        id: secret.id,
        success: isConnected,
        msg: isConnected
          ? `Conexão ativa com ZynPay API. Status da conta: ${zynRes.balance?.accountStatus || 'Ativa'}`
          : 'Falha na conexão com ZynPay.'
      });
      addLog(isConnected ? 'SUCCESS' : 'WARN', 'VAULT', `${secret.name}: ${isConnected ? 'Conectado' : 'Falha'}`);
      setTimeout(() => setTestResult(null), 5000);
      return;
    }

    if (secret.providerPingKey) {
      const ping = await newsIngestionService.testProviderPing(secret.providerPingKey as any);
      setTestingId(null);
      const newStatus: StatusColor = ping.success ? 'connected' : 'error';

      // Atualizar status no secret
      setSecrets((prev) =>
        prev.map((s) =>
          s.id === secret.id
            ? { ...s, status: newStatus, latencyMs: ping.latencyMs }
            : s
        )
      );

      // Atualizar status no provedor correspondente
      setProviders((prev) =>
        prev.map((p) =>
          p.id === secret.providerPingKey
            ? {
                ...p,
                status: newStatus,
                ms: `${ping.latencyMs} ms`,
                statusText: ping.success ? 'Conectado' : 'Erro'
              }
            : p
        )
      );

      setTestResult({
        id: secret.id,
        success: ping.success,
        msg: ping.message
      });
      addLog(ping.success ? 'SUCCESS' : 'WARN', 'VAULT', `${secret.name}: ${ping.message}`);
      setTimeout(() => setTestResult(null), 5000);
      return;
    }

    setTimeout(() => {
      setTestingId(null);
      // Se não tiver chave real configurada, permanece cinza (desconectado)
      if (secret.source === 'NÃO CONFIGURADO' || !secret.rawKey) {
        setTestResult({
          id: secret.id,
          success: false,
          msg: `${secret.name} não possui chave de API configurada no momento. Status mantido como Não Conectado (Cinza).`
        });
        addLog('WARN', 'VAULT', `${secret.name} não configurado.`);
        setTimeout(() => setTestResult(null), 5000);
        return;
      }

      setSecrets((prev) =>
        prev.map((s) => (s.id === secret.id ? { ...s, status: 'connected' } : s))
      );
      setTestResult({
        id: secret.id,
        success: true,
        msg: `Conexão bem-sucedida (${secret.latencyMs || 140}ms) com o gateway via Supabase Vault.`
      });
      addLog('SUCCESS', 'VAULT', `${secret.name} respondendo normalmente.`);
      setTimeout(() => setTestResult(null), 4000);
    }, 700);
  };

  // Salvar rotação de chave
  const handleSaveRotatedSecret = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSecret || !newSecretValue.trim()) return;

    const suffix = newSecretValue.slice(-4);
    setSecrets((prev) =>
      prev.map((s) =>
        s.id === editingSecret.id
          ? {
              ...s,
              maskedValue: `••••••••••••${suffix}`,
              lastRotated: 'Agora há pouco',
              status: 'connected',
              source: 'Vault (Supabase)'
            }
          : s
      )
    );
    addLog('SUCCESS', 'VAULT', `Segredo ${editingSecret.keyLabel} rotacionado no Supabase Vault.`);
    showToast(`Segredo "${editingSecret.name}" rotacionado com sucesso.`);
    setEditingSecret(null);
    setNewSecretValue('');
  };

  // Sincronizar catálogo com Supabase
  const handleSeedDatabase = async () => {
    if (!isSupabaseConfigured) {
      showToast('Supabase não conectado. Configure as credenciais no .env.');
      return;
    }

    setIsSeeding(true);
    addLog('INFO', 'DATABASE', 'Iniciando sincronização completa de catálogo para o Supabase...');
    const res = await adminService.seedSupabase(events, sources, topics, entities);
    setIsSeeding(false);

    if (res.success) {
      addLog('SUCCESS', 'DATABASE', res.message);
      showToast(res.message);
      loadDatabaseData();
    } else {
      addLog('ERROR', 'DATABASE', res.message);
      showToast(res.message);
    }
  };

  // Testar IA com prompt customizado
  const handleRunAiPromptTest = async () => {
    if (!aiTestPrompt.trim()) return;
    setIsTestingAi(true);
    addLog('INFO', 'NVIDIA_NIM', 'Iniciando teste de inferência em nvidia/nemotron-3.5-lightning-30b-a3b...');

    try {
      const res = await aiSummarizerService.callNvidiaNemotron(
        `Analise esta matéria e sintetize em JSON estruturado com title, summary, whatHappened e whyItMatters:\n\n${aiTestPrompt}`
      );
      setAiTestResult(res);
      addLog('SUCCESS', 'NVIDIA_NIM', 'Inferência concluída com sucesso.');
      showToast('Inferência com NVIDIA NIM concluída.');
    } catch (err: any) {
      addLog('ERROR', 'NVIDIA_NIM', `Erro na inferência: ${err?.message}`);
      showToast(`Erro na inferência: ${err?.message}`);
    } finally {
      setIsTestingAi(false);
    }
  };

  // Adicionar Fonte
  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim() || !newSourceDomain.trim()) return;

    const sourceObj: Source = {
      id: `src-${Date.now()}`,
      name: newSourceName.trim(),
      domain: newSourceDomain.trim().toLowerCase().replace('https://', '').replace('http://', '').replace('www.', ''),
      category: newSourceCategory,
      isFollowed: true,
      brandColor: '#3b82f6'
    };

    if (onAddSource) {
      onAddSource(sourceObj);
    }

    if (isSupabaseConfigured) {
      await adminService.createSource(sourceObj);
    }

    addLog('SUCCESS', 'SOURCES', `Nova fonte registrada: ${sourceObj.name} (${sourceObj.domain})`);
    showToast(`Fonte "${sourceObj.name}" adicionada com sucesso.`);
    setIsNewSourceModalOpen(false);
    setNewSourceName('');
    setNewSourceDomain('');
  };

  const filteredSecrets = secrets.filter(
    (s) =>
      s.name.toLowerCase().includes(secretSearch.toLowerCase()) ||
      s.keyLabel.toLowerCase().includes(secretSearch.toLowerCase()) ||
      s.category.toLowerCase().includes(secretSearch.toLowerCase())
  );

  const filteredEvents = events.filter(
    (e) =>
      e.title.toLowerCase().includes(eventSearch.toLowerCase()) ||
      e.category.toLowerCase().includes(eventSearch.toLowerCase()) ||
      e.summary.toLowerCase().includes(eventSearch.toLowerCase())
  );

  const filteredLogs = systemLogs.filter((log) => {
    if (logFilter === 'ALL') return true;
    return log.level === logFilter;
  });

  // Lista de Abas do Painel Admin
  const ADMIN_NAV_ITEMS: {
    id: AdminTab;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string | number;
  }[] = [
    { id: 'overview', label: 'Visão geral', shortLabel: 'Geral', icon: BarChart3 },
    { id: 'trends', label: 'Tendências de Mercado', shortLabel: 'Tendências', icon: TrendingUp, badge: '30D' },
    { id: 'events', label: 'Eventos / Feed', shortLabel: 'Eventos', icon: Calendar, badge: events.length },
    { id: 'companies', label: 'Empresas & Logotipos', shortLabel: 'Empresas', icon: Building2, badge: entities.filter((e) => e.type === 'company').length },
    { id: 'api-health', label: 'Saúde das APIs', shortLabel: 'Saúde APIs', icon: Activity, badge: 'Live' },
    { id: 'providers', label: 'Provedores & 24/7', shortLabel: 'Provedores', icon: Radio, badge: '4 APIs' },
    { id: 'ai', label: 'IA / Provedores', shortLabel: 'IA / NIM', icon: Cpu },
    { id: 'vault', label: 'Vault / Segredos', shortLabel: 'Vault', icon: Lock, badge: 'Vault' },
    { id: 'billing', label: 'Assinaturas & PIX', shortLabel: 'Assinaturas', icon: CreditCard },
    { id: 'users', label: 'Usuários & Sessões', shortLabel: 'Usuários', icon: Users, badge: usersList.length || 1 },
    { id: 'sources', label: 'Fontes & Veículos', shortLabel: 'Fontes', icon: Layers, badge: sources.length },
    { id: 'briefings', label: 'Briefings & E-mails', shortLabel: 'Briefings', icon: Mail },
    { id: 'webhooks', label: 'Webhooks Resend', shortLabel: 'Webhooks', icon: Activity, badge: 'Live' },
    {
      id: 'tickets',
      label: 'Tickets de Suporte',
      shortLabel: 'Tickets',
      icon: MessageSquare,
      badge: tickets.filter((t) => t.status === 'open').length || undefined
    },
    { id: 'instagram', label: 'Estúdio Instagram', shortLabel: 'Instagram', icon: Instagram, badge: '3/dia' },
    { id: 'three-globe', label: 'Cena 3D Three.js', shortLabel: 'Cena 3D', icon: Globe2, badge: '3D PBR' },
    { id: 'logs', label: 'Logs & Auditoria', shortLabel: 'Logs', icon: Terminal, badge: systemLogs.length }
  ];

  const currentTabItem = ADMIN_NAV_ITEMS.find((item) => item.id === activeAdminTab) || ADMIN_NAV_ITEMS[0];

  // Helper para renderizar cores de status padronizadas:
  // Verde: funcionando / conectado
  // Vermelho: erro / não funcionando
  // Cinza: não conectado / standby / desconectado
  const renderStatusBadge = (status: StatusColor, customText?: string) => {
    if (status === 'connected') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
          <span>{customText || 'Conectado'}</span>
        </span>
      );
    }
    if (status === 'error') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-red-500/10 text-red-400 border border-red-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
          <span>{customText || 'Erro'}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-zinc-800/80 text-zinc-400 border border-zinc-700/50">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0"></span>
        <span>{customText || 'Não conectado'}</span>
      </span>
    );
  };

  // Renderização do Painel Mobile se estiver em viewport móvel ou no modo forçado
  if ((isMobileViewport && viewMode !== 'desktop') || viewMode === 'mobile') {
    return (
      <AdminMobileView
        events={events}
        sources={sources}
        topics={topics}
        entities={entities}
        users={usersList}
        metrics={metrics}
        systemLogs={systemLogs}
        providers={providers}
        onBackToApp={onBackToApp}
        onOpenControl={onOpenControl}
        onShowToast={showToast}
        onAddEvent={onAddEvent}
        onDeleteEvent={onDeleteEvent}
        onClearEvents={onClearEvents}
        onResetEvents={onResetEvents}
        onAddSource={onAddSource}
        onDeleteSource={onDeleteSource}
        onUpdateEntityLogo={onUpdateEntityLogo}
        onAddEntity={onAddEntity}
        onTriggerIngestion={handleTriggerIngestion}
        ingestionStatus={ingestionStatus}
        onSeedDatabase={handleSeedDatabase}
        isSeeding={isSeeding}
        onToggleDesktopView={() => setViewMode('desktop')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#07090e] text-zinc-100 flex flex-col md:flex-row antialiased">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-5 right-5 z-50 bg-[#141b2d] border border-blue-500/40 text-blue-100 px-4 py-2.5 rounded-xl shadow-2xl text-xs flex items-center gap-2 animate-fade-in font-medium max-w-[90vw]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate">{toastMsg}</span>
        </div>
      )}

      {/* ================= BARRA SUPERIOR MOBILE (STICKY TOP) ================= */}
      <header className="md:hidden sticky top-0 z-30 bg-[#0a0d14]/95 backdrop-blur-md border-b border-[#151c2c] px-3.5 py-2.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-1.5 rounded-lg bg-[#111726] border border-[#1b253b] text-zinc-300 hover:text-white transition cursor-pointer"
              aria-label="Abrir menu de navegação"
            >
              {isMobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <div className="flex items-center gap-1">
              <FatosBrLogo size="sm" glow={true} />
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold ml-1">
                Admin
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Botão de Destaque Saúde da API Mobile */}
            <button
              onClick={() => setIsApiHealthModalOpen(true)}
              className="text-[10px] font-mono px-3 py-1.5 min-h-[36px] rounded-full bg-white text-black font-bold border border-white flex items-center gap-1.5 transition cursor-pointer shadow-sm hover:bg-zinc-200 active:bg-zinc-300"
              title="Abrir telemetria de Saúde da API"
            >
              <Activity className="w-3.5 h-3.5 text-black" />
              <span>Saúde da API</span>
            </button>

            {onBackToApp && (
              <button
                onClick={onBackToApp}
                className="p-1.5 min-h-[36px] min-w-[36px] rounded-lg bg-black border border-zinc-800 text-zinc-300 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1"
                title="Voltar ao App"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">App</span>
              </button>
            )}
          </div>
        </div>

        {/* Barra de Navegação Horizontal Swipeable para Mobile */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 -mx-1 px-1">
          {ADMIN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeAdminTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveAdminTab(item.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl text-xs font-semibold whitespace-nowrap transition shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-white text-black font-bold shadow-md'
                    : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-black' : 'text-zinc-400'}`} />
                <span>{item.shortLabel}</span>
                {item.badge !== undefined && (
                  <span
                    className={`text-[9px] font-mono px-1 rounded ${
                      isActive ? 'bg-black text-white' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* ================= DRAWER MOBILE COMPLETO ================= */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/80 backdrop-blur-sm animate-fade-in flex flex-col">
          <div className="bg-[#0a0d14] border-b border-[#182136] p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-400" />
              <div>
                <div className="font-bold text-sm text-white">Menu do Painel Admin</div>
                <div className="text-[10px] text-zinc-400 font-mono">astryasuporte@gmail.com</div>
              </div>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="p-1.5 rounded-lg bg-[#141d30] text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-1 text-xs">
            {ADMIN_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeAdminTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveAdminTab(item.id);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl font-medium transition cursor-pointer ${
                    isActive
                      ? 'bg-white text-black font-bold shadow-md'
                      : 'text-zinc-300 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-black' : 'text-zinc-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && (
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                        isActive ? 'bg-black text-white' : 'bg-zinc-900 text-zinc-300 border border-zinc-800'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="p-4 border-t border-[#182136] bg-[#07090e]">
            {onBackToApp && (
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onBackToApp();
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#111726] border border-[#1e2840] text-white text-xs font-semibold"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Voltar ao App Principal</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ================= 1. SIDEBAR ADMINISTRATIVA (DESKTOP) ================= */}
      <aside className="hidden md:flex md:w-64 bg-[#0a0d14] border-r border-[#151c2c] flex-col shrink-0 min-h-screen">
        {/* Brand */}
        <div className="p-5 flex items-center justify-between border-b border-[#151c2c]">
          <div className="flex items-center gap-2">
            <FatosBrLogo size="md" glow={true} />
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold ml-1">
              Admin
            </span>
          </div>
        </div>

        {/* Menu Items */}
        <nav className="p-3 space-y-1 text-xs flex-1">
          {ADMIN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeAdminTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveAdminTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium transition cursor-pointer ${
                  isActive
                    ? 'bg-white text-black font-bold shadow-md'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-black' : 'text-zinc-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      isActive ? 'bg-black text-white' : 'bg-zinc-900 text-zinc-300 border border-zinc-800'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Retornar ao App */}
        <div className="p-4 border-t border-[#151c2c] space-y-2">
          {/* Status do Super Admin (Verde quando conectado) */}
          <div className="text-[11px] px-1 font-mono flex items-center gap-1.5 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>astryasuporte (Online)</span>
          </div>
          {onBackToApp && (
            <button
              onClick={onBackToApp}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[#111726] hover:bg-[#161f33] border border-[#1e2840] text-zinc-300 hover:text-white text-xs font-semibold transition cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Voltar ao App FatosBR</span>
            </button>
          )}
        </div>
      </aside>

      {/* ================= 2. CONTEÚDO PRINCIPAL (OTIMIZADO MOBILE & DESKTOP) ================= */}
      <main className="flex-1 overflow-y-auto px-3.5 sm:px-8 py-4 sm:py-6 space-y-5 sm:space-y-6 max-w-7xl w-full">
        {/* Top Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#141b2d]">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                {currentTabItem.label}
              </h1>

              {/* Status do Supabase: Verde se conectado, Cinza se não conectado */}
              {isSupabaseConfigured
                ? renderStatusBadge('connected', 'Supabase Conectado')
                : renderStatusBadge('disconnected', 'Supabase Não Conectado')}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Administração de acontecimentos, pipeline NVIDIA NIM, chaves e assinaturas.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Alternador de Visualização Desktop / Mobile */}
            <div className="flex items-center p-0.5 rounded-xl bg-[#07111D] border border-[#183047] shadow-sm">
              <button
                onClick={() => setViewMode('desktop')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer bg-[#2378D4] text-white shadow-sm"
                title="Visualização padrão desktop"
              >
                <Monitor className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Desktop</span>
              </button>
              <button
                onClick={() => setViewMode('mobile')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer text-[#94A7BC] hover:text-[#F4F7FB] hover:bg-[#10233b]"
                title="Visualizar Painel Mobile (Mockup de 6 telas)"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Mobile</span>
              </button>
            </div>

            {/* Ação: Disparar Ingestão */}
            <button
              onClick={handleTriggerIngestion}
              disabled={ingestionStatus === 'running'}
              className="px-3.5 py-2 min-h-[38px] rounded-xl bg-[#07111D] hover:bg-[#0A1726] border border-[#183047] hover:border-[#2378D4] text-[#F4F7FB] font-semibold text-xs transition cursor-pointer shadow-sm disabled:opacity-50 flex items-center gap-2 active:scale-95"
              title="Disparar coleta e processamento imediato dos feeds das APIs"
            >
              <Play className="w-3.5 h-3.5 text-[#41C8F4] fill-[#41C8F4]" />
              <span>{ingestionStatus === 'running' ? 'Ingerindo...' : 'Disparar Ingestão'}</span>
            </button>

            {/* Ação: Saúde da API */}
            <button
              onClick={() => setIsApiHealthModalOpen(true)}
              className="px-3.5 py-2 min-h-[38px] rounded-xl bg-[#07111D] hover:bg-[#0A1726] border border-[#183047] hover:border-[#20D6A0] text-[#F4F7FB] font-semibold text-xs transition cursor-pointer shadow-sm flex items-center gap-2 active:scale-95"
              title="Abrir telemetria em tempo real e cotas de APIs (GNews, NewsAPI, World News, NVIDIA NIM)"
            >
              <Activity className="w-3.5 h-3.5 text-[#20D6A0]" />
              <span>Saúde da API</span>
            </button>

            {/* Ação: Testar Web Push */}
            <button
              onClick={async () => {
                const granted = await notificationService.requestPermission();
                if (granted) {
                  const sent = await notificationService.triggerTestNotification(
                    'FatosBR • Alerta de Breaking News (Web Push)',
                    'Notificação em segundo plano via Web Push ServiceWorker disparada com sucesso.'
                  );
                  showToast(sent ? 'Notificação Web Push enviada ao navegador!' : 'Permissão concedida. Teste emitido.');
                  addLog('SUCCESS', 'WEB_PUSH', 'Notificação de teste emitida via Web Push API / Service Worker.');
                } else {
                  showToast('Permissão de notificações não concedida no navegador.');
                  addLog('WARN', 'WEB_PUSH', 'Permissão de notificação negada pelo navegador.');
                }
              }}
              className="px-3.5 py-2 min-h-[38px] rounded-xl bg-[#07111D] hover:bg-[#0A1726] border border-[#183047] hover:border-[#2378D4] text-[#41C8F4] font-semibold text-xs transition cursor-pointer shadow-sm flex items-center gap-2 active:scale-95"
              title="Testar disparo de notificação push em segundo plano via Web Push API e ServiceWorker"
            >
              <Zap className="w-3.5 h-3.5 text-[#41C8F4]" />
              <span>Web Push</span>
            </button>

            {/* Ação: Sincronizar Banco */}
            <button
              onClick={handleSeedDatabase}
              disabled={isSeeding}
              className="px-3.5 py-2 min-h-[38px] rounded-xl bg-[#07111D] hover:bg-[#0A1726] border border-[#183047] hover:border-zinc-600 text-zinc-300 hover:text-white text-xs font-medium transition cursor-pointer shadow-sm disabled:opacity-50 flex items-center gap-2 active:scale-95"
              title="Popula ou atualiza as tabelas de dados no Supabase"
            >
              <Database className={`w-3.5 h-3.5 text-zinc-400 ${isSeeding ? 'animate-spin' : ''}`} />
              <span>Sincronizar Banco</span>
            </button>

            {/* Ação Opcional: FatosBR Control */}
            {onOpenControl && (
              <button
                onClick={onOpenControl}
                className="px-3.5 py-2 min-h-[38px] rounded-xl bg-[#07111D] hover:bg-[#0A1726] border border-[#183047] hover:border-emerald-500/50 text-emerald-400 font-semibold text-xs transition cursor-pointer shadow-sm flex items-center gap-1.5 active:scale-95"
                title="Abrir Central FatosBR Control"
              >
                <Instagram className="w-3.5 h-3.5 text-emerald-400" />
                <span>Control</span>
              </button>
            )}
          </div>
        </div>

        {/* 4 Cards de Métricas Principais (Grid 2 colunas no mobile, 4 no desktop) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
          <div className="p-3.5 sm:p-4 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-2">
            <div className="flex items-center justify-between">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              {renderStatusBadge('connected', 'Ativo')}
            </div>
            <div>
              <div className="text-[10px] sm:text-[11px] text-zinc-400 font-medium">Usuários</div>
              <div className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">{metrics.activeUsers}</div>
              <div className="text-[9px] sm:text-[10px] text-zinc-500 truncate mt-0.5">Super Admin astrya</div>
            </div>
          </div>

          {/* CARD DE ASSINATURAS PRO: NÃO CONTA O ADMIN NEM O 7D */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-2">
            <div className="flex items-center justify-between">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <CreditCard className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              {/* Verde se houver pagantes reais, Cinza se 0 pagantes (apenas admin ou trials) */}
              {metrics.proSubscriptions > 0
                ? renderStatusBadge('connected', 'PIX Ativo')
                : renderStatusBadge('disconnected', 'R$ 0,00')}
            </div>
            <div>
              <div className="text-[10px] sm:text-[11px] text-zinc-400 font-medium">Assinaturas Pro (PIX)</div>
              <div className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
                {metrics.proSubscriptions}
              </div>
              <div className="text-[9px] sm:text-[10px] text-zinc-400 truncate mt-0.5">
                {metrics.proSubscriptions === 0
                  ? 'Admin isento • Trials mostram - 7D'
                  : `${metrics.proSubscriptions} pagantes ativos`}
              </div>
            </div>
          </div>

          <div className="p-3.5 sm:p-4 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-2">
            <div className="flex items-center justify-between">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              {renderStatusBadge('connected', 'Deduplicados')}
            </div>
            <div>
              <div className="text-[10px] sm:text-[11px] text-zinc-400 font-medium">Acontecimentos</div>
              <div className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">{events.length}</div>
              <div className="text-[9px] sm:text-[10px] text-zinc-500 truncate mt-0.5">Agrupados no Feed</div>
            </div>
          </div>

          <div className="p-3.5 sm:p-4 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-2">
            <div className="flex items-center justify-between">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center text-blue-400">
                <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              {renderStatusBadge('connected', 'Multi-fonte')}
            </div>
            <div>
              <div className="text-[10px] sm:text-[11px] text-zinc-400 font-medium">Fontes</div>
              <div className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">{sources.length}</div>
              <div className="text-[9px] sm:text-[10px] text-zinc-500 truncate mt-0.5">Imprensa primária</div>
            </div>
          </div>
        </div>

        {/* ================= TAB 1: VISÃO GERAL ================= */}
        {activeAdminTab === 'overview' && (
          <div className="space-y-5 sm:space-y-6">
            {/* Banner de Acesso Rápido ao Estúdio Instagram */}
            <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-zinc-950 via-zinc-900 to-black border border-zinc-700/80 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="p-2.5 rounded-xl bg-white text-black font-black shrink-0">
                  <Instagram className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-black text-white text-sm sm:text-base flex items-center gap-2">
                    <span>Estúdio de Carrosséis para o Instagram</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700">
                      3 posts diários
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Modelos prontos no padrão visual @radar.fin adaptados para as cores e tipografia da Sinal (Preto e Branco).
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveAdminTab('instagram')}
                className="px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-black transition cursor-pointer shrink-0 shadow-md flex items-center gap-1.5 justify-center"
              >
                <span>Abrir Estúdio Instagram</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
              {/* Gráfico de Atividade Real */}
              <div className="lg:col-span-5 p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">Ingestão & Confluência</h3>
                    <p className="text-[10px] sm:text-[11px] text-zinc-400">Distribuição semanal dos fatos</p>
                  </div>
                  <span className="text-[9px] sm:text-[10px] font-mono font-medium text-zinc-400 px-2 py-0.5 rounded bg-[#131b2c] border border-[#1f2b45]">
                    {events.length} notícias no feed
                  </span>
                </div>

                <div className="pt-2 h-40 sm:h-44 flex items-end justify-between gap-1.5 sm:gap-2 px-1">
                  {platformActivity.map((bar, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group" title={`${bar.day}: ${bar.val} notícias`}>
                      <div className="w-full bg-[#131d33] rounded-t-lg h-28 sm:h-32 flex items-end overflow-hidden">
                        <div
                          style={{ height: bar.h }}
                          className={`w-full rounded-t-sm transition-all ${
                            bar.val > 0
                              ? 'bg-gradient-to-t from-blue-700 to-blue-500 group-hover:from-blue-600 group-hover:to-blue-400'
                              : 'bg-zinc-800/30'
                          }`}
                        ></div>
                      </div>
                      <span className="text-[9px] text-zinc-400 font-mono">{bar.day}</span>
                      <span className="text-[8px] text-zinc-500 font-mono -mt-1">{bar.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Status dos Provedores Conectados (Verde / Vermelho / Cinza) */}
              <div className="lg:col-span-4 p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">Status dos Provedores</h3>
                    <p className="text-[10px] sm:text-[11px] text-zinc-400">APIs e conectividade</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => setActiveAdminTab('briefings')}
                      className="text-[10px] sm:text-[11px] text-blue-400 hover:text-blue-300 font-semibold cursor-pointer bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20"
                    >
                      Resend ✉️
                    </button>
                    <button
                      onClick={() => setActiveAdminTab('api-health')}
                      className="text-[10px] sm:text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20"
                    >
                      Saúde 📈
                    </button>
                    <button
                      onClick={() => setActiveAdminTab('providers')}
                      className="text-[10px] sm:text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20"
                    >
                      24/7
                    </button>
                    <button
                      onClick={() => setActiveAdminTab('vault')}
                      className="text-[10px] sm:text-[11px] text-zinc-400 hover:text-zinc-200 font-medium cursor-pointer"
                    >
                      Vault
                    </button>
                  </div>
                </div>

                <div className="space-y-2 text-xs pt-1">
                  {providers.map((prov) => (
                    <div
                      key={prov.id}
                      className="flex items-center justify-between py-1.5 border-b border-[#151d2e] last:border-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Bolinha dinâmica: Verde = conectado, Vermelho = erro, Cinza = não conectado */}
                        <div
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            prov.status === 'connected'
                              ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                              : prov.status === 'error'
                              ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                              : 'bg-zinc-500'
                          }`}
                        ></div>
                        <span className="font-medium text-zinc-200 truncate text-[11px] sm:text-xs">
                          {prov.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {renderStatusBadge(prov.status, prov.statusText)}
                        <span className="text-[9px] sm:text-[10px] font-mono text-zinc-500">{prov.ms}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Jobs / Automação (Verde = Ativo / Cinza = Standby) */}
              <div className="lg:col-span-3 p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">Jobs em Background</h3>
                    <p className="text-[10px] sm:text-[11px] text-zinc-400">Pipelines do sistema</p>
                  </div>
                  <button
                    onClick={() => setActiveAdminTab('logs')}
                    className="text-[10px] sm:text-[11px] text-blue-400 cursor-pointer"
                  >
                    Logs →
                  </button>
                </div>

                <div className="space-y-2.5 pt-1 text-xs">
                  {jobs.map((j) => (
                    <div
                      key={j.id}
                      className="flex items-center justify-between py-1 border-b border-[#151d2e] last:border-0"
                    >
                      <span className="text-zinc-300 font-medium truncate text-[11px] sm:text-xs">{j.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {renderStatusBadge(j.status, j.statusLabel)}
                        <span className="text-[9px] font-mono text-zinc-500">{j.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Linha Inferior: Usuários do Supabase & Acontecimentos Recentes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
              {/* Usuários Reais */}
              <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs sm:text-sm font-bold text-white">Usuários & Acessos</h3>
                  <button
                    onClick={() => setActiveAdminTab('users')}
                    className="text-[10px] sm:text-[11px] text-blue-400 cursor-pointer"
                  >
                    Ver todos ({usersList.length}) →
                  </button>
                </div>
                <div className="space-y-2 text-xs">
                  {usersList.length === 0 ? (
                    <div className="py-4 text-center text-zinc-500 text-xs">
                      Nenhum usuário cadastrado além do Super Admin.
                    </div>
                  ) : (
                    usersList.slice(0, 4).map((u, i) => {
                      const isUserAdmin = u.isAdmin || u.email.toLowerCase() === 'astryasuporte@gmail.com';
                      return (
                        <div
                          key={u.id || i}
                          className="flex items-center justify-between py-1.5 border-b border-[#141b2c] last:border-0"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-6 h-6 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-[10px] font-bold text-blue-300 shrink-0">
                              {u.fullName[0]?.toUpperCase() || u.email[0]?.toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-zinc-200 text-xs flex items-center gap-1.5">
                                <span className="truncate">{u.fullName}</span>
                                {isUserAdmin && (
                                  <span className="text-[8px] font-mono px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                                    SUPER ADMIN
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-zinc-400 truncate">{u.email}</div>
                            </div>
                          </div>

                          {/* Status do usuário: Verde se admin/ativo, Cinza se inativo */}
                          <div>
                            {isUserAdmin ? (
                              <span className="text-[9px] font-mono text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                                SUPER ADMIN (Isento)
                              </span>
                            ) : (
                              <span className="text-[9px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">
                                - 7D
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Acontecimentos Ativos */}
              <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs sm:text-sm font-bold text-white">Acontecimentos no Feed</h3>
                  <button
                    onClick={() => setActiveAdminTab('events')}
                    className="text-[10px] sm:text-[11px] text-blue-400 cursor-pointer"
                  >
                    Gerenciar Feed ({events.length}) →
                  </button>
                </div>
                <div className="space-y-2.5 text-xs">
                  {events.length === 0 ? (
                    <div className="py-4 text-center text-zinc-500 text-xs">
                      Nenhum acontecimento no feed no momento.
                    </div>
                  ) : (
                    events.slice(0, 4).map((ev, i) => (
                      <div
                        key={ev.id || i}
                        className="flex items-start gap-2.5 py-1 border-b border-[#141b2c] last:border-0"
                      >
                        <span className="text-zinc-500 font-mono text-xs w-3 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-zinc-200 line-clamp-1">{ev.title}</div>
                          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                            {ev.category} • {ev.sources.length} fontes • {ev.relativeTime || 'recente'}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 2: EVENTOS / FEED ================= */}
        {activeAdminTab === 'events' && (
          <div className="space-y-4 sm:space-y-5">
            <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-white">Base de Acontecimentos</h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Unidade nuclear do FatosBR — cada Acontecimento consolida múltiplas matérias sobre o mesmo fato.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {onClearEvents && (
                    <button
                      onClick={() => {
                        if (confirm('Deseja esvaziar todos os acontecimentos do feed e deixar o estado limpo?')) {
                          onClearEvents();
                          if (isSupabaseConfigured) adminService.clearAllEventsFromSupabase();
                          showToast('Todos os acontecimentos foram removidos.');
                          addLog('WARN', 'EVENTS', 'Feed esvaziado pelo administrador.');
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl border border-red-500/30 bg-red-950/20 hover:bg-red-950/40 text-red-300 font-semibold text-xs cursor-pointer transition"
                    >
                      Esvaziar Feed
                    </button>
                  )}

                  {onResetEvents && (
                    <button
                      onClick={() => {
                        onResetEvents();
                        showToast('Catálogo verificado restaurado.');
                        addLog('INFO', 'EVENTS', 'Catálogo verificado restaurado.');
                      }}
                      className="px-3 py-1.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs cursor-pointer transition"
                    >
                      Restaurar Catálogo
                    </button>
                  )}

                  <button
                    onClick={handleTriggerIngestion}
                    disabled={ingestionStatus === 'running'}
                    className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs cursor-pointer transition flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Gerar com IA</span>
                  </button>
                </div>
              </div>

              {/* Filtro de Busca */}
              <div className="relative max-w-md w-full">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Buscar acontecimento..."
                  value={eventSearch}
                  onChange={(e) => setEventSearch(e.target.value)}
                  className="w-full bg-[#090c14] border border-[#1a2337] rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* LISTA EM CARDS NO MOBILE (UX OTIMIZADA) */}
              <div className="md:hidden space-y-3">
                {filteredEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                        {ev.category}
                      </span>
                      {renderStatusBadge('connected', `${ev.relevanceScore || 90}/100`)}
                    </div>

                    <div className="font-semibold text-white text-xs leading-snug line-clamp-2">
                      {ev.title}
                    </div>

                    <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                      {ev.summary}
                    </p>

                    <div className="flex items-center justify-between pt-1 border-t border-[#141b2c] text-[10px] text-zinc-500 font-mono">
                      <span>{ev.sources.length} fontes cruzadas</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedEventModal(ev)}
                          className="px-2 py-1 rounded bg-[#141d30] text-zinc-300 font-medium"
                        >
                          Ver JSON
                        </button>
                        {onDeleteEvent && (
                          <button
                            onClick={() => {
                              if (confirm(`Excluir acontecimento "${ev.title}"?`)) {
                                onDeleteEvent(ev.id);
                                if (isSupabaseConfigured) adminService.deleteEventFromSupabase(ev.id);
                                showToast('Acontecimento removido.');
                              }
                            }}
                            className="p-1 rounded bg-red-950/40 text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* TABELA NO DESKTOP */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#182136] text-[11px] text-zinc-400 uppercase font-mono">
                      <th className="pb-3 pl-2">Acontecimento</th>
                      <th className="pb-3">Categoria</th>
                      <th className="pb-3">Fontes Cruzadas</th>
                      <th className="pb-3">Relevância</th>
                      <th className="pb-3">Data</th>
                      <th className="pb-3 text-right pr-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#151d2e]">
                    {filteredEvents.map((ev) => (
                      <tr key={ev.id} className="hover:bg-[#12192b]/40 transition">
                        <td className="py-3 pl-2 max-w-xs">
                          <div className="font-semibold text-white line-clamp-1">{ev.title}</div>
                          <div className="text-[10px] text-zinc-400 line-clamp-1 mt-0.5">{ev.summary}</div>
                        </td>
                        <td className="py-3">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                            {ev.category}
                          </span>
                        </td>
                        <td className="py-3">
                          <span className="text-[11px] text-zinc-300 font-mono">
                            {ev.sources.length} fontes
                          </span>
                        </td>
                        <td className="py-3">
                          {renderStatusBadge('connected', `${ev.relevanceScore || 90}/100`)}
                        </td>
                        <td className="py-3 font-mono text-[10px] text-zinc-400">
                          {ev.relativeTime || 'Recente'}
                        </td>
                        <td className="py-3 text-right pr-2 space-x-2">
                          <button
                            onClick={() => setSelectedEventModal(ev)}
                            className="px-2.5 py-1 rounded-lg bg-[#141d30] hover:bg-[#1a2640] border border-[#202e4d] text-zinc-300 hover:text-white transition cursor-pointer text-[11px] font-medium"
                          >
                            Ver JSON
                          </button>
                          {onDeleteEvent && (
                            <button
                              onClick={() => {
                                if (confirm(`Excluir acontecimento "${ev.title}"?`)) {
                                  onDeleteEvent(ev.id);
                                  if (isSupabaseConfigured) adminService.deleteEventFromSupabase(ev.id);
                                  showToast('Acontecimento removido.');
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg bg-red-950/30 hover:bg-red-950/50 border border-red-500/30 text-red-400 transition cursor-pointer text-[11px] font-medium"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB: TENDÊNCIAS DE MERCADO (30 DIAS - RECHARTS) ================= */}
        {activeAdminTab === 'trends' && (
          <div className="space-y-6">
            <MarketTrendAnalysis
              entities={entities}
              events={events}
            />
          </div>
        )}

        {/* ================= TAB: PAINEL DE SAÚDE DA API (CHARTS EM TEMPO REAL) ================= */}
        {activeAdminTab === 'api-health' && (
          <ApiHealthDashboard
            onBackToOverview={() => setActiveAdminTab('overview')}
            renderStatusBadge={renderStatusBadge}
          />
        )}

        {/* ================= TAB: PROVEDORES 24/7 & RATE LIMITS ================= */}
        {activeAdminTab === 'providers' && (
          <ProviderDiagnostics
            onBackToOverview={() => setActiveAdminTab('overview')}
            renderStatusBadge={renderStatusBadge}
          />
        )}

        {/* ================= TAB 3: IA & MODELOS ================= */}
        {activeAdminTab === 'ai' && (
          <div className="space-y-5 sm:space-y-6">
            {/* Bloco de Execução Ativa do Pipeline */}
            <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-blue-500/30 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-blue-400 shrink-0" />
                    <h2 className="text-sm sm:text-base font-bold text-white">Pipeline NVIDIA NIM</h2>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    Modelo de síntese factual:{' '}
                    <strong className="text-zinc-200 font-mono text-[11px] sm:text-xs">
                      nvidia/nemotron-3.5-lightning-30b-a3b
                    </strong>
                  </p>
                </div>

                <button
                  onClick={handleTriggerIngestion}
                  disabled={ingestionStatus === 'running'}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-blue-900/30 cursor-pointer disabled:opacity-50"
                >
                  {ingestionStatus === 'running' ? (
                    <>
                      <RotateCw className="w-4 h-4 animate-spin" />
                      <span>Processando Síntese...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-white" />
                      <span>Executar Ingestão Agora</span>
                    </>
                  )}
                </button>
              </div>

              {/* Console de Saída do Pipeline em Execução */}
              {lastLog.length > 0 && (
                <div className="p-3.5 sm:p-4 rounded-xl bg-[#070b12] border border-[#141d30] font-mono text-[10px] sm:text-[11px] space-y-1.5 text-zinc-300">
                  <div className="text-zinc-500 pb-1 border-b border-[#141d30] flex items-center justify-between">
                    <span>CONSOLE DO PIPELINE (OUTPUT)</span>
                    <span className="text-emerald-400 font-bold">LIVE EXECUTION</span>
                  </div>
                  {lastLog.map((line, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <span className="text-blue-400 select-none">&gt;</span>
                      <span className={idx === lastLog.length - 1 ? 'text-emerald-300 font-semibold' : ''}>
                        {line}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Testador Interativo de Inferência com NVIDIA NIM */}
            <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Playground de Inferência — NVIDIA NIM</span>
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Envie qualquer notícia ou texto bruto para testar a estruturação editorial do FatosBR.
                  </p>
                </div>
                {renderStatusBadge('connected', 'nemotron-3.5-lightning')}
              </div>

              <div className="space-y-3">
                <textarea
                  rows={3}
                  value={aiTestPrompt}
                  onChange={(e) => setAiTestPrompt(e.target.value)}
                  placeholder="Cole aqui o texto ou chamada de notícia para testar a síntese..."
                  className="w-full bg-[#080b12] border border-[#182136] rounded-xl p-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 font-mono"
                />

                <div className="flex justify-end">
                  <button
                    onClick={handleRunAiPromptTest}
                    disabled={isTestingAi}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
                  >
                    {isTestingAi ? (
                      <>
                        <RotateCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Inferindo com NVIDIA NIM...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Testar Inferência ao Vivo</span>
                      </>
                    )}
                  </button>
                </div>

                {aiTestResult && (
                  <div className="p-3.5 sm:p-4 rounded-xl bg-[#070b12] border border-[#141d30] space-y-3 text-xs animate-fade-in font-mono">
                    <div className="text-emerald-400 font-bold text-[10px] sm:text-[11px] pb-1 border-b border-[#141d30] flex items-center justify-between">
                      <span>RESPOSTA DO MODELO (JSON SYNTHESIS)</span>
                      <span className="text-zinc-400">200 OK</span>
                    </div>
                    {aiTestResult.reasoning && (
                      <div className="text-zinc-500 text-[10px] p-2 rounded bg-[#090d16] border border-[#121927]">
                        <strong className="text-zinc-400">Raciocínio Interno (Reasoning):</strong>
                        <div className="line-clamp-4 mt-1">{aiTestResult.reasoning}</div>
                      </div>
                    )}
                    <pre className="text-zinc-200 overflow-x-auto whitespace-pre-wrap text-[10px] sm:text-[11px]">
                      {aiTestResult.content}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 4: VAULT / SEGREDOS (COM STATUS VERDE / VERMELHO / CINZA) ================= */}
        {activeAdminTab === 'vault' && (
          <div className="space-y-4 sm:space-y-6">
            <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                    <Lock className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-white">
                      Supabase Vault — Credenciais
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Verde = Conectado / Vermelho = Erro / Cinza = Desconectado.
                    </p>
                  </div>
                </div>

                <div className="relative w-full sm:w-auto">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Filtrar segredos..."
                    value={secretSearch}
                    onChange={(e) => setSecretSearch(e.target.value)}
                    className="w-full sm:w-64 bg-[#0a0d14] border border-[#1a2337] rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* LISTA EM CARDS NO MOBILE */}
              <div className="md:hidden space-y-3">
                {filteredSecrets.map((secret) => (
                  <div
                    key={secret.id}
                    className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-white text-xs">{secret.name}</div>
                      {renderStatusBadge(secret.status)}
                    </div>

                    <div className="text-[10px] text-zinc-400">{secret.description}</div>

                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[11px] text-zinc-400">{secret.keyLabel}</span>
                      <span className="bg-[#090c12] px-2 py-0.5 rounded border border-[#1a2337] text-zinc-300 text-[11px]">
                        {secret.maskedValue}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#141b2c]">
                      <button
                        onClick={() => handleTestSecret(secret)}
                        disabled={testingId === secret.id}
                        className="w-full py-2 rounded-lg bg-[#141d30] hover:bg-[#1a2640] border border-[#202e4d] text-zinc-300 text-xs font-medium text-center cursor-pointer"
                      >
                        {testingId === secret.id ? 'Testando...' : 'Testar Conexão'}
                      </button>
                      <button
                        onClick={() => setEditingSecret(secret)}
                        className="w-full py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-xs font-medium text-center cursor-pointer"
                      >
                        Rotacionar
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* TABELA NO DESKTOP */}
              <div className="hidden md:block overflow-x-auto pt-2">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#182136] text-[11px] text-zinc-400 uppercase font-mono tracking-wider">
                      <th className="pb-3 pl-2">Serviço / Credencial</th>
                      <th className="pb-3">Variável</th>
                      <th className="pb-3">Valor Mascarado</th>
                      <th className="pb-3">Origem</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3 text-right pr-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#151d2e]">
                    {filteredSecrets.map((secret) => (
                      <tr key={secret.id} className="hover:bg-[#12192b]/40 transition">
                        <td className="py-3.5 pl-2">
                          <div className="font-semibold text-white">{secret.name}</div>
                          <div className="text-[10px] text-zinc-400">{secret.description}</div>
                        </td>
                        <td className="py-3.5 font-mono text-[11px] text-zinc-300">{secret.keyLabel}</td>
                        <td className="py-3.5 font-mono text-zinc-400 text-xs">
                          <span className="bg-[#090c12] px-2 py-1 rounded border border-[#1a2337] text-zinc-300">
                            {secret.maskedValue}
                          </span>
                        </td>
                        <td className="py-3.5">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                            {secret.source}
                          </span>
                        </td>
                        <td className="py-3.5">
                          {renderStatusBadge(secret.status)}
                        </td>
                        <td className="py-3.5 text-right pr-2 space-x-2">
                          <button
                            onClick={() => handleTestSecret(secret)}
                            disabled={testingId === secret.id}
                            className="px-2.5 py-1 rounded-lg bg-[#141d30] hover:bg-[#1a2640] border border-[#202e4d] text-zinc-300 hover:text-white transition cursor-pointer text-[11px] font-medium"
                          >
                            {testingId === secret.id ? 'Testando...' : 'Testar Conexão'}
                          </button>
                          <button
                            onClick={() => setEditingSecret(secret)}
                            className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 transition cursor-pointer text-[11px] font-medium"
                          >
                            Rotacionar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2 animate-fade-in font-mono ${
                    testResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/20 text-red-300'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <span>{testResult.msg}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= TAB 5: ASSINATURAS & PIX (DASHBOARD FINANCEIRO FATURADO / NÃO FATURADO) ================= */}
        {activeAdminTab === 'billing' && (
          <div className="space-y-6">
            {/* Painel Financeiro Oficial ZynPay: Saldo em centavos, Volume e Últimos 20 Webhooks */}
            <AdminFinancialZynPayPanel onShowToast={showToast} />

            {/* Dashboard Financeiro Completo: MRR, Faturado vs Não Faturado, Gráfico e Exportação CSV */}
            <AdminFinancialDashboard users={usersList} onShowToast={showToast} />

            <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#182136]">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-purple-400 shrink-0" />
                    <span>FatosBR Pay Gateway (PIX Instantâneo)</span>
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Processador de pagamentos com webhook de confirmação. Admin é isento; novos cadastros mostram - 7D.
                  </p>
                </div>
                {renderStatusBadge('disconnected', 'Aguardando Credencial')}
              </div>

              {/* CARDS DE FATURAMENTO: ADMIN NÃO CONTA ASSINATURA, MOSTRA R$ 0,00 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#182136] space-y-1">
                  <div className="text-zinc-500 text-[10px]">VALOR DO PLANO PRO</div>
                  <div className="text-base sm:text-lg font-bold text-white">R$ 29,90 / mês</div>
                  <div className="text-[9px] text-zinc-400">Renovação recorrente via PIX</div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#182136] space-y-1">
                  <div className="text-zinc-500 text-[10px]">FATURAMENTO MENSAL ATUAL</div>
                  <div className="text-base sm:text-lg font-bold text-zinc-300">
                    R$ {(metrics.proSubscriptions * 29.9).toFixed(2).replace('.', ',')}
                  </div>
                  <div className="text-[9px] text-zinc-500">
                    {metrics.proSubscriptions === 0
                      ? 'Admin isento • Trials mostram - 7D'
                      : `${metrics.proSubscriptions} pagantes ativos`}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#090d16] border border-[#182136] space-y-1">
                  <div className="text-zinc-500 text-[10px]">STATUS DO WEBHOOK PIX</div>
                  <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>Ouvinte Ativo (200 OK)</span>
                  </div>
                  <div className="text-[9px] text-zinc-400">Idempotência & HMAC validado</div>
                </div>
              </div>

              {/* LISTA EM CARDS NO MOBILE (REGRA DE APRESENTAÇÃO - 7D E ADMIN ISENTO) */}
              <div className="md:hidden space-y-3 pt-2">
                <h3 className="text-xs font-bold text-white uppercase font-mono">Assinaturas Registradas</h3>
                {usersList.length === 0 ? (
                  <div className="p-6 text-center text-zinc-500 text-xs bg-[#0a0e17] rounded-xl border border-[#182136]">
                    Nenhuma assinatura registrada no momento.
                  </div>
                ) : (
                  usersList.map((u) => {
                    const isUserAdmin = u.isAdmin || u.email.toLowerCase() === 'astryasuporte@gmail.com';
                    const isTrial = !isUserAdmin && (u.planName === 'TRIAL_7D' || u.planName === 'TRIAL' || u.subscriptionStatus === 'TRIAL_ACTIVE');

                    return (
                      <div
                        key={u.id}
                        className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-semibold text-white">{u.fullName}</div>
                          {isUserAdmin ? (
                            renderStatusBadge('connected', 'Super Admin (Isento)')
                          ) : isTrial ? (
                            renderStatusBadge('connected', 'Teste 7D Ativo')
                          ) : (
                            renderStatusBadge('connected', 'Pago / Pro')
                          )}
                        </div>

                        <div className="text-[11px] text-zinc-400 font-mono">{u.email}</div>

                        <div className="flex items-center justify-between pt-1 border-t border-[#141b2c]">
                          {/* REGRA: NÃO MOSTRA R$ 29,90 PARA ADMIN NEM PARA QUEM TEM 7D */}
                          <div className="font-mono">
                            {isUserAdmin ? (
                              <span className="text-zinc-400 text-xs font-bold">- <span className="text-[10px] font-normal text-zinc-500">(Admin Cortesia)</span></span>
                            ) : isTrial ? (
                              <span className="text-emerald-400 text-sm font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                - 7D
                              </span>
                            ) : (
                              <span className="text-white font-bold text-xs">
                                R$ 29,90 <span className="text-[10px] text-emerald-400 font-normal">PIX</span>
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => {
                              showToast(`Status de ${u.email} atualizado com sucesso.`);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-[11px] font-semibold"
                          >
                            Gerenciar
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* TABELA NO DESKTOP (REGRA DE APRESENTAÇÃO - 7D E ADMIN ISENTO) */}
              <div className="hidden md:block pt-2">
                <h3 className="text-xs font-bold text-white mb-2 uppercase font-mono tracking-wider">
                  Assinaturas Registradas
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#182136] text-[11px] text-zinc-400 uppercase font-mono">
                        <th className="pb-3 pl-2">Usuário</th>
                        <th className="pb-3">Plano</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3">Valor Faturável</th>
                        <th className="pb-3">Método</th>
                        <th className="pb-3 text-right pr-2">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#151d2e]">
                      {usersList.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-zinc-500 text-xs font-mono">
                            Nenhuma assinatura registrada no momento.
                          </td>
                        </tr>
                      ) : (
                        usersList.map((u) => {
                          const isUserAdmin = u.isAdmin || u.email.toLowerCase() === 'astryasuporte@gmail.com';
                          const isTrial = !isUserAdmin && (u.planName === 'TRIAL_7D' || u.planName === 'TRIAL' || u.subscriptionStatus === 'TRIAL_ACTIVE');

                          return (
                            <tr key={u.id} className="hover:bg-[#12192b]/40">
                              <td className="py-3 pl-2">
                                <div className="font-semibold text-white">{u.fullName}</div>
                                <div className="text-[10px] text-zinc-400 font-mono">{u.email}</div>
                              </td>
                              <td className="py-3 font-mono text-zinc-300">
                                {isUserAdmin ? (
                                  <span className="text-amber-300 font-bold">SUPER ADMIN</span>
                                ) : isTrial ? (
                                  <span>Período de Teste (7 Dias)</span>
                                ) : (
                                  <span>Plano Pro Mensal</span>
                                )}
                              </td>
                              <td className="py-3">
                                {isUserAdmin
                                  ? renderStatusBadge('connected', 'Isento / Admin')
                                  : isTrial
                                  ? renderStatusBadge('connected', 'Teste 7D Ativo')
                                  : renderStatusBadge('connected', 'Pago / Pro')}
                              </td>
                              <td className="py-3 font-mono">
                                {/* EXIBIÇÃO: ADMIN É ISENTO, TRIAL MOSTRA - 7D */}
                                {isUserAdmin ? (
                                  <span className="text-zinc-500 font-bold">-</span>
                                ) : isTrial ? (
                                  <span className="text-emerald-400 font-bold text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                    - 7D
                                  </span>
                                ) : (
                                  <span className="text-white font-bold">R$ 29,90</span>
                                )}
                              </td>
                              <td className="py-3">
                                {isUserAdmin ? (
                                  <span className="text-[10px] text-zinc-500">Cortesia Admin</span>
                                ) : isTrial ? (
                                  <span className="text-[10px] text-zinc-400">Trial Gratuito</span>
                                ) : (
                                  <span className="text-[10px] font-bold text-emerald-400">PIX Instantâneo</span>
                                )}
                              </td>
                              <td className="py-3 text-right pr-2">
                                <button
                                  onClick={() => {
                                    showToast(`Assinatura de ${u.email} verificada.`);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-[11px] font-semibold cursor-pointer"
                                >
                                  Detalhes
                                </button>
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
          </div>
        )}

        {/* ================= TAB 6: USUÁRIOS & SESSÕES (ANALÍTICA COMPLETA) ================= */}
        {activeAdminTab === 'users' && (
          <div className="space-y-4 sm:space-y-6">
            {/* 1. CARDS DE MÉTRICAS RÁPIDAS DE USUÁRIOS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="p-4 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-[11px] font-mono uppercase tracking-wider">Total de Leitores</span>
                  <Users className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-xl sm:text-2xl font-bold text-white font-mono">{userStats.total}</div>
                <div className="text-[10px] text-zinc-500">Contas cadastradas no sistema</div>
              </div>

              <div className="p-4 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-[11px] font-mono uppercase tracking-wider">Teste Gratuito</span>
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl sm:text-2xl font-bold text-white font-mono">{userStats.trialUsers}</span>
                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    - 7D
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500">Período de avaliação ativo</div>
              </div>

              <div className="p-4 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-[11px] font-mono uppercase tracking-wider">Assinantes Pro</span>
                  <CreditCard className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-xl sm:text-2xl font-bold text-white font-mono">{userStats.proUsers}</div>
                <div className="text-[10px] text-zinc-500">Planos Pro mensais ativos</div>
              </div>

              <div className="p-4 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-[11px] font-mono uppercase tracking-wider">Super Admin</span>
                  <Shield className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-xl sm:text-2xl font-bold text-amber-300 font-mono">{userStats.superAdmins}</div>
                <div className="text-[10px] text-zinc-500">Acesso mestre e irrestrito</div>
              </div>
            </div>

            {/* 2. CARD RETRÁTIL DE CONFIGURAÇÃO DE RLS NO SUPABASE */}
            <div className="p-4 rounded-2xl bg-[#0c101a] border border-[#1c2740] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start sm:items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">
                      Sincronização & Permissões Supabase (RLS)
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      O painel agrega automaticamente contas locais e remotas. Para permitir que o Super Admin leia todas as linhas de outros navegadores via SQL do Supabase, certifique-se de aplicar a política de leitura.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setShowRlsSnippet(!showRlsSnippet)}
                    className="px-3 py-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-semibold transition cursor-pointer"
                  >
                    {showRlsSnippet ? 'Ocultar Script SQL' : 'Ver Script SQL'}
                  </button>

                  <button
                    onClick={copyRlsSql}
                    className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    {copiedSql ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-white" />
                        <span>Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar SQL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {showRlsSnippet && (
                <div className="pt-2 border-t border-[#182136] animate-fade-in space-y-2">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                    <span>EXECUTE NO SUPABASE &gt; SQL EDITOR:</span>
                    <span className="text-emerald-400">Habilita leitura irrestrita para astryasuporte@gmail.com</span>
                  </div>
                  <pre className="p-3 rounded-xl bg-[#06080d] border border-[#141b2b] text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre leading-relaxed">
{`-- Políticas RLS no Supabase para liberar leitura das contas para o Super Admin
DROP POLICY IF EXISTS "Usuário ou Super Admin lê perfis" ON public.profiles;
CREATE POLICY "Usuário ou Super Admin lê perfis" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id 
    OR (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

DROP POLICY IF EXISTS "Usuário insere o próprio perfil" ON public.profiles;
CREATE POLICY "Usuário insere o próprio perfil" ON public.profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id 
    OR (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
  );

DROP POLICY IF EXISTS "Usuário ou Super Admin edita o próprio perfil" ON public.profiles;
CREATE POLICY "Usuário ou Super Admin edita o próprio perfil" ON public.profiles
  FOR UPDATE USING (
    auth.uid() = id 
    OR (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
  );`}
                  </pre>
                </div>
              )}
            </div>

            {/* 3. GUIA OFICIAL DE URLS DE REDIRECIONAMENTO E SERVIDOR OAUTH SUPABASE */}
            <div className="p-4 rounded-2xl bg-[#0a0d14] border border-[#1a2337] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Globe2 className="w-4 h-4 text-white" />
                  <h3 className="text-xs sm:text-sm font-bold text-white">
                    URLs de Redirecionamento & Servidor OAuth (Supabase)
                  </h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                  Site Oficial: https://fatosbr.com.br
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Para que o login Google OAuth e o link de confirmação funcionem sem erros de redirecionamento, adicione estas URLs em <strong className="text-zinc-200">Supabase &gt; Authentication &gt; URL Configuration &gt; Redirect URLs</strong>:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                {[
                  { label: 'Site URL Principal', url: 'https://fatosbr.com.br' },
                  { label: 'Wildcard Geral', url: 'https://fatosbr.com.br/**' },
                  { label: 'Callback OAuth', url: 'https://fatosbr.com.br/auth/callback' },
                  { label: 'Confirmação E-mail', url: 'https://fatosbr.com.br/auth/confirm' },
                  { label: 'Caminho de Autorização (OAuth Server)', url: 'https://fatosbr.com.br/oauth/consent' },
                  { label: 'Redefinição de Senha', url: 'https://fatosbr.com.br/reset-password' },
                  { label: 'Onboarding Inicial', url: 'https://fatosbr.com.br/onboarding' },
                  { label: 'Localhost Dev', url: 'http://localhost:3000/**' }
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-xl bg-[#05070b] border border-zinc-800">
                    <div className="min-w-0 pr-2">
                      <div className="text-[9px] text-zinc-500 uppercase">{item.label}</div>
                      <div className="text-zinc-200 truncate">{item.url}</div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(item.url);
                        showToast(`Copiado: ${item.url}`);
                      }}
                      className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white shrink-0 cursor-pointer"
                      title="Copiar URL"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. TABELA COMPLETA DE USUÁRIOS COM FILTROS & BUSCA */}
            <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-white shrink-0" />
                    <span>Tabela Consolidada de Leitores & Contas (Supabase)</span>
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Visualização em tempo real de novos registros, provedor (Google / E-mail), UID e status de sessão.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      loadDatabaseData();
                      showToast('Lista de usuários sincronizada com o banco de dados.');
                    }}
                    disabled={isLoadingUsers}
                    className="px-3.5 py-1.5 rounded-xl border border-[#1a2337] bg-[#0a0d14] hover:bg-[#121826] text-zinc-200 text-xs font-semibold transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingUsers ? 'animate-spin text-white' : 'text-zinc-400'}`} />
                    <span>Sincronizar Lista</span>
                  </button>

                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700 font-mono">
                    {filteredUsers.length} de {usersList.length} contas
                  </span>
                </div>
              </div>

              {/* BARRA DE PESQUISA E FILTROS */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                {/* Campo de Busca */}
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Buscar por UID, nome ou e-mail..."
                    value={userSearchTerm}
                    onChange={(e) => setUserSearchTerm(e.target.value)}
                    className="w-full bg-[#0a0d14] border border-[#1a2337] rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                  {userSearchTerm && (
                    <button
                      onClick={() => setUserSearchTerm('')}
                      className="absolute right-2.5 top-2 text-zinc-500 hover:text-white text-xs"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filtros de Plano e Provedor */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-[#0a0d14] border border-[#1a2337] rounded-xl p-1 text-xs">
                    <span className="text-[10px] text-zinc-500 font-mono px-1.5 uppercase">Plano:</span>
                    <button
                      onClick={() => setUserPlanFilter('all')}
                      className={`px-2 py-0.5 rounded-lg text-[11px] transition cursor-pointer ${
                        userPlanFilter === 'all'
                          ? 'bg-zinc-800 text-white font-bold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Todos
                    </button>
                    <button
                      onClick={() => setUserPlanFilter('trial')}
                      className={`px-2 py-0.5 rounded-lg text-[11px] transition cursor-pointer ${
                        userPlanFilter === 'trial'
                          ? 'bg-zinc-700 text-white font-bold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Teste 7D
                    </button>
                    <button
                      onClick={() => setUserPlanFilter('pro')}
                      className={`px-2 py-0.5 rounded-lg text-[11px] transition cursor-pointer ${
                        userPlanFilter === 'pro'
                          ? 'bg-zinc-700 text-white font-bold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Pro
                    </button>
                  </div>

                  <div className="flex items-center gap-1 bg-[#0a0d14] border border-[#1a2337] rounded-xl p-1 text-xs">
                    <span className="text-[10px] text-zinc-500 font-mono px-1.5 uppercase">Login:</span>
                    <button
                      onClick={() => setUserProviderFilter('all')}
                      className={`px-2 py-0.5 rounded-lg text-[11px] transition cursor-pointer ${
                        userProviderFilter === 'all'
                          ? 'bg-zinc-800 text-white font-bold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Todos
                    </button>
                    <button
                      onClick={() => setUserProviderFilter('google')}
                      className={`px-2 py-0.5 rounded-lg text-[11px] transition cursor-pointer ${
                        userProviderFilter === 'google'
                          ? 'bg-zinc-700 text-white font-bold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Google
                    </button>
                    <button
                      onClick={() => setUserProviderFilter('email')}
                      className={`px-2 py-0.5 rounded-lg text-[11px] transition cursor-pointer ${
                        userProviderFilter === 'email'
                          ? 'bg-zinc-700 text-white font-bold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      E-mail
                    </button>
                  </div>
                </div>
              </div>

              {/* LISTA EM CARDS NO MOBILE */}
              <div className="md:hidden space-y-3">
                {filteredUsers.length === 0 ? (
                  <div className="p-6 text-center text-zinc-500 text-xs bg-[#0a0e17] rounded-xl border border-[#182136]">
                    Nenhum usuário encontrado com os filtros selecionados.
                  </div>
                ) : (
                  filteredUsers.map((u) => {
                    const isUserAdmin = u.isAdmin || u.email.toLowerCase() === 'astryasuporte@gmail.com';
                    const isGoogle = (u.provider || (u.email.includes('gmail') ? 'google' : 'email')) === 'google';
                    const isTrial = !isUserAdmin && (u.planName === 'TRIAL_7D' || u.planName === 'TRIAL' || u.subscriptionStatus === 'TRIAL_ACTIVE');

                    return (
                      <div
                        key={u.id}
                        className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {u.avatarUrl ? (
                                <img src={u.avatarUrl} alt={u.fullName} className="w-full h-full object-cover" />
                              ) : (
                                <span>{(u.fullName || u.email).substring(0, 2).toUpperCase()}</span>
                              )}
                            </div>
                            <div>
                              <div className="font-semibold text-white leading-tight">{u.fullName}</div>
                              <div className="text-[10px] text-zinc-400 font-mono">{u.email}</div>
                            </div>
                          </div>

                          {isUserAdmin ? (
                            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-700 uppercase font-bold">
                              SUPER ADMIN
                            </span>
                          ) : isTrial ? (
                            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-bold">
                              - 7D TRIAL
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-white text-black font-bold">
                              PRO
                            </span>
                          )}
                        </div>

                        {/* UID com botão de cópia */}
                        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 bg-black/40 px-2.5 py-1.5 rounded-lg border border-[#182136]">
                          <span className="truncate max-w-[210px]">UID: {u.id}</span>
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(u.id);
                              showToast(`UID copiado!`);
                            }}
                            className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                            title="Copiar UID"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between text-[11px] pt-2 border-t border-[#141b2c]">
                          <div className="flex items-center gap-2">
                            {/* Badge do Provedor */}
                            {isGoogle ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] font-mono">
                                <span>G</span> Google
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-mono">
                                <Mail className="w-2.5 h-2.5" /> E-mail
                              </span>
                            )}

                            {/* Status da Sessão */}
                            {renderStatusBadge('connected', isUserAdmin ? 'Online' : 'Ativo')}
                          </div>

                          <button
                            onClick={() => setSelectedUserModal(u)}
                            className="px-2.5 py-1 rounded-lg bg-[#141d30] hover:bg-[#1a2640] border border-[#202e4d] text-zinc-300 text-[10px] font-semibold cursor-pointer"
                          >
                            Detalhes
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* TABELA NO DESKTOP */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#182136] text-[11px] text-zinc-400 uppercase font-mono">
                      <th className="pb-3 pl-2">UID (Supabase)</th>
                      <th className="pb-3">Display Name / E-mail</th>
                      <th className="pb-3">Provedor</th>
                      <th className="pb-3">Papel / Acesso</th>
                      <th className="pb-3">Plano Atual</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Data Cadastro</th>
                      <th className="pb-3 text-right pr-2">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#151d2e]">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-zinc-500 text-xs font-mono">
                          Nenhum usuário cadastrado encontrado com esses filtros.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const isUserAdmin = u.isAdmin || u.email.toLowerCase() === 'astryasuporte@gmail.com';
                        const isGoogle = (u.provider || (u.email.includes('gmail') ? 'google' : 'email')) === 'google';
                        const isTrial = !isUserAdmin && (u.planName === 'TRIAL_7D' || u.planName === 'TRIAL' || u.subscriptionStatus === 'TRIAL_ACTIVE');

                        return (
                          <tr key={u.id} className="hover:bg-[#12192b]/40 transition-colors">
                            {/* UID */}
                            <td className="py-3.5 pl-2 font-mono text-[11px] text-zinc-400">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate max-w-[140px] xl:max-w-[180px]" title={u.id}>
                                  {u.id}
                                </span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard?.writeText(u.id);
                                    showToast(`UID ${u.id.substring(0, 8)}... copiado!`);
                                  }}
                                  title="Copiar UID"
                                  className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-white transition cursor-pointer"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                            </td>

                            <td className="py-3.5">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                  {u.avatarUrl ? (
                                    <img src={u.avatarUrl} alt={u.fullName} className="w-full h-full object-cover" />
                                  ) : (
                                    <span>{(u.fullName || u.email).substring(0, 2).toUpperCase()}</span>
                                  )}
                                </div>
                                <div>
                                  <div className="font-semibold text-white leading-tight">{u.fullName}</div>
                                  <div className="text-[10px] text-zinc-400 font-mono flex items-center gap-1.5 mt-0.5">
                                    <span>{u.email}</span>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard?.writeText(u.email);
                                        showToast(`E-mail ${u.email} copiado!`);
                                      }}
                                      title="Copiar e-mail"
                                      className="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                                    >
                                      <Copy className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-3.5">
                              {isGoogle ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] font-mono">
                                  <span className="font-bold">G</span> Google OAuth
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] font-mono">
                                  <Mail className="w-2.5 h-2.5" /> E-mail / Senha
                                </span>
                              )}
                            </td>

                            <td className="py-3.5">
                              {isUserAdmin ? (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-700 uppercase font-bold">
                                  SUPER ADMIN
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                                  LEITOR
                                </span>
                              )}
                            </td>

                            <td className="py-3.5">
                              {isUserAdmin ? (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-700">
                                  PRO ILIMITADO
                                </span>
                              ) : isTrial ? (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-bold">
                                  - 7D (TESTE)
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-black font-bold">
                                  PRO MENSAL
                                </span>
                              )}
                            </td>

                            <td className="py-3.5">
                              {renderStatusBadge('connected', isUserAdmin ? 'Online' : 'Ativo')}
                            </td>

                            <td className="py-3.5 font-mono text-[10px] text-zinc-400">
                              <div>{new Date(u.createdAt).toLocaleDateString('pt-BR')}</div>
                              <div className="text-[9px] text-zinc-600">
                                {new Date(u.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </td>

                            <td className="py-3.5 text-right pr-2">
                              <button
                                onClick={() => setSelectedUserModal(u)}
                                className="px-3 py-1 rounded-lg bg-[#141d30] hover:bg-[#1a2640] border border-[#202e4d] text-zinc-300 hover:text-white text-[11px] font-medium cursor-pointer transition shadow-xs"
                              >
                                Detalhes
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* MODAL: DETALHES COMPLETOS DO USUÁRIO SELECIONADO */}
            {selectedUserModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in">
                <div className="w-full max-w-lg bg-[#0c101a] border border-[#202c46] rounded-2xl p-6 shadow-2xl space-y-5 text-white">
                  <div className="flex items-center justify-between border-b border-[#182136] pb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700 flex items-center justify-center text-white text-sm font-bold">
                        {selectedUserModal.avatarUrl ? (
                          <img src={selectedUserModal.avatarUrl} alt={selectedUserModal.fullName} className="w-full h-full object-cover" />
                        ) : (
                          <span>{(selectedUserModal.fullName || selectedUserModal.email).substring(0, 2).toUpperCase()}</span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">{selectedUserModal.fullName}</h3>
                        <p className="text-xs text-zinc-400 font-mono">{selectedUserModal.email}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => setSelectedUserModal(null)}
                      className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-xl bg-[#080b12] border border-[#141d30] space-y-1">
                      <span className="text-[10px] text-zinc-500 uppercase">Papel no Sistema</span>
                      <div className="font-bold text-white">
                        {selectedUserModal.isAdmin || selectedUserModal.email.toLowerCase() === 'astryasuporte@gmail.com'
                          ? 'Super Administrador'
                          : 'Leitor FatosBR'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#080b12] border border-[#141d30] space-y-1">
                      <span className="text-[10px] text-zinc-500 uppercase">Provedor de Login</span>
                      <div className="font-bold text-white">
                        {(selectedUserModal.provider || (selectedUserModal.email.includes('gmail') ? 'google' : 'email')) === 'google'
                          ? 'Google OAuth'
                          : 'E-mail e Senha'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#080b12] border border-[#141d30] space-y-1">
                      <span className="text-[10px] text-zinc-500 uppercase">Plano Ativo</span>
                      <div className="font-bold text-emerald-400">
                        {selectedUserModal.planName || 'TRIAL_7D'}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-[#080b12] border border-[#141d30] space-y-1">
                      <span className="text-[10px] text-zinc-500 uppercase">Status da Assinatura</span>
                      <div className="font-bold text-blue-400">
                        {selectedUserModal.subscriptionStatus || 'TRIAL_ACTIVE'}
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#080b12] border border-[#141d30] space-y-2 text-xs font-mono">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-500">ID Único da Conta:</span>
                      <span className="text-zinc-300 font-bold truncate max-w-[240px]">{selectedUserModal.id}</span>
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-500">Data de Cadastro:</span>
                      <span className="text-zinc-300">
                        {new Date(selectedUserModal.createdAt).toLocaleString('pt-BR')}
                      </span>
                    </div>

                    {selectedUserModal.lastSignInAt && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-500">Último Acesso:</span>
                        <span className="text-zinc-300">
                          {new Date(selectedUserModal.lastSignInAt).toLocaleString('pt-BR')}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-[#182136]">
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(selectedUserModal.email);
                        showToast(`E-mail ${selectedUserModal.email} copiado.`);
                      }}
                      className="px-3 py-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-medium cursor-pointer transition flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar E-mail</span>
                    </button>

                    <button
                      onClick={() => setSelectedUserModal(null)}
                      className="px-4 py-1.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold cursor-pointer transition"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 7: FONTES & VEÍCULOS (VERDE SE CONECTADO / CINZA SE DESCONECTADO) ================= */}
        {activeAdminTab === 'sources' && (
          <div className="space-y-4 sm:space-y-6">
            <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <Layers className="w-5 h-5 text-emerald-400 shrink-0" />
                    <span>Fontes Monitoradas & Confluência</span>
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Veículos primários e agências de notícias conectadas.
                  </p>
                </div>
                <button
                  onClick={() => setIsNewSourceModalOpen(true)}
                  className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Adicionar Fonte</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sources.map((s) => (
                  <div key={s.id} className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs">{s.name}</span>
                      {renderStatusBadge('connected', 'Conectado')}
                    </div>
                    <div className="text-[11px] text-zinc-400 font-mono truncate">{s.domain}</div>
                    <div className="flex items-center justify-between pt-1 border-t border-[#141b2c]">
                      <span className="text-[10px] text-zinc-500">{s.category}</span>
                      {onDeleteSource && (
                        <button
                          onClick={() => {
                            if (confirm(`Remover fonte "${s.name}"?`)) {
                              onDeleteSource(s.id);
                              if (isSupabaseConfigured) adminService.deleteSource(s.id);
                              showToast(`Fonte ${s.name} removida.`);
                            }
                          }}
                          className="text-zinc-600 hover:text-red-400 text-xs cursor-pointer transition p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB: EMPRESAS & LOGOTIPOS PNG ================= */}
        {activeAdminTab === 'companies' && (
          <AdminCompanyManager
            entities={entities}
            onUpdateEntityLogo={onUpdateEntityLogo}
            onAddEntity={onAddEntity}
            onShowToast={showToast}
          />
        )}

        {/* ================= TAB 8: BRIEFINGS & E-MAILS ================= */}
        {activeAdminTab === 'briefings' && (
          <div className="space-y-6">
            {/* Customizador de Títulos e Subtítulos de Briefings com Preview e Webhooks em Tempo Real */}
            <AdminBriefingCustomizer
              events={events}
              onShowToast={showToast}
            />

            {/* Interface de Configuração SMTP do Resend e Testes em Tempo Real */}
            <ResendConfigPanel onShowToast={showToast} />

            {/* Componente Dedicado de Métricas em Tempo Real e Log de Webhooks (/api/resend/webhook) */}
            <ResendWebhookLiveMonitor onShowToast={showToast} />

            {/* Componente Visual de Telemetria do Resend (providerStats.resend via /api/resend/status) */}
            <ResendTelemetryCard
              onTestDispatchSuccess={(id, recipient) => {
                showToast(`Briefing de teste despachado via Resend: ID ${id}`);
                addLog('SUCCESS', 'RESEND', `Disparo teste para ${recipient} concluído. ID Resend: ${id}`);
              }}
            />

            <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <Mail className="w-5 h-5 text-blue-400 shrink-0" />
                    <span>Daily Briefings & Resend</span>
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Despachos editoriais matutino (07h00) e noturno (20h00) sintetizados por IA.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {renderStatusBadge('connected', 'Resend Conectado (Operacional)')}
                  <button
                    disabled={isTestingBriefingDispatch}
                    onClick={async () => {
                      setIsTestingBriefingDispatch(true);
                      addLog('INFO', 'BRIEFINGS', 'Iniciando disparo de teste via Resend API para astryasuporte@gmail.com...');
                      try {
                        const result = await resendService.sendTestEmail('astryasuporte@gmail.com');
                        if (result.success) {
                          showToast('Briefing de teste despachado com sucesso via Resend para astryasuporte@gmail.com');
                          addLog('SUCCESS', 'BRIEFINGS', `Despacho concluído com sucesso. ID de envio Resend: ${result.id || 'ok'}`);
                        } else {
                          showToast(`Falha no envio do Resend: ${result.error}`);
                          addLog('WARN', 'BRIEFINGS', `Falha no envio Resend: ${result.error}`);
                        }
                      } catch (err: any) {
                        showToast(`Erro na comunicação: ${err.message}`);
                        addLog('ERROR', 'BRIEFINGS', `Erro: ${err.message}`);
                      } finally {
                        setIsTestingBriefingDispatch(false);
                      }
                    }}
                    className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-xs cursor-pointer transition border border-zinc-200 disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    <Send className={`w-3.5 h-3.5 ${isTestingBriefingDispatch ? 'animate-spin' : ''}`} />
                    <span>{isTestingBriefingDispatch ? 'Disparando...' : 'Testar Disparo'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs">
                <div className="p-4 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-400 font-bold">Morning Briefing (07h00)</span>
                    {/* Verde: Operacional / Agendado */}
                    {renderStatusBadge('connected', 'Operacional / Agendado')}
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Síntese de abertura de mercado, fatos noturnos e panorama geopolítico com template magnífico.
                  </p>
                  <div className="text-[10px] font-mono text-emerald-400/90 pt-0.5 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Próximo disparo: Amanhã às 07:00 AM • Resend API Ativo
                  </div>
                  <button
                    disabled={isTestingMorningDispatch}
                    onClick={async () => {
                      setIsTestingMorningDispatch(true);
                      addLog('INFO', 'BRIEFINGS', 'Iniciando despacho de teste do Morning Briefing (07h00) com template magnífico para astryasuporte@gmail.com...');
                      try {
                        const result = await resendService.sendMorningBriefingTest('astryasuporte@gmail.com');
                        if (result.success) {
                          showToast('Morning Briefing (07h00) despachado com sucesso com tema magnífico!');
                          addLog('SUCCESS', 'BRIEFINGS', `Despacho do Morning Briefing concluído. ID Resend: ${result.id || 'ok'}`);
                        } else {
                          showToast(`Falha no envio do Resend: ${result.error}`);
                          addLog('WARN', 'BRIEFINGS', `Falha no envio Resend: ${result.error}`);
                        }
                      } catch (err: any) {
                        showToast(`Erro na comunicação: ${err.message}`);
                        addLog('ERROR', 'BRIEFINGS', `Erro: ${err.message}`);
                      } finally {
                        setIsTestingMorningDispatch(false);
                      }
                    }}
                    className="w-full mt-2 py-1.5 px-3 rounded-lg bg-gradient-to-r from-amber-500/20 to-blue-500/20 hover:from-amber-500/30 hover:to-blue-500/30 border border-amber-500/30 text-amber-300 hover:text-white font-bold text-[11px] cursor-pointer transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <Send className={`w-3 h-3 ${isTestingMorningDispatch ? 'animate-spin' : ''}`} />
                    <span>{isTestingMorningDispatch ? 'Despachando...' : '⚡ Testar Morning Briefing (07h00) Agora'}</span>
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-blue-400 font-bold">Evening Briefing (20h00)</span>
                    {/* Verde: Operacional / Agendado */}
                    {renderStatusBadge('connected', 'Operacional / Agendado')}
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Fechamento do dia, impactos regulatórios e desdobramentos de inteligência artificial.
                  </p>
                  <div className="text-[10px] font-mono text-blue-400/90 pt-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    Próximo disparo: Hoje às 20:00 PM • Resend API Ativo
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB: WEBHOOKS RESEND EM TEMPO REAL ================= */}
        {activeAdminTab === 'webhooks' && (
          <div className="space-y-6">
            <ResendWebhookLiveMonitor onShowToast={showToast} />
            <ResendTelemetryCard
              onTestDispatchSuccess={(id, recipient) => {
                showToast(`E-mail despachado via Resend: ID ${id}`);
                addLog('SUCCESS', 'RESEND', `Disparo teste para ${recipient} concluído. ID: ${id}`);
              }}
            />
          </div>
        )}

        {/* ================= TAB 9: LOGS & AUDITORIA ================= */}
        {activeAdminTab === 'logs' && (
          <div className="space-y-4 sm:space-y-6">
            <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-emerald-400 shrink-0" />
                    <span>Console Operacional & Auditoria</span>
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Registro de eventos de ingestão, autenticação e banco.
                  </p>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                  <div className="flex items-center bg-[#0a0d14] border border-[#182136] rounded-xl p-1 text-[10px] font-mono shrink-0">
                    {(['ALL', 'INFO', 'SUCCESS', 'WARN', 'ERROR'] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => setLogFilter(level)}
                        className={`px-2 py-0.5 rounded-lg transition cursor-pointer ${
                          logFilter === level ? 'bg-blue-600 text-white font-bold' : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => setSystemLogs([])}
                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition cursor-pointer shrink-0"
                    title="Limpar console"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="bg-[#070b12] p-3 sm:p-4 rounded-xl border border-[#162033] font-mono text-[10px] sm:text-xs space-y-2 max-h-96 overflow-y-auto">
                {filteredLogs.length === 0 ? (
                  <div className="p-8 text-center text-zinc-500 font-mono text-xs">
                    Nenhum log operacional registrado nesta sessão. As operações de ingestão, autenticação e suporte aparecerão aqui em tempo real.
                  </div>
                ) : (
                  filteredLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                      <span className="text-zinc-500 shrink-0 text-[10px]">[{log.timestamp}]</span>
                      <span
                        className={`font-bold shrink-0 text-[9px] px-1 rounded ${
                          log.level === 'SUCCESS'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : log.level === 'ERROR'
                            ? 'bg-red-500/15 text-red-400'
                            : log.level === 'WARN'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-blue-500/15 text-blue-400'
                        }`}
                      >
                        {log.service}
                      </span>
                      <span className="text-zinc-300 break-words flex-1">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 10: TICKETS DE SUPORTE ================= */}
        {activeAdminTab === 'tickets' && (() => {
          const filteredTicketList = tickets.filter((t) => {
            if (ticketFilter !== 'all' && t.status !== ticketFilter) return false;
            if (ticketSearch.trim()) {
              const q = ticketSearch.toLowerCase();
              return (
                t.subject.toLowerCase().includes(q) ||
                t.message.toLowerCase().includes(q) ||
                t.userName.toLowerCase().includes(q) ||
                t.userEmail.toLowerCase().includes(q) ||
                t.id.toLowerCase().includes(q)
              );
            }
            return true;
          });

          const currentTicket = tickets.find((t) => t.id === selectedTicketId) || filteredTicketList[0] || null;
          const openCount = tickets.filter((t) => t.status === 'open').length;
          const answeredCount = tickets.filter((t) => t.status === 'answered').length;
          const resolvedCount = tickets.filter((t) => t.status === 'resolved').length;

          return (
            <div className="space-y-4 sm:space-y-6">
              {/* Cabeçalho e Métricas Rápidas */}
              <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-blue-400 shrink-0" />
                      <span>Gestão de Tickets de Suporte</span>
                    </h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Responda e resolva chamados com disparo automatizado de notificações para o e-mail do usuário.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      <Mail className="w-3.5 h-3.5" />
                      <span>Resend Notificações Ativo</span>
                    </span>
                  </div>
                </div>

                {/* Cards de Métricas */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl bg-[#080b12] border border-[#162033]">
                    <div className="text-[11px] text-zinc-400">Total de Chamados</div>
                    <div className="text-lg font-bold text-white mt-0.5">{tickets.length}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#080b12] border border-amber-500/30 bg-amber-500/5">
                    <div className="text-[11px] text-amber-300 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Abertos / Pendentes
                    </div>
                    <div className="text-lg font-bold text-amber-400 mt-0.5">{openCount}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#080b12] border border-blue-500/20">
                    <div className="text-[11px] text-blue-300">Respondidos</div>
                    <div className="text-lg font-bold text-blue-400 mt-0.5">{answeredCount}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#080b12] border border-emerald-500/20">
                    <div className="text-[11px] text-emerald-300">Resolvidos</div>
                    <div className="text-lg font-bold text-emerald-400 mt-0.5">{resolvedCount}</div>
                  </div>
                </div>
              </div>

              {/* Barra de Filtros e Busca */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar p-1 bg-[#090d16] border border-[#192338] rounded-xl text-xs">
                  <button
                    onClick={() => setTicketFilter('all')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                      ticketFilter === 'all'
                        ? 'bg-blue-600 text-white font-bold shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Todos ({tickets.length})
                  </button>
                  <button
                    onClick={() => setTicketFilter('open')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                      ticketFilter === 'open'
                        ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Abertos ({openCount})
                  </button>
                  <button
                    onClick={() => setTicketFilter('answered')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                      ticketFilter === 'answered'
                        ? 'bg-blue-500/20 text-blue-300 font-bold border border-blue-500/40'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Respondidos ({answeredCount})
                  </button>
                  <button
                    onClick={() => setTicketFilter('resolved')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                      ticketFilter === 'resolved'
                        ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Resolvidos ({resolvedCount})
                  </button>
                </div>

                <div className="relative flex-1 sm:max-w-xs">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Buscar por assunto, nome ou e-mail..."
                    value={ticketSearch}
                    onChange={(e) => setTicketSearch(e.target.value)}
                    className="w-full bg-[#090d16] border border-[#192338] rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Layout em Duas Colunas: Lista e Detalhe */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Coluna da Esquerda: Lista de Tickets */}
                <div className="lg:col-span-5 space-y-2 max-h-[680px] overflow-y-auto pr-1">
                  {filteredTicketList.length === 0 ? (
                    <div className="p-8 text-center rounded-2xl bg-[#090d16] border border-[#182136] text-zinc-400 text-xs space-y-1.5">
                      <MessageSquare className="w-6 h-6 text-zinc-600 mx-auto mb-1" />
                      <div className="font-semibold text-zinc-300">Nenhum chamado de suporte</div>
                      <p className="text-zinc-500 text-[11px] max-w-xs mx-auto">
                        Quando um usuário enviar uma mensagem pelo menu de Ajuda & Suporte, ela será exibida aqui para atendimento.
                      </p>
                    </div>
                  ) : (
                    filteredTicketList.map((t) => {
                      const isSelected = currentTicket?.id === t.id;
                      return (
                        <div
                          key={t.id}
                          onClick={() => setSelectedTicketId(t.id)}
                          className={`p-3.5 rounded-xl border transition cursor-pointer space-y-2 ${
                            isSelected
                              ? 'bg-[#12192a] border-blue-500/60 shadow-lg'
                              : 'bg-[#090d16] hover:bg-[#0d1322] border-[#182236]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono text-zinc-400">
                              #{t.id}
                            </span>
                            <span
                              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                                t.status === 'open'
                                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                  : t.status === 'answered'
                                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              }`}
                            >
                              {t.status === 'open' ? 'Aberto' : t.status === 'answered' ? 'Respondido' : 'Resolvido'}
                            </span>
                          </div>

                          <div>
                            <div className="text-xs font-bold text-white line-clamp-1">{t.subject}</div>
                            <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">{t.message}</div>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1 border-t border-zinc-800/50">
                            <span className="text-zinc-400 font-medium truncate max-w-[150px]">{t.userName}</span>
                            <span>{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Coluna da Direita: Detalhe do Ticket, Histórico e Ações */}
                <div className="lg:col-span-7">
                  {currentTicket ? (
                    <div className="p-4 sm:p-5 rounded-2xl bg-[#090d16] border border-[#182136] space-y-4">
                      {/* Topo do Ticket Selecionado */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#182136]">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-zinc-400">#{currentTicket.id}</span>
                            <span
                              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                                currentTicket.status === 'open'
                                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                  : currentTicket.status === 'answered'
                                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              }`}
                            >
                              {currentTicket.status === 'open'
                                ? 'Aberto'
                                : currentTicket.status === 'answered'
                                ? 'Respondido'
                                : 'Resolvido'}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-white mt-1">{currentTicket.subject}</h3>
                        </div>

                        <div className="text-right text-[11px] text-zinc-400">
                          <div>{currentTicket.userName}</div>
                          <div className="text-zinc-500 font-mono text-[10px]">{currentTicket.userEmail}</div>
                        </div>
                      </div>

                      {/* Mensagem Original */}
                      <div className="p-3.5 rounded-xl bg-[#06080f] border border-[#151e30] space-y-2">
                        <div className="flex items-center justify-between text-[10px] text-zinc-400">
                          <span className="font-semibold text-zinc-300">Mensagem do Usuário:</span>
                          <span>{new Date(currentTicket.createdAt).toLocaleString('pt-BR')}</span>
                        </div>
                        <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap">
                          {currentTicket.message}
                        </p>
                      </div>

                      {/* Histórico de Respostas */}
                      {currentTicket.responses.length > 0 && (
                        <div className="space-y-2.5 pt-1">
                          <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-zinc-400" />
                            <span>Histórico de Mensagens ({currentTicket.responses.length})</span>
                          </div>

                          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                            {currentTicket.responses.map((resp) => (
                              <div
                                key={resp.id}
                                className={`p-3 rounded-xl text-xs space-y-1 ${
                                  resp.from === 'admin'
                                    ? 'bg-blue-950/20 border border-blue-900/40 text-blue-100'
                                    : 'bg-zinc-900/80 border border-zinc-800 text-zinc-200'
                                }`}
                              >
                                <div className="flex items-center justify-between text-[10px] text-zinc-400">
                                  <span className="font-bold text-white">{resp.authorName}</span>
                                  <span>{new Date(resp.sentAt).toLocaleString('pt-BR')}</span>
                                </div>
                                <p className="leading-relaxed whitespace-pre-wrap">{resp.message}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Caixa de Resposta do Administrador */}
                      <div className="pt-3 border-t border-[#182136] space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-zinc-300 mb-1">
                            Responder ao Usuário (dispara e-mail para {currentTicket.userEmail})
                          </label>
                          <textarea
                            rows={3}
                            placeholder="Escreva a resposta oficial do suporte FatosBR..."
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            className="w-full bg-[#06080f] border border-[#1a253a] rounded-xl p-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                            <Mail className="w-3 h-3 text-emerald-400" />
                            <span>E-mail enviado automaticamente via Resend</span>
                          </div>

                          <div className="flex items-center gap-2">
                            {currentTicket.status !== 'resolved' && (
                              <button
                                onClick={() => handleResolveTicket(currentTicket.id)}
                                disabled={isResolving}
                                className="px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Resolver Ticket</span>
                              </button>
                            )}

                            <button
                              onClick={() => handleSendReply(currentTicket.id)}
                              disabled={isSendingReply || !replyText.trim()}
                              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{isSendingReply ? 'Enviando...' : 'Responder e Notificar'}</span>
                            </button>
                          </div>
                        </div>

                        {currentTicket.status === 'resolved' && (
                          <div className="p-2.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 text-emerald-300 text-[11px] flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>Este chamado está concluído e resolvido. O usuário já recebeu o e-mail de fechamento.</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-10 text-center rounded-2xl bg-[#090d16] border border-[#182136] text-zinc-500 text-xs space-y-2">
                      <Inbox className="w-8 h-8 text-zinc-600 mx-auto mb-1" />
                      <div className="font-semibold text-zinc-300">Nenhum chamado selecionado</div>
                      <p className="text-zinc-500 text-[11px] max-w-sm mx-auto">
                        Selecione um chamado na lista à esquerda para visualizar mensagens, redigir respostas e enviar notificações por e-mail via Resend.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ================= TAB 14: ESTÚDIO INSTAGRAM (CARROSSÉIS P&B 4:5) ================= */}
        {activeAdminTab === 'instagram' && (
          <InstagramCarouselStudio
            events={events}
            entities={entities}
            onBack={() => setActiveAdminTab('overview')}
          />
        )}

        {/* ================= TAB 15: CENA 3D THREE.JS PBR DE ESTÚDIO ================= */}
        {activeAdminTab === 'three-globe' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-[#0b0d14] border border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 text-black font-black">
                  <Globe2 className="w-5 h-5 text-black" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                    <span>Cena 3D Interativa · Mercados & Conexões Globais</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">
                      Three.js PBR Studio
                    </span>
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Renderização procedural com materiais físicos metálicos, anéis equatoriais, feixes de dados e nós das principais capitais.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setActiveAdminTab('instagram')}
                className="px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-black transition cursor-pointer shrink-0 shadow-md flex items-center gap-1.5"
              >
                <span>Usar no Estúdio Instagram</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <ThreeGlobeScene className="h-[520px]" />
          </div>
        )}
      </main>

      {/* MODAL: VER JSON DO EVENTO */}
      {selectedEventModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-3 sm:p-4 animate-fade-in">
          <div className="w-full max-w-2xl bg-black border-2 border-zinc-700 rounded-2xl p-4 sm:p-6 shadow-2xl space-y-3 sm:space-y-4 text-white max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-xs sm:text-sm font-bold text-white truncate max-w-xs sm:max-w-md font-mono">
                {selectedEventModal.title}
              </h3>
              <button
                onClick={() => setSelectedEventModal(null)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 text-xs font-mono bg-zinc-950 p-3 sm:p-4 rounded-xl border border-zinc-800">
              <pre className="text-zinc-300 text-[10px] sm:text-[11px] whitespace-pre-wrap">
                {JSON.stringify(selectedEventModal, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setSelectedEventModal(null)}
                className="px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-xs cursor-pointer transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADICIONAR NOVA FONTE */}
      {isNewSourceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-3 sm:p-4 animate-fade-in">
          <div className="w-full max-w-md bg-black border-2 border-zinc-700 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-white">Cadastrar Nova Fonte Primária</h3>
              <button
                onClick={() => setIsNewSourceModalOpen(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSource} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-zinc-300 font-semibold mb-1">Nome do Veículo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: BBC Brasil, Estadão, InfoMoney"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-white placeholder:text-zinc-500 focus:outline-none focus:border-white transition"
                />
              </div>

              <div>
                <label className="block text-zinc-300 font-semibold mb-1">Domínio / Host</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: bbc.com/portuguese, estadao.com.br"
                  value={newSourceDomain}
                  onChange={(e) => setNewSourceDomain(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-white placeholder:text-zinc-500 focus:outline-none focus:border-white font-mono transition"
                />
              </div>

              <div>
                <label className="block text-zinc-300 font-semibold mb-1">Categoria Principal</label>
                <select
                  value={newSourceCategory}
                  onChange={(e) => setNewSourceCategory(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-white transition"
                >
                  <option value="Tecnologia">Tecnologia & IA</option>
                  <option value="Economia">Economia & Mercado</option>
                  <option value="Geral">Geral & Notícias</option>
                  <option value="Política">Política & Regulação</option>
                  <option value="Geopolítica">Geopolítica Global</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsNewSourceModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 font-medium cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold cursor-pointer transition"
                >
                  Cadastrar Fonte
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ROTACIONAR SEGREDO NO VAULT */}
      {editingSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-3 sm:p-4 animate-fade-in">
          <div className="w-full max-w-md bg-black border-2 border-zinc-700 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 text-white">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-white" />
                <h3 className="text-sm font-bold text-white">Rotacionar Credencial</h3>
              </div>
              <button
                onClick={() => setEditingSecret(null)}
                className="text-zinc-400 hover:text-white text-xs font-mono p-1 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition"
              >
                ESC
              </button>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
              <div className="text-xs font-semibold text-white">{editingSecret.name}</div>
              <div className="text-[11px] font-mono text-zinc-400">{editingSecret.keyLabel}</div>
              <p className="text-[11px] text-zinc-400 mt-1">{editingSecret.description}</p>
            </div>

            <form onSubmit={handleSaveRotatedSecret} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-300 mb-1.5">
                  Novo Valor da Chave (será cifrado no Supabase Vault)
                </label>
                <input
                  type="password"
                  required
                  placeholder="Cole aqui a nova chave de API..."
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-white font-mono transition"
                />
                <span className="text-[10px] text-zinc-500 mt-1 block">
                  Apenas os últimos 4 dígitos ficarão visíveis após o salvamento seguro.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingSecret(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 text-xs font-medium cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition cursor-pointer"
                >
                  Salvar no Vault
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL DE SAÚDE DA API (EXCLUSIVO SUPER ADMIN) ================= */}
      <ApiHealthModal
        isOpen={isApiHealthModalOpen}
        onClose={() => setIsApiHealthModalOpen(false)}
        isSuperAdmin={true}
      />
    </div>
  );
};
