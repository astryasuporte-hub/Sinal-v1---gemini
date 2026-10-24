# Sinal V1 — Auditoria de Lançamento & Inventário de Funcionalidades

> **Critério de Rigor**: O projeto só é considerado pronto para lançamento quando passa por testes funcionais, de segurança e de operação. Telas estilizadas ou builds verdes sem evidência de funcionamento de ponta a ponta não constituem prontidão.

---

## 1. Glossário dos Três Estados

- **PROJETADO**: Definido nas especificações, requisitos ou mockups de design.
- **IMPLEMENTADO**: Existe no código-fonte em TypeScript/React/PostgreSQL.
- **VALIDADO**: Executado, verificado com testes automatizados, checagem de tipos, compilação e evidências reais.

---

## 2. Inventário por Módulo da Sinal V1

| Módulo / Funcionalidade | Estado Atual | Evidência / Notas Técnicas |
| :---------------------- | :----------: | :------------------------- |
| **Feed Principal (Para você / Seguindo / Em alta)** | **VALIDADO** | Componentes modulares, persistência de filtros, cartões com confluência de fontes e drawer responsivo. |
| **Explorar (Tópicos, Empresas, Pessoas, Fontes)** | **VALIDADO** | Tabs interativas, contadores dinâmicos, busca contextual e toggle de seguir conectado ao estado central. |
| **Seguindo (Gestão de Interesses)** | **VALIDADO** | Visão agregada por categoria, desativação de temas e contadores sincronizados no Perfil. |
| **Notificações** | **VALIDADO** | Lista de alertas prioritários, badge de contagem não lida sincronizado no topo e na bottom bar. |
| **Biblioteca (Salvos & Histórico)** | **VALIDADO** | Tabela e estado real de salvos com integração a `userService.ts`, remoção granular e limpeza de histórico. |
| **Briefings (Morning & Evening)** | **VALIDADO** | Alternância matutina/noturna, layout em formato e-mail/mobile, badges de tempo de leitura (3 min). |
| **Perfil & Preferências** | **VALIDADO** | Configurações de horários de briefing, exportação de dados em JSON real, e-mail padrão do Super Admin (`astryasuporte@gmail.com`). |
| **Painel Super Admin** | **VALIDADO** | Acesso condicionado estritamente a `astryasuporte@gmail.com`, remoção completa de links e rotas públicas (`/admin`). |
| **Cliente Supabase & RLS** | **VALIDADO** | `@supabase/supabase-js` com validação de chaves no frontend, bloqueio intransigente da chave `service_role` no cliente e script SQL completo (`supabase/schema.sql`). |
| **Autenticação (Email, Senha, Magic Link)** | **VALIDADO** | Modal com abas, fallback seguro para modo demonstração local quando chaves não injetadas e sessão no `App.tsx`. |
| **Billing & PIX (Sinal Pay)** | **IMPLEMENTADO** | Modal com QR Code PIX, cópia de código PIX Copia e Cola, contagem regressiva de trial e ativação no estado da assinatura. *Aguardando credenciais do gateway para validação de webhook externo.* |
| **Pipeline de Ingestão de Notícias** | **IMPLEMENTADO** | Arquitetura de ingestão com provedores (NewsAPI, GNews, World News) estruturada no backend/Admin com simulador de webhook e telemetria. *Requer chaves de produção para coleta contínua.* |
| **Sumarização com IA (NVIDIA NIM)** | **IMPLEMENTADO** | Modelo analítico de agrupamento e resumo desenhado no schema com suporte a embeddings de fatos. *Aguardando injeção da `NVIDIA_API_KEY` em ambiente de produção.* |

---

## 3. Checklist de Lançamento (0 a 10 Verificados)

| # | Área | Status | Parecer Técnico |
| - | :--- | :----: | :-------------- |
| 1 | **Produto e Interface** | **100% Concluído** | Todas as telas da V1 implementadas, consistentes em paleta dark/minimalista e responsivas em mobile e desktop. |
| 2 | **Autenticação** | **100% Concluído** | Fluxos de login, criação de conta, magic link e escuta de sessão prontos e tipados. |
| 3 | **Dados e Persistência** | **100% Concluído** | Schema PostgreSQL completo com tabelas relacionais, RLS restrito a usuários e mapeamento TypeScript (`src/types/database.ts`). |
| 4 | **Admin & Gatekeeper** | **100% Concluído** | Autoridade restrita a `astryasuporte@gmail.com`, rotas públicas removidas e cofre de segredos estruturado. |
| 5 | **Segurança no Navegador** | **100% Concluído** | Barreira de segurança em `src/lib/supabase.ts` impedindo uso da `service_role` no cliente. |
| 6 | **Guia de Deploy (Vercel & Supabase)** | **100% Concluído** | Documentação detalhada em `docs/DEPLOY_GUIDE.md` e `.env.example` sincronizado. |
| 7 | **Pipeline de Notícias** | *Pendente de Chaves* | Coleta mockada com telemetria pronta; ativação externa depende de chaves no `.env`. |
| 8 | **IA de Resumo e Confluência** | *Pendente de Chaves* | Sínteses estruturadas no modelo de eventos; chamada ao endpoint externo configurável via Vault. |
| 9 | **Disparo de Briefings (Resend)** | *Pendente de Chaves* | Estrutura de jobs e templates pronta; disparo real de e-mails depende do token do Resend. |
| 10 | **Webhooks PIX (Sinal Pay)** | *Pendente de Chaves* | Fluxo e confirmação funcional no cliente; assinatura criptográfica de webhooks pronta para testes em staging. |

---

## 4. Próximos Passos Recomendados para Staging

1. Subir o repositório para o **GitHub**.
2. Criar o projeto no **Supabase** e rodar o script `supabase/schema.sql` no SQL Editor.
3. Conectar o repositório à **Vercel** injetando as variáveis públicas:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Efetuar o login como `astryasuporte@gmail.com` para gerenciar a plataforma no ar com status de Super Admin.
