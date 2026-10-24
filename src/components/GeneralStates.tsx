/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  AlertCircle,
  WifiOff,
  Lock,
  FileQuestion,
  UserX,
  ShieldAlert,
  Clock,
  Server,
  Search,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Home,
  Compass,
  Bookmark,
  Layers,
  CheckCircle2,
  Bell,
  X,
  ExternalLink,
  ChevronRight
} from 'lucide-react';

/* =========================================================================
   1. SINAL LOADING & EDITORIAL SPINNER
   ========================================================================= */

interface SinalLoadingProps {
  message?: string;
  submessage?: string;
  variant?: 'fullscreen' | 'inline' | 'card';
}

export const SinalLoading: React.FC<SinalLoadingProps> = ({
  message = 'Sincronizando acontecimentos...',
  submessage = 'Aguarde um instante enquanto reunimos os fatos mais relevantes.',
  variant = 'card'
}) => {
  const content = (
    <div className="flex flex-col items-center justify-center text-center p-8 space-y-4">
      {/* FatosBR Wave Pulse Logo */}
      <div className="relative flex items-center justify-center w-14 h-14 rounded-2xl bg-[#111216] border border-[#1e2026]">
        <div className="flex items-center gap-1">
          <span className="w-1 h-3 bg-zinc-600 rounded-full animate-[pulse_1s_ease-in-out_infinite]" />
          <span className="w-1 h-5 bg-zinc-300 rounded-full animate-[pulse_1s_ease-in-out_0.2s_infinite]" />
          <span className="w-1 h-7 bg-white rounded-full animate-[pulse_1s_ease-in-out_0.4s_infinite]" />
          <span className="w-1 h-5 bg-zinc-300 rounded-full animate-[pulse_1s_ease-in-out_0.6s_infinite]" />
          <span className="w-1 h-3 bg-zinc-600 rounded-full animate-[pulse_1s_ease-in-out_0.8s_infinite]" />
        </div>
      </div>

      <div className="space-y-1.5 max-w-sm">
        <h4 className="text-sm font-semibold text-white tracking-tight">{message}</h4>
        {submessage && (
          <p className="text-xs text-zinc-400 leading-relaxed">{submessage}</p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1 text-[11px] text-zinc-400 font-mono">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-ping" />
        <span>Conectando à curadoria FatosBR</span>
      </div>
    </div>
  );

  if (variant === 'fullscreen') {
    return (
      <div className="min-h-[70vh] flex items-center justify-center w-full">
        {content}
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-[#1e2026] bg-[#0c0d11]">
      {content}
    </div>
  );
};

/* =========================================================================
   2. SKELETONS (FEED, EVENT DETAIL, LIST)
   ========================================================================= */

export const EventCardSkeleton: React.FC = () => {
  return (
    <div className="rounded-2xl border border-[#1e2026] bg-[#111216] p-5 sm:p-6 space-y-4 animate-pulse">
      {/* Top row: badge + time */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-20 h-4 bg-zinc-800 rounded-full" />
          <div className="w-16 h-3 bg-zinc-800/60 rounded" />
        </div>
        <div className="w-6 h-6 bg-zinc-800/70 rounded-lg" />
      </div>

      {/* Title */}
      <div className="space-y-2">
        <div className="w-4/5 h-5 bg-zinc-800 rounded" />
        <div className="w-2/3 h-5 bg-zinc-800 rounded" />
      </div>

      {/* Summary lines */}
      <div className="space-y-1.5">
        <div className="w-full h-3.5 bg-zinc-800/60 rounded" />
        <div className="w-11/12 h-3.5 bg-zinc-800/60 rounded" />
        <div className="w-3/4 h-3.5 bg-zinc-800/50 rounded" />
      </div>

      {/* Footer row: sources chips */}
      <div className="pt-2 flex items-center justify-between border-t border-[#1a1c22]">
        <div className="flex items-center gap-2">
          <div className="w-16 h-4 bg-zinc-800/60 rounded-md" />
          <div className="w-20 h-4 bg-zinc-800/40 rounded-md" />
        </div>
        <div className="w-14 h-4 bg-zinc-800/50 rounded-md" />
      </div>
    </div>
  );
};

export const FeedSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => {
  return (
    <div className="space-y-4 w-full animate-feed-fade">
      {Array.from({ length: count }).map((_, idx) => (
        <EventCardSkeleton key={idx} />
      ))}
    </div>
  );
};

export const EventDetailSkeleton: React.FC = () => {
  return (
    <div className="space-y-6 animate-pulse p-4 sm:p-6">
      {/* Category & Date */}
      <div className="flex items-center justify-between">
        <div className="w-24 h-5 bg-zinc-800 rounded-full" />
        <div className="w-32 h-4 bg-zinc-800/60 rounded" />
      </div>

      {/* Main Title */}
      <div className="space-y-2">
        <div className="w-full h-7 bg-zinc-800 rounded" />
        <div className="w-4/5 h-7 bg-zinc-800 rounded" />
      </div>

      {/* Editorial Summary Box */}
      <div className="p-4 rounded-xl border border-[#1e2026] bg-[#14151a] space-y-3">
        <div className="w-28 h-4 bg-zinc-700/80 rounded" />
        <div className="space-y-2">
          <div className="w-full h-3.5 bg-zinc-800 rounded" />
          <div className="w-full h-3.5 bg-zinc-800 rounded" />
          <div className="w-3/4 h-3.5 bg-zinc-800 rounded" />
        </div>
      </div>

      {/* Timeline items */}
      <div className="space-y-3 pt-2">
        <div className="w-36 h-4 bg-zinc-800 rounded" />
        <div className="space-y-3 pl-4 border-l border-zinc-800">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <div className="w-24 h-3 bg-zinc-800/60 rounded" />
              <div className="w-5/6 h-4 bg-zinc-800 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const ListRowSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => {
  return (
    <div className="space-y-2.5 w-full">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="flex items-center justify-between p-3.5 rounded-xl border border-[#1e2026] bg-[#111216] animate-pulse"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-zinc-800 shrink-0" />
            <div className="space-y-1.5">
              <div className="w-28 h-4 bg-zinc-800 rounded" />
              <div className="w-44 h-3 bg-zinc-800/60 rounded" />
            </div>
          </div>
          <div className="w-16 h-7 bg-zinc-800/70 rounded-lg" />
        </div>
      ))}
    </div>
  );
};

/* =========================================================================
   3. BASE STATE CONTAINER (SHARED EDITORIAL LAYOUT)
   ========================================================================= */

interface BaseStateCardProps {
  icon: React.ReactNode;
  badge?: string;
  title: string;
  description: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  extraContent?: React.ReactNode;
  hintCode?: string;
}

export const BaseStateCard: React.FC<BaseStateCardProps> = ({
  icon,
  badge,
  title,
  description,
  primaryAction,
  secondaryAction,
  extraContent,
  hintCode
}) => {
  return (
    <div className="w-full rounded-2xl border border-[#1e2026] bg-[#111216] p-6 sm:p-10 text-center transition-all duration-200">
      <div className="max-w-md mx-auto space-y-5">
        {/* Minimalist Icon Vessel */}
        <div className="relative inline-flex items-center justify-center">
          <div className="w-14 h-14 rounded-2xl bg-[#16171d] border border-[#22242c] flex items-center justify-center text-zinc-300 shadow-inner">
            {icon}
          </div>
          {badge && (
            <span className="absolute -bottom-2 -right-2 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
              {badge}
            </span>
          )}
        </div>

        {/* Text Content */}
        <div className="space-y-2">
          <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
            {title}
          </h3>
          <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-sm mx-auto">
            {description}
          </p>
        </div>

        {/* Optional Extra Elements (e.g. Pro Benefits or Search suggestions) */}
        {extraContent && (
          <div className="pt-2 text-left">{extraContent}</div>
        )}

        {/* Action Buttons */}
        {(primaryAction || secondaryAction) && (
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2.5">
            {primaryAction && (
              <button
                onClick={primaryAction.onClick}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition-colors cursor-pointer shadow-sm"
              >
                {primaryAction.label}
              </button>
            )}
            {secondaryAction && (
              <button
                onClick={secondaryAction.onClick}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-[#22242c] bg-transparent text-zinc-300 text-xs font-semibold hover:text-white hover:bg-zinc-800/40 transition-colors cursor-pointer"
              >
                {secondaryAction.label}
              </button>
            )}
          </div>
        )}

        {/* Technical Hint or Diagnostic Code (Subtle Editorial) */}
        {hintCode && (
          <div className="pt-2 text-[10px] font-mono text-zinc-400">
            {hintCode}
          </div>
        )}
      </div>
    </div>
  );
};

/* =========================================================================
   4. STANDARDIZED EMPTY STATES
   ========================================================================= */

export const EmptyFeedState: React.FC<{ onExplore?: () => void }> = ({ onExplore }) => (
  <BaseStateCard
    icon={<Layers className="w-6 h-6 text-zinc-400" />}
    title="Seu FatosBR ainda está silencioso"
    description="Estamos procurando novidades sobre as entidades e assuntos que você acompanha. Novas atualizações surgirão aqui."
    primaryAction={
      onExplore
        ? {
            label: 'Explorar interesses',
            onClick: onExplore
          }
        : undefined
    }
  />
);

export const EmptySavedState: React.FC<{ onExplore?: () => void }> = ({ onExplore }) => (
  <BaseStateCard
    icon={<Bookmark className="w-6 h-6 text-zinc-400" />}
    title="Nada salvo ainda"
    description="Quando encontrar um acontecimento que queira guardar para ler com calma ou consultar depois, toque em Salvar."
    primaryAction={
      onExplore
        ? {
            label: 'Explorar acontecimentos',
            onClick: onExplore
          }
        : undefined
    }
  />
);

export const EmptyHistoryState: React.FC<{ onHome?: () => void }> = ({ onHome }) => (
  <BaseStateCard
    icon={<Clock className="w-6 h-6 text-zinc-400" />}
    title="Seu histórico ainda está vazio"
    description="Os acontecimentos que você abrir aparecerão aqui, facilitando reencontrar fatos e leituras anteriores."
    primaryAction={
      onHome
        ? {
            label: 'Ver Início',
            onClick: onHome
          }
        : undefined
    }
  />
);

export const EmptyFollowingState: React.FC<{ onExplore?: () => void }> = ({ onExplore }) => (
  <BaseStateCard
    icon={<Compass className="w-6 h-6 text-zinc-400" />}
    title="Você ainda não segue nenhum tema ou entidade"
    description="Acompanhe tópicos essenciais, fontes jornalísticas e empresas para personalizar seu feed e ver matérias sob medida nesta aba."
    primaryAction={
      onExplore
        ? {
            label: 'Explorar temas e entidades',
            onClick: onExplore
          }
        : undefined
    }
  />
);

export const EmptyNotificationsState: React.FC = () => (
  <BaseStateCard
    icon={<Bell className="w-6 h-6 text-zinc-400" />}
    title="Nenhuma notificação nova"
    description="Você está com tudo em dia. Avisaremos assim que ocorrerem atualizações importantes nas suas entidades seguidas."
  />
);

export const NoResultsState: React.FC<{
  query: string;
  onClear?: () => void;
  onExplore?: () => void;
}> = ({ query, onClear, onExplore }) => (
  <BaseStateCard
    icon={<Search className="w-6 h-6 text-zinc-400" />}
    title="Nenhum resultado encontrado"
    description={`Não encontramos nenhum acontecimento ou tema correspondente a "${query}". Tente usar termos mais curtos ou genéricos.`}
    primaryAction={
      onClear
        ? {
            label: 'Limpar busca',
            onClick: onClear
          }
        : undefined
    }
    secondaryAction={
      onExplore
        ? {
            label: 'Ver todos os tópicos',
            onClick: onExplore
          }
        : undefined
    }
  />
);

/* =========================================================================
   5. ERROR & EXCEPTION STATES
   ========================================================================= */

export const ErrorState: React.FC<{
  title?: string;
  description?: string;
  onRetry?: () => void;
  onHome?: () => void;
  errorCode?: string;
}> = ({
  title = 'Não foi possível carregar as informações',
  description = 'Houve uma falha momentânea de comunicação com os servidores do FatosBR. Seus dados continuam salvos e seguros.',
  onRetry,
  onHome,
  errorCode = 'REF_FATOSBR_ERR_TIMEOUT'
}) => (
  <BaseStateCard
    icon={<AlertCircle className="w-6 h-6 text-zinc-300" />}
    badge="ERRO"
    title={title}
    description={description}
    primaryAction={
      onRetry
        ? {
            label: 'Tentar novamente',
            onClick: onRetry
          }
        : undefined
    }
    secondaryAction={
      onHome
        ? {
            label: 'Voltar ao Início',
            onClick: onHome
          }
        : undefined
    }
    hintCode={`Diagnóstico: ${errorCode}`}
  />
);

export const OfflineState: React.FC<{
  onCheckConnection?: () => void;
  onViewSaved?: () => void;
}> = ({ onCheckConnection, onViewSaved }) => (
  <BaseStateCard
    icon={<WifiOff className="w-6 h-6 text-zinc-300" />}
    badge="OFFLINE"
    title="Você está desconectado"
    description="Parece que você está sem acesso à internet. O FatosBR voltará a sincronizar novidades assim que a conexão for restabelecida."
    primaryAction={
      onCheckConnection
        ? {
            label: 'Verificar conexão',
            onClick: onCheckConnection
          }
        : {
            label: 'Verificar conexão',
            onClick: () => window.location.reload()
          }
    }
    secondaryAction={
      onViewSaved
        ? {
            label: 'Acessar salvos offline',
            onClick: onViewSaved
          }
        : undefined
    }
    hintCode="Modo offline: recursos sincronizados continuam disponíveis localmente"
  />
);

export const OfflineBanner: React.FC<{ onDismiss?: () => void }> = ({ onDismiss }) => {
  return (
    <div className="w-full bg-[#16171d] border-b border-[#22242c] px-4 py-2 text-xs flex items-center justify-between text-zinc-300">
      <div className="flex items-center gap-2.5">
        <WifiOff className="w-4 h-4 text-zinc-400 shrink-0" />
        <span className="font-medium">
          Você está desconectado. Exibindo conteúdos armazenados em cache.
        </span>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-zinc-400 hover:text-white p-1 rounded transition cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export const NotFoundState: React.FC<{ onHome?: () => void }> = ({ onHome }) => (
  <BaseStateCard
    icon={<FileQuestion className="w-6 h-6 text-zinc-300" />}
    badge="404"
    title="Acontecimento ou página não encontrada"
    description="O link que você seguiu pode estar incorreto, expirado ou ter sido arquivado pela equipe de curadoria."
    primaryAction={
      onHome
        ? {
            label: 'Voltar ao Início',
            onClick: onHome
          }
        : undefined
    }
    hintCode="STATUS_404_PAGE_NOT_FOUND"
  />
);

export const PaywallState: React.FC<{
  onUpgrade?: () => void;
  onBack?: () => void;
}> = ({ onUpgrade, onBack }) => (
  <BaseStateCard
    icon={<Lock className="w-6 h-6 text-zinc-200" />}
    badge="PRO"
    title="Conteúdo exclusivo FatosBR Pro"
    description="Aprofunde sua leitura com análises de contexto completas, briefings diários da manhã e da noite e monitoramento contínuo."
    extraContent={
      <div className="p-3.5 rounded-xl border border-[#1e2026] bg-[#0d0e12] space-y-2 mb-2">
        <div className="text-[11px] font-bold text-white uppercase tracking-wider">
          O que está incluído no Pro:
        </div>
        <ul className="text-xs text-zinc-300 space-y-1.5">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span>Briefings diários selecionados (manhã e noite)</span>
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span>Linha do tempo ilimitada de cada acontecimento</span>
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span>Rastreamento prioritário de entidades e fontes</span>
          </li>
        </ul>
      </div>
    }
    primaryAction={
      onUpgrade
        ? {
            label: 'Conhecer o FatosBR Pro',
            onClick: onUpgrade
          }
        : undefined
    }
    secondaryAction={
      onBack
        ? {
            label: 'Voltar',
            onClick: onBack
          }
        : undefined
    }
    hintCode="Assinatura via PIX Instantâneo • Cancele quando quiser"
  />
);

export const UnauthorizedState: React.FC<{
  onLogin?: () => void;
  onHome?: () => void;
}> = ({ onLogin, onHome }) => (
  <BaseStateCard
    icon={<UserX className="w-6 h-6 text-zinc-300" />}
    badge="401"
    title="Identificação necessária"
    description="Para acessar sua biblioteca pessoal, salvar preferências ou personalizar seus alertas, entre na sua conta."
    primaryAction={
      onLogin
        ? {
            label: 'Entrar no FatosBR',
            onClick: onLogin
          }
        : undefined
    }
    secondaryAction={
      onHome
        ? {
            label: 'Continuar como leitor',
            onClick: onHome
          }
        : undefined
    }
    hintCode="STATUS_401_AUTHENTICATION_REQUIRED"
  />
);

export const ForbiddenState: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <BaseStateCard
    icon={<ShieldAlert className="w-6 h-6 text-zinc-300" />}
    badge="403"
    title="Acesso não autorizado"
    description="Sua conta atual não possui permissões administrativas para acessar este painel ou configuração."
    primaryAction={
      onBack
        ? {
            label: 'Retornar ao Início',
            onClick: onBack
          }
        : undefined
    }
    hintCode="STATUS_403_ACCESS_FORBIDDEN"
  />
);

export const SessionExpiredState: React.FC<{ onReconnect?: () => void }> = ({ onReconnect }) => (
  <BaseStateCard
    icon={<Clock className="w-6 h-6 text-zinc-300" />}
    badge="SESSÃO"
    title="Sua sessão expirou"
    description="Por segurança e privacidade, sessões inativas são encerradas automaticamente. Faça login para continuar de onde parou."
    primaryAction={
      onReconnect
        ? {
            label: 'Reconectar conta',
            onClick: onReconnect
          }
        : undefined
    }
    hintCode="STATUS_419_SESSION_TIMEOUT"
  />
);

export const MaintenanceState: React.FC<{ onCheckStatus?: () => void }> = ({ onCheckStatus }) => (
  <BaseStateCard
    icon={<Server className="w-6 h-6 text-zinc-300" />}
    badge="503"
    title="Manutenção programada"
    description="Estamos aprimorando a infraestrutura de curadoria do FatosBR. O serviço retornará ao ar em poucos minutos."
    primaryAction={
      onCheckStatus
        ? {
            label: 'Verificar status',
            onClick: onCheckStatus
          }
        : {
            label: 'Atualizar página',
            onClick: () => window.location.reload()
          }
    }
    hintCode="STATUS_503_SERVICE_MAINTENANCE"
  />
);

/* =========================================================================
   6. SHOWCASE MODAL / EXPLORADOR DE ESTADOS (QA & DESIGN SYSTEM)
   ========================================================================= */

export type GeneralStateType =
  | 'loading'
  | 'skeletons'
  | 'empty_feed'
  | 'empty_saved'
  | 'empty_history'
  | 'empty_following'
  | 'empty_notifications'
  | 'no_results'
  | 'error'
  | 'offline'
  | 'paywall'
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'session_expired'
  | 'maintenance';

interface GeneralStatesShowcaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectState?: (state: GeneralStateType) => void;
}

export const GeneralStatesShowcaseModal: React.FC<GeneralStatesShowcaseModalProps> = ({
  isOpen,
  onClose
}) => {
  const [selectedState, setSelectedState] = useState<GeneralStateType>('skeletons');

  if (!isOpen) return null;

  const statesList: { id: GeneralStateType; label: string; group: string }[] = [
    { id: 'loading', label: 'Carregamento (Loading)', group: 'Carregamento' },
    { id: 'skeletons', label: 'Skeletons (Feed & Cards)', group: 'Carregamento' },
    { id: 'empty_feed', label: 'Feed Vazio (Silencioso)', group: 'Vazios' },
    { id: 'empty_saved', label: 'Salvos Vazio', group: 'Vazios' },
    { id: 'empty_history', label: 'Histórico Vazio', group: 'Vazios' },
    { id: 'empty_following', label: 'Seguindo Vazio', group: 'Vazios' },
    { id: 'empty_notifications', label: 'Notificações Vazio', group: 'Vazios' },
    { id: 'no_results', label: 'Busca Sem Resultados', group: 'Vazios' },
    { id: 'error', label: 'Erro Geral de Conexão', group: 'Exceções' },
    { id: 'offline', label: 'Desconectado (Offline)', group: 'Exceções' },
    { id: 'paywall', label: 'Paywall / FatosBR Pro', group: 'Acesso' },
    { id: 'not_found', label: '404 Não Encontrado', group: 'Exceções' },
    { id: 'unauthorized', label: '401 Não Autenticado', group: 'Acesso' },
    { id: 'forbidden', label: '403 Acesso Negado', group: 'Acesso' },
    { id: 'session_expired', label: 'Sessão Expirada', group: 'Acesso' },
    { id: 'maintenance', label: '503 Manutenção', group: 'Exceções' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md">
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#0b0c10] border border-[#1e2026] rounded-2xl overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2026] bg-[#111216]">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-xs font-mono font-bold text-white">
              F
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Catálogo de Estados Gerais do FatosBR
              </h2>
              <p className="text-[11px] text-zinc-400">
                Padrão unificado para Loading, Skeletons, Vazios, Erros e Acesso
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Sidebar / Switcher */}
          <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-[#1e2026] bg-[#0c0d11] p-3 overflow-y-auto max-h-48 md:max-h-none space-y-1">
            <div className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 px-2 py-1">
              Selecionar Estado
            </div>
            {statesList.map((st) => (
              <button
                key={st.id}
                onClick={() => setSelectedState(st.id)}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between ${
                  selectedState === st.id
                    ? 'bg-white text-black font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#14151b]'
                }`}
              >
                <span>{st.label}</span>
                {selectedState === st.id && (
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* Preview Area */}
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto bg-[#08090b] flex flex-col justify-center">
            {selectedState === 'loading' && (
              <SinalLoading
                message="Sincronizando acontecimentos do FatosBR..."
                submessage="Aguarde um instante enquanto curamos os fatos mais relevantes para sua leitura."
              />
            )}

            {selectedState === 'skeletons' && (
              <div className="space-y-4 max-w-xl mx-auto w-full">
                <div className="text-xs text-zinc-400 font-mono flex items-center justify-between px-1">
                  <span>PREVIEW: ESQUELETO DE CARREGAMENTO (FEED)</span>
                  <span className="animate-pulse">PULSO ATIVO</span>
                </div>
                <FeedSkeleton count={2} />
              </div>
            )}

            {selectedState === 'empty_feed' && (
              <EmptyFeedState onExplore={() => {}} />
            )}

            {selectedState === 'empty_saved' && (
              <EmptySavedState onExplore={() => {}} />
            )}

            {selectedState === 'empty_history' && (
              <EmptyHistoryState onHome={() => {}} />
            )}

            {selectedState === 'empty_following' && (
              <EmptyFollowingState onExplore={() => {}} />
            )}

            {selectedState === 'empty_notifications' && (
              <EmptyNotificationsState />
            )}

            {selectedState === 'no_results' && (
              <NoResultsState
                query="computação quântica espacial"
                onClear={() => {}}
                onExplore={() => {}}
              />
            )}

            {selectedState === 'error' && (
              <ErrorState
                onRetry={() => {}}
                onHome={() => {}}
                errorCode="REF_SINAL_ERR_TIMEOUT_GATEWAY"
              />
            )}

            {selectedState === 'offline' && (
              <div className="space-y-4 max-w-xl mx-auto w-full">
                <OfflineBanner />
                <OfflineState
                  onCheckConnection={() => {}}
                  onViewSaved={() => {}}
                />
              </div>
            )}

            {selectedState === 'paywall' && (
              <PaywallState
                onUpgrade={() => {}}
                onBack={() => {}}
              />
            )}

            {selectedState === 'not_found' && (
              <NotFoundState onHome={() => {}} />
            )}

            {selectedState === 'unauthorized' && (
              <UnauthorizedState
                onLogin={() => {}}
                onHome={() => {}}
              />
            )}

            {selectedState === 'forbidden' && (
              <ForbiddenState onBack={() => {}} />
            )}

            {selectedState === 'session_expired' && (
              <SessionExpiredState onReconnect={() => {}} />
            )}

            {selectedState === 'maintenance' && (
              <MaintenanceState onCheckStatus={() => {}} />
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-[#1e2026] bg-[#111216] flex items-center justify-between text-xs text-zinc-400">
          <span>Total de 16 variações de estados editoriais padronizados</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 text-white font-medium hover:bg-zinc-700 transition cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
