# Templates Oficiais de E-mail — FatosBR Auth V3.0 (Supabase Auth OTP)

Todos os templates deste diretório usam **exclusivamente código numérico de 6 dígitos (`{{ .Token }}`)** e **nenhum Magic Link (`{{ .ConfirmationURL }}`)**.

## 1. Mapeamento no Painel do Supabase

Acesse **Supabase Dashboard → Authentication → Email Templates** (Projeto `zopbitgtexefmqfvwgzj`):

| Template no Supabase | Arquivo Local | Assunto Recomendado (Subject) | Fluxo no Código |
| :--- | :--- | :--- | :--- |
| **Magic Link** *(usado para OTP sem link)* | `magic_link_otp.html` | `{{ .Token }} é seu código de acesso na FatosBR` | `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })` + `verifyOtp({ email, token, type: 'email' })` |
| **Confirm signup** | `confirm_signup.html` | `{{ .Token }} — Confirme seu cadastro na FatosBR` | `supabase.auth.signUp({ email, password })` + `verifyOtp({ email, token, type: 'signup' })` |
| **Reset Password** | `reset_password.html` | `{{ .Token }} — Código para recuperar seu acesso na FatosBR` | `supabase.auth.resetPasswordForEmail(email)` + `verifyOtp({ email, token, type: 'recovery' })` + `updateUser({ password })` |

## 2. Variáveis Utilizadas

- `{{ .Token }}`: Código numérico OTP de 6 dígitos gerado e validado pelo Supabase Auth.
- `{{ .Email }}`: E-mail do destinatário.

## 3. Recomendações de Entregabilidade (SMTP Customizado / Resend)

1. Configure **Custom SMTP** em **Supabase Dashboard → Project Settings → Authentication → SMTP Settings** (por exemplo via `smtp.resend.com`, porta `465` SSL ou `587` TLS, usuário `resend` e senha sendo a API Key do Resend).
2. Utilize um remetente em domínio próprio autenticado com SPF, DKIM e DMARC (ex.: `no-reply@fatosbr.com.br` / `acesso@fatosbr.com.br`) — evite `onboarding@resend.dev` em produção para impedir bloqueios e entrega na caixa de spam.
3. Desative ou ajuste o campo `OTP Expiry` para `600` segundos (10 minutos) e garanta que **Confirm email** esteja coerente com a política de cadastro do projeto.

## 4. Checklist de Validação Pós-Configuração

- [ ] Solicitar login com código por e-mail para conta existente e confirmar chegada em Caixa de Entrada (Gmail/Outlook/Apple Mail) apenas com os 6 dígitos (`{{ .Token }}`) — sem nenhum link.
- [ ] Solicitar login com código para e-mail não cadastrado e validar que o fluxo com `shouldCreateUser: false` não cria conta indevidamente.
- [ ] Cadastrar novo usuário e validar recebimento do template `Confirm signup` com 6 dígitos e conclusão via `verifyOtp(..., type: 'signup')`.
- [ ] Solicitar recuperação de senha e validar recebimento do template `Reset Password` com 6 dígitos, validação via `verifyOtp(..., type: 'recovery')` e troca via `updateUser({ password })`.
- [ ] Verificar renderização mobile (dark/light mode no cliente de e-mail) sem overflow horizontal nem imagens bloqueadas.
