/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
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
  Sparkles,
  ShieldAlert
} from 'lucide-react';
import { Entity } from '../types/sinal';
import { CompanyLogoBadge } from './CompanyLogoBadge';
import { adminService } from '../services/adminService';
import { useI18n } from '../i18n';

interface AdminCompanyManagerProps {
  entities: Entity[];
  onUpdateEntityLogo?: (entityId: string, logoUrl: string | null) => void;
  onAddEntity?: (newEntity: Entity) => void;
  onShowToast: (msg: string) => void;
}

export const AdminCompanyManager: React.FC<AdminCompanyManagerProps> = ({
  entities,
  onUpdateEntityLogo,
  onAddEntity,
  onShowToast
}) => {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntityForUpload, setSelectedEntityForUpload] = useState<Entity | null>(null);
  const [isNewCompanyModalOpen, setIsNewCompanyModalOpen] = useState(false);

  // Estados do Modal de Upload
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

  // Filtra apenas empresas
  const companies = entities.filter((e) => e.type === 'company');
  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.sector && c.sector.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Validação e pré-visualização de PNG com transparência
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setPreviewDataUrl(null);
    setPreviewMeta(null);

    // 1. Validação estrita de extensão e MIME
    if (!file.name.toLowerCase().endsWith('.png') || !file.type.includes('png')) {
      const err = 'Formato inválido. O logotipo deve ser obrigatoriamente um arquivo PNG (.png).';
      setUploadError(err);
      onShowToast(err);
      e.target.value = '';
      return;
    }

    // 2. Validação de tamanho (máximo 4 MB)
    const MAX_SIZE = 4 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      const err = `Arquivo muito grande (${(file.size / (1024 * 1024)).toFixed(2)} MB). O limite é de 4 MB.`;
      setUploadError(err);
      onShowToast(err);
      e.target.value = '';
      return;
    }

    setSelectedFile(file);

    // 3. Leitura e inspeção das dimensões e transparência no navegador
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreviewDataUrl(dataUrl);

      const img = new Image();
      img.onload = () => {
        // Validação de dimensões
        if (img.width < 24 || img.height < 24) {
          setUploadError(`Dimensões muito baixas (${img.width}x${img.height}px). Mínimo recomendado: 24x24px.`);
        } else if (img.width > 2048 || img.height > 2048) {
          setUploadError(`Dimensões muito altas (${img.width}x${img.height}px). Máximo permitido: 2048x2048px.`);
        }

        // Checagem visual do canvas para detectar se há pixels com canal alfa transparente
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

            if (!hasTransparentPixels) {
              setUploadError('Aviso: Nenhum pixel transparente detectado. O design system requer fundo transparente.');
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

  // Confirmar Upload de Logotipo
  const handleConfirmUpload = async () => {
    if (!selectedEntityForUpload || !selectedFile) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const res = await adminService.uploadCompanyLogo(selectedEntityForUpload.id, selectedFile);
      if (res.success && res.logoUrl) {
        onUpdateEntityLogo?.(selectedEntityForUpload.id, res.logoUrl);
        onShowToast(`Logotipo de ${selectedEntityForUpload.name} atualizado com sucesso!`);
        setSelectedEntityForUpload(null);
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

  // Remover logotipo
  const handleRemoveLogo = async (company: Entity) => {
    if (!confirm(`Deseja remover o logotipo de ${company.name} e restaurar o monograma padrão?`)) {
      return;
    }

    try {
      await adminService.removeCompanyLogo(company.id);
      onUpdateEntityLogo?.(company.id, null);
      onShowToast(`Logotipo de ${company.name} removido. Monograma padrão restaurado.`);
    } catch {
      onShowToast(`Erro ao remover logotipo de ${company.name}.`);
    }
  };

  // Cadastrar nova empresa
  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) {
      onShowToast('Nome da empresa é obrigatório.');
      return;
    }

    const newId = `ent-${newCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`;
    let finalLogoUrl: string | undefined = undefined;

    if (newCompanyLogoFile) {
      const uploadRes = await adminService.uploadCompanyLogo(newId, newCompanyLogoFile);
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

  return (
    <div className="space-y-6">
      {/* Header do Módulo de Empresas */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#0e1320] border border-[#182136] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#182136]">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{t('admin.companies')}</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {t('admin.companiesSubtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsNewCompanyModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Nova Empresa</span>
            </button>
          </div>
        </div>

        {/* Barra de Busca e Filtros */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Buscar empresa por nome ou setor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#0a0e17] border border-[#182136] focus:border-zinc-600 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
            />
          </div>
          <span className="text-xs text-zinc-500 font-mono">
            {filteredCompanies.length} de {companies.length} empresas
          </span>
        </div>

        {/* Grade de Empresas Cadastradas */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
          {filteredCompanies.map((company) => {
            const hasCustomLogo = Boolean(company.logoUrl);

            return (
              <div
                key={company.id}
                className="p-4 rounded-xl bg-[#0a0e17] border border-[#182136] hover:border-zinc-700 transition flex flex-col justify-between space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Checkerboard container para preview visual de transparência */}
                    <div className="w-12 h-12 rounded-xl bg-[linear-gradient(45deg,#1f2937_25%,transparent_25%),linear-gradient(-45deg,#1f2937_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1f2937_75%),linear-gradient(-45deg,transparent_75%,#1f2937_75%)] bg-[size:10px_10px] bg-[#111827] border border-zinc-700/80 flex items-center justify-center p-1 shrink-0 overflow-hidden shadow-inner">
                      <CompanyLogoBadge
                        name={company.name}
                        brandColor={company.brandColor}
                        logoUrl={company.logoUrl}
                        size="md"
                      />
                    </div>

                    <div className="min-w-0">
                      <h4 className="font-bold text-white text-xs truncate leading-tight">
                        {company.name}
                      </h4>
                      <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                        {company.sector || 'Corporativo'}
                      </p>
                      {company.website && (
                        <a
                          href={company.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-400 hover:text-blue-300 font-mono truncate flex items-center gap-1 mt-0.5"
                        >
                          <span>{company.website.replace(/^https?:\/\//, '')}</span>
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
                    {hasCustomLogo ? 'PNG Custom' : 'Monograma'}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#141b2c] text-xs">
                  <button
                    onClick={() => {
                      setSelectedEntityForUpload(company);
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
                      onClick={() => handleRemoveLogo(company)}
                      className="p-1.5 rounded-lg hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition cursor-pointer"
                      title="Remover logotipo e usar padrão"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ================= MODAL 1: UPLOAD / SUBSTITUIÇÃO DE LOGOTIPO ================= */}
      {selectedEntityForUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-[#0e1320] border border-zinc-700 p-5 sm:p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#182136]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Upload de Logotipo: {selectedEntityForUpload.name}
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    PNG com transparência • Máximo 4 MB
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedEntityForUpload(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dropzone do arquivo */}
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
                  {selectedFile ? selectedFile.name : 'Clique ou arraste um arquivo PNG com transparência'}
                </div>
                <div className="text-[10px] text-zinc-500">
                  Resolução sugerida: 128x128px a 512x512px • Formato PNG obrigatório
                </div>
              </div>
            </div>

            {/* Checkerboard de Pré-visualização da Transparência */}
            {previewDataUrl && (
              <div className="p-3.5 rounded-xl bg-[#0a0e17] border border-[#182136] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-blue-400" />
                    <span>Pré-visualização de Transparência</span>
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

            {/* Feedback de erro */}
            {uploadError && (
              <div className="p-3 rounded-xl bg-red-950/30 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Ações do Modal */}
            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#182136]">
              <button
                type="button"
                onClick={() => setSelectedEntityForUpload(null)}
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
                    <span>Salvar Logotipo</span>
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
    </div>
  );
};
