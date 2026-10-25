# Plano de Implementação: Sincronização Automática de Usuários e Tabela Completa no Painel Admin

Correção do rastreamento e contagem de usuários autenticados (via Google OAuth e E-mail/Senha) no Painel Administrativo. A solução implementa sincronização ativa de perfis no banco de dados (`profiles`), política de acesso para o Super Admin contornar restrições de RLS, cache de agregação resiliente de contas e uma tabela analítica completa com e-mail, data, provedor, plano e status do leitor.

---

## Diagnóstico da Causa Raiz

1. **Ausência de Upsert Ativo pelo Cliente**: Ao logar com Google OAuth ou e-mail, o Supabase registra a conta em `auth.users`, mas nenhuma inserção direta era garantida na tabela `public.profiles`. Sem essa linha, consultas administrativas em `profiles` retornam apenas o fallback estático.
2. **Restrição de Row Level Security (RLS)**: A política padrão do Supabase (`auth.uid() = id`) restringe a leitura estritamente ao próprio ID do usuário conectado. Mesmo quando o Super Admin (`astryasuporte@gmail.com`) consultava a tabela, o banco ocultava os demais usuários.
3. **Métricas Estáticas no Painel**: Sem a sincronização e agregação de contas reais, o contador de usuários ativos permanecia travado em `1` (Astrya Suporte).

---

## Arquitetura de Sincronização de Usuários

```
          [Usuário faz Login com Google ou E-mail]
                              │
                              ▼
        [Supabase Auth: Sessão criada em auth.users]
                              │
                              ▼
           [handleUserSession / syncUserProfile]
       ┌──────────────────────────────────────────────┐
       │ 1. Upsert em public.profiles (token do user) │
       │ 2. Gravação no Registro de Contas Autenticadas│
       │ 3. Sincronização de metadados (nome/avatar)  │
       └──────────────────────┬───────────────────────┘
                              │
                              ▼
           [Super Admin acessa o Painel Admin]
       ┌──────────────────────────────────────────────┐
       │ 1. Consulta public.profiles (Policy Admin)   │
       │ 2. Mescla com Registro Agregado              │
       │ 3. Atualiza contadores de métricas em tempo  │
       │    real (Total de usuários, Pro, Trials)     │
       └──────────────────────┬───────────────────────┘
                              │
                              ▼
         [Tabela Analítica Completa no AdminPanel]
         - Avatar + Nome + E-mail
         - Provedor (Google / E-mail)
         - Data e horário do cadastro
         - Plano (FatosBR Pro / Trial 7D)
         - Status (Ativo / Em avaliação)
         - Ações (Promover, Ver histórico, Filtrar)
```

---

## Detalhamento das Alterações Técnicas

### 1. Sincronização Ativa de Perfil (`src/services/userService.ts` & `src/services/authService.ts`)
- Criar a função `syncUserProfile(user: SupabaseUser)`:
  - Realiza `upsert` com `onConflict: 'id'` na tabela `public.profiles` contendo:
    - `id`, `email`, `full_name`, `avatar_url`, `plan_name` (padrão `TRIAL_7D`), `subscription_status` (`TRIAL_ACTIVE`), `created_at` e `updated_at`.
  - Registra a conta no cache agregado local `sinal_registered_accounts_registry`, garantindo que contas que fizeram login no ambiente sejam imediatamente reconhecidas pelo painel mesmo antes de replicações remotas.
- Chamar `syncUserProfile` em todos os pontos de autenticação:
  - `handleUserSession` no `App.tsx`.
  - Callback de OAuth consent (`/oauth/consent`).
  - Sucesso do código de 6 dígitos no `LoginPage.tsx`.

### 2. Acesso do Super Admin e Atualização de RLS (`src/services/adminService.ts` & `supabase/schema.sql`)
- **Atualização em `adminService.getUsers()`**:
  - Consulta `public.profiles`.
  - Mescla dinamicamente com o registro de contas autenticadas para garantir que nenhuma conta seja perdida por restrições de permissão.
  - Formata cada usuário com:
    - `id`, `email`, `fullName`, `avatarUrl`, `provider` (Google / Senha), `planName`, `subscriptionStatus`, `createdAt`, `isAdmin`.
- **Atualização em `adminService.getMetrics()`**:
  - Calcula a contagem real de usuários ativos (`Math.max(users.length, totalContas)`).
  - Calcula a contagem real de assinantes pagos e testes ativos.
- **Script SQL para Supabase (`supabase/schema.sql`)**:
  - Adicionar política RLS permitindo que `astryasuporte@gmail.com` leia todos os perfis:
    ```sql
    CREATE POLICY "Super Admin lê todos os perfis" ON public.profiles
      FOR SELECT USING (
        (auth.jwt() ->> 'email') = 'astryasuporte@gmail.com'
        OR is_admin = true
      );
    ```
  - Disponibilizar card com botão de cópia do script SQL diretamente na aba "Sistema / Banco de Dados" do Painel Admin.

### 3. Tabela Completa de Usuários no Painel Admin (`src/components/AdminPanel.tsx`)
- Reformular a aba de usuários:
  - **Barra de Controle Superior**:
    - Campo de busca em tempo real (filtra por e-mail, nome ou ID).
    - Filtro por Plano (`Todos`, `Pro`, `Trial 7 Dias`).
    - Filtro por Provedor (`Todos`, `Google`, `E-mail`).
    - Botão "Atualizar Lista" com spinner de recarregamento.
  - **Tabela Responsiva**:
    - Coluna Usuário: Avatar, Nome Completo, E-mail.
    - Coluna Provedor: Badge com ícone do Google ou E-mail.
    - Coluna Plano: Badge Pro (verde) ou Trial (azul).
    - Coluna Status: Ativo / Em avaliação.
    - Coluna Cadastro: Data e horário formatados em português.
    - Coluna Ações: Badge "Super Admin" ou detalhes do perfil.
  - **Cards de Métricas Atualizados**:
    - Total de Usuários Cadastrados.
    - Assinantes Pro Ativos.
    - Usuários em Teste Grátis (Trial).

---

## Plano de Verificação

1. **Validação de Código e Linter**:
   - Executar `lint_applet` e `compile_applet` para assegurar 0 erros de compilação.
2. **Teste de Sincronização**:
   - Realizar login com uma conta de teste (Google ou e-mail/senha).
   - Acessar o Painel Admin com a conta `astryasuporte@gmail.com`.
   - Verificar se o novo e-mail aparece imediatamente na tabela de usuários e se a métrica de "Usuários Ativos" incrementou corretamente.
3. **Teste de Filtros e Busca**:
   - Buscar pelo e-mail recém-cadastrado na tabela do painel admin.
   - Alternar filtros de plano e provedor.
