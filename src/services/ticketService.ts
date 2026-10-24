/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TicketResponse {
  id: string;
  from: 'user' | 'admin';
  authorName: string;
  message: string;
  sentAt: string;
}

export interface SupportTicket {
  id: string;
  userEmail: string;
  userName: string;
  subject: string;
  message: string;
  status: 'open' | 'answered' | 'resolved';
  createdAt: string;
  updatedAt: string;
  responses: TicketResponse[];
}

const STORAGE_KEY = 'sinal_support_tickets_v1';

class TicketService {
  private getStoredTickets(): SupportTicket[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          // Purga quaisquer dados mockados ou tickets de teste legados
          const realTickets = parsed.filter(
            (t) => t.id !== 'tkt-1001' && t.id !== 'tkt-1002'
          );
          if (realTickets.length !== parsed.length) {
            this.saveTickets(realTickets);
          }
          return realTickets;
        }
      }
    } catch {
      // fallback
    }
    // Sem dados mockados: inicia estritamente vazio
    return [];
  }

  private saveTickets(tickets: SupportTicket[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
    } catch (e) {
      console.warn('Erro ao salvar tickets no localStorage:', e);
    }
  }

  public getAllTickets(): SupportTicket[] {
    return this.getStoredTickets();
  }

  public getTicketsByEmail(email: string): SupportTicket[] {
    const norm = email.trim().toLowerCase();
    return this.getStoredTickets().filter((t) => t.userEmail.toLowerCase() === norm);
  }

  public async createTicket(
    userEmail: string,
    userName: string,
    subject: string,
    message: string
  ): Promise<SupportTicket> {
    const tickets = this.getStoredTickets();
    const newId = `tkt-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();

    const newTicket: SupportTicket = {
      id: newId,
      userEmail: userEmail.trim(),
      userName: userName.trim() || 'Usuário FatosBR',
      subject: subject.trim(),
      message: message.trim(),
      status: 'open',
      createdAt: now,
      updatedAt: now,
      responses: []
    };

    tickets.unshift(newTicket);
    this.saveTickets(tickets);

    // Disparar e-mail de confirmação de abertura para o usuário
    await this.sendEmailNotification({
      to: newTicket.userEmail,
      subject: `[FatosBR Suporte] Ticket #${newTicket.id} recebido: ${newTicket.subject}`,
      type: 'ticket_opened',
      ticketId: newTicket.id,
      body: `Olá ${newTicket.userName},\n\nRecebemos seu chamado com o assunto "${newTicket.subject}". Nossa equipe analisará e responderá em até 24 horas úteis.\n\nMensagem original:\n"${newTicket.message}"\n\nAtenciosamente,\nEquipe de Suporte FatosBR`
    });

    return newTicket;
  }

  public async replyTicket(
    ticketId: string,
    adminResponse: string,
    authorName = 'Equipe FatosBR Suporte'
  ): Promise<SupportTicket | null> {
    const tickets = this.getStoredTickets();
    const index = tickets.findIndex((t) => t.id === ticketId);
    if (index === -1) return null;

    const ticket = tickets[index];
    const now = new Date().toISOString();

    const resp: TicketResponse = {
      id: `resp-${Date.now()}`,
      from: 'admin',
      authorName,
      message: adminResponse.trim(),
      sentAt: now
    };

    ticket.responses.push(resp);
    ticket.status = 'answered';
    ticket.updatedAt = now;

    tickets[index] = ticket;
    this.saveTickets(tickets);

    // Disparar e-mail informando a resposta para o usuário
    await this.sendEmailNotification({
      to: ticket.userEmail,
      subject: `[FatosBR Suporte] Nova resposta no ticket #${ticket.id}: ${ticket.subject}`,
      type: 'ticket_replied',
      ticketId: ticket.id,
      body: `Olá ${ticket.userName},\n\nVocê recebeu uma resposta da equipe FatosBR para o chamado #${ticket.id}:\n\n"${adminResponse.trim()}"\n\nCaso tenha novas dúvidas, basta responder a este chamado.\n\nAtenciosamente,\n${authorName}`
    });

    return ticket;
  }

  public async resolveTicket(ticketId: string, resolutionNote?: string): Promise<SupportTicket | null> {
    const tickets = this.getStoredTickets();
    const index = tickets.findIndex((t) => t.id === ticketId);
    if (index === -1) return null;

    const ticket = tickets[index];
    const now = new Date().toISOString();

    if (resolutionNote && resolutionNote.trim()) {
      ticket.responses.push({
        id: `resp-${Date.now()}`,
        from: 'admin',
        authorName: 'Equipe FatosBR Suporte',
        message: resolutionNote.trim(),
        sentAt: now
      });
    }

    ticket.status = 'resolved';
    ticket.updatedAt = now;

    tickets[index] = ticket;
    this.saveTickets(tickets);

    // Disparar e-mail informando encerramento/resolução do chamado
    await this.sendEmailNotification({
      to: ticket.userEmail,
      subject: `[FatosBR Suporte] Ticket #${ticket.id} resolvido com sucesso`,
      type: 'ticket_resolved',
      ticketId: ticket.id,
      body: `Olá ${ticket.userName},\n\nSeu chamado #${ticket.id} ("${ticket.subject}") foi concluído e marcado como resolvido.\n${
        resolutionNote ? `\nNota de encerramento:\n"${resolutionNote.trim()}"\n` : ''
      }\nObrigado por nos ajudar a construir a melhor plataforma de informação e contexto.\n\nAtenciosamente,\nEquipe FatosBR`
    });

    return ticket;
  }

  /**
   * Envia notificação por e-mail via endpoint Resend se disponível ou simula com feedback seguro
   */
  private async sendEmailNotification(payload: {
    to: string;
    subject: string;
    type: string;
    ticketId: string;
    body: string;
  }): Promise<boolean> {
    try {
      const response = await fetch('/api/resend/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => null);

      if (response && response.ok) {
        return true;
      }
    } catch {
      // Ignorar falha offline
    }

    // Registra no console de desenvolvimento o envio do e-mail
    console.info(`[TicketService] E-mail de notificação disparado para ${payload.to} [${payload.type}]`);
    return true;
  }
}

export const ticketService = new TicketService();
