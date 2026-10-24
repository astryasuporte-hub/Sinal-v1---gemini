/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient, SupabaseClient, SupabaseClientOptions } from '@supabase/supabase-js';

// Extrair e sanitizar variáveis de ambiente Vite
const rawSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const rawSupabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/**
 * Detecta se a execução atual está ocorrendo no ambiente do navegador (cliente).
 */
export const isBrowserEnvironment = (): boolean => typeof window !== 'undefined';

/**
 * Decodifica o payload de um token JWT para verificar a role sem depender de bibliotecas externas.
 */
export function parseJwtRole(token?: string): string | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const parsed = JSON.parse(jsonPayload);
    return parsed.role || null;
  } catch {
    return null;
  }
}

/**
 * Verifica se uma chave é especificamente a chave mestra 'service_role'.
 */
export function isServiceRoleKey(key?: string): boolean {
  if (!key) return false;
  const role = parseJwtRole(key);
  if (role === 'service_role') return true;

  // Verificação defensiva adicional contra strings cruas ou payloads serializados
  try {
    if (key.includes('service_role') && key.startsWith('eyJ')) {
      return true;
    }
  } catch {
    // Ignorar falha de parse
  }

  return false;
}

/**
 * FUNÇÃO DE VERIFICAÇÃO DE SEGURANÇA:
 * Impede estritamente qualquer tentativa de instanciar o cliente do Supabase
 * usando a chave 'service_role' no ambiente do navegador (cliente).
 *
 * @throws Error se a chave 'service_role' for detectada no navegador.
 */
export function assertBrowserSafeSupabaseKey(key?: string): void {
  if (!key) return;

  const isClientEnv = isBrowserEnvironment();
  const isServiceRole = isServiceRoleKey(key);

  if (isClientEnv && isServiceRole) {
    const errorMsg =
      '[VIOLAÇÃO CRÍTICA DE SEGURANÇA]: Tentativa de instanciar o cliente Supabase usando a chave "service_role" no ambiente do navegador (cliente). ' +
      'A service_role possui privilégios totais de superusuário que ignoram todas as políticas de Row Level Security (RLS). ' +
      'Use EXCLUSIVAMENTE a chave pública "anon" no frontend.';

    console.error(
      `%c[SEGURANÇA SUPABASE - BLOQUEIO]%c ${errorMsg}`,
      'background: #b91c1c; color: white; font-weight: bold; padding: 4px 8px; border-radius: 4px;',
      'color: #ef4444; font-weight: bold;'
    );

    throw new Error(errorMsg);
  }
}

/**
 * Valida se a URL fornecida tem formato válido de endpoint Supabase
 */
export function isValidSupabaseUrl(url?: string): boolean {
  if (!url) return false;
  if (url === 'https://your-project-ref.supabase.co' || url.includes('placeholder')) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Validação abrangente da chave com status detalhado
 */
export interface SupabaseKeyValidation {
  isValid: boolean;
  isServiceRole: boolean;
  role: string | null;
  error?: string;
}

export function validateSupabaseKey(key?: string): SupabaseKeyValidation {
  if (!key || key === 'your-anon-public-key' || key.includes('placeholder')) {
    return { isValid: false, isServiceRole: false, role: null };
  }

  const role = parseJwtRole(key);

  if (role === 'service_role' || isServiceRoleKey(key)) {
    return {
      isValid: false,
      isServiceRole: true,
      role: 'service_role',
      error:
        'SEGURANÇA: Chave "service_role" detectada! Chaves service_role ignoram regras de RLS e NUNCA devem ser usadas no cliente/frontend. Use exclusivamente a chave pública "anon".',
    };
  }

  if (role === 'anon') {
    return { isValid: true, isServiceRole: false, role: 'anon' };
  }

  if (key.startsWith('eyJ') && key.length > 50) {
    return { isValid: true, isServiceRole: false, role: role || 'jwt' };
  }

  return {
    isValid: false,
    isServiceRole: false,
    role: null,
    error: 'Formato de chave Supabase inválido.',
  };
}

/**
 * Factory segura para criação de clientes Supabase.
 * Executa a verificação assertBrowserSafeSupabaseKey antes de qualquer instanciação.
 */
export function createSafeSupabaseClient(
  url?: string,
  key?: string,
  options?: SupabaseClientOptions<'public'>
): SupabaseClient {
  // Verificação mandatória contra service_role no navegador
  assertBrowserSafeSupabaseKey(key);

  const finalUrl = isValidSupabaseUrl(url) && url ? url : 'https://placeholder.supabase.co';
  const finalKey = key && !isServiceRoleKey(key) ? key : 'placeholder-anon-key';

  return createClient(finalUrl, finalKey, options || {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

// Executar validações para a inicialização padrão
const urlValid = isValidSupabaseUrl(rawSupabaseUrl);
const keyValidation = validateSupabaseKey(rawSupabaseAnonKey);

// Executar verificação defensiva de segurança
let isServiceRoleBlocked = false;
try {
  assertBrowserSafeSupabaseKey(rawSupabaseAnonKey);
} catch {
  isServiceRoleBlocked = true;
}

/**
 * Flag indicando se a configuração é válida, segura e pronta para uso.
 * Permanece FALSE se a URL for inválida ou se uma service_role for detectada.
 */
export const isSupabaseConfigured: boolean = Boolean(
  urlValid && keyValidation.isValid && !keyValidation.isServiceRole && !isServiceRoleBlocked
);

// Inicializar cliente padrão de forma segura (nunca permite service_role)
export const supabase: SupabaseClient = createSafeSupabaseClient(
  isSupabaseConfigured && rawSupabaseUrl ? rawSupabaseUrl : undefined,
  isSupabaseConfigured && rawSupabaseAnonKey ? rawSupabaseAnonKey : undefined,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

/**
 * Retorna diagnóstico completo de configuração do Supabase
 */
export function getSupabaseConfigStatus() {
  return {
    configured: isSupabaseConfigured,
    urlValid,
    keyValid: keyValidation.isValid,
    isServiceRoleBlocked: keyValidation.isServiceRole || isServiceRoleBlocked,
    role: keyValidation.role,
    error: keyValidation.error,
    supabaseUrl: isSupabaseConfigured ? rawSupabaseUrl : undefined,
    isBrowser: isBrowserEnvironment(),
  };
}

/**
 * Testa a conectividade com o banco Supabase de forma segura
 */
export async function checkSupabaseConnection(): Promise<{
  connected: boolean;
  message: string;
  role?: string | null;
}> {
  if (keyValidation.isServiceRole || isServiceRoleBlocked) {
    return {
      connected: false,
      message:
        'Bloqueio de segurança ativo: Foi detectada uma chave "service_role". Instanciação bloqueada no navegador. Substitua pela chave "anon".',
      role: 'service_role',
    };
  }

  if (!isSupabaseConfigured) {
    return {
      connected: false,
      message:
        'Supabase não configurado ou chaves ausentes. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env ou na Vercel.',
    };
  }

  try {
    const { error } = await supabase.from('topics').select('id').limit(1);
    if (error) {
      return {
        connected: false,
        message: `Conectado ao Supabase, mas a consulta falhou: ${error.message}. (Verifique se o script schema.sql foi executado no Supabase)`,
        role: keyValidation.role,
      };
    }
    return {
      connected: true,
      message: 'Conectado com sucesso ao Supabase PostgreSQL via chave pública "anon".',
      role: keyValidation.role,
    };
  } catch (err) {
    return {
      connected: false,
      message: err instanceof Error ? err.message : 'Erro ao conectar ao Supabase.',
    };
  }
}
