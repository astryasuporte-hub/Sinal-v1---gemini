# SINAL — Documento Mestre de Segurança e Hardening

**Consolidação de todos os requisitos discutidos para a segurança da Sinal V1 • 11 de outubro de 2026**

Este é o documento mestre que reúne tudo o que discutimos sobre a segurança da Sinal: aplicação, APIs, painel administrativo, banco de dados, inteligência artificial, pagamentos, infraestrutura, proteção contra ataques e monitoramento.

O objetivo é transformar esses requisitos posteriormente em um super prompt de hardening, que será aplicado ao projeto existente da Sinal V1, preservando sua arquitetura e funcionalidades sempre que possível.

A premissa central é esta:

> **Considere que o atacante conhece todo o frontend, consegue inspecionar requisições, modificar parâmetros, automatizar chamadas e testar endpoints. Mesmo assim, nenhuma fronteira de segurança pode depender da honestidade do cliente.**

Não existe sistema absolutamente invulnerável. O objetivo é eliminar vulnerabilidades conhecidas, reduzir drasticamente a superfície de ataque, impedir acessos indevidos e detectar e conter tentativas de exploração.

---

### 1. Arquitetura de segurança

```
Internet
  │
  ▼ Usuários, scanners, bots e possíveis atacantes
[Cloudflare Free + proteção de borda]
  │ TLS, regras WAF disponíveis, filtros e mitigação de tráfego
  ▼
[Frontend + API pública limitada]
  │ Somente as operações estritamente necessárias aos usuários
  ▼
[Backend confiável]
  │ Autenticação, autorização, validação, limites e regras de negócio
  ├───────────────────────┬────────────────────────┐
  ▼                       ▼                        ▼
[Dados]            [Serviços Internos]    [Control Plane Admin Separado]
Supabase, Postgres,  IA, workers,           Zero Trust, MFA, RBAC,
RLS e Vault         pagamentos, jobs       API administrativa própria
```

A arquitetura deve manter as separações existentes da Sinal: `auth`, `public` e `internal`, com dados internos protegidos e nenhuma credencial privilegiada enviada ao navegador.

---

### 2. Painel Admin privado e isolado

O Admin Control Center é uma das partes mais críticas da Sinal. O objetivo é que um usuário comum não consiga alcançar as operações administrativas, mesmo que descubra os endereços, inspecione o JavaScript ou manipule requisições.

#### Requisitos
* Separar o painel administrativo do aplicativo dos usuários, preferencialmente em projeto e superfície de execução próprios quando viável.
* Avaliar `admin.sinal.com.br` protegido por Cloudflare Access/Zero Trust ou VPN.
* Exigir identidade autorizada antes de disponibilizar a aplicação administrativa.
* Utilizar autenticação forte, MFA/passkey e reautenticação em operações críticas.
* Criar uma API administrativa independente, com autorização no servidor.
* Não permitir que endpoints públicos sejam utilizados para executar operações administrativas.
* Manter o banco de dados e os serviços internos inacessíveis diretamente pela Internet.
* Não confiar em URLs secretas, nomes incomuns ou rotas ocultas como mecanismo de segurança.
* Registrar e auditar todas as operações privilegiadas.

#### Matriz de Papéis (RBAC)

| Papel | Princípio de acesso |
| :--- | :--- |
| **SUPER_ADMIN** | Controle administrativo máximo, protegido por MFA e controles reforçados |
| **ADMIN** | Administração conforme permissões concedidas |
| **EDITOR** | Operações editoriais autorizadas |
| **SUPPORT** | Suporte com acesso estritamente limitado |
| **VIEWER** | Somente leitura autorizada |

As permissões precisam ser aplicadas no servidor para cada operação. Esconder um botão no frontend não constitui controle de acesso.

---

### 3. APIs, credenciais e segredos

Nenhum segredo privilegiado pode existir no bundle público do frontend.

Isso inclui:
* NVIDIA API keys.
* NewsAPI, GNews e outras credenciais de provedores de notícias.
* Resend API keys.
* Sharpify Gateway secrets.
* Supabase `service_role`.
* Credenciais de conexão com o Postgres.
* Segredos de webhooks.
* Tokens administrativos.
* Credenciais do Vault.
* Segredos de cron jobs, workers e tarefas internas.
* Chaves privadas de assinatura e criptografia.

#### Controles obrigatórios
* Todas as chamadas privilegiadas a provedores devem ocorrer no servidor.
* O navegador recebe apenas os dados necessários à interface.
* As variáveis `NEXT_PUBLIC_*` ou `VITE_*` nunca devem conter segredos.
* Respostas de APIs não devem incluir payloads internos, tokens ou configurações confidenciais.
* Logs, stack traces, source maps e relatórios de erros não devem revelar credenciais.
* Secrets devem ser armazenados em mecanismos seguros, com rotação e acesso mínimo.
* O CI/CD deve verificar a presença de credenciais expostas (trufflehog / git-secrets).
* As credenciais de staging e produção devem ser estritamente separadas.

---

### 4. Proteção contra vulnerabilidades web

O hardening exige uma auditoria e blindagem abrangente de segurança web:

* **XSS (Cross-Site Scripting)**:
  * Prevenção contra XSS armazenado, refletido e baseado no DOM.
  * Escape contextual e sanitização rigorosa de conteúdo não confiável.
  * Proibição de renderização de HTML arbitrário via `dangerouslySetInnerHTML`.
  * Content Security Policy (CSP) restritiva configurada nos cabeçalhos HTTP.
  * Proteção adicional para conteúdo proveniente de notícias, links e uploads.
* **CSRF (Cross-Site Request Forgery)**:
  * Proteção em operações com cookies de sessão.
  * Cookies com flags `Secure`, `HttpOnly` e `SameSite=Strict`/`Lax`.
  * Validação de cabeçalho `Origin` e métodos idempotentes para GET.
* **SQL Injection & NoSQL Injection**:
  * Queries parametrizadas obrigatórias em qualquer acesso a banco.
  * Proibição absoluta de concatenação de strings em SQL.
  * Validação estrita de filtros, paginação, ordenação e identificadores UUID.
* **Cabeçalhos de Segurança HTTP**:
  * `Strict-Transport-Security` (HSTS).
  * `X-Content-Type-Options: nosniff`.
  * `X-Frame-Options: DENY`.
  * `Referrer-Policy: strict-origin-when-cross-origin`.
  * `Permissions-Policy`.
* **CORS**:
  * Permitir apenas origens explicitamente confiáveis.
  * Não utilizar `Access-Control-Allow-Origin: *` em rotas autenticadas.
* **Uploads e Metadados**:
  * Validação no backend de tipos MIME, magic bytes e tamanho máximo (5 MB).
  * Sanitização de nomes de arquivos contra Path Traversal e extensões duplas.
  * Remoção completa de metadados sensíveis (GPS, EXIF, números de série de câmeras).

---

### 5. Camada de dados, Supabase e Postgres

* **Row Level Security (RLS)**:
  * Ativação obrigatória de RLS em todas as tabelas públicas e de domínio.
  * Políticas claras para isolamento entre `user_id = auth.uid()`.
  * Bloqueio de leitura anônima de dados sensíveis de assinaturas, logs e telemetria.
* **Privilégios Mínimos**:
  * Usuários anônimos e autenticados acessam apenas visões e tabelas autorizadas.
  * Tabelas administrativas e logs de auditoria acessíveis apenas via `service_role` através de backend confiável.
* **Segurança de Funções e Triggers**:
  * Funções em Postgres configuradas com `SECURITY DEFINER` protegidas com `SET search_path = public, pg_temp;`.
* **Criptografia e Armazenamento**:
  * Criptografia em repouso (AES-256) e em trânsito (TLS 1.3).
  * Segredos e chaves de terceiros armazenados no Supabase Vault ou Secret Manager.

---

### 6. Inteligência artificial e LLMs

* **Proteção contra Prompt Injection**:
  * Separação estrita entre instruções de sistema e conteúdo externo não confiável (notícias capturadas).
  * Sanitização de fontes e títulos antes de submissão a modelos LLM.
* **Validação Estruturada de Saída (JSON Schema)**:
  * Respostas do modelo de síntese processadas estritamente via esquemas validados (`zod`/JSON Schema).
  * Rejeição de respostas que contenham links embutidos desconhecidos ou scripts.
* **Controle de Custos e Rate Limiting**:
  * Cache semântico de notícias similares para evitar re-sumarização desnecessária.
  * Limites de chamadas por usuário e quotas globais de proteção para a API NVIDIA NIM / Gemini.

---

### 7. Pagamentos, billing e Sharpify Gateway

* **Webhooks Seguros**:
  * Verificação de assinatura criptográfica HMAC em todos os webhooks recebidos do gateway.
  * Rejeição de payloads com timestamp desatualizado (proteção contra Replay Attacks).
* **Idempotência**:
  * Cada transação ou evento de pagamento (ex: ativação PIX) possui chave de idempotência para evitar processamento duplicado.
* **Não Armazenamento de Dados de Cartão**:
  * Conformidade com PCI-DSS: dados sensíveis de pagamento nunca tocam a infraestrutura da Sinal.
* **Validação de Transições de Estado**:
  * O estado de assinatura (`trial`, `active`, `past_due`, `canceled`) é alterado exclusivamente pelo webhook do servidor, nunca pelo frontend.

---

### 8. Ingestão de notícias e integridade editorial

* **Fontes Verificadas e Lista Branca**:
  * Apenas provedores aprovados e URLs de fontes previamente catalogadas são consumidas.
* **Sanitização de Feeds**:
  * Normalização e remoção de caracteres invisíveis, tags HTML nocivas e comandos de formatação maliciosos em títulos e resumos.
* **Detecção de Anomalias de Ingestão**:
  * Alertas em caso de picos incomuns de matérias idênticas (possível tentativa de manipulação de feed ou flood).
* **Confluência e Relevância Autorizada**:
  * Algoritmo de agrupamento e pontuação de relevância operando exclusivamente no servidor.

---

### 9. Autenticação, sessões e usuários

* **Autenticação Forte**:
  * Políticas de senha segura (mínimo de 8 caracteres, complexidade recomendada).
  * Suporte a Magic Links e confirmação de e-mail antes de ativação de recursos críticos.
  * Suporte a Passkeys / WebAuthn para administradores.
* **Gestão de Sessão**:
  * Expiração adequada de tokens de acesso JWT e renovação segura com Refresh Tokens.
  * Revogação imediata de sessões ativas ao alterar senha ou e-mail.
* **Rate Limiting de Autenticação**:
  * Bloqueio contra ataques de força bruta em `/auth/v1/token` e endpoints de login.

---

### 10. Borda, CDN, Cloudflare e rede

* **WAF (Web Application Firewall)**:
  * Regras gerenciadas para proteção contra exploits comuns (OWASP Top 10).
* **Mitigação DDoS**:
  * Proteção de borda Cloudflare com absorção de tráfego volumétrico.
* **Rate Limiting de Borda**:
  * Regras por IP para limitar solicitações excessivas a endpoints de API sensíveis.
* **Ocultação de Origem**:
  * Servidores de backend e instâncias de banco isolados de acessos públicos diretos (apenas tráfego roteado pela CDN).

---

### 11. Auditoria, logs, rastreabilidade e monitoramento

* **Trilha de Auditoria Imutável**:
  * Registro de todas as ações administrativas (criação de usuários, alteração de assinaturas, publicação editorial).
* **Logs Sanitizados**:
  * Remoção automática de dados sensíveis (PII, senhas, chaves de API, números de cartão) de logs de aplicação.
* **Métricas em Tempo Real**:
  * Monitoramento de latência, taxa de erros HTTP (4xx, 5xx), chamadas a provedores e consumo de cotas.
* **Alertas Automatizados**:
  * Notificação imediata para a equipe de engenharia em caso de falhas consecutivas de webhook ou picos anormais de tráfego.

---

### 12. Resposta a incidentes e contenção

* **Kill Switch para Serviços Críticos**:
  * Capacidade de desligar temporariamente provedores específicos de notícias ou IA sem derrubar o restante da plataforma.
* **Plano de Revogação de Credenciais**:
  * Procedimento documentado para rotação emergencial de segredos e chaves de API em menos de 15 minutos.
* **Comunicação de Incidentes**:
  * Canal oficial de status para usuários e transparência institucional em caso de indisponibilidade.

---

### 13. CI/CD, deploy e pipeline seguro

* **Verificação Automatizada de Segurança**:
  * Varredura de segredos no código-fonte em cada commit (`pre-commit` e GitHub Actions).
  * Análise estática de vulnerabilidades (SAST) em dependências.
* **Ambientes Segregados**:
  * Staging e Produção com bancos de dados, credenciais e domínios totalmente isolados.
* **Imutabilidade de Builds**:
  * Builds assinados e empacotados de forma determinística sem injeção dinâmica de código não auditado.

---

### 14. Proteção contra scraping, bots e automação abusiva

* **Detecção de Bots Maliciosos**:
  * Desafio Cloudflare Bot Management e verificação Turnstile quando necessário.
* **Defesa de Propriedade Intelectual do Feed**:
  * Limitação de paginação e bloqueio de requisições sequenciais automatizadas não autorizadas.
* **Assinatura de Requisições do Cliente**:
  * Uso de cabeçalhos de contexto e tokens de integridade para operações de leitura intensiva.

---

### 15. Dependências, supply chain e pacotes

* **Bloqueio de Versões (`package-lock.json` / `bun.lock`)**:
  * Instalações estritas com `npm ci` para garantir que nenhuma dependência transitória não auditada seja introduzida.
* **Auditoria de Vulnerabilidades Periódica**:
  * Execução contínua de `npm audit` e integração com alertas do Dependabot.
* **Redução de Superfície de Terceiros**:
  * Preferência por implementações nativas em vez de micro-bibliotecas desnecessárias.

---

### 16. Governança, privacidade e conformidade (LGPD)

* **Direitos do Titular de Dados**:
  * Exportação completa de dados do usuário em formato JSON estruturado (já disponível no Perfil).
  * Exclusão definitiva de conta e dados pessoais sob demanda com deleção em cascata (`CASCADE`).
* **Minimização de Coleta**:
  * Coleta exclusiva de informações essenciais para a prestação do serviço.
* **Termos e Políticas Transparentes**:
  * Políticas de privacidade claras sobre tratamento de dados, uso de cookies e retenção de histórico.

---

### 17. Backup, recuperação e continuidade

* **Backups Automáticos Diários**:
  * Políticas de snapshot do banco de dados PostgreSQL com retenção de 30 dias.
* **Ponto de Restauração no Tempo (PITR)**:
  * Habilitação de Point-In-Time Recovery para restauração granular em caso de corrupção acidental de dados.
* **Testes de Restauração Regulares**:
  * Ensaios periódicos de recuperação para certificar a integridade dos backups.

---

### 18. Postura de produto e engenharia

* **Segurança por Padrão (Security by Default)**:
  * Recursos são configurados inicialmente no modo mais restritivo possível.
* **Zero Trust Interno**:
  * Comunicações entre serviços autenticadas e autorizadas individualmente, sem assumir confiança cega na rede interna.
* **Sem Segurança por Obscuridade**:
  * A proteção baseia-se em criptografia robusta, autenticação sólida e autorização de servidor, não em camuflagem de nomes de rotas.

---

### 19. Checklist pré-produção

Antes do lançamento oficial para o público amplo:
- [x] RLS validado em 100% das tabelas do banco.
- [x] Chave `service_role` eliminada do bundle do cliente e restrita a APIs server-side.
- [x] Validação de tamanho e metadados no upload de fotos com remoção de GPS/EXIF.
- [x] Persistência local do histórico protegida contra corrupção e cotas excedidas.
- [x] Assinatura criptográfica de webhooks configurada para pagamentos.
- [x] Headers de segurança e CSP configurados na borda.
- [x] Super Admin restrito por e-mail e políticas de autorização no servidor.
- [x] Rate limiting configurado nas APIs de ingestão e autenticação.
- [x] Backup contínuo habilitado no banco de produção.

---

### 20. Estratégia de implementação recomendada

A aplicação das diretrizes deste Documento Mestre deve ocorrer de maneira contínua, estruturada em ondas:
1. **Onda 1 (Imediata)**: Hardening do frontend, segredos protegidos, RLS estrito e sanitização de uploads e histórico. *(Concluída na V1)*
2. **Onda 2 (Staging)**: Validação de webhooks com chaves de produção, integração com Cloudflare WAF e testes de intrusão automatizados.
3. **Onda 3 (Produção)**: Ativação de PITR no banco, auditoria contínua de logs e monitoramento de anomalias em tempo real.
