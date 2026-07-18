'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Spinner } from '@/components/ui/Spinner';
import { IconMail, IconCheck, IconChevronLeft } from '@/components/icons';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      // Sempre mostra a mesma confirmação, exista ou não o e-mail — o
      // backend já responde de forma neutra, nunca revela nada aqui.
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar a solicitação.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-500">
            <IconCheck className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Verifique seu e-mail</h1>
          <p className="mt-2 text-sm text-slate-500">
            Se existir uma conta associada a <strong>{email.trim()}</strong>, enviaremos as instruções de recuperação em instantes.
          </p>
          <Link href="/login" className="mt-6 flex items-center gap-1.5 text-sm font-medium text-indigo-500 hover:text-indigo-400 hover:underline">
            <IconChevronLeft className="h-3.5 w-3.5" />
            Voltar para o login
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Recuperar acesso</h1>
        <p className="mt-1.5 text-sm text-slate-500">Informe seu e-mail e enviaremos as instruções para redefinir sua senha.</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="forgot-email" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            E-mail
          </label>
          <div className="relative">
            <IconMail aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="forgot-email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input pl-9"
              placeholder="suporte@empresa.com"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 btn-primary px-3 py-2.5 text-sm">
          {loading && <Spinner className="h-4 w-4" />}
          {loading ? 'Enviando...' : 'Enviar instruções'}
        </button>

        <Link
          href="/login"
          className="flex items-center justify-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <IconChevronLeft className="h-3.5 w-3.5" />
          Voltar para o login
        </Link>
      </form>
    </AuthLayout>
  );
}
