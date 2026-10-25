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
   * Dispara autenticação via código OTP oficial do Supabase Auth
   */
  async signInWithOtp(
    email: string,
    options?: { shouldCreateUser?: boolean; emailRedirectTo?: string }
  ): Promise<AuthResponse> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        error: 'Supabase ainda não configurado.',
      };
    }

    try {
      const { data, error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: options?.shouldCreateUser ?? true,
          emailRedirectTo: options?.emailRedirectTo,
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao disparar OTP via Supabase.',
      };
    }
  },

  /**
   * Valida o código OTP de 6 dígitos no backend via /api/auth/verify-otp (Resend/Backend)
   */
  async verifyBackendOtp(
    email: string,
    code: string
  ): Promise<{ success: boolean; error?: string; message?: string }> {
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: code.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return { success: true, message: data.message };
      }
      return { success: false, error: data.error || 'Código de verificação incorreto.' };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Falha de comunicação com o servidor de autenticação.'
      };
    }
  },

  /**
   * Valida o token numérico (OTP) informado pelo usuário junto ao Supabase Auth
   * com verificação complementar no backend
   */
  async verifyOtp(
    email: string,
    token: string,
    type: 'email' | 'signup' | 'magiclink' = 'email'
  ): Promise<AuthResponse<{ user: User | null; session: Session | null }>> {
    const cleanToken = token.trim();

    // 1. Tentar validação no Supabase Auth se configurado
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.auth.verifyOtp({
          email,
          token: cleanToken,
          type,
        });

        if (!error && data?.session) {
          return { success: true, data: { user: data.user, session: data.session } };
        }
      } catch (err) {
        console.warn('[authService] Supabase verifyOtp tentou e falhou, tentando backend:', err);
      }
    }

    // 2. Validação no backend via /api/auth/verify-otp
    const backendRes = await this.verifyBackendOtp(email, cleanToken);
    if (backendRes.success) {
      return { success: true };
    }

    return {
      success: false,
      error: backendRes.error || 'Código de verificação incorreto ou expirado.',
    };
  },

  /**
   * Orquestra o envio do e-mail com código de confirmação (OTP) durante o login:
   * 1. Aciona o Supabase Auth (supabase.auth.signInWithOtp) para disparo oficial do provedor
   * 2. Aciona o endpoint /api/auth/send-otp com template dedicado e remetente do FatosBR
   */
  async sendLoginOtp(
    email: string,
    code: string
  ): Promise<{
    success: boolean;
    supabaseSent: boolean;
    resendSent: boolean;
    error?: string;
    details?: string;
  }> {
    let supabaseSent = false;
    let resendSent = false;
    let supabaseError: string | undefined;
    let resendError: string | undefined;

    // 1. Tentar envio via Supabase Auth se configurado
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
          },
        });

        if (!error) {
          supabaseSent = true;
          console.info('[authService] Código OTP disparado com sucesso via Supabase Auth.');
        } else {
          supabaseError = error.message;
          console.warn('[authService] Supabase signInWithOtp aviso/erro:', error.message);
        }
      } catch (err) {
        supabaseError = err instanceof Error ? err.message : 'Falha na conexão Supabase';
        console.warn('[authService] Erro ao disparar OTP via Supabase:', err);
      }
    }

    // 2. Disparar via endpoint de entrega direta /api/auth/send-otp
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.success) {
          resendSent = true;
          console.info('[authService] Código OTP entregue com sucesso via /api/auth/send-otp.');
        } else {
          resendError = data.error || 'Falha no envio de e-mail secundário';
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        resendError = errData.error || `HTTP ${res.status}`;
      }
    } catch (err) {
      resendError = err instanceof Error ? err.message : 'Falha na requisição de e-mail';
      console.warn('[authService] Falha ao chamar /api/auth/send-otp:', err);
    }

    const anySent = supabaseSent || resendSent;

    return {
      success: anySent,
      supabaseSent,
      resendSent,
      error: !anySent ? (supabaseError || resendError || 'Não foi possível despachar o código por e-mail.') : undefined,
      details: `Supabase: ${supabaseSent ? 'Enviado' : (supabaseError || 'Inativo')}; E-mail direto: ${resendSent ? 'Enviado' : (resendError || 'Inativo')}`,
    };
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
