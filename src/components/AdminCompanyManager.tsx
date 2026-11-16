/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo } from 'react';
import {
  Building2,
  Upload,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  ExternalLink,
  Eye,
  X,
  Check,
  Image as ImageIcon,
  ShieldAlert,
  FileArchive,
  History,
  RotateCcw,
  User,
  Newspaper,
  Lock
} from 'lucide-react';
import { Entity, Source } from '../types/sinal';
import { CompanyLogoBadge } from './CompanyLogoBadge';
import {
  adminService,
  ImageImportBatchDto,
  ImageImportItemDto
} from '../services/adminService';
import { useI18n } from '../i18n';

interface AdminCompanyManagerProps {
  entities: Entity[];
  sources?: Source[];
  onUpdateEntityLogo?: (entityId: string, logoUrl: string | null) => void;
  onAddEntity?: (newEntity: Entity) => void;
  onRefreshCatalog?: () => void | Promise<void>;
  onShowToast: (msg: string) => void;
}

type CatalogFilterTab = 'COMPANY' | 'PERSON' | 'SOURCE';
type PreviewStatusFilter = 'ALL' | 'APPROVED' | 'PENDING_REVIEW' | 'UNMATCHED' | 'INVALID';

interface UploadTarget {
  id: string;
  name: string;
  targetType: 'COMPANY' | 'PERSON' | 'SOURCE';
  imageUrl?: string;
}

export const AdminCompanyManager: React.FC<AdminCompanyManagerProps> = ({
  entities,
  sources = [],
  onUpdateEntityLogo,
  onAddEntity,
  onRefreshCatalog,
  onShowToast
}) => {
  const { t } = useI18n();
  const [catalogTab, setCatalogTab] = useState<CatalogFilterTab>('COMPANY');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTargetForUpload, setSelectedTargetForUpload] = useState<UploadTarget | null>(null);
  const [isNewCompanyModalOpen, setIsNewCompanyModalOpen] = useState(false);

  // Estados do Modal de Upload Individual
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{
    width: number;
    height: number;
    hasAlpha: boolean;
    sizeKb: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Estados do Modal de Nova Empresa
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanySector, setNewCompanySector] = useState('Tecnologia');
  const [newCompanyWebsite, setNewCompanyWebsite] = useState('');
  const [newCompanyDesc, setNewCompanyDesc] = useState('');
  const [newCompanyColor, setNewCompanyColor] = useState('#3b82f6');
  const [newCompanyLogoFile, setNewCompanyLogoFile] = useState<File | null>(null);
  const [newCompanyLogoPreview, setNewCompanyLogoPreview] = useState<string | null>(null);

  // Estados do Modal de Importação em Lote via ZIP
  const [isZipModalOpen, setIsZipModalOpen] = useState(false);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [previewBatch, setPreviewBatch] = useState<ImageImportBatchDto | null>(null);
  const [selectedBatchItemIds, setSelectedBatchItemIds] = useState<Set<string>>(new Set());
  const [previewFilter, setPreviewFilter] = useState<PreviewStatusFilter>('ALL');
  const [confirmPromptOpen, setConfirmPromptOpen] = useState(false);
  const [isApplyingBatch, setIsApplyingBatch] = useState(false);
  const [isReprocessingBatch, setIsReprocessingBatch] = useState(false);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  // Estados do Histórico de Importações
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [historyBatches, setHistoryBatches] = useState<ImageImportBatchDto[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  const companies = useMemo(
    () => entities.filter((e) => e.type === 'company' || e.type === 'organization'),
    [entities]
  );
  const people = useMemo(() => entities.filter((e) => e.type === 'person'), [entities]);

  const filteredCatalog = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (catalogTab === 'COMPANY') {
      return companies.filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.sector && c.sector.toLowerCase().includes(q)) ||
          (c.slug && c.slug.toLowerCase().includes(q))
      );
    }
    if (catalogTab === 'PERSON') {
      return people.filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.role && p.role.toLowerCase().includes(q)) ||
          (p.sector && p.sector.toLowerCase().includes(q))
      );
    }
    return [];
  }, [catalogTab, companies, people, searchTerm]);

  const filteredSources = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return sources.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.domain.toLowerCase().includes(q) ||
        (s.category && s.category.toLowerCase().includes(q))
    );
  }, [sources, searchTerm]);

  const notifyCatalogUpdated = async () => {
    try {
      await onRefreshCatalog?.();
    } catch {}
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fatosbr_entities_updated'));
    }
  };

  // ==================== UPLOAD INDIVIDUAL PNG ====================
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setPreviewDataUrl(null);
    setPreviewMeta(null);

    if (!file.name.toLowerCase().endsWith('.png') || !file.type.includes('png')) {
      const err = 'Formato inválido. O logotipo/imagem individual deve ser um arquivo PNG (.png).';
      setUploadError(err);
      onShowToast(err);
      e.target.value = '';
      return;
    }

    const MAX_SIZE = 4 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      const err = `Arquivo muito grande (${(file.size / (1024 * 1024)).toFixed(2)} MB). O limite é de 4 MB.`;
      setUploadError(err);
      onShowToast(err);
      e.target.value = '';
      return;
    }

    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreviewDataUrl(dataUrl);

      const img = new Image();
      img.onload = () => {
        if (img.width < 24 || img.height < 24) {
          setUploadError(`Dimensões muito baixas (${img.width}x${img.height}px). Mínimo recomendado: 24x24px.`);
        } else if (img.width > 2048 || img.height > 2048) {
          setUploadError(`Dimensões muito altas (${img.width}x${img.height}px). Máximo permitido: 2048x2048px.`);
        }

        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(img.width, 256);
          canvas.height = Math.min(img.height, 256);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let hasTransparentPixels = false;
            for (let i = 3; i < imgData.data.length; i += 4) {
              if (imgData.data[i] < 250) {
                hasTransparentPixels = true;
                break;
              }
            }
            setPreviewMeta({
              width: img.width,
              height: img.height,
              hasAlpha: hasTransparentPixels,
              sizeKb: Math.round(file.size / 1024)
            });

            if (!hasTransparentPixels && selectedTargetForUpload?.targetType !== 'PERSON') {
              setUploadError('Aviso: Nenhum pixel transparente detectado. O design system recomenda fundo transparente.');
            }
          }
        } catch {
          setPreviewMeta({
            width: img.width,
            height: img.height,
            hasAlpha: true,
            sizeKb: Math.round(file.size / 1024)
          });
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmUpload = async () => {
    if (!selectedTargetForUpload || !selectedFile) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const res = await adminService.uploadCompanyLogo(
        selectedTargetForUpload.id,
        selectedFile,
        selectedTargetForUpload.targetType
      );
      if (res.success && res.logoUrl) {
        if (selectedTargetForUpload.targetType !== 'SOURCE') {
          onUpdateEntityLogo?.(selectedTargetForUpload.id, res.logoUrl);
        }
        await notifyCatalogUpdated();
        onShowToast(`Imagem de ${selectedTargetForUpload.name} salva no Supabase Storage!`);
        setSelectedTargetForUpload(null);
        setSelectedFile(null);
        setPreviewDataUrl(null);
      } else {
        setUploadError(res.error || 'Falha ao processar logotipo.');
        onShowToast(res.error || 'Erro no upload.');
      }
    } catch (err: any) {
      setUploadError(err.message || 'Erro de conexão.');
      onShowToast(err.message || 'Erro no upload.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveLogo = async (target: UploadTarget) => {
    if (!confirm(`Deseja remover a imagem de ${target.name} e restaurar o monograma padrão?`)) {
      return;
    }

    try {
      const ok = await adminService.removeCompanyLogo(target.id, target.targetType);
      if (!ok) {
        onShowToast(`Não foi possível remover a imagem de ${target.name}.`);
        return;
      }
      if (target.targetType !== 'SOURCE') {
        onUpdateEntityLogo?.(target.id, null);
      }
      await notifyCatalogUpdated();
      onShowToast(`Imagem de ${target.name} removida. Monograma padrão restaurado.`);
    } catch {
      onShowToast(`Erro ao remover imagem de ${target.name}.`);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) {
      onShowToast('Nome da empresa é obrigatório.');
      return;
    }

    const newId = `ent-${newCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`;
    let finalLogoUrl: string | undefined = undefined;

    if (newCompanyLogoFile) {
      const uploadRes = await adminService.uploadCompanyLogo(newId, newCompanyLogoFile, 'COMPANY');
      if (uploadRes.success && uploadRes.logoUrl) {
        finalLogoUrl = uploadRes.logoUrl;
      }
    }

    const newEntity: Entity = {
      id: newId,
      name: newCompanyName.trim(),
      type: 'company',
      sector: newCompanySector,
      website: newCompanyWebsite.trim() || undefined,
      description: newCompanyDesc.trim() || `Empresa líder no setor de ${newCompanySector}.`,
      brandColor: newCompanyColor,
      isFollowed: false,
      imageUrl: finalLogoUrl,
      logoUrl: finalLogoUrl
    };

    onAddEntity?.(newEntity);
    onShowToast(`Empresa ${newEntity.name} cadastrada com sucesso!`);

    setIsNewCompanyModalOpen(false);
    setNewCompanyName('');
    setNewCompanyWebsite('');
    setNewCompanyDesc('');
    setNewCompanyLogoFile(null);
    setNewCompanyLogoPreview(null);
  };

  // ==================== IMPORTAÇÃO EM LOTE VIA ZIP ====================
  const openZipModal = () => {
    setIsZipModalOpen(true);
    setZipFile(null);
    setZipError(null);
    setPreviewBatch(null);
    setSelectedBatchItemIds(new Set());
    setPreviewFilter('ALL');
    setConfirmPromptOpen(false);
  };

  const handleZipFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setZipError(null);
    setPreviewBatch(null);
    setConfirmPromptOpen(false);

    if (!file.name.toLowerCase().endsWith('.zip')) {
      setZipError('Arquivo inválido. Envie um pacote compactado .zip contendo manifest.json e imagens.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setZipError('O pacote ZIP excede o limite máximo de 25 MB.');
      return;
    }

    setZipFile(file);
    setIsPreviewLoading(true);
    try {
      const res = await adminService.previewImageLibraryZip(file);
      if (!res.success || !res.batch) {
        setZipError(res.error || 'Não foi possível validar o pacote ZIP.');
        return;
      }
      setPreviewBatch(res.batch);
      const approvedIds = res.batch.items
        .filter((it) => it.status === 'APPROVED' && !it.requiresBrandReview)
        .map((it) => it.id);
      setSelectedBatchItemIds(new Set(approvedIds));
    } catch (err: any) {
      setZipError(err?.message || 'Erro ao analisar o pacote ZIP.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const approvedPreviewItems = useMemo(() => {
    if (!previewBatch) return [];
    return previewBatch.items.filter(
      (it) => it.status === 'APPROVED' && !it.requiresBrandReview
    );
  }, [previewBatch]);

  const filteredPreviewItems = useMemo(() => {
    if (!previewBatch) return [];
    if (previewFilter === 'ALL') return previewBatch.items;
    return previewBatch.items.filter((it) => it.status === previewFilter);
  }, [previewBatch, previewFilter]);

  const toggleItemSelection = (item: ImageImportItemDto) => {
    if (item.status !== 'APPROVED' || item.requiresBrandReview) return;
    setSelectedBatchItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const toggleSelectAllApproved = () => {
    if (selectedBatchItemIds.size === approvedPreviewItems.length) {
      setSelectedBatchItemIds(new Set());
    } else {
      setSelectedBatchItemIds(new Set(approvedPreviewItems.map((i) => i.id)));
    }
  };

  const handleConfirmApplyBatch = async () => {
    if (!previewBatch || selectedBatchItemIds.size === 0) return;

    setIsApplyingBatch(true);
    setZipError(null);
    try {
      const res = await adminService.applyImageLibraryBatch(
        previewBatch.batchId,
        Array.from(selectedBatchItemIds)
      );
      if (!res.success || !res.batch) {
        setZipError(res.error || 'Falha ao aplicar o lote de imagens.');
        return;
      }
      setPreviewBatch(res.batch);
      setConfirmPromptOpen(false);
      await notifyCatalogUpdated();

      if (res.batch.counts.failed > 0) {
        onShowToast(
          `Importação parcial: ${res.batch.counts.applied} aplicada(s), ${res.batch.counts.failed} falha(s). Imagens anteriores preservadas.`
        );
      } else {
        onShowToast(
          `Lote concluído! ${res.batch.counts.applied} imagem(ns) salva(s) no Supabase Storage.`
        );
      }
    } catch (err: any) {
      setZipError(err?.message || 'Erro de rede ao confirmar importação.');
    } finally {
      setIsApplyingBatch(false);
    }
  };

  const handleReprocessBatch = async (batchId: string) => {
    setIsReprocessingBatch(true);
    setZipError(null);
    try {
      const res = await adminService.reprocessImageImportBatch(batchId);
      if (!res.success || !res.batch) {
        onShowToast(res.error || 'Falha ao reprocessar itens com erro.');
        return;
      }
      if (previewBatch?.batchId === batchId) {
        setPreviewBatch(res.batch);
      }
      setHistoryBatches((prev) =>
        prev.map((b) => (b.batchId === batchId ? res.batch! : b))
      );
      await notifyCatalogUpdated();
      onShowToast(
        `Reprocessamento concluído: ${res.batch.counts.applied} aplicada(s), ${res.batch.counts.failed} falha(s).`
      );
    } catch (err: any) {
      onShowToast(err?.message || 'Erro ao reprocessar lote.');
    } finally {
      setIsReprocessingBatch(false);
    }
  };

  // ==================== HISTÓRICO DE IMPORTAÇÕES ====================
  const openHistoryModal = async () => {
    setIsHistoryModalOpen(true);
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await adminService.getImageImportHistory(20);
      if (!res.success) {
        setHistoryError(res.error || 'Não foi possível carregar o histórico de importações.');
      } else {
        setHistoryBatches(res.batches);
        if (res.batches.length > 0) {
          setExpandedBatchId(res.batches[0].batchId);
        }
      }
    } catch (err: any) {
      setHistoryError(err?.message || 'Erro ao consultar histórico.');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const renderItemStatusBadge = (item: ImageImportItemDto) => {
    switch (item.status) {
      case 'APPROVED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            Aprovada
          </span>
        );
      case 'APPLIED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            Aplicada no Supabase
          </span>
        );
      case 'PENDING_REVIEW':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
            <Lock className="w-2.5 h-2.5" />
            Revisão de marca (Bloqueada)
          </span>
        );
      case 'UNMATCHED':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-zinc-700">
            Sem correspondência
          </span>
        );
      case 'FAILED':
      case 'INVALID':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-500/15 text-red-400 border border-red-500/30">
            {item.status === 'FAILED' ? 'Falha' : 'Inválida'}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-zinc-700">
            Ignorada
          </span>
        );
    }
  };

  const renderTargetTypeBadge = (targetType: 'COMPANY' | 'PERSON' | 'SOURCE') => {
    if (targetType === 'PERSON') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-purple-500/15 text-purple-300 border border-purple-500/30 inline-flex items-center gap-1">
          <User className="w-2.5 h-2.5" />
          Pessoa
        </span>
      );
    }
    if (targetType === 'SOURCE') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-blue-500/15 text-blue-300 border border-blue-500/30 inline-flex items-center gap-1">
          <Newspaper className="w-2.5 h-2.5" />
          Fonte
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
        <Building2 className="w-2.5 h-2.5" />
        Empresa
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header do Módulo de Empresas & Biblioteca de Imagens */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{t('admin.companies')}</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {t('admin.companiesSubtitle')} · Persistência oficial no Supabase Storage
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openHistoryModal}
              className="px-3 py-2 rounded-xl bg-[#0a0e17] hover:bg-zinc-800 border border-[#1f2942] text-zinc-200 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition"
            >
              <History className="w-3.5 h-3.5 text-zinc-400" />
              <span>Histórico de Importações</span>
            </button>

            <button
              type="button"
              onClick={openZipModal}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-xs flex items-center gap-2 cursor-pointer transition shadow-sm"
            >
              <FileArchive className="w-4 h-4" />
              <span>Importar pacote ZIP</span>
            </button>

            <button
              type="button"
              onClick={() => setIsNewCompanyModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Nova Empresa</span>
            </button>
          </div>
        </div>

        {/* Sub-abas da Biblioteca: Empresas (padrão) / Pessoas / Fontes */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 bg-[#0a0e17] p-1 rounded-xl border border-[#182136]">
            <button
              type="button"
              onClick={() => setCatalogTab('COMPANY')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                catalogTab === 'COMPANY'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Empresas ({companies.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setCatalogTab('PERSON')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                catalogTab === 'PERSON'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Pessoas ({people.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setCatalogTab('SOURCE')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                catalogTab === 'SOURCE'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Newspaper className="w-3.5 h-3.5" />
              <span>Fontes ({sources.length})</span>
            </button>
          </div>

          <div className="flex-1 min-w-[220px]">
            <input
              type="text"
              placeholder={
                catalogTab === 'SOURCE'
                  ? 'Buscar fonte por nome ou domínio...'
                  : catalogTab === 'PERSON'
                  ? 'Buscar pessoa por nome ou cargo...'
                  : 'Buscar empresa por nome ou setor...'
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#0a0e17] border border-[#182136] focus:border-zinc-600 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Grade de Empresas ou Pessoas */}
        {catalogTab !== 'SOURCE' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
            {filteredCatalog.map((entity) => {
              const resolvedUrl = entity.imageUrl || entity.logoUrl || entity.avatarUrl;
              const hasCustomLogo = Boolean(resolvedUrl);
              const targetType: 'COMPANY' | 'PERSON' =
                entity.type === 'person' ? 'PERSON' : 'COMPANY';

              return (
                <div
                  key={entity.id}
                  className="p-4 rounded-xl bg-[#0a0e17] border border-[#182136] hover:border-zinc-700 transition flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-[linear-gradient(45deg,#1f2937_25%,transparent_25%),linear-gradient(-45deg,#1f2937_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1f2937_75%),linear-gradient(-45deg,transparent_75%,#1f2937_75%)] bg-[size:10px_10px] bg-[#111827] border border-zinc-700/80 flex items-center justify-center p-1 shrink-0 overflow-hidden shadow-inner">
                        <CompanyLogoBadge
                          name={entity.name}
                          type={entity.type}
                          brandColor={entity.brandColor}
                          imageUrl={entity.imageUrl}
                          logoUrl={entity.logoUrl || entity.avatarUrl}
                          website={entity.website}
                          size="md"
                        />
                      </div>

                      <div className="min-w-0">
                        <h4 className="font-bold text-white text-xs truncate leading-tight">
                          {entity.name}
                        </h4>
                        <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                          {entity.role || entity.sector || (targetType === 'PERSON' ? 'Personalidade' : 'Corporativo')}
                        </p>
                        {entity.website && (
                          <a
                            href={entity.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-blue-400 hover:text-blue-300 font-mono truncate flex items-center gap-1 mt-0.5"
                          >
                            <span>{entity.website.replace(/^https?:\/\//, '')}</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>

                    <span
                      className={`text-[9px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                        hasCustomLogo
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}
                    >
                      {hasCustomLogo ? 'Storage OK' : 'Monograma'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#141b2c] text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTargetForUpload({
                          id: entity.id,
                          name: entity.name,
                          targetType,
                          imageUrl: resolvedUrl
                        });
                        setSelectedFile(null);
                        setPreviewDataUrl(null);
                        setPreviewMeta(null);
                        setUploadError(null);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Upload className="w-3 h-3 text-emerald-400" />
                      <span>{hasCustomLogo ? 'Substituir' : 'Upload PNG'}</span>
                    </button>

                    {hasCustomLogo && (
                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveLogo({
                            id: entity.id,
                            name: entity.name,
                            targetType,
                            imageUrl: resolvedUrl
                          })
                        }
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition cursor-pointer"
                        title="Remover imagem e usar padrão"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Grade de Fontes de Notícia */}
        {catalogTab === 'SOURCE' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
            {filteredSources.map((src) => {
              const hasCustomLogo = Boolean(src.logoUrl);
              return (
                <div
                  key={src.id}
                  className="p-4 rounded-xl bg-[#0a0e17] border border-[#182136] hover:border-zinc-700 transition flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-[#111827] border border-zinc-700/80 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                        <CompanyLogoBadge
                          name={src.name}
                          type="source"
                          brandColor={src.brandColor}
                          logoUrl={src.logoUrl}
                          domain={src.domain}
                          size="md"
                        />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-white text-xs truncate leading-tight">
                          {src.name}
                        </h4>
                        <p className="text-[11px] text-zinc-400 font-mono truncate mt-0.5">
                          {src.domain}
                        </p>
                        <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                          {src.category}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`text-[9px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                        hasCustomLogo
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}
                    >
                      {hasCustomLogo ? 'Storage OK' : 'Monograma'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#141b2c] text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTargetForUpload({
                          id: src.id,
                          name: src.name,
                          targetType: 'SOURCE',
                          imageUrl: src.logoUrl
                        });
                        setSelectedFile(null);
                        setPreviewDataUrl(null);
                        setPreviewMeta(null);
                        setUploadError(null);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Upload className="w-3 h-3 text-emerald-400" />
                      <span>{hasCustomLogo ? 'Substituir' : 'Upload PNG'}</span>
                    </button>

                    {hasCustomLogo && (
                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveLogo({
                            id: src.id,
                            name: src.name,
                            targetType: 'SOURCE',
                            imageUrl: src.logoUrl
                          })
                        }
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition cursor-pointer"
                        title="Remover logotipo da fonte"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ================= MODAL 1: UPLOAD INDIVIDUAL PNG ================= */}
      {selectedTargetForUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-[#0e1320] border border-zinc-700 p-5 sm:p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#182136]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Upload Individual: {selectedTargetForUpload.name}
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    PNG • Máximo 4 MB • Persistência direta no Supabase Storage
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTargetForUpload(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-zinc-700 hover:border-emerald-500/60 rounded-xl p-6 text-center cursor-pointer transition bg-[#0a0e17]/80 hover:bg-[#0c121e] group"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-zinc-800 group-hover:bg-emerald-500/20 text-zinc-400 group-hover:text-emerald-400 flex items-center justify-center transition">
                  <ImageIcon className="w-5 h-5" />
                </div>
                <div className="text-xs font-semibold text-white">
                  {selectedFile ? selectedFile.name : 'Clique para selecionar um arquivo PNG'}
                </div>
                <div className="text-[10px] text-zinc-500">
                  Resolução sugerida: 128x128px a 512x512px • Formato PNG obrigatório
                </div>
              </div>
            </div>

            {previewDataUrl && (
              <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-blue-400" />
                    <span>Pré-visualização</span>
                  </span>
                  {previewMeta && (
                    <span className="text-[10px] font-mono text-zinc-400">
                      {previewMeta.width}x{previewMeta.height}px • {previewMeta.sizeKb} KB
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-center p-6 rounded-lg bg-[linear-gradient(45deg,#1e293b_25%,transparent_25%),linear-gradient(-45deg,#1e293b_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1e293b_75%),linear-gradient(-45deg,transparent_75%,#1e293b_75%)] bg-[size:12px_12px] bg-[#0f172a] border border-zinc-700 shadow-inner">
                  <img
                    src={previewDataUrl}
                    alt="Preview"
                    className="max-h-24 max-w-full object-contain filter drop-shadow-md"
                  />
                </div>

                {previewMeta && (
                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-zinc-800/80">
                    <span className="text-zinc-400">Canal Alfa / Fundo Transparente:</span>
                    <span className={`font-semibold flex items-center gap-1 ${previewMeta.hasAlpha ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {previewMeta.hasAlpha ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" /> Transparente Confirmado
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-3 h-3" /> Fundo Opaco Detectado
                        </>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            {uploadError && (
              <div className="p-3 rounded-xl bg-red-950/30 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#182136]">
              <button
                type="button"
                onClick={() => setSelectedTargetForUpload(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer transition"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={!selectedFile || isUploading}
                onClick={handleConfirmUpload}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition shadow-md"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Validando e Salvando...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Salvar no Supabase</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 2: CADASTRAR NOVA EMPRESA ================= */}
      {isNewCompanyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <form
            onSubmit={handleCreateCompany}
            className="w-full max-w-md rounded-2xl bg-[#0e1320] border border-zinc-700 p-5 sm:p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#182136]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-400" />
                <span>Cadastrar Nova Empresa</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsNewCompanyModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1 font-semibold">Nome da Empresa</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Nubank, Embraer, B3..."
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="w-full bg-[#0a0e17] border border-[#182136] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-zinc-400 mb-1 font-semibold">Setor</label>
                  <select
                    value={newCompanySector}
                    onChange={(e) => setNewCompanySector(e.target.value)}
                    className="w-full bg-[#0a0e17] border border-[#182136] rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="Tecnologia">Tecnologia</option>
                    <option value="Financeiro">Financeiro / Fintech</option>
                    <option value="Energia">Energia & Petróleo</option>
                    <option value="Mineração">Mineração</option>
                    <option value="Agronegócio">Agronegócio</option>
                    <option value="Automotivo">Automotivo</option>
                    <option value="Aviação">Aviação / Defesa</option>
                    <option value="Varejo">Varejo & E-commerce</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-400 mb-1 font-semibold">Cor da Marca</label>
                  <input
                    type="color"
                    value={newCompanyColor}
                    onChange={(e) => setNewCompanyColor(e.target.value)}
                    className="w-full h-9 bg-[#0a0e17] border border-[#182136] rounded-xl p-1 cursor-pointer"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1 font-semibold">Website Oficial</label>
                <input
                  type="url"
                  placeholder="https://exemplo.com.br"
                  value={newCompanyWebsite}
                  onChange={(e) => setNewCompanyWebsite(e.target.value)}
                  className="w-full bg-[#0a0e17] border border-[#182136] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-zinc-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1 font-semibold">Logotipo Inicial (PNG transparente - Opcional)</label>
                <input
                  type="file"
                  accept="image/png"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setNewCompanyLogoFile(file);
                      const r = new FileReader();
                      r.onload = () => setNewCompanyLogoPreview(r.result as string);
                      r.readAsDataURL(file);
                    }
                  }}
                  className="w-full text-zinc-400 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-white hover:file:bg-zinc-700"
                />
                {newCompanyLogoPreview && (
                  <div className="mt-2 p-2 rounded-lg bg-[linear-gradient(45deg,#1f2937_25%,transparent_25%),linear-gradient(-45deg,#1f2937_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1f2937_75%),linear-gradient(-45deg,transparent_75%,#1f2937_75%)] bg-[size:8px_8px] bg-[#111827] flex items-center justify-center">
                    <img src={newCompanyLogoPreview} alt="Preview" className="max-h-12 object-contain" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-[#182136]">
              <button
                type="button"
                onClick={() => setIsNewCompanyModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
              >
                Cadastrar Empresa
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================= MODAL 3: IMPORTAR PACOTE ZIP (BIBLIOTECA DE IMAGENS) ================= */}
      {isZipModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-4xl max-h-[92vh] rounded-2xl bg-[#0e1320] border border-zinc-700 flex flex-col shadow-2xl overflow-hidden">
            {/* Cabeçalho */}
            <div className="p-4 sm:p-5 border-b border-[#182136] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-white/10 border border-white/15 text-white">
                  <FileArchive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Importar pacote ZIP — Biblioteca de Imagens
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Empresas, Pessoas e Fontes via <code className="text-zinc-300">manifest.json</code> · Storage permanente Supabase
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsZipModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Corpo Rolável */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Dropzone para Upload do ZIP */}
              <div
                onClick={() => !isPreviewLoading && !isApplyingBatch && zipInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (isPreviewLoading || isApplyingBatch) return;
                  const f = e.dataTransfer.files?.[0];
                  void handleZipFileSelected(f);
                }}
                className="border-2 border-dashed border-zinc-700 hover:border-white/50 rounded-xl p-5 text-center cursor-pointer transition bg-[#0a0e17]/80"
              >
                <input
                  ref={zipInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    void handleZipFileSelected(f);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-1.5">
                  {isPreviewLoading ? (
                    <>
                      <RefreshCw className="w-6 h-6 text-white animate-spin" />
                      <span className="text-xs font-bold text-white">
                        Validando ZIP, MIME real, manifest.json e correspondências...
                      </span>
                    </>
                  ) : (
                    <>
                      <FileArchive className="w-6 h-6 text-zinc-300" />
                      <span className="text-xs font-bold text-white">
                        {zipFile
                          ? `Pacote selecionado: ${zipFile.name} (${(zipFile.size / 1024).toFixed(0)} KB)`
                          : 'Clique ou arraste um pacote .zip (máx. 25 MB)'}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        Suporta PNG, JPEG, WebP e SVG seguro · Proteção contra zip bombs, MIME falso e path traversal
                      </span>
                    </>
                  )}
                </div>
              </div>

              {zipError && (
                <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/40 text-red-300 text-xs flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{zipError}</span>
                </div>
              )}

              {/* Pré-visualização e Contadores */}
              {previewBatch && (
                <div className="space-y-4">
                  {/* Cards de Resumo */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 rounded-xl bg-[#0a0e17] border border-[#182136]">
                      <div className="text-[10px] font-mono uppercase text-zinc-400">Encontradas</div>
                      <div className="text-lg font-bold text-white font-mono mt-0.5">
                        {previewBatch.counts.totalFound}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30">
                      <div className="text-[10px] font-mono uppercase text-emerald-400">Aprovadas</div>
                      <div className="text-lg font-bold text-emerald-300 font-mono mt-0.5">
                        {previewBatch.counts.approved}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#0a0e17] border border-zinc-700/70">
                      <div className="text-[10px] font-mono uppercase text-zinc-400">Sem correspondência</div>
                      <div className="text-lg font-bold text-zinc-200 font-mono mt-0.5">
                        {previewBatch.counts.unmatched}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30">
                      <div className="text-[10px] font-mono uppercase text-amber-400">Pendentes revisão</div>
                      <div className="text-lg font-bold text-amber-300 font-mono mt-0.5">
                        {previewBatch.counts.pendingReview}
                      </div>
                    </div>
                  </div>

                  {/* Alerta obrigatório para requires_brand_review */}
                  {previewBatch.counts.pendingReview > 0 && (
                    <div className="p-3 rounded-xl bg-amber-950/25 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5">
                      <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Bloqueio automático de revisão de marca: </span>
                        {previewBatch.counts.pendingReview} arquivo(s) classificado(s) como{' '}
                        <code className="px-1 py-0.5 rounded bg-black/40 text-amber-300">requires_brand_review</code>{' '}
                        não serão importados automaticamente e aguardam validação manual.
                      </div>
                    </div>
                  )}

                  {/* Relatório de resultados pós-aplicação / falhas */}
                  {(previewBatch.status === 'COMPLETED' ||
                    previewBatch.status === 'PARTIAL_FAILURE' ||
                    previewBatch.status === 'FAILED') && (
                    <div
                      className={`p-3.5 rounded-xl border text-xs space-y-2 ${
                        previewBatch.counts.failed > 0
                          ? 'bg-amber-950/25 border-amber-500/40 text-amber-200'
                          : 'bg-emerald-950/25 border-emerald-500/40 text-emerald-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold">
                          Resultado do Lote: {previewBatch.counts.applied} aplicada(s) ·{' '}
                          {previewBatch.counts.failed} falha(s) · {previewBatch.counts.skipped} ignorada(s)
                        </span>
                        {previewBatch.counts.failed > 0 && (
                          <button
                            type="button"
                            disabled={isReprocessingBatch}
                            onClick={() => handleReprocessBatch(previewBatch.batchId)}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${isReprocessingBatch ? 'animate-spin' : ''}`} />
                            <span>{isReprocessingBatch ? 'Reprocessando...' : 'Reprocessar falhas'}</span>
                          </button>
                        )}
                      </div>
                      {previewBatch.errorReport.length > 0 && (
                        <div className="space-y-1 pt-1 border-t border-white/10 font-mono text-[11px]">
                          {previewBatch.errorReport.map((err, idx) => (
                            <div key={`${err.itemId}-${idx}`} className="text-red-300">
                              • [{err.targetType}] {err.targetName} ({err.zipEntryPath}): {err.error}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Filtros da lista de pré-visualização */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { id: 'ALL', label: `Todos (${previewBatch.items.length})` },
                          { id: 'APPROVED', label: `Aprovadas (${previewBatch.counts.approved})` },
                          { id: 'PENDING_REVIEW', label: `Pendentes (${previewBatch.counts.pendingReview})` },
                          { id: 'UNMATCHED', label: `Sem match (${previewBatch.counts.unmatched})` },
                          { id: 'INVALID', label: `Inválidas (${previewBatch.counts.invalid})` }
                        ] as { id: PreviewStatusFilter; label: string }[]
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setPreviewFilter(tab.id)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition ${
                            previewFilter === tab.id
                              ? 'bg-zinc-700 text-white'
                              : 'bg-[#0a0e17] text-zinc-400 hover:text-white border border-[#182136]'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {previewBatch.status === 'PREVIEW' && approvedPreviewItems.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleSelectAllApproved}
                        className="text-[11px] font-semibold text-zinc-300 hover:text-white underline cursor-pointer"
                      >
                        {selectedBatchItemIds.size === approvedPreviewItems.length
                          ? 'Desmarcar aprovadas'
                          : `Selecionar todas aprovadas (${approvedPreviewItems.length})`}
                      </button>
                    )}
                  </div>

                  {/* Tabela / Lista de Itens do ZIP */}
                  <div className="space-y-2 max-h-[34vh] overflow-y-auto pr-1">
                    {filteredPreviewItems.map((item) => {
                      const canSelect =
                        previewBatch.status === 'PREVIEW' &&
                        item.status === 'APPROVED' &&
                        !item.requiresBrandReview;
                      const isChecked = selectedBatchItemIds.has(item.id);
                      const imgPreviewSrc = item.publicImageUrl || item.previewDataUrl;

                      return (
                        <div
                          key={item.id}
                          onClick={() => canSelect && toggleItemSelection(item)}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition ${
                            canSelect ? 'cursor-pointer' : 'opacity-85'
                          } ${
                            isChecked
                              ? 'bg-[#121a2d] border-emerald-500/40'
                              : 'bg-[#0a0e17] border-[#182136]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {previewBatch.status === 'PREVIEW' && (
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!canSelect}
                                onChange={() => toggleItemSelection(item)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-4 h-4 accent-emerald-500 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                              />
                            )}

                            <div className="w-10 h-10 rounded-lg bg-[#111827] border border-zinc-700 flex items-center justify-center shrink-0 overflow-hidden p-1">
                              {imgPreviewSrc ? (
                                <img
                                  src={imgPreviewSrc}
                                  alt={item.targetName}
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <ImageIcon className="w-4 h-4 text-zinc-500" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {renderTargetTypeBadge(item.targetType)}
                                <span className="text-xs font-bold text-white truncate">
                                  {item.targetName}
                                </span>
                                {(item.targetDomain || item.targetSlug) && (
                                  <span className="text-[10px] font-mono text-zinc-400 truncate">
                                    · {item.targetDomain || item.targetSlug}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-mono text-zinc-500 truncate mt-0.5">
                                {item.zipEntryPath} · {item.mimeType || 'arquivo'} ·{' '}
                                {(item.byteSize / 1024).toFixed(1)} KB
                              </div>
                              {item.errorMessage && (
                                <div className="text-[10px] text-amber-300 mt-0.5">
                                  {item.errorMessage}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0">{renderItemStatusBadge(item)}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Confirmação Explícita antes de Aplicar */}
                  {confirmPromptOpen && previewBatch.status === 'PREVIEW' && (
                    <div className="p-4 rounded-xl bg-emerald-950/25 border border-emerald-500/40 space-y-3">
                      <div className="text-xs text-emerald-100">
                        <strong className="block text-sm text-white mb-1">
                          Confirmar importação permanente no Supabase?
                        </strong>
                        Serão gravadas <strong>{selectedBatchItemIds.size}</strong> imagem(ns) aprovada(s) no bucket{' '}
                        <code className="px-1 py-0.5 rounded bg-black/40">brand-assets</code> e atualizados os registros em{' '}
                        <code className="px-1 py-0.5 rounded bg-black/40">entities.image_url</code> /{' '}
                        <code className="px-1 py-0.5 rounded bg-black/40">news_sources.logo_url</code>. Imagens anteriores serão preservadas em caso de falha.
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={isApplyingBatch}
                          onClick={() => setConfirmPromptOpen(false)}
                          className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold cursor-pointer"
                        >
                          Voltar à pré-visualização
                        </button>
                        <button
                          type="button"
                          disabled={isApplyingBatch}
                          onClick={handleConfirmApplyBatch}
                          className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {isApplyingBatch ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Aplicando no Supabase...</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Confirmar e Aplicar Lote</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Rodapé do Modal ZIP */}
            <div className="p-4 sm:p-5 border-t border-[#182136] flex items-center justify-between gap-3 shrink-0 bg-[#0a0e17]">
              <span className="text-[11px] text-zinc-500 font-mono">
                {previewBatch
                  ? `Lote ${previewBatch.batchId.slice(0, 8)} · Status: ${previewBatch.status}`
                  : 'Nenhum pacote analisado ainda'}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsZipModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold cursor-pointer"
                >
                  Fechar
                </button>

                {previewBatch && previewBatch.status === 'PREVIEW' && !confirmPromptOpen && (
                  <button
                    type="button"
                    disabled={selectedBatchItemIds.size === 0 || isApplyingBatch}
                    onClick={() => setConfirmPromptOpen(true)}
                    className="px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 disabled:opacity-40 text-black font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Aplicar Lote ({selectedBatchItemIds.size} aprovadas)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 4: HISTÓRICO DE IMPORTAÇÕES & REPROCESSAMENTO ================= */}
      {isHistoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl bg-[#0e1320] border border-zinc-700 flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[#182136] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <History className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Histórico de Importações ZIP
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Auditoria de lotes, relatório de erros e reprocessamento de falhas
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
              {isLoadingHistory ? (
                <div className="py-10 text-center text-xs text-zinc-400 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Carregando histórico no Supabase...</span>
                </div>
              ) : historyError ? (
                <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/40 text-red-300 text-xs">
                  {historyError}
                </div>
              ) : historyBatches.length === 0 ? (
                <div className="py-10 text-center text-xs text-zinc-400">
                  Nenhuma importação ZIP registrada até o momento.
                </div>
              ) : (
                historyBatches.map((batch) => {
                  const isExpanded = expandedBatchId === batch.batchId;
                  const canReprocess =
                    batch.counts.failed > 0 ||
                    batch.status === 'PARTIAL_FAILURE' ||
                    batch.status === 'FAILED';

                  return (
                    <div
                      key={batch.batchId}
                      className="rounded-xl bg-[#0a0e17] border border-[#182136] overflow-hidden"
                    >
                      <div
                        onClick={() =>
                          setExpandedBatchId(isExpanded ? null : batch.batchId)
                        }
                        className="p-3.5 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-[#0e1524] transition"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white flex items-center gap-2">
                            <FileArchive className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            <span className="truncate">{batch.fileName}</span>
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
                            {new Date(batch.createdAt).toLocaleString('pt-BR')} ·{' '}
                            {batch.uploadedByEmail || 'Admin'}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-zinc-300">
                            {batch.counts.applied} aplicadas · {batch.counts.failed} falhas ·{' '}
                            {batch.counts.pendingReview} revisão
                          </span>
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                              batch.status === 'COMPLETED'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : batch.status === 'PARTIAL_FAILURE' || batch.status === 'FAILED'
                                ? 'bg-red-500/15 text-red-400 border-red-500/30'
                                : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                            }`}
                          >
                            {batch.status}
                          </span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-3.5 pb-3.5 pt-2 border-t border-[#182136] space-y-2.5 text-xs">
                          {canReprocess && (
                            <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-amber-950/20 border border-amber-500/30">
                              <span className="text-[11px] text-amber-200">
                                Existem itens com falha que podem ser reprocessados sem alterar registros já aplicados.
                              </span>
                              <button
                                type="button"
                                disabled={isReprocessingBatch}
                                onClick={() => handleReprocessBatch(batch.batchId)}
                                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-[11px] flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
                              >
                                <RotateCcw className={`w-3 h-3 ${isReprocessingBatch ? 'animate-spin' : ''}`} />
                                <span>Reprocessar falhas</span>
                              </button>
                            </div>
                          )}

                          {batch.errorReport.length > 0 && (
                            <div className="p-2.5 rounded-lg bg-red-950/20 border border-red-500/30 space-y-1 font-mono text-[10px] text-red-300">
                              <div className="font-bold text-red-200">Relatório de Erros:</div>
                              {batch.errorReport.map((err, i) => (
                                <div key={`${err.itemId}-${i}`}>
                                  • [{err.targetType}] {err.targetName} ({err.zipEntryPath}): {err.error}
                                </div>
                              ))}
                            </div>
                          )}

                          {batch.items && batch.items.length > 0 && (
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {batch.items.map((it) => (
                                <div
                                  key={it.id}
                                  className="flex items-center justify-between gap-2 py-1 border-b border-zinc-800/60 last:border-0 text-[11px]"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    {renderTargetTypeBadge(it.targetType)}
                                    <span className="text-zinc-200 truncate">{it.targetName}</span>
                                    <span className="text-zinc-500 font-mono text-[10px] truncate">
                                      ({it.zipEntryPath})
                                    </span>
                                  </div>
                                  {renderItemStatusBadge(it)}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
