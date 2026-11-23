# FatosBR — Prontidão de Agendamento Automático, Multi-Fuso & Outbox (V2.4.1)

> **Estado atual:** A comercialização e o cron automático de geração de briefings em produção **não foram ativados** em `vercel.json` (preservando exclusivamente `0 10 * * *` para `/api/proxy/ingest`), aguardando homologação explícita em produção.

## 1. Endpoints Protegidos
- **Geração de Briefings:** `POST /api/notifications/generate-briefings` (ou `GET` autenticado para Vercel Cron)
- **Processamento da Fila de Alertas (Outbox):** `POST /api/notifications/process-outbox` (ou `GET` autenticado para Vercel Cron)
- **Webhook Resend Assinado:** `POST /api/resend/webhook` (validação criptográfica Svix/HMAC via `RESEND_WEBHOOK_SECRET`)
- **Autenticação obrigatória (Briefings & Outbox):** Header `Authorization: Bearer <CRON_SECRET>` (ou `<ADMIN_SECRET>` / sessão admin `internal.user_roles`).
- **Trava distribuída persistente (Fail-Closed):** Execuções simultâneas usam lease distribuído durável em PostgreSQL (`internal.distributed_job_locks` via `public.acquire_distributed_job_lock` + heartbeat), retornando:
  - `409 BRIEFING_CYCLE_ALREADY_RUNNING` / `409 OUTBOX_WORKER_ALREADY_RUNNING` quando já há worker ativo;
  - `503 BRIEFING_LOCK_STORE_UNAVAILABLE` / `503 OUTBOX_LOCK_STORE_UNAVAILABLE` se o repositório de lock estiver indisponível (sem fallback inseguro em memória).

## 2. Multi-Fuso Horário, Horário de Verão (DST) & Catch-Up (Plano Hobby)
- No plano Vercel Hobby (que suporta execuções diárias/baixa granularidade de cron), `?respectSchedule=true` avalia individualmente:
  - `timezone` (IANA, ex.: `America/Sao_Paulo`, `America/Manaus`, `America/New_York`, `Europe/Lisbon`, `Asia/Tokyo`);
  - `morning_time` / `evening_time` personalizados;
  - `weekend_edition` calculado no dia da semana local do usuário;
  - Transições de DST resolvidas via `Intl.DateTimeFormat` (`zonedWallTimeToUtcDate`).
- **Catch-up determinístico:** Após o horário programado local do usuário naquele `local_date`, a próxima execução elegível cria o briefing uma única vez por `(user_id, type, local_date)` (`idx_briefing_delivery_slot`), garantindo zero duplicação em reexecuções.
- **Limitação explícita do Plano Hobby:** Sem upgrade para cron horário/15min (Pro) ou dispatcher externo autenticado com `CRON_SECRET`, usuários em fusos horários muito distantes do horário do cron diário da Vercel só recebem no próximo disparo em UTC (catch-up no mesmo dia ou janela seguinte). Para entrega precisa minuto-a-minuto multi-fuso no futuro, recomenda-se cron a cada 15–30 min no Vercel Pro ou trigger agendado externo chamando o mesmo endpoint com `CRON_SECRET`.

## 3. Configuração Recomendada para Ativação Futura (`vercel.json`)
Somente após validação em ambiente real e aprovação para go-live, adicionar em `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/proxy/ingest",
      "schedule": "0 10 * * *"
    },
    {
      "path": "/api/notifications/process-outbox",
      "schedule": "15 10 * * *"
    },
    {
      "path": "/api/notifications/generate-briefings?type=MORNING&respectSchedule=true&sendEmail=true",
      "schedule": "0 10 * * *"
    },
    {
      "path": "/api/notifications/generate-briefings?type=EVENING&respectSchedule=true&sendEmail=true",
      "schedule": "0 23 * * *"
    }
  ]
}
```

## 4. Variáveis de Ambiente Necessárias na Vercel
- `CRON_SECRET` — segredo compartilhado para autorizar `/api/notifications/generate-briefings` e `/api/notifications/process-outbox`.
- `RESEND_API_KEY` — chave de API do Resend.
- `RESEND_FROM_EMAIL` — remetente verificado (`FatosBR Briefings <briefings@fatosbr.com.br>`).
- `RESEND_WEBHOOK_SECRET` — segredo de assinatura de webhooks do Resend (`whsec_...` ou HMAC).
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DATABASE_URL` — persistência server-side segura.
