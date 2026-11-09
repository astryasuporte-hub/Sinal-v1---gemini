# Guia Completo de Implantação: Sinal v1 na Vercel + Supabase + GitHub

Este guia orienta passo a passo como hospedar a plataforma **Sinal** em produção na **Vercel**, conectada ao seu repositório no **GitHub** e com banco de dados e autenticação gerenciados pelo **Supabase**.

---

## 1. Arquitetura da Solução

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS (Hospedado na Vercel com CDN Global Edge).
- **Backend / Banco de Dados**: PostgreSQL gerenciado no Supabase com Row Level Security (RLS).
- **Autenticação**: Supabase Auth (Suporte a Email/Senha, Magic Link sem senha e persistência de sessão).
- **CI/CD**: Deploy contínuo e automático a cada `git push` na branch `main` do GitHub via integração oficial da Vercel.

---

## 2. Passo 1: Configurar o Projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e faça login (ou crie sua conta gratuita).
2. Clique no botão **"New Project"**.
3. Escolha uma organização, defina o nome do projeto (ex: `sinal-production`), crie uma senha forte para o banco de dados e selecione a região mais próxima (ex: `South America (São Paulo)` ou `East US`).
4. Aguarde cerca de 1 a 2 minutos até o banco ser provisionado.

### 2.1. Executar o Script SQL de Migração
1. No menu lateral esquerdo do Supabase, clique no ícone **SQL Editor** (ou pressione `Ctrl + Shift + S`).
2. Clique em **"New Query"**.
3. Abra o arquivo local `supabase/schema.sql` deste projeto, copie todo o seu conteúdo e cole no editor do Supabase.
4. Clique no botão verde **"Run"** (no canto inferior direito).
5. Você verá a mensagem `Success. No rows returned`.
   - *O que foi criado automaticamente:*
     - Tabela `profiles` com sincronização automática do `auth.users`;
     - Tabela `user_preferences` para briefings matinais/noturnos por e-mail;
     - Tabelas de `events` (Acontecimentos), `topics` (Tópicos), `entities` (Empresas/Pessoas) e `sources` (Fontes);
     - Tabelas de persistência de itens salvos (`user_saved_events`), tópicos seguidos e histórico;
     - Índices de performance e regras de segurança (Row Level Security - RLS);
     - Carga inicial essencial de tópicos, fontes e entidades.

### 2.2. Obter as Chaves de API do Supabase
1. No menu lateral esquerdo, clique na engrenagem **Project Settings**.
2. Clique na seção **API** (ou **Data API**).
3. Localize e copie os seguintes valores:
   - **Project URL**: (ex: `https://xyzcompany.supabase.co`)
   - **Project API Keys > anon / public**: (chave longa que começa com `eyJhbGci...`)

---

## 3. Passo 2: Subir o Projeto no GitHub

Se você ainda não enviou este projeto para um repositório no GitHub:

1. Acesse [github.com](https://github.com) e crie um novo repositório vazio (ex: `sinal-app`). Não inicialize com README ou .gitignore (eles já existem no projeto).
2. No seu terminal ou máquina local, execute:

```bash
# 1. Inicializar git local (se ainda não estiver inicializado)
git init

# 2. Adicionar todos os arquivos
git add .

# 3. Criar commit inicial
git commit -m "feat: setup sinal v1 com supabase e vercel config"

# 4. Apontar para o repositório remoto (substitua pela sua URL do GitHub)
git remote add origin https://github.com/SEU_USUARIO/sinal-app.git

# 5. Definir branch principal e enviar os arquivos
git branch -M main
git push -u origin main
```

---

## 4. Passo 3: Deploy na Vercel

1. Acesse [vercel.com](https://vercel.com) e conecte com sua conta do GitHub.
2. No painel principal (Dashboard), clique no botão **"Add New..."** e selecione **"Project"**.
3. Em **"Import Git Repository"**, localize o repositório `sinal-app` e clique em **"Import"**.
4. Na tela de configuração do projeto (**Configure Project**):
   - **Project Name**: `sinal-app` (ou o nome desejado).
   - **Framework Preset**: Selecione `Vite` (a Vercel geralmente detecta automaticamente).
   - **Root Directory**: `./` (padrão).
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Expanda a seção **"Environment Variables"** e adicione as variáveis obtidas no Supabase:

| Nome da Variável | Valor |
| :--- | :--- |
| `VITE_SUPABASE_URL` | Sua URL do Supabase (ex: `https://seu-id.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Sua chave pública anon do Supabase |

*(Opcional: se desejar utilizar a geração de sínteses via Gemini em rotas específicas, adicione também `GEMINI_API_KEY`)*

6. Clique no botão azul **"Deploy"**.
7. Aguarde a Vercel compilar o projeto (geralmente menos de 60 segundos). Quando terminar, você receberá a URL de produção (ex: `https://sinal-app.vercel.app`).

---

## 5. Passo 4: Configurar URLs de Redirecionamento no Supabase Auth

Para que o Magic Link e confirmação de e-mail redirecionem os usuários de volta para o seu domínio na Vercel:

1. No painel do Supabase, vá em **Authentication** > **URL Configuration**.
2. No campo **Site URL**, preencha com a URL oficial da Vercel:
   `https://seu-projeto.vercel.app`
3. No campo **Redirect URLs**, clique em **"Add URL"** e adicione:
   - `https://seu-projeto.vercel.app/**`
   - `http://localhost:3000/**` (para testes locais)
4. Clique em **Save**.

---

## 7. Configuração do Backend FatosBR V1.3 (News Engine, Cron & TLS)

### 7.1. Variáveis de Ambiente na Vercel (Produção & Preview)

No painel da Vercel (**Settings** > **Environment Variables**), configure as seguintes variáveis:

| Variável | Descrição / Exemplo | Escopo |
| :--- | :--- | :--- |
| `SUPABASE_DATABASE_URL` | `postgresql://postgres.[ID]:[SENHA]@db.[ID].supabase.co:5432/postgres?sslmode=require` | Production, Preview |
| `CRON_SECRET` | Segredo aleatório de 32+ bytes (ex: `openssl rand -hex 32`) | Production, Preview |
| `ADMIN_SECRET` | Chave de administração para disparos manuais e testes | Production, Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta `service_role` do Supabase para operações privilegiadas | Production, Preview |
| `VITE_SUPABASE_URL` | `https://zopbitgtexefmqfvwgzj.supabase.co` | Production, Preview, Dev |
| `VITE_SUPABASE_ANON_KEY` | Chave pública anônima do Supabase | Production, Preview, Dev |
| `GNEWS_API_KEY` | Chave de API do provedor GNews | Production, Preview |
| `NEWSAPI_API_KEY` | Chave de API do provedor NewsAPI | Production, Preview |
| `WORLD_NEWS_API_KEY` | Chave de API do provedor World News API | Production, Preview |

### 7.2. Validação TLS Segura com PostgreSQL da Supabase
O backend da FatosBR V1.3 utiliza validação estrita com `rejectUnauthorized: true`. A cadeia de certificados da **Supabase Root 2021 CA** e **Intermediate CA 2021** está embutida de forma resiliente em `api/_lib/postgres.ts`, garantindo que não ocorra o erro `self-signed certificate in certificate chain` mesmo sem fornecer manualmente `SUPABASE_DB_CA`.

### 7.3. Ativação e Disparo do Cron de Ingestão de Notícias
1. **Automático**: O cron configurado em `vercel.json` (`schedule: "0 10 * * *"`) dispara diariamente às 10h UTC chamando `GET /api/proxy/ingest`. A Vercel injeta automaticamente o cabeçalho `Authorization: Bearer <CRON_SECRET>`.
2. **Manual (Admin)**: Pode ser disparado a qualquer momento via terminal ou cURL:
```bash
curl -X POST https://app.fatosbr.com.br/api/proxy/ingest \
  -H "Authorization: Bearer SEU_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["brasil", "economia", "tecnologia"]}'
```

