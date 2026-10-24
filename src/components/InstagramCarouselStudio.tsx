/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Instagram,
  Download,
  Copy,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Layers,
  Check,
  RefreshCw,
  Sliders,
  Type,
  User,
  Share2,
  Calendar,
  Clock,
  ArrowRight,
  Bookmark,
  Heart,
  MessageCircle,
  Send,
  Plus,
  Trash2,
  Maximize2,
  Eye,
  Palette,
  Camera,
  Globe2,
  X,
  PieChart,
  Film,
  Zap,
  TrendingUp
} from 'lucide-react';
import { Event, Entity } from '../types/sinal';
import { ThreeGlobeScene } from './ThreeGlobeScene';

interface HeadlineWord {
  text: string;
  isCyan?: boolean;
}

interface SlideData {
  title: string;
  headlineParts?: HeadlineWord[];
  subtitle?: string;
  categoryTag?: string;
  backgroundImageUrl?: string;
  layoutType?: 'cover_badges' | 'cover_uppercase' | 'infographic_donut' | 'bullets' | 'cta_final';
  // Infográfico Donut (como no Screenshot 5)
  donutData?: {
    label: string;
    value: number;
    color: string;
    sublabel: string;
  }[];
  presidentsList?: string[];
  donutFootnote?: string;
  // Pontos de fatos
  points?: string[];
  sourceNote?: string;
  // CTA
  ctaTitle?: string;
  ctaText?: string;
  ctaHighlight?: string;
}

interface CarouselPost {
  id: string;
  slot: 'presidents' | 'global24h' | 'science' | 'spiderman' | 'custom';
  slotName: string;
  slotTime: string;
  badgeLabel: string;
  headline: string;
  category: string;
  dateStr: string;
  slideCount: 3 | 4 | 5;
  coverBadges: { name: string; avatarUrl: string }[];
  slides: SlideData[];
  caption: string;
}

interface InstagramCarouselStudioProps {
  events: Event[];
  entities: Entity[];
  onBack?: () => void;
}

// Personalidades com fotos reais para os cortes circulares da capa (estilo @radar.fin)
const PRESET_PERSONALITIES = [
  {
    name: 'Michel Temer',
    role: 'Ex-Presidente',
    avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=300&q=80'
  },
  {
    name: 'Lula da Silva',
    role: 'Presidente',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80'
  },
  {
    name: 'Jair Bolsonaro',
    role: 'Ex-Presidente',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80'
  },
  {
    name: 'Elon Musk',
    role: 'X / Tesla',
    avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80'
  },
  {
    name: 'Fernando Haddad',
    role: 'Fazenda',
    avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=300&q=80'
  },
  {
    name: 'Roberto Campos Neto',
    role: 'Banco Central',
    avatarUrl: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=300&q=80'
  },
  {
    name: 'Jerome Powell',
    role: 'Federal Reserve',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80'
  }
];

export const InstagramCarouselStudio: React.FC<InstagramCarouselStudioProps> = ({
  events,
  entities,
  onBack
}) => {
  // Seletor de Tema: 'color' (estilo original @radar.fin com ciano e fotos coloridas) vs 'bw' (P&B puro)
  const [visualTheme, setVisualTheme] = useState<'color' | 'bw'>('color');
  const [show3dStudio, setShow3dStudio] = useState<boolean>(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState<boolean>(false);
  const [renderedPreviewUrls, setRenderedPreviewUrls] = useState<string[]>([]);
  const [isGeneratingPreviews, setIsGeneratingPreviews] = useState<boolean>(false);
  const [previewSlideFocus, setPreviewSlideFocus] = useState<number>(0);

  // 4 MODELOS EXATOS BASEADOS NOS SCREENSHOTS DO USUÁRIO
  const [dailyPosts, setDailyPosts] = useState<CarouselPost[]>([
    // ================= MODELO 1: POLÍTICA & PODER (SCREENSHOT 2 & 5) =================
    {
      id: 'template-presidents',
      slot: 'presidents',
      slotName: 'Mandatos Presidenciais (Donut)',
      slotTime: '12h30',
      badgeLabel: 'Política & História',
      headline: 'Ao longo da história, por quantos dias cada partido já governou o Brasil?',
      category: 'POLÍTICA',
      dateStr: '22 out',
      slideCount: 3,
      coverBadges: [
        { name: 'Michel Temer', avatarUrl: PRESET_PERSONALITIES[0].avatarUrl },
        { name: 'Lula da Silva', avatarUrl: PRESET_PERSONALITIES[1].avatarUrl },
        { name: 'Jair Bolsonaro', avatarUrl: PRESET_PERSONALITIES[2].avatarUrl }
      ],
      slides: [
        // Lâmina 1: Capa idêntica ao Screenshot 2
        {
          layoutType: 'cover_badges',
          title: 'Ao longo da história, por quantos dias cada partido já governou o Brasil? 👉',
          headlineParts: [
            { text: 'Ao longo da história, por' },
            { text: 'quantos dias ' },
            { text: 'cada partido', isCyan: true },
            { text: 'já governou', isCyan: true },
            { text: 'o Brasil? 👉' }
          ],
          categoryTag: 'POLÍTICA · FATOS BR',
          backgroundImageUrl: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=1200&q=80'
        },
        // Lâmina 2: Infográfico Circular Donut idêntico ao Screenshot 5
        {
          layoutType: 'infographic_donut',
          title: 'Quantos dias cada partido já governou o Brasil?',
          headlineParts: [
            { text: 'Quantos dias', isCyan: true },
            { text: 'cada partido' },
            { text: 'já governou o Brasil?' }
          ],
          subtitle: '(Dias de cada partido à frente desde a redemocratização, em 1985)',
          donutData: [
            { label: 'PT', value: 6367, color: '#ef4444', sublabel: 'Lula & Dilma' },
            { label: 'MDB', value: 3412, color: '#22c55e', sublabel: 'Sarney, Itamar & Temer' },
            { label: 'PSDB', value: 2922, color: '#06b6d4', sublabel: 'FHC' },
            { label: 'PRN', value: 1020, color: '#8b5cf6', sublabel: 'Collor' },
            { label: 'PL', value: 397, color: '#2563eb', sublabel: 'Bolsonaro' },
            { label: 'PSL', value: 323, color: '#84cc16', sublabel: 'Bolsonaro' }
          ],
          presidentsList: [
            'PT: Lula (2003-2011/2023-2026) | Dilma (2011-2016)',
            'MDB: Sarney (1985-1990) | Itamar Franco (1992-1995) | Temer (2016-2019)',
            'PSDB: FHC (1995-2003)',
            'PRN: Fernando Collor (1990-1992)',
            'PL / PSL: Jair Bolsonaro (2019-2022)'
          ],
          donutFootnote: '*Jair Bolsonaro foi eleito pelo PSL, permaneceu sem partido por parte do mandato e filiou-se ao PL.',
          sourceNote: 'Fonte: TSE & Acervo Presidencial Oficial'
        },
        // Lâmina 3: CTA Final idêntico ao Screenshot 6
        {
          layoutType: 'cta_final',
          title: 'Gostou do conteúdo?',
          ctaTitle: 'Gostou do conteúdo?',
          ctaText: 'Siga nossa página @fatosbr para mais curiosidades de política e das eleições que você não vê em outro lugar.',
          ctaHighlight: 'curiosidades de política e das eleições',
          backgroundImageUrl: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=1200&q=80'
        }
      ],
      caption: `⏳ Desde a redemocratização, diferentes partidos ocuparam a Presidência da República.\n\nVocê sabia que o PT lidera o tempo acumulado no Planalto com mais de 6.300 dias, seguido pelo MDB com 3.412 dias?\n\n👉 Arraste para o lado e veja a distribuição completa no infográfico exclusivo do Fatos BR.\n\n💬 Qual período marcou mais a trajetória econômica do país na sua visão? Deixe seu comentário.\n\n---\nSiga @fatosbr para curiosidades e análises executivas sem ruído.\n\n#fatosbr #politica #historiadobrasil #eleicoes #democracia #congresso`
    },

    // ================= MODELO 2: NOTÍCIAS GLOBAIS 24H (SCREENSHOT 4) =================
    {
      id: 'template-global24h',
      slot: 'global24h',
      slotName: 'Mundo nas últimas 24h',
      slotTime: '20h00',
      badgeLabel: 'Giro Internacional',
      headline: 'O que aconteceu ao redor do mundo nas últimas 24 horas?',
      category: 'MUNDO & TECH',
      dateStr: '22 out',
      slideCount: 3,
      coverBadges: [
        { name: 'Elon Musk', avatarUrl: PRESET_PERSONALITIES[3].avatarUrl },
        { name: 'Lula da Silva', avatarUrl: PRESET_PERSONALITIES[1].avatarUrl },
        { name: 'Jerome Powell', avatarUrl: PRESET_PERSONALITIES[6].avatarUrl }
      ],
      slides: [
        // Lâmina 1: Capa com 3 figuras e seta (Screenshot 4)
        {
          layoutType: 'cover_badges',
          title: 'O que aconteceu ao redor do mundo nas últimas 24 horas? 👉',
          headlineParts: [
            { text: 'O que aconteceu', isCyan: true },
            { text: 'ao' },
            { text: 'redor do' },
            { text: 'mundo', isCyan: true },
            { text: 'nas' },
            { text: 'últimas 24 horas? 👉' }
          ],
          subtitle: 'Tudo sobre política, ciência e tecnologia... 👉',
          categoryTag: 'GIRO 24H · FATOS BR',
          backgroundImageUrl: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&q=80'
        },
        // Lâmina 2: Fatos estruturados
        {
          layoutType: 'bullets',
          title: 'Destaques Globais do Dia',
          points: [
            'Wall Street e Federal Reserve recalibram apostas para corte nas taxas de juros americanas.',
            'Disputa regulatória global sobre semicondutores e modelos de inteligência artificial de fronteira.',
            'Acordo comercial entre blocos econômicos avança em Bruxelas com impacto em commodities.'
          ],
          sourceNote: 'Fontes consolidadas: Reuters, Bloomberg e Financial Times'
        },
        // Lâmina 3: CTA
        {
          layoutType: 'cta_final',
          title: 'Gostou do resumo?',
          ctaTitle: 'Gostou do conteúdo?',
          ctaText: 'Siga nossa página @fatosbr para resumos diários de política, negócios e tecnologia direto no seu feed.',
          ctaHighlight: 'resumos diários de política, negócios e tecnologia',
          backgroundImageUrl: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&q=80'
        }
      ],
      caption: `🗞️ O que marcou as últimas 24 horas no Brasil e no mundo? Confira os acontecimentos essenciais em política, negócios e tecnologia.\n\nArraste para conferir os tópicos consolidados ➡️\n\n📌 Salve para revisar antes de começar o dia de amanhã!\n\n#fatosbr #noticiasglobais #tecnologia #politica #mercados #briefing`
    },

    // ================= MODELO 3: CIÊNCIA & NOTÍCIA INÉDITA (SCREENSHOT 3) =================
    {
      id: 'template-science',
      slot: 'science',
      slotName: 'Ciência & Inédito (Caixa Alta)',
      slotTime: '15h00',
      badgeLabel: 'Ciência & Inovação',
      headline: 'CIENTISTAS REVIVERAM RINS DE PORCOS CONGELADOS, ALGO INÉDITO',
      category: 'CIÊNCIA',
      dateStr: '22 out',
      slideCount: 3,
      coverBadges: [
        { name: 'Cirurgia', avatarUrl: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=300&q=80' }
      ],
      slides: [
        // Lâmina 1: Estilo Screenshot 3 (Título em caixa alta com palavras em ciano)
        {
          layoutType: 'cover_uppercase',
          title: 'CIENTISTAS REVIVERAM RINS DE PORCOS CONGELADOS, ALGO INÉDITO',
          headlineParts: [
            { text: 'CIENTISTAS REVIVERAM ' },
            { text: 'RINS DE PORCOS CONGELADOS, ', isCyan: true },
            { text: 'ALGO INÉDITO' }
          ],
          subtitle: 'Órgãos ficaram um ano a -150°C; técnica pode ampliar prazo de transplantes humanos.',
          categoryTag: 'CIÊNCIA · FATOS BR',
          backgroundImageUrl: 'https://images.unsplash.com/photo-1516467508483-a7212febe31a?auto=format&fit=crop&w=1200&q=80'
        },
        // Lâmina 2: Detalhes da técnica
        {
          layoutType: 'bullets',
          title: 'Como Funciona a Nova Tecnologia?',
          points: [
            'Uso de nanopartículas de ferro aquecidas por ondas de rádio permite descongelamento uniforme em segundos.',
            'Técnica evita a formação de cristais de gelo que antes destruíam o tecido celular durante o reaquecimento.',
            'Avanço pode revolucionar filas de espera por transplantes em hospitais do mundo inteiro.'
          ],
          sourceNote: 'Foto: Getty/Divulgação · Estudo publicado na Nature Biomedical Engineering'
        },
        // Lâmina 3: CTA
        {
          layoutType: 'cta_final',
          title: 'Gostou do conteúdo?',
          ctaTitle: 'Gostou do conteúdo?',
          ctaText: 'Siga nossa página @fatosbr para mais descobertas da ciência, medicina e tecnologia que mudam o futuro.',
          ctaHighlight: 'descobertas da ciência, medicina e tecnologia',
          backgroundImageUrl: 'https://images.unsplash.com/photo-1516467508483-a7212febe31a?auto=format&fit=crop&w=1200&q=80'
        }
      ],
      caption: `🔬 ALGO INÉDITO NA MEDICINA: Cientistas conseguiram congelar rins por um ano a -150°C e reaquecê-los com sucesso total para transplante.\n\nEssa técnica pode multiplicar o tempo de conservação de órgãos humanos e transformar as filas de espera.\n\n👉 Veja todos os detalhes técnicos no carrossel.\n\n#fatosbr #ciencia #medicina #tecnologia #inovacao #saude`
    },

    // ================= MODELO 4: CULTURA & ECONOMIA DO ENTRETENIMENTO (SCREENSHOT 1) =================
    {
      id: 'template-spiderman',
      slot: 'spiderman',
      slotName: 'Cultura Pop & Cinema (Homem-Aranha)',
      slotTime: '18h30',
      badgeLabel: 'Cultura & Negócios',
      headline: 'Esses são os atores que quase pegaram o papel de Homem-Aranha...',
      category: 'CINEMA',
      dateStr: '22 out',
      slideCount: 3,
      coverBadges: [
        { name: 'Tom Cruise', avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&q=80' },
        { name: 'Timothée Chalamet', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80' },
        { name: 'Leonardo DiCaprio', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80' }
      ],
      slides: [
        // Lâmina 1: Capa idêntica ao Screenshot 1
        {
          layoutType: 'cover_badges',
          title: 'Esses são os atores que quase pegaram o papel de Homem-Aranha... 👉',
          headlineParts: [
            { text: 'Esses são os atores que' },
            { text: 'quase pegaram o papel', isCyan: true },
            { text: 'de Homem-Aranha... 👉' }
          ],
          categoryTag: 'CINEMA · FATOS BR',
          backgroundImageUrl: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?auto=format&fit=crop&w=1200&q=80'
        },
        {
          layoutType: 'bullets',
          title: 'Bastidores de Hollywood',
          points: [
            'James Cameron escreveu nos anos 90 um roteiro pensando em Leonardo DiCaprio como Peter Parker.',
            'Tom Cruise foi cotado pela Cannon Films antes do projeto migrar para os estúdios Sony.',
            'Timothée Chalamet chegou a fazer teste de audição antes da escolha final de Tom Holland em 2015.'
          ],
          sourceNote: 'Fontes: Variety, The Hollywood Reporter e arquivos de produção'
        },
        {
          layoutType: 'cta_final',
          title: 'Gostou do conteúdo?',
          ctaTitle: 'Gostou do conteúdo?',
          ctaText: 'Siga nossa página @fatosbr para mais curiosidades do cinema, cultura pop e grandes negócios de Hollywood.',
          ctaHighlight: 'curiosidades do cinema, cultura pop e grandes negócios',
          backgroundImageUrl: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?auto=format&fit=crop&w=1200&q=80'
        }
      ],
      caption: `🎬 O Homem-Aranha quase teve rostos bem diferentes nos cinemas! Você sabia que Leonardo DiCaprio e Tom Cruise quase vestiram o traje nos anos 90?\n\n👉 Arraste para o lado e veja os bastidores dessa disputa de elenco histórica.\n\n💬 Quem teria sido o melhor Peter Parker entre eles? Comente abaixo!\n\n#fatosbr #cinema #homemaranha #hollywood #filmes #curiosidades`
    }
  ]);

  const [activePostIndex, setActivePostIndex] = useState<number>(0);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string>('');

  const activePost = dailyPosts[activePostIndex];

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Puxar notícia e imagem do feed com 1 clique
  const handleImportEvent = (eventId: string) => {
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return;

    setSelectedEventId(eventId);
    const updated = [...dailyPosts];
    const post = { ...updated[activePostIndex] };

    post.headline = ev.title;
    post.category = ev.category.toUpperCase();

    // Atualiza slide 0 (capa) com a imagem real da notícia
    post.slides[0] = {
      ...post.slides[0],
      title: `${ev.title} 👉`,
      headlineParts: [
        { text: ev.title.slice(0, 35) + ' ' },
        { text: ev.category.toUpperCase(), isCyan: true },
        { text: ' · Fatos BR 👉' }
      ],
      subtitle: ev.summary.slice(0, 95) + '...',
      categoryTag: `${ev.category.toUpperCase()} · FATOS BR`,
      backgroundImageUrl: ev.imageUrl || post.slides[0].backgroundImageUrl
    };

    // Atualiza slide 1 (pontos)
    if (post.slides[1]) {
      post.slides[1] = {
        ...post.slides[1],
        title: 'Fatos Centrais & Repercussão',
        points: [
          ev.whatHappened,
          ev.whyItMatters,
          ev.marketImpact || `Veículos reportando: ${ev.sources?.map((s) => s.sourceName).join(', ') || 'Agências Internacionais'}.`
        ].filter(Boolean).slice(0, 3),
        sourceNote: `Fontes: ${ev.sources?.map((s) => s.sourceName).join(', ') || 'Reuters, Bloomberg'}`
      };
    }

    // Atualiza legenda
    post.caption = `🚨 ${ev.category.toUpperCase()} | ${post.dateStr}\n\n${ev.title}\n\n${ev.summary}\n\n👉 Arraste para o lado para conferir todos os detalhes e impactos.\n\n💬 O que você achou dessa decisão? Comente abaixo.\n\n---\nSiga @fatosbr para inteligência e jornalismo sem ruído.\n\n#fatosbr #${ev.category.toLowerCase().replace(/\s+/g, '')} #economia #politica #brasil`;

    updated[activePostIndex] = post;
    setDailyPosts(updated);
    showToast(`Notícia e imagem real puxadas com sucesso!`);
  };

  // Renderiza uma lâmina específica no Canvas 1080x1350 px exatamente igual aos screenshots
  const renderSlideToCanvas = async (slideIdx: number): Promise<string> => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350; // Aspect ratio 4:5 nativo do Instagram
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Falha ao obter contexto Canvas');

    const totalSlides = activePost.slideCount;
    const slide = activePost.slides[slideIdx] || activePost.slides[0];
    const isColor = visualTheme === 'color';
    const cyanColor = isColor ? '#22d3ee' : '#FFFFFF';

    // 1. Fundo base preto
    ctx.fillStyle = '#060709';
    ctx.fillRect(0, 0, 1080, 1350);

    // 2. Imagem de fundo
    if (slide.backgroundImageUrl) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = () => resolve(null);
          img.src = slide.backgroundImageUrl!;
        });

        if (img.width && img.height) {
          const hRatio = 1080 / img.width;
          const vRatio = 1350 / img.height;
          const ratio = Math.max(hRatio, vRatio);
          const centerShiftX = (1080 - img.width * ratio) / 2;
          const centerShiftY = (1350 - img.height * ratio) / 2;

          ctx.drawImage(img, 0, 0, img.width, img.height, centerShiftX, centerShiftY, img.width * ratio, img.height * ratio);

          if (!isColor) {
            const imgData = ctx.getImageData(0, 0, 1080, 1350);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
              const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
              const contrasted = Math.min(255, Math.max(0, (gray - 128) * 1.18 + 128));
              d[i] = contrasted;
              d[i + 1] = contrasted;
              d[i + 2] = contrasted;
            }
            ctx.putImageData(imgData, 0, 0);
          }
        }
      } catch (e) {
        console.warn('Fallback imagem canvas:', e);
      }
    }

    // 3. Vinhetas e Gradientes Escuros (Idênticos aos screenshots)
    // Gradiente do topo para os botões do Instagram
    const topGrad = ctx.createLinearGradient(0, 0, 0, 320);
    topGrad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
    topGrad.addColorStop(1, 'rgba(0, 0, 0, 0.05)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, 1080, 320);

    // Gradiente da base onde fica a manchete
    const botGrad = ctx.createLinearGradient(0, 560, 0, 1350);
    botGrad.addColorStop(0, 'rgba(0, 0, 0, 0.10)');
    botGrad.addColorStop(0.45, 'rgba(0, 0, 0, 0.88)');
    botGrad.addColorStop(1, 'rgba(0, 0, 0, 0.98)');
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, 560, 1080, 790);

    // 4. Contador de Slide no Topo Direito (ex: 1/3, 2/3, 3/3, 1/10) - Padrão @radar.fin
    ctx.save();
    ctx.beginPath();
    ctx.arc(980, 95, 46, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 12, 16, 0.88)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isColor ? 'rgba(34, 211, 238, 0.4)' : 'rgba(255, 255, 255, 0.25)';
    ctx.stroke();

    ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${slideIdx + 1}/${totalSlides}`, 980, 95);
    ctx.restore();

    // 5. RENDERIZAÇÃO DO LAYOUT ESPECÍFICO DE CADA LÂMINA
    if (slide.layoutType === 'cover_badges') {
      // ===== CAPA COM BADGES CIRCULARES FLUTUANTES (SCREENSHOT 1, 2, 4) =====
      const badges = activePost.coverBadges;

      if (activePost.slot === 'presidents' && badges.length >= 2) {
        // Layout exato do Screenshot 2: Temer no topo esquerdo e Bolsonaro no topo direito
        const positions = [
          { cx: 240, cy: 300, radius: 135, avatarUrl: badges[0]?.avatarUrl },
          { cx: 840, cy: 300, radius: 135, avatarUrl: badges[2]?.avatarUrl || badges[1]?.avatarUrl }
        ];

        for (const pos of positions) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(pos.cx, pos.cy, pos.radius, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();

          try {
            const pImg = new Image();
            pImg.crossOrigin = 'anonymous';
            await new Promise((resolve) => {
              pImg.onload = resolve;
              pImg.onerror = resolve;
              pImg.src = pos.avatarUrl;
            });
            if (pImg.width) {
              ctx.drawImage(pImg, pos.cx - pos.radius, pos.cy - pos.radius, pos.radius * 2, pos.radius * 2);
              if (!isColor) {
                const pData = ctx.getImageData(pos.cx - pos.radius, pos.cy - pos.radius, pos.radius * 2, pos.radius * 2);
                const pd = pData.data;
                for (let pi = 0; pi < pd.length; pi += 4) {
                  const gray = pd[pi] * 0.299 + pd[pi + 1] * 0.587 + pd[pi + 2] * 0.114;
                  pd[pi] = gray;
                  pd[pi + 1] = gray;
                  pd[pi + 2] = gray;
                }
                ctx.putImageData(pData, pos.cx - pos.radius, pos.cy - pos.radius);
              }
            }
          } catch {}
          ctx.restore();

          // Borda branca 4px com sombra realista (idêntico ao Screenshot 2)
          ctx.save();
          ctx.beginPath();
          ctx.arc(pos.cx, pos.cy, pos.radius, 0, Math.PI * 2);
          ctx.lineWidth = 4.5;
          ctx.strokeStyle = '#FFFFFF';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
          ctx.shadowBlur = 22;
          ctx.stroke();
          ctx.restore();
        }
      } else if (badges.length > 0) {
        // Layout Trio (Screenshot 1 & Screenshot 4)
        const isTrio = badges.length === 3;
        const positions = isTrio
          ? [
              { cx: 230, cy: 340, radius: 120, b: badges[0] },
              { cx: 540, cy: 375, radius: 145, b: badges[1] },
              { cx: 850, cy: 340, radius: 120, b: badges[2] }
            ]
          : badges.map((b, i) => ({
              cx: 540 - ((badges.length - 1) * 260) / 2 + i * 260,
              cy: 330,
              radius: 125,
              b
            }));

        for (const pos of positions) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(pos.cx, pos.cy, pos.radius, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();

          try {
            const pImg = new Image();
            pImg.crossOrigin = 'anonymous';
            await new Promise((resolve) => {
              pImg.onload = resolve;
              pImg.onerror = resolve;
              pImg.src = pos.b.avatarUrl;
            });
            if (pImg.width) {
              ctx.drawImage(pImg, pos.cx - pos.radius, pos.cy - pos.radius, pos.radius * 2, pos.radius * 2);
              if (!isColor) {
                const pData = ctx.getImageData(pos.cx - pos.radius, pos.cy - pos.radius, pos.radius * 2, pos.radius * 2);
                const pd = pData.data;
                for (let pi = 0; pi < pd.length; pi += 4) {
                  const gray = pd[pi] * 0.299 + pd[pi + 1] * 0.587 + pd[pi + 2] * 0.114;
                  pd[pi] = gray;
                  pd[pi + 1] = gray;
                  pd[pi + 2] = gray;
                }
                ctx.putImageData(pData, pos.cx - pos.radius, pos.cy - pos.radius);
              }
            }
          } catch {}
          ctx.restore();

          // Borda branca 4px com sombra realista
          ctx.save();
          ctx.beginPath();
          ctx.arc(pos.cx, pos.cy, pos.radius, 0, Math.PI * 2);
          ctx.lineWidth = 4;
          ctx.strokeStyle = '#FFFFFF';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
          ctx.shadowBlur = 20;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Seta de transição centralizada (────▶)
      ctx.save();
      const arrowY = 745;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(460, arrowY);
      ctx.lineTo(605, arrowY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(590, arrowY - 14);
      ctx.lineTo(618, arrowY);
      ctx.lineTo(590, arrowY + 14);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();

      // Manchete Editorial em Dois Tons (Branco e Ciano Vibrante)
      ctx.save();
      ctx.font = 'bold 54px "Playfair Display", Georgia, serif';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
      ctx.shadowBlur = 18;

      const lines = slide.headlineParts || [
        { text: 'Ao longo da história, por' },
        { text: 'quantos dias ' },
        { text: 'cada partido', isCyan: true },
        { text: 'já governou', isCyan: true },
        { text: 'o Brasil? 👉' }
      ];

      const startY = 875;
      const line1 = lines.slice(0, 1).map((l) => l.text).join(' ');
      const line2 = lines.slice(1, 3);
      const line3 = lines.slice(3);

      // Linha 1 (centralizada)
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(line1, 540, startY);

      // Linha 2 (calculada com largura real centralizada)
      const line2TotalW = line2.reduce((acc, pt) => acc + ctx.measureText(pt.text + ' ').width, 0);
      let curX2 = 540 - line2TotalW / 2;
      ctx.textAlign = 'left';
      line2.forEach((pt) => {
        ctx.fillStyle = pt.isCyan ? cyanColor : '#FFFFFF';
        ctx.fillText(pt.text + ' ', curX2, startY + 76);
        curX2 += ctx.measureText(pt.text + ' ').width;
      });

      // Linha 3 (calculada com largura real centralizada)
      const line3TotalW = line3.reduce((acc, pt) => acc + ctx.measureText(pt.text + ' ').width, 0);
      let curX3 = 540 - line3TotalW / 2;
      line3.forEach((pt) => {
        ctx.fillStyle = pt.isCyan ? cyanColor : '#FFFFFF';
        ctx.fillText(pt.text + ' ', curX3, startY + 152);
        curX3 += ctx.measureText(pt.text + ' ').width;
      });
      ctx.restore();

      // Subtítulo opcional
      if (slide.subtitle) {
        ctx.save();
        ctx.font = '28px -apple-system, sans-serif';
        ctx.fillStyle = '#E5E7EB';
        ctx.textAlign = 'center';
        ctx.fillText(slide.subtitle, 540, startY + 225);
        ctx.restore();
      }
    } else if (slide.layoutType === 'infographic_donut') {
      // ===== INFOGRÁFICO CIRCULAR DONUT (SCREENSHOT 5) =====
      ctx.save();
      // Título do infográfico no topo
      ctx.font = 'bold 46px "Playfair Display", Georgia, serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = cyanColor;
      ctx.fillText('Quantos dias ', 90, 160);
      const w1 = ctx.measureText('Quantos dias ').width;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('cada partido', 90 + w1, 160);
      ctx.fillText('já governou o Brasil?', 90, 220);

      if (slide.subtitle) {
        ctx.font = 'italic 24px "Playfair Display", Georgia, serif';
        ctx.fillStyle = '#D1D5DB';
        ctx.fillText(slide.subtitle, 90, 270);
      }

      // Renderização do Donut Chart Circular (com arcos proporcionais)
      const centerX = 540;
      const centerY = 660;
      const outerR = 300;
      const innerR = 210;
      const donutData = slide.donutData || [];
      const totalVal = donutData.reduce((acc, d) => acc + d.value, 0);

      let currentAngle = -Math.PI / 2;

      for (let i = 0; i < donutData.length; i++) {
        const item = donutData[i];
        const sliceAngle = (item.value / totalVal) * (Math.PI * 2);
        const endAngle = currentAngle + sliceAngle;

        ctx.beginPath();
        ctx.arc(centerX, centerY, outerR, currentAngle, endAngle);
        ctx.arc(centerX, centerY, innerR, endAngle, currentAngle, true);
        ctx.closePath();
        ctx.fillStyle = item.color;
        ctx.fill();

        // Rótulo da fatia com contagem
        const midAngle = currentAngle + sliceAngle / 2;
        const labelR = (outerR + innerR) / 2;
        const lx = centerX + Math.cos(midAngle) * labelR;
        const ly = centerY + Math.sin(midAngle) * labelR;

        if (item.value > 800) {
          ctx.font = 'bold 22px -apple-system, sans-serif';
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(item.label, lx, ly - 10);
          ctx.font = '18px "JetBrains Mono", monospace';
          ctx.fillText(String(item.value), lx, ly + 14);
        }

        currentAngle = endAngle;
      }

      // Texto no Miolo do Donut
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const presidents = slide.presidentsList || [];
      let presY = centerY - 90;
      for (let pI = 0; pI < presidents.length; pI++) {
        const line = presidents[pI];
        const [pParty, pNames] = line.split(':');
        ctx.font = 'bold 18px "JetBrains Mono", monospace';
        ctx.fillStyle = pParty.includes('PT') ? '#ef4444' : pParty.includes('MDB') ? '#22c55e' : pParty.includes('PSDB') ? '#06b6d4' : '#E5E7EB';
        ctx.fillText(pParty.trim(), centerX, presY);
        ctx.font = '15px -apple-system, sans-serif';
        ctx.fillStyle = '#D1D5DB';
        ctx.fillText(pNames ? pNames.trim() : '', centerX, presY + 22);
        presY += 46;
      }

      // Rodapé com observação
      if (slide.donutFootnote) {
        ctx.font = 'italic 18px -apple-system, sans-serif';
        ctx.fillStyle = '#9CA3AF';
        ctx.textAlign = 'left';
        ctx.fillText(slide.donutFootnote, 90, 1220);
      }
      ctx.restore();
    } else if (slide.layoutType === 'cover_uppercase') {
      // ===== MANCHETE EM CAIXA ALTA (SCREENSHOT 3) =====
      ctx.save();
      // Corte circular no topo esquerdo (com borda branca)
      const cx = 220;
      const cy = 340;
      const radius = 125;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      try {
        const pImg = new Image();
        pImg.crossOrigin = 'anonymous';
        await new Promise((resolve) => {
          pImg.onload = resolve;
          pImg.onerror = resolve;
          pImg.src = activePost.coverBadges[0]?.avatarUrl || 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=300&q=80';
        });
        if (pImg.width) ctx.drawImage(pImg, cx - radius, cy - radius, radius * 2, radius * 2);
      } catch {}
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.restore();

      // Marca d'água no topo direito
      ctx.font = 'bold 32px -apple-system, sans-serif';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'right';
      ctx.fillText('Fatos', 980, 170);
      ctx.fillStyle = cyanColor;
      ctx.fillText('BR', 1030, 170);

      // Manchete em caixa alta com ciano no meio
      ctx.save();
      ctx.font = 'bold 46px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 12;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('CIENTISTAS REVIVERAM ', 90, 890);
      ctx.fillStyle = cyanColor;
      ctx.fillText('RINS DE PORCOS CONGELADOS, ', 90, 955);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('ALGO INÉDITO', 90, 1020);

      if (slide.subtitle) {
        ctx.font = 'italic 28px "Playfair Display", Georgia, serif';
        ctx.fillStyle = '#E5E7EB';
        ctx.fillText('Órgãos ficaram um ano a -150°C; técnica pode ampliar', 90, 1100);
        ctx.fillText('prazo de transplantes humanos.', 90, 1145);
      }
      ctx.restore();
    } else if (slide.layoutType === 'cta_final') {
      // ===== LÂMINA DE FECHAMENTO / CTA (SCREENSHOT 6) =====
      ctx.save();
      ctx.font = 'bold 64px "Playfair Display", Georgia, serif';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(slide.ctaTitle || 'Gostou do conteúdo?', 540, 530);

      ctx.font = '34px "Playfair Display", Georgia, serif';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('Siga nossa página @fatosbr para mais', 540, 640);
      ctx.fillStyle = cyanColor;
      ctx.fillText(slide.ctaHighlight || 'curiosidades de política e das eleições', 540, 695);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('que você não vê em outro lugar.', 540, 750);

      // Botão Seguir @fatosbr
      ctx.beginPath();
      ctx.roundRect(320, 850, 440, 84, 42);
      ctx.fillStyle = isColor ? '#06b6d4' : '#FFFFFF';
      ctx.fill();

      ctx.font = 'bold 30px -apple-system, sans-serif';
      ctx.fillStyle = isColor ? '#FFFFFF' : '#000000';
      ctx.textAlign = 'center';
      ctx.fillText('Seguir @fatosbr', 540, 903);
      ctx.restore();
    } else {
      // ===== LÂMINA PADRÃO DE FATOS / BULLETS =====
      ctx.save();
      ctx.font = 'bold 50px "Playfair Display", Georgia, serif';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      ctx.fillText(slide.title, 90, 240);

      ctx.beginPath();
      ctx.moveTo(90, 275);
      ctx.lineTo(990, 275);
      ctx.lineWidth = 2;
      ctx.strokeStyle = isColor ? 'rgba(34, 211, 238, 0.4)' : 'rgba(255, 255, 255, 0.2)';
      ctx.stroke();

      const points = slide.points || [];
      let currentY = 360;

      for (let pIdx = 0; pIdx < points.length; pIdx++) {
        const pointText = points[pIdx];

        ctx.font = 'bold 24px "JetBrains Mono", sans-serif';
        ctx.fillStyle = isColor ? '#22d3ee' : '#9CA3AF';
        ctx.fillText(`0${pIdx + 1}`, 90, currentY);

        ctx.font = '32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#F3F4F6';

        const words = pointText.split(' ');
        let line = '';
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          if (ctx.measureText(testLine).width > 820 && n > 0) {
            ctx.fillText(line.trim(), 160, currentY);
            currentY += 46;
            line = words[n] + ' ';
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line.trim(), 160, currentY);
        currentY += 80;
      }
      ctx.restore();
    }

    // 6. Assinatura no Rodapé (@fatosbr)
    ctx.save();
    ctx.font = 'italic bold 24px -apple-system, sans-serif';
    ctx.fillStyle = isColor ? '#22d3ee' : '#E5E7EB';
    ctx.textAlign = 'right';
    ctx.fillText('@fatosbr', 1000, 1270);

    if (slide.sourceNote) {
      ctx.font = '18px -apple-system, sans-serif';
      ctx.fillStyle = '#6B7280';
      ctx.textAlign = 'left';
      ctx.fillText(slide.sourceNote, 80, 1270);
    }
    ctx.restore();

    return canvas.toDataURL('image/png', 0.95);
  };

  // Abrir Modal de Pré-Visualização Completa de Todas as Lâminas
  const handleOpenFullPreview = async () => {
    setIsGeneratingPreviews(true);
    setIsPreviewModalOpen(true);
    try {
      const urls: string[] = [];
      for (let i = 0; i < activePost.slideCount; i++) {
        const dataUrl = await renderSlideToCanvas(i);
        urls.push(dataUrl);
      }
      setRenderedPreviewUrls(urls);
      setPreviewSlideFocus(0);
    } catch (err) {
      console.error(err);
      showToast('Erro ao compor pré-visualizações.');
    } finally {
      setIsGeneratingPreviews(false);
    }
  };

  // Download da lâmina atual
  const handleDownloadCurrentSlide = async (slideIndexToDownload = currentSlideIndex) => {
    setIsExporting(true);
    try {
      const dataUrl = await renderSlideToCanvas(slideIndexToDownload);
      const link = document.createElement('a');
      link.download = `fatosbr-post-${activePost.slot}-lamina-${slideIndexToDownload + 1}.png`;
      link.href = dataUrl;
      link.click();
      showToast(`Lâmina ${slideIndexToDownload + 1} baixada em alta resolução (1080x1350)!`);
    } catch {
      showToast('Erro ao exportar lâmina.');
    } finally {
      setIsExporting(false);
    }
  };

  // Download de todas as lâminas
  const handleDownloadAllSlides = async () => {
    setIsExporting(true);
    try {
      for (let i = 0; i < activePost.slideCount; i++) {
        const dataUrl = await renderSlideToCanvas(i);
        const link = document.createElement('a');
        link.download = `fatosbr-${activePost.slot}-slide-${i + 1}-de-${activePost.slideCount}.png`;
        link.href = dataUrl;
        link.click();
        await new Promise((res) => setTimeout(res, 400));
      }
      showToast(`Todas as ${activePost.slideCount} lâminas baixadas com sucesso!`);
    } catch {
      showToast('Erro ao exportar carrossel completo.');
    } finally {
      setIsExporting(false);
    }
  };

  // Copiar legenda pronta
  const handleCopyCaption = () => {
    navigator.clipboard.writeText(activePost.caption);
    showToast('Legenda copiada para a área de transferência! Pronta para postar.');
  };

  return (
    <div className="flex-1 w-full bg-[#08090b] text-zinc-100 p-4 sm:p-6 lg:p-8 space-y-6 animate-view-fade">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-full bg-zinc-900 border border-zinc-700 text-white text-xs font-semibold shadow-2xl flex items-center gap-2 animate-bounce-short">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ================= CABEÇALHO DO ESTÚDIO ================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#1b1e26]">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white font-bold shadow-md">
              <Instagram className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                <span>Estúdio de Carrosséis para o Instagram</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/60 text-cyan-300 border border-cyan-800 font-mono font-bold">
                  Padrão Oficial @radar.fin
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Modelos idênticos aos das referências: Capa com badges flutuantes, Infográfico Donut de mandatos, Notícia Caixa Alta e CTA final.
              </p>
            </div>
          </div>
        </div>

        {/* Ações Rápidas do Topo */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Seletor de Tema: Cores Vivas (como nas fotos) vs P&B */}
          <div className="inline-flex rounded-xl p-1 bg-zinc-900 border border-zinc-800">
            <button
              onClick={() => {
                setVisualTheme('color');
                showToast('Tema alterado para Cores Vivas & Destaques em Ciano (exatamente como nos screenshots).');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                visualTheme === 'color'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Cores Vivas (Original)</span>
            </button>

            <button
              onClick={() => {
                setVisualTheme('bw');
                showToast('Tema alterado para Monocromático Editorial P&B.');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                visualTheme === 'bw'
                  ? 'bg-white text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>P&B Editorial</span>
            </button>
          </div>

          {/* Botão de Cena 3D Three.js */}
          <button
            onClick={() => setShow3dStudio(!show3dStudio)}
            className={`px-3 py-2 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              show3dStudio
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-300'
            }`}
          >
            <Globe2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>{show3dStudio ? 'Fechar 3D' : 'Cena 3D Three.js'}</span>
          </button>

          {/* BOTÃO PRINCIPAL DE PRÉ-VISUALIZAÇÃO COMPLETA */}
          <button
            onClick={handleOpenFullPreview}
            disabled={isGeneratingPreviews}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-md"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Pré-visualizar Lâminas</span>
          </button>

          <button
            onClick={handleDownloadAllSlides}
            disabled={isExporting}
            className="px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-black transition flex items-center gap-2 cursor-pointer shadow-md"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting ? 'Exportando...' : 'Baixar Carrossel'}</span>
          </button>
        </div>
      </div>

      {/* ================= CENA 3D INTERATIVA THREE.JS (OPCIONAL/EXPANSÍVEL) ================= */}
      {show3dStudio && (
        <div className="p-4 rounded-2xl bg-[#0b0d14] border border-zinc-800 space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">
                Renderização 3D PBR Three.js · Estúdio Fatos BR
              </h3>
            </div>
            <span className="text-[11px] text-zinc-400">
              Gire com o mouse e clique em "Usar 3D no Carrossel" para aplicar como fundo!
            </span>
          </div>

          <ThreeGlobeScene
            onCaptureSnapshot={(dataUrl) => {
              const updated = [...dailyPosts];
              updated[activePostIndex].slides[currentSlideIndex].backgroundImageUrl = dataUrl;
              setDailyPosts(updated);
              showToast(`Imagem 3D renderizada aplicada ao slide ${currentSlideIndex + 1}!`);
            }}
            colorTheme={visualTheme === 'color' ? 'vibrant' : 'monochrome'}
          />
        </div>
      )}

      {/* ================= SELETOR DOS 4 MODELOS EXATOS DOS SCREENSHOTS ================= */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-white flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span>Escolha o Formato do Post (Baseados nos Screenshots):</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {dailyPosts.map((post, idx) => {
            const isSelected = activePostIndex === idx;
            return (
              <button
                key={post.id}
                onClick={() => {
                  setActivePostIndex(idx);
                  setCurrentSlideIndex(0);
                }}
                className={`p-3.5 rounded-2xl border text-left transition cursor-pointer relative overflow-hidden flex flex-col justify-between ${
                  isSelected
                    ? 'bg-zinc-900 border-cyan-400 text-white shadow-xl shadow-cyan-500/10'
                    : 'bg-[#111216] border-[#1e2026] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between pb-1.5">
                    <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-black/60 border border-zinc-800 font-bold text-cyan-300">
                      {post.badgeLabel}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      {post.slideCount} lâminas
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-white line-clamp-2 mt-1">
                    {post.slotName}
                  </h4>
                </div>

                <div className="pt-2 text-[10px] text-zinc-400 flex items-center gap-1 font-mono">
                  <Clock className="w-3 h-3 text-cyan-400" />
                  <span>{post.slotTime}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= ÁREA DE EDIÇÃO & VISUALIZAÇÃO INTERATIVA ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* COLUNA ESQUERDA: CONTROLES DO POST (LÂMINAS, NOTÍCIAS DO FEED, PERSONALIDADES) */}
        <div className="lg:col-span-5 space-y-5">
          
          {/* CARD 1: SELETOR DE QUANTIDADE DE LÂMINAS (3 a 5) */}
          <div className="p-4 sm:p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-zinc-400" />
                <span>Extensão do Carrossel</span>
              </label>
              <span className="text-[10px] font-mono text-cyan-400">
                Lâmina atual: {currentSlideIndex + 1} de {activePost.slideCount}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[3, 4, 5].map((cnt) => (
                <button
                  key={cnt}
                  onClick={() => {
                    const updated = [...dailyPosts];
                    updated[activePostIndex].slideCount = cnt as 3 | 4 | 5;
                    setDailyPosts(updated);
                    showToast(`Extensão ajustada para ${cnt} lâminas.`);
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                    activePost.slideCount === cnt
                      ? 'bg-cyan-500 text-black border-cyan-400 shadow-sm font-black'
                      : 'bg-[#15171e] text-zinc-400 border-zinc-800 hover:text-white hover:border-zinc-700'
                  }`}
                >
                  <span className="text-sm">{cnt} Lâminas</span>
                </button>
              ))}
            </div>
          </div>

          {/* CARD 2: PUXAR NOTÍCIA DO FEED EM TEMPO REAL & IMAGEM AUTOMÁTICA */}
          <div className="p-4 sm:p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-emerald-400" />
                <span>Puxar Notícia & Imagem Automática</span>
              </label>
              <span className="text-[10px] font-mono text-zinc-400">
                {events.length} notícias no feed
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Puxa o acontecimento real com manchete, imagem oficial e fontes com 1 clique.
            </p>

            <select
              value={selectedEventId}
              onChange={(e) => handleImportEvent(e.target.value)}
              className="w-full bg-[#161820] border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="">Selecione uma matéria recente para transformar em post...</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  [{ev.category.toUpperCase()}] {ev.title.slice(0, 60)}...
                </option>
              ))}
            </select>
          </div>

          {/* CARD 3: PERSONALIDADES DA CAPA (CORTES REDONDOS COM BORDA BRANCA) */}
          <div className="p-4 sm:p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-2">
                <User className="w-4 h-4 text-zinc-400" />
                <span>Personalidades na Capa (Estilo @radar.fin)</span>
              </label>
              <span className="text-[10px] font-mono text-zinc-400">
                {activePost.coverBadges.length}/3 selecionadas
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Cortes circulares com borda branca 2px como nos screenshots.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PRESET_PERSONALITIES.map((p) => {
                const isSelected = activePost.coverBadges.some((b) => b.name === p.name);
                return (
                  <button
                    key={p.name}
                    onClick={() => {
                      const updated = [...dailyPosts];
                      const post = { ...updated[activePostIndex] };
                      if (isSelected) {
                        if (post.coverBadges.length <= 1) {
                          showToast('Mantenha pelo menos uma foto na capa.');
                          return;
                        }
                        post.coverBadges = post.coverBadges.filter((b) => b.name !== p.name);
                      } else {
                        if (post.coverBadges.length >= 3) {
                          showToast('Máximo de 3 figuras na capa.');
                          return;
                        }
                        post.coverBadges.push(p);
                      }
                      updated[activePostIndex] = post;
                      setDailyPosts(updated);
                    }}
                    className={`p-2 rounded-xl border flex items-center gap-2 text-left transition cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-800 border-white text-white'
                        : 'bg-[#15171e] border-zinc-800/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                    }`}
                  >
                    <img
                      src={p.avatarUrl}
                      alt={p.name}
                      className="w-7 h-7 rounded-full object-cover border border-white shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold truncate leading-tight">{p.name}</div>
                      <div className="text-[9px] text-zinc-500 truncate">{p.role}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* CARD 4: LEGENDA PRONTA PARA POSTAR COM HASHTAGS */}
          <div className="p-4 sm:p-5 rounded-2xl border border-[#1e2026] bg-[#111216] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white flex items-center gap-2">
                <Type className="w-4 h-4 text-zinc-400" />
                <span>Legenda Oficial do Instagram</span>
              </label>
              <button
                onClick={handleCopyCaption}
                className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                <span>Copiar</span>
              </button>
            </div>

            <textarea
              rows={6}
              value={activePost.caption}
              onChange={(e) => {
                const updated = [...dailyPosts];
                updated[activePostIndex].caption = e.target.value;
                setDailyPosts(updated);
              }}
              className="w-full bg-[#161820] border border-zinc-800 rounded-xl p-3 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 font-sans leading-relaxed"
            />
          </div>
        </div>

        {/* COLUNA DIREITA: PREVIEW DO POST INSTAGRAM (RATIO 4:5 EXATAMENTE IGUAL AOS SCREENSHOTS) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">Visualização Exata do Post (4:5)</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-800 text-cyan-300">
                1080 x 1350 px
              </span>
            </div>

            {/* Ações Rápidas */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenFullPreview}
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Ver Todas as Lâminas</span>
              </button>

              <button
                onClick={() => handleDownloadCurrentSlide(currentSlideIndex)}
                disabled={isExporting}
                className="px-3 py-1.5 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Baixar Lâmina {currentSlideIndex + 1}</span>
              </button>
            </div>
          </div>

          {/* MOCKUP DO DISPOSITIVO / POST INSTAGRAM */}
          <div className="max-w-[440px] mx-auto bg-black border-2 border-zinc-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
            
            {/* Header Superior do Instagram */}
            <div className="px-4 py-3 bg-[#0a0c10] border-b border-zinc-900 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full border border-cyan-400 bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center font-black text-xs text-white">
                  F
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1">
                    <span>fatosbr</span>
                    <span className="text-[10px] text-cyan-400">· Seguir</span>
                  </div>
                  <div className="text-[9px] text-zinc-500">{activePost.slotName}</div>
                </div>
              </div>
              <span className="text-zinc-500 text-xs">•••</span>
            </div>

            {/* ÁREA DA LÂMINA 4:5 */}
            <div className="relative aspect-[4/5] w-full bg-[#050608] overflow-hidden select-none flex flex-col justify-between p-6">
              
              {/* Imagem de Fundo */}
              {activePost.slides[currentSlideIndex]?.backgroundImageUrl && (
                <div
                  className={`absolute inset-0 bg-cover bg-center ${
                    visualTheme === 'bw'
                      ? 'grayscale contrast-125 brightness-75 opacity-70'
                      : 'brightness-90 contrast-110 opacity-80'
                  }`}
                  style={{
                    backgroundImage: `url(${activePost.slides[currentSlideIndex].backgroundImageUrl})`
                  }}
                />
              )}

              {/* Vinheta Escura de Gradiente */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/25 to-black/95 pointer-events-none" />

              {/* TOPO DA LÂMINA: CATEGORIA & CONTADOR (1/3) */}
              <div className="relative z-10 flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-cyan-400">
                  {activePost.slides[currentSlideIndex]?.categoryTag || activePost.category}
                </span>

                <div className="w-8 h-8 rounded-full bg-black/80 border border-cyan-500/60 flex items-center justify-center text-xs font-bold text-white font-mono shadow-md">
                  {currentSlideIndex + 1}/{activePost.slideCount}
                </div>
              </div>

              {/* CORPO DA LÂMINA DE ACORDO COM O LAYOUT */}
              {activePost.slides[currentSlideIndex]?.layoutType === 'cover_badges' ? (
                /* CAPA COM BADGES CIRCULARES FLUTUANTES (SCREENSHOT 1, 2, 4) */
                <div className="relative z-10 flex-1 flex flex-col justify-end pb-7 space-y-3.5">
                  {/* Badges circulares de personalidades com borda branca 2px */}
                  {activePost.slot === 'presidents' && activePost.coverBadges.length >= 2 ? (
                    <div className="absolute inset-x-0 top-10 px-4 flex items-center justify-between pointer-events-none">
                      <div className="w-18 h-18 rounded-full border-2 border-white shadow-2xl overflow-hidden bg-zinc-900 shrink-0">
                        <img
                          src={activePost.coverBadges[0].avatarUrl}
                          alt={activePost.coverBadges[0].name}
                          className={`w-full h-full object-cover ${visualTheme === 'bw' ? 'grayscale contrast-125' : ''}`}
                        />
                      </div>
                      <div className="w-18 h-18 rounded-full border-2 border-white shadow-2xl overflow-hidden bg-zinc-900 shrink-0">
                        <img
                          src={activePost.coverBadges[2]?.avatarUrl || activePost.coverBadges[1]?.avatarUrl}
                          alt={activePost.coverBadges[2]?.name || activePost.coverBadges[1]?.name}
                          className={`w-full h-full object-cover ${visualTheme === 'bw' ? 'grayscale contrast-125' : ''}`}
                        />
                      </div>
                    </div>
                  ) : activePost.coverBadges.length > 0 ? (
                    <div className="flex items-center justify-center -space-x-2.5 pb-4">
                      {activePost.coverBadges.map((badge, bIdx) => (
                        <div
                          key={bIdx}
                          className={`relative rounded-full border-2 border-white shadow-2xl overflow-hidden bg-zinc-900 shrink-0 ${
                            bIdx === 1 && activePost.coverBadges.length === 3 ? 'w-20 h-20 z-10 scale-105' : 'w-16 h-16'
                          }`}
                          title={badge.name}
                        >
                          <img
                            src={badge.avatarUrl}
                            alt={badge.name}
                            className={`w-full h-full object-cover ${visualTheme === 'bw' ? 'grayscale contrast-125' : ''}`}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* Seta de transição central ───▶ */}
                  <div className="flex items-center justify-center gap-1 text-white py-1">
                    <div className="w-16 h-[2px] bg-white" />
                    <ArrowRight className="w-5 h-5 -ml-1 text-white" />
                  </div>

                  {/* Manchete Editorial com palavras em Ciano */}
                  <div className="text-xl sm:text-2xl font-serif font-black text-center text-white tracking-tight leading-snug px-2 drop-shadow-md">
                    {activePost.slides[currentSlideIndex].headlineParts ? (
                      <div>
                        {activePost.slides[currentSlideIndex].headlineParts!.map((part, pI) => (
                          <span
                            key={pI}
                            className={part.isCyan && visualTheme === 'color' ? 'text-cyan-400' : 'text-white'}
                          >
                            {part.text}{' '}
                          </span>
                        ))}
                      </div>
                    ) : (
                      activePost.slides[currentSlideIndex].title
                    )}
                  </div>

                  {activePost.slides[currentSlideIndex].subtitle && (
                    <p className="text-[11px] text-center text-zinc-300 font-sans line-clamp-2 px-4 opacity-90">
                      {activePost.slides[currentSlideIndex].subtitle}
                    </p>
                  )}
                </div>
              ) : activePost.slides[currentSlideIndex]?.layoutType === 'infographic_donut' ? (
                /* INFOGRÁFICO DONUT (SCREENSHOT 5) */
                <div className="relative z-10 flex-1 flex flex-col justify-center space-y-3 py-2">
                  <div>
                    <h3 className="text-base font-serif font-black text-white leading-tight">
                      <span className="text-cyan-400">Quantos dias </span> cada partido já governou o Brasil?
                    </h3>
                    <p className="text-[9px] text-zinc-400 italic">
                      (Dias de cada partido à frente desde a redemocratização, em 1985)
                    </p>
                  </div>

                  {/* Representação visual do Donut Chart */}
                  <div className="relative w-48 h-48 mx-auto my-2 flex items-center justify-center">
                    {/* SVG do Donut Chart */}
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" fill="transparent" stroke="#ef4444" strokeWidth="16" strokeDasharray="100 151" strokeDashoffset="0" />
                      <circle cx="50" cy="50" r="40" fill="transparent" stroke="#22c55e" strokeWidth="16" strokeDasharray="53 198" strokeDashoffset="-100" />
                      <circle cx="50" cy="50" r="40" fill="transparent" stroke="#06b6d4" strokeWidth="16" strokeDasharray="45 206" strokeDashoffset="-153" />
                      <circle cx="50" cy="50" r="40" fill="transparent" stroke="#8b5cf6" strokeWidth="16" strokeDasharray="16 235" strokeDashoffset="-198" />
                      <circle cx="50" cy="50" r="40" fill="transparent" stroke="#2563eb" strokeWidth="16" strokeDasharray="7 244" strokeDashoffset="-214" />
                      <circle cx="50" cy="50" r="40" fill="transparent" stroke="#84cc16" strokeWidth="16" strokeDasharray="5 246" strokeDashoffset="-221" />
                    </svg>

                    {/* Texto central do Donut */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2">
                      <span className="text-[8px] font-black text-red-400 font-mono">PT 6.367d</span>
                      <span className="text-[7px] text-zinc-300 font-sans leading-none">Lula / Dilma</span>
                      <span className="text-[8px] font-black text-emerald-400 font-mono mt-0.5">MDB 3.412d</span>
                      <span className="text-[7px] text-zinc-300 font-sans leading-none">Sarney / Temer</span>
                      <span className="text-[8px] font-black text-cyan-400 font-mono mt-0.5">PSDB 2.922d</span>
                    </div>
                  </div>

                  <p className="text-[8px] text-zinc-400 italic text-center">
                    *Jair Bolsonaro governou por PSL e PL. Fonte: TSE.
                  </p>
                </div>
              ) : activePost.slides[currentSlideIndex]?.layoutType === 'cover_uppercase' ? (
                /* NOTÍCIA CAIXA ALTA (SCREENSHOT 3) */
                <div className="relative z-10 flex-1 flex flex-col justify-between py-4">
                  {/* Corte circular de cirurgia */}
                  <div className="w-24 h-24 rounded-full border-2 border-white shadow-2xl overflow-hidden bg-zinc-900 mt-4">
                    <img
                      src={activePost.coverBadges[0]?.avatarUrl || 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=300&q=80'}
                      alt="Cirurgia"
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="space-y-2 pb-6">
                    <h3 className="text-lg font-black text-white uppercase tracking-tight leading-tight">
                      CIENTISTAS REVIVERAM <span className="text-cyan-400">RINS DE PORCOS CONGELADOS</span>, ALGO INÉDITO
                    </h3>
                    <p className="text-[11px] text-zinc-300 italic font-serif">
                      Órgãos ficaram um ano a -150°C; técnica pode ampliar prazo de transplantes humanos.
                    </p>
                  </div>
                </div>
              ) : activePost.slides[currentSlideIndex]?.layoutType === 'cta_final' ? (
                /* LÂMINA FINAL: CTA (SCREENSHOT 6) */
                <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center space-y-5 px-3">
                  <h3 className="text-2xl sm:text-3xl font-serif font-black text-white tracking-tight">
                    Gostou do conteúdo?
                  </h3>

                  <div className="text-xs sm:text-sm text-zinc-200 leading-relaxed font-serif max-w-xs">
                    Siga nossa página @fatosbr para mais{' '}
                    <span className="text-cyan-400 font-bold">curiosidades de política e das eleições</span> que você não vê em outro lugar.
                  </div>

                  <div className="px-6 py-2.5 rounded-full bg-cyan-500 text-black font-extrabold text-xs shadow-xl flex items-center gap-2">
                    <span>Seguir @fatosbr</span>
                  </div>

                  <div className="pt-4 flex items-center gap-6 text-zinc-400 text-xs">
                    <span className="flex items-center gap-1">❤️ Curtir</span>
                    <span className="flex items-center gap-1">💬 Comentar</span>
                    <span className="flex items-center gap-1">📌 Salvar</span>
                  </div>
                </div>
              ) : (
                /* LÂMINAS DE FATOS / BULLETS */
                <div className="relative z-10 flex-1 flex flex-col justify-center space-y-4 py-4">
                  <div className="border-b border-zinc-800 pb-2">
                    <h3 className="text-lg font-serif font-black text-white">
                      {activePost.slides[currentSlideIndex]?.title}
                    </h3>
                  </div>

                  <div className="space-y-3 text-xs leading-relaxed">
                    {activePost.slides[currentSlideIndex]?.points?.map((pt, pIdx) => (
                      <div key={pIdx} className="flex items-start gap-2.5">
                        <span className="font-mono font-bold text-[10px] mt-0.5 text-cyan-400">
                          0{pIdx + 1}
                        </span>
                        <p className="text-zinc-200 font-sans">{pt}</p>
                      </div>
                    ))}
                  </div>

                  {activePost.slides[currentSlideIndex]?.sourceNote && (
                    <div className="pt-2 text-[10px] text-zinc-500 font-mono">
                      {activePost.slides[currentSlideIndex].sourceNote}
                    </div>
                  )}
                </div>
              )}

              {/* RODAPÉ DA LÂMINA: ASSINATURA @fatosbr */}
              <div className="relative z-10 flex items-center justify-between text-[10px] text-zinc-400 font-mono border-t border-zinc-900/60 pt-2">
                <span>Fatos BR · Inteligência</span>
                <span className="font-bold text-cyan-400 tracking-wider">@fatosbr</span>
              </div>
            </div>

            {/* BARRA INFERIOR DE NAVEGAÇÃO ENTRE LÂMINAS DO CARROSSEL */}
            <div className="px-4 py-3 bg-[#0a0c10] border-t border-zinc-900 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3 text-zinc-300">
                <Heart className="w-4 h-4 hover:text-red-500 cursor-pointer" />
                <MessageCircle className="w-4 h-4 hover:text-white cursor-pointer" />
                <Send className="w-4 h-4 hover:text-white cursor-pointer" />
              </div>

              {/* Bolinhas indicadoras de slide */}
              <div className="flex items-center gap-1.5">
                {Array.from({ length: activePost.slideCount }).map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentSlideIndex(idx)}
                    className={`w-2 h-2 rounded-full transition cursor-pointer ${
                      currentSlideIndex === idx ? 'bg-cyan-400 scale-125' : 'bg-zinc-700 hover:bg-zinc-500'
                    }`}
                  />
                ))}
              </div>

              <Bookmark className="w-4 h-4 text-zinc-300 hover:text-white cursor-pointer" />
            </div>

            {/* CONTROLES DE ANTERIOR / PRÓXIMO SLIDE */}
            <div className="p-3 bg-[#07080a] border-t border-zinc-900/80 flex items-center justify-between">
              <button
                onClick={() => setCurrentSlideIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentSlideIndex === 0}
                className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-xs text-white font-semibold transition flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>

              <span className="text-[11px] font-mono text-zinc-400">
                Lâmina {currentSlideIndex + 1} de {activePost.slideCount}
              </span>

              <button
                onClick={() => setCurrentSlideIndex((prev) => Math.min(activePost.slideCount - 1, prev + 1))}
                disabled={currentSlideIndex === activePost.slideCount - 1}
                className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-xs text-white font-semibold transition flex items-center gap-1 cursor-pointer"
              >
                <span>Próxima</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          MODAL DE PRÉ-VISUALIZAÇÃO COMPLETA DAS LÂMINAS DO CARROSSEL
      ======================================================== */}
      {isPreviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-fade-in">
          <div className="relative w-full max-w-5xl rounded-3xl border border-zinc-800 bg-[#0a0c10] p-6 text-zinc-100 shadow-2xl flex flex-col max-h-[92vh]">
            
            {/* Header do Modal */}
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-cyan-600/20 text-cyan-400 border border-cyan-500/30">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <span>Pré-visualização do Carrossel Completo</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/60 text-cyan-300 font-mono border border-cyan-800">
                      {activePost.slotName} · {activePost.slideCount} Lâminas
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Inspecione todas as lâminas no formato nativo 1080x1350 px antes de realizar o download.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadAllSlides}
                  disabled={isExporting}
                  className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black transition cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar Todas</span>
                </button>
                <button
                  onClick={() => setIsPreviewModalOpen(false)}
                  className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Conteúdo Central do Modal: Galeria de Lâminas */}
            <div className="flex-1 overflow-y-auto py-5 space-y-6">
              {isGeneratingPreviews ? (
                <div className="py-20 flex flex-col items-center justify-center space-y-3 text-center">
                  <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                  <p className="text-sm font-semibold text-white">Renderizando lâminas em alta definição...</p>
                  <span className="text-xs text-zinc-400">Calculando tipografia editorial, vinhetas e gráficos</span>
                </div>
              ) : (
                <>
                  {/* Grade de Lâminas */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    {renderedPreviewUrls.map((url, idx) => (
                      <div
                        key={idx}
                        onClick={() => setPreviewSlideFocus(idx)}
                        className={`group relative rounded-2xl overflow-hidden border-2 transition cursor-pointer bg-black aspect-[4/5] flex flex-col justify-between ${
                          previewSlideFocus === idx
                            ? 'border-cyan-400 shadow-xl shadow-cyan-500/20'
                            : 'border-zinc-800 hover:border-zinc-600'
                        }`}
                      >
                        <img
                          src={url}
                          alt={`Lâmina ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 text-[10px] font-mono text-cyan-300 font-bold backdrop-blur-sm border border-zinc-700">
                          {idx === 0 ? 'Capa' : idx === activePost.slideCount - 1 ? 'CTA Final' : `Lâmina ${idx + 1}`}
                        </div>

                        {/* Botão de download individual da lâmina */}
                        <div className="absolute inset-x-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity flex justify-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadCurrentSlide(idx);
                            }}
                            className="w-full py-1.5 rounded-lg bg-black/90 hover:bg-cyan-500 hover:text-black text-white text-[10px] font-bold transition flex items-center justify-center gap-1 border border-zinc-700 shadow-lg"
                          >
                            <Download className="w-3 h-3" />
                            <span>Baixar {idx + 1}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Detalhe da Lâmina Selecionada */}
                  {renderedPreviewUrls[previewSlideFocus] && (
                    <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800/80 flex flex-col md:flex-row items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="text-xs font-bold text-white flex items-center gap-2">
                          <span>Lâmina {previewSlideFocus + 1} em Foco</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-cyan-400">
                            1080 x 1350 px
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 max-w-xl">
                          {activePost.slides[previewSlideFocus]?.title}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleDownloadCurrentSlide(previewSlideFocus)}
                          className="px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-sm"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Baixar Esta Lâmina (PNG)</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Bloco de Legenda Pronta */}
                  <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">Legenda Pronta para o Instagram</span>
                      <button
                        onClick={handleCopyCaption}
                        className="text-[11px] text-cyan-400 hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar Legenda</span>
                      </button>
                    </div>
                    <pre className="text-[11px] text-zinc-300 font-sans whitespace-pre-wrap bg-black/60 p-3 rounded-xl border border-zinc-900 leading-relaxed">
                      {activePost.caption}
                    </pre>
                  </div>
                </>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="pt-4 border-t border-zinc-800 flex items-center justify-between text-xs">
              <span className="text-[11px] font-mono text-zinc-500">
                Fatos BR · Estúdio de Carrosséis Instagram 4:5
              </span>
              <button
                onClick={() => setIsPreviewModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold transition cursor-pointer"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
