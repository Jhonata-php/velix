'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, setToken, setUser, ApiError } from '@/lib/api';
import { OtpInput, type OtpState } from '@/components/auth/OtpInput';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { Spinner } from '@/components/ui/Spinner';
import { IconMail, IconLock } from '@/components/icons';

// Só aceita caminhos internos (começam com "/", nunca "//") — um `next`
// vindo da URL apontando pra outro host seria um open redirect.
function safeNextPath(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/dashboard';
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [otpState, setOtpState] = useState<OtpState>('idle');
  const [useRecovery, setUseRecovery] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent, codeOverride?: string) {
    e.preventDefault();
    if (loading) return; // evita duplo submit (ex.: Enter + clique quase simultâneos)
    // O código pode vir por parâmetro: quando o OtpInput completa os 6 dígitos
    // ele dispara na hora, e o estado do React ainda não refletiu a última tecla.
    const code = codeOverride ?? totpCode;
    setError(null);
    setLoading(true);
    if (needsTotp) setOtpState('verifying');
    try {
      const data = await apiFetch<{ accessToken: string; user: { name: string; email: string; role: string } }>('/auth/login', {
        method: 'POST',
        // E-mail é normalizado; a senha é enviada exatamente como digitada
        // (trim() cortaria um espaço que pode ser parte real da senha).
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, rememberMe, ...(code ? { totpCode: code } : {}) }),
      });
      setToken(data.accessToken);
      setUser(data.user);
      if (needsTotp) {
        // Deixa a confirmação visível antes de sair da tela: entrar no mesmo
        // instante em que o código é aceito passa a sensação de que nada foi
        // conferido.
        setOtpState('success');
        setTimeout(() => router.push(safeNextPath(searchParams.get('next'))), 700);
        return;
      }
      router.push(safeNextPath(searchParams.get('next')));
    } catch (err) {
      // Pedir o segundo fator não é erro de credencial: a senha estava certa.
      // Limpar a senha aqui obrigaria a redigitar tudo a cada tentativa de
      // código, que é o caminho onde mais se erra.
      if (err instanceof ApiError && err.reason === 'totp_required') {
        setNeedsTotp(true);
        setOtpState('idle');
        setError(null);
        return;
      }
      setError(err instanceof Error ? err.message : 'Falha no login');
      if (err instanceof ApiError && err.reason === 'totp_invalid') {
        setOtpState('error');
        setTotpCode('');
        return;
      }
      // Preserva o e-mail (foi digitado certo, provavelmente), nunca a senha —
      // e leva o foco pro campo mais provável de precisar de correção.
      setPassword('');
      setNeedsTotp(false);
      setTotpCode('');
      setOtpState('idle');
      passwordRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Bem-vindo ao Velix</h1>
        <p className="mt-1.5 text-sm text-slate-500">Entre para acessar seu ambiente.</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            E-mail
          </label>
          <div className="relative">
            <IconMail aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={emailRef}
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!error || undefined}
              className="input pl-9"
              placeholder="suporte@empresa.com"
            />
          </div>
        </div>

        <PasswordInput
          ref={passwordRef}
          label="Senha"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          invalid={!!error}
        />

        {needsTotp && (
          <div>
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {useRecovery ? 'Código de recuperação' : 'Código de verificação'}
            </span>

            {/* Código de recuperação tem 11 caracteres com hífen e não cabe nas
                caixas de 6 dígitos — precisa de um campo próprio, senão a opção
                anunciada abaixo do campo seria impossível de usar. */}
            {useRecovery ? (
              <input
                value={totpCode}
                onChange={(e) => {
                  setTotpCode(e.target.value);
                  if (otpState === 'error') setOtpState('idle');
                }}
                placeholder="a1b2c-3d4e5"
                autoFocus
                autoComplete="off"
                disabled={loading}
                className={`input text-center font-mono tracking-widest ${otpState === 'error' ? 'border-red-500/60' : ''}`}
              />
            ) : (
              <OtpInput
                value={totpCode}
                onChange={(v) => {
                  setTotpCode(v);
                  if (otpState === 'error') setOtpState('idle');
                }}
                onComplete={(code) => handleSubmit(new Event('submit') as unknown as React.FormEvent, code)}
                state={otpState}
              />
            )}

            {otpState !== 'success' && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">
                  {otpState === 'verifying' ? 'Conferindo o código...' : useRecovery ? 'Cada código serve uma vez só.' : 'Do seu app autenticador.'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setUseRecovery((v) => !v);
                    setTotpCode('');
                    setOtpState('idle');
                  }}
                  className="shrink-0 text-xs font-medium text-indigo-500 hover:text-indigo-400 hover:underline"
                >
                  {useRecovery ? 'Usar o app' : 'Perdi o celular'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
            />
            Lembrar de mim
          </label>
          <Link href="/forgot-password" className="text-sm font-medium text-indigo-500 hover:text-indigo-400 hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 btn-primary px-3 py-2.5 text-sm">
          {loading && <Spinner className="h-4 w-4" />}
          {loading ? 'Entrando...' : needsTotp ? 'Verificar código' : 'Entrar'}
        </button>

        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <IconLock aria-hidden className="h-3.5 w-3.5" />
          Conexão protegida por HTTPS
        </p>
      </form>
    </AuthLayout>
  );
}
