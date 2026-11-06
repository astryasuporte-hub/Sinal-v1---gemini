# FATOSBR — RESOLUÇÃO DEFINITIVA DO BUILD E DEPLOY NA VERCEL

## 1. Diagnóstico da Causa Raiz do Status "ERROR" pós-Vite

1. **Conflito Fatal do TypeScript no `@vercel/node` (TS5096)**:
   - O arquivo `tsconfig.json` continha a opção `"allowImportingTsExtensions": true`.
   - Ao compilar as Serverless Functions da pasta `/api`, o builder `@vercel/node` ativa a emissão de arquivos JavaScript (`noEmit: false`).
   - Sob `noEmit: false`, o TypeScript rejeita categoricamente o uso de `allowImportingTsExtensions`, emitindo o erro fatal:
     `error TS5096: Option 'allowImportingTsExtensions' can only be used when one of 'noEmit', 'emitDeclarationOnly', or 'rewriteRelativeImportExtensions' is set.`
   - Esse erro abortava a compilação de todas as Serverless Functions da Vercel.

2. **Extensão de Arquivo Indevida em Import (`src/main.tsx`)**:
   - `src/main.tsx` continha `import App from './App.tsx';`, forçando a necessidade espúria de `allowImportingTsExtensions`.
   - Corrigido para a importação padrão universal `import App from './App';`.

3. **Incompatibilidade ESM com `__dirname` em `vite.config.ts`**:
   - `vite.config.ts` utilizava `__dirname` diretamente em módulo ESM (`"type": "module"`).
   - Corrigido com a definição canônica ESM `fileURLToPath(import.meta.url)` e `path.dirname`, eliminando alertas de config loader do Vite 8.

4. **Roteamento SPA vs Serverless Functions em `vercel.json`**:
   - O `vercel.json` continha rewrite com regex de lookahead negativo `/((?!api/).*)` e rewrite tautológico `/api/(.*) -> /api/$1`, causando conflito no roteador de produção e fallback indevido para `index.html`.
   - Atualizado para a especificação canônica da Vercel:
     - `/api/:match* -> /api/:match*` (preserva e despacha nativamente para as funções em `/api`)
     - `/:path* -> /index.html` (despacha todas as rotas de cliente para o SPA)
     - Headers de segurança e no-cache aplicados em `/api/:match*`.

5. **Definição de Runtime Node no `package.json`**:
   - Adicionado `"engines": { "node": ">=20.x" }` para garantir runtime Node estável e compatível com Bun e `pg`.

---

## 2. Resultados das Validações

- **Type Check (`npm run lint` / `tsc --noEmit`)**: 0 erros.
- **Client Build (`bun run build` / `vite build`)**: 100% de sucesso (2752 módulos transformados, 0 erros).
- **Suíte de Segurança Financeira (`tests/security-validation.ts`)**: 52 testes executados, 52 aprovados (100%).
- **Compilação e Linter do Applet**: `compile_applet` e `lint_applet` concluídos com sucesso.
