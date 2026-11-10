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


