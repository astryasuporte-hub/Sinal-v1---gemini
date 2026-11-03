# Correção do Feed, Webhook ZynPay, SSE no Checkout Pix, Otimização de Briefings e Suporte Real

Plano de engenharia para atender às melhorias solicitadas no FatosBR:
1. **Correção do Layout do Card de Notícias (`EventCard.tsx`)**: Ajuste na sobreposição dos botões de ação (salvar, compartilhar, opções) sobre a tag de data e tempo de leitura.
2. **Configuração de Webhook ZynPay no `AdminPanel.tsx`**: Interface para atualização dinâmica da URL de retorno, segredo criptográfico e ferramenta de teste de ping/simulação Pix.
3. **Listener SSE no Checkout Pix (`BillingModal.tsx`)**: Escuta em tempo real do evento de confirmação de pagamento Pix com modal/check animado e ativação automática do plano Pro.
4. **Aceleração Instantânea dos Briefings (`BriefingView.tsx`)**: Pré-carregamento de imagens, cache em memória e transições de zero latência.
5. **Tickets de Suporte Reais (`ticketService.ts`)**: Persistência no Supabase com sincronização de status e respostas reais.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Decisões confirmadas pelo usuário:**
> - **Tickets de Suporte**: Persistência em tabela real no Supabase (`support_tickets`) com sincronização de status e histórico de respostas.
> - **Confirmação Pix (SSE)**: Check animado imediato com liberação automática da assinatura Pro.
> - **Webhook ZynPay**: Painel com edição de URL pública, segredo e botão para disparar teste de ping e simulação de payload Pix.

---

### 1. Overview & Core Concept

- **Feed de Notícias Livre de Colisões**:
  - No mobile (telas estreitas como Samsung Galaxy A35), o cabeçalho do `EventCard` divide verticalmente o bloco de identificação da fonte/tempo e posiciona as ações (salvar, compartilhar, menu) no topo alinhado (`items-start`), garantindo que nenhum botão fique sobreposto à barra de data e tempo de leitura.
- **Webhook ZynPay Operacional**:
  - Os administradores podem redefinir a URL de retorno e o segredo `whsec_...` diretamente pelo painel e testar a integridade do endpoint com 1 clique (simulando payload de pagamento Pix do Banco Central).
- **Checkout em Tempo Real via SSE**:
  - Quando o usuário gera o Pix no `BillingModal`, o front-end ativa um listener de Server-Sent Events (`/api/zynpay/events`). Assim que o pagamento é liquidado, a tela exibe uma celebração com check animado e atualiza a sessão para Pro sem recarregar a página.
- **Briefings com Carregamento Instantâneo**:
  - Elimina o atraso de abertura da aba de Briefings através de pré-carregamento imediato das artes gráficas e cache em memória (SWR).
- **Chamada Real de Tickets**:
  - Envio e resposta de tickets de suporte conectados ao banco Supabase, com suporte a RLS e fallback resiliente.

---

### 2. User Experience & Visual Design

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FATOSBR EVENT CARD (FEED)                       │
├────────────────────────────────────────────────────────────────────────┤
│  [CN] CNN Brasil                           [Salvar] [Share] [Mais]     │
│  há 2 dias · 1 min de leitura                                          │
│                                                                        │
│  BoJ tenta estimular economia do Japão há muito tempo, diz economista  │
│  Autoridade monetária manteve taxa básica de juros em 1,5% ao ano...   │
│                                                                        │
│  [Tecnologia & IA] · 1 fonte CNN                          Contexto ▾   │
└────────────────────────────────────────────────────────────────────────┘
```

#### A. Ajuste de Layout no `EventCard.tsx`
- Mudança do cabeçalho de `items-center` com `flex-wrap` desordenado para uma estrutura em grid/duas linhas:
  - **Linha 1 (Superior)**: Logotipo + Nome da Fonte no canto esquerdo e barra de botões (`Bookmark`, `Share`, `More`) no canto direito com `items-start` e alinhamento estável.
  - **Linha 2 (Metadados)**: Texto limpo e desobstruído com o tempo decorrido e estimativa de leitura (`há 2 dias · 1 min de leitura`), sem cápsulas inchadas que colidam com os botões.

#### B. Painel de Webhook ZynPay (`AdminPanel.tsx` / `AdminFinancialZynPayPanel.tsx`)
- Card dedicado dentro da aba de Cobrança / Financeiro:
  - Input para `URL de Retorno Webhook` (com botão de cópia rápida).
  - Input para `Segredo de Segurança do Webhook` (com botão para mascarar/revelar).
  - Botão **"⚡ Testar Ping do Webhook"** e **"🧪 Simular Pagamento Pix (R$ 29,90)"**.
  - Histórico de entregas e telemetria dos últimos eventos processados.

#### C. Confirmação Animada do Pix via SSE (`BillingModal.tsx`)
- Listener do evento SSE `pix.payment.confirmed` conectado ao `zynpayService`.
- Overlay de celebração animado com `framer-motion`:
  - Ícone de check gigante com pulsar suave monocromático/esmeralda.
  - Texto: *"Pagamento Pix Confirmado com Sucesso!"*.
  - Subtexto: *"Sua conta FatosBR Pro foi liberada imediatamente."*.
  - Transição suave para o estado de Pro Ativo.

#### D. Otimização de Velocidade nos Briefings (`BriefingView.tsx`)
- Cache SWR imediato em `localStorage`: o leitor vê os resumos matinal e noturno sem esperar requisições de rede.
- Pré-carregamento no `useEffect` das imagens de fundo (`Amanhecer_sobre_a_cidade` e `Horizonte_urbano_ao_anoitecer`).

#### E. Tickets de Suporte no Supabase (`ticketService.ts` e `AdminPanel.tsx`)
- Consulta e inserção em `public.support_tickets`.
- Sincronização em tempo real das mensagens e respostas do administrador.

---

### 3. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FLUXO DE INTEGRAÇÕES                            │
│                                                                        │
│   EventCard (Feed) ───────> Header Anti-Colisão (items-start)          │
│                                                                        │
│   BillingModal (Pix) ─────> SSE Listener (/api/zynpay/events)          │
│                                      │                                 │
│                                      ▼                                 │
│                             Check Animado & Pro                        │
│                                                                        │
│   AdminPanel ─────────────> ZynPay Webhook Config & Ping Tester        │
│                                                                        │
│   ticketService ──────────> Supabase table `support_tickets`           │
│                                                                        │
│   BriefingView ───────────> Image Preloader + Local Cache SWR          │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 4. Step-by-Step Implementation Steps

1. **Correção do `EventCard.tsx`**:
   - Reestruturar o cabeçalho do card para separar a identificação da fonte e o badge de tempo das ações de topo, eliminando a colisão no mobile.
2. **Configuração de Webhook ZynPay em `AdminPanel.tsx` e `AdminFinancialZynPayPanel.tsx`**:
   - Integrar formulário de URL e Segredo com persistência em servidor/local.
   - Adicionar ferramenta de simulação e teste de ping de webhook Pix.
3. **SSE no `BillingModal.tsx`**:
   - Inscrever o modal no canal de eventos em tempo real do `zynpayService`.
   - Adicionar estado de pagamento aprovado com modal de check animado.
4. **Aceleração dos Briefings em `BriefingView.tsx`**:
   - Implementar pré-carregamento imediato de assets e leitura direta de cache sem loader bloqueante.
5. **Integração Real de Tickets no `ticketService.ts`**:
   - Adicionar chamadas reais ao Supabase (`supabase.from('support_tickets')`) para criação, listagem e resposta de tickets.
6. **Verificação & Build**:
   - Rodar `lint_applet` (`tsc --noEmit`) e `compile_applet`.
