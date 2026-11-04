# Plano Mestre de Conclusão e Lançamento Integral — FatosBR

Plano abrangente para finalizar todas as frentes necessárias para colocar o **FatosBR** no ar como um produto jornalístico profissional, lucrativo e escalável.

---

## 1. O Papel das Ferramentas: AI Studio vs. ChatGPT Plus

| Frente de Trabalho | Onde Fazer | Como Executar |
| :--- | :--- | :--- |
| **Código, Banco & Infraestrutura** | **Google AI Studio Build** (Aqui) | Desenvolvimento direto, compilação, testes, integração Supabase, ZynPay SSE e Vite. Sem necessidade de copiar e colar. |
| **Templates & Roteiros de WhatsApp** | **ChatGPT Plus + AI Studio** | O ChatGPT Plus pode gerar e refinar variações de copywriting; o AI Studio implementa os templates diretamente no código da API da Meta. |
| **Diretrizes Editoriais & Prompts** | **ChatGPT Plus + AI Studio** | Criação de personas e regras anti-viés político para alimentação do motor de síntese. |
| **Marketing de Aquisição & Vendas** | **ChatGPT Plus** | Roteiros de posts, anúncios para redes sociais e emails de onboarding para os primeiros 1.000 assinantes. |

---

## 2. Pilares de Execução para Conclusão do FatosBR

### Pilar A: Engenharia & Funcionalidades Finais (AI Studio)
1. **Conexão Real do WhatsApp Cloud API**:
   - Configuração de envio de mensagens no `src/services/whatsappService.ts` com suporte a templates aprovados pela Meta.
   - Painel administrativo no `AdminPanel.tsx` para envio em massa do Briefing Matinal e Alertas de Breaking News com métricas de entrega.
2. **Web Push API (Notificações no Navegador Fechado)**:
   - Registro de Service Worker para envio de alertas urgentes via Firebase Cloud Messaging (FCM).
3. **Esteira de Pagamentos Pix (ZynPay)**:
   - Validação da reconciliação com SSE no `BillingModal.tsx` e gestão de assinaturas no Supabase.
4. **Auditoria de Performance**:
   - Garantir carregamento inicial do feed em menos de 300ms com estratégia de cache em memória + localStorage (SWR).

---

### Pilar B: Conteúdo Editorial & Automação de WhatsApp
1. **Modelos de Templates Oficiais da Meta**:
   - `fatosbr_briefing_matinal`: Resumo dos 3 principais fatos econômicos e políticos do dia com link de leitura direta.
   - `fatosbr_breaking_news`: Alerta imediato de fatos extraordinários com alta relevância de mercado.
   - `fatosbr_briefing_noturno`: Fechamento de mercado, cotações e o que esperar para o dia seguinte.
2. **Diretrizes de Tom Editorial**:
   - Linguagem concisa, monocromática, estritamente factual e acessível para todas as faixas etárias.

---

### Pilar C: Jurídico, LGPD & Monetização
1. **Conformidade Legal**:
   - Termos de Uso, Política de Privacidade e Canal DPO já estruturados no `LegalCenterModal.tsx`.
2. **Modelo de Negócio**:
   - Plano Pro (R$ 29,90/mês ou R$ 249,00/ano no Pix).
   - Período de cortesia (Trial de 7 dias) para novos cadastros.

---

### Pilar D: Estratégia de Lançamento & Crescimento
1. **Lançamento para Beta Fechado (Primeiros 50 Usuários)**:
   - Teste prático do recebimento dos briefings via WhatsApp e abertura no leitor sem erros.
2. **Indexação & SEO**:
   - Otimização de tags OpenGraph e Twitter Cards para que os links compartilhados no WhatsApp e redes exibam prévias com imagem e título corretos.

---

## 3. Próximos Passos Imediatos de Execução

1. **Implementação do Envio de Briefings WhatsApp no Admin**:
   - Finalizar a integração técnica do `whatsappService.ts` com simulador de envio e webhook de status de entrega.
2. **Configuração de Web Push no Service Worker**:
   - Integrar permissão de notificações nativas no `ProfileView` e envio de teste.
3. **Revisão e Ativação do Fluxo de Caixa**:
   - Testar o ciclo completo: Geração do Pix no modal -> Confirmação SSE -> Liberação instantânea no banco de dados.
