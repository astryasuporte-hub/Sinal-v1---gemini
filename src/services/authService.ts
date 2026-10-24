/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';

export interface AuthResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export const authService = {
  isConfigured(): boolean {
    return isSupabaseConfigured;
  },

  /**
   * Cadastro com Email e Senha
   */
  async signUp(email: string, password: string, fullName?: string): Promise<AuthResponse<{ user: User | null }>> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        error: 'Supabase ainda não configurado. Adicione VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.',
      };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName || email.split('@')[0],
          },
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, data: { user: data.user } };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao realizar cadastro.',
      };
    }
  },

  /**
   * Login com Email e Senha
   */
  async signIn(email: string, password: string): Promise<AuthResponse<{ user: User | null; session: Session | null }>> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        error: 'Supabase ainda não configurado.',
      };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, data: { user: data.user, session: data.session } };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao realizar login.',
      };
    }
  },

  /**
   * Login sem senha via Magic Link (link enviado por e-mail)
   */
  async signInWithMagicLink(email: string, redirectTo?: string): Promise<AuthResponse> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        error: 'Supabase ainda não configurado.',
      };
    }

    try {
      const redirectUrl = redirectTo || (typeof window !== 'undefined' ? window.location.origin : undefined);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao enviar link mágico.',
      };
    }
  },

  /**
   * Login com Provedor OAuth (Google)
   */
  async signInWithOAuth(provider: 'google'): Promise<AuthResponse<{ url?: string }>> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        error: 'Supabase ainda não configurado.',
      };
    }

    try {
      const redirectUrl =
        typeof window !== 'undefined'
          ? (window.location.hostname.includes('fatosbr.com.br')
              ? 'https://fatosbr.com.br/oauth/consent'
              : `${window.location.origin}`)
          : undefined;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, data: { url: data.url } };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao iniciar autenticação com o Google.',
      };
    }
  },

  /**
   * Logout do usuário
   */
  async signOut(): Promise<AuthResponse> {
    if (!isSupabaseConfigured) {
      return { success: true };
    }

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao desconectar.',
      };
    }
  },

  /**
   * Obtém o usuário atual autenticado
   */
  async getCurrentUser(): Promise<User | null> {
    if (!isSupabaseConfigured) return null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    } catch {
      return null;
    }
  },

  /**
   * Obtém a sessão atual
   */
  async getSession(): Promise<Session | null> {
    if (!isSupabaseConfigured) return null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session;
    } catch {
      return null;
    }
  },

  /**
   * Observa mudanças no estado de autenticação
   */
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    if (!isSupabaseConfigured) {
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
    return supabase.auth.onAuthStateChange(callback);
  },

  /**
   * Carrega perfil do usuário na tabela public.profiles
   */
  async getUserProfile(userId: string) {
    if (!isSupabaseConfigured) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) return null;
      return data;
    } catch {
      return null;
    }
  },
};
