# Plano de Implementação: Página Dedicada de Login & Onboarding Completo (Mobile + PC)

Criação de uma página dedicada e exclusiva para autenticação (`LoginPage`), seguida pelo fluxo completo de Onboarding em 7 etapas baseado no protótipo do Figma e mockup visual fornecido, com adaptação responsiva de alta fidelidade para dispositivos móveis e computadores (PC). O fluxo incorpora as imagens de alta resolução do globo terrestre (Tela 1) e do selo luminoso de validação (Tela 7).

---

## Decisões Confirmadas com o Usuário

1. **Momento do Onboarding**: O fluxo de onboarding de 7 etapas é apresentado logo após o cadastro e login bem-sucedido do novo usuário (ou quando solicitado no perfil/recalibração).
2. **Layout da Página Dedicada de Login**: Interface em tela cheia com visual minimalista dark premium, tipografia refinada, foco central nas ações (Google OAuth e E-mail/Senha com código de verificação de 6 dígitos) e link direto para retornar à Landing Page.
3. **Layout no Computador (PC)**: No desktop, o onboarding será renderizado em um card centralizado premium com altura adaptativa e foco total, garantindo elegância sem esticar os controles; no celular, ocupará toda a tela mobile de forma imersiva e com barra de navegação inferior com safe-area.
4. **Imagens de Alta Resolução Incorporadas**:
   - **Tela 1 (Hero Onboarding)**: Imagem do globo terrestre com amanhecer espacial (`/assets/aistudio/file_00000000d9dc820eb1300938edc857d3_8a6e1430.png`).
   - **Tela 7 (Tudo Pronto)**: Imagem do selo luminoso com check central e raios cósmicos (`/assets/aistudio/file_00000000f254820eb392affea4aaa51a_376a3222.png`).

---

## Arquitetura do Fluxo de Entrada e Onboarding

```
                   [Landing Page fatosbr.com.br]
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
   [Começar 3 dias grátis]                  [Fazer Login / Entrar]
               └────────────────┬────────────────┘
                                │
                                ▼
         [Página Dedicada de Login (LoginPage.tsx)]
      ┌──────────────────────────────────────────────────┐
      │  FatosBR Intelligence                            │
      │  [G] Continuar com o Google (Destaque)           │
      │  ────────────── ou com e-mail ─────────────────  │
      │  Tabs: [ Entrar ]  [ Criar Conta ]               │
      │  (E-mail e Senha)                                │
      │  Etapa 2: Código verificador de 6 dígitos        │
      │  [← Voltar à página inicial]                     │
      └─────────────────────────┬────────────────────────┘
                                │ (Autenticação concluída)
                                ▼
                    [Verificação de Onboarding]
                   /                           \
        (Primeiro acesso)                  (Já configurado)
                 /                               \
                ▼                                 ▼
   [OnboardingFlow: 7 Etapas]                [Feed do App]
   ┌────────────────────────────────┐
   │ 1. Hero c/ Globo Terrestre     │
   │ 2. Interesses (Temas)          │
   │ 3. Pessoas, Empresas e Fontes  │
   │ 4. Notificações e Frequência   │
   │ 5. Personalização do Feed      │
   │ 6. Localização e Idioma        │
   │ 7. Tudo Pronto c/ Selo e Resumo│
   └────────────────┬───────────────┘
                    │ ("Acessar a FatosBR")
                    ▼
          [Feed Principal do App]
```

---

## Detalhamento das Etapas e Componentes

### 1. Novo Componente: `src/components/LoginPage.tsx`
- **Página Dedicada em Tela Cheia**:
  - Layout minimalista escuro (`#000000` / `#050506`), sem distrações laterais.
  - Header com logotipo FatosBR e botão de retorno para a Landing Page.
  - Card centralizado responsivo com suporte a toque e teclado.
  - **Opções de Acesso**:
    - Botão destacado "Continuar com o Google".
    - Divisor sutil "ou com seu e-mail".
    - Alternância entre "Entrar" e "Criar Conta".
    - Campos acessíveis com foco automático, validação visual e máscara de senha.
    - Tela de código de 6 dígitos numéricos com avanço automático.
  - Tratamento defensivo de erros e feedback de carregamento.

### 2. Novo Componente de Onboarding: `src/components/OnboardingFlow.tsx`
Substitui o antigo modal genérico por uma experiência fluida baseada no protótipo `Onboarding_9b71ccc9.html` e nos mockups visuais:
- **Barra de Progresso Global**: Indicador numérico (ex: `1/7`, `2/7`, etc.) e barra de progresso animada contínua.
- **Tela 1: Hero de Boas-Vindas**:
  - Imagem do globo terrestre espacial (`file_00000000d9dc820eb1300938edc857d3_8a6e1430.png`).
  - Logotipo FatosBR e headline: *"O que importa para você, sempre à frente."*
  - Subtítulo editorial sobre curadoria e inteligência de fatos.
  - Botão principal: "Começar".
- **Tela 2: Interesses (Temas)**:
  - Título: *"O que te interessa?"* (Escolha pelo menos 5 temas).
  - Campo de busca em tempo real.
  - Grid de cards seletores com ícones e checkmark: Tecnologia, Negócios, Política, Economia, Mundo, Ciência, Saúde, Esportes, Cultura, Entretenimento, Meio Ambiente, Educação.
- **Tela 3: Quem você quer seguir**:
  - Título: *"Quem você quer seguir?"* (Pessoas, empresas e organizações).
  - Tabs dinâmicas: `Pessoas` | `Empresas` | `Organizações`.
  - Lista com avatares reais, nomes, @handles e botões interativos de seguir/desmarcar (+ e check).
- **Tela 4: Notificações e Atualizações**:
  - Título: *"Como você quer receber as atualizações?"*.
  - Cards com checkboxes: *Notificações no app* (tempo real), *E-mail diário*, *E-mail semanal*, *Resumo por WhatsApp* (tag "Em breve").
- **Tela 5: Personalize seu Feed**:
  - Título: *"Personalize seu feed"*.
  - Seletores de priorização: *Notícias em tempo real*, *Análises e contextos*, *Fontes confiáveis*, *Eventos e tendências*, *Mercado e investimentos*, *Inovação e tecnologia*.
- **Tela 6: Localização e Idioma**:
  - Título: *"Onde você está?"*.
  - Campo de cidade/país com detecção/edição (padrão São Paulo, SP) e seletor de idioma (Português - Brasil).
- **Tela 7: Tudo Pronto (Sucesso)**:
  - Selo luminoso de alta definição (`file_00000000f254820eb392affea4aaa51a_376a3222.png`).
  - Título: *"Tudo pronto!"* com subtítulo de confirmação.
  - Resumo dinâmico das escolhas: contagem real de temas, entidades seguidas, preferências ativas e localização.
  - Botão principal: **"Acessar a FatosBR"**, que grava a conclusão no `localStorage` e libera o Feed principal.

### 3. Integração no `src/App.tsx`
- Adicionar os estados de navegação `'login'` e `'onboarding'` em `currentNav`.
- Conectar a Landing Page: botões "Começar 3 dias grátis" e "Fazer Login" / "Entrar" direcionam para `currentNav = 'login'`.
- Após login ou cadastro com sucesso no `LoginPage`, verificar se o usuário já completou o onboarding:
  - Se novo usuário: transição direta para `currentNav = 'onboarding'`.
  - Se já possui onboarding gravado: navega para `currentNav = 'home'`.
- Ao concluir a Tela 7 do Onboarding, persistir flag `sinal_onboarded_${userId}` e transicionar para o feed (`home`).

---

## Plano de Verificação

1. **Validação de Código e Linter**:
   - Executar `lint_applet` e `compile_applet` para assegurar 0 erros de compilação TypeScript.
2. **Validação da Página de Login**:
   - Clicar em "Fazer Login" e "Começar 3 dias grátis" na Landing Page e confirmar que abre a página dedicada em tela cheia (não modal).
   - Testar login com Google e login com E-mail + código de 6 dígitos.
   - Testar botão de voltar para a página inicial.
3. **Validação do Onboarding**:
   - Confirmar carregamento da imagem do globo terrestre na Tela 1.
   - Testar seleção de temas, busca e alternância de pessoas/empresas nas abas.
   - Testar telas 4, 5 e 6 com interações ativas e navegação "Voltar" / "Continuar".
   - Confirmar imagem do selo luminoso e contadores do resumo na Tela 7.
   - Clicar em "Acessar a FatosBR" e verificar redirecionamento correto para o Feed.
4. **Validação Responsiva (Mobile e PC)**:
   - No celular: tela imersiva sem rolagem horizontal com barra de ação fixa no rodapé.
   - No PC: card centralizado elegante com tipografia ajustada e espaçamentos simétricos.
