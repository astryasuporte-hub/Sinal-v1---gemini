/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ResendWebhookItem {
  id: string;
  type: 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | string;
  rawType: string;
  emailId: string;
  recipient: string;
  subject?: string;
  timestamp: string;
  link?: string;
}

export interface ResendWebhookCounts {
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
}

export interface ResendTelemetry {
  requestsToday: number;
  requestsThisMonth: number;
  emailsSentToday?: number;
  emailsSentThisMonth?: number;
  deliveredCount?: number;
  openedCount?: number;
  clickedCount?: number;
  bouncedCount?: number;
  complainedCount?: number;
  lastRequestAt: string | null;
  lastStatusCode: number;
  lastLatencyMs: number;
  errorCount: number;
  lastErrorMessage: string | null;
  quotaLeft: number;
}

export interface ResendStatusResponse {
  ok: boolean;
  connected: boolean;
  provider: string;
  latencyMs: number;
  sender: string;
  keyMasked: string;
  details?: any;
  providerStats?: {
    resend: ResendTelemetry;
  };
  stats?: ResendTelemetry;
  webhookStats?: {
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    recentEvents: ResendWebhookItem[];
  };
}

export interface ResendSendResult {
  success: boolean;
  id?: string;
  recipient?: string;
  template?: string;
  provider?: string;
  message?: string;
  error?: string;
}

const STORAGE_EMAIL_KEY = 'sinal_briefing_subscriber_email';
const DEFAULT_EMAIL = 'astryasuporte@gmail.com';

class ResendService {
  /**
   * Consulta o endpoint do servidor para verificar a integridade da chave do Resend
   */
  async getStatus(): Promise<ResendStatusResponse> {
    try {
      const res = await fetch('/api/resend/status');
      if (!res.ok) {
        return {
          ok: false,
          connected: false,
          provider: 'Resend',
          latencyMs: 0,
          sender: 'onboarding@resend.dev',
          keyMasked: 'Não configurado'
        };
      }
      return await res.json();
    } catch (err: any) {
      return {
        ok: false,
        connected: false,
        provider: 'Resend',
        latencyMs: 0,
        sender: 'onboarding@resend.dev',
        keyMasked: 'Erro de conexão'
      };
    }
  }

  /**
   * Dispara um e-mail de teste operacional utilizando o template externo test_email.html
   */
  async sendTestEmail(toEmail?: string): Promise<ResendSendResult> {
    const recipient = toEmail || this.getStoredSubscriberEmail();
    try {
      const res = await fetch('/api/resend/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipient,
          template: 'test_email',
          subject: 'FatosBR • Teste de Conexão com Resend',
          text: `Validação operacional da chave de API do Resend concluída com sucesso às ${new Date().toLocaleTimeString('pt-BR')}. Sua caixa postal está pronta para receber as sínteses editoriais.`
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return {
          success: true,
          id: data.id,
          recipient,
          template: 'test_email',
          provider: 'Resend',
          message: data.message || `E-mail de teste despachado para ${recipient}`
        };
      }
      return {
        success: false,
        recipient,
        error: data.error || data.message || `Falha no envio (HTTP ${res.status})`
      };
    } catch (err: any) {
      return {
        success: false,
        recipient,
        error: err.message || 'Falha de comunicação com o servidor'
      };
    }
  }

  /**
   * Dispara um Briefing Executivo utilizando o template externo briefing.html
   */
  async sendBriefing(toEmail: string, title: string, summary: string, rawEventsSummary?: string): Promise<ResendSendResult> {
    const recipient = toEmail || this.getStoredSubscriberEmail();
    
    // Constrói blocos elegantes em HTML para a síntese dos acontecimentos
    let eventsHtml = '';
    if (rawEventsSummary) {
      const items = rawEventsSummary.split('\n\n').filter(Boolean);
      eventsHtml = items.map((item, idx) => `
        <div style="background-color: #161820; border: 1px solid #232634; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px;">
          <div style="font-size: 11px; font-weight: 700; color: #60a5fa; text-transform: uppercase; margin-bottom: 4px;">Fato ${idx + 1}</div>
          <div style="font-size: 13px; color: #d4d4d8; line-height: 1.55;">${item}</div>
        </div>
      `).join('');
    } else {
      eventsHtml = `<p style="margin: 0; color: #94a3b8; font-size: 13px;">Síntese apurada em tempo real diretamente dos principais veículos jornalísticos.</p>`;
    }

    try {
      const res = await fetch('/api/resend/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipient,
          template: 'briefing',
          subject: `FatosBR • ${title}`,
          summary: summary,
          events_html: eventsHtml,
          text: `${title}\n\n${summary}\n\n${rawEventsSummary || ''}`
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return {
          success: true,
          id: data.id,
          recipient,
          template: 'briefing',
          provider: 'Resend',
          message: data.message || `Briefing despachado para ${recipient}`
        };
      }
      return {
        success: false,
        recipient,
        error: data.error || data.message || `Falha no envio (HTTP ${res.status})`
      };
    } catch (err: any) {
      return {
        success: false,
        recipient,
        error: err.message || 'Falha de comunicação com o servidor'
      };
    }
  }

  /**
   * Dispara o código de verificação (OTP 6 dígitos) para autenticação do usuário
   */
  /**
   * Dispara o código de verificação (OTP 6 dígitos) para autenticação do usuário
   */
  async sendVerificationCode(toEmail: string, code: string): Promise<ResendSendResult> {
    try {
      // 1. Tentar primeiro o endpoint dedicado /api/auth/send-otp
      const otpEndpointRes = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: toEmail,
          code
        })
      });

      if (otpEndpointRes.ok) {
        const otpData = await otpEndpointRes.json().catch(() => ({}));
        if (otpData.success) {
          return {
            success: true,
            id: otpData.id,
            recipient: toEmail,
            message: `Código enviado para ${toEmail}`
          };
        }
      }

      // 2. Fallback para /api/resend/send com template otp_code
      const res = await fetch('/api/resend/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail,
          template: 'otp_code',
          code,
          subject: `FatosBR • Código de Acesso: ${code}`,
          summary: `Seu código de acesso único é ${code}`,
          text: `Seu código de confirmação FatosBR é: ${code}\n\nUtilize este código de 6 dígitos para autenticar seu acesso à plataforma com segurança. Válido por 10 minutos.`
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return {
          success: true,
          id: data.id,
          recipient: toEmail,
          message: `Código enviado para ${toEmail}`
        };
      }
      return {
        success: false,
        recipient: toEmail,
        error: data.error || data.message || `Falha no envio (HTTP ${res.status})`
      };
    } catch (err: any) {
      return {
        success: false,
        recipient: toEmail,
        error: err.message || 'Falha de comunicação com o servidor de e-mail'
      };
    }
  }

  /**
   * Obtém o HTML compilado da publicação editorial (Resumo Matinal ou Noturno) com os eventos reais
   */
  async getEditorialPreview(type: 'morning' | 'evening' = 'morning', events?: any[]): Promise<string> {
    try {
      const res = await fetch('/api/resend/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          events: events && events.length > 0 ? events.map(e => ({
            id: e.id,
            title: e.title,
            summary: e.summary,
            category: e.category,
            imageUrl: e.imageUrl,
            relativeTime: e.relativeTime,
            sources: e.sources,
            sourceCountText: e.sourceCountText
          })) : undefined
        })
      });
      if (res.ok) {
        return await res.text();
      }
    } catch (e) {
      console.warn('[ResendService] Falha ao obter preview editorial:', e);
    }
    return '';
  }

  /**
   * Dispara a publicação editorial definitiva (Resumo Matinal 07h00 ou Noturno 20h00)
   * preenchida dinamicamente com os acontecimentos reais da plataforma Sinal.
   */
  async sendEditorialBriefing(options: {
    type?: 'morning' | 'evening';
    toEmail?: string;
    events?: any[];
    customTitle?: string;
    customSubtitle?: string;
  }): Promise<ResendSendResult> {
    const isEvening = options.type === 'evening';
    const recipient = options.toEmail || this.getStoredSubscriberEmail();
    const editionTitle = isEvening ? 'Resumo Noturno (20h00)' : 'Resumo Matinal (07h00)';
    const defaultSubject = `Sinal • ${editionTitle} — ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}`;

    const mappedEvents = options.events && options.events.length > 0
      ? options.events.map(e => ({
          id: e.id,
          title: e.title,
          summary: e.summary,
          category: e.category,
          imageUrl: e.imageUrl,
          relativeTime: e.relativeTime,
          sources: e.sources,
          sourceCountText: e.sourceCountText
        }))
      : undefined;

    try {
      const res = await fetch('/api/resend/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipient,
          template: 'briefing',
          type: options.type || 'morning',
          subject: defaultSubject,
          customTitle: options.customTitle,
          customSubtitle: options.customSubtitle,
          events: mappedEvents,
          text: `Sinal • ${editionTitle}\n${options.customSubtitle || 'Seu resumo com os principais acontecimentos apurados pela Sinal.'}`
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return {
          success: true,
          id: data.id,
          recipient,
          template: 'briefing',
          provider: 'Resend',
          message: data.message || `${editionTitle} despachado para ${recipient}`
        };
      }
      return {
        success: false,
        recipient,
        error: data.error || data.message || `Falha no envio (HTTP ${res.status})`
      };
    } catch (err: any) {
      return {
        success: false,
        recipient,
        error: err.message || 'Falha de comunicação com o servidor'
      };
    }
  }

  /**
   * Dispara um teste do Morning Briefing das 07h00 utilizando a publicação editorial Sinal
   */
  async sendMorningBriefingTest(toEmail?: string): Promise<ResendSendResult> {
    return this.sendEditorialBriefing({
      type: 'morning',
      toEmail
    });
  }

  getStoredSubscriberEmail(): string {
    try {
      const saved = localStorage.getItem(STORAGE_EMAIL_KEY);
      if (saved && saved.includes('@') && !saved.toLowerCase().includes('yleaopvpy01')) return saved;
    } catch {}
    return DEFAULT_EMAIL;
  }

  setStoredSubscriberEmail(email: string): void {
    try {
      localStorage.setItem(STORAGE_EMAIL_KEY, email);
    } catch {}
  }

  /**
   * Consulta os dados agregados e eventos de webhooks do Resend
   */
  async getWebhookEvents(): Promise<{
    ok: boolean;
    counts: ResendWebhookCounts;
    recentEvents: ResendWebhookItem[];
  }> {
    try {
      const res = await fetch('/api/resend/webhook');
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('[ResendService] Falha ao consultar webhooks:', e);
    }
    return {
      ok: false,
      counts: { delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 },
      recentEvents: []
    };
  }

  /**
   * Dispara um evento simulado para o endpoint /api/resend/webhook (útil para testes do painel)
   */
  async simulateWebhookEvent(
    type: 'delivered' | 'opened' | 'clicked' | 'bounced',
    customData?: { emailId?: string; recipient?: string; subject?: string; link?: string }
  ): Promise<{ success: boolean; eventType: string; eventId?: string }> {
    const recipient = customData?.recipient || this.getStoredSubscriberEmail();
    const emailId = customData?.emailId || `sim_${Date.now()}`;
    const subject = customData?.subject || 'FatosBR • Briefing Executivo';

    try {
      const res = await fetch('/api/resend/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: `email.${type}`,
          created_at: new Date().toISOString(),
          data: {
            email_id: emailId,
            to: [recipient],
            subject: subject,
            click: type === 'clicked' ? { link: customData?.link || 'https://fatosbr.app/briefings/latest' } : undefined
          }
        })
      });
      const data = await res.json();
      return {
        success: res.ok,
        eventType: type,
        eventId: data.eventId
      };
    } catch (err: any) {
      return {
        success: false,
        eventType: type
      };
    }
  }

  /**
   * Obtém a configuração atual do Resend (remetente e chave mascarada)
   */
  async getConfig(): Promise<{ success: boolean; sender: string; keyMasked: string; hasKey: boolean }> {
    try {
      const res = await fetch('/api/resend/config');
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('[ResendService] Falha ao obter config:', e);
    }
    return {
      success: false,
      sender: 'FatosBR Briefing <onboarding@resend.dev>',
      keyMasked: 'Não configurado',
      hasKey: false
    };
  }

  /**
   * Atualiza as credenciais e o remetente do Resend no servidor
   */
  async updateConfig(apiKey?: string, sender?: string): Promise<{ success: boolean; message: string; sender?: string; keyMasked?: string }> {
    try {
      const res = await fetch('/api/resend/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey?.trim() || undefined,
          sender: sender?.trim() || undefined
        })
      });
      const data = await res.json();
      return {
        success: res.ok && data.success,
        message: data.message || (res.ok ? 'Configurações salvas' : 'Falha ao salvar'),
        sender: data.sender,
        keyMasked: data.keyMasked
      };
    } catch (e: any) {
      return {
        success: false,
        message: e.message || 'Falha na comunicação com o servidor'
      };
    }
  }
}

export const resendService = new ResendService();
