# Plano de Implementação: Correção de Sessão, Perfil Dinâmico, Onboarding e Remoção de Elementos Visuais Indesejados

Ajuste completo da autenticação e experiência pós-login do FatosBR para garantir isolamento seguro entre usuário leitor e administrador, atualização dinâmica do perfil com o e-mail/Google correto, término efetivo de sessão no logout, tratamento da URL `/oauth/consent`, acionamento do onboarding de interesses no primeiro login, e limpeza de elementos visuais (mensagem verde de status e botão flutuante "Acessar Plataforma").

---

## Decisões Confirmadas com o Usuário

1. **Onboarding de Interesses**: Ao criar conta ou fazer login pela primeira vez, abrir o `OnboardingModal` com seleção de macro-temas e interesses antes de liberar o feed de notícias.
2. **Layout do Perfil**: Usuários comuns terão visão exclusiva de leitor (sem abas administrativas, métricas de backend ou painéis restritos; controles de Super Admin restritos estritamente ao e-mail autorizado `astryasuporte@gmail.com`).
3. **Limpeza da Landing Page**: Remover o botão flutuante inferior "Acessar Plataforma" e botões redundantes. Deixar apenas **"Começar 3 dias grátis"** e **"Fazer Login"** / **"Entrar"**.
4. **Remoção da Mensagem Verde**: Excluir a barra verde de status técnico (`Conectado ao Supabase Auth via chave pública (anon)`) do `AuthModal`.
5. **Tratamento do OAuth Consent**: Tratar a URL `/oauth/consent` para consumir o token do Supabase, limpar a URL via `replaceState` para `/` e redirecionar para o onboarding ou tela inicial com o perfil ativo.
6. **Logout Efetivo**: Ao tocar em "Sair da conta", deslogar completamente do Supabase, limpar storage local de usuário/perfil, retornar à Landing Page no estado deslogado e exibir os botões de entrada.

---

## Arquitetura de Sessão e Fluxo de Permissões

```
                      [Visitante em fatosbr.com.br]
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
   [Começar 3 dias grátis]                         [Fazer Login]
              └────────────────────┬────────────────────┘
                                   │
                                   ▼
                   [AuthModal (Sem mensagem verde)]
                      - Continuar com o Google
                      - E-mail e Senha + Código 6 dígitos
                                   │
             ┌─────────────────────┴─────────────────────┐
             ▼ (Google OAuth)                            ▼ (Email & Código)
     [/oauth/consent]                             [Validação Concluída]
     - Captura tokens na URL                             │
     - history.replaceState('/', ...)                    │
     - Restaura sessão limpa                             │
             └─────────────────────┬─────────────────────┘
                                   │
                                   ▼
                       [Novo Usuário Detectado?]
                      /                         \
            (Sim: Sem onboarding)            (Não: Já configurado)
                    /                             \
                   ▼                               ▼
       [Onboarding de Interesses]              [Feed do App]
       - Salva `sinal_onboarded_${id}`            │
                   │                              │
                   └───────────────┬──────────────┘
                                   │
                                   ▼
                         [Checagem de Role]
            ┌──────────────────────┴──────────────────────┐
            ▼                                             ▼
[astryasuporte@gmail.com]                  [Demais Usuários Leitores]
  • Painel Super Admin                       • Perfil Exclusivo do Leitor
  • Gestão de Conteúdo/Notícias              • Histórico e Leituras Salvas
  • Acesso a Controles Master                • SEM botões ou dados de admin
                                                          │
                                                          ▼
                                             [Toca em "Sair da conta"]
                                             - authService.signOut()
                                             - Limpa estado do usuário
                                             - Redireciona à Landing Page
```

---

## Detalhamento das Alterações nos Arquivos

### 1. `src/components/AuthModal.tsx`
- **Remover banner verde de status**: Excluir o bloco com o ícone de check e texto `"Conectado ao Supabase Auth via chave pública (anon)"`.
- **Garantir integridade do modal**: Manter apenas o botão "Continuar com o Google", abas de "Entrar" / "Criar Conta", campos de e-mail e senha, e a tela de código verificador de 6 dígitos.

### 2. `src/App.tsx`
- **Correção da falha de privilégios (`isSuperAdmin`)**:
  - Atualmente, se `currentUser` for nulo ou não validado, a lógica aplicava fallback `true`.
  - Corrigir para estrita validação: `currentUser?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()`, retornando `false` como padrão absoluto para qualquer outro usuário ou visitante.
- **Detecção e Tratamento da URL `/oauth/consent`**:
  - No `useEffect` de inicialização: verificar se `window.location.pathname.includes('/oauth')` ou se existem fragmentos com hash `#access_token` ou `?code=`.
  - Obter a sessão com `supabase.auth.getSession()`, sincronizar o `currentUser`, e imediatamente executar `window.history.replaceState(null, '', '/')` para deixar a URL limpa.
- **Acionamento do Onboarding Pós-Login**:
  - Ao autenticar um usuário, verificar `localStorage.getItem('sinal_onboarded_' + user.id)`.
  - Caso não exista, abrir `OnboardingModal` automaticamente antes de liberar a navegação comum.
  - Ao concluir o onboarding, marcar a flag no storage e direcionar para o feed de notícias (`home`).
- **Logout Completo e Redirecionamento**:
  - No `handleLogout`:
    - Chamar `await authService.signOut()`.
    - Setar `currentUser` para `null`.
    - Limpar caches locais de perfil.
    - Alterar `currentNav` para `'landing'`.
    - Rolar suavemente para o topo.

### 3. `src/components/ProfileView.tsx`
- **Sincronização Dinâmica do Usuário**:
  - Em vez de exibir dados fixos do administrador, derivar nome, e-mail e avatar diretamente das props `currentUser`:
    - Nome: `currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Leitor'`.
    - E-mail: `currentUser.email`.
    - Avatar: `currentUser.user_metadata?.avatar_url || currentUserAvatar`.
- **Isolamento de Perfil**:
  - Ocultar qualquer switcher ou menu de admin para quem não é `isSuperAdmin`.
  - Garantir que a visão apresentada seja estritamente a do leitor (histórico, interesses, leituras salvas e configurações pessoais).

### 4. `src/components/LandingPage.tsx`
- **Remoção do Botão Flutuante**:
  - Excluir o componente flutuante `<aside aria-label="Acesso Rápido"...>Acessar Plataforma</aside>`.
- **Limpeza dos Botões de Ação**:
  - No Hero e no Drawer mobile: deixar apenas **"Começar 3 dias grátis"** (que abre o fluxo de login/cadastro) e **"Fazer Login"** / **"Entrar"**.
  - Remover botões redundantes ("Acessar o App Agora").

### 5. `src/services/authService.ts`
- **Padronização da URL de Redirecionamento Google**:
  - Garantir que o `redirectTo` no `signInWithOAuth` aponte para `window.location.origin` (com suporte a fallback `/oauth/consent` caso configurado no console do Supabase).

---

## Plano de Verificação

1. **Compilação e Linter**:
   - Rodar `compile_applet` e `lint_applet` garantindo ausência de erros TypeScript.
2. **Validação do AuthModal**:
   - Abrir o modal de login e checar que a mensagem verde do Supabase foi removida.
3. **Validação de Logout**:
   - Fazer login, ir ao perfil, clicar em "Sair da conta" e checar se o estado de usuário é apagado e a landing page é exibida no modo visitante.
4. **Validação de Isolamento de Perfil & Usuário Dinâmico**:
   - Entrar com uma conta de leitor e verificar que o e-mail/nome refletem essa conta e nenhum recurso de super admin é exposto.
5. **Validação de Redirecionamento de URL**:
   - Verificar que a URL permanece limpa (`fatosbr.com.br`) sem ficar travada em `/oauth/consent` nem com hashtags `#`.
