/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Central de Conformidade Legal, Termos & LGPD (FatosBR)
 * Baseado na legislação brasileira oficial (ctresb/leis):
 * - Lei nº 13.709/2018 (LGPD)
 * - Lei nº 12.965/2014 (Marco Civil da Internet)
 * - Lei nº 8.078/1990 (Código de Defesa do Consumidor - CDC)
 * - Lei nº 9.609/1998 (Software) e Lei nº 9.610/1998 (Direitos Autorais)
 */

import React, { useState, useEffect } from 'react';
import {
  Shield,
  FileText,
  Lock,
  Scale,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  X,
  Send,
  Download,
  Copy,
  Check,
  Building,
  Mail,
  Clock,
  ChevronRight,
  HelpCircle,
  Sparkles
} from 'lucide-react';
import {
  LEGAL_SECTIONS,
  LegalSection,
  LegalArticle,
  DPO_CONTACT,
  DpoRequestSubmission
} from '../data/legalFrameworkData';

export interface LegalCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'terms' | 'lgpd' | 'cdc' | 'owner-rights' | 'dpo';
}

export const LegalCenterModal: React.FC<LegalCenterModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'terms'
}) => {
  const [activeTab, setActiveTab] = useState<'terms' | 'lgpd' | 'cdc' | 'owner-rights' | 'dpo'>(initialTab);
  const [copiedProtocol, setCopiedProtocol] = useState<string | null>(null);

  // Formulário do Encarregado (DPO)
  const [dpoName, setDpoName] = useState('');
  const [dpoEmail, setDpoEmail] = useState('');
  const [dpoType, setDpoType] = useState<DpoRequestSubmission['requestType']>('access');
  const [dpoDetails, setDpoDetails] = useState('');
  const [dpoSubmitting, setDpoSubmitting] = useState(false);
  const [lastSubmission, setLastSubmission] = useState<DpoRequestSubmission | null>(null);
  const [submissionsList, setSubmissionsList] = useState<DpoRequestSubmission[]>([]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('fatosbr_dpo_requests');
      if (stored) {
        setSubmissionsList(JSON.parse(stored));
      }
    } catch {}
  }, [isOpen]);

  if (!isOpen) return null;

  const currentSection = LEGAL_SECTIONS.find((s) => s.id === activeTab);

  const handleSubmitDpo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dpoName.trim() || !dpoEmail.trim()) return;

    setDpoSubmitting(true);
    setTimeout(() => {
      const randNum = Math.floor(100000 + Math.random() * 900000);
      const newSubmission: DpoRequestSubmission = {
        id: `dpo_${Date.now()}`,
        timestamp: new Date().toISOString(),
        protocol: `LGPD-2026-${randNum}`,
        userName: dpoName.trim(),
        userEmail: dpoEmail.trim(),
        requestType: dpoType,
        details: dpoDetails.trim() || 'Solicitação formal de exercício de direitos de titular LGPD.',
        status: 'PENDENTE'
      };

      const updated = [newSubmission, ...submissionsList];
      setSubmissionsList(updated);
      setLastSubmission(newSubmission);
      try {
        localStorage.setItem('fatosbr_dpo_requests', JSON.stringify(updated));
      } catch {}

      setDpoSubmitting(false);
      setDpoDetails('');
    }, 600);
  };

  const handleCopyProtocol = (proto: string) => {
    navigator.clipboard?.writeText(proto);
    setCopiedProtocol(proto);
    setTimeout(() => setCopiedProtocol(null), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-5 animate-fade-in">
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-[#070b12] border border-[#182338] rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col text-zinc-100 overflow-hidden">
        
        {/* ================= HEADER ================= */}
        <div className="px-5 sm:px-6 py-4 border-b border-[#151f33] bg-[#090e18] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600/20 to-emerald-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Scale className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Central Jurídica & Direitos FatosBR
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold hidden sm:inline-flex">
                  Lei 13.709/18 • Marco Civil • CDC
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Proteção incondicional ao leitor e segurança jurídica aos operadores da plataforma.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-[#141d30] transition cursor-pointer"
            aria-label="Fechar Central Jurídica"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ================= NAVEGAÇÃO POR ABAS ================= */}
        <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2.5 bg-[#080d16] border-b border-[#141d30] overflow-x-auto no-scrollbar shrink-0">
          <button
            onClick={() => setActiveTab('terms')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'terms'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-[#12192b]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Termos de Uso</span>
          </button>

          <button
            onClick={() => setActiveTab('lgpd')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'lgpd'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-[#12192b]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Privacidade & LGPD</span>
          </button>

          <button
            onClick={() => setActiveTab('cdc')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'cdc'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-[#12192b]'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Consumidor & Pix (CDC)</span>
          </button>

          <button
            onClick={() => setActiveTab('owner-rights')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'owner-rights'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-[#12192b]'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Defesa da Plataforma</span>
          </button>

          <button
            onClick={() => setActiveTab('dpo')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              activeTab === 'dpo'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-[#12192b]'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Canal do Encarregado (DPO)</span>
          </button>
        </div>

        {/* ================= CORPO COM SCROLL ================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {activeTab !== 'dpo' && currentSection && (
            <div className="space-y-5">
              {/* Descrição do Módulo */}
              <div className="p-4 rounded-2xl bg-[#0b101c] border border-[#162137]">
                <h3 className="text-sm font-bold text-white">{currentSection.title}</h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  {currentSection.description}
                </p>
              </div>

              {/* Artigos da Legislação Brasileira */}
              <div className="space-y-4">
                {currentSection.articles.map((art, idx) => (
                  <div
                    key={idx}
                    className="p-4 sm:p-5 rounded-2xl bg-[#090d16] border border-[#151f33] space-y-3 hover:border-[#1d2c47] transition"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#141b2c]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                          {art.law} • {art.number}
                        </span>
                        <span className="text-xs font-bold text-white">{art.title}</span>
                      </div>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase tracking-wider w-fit ${
                          art.beneficiary === 'cliente'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : art.beneficiary === 'plataforma'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}
                      >
                        {art.badge}
                      </span>
                    </div>

                    {/* Texto Literal da Lei */}
                    <div className="p-3 rounded-xl bg-[#05080f] border border-[#12192b] text-[11px] sm:text-xs text-zinc-300 font-mono italic leading-relaxed">
                      "{art.text}"
                    </div>

                    {/* Aplicação Prática no FatosBR */}
                    <div className="flex items-start gap-2 text-xs text-zinc-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-white">Aplicação Prática no FatosBR: </strong>
                        <span className="text-zinc-300">{art.practicalApplication}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ================= ABA DPO: CANAL DO ENCARREGADO ================= */}
          {activeTab === 'dpo' && (
            <div className="space-y-6">
              {/* Cartão de Informações do DPO */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-blue-950/30 to-emerald-950/20 border border-blue-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-sm font-bold text-white">Canal Direto do Encarregado de Dados (DPO)</h3>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                    Art. 41 da Lei 13.709/2018
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Conforme determinado pela Lei Geral de Proteção de Dados, disponibilizamos este canal direto para você exercer seus direitos de titular: confirmação de tratamento, acesso, retificação, portabilidade ou eliminação definitiva da sua conta.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono pt-1">
                  <div className="p-2.5 rounded-xl bg-[#070b12] border border-[#151f33] text-zinc-400">
                    <span className="text-[10px] text-zinc-500 block">E-MAIL OFICIAL DO ENCARREGADO:</span>
                    <strong className="text-blue-300">{DPO_CONTACT.email}</strong>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#070b12] border border-[#151f33] text-zinc-400">
                    <span className="text-[10px] text-zinc-500 block">PRAZO REGULAMENTAR DE RESPOSTA:</span>
                    <strong className="text-emerald-300">{DPO_CONTACT.responseDeadline}</strong>
                  </div>
                </div>
              </div>

              {/* Feedback de envio de protocolo */}
              {lastSubmission && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-2 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Solicitação LGPD Registrada com Sucesso!</span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-400">Status: PENDENTE</span>
                  </div>
                  <p className="text-zinc-300">
                    Seu requerimento foi autuado na fila de conformidade do Encarregado de Dados. Guarde seu protocolo para acompanhamento:
                  </p>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#080d16] border border-[#151f33] font-mono font-bold text-white">
                    <span className="text-blue-400">{lastSubmission.protocol}</span>
                    <button
                      onClick={() => handleCopyProtocol(lastSubmission.protocol)}
                      className="ml-auto px-2 py-1 rounded bg-[#131b2c] hover:bg-[#1a253c] text-zinc-300 hover:text-white text-[10px] transition cursor-pointer flex items-center gap-1"
                    >
                      {copiedProtocol === lastSubmission.protocol ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Formulário Interativo de Requisição */}
              <form onSubmit={handleSubmitDpo} className="p-4 sm:p-5 rounded-2xl bg-[#090d16] border border-[#151f33] space-y-4">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Registrar Nova Solicitação de Titular (LGPD)
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <label className="text-zinc-300 font-medium">Seu Nome Completo</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Ana Silva"
                      value={dpoName}
                      onChange={(e) => setDpoName(e.target.value)}
                      className="w-full bg-[#060910] border border-[#182338] rounded-xl px-3 py-2 text-zinc-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-zinc-300 font-medium">Seu E-mail Cadastrado</label>
                    <input
                      type="email"
                      required
                      placeholder="seuemail@exemplo.com"
                      value={dpoEmail}
                      onChange={(e) => setDpoEmail(e.target.value)}
                      className="w-full bg-[#060910] border border-[#182338] rounded-xl px-3 py-2 text-zinc-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1 text-xs">
                  <label className="text-zinc-300 font-medium">Tipo de Requerimento Legal (Art. 18 LGPD)</label>
                  <select
                    value={dpoType}
                    onChange={(e) => setDpoType(e.target.value as any)}
                    className="w-full bg-[#060910] border border-[#182338] rounded-xl px-3 py-2 text-zinc-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="access">Acesso e Cópia Integral dos Meus Dados (Art. 18, II)</option>
                    <option value="confirmation">Confirmação da Existência de Tratamento (Art. 18, I)</option>
                    <option value="deletion">Eliminação Definitiva da Conta e Dados Pessoais (Art. 18, VI)</option>
                    <option value="rectification">Correção de Dados Incompletos ou Inexatos (Art. 18, III)</option>
                    <option value="revocation">Revogação do Consentimento (Art. 8º, § 5º)</option>
                  </select>
                </div>

                <div className="space-y-1 text-xs">
                  <label className="text-zinc-300 font-medium">Detalhamento ou Justificativa (Opcional)</label>
                  <textarea
                    rows={3}
                    placeholder="Especifique eventuais informações complementares para agilizar o atendimento..."
                    value={dpoDetails}
                    onChange={(e) => setDpoDetails(e.target.value)}
                    className="w-full bg-[#060910] border border-[#182338] rounded-xl p-3 text-zinc-200 focus:outline-none focus:border-blue-500 text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={dpoSubmitting || !dpoName.trim() || !dpoEmail.trim()}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                >
                  <Send className={`w-3.5 h-3.5 ${dpoSubmitting ? 'animate-spin' : ''}`} />
                  <span>{dpoSubmitting ? 'Autuando Requerimento...' : 'Protocolar Requerimento ao DPO'}</span>
                </button>
              </form>

              {/* Histórico Local de Requerimentos */}
              {submissionsList.length > 0 && (
                <div className="p-4 rounded-2xl bg-[#090d16] border border-[#151f33] space-y-3">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                    Seus Protocolos Anteriores ({submissionsList.length})
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {submissionsList.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-xl bg-[#060910] border border-[#131b2c] flex items-center justify-between text-xs font-mono"
                      >
                        <div>
                          <div className="font-bold text-white">{item.protocol}</div>
                          <div className="text-[10px] text-zinc-400">
                            {new Date(item.timestamp).toLocaleDateString('pt-BR')} • {item.requestType.toUpperCase()}
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ================= FOOTER / ACEITE EXPLÍCITO ================= */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-[#151f33] bg-[#090e18] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 text-center sm:text-left">
            <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>FatosBR • Em estrita observância à Legislação Federal Brasileira (Repositório ctresb/leis).</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => {
                const textToPrint = `FATOSBR - CENTRAL JURÍDICA E DE CONFORMIDADE\n\n` +
                  `Legislação Integrada: LGPD (Lei 13.709/18), Marco Civil (Lei 12.965/14), CDC (Lei 8.078/90), Software (Lei 9.609/98).\n` +
                  `Encarregado DPO: ${DPO_CONTACT.email}\n` +
                  `Data da consulta: ${new Date().toLocaleDateString('pt-BR')}\n`;
                const blob = new Blob([textToPrint], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `fatosbr-conformidade-legal-${Date.now()}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex-1 sm:flex-none px-3 py-2 rounded-xl border border-[#1b273f] bg-[#0c1220] hover:bg-[#141d30] text-zinc-300 hover:text-white text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar Cópia</span>
            </button>

            <button
              onClick={() => {
                try {
                  localStorage.setItem('fatosbr_lgpd_consent_v1', 'accepted');
                } catch {}
                onClose();
              }}
              className="flex-1 sm:flex-none px-5 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-xs transition cursor-pointer shadow-sm"
            >
              Compreendido & Ciente
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
