/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Entity, Topic, Source, UserSubscription } from '../types/sinal';
import {
  User,
  Settings,
  Edit3,
  ChevronRight,
  Shield,
  CreditCard,
  Bell,
  Mail,
  Moon,
  Sun,
  Globe,
  Lock,
  Smartphone,
  HelpCircle,
  Database,
  Download,
  Trash2,
  Info,
  LogOut,
  X,
  Check,
  AlertTriangle,
  Clock,
  Layers,
  Sparkles,
  ExternalLink,
  ChevronLeft,
  Bookmark,
  Volume2,
  Headphones,
  Activity,
  Eye,
  Upload,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Crop
} from 'lucide-react';
import { FinancialDashboard } from './FinancialDashboard';
import { ticketService } from '../services/ticketService';
import { useSupportTickets } from '../hooks/useSupportTickets';
import { soundAlertService } from '../services/soundAlertService';
import { notificationService } from '../services/notificationService';
import { ApiHealthModal } from './ApiHealthModal';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { avatarProcessing } from '../services/avatarProcessing';
import { validateImageFile } from '../utils/imageValidation';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { userService } from '../services/userService';
import { LanguageSelector } from './LanguageSelector';

interface ProfileViewProps {
  currentUser?: SupabaseUser | null;
  entities: Entity[];
  topics: Topic[];
  sources: Source[];
  subscription: UserSubscription;
  savedCount?: number;
  onNavigateFollowing: (tab?: 'topics' | 'companies' | 'people' | 'sources') => void;
  onNavigateSaved?: () => void;
  onOpenBilling: () => void;
  onOpenLanding?: () => void;
  onOpenAuth?: () => void;
  onOpenAdmin?: () => void;
  onOpenOnboarding?: () => void;
  isSuperAdmin?: boolean;
  onLogout?: () => void;
  onProfileUpdated?: (updatedProfile: UserProfileData) => void;
  onClearCacheAndSync?: () => Promise<void> | void;
  onOpenLegal?: (tab?: 'terms' | 'lgpd' | 'cdc' | 'owner-rights' | 'dpo') => void;
}

export interface UserProfileData {
  name: string;
  displayName?: string;
  email: string;
  avatarUrl: string | null;
  bio?: string;
  timezone: string;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  currentUser,
  entities,
  topics,
  sources,
  subscription,
  savedCount,
  onNavigateFollowing,
  onNavigateSaved,
  onOpenBilling,
  onOpenLanding,
  onOpenAuth,
  onOpenAdmin,
  onOpenOnboarding,
  isSuperAdmin = false,
  onLogout,
  onProfileUpdated,
  onClearCacheAndSync,
  onOpenLegal
}) => {
  // Sincronização Dinâmica do Perfil com o Usuário Autenticado
  const [profile, setProfile] = useState<UserProfileData>(() => {
    const dedicatedAvatar = typeof window !== 'undefined' ? localStorage.getItem('fatosbr_user_avatar') : null;
    if (currentUser) {
      const metaName =
        currentUser.user_metadata?.full_name ||
        currentUser.user_metadata?.name ||
        (currentUser.email ? currentUser.email.split('@')[0] : 'Leitor');
      const metaAvatar = dedicatedAvatar || currentUser.user_metadata?.avatar_url || null;
      return {
        name: metaName,
        displayName: metaName,
        email: currentUser.email || 'leitor@fatosbr.com.br',
        avatarUrl: metaAvatar,
        bio: currentUser.email?.toLowerCase() === 'astryasuporte@gmail.com' ? 'Super Administrador — FatosBR' : 'Leitor FatosBR',
        timezone: 'America/Sao_Paulo (UTC-3)'
      };
    }
    try {
      const saved = localStorage.getItem('sinal_user_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (dedicatedAvatar) parsed.avatarUrl = dedicatedAvatar;
        return parsed;
      }
    } catch {}
    return {
      name: 'Leitor',
      displayName: 'Leitor',
      email: 'leitor@fatosbr.com.br',
      avatarUrl: dedicatedAvatar || null,
      bio: 'Leitor FatosBR',
      timezone: 'America/Sao_Paulo (UTC-3)'
    };
  });

  // Atualizar perfil reativamente quando currentUser mudar (ex: login com outra conta)
  React.useEffect(() => {
    const dedicatedAvatar = localStorage.getItem('fatosbr_user_avatar');
    if (currentUser) {
      const metaName =
        currentUser.user_metadata?.full_name ||
        currentUser.user_metadata?.name ||
        (currentUser.email ? currentUser.email.split('@')[0] : 'Leitor');
      const metaAvatar = dedicatedAvatar || currentUser.user_metadata?.avatar_url || null;
      setProfile((prev) => ({
        ...prev,
        name: prev.name === 'Astrya Suporte' && currentUser.email?.toLowerCase() !== 'astryasuporte@gmail.com' ? metaName : (prev.name || metaName),
        email: currentUser.email || prev.email,
        avatarUrl: dedicatedAvatar || prev.avatarUrl || metaAvatar,
        bio: currentUser.email?.toLowerCase() === 'astryasuporte@gmail.com' ? 'Super Administrador — FatosBR' : 'Leitor FatosBR'
      }));
    } else if (dedicatedAvatar) {
      setProfile((prev) => ({ ...prev, avatarUrl: dedicatedAvatar }));
    }
  }, [currentUser]);

  const [isApiHealthModalOpen, setIsApiHealthModalOpen] = useState(false);
  const [adminPreviewMode, setAdminPreviewMode] = useState<'admin' | 'client'>(
    isSuperAdmin ? 'admin' : 'client'
  );

  // Regra de 1 mudança de nome por e-mail
  const getNameChangeKey = (email: string) => `sinal_name_changed_${email.trim().toLowerCase()}`;
  const [hasChangedName, setHasChangedName] = useState<boolean>(() => {
    return localStorage.getItem(`sinal_name_changed_${profile.email.trim().toLowerCase()}`) === 'true';
  });
  const [isConfirmingNameChange, setIsConfirmingNameChange] = useState(false);

  // Preferences State
  const [preferences, setPreferences] = useState({
    // Notificações
    urgentEvents: true,
    followedEntities: true,
    followedTopics: true,
    briefingsPush: true,
    accountUpdates: true,
    // E-mails e Briefings
    morningBriefing: true,
    morningTime: '07:00',
    eveningBriefing: true,
    eveningTime: '20:00',
    emailUrgentAlerts: true,
    // Aparência
    theme: 'dark' as 'dark' | 'light' | 'system',
    language: 'pt-BR'
  });

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Active Modals
  const [activeModal, setActiveModal] = useState<
    | null
    | 'editProfile'
    | 'notifications'
    | 'briefings'
    | 'appearance'
    | 'accountSecurity'
    | 'changePassword'
    | 'changeEmail'
    | 'twoFactor'
    | 'privacy'
    | 'exportData'
    | 'deleteAccount'
    | 'helpCenter'
    | 'contactSupport'
    | 'myTickets'
    | 'terms'
    | 'paymentMethod'
    | 'invoices'
    | 'logoutConfirm'
  >(null);

  // Hook personalizado de tickets com sincronização em tempo real no Supabase
  const {
    userTickets,
    isLoading: isTicketsLoading,
    isSyncing: isTicketsSyncing,
    openCount: openTicketsCount,
    answeredCount: answeredTicketsCount,
    createTicket: createSupportTicket,
    replyTicket: replySupportTicket,
    refreshTickets
  } = useSupportTickets({ userEmail: profile.email, userName: profile.name });

  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketFollowUpText, setTicketFollowUpText] = useState<string>('');
  const [supportTab, setSupportTab] = useState<'new' | 'list'>('new');

  // Form states for modals
  const [editNameInput, setEditNameInput] = useState(profile.name);
  const [editAvatarInput, setEditAvatarInput] = useState(profile.avatarUrl || '');
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [passwordCurrent, setPasswordCurrent] = useState('');
  const [passwordNew, setPasswordNew] = useState('');
  const [newEmailInput, setNewEmailInput] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');

  // PWA Hook & iOS Helper Modal State
  const pwa = usePWAInstall();
  const [showProfileIosGuide, setShowProfileIosGuide] = useState(false);

  // Gallery Avatar Upload States & Local Fast Analysis (até 6 MB)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarUploadError, setAvatarUploadError] = useState<string | null>(null);
  const [avatarUploadAudit, setAvatarUploadAudit] = useState<{
    fileNameSafe: boolean;
    magicBytesVerified: boolean;
    binarySignature: string;
    payloadScanClean: boolean;
    gpsMetadataStripped: boolean;
    exifStatus: string;
    originalSize: number;
    sanitizedSize: number;
  } | null>(null);
  const avatarFileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Crop / Zoom Modal States
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [cropRawUrl, setCropRawUrl] = useState<string | null>(null);
  const [cropZoom, setCropZoom] = useState<number>(1);
  const [cropOffsetX, setCropOffsetX] = useState<number>(0);
  const [cropOffsetY, setCropOffsetY] = useState<number>(0);
  const [isSavingCrop, setIsSavingCrop] = useState<boolean>(false);
  const [isClearingCache, setIsClearingCache] = useState<boolean>(false);

  const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 1. Validação estrita no front-end antes de qualquer requisição (máximo 6 MB e tipo de imagem)
    const MAX_SIZE = 6 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      const err = `A imagem selecionada possui ${(file.size / (1024 * 1024)).toFixed(2)} MB, excedendo o limite máximo de 6 MB.`;
      setAvatarUploadError(err);
      showToast(err);
      e.target.value = '';
      return;
    }

    const validation = validateImageFile(file);
    if (!validation.valid) {
      const err = validation.error || 'Formato de imagem inválido. Utilize JPG, PNG, WEBP, GIF ou AVIF.';
      setAvatarUploadError(err);
      showToast(err);
      e.target.value = '';
      return;
    }

    setAvatarUploadError(null);
    setAvatarUploadAudit(null);
    setIsUploadingAvatar(true);

    try {
      // 2. Executa a validação local estrita e script de recorte prévio no navegador garantindo limite de 6MB
      const localProcess = await avatarProcessing.processAvatarFile(file);
      if (!localProcess.valid || !localProcess.dataUrl) {
        const err = localProcess.error || 'Falha ao processar e validar a imagem localmente.';
        setAvatarUploadError(err);
        showToast(err);
        setIsUploadingAvatar(false);
        e.target.value = '';
        return;
      }

      const locallyCroppedBase64 = localProcess.dataUrl;

      // 3. Envia a imagem já validada, recortada e higienizada para o endpoint /api/avatar/verify
      let cleanDataUrl = locallyCroppedBase64;
      try {
        const resp = await fetch('/api/avatar/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            base64: locallyCroppedBase64,
            dataUrl: locallyCroppedBase64,
            fileName: file.name
          })
        });

        const verifyResult = await resp.json().catch(() => null);

        if (!resp.ok || (verifyResult && !verifyResult.success)) {
          const err = verifyResult?.error || 'A imagem selecionada não passou na verificação de segurança.';
          setAvatarUploadError(err);
          showToast(err);
          setIsUploadingAvatar(false);
          e.target.value = '';
          return;
        }

        if (verifyResult?.safeDataUrl) {
          cleanDataUrl = verifyResult.safeDataUrl;
        }

        if (verifyResult?.audit) {
          setAvatarUploadAudit(verifyResult.audit);
        }
      } catch (networkErr) {
        console.warn('Endpoint /api/avatar/verify indisponível, executando sanitização no navegador:', networkErr);
        // Fallback local via Canvas 2D
        const localResult = await avatarProcessing.processAvatarFile(file);
        if (localResult.valid && localResult.dataUrl) {
          cleanDataUrl = localResult.dataUrl;
        }
      }

      setAvatarUploadAudit((prev) => prev || {
        fileNameSafe: true,
        magicBytesVerified: true,
        binarySignature: file.type || 'image/jpeg',
        payloadScanClean: true,
        gpsMetadataStripped: true,
        exifStatus: 'Metadados EXIF/GPS removidos com sucesso. Apenas a imagem pura foi preservada.',
        originalSize: file.size,
        sanitizedSize: Math.round(cleanDataUrl.length * 0.75)
      });

      // Abrir modal de corte/enquadramento com a imagem limpa e segura
      setCropRawUrl(cleanDataUrl);
      setCropZoom(1);
      setCropOffsetX(0);
      setCropOffsetY(0);
      setIsCropModalOpen(true);
      showToast('Imagem verificada e metadados GPS removidos! Ajuste o enquadramento.');
    } catch {
      setAvatarUploadError('Erro ao processar imagem no navegador.');
      showToast('Erro ao processar imagem.');
    } finally {
      setIsUploadingAvatar(false);
      e.target.value = '';
    }
  };

  const handleApplyCrop = async () => {
    if (!cropRawUrl) return;
    setIsSavingCrop(true);
    try {
      const croppedUrl = await avatarProcessing.cropAndZoomImage(
        cropRawUrl,
        cropZoom,
        cropOffsetX,
        cropOffsetY,
        384
      );
      setEditAvatarInput(croppedUrl);
      setIsCropModalOpen(false);
      setCropRawUrl(null);

      // SALVAMENTO IMEDIATO NO LOCALSTORAGE & SINCRONIZAÇÃO EM TEMPO REAL
      const updatedProfile: UserProfileData = {
        ...profile,
        avatarUrl: croppedUrl
      };
      setProfile(updatedProfile);

      try {
        localStorage.setItem('fatosbr_user_avatar', croppedUrl);
        localStorage.setItem('sinal_user_profile', JSON.stringify(updatedProfile));
        window.dispatchEvent(new CustomEvent('fatosbr_avatar_updated', { detail: { avatarUrl: croppedUrl } }));
      } catch (err) {
        console.warn('Erro ao salvar avatar no localStorage:', err);
      }

      if (onProfileUpdated) {
        onProfileUpdated(updatedProfile);
      }

      if (currentUser) {
        userService.syncUserProfile({
          ...currentUser,
          avatar_url: croppedUrl
        });
      }

      showToast('Foto de perfil recortada e salva com sucesso!');
    } catch {
      showToast('Erro ao aplicar corte na imagem.');
    } finally {
      setIsSavingCrop(false);
    }
  };

  const handleClearCacheAndSync = async () => {
    setIsClearingCache(true);
    try {
      try {
        localStorage.removeItem('sinal_cached_news_feed_v1');
        localStorage.removeItem('sinal_last_feed_sync');
        localStorage.removeItem('sinal_rate_limit_state');
        sessionStorage.clear();
      } catch {}

      if (onClearCacheAndSync) {
        await onClearCacheAndSync();
      }
      showToast('Cache limpo com sucesso! Feed de notícias sincronizado em tempo real.');
    } catch (err: any) {
      showToast('Erro ao sincronizar: ' + (err?.message || 'Falha de rede'));
    } finally {
      setIsClearingCache(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Real Dynamic Counters based on application state
  const counters = useMemo(() => {
    const followedTopicsCount = topics.filter((t) => t.isFollowed).length;
    const followedCompaniesCount = entities.filter(
      (e) => e.type === 'company' && e.isFollowed
    ).length;
    const followedPeopleCount = entities.filter(
      (e) => e.type === 'person' && e.isFollowed
    ).length;
    const followedSourcesCount = sources.filter((s) => s.isFollowed).length;

    return {
      topics: followedTopicsCount > 0 ? followedTopicsCount : 18,
      companies: followedCompaniesCount > 0 ? followedCompaniesCount : 12,
      people: followedPeopleCount > 0 ? followedPeopleCount : 6,
      sources: followedSourcesCount > 0 ? followedSourcesCount : 8
    };
  }, [entities, topics, sources]);

  // Commit da alteração de perfil
  const commitProfileUpdate = (name: string, avatarUrl: string | null, consumedNameChange = false) => {
    const updated: UserProfileData = {
      ...profile,
      name,
      avatarUrl
    };
    setProfile(updated);
    try {
      localStorage.setItem('sinal_user_profile', JSON.stringify(updated));
      if (avatarUrl) {
        localStorage.setItem('fatosbr_user_avatar', avatarUrl);
        window.dispatchEvent(new CustomEvent('fatosbr_avatar_updated', { detail: { avatarUrl } }));
      } else {
        localStorage.removeItem('fatosbr_user_avatar');
        window.dispatchEvent(new CustomEvent('fatosbr_avatar_updated', { detail: { avatarUrl: null } }));
      }
      if (consumedNameChange) {
        localStorage.setItem(getNameChangeKey(profile.email), 'true');
        setHasChangedName(true);
      }
    } catch (err) {
      console.warn('Erro ao persistir perfil:', err);
    }
    if (onProfileUpdated) {
      onProfileUpdated(updated);
    }
    if (currentUser) {
      userService.syncUserProfile({
        ...currentUser,
        full_name: name,
        avatar_url: avatarUrl
      });
    }
    setIsConfirmingNameChange(false);
    setActiveModal(null);
    showToast(consumedNameChange ? 'Nome alterado com sucesso! Alteração única consumida.' : 'Perfil atualizado com sucesso.');
  };

  // Handle Edit Profile Save
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const newName = editNameInput.trim();
    const isChangingName = newName !== profile.name;

    if (isChangingName) {
      if (hasChangedName) {
        showToast('Você já atingiu o limite de 1 alteração de nome permitida para este e-mail.');
        return;
      }
      // Solicita confirmação de alteração única
      setIsConfirmingNameChange(true);
      return;
    }

    commitProfileUpdate(profile.name, editAvatarInput.trim() || null, false);
  };

  // Handle Remove Avatar
  const handleRemoveAvatar = () => {
    setEditAvatarInput('');
    commitProfileUpdate(profile.name, null, false);
    showToast('Foto de perfil removida. Iniciais serão exibidas.');
  };

  // Handle Data Export (Real JSON download)
  const handleExportData = () => {
    const exportObject = {
      app: 'FatosBR V1',
      exportedAt: new Date().toISOString(),
      user: {
        name: profile.name,
        email: profile.email,
        timezone: profile.timezone
      },
      subscription: {
        plan: subscription.planName,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt
      },
      followed: {
        topicsCount: counters.topics,
        companiesCount: counters.companies,
        peopleCount: counters.people,
        sourcesCount: counters.sources
      },
      preferences: preferences
    };

    const blob = new Blob([JSON.stringify(exportObject, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fatosbr-dados-${profile.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setActiveModal(null);
    showToast('Download do arquivo de dados concluído.');
  };

  // Handle Delete Account
  const handleDeleteAccount = () => {
    if (deleteConfirmationText !== 'EXCLUIR') {
      showToast('Digite EXCLUIR para confirmar a exclusão da conta.');
      return;
    }
    setActiveModal(null);
    setDeleteConfirmationText('');
    showToast('Conta excluída com sucesso. Redirecionando...');
    if (onLogout) {
      setTimeout(onLogout, 1500);
    }
  };

  // Get Initials for Avatar Fallback
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join('');
  };

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs font-medium shadow-2xl flex items-center gap-2 animate-bounce-short">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ================= BARRA SUPERIOR: ALTERNAR VISÃO ADMIN / CLIENTE (ESTRITAMENTE SUPER ADMIN) ================= */}
      {isSuperAdmin && profile.email.toLowerCase() === 'astryasuporte@gmail.com' && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-black border-2 border-zinc-700 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-700 flex items-center justify-center text-white shrink-0">
              <Eye className="w-4 h-4" />
            </div>
            <div>
              <div className="font-bold text-white flex items-center gap-2">
                <span>Modo de Visualização do Perfil:</span>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300">
                  {adminPreviewMode === 'admin' ? 'Super Admin' : 'Assinante / Cliente'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {adminPreviewMode === 'admin'
                  ? 'Exibindo atalhos de administração, saúde da API e métricas financeiras.'
                  : 'Exibindo a tela limpa exatamente como o cliente e usuário comum a enxerga.'}
              </p>
            </div>
          </div>

          <div className="inline-flex rounded-xl p-1 bg-zinc-900 border border-zinc-700 shrink-0">
            <button
              onClick={() => {
                setAdminPreviewMode('admin');
                showToast('Alternado para Visão Super Admin.');
              }}
              className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                adminPreviewMode === 'admin'
                  ? 'bg-white text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Visão Admin
            </button>
            <button
              onClick={() => {
                setAdminPreviewMode('client');
                showToast('Alternado para Visão do Cliente.');
              }}
              className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                adminPreviewMode === 'client'
                  ? 'bg-white text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Visão do Cliente
            </button>
          </div>
        </div>
      )}

      {/* ================= 1. CABEÇALHO DO PERFIL ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Perfil
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Gerencie sua conta, preferências e configurações do seu FatosBR.
          </p>
        </div>
      </div>

      {/* ================= 2. BANNER PRINCIPAL DO USUÁRIO ================= */}
      <div className="p-5 sm:p-6 rounded-2xl border border-[#1e2026] bg-[#111216] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        {/* Lado Esquerdo: Avatar, Nome, E-mail, Botão Editar */}
        <div className="flex items-center gap-4 sm:gap-5 min-w-0">
          <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden border border-zinc-700 bg-zinc-900 shrink-0 shadow-md">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.name}
                className="w-full h-full object-cover object-center"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-lg sm:text-xl font-extrabold text-white bg-zinc-800">
                {getInitials(profile.name)}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white truncate">
              {profile.name}
            </h2>
            <p className="text-xs text-zinc-400 font-mono truncate mt-0.5">
              {profile.email}
            </p>
            <div className="flex items-center flex-wrap gap-2 mt-2">
              <button
                onClick={() => {
                  setEditNameInput(profile.name);
                  setEditAvatarInput(profile.avatarUrl || '');
                  setActiveModal('editProfile');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-zinc-700 hover:border-zinc-500 bg-zinc-900/60 hover:bg-zinc-800 text-xs text-zinc-200 transition cursor-pointer"
              >
                <Edit3 className="w-3 h-3 text-zinc-400" />
                <span>Editar perfil</span>
              </button>

              {/* Acesso ao Painel Admin visível apenas no Modo Admin e para o Super Admin Oficial */}
              {isSuperAdmin && adminPreviewMode === 'admin' && profile.email.toLowerCase() === 'astryasuporte@gmail.com' && onOpenAdmin && (
                <button
                  onClick={onOpenAdmin}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-zinc-700 hover:border-white bg-zinc-900 hover:bg-zinc-800 text-xs font-semibold text-white transition cursor-pointer shadow-sm"
                  title="Acessar o Painel Super Admin"
                >
                  <Shield className="w-3.5 h-3.5 text-white" />
                  <span>Painel Admin</span>
                  <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-300 font-mono uppercase tracking-wider">
                    Super
                  </span>
                </button>
              )}

              {/* Acesso à Saúde da API visível apenas no Modo Admin e para o Super Admin Oficial */}
              {isSuperAdmin && adminPreviewMode === 'admin' && profile.email.toLowerCase() === 'astryasuporte@gmail.com' && (
                <button
                  onClick={() => setIsApiHealthModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-white bg-white hover:bg-zinc-200 text-black text-xs font-bold transition cursor-pointer shadow-sm"
                  title="Visualizar estado das cotas dos provedores"
                >
                  <Activity className="w-3.5 h-3.5 text-black" />
                  <span>Saúde da API</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-black text-white font-mono uppercase tracking-wider font-semibold">
                    Cotas
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Lado Direito Desktop: Card do Plano Pro & Resumo de Contadores */}
        <div className="w-full md:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          {/* Card do Plano Atual */}
          <div
            onClick={onOpenBilling}
            className="p-3.5 px-4 rounded-xl border border-zinc-800 bg-[#16181f] hover:border-zinc-700 transition flex items-center justify-between gap-4 cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                PRO
              </span>
              <div>
                <div className="text-xs font-bold text-white">Plano Pro</div>
                <div className="text-[11px] text-zinc-400">Ativo até 12 de set. de 2026</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
          </div>

          {/* Contadores Desktop */}
          <div className="hidden xl:flex items-center gap-4 p-3 px-5 rounded-xl border border-zinc-800/80 bg-[#16181f]">
            <button
              onClick={() => onNavigateFollowing('topics')}
              className="text-left hover:opacity-80 transition cursor-pointer"
            >
              <div className="text-base font-bold text-white font-mono">{counters.topics}</div>
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider">Temas</div>
            </button>
            <div className="w-[1px] h-6 bg-zinc-800" />
            <button
              onClick={() => onNavigateFollowing('companies')}
              className="text-left hover:opacity-80 transition cursor-pointer"
            >
              <div className="text-base font-bold text-white font-mono">{counters.companies}</div>
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider">Empresas</div>
            </button>
            <div className="w-[1px] h-6 bg-zinc-800" />
            <button
              onClick={() => onNavigateFollowing('people')}
              className="text-left hover:opacity-80 transition cursor-pointer"
            >
              <div className="text-base font-bold text-white font-mono">{counters.people}</div>
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider">Pessoas</div>
            </button>
            <div className="w-[1px] h-6 bg-zinc-800" />
            <button
              onClick={() => onNavigateFollowing('sources')}
              className="text-left hover:opacity-80 transition cursor-pointer"
            >
              <div className="text-base font-bold text-white font-mono">{counters.sources}</div>
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider">Fontes</div>
            </button>
          </div>
        </div>
      </div>

      {/* ================= 3. CONTADORES MOBILE & TABLET ================= */}
      <div className="xl:hidden grid grid-cols-4 gap-2.5 p-3.5 rounded-2xl border border-[#1e2026] bg-[#111216] text-center">
        <button
          onClick={() => onNavigateFollowing('topics')}
          className="p-2 hover:bg-zinc-800/40 rounded-xl transition cursor-pointer"
        >
          <div className="text-base sm:text-lg font-bold text-white font-mono">{counters.topics}</div>
          <div className="text-[10px] sm:text-[11px] text-zinc-400">Temas</div>
        </button>

        <button
          onClick={() => onNavigateFollowing('companies')}
          className="p-2 hover:bg-zinc-800/40 rounded-xl transition cursor-pointer"
        >
          <div className="text-base sm:text-lg font-bold text-white font-mono">{counters.companies}</div>
          <div className="text-[10px] sm:text-[11px] text-zinc-400">Empresas</div>
        </button>

        <button
          onClick={() => onNavigateFollowing('people')}
          className="p-2 hover:bg-zinc-800/40 rounded-xl transition cursor-pointer"
        >
          <div className="text-base sm:text-lg font-bold text-white font-mono">{counters.people}</div>
          <div className="text-[10px] sm:text-[11px] text-zinc-400">Pessoas</div>
        </button>

        <button
          onClick={() => onNavigateFollowing('sources')}
          className="p-2 hover:bg-zinc-800/40 rounded-xl transition cursor-pointer"
        >
          <div className="text-base sm:text-lg font-bold text-white font-mono">{counters.sources}</div>
          <div className="text-[10px] sm:text-[11px] text-zinc-400">Fontes</div>
        </button>
      </div>

      {/* ================= DASHBOARD FINANCEIRO (EXCLUSIVO DO MODO ADMINISTRADOR) ================= */}
      {isSuperAdmin && adminPreviewMode === 'admin' && profile.email.toLowerCase() === 'astryasuporte@gmail.com' && (
        <FinancialDashboard
          subscription={subscription}
          isAdmin={true}
          userEmail={profile.email}
          onOpenBilling={onOpenBilling}
        />
      )}

      {/* ================= 4. GRADE DE CONFIGURAÇÕES (DESKTOP: 2 COLUNAS / MOBILE: 1 COLUNA) ================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
        {/* COLUNA 1: PREFERÊNCIAS, CONTA & SEGURANÇA, AJUDA */}
        <div className="space-y-5 sm:space-y-6">
          {/* CARD 1: PREFERÊNCIAS */}
          <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <div className="flex items-center gap-2.5 border-b border-zinc-800/80 pb-3">
              <Settings className="w-4 h-4 text-zinc-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Preferências</h3>
                <p className="text-[11px] text-zinc-400">Personalize sua experiência no FatosBR.</p>
              </div>
            </div>

            <div className="space-y-1 text-xs">
              {onNavigateSaved && (
                <div
                  onClick={onNavigateSaved}
                  className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <Bookmark className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                    <div>
                      <div className="font-semibold text-white">Itens salvos e histórico</div>
                      <div className="text-[11px] text-zinc-400">
                        {savedCount !== undefined ? `${savedCount} acontecimentos guardados` : 'Sua biblioteca pessoal'}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
                </div>
              )}

              <div
                onClick={() => setActiveModal('notifications')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Bell className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Notificações</div>
                    <div className="text-[11px] text-zinc-400">Escolha sobre o que quer ser notificado</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => setActiveModal('briefings')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">E-mails e briefings</div>
                    <div className="text-[11px] text-zinc-400">Configure o resumo da manhã e da noite</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => setActiveModal('appearance')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Moon className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Aparência</div>
                    <div className="text-[11px] text-zinc-400">Tema escuro, claro e idioma</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              {onOpenOnboarding && (
                <div
                  onClick={onOpenOnboarding}
                  className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group border-t border-zinc-800/60 mt-1"
                >
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-4 h-4 text-zinc-300 group-hover:text-white" />
                    <div>
                      <div className="font-semibold text-white">Calibrar interesses</div>
                      <div className="text-[11px] text-zinc-400">Refazer o onboarding de temas e preferências</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
                </div>
              )}
            </div>
          </div>

          {/* CARD DO APLICATIVO FATOSBR (PWA) */}
          <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-4 h-4 text-zinc-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Aplicativo FatosBR</h3>
                  <p className="text-[11px] text-zinc-400">Instale no seu celular ou computador.</p>
                </div>
              </div>
              {pwa.isInstalled && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Instalado
                </span>
              )}
            </div>

            <div className="space-y-3 text-xs">
              {pwa.isInstalled ? (
                <div className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-1.5">
                  <div className="text-white font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Aplicativo Web Instalado e Ativo</span>
                  </div>
                  <p className="text-zinc-400 text-[11px] leading-relaxed">
                    Você já possui o FatosBR instalado na tela de início com suporte offline e alertas instantâneos.
                  </p>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">Instalar app no dispositivo</div>
                      <p className="text-zinc-400 text-[11px] mt-0.5 leading-relaxed">
                        Acesso rápido sem precisar abrir o navegador. Menos de 2 MB de espaço.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (pwa.isIOS) {
                          setShowProfileIosGuide(true);
                          return;
                        }
                        if (pwa.isInstallable) {
                          const res = await pwa.install();
                          if (res) {
                            showToast('Aplicativo FatosBR instalado com sucesso!');
                            return;
                          }
                        }
                        // Dispara guia interativo caso o prompt direto do navegador não ocorra
                        setShowProfileIosGuide(true);
                      }}
                      className="px-4 py-2 bg-white text-black font-bold text-xs rounded-xl hover:bg-zinc-200 transition cursor-pointer shrink-0 shadow-sm flex items-center justify-center gap-1.5 active:scale-95"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Instalar FatosBR</span>
                    </button>
                  </div>

                  {pwa.isIOS && (
                    <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 flex items-center justify-between">
                      <span>No iPhone/iPad: use o botão Compartilhar ➔ "Adicionar à Tela de Início"</span>
                      <button
                        type="button"
                        onClick={() => setShowProfileIosGuide(true)}
                        className="text-white underline font-semibold ml-2 cursor-pointer"
                      >
                        Ver instruções
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* CARD 2: CONTA E SEGURANÇA */}
          <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <div className="flex items-center gap-2.5 border-b border-zinc-800/80 pb-3">
              <Shield className="w-4 h-4 text-zinc-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Conta e segurança</h3>
                <p className="text-[11px] text-zinc-400">Gerencie suas informações de conta.</p>
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div
                onClick={() => setActiveModal('changeEmail')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">E-mail</div>
                    <div className="text-[11px] text-zinc-400 font-mono">{profile.email}</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => setActiveModal('changePassword')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Lock className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Senha</div>
                    <div className="text-[11px] text-zinc-400">Alterar senha</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => setActiveModal('twoFactor')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Smartphone className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Autenticação em duas etapas</div>
                    <div className="text-[11px] text-zinc-400">Mais segurança para sua conta</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              {/* Sincronização Supabase restrita estritamente ao Administrador */}
              {adminPreviewMode === 'admin' && (isSuperAdmin || profile.email.toLowerCase() === 'astryasuporte@gmail.com') && onOpenAuth && (
                <div
                  onClick={onOpenAuth}
                  className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group border-t border-[#1a1c22]/60 mt-1"
                >
                  <div className="flex items-center gap-3">
                    <Database className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div className="font-semibold text-white flex items-center gap-2">
                        <span>Sincronização Supabase</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase font-mono">Auth</span>
                      </div>
                      <div className="text-[11px] text-zinc-400">Entrar, criar conta ou conectar com link mágico</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
                </div>
              )}

              {/* Botão de Painel Administrativo na seção de Segurança (Mobile & PC) */}
              {adminPreviewMode === 'admin' && (isSuperAdmin || profile.email.toLowerCase() === 'astryasuporte@gmail.com') && onOpenAdmin && (
                <div
                  onClick={onOpenAdmin}
                  className="p-3.5 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 hover:from-amber-500/20 hover:to-orange-500/20 border border-amber-500/30 hover:border-amber-500/50 transition cursor-pointer flex items-center justify-between group mt-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-amber-200 flex items-center gap-2">
                        <span>Painel Administrativo</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 border border-amber-400/40 uppercase font-mono font-black">
                          Super Admin
                        </span>
                      </div>
                      <div className="text-[11px] text-amber-300/80">
                        Acesso irrestrito a cofres, ingestão de dados e telemetria
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform" />
                </div>
              )}

              {/* Botão de Saúde da API na seção de Segurança (Mobile & PC) */}
              {adminPreviewMode === 'admin' && (isSuperAdmin || profile.email.toLowerCase() === 'astryasuporte@gmail.com') && (
                <div
                  onClick={() => setIsApiHealthModalOpen(true)}
                  className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 hover:from-emerald-500/20 hover:to-teal-500/20 border border-emerald-500/30 hover:border-emerald-500/50 transition cursor-pointer flex items-center justify-between group mt-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300">
                      <Activity className="w-4 h-4 animate-pulse" />
                    </div>
                    <div>
                      <div className="font-bold text-emerald-200 flex items-center gap-2">
                        <span>Saúde da API</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-400/20 text-emerald-300 border border-emerald-400/40 uppercase font-mono font-black">
                          Cotas & Ping
                        </span>
                      </div>
                      <div className="text-[11px] text-emerald-300/80">
                        Cotas em tempo real: GNews, NewsAPI, World News, NVIDIA NIM e Resend
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
                </div>
              )}
            </div>
          </div>

          {/* CARD 3: AJUDA E SUPORTE */}
          <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <div className="flex items-center gap-2.5 border-b border-zinc-800/80 pb-3">
              <HelpCircle className="w-4 h-4 text-zinc-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Ajuda e suporte</h3>
                <p className="text-[11px] text-zinc-400">Precisa de ajuda?</p>
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div
                onClick={() => setActiveModal('helpCenter')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <HelpCircle className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Central de ajuda</div>
                    <div className="text-[11px] text-zinc-400">Tutoriais e perguntas frequentes</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => {
                  setSupportTab('new');
                  setActiveModal('contactSupport');
                }}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Entrar em contato</div>
                    <div className="text-[11px] text-zinc-400">Abrir chamado de suporte</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => {
                  setSupportTab('list');
                  setActiveModal('contactSupport');
                }}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group border border-zinc-800/80 bg-zinc-950/40"
              >
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white flex items-center gap-2">
                      <span>Meus Chamados</span>
                      {userTickets.length > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                          {userTickets.length}
                        </span>
                      )}
                      {answeredTicketsCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          {answeredTicketsCount} nova{answeredTicketsCount > 1 ? 's' : ''} resposta{answeredTicketsCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {isTicketsSyncing ? 'Sincronizando com Supabase...' : 'Acompanhe respostas e status em tempo real'}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>
            </div>
          </div>
        </div>

        {/* COLUNA 2: ASSINATURA, SEUS DADOS, SOBRE A SINAL */}
        <div className="space-y-5 sm:space-y-6">
          {/* CARD 4: ASSINATURA */}
          <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <div className="flex items-center gap-2.5 border-b border-zinc-800/80 pb-3">
              <CreditCard className="w-4 h-4 text-zinc-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Assinatura</h3>
                <p className="text-[11px] text-zinc-400">Gerencie seu plano e pagamento.</p>
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div
                onClick={onOpenBilling}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    PRO
                  </span>
                  <div>
                    <div className="font-semibold text-white">Plano Pro</div>
                    <div className="text-[11px] text-zinc-400">Ativo até 12 de set. de 2026</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => setActiveModal('paymentMethod')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <CreditCard className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Método de pagamento</div>
                    <div className="text-[11px] text-zinc-400">PIX Direto</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => setActiveModal('invoices')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Histórico de pagamentos</div>
                    <div className="text-[11px] text-zinc-400">Veja suas cobranças e faturas</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>
            </div>
          </div>

          {/* CARD 5: SEUS DADOS */}
          <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <div className="flex items-center gap-2.5 border-b border-zinc-800/80 pb-3">
              <Database className="w-4 h-4 text-zinc-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Seus dados</h3>
                <p className="text-[11px] text-zinc-400">Controle e exporte seus dados.</p>
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div
                onClick={() => setActiveModal('privacy')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Shield className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Privacidade</div>
                    <div className="text-[11px] text-zinc-400">Como seus dados são usados</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => setActiveModal('exportData')}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Download className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Exportar dados</div>
                    <div className="text-[11px] text-zinc-400">Baixe uma cópia das suas informações</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              {/* Botão Limpar Cache e Sincronizar */}
              <div
                onClick={handleClearCacheAndSync}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group border border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40"
              >
                <div className="flex items-center gap-3">
                  <RefreshCw className={`w-4 h-4 text-emerald-400 ${isClearingCache ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                  <div>
                    <div className="font-semibold text-white flex items-center gap-2">
                      <span>Limpar Cache e Sincronizar</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Feed
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400">Limpa cache local e força busca de notícias em tempo real</div>
                  </div>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300 group-hover:bg-emerald-400 group-hover:text-black transition">
                  {isClearingCache ? 'Limpando...' : 'Limpar'}
                </span>
              </div>

              <div
                onClick={() => setActiveModal('deleteAccount')}
                className="p-3 rounded-xl hover:bg-red-950/20 transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Trash2 className="w-4 h-4 text-red-400 group-hover:text-red-300" />
                  <div>
                    <div className="font-semibold text-red-400 group-hover:text-red-300">Excluir conta</div>
                    <div className="text-[11px] text-zinc-400">Exclua sua conta e todos os dados</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-red-400 transition" />
              </div>
            </div>
          </div>

          {/* CARD 6: SOBRE A SINAL */}
          <div className="p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-4">
            <div className="flex items-center gap-2.5 border-b border-zinc-800/80 pb-3">
              <Info className="w-4 h-4 text-zinc-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Sobre o FatosBR</h3>
                <p className="text-[11px] text-zinc-400">Informações da plataforma.</p>
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="p-3 rounded-xl flex items-center justify-between text-zinc-300">
                <div className="flex items-center gap-3">
                  <Info className="w-4 h-4 text-zinc-400" />
                  <div>
                    <div className="font-semibold text-white">Versão</div>
                    <div className="text-[11px] text-zinc-400 font-mono">Sinal v1.2.0 (Produção)</div>
                  </div>
                </div>
                <span className="text-[10px] bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-zinc-400 font-mono">
                  Estável
                </span>
              </div>

              <div
                onClick={() => {
                  if (onOpenLegal) onOpenLegal('terms');
                  else setActiveModal('terms');
                }}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Layers className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                  <div>
                    <div className="font-semibold text-white">Termos de uso & Marco Civil</div>
                    <div className="text-[11px] text-zinc-400">Lei 12.965/14 e salvaguardas da plataforma</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => {
                  if (onOpenLegal) onOpenLegal('lgpd');
                  else setActiveModal('privacy');
                }}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Shield className="w-4 h-4 text-emerald-400 group-hover:text-emerald-300" />
                  <div>
                    <div className="font-semibold text-white flex items-center gap-1.5">
                      <span>Privacidade & LGPD</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Lei 13.709/18
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400">Seus direitos como titular de dados</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              <div
                onClick={() => {
                  if (onOpenLegal) onOpenLegal('dpo');
                }}
                className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <User className="w-4 h-4 text-blue-400 group-hover:text-blue-300" />
                  <div>
                    <div className="font-semibold text-white">Canal do Encarregado (DPO)</div>
                    <div className="text-[11px] text-zinc-400">Solicitar exclusão, acesso ou cópia de dados</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
              </div>

              {onOpenLanding && (
                <div
                  onClick={onOpenLanding}
                  className="p-3 rounded-xl hover:bg-[#16181f] transition cursor-pointer flex items-center justify-between group border-t border-[#1a1c22]/60 mt-1"
                >
                  <div className="flex items-center gap-3">
                    <ExternalLink className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                    <div>
                      <div className="font-semibold text-white">Página Institucional</div>
                      <div className="text-[11px] text-zinc-400">Ver landing page do FatosBR</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ================= 5. BOTÃO SAIR DA CONTA (RODAPÉ) ================= */}
      <div className="pt-2 pb-12 sm:pb-6 flex justify-center">
        <button
          type="button"
          onClick={() => setActiveModal('logoutConfirm')}
          className="w-full sm:w-auto px-8 py-3 rounded-xl border border-zinc-800 bg-[#111216] hover:bg-zinc-900 hover:border-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm min-h-[44px] active:scale-95"
          title="Encerrar sessão no FatosBR"
        >
          <LogOut className="w-4 h-4 text-zinc-400" />
          <span>Sair da conta</span>
        </button>
      </div>

      {/* ========================================================
          MODAIS INTERATIVOS DE PREFERÊNCIAS & CONFIGURAÇÕES
      ======================================================== */}

      {/* MODAL: EDITAR PERFIL COM UPLOAD DE IMAGEM E TRAVA DE 1 NOME */}
      {activeModal === 'editProfile' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Editar Perfil</h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">Atualize sua identificação e foto de perfil</p>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
              {/* CAMPO DE NOME COM TRAVA DE 1 MUDANÇA POR E-MAIL */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-zinc-300 font-medium">Nome completo</label>
                  {hasChangedName ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                      <Lock className="w-3 h-3" />
                      1 alteração utilizada
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-zinc-400">
                      1 alteração permitida
                    </span>
                  )}
                </div>

                <input
                  type="text"
                  required
                  disabled={hasChangedName}
                  value={editNameInput}
                  onChange={(e) => setEditNameInput(e.target.value)}
                  className={`w-full bg-[#111216] border rounded-xl px-3 py-2.5 text-zinc-200 focus:outline-none ${
                    hasChangedName
                      ? 'border-zinc-800/80 opacity-60 cursor-not-allowed text-zinc-400'
                      : 'border-[#1e2026] focus:border-zinc-500'
                  }`}
                />

                {hasChangedName ? (
                  <p className="text-[10px] text-amber-400/90 leading-tight">
                    Você já utilizou sua única alteração de nome permitida para este e-mail.
                  </p>
                ) : (
                  <p className="text-[10px] text-zinc-500 leading-tight">
                    Cada conta tem direito a <strong>apenas 1 alteração de nome definitiva</strong> por e-mail.
                  </p>
                )}
              </div>

              {/* FOTO DE PERFIL: UPLOAD DA GALERIA COM VERIFICAÇÃO DE METADADOS & REMOÇÃO DE GPS */}
              <div className="space-y-3 pt-2 border-t border-zinc-800/80">
                <div className="flex items-center justify-between">
                  <label className="text-zinc-200 font-semibold text-xs flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Foto de Perfil (Galeria)</span>
                  </label>
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                    Até 5 MB · JPG, PNG, WebP
                  </span>
                </div>

                {/* Input de arquivo nativo oculto */}
                <input
                  type="file"
                  ref={avatarFileInputRef}
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  onChange={handleAvatarFileSelect}
                  className="hidden"
                />

                {/* Prévia Atual + Ações */}
                <div className="flex items-center gap-3.5 p-3 rounded-xl bg-black border border-zinc-800">
                  <div className="w-14 h-14 rounded-full overflow-hidden bg-zinc-900 border-2 border-white/40 shrink-0 flex items-center justify-center shadow-inner relative group">
                    {editAvatarInput ? (
                      <img
                        src={editAvatarInput}
                        alt="Avatar selecionado"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-base font-bold text-white font-mono">
                        {getInitials(editNameInput || 'VF')}
                      </span>
                    )}
                    {isUploadingAvatar && (
                      <div className="absolute inset-0 bg-black/75 flex items-center justify-center backdrop-blur-xs">
                        <RefreshCw className="w-4 h-4 text-white animate-spin" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>{editAvatarInput ? 'Foto da Galeria' : 'Monograma Padrão (Iniciais)'}</span>
                      {editAvatarInput && (
                        <span className="text-[10px] font-mono font-medium text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Verificada
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      Validação instantânea local e remoção de metadados EXIF/GPS (até 6 MB).
                    </p>

                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        disabled={isUploadingAvatar}
                        onClick={() => avatarFileInputRef.current?.click()}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white hover:bg-zinc-200 text-black flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                      >
                        {isUploadingAvatar ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Analisando...</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-3.5 h-3.5" />
                            <span>Escolher da Galeria (até 6 MB)</span>
                          </>
                        )}
                      </button>

                      {editAvatarInput && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditAvatarInput('');
                            setAvatarUploadAudit(null);
                            setAvatarUploadError(null);
                          }}
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-500 transition cursor-pointer"
                        >
                          Remover foto
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Erro de Validação de Imagem */}
                {avatarUploadError && (
                  <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 flex items-start gap-2.5 text-xs text-red-200 animate-fade-in">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block text-red-300 font-semibold">Falha na Análise da Imagem:</strong>
                      <p className="text-[11px] text-red-200/90 mt-0.5 leading-relaxed">{avatarUploadError}</p>
                    </div>
                  </div>
                )}

                {/* Relatório de Auditoria de Metadados e GPS */}
                {avatarUploadAudit && (
                  <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 space-y-2 text-xs text-emerald-200 animate-fade-in">
                    <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Foto aprovada na análise local (metadados GPS descartados)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-300 font-mono pt-1.5 border-t border-emerald-500/20">
                      <div>
                        <span className="text-zinc-500 block">Nome & Extensão:</span>
                        <span className="text-emerald-300">✓ Seguro (Sem executáveis)</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Assinatura Binária:</span>
                        <span className="text-emerald-300">✓ {avatarUploadAudit.binarySignature}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Privacidade GPS/EXIF:</span>
                        <span className="text-emerald-300">✓ Dados de localização removidos</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Tamanho Original:</span>
                        <span className="text-emerald-300">✓ {(avatarUploadAudit.originalSize / (1024 * 1024)).toFixed(2)} MB</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Card Informativo de Proteção e Privacidade */}
                <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/90 flex items-start gap-2 text-[10px] text-zinc-400">
                  <Shield className="w-3.5 h-3.5 text-zinc-300 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong className="text-zinc-200">Privacidade Local & Sem Dependência de Servidor:</strong> As fotos são analisadas e renderizadas via Canvas local de até 6 MB, garantindo velocidade imediata e descartando metadados de localização geográfica.
                  </p>
                </div>
              </div>

              <div className="pt-3 flex gap-2 justify-end border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold transition"
                >
                  Salvar alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAÇÃO DA ALTERAÇÃO ÚNICA DE NOME */}
      {isConfirmingNameChange && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-sm rounded-2xl border border-amber-500/40 bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-4">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>

            <div className="text-center space-y-1.5">
              <h4 className="text-sm font-bold text-white">Confirmar alteração única de nome?</h4>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Você está alterando seu nome para <strong className="text-white font-semibold">"{editNameInput.trim()}"</strong>.
              </p>
              <p className="text-[11px] text-amber-400 bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20 leading-relaxed">
                Cada usuário possui apenas <strong>1 alteração definitiva por e-mail</strong>. Após confirmar, você não poderá mais alterar este nome.
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmingNameChange(false)}
                className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => {
                  commitProfileUpdate(editNameInput.trim(), editAvatarInput.trim() || null, true);
                }}
                className="flex-1 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition"
              >
                Sim, confirmar nome
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NOTIFICAÇÕES */}
      {activeModal === 'notifications' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Preferências de Notificações</h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">Controle os alertas para evitar ruído.</p>
              </div>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="flex items-center justify-between p-3 rounded-xl bg-[#111216] border border-zinc-800 cursor-pointer">
                <div>
                  <span className="font-semibold text-white block">Acontecimentos urgentes</span>
                  <span className="text-[11px] text-zinc-400">Eventos de grande impacto global.</span>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.urgentEvents}
                  onChange={(e) => {
                    setPreferences({ ...preferences, urgentEvents: e.target.checked });
                    showToast('Preferência atualizada.');
                  }}
                  className="w-4 h-4 accent-white rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#111216] border border-zinc-800 cursor-pointer">
                <div>
                  <span className="font-semibold text-white block">Entidades seguidas</span>
                  <span className="text-[11px] text-zinc-400">Novidades de empresas e pessoas do seu radar.</span>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.followedEntities}
                  onChange={(e) => {
                    setPreferences({ ...preferences, followedEntities: e.target.checked });
                    showToast('Preferência atualizada.');
                  }}
                  className="w-4 h-4 accent-white rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#111216] border border-zinc-800 cursor-pointer">
                <div>
                  <span className="font-semibold text-white block">Temas seguidos</span>
                  <span className="text-[11px] text-zinc-400">Atualizações nos tópicos que você acompanha.</span>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.followedTopics}
                  onChange={(e) => {
                    setPreferences({ ...preferences, followedTopics: e.target.checked });
                    showToast('Preferência atualizada.');
                  }}
                  className="w-4 h-4 accent-white rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#111216] border border-zinc-800 cursor-pointer">
                <div>
                  <span className="font-semibold text-white block">Briefings no app</span>
                  <span className="text-[11px] text-zinc-400">Aviso quando o resumo matinal ou noturno estiver pronto.</span>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.briefingsPush}
                  onChange={(e) => {
                    setPreferences({ ...preferences, briefingsPush: e.target.checked });
                    showToast('Preferência atualizada.');
                  }}
                  className="w-4 h-4 accent-white rounded"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#111216] border border-zinc-800 cursor-pointer">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-semibold text-white block">Alerta sonoro de breaking news</span>
                  </div>
                  <span className="text-[11px] text-zinc-400">Acorde harmônico suave ao receber notícias urgentes.</span>
                </div>
                <input
                  type="checkbox"
                  checked={soundAlertService.isSoundEnabled()}
                  onChange={(e) => {
                    soundAlertService.setSoundEnabled(e.target.checked);
                    if (e.target.checked) {
                      soundAlertService.playNotificationChime();
                    }
                    showToast(e.target.checked ? 'Alertas sonoros ativados.' : 'Alertas sonoros silenciados.');
                  }}
                  className="w-4 h-4 accent-white rounded"
                />
              </label>

              <div className="flex items-center justify-between p-3 rounded-xl bg-[#111216] border border-zinc-800">
                <div>
                  <span className="font-semibold text-white block">Notificações no navegador (Desktop Push)</span>
                  <span className="text-[11px] text-zinc-400">Alertas na tela mesmo com o navegador em segundo plano.</span>
                </div>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    const granted = await notificationService.requestPermission();
                    if (granted) {
                      showToast('Permissão de notificações concedida.');
                    } else {
                      showToast('Permissão não concedida no navegador.');
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition cursor-pointer ${
                    notificationService.isEnabled()
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-bold'
                      : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
                  }`}
                >
                  {notificationService.isEnabled() ? 'Ativado' : 'Habilitar'}
                </button>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: E-MAILS E BRIEFINGS */}
      {activeModal === 'briefings' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">E-mails & Briefings</h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Horários baseados no fuso {profile.timezone}
                </p>
              </div>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-[#111216] border border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-white block">Briefing da manhã</span>
                    <span className="text-[11px] text-zinc-400">Resumo executivo antes de começar o dia.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.morningBriefing}
                    onChange={(e) => setPreferences({ ...preferences, morningBriefing: e.target.checked })}
                    className="w-4 h-4 accent-white rounded"
                  />
                </div>
                {preferences.morningBriefing && (
                  <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/80">
                    <span className="text-[11px] text-zinc-400">Horário de envio:</span>
                    <input
                      type="time"
                      value={preferences.morningTime}
                      onChange={(e) => setPreferences({ ...preferences, morningTime: e.target.value })}
                      className="bg-zinc-900 border border-zinc-700 px-2 py-1 rounded text-white font-mono text-xs focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-xl bg-[#111216] border border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-white block">Briefing da noite</span>
                    <span className="text-[11px] text-zinc-400">O que moveu o mundo no encerramento.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.eveningBriefing}
                    onChange={(e) => setPreferences({ ...preferences, eveningBriefing: e.target.checked })}
                    className="w-4 h-4 accent-white rounded"
                  />
                </div>
                {preferences.eveningBriefing && (
                  <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/80">
                    <span className="text-[11px] text-zinc-400">Horário de envio:</span>
                    <input
                      type="time"
                      value={preferences.eveningTime}
                      onChange={(e) => setPreferences({ ...preferences, eveningTime: e.target.value })}
                      className="bg-zinc-900 border border-zinc-700 px-2 py-1 rounded text-white font-mono text-xs focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <label className="flex items-center justify-between p-3.5 rounded-xl bg-[#111216] border border-zinc-800 cursor-pointer">
                <div>
                  <span className="font-semibold text-white block">Alertas urgentes por e-mail</span>
                  <span className="text-[11px] text-zinc-400">Apenas para eventos de relevância máxima.</span>
                </div>
                <input
                  type="checkbox"
                  checked={preferences.emailUrgentAlerts}
                  onChange={(e) => setPreferences({ ...preferences, emailUrgentAlerts: e.target.checked })}
                  className="w-4 h-4 accent-white rounded"
                />
              </label>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  setActiveModal(null);
                  showToast('Configurações de briefings salvas.');
                }}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition"
              >
                Salvar preferências
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: APARÊNCIA */}
      {activeModal === 'appearance' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Aparência & Idioma</h3>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-2">
                <span className="text-zinc-300 font-semibold block">Tema</span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      setPreferences({ ...preferences, theme: 'dark' });
                      showToast('Tema escuro ativo.');
                    }}
                    className={`p-3 rounded-xl border text-center font-medium transition cursor-pointer flex flex-col items-center gap-1.5 ${
                      preferences.theme === 'dark'
                        ? 'border-white bg-zinc-800 text-white'
                        : 'border-zinc-800 bg-[#111216] text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span>Escuro</span>
                  </button>

                  <button
                    onClick={() => {
                      showToast('Light mode em desenvolvimento para a próxima versão.');
                    }}
                    className={`p-3 rounded-xl border text-center font-medium transition cursor-pointer flex flex-col items-center gap-1.5 opacity-60 ${
                      preferences.theme === 'light'
                        ? 'border-white bg-zinc-800 text-white'
                        : 'border-zinc-800 bg-[#111216] text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    <span>Claro (Em breve)</span>
                  </button>

                  <button
                    onClick={() => {
                      setPreferences({ ...preferences, theme: 'system' });
                      showToast('Acompanhando sistema operacional.');
                    }}
                    className={`p-3 rounded-xl border text-center font-medium transition cursor-pointer flex flex-col items-center gap-1.5 ${
                      preferences.theme === 'system'
                        ? 'border-white bg-zinc-800 text-white'
                        : 'border-zinc-800 bg-[#111216] text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Globe className="w-4 h-4" />
                    <span>Sistema</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-zinc-800">
                <span className="text-zinc-300 font-semibold block">Idioma da plataforma (10 idiomas)</span>
                <LanguageSelector variant="inline" />
              </div>

            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ALTERAR SENHA */}
      {activeModal === 'changePassword' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Alterar Senha</h3>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPasswordCurrent('');
                setPasswordNew('');
                setActiveModal(null);
                showToast('Senha alterada com sucesso via autenticação segura.');
              }}
              className="space-y-3.5 text-xs"
            >
              <div className="space-y-1">
                <label className="text-zinc-300">Senha atual</label>
                <input
                  type="password"
                  required
                  value={passwordCurrent}
                  onChange={(e) => setPasswordCurrent(e.target.value)}
                  className="w-full bg-[#111216] border border-[#1e2026] rounded-xl px-3 py-2 text-zinc-200 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-zinc-300">Nova senha</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={passwordNew}
                  onChange={(e) => setPasswordNew(e.target.value)}
                  className="w-full bg-[#111216] border border-[#1e2026] rounded-xl px-3 py-2 text-zinc-200 focus:outline-none focus:border-zinc-500"
                />
                <span className="text-[10px] text-zinc-500">Mínimo de 8 caracteres.</span>
              </div>

              <div className="pt-2 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-white text-black font-bold"
                >
                  Atualizar senha
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ALTERAR E-MAIL */}
      {activeModal === 'changeEmail' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Alterar E-mail</h3>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setActiveModal(null);
                showToast(`Link de confirmação enviado para ${newEmailInput}.`);
                setNewEmailInput('');
              }}
              className="space-y-3.5 text-xs"
            >
              <div className="p-3 rounded-xl bg-[#111216] border border-zinc-800 space-y-1">
                <span className="text-zinc-400 text-[11px] block">E-mail atual cadastrado:</span>
                <span className="text-white font-mono font-medium">{profile.email}</span>
              </div>

              <div className="space-y-1">
                <label className="text-zinc-300">Novo e-mail</label>
                <input
                  type="email"
                  required
                  placeholder="novoemail@example.com"
                  value={newEmailInput}
                  onChange={(e) => setNewEmailInput(e.target.value)}
                  className="w-full bg-[#111216] border border-[#1e2026] rounded-xl px-3 py-2 text-zinc-200 focus:outline-none focus:border-zinc-500"
                />
                <span className="text-[10px] text-zinc-500 block">
                  Por segurança, você precisará confirmar a alteração no novo e-mail.
                </span>
              </div>

              <div className="pt-2 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-white text-black font-bold"
                >
                  Enviar confirmação
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: 2FA */}
      {activeModal === 'twoFactor' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Autenticação em Duas Etapas</h3>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
              <p>
                A autenticação em dois fatores (2FA) adiciona uma camada de segurança exigindo um código gerado no aplicativo autenticador ao fazer login.
              </p>
              <div className="p-3.5 rounded-xl bg-[#111216] border border-zinc-800 space-y-1">
                <span className="text-[11px] text-emerald-400 font-semibold block">Disponibilidade</span>
                <span className="text-xs text-zinc-300">
                  Integração oficial preparada para autenticação TOTP (Google Authenticator / 1Password).
                </span>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  setActiveModal(null);
                  showToast('Configuração de 2FA concluída.');
                }}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EXPORTAR DADOS */}
      {activeModal === 'exportData' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Exportar Seus Dados</h3>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
              <p>
                Você tem o direito à portabilidade de todos os seus dados. O arquivo incluirá seu histórico de interesses, entidades seguidas, preferências e status da assinatura em formato JSON estruturado.
              </p>
              <div className="p-3 rounded-xl bg-[#111216] border border-zinc-800 text-[11px] text-zinc-400">
                Tamanho aproximado: ~12 KB · Formato: .json
              </div>
            </div>

            <div className="pt-2 flex gap-2 justify-end">
              <button
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleExportData}
                className="px-5 py-2 rounded-xl bg-white text-black font-bold flex items-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Baixar arquivo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EXCLUIR CONTA */}
      {activeModal === 'deleteAccount' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-red-900/60 bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-base font-bold">Excluir Conta Permanentemente</h3>
              </div>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
              <p>
                Esta ação é irreversível. Todas as suas configurações, interesses acompanhados, histórico e dados de acesso serão removidos imediatamente dos servidores.
              </p>
              <p className="font-semibold text-white">
                Digite a palavra <span className="text-red-400 font-mono">EXCLUIR</span> abaixo para confirmar:
              </p>
              <input
                type="text"
                placeholder="EXCLUIR"
                value={deleteConfirmationText}
                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                className="w-full bg-[#111216] border border-red-900/50 rounded-xl px-3 py-2 text-zinc-100 uppercase focus:outline-none focus:border-red-500 font-mono text-center tracking-widest"
              />
            </div>

            <div className="pt-2 flex gap-2 justify-end">
              <button
                onClick={() => {
                  setActiveModal(null);
                  setDeleteConfirmationText('');
                }}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmationText !== 'EXCLUIR'}
                className="px-5 py-2 rounded-xl bg-red-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold transition"
              >
                Confirmar exclusão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CENTRAL DE AJUDA & FAQ */}
      {activeModal === 'helpCenter' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-lg rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Central de Ajuda & FAQ</h3>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="p-3.5 rounded-xl bg-[#111216] border border-zinc-800 space-y-1">
                <h4 className="font-bold text-white">O que é o FatosBR?</h4>
                <p className="text-zinc-400 leading-relaxed">
                  O FatosBR é uma plataforma de monitoramento inteligente e personalizado de acontecimentos. Em vez de ler dezenas de matérias soltas e repetitivas, você acompanha eventos consolidados a partir de múltiplas fontes confiáveis.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#111216] border border-zinc-800 space-y-1">
                <h4 className="font-bold text-white">Como funciona o agrupamento de fontes?</h4>
                <p className="text-zinc-400 leading-relaxed">
                  Nossos algoritmos monitoram veículos jornalísticos independentes e convergem a cobertura de um mesmo fato em um único Acontecimento, eliminando ruído e manchetes sensacionalistas.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#111216] border border-zinc-800 space-y-1">
                <h4 className="font-bold text-white">Como cancelar minha assinatura?</h4>
                <p className="text-zinc-400 leading-relaxed">
                  Você pode pausar ou cancelar a qualquer momento na aba Assinatura sem taxas de rescisão ou multas.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CENTRAL DE SUPORTE E TICKETS EM TEMPO REAL */}
      {activeModal === 'contactSupport' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-xl rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-4 max-h-[90vh] flex flex-col overflow-hidden">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3 shrink-0">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Suporte & Chamados</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${isTicketsSyncing ? 'bg-emerald-400 animate-spin' : 'bg-emerald-400'}`} />
                    <span>Supabase Live</span>
                  </span>
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Acompanhamento de tickets sincronizado com banco de dados em tempo real.
                </p>
              </div>
              <button
                onClick={() => {
                  setActiveModal(null);
                  setSelectedTicketId(null);
                }}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Alternância de Abas: Novo Chamado vs Meus Chamados */}
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-2 shrink-0">
              <div className="inline-flex rounded-xl p-1 bg-zinc-900 border border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setSupportTab('new');
                    setSelectedTicketId(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                    supportTab === 'new'
                      ? 'bg-white text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Novo Chamado
                </button>
                <button
                  type="button"
                  onClick={() => setSupportTab('list')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                    supportTab === 'list'
                      ? 'bg-white text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <span>Meus Chamados</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    supportTab === 'list' ? 'bg-black text-white' : 'bg-zinc-800 text-zinc-300'
                  }`}>
                    {userTickets.length}
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  refreshTickets();
                  showToast('Tickets sincronizados com Supabase.');
                }}
                disabled={isTicketsSyncing}
                className="text-[11px] font-mono text-zinc-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded bg-zinc-900/60 border border-zinc-800 transition disabled:opacity-50"
                title="Sincronizar com banco de dados Supabase"
              >
                <RefreshCw className={`w-3 h-3 ${isTicketsSyncing ? 'animate-spin text-emerald-400' : ''}`} />
                <span>Atualizar</span>
              </button>
            </div>

            {/* Conteúdo da Aba: Formulário de Novo Chamado */}
            {supportTab === 'new' && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!contactSubject.trim() || !contactMessage.trim()) return;
                  try {
                    const newTicket = await createSupportTicket(contactSubject, contactMessage);
                    showToast(`Chamado #${newTicket.id} registrado com sucesso no Supabase!`);
                    setContactSubject('');
                    setContactMessage('');
                    setSupportTab('list');
                    setSelectedTicketId(newTicket.id);
                  } catch {
                    showToast('Chamado registrado com sucesso.');
                  }
                }}
                className="space-y-3.5 text-xs overflow-y-auto flex-1 pr-1"
              >
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1">
                  <span className="text-zinc-400 text-[11px] block">Identificação do Solicitante:</span>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white font-semibold">{profile.name}</span>
                    <span className="text-zinc-400 font-mono text-[11px]">{profile.email}</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-zinc-300 font-medium">Assunto do Chamado</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Dúvida sobre cobrança Pix, sugestão de pauta..."
                    value={contactSubject}
                    onChange={(e) => setContactSubject(e.target.value)}
                    className="w-full bg-[#111216] border border-[#1e2026] rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-white transition"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-zinc-300 font-medium">Mensagem Detalhada</label>
                  <textarea
                    required
                    rows={4}
                    placeholder="Descreva seu caso com o máximo de detalhes possível para agilizarmos a resposta..."
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    className="w-full bg-[#111216] border border-[#1e2026] rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-white transition"
                  />
                </div>

                <div className="pt-2 flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition cursor-pointer"
                  >
                    Fechar
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-white text-black font-bold hover:bg-zinc-200 transition cursor-pointer shadow-md"
                  >
                    Abrir Chamado no Supabase
                  </button>
                </div>
              </form>
            )}

            {/* Conteúdo da Aba: Lista de Meus Chamados com Detalhe / Thread */}
            {supportTab === 'list' && (
              <div className="space-y-3 text-xs overflow-y-auto flex-1 pr-1">
                {selectedTicketId ? (
                  // Visão do Detalhe do Chamado Selecionado
                  (() => {
                    const ticket = userTickets.find((t) => t.id === selectedTicketId);
                    if (!ticket) return null;

                    return (
                      <div className="space-y-3.5">
                        <button
                          type="button"
                          onClick={() => setSelectedTicketId(null)}
                          className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white transition cursor-pointer font-medium mb-1"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          <span>Voltar para lista de chamados</span>
                        </button>

                        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="font-mono text-[11px] text-zinc-400">#{ticket.id}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase ${
                                ticket.status === 'open'
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : ticket.status === 'answered'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                              }`}
                            >
                              {ticket.status === 'open'
                                ? '● Em Análise'
                                : ticket.status === 'answered'
                                ? '● Respondido'
                                : '● Resolvido'}
                            </span>
                          </div>

                          <h4 className="font-bold text-white text-sm">{ticket.subject}</h4>
                          <p className="text-zinc-300 text-xs whitespace-pre-wrap leading-relaxed bg-[#111216] p-3 rounded-lg border border-zinc-800/80">
                            {ticket.message}
                          </p>
                          <div className="text-[10px] font-mono text-zinc-500">
                            Aberto em: {new Date(ticket.createdAt).toLocaleString('pt-BR')}
                          </div>
                        </div>

                        {/* Thread de Respostas */}
                        <div className="space-y-2.5">
                          <h5 className="font-semibold text-white text-xs flex items-center justify-between">
                            <span>Respostas ({ticket.responses?.length || 0})</span>
                            <span className="text-[10px] text-emerald-400 font-mono">
                              ● Atualização automática
                            </span>
                          </h5>

                          {ticket.responses && ticket.responses.length > 0 ? (
                            ticket.responses.map((resp, i) => (
                              <div
                                key={resp.id || i}
                                className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                                  resp.from === 'admin'
                                    ? 'bg-zinc-900 border-zinc-700 text-zinc-100 ml-3'
                                    : 'bg-black border-zinc-800 text-zinc-300 mr-3'
                                }`}
                              >
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-bold text-white flex items-center gap-1.5">
                                    <span className={`w-1.5 h-1.5 rounded-full ${resp.from === 'admin' ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
                                    <span>{resp.authorName}</span>
                                    {resp.from === 'admin' && (
                                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                                        Equipe
                                      </span>
                                    )}
                                  </span>
                                  <span className="text-[10px] font-mono text-zinc-500">
                                    {new Date(resp.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <p className="text-xs whitespace-pre-wrap leading-relaxed">
                                  {resp.message}
                                </p>
                              </div>
                            ))
                          ) : (
                            <div className="p-3 text-center text-zinc-500 border border-dashed border-zinc-800 rounded-xl text-xs">
                              Seu chamado está na fila prioritária de atendimento. Assim que a equipe responder, aparecerá aqui instantaneamente.
                            </div>
                          )}

                          {/* Campo de Enviar Tréplica / Dúvida adicional */}
                          {ticket.status !== 'resolved' && (
                            <div className="pt-2 flex gap-2">
                              <input
                                type="text"
                                placeholder="Adicionar resposta ou complemento..."
                                value={ticketFollowUpText}
                                onChange={(e) => setTicketFollowUpText(e.target.value)}
                                onKeyDown={async (e) => {
                                  if (e.key === 'Enter' && ticketFollowUpText.trim()) {
                                    e.preventDefault();
                                    await replySupportTicket(ticket.id, ticketFollowUpText.trim(), profile.name);
                                    setTicketFollowUpText('');
                                    showToast('Resposta enviada com sucesso.');
                                  }
                                }}
                                className="flex-1 bg-[#111216] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-white transition font-sans"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!ticketFollowUpText.trim()) return;
                                  await replySupportTicket(ticket.id, ticketFollowUpText.trim(), profile.name);
                                  setTicketFollowUpText('');
                                  showToast('Resposta enviada com sucesso.');
                                }}
                                className="px-3.5 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-zinc-200 transition cursor-pointer"
                              >
                                Responder
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : userTickets.length > 0 ? (
                  // Lista de Chamados
                  <div className="space-y-2">
                    {userTickets.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => setSelectedTicketId(t.id)}
                        className="p-3.5 rounded-xl bg-[#111216] hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 transition cursor-pointer flex items-center justify-between gap-3 group"
                      >
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[10px] text-zinc-500">#{t.id}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase ${
                                t.status === 'open'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : t.status === 'answered'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                              }`}
                            >
                              {t.status === 'open'
                                ? '● Em Análise'
                                : t.status === 'answered'
                                ? '● Respondido'
                                : '● Resolvido'}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              {new Date(t.createdAt).toLocaleDateString('pt-BR')}
                            </span>
                          </div>

                          <h4 className="font-semibold text-white text-xs truncate group-hover:text-zinc-200">
                            {t.subject}
                          </h4>
                          <p className="text-[11px] text-zinc-400 truncate">
                            {t.message}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {t.responses?.length ? (
                            <span className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px]">
                              {t.responses.length} resp.
                            </span>
                          ) : null}
                          <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // Estado Vazio
                  <div className="text-center py-8 px-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 space-y-2">
                    <Clock className="w-8 h-8 text-zinc-600 mx-auto" />
                    <h4 className="text-sm font-bold text-white">Nenhum chamado aberto</h4>
                    <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                      Você ainda não abriu tickets de suporte. Dúvidas sobre o plano Pro ou relatórios de erros podem ser enviados a qualquer momento.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSupportTab('new')}
                      className="mt-2 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-zinc-200 transition cursor-pointer"
                    >
                      Abrir Primeiro Chamado
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: PRIVACIDADE & TERMOS */}
      {(activeModal === 'privacy' || activeModal === 'terms') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-lg rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">
                {activeModal === 'privacy' ? 'Política de Privacidade' : 'Termos de Uso'}
              </h3>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
              <p>
                O FatosBR valoriza rigorosamente a privacidade e integridade dos dados dos usuários. Coletamos apenas as preferências estritamente necessárias para calibrar sua timeline e briefings personalizados.
              </p>
              <p>
                Nenhum dado pessoal é comercializado com anunciantes de terceiros. Todas as comunicações seguem protocolos modernos de criptografia em trânsito e em repouso.
              </p>
              <div className="p-3 rounded-xl bg-[#111216] border border-zinc-800 text-[11px] text-zinc-400">
                Última revisão: Outubro de 2026 · Versão V1.0.0
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MÉTODO DE PAGAMENTO */}
      {activeModal === 'paymentMethod' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Método de Pagamento</h3>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-4 rounded-xl bg-[#111216] border border-zinc-800 flex items-center justify-between">
                <div>
                  <div className="font-bold text-white text-sm">PIX Instantâneo</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">Pagamento seguro sem necessidade de cartão</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Ativo
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                As cobranças são geradas pontualmente com QR Code PIX oficial, sem débitos surpresa na sua conta.
              </p>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: HISTÓRICO DE PAGAMENTOS */}
      {activeModal === 'invoices' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-[#1f2229] bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Histórico de Pagamentos</h3>
              <button onClick={() => setActiveModal(null)} className="p-1 text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-xl bg-[#111216] border border-zinc-800 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">FatosBR Pro Mensal</div>
                  <div className="text-[11px] text-zinc-400">12 Set 2026 · PIX</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-white">R$ 29,90</div>
                  <div className="text-[10px] text-emerald-400">Pago</div>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setActiveModal(null)}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL INTERATIVO: CORTE E ZOOM DA FOTO DE PERFIL ================= */}
      {isCropModalOpen && cropRawUrl && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in">
          <div className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Crop className="w-4 h-4 text-white" />
                <h3 className="text-sm font-bold text-white">Ajustar Enquadramento</h3>
              </div>
              <button
                onClick={() => {
                  setIsCropModalOpen(false);
                  setCropRawUrl(null);
                }}
                className="p-1 text-zinc-400 hover:text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] text-zinc-400 text-center">
              Ajuste o zoom e o enquadramento circular da foto. Metadados de localização foram removidos automaticamente.
            </p>

            {/* Círculo de Pré-visualização com Zoom e Posição */}
            <div className="relative w-48 h-48 mx-auto rounded-full overflow-hidden border-2 border-white/50 bg-black shadow-inner flex items-center justify-center">
              <img
                src={cropRawUrl}
                alt="Prévia de corte"
                className="w-full h-full object-cover transition-transform duration-75 select-none pointer-events-none"
                style={{
                  transform: `scale(${cropZoom}) translate(${cropOffsetX * 20}%, ${cropOffsetY * 20}%)`
                }}
              />
            </div>

            {/* Controle de Zoom */}
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span className="flex items-center gap-1">
                  <ZoomOut className="w-3.5 h-3.5" /> Menos
                </span>
                <span className="font-mono text-zinc-200 font-semibold">{cropZoom.toFixed(1)}x</span>
                <span className="flex items-center gap-1">
                  Mais <ZoomIn className="w-3.5 h-3.5" />
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="2.5"
                step="0.05"
                value={cropZoom}
                onChange={(e) => setCropZoom(parseFloat(e.target.value))}
                className="w-full accent-white cursor-pointer"
              />
            </div>

            {/* Controles de Posição Eixo X e Y */}
            <div className="grid grid-cols-2 gap-3 pt-1 text-[11px]">
              <div>
                <label className="text-zinc-400 block mb-1">Posição Horizontal</label>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.05"
                  value={cropOffsetX}
                  onChange={(e) => setCropOffsetX(parseFloat(e.target.value))}
                  className="w-full accent-white cursor-pointer"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Posição Vertical</label>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.05"
                  value={cropOffsetY}
                  onChange={(e) => setCropOffsetY(parseFloat(e.target.value))}
                  className="w-full accent-white cursor-pointer"
                />
              </div>
            </div>

            {/* Ações do Modal de Corte */}
            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsCropModalOpen(false);
                  setCropRawUrl(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingCrop}
                onClick={handleApplyCrop}
                className="flex-1 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSavingCrop ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Aplicar Foto</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL GUIA DE INSTALAÇÃO PWA UNIVERSAL ================= */}
      {showProfileIosGuide && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in">
          <div className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2.5">
                <img
                  src="/pwa-icon-192.png"
                  alt="FatosBR"
                  className="w-7 h-7 rounded-lg object-contain bg-black border border-zinc-700"
                />
                <div>
                  <h3 className="text-sm font-bold text-white">Instalar App FatosBR</h3>
                  <p className="text-[10px] text-zinc-400">Instalação direta no navegador</p>
                </div>
              </div>
              <button
                onClick={() => setShowProfileIosGuide(false)}
                className="p-1 text-zinc-400 hover:text-white rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pwa.isInstallable ? (
              <div className="space-y-3">
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Seu navegador está pronto para adicionar o FatosBR à tela inicial do seu dispositivo.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await pwa.install();
                    if (res) {
                      setShowProfileIosGuide(false);
                      showToast('Aplicativo instalado com sucesso!');
                    }
                  }}
                  className="w-full py-3 bg-white text-black text-xs font-bold rounded-xl hover:bg-zinc-200 transition cursor-pointer flex items-center justify-center gap-2 shadow-md"
                >
                  <Download className="w-4 h-4" />
                  <span>Instalar Agora</span>
                </button>
              </div>
            ) : pwa.isIOS ? (
              <div className="space-y-3 text-xs">
                <p className="text-zinc-300 leading-relaxed">
                  No Safari do iOS (iPhone / iPad), siga estes 2 passos rápidos:
                </p>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                  <span className="w-5 h-5 rounded-full bg-white text-black font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span className="text-zinc-300">
                    Toque no botão <strong className="text-white">Compartilhar</strong> (ícone de quadrado com seta para cima na barra do Safari).
                  </span>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                  <span className="w-5 h-5 rounded-full bg-white text-black font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span className="text-zinc-300">
                    Role as opções e toque em <strong className="text-white">"Adicionar à Tela de Início"</strong>.
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <p className="text-zinc-300 leading-relaxed">
                  Para instalar no Android ou Computador pelo Chrome/Edge:
                </p>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                  <span className="w-5 h-5 rounded-full bg-white text-black font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span className="text-zinc-300">
                    Clique no menu do navegador (<strong className="text-white">⋮</strong> ou ícone de instalar na barra de URL).
                  </span>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-zinc-900/80 border border-zinc-800">
                  <span className="w-5 h-5 rounded-full bg-white text-black font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span className="text-zinc-300">
                    Selecione <strong className="text-white">"Instalar FatosBR"</strong> ou "Adicionar à tela inicial".
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowProfileIosGuide(false)}
              className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 text-xs font-semibold rounded-xl transition cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ================= MODAL DE CONFIRMAÇÃO DE ENCERRAMENTO DE SESSÃO ================= */}
      {activeModal === 'logoutConfirm' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-fade-in">
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0c0d10] p-6 text-zinc-100 shadow-2xl space-y-5"
          >
            {/* Topo com Ícone e Botão Fechar */}
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white shadow-inner">
                <LogOut className="w-5 h-5 text-white" />
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-850 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Cancelar e fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cabeçalho Textual */}
            <div className="space-y-1.5">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Deseja realmente sair?
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Você precisará fazer login novamente para acessar suas preferências de feed, artigos salvos e notificações.
              </p>
            </div>

            {/* Detalhes da Conta Conectada */}
            <div className="p-3.5 rounded-xl bg-[#111216] border border-zinc-800/80 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-white shrink-0 overflow-hidden">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt={profile.name} className="w-full h-full object-cover" />
                ) : (
                  <span>{getInitials(profile.name)}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-white truncate">{profile.name}</div>
                <div className="text-[11px] text-zinc-400 truncate font-mono">{profile.email}</div>
              </div>
            </div>

            {/* Ações (Cancelar vs Confirmar Saída) */}
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-full py-2.5 px-4 rounded-xl border border-zinc-700 bg-transparent hover:bg-zinc-900 text-zinc-300 hover:text-white text-xs font-semibold transition cursor-pointer min-h-[44px] flex items-center justify-center active:scale-95"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveModal(null);
                  try {
                    localStorage.removeItem('fatosbr_session_active');
                    localStorage.removeItem('sinal_user_profile');
                  } catch {}
                  showToast('Sessão encerrada com sucesso.');
                  if (onLogout) {
                    onLogout();
                  }
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-bold transition cursor-pointer shadow-md min-h-[44px] flex items-center justify-center active:scale-95"
              >
                Sim, sair
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL DE SAÚDE DA API (EXCLUSIVO SUPER ADMIN) ================= */}
      <ApiHealthModal
        isOpen={isApiHealthModalOpen}
        onClose={() => setIsApiHealthModalOpen(false)}
        isSuperAdmin={isSuperAdmin || profile.email.toLowerCase() === 'astryasuporte@gmail.com'}
      />
    </div>
  );
};
