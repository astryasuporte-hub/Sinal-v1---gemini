# FATOSBR V2.4.2 — Checklist de Ativação Controlada & Agendamento Vercel

> **REGRA DE SEGURANÇA OPERACIONAL:** Este documento descreve o roteiro passo a passo para ativação gradual em produção. **NÃO** ative crons em `vercel.json`, **NÃO** dispare e-mails reais e **NÃO** processe os 40 itens `PENDING` preexistentes em `internal.notification_outbox` sem autorização expressa da equipe de operação.

---

## 1. Pré-requisitos Validados em Homologação Isolada

- Arquitetura serverless preservada dentro do limite de **8 Vercel Serverless Functions** em `api/` (`api/_lib/**` fora da contagem).
- Migrações V2.4.1 (`20261122000002` a `20261122000005`) já aplicadas e auditadas no Supabase de produção (não reaplicar).
- `vercel.json` preservado intacto com apenas `/api/proxy/ingest` (`0 10 * * *`), sem ativação automática de novos crons.

---

## 2. Sequência de Ativação Controlada

### Passo 1 — Aplicar Migração Estritamente Incremental V2.4.2 no Supabase
Aplicar **somente** a nova migração incremental (não reaplicar V2.4.1):
- Arquivo: `supabase/migrations/20261123000001_v2_4_2_webhook_idempotency_and_revision_dedup.sql`

Conferência no SQL Editor do Supabase:
1. Tabela `internal.resend_webhook_events` criada com RLS habilitado (`service_role` apenas).
2. Funções RPC `public.claim_resend_webhook_event`, `public.complete_resend_webhook_event`, `public.fail_resend_webhook_event` e `public.apply_resend_webhook_event` com privilégios revogados de `PUBLIC`, `anon` e `authenticated`.
3. Coluna `public.notifications.event_revision` (`DEFAULT 1`) e índice único `idx_notifications_dedup_user_event_cat` atualizado com segurança para `(user_id, event_id, category, event_revision) WHERE event_id IS NOT NULL`.

### Passo 2 — Backfill Controlado de `public.event_entities`
1. Executar em modo **dry-run** (somente leitura):
   ```bash
   npx tsx scripts/backfill-event-entities.ts
   ```
2. Auditar `eventsWithMatches`, `linksPlanned` e `matchesPreview`.
3. Aplicar de forma idempotente:
   ```bash
   npx tsx scripts/backfill-event-entities.ts --apply
   ```
4. Confirmar persistência:
   ```sql
   SELECT COUNT(*) FROM public.event_entities;
   ```

### Passo 3 — Configurar Webhook Resend & `RESEND_WEBHOOK_SECRET`
1. No painel da **Resend**, cadastrar o webhook:
   - Endpoint: `https://app.fatosbr.com.br/api/resend/webhook`
   - Eventos assinados: `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`
2. Copiar o Signing Secret oficial (`whsec_...`) da Resend para a variável de ambiente `RESEND_WEBHOOK_SECRET` na Vercel (**Production**).
3. Realizar deploy/redeploy controlado e conferir o endpoint público de status:
   - `GET https://app.fatosbr.com.br/api/resend/status` -> confirmar `webhookConfigured: true` (sem expor segredos).

### Passo 4 — Drenagem Controlada do Backlog Inicial (40 itens `PENDING`)
Somente após autorização para liberar notificações in-app aos usuários:
1. Processar um **lote piloto pequeno (`limit=10`)**:
   ```bash
   curl -X POST "https://app.fatosbr.com.br/api/notifications/process-outbox" \
     -H "Authorization: Bearer ${CRON_SECRET}" \
     -H "Content-Type: application/json" \
     -d '{"limit":10,"maxBatches":1}'
   ```
2. Auditar o JSON de retorno (`runLog`, `claimed`, `completed`, `retried`, `deadLettered`, `notificationsCreated`, `statsAfter`) e verificar `public.notifications` no Supabase.
3. Estando saudável, drenar o restante em lotes controlados (`limit=25`, `maxBatches=2`).

### Passo 5 — Configuração de Agendamento Compatível com Vercel Hobby / Pro

Limites considerados:
- **Vercel Hobby**: até **2 Cron Jobs** em `vercel.json`, com frequência mínima diária por cron (1 slot já ocupado por `/api/proxy/ingest` às `0 10 * * *`), além do teto arquitetural de **8 Serverless Functions** no projeto.
- Todas as rotas protegidas aceitam `Authorization: Bearer ${CRON_SECRET}` via `GET` ou `POST` e possuem trava distribuída `fail-closed` em `internal.distributed_job_locks`.

#### Opção A — Agendador Externo Autenticado (Recomendado no plano Vercel Hobby)
Mantém o `vercel.json` dentro do limite gratuito com zero novas funções e permite frequência de 5–10 minutos na outbox e janelas horárias de briefings multi-timezone:
- **Outbox Worker** (a cada 10 min):
  `GET https://app.fatosbr.com.br/api/notifications/process-outbox?limit=25&maxBatches=2`
  Header: `Authorization: Bearer ${CRON_SECRET}`
- **Briefings Programados** (ex.: a cada 30 min com janela local + `respectScheduleWindow: true`):
  `POST https://app.fatosbr.com.br/api/notifications/generate-briefings`
  Header: `Authorization: Bearer ${CRON_SECRET}`
  Body piloto (in-app sem e-mail antes do rollout de e-mail): `{"type":"MORNING","sendEmail":false,"respectScheduleWindow":true}`

Exemplo de template **não ativado** para GitHub Actions (`schedule` a ser habilitado apenas quando autorizado):
```yaml
# Template para .github/workflows/fatosbr-workers.yml (NÃO ativar sem autorização)
on:
  schedule:
    - cron: '*/10 * * * *'
jobs:
  process-outbox:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Outbox Worker
        run: |
          curl --fail-with-body -sS -X GET \
            "https://app.fatosbr.com.br/api/notifications/process-outbox?limit=25&maxBatches=2" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

#### Opção B — 2º Cron Nativo no Plano Vercel Hobby (`vercel.json`)
Caso deseje apenas execução diária pós-ingestão utilizando o **2º slot gratuito** da Vercel Hobby (sem ativar agora):
```json
{
  "crons": [
    { "path": "/api/proxy/ingest", "schedule": "0 10 * * *" },
    { "path": "/api/notifications/process-outbox?limit=100&maxBatches=4", "schedule": "15 10 * * *" }
  ]
}
```

#### Opção C — Plano Vercel Pro
Permite múltiplos crons sub-diários nativos em `vercel.json` (ex.: `*/5 * * * *` para `/api/notifications/process-outbox` e horários por janela para `/api/notifications/generate-briefings`).

### Passo 6 — Rollout Gradual de E-mail dos Briefings
1. Manter `sendEmail: false` inicialmente para validar geração diária `MORNING`/`EVENING`, personalização e notificações `BRIEFING_READY` em produção.
2. Liberar `sendEmail: true` após confirmar entrega de teste em conta interna e recebimento do primeiro evento real `email.delivered` em `internal.resend_webhook_events` + `internal.briefing_email_deliveries`.
