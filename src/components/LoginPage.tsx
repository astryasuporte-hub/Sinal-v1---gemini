/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
  ShieldCheck,
  KeyRound,
  RotateCcw,
} from 'lucide-react';
import { FatosBrLogo } from './FatosBrLogo';
import { authService, validatePasswordRequirements } from '../services/authService';
import { isSupabaseConfigured, getSupabaseConfigStatus } from '../lib/supabase';
import { LegalCenterModal } from './LegalCenterModal';

export type AuthView = 'signin' | 'signup' | 'recovery' | 'otp' | 'new-password';
export type OtpPurpose = 'email' | 'signup' | 'recovery';

interface LoginPageProps {
  onBackToLanding: () => void;
  onAuthSuccess: (email: string, name?: string) => void;
  onRecoveryModeChange?: (isRecovering: boolean) => void;
  initialMode?: 'signin' | 'signup' | 'recovery';
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onBackToLanding,
  onAuthSuccess,
  onRecoveryModeChange,
  initialMode = 'signin',
}) => {
  const [view, setView] = useState<AuthView>(initialMode);
  const [signinMethod, setSigninMethod] = useState<'password' | 'otp'>('password');
  const [otpPurpose, setOtpPurpose] = useState<OtpPurpose>('email');
  const [returnViewAfterOtp, setReturnViewAfterOtp] = useState<'signin' | 'signup' | 'recovery'>('signin');

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Legal modal
  const [legalTab, setLegalTab] = useState<'terms' | 'lgpd' | null>(null);

  // 6-digit OTP inputs (usuário digita os 6 dígitos enviados pelo Supabase)
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const digitInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Locks & Status feedback
  const submitLockRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const passwordReqs = validatePasswordRequirements(password);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const resetFeedback = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const switchView = (nextView: AuthView, nextSigninMethod?: 'password' | 'otp') => {
    resetFeedback();
    if (nextView !== 'otp' && nextView !== 'new-password') {
      onRecoveryModeChange?.(false);
    }
    if (nextSigninMethod) setSigninMethod(nextSigninMethod);
    setView(nextView);
  };

  const enterOtpStep = (purpose: OtpPurpose, returnTo: 'signin' | 'signup' | 'recovery', feedbackMsg: string) => {
    setOtpPurpose(purpose);
    setReturnViewAfterOtp(returnTo);
    setCodeDigits(['', '', '', '', '', '']);
    setResendCooldown(60);
    setSuccessMessage(feedbackMsg);
    setErrorMessage(null);
    setView('otp');
    setTimeout(() => {
      digitInputRefs.current[0]?.focus();
    }, 100);
  };

  // Google OAuth Oficial
  const handleGoogleSignIn = async () => {
    if (submitLockRef.current || isLoading || isGoogleLoading) return;
    resetFeedback();

    if (!isSupabaseConfigured) {
      setErrorMessage('Autenticação com Google indisponível neste ambiente no momento.');
      return;
    }

    submitLockRef.current = true;
    setIsGoogleLoading(true);
    try {
      const res = await authService.signInWithGoogle();
      if (!res.success) {
        setErrorMessage(res.error || 'Não foi possível conectar ao Google neste momento.');
        setIsGoogleLoading(false);
        submitLockRef.current = false;
      }
    } catch (err) {
      setErrorMessage(authService.translateError(err, 'oauth').message);
      setIsGoogleLoading(false);
      submitLockRef.current = false;
    }
  };

  // Login com e-mail + senha OU disparo de login com código OTP
  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    resetFeedback();

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Informe um endereço de e-mail válido.');
      return;
    }

    if (signinMethod === 'otp') {
      submitLockRef.current = true;
      setIsLoading(true);
      try {
        const res = await authService.signInWithEmailOtp(cleanEmail);
        if (!res.success) {
          setErrorMessage(res.error || 'Não foi possível enviar o código para seu e-mail.');
          return;
        }
        enterOtpStep(
          'email',
          'signin',
          'Código numérico enviado para seu e-mail. Verifique sua caixa de entrada e spam.'
        );
      } finally {
        setIsLoading(false);
        submitLockRef.current = false;
      }
      return;
    }

    if (!password) {
      setErrorMessage('Informe sua senha para entrar.');
      return;
    }

    submitLockRef.current = true;
    setIsLoading(true);
    try {
      const res = await authService.signInWithPassword(cleanEmail, password);
      if (!res.success || !res.data?.user) {
        setErrorMessage(res.error || 'E-mail ou senha incorretos.');
        return;
      }

      const metaName =
        (res.data.user.user_metadata?.full_name as string | undefined) ||
        (res.data.user.user_metadata?.name as string | undefined) ||
        cleanEmail.split('@')[0];

      setSuccessMessage('Acesso confirmado. Carregando sua experiência...');
      onAuthSuccess(res.data.user.email || cleanEmail, metaName);
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  // Cadastro com nome, e-mail, senha, confirmação e termos
  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    resetFeedback();

    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2) {
      setErrorMessage('Informe seu nome completo para criar sua conta.');
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Informe um endereço de e-mail válido.');
      return;
    }
    if (!passwordReqs.isValid) {
      setErrorMessage('Sua senha deve ter no mínimo 8 caracteres, incluindo letras e números.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('A confirmação de senha não confere.');
      return;
    }
    if (!acceptedTerms) {
      setErrorMessage('Você precisa aceitar os Termos de Uso e a Política de Privacidade para continuar.');
      return;
    }

    submitLockRef.current = true;
    setIsLoading(true);
    try {
      const res = await authService.signUpWithPassword(cleanEmail, password, cleanName);
      if (!res.success) {
        setErrorMessage(res.error || 'Não foi possível criar sua conta agora.');
        return;
      }

      if (res.data?.needsEmailConfirmation) {
        enterOtpStep(
          'signup',
          'signup',
          'Enviamos um código de 6 dígitos para confirmar seu cadastro. Verifique sua caixa de entrada e spam.'
        );
        return;
      }

      setSuccessMessage('Conta criada com sucesso! Preparando seu acesso...');
      onAuthSuccess(res.data?.user?.email || cleanEmail, cleanName);
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  // Recuperação de senha: envia OTP numérico
  const handleRecoveryRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    resetFeedback();

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Informe o e-mail cadastrado para recuperar sua senha.');
      return;
    }

    submitLockRef.current = true;
    setIsLoading(true);
    try {
      onRecoveryModeChange?.(true);
      const res = await authService.requestPasswordRecoveryOtp(cleanEmail);
      if (!res.success) {
        onRecoveryModeChange?.(false);
        setErrorMessage(res.error || 'Não foi possível enviar o código de recuperação.');
        return;
      }

      enterOtpStep(
        'recovery',
        'recovery',
        'Código de recuperação enviado para seu e-mail. Verifique sua caixa de entrada e spam.'
      );
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  // Manipulação dos 6 dígitos do OTP
  const handleDigitChange = (index: number, val: string) => {
    const cleaned = val.replace(/\D/g, '');
    const newDigits = [...codeDigits];

    if (cleaned.length > 1) {
      const pasted = cleaned.slice(0, 6).split('');
      for (let i = 0; i < 6; i++) {
        newDigits[i] = pasted[i] || '';
      }
      setCodeDigits(newDigits);
      const nextIdx = Math.min(pasted.length - 1, 5);
      digitInputRefs.current[Math.max(0, nextIdx)]?.focus();
      return;
    }

    newDigits[index] = cleaned;
    setCodeDigits(newDigits);

    if (cleaned && index < 5) {
      digitInputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (codeDigits[index]) {
        const nextDigits = [...codeDigits];
        nextDigits[index] = '';
        setCodeDigits(nextDigits);
        e.preventDefault();
      } else if (index > 0) {
        const nextDigits = [...codeDigits];
        nextDigits[index - 1] = '';
        setCodeDigits(nextDigits);
        digitInputRefs.current[index - 1]?.focus();
        e.preventDefault();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      digitInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      digitInputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const nextDigits = ['', '', '', '', '', ''];
    pasted.split('').forEach((char, i) => {
      if (i < 6) nextDigits[i] = char;
    });
    setCodeDigits(nextDigits);
    const nextIdx = Math.min(pasted.length - 1, 5);
    digitInputRefs.current[Math.max(0, nextIdx)]?.focus();
  };

  // Confirmação do código OTP oficial no Supabase Auth
  const handleVerifyOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    resetFeedback();

    const fullCode = codeDigits.join('').trim();
    if (fullCode.length !== 6) {
      setErrorMessage('Informe os 6 dígitos do código recebido por e-mail.');
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    submitLockRef.current = true;
    setIsLoading(true);
    try {
      const res = await authService.verifyOtp(cleanEmail, fullCode, otpPurpose);
      if (!res.success || !res.data?.session || !res.data?.user) {
        setErrorMessage(res.error || 'Código inválido, expirado ou já utilizado. Solicite um novo código.');
        return;
      }

      if (otpPurpose === 'recovery') {
        onRecoveryModeChange?.(true);
        setPassword('');
        setConfirmPassword('');
        setShowPassword(false);
        setShowConfirmPassword(false);
        setSuccessMessage('Código validado! Defina sua nova senha abaixo.');
        setView('new-password');
        return;
      }

      const resolvedName =
        (res.data.user.user_metadata?.full_name as string | undefined) ||
        fullName.trim() ||
        cleanEmail.split('@')[0];

      setSuccessMessage('Código confirmado com sucesso! Acessando a FatosBR...');
      onAuthSuccess(res.data.user.email || cleanEmail, resolvedName);
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  // Reenvio oficial via Supabase Auth
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || submitLockRef.current || isLoading) return;
    resetFeedback();

    const cleanEmail = email.trim().toLowerCase();
    submitLockRef.current = true;
    setIsLoading(true);
    setCodeDigits(['', '', '', '', '', '']);

    try {
      const res =
        otpPurpose === 'signup'
          ? await authService.resendSignupOtp(cleanEmail)
          : otpPurpose === 'recovery'
          ? await authService.requestPasswordRecoveryOtp(cleanEmail)
          : await authService.signInWithEmailOtp(cleanEmail);

      if (!res.success) {
        setErrorMessage(res.error || 'Não foi possível reenviar o código agora. Tente em instantes.');
        return;
      }

      setResendCooldown(60);
      setSuccessMessage('Novo código enviado para seu e-mail. Verifique sua caixa de entrada e spam.');
      setTimeout(() => {
        digitInputRefs.current[0]?.focus();
      }, 80);
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  // Definir nova senha após validar OTP de recuperação
  const handleUpdatePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    resetFeedback();

    if (!passwordReqs.isValid) {
      setErrorMessage('A nova senha deve ter no mínimo 8 caracteres, incluindo letras e números.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('A confirmação da nova senha não confere.');
      return;
    }

    submitLockRef.current = true;
    setIsLoading(true);
    try {
      const res = await authService.updatePassword(password);
      if (!res.success) {
        setErrorMessage(res.error || 'Não foi possível atualizar sua senha agora.');
        return;
      }

      onRecoveryModeChange?.(false);
      const cleanEmail = res.data?.user?.email || email.trim().toLowerCase();
      const resolvedName =
        (res.data?.user?.user_metadata?.full_name as string | undefined) || cleanEmail.split('@')[0];

      setSuccessMessage('Senha atualizada com sucesso! Entrando na sua conta...');
      onAuthSuccess(cleanEmail, resolvedName);
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  const status = getSupabaseConfigStatus();
  const isOtpComplete = codeDigits.every((d) => /^\d$/.test(d));

  const headerCopy: Record<AuthView, { title: string; subtitle: string }> = {
    signin:
      signinMethod === 'otp'
        ? {
            title: 'Entrar com código.',
            subtitle: 'Receba um código numérico de 6 dígitos no seu e-mail para entrar sem senha.',
          }
        : {
            title: 'Bem-vindo de volta.',
            subtitle: 'Entre na sua conta para acompanhar o que realmente importa.',
          },
    signup: {
      title: 'Comece com o que importa.',
      subtitle: 'Crie sua conta e tenha uma experiência de informação personalizada.',
    },
    recovery: {
      title: 'Recuperar acesso.',
      subtitle: 'Informe seu e-mail cadastrado para receber o código numérico de 6 dígitos.',
    },
    otp: {
      title: 'Verifique seu e-mail.',
      subtitle: '',
    },
    'new-password': {
      title: 'Defina sua nova senha.',
      subtitle: 'Escolha uma nova senha segura para proteger o acesso à sua conta FatosBR.',
    },
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 flex flex-col justify-between selection:bg-white selection:text-black font-sans relative overflow-x-hidden">
      {/* Background radial minimalista */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          background: 'radial-gradient(circle at 50% 10%, rgba(255,255,255,0.05) 0%, rgba(5,5,5,0.98) 68%)',
        }}
      />

      {/* Top Header */}
      <header className="relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            onRecoveryModeChange?.(false);
            onBackToLanding();
          }}
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-zinc-400 hover:text-white transition cursor-pointer px-2.5 py-2 -ml-2 rounded-xl hover:bg-zinc-900/70 min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>Voltar</span>
        </button>

        <FatosBrLogo size="sm" variant="compact" glow={false} />
      </header>

      {/* Main Container */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-3.5 sm:px-6 py-4 sm:py-10">
        <div className="w-full max-w-[440px] bg-[#111216] border border-zinc-800/90 rounded-3xl p-5 sm:p-8 shadow-2xl">
          {/* Bloqueio preventivo se service_role for detectada no cliente */}
          {status.isServiceRoleBlocked && (
            <div className="mb-5 flex items-start space-x-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <div>
                <span className="font-semibold block">Aviso de Configuração</span>
                <span className="text-zinc-300">Chave service_role detectada no cliente. Utilize exclusivamente a anon key.</span>
              </div>
            </div>
          )}

          {/* Heading */}
          <div className="text-center mb-6">
            {view === 'otp' && (
              <div className="w-12 h-12 rounded-2xl bg-[#050505] border border-zinc-800 flex items-center justify-center mx-auto mb-4 text-white">
                <Mail className="w-5 h-5 text-emerald-400" />
              </div>
            )}
            {view === 'recovery' && (
              <div className="w-12 h-12 rounded-2xl bg-[#050505] border border-zinc-800 flex items-center justify-center mx-auto mb-4 text-white">
                <KeyRound className="w-5 h-5 text-zinc-200" />
              </div>
            )}
            <h1 className="text-2xl sm:text-[26px] font-bold text-white tracking-tight leading-tight">
              {headerCopy[view].title}
            </h1>

            {view === 'otp' ? (
              <div className="text-xs sm:text-sm text-zinc-400 mt-2.5 space-y-1 leading-relaxed">
                <p>
                  Enviamos um código numérico de 6 dígitos para{' '}
                  <span className="text-white font-semibold break-all">{email.trim().toLowerCase()}</span>.
                </p>
                <p className="text-zinc-500 text-xs">Verifique sua caixa de entrada e spam.</p>
              </div>
            ) : (
              <p className="text-xs sm:text-sm text-zinc-400 mt-2 leading-relaxed">
                {headerCopy[view].subtitle}
              </p>
            )}
          </div>

          {/* Feedback Banners */}
          {errorMessage && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start gap-2.5 text-xs text-red-300 leading-relaxed"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div
              role="status"
              className="mb-5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-start gap-2.5 text-xs text-emerald-300 leading-relaxed"
            >
              <Check className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* ================= 1. TELA ENTRAR ================= */}
          {view === 'signin' && (
            <div className="space-y-5">
              <form onSubmit={handleSignInSubmit} className="space-y-4">
                <div>
                  <label htmlFor="login-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    E-mail
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full min-h-[48px] bg-[#050505] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                    />
                  </div>
                </div>

                {signinMethod === 'password' && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="login-password" className="block text-xs font-medium text-zinc-300">
                        Senha
                      </label>
                      <button
                        type="button"
                        onClick={() => switchView('recovery')}
                        className="text-xs font-medium text-zinc-400 hover:text-white transition cursor-pointer py-0.5"
                      >
                        Esqueci minha senha
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5 pointer-events-none" />
                      <input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Digite sua senha"
                        className="w-full min-h-[48px] bg-[#050505] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-11 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                        className="absolute right-2 top-1.5 w-9 h-9 flex items-center justify-center text-zinc-500 hover:text-zinc-200 transition cursor-pointer rounded-lg"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || isGoogleLoading}
                  className="w-full min-h-[48px] py-3 bg-white text-black hover:bg-zinc-200 font-bold text-sm rounded-2xl transition cursor-pointer active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>{signinMethod === 'otp' ? 'Enviar código por e-mail' : 'Entrar'}</span>
                  )}
                </button>
              </form>

              {/* Alternância limpa entre senha e código OTP por e-mail */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => {
                  resetFeedback();
                  setSigninMethod(signinMethod === 'password' ? 'otp' : 'password');
                }}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#050505] border border-zinc-800 hover:border-zinc-600 text-xs font-semibold text-zinc-200 hover:text-white transition cursor-pointer flex items-center justify-center gap-2"
              >
                {signinMethod === 'password' ? (
                  <>
                    <Mail className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Entrar com código por e-mail</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Voltar para entrar com senha</span>
                  </>
                )}
              </button>

              {isSupabaseConfigured && (
                <>
                  <div className="relative flex items-center justify-center">
                    <div className="w-full border-t border-zinc-800" />
                    <span className="absolute bg-[#111216] px-3 text-[11px] text-zinc-500">ou</span>
                  </div>

                  <button
                    type="button"
                    disabled={isLoading || isGoogleLoading}
                    onClick={handleGoogleSignIn}
                    className="w-full min-h-[48px] flex items-center justify-center gap-3 px-4 py-3 bg-[#050505] hover:bg-zinc-900 text-zinc-100 border border-zinc-800 hover:border-zinc-600 font-medium text-sm rounded-2xl transition cursor-pointer active:scale-[0.99] disabled:opacity-60"
                  >
                    {isGoogleLoading ? (
                      <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
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
                    <span>Continuar com Google</span>
                  </button>
                </>
              )}

              <div className="pt-2 text-center text-xs text-zinc-400">
                <span>Ainda não tem conta? </span>
                <button
                  type="button"
                  onClick={() => switchView('signup')}
                  className="text-white font-semibold hover:underline cursor-pointer py-1"
                >
                  Criar uma conta
                </button>
              </div>
            </div>
          )}

          {/* ================= 2. TELA CRIAR CONTA ================= */}
          {view === 'signup' && (
            <div className="space-y-5">
              <form onSubmit={handleSignUpSubmit} className="space-y-4">
                <div>
                  <label htmlFor="signup-name" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Nome completo
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      id="signup-name"
                      type="text"
                      autoComplete="name"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Como deseja ser chamado"
                      className="w-full min-h-[48px] bg-[#050505] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="signup-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    E-mail
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      id="signup-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full min-h-[48px] bg-[#050505] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="signup-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Senha
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Crie uma senha forte"
                      className="w-full min-h-[48px] bg-[#050505] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-11 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-2 top-1.5 w-9 h-9 flex items-center justify-center text-zinc-500 hover:text-zinc-200 transition cursor-pointer rounded-lg"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Indicador claro dos requisitos de senha */}
                  <div className="mt-2.5 grid grid-cols-1 gap-1.5 text-[11px] bg-[#050505]/70 border border-zinc-800/80 rounded-xl p-2.5">
                    <div className={`flex items-center gap-2 ${passwordReqs.minLength ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${passwordReqs.minLength ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                      <span>Mínimo de 8 caracteres</span>
                    </div>
                    <div className={`flex items-center gap-2 ${passwordReqs.hasLetter ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${passwordReqs.hasLetter ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                      <span>Pelo menos uma letra</span>
                    </div>
                    <div className={`flex items-center gap-2 ${passwordReqs.hasNumber ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${passwordReqs.hasNumber ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                      <span>Pelo menos um número</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="signup-confirm-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Confirmar senha
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      id="signup-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repita a senha"
                      className="w-full min-h-[48px] bg-[#050505] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-11 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      aria-label={showConfirmPassword ? 'Ocultar confirmação' : 'Mostrar confirmação'}
                      className="absolute right-2 top-1.5 w-9 h-9 flex items-center justify-center text-zinc-500 hover:text-zinc-200 transition cursor-pointer rounded-lg"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Aceite explícito de Termos e Política de Privacidade */}
                <label className="flex items-start gap-2.5 text-xs text-zinc-400 cursor-pointer select-none pt-1">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-zinc-700 bg-[#050505] accent-emerald-500 cursor-pointer shrink-0"
                  />
                  <span className="leading-relaxed">
                    Concordo com os{' '}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setLegalTab('terms');
                      }}
                      className="text-zinc-200 underline hover:text-white cursor-pointer"
                    >
                      Termos de Uso
                    </button>{' '}
                    e com a{' '}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setLegalTab('lgpd');
                      }}
                      className="text-zinc-200 underline hover:text-white cursor-pointer"
                    >
                      Política de Privacidade
                    </button>{' '}
                    da FatosBR.
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isLoading || isGoogleLoading}
                  className="w-full min-h-[48px] py-3 bg-white text-black hover:bg-zinc-200 font-bold text-sm rounded-2xl transition cursor-pointer active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>Criar minha conta</span>
                  )}
                </button>
              </form>

              <div className="pt-1 text-center text-xs text-zinc-400">
                <span>Já possui uma conta? </span>
                <button
                  type="button"
                  onClick={() => switchView('signin', 'password')}
                  className="text-white font-semibold hover:underline cursor-pointer py-1"
                >
                  Entrar
                </button>
              </div>
            </div>
          )}

          {/* ================= 3. TELA RECUPERAR ACESSO ================= */}
          {view === 'recovery' && (
            <div className="space-y-5">
              <form onSubmit={handleRecoveryRequestSubmit} className="space-y-4">
                <div>
                  <label htmlFor="recovery-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    E-mail cadastrado
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      id="recovery-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full min-h-[48px] bg-[#050505] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full min-h-[48px] py-3 bg-white text-black hover:bg-zinc-200 font-bold text-sm rounded-2xl transition cursor-pointer active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>Enviar código de recuperação</span>
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={() => switchView('signin', 'password')}
                className="w-full min-h-[44px] py-2 text-xs text-zinc-400 hover:text-white transition cursor-pointer"
              >
                Voltar para Entrar
              </button>
            </div>
          )}

          {/* ================= 4. TELA VERIFICAÇÃO OTP DE 6 DÍGITOS ================= */}
          {view === 'otp' && (
            <form onSubmit={handleVerifyOtpSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-zinc-400 text-center mb-3">
                  Digite o código de 6 dígitos
                </label>
                <div className="grid grid-cols-6 gap-1.5 sm:gap-2.5" onPaste={handleDigitPaste}>
                  {codeDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        digitInputRefs.current[idx] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                      maxLength={1}
                      value={digit}
                      aria-label={`Dígito ${idx + 1} de 6`}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                      className="w-full h-12 sm:h-14 text-center text-lg sm:text-2xl font-mono font-bold bg-[#050505] border border-zinc-800 focus:border-white focus:ring-1 focus:ring-white/30 rounded-xl text-white focus:outline-none transition"
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || !isOtpComplete}
                className="w-full min-h-[48px] py-3 bg-white text-black hover:bg-zinc-200 font-bold text-sm rounded-2xl transition cursor-pointer active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>Confirmar código</span>
                )}
              </button>

              <div className="flex items-center justify-between gap-2 text-xs pt-1 text-zinc-400">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    setCodeDigits(['', '', '', '', '', '']);
                    switchView(returnViewAfterOtp);
                  }}
                  className="hover:text-white transition cursor-pointer py-2 min-h-[44px]"
                >
                  Alterar e-mail
                </button>

                <button
                  type="button"
                  disabled={resendCooldown > 0 || isLoading}
                  onClick={handleResendOtp}
                  className={`inline-flex items-center gap-1.5 transition py-2 min-h-[44px] ${
                    resendCooldown > 0 || isLoading
                      ? 'text-zinc-500 cursor-not-allowed'
                      : 'text-zinc-200 hover:text-white font-semibold cursor-pointer'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{resendCooldown > 0 ? `Reenviar código (${resendCooldown}s)` : 'Reenviar código'}</span>
                </button>
              </div>
            </form>
          )}

          {/* ================= 5. TELA DEFINIR NOVA SENHA (APÓS OTP RECOVERY) ================= */}
          {view === 'new-password' && (
            <form onSubmit={handleUpdatePasswordSubmit} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Nova senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full min-h-[48px] bg-[#050505] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-11 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-2 top-1.5 w-9 h-9 flex items-center justify-center text-zinc-500 hover:text-zinc-200 transition cursor-pointer rounded-lg"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="mt-2.5 grid grid-cols-1 gap-1.5 text-[11px] bg-[#050505]/70 border border-zinc-800/80 rounded-xl p-2.5">
                  <div className={`flex items-center gap-2 ${passwordReqs.minLength ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${passwordReqs.minLength ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                    <span>Mínimo de 8 caracteres</span>
                  </div>
                  <div className={`flex items-center gap-2 ${passwordReqs.hasLetter ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${passwordReqs.hasLetter ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                    <span>Pelo menos uma letra</span>
                  </div>
                  <div className={`flex items-center gap-2 ${passwordReqs.hasNumber ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${passwordReqs.hasNumber ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                    <span>Pelo menos um número</span>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="confirm-new-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Confirmar nova senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    id="confirm-new-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    className="w-full min-h-[48px] bg-[#050505] border border-zinc-800 focus:border-zinc-500 rounded-xl pl-10 pr-11 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Ocultar confirmação' : 'Mostrar confirmação'}
                    className="absolute right-2 top-1.5 w-9 h-9 flex items-center justify-center text-zinc-500 hover:text-zinc-200 transition cursor-pointer rounded-lg"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full min-h-[48px] py-3 bg-white text-black hover:bg-zinc-200 font-bold text-sm rounded-2xl transition cursor-pointer active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>Salvar nova senha</span>
                )}
              </button>
            </form>
          )}

          {/* Rodapé de Segurança */}
          <div className="mt-7 pt-5 border-t border-zinc-800/80 text-center text-[11px] text-zinc-500 space-y-1.5">
            <div className="flex items-center justify-center gap-1.5 text-zinc-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Autenticação protegida por Supabase Auth e código numérico único</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 w-full text-center py-5 text-xs text-zinc-600">
        © {new Date().getFullYear()} FatosBR. Todos os direitos reservados.
      </footer>

      {legalTab && (
        <LegalCenterModal
          isOpen={Boolean(legalTab)}
          onClose={() => setLegalTab(null)}
          initialTab={legalTab}
        />
      )}
    </div>
  );
};
