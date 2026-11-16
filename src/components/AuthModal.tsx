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
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  RotateCcw,
  Eye,
  EyeOff,
} from 'lucide-react';
import { FatosBrLogo } from './FatosBrLogo';
import { authService, validatePasswordRequirements } from '../services/authService';
import { isSupabaseConfigured, getSupabaseConfigStatus } from '../lib/supabase';
import { LegalCenterModal } from './LegalCenterModal';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: (email: string, fullName?: string) => void;
  onRecoveryModeChange?: (isRecovering: boolean) => void;
  initialMode?: 'login' | 'signup';
}

type ModalView = 'login' | 'signup' | 'recovery' | 'otp' | 'new-password';
type OtpPurpose = 'email' | 'signup' | 'recovery';

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  onRecoveryModeChange,
  initialMode = 'login',
}) => {
  const [view, setView] = useState<ModalView>(initialMode);
  const [signinMethod, setSigninMethod] = useState<'password' | 'otp'>('password');
  const [otpPurpose, setOtpPurpose] = useState<OtpPurpose>('email');
  const [returnView, setReturnView] = useState<'login' | 'signup' | 'recovery'>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [legalTab, setLegalTab] = useState<'terms' | 'lgpd' | null>(null);

  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const submitLockRef = useRef(false);
  const digitInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const passwordReqs = validatePasswordRequirements(password);

  useEffect(() => {
    if (isOpen) {
      setView(initialMode);
      setSigninMethod('password');
      setErrorMessage(null);
      setSuccessMessage(null);
      setCodeDigits(['', '', '', '', '', '']);
      setResendCooldown(0);
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  if (!isOpen) return null;

  const resetMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const enterOtp = (purpose: OtpPurpose, backTo: 'login' | 'signup' | 'recovery', message: string) => {
    setOtpPurpose(purpose);
    setReturnView(backTo);
    setCodeDigits(['', '', '', '', '', '']);
    setResendCooldown(60);
    setSuccessMessage(message);
    setErrorMessage(null);
    setView('otp');
    setTimeout(() => digitInputRefs.current[0]?.focus(), 100);
  };

  const handleGoogleSignIn = async () => {
    if (submitLockRef.current || isLoading || isGoogleLoading) return;
    resetMessages();

    if (!isSupabaseConfigured) {
      setErrorMessage('Login com Google indisponível neste ambiente no momento.');
      return;
    }

    submitLockRef.current = true;
    setIsGoogleLoading(true);
    try {
      const res = await authService.signInWithGoogle();
      if (!res.success) {
        setErrorMessage(res.error || 'Falha ao conectar com o Google.');
        setIsGoogleLoading(false);
        submitLockRef.current = false;
      } else {
        setSuccessMessage('Redirecionando para o Google...');
      }
    } catch (err) {
      setErrorMessage(authService.translateError(err, 'oauth').message);
      setIsGoogleLoading(false);
      submitLockRef.current = false;
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    resetMessages();

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Informe um e-mail válido.');
      return;
    }

    if (signinMethod === 'otp') {
      submitLockRef.current = true;
      setIsLoading(true);
      try {
        const res = await authService.signInWithEmailOtp(cleanEmail);
        if (!res.success) {
          setErrorMessage(res.error || 'Não foi possível enviar o código.');
          return;
        }
        enterOtp('email', 'login', 'Código enviado para seu e-mail. Verifique sua caixa de entrada e spam.');
      } finally {
        setIsLoading(false);
        submitLockRef.current = false;
      }
      return;
    }

    if (!password) {
      setErrorMessage('Informe sua senha.');
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
      const name =
        (res.data.user.user_metadata?.full_name as string | undefined) || cleanEmail.split('@')[0];
      onAuthSuccess?.(res.data.user.email || cleanEmail, name);
      onClose();
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    resetMessages();

    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2) {
      setErrorMessage('Informe seu nome completo.');
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Informe um e-mail válido.');
      return;
    }
    if (!passwordReqs.isValid) {
      setErrorMessage('A senha deve ter no mínimo 8 caracteres, com letras e números.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('A confirmação de senha não confere.');
      return;
    }
    if (!acceptedTerms) {
      setErrorMessage('Aceite os Termos de Uso e a Política de Privacidade para criar sua conta.');
      return;
    }

    submitLockRef.current = true;
    setIsLoading(true);
    try {
      const res = await authService.signUpWithPassword(cleanEmail, password, cleanName);
      if (!res.success) {
        setErrorMessage(res.error || 'Não foi possível criar sua conta.');
        return;
      }

      if (res.data?.needsEmailConfirmation) {
        enterOtp('signup', 'signup', 'Código de ativação enviado para seu e-mail. Verifique sua caixa de entrada e spam.');
        return;
      }

      onAuthSuccess?.(res.data?.user?.email || cleanEmail, cleanName);
      onClose();
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    resetMessages();

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Informe um e-mail válido.');
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
      enterOtp('recovery', 'recovery', 'Código de recuperação enviado para seu e-mail. Verifique sua caixa de entrada e spam.');
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

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
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newDigits = ['', '', '', '', '', ''];
    pasted.split('').forEach((char, i) => {
      if (i < 6) newDigits[i] = char;
    });
    setCodeDigits(newDigits);
    const nextIdx = Math.min(pasted.length - 1, 5);
    digitInputRefs.current[Math.max(0, nextIdx)]?.focus();
  };

  const handleVerifyOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    resetMessages();

    const fullCode = codeDigits.join('').trim();
    if (fullCode.length !== 6) {
      setErrorMessage('Informe todos os 6 dígitos do código de verificação.');
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    submitLockRef.current = true;
    setIsLoading(true);
    try {
      const res = await authService.verifyOtp(cleanEmail, fullCode, otpPurpose);
      if (!res.success || !res.data?.session || !res.data?.user) {
        setErrorMessage(res.error || 'Código inválido, expirado ou já utilizado.');
        return;
      }

      if (otpPurpose === 'recovery') {
        onRecoveryModeChange?.(true);
        setPassword('');
        setConfirmPassword('');
        setView('new-password');
        setSuccessMessage('Código validado. Defina sua nova senha.');
        return;
      }

      const name =
        (res.data.user.user_metadata?.full_name as string | undefined) ||
        fullName.trim() ||
        cleanEmail.split('@')[0];

      onAuthSuccess?.(res.data.user.email || cleanEmail, name);
      onClose();
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0 || submitLockRef.current || isLoading) return;
    resetMessages();

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
        setErrorMessage(res.error || 'Não foi possível reenviar o código agora.');
        return;
      }
      setResendCooldown(60);
      setSuccessMessage('Código reenviado para seu e-mail. Verifique sua caixa de entrada e spam.');
      setTimeout(() => digitInputRefs.current[0]?.focus(), 80);
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isLoading) return;
    resetMessages();

    if (!passwordReqs.isValid) {
      setErrorMessage('A nova senha deve ter no mínimo 8 caracteres, com letras e números.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('A confirmação de senha não confere.');
      return;
    }

    submitLockRef.current = true;
    setIsLoading(true);
    try {
      const res = await authService.updatePassword(password);
      if (!res.success) {
        setErrorMessage(res.error || 'Não foi possível salvar sua nova senha.');
        return;
      }
      onRecoveryModeChange?.(false);
      const cleanEmail = res.data?.user?.email || email.trim().toLowerCase();
      const name = (res.data?.user?.user_metadata?.full_name as string | undefined) || cleanEmail.split('@')[0];
      onAuthSuccess?.(cleanEmail, name);
      onClose();
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  const status = getSupabaseConfigStatus();
  const isOtpComplete = codeDigits.every((d) => /^\d$/.test(d));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div
        className="w-full max-w-md bg-[#111216] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden relative my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/80 bg-[#050505]/70">
          <FatosBrLogo size="sm" variant="compact" glow={false} />
          <button
            type="button"
            onClick={() => {
              onRecoveryModeChange?.(false);
              onClose();
            }}
            className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800/60 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {status.isServiceRoleBlocked && (
          <div className="px-5 pt-4">
            <div className="flex items-start space-x-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <span>Chave service_role detectada no cliente. Use exclusivamente a chave pública anon.</span>
            </div>
          </div>
        )}

        <div className="p-5 sm:p-6 space-y-5">
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

          {view === 'login' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {signinMethod === 'otp' ? 'Entrar com código.' : 'Bem-vindo de volta.'}
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  {signinMethod === 'otp'
                    ? 'Receba um código numérico de 6 dígitos por e-mail.'
                    : 'Entre na sua conta para acompanhar o que realmente importa.'}
                </p>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full min-h-[46px] bg-[#050505] border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                </div>

                {signinMethod === 'password' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-zinc-300">Senha</label>
                      <button
                        type="button"
                        onClick={() => {
                          resetMessages();
                          setView('recovery');
                        }}
                        className="text-xs text-zinc-400 hover:text-white cursor-pointer"
                      >
                        Esqueci minha senha
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Digite sua senha"
                        className="w-full min-h-[46px] bg-[#050505] border border-zinc-800 rounded-xl pl-9 pr-10 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-1.5 w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || isGoogleLoading}
                  className="w-full min-h-[48px] flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-zinc-200 text-black font-bold text-sm rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  {isLoading ? (
                    <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>{signinMethod === 'otp' ? 'Enviar código por e-mail' : 'Entrar'}</span>
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={() => {
                  resetMessages();
                  setSigninMethod(signinMethod === 'password' ? 'otp' : 'password');
                }}
                className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-[#050505] border border-zinc-800 hover:border-zinc-600 text-xs font-medium text-zinc-200 hover:text-white cursor-pointer"
              >
                {signinMethod === 'password' ? 'Entrar com código por e-mail' : 'Voltar para e-mail e senha'}
              </button>

              {isSupabaseConfigured && (
                <button
                  type="button"
                  disabled={isLoading || isGoogleLoading}
                  onClick={handleGoogleSignIn}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2.5 px-4 py-2 bg-[#050505] hover:bg-zinc-900 text-zinc-100 border border-zinc-800 rounded-xl text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  <span>Continuar com Google</span>
                </button>
              )}

              <div className="text-center text-xs text-zinc-400">
                <span>Não tem conta? </span>
                <button
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setView('signup');
                  }}
                  className="text-white font-semibold hover:underline cursor-pointer"
                >
                  Criar uma conta
                </button>
              </div>
            </div>
          )}

          {view === 'signup' && (
            <form onSubmit={handleSignUpSubmit} className="space-y-3.5">
              <div>
                <h3 className="text-lg font-bold text-white">Comece com o que importa.</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Crie sua conta e tenha uma experiência de informação personalizada.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Nome completo</label>
                <div className="relative">
                  <User className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Seu nome"
                    className="w-full min-h-[46px] bg-[#050505] border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full min-h-[46px] bg-[#050505] border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres (letras e números)"
                    className="w-full min-h-[46px] bg-[#050505] border border-zinc-800 rounded-xl pl-9 pr-10 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-2 top-1.5 w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Confirmar senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha"
                    className="w-full min-h-[46px] bg-[#050505] border border-zinc-800 rounded-xl pl-9 pr-10 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                    className="absolute right-2 top-1.5 w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-200 cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-2 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-emerald-500"
                />
                <span>
                  Li e aceito os{' '}
                  <button type="button" onClick={() => setLegalTab('terms')} className="text-zinc-200 underline cursor-pointer">
                    Termos de Uso
                  </button>{' '}
                  e a{' '}
                  <button type="button" onClick={() => setLegalTab('lgpd')} className="text-zinc-200 underline cursor-pointer">
                    Política de Privacidade
                  </button>.
                </span>
              </label>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full min-h-[48px] bg-white hover:bg-zinc-200 text-black font-bold text-sm rounded-xl cursor-pointer disabled:opacity-50"
              >
                {isLoading ? 'Criando conta...' : 'Criar minha conta'}
              </button>

              <div className="text-center text-xs text-zinc-400">
                <span>Já tem conta? </span>
                <button
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setView('login');
                  }}
                  className="text-white font-semibold hover:underline cursor-pointer"
                >
                  Entrar
                </button>
              </div>
            </form>
          )}

          {view === 'recovery' && (
            <form onSubmit={handleRecoverySubmit} className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-white">Recuperar acesso.</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Informe seu e-mail para receber o código numérico de 6 dígitos.
                </p>
              </div>

              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full min-h-[46px] bg-[#050505] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
              />

              <button
                type="submit"
                disabled={isLoading}
                className="w-full min-h-[48px] bg-white hover:bg-zinc-200 text-black font-bold text-sm rounded-xl cursor-pointer disabled:opacity-50"
              >
                {isLoading ? 'Enviando...' : 'Enviar código de recuperação'}
              </button>

              <button
                type="button"
                onClick={() => {
                  resetMessages();
                  setView('login');
                }}
                className="w-full text-xs text-zinc-400 hover:text-white py-2 cursor-pointer"
              >
                Voltar para Entrar
              </button>
            </form>
          )}

          {view === 'otp' && (
            <form onSubmit={handleVerifyOtpSubmit} className="space-y-4">
              <div className="space-y-1 text-center">
                <h4 className="text-lg font-bold text-white">Verifique seu e-mail.</h4>
                <p className="text-xs text-zinc-400">
                  Enviamos um código numérico de 6 dígitos para <span className="text-white font-medium break-all">{email}</span>.
                </p>
                <p className="text-[11px] text-zinc-500">Verifique sua caixa de entrada e spam.</p>
              </div>

              <div className="grid grid-cols-6 gap-1.5 sm:gap-2.5" onPaste={handleDigitPaste}>
                {codeDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      digitInputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                    pattern="[0-9]*"
                    maxLength={1}
                    value={digit}
                    aria-label={`Dígito ${idx + 1} de 6`}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                    className="w-full h-12 sm:h-14 rounded-xl border border-zinc-800 bg-[#050505] text-center text-lg sm:text-xl font-mono font-bold text-white focus:outline-none focus:border-white"
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={isLoading || !isOtpComplete}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white hover:bg-zinc-200 text-black font-bold text-sm rounded-xl transition cursor-pointer disabled:opacity-50 min-h-[48px]"
              >
                <span>Confirmar código</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="flex items-center justify-between pt-1 text-xs text-zinc-400">
                <button
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setView(returnView);
                  }}
                  className="flex items-center gap-1 hover:text-white transition cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Alterar e-mail</span>
                </button>

                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={resendCooldown > 0 || isLoading}
                  className="flex items-center gap-1 text-zinc-200 hover:text-white disabled:text-zinc-500 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{resendCooldown > 0 ? `Reenviar código (${resendCooldown}s)` : 'Reenviar código'}</span>
                </button>
              </div>
            </form>
          )}

          {view === 'new-password' && (
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <h4 className="text-lg font-bold text-white">Defina sua nova senha.</h4>
                <p className="text-xs text-zinc-400 mt-1">Mínimo 8 caracteres com letras e números.</p>
              </div>

              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nova senha"
                className="w-full min-h-[46px] bg-[#050505] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
              />

              <input
                type={showConfirmPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirmar nova senha"
                className="w-full min-h-[46px] bg-[#050505] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
              />

              <button
                type="submit"
                disabled={isLoading}
                className="w-full min-h-[48px] bg-white hover:bg-zinc-200 text-black font-bold text-sm rounded-xl cursor-pointer disabled:opacity-50"
              >
                {isLoading ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          )}
        </div>
      </div>

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
