# Plano de Implementação: Persistência Local do Histórico e Documento Mestre de Segurança

Implementação da persistência resiliente do histórico de acontecimentos lidos (`historyItems`) no `localStorage` do navegador com limite de 50 itens e priorização no topo, acompanhado da criação do repositório documental de segurança `docs/SECURITY_MASTER.md`.

---

## 1. Visão Geral e Arquitetura

Atualmente, o histórico de matérias e acontecimentos abertos pelo leitor reside exclusivamente no estado React em memória (`App.tsx`), sendo perdido quando a página é atualizada ou fechada. Além disso, foi aprovada a inclusão do Documento Mestre de Segurança e Hardening da Sinal V1 na estrutura oficial do projeto.

### Fluxo de Dados e Persistência

```
  [Ação do Leitor] (Clica em matéria no Feed / Busca / Explore)
           │
           ▼
  [handleOpenEventDetail]
           │
           ├─► Verifica se o evento já existe no histórico
           │     ├─ Se já existe: remove da posição antiga e move para o topo (índice 0)
           │     └─ Se é novo: insere no topo (índice 0)
           │
           ├─► Atualiza timestamp atual (`Date.now()`) e rótulo temporal
           ├─► Aplica corte FIFO de capacidade: `.slice(0, 50)`
           │
           ├─► Atualiza estado React: `setHistoryItems(nextItems)`
           │
           ▼
  [Efeito de Sincronização / Storage Service]
           │
           ├─► Serialização segura (`try...catch`)
           └─► `localStorage.setItem('sinal_history_items_v1', JSON.stringify(...))`
                    │
                    ▼
           [Recarga de Página / Nova Sessão]
                    │
                    └─► Lazy Initializer recupera até 50 itens salvos
                    └─► Marca `isViewed: true` nas notícias correspondentes do feed
```

---

## 2. Decisões Confirmadas com o Usuário

1. **Capacidade do Histórico**: Limite estrito de **50 itens** mais recentes para evitar degradação de desempenho e respeitar a cota do `localStorage`.
2. **Reabertura de Notícias Existentes**: Se o usuário abrir novamente uma notícia já presente no histórico, o item é **movido para o topo** da lista com o horário de leitura atualizado.
3. **Localização do Documento de Segurança**: Arquivo dedicado em `docs/SECURITY_MASTER.md` contendo todas as 20 seções do documento mestre de segurança da Sinal V1.

---

## 3. Detalhamento das Alterações Técnicas

### A. Persistência de Histórico em `src/App.tsx`
- **Inicialização Preguiçosa (`lazy initializer`)**:
  - Chave: `'sinal_history_items_v1'`.
  - Leitura segura com tratamento para JSON corrompido ou modo de navegação anônima sem acesso a storage.
  - Carregamento de até 50 itens validados.
- **Efeito de Gravação Automática (`useEffect`)**:
  - Salva automaticamente as alterações de `historyItems` no `localStorage`.
  - Tratamento para erro `QuotaExceededError` (se o armazenamento estiver cheio, trunca itens mais antigos).
- **Repositório e Ordenação em `handleOpenEventDetail`**:
  - Filtragem de duplicata anterior do mesmo `event.id`.
  - Inserção no topo com timestamp atualizado (`timestamp: Date.now()`, `openedAt: 'Agora há pouco'`).
  - Restrição aos últimos 50 registros (`.slice(0, 50)`).
- **Sincronização de Remoção e Limpeza**:
  - `handleRemoveFromHistory(eventId)` e `handleClearHistory()` sincronizados imediatamente com o storage.
- **Hidratação de Notícias Lidas no Feed**:
  - Ao carregar as notícias em tempo real, marcar com `isViewed: true` aquelas cujos IDs constem no histórico persistido.

### B. Otimização de Exibição em `src/components/SavedHistoryView.tsx`
- **Recálculo Dinâmico de Tempos Relativos**:
  - Utilizar o `timestamp` numérico armazenado para calcular o rótulo ("Agora há pouco", "Há 15 min", "Há 2 horas", "Ontem às 14:30") em vez de manter uma string estática eternamente congelada em recargas futuras.
- **Manutenção de Estado Vazio e Ações Rápidas**:
  - Preservar botões de remover item individual, limpar todo o histórico e alternância entre as abas "Salvos" e "Histórico".

### C. Criação do Arquivo `docs/SECURITY_MASTER.md`
- Criar o arquivo no diretório `/docs/SECURITY_MASTER.md`.
- Conter integralmente todas as 20 seções do documento mestre de segurança da Sinal V1:
  1. Arquitetura de segurança
  2. Painel Admin privado e isolado
  3. APIs, credenciais e segredos
  4. Proteção contra vulnerabilidades web
  5. Camada de dados, Supabase e Postgres
  6. Inteligência artificial e LLMs
  7. Pagamentos, billing e Sharpify Gateway
  8. Ingestão de notícias e integridade editorial
  9. Autenticação, sessões e usuários
  10. Borda, CDN, Cloudflare e rede
  11. Auditoria, logs, rastreabilidade e monitoramento
  12. Resposta a incidentes e contenção
  13. CI/CD, deploy e pipeline seguro
  14. Proteção contra scraping, bots e automação abusiva
  15. Dependências, supply chain e pacotes
  16. Governança, privacidade e conformidade (LGPD)
  17. Backup, recuperação e continuidade
  18. Postura de produto e engenharia
  19. Checklist pré-produção
  20. Estratégia de implementação recomendada

---

## 4. Plano de Verificação e Testes

1. **Validação de Compilação e Linter**:
   - Executar `compile_applet` para certificar que os tipos TypeScript estão estritamente válidos.
   - Executar `lint_applet` para assegurar conformidade do código.
2. **Teste de Persistência do Histórico**:
   - Abrir matérias no feed e verificar o registro imediato na aba de Histórico.
   - Recarregar a página e confirmar que os itens continuam salvos e ordenados.
   - Abrir novamente uma matéria antiga e validar se ela migrou para o topo com horário atualizado.
   - Excluir uma notícia do histórico e limpar todo o histórico, verificando que o `localStorage` reflete a ação.
3. **Verificação do Documento de Segurança**:
   - Conferir se o arquivo `/docs/SECURITY_MASTER.md` foi criado com sucesso com todas as seções e formatação intacta.
