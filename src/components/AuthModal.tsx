/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  X,
  Mail,
  Lock,
  User,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  ShieldCheck
} from 'lucide-react';
import { authService } from '../services/authService';
import { isSupabaseConfigured, getSupabaseConfigStatus } from '../lib/supabase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: (email: string, fullName?: string) => void;
  initialMode?: 'login' | 'signup' | 'magic-link';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'magic-link'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsGoogleLoading(true);

    try {
      if (!isSupabaseConfigured) {
        // Modo demonstração quando as variáveis do Supabase ainda não foram adicionadas no Vercel
        setTimeout(() => {
          setIsGoogleLoading(false);
          setSuccessMessage('Login com Google autenticado (Modo Demonstração).');
          setTimeout(() => {
            onAuthSuccess?.('usuario.google@fatosbr.com.br', 'Usuário Google');
            onClose();
          }, 800);
        }, 600);
        return;
      }

      const res = await authService.signInWithOAuth('google');
      if (!res.success) {
        setErrorMessage(res.error || 'Falha ao conectar com o Google.');
      } else {
        setSuccessMessage('Redirecionando para o Google...');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro ao autenticar com Google.');
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      if (!isSupabaseConfigured) {
        // Modo local/demonstração quando chaves ainda não foram injetadas
        setTimeout(() => {
          setIsLoading(false);
          setSuccessMessage('Sessão local iniciada com sucesso (Modo Demonstração). Configure o Supabase para sincronização na nuvem.');
          setTimeout(() => {
            onAuthSuccess?.(email || 'astryasuporte@gmail.com', fullName || 'Astrya Suporte');
            onClose();
          }, 1200);
        }, 600);
        return;
      }

      if (mode === 'login') {
        const res = await authService.signIn(email, password);
        if (!res.success) {
          setErrorMessage(res.error || 'Credenciais inválidas.');
        } else {
          setSuccessMessage('Login efetuado com sucesso!');
          setTimeout(() => {
            onAuthSuccess?.(email);
            onClose();
          }, 800);
        }
      } else if (mode === 'signup') {
        const res = await authService.signUp(email, password, fullName);
        if (!res.success) {
          setErrorMessage(res.error || 'Erro ao criar conta.');
        } else {
          setSuccessMessage('Conta criada com sucesso! Verifique seu e-mail para confirmação se necessário.');
          setTimeout(() => {
            onAuthSuccess?.(email, fullName);
            onClose();
          }, 1200);
        }
      } else if (mode === 'magic-link') {
        const res = await authService.signInWithMagicLink(email);
        if (!res.success) {
          setErrorMessage(res.error || 'Erro ao enviar link de acesso.');
        } else {
          setSuccessMessage(`Link mágico enviado para ${email}. Acesse sua caixa postal.`);
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div
        className="w-full max-w-md bg-[#0a0c10] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-800/80 bg-zinc-950/60">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <span className="font-mono text-xs font-bold text-white tracking-wider">FBR</span>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white tracking-tight">FatosBR Intelligence</h3>
              <p className="text-xs text-zinc-400">Acesso seguro e sincronização contínua</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Supabase Banner */}
        <div className="px-6 pt-4">
          {(() => {
            const status = getSupabaseConfigStatus();
            if (status.isServiceRoleBlocked) {
              return (
                <div className="flex items-start space-x-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Bloqueio de Segurança Ativo</span>
                    <span className="text-zinc-300">Foi detectada uma chave "service_role". Substitua pela chave pública "anon" para proteger o banco.</span>
                  </div>
                </div>
              );
            }
            if (status.configured) {
              return (
                <div className="flex items-center space-x-2 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Conectado ao Supabase Auth via chave pública (anon)</span>
                </div>
              );
            }
            return (
              <div className="flex items-center space-x-2 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Modo Local / Demonstração (Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY)</span>
              </div>
            );
          })()}
        </div>

        {/* Botão de Autenticação Social com Google */}
        <div className="px-6 pt-4">
          <button
            type="button"
            disabled={isLoading || isGoogleLoading}
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center space-x-3 px-4 py-2.5 bg-[#12141a] hover:bg-[#181a22] text-zinc-100 border border-zinc-700/80 hover:border-zinc-500 font-medium text-sm rounded-xl transition-all cursor-pointer active:scale-[0.99] shadow-sm disabled:opacity-60"
          >
            {isGoogleLoading ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#EA4335"
                  d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 14.5s.7 4.8 1.9 7.2l3.7-2.9z"
                />
                <path
                  fill="#34A853"
                  d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 17C3.7 20.7 7.5 23.5 12 23.5z"
                />
              </svg>
            )}
            <span>Continuar com o Google</span>
          </button>

          {/* Divisor Visual */}
          <div className="flex items-center my-4 space-x-3">
            <div className="flex-1 h-px bg-zinc-800"></div>
            <span className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">ou com e-mail</span>
            <div className="flex-1 h-px bg-zinc-800"></div>
          </div>
        </div>

        {/* Tabs de Modo */}
        <div className="flex p-2 mx-6 bg-zinc-900/60 rounded-xl border border-zinc-800/80">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
              mode === 'login' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
              mode === 'signup' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Criar Conta
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('magic-link');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
              mode === 'magic-link' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Link Mágico
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-300">Nome completo</label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Seu nome ou organização"
                  className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-500 transition-colors"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-300">E-mail corporativo ou pessoal</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.email@empresa.com"
                className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-500 transition-colors"
              />
            </div>
          </div>

          {mode !== 'magic-link' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-zinc-300">Senha</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => setMode('magic-link')}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Entrar sem senha?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  minLength={6}
                  className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-500 transition-colors"
                />
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-start space-x-2 p-3 bg-red-950/40 border border-red-800/50 rounded-xl text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-start space-x-2 p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 flex items-center justify-center space-x-2 px-4 py-2.5 bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-sm rounded-xl transition-all disabled:opacity-50 cursor-pointer shadow-sm active:scale-[0.99]"
          >
            {isLoading ? (
              <span className="inline-block w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
            ) : mode === 'login' ? (
              <>
                <span>Acessar FatosBR</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : mode === 'signup' ? (
              <>
                <span>Criar Conta & Iniciar Trial (3 Dias)</span>
                <Sparkles className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>Enviar Link Mágico por E-mail</span>
                <KeyRound className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Rodapé explicativo */}
        <div className="px-6 py-4 bg-zinc-950/80 border-t border-zinc-800/80 text-center">
          <p className="text-[11px] text-zinc-400">
            O FatosBR protege suas fontes e preferências com criptografia de ponta e isolamento RLS.
          </p>
        </div>
      </div>
    </div>
  );
};
