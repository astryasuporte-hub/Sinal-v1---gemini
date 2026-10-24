/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Entity, Topic, Source } from '../types/sinal';
import {
  Check,
  Search,
  X,
  ArrowRight,
  TrendingUp,
  Cpu,
  Building2,
  Newspaper,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  ChevronRight,
  Sliders,
  Layers,
  Compass
} from 'lucide-react';

export interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  entities: Entity[];
  topics: Topic[];
  sources: Source[];
  onToggleEntity: (id: string) => void;
  onToggleTopic: (id: string) => void;
  onToggleSource: (id: string) => void;
  onComplete: () => void;
  // Permite abrir já em etapa avançada se desejado (ex: calibragem pelo perfil)
  initialStep?: 'topics' | 'entities' | 'generating' | 'summary';
}

export type OnboardingStep =
  | 'topics'      // Etapa 1: Grandes Macrotemas / Eixos editoriais
  | 'entities'    // Etapa 2: Entidades e players específicos (empresas, líderes, fontes)
  | 'generating'  // Etapa 3: "O FatosBR está organizando seus primeiros acontecimentos..."
  | 'summary';    // Etapa 4: Resumo dos interesses calibrados e CTA para o Feed

// Macrotemas padrão inspirados no design do FatosBR
interface OnboardingMacroTheme {
  id: string;
  name: string;
  label: string;
  description: string;
  category: string;
  iconName: 'ia' | 'tech' | 'markets' | 'geopolitics' | 'climate' | 'crypto';
  suggestedEntityIds: string[];
}

const MACRO_THEMES: OnboardingMacroTheme[] = [
  {
    id: 'theme-ia',
    name: 'Inteligência Artificial',
    label: 'Modelos, semicondutores, automação e regulação',
    description: 'Acompanhe modelos de fronteira, data centers e avanços de LLMs.',
    category: 'Tecnologia & Fronteira',
    iconName: 'ia',
    suggestedEntityIds: ['ent-nvidia', 'ent-openai', 'ent-sam-altman', 'ent-google']
  },
  {
    id: 'theme-tech',
    name: 'Big Techs & Plataformas',
    label: 'Apple, Microsoft, Google, Meta e ecossistema de software',
    description: 'Balanços trimestrais, novos produtos e mudanças em plataformas globais.',
    category: 'Negócios Globais',
    iconName: 'tech',
    suggestedEntityIds: ['ent-apple', 'ent-microsoft', 'ent-google', 'ent-meta', 'ent-amazon']
  },
  {
    id: 'theme-markets',
    name: 'Mercado Financeiro & Macroeconomia',
    label: 'Taxas de juros, inflação, Banco Central, câmbio e política fiscal',
    description: 'Decisões do Copom, Fed, Treasuries e impacto direto no Brasil.',
    category: 'Economia & Finanças',
    iconName: 'markets',
    suggestedEntityIds: ['ent-banco-central', 'ent-fernando-haddad', 'ent-roberto-campos']
  },
  {
    id: 'theme-geopolitics',
    name: 'Poder Público & Geopolítica',
    label: 'STF, Congresso Nacional, eleições e relações internacionais',
    description: 'Decisões institucionais, marcos regulatórios e tensões globais.',
    category: 'Poder & Instituições',
    iconName: 'geopolitics',
    suggestedEntityIds: ['ent-stf', 'ent-governo-br', 'ent-uniao-europeia', 'ent-onu']
  },
  {
    id: 'theme-mobility',
    name: 'Mobilidade, Espaço & Energia',
    label: 'Veículos autônomos, transição verde, exploração espacial',
    description: 'Inovações em transporte elétrico, aeroespacial e baterias.',
    category: 'Infraestrutura & Futuro',
    iconName: 'climate',
    suggestedEntityIds: ['ent-tesla', 'ent-elon-musk']
  },
  {
    id: 'theme-media',
    name: 'Mídia, Entretenimento & Streaming',
    label: 'Netflix, direitos de transmissão, streaming e cultura digital',
    description: 'Transformação dos modelos de assinatura, cinema e conteúdo esportivo.',
    category: 'Indústria Criativa',
    iconName: 'crypto',
    suggestedEntityIds: ['ent-netflix']
  }
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  entities,
  topics,
  sources,
  onToggleEntity,
  onToggleTopic,
  onToggleSource,
  onComplete,
  initialStep = 'topics'
}) => {
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'companies' | 'people' | 'institutions'>('all');
  const [generationProgress, setGenerationProgress] = useState(0);

  // Seleções ativas
  const followedEntities = useMemo(() => entities.filter((e) => e.isFollowed), [entities]);
  const followedTopics = useMemo(() => topics.filter((t) => t.isFollowed), [topics]);
  const followedSources = useMemo(() => sources.filter((s) => s.isFollowed), [sources]);
  const totalFollowed = followedEntities.length + followedTopics.length + followedSources.length;

  const minRequired = 5;
  const isMinimumMet = totalFollowed >= minRequired;

  // Ação de avançar para a geração do feed
  const handleProceedToGenerate = () => {
    setStep('generating');
    setGenerationProgress(15);

    const t1 = setTimeout(() => setGenerationProgress(45), 450);
    const t2 = setTimeout(() => setGenerationProgress(78), 900);
    const t3 = setTimeout(() => {
      setGenerationProgress(100);
      setTimeout(() => {
        setStep('summary');
      }, 500);
    }, 1400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  };

  // Finalização do Onboarding
  const handleFinalize = () => {
    onComplete();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/90 backdrop-blur-md overflow-y-auto animate-fade-in"
    >
      <div className="relative w-full max-w-3xl rounded-2xl border border-[#20222a] bg-[#0c0d11] text-zinc-100 shadow-2xl my-6 overflow-hidden flex flex-col max-h-[92vh]">
        {/* ================= BARRA DE STATUS / CABEÇALHO SUPERIOR ================= */}
        <header className="px-5 sm:px-8 pt-6 pb-5 border-b border-[#1b1c24] shrink-0 bg-[#0c0d11]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
              <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-400">
                FatosBR · Personalização Inicial
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-zinc-500">
                {step === 'topics' && 'Etapa 1 de 3'}
                {step === 'entities' && 'Etapa 2 de 3'}
                {step === 'generating' && 'Sincronizando'}
                {step === 'summary' && 'Concluído'}
              </span>

              {/* Botão Fechar / Pular */}
              <button
                onClick={onClose}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-[#1a1b22] transition cursor-pointer"
                title="Fechar calibragem"
                aria-label="Fechar calibragem"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Título & Subtítulo da Etapa */}
          <div className="mt-3">
            {step === 'topics' && (
              <>
                <h1 id="onboarding-title" className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                  O que você quer acompanhar?
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  Selecione os temas e assuntos que importam para o seu dia a dia. Você pode alterar tudo depois.
                </p>
              </>
            )}

            {step === 'entities' && (
              <>
                <h1 id="onboarding-title" className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                  Escolha os principais players e entidades
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  Empresas, líderes, instituições e reguladores que moldam esses acontecimentos.
                </p>
              </>
            )}

            {step === 'generating' && (
              <>
                <h1 id="onboarding-title" className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                  Organizando seu primeiro feed
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  Cruzando fontes verificadas, cronologias e relevância editorial...
                </p>
              </>
            )}

            {step === 'summary' && (
              <>
                <h1 id="onboarding-title" className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                  Seu FatosBR está calibrado
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  Seu feed inicial foi personalizado com base nos assuntos e entidades que você escolheu.
                </p>
              </>
            )}
          </div>

          {/* Contador de Interesses e Barra de Progresso do Mínimo */}
          {(step === 'topics' || step === 'entities') && (
            <div className="mt-4 pt-3 border-t border-[#1a1c22] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1.5 font-mono text-xs">
                  <span className={`font-semibold ${totalFollowed >= minRequired ? 'text-white' : 'text-zinc-300'}`}>
                    {totalFollowed}
                  </span>
                  <span className="text-zinc-500">/</span>
                  <span className="text-zinc-500">{minRequired} mínimos</span>
                </div>

                {isMinimumMet ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-zinc-300 font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5 text-zinc-200" />
                    <span>Mínimo alcançado</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-500 font-mono">
                    (Escolha mais {minRequired - totalFollowed} para calibrar com precisão)
                  </span>
                )}
              </div>

              {/* Botões de Ação na barra do topo */}
              <div className="flex items-center gap-2 self-end sm:self-auto">
                {step === 'topics' ? (
                  <button
                    onClick={() => setStep('entities')}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-white text-black text-xs font-semibold hover:bg-zinc-200 transition cursor-pointer"
                  >
                    <span>Próximo: Players</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setStep('topics')}
                      className="px-3 py-1.5 rounded-xl bg-[#14151b] border border-[#22242d] text-zinc-300 text-xs font-medium hover:text-white transition cursor-pointer"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={handleProceedToGenerate}
                      disabled={!isMinimumMet}
                      className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                        isMinimumMet
                          ? 'bg-white text-black hover:bg-zinc-200 shadow-sm'
                          : 'bg-[#181920] text-zinc-500 border border-[#22242d] cursor-not-allowed'
                      }`}
                    >
                      <span>Gerar meu Feed</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </header>

        {/* ================= CONTEÚDO DINÂMICO DE ACORDO COM A ETAPA ================= */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-6 bg-[#090a0d]">
          {/* ================= ETAPA 1: MACROTEMAS & TEMAS ================= */}
          {step === 'topics' && (
            <div className="space-y-6">
              {/* Grid de Macrotemas Estruturais */}
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-3">
                  Eixos Temáticos em Destaque
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {MACRO_THEMES.map((theme) => {
                    // Verifica se algum tópico associado já está ativo
                    const matchingTopic = topics.find(
                      (t) =>
                        t.name.toLowerCase() === theme.name.toLowerCase() ||
                        t.slug.toLowerCase().includes(theme.id.replace('theme-', ''))
                    );
                    const isSelected = matchingTopic?.isFollowed;

                    return (
                      <div
                        key={theme.id}
                        onClick={() => {
                          if (matchingTopic) {
                            onToggleTopic(matchingTopic.id);
                          }
                        }}
                        className={`p-4 rounded-xl border text-left cursor-pointer transition flex flex-col justify-between group ${
                          isSelected
                            ? 'bg-[#15171e] border-zinc-500 text-white shadow-sm'
                            : 'bg-[#0f1015] border-[#1f212a] text-zinc-300 hover:border-[#30333f] hover:bg-[#13141a]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <span className="text-[10px] font-mono uppercase text-zinc-400 tracking-wider">
                              {theme.category}
                            </span>
                            <h3 className="text-sm font-semibold text-white leading-tight">
                              {theme.name}
                            </h3>
                            <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">
                              {theme.label}
                            </p>
                          </div>

                          {/* Caixa de seleção monocromática */}
                          <div
                            className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 transition ${
                              isSelected
                                ? 'bg-white border-white text-black'
                                : 'border-zinc-700 bg-[#16171d] group-hover:border-zinc-500'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                        </div>

                        {/* Sugestões de Players Relacionados */}
                        <div className="mt-3 pt-2.5 border-t border-[#1a1c22] flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono text-zinc-400">Inclui:</span>
                          {theme.suggestedEntityIds.slice(0, 3).map((entId) => {
                            const ent = entities.find((e) => e.id === entId);
                            if (!ent) return null;
                            return (
                              <span
                                key={ent.id}
                                className="text-[10px] text-zinc-300 font-mono bg-[#161820] px-1.5 py-0.5 rounded border border-[#22242d]"
                              >
                                {ent.name}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lista Completa de Tópicos Disponíveis */}
              <div className="pt-2 border-t border-[#1a1c22]">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                    Todos os Temas de Cobertura
                  </div>
                  <span className="text-[11px] font-mono text-zinc-400">
                    {topics.filter((t) => t.isFollowed).length} selecionados
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {topics.map((t) => {
                    const isFollowed = t.isFollowed;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onToggleTopic(t.id)}
                        className={`p-2.5 rounded-lg border text-left flex items-center justify-between transition cursor-pointer ${
                          isFollowed
                            ? 'bg-[#15171e] border-zinc-500 text-white'
                            : 'bg-[#0e0f14] border-[#1b1c24] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                        }`}
                      >
                        <div className="overflow-hidden pr-2">
                          <div className="text-xs font-semibold text-zinc-200 truncate">{t.name}</div>
                          <div className="text-[10px] text-zinc-400 font-mono truncate">{t.category}</div>
                        </div>
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 transition ${
                            isFollowed
                              ? 'bg-white border-white text-black'
                              : 'border-zinc-700 bg-[#16171e]'
                          }`}
                        >
                          {isFollowed && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ================= ETAPA 2: PLAYERS, EMPRESAS E PESSOAS ================= */}
          {step === 'entities' && (
            <div className="space-y-4">
              {/* Barra de Busca & Filtros Rápidos de Entidades */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between pb-2 border-b border-[#1a1c22]">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Buscar empresas, executivos, ministros ou tribunais..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-[#121319] border border-[#22242e] rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
                  <button
                    onClick={() => setFilterType('all')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer shrink-0 ${
                      filterType === 'all'
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:text-white bg-[#121319]'
                    }`}
                  >
                    Todos
                  </button>
                  <button
                    onClick={() => setFilterType('companies')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer shrink-0 ${
                      filterType === 'companies'
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:text-white bg-[#121319]'
                    }`}
                  >
                    Empresas
                  </button>
                  <button
                    onClick={() => setFilterType('people')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer shrink-0 ${
                      filterType === 'people'
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:text-white bg-[#121319]'
                    }`}
                  >
                    Pessoas & Líderes
                  </button>
                  <button
                    onClick={() => setFilterType('institutions')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer shrink-0 ${
                      filterType === 'institutions'
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-400 hover:text-white bg-[#121319]'
                    }`}
                  >
                    Instituições
                  </button>
                </div>
              </div>

              {/* Grid de Entidades Filtradas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {entities
                  .filter((ent) => {
                    const matchSearch =
                      ent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      (ent.sector && ent.sector.toLowerCase().includes(searchTerm.toLowerCase())) ||
                      (ent.role && ent.role.toLowerCase().includes(searchTerm.toLowerCase()));

                    if (!matchSearch) return false;

                    if (filterType === 'companies') return ent.type === 'company';
                    if (filterType === 'people') return ent.type === 'person';
                    if (filterType === 'institutions') return ent.type === 'organization';
                    return true;
                  })
                  .map((ent) => {
                    const isFollowed = ent.isFollowed;
                    return (
                      <div
                        key={ent.id}
                        onClick={() => onToggleEntity(ent.id)}
                        className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition group ${
                          isFollowed
                            ? 'bg-[#15171e] border-zinc-500 text-white shadow-sm'
                            : 'bg-[#0f1015] border-[#1e2029] text-zinc-400 hover:border-[#2f3240] hover:bg-[#13141a]'
                        }`}
                      >
                        <div className="flex items-center space-x-3 overflow-hidden pr-2">
                          {/* Avatar / Inicial monocromática com cor autêntica discreta */}
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 text-white shadow-inner"
                            style={{
                              backgroundColor: ent.brandColor || '#27272a',
                              color: ent.brandColor === '#ffffff' ? '#000000' : '#ffffff'
                            }}
                          >
                            {ent.name.charAt(0)}
                          </div>
                          <div className="overflow-hidden">
                            <div className="text-xs font-semibold text-zinc-100 group-hover:text-white truncate">
                              {ent.name}
                            </div>
                            <div className="text-[10px] text-zinc-400 font-mono truncate">
                              {ent.role || ent.sector || (ent.type === 'company' ? 'Empresa' : 'Entidade')}
                            </div>
                          </div>
                        </div>

                        {/* Toggle Checkbox monocromático */}
                        <div
                          className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 transition ${
                            isFollowed
                              ? 'bg-white border-white text-black'
                              : 'border-zinc-700 bg-[#16171f] group-hover:border-zinc-500'
                          }`}
                        >
                          {isFollowed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Bloco de Fontes Principais */}
              <div className="pt-4 border-t border-[#1a1c22]">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                    Fontes de Notícia Verificadas
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">
                    O FatosBR cruza apenas publicações confiáveis
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {sources.slice(0, 8).map((src) => {
                    const isFollowed = src.isFollowed;
                    return (
                      <button
                        key={src.id}
                        type="button"
                        onClick={() => onToggleSource(src.id)}
                        className={`p-2 rounded-lg border text-left flex items-center justify-between text-xs transition cursor-pointer ${
                          isFollowed
                            ? 'bg-[#15171e] border-zinc-500 text-white'
                            : 'bg-[#0f1015] border-[#1e2029] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                        }`}
                      >
                        <span className="truncate pr-1">{src.name}</span>
                        <div
                          className={`w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0 ${
                            isFollowed ? 'bg-white border-white text-black' : 'border-zinc-700 bg-transparent'
                          }`}
                        >
                          {isFollowed && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ================= ETAPA 3: GERANDO FEED (PROGRESSO EDITORIAL) ================= */}
          {step === 'generating' && (
            <div className="py-12 px-4 flex flex-col items-center justify-center text-center space-y-6 max-w-md mx-auto">
              {/* Animação Minimalista Monocromática (Sem robôs ou neons) */}
              <div className="relative w-16 h-16 rounded-2xl bg-[#13141a] border border-zinc-700 flex items-center justify-center text-white">
                <svg
                  className="w-8 h-8 text-white animate-pulse"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2 13h4l2.5-6 4 13 3-9 2.5 4h4" />
                </svg>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Construindo seu feed FatosBR...
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-mono">
                  {generationProgress < 30 && 'Identificando tópicos de interesse...'}
                  {generationProgress >= 30 && generationProgress < 70 && 'Mapeando acontecimentos e declarações recentes...'}
                  {generationProgress >= 70 && 'Agrupando confluência de fontes e desdobramentos...'}
                </p>
              </div>

              {/* Barra de Progresso Discreta */}
              <div className="w-full bg-[#161720] rounded-full h-1.5 overflow-hidden border border-[#222430]">
                <div
                  className="bg-white h-full transition-all duration-300 rounded-full"
                  style={{ width: `${generationProgress}%` }}
                />
              </div>

              <div className="flex items-center gap-4 text-[11px] font-mono text-zinc-500 pt-2">
                <span>{totalFollowed} parâmetros selecionados</span>
                <span>·</span>
                <span>Filtro de ruído ativo</span>
              </div>
            </div>
          )}

          {/* ================= ETAPA 4: RESUMO & CONFIRMAÇÃO ================= */}
          {step === 'summary' && (
            <div className="space-y-6">
              <div className="p-5 rounded-2xl bg-[#121319] border border-[#22242e] space-y-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                  <span className="font-semibold text-sm text-white">
                    Pronto para acompanhar o que importa
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  O FatosBR organizou sua experiência inicial. Em vez de milhares de manchetes soltas, você verá acontecimentos agrupados com contexto, cronologia e fontes oficiais.
                </p>

                {/* Resumo dos Tópicos Selecionados */}
                <div className="pt-3 border-t border-[#1c1e26] space-y-2">
                  <div className="text-[11px] font-mono uppercase text-zinc-400">
                    Seus eixos calibrados:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {followedTopics.map((top) => (
                      <span
                        key={top.id}
                        className="text-xs bg-[#1a1c24] text-zinc-200 px-2.5 py-1 rounded-lg border border-[#282a36] font-medium"
                      >
                        {top.name}
                      </span>
                    ))}
                    {followedEntities.map((ent) => (
                      <span
                        key={ent.id}
                        className="text-xs bg-[#1a1c24] text-zinc-200 px-2.5 py-1 rounded-lg border border-[#282a36] font-medium flex items-center gap-1.5"
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: ent.brandColor || '#71717a' }}
                        />
                        {ent.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Botões de Ação Final */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('entities')}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-[#22242e] bg-[#121319] hover:bg-[#161820] text-xs font-semibold text-zinc-300 transition cursor-pointer text-center"
                >
                  Ajustar seleções
                </button>

                <button
                  type="button"
                  onClick={handleFinalize}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold shadow-lg transition cursor-pointer"
                >
                  <span>Entrar no FatosBR</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ================= RODAPÉ DO MODAL (QUANDO NAS ETAPAS INICIAIS) ================= */}
        {(step === 'topics' || step === 'entities') && (
          <footer className="px-5 sm:px-8 py-3.5 border-t border-[#1a1c22] bg-[#0c0d11] shrink-0 flex items-center justify-between text-xs text-zinc-400">
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
              <span>Você pode recalibrar seus interesses a qualquer momento no Perfil.</span>
            </div>

            {step === 'topics' ? (
              <button
                onClick={() => setStep('entities')}
                className="text-zinc-300 hover:text-white underline font-medium cursor-pointer"
              >
                Avançar para Players →
              </button>
            ) : (
              <button
                onClick={handleProceedToGenerate}
                disabled={!isMinimumMet}
                className={`font-semibold cursor-pointer ${
                  isMinimumMet ? 'text-white hover:underline' : 'text-zinc-600 cursor-not-allowed'
                }`}
              >
                Finalizar calibração →
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
};
