# Sinal V1 — Documento Mestre de Produto (Product Manifest)

> **"Você escolhe o que importa. A Sinal observa o mundo por você."**  
> Categoria: Monitoramento inteligente de informações e acontecimentos · Modelo: SaaS por assinatura.

---

## 1. O que é a Sinal?

A **Sinal** é uma plataforma SaaS de monitoramento contínuo de informação e acontecimentos que acompanha o que acontece no mundo e organiza os fatos com base nos interesses calibrados por cada usuário.

Em vez de obrigar o leitor a abrir dezenas de portais, seguir centenas de contas em redes sociais ou ler repetidamente a mesma notícia de ângulos redundantes, a Sinal:
1. Coleta informações de fontes plurais e verificadas.
2. Identifica quando múltiplas fontes estão falando sobre o **mesmo acontecimento**.
3. Reúne essas fontes em uma confluência contextualizada.
4. Apresenta o que aconteceu, por que isso importa e quais fontes sustentam o fato.

A proposta não é maximizar o volume de cliques ou alimentar o consumo compulsivo. É fornecer **clareza, profundidade e economia de tempo**.

---

## 2. O que a Sinal É — e o que NÃO É

| A Sinal É                                                  | A Sinal NÃO É                           |
| :--------------------------------------------------------- | :-------------------------------------- |
| **Um feed pessoal de acontecimentos contextualizados**     | Um portal de notícias sensacionalista   |
| **Um sistema de monitoramento contínuo e inteligente**     | Apenas um agregador superficial de RSS  |
| **Uma camada de síntese e cruzamento analítico de fontes** | Um resumidor genérico de textos soltos  |
| **Uma plataforma estritamente orientada a interesses**     | Uma rede social com curtidas ou debates |
| **Uma confluência de fontes independentes sobre o fato**   | Um chatbot genérico de conversação com IA |

---

## 3. A Unidade Central do Produto: O `Event` (Acontecimento)

O modelo central de dados e UX do ecossistema é o **Acontecimento (`Event`)**.
- Um acontecimento agrega notícias e reportagens de diversos veículos independentes (Reuters, Bloomberg, Valor, Folha, TechCrunch, etc.).
- Evita redundância no feed: se dez portais publicam sobre a reunião do Copom, o usuário vê **um único acontecimento** com o resumo essencial, contexto histórico, desdobramentos futuros e a lista de matérias originais para consulta.

---

## 4. Para Quem a Sinal Serve?

- **Empreendedores e Lideranças**: Acompanham concorrentes, movimentações de mercado, regulação e impactos econômicos diretos.
- **Profissionais de Tecnologia & Investidores**: Monitoram modelos de IA, segurança digital, hardware, rodadas de captação e ecossistema tech.
- **Pesquisadores e Tomadores de Decisão**: Seguem políticas públicas, decisões do Judiciário, diplomacia e cenários geopolíticos globais.

---

## 5. Arquitetura de Módulos & Telas da Sinal V1

1. **Feed Principal ("Início")**:
   - Subtabs de curadoria: *Para você* (calibrado), *Seguindo* (apenas temas e entidades assinados) e *Em alta* (fatos de alto impacto).
   - Cartões de Acontecimento com badge de categoria, tempo relativo, status de verificação e fontes cruzadas.
2. **Explorar**:
   - Descoberta visual de Tópicos, Empresas, Pessoas Públicas e Veículos de Imprensa com botões diretos de seguir.
3. **Seguindo**:
   - Gestão granular dos tópicos, organizações e analistas monitorados pelo usuário.
4. **Notificações**:
   - Alertas pontuais de desdobramentos de fatos monitorados e comunicados institucionais.
5. **Biblioteca Pessoal (Salvos & Histórico)**:
   - Acervo de itens arquivados para referência futura e registro de leitura com limpeza granular.
6. **Briefings (Daily Briefings)**:
   - Edições fechadas de 3 minutos: **Morning Briefing** (07h00) e **Evening Briefing** (18h30/20h00), acessíveis no app e enviáveis por e-mail.
7. **Perfil & Preferências**:
   - Personalização de horários de briefing, preferências temáticas, gerenciamento de assinatura Pro e segurança de acesso.
   - Ponto de acesso restrito ao **Super Admin** para o e-mail oficial `astryasuporte@gmail.com`.
8. **Billing & Assinatura**:
   - Plano Pro (R$ 29,90/mês) pago instantaneamente via PIX com trial de 7 dias sem exigência de cartão.
9. **Painel Administrativo (Super Admin)**:
   - Painel restrito e sem rotas públicas expostas. Gerenciamento de cofres de chaves de API, monitoramento de provedores (NVIDIA NIM, NewsAPI, GNews, World News, Resend, Sinal Pay) e telemetria de latência.

---

## 6. Governança e Diretrizes Inegociáveis de Desenvolvimento

1. **Sem criação de chatbots artificiais**: A Sinal é um produto de monitoramento, não um assistente conversacional.
2. **Preservação de código existente**: Cada etapa deve expandir e consolidar o código real sem recriar telas do zero.
3. **Segurança de chaves**: A chave `service_role` nunca é exposta no frontend. O cliente Supabase usa estritamente a chave pública anon com RLS ativado.
4. **Super Admin Único**: O e-mail `astryasuporte@gmail.com` detém autoridade total e exclusiva sobre o painel de gerenciamento.
