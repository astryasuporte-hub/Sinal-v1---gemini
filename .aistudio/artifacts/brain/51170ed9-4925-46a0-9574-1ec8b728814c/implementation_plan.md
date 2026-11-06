# FATOSBR — MISSÃO P0: ESTABILIZAÇÃO DO RUNTIME E DEPLOY NA VERCEL

## 1. Diagnóstico do Deployment `dpl_9H3315ENuuZcjZyDeLgqxj3iqhMD`

1. **Alinhamento do Node.js Runtime (Engines vs Project Settings)**:
   - O `package.json` definia `"engines": { "node": ">=20.x" }`.
   - A Vercel interpretou a faixa aberta e selecionou automaticamente a versão mais recente (`Node.js 26.x`), sobrescrevendo a versão `24.x` configurada nas Project Settings do projeto `fatosbr`.
   - A Vercel emitiu os seguintes avisos:
     `Warning: Due to "engines": { "node": ">=20.x" } in your package.json file, the Node.js Version defined in your Project Settings ("24.x") will not apply, Node.js Version "26.x" will be used instead.`
     `Warning: Detected "engines": { "node": ">=20.x" } in your package.json that will automatically upgrade when a new major Node.js Version is released.`
   - **Correção**: Travado explicitamente em `"node": "24.x"` no `package.json`, eliminando a atualização automática para versões não-LTS.

2. **Eliminação de Colisão de Rotas Serverless (`api/[...path].ts`)**:
   - O arquivo `api/[...path].ts` atuava como um catch-all monolítico competindo com todas as 20 rotas filhas em `/api/`.
   - Na Vercel, cada arquivo em `/api` é empacotado como uma função independente; ter um catch-all na raiz do diretório gera colisões no roteador da Vercel.
   - **Correção**: Removido `api/[...path].ts`. Cada rota possui agora sua Serverless Function isolada.

3. **Criação de Endpoints Dedicados Faltantes**:
   - Criados `api/resend/config.ts` e `api/resend/preview.ts`, garantindo suporte nativo serverless para as chamadas do painel editorial e de configurações.

4. **Padronização dos Rewrites no `vercel.json`**:
   - Removido o rewrite reflexivo `/api/:match* -> /api/:match*`.
   - Aplicado o padrão canônico da Vercel:
     `"source": "/((?!api/.*).*)"` -> `"destination": "/index.html"`.
     Garante que todas as chamadas `/api/*` sejam despachadas diretamente para as funções serverless sem interceptação pela SPA.

---

## 2. Resultados das Validações

- **Type Check (`npm run lint` / `tsc --noEmit`)**: 0 erros.
- **Client Build (`bun run build` / `vite build`)**: 100% aprovado (2752 módulos).
- **Suíte de Segurança Financeira (`tests/security-validation.ts`)**: 52 testes aprovados (100%).
- **Compilação e Linter do Applet**: `compile_applet` e `lint_applet` 100% aprovados.
