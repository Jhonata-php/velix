'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { PasswordStrength } from '@/components/auth/PasswordStrength';
import { Spinner } from '@/components/ui/Spinner';
import { Skeleton } from '@/components/Skeleton';
import { IconCheck, IconAlertTriangle, IconChevronLeft } from '@/components/icons';

type ValidationState = 'checking' | 'valid' | 'not_found' | 'expired' | 'used';

const INVALID_REASON_COPY: Record<Exclude<ValidationState, 'checking' | 'valid'>, { title: string; description: string }> = {
  not_found: { title: 'Link inválido', description: 'Este link de redefinição não é válido. Verifique se copiou o endereço completo ou solicite um novo.' },
  expired: { title: 'Link expirado', description: 'Este link expirou. Solicite uma nova recuperação de senha para continuar.' },
  used: { title: 'Link já utilizado', description: 'Este link já foi usado para redefinir a senha. Solicite um novo, se precisar trocar a senha novamente.' },
};

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [validation, setValidation] = useState<ValidationState>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setValidation('not_found');
      return;
    }
    apiFetch<{ valid: boolean; reason?: 'not_found' | 'expired' | 'used' }>(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`)
      .then((res) => setValidation(res.valid ? 'valid' : (res.reason ?? 'not_found')))
      .catch(() => setValidation('not_found'));
  }, [token]);

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || mismatch) return;
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível redefinir a senha.');
    } finally {
      setLoading(false);
    }
  }

  if (validation === 'checking') {
    return (
      <AuthLayout>
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="mt-6 h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthLayout>
    );
  }

  if (validation !== 'valid') {
    const copy = INVALID_REASON_COPY[validation];
    return (
      <AuthLayout>
        <div className="flex flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            <IconAlertTriangle className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{copy.title}</h1>
          <p className="mt-2 text-sm text-slate-500">{copy.description}</p>
          <Link href="/forgot-password" className="mt-6 btn-primary px-4 py-2 text-sm">
            Solicitar nova recuperação
          </Link>
          <Link href="/login" className="mt-4 flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            <IconChevronLeft className="h-3.5 w-3.5" />
            Voltar para o login
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-500">
            <IconCheck className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Senha alterada com sucesso.</h1>
          <p className="mt-2 text-sm text-slate-500">Todas as sessões anteriores foram encerradas por segurança. Entre novamente com sua nova senha.</p>
          <button onClick={() => router.push('/login')} className="mt-6 btn-primary px-4 py-2 text-sm">
            Voltar para o login
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Criar nova senha</h1>
        <p className="mt-1.5 text-sm text-slate-500">Escolha uma senha forte para proteger sua conta.</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <PasswordInput label="Nova senha" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
          <PasswordStrength password={password} />
        </div>

        <PasswordInput
          label="Confirmar nova senha"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          invalid={mismatch}
          errorMessage="As senhas não coincidem."
        />

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading || mismatch || !password} className="flex w-full items-center justify-center gap-2 btn-primary px-3 py-2.5 text-sm">
          {loading && <Spinner className="h-4 w-4" />}
          {loading ? 'Salvando...' : 'Redefinir senha'}
        </button>
      </form>
    </AuthLayout>
  );
}
