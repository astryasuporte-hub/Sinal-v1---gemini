# Plano de Implementação — Integração ZynPay Pix no FatosBR

Integração de ponta a ponta da API da **ZynPay** para pagamentos Pix reais no FatosBR, contemplando:
1. **Checkout Pix real no FatosBR Pro** (`BillingModal`) com QR Code e Pix Copia e Cola dinâmicos.
2. **Confirmação e ativação automática** por verificação de status e endpoint de webhook (`/api/zynpay/webhook`).
3. **Painel Financeiro ZynPay no Admin** (`AdminPanel`) com consulta de saldo da conta, extrato de cobranças e telemetria de pagamentos.

---

## 1. Arquitetura e Segurança de Chaves

- **Chave de API**: `zpk_live_iDWdmDVWUV97IQ3qUhNwB4qXn8zCrrVMaboFeeP8qm8` será mantida **estritamente no servidor** (no arquivo de proxy backend `vite.config.ts` via `SERVER_SECRET_KEYS.ZYNPAY`).
- **Valores Monetários**: Conversão padronizada de reais para centavos inteiros (ex.: plano Pro de R$ 29,90 $\rightarrow$ `2990` centavos).
- **Tratamento de Contas em Análise**: Caso a conta retorne `403 ACCOUNT_NOT_VERIFIED`, a interface exibirá um status claro de "Conta em processo de verificação", permitindo fallback seguro e testes sem falhas bruscas.

---

## 2. Endpoints Backend (`vite.config.ts`)

Serão adicionadas as seguintes rotas no proxy backend:
- `POST /api/zynpay/charges`: Recebe valor, descrição e identificador do cliente, encaminha para `POST https://api.zynpay.com.br/v1/public/pix/charges` com header `Authorization: Bearer zpk_live_...`. Retorna `id`, `qrCode`, `qrCodeText` (Copia e Cola), `expiresAt` e `status`.
- `GET /api/zynpay/charges/:id`: Consulta o status atual de uma cobrança específica em `https://api.zynpay.com.br/v1/public/pix/charges/:id`.
- `GET /api/zynpay/charges`: Lista o histórico recente de cobranças geradas.
- `GET /api/zynpay/balance`: Consulta o saldo disponível e a liberar em `https://api.zynpay.com.br/v1/public/balance`.
- `POST /api/zynpay/webhook`: Endpoint para receber os eventos da ZynPay (`charge.paid`, `payment.confirmed`), registrar log no servidor e liberar a assinatura do usuário.
- `GET /api/zynpay/webhook`: Retorna métricas e histórico recente de webhooks recebidos.

---

## 3. Serviço Cliente (`src/services/zynpayService.ts`)

Criação de serviço dedicado TypeScript com métodos:
- `createPixCharge(amountCents: number, description: string, customer?: { name?: string; email?: string; taxId?: string })`
- `checkChargeStatus(chargeId: string)`
- `getBalance()`
- `getRecentCharges()`
- `getWebhookEvents()`

---

## 4. Checkout Pix no `BillingModal.tsx`

Substituição da simulação estática por fluxo real da ZynPay:
- **Geração Automática**: Ao selecionar a assinatura FatosBR Pro (R$ 29,90 = 2990 centavos), uma cobrança Pix real é criada via API.
- **Renderização Visual**:
  - Exibição do QR Code real retornado pela ZynPay (ou gerado a partir do código Copia e Cola).
  - Campo "Pix Copia e Cola" com botão de cópia rápida em 1 clique e feedback tátil.
  - Temporizador regressivo de expiração da cobrança.
- **Ativação Automática**: Polling inteligente de status a cada 3 segundos enquanto o modal estiver aberto. Assim que o pagamento for detectado (pago via Pix), o status muda imediatamente para "Aprovado!", toca som de confirmação e ativa a assinatura Pro no app.

---

## 5. Módulo Financeiro ZynPay no `AdminPanel.tsx`

Implementação de seção dedicada de Pagamentos & Pix no Painel Administrativo (versão Desktop e Mobile):
- **Card de Saldo da Conta**: Saldo disponível (R$) e saldo a compensar/liberar da conta ZynPay.
- **Extrato de Cobranças Pix**: Lista com ID da transação, valor em R$, data/hora, status (Pago, Aguardando, Expirado) e botão de atualizar.
- **Log de Webhooks em Tempo Real**: Histórico de notificações recebidas da ZynPay com status de entrega e conciliação.
- **Simulador de Teste no Admin**: Botão para testar conexão com a API da ZynPay e medir latência (ms).

---

## 6. Verificação e Testes

1. Executar `lint_applet` (`tsc --noEmit`) para validar tipagem estrita de todos os componentes e payloads da ZynPay.
2. Executar `compile_applet` (`vite build`) para assegurar compilação limpa.
3. Testar o fluxo no `BillingModal` gerando uma cobrança real de teste e verificando a resposta do endpoint da ZynPay.
4. Testar a aba financeira no `AdminPanel` com a exibição das métricas e tratamento para conta verificada ou pendente.
