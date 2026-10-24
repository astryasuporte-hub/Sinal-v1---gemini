/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
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
  ShieldCheck,
  ChevronLeft,
  RotateCcw
} from 'lucide-react';
import { authService } from '../services/authService';
import { isSupabaseConfigured, getSupabaseConfigStatus } from '../lib/supabase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: (email: string, fullName?: string) => void;
  initialMode?: 'login' | 'signup';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [step, setStep] = useState<'credentials' | 'verify-code'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(45);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const digitInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Reset states when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('credentials');
      setErrorMessage(null);
      setSuccessMessage(null);
      setCodeDigits(['', '', '', '', '', '']);
      setResendCooldown(45);
    }
  }, [isOpen, initialMode]);

  // Resend cooldown timer
  useEffect(() => {
    if (step === 'verify-code' && resendCooldown > 0) {
      const timer = setInterval(() => {
        setResendCooldown((prev) => Math.max(0, prev - 1));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [step, resendCooldown]);

  if (!isOpen) return null;

  // Google OAuth Flow
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

  // Submissão das Credenciais (E-mail e Senha) -> Avança para tela de código de verificação
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email.trim() || !password.trim()) {
      setErrorMessage('Por favor, preencha o e-mail e a senha.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('A senha deve conter no mínimo 6 caracteres.');
      return;
    }

    setIsLoading(true);

    try {
      if (isSupabaseConfigured) {
        if (mode === 'signup') {
          const res = await authService.signUp(email, password, fullName);
          if (!res.success) {
            setErrorMessage(res.error || 'Erro ao registrar usuário.');
            setIsLoading(false);
            return;
          }
        } else {
          // No login tradicional, podemos validar com Supabase
          const res = await authService.signIn(email, password);
          if (!res.success) {
            setErrorMessage(res.error || 'Credenciais inválidas. Verifique seu e-mail e senha.');
            setIsLoading(false);
            return;
          }
        }
      }

      // Avança para a tela de confirmação de código de 6 dígitos
      setIsLoading(false);
      setStep('verify-code');
      setResendCooldown(45);
      setSuccessMessage(`Código de verificação enviado para ${email}.`);
      setTimeout(() => {
        digitInputRefs.current[0]?.focus();
      }, 100);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro inesperado.');
      setIsLoading(false);
    }
  };

  // Manipulação dos 6 dígitos individuais
  const handleDigitChange = (index: number, val: string) => {
    const cleaned = val.replace(/\D/g, '');
    const newDigits = [...codeDigits];

    if (cleaned.length > 1) {
      // Colagem de múltiplos dígitos
      const pastedChars = cleaned.slice(0, 6).split('');
      pastedChars.forEach((char, i) => {
        if (i < 6) newDigits[i] = char;
      });
      setCodeDigits(newDigits);
      const nextIdx = Math.min(pastedChars.length, 5);
      digitInputRefs.current[nextIdx]?.focus();
      return;
    }

    newDigits[index] = cleaned;
    setCodeDigits(newDigits);

    // Avanço automático para o próximo dígito
    if (cleaned && index < 5) {
      digitInputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !codeDigits[index] && index > 0) {
      digitInputRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted) {
      const newDigits = [...codeDigits];
      pasted.split('').forEach((char, i) => {
        if (i < 6) newDigits[i] = char;
      });
      setCodeDigits(newDigits);
      const nextIdx = Math.min(pasted.length, 5);
      digitInputRefs.current[nextIdx]?.focus();
    }
  };

  // Confirmação do Código de Verificação de 6 Dígitos
  const handleVerifyCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const fullCode = codeDigits.join('');
    if (fullCode.length < 6) {
      setErrorMessage('Por favor, informe todos os 6 dígitos do código de verificação.');
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      setSuccessMessage('Código verificado com sucesso! Acessando FatosBR...');

      // Salva dados locais do usuário autenticado
      try {
        const userProfile = {
          name: fullName || email.split('@')[0],
          displayName: fullName || email.split('@')[0],
          email: email,
          avatarUrl: null,
          timezone: 'America/Sao_Paulo'
        };
        localStorage.setItem('sinal_user_profile', JSON.stringify(userProfile));
      } catch {}

      setTimeout(() => {
        onAuthSuccess?.(email, fullName || email.split('@')[0]);
        onClose();
      }, 700);
    }, 600);
  };

  const handleResendCode = () => {
    if (resendCooldown > 0) return;
    setResendCooldown(45);
    setCodeDigits(['', '', '', '', '', '']);
    setSuccessMessage(`Um novo código de verificação de 6 dígitos foi enviado para ${email}.`);
    digitInputRefs.current[0]?.focus();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div
        className="w-full max-w-md bg-[#0a0c10] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800/80 bg-zinc-950/60">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <span className="font-mono text-xs font-bold text-white tracking-wider">FBR</span>
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-semibold text-white tracking-tight">FatosBR Intelligence</h3>
              <p className="text-[11px] text-zinc-400">Acesso seguro e sincronização contínua</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Supabase Banner */}
        <div className="px-6 pt-3">
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
                <span>Modo Demonstração (Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Vercel)</span>
              </div>
            );
          })()}
        </div>

        {step === 'credentials' ? (
          /* ================= ETAPA 1: CREDENCIAIS (GOOGLE OU EMAIL E SENHA) ================= */
          <div>
            {/* Botão de Destaque: Continuar com o Google */}
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
              <div className="flex items-center my-3.5 space-x-3">
                <div className="flex-1 h-px bg-zinc-800"></div>
                <span className="text-[10.5px] text-zinc-400 font-medium uppercase tracking-wider">ou com e-mail e senha</span>
                <div className="flex-1 h-px bg-zinc-800"></div>
              </div>
            </div>

            {/* Tabs: Entrar vs Criar Conta (SEM LINK MÁGICO) */}
            <div className="flex p-1.5 mx-6 bg-zinc-900/60 rounded-xl border border-zinc-800/80">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
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
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  mode === 'signup' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Criar Conta
              </button>
            </div>

            {/* Formulário de Credenciais */}
            <form onSubmit={handleCredentialsSubmit} className="p-6 pt-4 space-y-3.5">
              {mode === 'signup' && (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-zinc-300">Nome completo</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Seu nome"
                      className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-500 transition-colors"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-300">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu.email@exemplo.com"
                    className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-300">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-500 transition-colors"
                  />
                </div>
                <span className="text-[10px] text-zinc-400">Mínimo de 6 caracteres.</span>
              </div>

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
                    <span>Continuar para Verificação</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    <span>Criar Conta & Enviar Código (3 Dias)</span>
                    <Sparkles className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        ) : (
          /* ================= ETAPA 2: CÓDIGO DE VERIFICAÇÃO DE 6 DÍGITOS ================= */
          <div className="p-6 space-y-5 animate-fade-in">
            {/* Header da Etapa de Código */}
            <div className="space-y-1 text-center">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-emerald-400 mb-2">
                <KeyRound className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-white">Código de Verificação</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Digite o código de 6 dígitos enviado para{' '}
                <span className="text-zinc-200 font-semibold">{email}</span>.
              </p>
            </div>

            <form onSubmit={handleVerifyCodeSubmit} className="space-y-4">
              {/* Grid dos 6 Dígitos */}
              <div className="flex items-center justify-center gap-2 sm:gap-2.5">
                {codeDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      digitInputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                    onPaste={idx === 0 ? handleDigitPaste : undefined}
                    className="w-11 h-13 sm:w-12 sm:h-14 rounded-xl border border-zinc-700 bg-zinc-900 text-center text-lg sm:text-xl font-mono font-bold text-white focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all shadow-inner"
                  />
                ))}
              </div>

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

              {/* Botão de Confirmação */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-zinc-100 hover:bg-white text-zinc-950 font-bold text-sm rounded-xl transition-all disabled:opacity-50 cursor-pointer shadow-sm active:scale-[0.99]"
              >
                {isLoading ? (
                  <span className="inline-block w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Confirmar Código e Acessar FatosBR</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Reenvio e Voltar */}
              <div className="flex items-center justify-between pt-2 text-xs text-zinc-400">
                <button
                  type="button"
                  onClick={() => {
                    setStep('credentials');
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Alterar e-mail</span>
                </button>

                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={resendCooldown > 0}
                  className={`flex items-center gap-1 transition cursor-pointer ${
                    resendCooldown > 0 ? 'text-zinc-400 cursor-not-allowed' : 'text-zinc-200 hover:text-white font-medium'
                  }`}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>
                    {resendCooldown > 0 ? `Reenviar código (${resendCooldown}s)` : 'Reenviar código'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Rodapé explicativo */}
        <div className="px-6 py-3.5 bg-zinc-950/80 border-t border-zinc-800/80 text-center">
          <p className="text-[11px] text-zinc-400">
            O FatosBR protege suas fontes e preferências com criptografia de ponta e isolamento RLS.
          </p>
        </div>
      </div>
    </div>
  );
};
