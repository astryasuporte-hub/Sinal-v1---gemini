# Plano de Implementação: Versão Mobile Responsiva e Autenticação (Email/Senha & Google)

Correção definitiva da renderização mobile no domínio de produção `fatosbr.com.br`, ativação de viewport nativo, refinamento da Landing Page para smartphones com acesso direto ao app, barra de navegação inferior fixa com safe areas e implementação completa do fluxo de autenticação com Email/Senha e Google OAuth.

---

## Revisão do Usuário & Decisões Críticas

> [!IMPORTANT]
> **Decisões confirmadas com o usuário no Turno 1:**
> 1. **Tela inicial no celular**: Landing page mobile com botão direto para o app e acesso rápido à autenticação.
> 2. **Métodos de autenticação**: E-mail com senha e Login social com Google (via Supabase OAuth com fallback seguro de demonstração).
> 3. **Padrão de navegação mobile**: Barra de navegação fixa na parte inferior da tela (`Bottom Navigation Bar`) com safe area insets para iOS/Android.

---

## 1. Visão Geral e Causa-Raiz do Problema Mobile

### Diagnóstico Técnico no Vercel
Ao acessar `fatosbr.com.br` por um smartphone real, o navegador móvil simulava uma tela desktop de 980px reduzida (zoom-out) porque o arquivo `index.html` **não continha a tag `<meta name="viewport">`**. 
Sem essa tag essencial da especificação HTML5, os navegadores móveis (Safari iOS e Chrome Android) ignoram media queries responsivas (como `max-width`, `sm:` e `md:` do Tailwind), exibindo a versão desktop miniaturizada.

### Objetivos desta Entrega
1. **Ativação da Viewport Mobile Nativa**: Inserir `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />` e meta tags de suporte PWA e entalhes (notch).
2. **Landing Page Otimizada para Celular**:
   - Cabeçalho mobile limpo com logotipo `FatosBR` e botão "Entrar".
   - Hero impactante adaptado para telas verticais com CTA principal "Começar 3 dias grátis" e "Abrir o App".
   - Eliminação de transbordamento horizontal e otimização do canvas 3D Three.js para baixo consumo de bateria em smartphones.
3. **Barra de Navegação Inferior Fixa no App**:
   - Ícones de alta legibilidade: Início, Explorar, Seguindo, Briefings e Perfil.
   - Indicador de estado ativo e badges de contagem não lida.
   - Suporte estrito a `padding-bottom: env(safe-area-inset-bottom)` para não colidir com o botão home/gesto de deslizar do iPhone e Android.
4. **Sistema de Autenticação (Email/Senha e Google OAuth)**:
   - Adicionar método `signInWithOAuth('google')` no `authService.ts`.
   - Adicionar botão "Continuar com o Google" com logo oficial em `AuthModal.tsx`.
   - Suporte a login e cadastro tradicional com Email e Senha.
   - Modo de demonstração gracioso caso as variáveis de produção do Supabase ainda não tenham sido configuradas no painel da Vercel.

---

## 2. Experiência do Usuário & Design Visual

### Fluxos do Usuário

```
  [Acesso pelo Celular em fatosbr.com.br]
                  │
                  ▼
   [Landing Page Mobile Otimizada]
         │                 │
         │ (Toca em "Entrar") │ (Toca em "Começar 3 dias grátis" / "Acessar App")
         ▼                 ▼
   [Modal de Auth]     [Feed do App no Mobile]
   ├─ Continuar c/ Google  │
   ├─ Email e Senha        ├─ Barra Superior: Logo FatosBR + Busca/Sincronização
   └─ Modo Demo Seguro     │
                           └─ Barra Inferior Fixa:
                              [Início] [Explorar] [Seguindo] [Briefings] [Perfil]
```

### Detalhes de Interface Mobile
- **Tipografia**: Escalas proporcionais em rem, títulos sem quebra órfã (`line-clamp-2`/`line-clamp-3`), padding horizontal de 16px nas laterais (`px-4`).
- **Alvos de Toque (Touch Targets)**: Altura mínima de 44px para todos os botões e abas, garantindo toque ágil e sem cliques acidentais.
- **Barra Inferior (`Bottom Nav`)**: Fundo com vidro fosco elegante (`bg-[#090a0d]/95 backdrop-blur-md`), borda superior sutil (`border-t border-[#1a1c23]`), ícones de 20px e legendas legíveis de 10px.

---

## 3. Decisões de Produto & Arquitetura

1. **Tag de Viewport com `viewport-fit=cover`**:
   - Permite que a interface ocupe a tela inteira em celulares modernos com cantos arredondados e entalhe/Dynamic Island, aplicando `safe-area-inset` onde necessário.
2. **Fallback Inteligente para Autenticação Google**:
   - Em produção na Vercel com chaves Supabase ativas, o clique dispara o redirecionamento OAuth real do Google (`supabase.auth.signInWithOAuth`).
   - Se o projeto na Vercel ainda estiver aguardando as chaves no painel, o modal informa amigavelmente e oferece login em Modo Demonstração para que a navegação nunca trave.
3. **Desempenho em Celulares**:
   - Pausar ou suavizar animações Three.js pesadas quando em telas pequenas (`max-width: 768px`) para garantir 60 FPS e carregamento instantâneo no 4G/5G.

---

## 4. Arquitetura Técnica & Componentes

```
┌────────────────────────────────────────────────────────┐
│                      index.html                        │
│   meta viewport (device-width, initial-scale=1.0)      │
│   theme-color, apple-touch-icon, safe-area config      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                        App.tsx                         │
│  - Detecta viewport mobile / safe area                 │
│  - Renderiza LandingPage ou Feed Principal             │
│  - Renderiza Mobile Header no topo (sm:hidden)         │
│  - Renderiza Mobile Bottom Navigation Bar (sm:hidden)  │
│  - Gerencia estado de autenticação e modais            │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
               ▼                          ▼
┌─────────────────────────────┐ ┌────────────────────────┐
│       LandingPage.tsx       │ │     AuthModal.tsx      │
│ - Hero mobile responsivo    │ │ - Botão Google OAuth   │
│ - Botão "Entrar" no topo    │ │ - Email e Senha        │
│ - Botão direto p/ o App     │ │ - Feedback instantâneo │
└─────────────────────────────┘ └────────────────────────┘
```

### Mapeamento de Arquivos e Alterações

1. **`index.html`**:
   - Inclusão da meta tag de viewport com escala inicial 1.0 e `viewport-fit=cover`.
   - Inclusão de meta tags mobile para iOS (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`).
2. **`src/services/authService.ts`**:
   - Adição do método `signInWithOAuth(provider: 'google')`.
3. **`src/components/AuthModal.tsx`**:
   - Adição do botão de autenticação social com Google (ícone oficial colorido SVG, estilo moderno e acessível).
   - Abas claras: "Entrar" e "Criar Conta", com login por Google e Email/Senha.
4. **`src/components/LandingPage.tsx`**:
   - Ajustes responsivos nas media queries da Landing Page para renderizar perfeitamente no mobile.
   - Botão de acesso direto ao aplicativo para visitantes no celular.
5. **`src/App.tsx`**:
   - Revisão e blindagem da barra de navegação inferior fixa para garantir visibilidade perfeita em todas as telas móveis.
   - Sincronização do estado de login e perfil.

---

## 5. Plano de Verificação

1. **Validação de Código e Tipos**:
   - Executar `compile_applet` e `lint_applet` para assegurar conformidade total sem erros de compilação.
2. **Verificação da Tag Viewport**:
   - Inspecionar `index.html` para confirmar presença de `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />`.
3. **Teste Funcional de Autenticação**:
   - Testar login com Email e Senha no modal.
   - Testar chamada ao Google OAuth com tratamento de fallback.
4. **Verificação de Responsividade**:
   - Conferir que em resoluções mobile (< 768px) a barra inferior e a navegação fluem naturalmente.
