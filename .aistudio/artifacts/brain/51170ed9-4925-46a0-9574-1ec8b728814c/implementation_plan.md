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

---

## 2. Resumo das Alterações por Arquivo

1. **`vercel.json`**: Adicionada chave `functions` mapeando `api/**/*.ts` para `includeFiles: "api/_lib/**"`.
2. **`api/proxy/[...action].ts`**: Importações estáticas com extensões `.js` para os 6 submódulos.
3. **`api/_lib/ingestionEngine.ts`**:
   - Correção dos imports com extensões `.js`.
   - Implementação de UUID v5 em tópicos e relacionamento `event_topics`.
   - Correção do `ON CONFLICT (canonical_url)` em `articles`.
   - Alinhamento estrito dos status `'DEVELOPING'`, `'CONFIRMED'`, `'UPDATED'` e `'PENDING'` em `events`.
4. **`api/_lib/handlers/proxy/events.ts`** e **`status.ts`**:
   - Extensões `.js` em todos os imports.
   - Retorno seguro HTTP 200 com array vazio e zero código 500 para base em inicialização.
5. **Todos os demais módulos de `api/`**:
   - 100% dos imports relativos normalizados com extensão `.js`.

---

## 3. Matriz de Validação e Testes Locais

| Teste | Escopo | Resultado |
|---|---|---|
| `bunx --bun tsc --noEmit` | Compilação TypeScript de todo o backend e frontend | ✅ 0 erros |
| `bun ./tests/canonical-events-validation.ts` | UUID v5 RFC 4122, TLS estrito, resiliência do feed, auth Bearer do cron e status | ✅ 100% Aprovado |
| `bun ./tests/news-engine-validation.ts` | Auditoria contra dados mockados, SWR cache, observabilidade e limite de 8 funções serverless | ✅ 9/9 Aprovados |
| `bun ./tests/security-validation.ts` | Rate limit distribuído, ZynPay HMAC, transações atômicas, anti-tampering, roteadores consolidados | ✅ 59/59 Aprovados |
| `bun run build` | Build do Vite para produção (2752 módulos) | ✅ Concluído em 2.30s |
| `compile_applet` & `lint_applet` | Verificação do build system | ✅ Build & Lint Aprovados |
