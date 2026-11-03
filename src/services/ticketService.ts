/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';

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
  private inMemoryTickets: SupportTicket[] = [];
  private isInitialized = false;

  constructor() {
    this.inMemoryTickets = this.getStoredTickets();
    if (typeof window !== 'undefined') {
      this.syncWithSupabase().catch(() => {});
    }
  }

  private getStoredTickets(): SupportTicket[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed.filter((t) => t.id !== 'tkt-1001' && t.id !== 'tkt-1002');
        }
      }
    } catch {
      // fallback
    }
    return [];
  }

  private saveTickets(tickets: SupportTicket[]): void {
    this.inMemoryTickets = tickets;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
      window.dispatchEvent(new CustomEvent('fatosbr_tickets_updated', { detail: tickets }));
    } catch (e) {
      console.warn('[TicketService] Erro ao salvar tickets no localStorage:', e);
    }
  }

  /**
   * Sincroniza os chamados diretamente com a tabela support_tickets do Supabase
   */
  public async syncWithSupabase(): Promise<SupportTicket[]> {
    if (!isSupabaseConfigured) {
      return this.inMemoryTickets;
    }

    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        // Tabela pode ainda não ter sido migrada no Supabase do cliente
        console.warn('[TicketService] Falha ao consultar support_tickets no Supabase:', error.message);
        return this.inMemoryTickets;
      }

      if (Array.isArray(data) && data.length > 0) {
        const mapped: SupportTicket[] = data.map((row: any) => ({
          id: row.id,
          userEmail: row.user_email || row.userEmail || '',
          userName: row.user_name || row.userName || 'Usuário FatosBR',
          subject: row.subject || 'Sem assunto',
          message: row.message || '',
          status: (row.status as any) || 'open',
          createdAt: row.created_at || row.createdAt || new Date().toISOString(),
          updatedAt: row.updated_at || row.updatedAt || new Date().toISOString(),
          responses: Array.isArray(row.responses) ? row.responses : []
        }));

        this.saveTickets(mapped);
        this.isInitialized = true;
        return mapped;
      }
    } catch (err: any) {
      console.warn('[TicketService] Exceção na sincronização Supabase:', err.message);
    }

    return this.inMemoryTickets;
  }

  public getAllTickets(): SupportTicket[] {
    if (this.inMemoryTickets.length === 0) {
      this.inMemoryTickets = this.getStoredTickets();
    }
    return this.inMemoryTickets;
  }

  public getTicketsByEmail(email: string): SupportTicket[] {
    const norm = email.trim().toLowerCase();
    return this.getAllTickets().filter((t) => t.userEmail.toLowerCase() === norm);
  }

  /**
   * Cria um chamado real no Supabase e no cache local
   */
  public async createTicket(
    userEmail: string,
    userName: string,
    subject: string,
    message: string
  ): Promise<SupportTicket> {
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

    // 1. Salva imediatamente em memória e localStorage
    const current = this.getAllTickets();
    const updated = [newTicket, ...current.filter((t) => t.id !== newId)];
    this.saveTickets(updated);

    // 2. Persiste na tabela support_tickets do Supabase
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase.from('support_tickets').insert({
          id: newTicket.id,
          user_email: newTicket.userEmail,
          user_name: newTicket.userName,
          subject: newTicket.subject,
          message: newTicket.message,
          status: newTicket.status,
          responses: newTicket.responses,
          created_at: newTicket.createdAt,
          updated_at: newTicket.updatedAt
        });

        if (error) {
          console.warn('[TicketService] Aviso ao inserir no Supabase (mantido em local):', error.message);
        }
      } catch (err: any) {
        console.warn('[TicketService] Erro ao gravar ticket no Supabase:', err.message);
      }
    }

    // 3. Dispara e-mail de confirmação de abertura para o usuário
    await this.sendEmailNotification({
      to: newTicket.userEmail,
      subject: `[FatosBR Suporte] Ticket #${newTicket.id} recebido: ${newTicket.subject}`,
      type: 'ticket_opened',
      ticketId: newTicket.id,
      body: `Olá ${newTicket.userName},\n\nRecebemos seu chamado com o assunto "${newTicket.subject}". Nossa equipe analisará e responderá com prioridade.\n\nMensagem original:\n"${newTicket.message}"\n\nAtenciosamente,\nEquipe de Suporte FatosBR`
    });

    return newTicket;
  }

  /**
   * Responde ao chamado com persistência no Supabase
   */
  public async replyTicket(
    ticketId: string,
    adminResponse: string,
    authorName = 'Equipe FatosBR Suporte'
  ): Promise<SupportTicket | null> {
    const current = this.getAllTickets();
    const index = current.findIndex((t) => t.id === ticketId);
    if (index === -1) return null;

    const ticket = { ...current[index] };
    const now = new Date().toISOString();

    const resp: TicketResponse = {
      id: `resp-${Date.now()}`,
      from: 'admin',
      authorName,
      message: adminResponse.trim(),
      sentAt: now
    };

    ticket.responses = [...(ticket.responses || []), resp];
    ticket.status = 'answered';
    ticket.updatedAt = now;

    current[index] = ticket;
    this.saveTickets([...current]);

    // Atualiza no Supabase
    if (isSupabaseConfigured) {
      try {
        await supabase
          .from('support_tickets')
          .update({
            responses: ticket.responses,
            status: ticket.status,
            updated_at: ticket.updatedAt
          })
          .eq('id', ticketId);
      } catch (err: any) {
        console.warn('[TicketService] Erro ao atualizar resposta no Supabase:', err.message);
      }
    }

    // Dispara e-mail informando a resposta para o usuário
    await this.sendEmailNotification({
      to: ticket.userEmail,
      subject: `[FatosBR Suporte] Nova resposta no ticket #${ticket.id}: ${ticket.subject}`,
      type: 'ticket_replied',
      ticketId: ticket.id,
      body: `Olá ${ticket.userName},\n\nVocê recebeu uma resposta da equipe FatosBR para o chamado #${ticket.id}:\n\n"${adminResponse.trim()}"\n\nAtenciosamente,\n${authorName}`
    });

    return ticket;
  }

  /**
   * Encerra e marca o chamado como resolvido
   */
  public async resolveTicket(ticketId: string, resolutionNote?: string): Promise<SupportTicket | null> {
    const current = this.getAllTickets();
    const index = current.findIndex((t) => t.id === ticketId);
    if (index === -1) return null;

    const ticket = { ...current[index] };
    const now = new Date().toISOString();

    if (resolutionNote && resolutionNote.trim()) {
      ticket.responses = [
        ...(ticket.responses || []),
        {
          id: `resp-${Date.now()}`,
          from: 'admin',
          authorName: 'Equipe FatosBR Suporte',
          message: resolutionNote.trim(),
          sentAt: now
        }
      ];
    }

    ticket.status = 'resolved';
    ticket.updatedAt = now;

    current[index] = ticket;
    this.saveTickets([...current]);

    // Atualiza no Supabase
    if (isSupabaseConfigured) {
      try {
        await supabase
          .from('support_tickets')
          .update({
            responses: ticket.responses,
            status: ticket.status,
            updated_at: ticket.updatedAt
          })
          .eq('id', ticketId);
      } catch (err: any) {
        console.warn('[TicketService] Erro ao marcar ticket resolvido no Supabase:', err.message);
      }
    }

    // Dispara e-mail informando encerramento
    await this.sendEmailNotification({
      to: ticket.userEmail,
      subject: `[FatosBR Suporte] Ticket #${ticket.id} resolvido com sucesso`,
      type: 'ticket_resolved',
      ticketId: ticket.id,
      body: `Olá ${ticket.userName},\n\nSeu chamado #${ticket.id} ("${ticket.subject}") foi concluído e marcado como resolvido.\n${
        resolutionNote ? `\nNota de encerramento:\n"${resolutionNote.trim()}"\n` : ''
      }\nAtenciosamente,\nEquipe FatosBR`
    });

    return ticket;
  }

  /**
   * Envia notificação por e-mail via endpoint Resend
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

    console.info(`[TicketService] Notificação para ${payload.to} [${payload.type}]`);
    return true;
  }
}

export const ticketService = new TicketService();
