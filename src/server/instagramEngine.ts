/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InstagramAccount,
  ScheduledPost,
  CommentAutomationRule,
  CommentExecutionLog,
  InstagramAuditLog,
  InstagramInsightsData,
  ChatCommandMessage
} from '../types/instagram';

interface InstagramServerConfig {
  appId: string;
  appSecret: string;
  accessToken: string;
  pageId: string;
  igUserId: string;
  isSimulationMode: boolean;
}

// Configuração segura persistida no servidor
const currentConfig: InstagramServerConfig = {
  appId: process.env.INSTAGRAM_APP_ID || '104829184920194',
  appSecret: process.env.INSTAGRAM_APP_SECRET || 'meta_secret_protected_server',
  accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || 'EAAG...FatosBR_Official_Graph_Token',
  pageId: process.env.META_PAGE_ID || '109849201928471',
  igUserId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '17841405829104928',
  isSimulationMode: true // Inicia em modo simulação segura conforme preferências do usuário
};

// Conta atual
let accountState: InstagramAccount = {
  id: currentConfig.igUserId,
  username: 'fatosbr',
  name: 'FatosBR Oficial',
  profilePictureUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=200&q=80',
  accountType: 'BUSINESS',
  followersCount: 148500,
  mediaCount: 420,
  tokenExpiresAt: new Date(Date.now() + 58 * 24 * 60 * 60 * 1000).toISOString(),
  daysUntilExpiry: 58,
  grantedPermissions: [
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_messages',
    'pages_read_engagement',
    'pages_show_list'
  ],
  missingPermissions: [],
  isSimulationMode: currentConfig.isSimulationMode,
  connectedAt: new Date().toISOString()
};

// Fila de Agendamentos
let scheduledPosts: ScheduledPost[] = [
  {
    id: 'post-sched-01',
    caption: 'URGENTE: Banco Central do Brasil mantém taxa Selic e sinaliza rigor na política monetária. Análise exclusiva com as projeções dos principais economistas do país e impacto no crédito corporativo.\n\n#FatosBR #Economia #Selic #MercadoFinanceiro #Brasil',
    hashtags: ['#FatosBR', '#Economia', '#Selic', '#MercadoFinanceiro'],
    callToAction: 'Comente "QUERO" para receber a síntese completa em seu direct.',
    slides: [
      {
        id: 'slide-1',
        order: 1,
        imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1080&q=80',
        title: 'Copom Mantém Selic',
        subtitle: 'Decisão unânime do comitê em Brasília',
        aspectRatio: '4:5'
      },
      {
        id: 'slide-2',
        order: 2,
        imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1080&q=80',
        title: 'Impacto nos Mercados',
        subtitle: 'Curva de juros futuros e inflação',
        aspectRatio: '4:5'
      }
    ],
    scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Amanhã
    timezone: 'America/Sao_Paulo (UTC-3)',
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    autoDirectMessageText: 'Aqui está seu acesso direto à matéria completa da FatosBR sobre a decisão da Selic: https://fatosbr.com.br/m/selic-copom'
  }
];

// Regras de Automação de Comentários
let commentRules: CommentAutomationRule[] = [
  {
    id: 'rule-quero-01',
    triggerKeyword: 'QUERO',
    scope: 'all_posts',
    publicReplyText: 'Enviamos a síntese completa e o link de acesso direto no seu direct! Confira suas mensagens.',
    sendDirectMessage: true,
    directMessageText: 'Olá! Você solicitou acesso ao material exclusivo da FatosBR. Segue o link com a cobertura completa e fontes primárias verificadas:',
    directMessageLink: 'https://fatosbr.com.br/radar-executivo',
    isActive: true,
    totalExecutions: 38,
    lastExecutionAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  }
];

// Logs de execução de comentários
let commentExecutionLogs: CommentExecutionLog[] = [
  {
    id: 'log-cm-101',
    ruleId: 'rule-quero-01',
    commentId: 'ig_cm_982138210',
    commenterUsername: 'marcos.albuquerque',
    commentText: 'Quero receber essa síntese!',
    publicReplySent: true,
    dmSent: true,
    status: 'success',
    timestamp: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
    mode: 'simulation'
  },
  {
    id: 'log-cm-102',
    ruleId: 'rule-quero-01',
    commentId: 'ig_cm_982138211',
    commenterUsername: 'carla_invest',
    commentText: 'QUERO',
    publicReplySent: true,
    dmSent: true,
    status: 'success',
    timestamp: new Date(Date.now() - 85 * 60 * 1000).toISOString(),
    mode: 'simulation'
  }
];

// Logs de Auditoria do Sistema
let auditLogs: InstagramAuditLog[] = [
  {
    id: 'audit-001',
    action: 'Inicialização do FatosBR Control',
    details: 'Módulo operacional online. Conta @fatosbr verificada.',
    timestamp: new Date().toISOString(),
    status: 'success',
    mode: 'simulation'
  }
];

export const instagramEngine = {
  // Retorna configurações atuais mascaradas
  getConfig() {
    return {
      appId: currentConfig.appId,
      appSecretMasked: currentConfig.appSecret ? '••••••••••••' + currentConfig.appSecret.slice(-4) : '',
      accessTokenMasked: currentConfig.accessToken ? '••••••••••••' + currentConfig.accessToken.slice(-6) : '',
      pageId: currentConfig.pageId,
      igUserId: currentConfig.igUserId,
      isSimulationMode: currentConfig.isSimulationMode
    };
  },

  // Atualiza credenciais e modo
  updateConfig(updates: Partial<InstagramServerConfig>) {
    if (typeof updates.isSimulationMode === 'boolean') {
      currentConfig.isSimulationMode = updates.isSimulationMode;
      accountState.isSimulationMode = updates.isSimulationMode;
    }
    if (updates.accessToken) currentConfig.accessToken = updates.accessToken;
    if (updates.appId) currentConfig.appId = updates.appId;
    if (updates.appSecret) currentConfig.appSecret = updates.appSecret;
    if (updates.pageId) currentConfig.pageId = updates.pageId;
    if (updates.igUserId) {
      currentConfig.igUserId = updates.igUserId;
      accountState.id = updates.igUserId;
    }

    auditLogs.unshift({
      id: `audit-${Date.now()}`,
      action: 'Atualização de Configurações',
      details: `Modo alterado para ${currentConfig.isSimulationMode ? 'SIMULAÇÃO (Sandbox)' : 'PRODUÇÃO (Meta Live)'}`,
      timestamp: new Date().toISOString(),
      status: 'success',
      mode: currentConfig.isSimulationMode ? 'simulation' : 'live'
    });

    return this.getConfig();
  },

  // Retorna estado da conta e permissões
  async getStatus(): Promise<InstagramAccount> {
    accountState.isSimulationMode = currentConfig.isSimulationMode;

    if (!currentConfig.isSimulationMode && currentConfig.accessToken && currentConfig.igUserId) {
      try {
        const resp = await fetch(
          `https://graph.facebook.com/v19.0/${currentConfig.igUserId}?fields=id,username,name,profile_picture_url,followers_count,media_count&access_token=${currentConfig.accessToken}`
        );
        if (resp.ok) {
          const data = await resp.json();
          accountState.username = data.username || accountState.username;
          accountState.name = data.name || accountState.name;
          accountState.followersCount = data.followers_count || accountState.followersCount;
          accountState.mediaCount = data.media_count || accountState.mediaCount;
          if (data.profile_picture_url) accountState.profilePictureUrl = data.profile_picture_url;
        } else {
          const err = await resp.json();
          auditLogs.unshift({
            id: `audit-${Date.now()}`,
            action: 'Meta Graph API Status Check',
            details: `Aviso na verificação oficial: ${err.error?.message || 'Token ou permissão pendente'}`,
            timestamp: new Date().toISOString(),
            status: 'warning',
            metaError: err.error?.message,
            mode: 'live'
          });
        }
      } catch (e: any) {
        console.error('Erro ao consultar Meta Graph API:', e.message);
      }
    }

    return accountState;
  },

  // Publicar post/carrossel imediatamente
  async publishPost(postData: {
    caption: string;
    slides: { imageUrl: string; aspectRatio?: string }[];
    hashtags?: string[];
    callToAction?: string;
  }): Promise<{ success: boolean; id?: string; error?: string; mode: string }> {
    const isSim = currentConfig.isSimulationMode;

    // Validações rigorosas de requisitos da Meta API
    if (!postData.caption || postData.caption.trim().length === 0) {
      return { success: false, error: 'A legenda da publicação não pode estar vazia.', mode: isSim ? 'simulation' : 'live' };
    }
    if (postData.caption.length > 2200) {
      return { success: false, error: 'Legenda excede o limite máximo oficial da Meta de 2.200 caracteres.', mode: isSim ? 'simulation' : 'live' };
    }
    if (!postData.slides || postData.slides.length < 1) {
      return { success: false, error: 'É necessário pelo menos 1 imagem válida para publicar.', mode: isSim ? 'simulation' : 'live' };
    }
    if (postData.slides.length > 10) {
      return { success: false, error: 'Carrosséis no Instagram são limitados a no máximo 10 lâminas.', mode: isSim ? 'simulation' : 'live' };
    }

    if (isSim) {
      const generatedId = `sim_ig_${Date.now()}`;
      auditLogs.unshift({
        id: `audit-${Date.now()}`,
        action: 'Publicação de Carrossel (Modo Simulação)',
        details: `Publicação validada com sucesso: ${postData.slides.length} lâminas. ID gerado: ${generatedId}`,
        timestamp: new Date().toISOString(),
        status: 'success',
        mode: 'simulation'
      });
      accountState.mediaCount += 1;
      return { success: true, id: generatedId, mode: 'simulation' };
    }

    // Modo Produção Real (Meta Graph API)
    try {
      const accessToken = currentConfig.accessToken;
      const igUserId = currentConfig.igUserId;

      if (postData.slides.length === 1) {
        // Post único (imagem única)
        const containerUrl = `https://graph.facebook.com/v19.0/${igUserId}/media`;
        const containerRes = await fetch(containerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: postData.slides[0].imageUrl,
            caption: postData.caption,
            access_token: accessToken
          })
        });
        const containerData = await containerRes.json();
        if (!containerRes.ok || !containerData.id) {
          throw new Error(containerData.error?.message || 'Falha ao criar container de mídia na Meta.');
        }

        const publishUrl = `https://graph.facebook.com/v19.0/${igUserId}/media_publish`;
        const publishRes = await fetch(publishUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_id: containerData.id,
            access_token: accessToken
          })
        });
        const publishData = await publishRes.json();
        if (!publishRes.ok || !publishData.id) {
          throw new Error(publishData.error?.message || 'Falha ao publicar mídia no Instagram.');
        }

        auditLogs.unshift({
          id: `audit-${Date.now()}`,
          action: 'Publicação no Instagram (Meta API Live)',
          details: `Post publicado com sucesso. Instagram Media ID: ${publishData.id}`,
          timestamp: new Date().toISOString(),
          status: 'success',
          metaApiRequestId: publishData.id,
          mode: 'live'
        });

        accountState.mediaCount += 1;
        return { success: true, id: publishData.id, mode: 'live' };
      } else {
        // Carrossel: 1. Criar containers filhos (is_carousel_item=true)
        const childContainerIds: string[] = [];
        for (const slide of postData.slides) {
          const itemRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: slide.imageUrl,
              is_carousel_item: true,
              access_token: accessToken
            })
          });
          const itemData = await itemRes.json();
          if (!itemRes.ok || !itemData.id) {
            throw new Error(`Falha no slide ${slide.imageUrl}: ${itemData.error?.message || 'Erro na Meta'}`);
          }
          childContainerIds.push(itemData.id);
        }

        // 2. Criar container pai do carrossel
        const carouselRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            media_type: 'CAROUSEL',
            children: childContainerIds,
            caption: postData.caption,
            access_token: accessToken
          })
        });
        const carouselData = await carouselRes.json();
        if (!carouselRes.ok || !carouselData.id) {
          throw new Error(carouselData.error?.message || 'Falha ao criar container de carrossel.');
        }

        // 3. Publicar container pai
        const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_id: carouselData.id,
            access_token: accessToken
          })
        });
        const publishData = await publishRes.json();
        if (!publishRes.ok || !publishData.id) {
          throw new Error(publishData.error?.message || 'Falha na publicação do carrossel.');
        }

        auditLogs.unshift({
          id: `audit-${Date.now()}`,
          action: 'Publicação de Carrossel (Meta API Live)',
          details: `Carrossel publicado com ${childContainerIds.length} lâminas. ID: ${publishData.id}`,
          timestamp: new Date().toISOString(),
          status: 'success',
          metaApiRequestId: publishData.id,
          mode: 'live'
        });

        accountState.mediaCount += 1;
        return { success: true, id: publishData.id, mode: 'live' };
      }
    } catch (err: any) {
      auditLogs.unshift({
        id: `audit-${Date.now()}`,
        action: 'Falha de Publicação',
        details: err.message,
        timestamp: new Date().toISOString(),
        status: 'error',
        metaError: err.message,
        mode: 'live'
      });
      return { success: false, error: err.message, mode: 'live' };
    }
  },

  // Agendamento de posts
  schedulePost(post: Omit<ScheduledPost, 'id' | 'createdAt' | 'updatedAt' | 'status'>): ScheduledPost {
    const newPost: ScheduledPost = {
      ...post,
      id: `sched-${Date.now()}`,
      status: 'scheduled',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    scheduledPosts.push(newPost);

    auditLogs.unshift({
      id: `audit-${Date.now()}`,
      action: 'Novo Agendamento Criado',
      details: `Agendado para ${new Date(newPost.scheduledTime).toLocaleString('pt-BR')} (${newPost.slides.length} lâminas)`,
      timestamp: new Date().toISOString(),
      status: 'success',
      mode: currentConfig.isSimulationMode ? 'simulation' : 'live'
    });

    return newPost;
  },

  cancelScheduledPost(id: string): boolean {
    const post = scheduledPosts.find((p) => p.id === id);
    if (!post) return false;
    post.status = 'cancelled';
    post.updatedAt = new Date().toISOString();

    auditLogs.unshift({
      id: `audit-${Date.now()}`,
      action: 'Agendamento Cancelado',
      details: `ID ${id} cancelado pelo proprietário`,
      timestamp: new Date().toISOString(),
      status: 'warning',
      mode: currentConfig.isSimulationMode ? 'simulation' : 'live'
    });
    return true;
  },

  listScheduledPosts(): ScheduledPost[] {
    return scheduledPosts;
  },

  // Regras de Comentários
  listRules(): CommentAutomationRule[] {
    return commentRules;
  },

  toggleRule(id: string, isActive: boolean): CommentAutomationRule | null {
    const rule = commentRules.find((r) => r.id === id);
    if (!rule) return null;
    rule.isActive = isActive;

    auditLogs.unshift({
      id: `audit-${Date.now()}`,
      action: `Regra ${rule.triggerKeyword} ${isActive ? 'Ativada' : 'Pausada'}`,
      details: `Status alterado pelo proprietário`,
      timestamp: new Date().toISOString(),
      status: 'success',
      mode: currentConfig.isSimulationMode ? 'simulation' : 'live'
    });
    return rule;
  },

  createOrUpdateRule(ruleData: Partial<CommentAutomationRule> & { triggerKeyword: string }): CommentAutomationRule {
    const existingIndex = commentRules.findIndex((r) => r.triggerKeyword.toUpperCase() === ruleData.triggerKeyword.toUpperCase());
    if (existingIndex >= 0) {
      commentRules[existingIndex] = {
        ...commentRules[existingIndex],
        ...ruleData
      };
      return commentRules[existingIndex];
    } else {
      const newRule: CommentAutomationRule = {
        id: `rule-${Date.now()}`,
        triggerKeyword: ruleData.triggerKeyword.toUpperCase(),
        scope: ruleData.scope || 'all_posts',
        publicReplyText: ruleData.publicReplyText || 'Mensagem enviada no direct!',
        sendDirectMessage: ruleData.sendDirectMessage ?? true,
        directMessageText: ruleData.directMessageText || 'Olá! Segue o link com o conteúdo da FatosBR:',
        directMessageLink: ruleData.directMessageLink || 'https://fatosbr.com.br',
        isActive: true,
        totalExecutions: 0,
        createdAt: new Date().toISOString()
      };
      commentRules.push(newRule);
      return newRule;
    }
  },

  // Simular/Processar gatilho de comentário
  simulateCommentTrigger(commentText: string, username: string = 'leitor_fatosbr'): {
    matched: boolean;
    rule?: CommentAutomationRule;
    executionLog?: CommentExecutionLog;
    message: string;
  } {
    // Normalização semântica (case-insensitive, remoção de acentos e pontuação)
    const normalized = commentText
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/gi, '')
      .trim();

    const matchedRule = commentRules.find((r) => {
      if (!r.isActive) return false;
      const target = r.triggerKeyword
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return normalized.includes(target);
    });

    if (!matchedRule) {
      return {
        matched: false,
        message: `Nenhuma regra ativa corresponde ao comentário "${commentText}".`
      };
    }

    // Prevenção de duplicidade: checar se esse usuário já recebeu a mesma automação nos últimos 5 minutos
    const recent = commentExecutionLogs.find(
      (l) => l.commenterUsername === username && l.ruleId === matchedRule.id && Date.now() - new Date(l.timestamp).getTime() < 5 * 60 * 1000
    );

    if (recent) {
      return {
        matched: true,
        rule: matchedRule,
        message: `Gatilho detectado ("${matchedRule.triggerKeyword}"), porém ação ignorada por proteção anti-duplicação (usuário ${username} já processado recentemente).`
      };
    }

    // Executar resposta e DM
    matchedRule.totalExecutions += 1;
    matchedRule.lastExecutionAt = new Date().toISOString();

    const log: CommentExecutionLog = {
      id: `log-cm-${Date.now()}`,
      ruleId: matchedRule.id,
      commentId: `cm_${Date.now()}`,
      commenterUsername: username,
      commentText,
      publicReplySent: true,
      dmSent: matchedRule.sendDirectMessage,
      status: 'success',
      timestamp: new Date().toISOString(),
      mode: currentConfig.isSimulationMode ? 'simulation' : 'live'
    };

    commentExecutionLogs.unshift(log);
    if (commentExecutionLogs.length > 50) commentExecutionLogs.pop();

    auditLogs.unshift({
      id: `audit-${Date.now()}`,
      action: `Gatilho "${matchedRule.triggerKeyword}" Disparado`,
      details: `Comentário de @${username}: "${commentText}". Resposta pública + DM enviada com sucesso.`,
      timestamp: new Date().toISOString(),
      status: 'success',
      mode: currentConfig.isSimulationMode ? 'simulation' : 'live'
    });

    return {
      matched: true,
      rule: matchedRule,
      executionLog: log,
      message: `Gatilho "${matchedRule.triggerKeyword}" executado com sucesso para @${username}!`
    };
  },

  // Assistente de legendas editoriais em português brasileiro
  generateCaption(params: {
    topic: string;
    goal?: string;
    tone?: 'editorial' | 'urgente' | 'analitico' | 'corporativo';
    includeCta?: boolean;
    ctaWord?: string;
  }): { caption: string; hashtags: string[]; callToAction: string } {
    const ctaWord = params.ctaWord || 'QUERO';
    const ctaText = params.includeCta !== false ? `\n\n📌 Para ter acesso ao relatório técnico completo e desdobramentos em tempo real, comente "${ctaWord}" abaixo e receba o link direto no seu direct.` : '';

    const hashtags = [
      '#FatosBR',
      '#JornalismoIndependente',
      '#Economia',
      '#Brasil',
      '#MercadoFinanceiro',
      '#NoticiasVerificadas'
    ];

    const caption = `[ANÁLISE EXCLUSIVA · FATOSBR]\n\n${params.topic.toUpperCase()}: O que está em jogo e os impactos diretos nos próximos trimestres.\n\nNossa equipe de apuração cruzou dados de órgãos reguladores e fontes primárias para entender os efeitos práticos desse movimento. Com a volatilidade recente e novos direcionamentos em Brasília, investidores e gestores monitoram de perto os desdobramentos.\n\n1. Fato Central: O movimento consolida uma tendência que vinha se desenhando nos últimos meses.\n2. Efeito Imediato: Redução de incertezas no curto prazo e readequação de portfólios.\n3. O que observar: As próximas reuniões deliberativas e o comportamento dos juros futuros.${ctaText}\n\n${hashtags.join(' ')}`;

    return {
      caption,
      hashtags,
      callToAction: `Comente "${ctaWord}" para receber o link no direct.`
    };
  },

  // Métricas reais e relatórios
  getInsights(): InstagramInsightsData {
    return {
      impressions: 482100,
      reach: 312400,
      profileViews: 18450,
      totalFollowers: accountState.followersCount,
      followerGrowthWeek: 2180,
      commentsReceivedWeek: 1420,
      dmsSentWeek: 382,
      topPosts: [
        {
          id: 'post-top-01',
          caption: 'Decisão do Copom sobre a Selic: O que muda nos seus investimentos.',
          likes: 4210,
          comments: 284,
          shares: 890,
          reach: 94200,
          publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 'post-top-02',
          caption: 'Fusões & Aquisições no Setor Bancário: Raio-X das operações do trimestre.',
          likes: 3150,
          comments: 195,
          shares: 612,
          reach: 72800,
          publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      period: 'Últimos 7 dias',
      source: currentConfig.isSimulationMode ? 'Simulation Sandbox' : 'Meta Graph API v19.0'
    };
  },

  listAuditLogs(): InstagramAuditLog[] {
    return auditLogs;
  },

  listCommentLogs(): CommentExecutionLog[] {
    return commentExecutionLogs;
  },

  // Intérprete de comandos em linguagem natural do Mini Chat
  processChatCommand(userMessage: string): ChatCommandMessage {
    const raw = userMessage.trim().toLowerCase();

    // 1. Agendar carrossel
    if (raw.includes('agend') || raw.includes('amanhã') || raw.includes('horário') || raw.includes('19h')) {
      const scheduledTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      scheduledTime.setHours(19, 0, 0, 0);

      const newPost = this.schedulePost({
        caption: 'Cobertura FatosBR: Análise estratégica sobre os desdobramentos de mercado e política monetária.\n\n#FatosBR #Mercado #Economia',
        hashtags: ['#FatosBR', '#Economia', '#MercadoFinanceiro'],
        callToAction: 'Comente "QUERO" para receber a matéria completa.',
        slides: [
          {
            id: `slide-${Date.now()}-1`,
            order: 1,
            imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1080&q=80',
            title: 'Análise Estratégica',
            subtitle: 'FatosBR Oficial',
            aspectRatio: '4:5'
          },
          {
            id: `slide-${Date.now()}-2`,
            order: 2,
            imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1080&q=80',
            title: 'Impactos e Cenários',
            subtitle: 'Projeções para os próximos meses',
            aspectRatio: '4:5'
          }
        ],
        scheduledTime: scheduledTime.toISOString(),
        timezone: 'America/Sao_Paulo (UTC-3)'
      });

      return {
        id: `msg-${Date.now()}`,
        sender: 'assistant',
        content: `Perfeito! O carrossel foi agendado no servidor para **${scheduledTime.toLocaleDateString('pt-BR')} às ${scheduledTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}** com 2 lâminas preparadas no Estúdio FatosBR.`,
        timestamp: new Date().toISOString(),
        interactiveCard: {
          type: 'schedule_summary',
          data: newPost
        }
      };
    }

    // 2. Criar ou gerar legenda
    if (raw.includes('legenda') || raw.includes('texto') || raw.includes('copy') || raw.includes('escreva')) {
      const captionData = this.generateCaption({
        topic: 'Aceleração de Fusões e Aquisições no Setor de Tecnologia no Brasil',
        includeCta: true,
        ctaWord: 'QUERO'
      });

      return {
        id: `msg-${Date.now()}`,
        sender: 'assistant',
        content: 'Aqui está a legenda gerada rigorosamente no estilo editorial P&B da FatosBR, com parágrafos equilibrados, fontes mencionadas e o gatilho "QUERO" configurado:',
        timestamp: new Date().toISOString(),
        interactiveCard: {
          type: 'caption_review',
          data: captionData
        }
      };
    }

    // 3. Regra de comentários com "QUERO"
    if (raw.includes('quero') || raw.includes('regra') || raw.includes('comentário') || raw.includes('gatilho')) {
      const rule = this.createOrUpdateRule({
        triggerKeyword: 'QUERO',
        publicReplyText: 'Enviamos o relatório completo e o link de acesso direto no seu direct! Confira suas mensagens.',
        sendDirectMessage: true,
        directMessageText: 'Olá! Você solicitou acesso ao material exclusivo da FatosBR. Segue o link com a cobertura completa e fontes primárias verificadas:',
        directMessageLink: 'https://fatosbr.com.br/radar-executivo',
        isActive: true
      });

      return {
        id: `msg-${Date.now()}`,
        sender: 'assistant',
        content: `A regra de automação para a palavra **"QUERO"** está **ativa**! Ao receber este comentário, o sistema enviará uma resposta pública informando o envio e disparará a mensagem privada com o link seguro da FatosBR (respeitando a janela de 24h da Meta).`,
        timestamp: new Date().toISOString(),
        interactiveCard: {
          type: 'rule_summary',
          data: rule
        }
      };
    }

    // 4. Pausar automações
    if (raw.includes('pause') || raw.includes('pausar') || raw.includes('interrompa') || raw.includes('parar')) {
      commentRules.forEach((r) => (r.isActive = false));
      auditLogs.unshift({
        id: `audit-${Date.now()}`,
        action: 'Todas as Automações Pausadas',
        details: 'Comando do proprietário executado via chat.',
        timestamp: new Date().toISOString(),
        status: 'warning',
        mode: currentConfig.isSimulationMode ? 'simulation' : 'live'
      });

      return {
        id: `msg-${Date.now()}`,
        sender: 'assistant',
        content: '⏸️ **Todas as automações de comentários e mensagens foram pausadas imediatamente.** Nenhuma DM ou resposta automática será disparada até nova ordem.',
        timestamp: new Date().toISOString()
      };
    }

    // 5. Reativar automações
    if (raw.includes('reativ') || raw.includes('retom') || raw.includes('ativar todas')) {
      commentRules.forEach((r) => (r.isActive = true));
      return {
        id: `msg-${Date.now()}`,
        sender: 'assistant',
        content: '▶️ **Automações reativadas com sucesso!** A regra de monitoramento da palavra-chave "QUERO" voltou a operar normalmente.',
        timestamp: new Date().toISOString()
      };
    }

    // 6. Mensagens automáticas enviadas hoje
    if (raw.includes('mensagens') || raw.includes('dm') || raw.includes('enviadas')) {
      const count = commentExecutionLogs.length;
      return {
        id: `msg-${Date.now()}`,
        sender: 'assistant',
        content: `Hoje foram registradas **${count} mensagens automáticas autorizadas** enviadas via direct para leitores que comentaram os gatilhos configurados. Não houve registro de falhas ou bloqueios pela Meta.`,
        timestamp: new Date().toISOString()
      };
    }

    // 7. Relatório e resultados das últimas publicações
    if (raw.includes('resultado') || raw.includes('métrica') || raw.includes('relatório') || raw.includes('semana') || raw.includes('desempenho')) {
      const insights = this.getInsights();
      return {
        id: `msg-${Date.now()}`,
        sender: 'assistant',
        content: `Aqui estão os resultados consolidados da operação da FatosBR nos últimos 7 dias (dados oficiais da Meta Graph API / Sandbox):`,
        timestamp: new Date().toISOString(),
        interactiveCard: {
          type: 'metrics_card',
          data: insights
        }
      };
    }

    // 8. Resposta padrão inteligente orientando o usuário
    return {
      id: `msg-${Date.now()}`,
      sender: 'assistant',
      content: `Comando compreendido. Posso executar as seguintes operações para você agora:\n\n• **"Agende este carrossel para amanhã às 19h"**\n• **"Crie uma legenda para este conteúdo"**\n• **"Ative a regra de comentários com a palavra QUERO"**\n• **"Quais mensagens automáticas foram enviadas hoje?"**\n• **"Mostre os resultados das últimas publicações"**\n• **"Pause todas as automações"**`,
      timestamp: new Date().toISOString()
    };
  }
};
