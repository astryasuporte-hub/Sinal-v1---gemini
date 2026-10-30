# Redesign Monocromático, Gaveta de Temas, Otimização Mobile A35 e Painel ZynPay Avançado

Implementação da reformulação visual para preto e branco estrito, remoção dos botões superiores e avisos verdes destacados na captura de tela, gaveta lateral minimalista para seleção de temas com botão de 3 barras, alinhamento responsivo perfeito para dispositivos como Samsung Galaxy A35, endpoint e formulário de configuração de webhook ZynPay, hook SSE para notificações em tempo real e gráfico de linhas diário de transações Pix.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Todas as preferências de design e arquitetura foram confirmadas pelo usuário e serão aplicadas integralmente:
> - **Estética Visual**: Monocromático estrito — preto puro (`#000000`), cinzas escuros (`#121214`, `#1a1a1e`), cinzas sutis (`#27272a`, `#71717a`) e branco puro (`#ffffff`), sem qualquer tom de verde, azul ou roxo decorativo.
> - **Navegação de Temas**: Remoção do carrossel horizontal de temas e substituição por botão de 3 barras que abre uma gaveta lateral minimalista (*Drawer*) em preto e branco.
> - **Cabeçalho & Avisos**: Remoção dos botões superiores "Briefings" e "Control" (circulados na imagem) e eliminação completa do aviso verde *"Feed filtrado por seus temas"*.
> - **Ergonomia Mobile (Samsung A35)**: Ajuste minucioso de largura, padding, espaçamento e altura de toque ($\ge 44\text{px}$) evitando quebras indesejadas, descompassos de linha ou overflow horizontal.
> - **Integração ZynPay**: Endpoint de persistência da URL de callback, formulário de configuração no `AdminPanel`, hook SSE em tempo real e gráfico diário de transações com Recharts.

---

### 1. Overview & Core Concept

- **O que faz**:
  1. Converte a interface do FatosBR para uma estética editorial monocromática de alto contraste (preto e branco), eliminando poluição visual, badges coloridas e avisos em verde.
  2. Simplifica a navegação no celular (Samsung Galaxy A35 e similares) através de uma gaveta lateral expansível acionada por 3 barrinhas, mantendo o topo limpo e livre de botões dispensáveis.
  3. No painel administrativo e financeiro, possibilita ao administrador configurar e testar a URL de webhook da ZynPay, visualizar em tempo real transações Pix via Server-Sent Events (SSE) e acompanhar a evolução financeira diária em um gráfico de linhas elegante.
- **Público-Alvo**: Leitores de notícias e briefings em smartphones, com experiência de leitura limpa e sem distrações, e administradores gerenciando assinaturas e cobranças Pix.
- **Valor Principal**: Simplicidade visual absoluta, leitura confortável no mobile e controle financeiro em tempo real.

---

### 2. User Experience & Visual Design

#### A. Cabeçalho e Feed Limpos (Conforme Captura de Tela)
- **Remoção de Elementos Circulados**:
  - Excluir botões "Briefings" e "Control" da barra de navegação superior.
  - Excluir o banner verde de recalibração (`Feed filtrado por seus temas...`).
- **Novo Controle de Temas**:
  - No lugar do carrossel horizontal de temas que gerava rolagem e quebra de linha, implementar um botão discreto de 3 barras (*SlidersHorizontal* / *Menu*) com o tema atualmente ativo em texto puro ao lado (ex.: "Todas as Notícias · Filtrar").
  - Ao tocar no botão de 3 barras, abre-se uma gaveta lateral (*Slide-over Drawer*) da direita ou da esquerda com fundo preto fosco (`bg-black`), bordas finas (`border-zinc-800`), lista limpa de categorias com indicador branco de seleção ativa e toque ergonômico ($\ge 48\text{px}$).

#### B. Paleta Monocromática Estrita
- **Cores Permitidas**:
  - Fundo primário: `#000000` (Preto absoluto) e `#09090b` / `#0d0d10` (Superfícies).
  - Bordas e divisores: `#27272a` (Zinc 800) e `#18181b` (Zinc 900).
  - Tipografia: `#ffffff` (Títulos e ações principais), `#d4d4d8` (Texto corrido), `#71717a` (Metadados e rótulos secundários).
  - Acentos ativos: Fundo branco com texto preto (`bg-white text-black font-semibold`).
- **Erradicação de Cores**:
  - Substituição de todos os estados `emerald-*`, `green-*`, `blue-*`, `purple-*` por tons de cinza e branco com alto contraste e acessibilidade WCAG AA.

#### C. Responsividade Samsung Galaxy A35 (~384px - 412px de viewport)
- Correção de paddings horizontais (`px-3.5` e `px-4`), garantindo que nenhum elemento transborde `100vw`.
- `overflow-x-hidden` nos contêineres principais.
- Alinhamento vertical e hierarquia de títulos equilibrada (`text-balance`), sem palavras órfãs ou quebras tortas em telas estreitas.
- Área de toque mínima de $44 \times 44\text{px}$ para todos os botões e abas.

---

### 3. Key Product Decisions & Trade-Offs

1. **Gaveta Lateral vs Modal Central para Temas**:
   - *Decisão*: Gaveta lateral deslizante (*Lateral Drawer*) com transição suave e fundo escurecido.
   - *Motivo*: Muito mais ergonômica para navegação com o polegar no celular, deixando o conteúdo visível atrás e permitindo troca rápida com um toque.
2. **Recharts para Gráfico Diário de Transações Pix**:
   - *Decisão*: Recharts integrado com tema monocromático (linha branca ou cinza claro com gradiente sutil, eixos em cinza escuro, tooltip monocromático estilizado).
   - *Motivo*: Biblioteca já presente e configurada no ecossistema Vite/React, com suporte total a SVG responsivo (`ResponsiveContainer`) e sem problemas de hidratação ou bugs de resize em telas mobile.
3. **Persistência da Configuração de Webhook**:
   - *Decisão*: Endpoints dedicados `GET /api/zynpay/config` e `POST /api/zynpay/config` no servidor Vite, com validação de formato de URL e fallback sincronizado com `localStorage`.
   - *Motivo*: Garante que o administrador possa cadastrar e persistir a URL em produção sem perder o estado entre recarregamentos.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                          FatosBR Client UI                             │
│                                                                        │
│  ┌─────────────────────────┐         ┌──────────────────────────────┐  │
│  │     Top Navigation      │         │      Feed & Theme Drawer     │  │
│  │ (FatosBR Wordmark only, │         │ (3-bars trigger, pure black/ │  │
│  │  search, profile, clean)│         │  white drawer, no green tag) │  │
│  └─────────────────────────┘         └──────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                       Admin Financial Panel                      │  │
│  │  - Webhook URL Config Form (GET/POST /api/zynpay/config)         │  │
│  │  - SSE Live Hook Listener (GET /api/zynpay/events)               │  │
│  │  - Daily Pix Volume Line Chart (Recharts ResponsiveContainer)    │  │
│  │  - Balance & Recent Webhooks Ledger                              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ HTTP / SSE
┌────────────────────────────────────▼───────────────────────────────────┐
│                        Vite Dev / Backend API                          │
│                                                                        │
│  - GET/POST /api/zynpay/config   -> Persistent webhook URL storage     │
│  - POST /api/zynpay/webhook      -> Ingests ZynPay event & dispatches  │
│  - GET /api/zynpay/events (SSE)  -> Broadcasts PAYMENT_CONFIRMED live  │
│  - GET /api/zynpay/webhooks      -> Returns recent 20 webhooks         │
│  - GET /api/zynpay/balance       -> Fetches live or simulated balance  │
└────────────────────────────────────────────────────────────────────────┘
```

#### Sequência de Implementação:
1. **Configuração de Servidor (`vite.config.ts`)**:
   - Adicionar estado `zynpayWebhookConfig` com endpoint de callback padrão.
   - Criar rotas `GET /api/zynpay/config` e `POST /api/zynpay/config`.
2. **Painel Financeiro ZynPay (`src/components/AdminFinancialZynPayPanel.tsx`)**:
   - Implementar formulário de URL de webhook com botão de salvar, cópia de URL e teste.
   - Implementar conexão SSE em tempo real escutando `/api/zynpay/events`, exibindo banner de notificação instantânea quando uma cobrança Pix for confirmada.
   - Integrar gráfico de linhas diário com Recharts demonstrando o volume diário e quantidade de transações em centavos/R$.
3. **Refatoração Visual e Responsividade no `src/App.tsx`**:
   - Remover botões "Briefings" e "Control" do cabeçalho.
   - Remover carrossel de pills de temas e o aviso verde de recalibração.
   - Adicionar botão de 3 barras e gaveta lateral de seleção de temas (*ThemeDrawer*).
   - Trocar todas as cores decorativas por preto, branco e escala de cinzas.
   - Otimizar paddings e contêineres para o Samsung Galaxy A35.
4. **Verificação & Testes**:
   - Validação com `lint_applet` e `compile_applet`.
   - Teste de chamada cURL em `/api/zynpay/config` e disparo de webhook para checagem do SSE.
