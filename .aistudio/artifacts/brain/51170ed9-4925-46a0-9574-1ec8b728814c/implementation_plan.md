# FATOSBR — RESOLUÇÃO DO LIMITE DE SERVERLESS FUNCTIONS (HOBBY PLAN)

## 1. Diagnóstico do Erro Fatal `exceeded_serverless_functions_per_deployment`

- **Deployment afetado**: `dpl_EwAMtKNHULSfHJqa6hzHGZLKzgi4` (commit `a59c083402a4e9bf756eee05c37fecc101d09d7c`)
- **Etapa da falha**: `patchBuild`
- **Mensagem da Vercel**:
  `No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan. Create a team (Pro plan) to deploy more.`
- **Causa Raiz**: O projeto continha 23 arquivos `.ts` espalhados pelas pastas de `/api`, fazendo a Vercel gerar 23 funções serverless isoladas, violando o limite de 12 funções do plano Hobby.

---

## 2. Estratégia de Consolidação Arquitetural

Conforme a documentação da Vercel, arquivos e diretórios iniciados por `_` (como `_lib/`) são ignorados para a contagem de Serverless Functions. Os handlers reais foram movidos para `api/_lib/handlers/` e os pontos de entrada foram unificados por domínio de negócio:

### Mapeamento:
1. **`api/zynpay/[...action].ts`** (1 função) -> Atende `/api/zynpay/charges`, `/api/zynpay/webhook`, `/api/zynpay/balance`, `/api/zynpay/config`, `/api/zynpay/events`.
2. **`api/resend/[...action].ts`** (1 função) -> Atende `/api/resend/send`, `/api/resend/status`, `/api/resend/ticket`, `/api/resend/webhook`, `/api/resend/config`, `/api/resend/preview`.
3. **`api/proxy/[...action].ts`** (1 função) -> Atende `/api/proxy/gnews`, `/api/proxy/newsapi`, `/api/proxy/worldnews`, `/api/proxy/nvidia/chat`, `/api/proxy/status`.
4. **`api/auth/[...action].ts`** (1 função) -> Atende `/api/auth/send-otp`, `/api/auth/verify-otp`.
5. **`api/notifications/[...action].ts`** (1 função) -> Atende `/api/notifications/subscribe`, `/api/notifications/broadcast-push`.
6. **`api/instagram/[...action].ts`** (1 função) -> Atende `/api/instagram/*`.
7. **`api/avatar/verify.ts`** (1 função) -> Atende `/api/avatar/verify`.
8. **`api/admin/company-logo.ts`** (1 função) -> Atende `/api/admin/company-logo`.

**Total de Funções Geradas na Vercel: EXATAMENTE 8 (Limite do plano: 12).**

---

## 3. Validação e Testes

- **Typecheck (`tsc --noEmit`)**: 0 erros.
- **Frontend Build (`bun run build`)**: 2752 módulos transformados com sucesso.
- **Suíte de Testes (`tests/security-validation.ts`)**: **59 testes executados, 59 aprovados (100%)**, incluindo os 7 testes de integração com os roteadores consolidados.
- **Proteções ZynPay Preservadas**: Verificação HMAC `x-zinpay-signature`, idempotência, reserva transacional `CREATING`, reconciliação de valores e moeda BRL 100% ativas e validadas.
