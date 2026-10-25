# Refinamento do Onboarding (Mockups 1 e 7), Integração PWA e Validador Rápido de Imagens

Plano de implementação para alinhar as telas 1 e 7 do Onboarding com os mockups oficiais enviados pelo usuário, adicionar o fluxo de instalação do aplicativo PWA (notificação discreta no onboarding e card permanente no perfil) e substituir a verificação externa de imagens por um script rápido no navegador para fotos de até 6MB com ajuste de recorte e zoom.

### User Review & Critical Decisions

> [!IMPORTANT]
> **Decisões Confirmadas pelo Usuário (Fase 1):**
> 1. **Convite PWA no Onboarding**: Notificação deslizante discreta no topo durante o onboarding, com opção "Mais tarde" que transfere o atalho para a tela de Perfil.
> 2. **Identidade Visual da Tela 1**: Exibição da marca oficial **FatosBR** com o logotipo estilizado, respeitando o layout do mockup onde o texto fica acima do globo terrestre.
> 3. **Upload de Imagem até 6MB**: Ambos os recursos implementados — validação rápida via script no navegador (sem chamadas a APIs que possam falhar), higienização de GPS/EXIF e modal interativo de ajuste de zoom e enquadramento circular antes de salvar.

---

### 1. Overview & Core Concept

1. **Alinhamento da Tela 1 do Onboarding (Mockup 2)**:
   - Estrutura reformulada: Logotipo e marca FatosBR no topo, seguido pelo título em destaque *"O que importa para você, sempre à frente."* e subtítulo explicativo à esquerda.
   - O globo terrestre em alta definição é posicionado na parte inferior central, emergindo suavemente com arcos orbitais no fundo escuro.
   - Botão pill *"Começar"*, atalho *"Já tem uma conta? Entrar"* e indicador de progresso `1/8` na base.

2. **Alinhamento da Tela 7 do Onboarding (Mockup 3 - "Tudo pronto!")**:
   - Botão de voltar `<` no topo e alinhamento à esquerda de *"Tudo pronto!"*.
   - Card escuro estilizado contendo o selo circular luminoso de verificação e linhas de resumo detalhadas:
     - Temas selecionados (`+5`)
     - Pessoas e empresas (`+3`)
     - Notificações ativas (`+2`)
     - Localização definida (`São Paulo, SP` ou Brasil)
   - Botão *"Acessar o FatosBR"*, contador `7/8` e barra de progresso horizontal inferior.

3. **Instalação do Aplicativo (PWA)**:
   - Configuração de Service Worker e manifesto PWA nativo (`manifest.json` com `display: standalone`).
   - Notificação deslizante no Onboarding convidando o usuário a instalar o app no celular ou desktop via navegador.
   - Card dedicado e permanente na página de Perfil (`ProfileView.tsx`) permitindo instalar a qualquer momento caso o leitor tenha pulado o onboarding.

4. **Validador Rápido de Fotos de Perfil (Até 6MB)**:
   - Remoção da dependência com a rota backend `/api/avatar/verify` que estava gerando rejeição.
   - Script direto em TypeScript no cliente:
     - Aceita imagens até 6 MB.
     - Valida cabeçalhos e tipos MIME (JPG, PNG, WebP).
     - Remove metadados EXIF e geolocalização (GPS) desenhando em `HTMLCanvasElement` em memória.
     - Modal interativo com controle deslizante de zoom e pré-visualização circular.
     - Compressão e salvamento imediato no perfil do usuário e no Supabase.

---

### 2. User Experience & Visual Design

#### Fluxo 1: Onboarding Visual Fiel ao Mockup
```
┌────────────────────────────────────────────────────────┐
│  [Logo FatosBR]                                1/8     │
│                                                        │
│  O que importa para você,                              │
│  sempre à frente.                                      │
│                                                        │
│  A FatosBR observa o mundo por você, reunindo os       │
│  acontecimentos mais relevantes em um só lugar.        │
│                                                        │
│                 [ GLOBO TERRESTRE ]                    │
│            (Emerge suavemente no fundo)                │
│                                                        │
│                [     Começar     ]                     │
│                Já tem uma conta? Entrar                │
│                1/8  ══════════════                     │
└────────────────────────────────────────────────────────┘
```

#### Fluxo 2: Tela "Tudo pronto!" (Conclusão)
```
┌────────────────────────────────────────────────────────┐
│  <                                                     │
│  Tudo pronto!                                          │
│  Agora é só explorar. Seu feed já está personalizado   │
│  com base nas suas escolhas.                           │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │                     [ ✔ ]                        │  │
│  │                                                  │  │
│  │  ⚙  Temas selecionados                        +5 │  │
│  │  👥 Pessoas e empresas                        +3 │  │
│  │  🔔 Notificações ativas                       +2 │  │
│  │  📍 Localização definida           São Paulo, SP │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│               [   Acessar o FatosBR   ]                │
│               7/8  ══════════════════                  │
└────────────────────────────────────────────────────────┘
```

#### Fluxo 3: PWA Install (Notificação & Perfil)
- **Durante o Onboarding**: Uma barra deslizante suave surge no topo:
  - *"Adicionar à Tela Inicial: Instale o FatosBR como aplicativo no seu celular ou PC."*
  - Ações: `[Instalar]` e `[Mais tarde]`.
- **No Perfil**: Card elegante na seção de configurações:
  - Se instalado: indicador verde *"App instalado no dispositivo"*.
  - Se não instalado: botão interativo *"Instalar Aplicativo (PWA)"* com suporte ao prompt nativo do Chrome/Android e instruções assistidas para Safari no iOS ("Compartilhar > Adicionar à Tela de Início").

#### Fluxo 4: Validador e Editor de Foto de Perfil
- Seleção de arquivos até 6MB na galeria ou câmera.
- Modal escuro e minimalista com preview circular, slider de zoom (1.0x a 3.0x) e botão *"Aplicar Foto"*.
- Higienização instantânea de GPS/EXIF sem travar o dispositivo.

---

### 3. Key Product Decisions & Trade-Offs

- **Validação Local vs. API Remota**:
  - *Decisão*: Processar imagens diretamente via Canvas API no navegador do leitor.
  - *Motivo*: Elimina erros de rede ("Falha ao comunicar com o servidor"), remove dados sensíveis de GPS antes de qualquer upload e garante resposta instantânea sem timeout de proxy.
- **PWA sem forçar instalação**:
  - *Decisão*: Notificação não bloqueante no onboarding com persistência de atalho no perfil.
  - *Motivo*: Respeita a intenção do leitor, não interrompe a calibragem de interesses e garante que o recurso continue acessível a qualquer momento.

---

### 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────────┐
│                      SISTEMA FRONTEND (REACT)                     │
└──────────────────────────────────────────────────────────────────┘
       │                                            │
       ▼                                            ▼
┌───────────────────────────────┐     ┌────────────────────────────┐
│      OnboardingFlow.tsx       │     │      ProfileView.tsx       │
│  - Tela 1: Texto sobre Globo  │     │  - Card PWA no Perfil      │
│  - Tela 7: Card com Selo ✔   │     │  - Modal de Foto até 6MB   │
│  - Banner PWA Deslizante      │     │  - Ajuste de Zoom & Corte  │
└───────────────────────────────┘     └────────────────────────────┘
       │                                            │
       ▼                                            ▼
┌───────────────────────────────┐     ┌────────────────────────────┐
│      usePWAInstall Hook       │     │   avatarProcessing.ts      │
│  - beforeinstallprompt        │     │  - Limite 6MB & MIME check │
│  - display-mode detection     │     │  - Canvas EXIF/GPS Strip   │
│  - iOS Safari Helper Modal    │     │  - Compressão WebP/JPEG    │
└───────────────────────────────┘     └────────────────────────────┘
```

---

### 5. Verification Plan

1. **Validação Visual do Onboarding**:
   - Testar no mobile (390px) e no desktop (1440px) para garantir que o layout da Tela 1 posiciona o texto acima do globo e a Tela 7 replica fielmente o card de resumo com o selo central.
2. **Teste de Instalação PWA**:
   - Verificar evento `beforeinstallprompt` no navegador e confirmação do guia iOS no Safari.
   - Confirmar presença do botão de instalação na tela de perfil quando recusado no onboarding.
3. **Teste de Upload de Fotos**:
   - Testar imagens de 1MB a 6MB (JPEG e PNG).
   - Validar remoção de metadados EXIF/GPS e aplicação instantânea do avatar na barra superior e no perfil.
4. **Verificação de Compilação**:
   - Executar `lint_applet` e `compile_applet` garantindo zero erros de TypeScript.
