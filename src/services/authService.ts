/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FatosBR Auth Service V3.0
 * - 100% baseado no Supabase Auth oficial
 * - Zero Magic Links, zero geração de OTP no navegador, zero bypass local
 * - Códigos numéricos OTP de 6 dígitos com sessão real validada
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js';

export type AuthErrorContext = 'signin' | 'signup' | 'otp' | 'recovery' | 'oauth' | 'password_update';

export interface AuthResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

export interface TranslatedAuthError {
  code: string;
  message: string;
}

/**
 * Traduz erros do Supabase Auth e de rede para mensagens claras e amigáveis em Português (Brasil).
 */
export function translateAuthError(
  error: unknown,
  context: AuthErrorContext = 'signin'
): TranslatedAuthError {
  const rawMessage =
    typeof error === 'string'
      ? error
      : error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as any).message)
      : '';

  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error && (error as any).code
      ? String((error as any).code).toLowerCase()
      : '';

  const msg = rawMessage.toLowerCase();

  // Ambiente / Serviço indisponível
  if (msg.includes('não configurado') || msg.includes('service unavailable') || msg.includes('placeholder')) {
    return {
      code: 'AUTH_SERVICE_UNAVAILABLE',
      message: 'Serviço de autenticação indisponível no momento. Tente novamente em instantes.',
    };
  }

  // Rate limit / Too many requests
  if (
    rawCode === 'over_email_send_rate_limit' ||
    rawCode === 'over_request_rate_limit' ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('429') ||
    msg.includes('only request this after')
  ) {
    const secMatch = rawMessage.match(/(\d+)\s*seconds?/i);
    if (secMatch?.[1]) {
      return {
        code: 'RATE_LIMITED',
        message: `Muitas tentativas em sequência. Aguarde ${secMatch[1]} segundos antes de tentar novamente.`,
      };
    }
    return {
      code: 'RATE_LIMITED',
      message: 'Muitas tentativas em sequência. Aguarde alguns instantes antes de solicitar um novo código.',
    };
  }

  // OTP inválido / expirado / já utilizado
  if (
    rawCode === 'otp_expired' ||
    msg.includes('token has expired') ||
    msg.includes('expired or is invalid') ||
    msg.includes('otp_expired') ||
    msg.includes('invalid token') ||
    (context === 'otp' && (msg.includes('invalid') || msg.includes('expired') || msg.includes('not found')))
  ) {
    return {
      code: 'OTP_INVALID_OR_EXPIRED',
      message: 'Código inválido, expirado ou já utilizado. Confira os 6 dígitos ou solicite um novo código.',
    };
  }

  // Usuário não encontrado ao tentar login por código sem cadastro (shouldCreateUser: false)
  if (
    rawCode === 'otp_disabled' ||
    msg.includes('signups not allowed for otp') ||
    msg.includes('user not found') ||
    msg.includes('no user found')
  ) {
    return {
      code: 'USER_NOT_FOUND',
      message: 'Não encontramos uma conta com este e-mail. Confira o endereço ou crie uma conta primeiro.',
    };
  }

  // E-mail ainda não confirmado
  if (rawCode === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return {
      code: 'EMAIL_NOT_CONFIRMED',
      message: 'Seu e-mail ainda não foi confirmado. Confirme com o código de 6 dígitos enviado para sua caixa de entrada.',
    };
  }

  // Credenciais inválidas (e-mail/senha)
  if (
    rawCode === 'invalid_credentials' ||
    msg.includes('invalid login credentials') ||
    msg.includes('invalid email or password')
  ) {
    return {
      code: 'INVALID_CREDENTIALS',
      message: 'E-mail ou senha incorretos. Confira seus dados ou use "Esqueci minha senha".',
    };
  }

  // Usuário já cadastrado
  if (
    rawCode === 'user_already_exists' ||
    rawCode === 'email_exists' ||
    msg.includes('user already registered') ||
    msg.includes('already registered') ||
    msg.includes('already exists')
  ) {
    return {
      code: 'USER_ALREADY_REGISTERED',
      message: 'Este e-mail já está cadastrado. Faça login ou recupere sua senha.',
    };
  }

  // Senha fraca ou igual à anterior
  if (rawCode === 'same_password' || msg.includes('new password should be different')) {
    return {
      code: 'SAME_PASSWORD',
      message: 'A nova senha deve ser diferente da senha atual.',
    };
  }

  if (
    rawCode === 'weak_password' ||
    msg.includes('password should be at least') ||
    msg.includes('weak password')
  ) {
    return {
      code: 'WEAK_PASSWORD',
      message: 'A senha não atende aos requisitos mínimos de segurança (mínimo de 8 caracteres com letras e números).',
    };
  }

  // Sessão ausente / expirada
  if (
    rawCode === 'session_not_found' ||
    msg.includes('auth session missing') ||
    msg.includes('session not found') ||
    msg.includes('refresh token')
  ) {
    return {
      code: 'SESSION_EXPIRED',
      message: 'Sua sessão expirou ou o código já venceu. Solicite um novo código para continuar.',
    };
  }

  // OAuth indisponível
  if (
    msg.includes('provider is not enabled') ||
    msg.includes('unsupported provider') ||
    (context === 'oauth' && msg.includes('provider'))
  ) {
    return {
      code: 'OAUTH_PROVIDER_UNAVAILABLE',
      message: 'O login com Google não está habilitado no projeto. Entre usando seu e-mail.',
    };
  }

  // Falha de rede / SMTP / 5xx
  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('timeout') ||
    msg.includes('error sending') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  ) {
    if (msg.includes('error sending')) {
      return {
        code: 'EMAIL_DISPATCH_FAILED',
        message: 'Não foi possível enviar o e-mail de verificação agora. Tente novamente em instantes.',
      };
    }
    return {
      code: 'NETWORK_ERROR',
      message: 'Falha de conexão com o servidor de autenticação. Verifique sua internet e tente novamente.',
    };
  }

  // E-mail inválido
  if (rawCode === 'validation_failed' || msg.includes('unable to validate email') || msg.includes('invalid email')) {
    return {
      code: 'INVALID_EMAIL',
      message: 'Informe um endereço de e-mail válido.',
    };
  }

  // Fallback seguro por contexto (sem vazar mensagens técnicas em inglês)
  const defaultByContext: Record<AuthErrorContext, string> = {
    signin: 'Não foi possível concluir seu acesso. Verifique seus dados e tente novamente.',
    signup: 'Não foi possível concluir seu cadastro agora. Tente novamente em instantes.',
    otp: 'Não foi possível validar o código informado. Solicite um novo código e tente novamente.',
    recovery: 'Não foi possível enviar o código de recuperação. Tente novamente em instantes.',
    oauth: 'Não foi possível conectar com o Google agora. Tente novamente ou entre com e-mail.',
    password_update: 'Não foi possível atualizar sua senha agora. Solicite um novo código de recuperação.',
  };

  return {
    code: rawCode ? rawCode.toUpperCase() : 'AUTH_ERROR',
    message: defaultByContext[context],
  };
}

/**
 * Validação padronizada de formato de e-mail e requisitos mínimos de senha FatosBR.
 */
export function validatePasswordRequirements(password: string) {
  return {
    minLength: password.length >= 8,
    hasLetter: /[a-zA-ZÀ-ÿ]/.test(password),
    hasNumber: /\d/.test(password),
    get isValid() {
      return this.minLength && this.hasLetter && this.hasNumber;
    },
  };
}

export const authService = {
  isConfigured(): boolean {
    return isSupabaseConfigured;
  },

  translateError(error: unknown, context: AuthErrorContext = 'signin'): TranslatedAuthError {
    return translateAuthError(error, context);
  },

  /**
   * Cadastro oficial com e-mail e senha via Supabase Auth.
   * Quando a confirmação de e-mail está ativa no Supabase, data.session vem null
   * e o usuário precisa validar o código numérico de 6 dígitos (type: 'signup').
   */
  async signUpWithPassword(
    email: string,
    password: string,
    fullName?: string
  ): Promise<AuthResponse<{ user: User | null; session: Session | null; needsEmailConfirmation: boolean }>> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        errorCode: 'AUTH_SERVICE_UNAVAILABLE',
        error: 'Serviço de autenticação indisponível no momento.',
      };
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName?.trim() || cleanEmail.split('@')[0];

    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: cleanName,
            name: cleanName,
          },
        },
      });

      if (error) {
        const translated = translateAuthError(error, 'signup');
        return { success: false, errorCode: translated.code, error: translated.message };
      }

      // Nota Supabase: se identidades vierem vazias em alguns cenários de proteção contra enumeração,
      // tratamos como conta já existente caso session === null e identities.length === 0.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return {
          success: false,
          errorCode: 'USER_ALREADY_REGISTERED',
          error: 'Este e-mail já está cadastrado. Faça login ou recupere sua senha.',
        };
      }

      const needsEmailConfirmation = !data.session;
      return {
        success: true,
        data: {
          user: data.user,
          session: data.session,
          needsEmailConfirmation,
        },
      };
    } catch (err) {
      const translated = translateAuthError(err, 'signup');
      return { success: false, errorCode: translated.code, error: translated.message };
    }
  },

  /**
   * Alias compatível para cadastro com e-mail e senha.
   */
  async signUp(email: string, password: string, fullName?: string) {
    return this.signUpWithPassword(email, password, fullName);
  },

  /**
   * Login oficial com e-mail e senha via Supabase Auth.
   */
  async signInWithPassword(
    email: string,
    password: string
  ): Promise<AuthResponse<{ user: User | null; session: Session | null }>> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        errorCode: 'AUTH_SERVICE_UNAVAILABLE',
        error: 'Serviço de autenticação indisponível no momento.',
      };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        const translated = translateAuthError(error, 'signin');
        return { success: false, errorCode: translated.code, error: translated.message };
      }

      if (!data.session || !data.user) {
        return {
          success: false,
          errorCode: 'SESSION_MISSING',
          error: 'Não foi possível estabelecer sua sessão agora. Tente novamente.',
        };
      }

      return { success: true, data: { user: data.user, session: data.session } };
    } catch (err) {
      const translated = translateAuthError(err, 'signin');
      return { success: false, errorCode: translated.code, error: translated.message };
    }
  },

  /**
   * Alias compatível para login com e-mail e senha.
   */
  async signIn(email: string, password: string) {
    return this.signInWithPassword(email, password);
  },

  /**
   * Envia código numérico OTP de 6 dígitos para login (SEM Magic Link e com shouldCreateUser: false).
   */
  async signInWithEmailOtp(email: string): Promise<AuthResponse> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        errorCode: 'AUTH_SERVICE_UNAVAILABLE',
        error: 'Serviço de autenticação indisponível no momento.',
      };
    }

    try {
      const { data, error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: false,
        },
      });

      if (error) {
        const translated = translateAuthError(error, 'signin');
        return { success: false, errorCode: translated.code, error: translated.message };
      }

      return { success: true, data };
    } catch (err) {
      const translated = translateAuthError(err, 'signin');
      return { success: false, errorCode: translated.code, error: translated.message };
    }
  },

  /**
   * Reenvia código numérico OTP de confirmação de cadastro.
   */
  async resendSignupOtp(email: string): Promise<AuthResponse> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        errorCode: 'AUTH_SERVICE_UNAVAILABLE',
        error: 'Serviço de autenticação indisponível no momento.',
      };
    }

    try {
      const { data, error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
      });

      if (error) {
        const translated = translateAuthError(error, 'otp');
        return { success: false, errorCode: translated.code, error: translated.message };
      }

      return { success: true, data };
    } catch (err) {
      const translated = translateAuthError(err, 'otp');
      return { success: false, errorCode: translated.code, error: translated.message };
    }
  },

  /**
   * Inicia recuperação de senha enviando código numérico OTP via Supabase Auth.
   */
  async requestPasswordRecoveryOtp(email: string): Promise<AuthResponse> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        errorCode: 'AUTH_SERVICE_UNAVAILABLE',
        error: 'Serviço de autenticação indisponível no momento.',
      };
    }

    try {
      const { data, error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());

      if (error) {
        const translated = translateAuthError(error, 'recovery');
        return { success: false, errorCode: translated.code, error: translated.message };
      }

      return { success: true, data };
    } catch (err) {
      const translated = translateAuthError(err, 'recovery');
      return { success: false, errorCode: translated.code, error: translated.message };
    }
  },

  /**
   * Valida código OTP de 6 dígitos no Supabase Auth (zero fallback/bypass).
   * Só retorna success: true quando o Supabase Auth confirmar sessão e usuário válidos.
   */
  async verifyOtp(
    email: string,
    token: string,
    type: 'email' | 'signup' | 'recovery' = 'email'
  ): Promise<AuthResponse<{ user: User | null; session: Session | null }>> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        errorCode: 'AUTH_SERVICE_UNAVAILABLE',
        error: 'Serviço de autenticação indisponível no momento.',
      };
    }

    const cleanToken = token.replace(/\D/g, '').trim();
    if (cleanToken.length !== 6) {
      return {
        success: false,
        errorCode: 'INVALID_OTP_FORMAT',
        error: 'Digite os 6 dígitos numéricos do código enviado por e-mail.',
      };
    }

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: cleanToken,
        type,
      });

      if (error) {
        const translated = translateAuthError(error, 'otp');
        return { success: false, errorCode: translated.code, error: translated.message };
      }

      if (!data?.session || !data?.user) {
        return {
          success: false,
          errorCode: 'SESSION_MISSING',
          error: 'Não foi possível validar sua sessão com este código. Solicite um novo código.',
        };
      }

      return {
        success: true,
        data: { user: data.user, session: data.session },
      };
    } catch (err) {
      const translated = translateAuthError(err, 'otp');
      return { success: false, errorCode: translated.code, error: translated.message };
    }
  },

  async verifyEmailOtp(email: string, token: string) {
    return this.verifyOtp(email, token, 'email');
  },

  async verifySignupOtp(email: string, token: string) {
    return this.verifyOtp(email, token, 'signup');
  },

  async verifyRecoveryOtp(email: string, token: string) {
    return this.verifyOtp(email, token, 'recovery');
  },

  /**
   * Define nova senha na sessão autenticada de recuperação.
   */
  async updatePassword(newPassword: string): Promise<AuthResponse<{ user: User | null }>> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        errorCode: 'AUTH_SERVICE_UNAVAILABLE',
        error: 'Serviço de autenticação indisponível no momento.',
      };
    }

    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        const translated = translateAuthError(error, 'password_update');
        return { success: false, errorCode: translated.code, error: translated.message };
      }

      return { success: true, data: { user: data.user } };
    } catch (err) {
      const translated = translateAuthError(err, 'password_update');
      return { success: false, errorCode: translated.code, error: translated.message };
    }
  },

  /**
   * Login com Provedor OAuth (Google) via Supabase Auth.
   */
  async signInWithOAuth(provider: 'google'): Promise<AuthResponse<{ url?: string }>> {
    if (!isSupabaseConfigured) {
      return {
        success: false,
        errorCode: 'AUTH_SERVICE_UNAVAILABLE',
        error: 'Autenticação Google indisponível neste ambiente.',
      };
    }

    try {
      const redirectUrl =
        typeof window !== 'undefined'
          ? window.location.hostname.includes('fatosbr.com.br')
            ? 'https://app.fatosbr.com.br'
            : `${window.location.origin}`
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
        const translated = translateAuthError(error, 'oauth');
        return { success: false, errorCode: translated.code, error: translated.message };
      }

      return { success: true, data: { url: data.url } };
    } catch (err) {
      const translated = translateAuthError(err, 'oauth');
      return { success: false, errorCode: translated.code, error: translated.message };
    }
  },

  async signInWithGoogle() {
    return this.signInWithOAuth('google');
  },

  /**
   * Logout do usuário no Supabase Auth.
   */
  async signOut(): Promise<AuthResponse> {
    if (!isSupabaseConfigured) {
      return { success: true };
    }

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        return { success: false, error: 'Não foi possível encerrar a sessão agora.' };
      }
      return { success: true };
    } catch {
      return { success: false, error: 'Falha ao encerrar sessão.' };
    }
  },

  /**
   * Obtém o usuário autenticado validado junto ao Supabase Auth.
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
   * Obtém a sessão ativa atual do Supabase Auth.
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
   * Observa mudanças no estado de autenticação.
   */
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    if (!isSupabaseConfigured) {
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
    return supabase.auth.onAuthStateChange(callback);
  },

  /**
   * Carrega perfil completo do usuário na tabela public.profiles (chaveado por user_id).
   */
  async getUserProfile(userId: string) {
    if (!isSupabaseConfigured || !userId) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) return null;
      return data;
    } catch {
      return null;
    }
  },
};
