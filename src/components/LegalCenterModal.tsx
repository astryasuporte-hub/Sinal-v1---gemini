/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Central de Conformidade Legal, Termos & LGPD (FatosBR)
 * - 100% Monocromático (Preto, Cinzas e Branco)
 * - Interface Fullscreen Otimizada para Mobile (Samsung Galaxy A35 e smartphones)
 * - Baseado na legislação brasileira oficial (ctresb/leis):
 *   - Lei nº 13.709/2018 (LGPD)
 *   - Lei nº 12.965/2014 (Marco Civil da Internet)
 *   - Lei nº 8.078/1990 (Código de Defesa do Consumidor - CDC)
 *   - Lei nº 9.609/1998 (Software) e Lei nº 9.610/1998 (Direitos Autorais)
 */

import React, { useState, useEffect } from 'react';
import {
  Shield,
  FileText,
  Lock,
  Scale,
  UserCheck,
  CheckCircle2,
  X,
  Send,
  Copy,
  Check,
  Mail,
  Clock
} from 'lucide-react';
import {
  LEGAL_SECTIONS,
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
    <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center bg-black/90 backdrop-blur-md p-0 sm:p-5 animate-fadeIn">
      {/* Container Responsivo: Tela cheia no Mobile (Samsung A35), Dialog no Desktop */}
      <div className="relative w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-4xl bg-black border-0 sm:border sm:border-zinc-800 rounded-none sm:rounded-3xl shadow-2xl flex flex-col text-zinc-100 overflow-hidden">
        
        {/* ================= HEADER ================= */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-zinc-800 bg-[#09090b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center text-white shrink-0">
              <Scale className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Central Jurídica & LGPD
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-300 font-bold hidden sm:inline-flex">
                  Lei 13.709/18 • Marco Civil • CDC
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-zinc-400">
                Garantias ao titular e segurança jurídica na plataforma.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Fechar Central Jurídica"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ================= NAVEGAÇÃO POR ABAS SUPERIORES ================= */}
        <div className="flex items-center gap-1.5 px-3 sm:px-6 py-2.5 bg-black border-b border-zinc-800 overflow-x-auto no-scrollbar shrink-0">
          <button
            onClick={() => setActiveTab('terms')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer min-h-[40px] ${
              activeTab === 'terms'
                ? 'bg-white text-black font-bold shadow-md'
                : 'text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Termos de Uso</span>
          </button>

          <button
            onClick={() => setActiveTab('lgpd')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer min-h-[40px] ${
              activeTab === 'lgpd'
                ? 'bg-white text-black font-bold shadow-md'
                : 'text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Privacidade & LGPD</span>
          </button>

          <button
            onClick={() => setActiveTab('dpo')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer min-h-[40px] ${
              activeTab === 'dpo'
                ? 'bg-white text-black font-bold shadow-md'
                : 'text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Canal do Encarregado (DPO)</span>
          </button>

          <button
            onClick={() => setActiveTab('cdc')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer min-h-[40px] ${
              activeTab === 'cdc'
                ? 'bg-white text-black font-bold shadow-md'
                : 'text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Consumidor & Pix (CDC)</span>
          </button>

          <button
            onClick={() => setActiveTab('owner-rights')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer min-h-[40px] ${
              activeTab === 'owner-rights'
                ? 'bg-white text-black font-bold shadow-md'
                : 'text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Defesa da Plataforma</span>
          </button>
        </div>

        {/* ================= CORPO COM SCROLL ================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 no-scrollbar">
          {activeTab !== 'dpo' && currentSection && (
            <div className="space-y-4">
              {/* Descrição do Módulo */}
              <div className="p-4 rounded-2xl bg-[#09090b] border border-zinc-800">
                <h3 className="text-sm font-bold text-white">{currentSection.title}</h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  {currentSection.description}
                </p>
              </div>

              {/* Artigos da Legislação Brasileira */}
              <div className="space-y-3.5">
                {currentSection.articles.map((art, idx) => (
                  <div
                    key={idx}
                    className="p-4 sm:p-5 rounded-2xl bg-[#09090b] border border-zinc-800 space-y-3 hover:border-zinc-700 transition"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-zinc-800">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-mono font-bold text-white bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">
                          {art.law} • {art.number}
                        </span>
                        <span className="text-xs font-bold text-white">{art.title}</span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-bold uppercase tracking-wider w-fit">
                        {art.badge}
                      </span>
                    </div>

                    {/* Texto Literal da Lei */}
                    <div className="p-3 rounded-xl bg-black border border-zinc-800 text-[11px] sm:text-xs text-zinc-300 font-mono italic leading-relaxed">
                      "{art.text}"
                    </div>

                    {/* Aplicação Prática no FatosBR */}
                    <div className="flex items-start gap-2 text-xs text-zinc-300">
                      <CheckCircle2 className="w-4 h-4 text-white shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-white">Aplicação Prática no FatosBR: </strong>
                        <span className="text-zinc-400">{art.practicalApplication}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ================= ABA DPO: CANAL DO ENCARREGADO ================= */}
          {activeTab === 'dpo' && (
            <div className="space-y-5">
              {/* Cartão de Informações do DPO */}
              <div className="p-4 sm:p-5 rounded-2xl bg-[#09090b] border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-white" />
                    <h3 className="text-sm font-bold text-white">Canal Direto do Encarregado de Dados (DPO)</h3>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-white border border-zinc-700 font-bold">
                    Art. 41 LGPD
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Conforme determinado pela Lei Geral de Proteção de Dados (Lei 13.709/18), disponibilizamos este canal direto para você exercer seus direitos de titular: confirmação de tratamento, acesso, retificação, portabilidade ou eliminação definitiva da sua conta.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono pt-1">
                  <div className="p-3 rounded-xl bg-black border border-zinc-800 text-zinc-400">
                    <span className="text-[10px] text-zinc-500 block">E-MAIL DO ENCARREGADO:</span>
                    <strong className="text-white font-bold">{DPO_CONTACT.email}</strong>
                  </div>
                  <div className="p-3 rounded-xl bg-black border border-zinc-800 text-zinc-400">
                    <span className="text-[10px] text-zinc-500 block">PRAZO LEGAL DE RESPOSTA:</span>
                    <strong className="text-white font-bold">{DPO_CONTACT.responseDeadline}</strong>
                  </div>
                </div>
              </div>

              {/* Feedback de envio de protocolo */}
              {lastSubmission && (
                <div className="p-4 rounded-2xl bg-zinc-900 border border-white text-xs space-y-2 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <CheckCircle2 className="w-4 h-4 text-white" />
                      <span>Solicitação LGPD Registrada com Sucesso!</span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-400">Status: PENDENTE</span>
                  </div>
                  <p className="text-zinc-300">
                    Seu requerimento foi autuado na fila de conformidade do Encarregado de Dados. Guarde seu protocolo:
                  </p>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-black border border-zinc-700 font-mono font-bold text-white">
                    <span className="text-white font-bold">{lastSubmission.protocol}</span>
                    <button
                      onClick={() => handleCopyProtocol(lastSubmission.protocol)}
                      className="ml-auto px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] transition cursor-pointer flex items-center gap-1 min-h-[36px]"
                    >
                      {copiedProtocol === lastSubmission.protocol ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-white" />
                          <span>Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Formulário Interativo de Requisição */}
              <form onSubmit={handleSubmitDpo} className="p-4 sm:p-5 rounded-2xl bg-[#09090b] border border-zinc-800 space-y-4">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Registrar Nova Solicitação de Titular (LGPD)
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1.5">
                    <label className="text-zinc-300 font-medium">Seu Nome Completo</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Ana Silva"
                      value={dpoName}
                      onChange={(e) => setDpoName(e.target.value)}
                      className="w-full bg-black border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-white transition min-h-[44px]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-zinc-300 font-medium">Seu E-mail Cadastrado</label>
                    <input
                      type="email"
                      required
                      placeholder="seuemail@exemplo.com"
                      value={dpoEmail}
                      onChange={(e) => setDpoEmail(e.target.value)}
                      className="w-full bg-black border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-white transition min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 text-xs">
                  <label className="text-zinc-300 font-medium">Tipo de Requerimento Legal (Art. 18 LGPD)</label>
                  <select
                    value={dpoType}
                    onChange={(e) => setDpoType(e.target.value as any)}
                    className="w-full bg-black border border-zinc-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-white transition min-h-[44px] cursor-pointer"
                  >
                    <option value="access">Acesso e Cópia Integral dos Meus Dados (Art. 18, II)</option>
                    <option value="confirmation">Confirmação da Existência de Tratamento (Art. 18, I)</option>
                    <option value="deletion">Eliminação Definitiva da Conta e Dados Pessoais (Art. 18, VI)</option>
                    <option value="rectification">Correção de Dados Incompletos ou Inexatos (Art. 18, III)</option>
                    <option value="revocation">Revogação do Consentimento (Art. 8º, § 5º)</option>
                  </select>
                </div>

                <div className="space-y-1.5 text-xs">
                  <label className="text-zinc-300 font-medium">Detalhamento ou Justificativa (Opcional)</label>
                  <textarea
                    rows={3}
                    placeholder="Especifique eventuais informações complementares para agilizar o atendimento..."
                    value={dpoDetails}
                    onChange={(e) => setDpoDetails(e.target.value)}
                    className="w-full bg-black border border-zinc-800 rounded-xl p-3 text-white focus:outline-none focus:border-white transition text-xs"
                  />
                </div>

                <button
                  type="submit"
                  disabled={dpoSubmitting || !dpoName.trim() || !dpoEmail.trim()}
                  className="w-full sm:w-auto px-5 py-3 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 min-h-[44px]"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{dpoSubmitting ? 'Autuando...' : 'Autuar Requerimento Oficial'}</span>
                </button>
              </form>
            </div>
          )}
        </div>

        {/* ================= RODAPÉ DA CENTRAL ================= */}
        <div className="p-3.5 sm:p-4 border-t border-zinc-800 bg-[#09090b] flex items-center justify-between text-xs text-zinc-400 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-[11px] font-mono">Conformidade Ativa • Marco Civil & LGPD</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-white hover:bg-zinc-800 text-xs font-semibold transition cursor-pointer min-h-[40px]"
          >
            Fechar
          </button>
        </div>

      </div>
    </div>
  );
};
