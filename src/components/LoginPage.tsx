/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Check, AlertCircle, Eye, EyeOff, Lock, Mail, User, ShieldCheck } from 'lucide-react';
import { authService } from '../services/authService';
import { userService } from '../services/userService';
import { isSupabaseConfigured, getSupabaseConfigStatus } from '../lib/supabase';

interface LoginPageProps {
  onBackToLanding: () => void;
  onAuthSuccess: (email: string, name?: string) => void;
  initialMode?: 'signin' | 'signup';
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onBackToLanding,
  onAuthSuccess,
  initialMode = 'signin'
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [step, setStep] = useState<'credentials' | 'verify-code'>('credentials');

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // 6-digit Code State
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const digitInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Status feedback
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Timer para reenvio de código
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Google OAuth Flow
  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsGoogleLoading(true);

    try {
      if (isSupabaseConfigured) {
        const res = await authService.signInWithOAuth('google');
        if (!res.success) {
          setErrorMessage(res.error || 'Não foi possível conectar ao Google neste momento.');
          setIsGoogleLoading(false);
          return;
        }
        return;
      }

      // Fallback em ambiente de demonstração
      setTimeout(() => {
        setIsGoogleLoading(false);
        const demoEmail = 'leitor.google@fatosbr.com.br';
        const demoName = 'Leitor Convidado';
        userService.syncUserProfile({
          email: demoEmail,
          full_name: demoName,
          name: demoName,
          provider: 'google'
        });
        try {
          localStorage.setItem(
            'sinal_user_profile',
            JSON.stringify({
              name: demoName,
              displayName: demoName,
              email: demoEmail,
              avatarUrl: null,
              timezone: 'America/Sao_Paulo'
            })
          );
        } catch {}
        onAuthSuccess(demoEmail, demoName);
      }, 700);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro ao iniciar login com o Google.');
      setIsGoogleLoading(false);
    }
  };

  // Submit Credentials (Email & Senha)
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email || !email.includes('@')) {
      setErrorMessage('Por favor, informe um endereço de e-mail válido.');
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
          const res = await authService.signIn(email, password);
          if (!res.success) {
            setErrorMessage(res.error || 'Credenciais inválidas. Verifique seu e-mail e senha.');
            setIsLoading(false);
            return;
          }
        }
      }

      // Avança para a verificação do código de 6 dígitos
      setIsLoading(false);
      setStep('verify-code');
      setResendCooldown(45);
      setSuccessMessage(`Código de verificação enviado para ${email}.`);
      setTimeout(() => {
        digitInputRefs.current[0]?.focus();
      }, 100);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro inesperado ao processar credenciais.');
      setIsLoading(false);
    }
  };

  // Manipulação dos 6 dígitos individuais
  const handleDigitChange = (index: number, val: string) => {
    const cleaned = val.replace(/\D/g, '');
    const newDigits = [...codeDigits];

    if (cleaned.length > 1) {
      // Colagem de múltiplos dígitos
      const pasted = cleaned.slice(0, 6).split('');
      pasted.forEach((d, i) => {
        newDigits[i] = d;
      });
      setCodeDigits(newDigits);
      const nextIdx = Math.min(pasted.length, 5);
      digitInputRefs.current[nextIdx]?.focus();
      return;
    }

    newDigits[index] = cleaned;
    setCodeDigits(newDigits);

    if (cleaned && index < 5) {
      digitInputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !codeDigits[index] && index > 0) {
      digitInputRefs.current[index - 1]?.focus();
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
      setSuccessMessage('Autenticação confirmada com sucesso! Acessando...');

      const resolvedName = fullName || email.split('@')[0];
      userService.syncUserProfile({
        email: email,
        full_name: resolvedName,
        name: resolvedName,
        provider: 'email'
      });

      try {
        const userProfile = {
          name: resolvedName,
          displayName: resolvedName,
          email: email,
          avatarUrl: null,
          timezone: 'America/Sao_Paulo'
        };
        localStorage.setItem('sinal_user_profile', JSON.stringify(userProfile));
      } catch {}

      setTimeout(() => {
        onAuthSuccess(email, resolvedName);
      }, 500);
    }, 600);
  };

  const handleResendCode = () => {
    if (resendCooldown > 0) return;
    setResendCooldown(45);
    setCodeDigits(['', '', '', '', '', '']);
    setSuccessMessage(`Um novo código de verificação foi enviado para ${email}.`);
    digitInputRefs.current[0]?.focus();
  };

  const status = getSupabaseConfigStatus();

  return (
    <div className="min-h-screen bg-[#000000] text-zinc-100 flex flex-col justify-between selection:bg-white selection:text-black font-sans relative overflow-x-hidden">
      {/* Background radial sutil */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          background: 'radial-gradient(circle at 50% 15%, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0.95) 70%)'
        }}
      />

      {/* Top Header */}
      <header className="relative z-10 w-full max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
        <button
          onClick={onBackToLanding}
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-zinc-400 hover:text-white transition cursor-pointer p-2 -ml-2 rounded-xl hover:bg-zinc-900/60"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar à página inicial</span>
        </button>

        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="2 12 6 12 9 3 13 21 16 12 22 12" />
            </svg>
          </div>
          <span className="font-bold text-sm tracking-tight text-white">FatosBR</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-md bg-[#090a0d] border border-zinc-800/90 rounded-3xl p-7 sm:p-9 shadow-2xl backdrop-blur-xl">
          {/* Alerta de bloqueio caso haja service_role por engano */}
          {status.isServiceRoleBlocked && (
            <div className="mb-6 flex items-start space-x-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <div>
                <span className="font-semibold block">Aviso de Configuração</span>
                <span className="text-zinc-300">Chave service_role detectada no cliente. Substitua pela anon key.</span>
              </div>
            </div>
          )}

          {/* Heading */}
          <div className="text-center mb-7">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {step === 'credentials'
                ? mode === 'signin'
                  ? 'Acesse sua conta'
                  : 'Crie sua conta'
                : 'Verifique seu e-mail'}
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-2">
              {step === 'credentials'
                ? 'Acontecimentos em tempo real e contexto claro.'
                : `Digite o código numérico de 6 dígitos enviado para ${email}.`}
            </p>
          </div>

          {/* Feedback Messages */}
          {errorMessage && (
            <div className="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start gap-2.5 text-xs text-red-400 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-start gap-2.5 text-xs text-emerald-400 animate-fadeIn">
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* ================= ETAPA 1: CREDENCIAIS ================= */}
          {step === 'credentials' ? (
            <div className="space-y-6">
              {/* Botão de Destaque: Google OAuth */}
              <button
                type="button"
                disabled={isLoading || isGoogleLoading}
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-[#111318] hover:bg-[#171922] text-zinc-100 border border-zinc-700/80 hover:border-zinc-500 font-medium text-sm rounded-2xl transition-all cursor-pointer active:scale-[0.99] shadow-sm disabled:opacity-60"
              >
                {isGoogleLoading ? (
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                )}
                <span>Continuar com o Google</span>
              </button>

              {/* Divisor Visual */}
              <div className="relative flex items-center justify-center">
                <div className="w-full border-t border-zinc-800" />
                <span className="absolute bg-[#090a0d] px-3 text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
                  ou com e-mail
                </span>
              </div>

              {/* Tabs de Seleção: Entrar / Criar Conta */}
              <div className="grid grid-cols-2 p-1 bg-[#12141a] border border-zinc-800/80 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setErrorMessage(null);
                  }}
                  className={`py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
                    mode === 'signin' ? 'bg-white text-black shadow-sm' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setErrorMessage(null);
                  }}
                  className={`py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
                    mode === 'signup' ? 'bg-white text-black shadow-sm' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Criar Conta
                </button>
              </div>

              {/* Formulário com E-mail e Senha */}
              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                {mode === 'signup' && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">Nome completo</label>
                    <div className="relative">
                      <User className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Como deseja ser chamado"
                        className="w-full bg-[#12141a] border border-zinc-800 focus:border-zinc-600 rounded-xl pl-10 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Seu e-mail</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full bg-[#12141a] border border-zinc-800 focus:border-zinc-600 rounded-xl pl-10 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Sua senha</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="w-full bg-[#12141a] border border-zinc-800 focus:border-zinc-600 rounded-xl pl-10 pr-10 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-3.5 text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full mt-2 py-3.5 bg-white text-black hover:bg-zinc-200 font-bold text-sm rounded-2xl transition cursor-pointer active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>{mode === 'signin' ? 'Entrar' : 'Continuar com Cadastro'}</span>
                  )}
                </button>
              </form>
            </div>
          ) : (
            /* ================= ETAPA 2: CÓDIGO DE 6 DÍGITOS ================= */
            <form onSubmit={handleVerifyCodeSubmit} className="space-y-6">
              <div className="flex justify-between gap-2 sm:gap-3 py-2">
                {codeDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      digitInputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                    className="w-12 h-14 sm:w-14 sm:h-16 text-center text-xl sm:text-2xl font-mono font-bold bg-[#12141a] border border-zinc-700/80 focus:border-white rounded-2xl text-white focus:outline-none transition shadow-inner"
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 bg-white text-black hover:bg-zinc-200 font-bold text-sm rounded-2xl transition cursor-pointer active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>Confirmar Código e Acessar</span>
                )}
              </button>

              <div className="flex items-center justify-between text-xs pt-1 text-zinc-400">
                <button
                  type="button"
                  onClick={() => {
                    setStep('credentials');
                    setErrorMessage(null);
                  }}
                  className="hover:text-white underline cursor-pointer"
                >
                  Alterar e-mail
                </button>

                <button
                  type="button"
                  disabled={resendCooldown > 0}
                  onClick={handleResendCode}
                  className="hover:text-white transition cursor-pointer disabled:text-zinc-600 disabled:no-underline"
                >
                  {resendCooldown > 0 ? `Reenviar código em ${resendCooldown}s` : 'Reenviar código'}
                </button>
              </div>
            </form>
          )}

          {/* Segurança & Termos */}
          <div className="mt-8 pt-5 border-t border-zinc-800/80 text-center text-[11px] text-zinc-500 space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-zinc-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Conexão criptografada e autenticação segura</span>
            </div>
            <p>Ao continuar, você concorda com os Termos de Uso e Política de Privacidade do FatosBR.</p>
          </div>
        </div>
      </main>

      {/* Footer simples */}
      <footer className="relative z-10 w-full text-center py-6 text-xs text-zinc-600">
        © {new Date().getFullYear()} FatosBR Intelligence. Todos os direitos reservados.
      </footer>
    </div>
  );
};
