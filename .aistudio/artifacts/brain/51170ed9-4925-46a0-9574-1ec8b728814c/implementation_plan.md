# Carrossel de Manchetes no Topo do Feed e Central LGPD Mobile Simplificada

Implementação das duas funcionalidades confirmadas:
1. **Carrossel de Manchetes em Destaque no Topo do Feed**: Componente de banner em destaque no topo do feed Home que agrega as notícias mais importantes do momento em um carrossel horizontal navegável, movendo-as para fora da listagem vertical padrão para evitar duplicidade.
2. **Reestruturação da Central de Privacidade & LGPD para Mobile**: Visão dedicada, simplificada e em tela cheia para dispositivos móveis, com seções colapsáveis (acordeões rápidos dos direitos do titular Art. 18 LGPD e dados coletados) e paleta estritamente em preto e branco.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Decisões confirmadas com o usuário:**
> - **Carrossel no Topo**: Sim, adicionar carrossel de manchetes no topo do feed. Os 3 a 5 acontecimentos mais relevantes serão exibidos no topo em slides horizontais navegáveis com banner amplo, sendo filtrados da listagem vertical abaixo para manter o feed limpo e dinâmico.
> - **Visual Mobile LGPD**: Tela cheia mobile (`fixed inset-0 h-full w-full bg-black`) com resumo de fácil leitura e seções colapsáveis (accordion) dos direitos do titular, além de atalho direto para abertura de protocolo junto ao DPO, mantendo a paleta 100% monocromática do app.

---

### 1. Overview & Core Concept

- **Carrossel Superior de Destaques (`FeaturedTopCarousel`)**:
  - Exibe no topo do feed Home os acontecimentos de maior impacto (baseados em urgência, número de fontes e relevância).
  - Permite deslizar horizontalmente no mobile (touch swipe) ou avançar via setas/indicadores no desktop.
  - Ao clicar, abre o modal detalhado do acontecimento.
  - A lista vertical do feed consome apenas as notícias restantes (`remainingEvents`), eliminando repetições desnecessárias.
- **Central de Privacidade & LGPD Mobile Otimizada (`LegalCenterModal`)**:
  - Em telas móveis (como Samsung Galaxy A35), fornece um modo de visualização rápida e desburocratizada com seções colapsáveis ("O que coletamos?", "Seus direitos Art. 18 LGPD", "Segurança dos dados" e "Ação rápida com o DPO").
  - Interface monocromática rigorosa (preto absoluto, branco puro e cinzas neutros), com áreas de toque confortáveis ($\ge 44\text{px}$).

---

### 2. User Experience & Visual Design

#### A. Componente `FeaturedTopCarousel` no Feed Home
- **Posicionamento**: Logo abaixo da barra de subtabs ("Para você", "Seguindo", "Em alta") e antes da listagem vertical.
- **Estrutura Visual**:
  - Card amplo com banner 16:9 (`h-56 sm:h-64 w-full`), gradiente escuro inferior para leitura nítida.
  - Etiqueta de destaque monocromática: `DESTAQUE EDITORIAL` ou `MANCHETE`.
  - Título em negrito e resumo direto de 2 linhas.
  - Logo monocromático da empresa/veículo e tempo estimado de leitura.
  - Paginação com pontos/barras indicadoras e botões de navegação lateral (prev/next) no desktop.
  - Animação suave com Framer Motion (`AnimatePresence`).

#### B. Seções Colapsáveis na Central LGPD Mobile
- **Modo Mobile Dedicado**:
  - Alternador de visão no topo: `Resumo Rápido (Mobile)` vs `Texto Legal Completo`.
  - 4 seções colapsáveis (Acordeão) com ícone de expansão:
    1. **Dados Pessoais Coletados**: Lista simplificada em bullets (e-mail de login, preferências de temas, histórico local).
    2. **Direitos do Titular (Art. 18 LGPD)**: Confirmação, acesso, correção, anonimização e exclusão explicados em linguagem acessível.
    3. **Armazenamento e Segurança**: Criptografia de ponta a ponta e persistência segura no Supabase.
    4. **Solicitar Atendimento ao DPO**: Card com botão direto para preencher nome/e-mail e gerar o protocolo oficial `LGPD-2026-XXXXXX`.
  - Design estritamente monocromático: fundos em `#000000` e `#0c0c0e`, bordas em `#27272a`, textos em branco e cinza claro, botões em branco com texto preto.

---

### 3. Architecture & File Plan

```
src/
├── components/
│   ├── FeaturedTopCarousel.tsx    # NOVO: Carrossel de manchetes do topo do feed
│   ├── LegalCenterModal.tsx       # ATUALIZADO: Modo mobile simplificado com acordeões
│   └── EventCard.tsx              # Mantido com a transição de escala otimizada
└── App.tsx                        # Integração do carrossel no feed e filtro de duplicatas
```

---

### 4. Step-by-Step Implementation Steps

1. **Criar `src/components/FeaturedTopCarousel.tsx`**:
   - Implementar componente autônomo com navegação horizontal, autoplay opcional (pausado no hover), suporte a touch drag, e cards com imagem e tipografia refinadas.
2. **Atualizar `src/App.tsx`**:
   - Separar os eventos em destaque (`topFeaturedEvents`) e os eventos do feed padrão (`feedEvents = remainingEvents`).
   - Renderizar o `FeaturedTopCarousel` no topo do feed Home quando houver eventos disponíveis.
3. **Reestruturar `src/components/LegalCenterModal.tsx`**:
   - Adicionar o modo de visualização simplificada para mobile com seções colapsáveis clicáveis (`useState` para controle de acordeão aberto).
   - Aplicar a paleta estrita em preto e branco, garantindo conformidade com a LGPD e ergonomia no celular.
4. **Validação & Testes**:
   - Executar `lint_applet` e `compile_applet` para garantir zero erros de TypeScript e build pronto para produção.
