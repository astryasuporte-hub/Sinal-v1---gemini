/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Event, Entity, Topic, Source, Briefing, UserSubscription, SinalNotification } from '../types/sinal';

export const INITIAL_ENTITIES: Entity[] = [
  // Empresas
  {
    id: 'ent-nvidia',
    name: 'NVIDIA',
    type: 'company',
    sector: 'Tecnologia',
    description: 'Empresa de tecnologia focada em GPUs e inteligência artificial.',
    website: 'https://nvidia.com',
    isFollowed: true,
    interestCount: '+ 12K interesses',
    brandColor: '#76b900',
    recentEventsCount: 12
  },
  {
    id: 'ent-openai',
    name: 'OpenAI',
    type: 'company',
    sector: 'Tecnologia',
    description: 'Empresa de pesquisa e desenvolvimento em inteligência artificial.',
    website: 'https://openai.com',
    isFollowed: true,
    interestCount: '+ 9.4K interesses',
    brandColor: '#10a37f',
    recentEventsCount: 18
  },
  {
    id: 'ent-apple',
    name: 'Apple',
    type: 'company',
    sector: 'Tecnologia',
    description: 'Empresa de tecnologia e eletrônicos.',
    website: 'https://apple.com',
    isFollowed: true,
    interestCount: '+ 8.9K interesses',
    brandColor: '#ffffff',
    recentEventsCount: 16
  },
  {
    id: 'ent-microsoft',
    name: 'Microsoft',
    type: 'company',
    sector: 'Tecnologia',
    description: 'Gigante de software, computação em nuvem Azure e infraestrutura.',
    website: 'https://microsoft.com',
    isFollowed: true,
    interestCount: '+ 8.4K interesses',
    brandColor: '#00a4ef',
    recentEventsCount: 22
  },
  {
    id: 'ent-google',
    name: 'Google',
    type: 'company',
    sector: 'Tecnologia',
    description: 'Líder em busca, serviços em nuvem, Android e modelos Gemini.',
    website: 'https://google.com',
    isFollowed: true,
    interestCount: '+ 7.2K interesses',
    brandColor: '#4285f4',
    recentEventsCount: 15
  },
  {
    id: 'ent-tesla',
    name: 'Tesla',
    type: 'company',
    sector: 'Automotivo',
    description: 'Pioneira em veículos elétricos autônomos e soluções de armazenamento de energia.',
    website: 'https://tesla.com',
    isFollowed: false,
    interestCount: '+ 6.7K interesses',
    brandColor: '#e82127'
  },
  {
    id: 'ent-meta',
    name: 'Meta',
    type: 'company',
    sector: 'Tecnologia',
    description: 'Conglomerado de plataformas sociais, realidade virtual e modelos abertos Llama.',
    website: 'https://meta.com',
    isFollowed: false,
    interestCount: '+ 6.1K interesses',
    brandColor: '#0668e1'
  },
  {
    id: 'ent-amazon',
    name: 'Amazon',
    type: 'company',
    sector: 'E-commerce',
    description: 'Líder global em comércio eletrônico e computação em nuvem AWS.',
    website: 'https://amazon.com',
    isFollowed: false,
    interestCount: '+ 5.8K interesses',
    brandColor: '#ff9900'
  },
  {
    id: 'ent-netflix',
    name: 'Netflix',
    type: 'company',
    sector: 'Entretenimento',
    description: 'Principal serviço de streaming de entretenimento e produção audiovisual do mundo.',
    website: 'https://netflix.com',
    isFollowed: false,
    interestCount: '+ 5.1K interesses',
    brandColor: '#e50914'
  },
  {
    id: 'ent-petrobras',
    name: 'Petrobras',
    type: 'company',
    sector: 'Energia & Petróleo',
    description: 'Maior companhia de energia do Brasil, líder em exploração no pré-sal e transição energética.',
    website: 'https://petrobras.com.br',
    isFollowed: true,
    interestCount: '+ 15.2K interesses',
    brandColor: '#008542',
    recentEventsCount: 24
  },
  {
    id: 'ent-vale',
    name: 'Vale',
    type: 'company',
    sector: 'Mineração & Siderurgia',
    description: 'Uma das maiores mineradoras do mundo, pioneira em descarbonização e briquetes verdes.',
    website: 'https://vale.com',
    isFollowed: true,
    interestCount: '+ 11.8K interesses',
    brandColor: '#007e7a',
    recentEventsCount: 19
  },
  {
    id: 'ent-nubank',
    name: 'Nubank',
    type: 'company',
    sector: 'Fintech & Bancos',
    description: 'Líder em serviços financeiros digitais na América Latina com mais de 105 milhões de clientes.',
    website: 'https://nubank.com.br',
    isFollowed: true,
    interestCount: '+ 14.5K interesses',
    brandColor: '#820ad1',
    recentEventsCount: 21
  },
  {
    id: 'ent-itau',
    name: 'Itaú Unibanco',
    type: 'company',
    sector: 'Bancos & Finanças',
    description: 'Maior conglomerado financeiro privado do hemisfério sul, liderando transformação digital.',
    website: 'https://itau.com.br',
    isFollowed: true,
    interestCount: '+ 10.3K interesses',
    brandColor: '#ec7000',
    recentEventsCount: 16
  },
  {
    id: 'ent-embraer',
    name: 'Embraer',
    type: 'company',
    sector: 'Aeroespacial & Defesa',
    description: 'Terceira maior fabricante global de jatos comerciais e líder em aviação executiva e militar.',
    website: 'https://embraer.com',
    isFollowed: true,
    interestCount: '+ 9.1K interesses',
    brandColor: '#002b49',
    recentEventsCount: 14
  },
  {
    id: 'ent-mercadolivre',
    name: 'Mercado Livre',
    type: 'company',
    sector: 'E-commerce & Logística',
    description: 'Líder absoluto de comércio eletrônico e soluções financeiras na América Latina.',
    website: 'https://mercadolivre.com.br',
    isFollowed: true,
    interestCount: '+ 13.0K interesses',
    brandColor: '#ffe600',
    recentEventsCount: 17
  },
  // Pessoas
  {
    id: 'ent-sam-altman',
    name: 'Sam Altman',
    type: 'person',
    sector: 'Executivo · Tecnologia',
    role: 'CEO da OpenAI',
    description: 'Executivo e investidor à frente do desenvolvimento de inteligência artificial de ponta.',
    isFollowed: true,
    interestCount: '+ 8.2K interesses',
    brandColor: '#10a37f'
  },
  {
    id: 'ent-jensen-huang',
    name: 'Jensen Huang',
    type: 'person',
    sector: 'CEO · Tecnologia',
    role: 'CEO da NVIDIA',
    description: 'Cofundador e presidente executivo da NVIDIA, liderando a era da computação acelerada.',
    isFollowed: true,
    interestCount: '+ 7.8K interesses',
    brandColor: '#76b900'
  },
  {
    id: 'ent-elon-musk',
    name: 'Elon Musk',
    type: 'person',
    sector: 'Executivo · Tecnologia & Espaço',
    role: 'CEO da Tesla e SpaceX',
    description: 'Líder empresarial à frente da Tesla, SpaceX, Neuralink e X.',
    isFollowed: false,
    interestCount: '+ 9.5K interesses',
    brandColor: '#ffffff'
  },
  {
    id: 'ent-fernando-haddad',
    name: 'Fernando Haddad',
    type: 'person',
    sector: 'Ministro · Economia',
    role: 'Ministro da Fazenda',
    description: 'Comandante da equipe econômica brasileira e condutor da agenda fiscal e tributária.',
    isFollowed: true,
    interestCount: '+ 6.1K interesses',
    brandColor: '#002b49'
  },
  {
    id: 'ent-roberto-campos',
    name: 'Roberto Campos Neto',
    type: 'person',
    sector: 'Economista · Finanças',
    role: 'Ex-Presidente do Banco Central',
    description: 'Economista responsável pela implementação do PIX e autonomia operacional do Banco Central.',
    isFollowed: false,
    interestCount: '+ 5.4K interesses',
    brandColor: '#2563eb'
  },
  {
    id: 'ent-tim-cook',
    name: 'Tim Cook',
    type: 'person',
    sector: 'CEO · Tecnologia',
    role: 'CEO da Apple',
    description: 'Diretor executivo da Apple Inc. liderando a expansão global de serviços e dispositivos.',
    isFollowed: false,
    interestCount: '+ 4.9K interesses',
    brandColor: '#a1a1aa'
  },
  // Organizações
  {
    id: 'ent-banco-central',
    name: 'Banco Central do Brasil',
    type: 'organization',
    sector: 'Autoridade Monetária',
    description: 'Regulador do sistema financeiro nacional e guardião da estabilidade da moeda.',
    website: 'https://bcb.gov.br',
    isFollowed: true,
    interestCount: '+ 7.5K interesses',
    brandColor: '#2563eb'
  },
  {
    id: 'ent-governo-br',
    name: 'Governo Federal',
    type: 'organization',
    sector: 'Poder Executivo',
    description: 'Administração pública federal brasileira e ministérios de Estado.',
    website: 'https://gov.br',
    isFollowed: true,
    interestCount: '+ 8.0K interesses',
    brandColor: '#16a34a'
  },
  {
    id: 'ent-stf',
    name: 'Supremo Tribunal Federal',
    type: 'organization',
    sector: 'Poder Judiciário',
    description: 'Guardião da Constituição e instância máxima do Judiciário brasileiro.',
    website: 'https://stf.jus.br',
    isFollowed: false,
    interestCount: '+ 6.3K interesses',
    brandColor: '#475569'
  },
  {
    id: 'ent-uniao-europeia',
    name: 'União Europeia',
    type: 'organization',
    sector: 'Bloco Econômico',
    description: 'Comunidade política e econômica de 27 estados membros na Europa.',
    website: 'https://europa.eu',
    isFollowed: false,
    interestCount: '+ 5.2K interesses',
    brandColor: '#003399'
  },
  {
    id: 'ent-onu',
    name: 'ONU',
    type: 'organization',
    sector: 'Organização Internacional',
    description: 'Organização das Nações Unidas para paz, segurança e cooperação global.',
    website: 'https://un.org',
    isFollowed: false,
    interestCount: '+ 4.7K interesses',
    brandColor: '#009edb'
  }
];

export const INITIAL_TOPICS: Topic[] = [
  {
    id: 'top-ia',
    name: 'Inteligência Artificial',
    slug: 'inteligencia-artificial',
    category: 'Tema',
    description: 'Avanços, pesquisa, empresas e regulação de IA.',
    isFollowed: true,
    interestCount: '+ 8.1K interesses',
    brandColor: '#9333ea',
    recentEventsCount: 28
  },
  {
    id: 'top-economia',
    name: 'Economia',
    slug: 'economia',
    category: 'Tema',
    description: 'Mercados, indicadores, política econômica e cenário global.',
    isFollowed: true,
    interestCount: '+ 9.8K interesses',
    brandColor: '#2563eb',
    recentEventsCount: 34
  },
  {
    id: 'top-brasil',
    name: 'Brasil',
    slug: 'brasil',
    category: 'País · Política',
    description: 'Notícias, política, economia e acontecimentos no Brasil.',
    isFollowed: true,
    interestCount: '+ 5.8K interesses',
    brandColor: '#16a34a',
    recentEventsCount: 42
  },
  {
    id: 'top-matematica',
    name: 'Matemática',
    slug: 'matematica',
    category: 'Tema',
    description: 'Educação, métodos de estudo e conteúdos de matemática.',
    isFollowed: true,
    interestCount: '+ 4.2K interesses',
    brandColor: '#4f46e5',
    recentEventsCount: 7
  },
  {
    id: 'top-bitcoin',
    name: 'Bitcoin',
    slug: 'bitcoin',
    category: 'Tema · Finanças',
    description: 'Criptomoeda descentralizada e ecossistema de ativos digitais.',
    isFollowed: true,
    interestCount: '+ 6.2K interesses',
    brandColor: '#f7931a',
    recentEventsCount: 19
  },
  {
    id: 'top-semicondutores',
    name: 'Semicondutores',
    slug: 'semicondutores',
    category: 'Tema · Tecnologia',
    description: 'Cadeia de suprimentos de silício, litografia avançada e chips.',
    isFollowed: true,
    interestCount: '+ 6.8K interesses',
    brandColor: '#76b900',
    recentEventsCount: 11
  }
];

export const INITIAL_SOURCES: Source[] = [
  {
    id: 'src-reuters',
    name: 'Reuters',
    domain: 'reuters.com',
    category: 'Fonte de Notícias',
    isFollowed: true,
    interestCount: '+ 11.2K interesses',
    brandColor: '#ff8000',
    recentEventsCount: 120
  },
  {
    id: 'src-bloomberg',
    name: 'Bloomberg',
    domain: 'bloomberg.com',
    category: 'Mercados Financeiros',
    isFollowed: true,
    interestCount: '+ 10.4K interesses',
    brandColor: '#1d1d1d',
    recentEventsCount: 98
  },
  {
    id: 'src-cnbc',
    name: 'CNBC',
    domain: 'cnbc.com',
    category: 'Negócios Globais',
    isFollowed: true,
    interestCount: '+ 8.9K interesses',
    brandColor: '#005596',
    recentEventsCount: 64
  },
  {
    id: 'src-cnn',
    name: 'CNN Brasil',
    domain: 'cnnbrasil.com.br',
    category: 'Notícias',
    isFollowed: false,
    interestCount: '+ 7.8K interesses',
    brandColor: '#cc0000',
    recentEventsCount: 52
  },
  {
    id: 'src-valor',
    name: 'Valor Econômico',
    domain: 'valor.globo.com',
    category: 'Economia',
    isFollowed: false,
    interestCount: '+ 9.1K interesses',
    brandColor: '#004b87',
    recentEventsCount: 75
  }
];

export const EXPLORE_CATEGORIES = [
  { id: 'cat-macro', name: 'Macro & Mercados', interestsCount: '15.8K interesses', icon: 'chart' },
  { id: 'cat-reg', name: 'Regulação & Políticas Públicas', interestsCount: '12.1K interesses', icon: 'landmark' },
  { id: 'cat-corp', name: 'M&A & Finanças Corporativas', interestsCount: '10.4K interesses', icon: 'coins' },
  { id: 'cat-tech', name: 'Tech & Inovação', interestsCount: '14.2K interesses', icon: 'laptop' },
  { id: 'cat-energy', name: 'Energia & Commodities', interestsCount: '8.9K interesses', icon: 'flame' },
  { id: 'cat-global', name: 'Geopolítica Global', interestsCount: '7.3K interesses', icon: 'globe' }
];

export const EXPLORE_TRENDING_ITEMS = [
  { rank: 1, id: 'ent-nvidia', name: 'NVIDIA', type: 'Empresa', category: 'Tecnologia', interestCount: '+ 12K interesses', brandColor: '#76b900', isFollowed: true },
  { rank: 2, id: 'ent-openai', name: 'OpenAI', type: 'Empresa', category: 'Inteligência Artificial', interestCount: '+ 9.4K interesses', brandColor: '#10a37f', isFollowed: true },
  { rank: 3, id: 'top-ia', name: 'Inteligência Artificial', type: 'Tema', category: 'Tecnologia', interestCount: '+ 8.1K interesses', brandColor: '#9333ea', isFollowed: true },
  { rank: 4, id: 'top-bitcoin', name: 'Bitcoin', type: 'Tema', category: 'Finanças', interestCount: '+ 6.2K interesses', brandColor: '#f7931a', isFollowed: true },
  { rank: 5, id: 'top-brasil', name: 'Brasil', type: 'País', category: 'Política', interestCount: '+ 5.8K interesses', brandColor: '#16a34a', isFollowed: true },
  { rank: 6, id: 'ent-apple', name: 'Apple', type: 'Empresa', category: 'Tecnologia', interestCount: '+ 5.1K interesses', brandColor: '#ffffff', isFollowed: false }
];

export const INITIAL_EVENTS: Event[] = [
  {
    id: 'evt-apple-iphone-17',
    title: 'Apple apresenta nova linha de iPhone 17',
    summary: 'Empresa anunciou novos modelos e melhorias em câmera, desempenho e bateria para a linha iPhone 17.',
    whatHappened: 'Em evento global na Califórnia, a Apple apresentou oficialmente a família iPhone 17 com chips A19 Pro, display OLED aprimorado, maior integração neural para processamento local e nova arquitetura térmica.',
    whyItMatters: 'O lançamento movimenta o mercado global de semicondutores, fornecedores asiáticos e dita tendências para a indústria de eletrônicos de consumo no último trimestre do ano.',
    marketImpact: 'Alavanca margens na cadeia de semicondutores e dita a demanda por chips neurais na TSMC e fornecedores globais.',
    nextSteps: 'Monitorar os números de pré-venda nas primeiras 72 horas e relatórios de analistas de Wall Street.',
    category: 'Tecnologia',
    relativeTime: 'há 2 horas',
    publishedAt: '2026-10-10T12:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 98,
    isSaved: true,
    savedAt: '2026-10-10T12:05:00Z',
    isViewed: false,
    entities: [INITIAL_ENTITIES[2]],
    topics: [INITIAL_TOPICS[0]],
    featuredSourceLogos: [
      { name: 'Bloomberg', color: '#1d1d1d', label: 'BBG' },
      { name: 'The Verge', color: '#e5125b', label: 'Verge' },
      { name: 'Reuters', color: '#ff8000', label: 'R' }
    ],
    sources: [
      {
        id: 'sref-apple-1',
        sourceName: 'The Verge',
        domain: 'theverge.com',
        headline: 'Apple unveils iPhone 17 lineup with thinner design and faster chips',
        url: 'https://theverge.com/apple-iphone-17',
        publishedAt: 'há 2 horas'
      },
      {
        id: 'sref-apple-2',
        sourceName: 'Bloomberg',
        domain: 'bloomberg.com',
        headline: 'Apple introduces iPhone 17 aiming to spark holiday upgrade cycle',
        url: 'https://bloomberg.com/apple-iphone-17-launch',
        publishedAt: 'há 2 horas'
      },
      {
        id: 'sref-apple-3',
        sourceName: 'Reuters',
        domain: 'reuters.com',
        headline: 'Apple debuts new iPhone 17 smartphones focused on on-device AI',
        url: 'https://reuters.com/apple-iphone-17',
        publishedAt: 'há 3 horas'
      },
      {
        id: 'sref-apple-4',
        sourceName: 'CNBC',
        domain: 'cnbc.com',
        headline: 'Apple announces iPhone 17 pricing and availability dates',
        url: 'https://cnbc.com/apple-iphone-17-announcement',
        publishedAt: 'há 3 horas'
      },
      {
        id: 'sref-apple-5',
        sourceName: 'TechCrunch',
        domain: 'techcrunch.com',
        headline: 'Everything announced at Apple special keynote',
        url: 'https://techcrunch.com/apple-keynote-recap',
        publishedAt: 'há 3 horas'
      }
    ],
    timeline: [
      {
        id: 'tl-ap-1',
        date: 'Hoje',
        time: '14:00',
        title: 'Abertura do keynote oficial',
        description: 'Tim Cook apresenta as diretrizes de inovação para hardware e serviços.'
      }
    ]
  },
  {
    id: 'evt-governo-pacote-fiscal',
    title: 'Governo anuncia novo pacote fiscal',
    summary: 'Medidas incluem mudanças em impostos e revisão de despesas para os próximos anos.',
    whatHappened: 'A equipe econômica detalhou no Palácio do Planalto uma proposta ampla para reestruturação orçamentária, incluindo revisão de renúncias setoriais e reforço de arrecadação sustentável.',
    whyItMatters: 'As medidas impactam diretamente a percepção de risco fiscal do Brasil, com reflexos no câmbio, curva de juros do Banco Central e investimentos produtivos.',
    marketImpact: 'Impacta diretamente a curva de juros DI futura, o índice Ibovespa e as decisões de alocação de gestores de fundos macro.',
    nextSteps: 'Acompanhar a tramitação no Congresso, reações das lideranças partidárias e eventuais notas técnicas do setor produtivo.',
    category: 'Política',
    relativeTime: 'há 5 horas',
    publishedAt: '2026-10-10T09:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 94,
    isSaved: true,
    savedAt: '2026-10-10T09:30:00Z',
    isViewed: true,
    viewedAt: '2026-10-10T10:15:00Z',
    entities: [INITIAL_ENTITIES[3]],
    topics: [INITIAL_TOPICS[2]],
    featuredSourceLogos: [
      { name: 'Folha', color: '#003366', label: 'Folha' },
      { name: 'Valor', color: '#004b87', label: 'Valor' },
      { name: 'g1', color: '#c4170c', label: 'g1' }
    ],
    sources: [
      {
        id: 'sref-gov-1',
        sourceName: 'Valor Econômico',
        domain: 'valor.globo.com',
        headline: 'Fazenda apresenta pacote fiscal com metas de equilíbrio orçamentário',
        url: 'https://valor.globo.com/brasil/pacote-fiscal-governo',
        publishedAt: 'há 5 horas'
      },
      {
        id: 'sref-gov-2',
        sourceName: 'Folha de S.Paulo',
        domain: 'folha.uol.com.br',
        headline: 'Governo propõe medidas para corte de gastos e recomposição de receitas',
        url: 'https://folha.uol.com.br/mercado/governo-novo-pacote-fiscal',
        publishedAt: 'há 5 horas'
      }
    ],
    timeline: [
      {
        id: 'tl-gov-1',
        date: 'Hoje',
        time: '11:00',
        title: 'Coletiva de imprensa da Fazenda',
        description: 'Apresentação dos principais pontos da matéria ao Congresso Nacional.'
      }
    ]
  },
  {
    id: 'evt-ue-regras-ia',
    title: 'União Europeia aprova novas regras para IA',
    summary: 'Regulamento estabelece diretrizes mais rígidas para o desenvolvimento e uso de sistemas de inteligência artificial.',
    whatHappened: 'O Parlamento Europeu e os estados-membros ratificaram a fase final das exigências de transparência, auditoria de modelos de fundação e proteção de dados para sistemas de IA generativa.',
    whyItMatters: 'O marco europeu serve de referência global (Efeito Bruxelas) e obriga multinacionais de tecnologia a adaptarem sistemas antes de operar no continente.',
    category: 'Mundo',
    relativeTime: 'há 1 dia',
    publishedAt: '2026-10-09T14:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 91,
    isSaved: true,
    savedAt: '2026-10-09T14:30:00Z',
    isViewed: false,
    entities: [],
    topics: [INITIAL_TOPICS[0]],
    featuredSourceLogos: [
      { name: 'Financial Times', color: '#fcd0a1', label: 'FT' },
      { name: 'Reuters', color: '#ff8000', label: 'R' },
      { name: 'Politico', color: '#002b49', label: 'Politico' }
    ],
    sources: [
      {
        id: 'sref-ue-1',
        sourceName: 'Financial Times',
        domain: 'ft.com',
        headline: 'EU approves groundbreaking Artificial Intelligence Act standards',
        url: 'https://ft.com/eu-ai-act-approval',
        publishedAt: 'há 1 dia'
      }
    ],
    timeline: [
      {
        id: 'tl-ue-1',
        date: 'Ontem',
        time: '16:00',
        title: 'Votação no plenário em Estrasburgo',
        description: 'Texto aprovado por ampla maioria dos parlamentares europeus.'
      }
    ]
  },
  {
    id: 'evt-brasil-copa-2026',
    title: 'Brasil se classifica para a Copa de 2026',
    summary: 'Seleção garante vaga após vitória em casa e mantém sequência positiva nas eliminatórias.',
    whatHappened: 'Com vitória por 2 a 0 em partida disputada no Maracanã, a Seleção Brasileira atingiu a pontuação matemática necessária para garantir a vaga antecipada no Mundial de 2026.',
    whyItMatters: 'A classificação confirma a continuidade histórica da única seleção presente em todas as edições de Copas do Mundo e traz estabilidade ao planejamento técnico.',
    category: 'Esportes',
    relativeTime: 'há 1 dia',
    publishedAt: '2026-10-09T12:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 89,
    isSaved: true,
    savedAt: '2026-10-09T12:30:00Z',
    isViewed: true,
    viewedAt: '2026-10-09T16:00:00Z',
    entities: [],
    topics: [],
    featuredSourceLogos: [
      { name: 'ge', color: '#00b049', label: 'ge' },
      { name: 'ESPN', color: '#cc0000', label: 'ESPN' }
    ],
    sources: [
      {
        id: 'sref-br-1',
        sourceName: 'ge.globo',
        domain: 'ge.globo.com',
        headline: 'Brasil vence com autoridade e carimba passaporte para o Mundial de 2026',
        url: 'https://ge.globo.com/futebol/brasil-classificado-copa-2026',
        publishedAt: 'há 1 dia'
      }
    ],
    timeline: [
      {
        id: 'tl-br-1',
        date: 'Ontem',
        time: '23:30',
        title: 'Apito final no Maracanã',
        description: 'Festa da torcida celebra vaga matemática garantida.'
      }
    ]
  },
  {
    id: 'evt-bitcoin-70k',
    title: 'Bitcoin volta a subir e ultrapassa US$ 70 mil',
    summary: 'Criptomoeda registra alta impulsionada por entrada de capital institucional e expectativas de cortes de juros nos EUA.',
    whatHappened: 'O Bitcoin superou o patamar de US$ 70.000 após fortes influxos líquidos em ETFs de mercado à vista e aumento de posições em tesourarias corporativas globais.',
    whyItMatters: 'A retomada do nível de US$ 70k consolida a classe de ativos digitais nas carteiras institucionais e reativa volumes em plataformas de negociação.',
    category: 'Finanças',
    relativeTime: 'há 2 dias',
    publishedAt: '2026-10-08T18:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 92,
    isSaved: true,
    savedAt: '2026-10-08T18:30:00Z',
    isViewed: false,
    entities: [],
    topics: [],
    featuredSourceLogos: [
      { name: 'CoinDesk', color: '#ffb300', label: 'CD' },
      { name: 'Bloomberg', color: '#1d1d1d', label: 'BBG' }
    ],
    sources: [
      {
        id: 'sref-btc-1',
        sourceName: 'CoinDesk',
        domain: 'coindesk.com',
        headline: 'Bitcoin tops $70,000 as institutional demand accelerates',
        url: 'https://coindesk.com/markets/bitcoin-crosses-70k',
        publishedAt: 'há 2 dias'
      }
    ],
    timeline: [
      {
        id: 'tl-btc-1',
        date: '08 Out 2026',
        time: '18:00',
        title: 'Rompimento da resistência técnica de US$ 70 mil',
        description: 'Volume recorde registrado nas exchanges globais.'
      }
    ]
  },
  {
    id: 'evt-stf-marco-regulatorio',
    title: 'STF retoma julgamento sobre marco regulatório',
    summary: 'Julgamento pode definir novas regras para o setor de tecnologia no país.',
    whatHappened: 'O Supremo Tribunal Federal retomou a votação sobre a responsabilização de plataformas digitais por conteúdos de terceiros e diretrizes de moderação.',
    whyItMatters: 'O resultado impacta diretamente a governança da internet no Brasil, a responsabilidade civil das big techs e a liberdade de expressão dos usuários.',
    category: 'Política',
    relativeTime: 'há 1 hora',
    publishedAt: '2026-10-10T13:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 96,
    isSaved: false,
    isViewed: true,
    viewedAt: '2026-10-10T13:40:00Z',
    entities: [
      {
        id: 'ent-stf',
        name: 'STF',
        type: 'organization',
        description: 'Supremo Tribunal Federal do Brasil.',
        isFollowed: true
      }
    ],
    topics: [
      {
        id: 'top-pol',
        name: 'Política',
        slug: 'politica',
        category: 'Política',
        description: 'Cobertura política e regulação.',
        isFollowed: true
      },
      {
        id: 'top-reg',
        name: 'Regulação',
        slug: 'regulacao',
        category: 'Política',
        description: 'Marcos regulatórios e normas jurídicas.',
        isFollowed: true
      }
    ],
    featuredSourceLogos: [
      { name: 'g1', color: '#c4170c', label: 'g1' },
      { name: 'Folha', color: '#003366', label: 'Folha' },
      { name: 'CNN', color: '#cc0000', label: 'CNN' }
    ],
    sources: [
      { id: 's-stf-1', sourceName: 'g1', domain: 'g1.globo.com', headline: 'STF retoma análise do Marco Civil da Internet', url: '#', publishedAt: 'há 1 hora' },
      { id: 's-stf-2', sourceName: 'Folha de S.Paulo', domain: 'folha.uol.com.br', headline: 'Ministros debatem regras de moderação para redes sociais', url: '#', publishedAt: 'há 1 hora' },
      { id: 's-stf-3', sourceName: 'CNN Brasil', domain: 'cnnbrasil.com.br', headline: 'Julgamento do marco regulatório atrai atenção de big techs', url: '#', publishedAt: 'há 2 horas' },
      { id: 's-stf-4', sourceName: 'JOTA', domain: 'jota.info', headline: 'Voto do relator propõe equilíbrio entre liberdade e dever de cuidado', url: '#', publishedAt: 'há 2 horas' },
      { id: 's-stf-5', sourceName: 'Valor Econômico', domain: 'valor.globo.com', headline: 'Impacto regulatório mobiliza setor de tecnologia', url: '#', publishedAt: 'há 2 horas' },
      { id: 's-stf-6', sourceName: 'Estadão', domain: 'estadao.com.br', headline: 'Sessão plenária discute artigo 19 do Marco Civil', url: '#', publishedAt: 'há 2 horas' },
      { id: 's-stf-7', sourceName: 'Poder360', domain: 'poder360.com.br', headline: 'Plenário deve concluir voto nas próximas sessões', url: '#', publishedAt: 'há 3 horas' }
    ],
    timeline: []
  },
  {
    id: 'evt-dolar-inflacao-eua',
    title: 'Dólar recua após dados de inflação nos EUA',
    summary: 'Dados mostram desaceleração da inflação, o que influencia expectativas sobre juros.',
    whatHappened: 'O índice de preços ao consumidor (CPI) norte-americano veio abaixo do projetado, reforçando apostas em flexibilização monetária pelo Federal Reserve e provocando desvalorização da moeda americana frente ao real.',
    whyItMatters: 'A queda do dólar melhora o controle inflacionário brasileiro e barateia importações industriais e de alimentos.',
    category: 'Mercado',
    relativeTime: 'há 3 horas',
    publishedAt: '2026-10-10T11:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1580519542036-c47de6196ba5?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 93,
    isSaved: false,
    isViewed: true,
    viewedAt: '2026-10-10T11:30:00Z',
    entities: [
      {
        id: 'ent-eua',
        name: 'EUA',
        type: 'organization',
        description: 'Estados Unidos da América.',
        isFollowed: true
      }
    ],
    topics: [
      {
        id: 'top-merc',
        name: 'Mercado',
        slug: 'mercado',
        category: 'Economia',
        description: 'Mercados de capitais e moedas.',
        isFollowed: true
      },
      {
        id: 'top-econ',
        name: 'Economia',
        slug: 'economia',
        category: 'Economia',
        description: 'Indicadores macroeconômicos e juros.',
        isFollowed: true
      }
    ],
    featuredSourceLogos: [
      { name: 'Valor', color: '#004b87', label: 'Valor' },
      { name: 'Bloomberg', color: '#1d1d1d', label: 'BBG' },
      { name: 'Reuters', color: '#ff8000', label: 'R' }
    ],
    sources: [
      { id: 's-dol-1', sourceName: 'Valor Econômico', domain: 'valor.globo.com', headline: 'Dólar cai para R$ 5,38 com dados benéficos de inflação nos EUA', url: '#', publishedAt: 'há 3 horas' },
      { id: 's-dol-2', sourceName: 'Bloomberg', domain: 'bloomberg.com', headline: 'US CPI cooldown weighs on greenback across emerging FX', url: '#', publishedAt: 'há 3 horas' },
      { id: 's-dol-3', sourceName: 'Reuters', domain: 'reuters.com', headline: 'Dollar slips as investors price in fed interest rate reductions', url: '#', publishedAt: 'há 3 horas' },
      { id: 's-dol-4', sourceName: 'InfoMoney', domain: 'infomoney.com.br', headline: 'Ibovespa sobe e dólar recua em dia positivo no exterior', url: '#', publishedAt: 'há 4 horas' },
      { id: 's-dol-5', sourceName: 'CNBC', domain: 'cnbc.com', headline: 'Cooling inflation sparks relief rally in world markets', url: '#', publishedAt: 'há 4 horas' },
      { id: 's-dol-6', sourceName: 'Exame', domain: 'exame.com', headline: 'Alívio cambial reabre espaço para cortes do Copom', url: '#', publishedAt: 'há 4 horas' }
    ],
    timeline: []
  },
  {
    id: 'evt-openai-modelo-empresas',
    title: 'OpenAI lança novo modelo de IA para empresas',
    summary: 'Modelo traz avanços em raciocínio e suporte a aplicações corporativas.',
    whatHappened: 'A OpenAI anunciou o lançamento de nova versão da sua arquitetura neural com foco em agentes autônomos corporativos, maior janela de contexto e rígidas diretrizes de privacidade empresarial.',
    whyItMatters: 'A disputa entre os principais laboratórios de IA se acirra no segmento corporativo, disputando grandes contratos de infraestrutura e consultoria digital.',
    category: 'Tecnologia',
    relativeTime: 'há 5 horas',
    publishedAt: '2026-10-10T09:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 97,
    isSaved: false,
    isViewed: true,
    viewedAt: '2026-10-10T09:45:00Z',
    entities: [
      {
        id: 'ent-openai',
        name: 'OpenAI',
        type: 'company',
        description: 'Laboratório de pesquisa em inteligência artificial.',
        isFollowed: true
      }
    ],
    topics: [
      {
        id: 'top-ia-2',
        name: 'IA',
        slug: 'ia',
        category: 'Tecnologia',
        description: 'Tecnologias de inteligência artificial generativa.',
        isFollowed: true
      },
      {
        id: 'top-tec-2',
        name: 'Tecnologia',
        slug: 'tecnologia',
        category: 'Tecnologia',
        description: 'Inovações e produtos digitais corporativos.',
        isFollowed: true
      }
    ],
    featuredSourceLogos: [
      { name: 'The Verge', color: '#e5125b', label: 'Verge' },
      { name: 'TechCrunch', color: '#00a562', label: 'TC' },
      { name: 'Wired', color: '#000000', label: 'Wired' }
    ],
    sources: [
      { id: 's-op-1', sourceName: 'The Verge', domain: 'theverge.com', headline: 'OpenAI introduces enterprise AI reasoning model', url: '#', publishedAt: 'há 5 horas' },
      { id: 's-op-2', sourceName: 'TechCrunch', domain: 'techcrunch.com', headline: 'OpenAI targets business workflows with newest model deployment', url: '#', publishedAt: 'há 5 horas' },
      { id: 's-op-3', sourceName: 'Wired', domain: 'wired.com', headline: 'Inside OpenAI push to dominate corporate software ecosystems', url: '#', publishedAt: 'há 5 horas' },
      { id: 's-op-4', sourceName: 'Reuters', domain: 'reuters.com', headline: 'OpenAI releases upgraded enterprise AI solution', url: '#', publishedAt: 'há 6 horas' },
      { id: 's-op-5', sourceName: 'Financial Times', domain: 'ft.com', headline: 'Big tech and AI startups battle for enterprise cloud contracts', url: '#', publishedAt: 'há 6 horas' },
      { id: 's-op-6', sourceName: 'Bloomberg', domain: 'bloomberg.com', headline: 'OpenAI expands B2B capabilities with advanced reasoning agents', url: '#', publishedAt: 'há 6 horas' },
      { id: 's-op-7', sourceName: 'The Information', domain: 'theinformation.com', headline: 'OpenAI enterprise customer roster expands following release', url: '#', publishedAt: 'há 6 horas' },
      { id: 's-op-8', sourceName: 'VentureBeat', domain: 'venturebeat.com', headline: 'Security and governance prioritized in OpenAI newest architecture', url: '#', publishedAt: 'há 7 horas' },
      { id: 's-op-9', sourceName: 'Ars Technica', domain: 'arstechnica.com', headline: 'Benchmark comparisons highlight efficiency leaps in enterprise AI', url: '#', publishedAt: 'há 7 horas' }
    ],
    timeline: []
  },
  {
    id: 'evt-google-workspace-ia',
    title: 'Google anuncia novos recursos de IA no Workspace',
    summary: 'Novas ferramentas prometem aumentar a produtividade e automatizar fluxos de trabalho.',
    whatHappened: 'O Google apresentou integrações profundas do Gemini no Docs, Sheets e Gmail para criação automática de relatórios, síntese de reuniões e automações de planilhas complexas.',
    whyItMatters: 'A concorrência com a Microsoft 365 Copilot se intensifica pelo domínio das suítes de produtividade no ambiente corporativo.',
    category: 'Tecnologia',
    relativeTime: 'há 1 dia',
    publishedAt: '2026-10-09T10:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1572021335469-31706a17aaef?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 90,
    isSaved: true,
    savedAt: '2026-10-09T11:00:00Z',
    isViewed: false,
    entities: [
      {
        id: 'ent-google',
        name: 'Google',
        type: 'company',
        description: 'Multinacional de tecnologia e software.',
        isFollowed: true
      }
    ],
    topics: [
      {
        id: 'top-prod',
        name: 'Produtividade',
        slug: 'produtividade',
        category: 'Tecnologia',
        description: 'Ferramentas de escritório e colaboração.',
        isFollowed: true
      }
    ],
    sources: [
      { id: 's-gg-1', sourceName: 'The Verge', domain: 'theverge.com', headline: 'Google enhances Workspace with next-gen automated AI features', url: '#', publishedAt: 'há 1 dia' },
      { id: 's-gg-2', sourceName: 'CNET', domain: 'cnet.com', headline: 'Google Workspace gets big AI boost to challenge Microsoft Copilot', url: '#', publishedAt: 'há 1 dia' },
      { id: 's-gg-3', sourceName: 'TechCrunch', domain: 'techcrunch.com', headline: 'Workspace users gain automated workflow agents', url: '#', publishedAt: 'há 1 dia' },
      { id: 's-gg-4', sourceName: 'Forbes', domain: 'forbes.com', headline: 'How Google new tools are changing enterprise office work', url: '#', publishedAt: 'há 1 dia' }
    ],
    timeline: []
  },
  {
    id: 'evt-anvisa-diabetes',
    title: 'Anvisa aprova novo medicamento para diabetes',
    summary: 'Aprovação amplia opções terapêuticas para controle glicêmico e redução de peso.',
    whatHappened: 'A Agência Nacional de Vigilância Sanitária autorizou a comercialização de um novo agonista hormonal duplo com alta eficácia comprovada em estudos clínicos para pacientes com diabetes tipo 2 e obesidade.',
    whyItMatters: 'A medida amplia o acesso a tratamentos de ponta no país e fomenta a concorrência na indústria farmacêutica brasileira.',
    category: 'Saúde',
    relativeTime: 'há 2 dias',
    publishedAt: '2026-10-08T15:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 89,
    isSaved: true,
    savedAt: '2026-10-08T16:00:00Z',
    isViewed: true,
    viewedAt: '2026-10-08T17:30:00Z',
    entities: [
      {
        id: 'ent-anvisa',
        name: 'Anvisa',
        type: 'organization',
        description: 'Agência Nacional de Vigilância Sanitária.',
        isFollowed: true
      }
    ],
    topics: [
      {
        id: 'top-saude',
        name: 'Saúde',
        slug: 'saude',
        category: 'Saúde',
        description: 'Medicina, ensaios clínicos e vigilância sanitária.',
        isFollowed: true
      }
    ],
    sources: [
      { id: 's-anv-1', sourceName: 'g1 Saúde', domain: 'g1.globo.com', headline: 'Anvisa dá sinal verde para novo fármaco para diabetes tipo 2', url: '#', publishedAt: 'há 2 dias' },
      { id: 's-anv-2', sourceName: 'Folha de S.Paulo', domain: 'folha.uol.com.br', headline: 'Entenda os benefícios do novo medicamento autorizado pela Anvisa', url: '#', publishedAt: 'há 2 dias' },
      { id: 's-anv-3', sourceName: 'CNN Brasil', domain: 'cnnbrasil.com.br', headline: 'Droga demonstrou redução consistente de hemoglobina glicada', url: '#', publishedAt: 'há 2 dias' },
      { id: 's-anv-4', sourceName: 'Estadão', domain: 'estadao.com.br', headline: 'Endocrinologistas celebram chegada da nova opção de tratamento', url: '#', publishedAt: 'há 2 dias' },
      { id: 's-anv-5', sourceName: 'Veja Saúde', domain: 'saude.abril.com.br', headline: 'Avanço contra diabetes ganha novo aliado no Brasil', url: '#', publishedAt: 'há 2 dias' },
      { id: 's-anv-6', sourceName: 'BBC Brasil', domain: 'bbc.com', headline: 'Resultados de ensaios clínicos animam comunidade científica', url: '#', publishedAt: 'há 2 dias' },
      { id: 's-anv-7', sourceName: 'O Globo', domain: 'oglobo.globo.com', headline: 'Remédio deve chegar às farmácias no primeiro semestre de 2027', url: '#', publishedAt: 'há 2 dias' },
      { id: 's-anv-8', sourceName: 'Jornal do Commercio', domain: 'jc.ne10.uol.com.br', headline: 'Impactos no tratamento de doenças metabólicas crônicas', url: '#', publishedAt: 'há 2 dias' }
    ],
    timeline: []
  },
  {
    id: 'evt-petrobras-investimentos',
    title: 'Petrobras anuncia novo plano de investimentos',
    summary: 'Plano foca em transição energética gradual e aumento da produção offshore.',
    whatHappened: 'A Petrobras apresentou seu Plano Estratégico quinquenal com aportes prioritários no pré-sal da Bacia de Santos e projetos pilotos de eólica offshore e hidrogênio sustentável.',
    whyItMatters: 'A estatal movimenta uma das maiores cadeias industriais de bens e serviços do país, influenciando estaleiros, fornecedores locais e dividendos públicos.',
    category: 'Mercado',
    relativeTime: 'há 3 dias',
    publishedAt: '2026-10-07T14:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 92,
    isSaved: true,
    savedAt: '2026-10-07T14:30:00Z',
    isViewed: false,
    entities: [
      {
        id: 'ent-petrobras',
        name: 'Petrobras',
        type: 'company',
        description: 'Empresa brasileira de energia e petróleo.',
        isFollowed: true
      }
    ],
    topics: [
      {
        id: 'top-energia',
        name: 'Energia',
        slug: 'energia',
        category: 'Economia',
        description: 'Setor elétrico, óleo e gás e transição energética.',
        isFollowed: true
      }
    ],
    sources: [
      { id: 's-pet-1', sourceName: 'Valor Econômico', domain: 'valor.globo.com', headline: 'Petrobras prevê US$ 102 bilhões em plano para os próximos 5 anos', url: '#', publishedAt: 'há 3 dias' },
      { id: 's-pet-2', sourceName: 'Reuters', domain: 'reuters.com', headline: 'Petrobras unveils strategic plan balancing offshore exploration and renewables', url: '#', publishedAt: 'há 3 dias' },
      { id: 's-pet-3', sourceName: 'Bloomberg', domain: 'bloomberg.com', headline: 'Brazil state oil giant details capital expenditures roadmap', url: '#', publishedAt: 'há 3 dias' },
      { id: 's-pet-4', sourceName: 'Folha de S.Paulo', domain: 'folha.uol.com.br', headline: 'Foco no pré-sal garante rentabilidade da companhia', url: '#', publishedAt: 'há 3 dias' },
      { id: 's-pet-5', sourceName: 'g1', domain: 'g1.globo.com', headline: 'Projetos de descarbonização recebem fatia expressiva de recursos', url: '#', publishedAt: 'há 3 dias' },
      { id: 's-pet-6', sourceName: 'CNN Brasil', domain: 'cnnbrasil.com.br', headline: 'Mercado financeiro reage positivamente ao plano de disciplina de capital', url: '#', publishedAt: 'há 3 dias' },
      { id: 's-pet-7', sourceName: 'Estadão', domain: 'estadao.com.br', headline: 'Diretoria destaca compromisso com geração de valor sustentável', url: '#', publishedAt: 'há 3 dias' },
      { id: 's-pet-8', sourceName: 'InfoMoney', domain: 'infomoney.com.br', headline: 'Ações ordinárias e preferenciais sobem após conferência com investidores', url: '#', publishedAt: 'há 3 dias' },
      { id: 's-pet-9', sourceName: 'Exame', domain: 'exame.com', headline: 'Transição energética entra na pauta estruturante da petroleira', url: '#', publishedAt: 'há 3 dias' },
      { id: 's-pet-10', sourceName: 'Poder360', domain: 'poder360.com.br', headline: 'Ministério de Minas e Energia elogia diretrizes de segurança de suprimento', url: '#', publishedAt: 'há 3 dias' }
    ],
    timeline: []
  },
  {
    id: 'evt-eua-china-tarifas',
    title: 'Tensão entre EUA e China aumenta após novas tarifas',
    summary: 'Novas barreiras comerciais afetam cadeias globais de suprimentos e semicondutores.',
    whatHappened: 'Washington anunciou tarifas adicionais sobre veículos elétricos, baterias e ligas de aço chinesas, levando o Ministério do Comércio de Pequim a prometer medidas recíprocas na OMC.',
    whyItMatters: 'A escalada tarifária reacende incertezas sobre o comércio transfronteiriço, pressiona o frete marítimo e reacelera custos de insumos industriais no Ocidente.',
    category: 'Mundo',
    relativeTime: 'há 4 dias',
    publishedAt: '2026-10-06T12:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 94,
    isSaved: true,
    savedAt: '2026-10-06T12:30:00Z',
    isViewed: false,
    entities: [
      {
        id: 'ent-china',
        name: 'China',
        type: 'organization',
        description: 'República Popular da China.',
        isFollowed: true
      }
    ],
    topics: [
      {
        id: 'top-comercio',
        name: 'Comércio Global',
        slug: 'comercio-global',
        category: 'Mundo',
        description: 'Relações comerciais bilaterais e tarifas aduaneiras.',
        isFollowed: true
      }
    ],
    sources: [
      { id: 's-tar-1', sourceName: 'Financial Times', domain: 'ft.com', headline: 'US and China trade friction intensifies over clean tech tariffs', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-2', sourceName: 'Wall Street Journal', domain: 'wsj.com', headline: 'New trade curbs hit global supply networks for electronics', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-3', sourceName: 'Reuters', domain: 'reuters.com', headline: 'Beijing prepares retaliatory trade countermeasures following US sanctions', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-4', sourceName: 'Bloomberg', domain: 'bloomberg.com', headline: 'Tariff disputes rattle Asian stock indices and currency markets', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-5', sourceName: 'South China Morning Post', domain: 'scmp.com', headline: 'Commerce Ministry issues stern warning on bilateral ties', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-6', sourceName: 'The Economist', domain: 'economist.com', headline: 'The fracturing architecture of international trade agreements', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-7', sourceName: 'Le Monde', domain: 'lemonde.fr', headline: 'Europe watches carefully as transatlantic protectionism deepens', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-8', sourceName: 'Nikkei Asia', domain: 'asia.nikkei.com', headline: 'Supply chains pivot to Southeast Asia amidst geopolitical headwinds', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-9', sourceName: 'Valor Econômico', domain: 'valor.globo.com', headline: 'Impactos no agronegócio e na indústria de transformação brasileira', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-10', sourceName: 'Folha de S.Paulo', domain: 'folha.uol.com.br', headline: 'Especialistas analisam risco de estagflação em economias dependentes', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-11', sourceName: 'CNBC', domain: 'cnbc.com', headline: 'Tech sector braces for semiconductor export bottlenecks', url: '#', publishedAt: 'há 4 dias' },
      { id: 's-tar-12', sourceName: 'Foreign Policy', domain: 'foreignpolicy.com', headline: 'Geoeconomic competition enters a new high-stakes phase', url: '#', publishedAt: 'há 4 dias' }
    ],
    timeline: []
  },
  {
    id: 'evt-nvidia-4-trilhoes',
    title: 'NVIDIA atinge novo recorde de valor de mercado',
    summary: 'Empresa ultrapassa marca histórica impulsionada pela demanda por chips de IA.',
    whatHappened: 'As ações da Nvidia atingiram um novo recorde histórico, levando a empresa a ultrapassar a marca de US$ 4 trilhões em valor de mercado. O movimento foi impulsionado pela forte demanda por chips de IA e pelo otimismo do mercado em relação ao setor de tecnologia.',
    whyItMatters: 'Esse marco reforça o papel da Nvidia como uma das principais empresas do mundo e destaca a crescente importância da inteligência artificial na economia global, com reflexos em diversos setores, desde tecnologia até indústria e serviços.',
    category: 'Tecnologia',
    relativeTime: 'há 8 horas',
    publishedAt: '2026-10-10T06:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 99,
    isSaved: true,
    savedAt: '2026-10-10T06:30:00Z',
    isViewed: true,
    viewedAt: '2026-10-10T08:00:00Z',
    entities: [INITIAL_ENTITIES[0]],
    topics: [INITIAL_TOPICS[0]],
    featuredSourceLogos: [
      { name: 'Reuters', color: '#ff8000', label: 'R' },
      { name: 'CNBC', color: '#005596', label: 'CNBC' },
      { name: 'Bloomberg', color: '#1d1d1d', label: 'BBG' },
      { name: 'Estadão', color: '#002b49', label: 'Estadão' }
    ],
    sources: [
      {
        id: 'sref-1',
        sourceName: 'Reuters',
        domain: 'reuters.com',
        headline: 'Nvidia hits $4 trillion market value milestone',
        url: 'https://reuters.com/technology/nvidia-market-cap-record',
        publishedAt: 'há 2 h'
      },
      {
        id: 'sref-2',
        sourceName: 'CNBC',
        domain: 'cnbc.com',
        headline: 'Nvidia reaches $4 trillion as AI demand soars',
        url: 'https://cnbc.com/nvidia-4-trillion-mark',
        publishedAt: 'há 2 h'
      },
      {
        id: 'sref-3',
        sourceName: 'Bloomberg',
        domain: 'bloomberg.com',
        headline: 'Nvidia becomes first $4 trillion company',
        url: 'https://bloomberg.com/nvidia-record-valuation',
        publishedAt: 'há 3 h'
      },
      {
        id: 'sref-4',
        sourceName: 'Estadão',
        domain: 'estadao.com.br',
        headline: 'Nvidia ultrapassa US$ 4 trilhões em valor de mercado',
        url: 'https://estadao.com.br/economia/nvidia-ultrapassa-4-trilhoes',
        publishedAt: 'há 3 h'
      }
    ],
    timeline: [
      {
        id: 'tl-1',
        date: 'Hoje',
        time: 'há 2 h',
        title: 'Nvidia atinge US$ 4 trilhões em valor de mercado',
        description: 'Ações da empresa registram alta histórica.'
      },
      {
        id: 'tl-2',
        date: 'Hoje',
        time: 'há 5 h',
        title: 'Mercado reage positivamente',
        description: 'Investidores impulsionam ações após resultados e demanda por IA.'
      },
      {
        id: 'tl-3',
        date: 'Hoje',
        time: 'há 8 h',
        title: 'Analistas elevam projeções',
        description: 'Bancos revisam metas de preço para as ações da Nvidia.'
      }
    ]
  },
  {
    id: 'evt-dolar-recua-negociacoes',
    title: 'Dólar recua com otimismo global e avanço nas negociações',
    summary: 'Moeda americana fecha em queda após sinais positivos nas negociações entre EUA e China.',
    whatHappened: 'O dólar comercial registrou queda expressiva nesta sessão, cotado com alívio firme frente ao real e divisas emergentes, repercutindo dados mais brandos de inflação externa e rodadas construtivas de negociação diplomática e aduaneira entre autoridades de Washington e Pequim.',
    whyItMatters: 'A queda da moeda norte-americana reduz os custos de reposição de insumos no Brasil, alivia a curva de juros futuros e diminui a pressão sobre combustíveis e preços de alimentos nos índices ao consumidor.',
    category: 'Economia',
    relativeTime: 'há 4 h',
    publishedAt: '2026-10-09T15:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1580519542036-c47de6196ba5?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 92,
    entities: [INITIAL_ENTITIES[3]],
    topics: [INITIAL_TOPICS[1]],
    featuredSourceLogos: [
      { name: 'CNN Brasil', color: '#cc0000', label: 'CNN' },
      { name: 'Valor', color: '#004b87', label: 'Valor' },
      { name: 'InfoMoney', color: '#00a86b', label: 'IM' }
    ],
    sources: [
      {
        id: 'sref-5',
        sourceName: 'CNN Brasil',
        domain: 'cnnbrasil.com.br',
        headline: 'Dólar aprofunda queda com cenário internacional favorável e diálogo global',
        url: 'https://cnnbrasil.com.br/economia/cotacao-dolar-queda-hoje',
        publishedAt: 'há 4 h'
      },
      {
        id: 'sref-6',
        sourceName: 'Valor Econômico',
        domain: 'valor.globo.com',
        headline: 'Moeda americana encerra em baixa após sinais de descompressão comercial',
        url: 'https://valor.globo.com/financas/dolar-fechamento.ghtml',
        publishedAt: 'há 4 h'
      },
      {
        id: 'sref-7',
        sourceName: 'Bloomberg',
        domain: 'bloomberg.com',
        headline: 'Emerging market currencies rally on constructive bilateral talks',
        url: 'https://bloomberg.com/emerging-fx-rally',
        publishedAt: 'há 5 h'
      }
    ],
    timeline: [
      {
        id: 'tl-3',
        date: '09 Out 2026',
        time: '13:00',
        title: 'Declaração conjunta de negociadores comerciais',
        description: 'Sinalização positiva acalma bolsas e derruba índice DXY global.'
      }
    ]
  },
  {
    id: 'evt-pacote-credito-governo',
    title: 'Governo anuncia novo pacote econômico com foco em crédito',
    summary: 'Medidas incluem ampliação do acesso a crédito para pequenas e médias empresas.',
    whatHappened: 'Em cerimônia no Palácio do Planalto com a presença da equipe econômica, foram lançadas novas linhas de crédito subsidiado e garantias públicas voltadas à modernização de micro, pequenas e médias empresas, além de estímulos para inovação produtiva.',
    whyItMatters: 'O crédito focado na base produtiva busca sustentar o nível de atividade econômica e emprego sem inflacionar a demanda agregada de consumo imediato, fortalecendo a liquidez no setor privado.',
    category: 'Política',
    relativeTime: 'há 6 h',
    publishedAt: '2026-10-09T13:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 90,
    entities: [INITIAL_ENTITIES[2]],
    topics: [INITIAL_TOPICS[2]],
    featuredSourceLogos: [
      { name: 'g1', color: '#c4170c', label: 'g1' },
      { name: 'Folha', color: '#003366', label: 'Folha' },
      { name: 'Estadão', color: '#002b49', label: 'Estadão' }
    ],
    sources: [
      {
        id: 'sref-8',
        sourceName: 'g1',
        domain: 'g1.globo.com',
        headline: 'Governo lança pacote de linhas de crédito para micro e pequenas empresas',
        url: 'https://g1.globo.com/economia/pacote-credito-governo.ghtml',
        publishedAt: 'há 6 h'
      },
      {
        id: 'sref-9',
        sourceName: 'Folha de S.Paulo',
        domain: 'folha.uol.com.br',
        headline: 'Fazenda aposta em garantias do FGO para baratear juros a pequenas firmas',
        url: 'https://folha.uol.com.br/mercado/credito-pme-fazenda.shtml',
        publishedAt: 'há 6 h'
      },
      {
        id: 'sref-10',
        sourceName: 'Estadão',
        domain: 'estadao.com.br',
        headline: 'Medidas de crédito visam destravar investimentos regionais',
        url: 'https://estadao.com.br/economia/medidas-credito-anuncio',
        publishedAt: 'há 7 h'
      }
    ],
    timeline: [
      {
        id: 'tl-4',
        date: '09 Out 2026',
        time: '11:30',
        title: 'Assinatura dos decretos regulamentadores',
        description: 'Bancos oficiais iniciam liberação das propostas a partir da próxima semana.'
      }
    ]
  },
  {
    id: 'evt-alzheimer-tratamento-avanco',
    title: 'Novo estudo revela avanços no tratamento do Alzheimer',
    summary: 'Pesquisa aponta resultados promissores em testes com novo medicamento.',
    whatHappened: 'Resultados de um ensaio clínico internacional com mais de 3.000 pacientes demonstraram que um novo composto biológico conseguiu desacelerar de forma consistente o avanço de marcadores biológicos e sintomas cognitivos em fases iniciais da doença.',
    whyItMatters: 'A consolidação de tratamentos capazes de frear o declínio cognitivo representa um avanço sem precedentes na medicina preventiva e na sustentabilidade dos sistemas de saúde de países com populações em rápido envelhecimento.',
    category: 'Ciência',
    relativeTime: 'há 8 h',
    publishedAt: '2026-10-09T11:00:00Z',
    imageUrl: 'https://images.unsplash.com/photo-1559757175-5700dde675bc?auto=format&fit=crop&w=800&q=80',
    relevanceScore: 88,
    entities: [],
    topics: [INITIAL_TOPICS[3]],
    featuredSourceLogos: [
      { name: 'Nature', color: '#e60000', label: 'Nature' },
      { name: 'CNN Saúde', color: '#cc0000', label: 'CNN' },
      { name: 'Folha', color: '#003366', label: 'Folha' }
    ],
    sources: [
      {
        id: 'sref-11',
        sourceName: 'Nature',
        domain: 'nature.com',
        headline: 'Clinical trial demonstrates unprecedented cognitive slowing in early Alzheimer cohort',
        url: 'https://nature.com/articles/alzheimer-trial-results',
        publishedAt: 'há 8 h'
      },
      {
        id: 'sref-12',
        sourceName: 'CNN Brasil',
        domain: 'cnnbrasil.com.br',
        headline: 'Estudo internacional confirma nova droga promissora contra o Alzheimer',
        url: 'https://cnnbrasil.com.br/saude/alzheimer-avanco-estudo',
        publishedAt: 'há 8 h'
      }
    ],
    timeline: [
      {
        id: 'tl-5',
        date: '09 Out 2026',
        time: '09:00',
        title: 'Publicação simultânea em periódicos médicos',
        description: 'Associações médicas globais celebram a eficácia estatística dos resultados.'
      }
    ]
  }
];

export const HIGHLIGHTED_ENTITIES = [
  { id: 'h-1', name: 'Nvidia', eventsToday: 12, iconColor: '#76b900' },
  { id: 'h-2', name: 'OpenAI', eventsToday: 8, iconColor: '#10a37f' },
  { id: 'h-3', name: 'Economia Global', eventsToday: 6, iconColor: '#2563eb' },
  { id: 'h-4', name: 'Brasil', eventsToday: 5, iconColor: '#16a34a' },
  { id: 'h-5', name: 'Inteligência Artificial', eventsToday: 4, iconColor: '#9333ea' }
];

export const TRENDING_SUBJECTS = [
  { rank: 1, name: 'Nvidia' },
  { rank: 2, name: 'Economia' },
  { rank: 3, name: 'Inteligência Artificial' },
  { rank: 4, name: 'Brasil' },
  { rank: 5, name: 'Governo' },
  { rank: 6, name: 'Bitcoin' },
  { rank: 7, name: 'China' },
  { rank: 8, name: 'Mercado Financeiro' }
];

export const INITIAL_BRIEFING: Briefing = {
  id: 'brf-morning-today',
  type: 'morning',
  date: 'Hoje • 07h00',
  title: 'Radar Matinal • Abertura dos Mercados & Radar Estratégico',
  estimatedReadTime: '3 min',
  summary: 'Abertura das bolsas com liquidez global, novos direcionamentos fiscais em Brasília e repercussão setorial de energia e tecnologia.',
  events: [INITIAL_EVENTS[0], INITIAL_EVENTS[1], INITIAL_EVENTS[2]],
  status: 'ready'
};

export const INITIAL_EVENING_BRIEFING: Briefing = {
  id: 'brf-evening-today',
  type: 'evening',
  date: 'Hoje • 20h00',
  title: 'Síntese do Fechamento • Balanço dos Mercados & Desdobramentos',
  estimatedReadTime: '3 min',
  summary: 'Consolidado do fechamento do Ibovespa e curva de juros, atos regulatórios publicados no Diário Oficial e o que monitorar na abertura de amanhã.',
  events: [INITIAL_EVENTS[1], INITIAL_EVENTS[2], INITIAL_EVENTS[0]],
  status: 'ready'
};

export const INITIAL_SUBSCRIPTION: UserSubscription = {
  status: 'ACTIVE',
  planName: 'Sinal Executive (Individual)',
  amount: 119.00,
  trialDaysLeft: 3,
  trialEndsAt: '27 de Outubro de 2026',
  currentPeriodEnd: '27 de Outubro de 2026',
  gateway: 'Sinal Gateway',
  paymentMethod: 'PIX'
};

export const INITIAL_NOTIFICATIONS: SinalNotification[] = [
  {
    id: 'notif-1',
    type: 'NEW_RELEVANT_EVENT',
    title: 'Nvidia atinge novo recorde de valor de mercado',
    description: '12 fontes convergem para o marco histórico de US$ 4 trilhões.',
    createdAt: 'há 2 h',
    read: false,
    eventId: 'evt-nvidia-4-trilhoes'
  },
  {
    id: 'notif-2',
    type: 'BRIEFING_READY',
    title: 'Seu Briefing da Manhã está pronto',
    description: 'Acontecimentos essenciais monitorados a partir dos seus interesses.',
    createdAt: 'há 5 h',
    read: false
  }
];

export const RELATED_EVENTS_MOCK = [
  {
    id: 'rel-1',
    category: 'Negócios',
    time: 'há 1 dia',
    title: 'Ações de big techs sobem com otimismo em IA',
    imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80'
  },
  {
    id: 'rel-2',
    category: 'Tecnologia',
    time: 'há 3 dias',
    title: 'Demanda por chips de IA impulsiona mercado global',
    imageUrl: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?auto=format&fit=crop&w=400&q=80'
  },
  {
    id: 'rel-3',
    category: 'Mercado',
    time: 'há 5 dias',
    title: 'Principais empresas de tecnologia registram alta em Wall Street',
    imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=400&q=80'
  }
];
