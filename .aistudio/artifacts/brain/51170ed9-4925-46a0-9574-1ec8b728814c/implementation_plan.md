# Plano de Implementação: Autenticação Google/Email com Código de 6 Dígitos, Logout Efetivo e URLs Limpas na Landing Page

Reestruturação do fluxo de entrada do usuário para abrir diretamente a autenticação com Google ao clicar em "Começar 3 dias grátis" (sem exibir cobrança PIX prévia), implementação de tela de código verificador de 6 dígitos para e-mail e senha, remoção definitiva do link mágico, logout funcional com retorno imediato à Landing Page, e navegação suave na Landing Page com URLs limpas (sem `#seção` no navegador).

---

## Revisão do Usuário & Decisões Confirmadas

> [!IMPORTANT]
> **Decisões confirmadas com o usuário no Turno 1:**
> 1. **Ao sair da conta no perfil**: Redirecionar o usuário imediatamente para a **Landing Page**, limpando a sessão e o estado de autenticação.
> 2. **Fluxo de e-mail e senha**: Exibir **tela dedicada no modal para digitação do código verificador de 6 dígitos** (com avanço automático e reenvio), eliminando a opção de "Link Mágico".
> 3. **Navegação nas seções da Landing Page**: Rolagem suave com interceptação de clique, mantendo a **URL limpa sem hashtags** (sem exibir `#FAQ`, `#planos`, etc. no navegador).
> 4. **Ação do botão "Começar 3 dias grátis"**: Abre diretamente o **AuthModal** focado em "Continuar com o Google" (o modal PIX/Cobrança não deve aparecer neste momento).
> 5. **Hero da Landing Page**: Remover o texto redundante "Já tem conta? Fazer Login" adicionado anteriormente no mobile.

---

## 1. Visão Geral e Arquitetura do Fluxo

```
  [Visitante clica em "Começar 3 dias grátis" ou "Entrar"]
                          │
                          ▼
             [AuthModal: Autenticação Direta]
         ┌────────────────────────────────────────┐
         │  [G] Continuar com o Google (Destaque) │
         │  ──────────── ou com e-mail ────────── │
         │  Tabs: [ Entrar ]  [ Criar Conta ]     │
         │  (E-mail e Senha)                      │
         └───────────────────┬────────────────────┘
                             │ (Submete credenciais)
                             ▼
         [Etapa 2: Código Verificador de 6 Dígitos]
         ┌────────────────────────────────────────┐
         │  Digite o código enviado para seu e-mail│
         │  [ _ ] [ _ ] [ _ ] [ _ ] [ _ ] [ _ ]   │
         │  [ Confirmar Código e Acessar App ]    │
         │  Reenviar código em 30s | Trocar email │
         └───────────────────┬────────────────────┘
                             │ (Código validado)
                             ▼
              [Acesso Liberado ao App Feed]
                             │
                             ▼ (No Perfil: Toca em "Sair da conta")
              [Logout Efetivo & Retorno à Landing]
```

---

## 2. Detalhamento das Alterações Técnicas

### A. Fluxo de Entrada na Landing Page (`LandingPage.tsx` & `App.tsx`)
1. **Redirecionamento do Botão de Trial**:
   - No `App.tsx`, configurar `onStartFreeTrial={() => setIsAuthModalOpen(true)}` em vez de abrir o modal de cobrança com PIX.
2. **Remoção do Link Redundante no Hero**:
   - Remover o bloco `.sm:hidden pt-1 pb-2` contendo "Já tem conta? Fazer Login".
3. **Navegação Suave com URLs Limpas (Sem `#`)**:
   - Substituir os links `<a href="#faq">` e `<a href="#planos">` por manipuladores de clique com `e.preventDefault()`.
   - Executar rolagem suave: `document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth' })`.
   - Utilizar `window.history.replaceState(null, '', window.location.pathname)` para garantir que a barra de endereços continue estritamente limpa (`fatosbr.com.br`) sem sufixos como `#FAQ` ou `#top`.

### B. Novo Modal de Autenticação (`AuthModal.tsx`)
1. **Remoção Completa do "Link Mágico"**:
   - Eliminar a aba de Magic Link e seus estados correlatos.
   - Apenas duas abas: **"Entrar"** e **"Criar Conta"**.
2. **Destaque ao Login com Google**:
   - Botão proeminente **"Continuar com o Google"** no topo, integrando com o callback `https://fatosbr.com.br/oauth/consent` e fallback gracioso de demonstração.
3. **Tela de Código Verificador de 6 Dígitos (`step === 'verify-code'`)**:
   - Ao submeter e-mail e senha no cadastro ou login, o modal avança para a tela de verificação.
   - Interface com 6 caixas numéricas (`input` de 1 dígito com foco automático e colagem de código completo).
   - Botão "Confirmar e Acessar FatosBR".
   - Temporizador regressivo para reenvio e link "Voltar e editar e-mail".
   - Validação com feedback visual claro (sucesso/erro).

### C. Logout Efetivo no Perfil (`ProfileView.tsx` & `App.tsx`)
1. **Sessão e Redirecionamento**:
   - No `App.tsx`, atualizar a função `onLogout` do `ProfileView`:
     - Chamar `await authService.signOut()`.
     - Limpar o usuário atual: `setCurrentUser(null)`.
     - Limpar avatar e perfil temporário se necessário.
     - Navegar para a Landing Page: `setCurrentNav('landing')`.
     - Resetar scroll para o topo: `window.scrollTo({ top: 0, behavior: 'smooth' })`.
2. **Confirmação Visual**:
   - Exibir feedback de desconexão e garantir que nenhuma interface do app logado continue visível.

---

## 3. Plano de Verificação

1. **Validação de Código e Linter**:
   - Executar `compile_applet` e `lint_applet` para assegurar 0 erros de compilação TypeScript.
2. **Teste da Landing Page e URLs**:
   - Clicar em "Começar 3 dias grátis" e validar que o modal de Login/Cadastro abre diretamente (sem PIX).
   - Clicar em links de navegação ("Recursos", "Planos", "FAQ") e conferir que a página rola suavemente sem adicionar hashtags na URL do navegador.
   - Verificar ausência do texto "Já tem conta? Fazer Login" no hero mobile.
3. **Teste do Fluxo de Autenticação**:
   - Testar o botão "Continuar com o Google".
   - Digitar e-mail e senha e verificar transição para a tela com 6 dígitos de verificação.
   - Testar digitação do código de 6 dígitos e aprovação de acesso ao Feed.
4. **Teste de Logout**:
   - Acessar o Perfil, clicar em "Sair da conta", confirmar o alerta e verificar retorno imediato à Landing Page no estado deslogado.
