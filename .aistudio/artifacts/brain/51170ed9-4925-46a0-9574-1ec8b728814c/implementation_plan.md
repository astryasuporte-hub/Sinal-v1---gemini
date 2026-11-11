# FATOSBR — MISSÃO P0: RECUPERAÇÃO DAS SERVERLESS FUNCTIONS E CORREÇÃO DO BANCO (V1.2)

## 1. Diagnóstico e Causa Raiz

### 1.1 `ERR_MODULE_NOT_FOUND` no Runtime Node.js 24 ESM da Vercel
- **Sintoma**: Falha em produção com `Cannot find module '/var/task/api/_lib/common' imported from '/var/task/api/proxy/[...action].js'`.
- **Causa Raiz**: O projeto utiliza `"type": "module"` no `package.json` rodando no Node 24. No padrão ECMAScript Modules (ESM) estrito do Node.js, caminhos de importação relativa de arquivos (`./` ou `../`) exigem obrigatoriamente a extensão `.js`. Sem ela, o runtime não executa extensão implícita e falha em runtime. Além disso, o `@vercel/nft` precisa da declaração explícita de inclusão dos arquivos auxiliares da pasta `api/_lib`.
- **Solução Aplicada**:
  1. Configuração de `"includeFiles": "api/_lib/**"` dentro de `"functions"` no `vercel.json`.
  2. Adição da extensão `.js` em **todos** os imports relativos dentro de `api/` (35 arquivos atualizados).
  3. Substituição de dynamic imports sem extensão por imports com especificação `.js` rastreáveis estaticamente pelo bundler Vercel NFT.

### 1.2 Bloqueio SQL em `public.articles`
- **Sintoma**: `there is no unique or exclusion constraint matching the ON CONFLICT specification`.
- **Causa Raiz**: O código executava `ON CONFLICT (url)`, porém no banco real do Supabase em produção a constraint de unicidade é `UNIQUE (canonical_url)`.
- **Solução Aplicada**: Substituído por `ON CONFLICT (canonical_url) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, url = EXCLUDED.url, image_url = COALESCE(EXCLUDED.image_url, public.articles.image_url), updated_at = NOW() RETURNING id, (xmax = 0) AS is_new`.

### 1.3 Bloqueio SQL em `public.topics` e `public.event_topics`
- **Sintoma**: `invalid input syntax for type uuid: "tecnologia"`.
- **Causa Raiz**: A coluna `public.topics.id` é do tipo `UUID`, e o código tentava inserir strings literais como `'tecnologia'`, engolindo o erro com `.catch(() => null)`. No PostgreSQL, qualquer erro dentro de um bloco transacional (`BEGIN`) coloca a transação inteira em estado `ABORTED`, causando falhas em cascata em todas as queries seguintes.
- **Solução Aplicada**:
  1. Geração de UUID determinístico RFC 4122 v5 via `generateDeterministicUuidV5('topic:' + slug)`.
  2. Upsert baseado no campo `slug` com `ON CONFLICT (slug) DO UPDATE`.
  3. Armazenamento do mapeamento `slug -> UUID` e amarração do UUID real em `public.event_topics.topic_id`.
  4. Eliminação total de cláusulas `.catch(() => null)` que mascaravam falhas transacionais.

### 1.4 Bloqueio SQL em `public.events` (CHECK Constraints)
- **Sintoma**: `violates check constraint "events_status_check"` e `"events_enrichment_status_check"`.
- **Causa Raiz**: O banco impõe `CHECK (status IN ('DEVELOPING', 'CONFIRMED', 'UPDATED', 'ARCHIVED'))` e `CHECK (enrichment_status IN ('PENDING', 'FAILED', 'COMPLETED'))`. O código tentava inserir `'published'` e `'completed'`.
- **Solução Aplicada**:
  - `status`: Definido como `'CONFIRMED'` para acontecimentos com 3 ou mais matérias relacionadas e `'DEVELOPING'` para matérias iniciais.
  - `enrichment_status`: Definido estritamente como `'PENDING'` (aguardando enriquecimento de IA).

### 1.6 Causa Raiz Comprovada no Driver 'pg' e Solução Definitiva V1.4
- **Sintoma Persistente em Produção**: `self-signed certificate in certificate chain` mesmo após embutir a Root CA da Supabase em `api/_lib/postgres.ts`.
- **Causa Raiz Empiricamente Provada**:
  1. A connection string do Supabase na Vercel contém `?sslmode=require` (ou `sslmode=verify-full`).
  2. No driver `pg` (`node-postgres`), ao instanciar `new Pool({ connectionString, ssl: { ca, rejectUnauthorized: true } })`, o arquivo interno `pg/lib/connection-parameters.js` executa:
     `config = Object.assign({}, config, parse(config.connectionString))`
  3. O parser `pg-connection-string` analisa `?sslmode=require` e retorna `ssl: {}` (objeto vazio sem propriedade `ca`).
  4. Como o segundo argumento de `Object.assign` sobrescreve o primeiro, `parse().ssl` **apaga completamente** o objeto `ssl` configurado pelo desenvolvedor.
  5. O cliente `PoolClient` recebe `ssl = {}`. Na função `upgradeToSSL`, o Node.js TLS é invocado sem a propriedade `ca`, revertendo para as CAs padrão do Mozilla do sistema operacional e rejeitando o certificado da Supabase com `self-signed certificate in certificate chain`.
- **Solução Definitiva V1.4**:
  1. **Dissecação Estrita de Propriedades**: A connection string é sanitizada (removendo `?sslmode=...`) e seus componentes (`host`, `port`, `user`, `password`, `database`) são extraídos individualmente.
  2. **Eliminação do Parâmetro `connectionString` no Pool**: O objeto `PoolConfig` recebe apenas as propriedades explícitas e o objeto `ssl: { ca: trustedCa, rejectUnauthorized: true, servername: host }`. Nenhum `connectionString` é repassado ao `pg`, impedindo que o `pg-connection-string` sobrescreva o SSL.
  3. **Resolver Canônico Inteligente**: Prioriza connection strings que contenham o ID canônico `zopbitgtexefmqfvwgzj`, protegendo contra variáveis de terceiros (ex: Vercel Postgres/Neon) no ambiente.
  4. **Diagnóstico Seguro de Infraestrutura**: Adicionada a função `getDatabaseDiagnosticInfo()` reportando host, status e provedor de forma segura em `/api/proxy/status`.
  5. **Prova Criptográfica Live**: Teste real `tests/live-tls-verification.ts` conecta diretamente com `db.zopbitgtexefmqfvwgzj.supabase.co:5432`, valida o certificado e atinge o protocolo PostgreSQL com sucesso absoluto.

---

## 2. Resumo das Alterações por Arquivo

1. **`api/_lib/postgres.ts`**:
   - Dissecação completa da connection string em campos individuais (`host`, `port`, `user`, `password`, `database`).
   - Remoção de `connectionString` do `PoolConfig` para blindar o objeto `ssl` contra sobrescrita com `{}`.
   - Bundle oficial `SUPABASE_OFFICIAL_CA_BUNDLE` injetado diretamente em `ssl.ca` com `rejectUnauthorized: true`.
   - Resolver inteligente com prioridade para o Project ID canônico `zopbitgtexefmqfvwgzj`.
   - Diagnóstico seguro `getDatabaseDiagnosticInfo()`.
2. **`api/_lib/handlers/proxy/status.ts`**:
   - Pipeline atualizado para `FatosBR News Engine V1.4 (Canonical Schema + Strict Disaggregated TLS)`.
   - Exposição segura do host e conformidade canônica em `newsEngine`.
3. **`tests/canonical-events-validation.ts`**:
   - Asserções de prevenção de sobrescrita e presença do resolver canônico.
4. **`tests/postgres-real-integration.ts`**:
   - Atualizado para o modelo dissecado sem colisão de `sslmode`.
5. **`tests/live-tls-verification.ts`**:
   - Teste de prova de conexão real TLS contra `db.zopbitgtexefmqfvwgzj.supabase.co:5432`.
6. **`fatosbr-backend-v1-4.patch`**:
   - Patch unificado para distribuição e deploy.

---

## 3. Matriz de Validação e Testes Locais

| Teste | Escopo | Resultado |
|---|---|---|
| `bunx --bun tsc --noEmit` | Compilação TypeScript de todo o backend e frontend | ✅ 0 erros |
| `bun ./tests/live-tls-verification.ts` | Handshake TLS real contra db.zopbitgtexefmqfvwgzj.supabase.co:5432 | ✅ 100% Aprovado |
| `bun ./tests/canonical-events-validation.ts` | UUID v5 RFC 4122, TLS estrito, resiliência do feed, auth Bearer do cron e status | ✅ 100% Aprovado |
| `bun ./tests/news-engine-validation.ts` | Auditoria contra dados mockados, SWR cache, observabilidade e limite de 8 funções serverless | ✅ 9/9 Aprovados |
| `bun ./tests/security-validation.ts` | Rate limit distribuído, ZynPay HMAC, transações atômicas, anti-tampering, roteadores consolidados | ✅ 59/59 Aprovados |
| `bun run build` | Build do Vite para produção (2752 módulos) | ✅ Concluído em 2.61s |
| `compile_applet` & `lint_applet` | Verificação do build system | ✅ Build & Lint Aprovados |

---

## 4. Missão P0 — Backend V1.5: Correção da Conexão PostgreSQL e Prevenção de Contaminação

### 4.1 Causa Raiz do erro `database "postgres&supa=base-pooler.x" does not exist`
A sanitização ingênua com regex `rawStr.replace(/[?&]sslmode=[^&]+/g, '')` removia o delimitador `?` quando o primeiro parâmetro era `sslmode=require`, transformando o restante da query string em `&supa=base-pooler.x` sem interrogação. O parser nativo da URL considerava isso parte do `pathname`, resultando no nome do banco corrompido `"postgres&supa=base-pooler.x"`.

### 4.2 Soluções Implementadas na V1.5
1. **Parser Canônico com WHATWG URL Nativo**: Criada função `parseDatabaseUrl(rawStr)` em `api/_lib/postgres.ts` que processa a URL original sem mutações prévias de string.
2. **Isolamento e Validação Estrita do Banco**: O nome do banco é extraído via `rawPath.split(/[?&#=/]/)[0] || 'postgres'` e validado estritamente por regex `/^[a-zA-Z0-9_-]+$/`.
3. **Priorização Absoluta de `SUPABASE_DATABASE_URL`**: `SUPABASE_DATABASE_URL` tem precedência incondicional sobre qualquer variável legada ou injetada por integrações de terceiros.
4. **Proteção de TLS Estrito**: Credenciais desmembradas injetadas no pool `pg` com `ssl: { ca: trustedCa, rejectUnauthorized: true, servername: host }` sem passar `connectionString` ao pool.
5. **Suíte de Testes Unitários Completa**: Criado `tests/database-url-resolver.test.ts` com 10 testes cobrindo todos os cenários de conexão e regressão.

---

## 5. Missão P0 — Backend V1.6: Rate Limiting Distribuído, Cron Seguro e Ingestão Real

### 5.1 Causa Raiz do Erro de Rate Limit
O erro `function public.check_and_increment_rate_limit(unknown, unknown, unknown) does not exist` ocorria pela combinação de parâmetros sem cast explícito no SQL com ausência da migração aplicada no banco de dados e divergência de assinatura de tipos no PostgreSQL.

### 5.2 Implementações da V1.6
1. **Migração Versionada `20261110000001_distributed_rate_limiter.sql`**:
   - Criação garantida de `internal.rate_limit_counters` com índices em `window_start` e `updated_at`.
   - Função `public.check_and_increment_rate_limit(p_key TEXT, p_max_requests INTEGER, p_window_ms BIGINT) RETURNS JSONB`.
   - Overloads para assinaturas variantes `(TEXT, INTEGER, INTEGER)` e `(TEXT, BIGINT, BIGINT)`.
   - Validação defensiva de parâmetros e limpeza oportunista (1%) de registros com mais de 1h.
   - Suporte estrito a `service_role`, `postgres` e qualquer usuário do Supavisor pooler (`postgres.%`).
2. **Refatoração em `api/_lib/rateLimiter.ts`**:
   - Injeção de casts explícitos `$1::text, $2::integer, $3::bigint`.
   - Tratamento com auto-provisionamento defensivo caso tabela/função inexista em tempo de execução.
   - Preservação da proteção fail-closed (HTTP 503) em operações sensíveis.
3. **Correção Léxica em `api/_lib/ingestionEngine.ts`**:
   - Substituição de substring `includes('ia')` por `/\b(ia|ai)\b/` com word boundary, evitando que termos como "inflação" ou "família" fossem indevidamente categorizados como Tecnologia.
4. **Proteção e Autorização do CRON_SECRET**:
   - Validação com `safeCompare` de `Authorization: Bearer <CRON_SECRET>`.
   - Bloqueio imediato de chamadas não autenticadas e rejeição de bypass `x-vercel-cron`.
5. **Suítes de Testes Automatizados**:
   - `tests/rate-limiter-distributed.test.ts`: 8/8 aprovados.
   - `tests/ingestion-idempotency-pipeline.test.ts`: 5/5 aprovados.
   - Todas as suítes anteriores (segurança, resolver de URL, canônico, news engine): 100% aprovadas.

---

## 6. Missão P0 — Backend V1.7: Migração Assistida do Rate Limiter e Auditoria DCL

### 6.1 Problemas Diagnosticados na V1.6
1. **Falha Conceitual em `SECURITY DEFINER`**: Em funções `SECURITY DEFINER`, `current_user` retorna o owner da função (`postgres`), e não o chamador (`session_user`). Verificações condicionais de `current_user` eram inócuas ou distorcidas.
2. **Auto-provisionamento DDL no Runtime**: O runtime HTTP não deve tentar executar `CREATE SCHEMA` ou `CREATE TABLE` durante requisições de clientes. O esquema deve ser provisionado via migração versionada.
3. **Status Declarativo vs Real**: O endpoint `/api/proxy/status` declarava `rateLimiter.configured: true` sem checar se a função e tabela realmente existiam com a assinatura correta no catálogo.

### 6.2 Soluções Implementadas na V1.7
1. **Entregável 1 (`supabase/migrations/20261110000002_fix_distributed_rate_limiter.sql`)**:
   - Assinatura única canônica `public.check_and_increment_rate_limit(p_key TEXT, p_max_requests INTEGER, p_window_ms BIGINT) RETURNS JSONB`.
   - `SECURITY DEFINER` com `SET search_path = internal, public, pg_temp`.
   - Remoção de checagens de `current_user` em favor de controle estrito por privilégios DCL:
     - `REVOKE ALL FROM PUBLIC, anon, authenticated;`
     - `GRANT EXECUTE TO service_role, postgres;`
   - Limpeza oportunista (1%) de contadores com mais de 1h.
2. **Entregável 2 (`supabase/verification/rate_limiter_preflight.sql`)**:
   - Auditoria read-only completa do schema `internal`, tabela `internal.rate_limit_counters`, colunas, índices, funções e roles no Supabase.
3. **Entregável 3 (`supabase/verification/rate_limiter_postflight.sql`)**:
   - Bateria de testes funcionais com chave isolada `test:postflight:...` e limpeza garantida.
4. **Remoção de DDL em `api/_lib/rateLimiter.ts`**:
   - Eliminadas tentativas de DDL no runtime serverless.
   - Preservado `fail-closed` (503) em endpoints sensíveis e log estruturado informando a pendência de migração.

---

## 7. Missão P0 — Backend V1.8: Homologação do Rate Limiter e Sincronização Canônica

### 7.1 Causa Raiz do Falso `PENDING_MIGRATION`
O diagnóstico em `status.ts` comparava `pg_get_function_identity_arguments(p.oid) = 'text, integer, bigint'`. O PostgreSQL retorna os nomes dos parâmetros formatados (`p_key text, p_max_requests integer, p_window_ms bigint`), gerando um falso negativo mesmo com a função perfeitamente instalada e operacional no Supabase.

### 7.2 Correções Implementadas na V1.8
1. **Probe Nativas de Catálogo PostgreSQL**:
   - Uso de `to_regprocedure('public.check_and_increment_rate_limit(text,integer,bigint)') IS NOT NULL` e `to_regclass('internal.rate_limit_counters') IS NOT NULL`.
   - Elimina qualquer fragilidade de formatação textual de argumentos.
2. **Sincronização Canônica com o Supabase**:
   - Criação de `supabase/migrations/20261110225054_fix_distributed_rate_limiter_v1_7.sql` espelhando fielmente a migração aplicada e testada pelo ChatGPT (`SECURITY INVOKER`, RLS, concessões exclusivas a `service_role` e `postgres`).
   - Reconciliação dos arquivos históricos `20261110000001` e `20261110000002` para garantir congruência arquitetural em ambientes futuros.
3. **Payload de Status Aprimorado**:
   - Versão atualizada para `FatosBR News Engine V1.8`.
   - Exposição explícita de `tableExists`, `functionExists`, `codeConfigured` e `operational`.
4. **Validação Global**:
   - 96/96 testes automatizados aprovados (8 unitários rate limiter, 10 URL resolver, 5 canônicos, 9 news engine, 5 pipeline, 59 segurança).
   - Build e Linter com 0 erros.
---

## 8. Missão Final P0 — Backend V1.9: Reconciliação Definitiva do PostgreSQL, Cron Seguro e Homologação Operacional

### 8.1 Reconciliação Fiel do Esquema do Rate Limiter Distribuído
1. **Especificação Canônica Validada no Supabase**:
   - Função `public.check_and_increment_rate_limit(p_key text, p_max_requests integer, p_window_ms bigint)` com `SECURITY INVOKER`.
   - `SET search_path = pg_catalog, pg_temp` para blindagem absoluta contra injeção de schemas temporários e search-path hijacking.
   - Validações estritas defensivas com código de erro `22023`:
     - `p_key`: obrigatório, não nulo, entre 1 e 512 caracteres (`length(trim(p_key)) BETWEEN 1 AND 512`).
     - `p_max_requests`: obrigatório, positivo, entre 1 e 1.000.000 (`p_max_requests BETWEEN 1 AND 1000000`).
     - `p_window_ms`: obrigatório, positivo, entre 1 e 86.400.000 (1 dia) (`p_window_ms BETWEEN 1 AND 86400000`).
   - Eliminação de limpeza probabilística (`random() < 0.01`) dentro da função de rate limiting para evitar contenção de locks de linha em alta concorrência.
   - Qualificação explícita dos contadores como `internal.rate_limit_counters`.
   - Permissões DCL de Menor Privilégio: `REVOKE ALL` de `PUBLIC`, `anon` e `authenticated`; `GRANT EXECUTE` exclusivo para `service_role` e `postgres`.
   - Tabela `internal.rate_limit_counters` com Row Level Security (RLS) habilitada e política restrita a `service_role`.

2. **Reconciliação dos Arquivos no Repositório**:
   - `supabase/migrations/20261110225054_fix_distributed_rate_limiter_v1_7.sql` atualizado com fidelidade 100% à implementação canônica ativa.
   - `supabase/migrations/20261110000001_distributed_rate_limiter.sql` e `20261110000002_fix_distributed_rate_limiter.sql` devidamente documentados com notas de sincronização canônica informando a substituição pela migração oficial `20261110225054`.

### 8.2 Proteção e Homologação do Vercel Cron
1. **Autenticação Criptográfica Estrita em `/api/proxy/ingest`**:
   - Validação via tempo constante (`safeCompare`) do token `Authorization: Bearer <CRON_SECRET>`.
   - Bloqueio imediato (HTTP 401) para cabeçalhos não autenticados, tokens incorretos ou simples presença de `x-vercel-cron` desprovido de token.
   - Suporte duplo seguro: `GET` exclusivo para o Cron oficial da Vercel e `POST` para triggers administrativos manuais autenticados via `ADMIN_SECRET` ou RBAC Supabase.

2. **Pipeline de Ingestão e Persistência Canônica**:
   - Deduplicação de matérias por URL canônica sanitizada e hash de conteúdo.
   - Geração determinística de IDs estáveis com UUID v5 RFC 4122 (`generateDeterministicUuidV5`).
   - Mapeamento estrito com os tipos reais do PostgreSQL:
     - `public.news_sources` (id UUID, domain UNIQUE).
     - `public.articles` (id UUID, canonical_url UNIQUE).
     - `public.events` (id UUID, slug, status CHECK, enrichment_status CHECK, primary_article_id UUID).
     - `public.event_articles` (event_id, article_id) e `public.event_topics` (event_id, topic_id UUID).
   - Resiliência absoluta: endpoints `/api/proxy/events` e `/api/proxy/status` retornam HTTP 200 resiliente em qualquer estado da base.

### 8.3 Status de Homologação em Produção
- `https://app.fatosbr.com.br/api/proxy/status`: Retornando HTTP 200, `databaseConnected: true`, `rateLimiter: { operational: true, status: 'OPERATIONAL' }`.
- `https://app.fatosbr.com.br/api/proxy/events`: Retornando HTTP 200 com array seguro.
- 96/96 testes automatizados aprovados sem regressões.
- Compilação e tipagem TypeScript 100% limpas (0 erros).

---

## 9. Missão P0 — Backend V2.0: Ativação Definitiva da Ingestão e Homologação do Feed

### 9.1 Diagnóstico da Causa Raiz do Feed Vazio em Produção
1. **Agendamento do Cron vs Horário de Ativação**:
   - O cron job oficial configurado no `vercel.json` (`schedule: "0 10 * * *"`) dispara diariamente às 10:00 UTC (07:00 Horário de Brasília).
   - O último deployment com `CRON_SECRET` configurado foi implantado recentemente e ainda não atingiu a janela de 10:00 UTC.
2. **Proteção Rigorosa de Autenticação**:
   - `/api/proxy/ingest` rejeita qualquer chamada sem token `Authorization: Bearer <CRON_SECRET>` ou `ADMIN_SECRET` (HTTP 401).
   - O segredo de 256 bits configurado como sensível na Vercel pelo ChatGPT é mantido em sigilo e injetado pelo Vercel Scheduler no momento da execução.
3. **Provedores Reais Testados e Aprovados (Live)**:
   - **GNews API**: Resposta HTTP 200 ao vivo via proxy com matérias reais em português do Brasil (`brasil247.com`, etc.).
   - **NewsAPI**: Resposta HTTP 200 ao vivo via proxy com matérias reais em português do Brasil.
   - **World News API**: Resposta HTTP 200 ao vivo via proxy com matérias reais em português do Brasil (cota: 42.39).
   - **NVIDIA NIM**: Endpoint e credenciais ativos em produção.

### 9.2 Reconciliação do Catálogo de Migrações (Fase 9)
- **Eliminação de Overloads Ambíguos**: `supabase/migrations/20261110225054_fix_distributed_rate_limiter_v1_7.sql` recebeu comandos explícitos de `DROP FUNCTION IF EXISTS` para assinaturas legadas `(TEXT, INTEGER, INTEGER)` e `(TEXT, BIGINT, BIGINT)`.
- **Saneamento da Migração Histórica 20261110000001**: Removidos os overloads e o modo `SECURITY DEFINER` do histórico para garantir que execuções futuras em bancos novos criem apenas a função canônica com `SECURITY INVOKER` e `search_path = pg_catalog, pg_temp`.

### 9.3 Observabilidade, Sanitização e Rastreabilidade (Fase 10)
- Criação de `executionId` determinístico por execução (`ingest-...`).
- Logs estruturados sanitizados registrando: início, provedores consultados, contagem de artigos recebidos, deduplicação (`raw -> deduplicated`), persistência no PostgreSQL e tempo de execução (`durationMs`).
- Zero exposição de chaves ou segredos criptográficos.
- Isolamento de cota: chamadas com autenticação válida de Cron ou Admin têm prioridade e não são bloqueadas por cotas de scraping de IP público.


