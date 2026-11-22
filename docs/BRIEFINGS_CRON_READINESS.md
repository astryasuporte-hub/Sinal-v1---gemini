# FatosBR — Prontidão de Agendamento Automático de Briefings (V2.4)

> **Estado atual:** A comercialização e o cron automático de geração de briefings em produção **não foram ativados** em `vercel.json` (preservando exclusivamente `0 10 * * *` para `/api/proxy/ingest`), aguardando homologação explícita em produção.

## 1. Endpoint de Execução Protegido
- **Rota:** `POST /api/notifications/generate-briefings` (ou `GET` autenticado para Vercel Cron)
- **Autenticação obrigatória:** Header `Authorization: Bearer <CRON_SECRET>` (ou `<ADMIN_SECRET>` / sessão admin `internal.user_roles`).
- **Trava de concorrência:** Execuções simultâneas para o mesmo `(type, localDate)` retornam HTTP `409 BRIEFING_CYCLE_ALREADY_RUNNING` usando mutex em memória + `pg_try_advisory_lock` quando PostgreSQL direto está configurado.

## 2. Parâmetros de Janela e Fuso Horário
- Quando acionado com `?respectSchedule=true`, o motor avalia o fuso horário (`user_preferences.timezone`, padrão `America/Sao_Paulo`) e os horários individuais (`morning_time`, padrão `07:00`; `evening_time`, padrão `20:00`) antes de gerar cada edição.
- A deduplicação por slot garante unicidade por `(user_id, type, local_date)` (`idx_briefing_delivery_slot`), com recuperação segura para slots em estado `FAILED`, `CANCELED` ou `GENERATING` expirado (> 15 min).

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
- `CRON_SECRET` — segredo compartilhado da Vercel Cron para autorizar `/api/notifications/generate-briefings`.
- `RESEND_API_KEY` e `RESEND_FROM_EMAIL` — credenciais e remetente verificado para disparo de e-mails.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — leitura e persistência server-side segura.
