/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { ticketService, SupportTicket, TicketResponse } from '../services/ticketService';

interface UseSupportTicketsOptions {
  userEmail?: string;
  userName?: string;
}

export interface UseSupportTicketsResult {
  tickets: SupportTicket[];
  userTickets: SupportTicket[];
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  openCount: number;
  answeredCount: number;
  resolvedCount: number;
  createTicket: (subject: string, message: string) => Promise<SupportTicket>;
  replyTicket: (ticketId: string, message: string, authorName?: string) => Promise<SupportTicket | null>;
  resolveTicket: (ticketId: string, note?: string) => Promise<SupportTicket | null>;
  refreshTickets: () => Promise<void>;
}

export function useSupportTickets(options: UseSupportTicketsOptions = {}): UseSupportTicketsResult {
  const { userEmail, userName } = options;
  const [tickets, setTickets] = useState<SupportTicket[]>(() => ticketService.getAllTickets());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filtra tickets exclusivos do usuário logado se o e-mail for fornecido
  const userTickets = useMemo(() => {
    if (!userEmail) return tickets;
    const norm = userEmail.trim().toLowerCase();
    return tickets.filter((t) => (t.userEmail || '').toLowerCase() === norm);
  }, [tickets, userEmail]);

  // Contadores analíticos
  const openCount = useMemo(() => userTickets.filter((t) => t.status === 'open').length, [userTickets]);
  const answeredCount = useMemo(() => userTickets.filter((t) => t.status === 'answered').length, [userTickets]);
  const resolvedCount = useMemo(() => userTickets.filter((t) => t.status === 'resolved').length, [userTickets]);

  // Sincronização centralizada com Supabase + fallback imediato do ticketService
  const refreshTickets = useCallback(async () => {
    setIsSyncing(true);
    setError(null);
    try {
      const fresh = await ticketService.syncWithSupabase();
      if (Array.isArray(fresh)) {
        setTickets([...fresh]);
      }
    } catch (err: any) {
      setError(err?.message || 'Falha ao sincronizar tickets com Supabase');
    } finally {
      setIsSyncing(false);
      setIsLoading(false);
    }
  }, []);

  // Criação de chamado
  const createTicket = useCallback(
    async (subject: string, message: string): Promise<SupportTicket> => {
      const email = userEmail || 'usuario@fatosbr.com.br';
      const name = userName || 'Leitor FatosBR';
      const created = await ticketService.createTicket(email, name, subject, message);
      setTickets((prev) => [created, ...prev.filter((t) => t.id !== created.id)]);
      return created;
    },
    [userEmail, userName]
  );

  // Resposta a chamado existente
  const replyTicket = useCallback(
    async (ticketId: string, message: string, authorName?: string): Promise<SupportTicket | null> => {
      const author = authorName || userName || 'Você';
      const updated = await ticketService.replyTicket(ticketId, message, author);
      if (updated) {
        setTickets((prev) => prev.map((t) => (t.id === ticketId ? updated : t)));
      }
      return updated;
    },
    [userName]
  );

  // Resolução de chamado
  const resolveTicket = useCallback(
    async (ticketId: string, note?: string): Promise<SupportTicket | null> => {
      const updated = await ticketService.resolveTicket(ticketId, note);
      if (updated) {
        setTickets((prev) => prev.map((t) => (t.id === ticketId ? updated : t)));
      }
      return updated;
    },
    []
  );

  // Efeito 1: Carga inicial e escuta de eventos locais no navegador
  useEffect(() => {
    refreshTickets();

    const handleLocalUpdate = (e: any) => {
      if (Array.isArray(e.detail)) {
        setTickets([...e.detail]);
      } else {
        setTickets([...ticketService.getAllTickets()]);
      }
    };

    window.addEventListener('fatosbr_tickets_updated', handleLocalUpdate);
    return () => window.removeEventListener('fatosbr_tickets_updated', handleLocalUpdate);
  }, [refreshTickets]);

  // Efeito 2: Inscrição Realtime no canal Postgres do Supabase (quando configurado)
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let channel: any = null;
    try {
      channel = supabase
        .channel('realtime_support_tickets')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'support_tickets' },
          (payload) => {
            if (payload.eventType === 'INSERT' && payload.new) {
              const row = payload.new;
              const mapped: SupportTicket = {
                id: row.id,
                userEmail: row.user_email || row.userEmail || '',
                userName: row.user_name || row.userName || 'Usuário',
                subject: row.subject || 'Sem assunto',
                message: row.message || '',
                status: row.status || 'open',
                createdAt: row.created_at || row.createdAt || new Date().toISOString(),
                updatedAt: row.updated_at || row.updatedAt || new Date().toISOString(),
                responses: Array.isArray(row.responses) ? row.responses : []
              };
              setTickets((prev) => [mapped, ...prev.filter((t) => t.id !== mapped.id)]);
            } else if (payload.eventType === 'UPDATE' && payload.new) {
              const row = payload.new;
              setTickets((prev) =>
                prev.map((t) =>
                  t.id === row.id
                    ? {
                        ...t,
                        status: row.status || t.status,
                        updatedAt: row.updated_at || new Date().toISOString(),
                        responses: Array.isArray(row.responses) ? row.responses : t.responses
                      }
                    : t
                )
              );
            } else if (payload.eventType === 'DELETE' && payload.old) {
              setTickets((prev) => prev.filter((t) => t.id !== payload.old.id));
            }
          }
        )
        .subscribe();
    } catch (err) {
      console.warn('[useSupportTickets] Supabase Realtime fallback to polling:', err);
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  return {
    tickets,
    userTickets,
    isLoading,
    isSyncing,
    error,
    openCount,
    answeredCount,
    resolvedCount,
    createTicket,
    replyTicket,
    resolveTicket,
    refreshTickets
  };
}
